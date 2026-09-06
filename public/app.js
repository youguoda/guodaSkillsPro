// SkillsHub Client Application Logic
let allSkills = [];
let appStats = {};
let appTargets = [];
let appMeta = { tiers: [], syncStatuses: [], customSkillEnvs: [] };
let currentTierFilter = 'all';
let currentSyncFilter = 'all';
let currentAgentFilter = 'all';
let currentViewMode = 'cards';
try { currentViewMode = localStorage.getItem('skillshub-view') === 'compact' ? 'compact' : 'cards'; } catch (e) {}

function setViewMode(mode) {
  currentViewMode = mode === 'compact' ? 'compact' : 'cards';
  try { localStorage.setItem('skillshub-view', currentViewMode); } catch (e) {}
  renderSkillsList();
}

function updateViewToggleStyles() {
  const cardsBtn = document.getElementById('view-cards-btn');
  const compactBtn = document.getElementById('view-compact-btn');
  if (!cardsBtn || !compactBtn) return;
  const active = 'px-2.5 py-1 rounded-lg transition font-medium bg-indigo-600 text-white';
  const idle = 'px-2.5 py-1 rounded-lg transition font-medium text-slate-400 hover:text-white';
  cardsBtn.className = currentViewMode === 'cards' ? active : idle;
  compactBtn.className = currentViewMode === 'compact' ? active : idle;
}

let currentActiveSkill = null;
let currentActiveSkillId = null;
let currentActiveInstance = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  loadSystemInfo();
  refreshSkills();
});

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
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
  if (btn) btn.classList.add('opacity-50', 'pointer-events-none');

  try {
    const res = await fetch('/api/skills?force=1');
    const data = await res.json();
    if (data.success) {
      allSkills = data.skills;
      appStats = data.stats;
      appTargets = data.targets || [];
      appMeta = data.meta || appMeta;
      updateStatsUI();
      renderTargetsOverview();
      renderFilterButtons();
      renderSkillsList();
      showToast(`扫描完成，共识别 ${allSkills.length} 个 Agent 技能`, 'success');
    } else {
      showToast(`扫描失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`无法连接后端服务: ${err.message}`, 'error');
  } finally {
    if (btn) btn.classList.remove('opacity-50', 'pointer-events-none');
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

// Render Agent Target Folders Overview Bar
function renderTargetsOverview() {
  const container = document.getElementById('agent-targets-bar');
  if (!container) return;

  const countLabel = document.getElementById('agent-targets-count');
  if (countLabel && appTargets) {
    const existing = appTargets.filter(t => t.exists).length;
    countLabel.textContent = `当前共发现 ${appTargets.length} 个 Agent 专属技能目录 (${existing} 个存在)`;
  }

  if (!appTargets || appTargets.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-500">未发现 Agent 专属目录</div>';
    return;
  }

  container.innerHTML = appTargets.map(t => {
    const isSelected = currentAgentFilter === t.agentId;
    const envBadge = t.env === 'windows' 
      ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300">Win</span>'
      : '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">WSL</span>';

    return `
      <div onclick="setAgentFilter('${t.agentId}')" class="cursor-pointer p-2.5 rounded-xl border transition flex flex-col justify-between ${isSelected ? 'bg-indigo-950/60 border-indigo-500/80 shadow-md' : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'}">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-1.5">
            ${envBadge}
            <span class="font-semibold text-xs text-slate-200 truncate">${t.agentName}</span>
          </div>
          <span class="text-xs font-bold ${t.count > 0 ? 'text-indigo-400' : 'text-slate-600'}">${t.count}</span>
        </div>
        <div class="text-[10px] text-slate-500 font-mono truncate mt-1.5" title="${escapeHtml(t.dir)}">
          ${escapeHtml(t.displayBase)}
        </div>
      </div>
    `;
  }).join('');
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

function setAgentFilter(agentId) {
  currentAgentFilter = agentId;
  const select = document.getElementById('agent-filter-select');
  if (select) select.value = agentId;
  renderTargetsOverview();
  renderSkillsList();
}

// Vocabulary comes from the server's meta contract — no label duplication here
function tierLabelOf(id) {
  const t = (appMeta.tiers || []).find(t => t.id === id);
  return t ? t.label : id;
}

function tierIconOf(id) {
  const t = (appMeta.tiers || []).find(t => t.id === id);
  return t ? t.icon : '📄';
}

// Render Tier / Sync / Agent filter controls from the meta contract
function renderFilterButtons() {
  const tierBox = document.getElementById('tier-filters');
  if (tierBox && appMeta.tiers) {
    tierBox.innerHTML =
      `<button onclick="setTierFilter('all')" data-tier="all" class="filter-tier-btn px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-medium transition">全部</button>` +
      appMeta.tiers.map(t =>
        `<button onclick="setTierFilter('${t.id}')" data-tier="${t.id}" class="filter-tier-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition" title="${escapeHtml(t.hint || '')}">${t.icon} ${escapeHtml(t.label)}</button>`
      ).join('');
  }

  const syncBox = document.getElementById('sync-filters');
  if (syncBox && appMeta.syncStatuses) {
    syncBox.innerHTML =
      `<button onclick="setSyncFilter('all')" data-sync="all" class="filter-sync-btn px-2.5 py-1 rounded-lg bg-slate-800 text-white font-medium transition">所有状态</button>` +
      appMeta.syncStatuses.map(s =>
        `<button onclick="setSyncFilter('${s.id}')" data-sync="${s.id}" class="filter-sync-btn px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition">${escapeHtml(s.label)}</button>`
      ).join('');
  }

  const agentSelect = document.getElementById('agent-filter-select');
  if (agentSelect && Array.isArray(appTargets)) {
    const groups = [];
    appTargets.forEach(t => {
      let g = groups.find(x => x.agentId === t.agentId);
      if (!g) {
        g = { agentId: t.agentId, agentName: t.agentName, envs: [] };
        groups.push(g);
      }
      if (!g.envs.includes(t.env)) g.envs.push(t.env);
    });
    agentSelect.innerHTML = '<option value="all">全部 Agent 技能</option>' + groups.map(g =>
      `<option value="${escapeHtml(g.agentId)}">${escapeHtml(g.agentName)} (${g.envs.map(e => (e === 'windows' ? 'Win' : 'WSL')).join(' + ')})</option>`
    ).join('');
    agentSelect.value = currentAgentFilter;
  }

  // Re-apply current filter highlight after re-render
  setTierFilter(currentTierFilter);
  setSyncFilter(currentSyncFilter);
}

// Shared filter pipeline for both view modes
function filterSkills() {
  const search = (document.getElementById('search-input').value || '').toLowerCase().trim();

  return allSkills.filter(skill => {
    // 1. Tier filter
    if (currentTierFilter !== 'all' && skill.tier !== currentTierFilter) return false;
    // 2. Sync status filter
    if (currentSyncFilter !== 'all' && skill.syncStatus !== currentSyncFilter) return false;
    // 3. Agent filter
    if (currentAgentFilter !== 'all') {
      if (!skill.agentIds || !skill.agentIds.includes(currentAgentFilter)) return false;
    }
    // 4. Search query (name / description / agent / path / manual tags)
    if (search) {
      const matchName = skill.name.toLowerCase().includes(search);
      const matchDesc = (skill.description || '').toLowerCase().includes(search);
      const matchAgent = (skill.agentLabels || []).some(l => l.toLowerCase().includes(search));
      const matchPath = (skill.managedBy || []).some(m => m.displayPath.toLowerCase().includes(search));
      const matchTags = (skill.customTags || []).some(t => t.toLowerCase().includes(search));
      if (!matchName && !matchDesc && !matchAgent && !matchPath && !matchTags) return false;
    }
    return true;
  });
}

// View dispatcher — both modes share the same filter pipeline
function renderSkillsList() {
  updateViewToggleStyles();
  if (currentViewMode === 'compact') {
    renderCompactList();
  } else {
    renderCardsView();
  }
}

function renderEmptyState() {
  const container = document.getElementById('skills-container');
  container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-500 bg-slate-900/30 border border-slate-800/60 rounded-2xl">
        <p class="text-sm">没有匹配到符合条件的技能</p>
        <button onclick="setTierFilter('all'); setSyncFilter('all'); setAgentFilter('all');" class="mt-2 text-xs text-indigo-400 hover:underline">重置所有筛选</button>
      </div>
    `;
}

// Render Skills Cards Grid (卡片模式)
function renderCardsView() {
  const container = document.getElementById('skills-container');
  const filtered = filterSkills();

  if (filtered.length === 0) {
    renderEmptyState();
    return;
  }

  container.innerHTML = filtered.map(skill => {
    // Presentation colors stay client-side; labels/icons come from meta
    const tierColor = {
      builtin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      downloaded: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      custom: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    };
    const syncDot = {
      synced: 'bg-emerald-500', diff: 'bg-amber-500', windows_only: 'bg-blue-500',
      wsl_only: 'bg-orange-500', unknown: 'bg-slate-500'
    };
    const syncText = {
      synced: 'text-emerald-400', diff: 'text-amber-400', windows_only: 'text-blue-400',
      wsl_only: 'text-orange-400', unknown: 'text-slate-400'
    };

    const tierBadgeHtml = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border ${tierColor[skill.tier] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}">${tierIconOf(skill.tier)} ${escapeHtml(tierLabelOf(skill.tier))}</span>`;

    const syncMetaEntry = (appMeta.syncStatuses || []).find(s => s.id === skill.syncStatus);
    const syncBadgeHtml = syncMetaEntry
      ? `<span class="flex items-center space-x-1 text-[10px] ${syncText[skill.syncStatus] || 'text-slate-400'} font-medium"><span class="w-1.5 h-1.5 rounded-full ${syncDot[skill.syncStatus] || 'bg-slate-500'}"></span><span>${escapeHtml(syncMetaEntry.label)}</span></span>`
      : '';

    // Build Agent location rows
    const agentRows = (skill.managedBy || []).map(m => {
      const isWin = m.env === 'windows';
      const badgeClass = isWin ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      return `
        <div class="flex items-center justify-between text-[11px] bg-slate-950/70 px-2 py-1 rounded-lg border border-slate-800/80">
          <div class="flex items-center space-x-1.5 truncate">
            <span class="px-1.5 py-0.2 rounded text-[9px] font-bold border ${badgeClass}">${isWin ? 'Win' : 'WSL'}</span>
            <span class="text-slate-300 font-medium">${escapeHtml(m.agentName)}</span>
            <span class="text-slate-500 font-mono truncate" title="${escapeHtml(m.displayPath)}">${escapeHtml(m.displayPath)}</span>
          </div>
          <button onclick="openInCursor('${skill.id}', '${m.targetId}')" class="text-[10px] text-indigo-400 hover:text-indigo-300 ml-2 flex-shrink-0 font-medium hover:underline flex items-center space-x-0.5" title="在 Cursor 中直接打开此 Agent 目录">
            <span>打开</span>
          </button>
        </div>
      `;
    }).join('');

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
      actionButtons += `<button onclick="forkBuiltinSkill('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg transition">🔱 Fork 派生</button>`;
    } else if (skill.tier === 'downloaded' && skill.upstream) {
      actionButtons += `<button onclick="checkSkillUpdate('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition">🔄 检查更新</button>`;
    }

    // Quick open in cursor button right on card
    actionButtons += `<button onclick="openInCursor('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg transition font-medium">⚡ 用 Cursor 打开</button>`;

    // Manual attribute override entry
    actionButtons += `<button onclick="openOverrideModal('${skill.id}')" class="px-2.5 py-1 text-[11px] ${skill.isOverridden ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'} rounded-lg transition" title="人工调整类别 / 绑定上游 Git / 标签与备注">⚙️ 调整属性</button>`;

    // Guide & Use entry — learn what it does, install elsewhere, favorite
    actionButtons = `<button onclick="openGuideModal('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg transition font-medium" title="了解技能内容并使用：复制提示词 / 安装到其他 Agent / 收藏">📖 了解与使用</button>` + actionButtons;

    // View & Edit button
    actionButtons += `<button onclick="openEditorModal('${skill.id}')" class="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition">查看 / 编辑</button>`;

    return `
      <div class="skill-card bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3">
        <!-- Card Top -->
        <div class="space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center space-x-2 truncate">
              <span class="text-base">${tierIconOf(skill.tier)}</span>
              <h3 class="font-bold text-sm text-white font-mono truncate" title="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</h3>
            </div>
            <div class="flex items-center space-x-1.5 flex-shrink-0">
              ${skill.usage && skill.usage.favorite ? '<span title="已收藏">⭐</span>' : ''}
              ${skill.usage && skill.usage.uses > 0 ? `<span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 text-slate-400 border border-slate-700 font-mono" title="已使用 ${skill.usage.uses} 次">▸${skill.usage.uses}</span>` : ''}
              ${tierBadgeHtml}
              ${skill.isOverridden ? '<span class="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20" title="该技能属性被人工指定覆盖，优先于自动探测">✋ 人工</span>' : ''}
            </div>
          </div>

          <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed" title="${escapeHtml(skill.description || '无描述')}">
            ${skill.description ? escapeHtml(skill.description) : '<span class="italic text-slate-600">未提供描述</span>'}
          </p>

          ${(skill.customTags && skill.customTags.length > 0) ? `
          <div class="flex flex-wrap gap-1">
            ${skill.customTags.map(t => `<span class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/80 text-slate-300 border border-slate-700 cursor-pointer hover:border-indigo-500/60" onclick="searchByTag('${escapeHtml(t)}')" title="点击按标签「${escapeHtml(t)}」筛选">#${escapeHtml(t)}</span>`).join('')}
          </div>` : ''}
          ${skill.customNotes ? `<p class="text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2 py-1 leading-relaxed" title="${escapeHtml(skill.customNotes)}"><span class="font-semibold">📝</span> ${escapeHtml(skill.customNotes)}</p>` : ''}
        </div>

        <!-- Agent Locations Section (明确展示归属哪个 Agent 目录) -->
        <div class="space-y-1.5 pt-1">
          <div class="flex items-center justify-between text-[10px] text-slate-500 font-medium">
            <span>Agent 归属与所在目录:</span>
            ${syncBadgeHtml}
          </div>
          <div class="space-y-1">
            ${agentRows}
          </div>
          ${skill.upstream ? `
          <div class="flex items-center justify-between truncate text-slate-500 text-[10px] font-mono pt-1" title="${skill.upstream.sourceUrl}">
            <span>上游:</span>
            <span class="text-indigo-400 truncate max-w-[170px]">${skill.upstream.source}</span>
          </div>` : ''}
        </div>

        <!-- Card Actions -->
        <div class="pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5 justify-end">
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');
}

// Render Compact List (简洁模式) — skills grouped by agent target directory
function renderCompactList() {
  const container = document.getElementById('skills-container');
  const skills = filterSkills();

  if (skills.length === 0) {
    renderEmptyState();
    return;
  }

  const syncDot = {
    synced: 'bg-emerald-500', diff: 'bg-amber-500', windows_only: 'bg-blue-500',
    wsl_only: 'bg-orange-500', unknown: 'bg-slate-500'
  };
  const syncLabel = (appMeta.syncStatuses || []).reduce((acc, s) => (acc[s.id] = s.label, acc), {});

  const sections = appTargets.filter(t => t.exists).map(t => {
    const rows = skills.filter(s => (s.managedBy || []).some(m => m.targetId === t.id));
    if (rows.length === 0) return '';

    const isWin = t.env === 'windows';
    const envBadge = isWin
      ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300">Win</span>'
      : '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">WSL</span>';

    const rowsHtml = rows.map(s => {
      const dot = syncDot[s.syncStatus] || 'bg-slate-500';
      const statusText = syncLabel[s.syncStatus] || s.syncStatus;
      const desc = (s.description || '').slice(0, 90);
      return `
        <div class="group flex items-center gap-2 px-4 py-1.5 hover:bg-slate-900/70 border-b border-slate-900/80 last:border-0 text-xs">
          <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}" title="${escapeHtml(statusText)}"></span>
          <span class="flex-shrink-0" title="${escapeHtml(tierLabelOf(s.tier))}">${tierIconOf(s.tier)}</span>
          <button onclick="openGuideModal('${s.id}')" class="font-mono font-semibold text-slate-200 hover:text-indigo-300 truncate max-w-[200px]" title="${escapeHtml(s.name)} — 点击打开了解与使用">${escapeHtml(s.name)}</button>
          <span class="text-slate-500 truncate flex-1" title="${escapeHtml(s.description || '')}">${escapeHtml(desc)}</span>
          ${(s.usage && s.usage.favorite) ? '<span class="flex-shrink-0" title="已收藏">⭐</span>' : ''}
          ${s.isOverridden ? '<span class="flex-shrink-0 text-[10px] text-amber-400" title="属性被人工覆盖">✋</span>' : ''}
          <span class="hidden group-hover:flex items-center gap-1 flex-shrink-0">
            <button onclick="openEditorModal('${s.id}', '${t.id}')" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700" title="查看 / 编辑">✏️</button>
            <button onclick="openInCursor('${s.id}', '${t.id}')" class="px-1.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30" title="用 Cursor 打开">⚡</button>
          </span>
        </div>
      `;
    }).join('');

    return `
      <details open class="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <summary class="cursor-pointer select-none px-4 py-2.5 flex items-center justify-between hover:bg-slate-900/80">
          <div class="flex items-center space-x-2 text-xs min-w-0">
            ${envBadge}
            <span class="font-semibold text-slate-200 truncate">${escapeHtml(t.agentName)}</span>
            <span class="font-mono text-[10px] text-slate-500 truncate" title="${escapeHtml(t.dir)}">${escapeHtml(t.displayBase)}</span>
          </div>
          <span class="text-xs font-bold text-indigo-400 flex-shrink-0 ml-2">${rows.length}</span>
        </summary>
        <div class="bg-slate-950/40">${rowsHtml}</div>
      </details>
    `;
  }).join('');

  const totalRows = appTargets.filter(t => t.exists).reduce((n, t) => n + skills.filter(s => (s.managedBy || []).some(m => m.targetId === t.id)).length, 0);
  container.innerHTML = `
    <div class="col-span-full space-y-3">
      <div class="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span>简洁模式：按 Agent 目录分组，点击分组标题可折叠</span>
        <span class="font-mono">${skills.length} 个技能 · ${totalRows} 个分布位置</span>
      </div>
      ${sections}
    </div>
  `;
}

// ---------------------------------------------------------------------
// Actions: Open in Cursor, Sync, Fork, Update
// ---------------------------------------------------------------------

// Open in Cursor directly
async function openInCursor(skillId, targetId = null) {
  showToast(`正在唤起 Cursor 打开 ${skillId}...`, 'info');
  try {
    const res = await fetch('/api/open-editor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, targetId, editor: 'cursor' })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`已通过 Cursor 打开目录: ${data.result.path}`, 'success');
    } else {
      showToast(`打开失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`唤起异常: ${err.message}`, 'error');
  }
}

// Sync single skill (by id — the server resolves paths itself)
async function syncSingleSkill(skillId, direction) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  showToast(`正在同步 ${skill.name} (${direction})...`, 'info');
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, direction })
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
async function forkBuiltinSkill(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  const newName = prompt(`为 Fork 的自定义技能输入新名称:`, `my-${skill.name}`);
  if (!newName) return;

  showToast(`正在派生 ${skill.name} 为自定义技能...`, 'info');
  try {
    const res = await fetch('/api/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, newName, targetEnv: 'windows' })
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
      body: JSON.stringify({ skillId })
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
      body: JSON.stringify({ skillId })
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
// Editor & Markdown Viewer Modal (Safe & Robust)
// ---------------------------------------------------------------------
async function openEditorModal(skillId, specificTargetId = null) {
  currentActiveSkillId = skillId;
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  const modal = document.getElementById('modal-editor');
  modal.classList.remove('hidden');

  document.getElementById('modal-skill-name').textContent = skill.name;
  document.getElementById('modal-skill-meta').textContent = `类别: ${tierLabelOf(skill.tier)} | 涉及 ${skill.managedBy.length} 个 Agent 目录`;

  // Render instance switcher chips
  const instancesList = document.getElementById('modal-instances-list');
  const activeInstance = (specificTargetId && skill.managedBy.find(m => m.targetId === specificTargetId)) || skill.managedBy[0];
  currentActiveInstance = activeInstance;

  instancesList.innerHTML = skill.managedBy.map(m => {
    const isSelected = m.targetId === activeInstance.targetId;
    return `
      <button onclick="switchModalInstance('${skill.id}', '${m.targetId}')" class="px-2.5 py-1 rounded-lg border font-mono text-[11px] transition flex items-center space-x-1.5 ${isSelected ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900 text-slate-400 border-slate-750 hover:text-slate-200'}">
        <span>${m.env === 'windows' ? '🪟 Win' : '🐧 WSL'}: ${m.agentName}</span>
      </button>
    `;
  }).join('');

  document.getElementById('modal-current-path').textContent = `物理路径: ${activeInstance.path}`;
  document.getElementById('modal-current-hash').textContent = `Hash: ${activeInstance.dirHash}`;

  // Fetch content for active instance
  try {
    const res = await fetch(`/api/skill-detail?path=${encodeURIComponent(activeInstance.path)}`);
    const data = await res.json();
    if (data.success) {
      currentActiveSkill = data;
      document.getElementById('editor-textarea').value = data.parsed.rawContent;
      updateLinterBanner(data.lint);
      renderFilesList(data.files);
      switchEditorTab('edit');
    }
  } catch (err) {
    showToast(`无法加载技能详情: ${err.message}`, 'error');
  }
}

function switchModalInstance(skillId, targetId) {
  openEditorModal(skillId, targetId);
}

function updateLinterBanner(lint) {
  const banner = document.getElementById('linter-banner');
  if (!banner) return;

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
  if (!list) return;
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

  if (!btnEdit || !viewEdit) return;

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
  if (!currentActiveInstance) return;

  btn.textContent = '保存中...';

  try {
    const res = await fetch('/api/save-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillPath: currentActiveInstance.path, content })
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

function triggerOpenEditorFromModal() {
  if (!currentActiveSkillId) return;
  const targetId = currentActiveInstance ? currentActiveInstance.targetId : null;
  openInCursor(currentActiveSkillId, targetId);
}

function closeEditorModal() {
  document.getElementById('modal-editor').classList.add('hidden');
}

// ---------------------------------------------------------------------
// Skill Guide Modal (了解与使用)
// ---------------------------------------------------------------------
let guideSkillId = null;

async function openGuideModal(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;
  guideSkillId = skillId;

  document.getElementById('guide-skill-name').textContent = skill.name;
  document.getElementById('guide-skill-desc').textContent = skill.description || '未提供描述';
  document.getElementById('guide-fav-star').classList.toggle('hidden', !(skill.usage && skill.usage.favorite));
  const favBtn = document.getElementById('guide-fav-btn');
  favBtn.textContent = (skill.usage && skill.usage.favorite) ? '⭐ 已收藏' : '☆ 收藏';
  updateGuideUsageStat(skill.usage);

  // Install targets: every registered target this skill does NOT live in yet
  const select = document.getElementById('guide-install-select');
  const owned = new Set((skill.managedBy || []).map(m => m.targetId));
  const candidates = appTargets.filter(t => t.exists && !owned.has(t.id));
  select.innerHTML = candidates.length
    ? candidates.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${t.env === 'windows' ? 'Win' : 'WSL'})</option>`).join('')
    : '<option value="">该技能已覆盖全部 Agent 目录</option>';

  // First instance drives the rendered content
  const first = (skill.managedBy || [])[0];
  document.getElementById('guide-current-path').textContent = first ? first.path : '';

  document.getElementById('guide-markdown').innerHTML = '<p class="text-slate-500 text-center py-6">正在加载 SKILL.md ...</p>';
  document.getElementById('guide-files').innerHTML = '<li class="text-slate-500 italic">加载中...</li>';
  ['guide-ai-output', 'guide-ai-error', 'guide-ai-setup', 'guide-ai-refresh', 'guide-ai-badge'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('modal-guide').classList.remove('hidden');

  // Record the view usage (fire-and-forget; keep displayed value until refresh)
  recordGuideUsage('view');

  try {
    const res = await fetch(`/api/skill-detail?path=${encodeURIComponent(first ? first.path : '')}`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('guide-markdown').innerHTML = marked.parse(data.parsed.rawContent || '');
      const filesList = document.getElementById('guide-files');
      filesList.innerHTML = (data.files && data.files.length)
        ? data.files.map(f => `<li class="flex items-center justify-between border-b border-slate-900 last:border-0"><span>${f.name.endsWith('.sh') || f.name.endsWith('.py') ? '⚙️' : '📄'} ${escapeHtml(f.path)}</span><span class="text-slate-500 text-[10px]">${(f.size / 1024).toFixed(1)} KB</span></li>`).join('')
        : '<li class="text-slate-500 italic">无附带文件，仅 SKILL.md 本体</li>';
      renderGuideFacts(skill, data.files ? data.files.length : 0);
    } else {
      document.getElementById('guide-markdown').innerHTML = `<p class="text-rose-400">加载失败: ${escapeHtml(data.error || '')}</p>`;
    }
  } catch (err) {
    document.getElementById('guide-markdown').innerHTML = `<p class="text-rose-400">加载异常: ${escapeHtml(err.message)}</p>`;
  }
}

function renderGuideFacts(skill, fileCount) {
  const facts = [
    { label: '类别', value: `${tierIconOf(skill.tier)} ${tierLabelOf(skill.tier)}${skill.isOverridden ? ' (人工)' : ''}` },
    { label: '双端状态', value: (appMeta.syncStatuses || []).find(s => s.id === skill.syncStatus)?.label || skill.syncStatus },
    { label: '归属 Agent', value: (skill.agentLabels || []).join('、') || '无' },
    { label: '文件数', value: `${fileCount} 个` }
  ];
  if (skill.upstream) facts.push({ label: '上游仓库', value: skill.upstream.source });
  if (skill.customTags && skill.customTags.length) facts.push({ label: '标签', value: skill.customTags.map(t => `#${t}`).join(' ') });

  document.getElementById('guide-facts').innerHTML = facts.map(f => `
    <div class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
      <div class="text-[10px] uppercase tracking-wider text-slate-500">${escapeHtml(f.label)}</div>
      <div class="text-slate-200 mt-1 truncate" title="${escapeHtml(String(f.value))}">${escapeHtml(String(f.value))}</div>
    </div>
  `).join('');
}

function updateGuideUsageStat(usage) {
  const el = document.getElementById('guide-usage-stat');
  if (!el) return;
  if (usage && usage.uses > 0) {
    const when = usage.lastUsedAt ? new Date(usage.lastUsedAt).toLocaleString() : '';
    el.textContent = `已使用 ${usage.uses} 次${when ? ' · 最近 ' + when : ''}`;
  } else {
    el.textContent = '尚未使用';
  }
}

async function recordGuideUsage(action) {
  if (!guideSkillId) return null;
  try {
    const res = await fetch('/api/use-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: guideSkillId, action })
    });
    const data = await res.json();
    if (data.success) {
      updateGuideUsageStat(data.usage);
      const skill = allSkills.find(s => s.id === guideSkillId);
      if (skill) skill.usage = data.usage;
      return data.usage;
    }
  } catch (e) { /* usage tracking must never break the guide */ }
  return null;
}

function guidePromptText() {
  const skill = allSkills.find(s => s.id === guideSkillId);
  if (!skill) return '';
  const first = (skill.managedBy || [])[0];
  return [
    `请使用技能「${skill.name}」处理我的请求。`,
    skill.description ? `\n技能说明：${skill.description}` : '',
    first ? `\n技能位置：${first.displayPath}/SKILL.md` : ''
  ].filter(Boolean).join('\n');
}

async function copySkillPrompt() {
  const text = guidePromptText();
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (ok) {
    showToast('触发提示词已复制，粘贴给任意 Agent 即可使用', 'success');
    await recordGuideUsage('copy_prompt');
  } else {
    showToast('复制失败，请手动选择文本复制', 'error');
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback for non-secure contexts
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

async function toggleGuideFavorite() {
  const skill = allSkills.find(s => s.id === guideSkillId);
  if (!skill) return;
  const next = !(skill.usage && skill.usage.favorite);
  try {
    const res = await fetch('/api/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: guideSkillId, favorite: next })
    });
    const data = await res.json();
    if (data.success) {
      skill.usage = data.usage;
      document.getElementById('guide-fav-star').classList.toggle('hidden', !next);
      document.getElementById('guide-fav-btn').textContent = next ? '⭐ 已收藏' : '☆ 收藏';
      showToast(next ? '已收藏' : '已取消收藏', 'success');
      renderSkillsList();
    } else {
      showToast(`收藏失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`收藏出错: ${err.message}`, 'error');
  }
}

async function installSkillToTargetFromGuide() {
  const select = document.getElementById('guide-install-select');
  const targetId = select ? select.value : '';
  if (!targetId) {
    showToast('没有可安装的目标目录', 'error');
    return;
  }
  const skill = allSkills.find(s => s.id === guideSkillId);
  showToast(`正在把 ${skill ? skill.name : guideSkillId} 安装到目标 Agent ...`, 'info');
  try {
    const res = await fetch('/api/install-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: guideSkillId, targetId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`安装成功：${data.result.destDir}`, 'success');
      await recordGuideUsage('install');
      await refreshSkills();
    } else {
      showToast(`安装失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`安装出错: ${err.message}`, 'error');
  }
}

function closeGuideModal() {
  document.getElementById('modal-guide').classList.add('hidden');
  guideSkillId = null;
}

// ---------------------------------------------------------------------
// AI Guide (🤖 AI 讲解) — LLM reads the SKILL.md and explains it
// ---------------------------------------------------------------------
async function explainCurrentSkill(force) {
  if (!guideSkillId) return;
  const btn = document.getElementById('guide-ai-btn');
  const output = document.getElementById('guide-ai-output');
  const errBox = document.getElementById('guide-ai-error');
  const badge = document.getElementById('guide-ai-badge');
  btn.disabled = true;
  btn.textContent = '🤖 正在阅读技能文件...';
  errBox.classList.add('hidden');
  output.classList.add('hidden');
  badge.classList.add('hidden');

  try {
    const res = await fetch('/api/explain-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: guideSkillId, force: !!force })
    });
    const data = await res.json();

    if (res.status === 503 || res.status === 502 || res.status === 504) {
      // Unconfigured, or the configured gateway rejected the key — offer the setup form
      showAiSetupForm();
      errBox.textContent = data.error || `请求失败 (${res.status})`;
      errBox.classList.remove('hidden');
      return;
    }
    if (!data.success) {
      errBox.textContent = data.error || `请求失败 (${res.status})`;
      errBox.classList.remove('hidden');
      return;
    }

    output.innerHTML = marked.parse(data.explanation.text || '');
    output.classList.remove('hidden');
    badge.textContent = `${data.explanation.model}${data.explanation.cached ? ' · 缓存' : ''}`;
    badge.classList.remove('hidden');
    document.getElementById('guide-ai-refresh').classList.remove('hidden');
    if (data.usage) updateGuideUsageStat(data.usage);
  } catch (err) {
    errBox.textContent = `讲解出错: ${err.message}`;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 让 AI 讲解这个技能';
  }
}

async function showAiSetupForm() {
  const box = document.getElementById('guide-ai-setup');
  try {
    const res = await fetch('/api/llm-config');
    const cfg = await res.json();
    document.getElementById('ai-setup-url').value = cfg.baseUrl || 'https://open.bigmodel.cn/api/paas/v4';
    document.getElementById('ai-setup-model').value = cfg.model || 'glm-4-flash';
  } catch (e) { /* defaults stay as placeholders */ }
  box.classList.remove('hidden');
}

async function saveAiSetup() {
  const baseUrl = document.getElementById('ai-setup-url').value.trim();
  const model = document.getElementById('ai-setup-model').value.trim();
  const apiKey = document.getElementById('ai-setup-key').value.trim();
  if (!baseUrl || !model || !apiKey) {
    alert('Base URL、模型名和 API Key 都需要填写');
    return;
  }
  try {
    const res = await fetch('/api/llm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, model, apiKey })
    });
    const data = await res.json();
    if (data.success) {
      showToast('AI 服务配置已保存', 'success');
      document.getElementById('guide-ai-setup').classList.add('hidden');
      await explainCurrentSkill(true);
    } else {
      showToast(`保存失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`保存出错: ${err.message}`, 'error');
  }
}

// ---------------------------------------------------------------------
// Manual Attribute Override Modal (人工类别覆盖 / 上游绑定 / 标签备注)
// ---------------------------------------------------------------------
let overrideTargetSkillId = null;
let overrideSelectedTier = 'custom';

function openOverrideModal(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  overrideTargetSkillId = skillId;
  document.getElementById('override-skill-name').textContent = `${skill.name}  (id: ${skill.id})`;

  // Prefill with the currently effective (possibly already overridden) attributes
  selectOverrideTier(skill.tier || 'custom');
  document.getElementById('override-upstream-input').value = (skill.upstream && skill.upstream.sourceUrl) || '';
  document.getElementById('override-tags-input').value = (skill.customTags || []).join(', ');
  document.getElementById('override-notes-input').value = skill.customNotes || '';
  document.getElementById('modal-override').classList.remove('hidden');
}

function closeOverrideModal() {
  document.getElementById('modal-override').classList.add('hidden');
  overrideTargetSkillId = null;
}

function selectOverrideTier(tier) {
  overrideSelectedTier = tier;

  document.querySelectorAll('.override-tier-card').forEach(card => {
    if (card.dataset.tier === tier) {
      card.className = 'override-tier-card cursor-pointer rounded-xl border p-2.5 text-center transition border-indigo-500 bg-indigo-950/40 shadow-md shadow-indigo-900/30';
    } else {
      card.className = 'override-tier-card cursor-pointer rounded-xl border p-2.5 text-center transition border-slate-700 bg-slate-950 hover:border-slate-500';
    }
  });

  // Upstream binding input only makes sense for downloaded skills
  const upstreamBox = document.getElementById('override-upstream-box');
  if (upstreamBox) upstreamBox.classList.toggle('hidden', tier !== 'downloaded');
}

async function saveSkillOverride() {
  if (!overrideTargetSkillId) return;

  const tier = overrideSelectedTier;
  const upstreamUrl = document.getElementById('override-upstream-input').value.trim();
  const tags = document.getElementById('override-tags-input').value.trim();
  const notes = document.getElementById('override-notes-input').value.trim();

  if (tier === 'downloaded' && !upstreamUrl) {
    alert('归类为「网上下载」时必须填写上游 Git 仓库地址，否则无法检查更新。');
    return;
  }
  if (upstreamUrl && !/^(https?:\/\/|git@)/.test(upstreamUrl)) {
    alert('上游地址需以 https:// 、http:// 或 git@ 开头 (Git 仓库地址)。');
    return;
  }

  const btn = document.getElementById('btn-save-override');
  btn.textContent = '保存中...';
  btn.classList.add('opacity-50', 'pointer-events-none');

  try {
    const res = await fetch('/api/set-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: overrideTargetSkillId, tier, upstreamUrl: upstreamUrl || null, tags, notes })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`已保存人工覆盖: ${overrideTargetSkillId} → ${tier === 'builtin' ? '官方内置' : tier === 'downloaded' ? '网上下载' : '自己编写'}`, 'success');
      closeOverrideModal();
      await refreshSkills();
    } else {
      showToast(`保存覆盖失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`保存覆盖出错: ${err.message}`, 'error');
  } finally {
    btn.textContent = '保存覆盖';
    btn.classList.remove('opacity-50', 'pointer-events-none');
  }
}

async function resetSkillOverride() {
  if (!overrideTargetSkillId) return;

  try {
    const res = await fetch('/api/reset-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: overrideTargetSkillId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`已恢复自动判定: ${overrideTargetSkillId}`, 'success');
      closeOverrideModal();
      await refreshSkills();
    } else {
      showToast(`重置失败: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`重置出错: ${err.message}`, 'error');
  }
}

// Quick filter by clicking a tag chip on a card
function searchByTag(tag) {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.value = tag;
  renderSkillsList();
}

// ---------------------------------------------------------------------
// New Skill Wizard
// ---------------------------------------------------------------------
function openNewSkillModal() {
  document.getElementById('new-skill-name').value = '';
  document.getElementById('new-skill-desc').value = '';
  const envSelect = document.getElementById('new-skill-env');
  if (envSelect && appMeta.customSkillEnvs) {
    envSelect.innerHTML = appMeta.customSkillEnvs.map(e =>
      `<option value="${escapeHtml(e.id)}">${escapeHtml(e.label)}</option>`
    ).join('');
  }
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
      openEditorModal(data.result.name);
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
