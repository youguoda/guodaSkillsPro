const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { getOverrides } = require('./overrides');
const { pathExists } = require('./fs-utils');
const { parseFrontmatter } = require('./skill-md');

/**
 * Parses YAML frontmatter and body from SKILL.md
 */
async function parseSkillFile(skillDir) {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!(await pathExists(skillMdPath))) return null;

  try {
    const rawContent = await fsp.readFile(skillMdPath, 'utf8');
    const { name, description, hasValidFrontmatter, frontmatterRaw, body } =
      parseFrontmatter(rawContent, path.basename(skillDir));

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
 * Calculates a reproducible hash for directory contents.
 * Walks the tree first (collecting relative paths), then reads in parallel
 * but updates the hash in sorted order — deterministic across machines.
 */
async function calculateDirHash(dir) {
  const SKIP = new Set(['node_modules', '__pycache__', 'venv', '.venv']);
  const files = [];

  async function walk(currentDir, relBase) {
    let entries;
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true });
    } catch (e) {
      console.warn(`Hash walk could not read directory ${currentDir}:`, e.message);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (
        entry.name.startsWith('.git') ||
        entry.name === '.sync-manifest.json' ||
        SKIP.has(entry.name)
      ) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        files.push({ fullPath, relPath });
      }
    }
  }

  await walk(dir, '');

  const hash = crypto.createHash('sha256');
  const contents = await Promise.all(files.map(f =>
    fsp.readFile(f.fullPath).then(
      buf => buf,
      () => null
    )
  ));

  // A hash over partially-readable content can produce a false "synced"
  // verdict, so refuse to answer instead of lying
  const unreadable = files.filter((f, i) => contents[i] === null);
  if (unreadable.length > 0) {
    throw new Error(`Unreadable files during hash: ${unreadable.slice(0, 3).map(f => f.relPath).join(', ')}`);
  }

  for (let i = 0; i < files.length; i++) {
    hash.update(files[i].relPath);
    hash.update(contents[i]);
  }

  return hash.digest('hex').slice(0, 10);
}

/**
 * Recursively discover skill directories (supporting category subfolders like Hermes / OpenClaw)
 */
async function discoverSkillDirectories(baseDir, maxDepth = 2, currentDepth = 0) {
  const list = [];
  if (!baseDir || currentDepth > maxDepth || !(await pathExists(baseDir))) return list;

  let items;
  try {
    items = await fsp.readdir(baseDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Cannot read directory ${baseDir}:`, err.message);
    return list;
  }

  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const fullPath = path.join(baseDir, item.name);

    if (await pathExists(path.join(fullPath, 'SKILL.md'))) {
      list.push({
        dirName: item.name,
        skillDir: fullPath
      });
    } else {
      // Recurse down into categories
      const subSkills = await discoverSkillDirectories(fullPath, maxDepth, currentDepth + 1);
      list.push(...subSkills);
    }
  }
  return list;
}

/**
 * Scans the given agent targets (defaults to the registered config.targets)
 * and returns a unified, cross-environment skills inventory.
 * Targets are injectable so tests can point at fixture directories.
 */
async function scanAllSkills(targets = config.targets) {
  // 1. Load lockfile(s)
  const lockfileMap = new Map();
  for (const target of targets) {
    if (target.lockfile && (await pathExists(target.lockfile))) {
      try {
        const data = JSON.parse(await fsp.readFile(target.lockfile, 'utf8'));
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
  for (const target of targets) {
    targetCounts[target.id] = 0;
  }

  for (const target of targets) {
    if (!(await pathExists(target.dir))) continue;

    try {
      const discovered = await discoverSkillDirectories(target.dir, target.recursive ? 3 : 0);

      for (const item of discovered) {
        const parsed = await parseSkillFile(item.skillDir);
        if (!parsed) continue;

        targetCounts[target.id] = (targetCounts[target.id] || 0) + 1;
        let dirHash = null;
        try {
          dirHash = await calculateDirHash(item.skillDir);
        } catch (hashErr) {
          console.warn(`Hash unavailable for ${item.skillDir}: ${hashErr.message}`);
        }

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
        const subdirChecks = await Promise.all(
          ['scripts', 'references', 'examples', 'resources'].map(sub =>
            pathExists(path.join(item.skillDir, sub)).then(ok => (ok ? sub : null))
          )
        );
        const subdirs = subdirChecks.filter(Boolean);

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
      if (winHash === null || wslHash === null) {
        syncStatus = 'unknown';
      } else {
        syncStatus = (winHash === wslHash) ? 'synced' : 'diff';
      }
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
  const targetStats = await Promise.all(targets.map(async t => ({
    id: t.id,
    name: t.name,
    agentId: t.agentId,
    agentName: t.agentName,
    env: t.env,
    dir: t.dir,
    displayBase: t.displayBase,
    exists: await pathExists(t.dir),
    count: targetCounts[t.id] || 0
  })));

  return {
    skills: unifiedList,
    targets: targetStats
  };
}

// ---------------------------------------------------------------------
// Inventory cache & deep accessors
// scanAllSkills() is the raw (always-fresh) scan; getInventory() serves the
// cached inventory and is the only thing id-based lookups should touch.
// Mutating routes MUST call invalidateInventory() after changing skill files.
// ---------------------------------------------------------------------
let inventoryCache = null;

async function getInventory({ force = false } = {}) {
  if (force || !inventoryCache) {
    inventoryCache = await scanAllSkills();
  }
  return inventoryCache;
}

function invalidateInventory() {
  inventoryCache = null;
}

/**
 * Resolve a skill aggregate (and one of its agent instances) by id.
 * targetId scopes to a specific agent directory; null picks the first instance.
 * Returns { skill: null, instance: null } when the id is unknown.
 */
function resolveSkill(inventory, skillId, targetId = null) {
  const id = String(skillId || '').toLowerCase();
  const skill = (inventory.skills || []).find(s => s.id === id);
  if (!skill || !Array.isArray(skill.managedBy) || skill.managedBy.length === 0) {
    return { skill: skill || null, instance: null };
  }
  const instance = targetId
    ? (skill.managedBy.find(m => m.targetId === targetId) || skill.managedBy[0])
    : skill.managedBy[0];
  return { skill, instance };
}

module.exports = {
  scanAllSkills,
  parseSkillFile,
  calculateDirHash,
  getInventory,
  invalidateInventory,
  resolveSkill,
  pathExists
};
