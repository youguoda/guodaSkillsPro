const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

const WIN_USER_HOME = process.env.USERPROFILE || 'C:/Users/14393';

// Ask the default WSL distro for its own name and home directory. Hardcoding
// these silently produces a valid-looking UNC path that matches nothing, so
// every WSL target scans as empty instead of erroring.
function probeWsl() {
  try {
    const out = execSync('wsl -e sh -c "echo $WSL_DISTRO_NAME; echo $HOME"', {
      env: { ...process.env, WSL_UTF8: '1' },
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const [distro, home] = out.split('\n').map(s => s.trim());
    if (distro && home) return { distro, home };
  } catch (e) {
    console.warn(`[config] WSL probe failed (${e.message}). Falling back to defaults.`);
  }
  return null;
}

const probed = probeWsl();
const WSL_DISTRO = process.env.WSL_DISTRO || (probed && probed.distro) || 'Ubuntu';
const WSL_HOME = process.env.WSL_HOME || (probed && probed.home) || `/home/${os.userInfo().username}`;
const WSL_USER = process.env.WSL_USER || path.basename(WSL_HOME);
const WSL_HOME_UNC = `//wsl.localhost/${WSL_DISTRO}${WSL_HOME}`;

if (!fs.existsSync(WSL_HOME_UNC)) {
  console.warn(`[config] WSL home not reachable at ${WSL_HOME_UNC} - WSL skills will not be scanned.`);
}

module.exports = {
  PORT: process.env.PORT || 3721,
  WIN_USER_HOME,
  WSL_DISTRO,
  WSL_USER,
  WSL_HOME,
  WSL_HOME_UNC,
  
  // Pre-configured agent scan targets across Windows and WSL2
  targets: [
    // --- Claude Code ---
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
      id: 'wsl-claude',
      name: 'WSL: Claude Code',
      env: 'wsl',
      agentId: 'claude',
      agentName: 'Claude Code',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.claude/skills'),
      displayBase: 'WSL:~/.claude/skills'
    },

    // --- Cursor ---
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
      id: 'wsl-cursor',
      name: 'WSL: Cursor',
      env: 'wsl',
      agentId: 'cursor',
      agentName: 'Cursor',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.cursor/skills-cursor'),
      displayBase: 'WSL:~/.cursor/skills-cursor'
    },

    // --- Hermes ---
    {
      id: 'win-hermes',
      name: 'Windows: Hermes',
      env: 'windows',
      agentId: 'hermes',
      agentName: 'Hermes Agent',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.hermes/skills'),
      displayBase: '~/.hermes/skills',
      recursive: true
    },
    {
      id: 'wsl-hermes',
      name: 'WSL: Hermes',
      env: 'wsl',
      agentId: 'hermes',
      agentName: 'Hermes Agent',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.hermes/skills'),
      displayBase: 'WSL:~/.hermes/skills',
      recursive: true
    },

    // --- OpenClaw ---
    {
      id: 'win-openclaw',
      name: 'Windows: OpenClaw',
      env: 'windows',
      agentId: 'openclaw',
      agentName: 'OpenClaw',
      tier: 'mixed',
      dir: path.join(WIN_USER_HOME, '.openclaw/skills'),
      displayBase: '~/.openclaw/skills',
      recursive: true
    },
    {
      id: 'wsl-openclaw-workspace',
      name: 'WSL: OpenClaw Workspace',
      env: 'wsl',
      agentId: 'openclaw',
      agentName: 'OpenClaw',
      tier: 'custom',
      dir: path.join(WSL_HOME_UNC, '.openclaw/workspace/skills'),
      displayBase: 'WSL:~/.openclaw/workspace/skills',
      recursive: true
    },
    {
      id: 'wsl-openclaw-plugins',
      name: 'WSL: OpenClaw Plugins',
      env: 'wsl',
      agentId: 'openclaw',
      agentName: 'OpenClaw Plugins',
      tier: 'builtin',
      dir: path.join(WSL_HOME_UNC, '.openclaw/npm/node_modules/@openclaw/feishu/skills'),
      displayBase: 'WSL:~/.openclaw/plugins/feishu/skills',
      recursive: true
    },

    // --- Codex System ---
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

    // --- ZCode ---
    {
      id: 'wsl-zcode',
      name: 'WSL: ZCode',
      env: 'wsl',
      agentId: 'zcode',
      agentName: 'ZCode',
      tier: 'mixed',
      dir: path.join(WSL_HOME_UNC, '.zcode/skills'),
      displayBase: 'WSL:~/.zcode/skills'
    },

    // --- Generic Agents (.agents) ---
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
    }
  ],

  // Default directory for creating new custom skills
  defaultCustomDir: {
    windows: path.join(WIN_USER_HOME, '.claude/skills'),
    wsl: path.join(WSL_HOME_UNC, '.cursor/skills-cursor')
  }
};
