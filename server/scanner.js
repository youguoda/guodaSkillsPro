const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { getOverrides } = require('./overrides');

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

      if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      if (descMatch) description = descMatch[1].replace(/\r?\n\s*/g, ' ').trim().replace(/^["']|["']$/g, '');
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
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (
        entry.name.startsWith('.git') ||
        entry.name === '.sync-manifest.json' ||
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name === 'venv' ||
        entry.name === '.venv'
      ) continue;
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
 * Recursively discover skill directories (supporting category subfolders like Hermes / OpenClaw)
 */
function discoverSkillDirectories(baseDir, maxDepth = 2, currentDepth = 0) {
  const list = [];
  if (!fs.existsSync(baseDir) || currentDepth > maxDepth) return list;

  try {
    const items = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const item of items) {
      if (!item.isDirectory() || item.name.startsWith('.')) continue;
      const fullPath = path.join(baseDir, item.name);

      if (fs.existsSync(path.join(fullPath, 'SKILL.md'))) {
        list.push({
          dirName: item.name,
          skillDir: fullPath
        });
      } else {
        // Recurse down into categories
        const subSkills = discoverSkillDirectories(fullPath, maxDepth, currentDepth + 1);
        list.push(...subSkills);
      }
    }
  } catch (err) {
    console.warn(`Cannot read directory ${baseDir}:`, err.message);
  }
  return list;
}

/**
 * Scans all configured agent targets and returns a unified, cross-environment skills inventory
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
  const targetCounts = {};
  for (const target of config.targets) {
    targetCounts[target.id] = 0;
  }

  for (const target of config.targets) {
    if (!fs.existsSync(target.dir)) continue;

    try {
      const discovered = discoverSkillDirectories(target.dir, target.recursive ? 3 : 0);

      for (const item of discovered) {
        const parsed = parseSkillFile(item.skillDir);
        if (!parsed) continue;

        targetCounts[target.id] = (targetCounts[target.id] || 0) + 1;
        const dirHash = calculateDirHash(item.skillDir);

        // Determine tier
        let tier = target.tier;
        let upstream = null;

        if (target.tier === 'builtin' || item.skillDir.includes('.system') || item.skillDir.includes('plugins')) {
          tier = 'builtin';
        } else {
          const lockKey = parsed.name.toLowerCase();
          const itemKey = item.dirName.toLowerCase();
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

        // Subdirectories
        const subdirs = [];
        for (const sub of ['scripts', 'references', 'examples', 'resources']) {
          if (fs.existsSync(path.join(item.skillDir, sub))) subdirs.push(sub);
        }

        const relPath = path.relative(target.dir, item.skillDir).replace(/\\/g, '/');
        const displayPath = `${target.displayBase}/${relPath}`;

        rawList.push({
          skillName: parsed.name,
          dirName: item.dirName,
          env: target.env,
          agentId: target.agentId,
          agentName: target.agentName,
          targetId: target.id,
          targetName: target.name,
          tier,
          dirHash,
          path: item.skillDir,
          displayPath,
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
        },
        managedBy: []
      });
    }

    const group = aggregatedMap.get(key);
    if (!group.description && item.description) group.description = item.description;
    if (item.tier === 'builtin') group.tier = 'builtin';
    else if (item.tier === 'downloaded' && group.tier !== 'builtin') group.tier = 'downloaded';
    if (!group.upstream && item.upstream) group.upstream = item.upstream;

    const instanceInfo = {
      agentId: item.agentId,
      agentName: item.agentName,
      targetId: item.targetId,
      targetName: item.targetName,
      env: item.env,
      path: item.path,
      displayPath: item.displayPath,
      dirHash: item.dirHash,
      hasValidFrontmatter: item.hasValidFrontmatter
    };

    group.instances[item.env].push(instanceInfo);
    group.managedBy.push(instanceInfo);
  }

  const userOverrides = getOverrides();

  // 4. Compute status flags, agent tags, and paths
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

    const uniqueAgentIds = Array.from(new Set(skill.managedBy.map(m => m.agentId)));
    const uniqueAgentLabels = Array.from(new Set(skill.managedBy.map(m => `${m.agentName} (${m.env === 'windows' ? 'Win' : 'WSL'})`)));

    // Apply manual user overrides if present
    const override = userOverrides[skill.id];
    let finalTier = skill.tier;
    let finalUpstream = skill.upstream;
    let isOverridden = false;
    let customTags = [];
    let customNotes = '';

    if (override) {
      isOverridden = true;
      if (override.tier) finalTier = override.tier;
      if (override.upstream !== undefined) finalUpstream = override.upstream;
      if (Array.isArray(override.tags) && override.tags.length > 0) customTags = override.tags;
      if (override.notes) customNotes = override.notes;
    }

    return {
      ...skill,
      tier: finalTier,
      upstream: finalUpstream,
      isOverridden,
      customTags,
      customNotes,
      syncStatus,
      winHash,
      wslHash,
      hasWin,
      hasWsl,
      agentIds: uniqueAgentIds,
      agentLabels: uniqueAgentLabels
    };
  });

  unifiedList.sort((a, b) => a.name.localeCompare(b.name));

  // Build target stats
  const targetStats = config.targets.map(t => ({
    id: t.id,
    name: t.name,
    agentId: t.agentId,
    agentName: t.agentName,
    env: t.env,
    dir: t.dir,
    displayBase: t.displayBase,
    exists: fs.existsSync(t.dir),
    count: targetCounts[t.id] || 0
  }));

  return {
    skills: unifiedList,
    targets: targetStats
  };
}

module.exports = {
  scanAllSkills,
  parseSkillFile,
  calculateDirHash
};
