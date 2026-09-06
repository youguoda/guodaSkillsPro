const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { scanAllSkills, parseSkillFile, getInventory, invalidateInventory, resolveSkill, pathExists } = require('./scanner');
const { syncSkill, syncDirectory } = require('./sync');
const { getOverrides, setOverride, deleteOverride } = require('./overrides');
const {
  forkToCustom,
  checkUpstreamUpdate,
  getSkillDiff,
  scaffoldSkill,
  lintSkill,
  openInEditor
} = require('./lifecycle');

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
    res.json({ success: true, stats, targets, skills });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

  if (!skillPath || !(await pathExists(skillPath))) {
    return res.status(404).json({ success: false, error: 'Skill directory not found' });
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
    res.status(500).json({ success: false, error: err.message });
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
    const targetFile = path.join(skillPath, 'SKILL.md');
    fs.writeFileSync(targetFile, content, 'utf8');
    const lint = lintSkill(skillPath);
    invalidateInventory();
    res.json({ success: true, lint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Sync single skill between Windows and WSL
 */
router.post('/sync', async (req, res) => {
  const { skill, direction } = req.body;
  if (!skill || !direction) {
    return res.status(400).json({ success: false, error: 'Missing skill or direction' });
  }

  try {
    const result = await syncSkill(skill, direction);
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const result = await forkToCustom(sourcePath, newName, targetEnv);
    invalidateInventory();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Check upstream update for downloaded skill
 */
router.post('/check-update', async (req, res) => {
  const { upstream } = req.body;
  if (!upstream) {
    return res.status(400).json({ success: false, error: 'Missing upstream metadata' });
  }

  try {
    const result = await checkUpstreamUpdate(upstream);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Compare Diff between Windows and WSL instance of SKILL.md
 */
router.post('/diff', (req, res) => {
  const { skill } = req.body;
  if (!skill || !skill.instances.windows[0] || !skill.instances.wsl[0]) {
    return res.status(400).json({ success: false, error: 'Skill must exist in both Windows and WSL to compare diff' });
  }

  try {
    const winFile = path.join(skill.instances.windows[0].path, 'SKILL.md');
    const wslFile = path.join(skill.instances.wsl[0].path, 'SKILL.md');
    const diff = getSkillDiff(winFile, wslFile);
    res.json({ success: true, diff });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    const result = openInEditor(dirPath, editor || 'cursor');
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

