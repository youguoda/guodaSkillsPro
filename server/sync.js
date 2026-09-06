const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const { calculateDirHash } = require('./scanner');
const { pathExists } = require('./fs-utils');

/**
 * Safely copies a directory with atomic backup and hash verification
 */
async function syncDirectory(sourceDir, destDir) {
  if (!(await pathExists(sourceDir))) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  // If destination exists, create a backup just in case
  let backupDir = null;
  if (await pathExists(destDir)) {
    const timestamp = Date.now();
    backupDir = `${destDir}.bak.${timestamp}`;
    try {
      await fsp.cp(destDir, backupDir, { recursive: true });
    } catch (err) {
      console.warn('Backup creation failed:', err.message);
      backupDir = null;
    }
  }

  try {
    // Ensure parent directory of destination exists
    const destParent = path.dirname(destDir);
    if (!(await pathExists(destParent))) {
      await fsp.mkdir(destParent, { recursive: true });
    }

    // Perform recursive copy
    await fsp.cp(sourceDir, destDir, { recursive: true });

    // Verify hash integrity
    const srcHash = await calculateDirHash(sourceDir);
    const dstHash = await calculateDirHash(destDir);

    if (srcHash !== dstHash) {
      throw new Error(`Hash mismatch after sync! Source: ${srcHash}, Dest: ${dstHash}`);
    }

    // If sync succeeded and backup was created, clean up old backup
    if (backupDir && (await pathExists(backupDir))) {
      try {
        await fsp.rm(backupDir, { recursive: true, force: true });
      } catch (e) {}
    }

    return {
      success: true,
      srcHash,
      dstHash,
      syncedAt: new Date().toISOString()
    };
  } catch (err) {
    // Rollback from backup if failed
    if (backupDir && (await pathExists(backupDir))) {
      try {
        await fsp.rm(destDir, { recursive: true, force: true });
        await fsp.rename(backupDir, destDir);
      } catch (rollbackErr) {
        console.error('Rollback failed; backup preserved at', backupDir, rollbackErr.message);
        err.rollbackFailed = true;
        err.backupDir = backupDir;
      }
    }
    throw err;
  }
}

/**
 * High-level sync a skill between Windows and WSL.
 * The "first instance per env" semantics live HERE, not in callers.
 * @param {Object} instances - { windows: [...], wsl: [...] } from the scanner aggregate
 * @param {string} name - skill display name (for errors)
 * @param {string} direction - 'to_wsl' | 'to_windows'
 */
async function syncSkillByEnv(instances, name, direction) {
  const list = instances || {};

  if (direction === 'to_wsl') {
    if (!list.windows || list.windows.length === 0) {
      throw new Error(`Skill "${name}" has no Windows instance to sync from.`);
    }
    const sourcePath = list.windows[0].path;
    // Determine target directory in WSL
    let targetDir;
    if (list.wsl && list.wsl.length > 0) {
      targetDir = list.wsl[0].path;
    } else {
      // Default to WSL cursor skills directory
      targetDir = path.join(config.defaultCustomDir.wsl, path.basename(sourcePath));
    }
    return syncDirectory(sourcePath, targetDir);
  } else if (direction === 'to_windows') {
    if (!list.wsl || list.wsl.length === 0) {
      throw new Error(`Skill "${name}" has no WSL instance to sync from.`);
    }
    const sourcePath = list.wsl[0].path;
    let targetDir;
    if (list.windows && list.windows.length > 0) {
      targetDir = list.windows[0].path;
    } else {
      targetDir = path.join(config.defaultCustomDir.windows, path.basename(sourcePath));
    }
    return syncDirectory(sourcePath, targetDir);
  } else {
    throw new Error(`Invalid sync direction: ${direction}`);
  }
}

module.exports = {
  syncDirectory,
  syncSkillByEnv
};
