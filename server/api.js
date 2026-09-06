const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { scanAllSkills, parseSkillFile, getInventory, invalidateInventory, resolveSkill } = require('./scanner');
const { pathExists } = require('./fs-utils');
const { syncDirectory, syncSkillByEnv } = require('./sync');
const { getOverrides, setOverride, deleteOverride } = require('./overrides');
const { HttpError, assertContainedSkillPath } = require('./guard');
const { TIERS, SYNC_STATUSES, tierLabel, tierIcon } = require('./vocab');
const {
  forkToCustom,
  checkUpstreamUpdate,
  getSkillDiff,
  scaffoldSkill,
  lintSkill,
  openInEditor
} = require('./lifecycle');

/** Map guard/lifecycle errors to proper HTTP status codes */
function sendError(res, err, fallbackStatus = 500) {
  res.status(err.statusCode || fallbackStatus).json({ success: false, error: err.message });
}

/**
 * System metadata & environment info
 */
router.get('/system-info', async (req, res) => {
  const targets = await Promise.all(config.targets.map(async t => ({
    id: t.id,
    name: t.name,
    agentId: t.agentId,
    agentName: t.agentName,
    env: t.env,
    dir: t.dir,
    displayBase: t.displayBase,
    exists: await pathExists(t.dir)
  })));
  res.json({
    success: true,
    winUser: config.WIN_USER_HOME,
    wslDistro: config.WSL_DISTRO,
    wslUser: config.WSL_USER,
    wslHomeUnc: config.WSL_HOME_UNC,
    targets
  });
});

/**
 * List all discovered skills with dual-env status & target stats
 * ?force=1 bypasses the inventory cache (used by the manual refresh button)
 */
router.get('/skills', async (req, res) => {
  try {
    const force = req.query.force === '1';
    const { skills, targets } = await getInventory({ force });
    const stats = {
      total: skills.length,
      windows: skills.filter(s => s.hasWin).length,
      wsl: skills.filter(s => s.hasWsl).length,
      synced: skills.filter(s => s.syncStatus === 'synced').length,
      diff: skills.filter(s => s.syncStatus === 'diff').length,
      winOnly: skills.filter(s => s.syncStatus === 'windows_only').length,
      wslOnly: skills.filter(s => s.syncStatus === 'wsl_only').length,
      builtin: skills.filter(s => s.tier === 'builtin').length,
      downloaded: skills.filter(s => s.tier === 'downloaded').length,
      custom: skills.filter(s => s.tier === 'custom').length
    };
    const meta = {
      tiers: TIERS,
      syncStatuses: SYNC_STATUSES,
      customSkillEnvs: [
        { id: 'windows', label: `Windows: ${path.basename(config.defaultCustomDir.windows)}  (${config.defaultCustomDir.windows})` },
        { id: 'wsl', label: `WSL: Cursor skills  (${config.defaultCustomDir.wsl})` }
      ]
    };
    res.json({ success: true, stats, targets, meta, skills });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Read full SKILL.md and directory structure by id or by path
 */
router.get('/skill-detail', async (req, res) => {
  let skillPath = req.query.path;
  const skillId = req.query.id;

  if (skillId && !skillPath) {
    const { instance } = resolveSkill(await getInventory(), skillId);
    skillPath = instance ? instance.path : undefined;
  }

  try {
    await assertContainedSkillPath(skillPath, 'path');
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const parsed = await parseSkillFile(skillPath);
    const lint = lintSkill(skillPath);

    // Read all files in folder
    const files = [];
    async function readFolder(dir, rel = '') {
      const items = await fsp.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.git')) continue;
        const relPath = path.join(rel, item.name);
        if (item.isDirectory()) {
          await readFolder(path.join(dir, item.name), relPath);
        } else {
          const stat = await fsp.stat(path.join(dir, item.name));
          files.push({ name: item.name, path: relPath, size: stat.size });
        }
      }
    }
    await readFolder(skillPath);

    res.json({
      success: true,
      path: skillPath,
      parsed,
      lint,
      files
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Save updated SKILL.md
 */
router.post('/save-skill', async (req, res) => {
  let { skillPath, skillId, content } = req.body;

  if (!skillPath && skillId) {
    const { instance } = resolveSkill(await getInventory(), skillId);
    skillPath = instance ? instance.path : undefined;
  }

  if (!skillPath || typeof content !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid parameters: skillPath and content are required' });
  }

  try {
    await assertContainedSkillPath(skillPath, 'skillPath');
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const targetFile = path.join(skillPath, 'SKILL.md');
    await fsp.writeFile(targetFile, content, 'utf8');
    const lint = lintSkill(skillPath);
    invalidateInventory();
    res.json({ success: true, lint });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Sync single skill between Windows and WSL (by skillId — no client paths)
 */
router.post('/sync', async (req, res) => {
  const { skillId, direction } = req.body;
  if (!skillId || !direction) {
    return res.status(400).json({ success: false, error: 'Missing skillId or direction' });
  }
  if (direction !== 'to_wsl' && direction !== 'to_windows') {
    return res.status(400).json({ success: false, error: `Invalid direction: ${direction}` });
  }

  try {
    const { skill } = resolveSkill(await getInventory(), skillId);
    if (!skill) throw new HttpError(404, `Unknown skill: ${skillId}`);

    const result = await syncSkillByEnv(skill.instances, skill.name, direction);
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Fork built-in skill into user custom skill
 */
router.post('/fork', async (req, res) => {
  let { sourcePath, skillId, newName, targetEnv } = req.body;

  if (!sourcePath && skillId) {
    const { instance } = resolveSkill(await getInventory(), skillId);
    sourcePath = instance ? instance.path : undefined;
  }

  if (!sourcePath) {
    return res.status(400).json({ success: false, error: 'Source path is required' });
  }

  try {
    await assertContainedSkillPath(sourcePath, 'sourcePath');
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const result = await forkToCustom(sourcePath, newName, targetEnv);
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Scaffold a new custom skill
 */
router.post('/scaffold', (req, res) => {
  const { name, description, targetEnv } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'Skill name is required' });
  }

  try {
    const result = scaffoldSkill({ name, description, targetEnv });
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Check upstream update for downloaded skill (by skillId)
 */
router.post('/check-update', async (req, res) => {
  const { skillId } = req.body;
  if (!skillId) {
    return res.status(400).json({ success: false, error: 'Missing skillId' });
  }

  try {
    const { skill } = resolveSkill(await getInventory(), skillId);
    if (!skill) throw new HttpError(404, `Unknown skill: ${skillId}`);
    if (!skill.upstream || !skill.upstream.sourceUrl) {
      throw new HttpError(400, 'This skill has no upstream repository bound');
    }

    const result = await checkUpstreamUpdate(skill.upstream);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Compare Diff between Windows and WSL instance of SKILL.md (by skillId)
 */
router.post('/diff', async (req, res) => {
  const { skillId } = req.body;
  if (!skillId) {
    return res.status(400).json({ success: false, error: 'Missing skillId' });
  }

  try {
    const { skill } = resolveSkill(await getInventory(), skillId);
    if (!skill) throw new HttpError(404, `Unknown skill: ${skillId}`);
    if (!skill.instances.windows[0] || !skill.instances.wsl[0]) {
      throw new HttpError(400, 'Skill must exist in both Windows and WSL to compare diff');
    }

    const winFile = path.join(skill.instances.windows[0].path, 'SKILL.md');
    const wslFile = path.join(skill.instances.wsl[0].path, 'SKILL.md');
    const diff = getSkillDiff(winFile, wslFile);
    res.json({ success: true, diff });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Open folder in editor by path or skillId
 */
router.post('/open-editor', async (req, res) => {
  let { path: dirPath, skillId, targetId, editor } = req.body;

  if (!dirPath && skillId) {
    const { instance } = resolveSkill(await getInventory(), skillId, targetId);
    dirPath = instance ? instance.path : undefined;
  }

  if (!dirPath) {
    return res.status(400).json({ success: false, error: 'Path or valid skillId is required' });
  }

  try {
    await assertContainedSkillPath(dirPath, 'path');
  } catch (err) {
    return sendError(res, err);
  }

  try {
    const result = openInEditor(dirPath, editor || 'cursor');
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Get all manual user overrides
 */
router.get('/overrides', (req, res) => {
  res.json({ success: true, overrides: getOverrides() });
});

/**
 * Set manual user override for a skill (tier, upstreamUrl, notes)
 */
router.post('/set-override', (req, res) => {
  const { skillId, tier, upstreamUrl, tags, notes } = req.body;
  if (!skillId) {
    return res.status(400).json({ success: false, error: 'skillId is required' });
  }

  try {
    const result = setOverride(skillId, { tier, upstreamUrl, tags, notes });
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Reset manual user override (restore automatic detection)
 */
router.post('/reset-override', (req, res) => {
  const { skillId } = req.body;
  if (!skillId) {
    return res.status(400).json({ success: false, error: 'skillId is required' });
  }

  try {
    const success = deleteOverride(skillId);
    if (success) invalidateInventory();
    res.json({ success, message: success ? 'Override removed' : 'No override existed' });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;

