const fsp = require('fs').promises;

/**
 * Non-blocking existence check (UNC-safe; fs.existsSync stalls the event loop on 9P shares)
 * Lives in its own dependency-free module so guard/scanner/sync/api can share it
 * without circular requires.
 */
async function pathExists(p) {
  if (!p) return false;
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = { pathExists };
