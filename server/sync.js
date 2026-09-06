const fs = require('fs');
const path = require('path');
const config = require('./config');
const { calculateDirHash } = require('./scanner');

/**
 * Safely copies a directory with atomic backup and hash verification
 */
function syncDirectory(sourceDir, destDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  // If destination exists, create a backup just in case
  let backupDir = null;
  if (fs.existsSync(destDir)) {
    const timestamp = Date.now();
    backupDir = `${destDir}.bak.${timestamp}`;
    try {
      fs.cpSync(destDir, backupDir, { recursive: true });
    } catch (err) {
      console.warn('Backup creation failed:', err.message);
    }
  }

  try {
    // Ensure parent directory of destination exists
    const destParent = path.dirname(destDir);
    if (!fs.existsSync(destParent)) {
      fs.mkdirSync(destParent, { recursive: true });
    }

    // Perform recursive copy
    fs.cpSync(sourceDir, destDir, { recursive: true });

    // Verify hash integrity
    const srcHash = calculateDirHash(sourceDir);
    const dstHash = calculateDirHash(destDir);

    if (srcHash !== dstHash) {
      throw new Error(`Hash mismatch after sync! Source: ${srcHash}, Dest: ${dstHash}`);
    }

    // If sync succeeded and backup was created, clean up old backup
    if (backupDir && fs.existsSync(backupDir)) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
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
    if (backupDir && fs.existsSync(backupDir)) {
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
        fs.renameSync(backupDir, destDir);
      } catch (e) {}
    }
    throw err;
  }
}

/**
 * High-level sync a skill between Windows and WSL
 * @param {Object} skill - the aggregated skill object from scanner
 * @param {string} direction - 'to_wsl' | 'to_windows'
 */
function syncSkill(skill, direction) {
  if (direction === 'to_wsl') {
    if (!skill.instances.windows || skill.instances.windows.length === 0) {
      throw new Error(`Skill "${skill.name}" has no Windows instance to sync from.`);
    }
    const sourcePath = skill.instances.windows[0].path;
    // Determine target directory in WSL
    let targetDir;
    if (skill.instances.wsl && skill.instances.wsl.length > 0) {
      targetDir = skill.instances.wsl[0].path;
    } else {
      // Default to WSL cursor skills directory
      targetDir = path.join(config.defaultCustomDir.wsl, path.basename(sourcePath));
    }
    return syncDirectory(sourcePath, targetDir);
  } else if (direction === 'to_windows') {
    if (!skill.instances.wsl || skill.instances.wsl.length === 0) {
      throw new Error(`Skill "${skill.name}" has no WSL instance to sync from.`);
    }
    const sourcePath = skill.instances.wsl[0].path;
    let targetDir;
    if (skill.instances.windows && skill.instances.windows.length > 0) {
      targetDir = skill.instances.windows[0].path;
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
  syncSkill
};
