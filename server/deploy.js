const path = require('path');
const { pathExists } = require('./fs-utils');
const { syncDirectory } = require('./sync');
const { HttpError } = require('./guard');

/**
 * Install (deploy) a skill into an agent target directory.
 * sourcePath — an existing instance path from the inventory
 * target     — a registered config.targets entry (or a fixture in tests)
 * Reuses syncDirectory: atomic backup + hash verification.
 */
async function installSkillToTarget(sourcePath, target) {
  if (!sourcePath || !(await pathExists(sourcePath))) {
    throw new HttpError(404, `Source skill instance not found: ${sourcePath}`);
  }
  if (!target || !target.dir || !target.id) {
    throw new HttpError(400, 'Invalid install target');
  }

  const destDir = path.join(target.dir, path.basename(sourcePath));
  if (await pathExists(destDir)) {
    throw new HttpError(409, `Skill already present in the target directory: ${destDir}`);
  }

  const result = await syncDirectory(sourcePath, destDir);
  return {
    ...result,
    targetId: target.id,
    targetName: target.name || target.id,
    destDir
  };
}

module.exports = { installSkillToTarget };
