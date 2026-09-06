const path = require('path');
const os = require('os');
const fs = require('fs');

const WIN_USER_HOME = process.env.USERPROFILE || 'C:/Users/14393';
const WSL_DISTRO = process.env.WSL_DISTRO || 'Ubuntu-22.04';
const WSL_USER = process.env.WSL_USER || 'guoda';
const WSL_HOME_UNC = `//wsl.localhost/${WSL_DISTRO}/home/${WSL_USER}`;

module.exports = {
  PORT: process.env.PORT || 3721,
  WIN_USER_HOME,
  WSL_DISTRO,
  WSL_USER,
  WSL_HOME_UNC,
  
  // Pre-configured agent scan targets
  targets: [
    {
      id: 'win-agents',
      name: 'Windows Generic Agents (~/.agents/skills)',
      env: 'windows',
      agent: 'agents',
      tier: 'downloaded',
      dir: path.join(WIN_USER_HOME, '.agents/skills'),
      lockfile: path.join(WIN_USER_HOME, '.agents/.skill-lock.json')
    },
    {
      id: 'win-claude',
      name: 'Windows Claude Code (~/.claude/skills)',
      env: 'windows',
      agent: 'claude',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.claude/skills')
    },
    {
      id: 'win-cursor',
      name: 'Windows Cursor (~/.cursor/skills-cursor)',
      env: 'windows',
      agent: 'cursor',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.cursor/skills-cursor')
    },
    {
      id: 'wsl-cursor',
      name: 'WSL Cursor (~/.cursor/skills-cursor)',
      env: 'wsl',
      agent: 'cursor',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.cursor/skills-cursor')
    },
    {
      id: 'wsl-codex-system',
      name: 'WSL Codex System (~/.codex/skills/.system)',
      env: 'wsl',
      agent: 'codex',
      tier: 'builtin',
      dir: path.join(WSL_HOME_UNC, '.codex/skills/.system')
    },
    {
      id: 'wsl-claude',
      name: 'WSL Claude Code (~/.claude/skills)',
      env: 'wsl',
      agent: 'claude',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.claude/skills')
    }
  ],

  // Default directory for creating new custom skills
  defaultCustomDir: {
    windows: path.join(WIN_USER_HOME, '.claude/skills'),
    wsl: path.join(WSL_HOME_UNC, '.cursor/skills-cursor')
  }
};
