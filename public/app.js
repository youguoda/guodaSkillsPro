// SkillsHub Client Application Logic
let allSkills = [];
let appStats = {};
let currentTierFilter = 'all';
let currentSyncFilter = 'all';
let currentActiveSkill = null;
let currentActiveSkillPath = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  loadSystemInfo();
  refreshSkills();
});

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600 text-white border-emerald-500',
    error: 'bg-rose-600 text-white border-rose-500',
    info: 'bg-slate-800 text-slate-100 border-slate-700'
  };

  toast.className = `px-4 py-2.5 rounded-xl border text-xs shadow-xl flex items-center space-x-2 toast-animate ${colors[type] || colors.info}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Fetch system environment info
async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system-info');
    const data = await res.json();
    if (data.winUser) {
      document.getElementById('env-win-user').textContent = `Win: ${data.winUser.split(/[\/\\]/).pop()}`;
    }
    if (data.wslDistro) {
      document.getElementById('env-wsl-distro').textContent = `WSL: ${data.wslDistro}`;
    }
  } catch (e) {
    console.error('Failed to load system info', e);
  }
}

// Refresh skills list from backend
async function refreshSkills() {
  const container = document.getElementById('skills-container');
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('opacity-50', 'pointer-events-none');

  try {
    const res = await fetch('/api/skills');
    const data = await res.json();
    if (data.success) {
      allSkills = data.skills;
      appStats = data.stats;
      updateStatsUI();
      renderSkillsList();
      showToast(`扫描完成，共识别 ${allSkills.length} 个 Agent 技能`, 'success');
    } else {
      showToast(`扫描失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`无法连接后端服务: ${err.message}`, 'error');
  } finally {
    btn.classList.remove('opacity-50', 'pointer-events-none');
  }
}

// Update Top Statistic Cards
function updateStatsUI() {
  document.getElementById('stat-total').textContent = appStats.total || 0;
  document.getElementById('stat-win-only').textContent = appStats.winOnly || 0;
  document.getElementById('stat-wsl-only').textContent = appStats.wslOnly || 0;
  document.getElementById('stat-synced').textContent = appStats.synced || 0;
  document.getElementById('stat-builtin').textContent = appStats.builtin || 0;
  document.getElementById('stat-downloaded').textContent = appStats.downloaded || 0;
}

// Filter setting functions
function setTierFilter(tier) {
  currentTierFilter = tier;
  document.querySelectorAll('.filter-tier-btn').forEach(btn => {
    if (btn.dataset.tier === tier) {
      btn.className = 'filter-tier-btn px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium transition';
    } else {
      btn.className = 'filter-tier-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition';
    }
  });
  renderSkillsList();
}

function setSyncFilter(sync) {
  currentSyncFilter = sync;
  document.querySelectorAll('.filter-sync-btn').forEach(btn => {
    if (btn.dataset.sync === sync) {
      btn.className = 'filter-sync-btn px-2.5 py-1 rounded-lg bg-slate-800 text-white font-medium transition';
    } else {
      btn.className = 'filter-sync-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition';
    }
  });
  renderSkillsList();
}

// Render Skills Cards Grid
function renderSkillsList() {
  const container = document.getElementById('skills-container');
  const search = (document.getElementById('search-input').value || '').toLowerCase().trim();

  // Filter skills
  const filtered = allSkills.filter(skill => {
    // 1. Tier filter
    if (currentTierFilter !== 'all' && skill.tier !== currentTierFilter) return false;
    // 2. Sync status filter
    if (currentSyncFilter !== 'all' && skill.syncStatus !== currentSyncFilter) return false;
    // 3. Search query
    if (search) {
      const matchName = skill.name.toLowerCase().includes(search);
      const matchDesc = (skill.description || '').toLowerCase().includes(search);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 bg-slate-900/30 border border-slate-800/60 rounded-2xl">
        <p class="text-sm">没有匹配到符合条件的技能</p>
        <button onclick="setTierFilter('all'); setSyncFilter('all');" class="mt-2 text-xs text-indigo-400 hover:underline">重置所有筛选</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(skill => {
    // Badge styles for Tier
    const tierBadges = {
      builtin: '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">官方内置</span>',
      downloaded: '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">社区下载</span>',
      custom: '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">自己编写</span>'
    };

    // Badge styles for Sync Status
    const syncBadges = {
      synced: '<span class="flex items-center space-x-1 text-[10px] text-emerald-400 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span>双端一致</span></span>',
      diff: '<span class="flex items-center space-x-1 text-[10px] text-amber-400 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>内容差异</span></span>',
      windows_only: '<span class="flex items-center space-x-1 text-[10px] text-blue-400 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span><span>仅 Win</span></span>',
      wsl_only: '<span class="flex items-center space-x-1 text-[10px] text-orange-400 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-orange-500"></span><span>仅 WSL</span></span>'
    };

    // First available path for inspection
    const primaryPath = (skill.instances.windows[0] || skill.instances.wsl[0] || {}).path || '';

    // Action buttons based on status
    let actionButtons = '';

    // Sync button
    if (skill.syncStatus === 'windows_only') {
      actionButtons += `<button onclick="syncSingleSkill('${skill.id}', 'to_wsl')" class="px-2.5 py-1 text-[11px] bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg transition">➔ 同步到 WSL</button>`;
    } else if (skill.syncStatus === 'wsl_only') {
      actionButtons += `<button onclick="syncSingleSkill('${skill.id}', 'to_windows')" class="px-2.5 py-1 text-[11px] bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-lg transition">➔ 同步到 Win</button>`;
    } else if (skill.syncStatus === 'diff') {
      actionButtons += `<button onclick="openDiffModal('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg transition font-medium">⚡ 查看 Diff</button>`;
    }

    // Tier-specific buttons
    if (skill.tier === 'builtin') {
      actionButtons += `<button onclick="forkBuiltinSkill('${primaryPath}', '${skill.name}')" class="px-2.5 py-1 text-[11px] bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg transition">🔱 Fork 派生</button>`;
    } else if (skill.tier === 'downloaded' && skill.upstream) {
      actionButtons += `<button onclick="checkSkillUpdate('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition">🔄 检查更新</button>`;
    }

    // Always allow viewing/editing
    actionButtons += `<button onclick="openEditorModal('${primaryPath}')" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition">查看 / 编辑</button>`;

    return `
      <div class="skill-card bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
        <!-- Card Top -->
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center space-x-2 truncate">
              <span class="text-base">${skill.tier === 'builtin' ? '🔒' : skill.tier === 'downloaded' ? '📦' : '✏️'}</span>
              <h3 class="font-bold text-sm text-white font-mono truncate" title="${skill.name}">${skill.name}</h3>
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
              ${tierBadges[skill.tier] || ''}
            </div>
          </div>

          <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed" title="${skill.description || '无描述'}">
            ${skill.description || '<span class="italic text-slate-600">未提供描述</span>'}
          </p>
        </div>

        <!-- Location & Env Info -->
        <div class="pt-2 border-t border-slate-800/80 text-[11px] space-y-1 font-mono text-slate-400">
          <div class="flex items-center justify-between">
            <span class="text-slate-500">跨端状态:</span>
            ${syncBadges[skill.syncStatus] || ''}
          </div>
          ${skill.upstream ? `
          <div class="flex items-center justify-between truncate text-slate-500" title="${skill.upstream.sourceUrl}">
            <span>上游源:</span>
            <span class="text-indigo-400 truncate max-w-[160px]">${skill.upstream.source}</span>
          </div>` : ''}
        </div>

        <!-- Card Actions -->
        <div class="pt-2 flex flex-wrap items-center gap-1.5 justify-end">
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------
// Actions: Sync, Fork, Update
// ---------------------------------------------------------------------

// Sync single skill
async function syncSingleSkill(skillId, direction) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  showToast(`正在同步 ${skill.name} (${direction})...`, 'info');
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill, direction })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`${skill.name} 同步成功！两端哈希一致 (${data.result.dstHash})`, 'success');
      refreshSkills();
    } else {
      showToast(`同步失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`同步出错: ${err.message}`, 'error');
  }
}

// Fork Builtin Skill
async function forkBuiltinSkill(sourcePath, currentName) {
  const newName = prompt(`为 Fork 的自定义技能输入新名称:`, `my-${currentName}`);
  if (!newName) return;

  showToast(`正在派生 ${currentName} 为自定义技能...`, 'info');
  try {
    const res = await fetch('/api/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, newName, targetEnv: 'windows' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Fork 成功！已创建自定义技能: ${data.result.name}`, 'success');
      refreshSkills();
    } else {
      showToast(`Fork 失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Fork 请求失败: ${err.message}`, 'error');
  }
}

// Check upstream update for downloaded skill
async function checkSkillUpdate(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill || !skill.upstream) return;

  showToast(`正在嗅探 ${skill.name} 的远程 Git 仓库...`, 'info');
  try {
    const res = await fetch('/api/check-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upstream: skill.upstream })
    });
    const data = await res.json();
    if (data.success) {
      if (data.hasUpdate) {
        alert(`发现上游新版本！\n\n上游最新 Commit: ${data.remoteCommit}\n本地锁定 Commit: ${data.localCommit}\n\n建议在更新前备份或通过 Diff 对比变更。`);
      } else {
        showToast(`${skill.name} 已经是最新版本 (Commit: ${data.localCommit})`, 'success');
      }
    } else {
      showToast(`检查失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`检查出错: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------
// Diff Modal
// ---------------------------------------------------------------------
async function openDiffModal(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  document.getElementById('diff-modal-title').textContent = `差异对比: ${skill.name}`;
  const output = document.getElementById('diff-output');
  output.innerHTML = '<p class="text-slate-500 py-4 text-center">正在计算 Windows 与 WSL 的行级差异...</p>';
  document.getElementById('modal-diff').classList.remove('hidden');

  // Bind direction buttons
  document.getElementById('btn-diff-sync-to-wsl').onclick = async () => {
    await syncSingleSkill(skillId, 'to_wsl');
    closeDiffModal();
  };
  document.getElementById('btn-diff-sync-to-win').onclick = async () => {
    await syncSingleSkill(skillId, 'to_windows');
    closeDiffModal();
  };

  try {
    const res = await fetch('/api/diff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill })
    });
    const data = await res.json();
    if (data.success) {
      const diff = data.diff;
      if (diff.isEqual) {
        output.innerHTML = '<p class="text-emerald-400 py-6 text-center font-bold">✓ 两侧 SKILL.md 文本内容完全相同（差异可能来自附属脚本/文件夹）</p>';
      } else {
        renderSimpleDiff(diff.linesA, diff.linesB, output);
      }
    }
  } catch (err) {
    output.innerHTML = `<p class="text-rose-400">Diff 失败: ${err.message}</p>`;
  }
}

function renderSimpleDiff(linesWin, linesWsl, container) {
  let html = '';
  const maxLines = Math.max(linesWin.length, linesWsl.length);
  for (let i = 0; i < maxLines; i++) {
    const lineWin = linesWin[i] !== undefined ? linesWin[i] : null;
    const lineWsl = linesWsl[i] !== undefined ? linesWsl[i] : null;

    if (lineWin === lineWsl) {
      html += `<div class="flex py-0.5 text-slate-400 hover:bg-slate-900"><span class="diff-line-number">${i + 1}</span><span class="pl-2 flex-1">${escapeHtml(lineWin)}</span></div>`;
    } else {
      if (lineWin !== null) {
        html += `<div class="flex py-0.5 diff-removed"><span class="diff-line-number">${i + 1}</span><span class="pl-1 text-rose-400 font-bold">- Win</span><span class="pl-2 flex-1">${escapeHtml(lineWin)}</span></div>`;
      }
      if (lineWsl !== null) {
        html += `<div class="flex py-0.5 diff-added"><span class="diff-line-number">${i + 1}</span><span class="pl-1 text-emerald-400 font-bold">+ WSL</span><span class="pl-2 flex-1">${escapeHtml(lineWsl)}</span></div>`;
      }
    }
  }
  container.innerHTML = html;
}

function closeDiffModal() {
  document.getElementById('modal-diff').classList.add('hidden');
}

// ---------------------------------------------------------------------
// Editor & Markdown Viewer Modal
// ---------------------------------------------------------------------
async function openEditorModal(skillPath) {
  currentActiveSkillPath = skillPath;
  const modal = document.getElementById('modal-editor');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/skill-detail?path=${encodeURIComponent(skillPath)}`);
    const data = await res.json();
    if (data.success) {
      currentActiveSkill = data;
      document.getElementById('modal-skill-name').textContent = data.parsed.name;
      document.getElementById('modal-skill-path').textContent = data.path;
      document.getElementById('editor-textarea').value = data.parsed.rawContent;

      updateLinterBanner(data.lint);
      renderFilesList(data.files);
      switchEditorTab('edit');
    }
  } catch (err) {
    showToast(`无法加载技能详情: ${err.message}`, 'error');
  }
}

function updateLinterBanner(lint) {
  const banner = document.getElementById('linter-banner');
  const msg = document.getElementById('linter-msg');

  if (!lint.valid) {
    banner.className = 'rounded-xl p-3 text-xs flex items-start space-x-2 bg-rose-500/10 border border-rose-500/20 text-rose-400';
    banner.innerHTML = `<span class="font-bold">✕ 规范校验未通过:</span> <span>${lint.errors.join('; ')}</span>`;
  } else if (lint.warnings.length > 0) {
    banner.className = 'rounded-xl p-3 text-xs flex items-start space-x-2 bg-amber-500/10 border border-amber-500/20 text-amber-400';
    banner.innerHTML = `<span class="font-bold">⚠️ 建议优化:</span> <span>${lint.warnings.join('; ')}</span>`;
  } else {
    banner.className = 'rounded-xl p-3 text-xs flex items-start space-x-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400';
    banner.innerHTML = `<span class="font-bold">✓ 规范校验通过:</span> <span>符合 agentskills.io 规范标准</span>`;
  }
}

function renderFilesList(files) {
  const list = document.getElementById('files-list');
  if (!files || files.length === 0) {
    list.innerHTML = '<li class="text-slate-500 italic">暂无附属脚本或参考文件</li>';
    return;
  }
  list.innerHTML = files.map(f => `
    <li class="flex items-center justify-between py-1 border-b border-slate-900 last:border-0">
      <span>${f.name.endsWith('.sh') || f.name.endsWith('.py') ? '⚙️' : '📄'} ${f.path}</span>
      <span class="text-slate-500 text-[10px]">${(f.size / 1024).toFixed(1)} KB</span>
    </li>
  `).join('');
}

function switchEditorTab(tab) {
  const btnEdit = document.getElementById('tab-btn-edit');
  const btnPrev = document.getElementById('tab-btn-preview');
  const btnFiles = document.getElementById('tab-btn-files');
  const viewEdit = document.getElementById('view-edit');
  const viewPrev = document.getElementById('view-preview');
  const viewFiles = document.getElementById('view-files');

  [btnEdit, btnPrev, btnFiles].forEach(b => b.className = 'pb-2 text-slate-400 hover:text-slate-200');
  [viewEdit, viewPrev, viewFiles].forEach(v => v.classList.add('hidden'));

  if (tab === 'edit') {
    btnEdit.className = 'pb-2 text-indigo-400 border-b-2 border-indigo-500';
    viewEdit.classList.remove('hidden');
  } else if (tab === 'preview') {
    btnPrev.className = 'pb-2 text-indigo-400 border-b-2 border-indigo-500';
    viewPrev.classList.remove('hidden');
    const content = document.getElementById('editor-textarea').value;
    viewPrev.innerHTML = marked.parse(content);
  } else if (tab === 'files') {
    btnFiles.className = 'pb-2 text-indigo-400 border-b-2 border-indigo-500';
    viewFiles.classList.remove('hidden');
  }
}

async function saveSkillContent() {
  const content = document.getElementById('editor-textarea').value;
  const btn = document.getElementById('btn-save-skill');
  btn.textContent = '保存中...';

  try {
    const res = await fetch('/api/save-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillPath: currentActiveSkillPath, content })
    });
    const data = await res.json();
    if (data.success) {
      showToast('保存成功并已重算校验！', 'success');
      updateLinterBanner(data.lint);
      refreshSkills();
    } else {
      showToast(`保存失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`保存异常: ${err.message}`, 'error');
  } finally {
    btn.textContent = '保存并更新';
  }
}

function triggerOpenEditor() {
  if (!currentActiveSkillPath) return;
  fetch('/api/open-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentActiveSkillPath, editor: 'cursor' })
  });
  showToast('已唤起本地 Cursor / 文件管理器打开该技能目录', 'info');
}

function closeEditorModal() {
  document.getElementById('modal-editor').classList.add('hidden');
}

// ---------------------------------------------------------------------
// New Skill Wizard
// ---------------------------------------------------------------------
function openNewSkillModal() {
  document.getElementById('new-skill-name').value = '';
  document.getElementById('new-skill-desc').value = '';
  document.getElementById('modal-new-skill').classList.remove('hidden');
}

function closeNewSkillModal() {
  document.getElementById('modal-new-skill').classList.add('hidden');
}

async function createCustomSkill() {
  const name = document.getElementById('new-skill-name').value.trim();
  const description = document.getElementById('new-skill-desc').value.trim();
  const targetEnv = document.getElementById('new-skill-env').value;

  if (!name) {
    alert('请输入技能标识名称');
    return;
  }

  try {
    const res = await fetch('/api/scaffold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, targetEnv })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`技能 ${name} 标准骨架创建成功！`, 'success');
      closeNewSkillModal();
      await refreshSkills();
      openEditorModal(data.result.path);
    } else {
      showToast(`创建失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`创建出错: ${err.message}`, 'error');
  }
}

// Utility
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
