const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

/**
 * Parses YAML frontmatter and body from SKILL.md
 */
function parseSkillFile(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;

  try {
    const rawContent = fs.readFileSync(skillMdPath, 'utf8');
    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
    
    let name = path.basename(skillDir);
    let description = '';
    let frontmatterRaw = '';
    let body = rawContent;
    let hasValidFrontmatter = false;

    if (match) {
      hasValidFrontmatter = true;
      frontmatterRaw = match[1];
      body = match[2].trim();

      const nameMatch = frontmatterRaw.match(/^name:\s*(.+)$/m);
      const descMatch = frontmatterRaw.match(/^description:\s*(?:>-\s*)?([\s\S]*?)(?=\n[a-z_]+:|$)/m);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].replace(/\r?\n\s*/g, ' ').trim();
    }

    return {
      name,
      description,
      hasValidFrontmatter,
      frontmatterRaw,
      body,
      rawContent,
      skillMdPath
    };
  } catch (err) {
    console.error(`Error reading ${skillMdPath}:`, err.message);
    return null;
  }
}

/**
 * Calculates a reproducible hash for directory contents
 */
function calculateDirHash(dir) {
  const hash = crypto.createHash('sha256');
  function hashEntries(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    // Sort for deterministic hashing
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.git') || entry.name === '.sync-manifest.json') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        hashEntries(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          hash.update(entry.name);
          hash.update(content);
        } catch (e) {}
      }
    }
  }
  try {
    hashEntries(dir);
  } catch (e) {}
  return hash.digest('hex').slice(0, 10);
}

/**
 * Scans directories and returns a unified, cross-environment skills inventory
 */
function scanAllSkills() {
  // 1. Load lockfile(s)
  const lockfileMap = new Map();
  for (const target of config.targets) {
    if (target.lockfile && fs.existsSync(target.lockfile)) {
      try {
        const data = JSON.parse(fs.readFileSync(target.lockfile, 'utf8'));
        if (data.skills) {
          for (const [key, val] of Object.entries(data.skills)) {
            lockfileMap.set(key.toLowerCase(), val);
          }
        }
      } catch (e) {
        console.warn('Could not parse lockfile:', target.lockfile);
      }
    }
  }

  // 2. Discover all skill folders across all targets
  const rawList = [];

  for (const target of config.targets) {
    if (!fs.existsSync(target.dir)) continue;

    try {
      const items = fs.readdirSync(target.dir, { withFileTypes: true });
      for (const item of items) {
        if (!item.isDirectory() || item.name.startsWith('.')) continue;

        const skillDir = path.join(target.dir, item.name);
        const parsed = parseSkillFile(skillDir);
        if (!parsed) continue;

        const dirHash = calculateDirHash(skillDir);

        // Determine tier
        let tier = target.tier;
        let upstream = null;

        if (target.tier === 'builtin' || item.name.includes('.system') || target.dir.includes('.system')) {
          tier = 'builtin';
        } else {
          const lockKey = parsed.name.toLowerCase();
          const itemKey = item.name.toLowerCase();
          const lockData = lockfileMap.get(lockKey) || lockfileMap.get(itemKey);

          if (lockData) {
            tier = 'downloaded';
            upstream = {
              source: lockData.source,
              sourceType: lockData.sourceType || 'github',
              sourceUrl: lockData.sourceUrl,
              skillPath: lockData.skillPath,
              lockHash: lockData.skillFolderHash,
              updatedAt: lockData.updatedAt
            };
          } else {
            tier = 'custom';
          }
        }

        // Check helper files
        const subdirs = [];
        for (const sub of ['scripts', 'references', 'examples', 'resources']) {
          if (fs.existsSync(path.join(skillDir, sub))) subdirs.push(sub);
        }

        rawList.push({
          skillName: parsed.name,
          dirName: item.name,
          env: target.env,
          agent: target.agent,
          targetId: target.id,
          targetName: target.name,
          tier,
          dirHash,
          path: skillDir,
          description: parsed.description,
          subdirs,
          hasValidFrontmatter: parsed.hasValidFrontmatter,
          upstream
        });
      }
    } catch (err) {
      console.warn(`Scan error in ${target.dir}:`, err.message);
    }
  }

  // 3. Aggregate across environments into unified entries
  const aggregatedMap = new Map();

  for (const item of rawList) {
    const key = item.skillName.toLowerCase();
    if (!aggregatedMap.has(key)) {
      aggregatedMap.set(key, {
        id: key,
        name: item.skillName,
        description: item.description,
        tier: item.tier,
        subdirs: item.subdirs,
        upstream: item.upstream,
        instances: {
          windows: [],
          wsl: []
        }
      });
    }

    const group = aggregatedMap.get(key);
    // Prioritize richer metadata if another instance has it
    if (!group.description && item.description) group.description = item.description;
    if (item.tier === 'builtin') group.tier = 'builtin';
    else if (item.tier === 'downloaded' && group.tier !== 'builtin') group.tier = 'downloaded';
    if (!group.upstream && item.upstream) group.upstream = item.upstream;

    group.instances[item.env].push({
      agent: item.agent,
      targetId: item.targetId,
      path: item.path,
      dirHash: item.dirHash,
      hasValidFrontmatter: item.hasValidFrontmatter
    });
  }

  // 4. Compute status flags for each skill
  const unifiedList = Array.from(aggregatedMap.values()).map(skill => {
    const hasWin = skill.instances.windows.length > 0;
    const hasWsl = skill.instances.wsl.length > 0;

    let syncStatus = 'unknown';
    let winHash = hasWin ? skill.instances.windows[0].dirHash : null;
    let wslHash = hasWsl ? skill.instances.wsl[0].dirHash : null;

    if (hasWin && !hasWsl) {
      syncStatus = 'windows_only';
    } else if (!hasWin && hasWsl) {
      syncStatus = 'wsl_only';
    } else if (hasWin && hasWsl) {
      syncStatus = (winHash === wslHash) ? 'synced' : 'diff';
    }

    return {
      ...skill,
      syncStatus,
      winHash,
      wslHash,
      hasWin,
      hasWsl
    };
  });

  // Sort alphabetically by name
  unifiedList.sort((a, b) => a.name.localeCompare(b.name));
  return unifiedList;
}

module.exports = {
  scanAllSkills,
  parseSkillFile,
  calculateDirHash
};
