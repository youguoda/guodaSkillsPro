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
  
  // Pre-configured agent scan targets with friendly names and short display paths
  targets: [
    {
      id: 'win-claude',
      name: 'Windows: Claude Code',
      env: 'windows',
      agentId: 'claude',
      agentName: 'Claude Code',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.claude/skills'),
      displayBase: '~/.claude/skills'
    },
    {
      id: 'win-cursor',
      name: 'Windows: Cursor',
      env: 'windows',
      agentId: 'cursor',
      agentName: 'Cursor',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.cursor/skills-cursor'),
      displayBase: '~/.cursor/skills-cursor'
    },
    {
      id: 'win-agents',
      name: 'Windows: Generic Agents',
      env: 'windows',
      agentId: 'agents',
      agentName: 'Generic Agents (.agents)',
      tier: 'downloaded',
      dir: path.join(WIN_USER_HOME, '.agents/skills'),
      lockfile: path.join(WIN_USER_HOME, '.agents/.skill-lock.json'),
      displayBase: '~/.agents/skills'
    },
    {
      id: 'wsl-cursor',
      name: 'WSL: Cursor',
      env: 'wsl',
      agentId: 'cursor',
      agentName: 'Cursor',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.cursor/skills-cursor'),
      displayBase: 'WSL:~/.cursor/skills-cursor'
    },
    {
      id: 'wsl-codex-system',
      name: 'WSL: Codex System',
      env: 'wsl',
      agentId: 'codex',
      agentName: 'Codex System',
      tier: 'builtin',
      dir: path.join(WSL_HOME_UNC, '.codex/skills/.system'),
      displayBase: 'WSL:~/.codex/skills/.system'
    },
    {
      id: 'wsl-claude',
      name: 'WSL: Claude Code',
      env: 'wsl',
      agentId: 'claude',
      agentName: 'Claude Code',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.claude/skills'),
      displayBase: 'WSL:~/.claude/skills'
    }
  ],

  // Default directory for creating new custom skills
  defaultCustomDir: {
    windows: path.join(WIN_USER_HOME, '.claude/skills'),
    wsl: path.join(WSL_HOME_UNC, '.cursor/skills-cursor')
  }
};
