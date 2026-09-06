const fs = require('fs');
const path = require('path');

/**
 * Usage store — "了解与使用" tracking per skill: view/copy/install counts,
 * last-used timestamp and the favorite flag. Persists to server/data/usage.json.
 * Usage is user metadata: it never invalidates the skill inventory.
 */

const DATA_DIR = path.join(__dirname, 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getUsage() {
  if (!fs.existsSync(USAGE_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) || {};
  } catch (err) {
    const quarantine = `${USAGE_FILE}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(USAGE_FILE, quarantine);
      console.error('usage.json was unreadable; quarantined to', quarantine, err.message);
    } catch (e) {
      console.error('usage.json is unreadable AND could not be quarantined:', e.message);
    }
    return {};
  }
}

function writeUsage(usage) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), 'utf8');
}

function recordUsage(skillId, action = 'view') {
  if (!skillId) throw new Error('skillId is required');
  const usage = getUsage();
  const key = String(skillId).toLowerCase();
  const entry = usage[key] || { uses: 0 };
  entry.uses += 1;
  entry.lastAction = action;
  entry.lastUsedAt = new Date().toISOString();
  usage[key] = entry;
  writeUsage(usage);
  return entry;
}

function setFavorite(skillId, favorite) {
  if (!skillId) throw new Error('skillId is required');
  const usage = getUsage();
  const key = String(skillId).toLowerCase();
  const entry = usage[key] || { uses: 0 };
  entry.favorite = !!favorite;
  usage[key] = entry;
  writeUsage(usage);
  return entry;
}

function resetUsage(skillId) {
  const usage = getUsage();
  const key = String(skillId).toLowerCase();
  if (usage[key]) {
    delete usage[key];
    writeUsage(usage);
    return true;
  }
  return false;
}

/** Non-mutating merge: usage metadata onto skill aggregates (cache-safe) */
function mergeUsage(skills) {
  const usage = getUsage();
  return skills.map(s => ({
    ...s,
    usage: usage[s.id] || { uses: 0, favorite: false }
  }));
}

module.exports = {
  getUsage,
  recordUsage,
  setFavorite,
  resetUsage,
  mergeUsage
};
