/**
 * vocab — the single source of the client-facing vocabulary:
 * tier labels, sync-status labels and the custom-skill env choices.
 * The scanner PRODUCES tier/syncStatus ids; this module names them.
 * The frontend renders from here — no label duplication in app.js/index.html.
 */

const { VALID_TIERS } = require('./guard');

const TIERS = [
  { id: 'builtin', label: '官方内置', icon: '🔒', hint: '只读保护 / 可派生' },
  { id: 'downloaded', label: '网上下载', icon: '📦', hint: '绑定 Git 上游' },
  { id: 'custom', label: '自己编写', icon: '✏️', hint: '自由编辑 / Linter' }
];

const SYNC_STATUSES = [
  { id: 'synced', label: '双端一致' },
  { id: 'diff', label: '内容差异' },
  { id: 'windows_only', label: '仅 Win' },
  { id: 'wsl_only', label: '仅 WSL' },
  { id: 'unknown', label: '无法校验' }
];

// Vocab ids must cover exactly what the guard whitelist accepts
if (TIERS.length !== VALID_TIERS.size || !TIERS.every(t => VALID_TIERS.has(t.id))) {
  throw new Error('vocab TIERS and guard VALID_TIERS are out of sync');
}

function tierLabel(id) {
  const t = TIERS.find(t => t.id === id);
  return t ? t.label : id;
}

function tierIcon(id) {
  const t = TIERS.find(t => t.id === id);
  return t ? t.icon : '📄';
}

module.exports = {
  TIERS,
  SYNC_STATUSES,
  tierLabel,
  tierIcon
};
