const path = require('path');
const config = require('./config');
const { pathExists } = require('./fs-utils');

/**
 * Trust-boundary guard: every host path that crosses the HTTP seam must live
 * inside a registered skill target directory (or the default custom dirs).
 */

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_TIERS = new Set(['builtin', 'downloaded', 'custom']);

function allowedRoots() {
  return [
    ...config.targets.map(t => t.dir),
    config.defaultCustomDir.windows,
    config.defaultCustomDir.wsl
  ].filter(Boolean);
}

function isInside(root, resolvedTarget) {
  // Windows filesystems are case-insensitive; normalize before comparing
  const rel = path.relative(String(root).toLowerCase(), resolvedTarget.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Assert a host path is inside a registered skill directory and exists.
 * Throws HttpError(403) when outside, HttpError(404) when missing.
 * Returns the resolved absolute path.
 */
async function assertContainedSkillPath(p, label = 'path') {
  if (!p || typeof p !== 'string') {
    throw new HttpError(400, `${label} is required`);
  }

  const resolved = path.resolve(p);
  const contained = allowedRoots().some(root => isInside(root, resolved));
  if (!contained) {
    throw new HttpError(403, `${label} is outside the registered skill directories`);
  }
  if (!(await pathExists(resolved))) {
    throw new HttpError(404, `${label} does not exist: ${p}`);
  }
  return resolved;
}

module.exports = {
  HttpError,
  VALID_TIERS,
  assertContainedSkillPath,
  allowedRoots
};
