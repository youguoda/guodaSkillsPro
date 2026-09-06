const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const OVERRIDES_FILE = path.join(DATA_DIR, 'user_overrides.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getOverrides() {
  if (!fs.existsSync(OVERRIDES_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(OVERRIDES_FILE, 'utf8');
    return JSON.parse(raw) || {};
  } catch (err) {
    console.warn('Could not parse user_overrides.json:', err.message);
    return {};
  }
}

// Normalize user-supplied tags: accept an array or a comma/、-separated string
function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return Array.from(new Set(tags.map(t => String(t).trim()).filter(Boolean)));
  }
  if (typeof tags === 'string') {
    return Array.from(new Set(tags.split(/[,，、]+/).map(t => t.trim()).filter(Boolean)));
  }
  return [];
}

function setOverride(skillId, { tier, upstreamUrl, tags, notes }) {
  if (!skillId) throw new Error('skillId is required');
  const overrides = getOverrides();
  const key = skillId.toLowerCase();

  let upstream = null;
  if (tier === 'downloaded' && upstreamUrl) {
    upstream = {
      source: upstreamUrl.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, ''),
      sourceType: 'github',
      sourceUrl: upstreamUrl,
      updatedAt: new Date().toISOString()
    };
  }

  overrides[key] = {
    skillId: key,
    tier: tier || 'custom',
    upstream,
    tags: normalizeTags(tags),
    notes: notes || '',
    updatedAt: new Date().toISOString()
  };

  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8');
  return overrides[key];
}

function deleteOverride(skillId) {
  if (!skillId) return false;
  const overrides = getOverrides();
  const key = skillId.toLowerCase();
  if (overrides[key]) {
    delete overrides[key];
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8');
    return true;
  }
  return false;
}

module.exports = {
  getOverrides,
  setOverride,
  deleteOverride
};
