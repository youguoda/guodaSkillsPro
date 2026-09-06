const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { scanAllSkills, parseSkillFile } = require('./scanner');
const { syncSkill, syncDirectory } = require('./sync');
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
router.get('/system-info', (req, res) => {
  res.json({
    winUser: config.WIN_USER_HOME,
    wslDistro: config.WSL_DISTRO,
    wslUser: config.WSL_USER,
    wslHomeUnc: config.WSL_HOME_UNC,
    targets: config.targets.map(t => ({
      id: t.id,
      name: t.name,
      agentId: t.agentId,
      agentName: t.agentName,
      env: t.env,
      dir: t.dir,
      displayBase: t.displayBase,
      exists: fs.existsSync(t.dir)
    }))
  });
});

/**
 * List all discovered skills with dual-env status & target stats
 */
router.get('/skills', (req, res) => {
  try {
    const { skills, targets } = scanAllSkills();
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
router.get('/skill-detail', (req, res) => {
  let skillPath = req.query.path;
  const skillId = req.query.id;

  if (skillId && !skillPath) {
    const { skills } = scanAllSkills();
    const found = skills.find(s => s.id === skillId.toLowerCase());
    if (found && found.managedBy && found.managedBy.length > 0) {
      skillPath = found.managedBy[0].path;
    }
  }

  if (!skillPath || !fs.existsSync(skillPath)) {
    return res.status(404).json({ success: false, error: 'Skill directory not found' });
  }

  try {
    const parsed = parseSkillFile(skillPath);
    const lint = lintSkill(skillPath);
    
    // Read all files in folder
    const files = [];
    function readFolder(dir, rel = '') {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith('.git')) continue;
        const relPath = path.join(rel, item.name);
        if (item.isDirectory()) {
          readFolder(path.join(dir, item.name), relPath);
        } else {
          files.push({ name: item.name, path: relPath, size: fs.statSync(path.join(dir, item.name)).size });
        }
      }
    }
    readFolder(skillPath);

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
router.post('/save-skill', (req, res) => {
  let { skillPath, skillId, content } = req.body;

  if (!skillPath && skillId) {
    const { skills } = scanAllSkills();
    const found = skills.find(s => s.id === skillId.toLowerCase());
    if (found && found.managedBy && found.managedBy.length > 0) {
      skillPath = found.managedBy[0].path;
    }
  }

  if (!skillPath || typeof content !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid parameters: skillPath and content are required' });
  }

  try {
    const targetFile = path.join(skillPath, 'SKILL.md');
    fs.writeFileSync(targetFile, content, 'utf8');
    const lint = lintSkill(skillPath);
    res.json({ success: true, lint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Sync single skill between Windows and WSL
 */
router.post('/sync', (req, res) => {
  const { skill, direction } = req.body;
  if (!skill || !direction) {
    return res.status(400).json({ success: false, error: 'Missing skill or direction' });
  }

  try {
    const result = syncSkill(skill, direction);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Fork built-in skill into user custom skill
 */
router.post('/fork', (req, res) => {
  let { sourcePath, skillId, newName, targetEnv } = req.body;

  if (!sourcePath && skillId) {
    const { skills } = scanAllSkills();
    const found = skills.find(s => s.id === skillId.toLowerCase());
    if (found && found.managedBy && found.managedBy.length > 0) {
      sourcePath = found.managedBy[0].path;
    }
  }

  if (!sourcePath) {
    return res.status(400).json({ success: false, error: 'Source path is required' });
  }

  try {
    const result = forkToCustom(sourcePath, newName, targetEnv);
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
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Check upstream update for downloaded skill
 */
router.post('/check-update', (req, res) => {
  const { upstream } = req.body;
  if (!upstream) {
    return res.status(400).json({ success: false, error: 'Missing upstream metadata' });
  }

  try {
    const result = checkUpstreamUpdate(upstream);
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
router.post('/open-editor', (req, res) => {
  let { path: dirPath, skillId, targetId, editor } = req.body;

  if (!dirPath && skillId) {
    const { skills } = scanAllSkills();
    const found = skills.find(s => s.id === skillId.toLowerCase());
    if (found && found.managedBy && found.managedBy.length > 0) {
      if (targetId) {
        const specific = found.managedBy.find(m => m.targetId === targetId);
        dirPath = specific ? specific.path : found.managedBy[0].path;
      } else {
        dirPath = found.managedBy[0].path;
      }
    }
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

module.exports = router;
