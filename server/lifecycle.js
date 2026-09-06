const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const config = require('./config');
const { parseSkillFile, calculateDirHash } = require('./scanner');

/**
 * 1. BUILT-IN: Fork a built-in or system skill into user's custom directory
 */
function forkToCustom(sourceSkillPath, newName, targetEnv = 'windows') {
  if (!fs.existsSync(sourceSkillPath)) {
    throw new Error(`Source skill path does not exist: ${sourceSkillPath}`);
  }

  const baseDest = config.defaultCustomDir[targetEnv] || config.defaultCustomDir.windows;
  const cleanName = (newName || path.basename(sourceSkillPath))
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const destDir = path.join(baseDest, cleanName);

  if (fs.existsSync(destDir)) {
    throw new Error(`Target custom skill directory already exists: ${destDir}`);
  }

  // Copy whole folder
  fs.cpSync(sourceSkillPath, destDir, { recursive: true });

  // Update frontmatter name in SKILL.md
  const skillMdPath = path.join(destDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    let content = fs.readFileSync(skillMdPath, 'utf8');
    content = content.replace(/^name:\s*.+$/m, `name: ${cleanName}`);
    fs.writeFileSync(skillMdPath, content, 'utf8');
  }

  return {
    success: true,
    name: cleanName,
    path: destDir,
    env: targetEnv,
    hash: calculateDirHash(destDir)
  };
}

/**
 * 2. DOWNLOADED: Check upstream remote for updates
 */
function checkUpstreamUpdate(upstream) {
  if (!upstream || !upstream.sourceUrl) {
    throw new Error('No upstream sourceUrl configured for this skill');
  }

  try {
    const output = execSync(`git ls-remote ${upstream.sourceUrl} HEAD`, {
      encoding: 'utf8',
      timeout: 8000
    });
    const match = output.match(/^([a-f0-9]+)\s+/);
    if (!match) {
      return { hasUpdate: false, error: 'Could not parse remote commit' };
    }

    const remoteCommit = match[1];
    const localCommit = upstream.lockHash || '';
    const hasUpdate = !localCommit || !remoteCommit.startsWith(localCommit.slice(0, 7));

    return {
      success: true,
      remoteCommit: remoteCommit.slice(0, 10),
      localCommit: localCommit ? localCommit.slice(0, 10) : 'unknown',
      sourceUrl: upstream.sourceUrl,
      hasUpdate
    };
  } catch (err) {
    return {
      success: false,
      error: `Git check failed: ${err.message}`
    };
  }
}

/**
 * Compare two text files or SKILL.md contents (e.g. Win vs WSL)
 */
function getSkillDiff(fileA, fileB) {
  const contentA = fs.existsSync(fileA) ? fs.readFileSync(fileA, 'utf8') : '(file not found)';
  const contentB = fs.existsSync(fileB) ? fs.readFileSync(fileB, 'utf8') : '(file not found)';

  const linesA = contentA.split(/\r?\n/);
  const linesB = contentB.split(/\r?\n/);

  return {
    pathA: fileA,
    pathB: fileB,
    linesA,
    linesB,
    isEqual: contentA === contentB
  };
}

/**
 * 3. CUSTOM: Scaffold a new skill following agentskills.io standard
 */
function scaffoldSkill({ name, description, targetEnv = 'windows' }) {
  if (!name) throw new Error('Skill name is required');
  const cleanName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const baseDir = config.defaultCustomDir[targetEnv] || config.defaultCustomDir.windows;
  const targetDir = path.join(baseDir, cleanName);

  if (fs.existsSync(targetDir)) {
    throw new Error(`Directory already exists: ${targetDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'references'), { recursive: true });

  const descText = description || `Use this skill when the user asks to perform ${cleanName} workflows.`;
  const initialSkillMd = `---
name: ${cleanName}
description: >-
  ${descText}
---

# ${cleanName}

## Overview
Describe what this skill does and the procedural steps for the agent to follow.

## Instructions
1. Step 1: Initial setup
2. Step 2: Main execution
3. Step 3: Validation and verification
`;

  fs.writeFileSync(path.join(targetDir, 'SKILL.md'), initialSkillMd, 'utf8');

  return {
    success: true,
    name: cleanName,
    path: targetDir,
    env: targetEnv
  };
}

/**
 * Linter validating SKILL.md specification
 */
function lintSkill(skillDir) {
  const skillMd = path.join(skillDir, 'SKILL.md');
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(skillMd)) {
    errors.push('Missing SKILL.md in root of skill directory');
    return { valid: false, errors, warnings };
  }

  const content = fs.readFileSync(skillMd, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    errors.push('Missing or malformed YAML frontmatter (must start and end with ---)');
  } else {
    const yaml = match[1];
    const nameMatch = yaml.match(/^name:\s*(.+)$/m);
    const descMatch = yaml.match(/^description:\s*(?:>-\s*)?([\s\S]*?)(?=\n[a-z_]+:|$)/m);

    if (!nameMatch) {
      errors.push('Missing required frontmatter field: "name"');
    } else {
      const nameVal = nameMatch[1].trim();
      if (!/^[a-z0-9_-]+$/.test(nameVal)) {
        warnings.push('Skill name should only contain lowercase letters, numbers, hyphens and underscores');
      }
    }

    if (!descMatch || !descMatch[1].trim()) {
      errors.push('Missing required frontmatter field: "description"');
    } else if (descMatch[1].trim().length < 20) {
      warnings.push('Description is very short; agents use description to trigger skills, so provide clear triggers (e.g. "Use this skill when...")');
    }
  }

  if (!fs.existsSync(path.join(skillDir, 'scripts'))) {
    warnings.push('Optional scripts/ directory not found (recommended for executable helpers)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Open skill directory in Cursor, VS Code, or Explorer
 */
function openInEditor(dirPath, editor = 'cursor') {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  // Normalize path for Windows CLI execution
  const normalizedPath = path.resolve(dirPath);

  // Candidate commands
  let cmd = `cursor "${normalizedPath}"`;
  if (editor === 'code') {
    cmd = `code "${normalizedPath}"`;
  } else if (editor === 'explorer') {
    cmd = `explorer "${normalizedPath}"`;
  }

  // Execute asynchronously
  exec(cmd, { windowsHide: true }, (err) => {
    if (err) {
      console.warn(`Editor launch failed for [${cmd}], falling back to Explorer:`, err.message);
      exec(`explorer "${normalizedPath}"`);
    }
  });

  return { success: true, command: cmd, path: normalizedPath };
}

module.exports = {
  forkToCustom,
  checkUpstreamUpdate,
  getSkillDiff,
  scaffoldSkill,
  lintSkill,
  openInEditor
};
