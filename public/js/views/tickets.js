/* ============================ SERVICE DESK (ITIL) ============================ */

const TK_STATUS = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'];
const TK_BOARD_COLUMNS = ['new', 'open', 'in_progress', 'pending', 'resolved'];
const TK_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TK_STATUS_PILL = {
  new: 'pill-slate', open: 'pill-blue', in_progress: 'pill-amber', pending: 'pill-slate',
  resolved: 'pill-emerald', closed: 'pill-slate', cancelled: 'pill-rose',
};
const TK_PRIORITY_PILL = { low: 'pill-slate', medium: 'pill-blue', high: 'pill-amber', urgent: 'pill-rose' };
// Mirror of the server's Impact × Urgency matrix (ticketService.derivePriority).
const TK_PRIORITY_MATRIX = {
  high: { high: 'urgent', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
};
const tkDerivePriority = (impact, urgency) => (TK_PRIORITY_MATRIX[impact] && TK_PRIORITY_MATRIX[impact][urgency]) || null;
const TK_RESOLUTION_CODES = ['fixed', 'workaround', 'no_fault', 'duplicate', 'not_reproducible', 'user_education'];
const tkStars = (n) => `<span class="tk-stars" title="${n}/5">${'★'.repeat(n)}<span class="tk-stars-off">${'★'.repeat(5 - n)}</span></span>`;
const tkStatusLabel = (s) => t('tk.status.' + s) || s;
const tkPriorityLabel = (p) => t('tk.priority.' + p) || p;
const tkTypeLabel = (ty) => t('tk.type.' + ty) || ty;
// Readable label for an approval-chain level token (manager / manager2 /
// department / role:<team> / emp:<uuid> fixed approver).
const lvlLabel = (lv) => {
  const s = String(lv);
  if (s.startsWith('emp:')) return t('rt.finalApprover');
  if (s === 'role:it') return t('rt.itTeam');
  if (s.startsWith('role:')) return s.slice(5);
  return t('rt.' + s) || s;
};

/* Approval decision trail. `history` = [{ at, decision, deciderName, approverName, note }].
   Shared by the staff and portal ticket detail; returns '' when there's nothing to show. */
function renderApprovalTimeline(history) {
  const rows = Array.isArray(history) ? history : [];
  if (!rows.length) return '';
  const items = rows.map((h) => {
    const kind = h.decision === 'approved' ? 'ok' : h.decision === 'escalated' ? 'esc' : 'no';
    const icon = kind === 'ok' ? 'check_circle' : kind === 'esc' ? 'trending_up' : 'cancel';
    const pill = kind === 'ok' ? 'pill-emerald' : kind === 'esc' ? 'pill-amber' : 'pill-rose';
    const label = kind === 'ok' ? t('mtk.apApproved') : kind === 'esc' ? t('mtk.apEscalated') : t('mtk.apRejected');
    const when = String(h.at || '').replace('T', ' ').slice(0, 16);
    const who = h.deciderName || h.approverName || '—';
    const asSlot = h.approverName && h.deciderName && h.approverName !== h.deciderName ? ` <span class="cell-sub">(${esc(t('mtk.apFor'))} ${esc(h.approverName)})</span>` : '';
    return `<li class="tk-appr-ev">
        <span class="ms ms-sm tk-appr-${kind}">${icon}</span>
        <div class="tk-appr-body">
          <div class="tk-appr-line"><strong>${esc(who)}</strong>${asSlot}
            <span class="pill ${pill}">${esc(label)}</span></div>
          <div class="cell-sub">${esc(when)}</div>
          ${h.note ? `<div class="tk-appr-note">“${esc(h.note)}”</div>` : ''}</div>
      </li>`;
  }).join('');
  return `<div class="form-field full"><label>${esc(t('tk.approvalTrail'))}</label>
    <ul class="tk-appr-timeline">${items}</ul></div>`;
}

/* --- SLA badges (staff views only — portal payloads carry no `sla`) --- */
const TK_SLA_PILL = { due: 'pill-blue', breached: 'pill-rose', met: 'pill-emerald', paused: 'pill-slate', na: 'pill-slate', none: 'pill-slate' };
function tkFmtRemaining(ms) {
  const m = Math.max(0, Math.round((ms || 0) / 60000));
  if (m < 60) return (t('tk.sla.inMin') || '{n}m').replace('{n}', m);
  const h = Math.floor(m / 60);
  if (h < 48) return (t('tk.sla.inHour') || '{n}h').replace('{n}', h);
  return (t('tk.sla.inDay') || '{n}d').replace('{n}', Math.floor(h / 24));
}
function tkSlaLabel(leg) {
  if (!leg || leg.state === 'none' || leg.state === 'na') return t('tk.sla.na');
  if (leg.state === 'met') return t('tk.sla.met');
  if (leg.state === 'breached') return t('tk.sla.breached');
  if (leg.state === 'paused') return t('tk.sla.paused');
  return tkFmtRemaining(leg.remainingMs);
}
function tkSlaBadge(leg) {
  const cls = TK_SLA_PILL[(leg && leg.state) || 'none'] || 'pill-slate';
  return `<span class="pill ${cls}">${esc(tkSlaLabel(leg))}</span>`;
}
function slaDue(leg) {
  if (!leg || !leg.dueAt) return '';
  return ` <span class="cell-sub">· ${esc(t('tk.sla.target'))} ${esc(String(leg.dueAt).replace('T', ' ').slice(0, 16))}</span>`;
}

Views.tickets = async function (el, params = {}) {
  const canCreate = Auth.canIam('ticket', 'create') || Auth.canIam('ticket', 'manage');
  const canUpdate = Auth.canIam('ticket', 'update') || Auth.canIam('ticket', 'manage');
  const canAssign = Auth.canIam('ticket', 'assign') || Auth.canIam('ticket', 'manage');
  const canManage = Auth.canIam('ticket', 'manage');
  // Fine-grained (manage still implies both): report = the Report screen;
  // configure = request templates + SLA targets + approval settings.
  const canReport = Auth.canIam('ticket', 'report') || canManage;
  const canConfigure = Auth.canIam('ticket', 'configure') || canManage;
  const canDocRead = Auth.canIam('document', 'read');
  const canDocUpload = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create');
  const canDocDelete = Auth.canIam('document', 'delete');
  const canLinkProblem = Auth.canIam('problem', 'update') || Auth.canIam('problem', 'manage');
  let mode = localStorage.getItem('tk_mode') === 'board' ? 'board' : 'list';

  const [tickets, staff, empRes, assetRes, stats0, catsRes, cannedRes, problemsRes, tplRes] = await Promise.all([
    api('/tickets?open=1').catch(() => []),
    api('/auth/users').catch(() => []),
    api('/employees?status=Active&limit=1000').catch(() => ({ items: [] })),
    api('/assets?limit=1000').catch(() => ({ items: [] })),
    api('/tickets/stats').catch(() => null),
    api('/tickets/categories').catch(() => []),
    api('/tickets/canned').catch(() => []),
    canLinkProblem ? api('/problems?limit=500').catch(() => []) : Promise.resolve([]),
    api('/request-templates').catch(() => []),
  ]);
  const templates = (Array.isArray(tplRes) ? tplRes : []).filter((tp) => tp.enabled !== false);
  const problemsList = Array.isArray(problemsRes) ? problemsRes : [];
  const probLabel = (p) => `${p.number} · ${p.title}`;
  const catList = Array.isArray(catsRes) ? catsRes : [];
  // <option>s for a category <select>; keeps a legacy/current value that is no
  // longer in the managed list so it isn't silently dropped on save.
  const catOptions = (sel) => {
    const opts = sel && !catList.includes(sel) ? [sel, ...catList] : catList;
    return opts.map((c) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)}</option>`).join('');
  };
  let canned = Array.isArray(cannedRes) ? cannedRes : [];
  let sortKey = 'created';
  let sortOrder = 'desc';
  let searchTerm = '';
  let searchTimer = null;
  const selected = new Set(); // bulk-select ids for the current painted list

  // KPI strip: open · unassigned · SLA-breached · resolved today.
  const statsHtml = (s) => {
    if (!s) return '';
    const card = (label, val, icon, tone) => `<div class="card card-pad metric">
      <div class="metric-top"><h3 class="card-title">${esc(label)}</h3>${iconChip(icon, tone)}</div>
      <div class="metric-value">${val}</div></div>`;
    const compliance = s.slaCompliance != null
      ? (s.slaCompliance >= 90 ? 'var(--emerald-600)' : s.slaCompliance >= 75 ? 'var(--amber-600)' : 'var(--rose-600)') : '';
    const extra = (s.slaCompliance != null || s.csatCount)
      ? `<div style="display:flex;gap:22px;flex-wrap:wrap;margin:-6px 0 16px;padding:0 2px;font-size:13px">
          ${s.slaCompliance != null ? `<span><span class="cell-sub">${esc(t('tk.slaCompliance'))}:</span> <strong style="color:${compliance}">%${s.slaCompliance}</strong> <span class="cell-sub">(30${esc(t('tk.daysShort'))})</span></span>` : ''}
          ${s.csatCount ? `<span><span class="cell-sub">${esc(t('tk.csatAvg'))}:</span> <strong>${esc(String(s.csatAvg))} / 5</strong> <span class="cell-sub">(${s.csatCount} ${esc(t('tk.votes'))})</span></span>` : ''}
        </div>` : '';
    return `<div class="grid grid-4" style="margin-bottom:${extra ? '10px' : '16px'}">
      ${card(t('tk.kpiOpen'), s.open, 'confirmation_number', 'indigo')}
      ${card(t('tk.kpiUnassigned'), s.unassigned, 'person_off', s.unassigned ? 'amber' : 'emerald')}
      ${card(t('tk.kpiBreached'), s.breached, 'warning', s.breached ? 'rose' : 'emerald')}
      ${card(t('tk.kpiResolvedToday'), s.resolvedToday, 'task_alt', 'blue')}
    </div>${extra}`;
  };
  const staffList = Array.isArray(staff) ? staff : [];
  const staffName = (uid) => (staffList.find((u) => u.uid === uid) || {}).username || '';

  // Searchable pickers (datalist): build unique label→id maps for requester + asset.
  const emps = Array.isArray(empRes) ? empRes : (empRes.items || []);
  const assets = Array.isArray(assetRes) ? assetRes : (assetRes.items || []);
  const empLabel = (e) => [e.fullName, e.department || e.title].filter(Boolean).join(' · ') || e.fullName || '—';
  const assetLabel = (x) => [x.assetTag, [x.brand, x.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const assetById = new Map(assets.map((x) => [x.id, x]));

  const canBulk = canUpdate || canAssign;
  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const avatar = (name) => `<span class="tk-assignee"><span class="tk-avatar">${esc(initials(name))}</span><span>${esc(name)}</span></span>`;
  const rowHtml = (tk) => `<tr data-open="${esc(tk.id)}" class="tk-row prio-${esc(tk.priority)}" style="cursor:pointer">
      ${canBulk ? `<td class="tk-selcell"><input type="checkbox" class="tk-sel" data-id="${esc(tk.id)}"></td>` : ''}
      <td class="mono tk-num">${esc(tk.number)}</td>
      <td><span class="tk-type"><span class="ms ms-sm">${tk.type === 'request' ? 'assignment' : 'bolt'}</span>${esc(tkTypeLabel(tk.type))}</span></td>
      <td><div class="cell-title">${esc(tk.subject)}</div>${tk.assetTag ? `<div class="cell-sub"><span class="ms ms-sm" style="vertical-align:-3px">devices</span> ${esc(tk.assetTag)}</div>` : ''}</td>
      <td>${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}</td>
      <td>${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</td>
      <td>${tkSlaBadge(tk.sla && tk.sla.resolve)}</td>
      <td class="cell-sub">${esc(tk.requesterName || '—')}</td>
      <td>${tk.assigneeName ? avatar(tk.assigneeName) : `<span class="tk-unassigned">${esc(t('tk.unassigned'))}</span>`}</td>
      <td class="cell-sub tk-date">${esc(String(tk.createdAt || '').slice(0, 10))}</td>
    </tr>`;

  const sortTh = (key, label) => {
    const arrow = sortKey === key ? (sortOrder === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="tk-sortable${sortKey === key ? ' active' : ''}" data-sort="${key}">${esc(label)}${arrow}</th>`;
  };
  const tableHtml = (list) => `<div class="card table-wrap"><table class="data tk-list">
      <thead><tr>
        ${canBulk ? '<th class="tk-selcell"><input type="checkbox" id="tk-sel-all"></th>' : ''}
        ${sortTh('number', '#')}<th>${esc(t('tk.type'))}</th>${sortTh('subject', t('tk.subject'))}
        ${sortTh('status', t('tk.statusCol'))}${sortTh('priority', t('tk.priorityCol'))}${sortTh('sla', t('tk.slaCol'))}
        <th>${esc(t('tk.requester'))}</th><th>${esc(t('tk.assignee'))}</th>${sortTh('created', t('tk.createdCol'))}
      </tr></thead>
      <tbody id="tk-rows">${list.length ? list.map(rowHtml).join('')
        : `<tr><td colspan="${canBulk ? 10 : 9}" class="table-empty">${esc(t('tk.none'))}</td></tr>`}</tbody>
    </table></div>`;

  const cardHtml = (tk) => `<div class="tk-card" data-id="${esc(tk.id)}" data-status="${esc(tk.status)}"${canUpdate ? ' draggable="true"' : ''}>
      <div class="tk-card-top"><span class="mono cell-sub">${esc(tk.number)}</span>${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</div>
      <div class="tk-card-title">${esc(tk.subject)}</div>
      <div class="tk-card-foot">${tkSlaBadge(tk.sla && tk.sla.resolve)}<span class="cell-sub">${esc(tk.assigneeName || t('tk.unassigned'))}</span></div>
    </div>`;

  const boardHtml = (list) => {
    const by = {}; TK_BOARD_COLUMNS.forEach((s) => { by[s] = []; });
    list.forEach((tk) => { if (by[tk.status]) by[tk.status].push(tk); });
    return `<div class="tk-board">${TK_BOARD_COLUMNS.map((s) => `
      <div class="tk-col">
        <div class="tk-col-head">${pill(TK_STATUS_PILL[s], tkStatusLabel(s))}<span class="tk-col-count" data-count="${s}">${by[s].length}</span></div>
        <div class="tk-col-body" data-col="${s}">${by[s].map(cardHtml).join('')}</div>
      </div>`).join('')}</div>`;
  };

  const paintList = (list) => {
    const box = $('#tk-content', el); if (!box) return;
    selected.clear(); // a fresh paint (sort/filter/refresh) starts with no selection
    box.innerHTML = tableHtml(list);
    box.querySelectorAll('#tk-rows tr[data-open]').forEach((tr) =>
      tr.addEventListener('click', () => openTicket(tr.dataset.open)));
    box.querySelectorAll('th.tk-sortable').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortOrder = key === 'subject' || key === 'number' ? 'asc' : 'desc'; }
      refresh();
    }));
    // Bulk-select checkboxes (don't let a checkbox click open the ticket).
    box.querySelectorAll('.tk-sel').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.id); else selected.delete(cb.dataset.id);
        const all = $('#tk-sel-all', box); if (all) all.checked = selected.size === list.length && list.length > 0;
        renderBulk();
      });
    });
    const selAll = $('#tk-sel-all', box);
    if (selAll) selAll.addEventListener('change', () => {
      selected.clear();
      box.querySelectorAll('.tk-sel').forEach((cb) => { cb.checked = selAll.checked; if (selAll.checked) selected.add(cb.dataset.id); });
      renderBulk();
    });
    renderBulk();
  };

  const paintBoard = (list) => {
    const box = $('#tk-content', el); if (!box) return;
    box.innerHTML = boardHtml(list);
    box.querySelectorAll('.tk-card').forEach((card) => {
      card.addEventListener('click', () => { if (!card.dataset.dragging) openTicket(card.dataset.id); });
      card.addEventListener('dragstart', (e) => { card.dataset.dragging = '1'; card.classList.add('dragging'); e.dataTransfer.setData('text/plain', card.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
      card.addEventListener('dragend', () => { delete card.dataset.dragging; card.classList.remove('dragging'); });
    });
    box.querySelectorAll('.tk-col-body').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop-target'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop-target'); onDrop(col, e.dataTransfer.getData('text/plain')); });
    });
  };

  const updateCounts = () => el.querySelectorAll('.tk-col-body').forEach((col) => {
    const span = el.querySelector(`.tk-col-count[data-count="${col.dataset.col}"]`);
    if (span) span.textContent = col.querySelectorAll('.tk-card').length;
  });

  async function onDrop(col, id) {
    const to = col.dataset.col;
    const card = id && el.querySelector(`.tk-card[data-id="${id}"]`);
    if (!card || card.dataset.status === to) return;
    const prevBody = card.parentNode;
    col.appendChild(card); card.dataset.status = to; updateCounts(); // optimistic
    try {
      await api('/tickets/' + encodeURIComponent(id), { method: 'PATCH', body: { status: to } });
      refreshStats();
    } catch (err) {
      toast(err.message, 'error');
      if (prevBody) { prevBody.appendChild(card); card.dataset.status = prevBody.dataset.col; updateCounts(); }
    }
  }

  const refreshStats = () => api('/tickets/stats')
    .then((s) => { const b = $('#tk-stats', el); if (b && s) b.innerHTML = statsHtml(s); }).catch(() => {});

  function renderBulk() {
    const box = $('#tk-bulk', el); if (!box) return;
    if (!selected.size) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'flex';
    box.innerHTML = `
      <span class="tk-bulk-count">${esc(t('tk.selected').replace('{n}', selected.size))}</span>
      ${canAssign ? `<select class="ops-select" id="tk-bulk-assign">
        <option value="">${esc(t('tk.bulkAssign'))}</option>
        <option value="__none__">${esc(t('tk.unassigned'))}</option>
        ${staffList.map((u) => `<option value="${esc(u.uid)}">${esc(u.username)}</option>`).join('')}
      </select>` : ''}
      ${canUpdate ? `<select class="ops-select" id="tk-bulk-priority">
        <option value="">${esc(t('tk.bulkPriority'))}</option>
        ${TK_PRIORITY.map((p) => `<option value="${p}">${esc(tkPriorityLabel(p))}</option>`).join('')}
      </select>` : ''}
      ${canUpdate ? `<select class="ops-select" id="tk-bulk-status">
        <option value="">${esc(t('tk.bulkStatus'))}</option>
        ${TK_STATUS.map((s) => `<option value="${s}">${esc(tkStatusLabel(s))}</option>`).join('')}
      </select>` : ''}
      <button class="btn btn-outline btn-sm" id="tk-bulk-clear" style="margin-left:auto">${esc(t('tk.clearSel'))}</button>`;
    $('#tk-bulk-assign', box)?.addEventListener('change', (e) => { if (e.target.value) bulkApply({ assigneeUserId: e.target.value === '__none__' ? null : e.target.value }); });
    $('#tk-bulk-priority', box)?.addEventListener('change', (e) => { if (e.target.value) bulkApply({ priority: e.target.value }); });
    $('#tk-bulk-status', box)?.addEventListener('change', (e) => { if (e.target.value) bulkApply({ status: e.target.value }); });
    $('#tk-bulk-clear', box)?.addEventListener('click', () => { selected.clear(); el.querySelectorAll('.tk-sel, #tk-sel-all').forEach((cb) => { cb.checked = false; }); renderBulk(); });
  }

  async function bulkApply(patch) {
    const ids = [...selected];
    if (!ids.length) return;
    let ok = 0; let fail = 0;
    for (const id of ids) {
      try { await api('/tickets/' + encodeURIComponent(id), { method: 'PATCH', body: patch }); ok += 1; }
      catch { fail += 1; }
    }
    toast(t('tk.bulkDone').replace('{ok}', ok).replace('{fail}', fail), fail ? 'error' : 'success');
    refresh(); // repaint clears selection + checkboxes + hides the bar
  }

  /* ------------------------- saved views (per browser) ------------------------- */
  const loadViews = () => { try { return JSON.parse(localStorage.getItem('tk_saved_views') || '[]'); } catch { return []; } };
  const storeViews = (v) => localStorage.setItem('tk_saved_views', JSON.stringify(v.slice(0, 50)));

  const currentFilters = () => ({
    search: searchTerm,
    status: $('#tk-f-status', el) ? $('#tk-f-status', el).value : 'open',
    type: $('#tk-f-type', el) ? $('#tk-f-type', el).value : '',
    priority: $('#tk-f-priority', el) ? $('#tk-f-priority', el).value : '',
    category: $('#tk-f-category', el) ? $('#tk-f-category', el).value : '',
    mine: !!($('#tk-f-mine', el) && $('#tk-f-mine', el).checked),
    sortKey, sortOrder,
  });

  const applyView = (f) => {
    searchTerm = f.search || '';
    if ($('#tk-f-search', el)) $('#tk-f-search', el).value = searchTerm;
    if ($('#tk-f-status', el)) $('#tk-f-status', el).value = f.status != null ? f.status : 'open';
    if ($('#tk-f-type', el)) $('#tk-f-type', el).value = f.type || '';
    if ($('#tk-f-priority', el)) $('#tk-f-priority', el).value = f.priority || '';
    if ($('#tk-f-category', el)) $('#tk-f-category', el).value = f.category || '';
    if ($('#tk-f-mine', el)) $('#tk-f-mine', el).checked = !!f.mine;
    sortKey = f.sortKey || 'created';
    sortOrder = f.sortOrder || 'desc';
    refresh();
  };

  function renderViewsSelect() {
    const wrap = $('#tk-views-wrap', el); if (!wrap) return;
    const views = loadViews();
    wrap.innerHTML = `<select id="tk-views" class="ops-select">
      <option value="">${esc(t('tk.views'))}</option>
      ${views.map((v, i) => `<option value="v:${i}">${esc(v.name)}</option>`).join('')}
      <option value="__save__">＋ ${esc(t('tk.saveView'))}</option>
      ${views.length ? `<option value="__manage__">${esc(t('tk.manageViews'))}…</option>` : ''}
    </select>`;
    $('#tk-views', wrap).addEventListener('change', (e) => {
      const v = e.target.value;
      if (v === '__save__') saveCurrentView();
      else if (v === '__manage__') openViewsManager();
      else if (v.startsWith('v:')) applyView(views[Number(v.slice(2))].filters);
      e.target.value = '';
    });
  }

  function saveCurrentView() {
    openModal({
      title: t('tk.saveView'),
      body: `<div class="form-field full"><label>${esc(t('tk.viewName'))}</label><input id="tk-view-name" maxlength="60" placeholder="${esc(t('tk.viewNamePh'))}"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" id="tk-view-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        const inp = $('#tk-view-name', ov); inp.focus();
        $('#tk-view-save', ov).addEventListener('click', () => {
          const name = inp.value.trim(); if (!name) return;
          const views = loadViews(); views.push({ name, filters: currentFilters() }); storeViews(views);
          closeModal(); renderViewsSelect(); toast(t('tk.viewSaved'), 'success');
        });
      },
    });
  }

  function openViewsManager() {
    const views = loadViews();
    openModal({
      title: t('tk.manageViews'),
      body: views.length
        ? `<ul class="tk-views-list" style="list-style:none;padding:0;margin:0">${views.map((v, i) => `
            <li style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--outline-variant)">
              <span style="flex:1">${esc(v.name)}</span>
              <button class="btn btn-outline btn-sm tk-view-del" data-i="${i}"><span class="ms ms-sm">delete</span></button>
            </li>`).join('')}</ul>`
        : `<p class="cell-sub">${esc(t('tk.noViews'))}</p>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        ov.querySelectorAll('.tk-view-del').forEach((b) => b.addEventListener('click', () => {
          const cur = loadViews(); cur.splice(Number(b.dataset.i), 1); storeViews(cur);
          closeModal(); renderViewsSelect(); openViewsManager();
        }));
      },
    });
  }

  const setMode = (m) => { mode = m; localStorage.setItem('tk_mode', m); render(); refresh(); };

  const render = () => {
    el.innerHTML = `
      ${pageHead(t('tk.title'), t('tk.subtitle'),
        `${canReport ? `<button class="btn btn-outline" id="tk-report"><span class="ms">insights</span> ${esc(t('tk.report'))}</button>` : ''}`
        + `${canConfigure ? `<button class="btn btn-outline" id="tk-templates"><span class="ms">assignment</span> ${esc(t('rt.title'))}</button>` : ''}`
        + `${canConfigure ? `<button class="btn btn-outline" id="tk-sla"><span class="ms">schedule</span> ${esc(t('tk.slaSettings'))}</button>` : ''}`
        + `${canConfigure ? `<button class="btn btn-outline" id="tk-workflow"><span class="ms">account_tree</span> ${esc(t('wf.title'))}</button>` : ''}`
        + `${canCreate ? `<button class="btn btn-primary" id="tk-new"><span class="ms">add</span> ${esc(t('tk.new'))}</button>` : ''}`)}
      <div id="tk-stats">${statsHtml(stats0)}</div>
      <div class="card card-pad" style="margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div class="seg" role="tablist">
          <button class="seg-btn ${mode === 'list' ? 'active' : ''}" id="tk-mode-list"><span class="ms ms-sm">list</span> ${esc(t('tk.viewList'))}</button>
          <button class="seg-btn ${mode === 'board' ? 'active' : ''}" id="tk-mode-board"><span class="ms ms-sm">view_kanban</span> ${esc(t('tk.viewBoard'))}</button>
        </div>
        <input type="search" id="tk-f-search" class="ops-select" placeholder="${esc(t('tk.searchTickets'))}" style="min-width:200px" value="${esc(searchTerm)}">
        <select id="tk-f-status" class="ops-select" ${mode === 'board' ? 'style="display:none"' : ''}>
          <option value="open">${esc(t('tk.filterOpen'))}</option>
          <option value="">${esc(t('tk.filterAll'))}</option>
          ${TK_STATUS.map((s) => `<option value="${s}">${esc(tkStatusLabel(s))}</option>`).join('')}
        </select>
        <select id="tk-f-type" class="ops-select">
          <option value="">${esc(t('tk.allTypes'))}</option>
          <option value="incident">${esc(tkTypeLabel('incident'))}</option>
          <option value="request">${esc(tkTypeLabel('request'))}</option>
        </select>
        <select id="tk-f-priority" class="ops-select">
          <option value="">${esc(t('tk.allPriorities'))}</option>
          ${TK_PRIORITY.map((p) => `<option value="${p}">${esc(tkPriorityLabel(p))}</option>`).join('')}
        </select>
        ${catList.length ? `<select id="tk-f-category" class="ops-select">
          <option value="">${esc(t('tk.allCategories'))}</option>
          ${catList.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>` : ''}
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px">
          <input type="checkbox" id="tk-f-mine"> ${esc(t('tk.mineOnly'))}</label>
        <span id="tk-views-wrap"></span>
        <button class="btn btn-outline btn-sm" id="tk-csv" style="margin-left:auto"><span class="ms ms-sm">download</span> ${esc(t('tk.exportCsv'))}</button>
      </div>
      <div id="tk-bulk" class="tk-bulk" style="display:none"></div>
      <div id="tk-content"></div>`;

    const nb = $('#tk-new', el);
    if (nb) nb.addEventListener('click', openCreate);
    const sb = $('#tk-sla', el);
    if (sb) sb.addEventListener('click', openSlaEditor);
    const wb = $('#tk-workflow', el);
    if (wb) wb.addEventListener('click', openWorkflowEditor);
    const tb = $('#tk-templates', el);
    if (tb) tb.addEventListener('click', openRequestTemplates);
    $('#tk-report', el)?.addEventListener('click', openReport);
    $('#tk-mode-list', el)?.addEventListener('click', () => { if (mode !== 'list') setMode('list'); });
    $('#tk-mode-board', el)?.addEventListener('click', () => { if (mode !== 'board') setMode('board'); });
    const reload = () => refresh();
    $('#tk-f-status', el)?.addEventListener('change', reload);
    $('#tk-f-type', el)?.addEventListener('change', reload);
    $('#tk-f-priority', el)?.addEventListener('change', reload);
    $('#tk-f-category', el)?.addEventListener('change', reload);
    $('#tk-f-mine', el)?.addEventListener('change', reload);
    $('#tk-f-search', el)?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refresh, 300);
    });
    $('#tk-csv', el)?.addEventListener('click', exportCsv);
    renderViewsSelect();
  };

  // Shared query string from the active filters (mode-aware).
  function filterQs() {
    const qs = new URLSearchParams();
    const type = $('#tk-f-type', el)?.value;
    const priority = $('#tk-f-priority', el)?.value;
    const category = $('#tk-f-category', el)?.value;
    const mine = $('#tk-f-mine', el)?.checked;
    if (searchTerm.trim()) qs.set('search', searchTerm.trim());
    if (type) qs.set('type', type);
    if (priority) qs.set('priority', priority);
    if (category) qs.set('category', category);
    if (mine && Auth.profile) qs.set('assignee', Auth.profile.uid);
    if (mode === 'board') {
      qs.set('limit', '500');
    } else {
      const status = $('#tk-f-status', el)?.value;
      if (status === 'open') qs.set('open', '1'); else if (status) qs.set('status', status);
      qs.set('sort', sortKey); qs.set('order', sortOrder);
    }
    return qs;
  }

  async function exportCsv() {
    const qs = filterQs();
    qs.set('limit', '5000');
    qs.delete('open'); // export everything matching, not just open
    const list = await api('/tickets?' + qs.toString()).catch(() => []);
    const arr = Array.isArray(list) ? list : [];
    const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const headers = ['Number', 'Type', 'Subject', 'Status', 'Priority', 'Category', 'Requester', 'Assignee', 'Created', 'Resolve due', 'SLA'];
    const rows = arr.map((tk) => [
      tk.number, tkTypeLabel(tk.type), tk.subject, tkStatusLabel(tk.status), tkPriorityLabel(tk.priority),
      tk.category || '', tk.requesterName || '', tk.assigneeName || '',
      String(tk.createdAt || '').slice(0, 16).replace('T', ' '),
      tk.sla && tk.sla.resolve && tk.sla.resolve.dueAt ? String(tk.sla.resolve.dueAt).slice(0, 16).replace('T', ' ') : '',
      tk.sla && tk.sla.resolve ? tkSlaLabel(tk.sla.resolve) : '',
    ].map(cell).join(','));
    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n'); // BOM for Excel/Turkish chars
    downloadTextFile(`tickets-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast(t('tk.exported').replace('{n}', arr.length), 'success');
  }

  async function refresh() {
    const list = await api('/tickets?' + filterQs().toString()).catch(() => []);
    refreshStats();
    const arr = Array.isArray(list) ? list : [];
    if (mode === 'board') paintBoard(arr); else paintList(arr);
  }

  async function openRequestTemplates() {
    const [tpls, cfg] = await Promise.all([
      api('/request-templates').catch(() => []),
      api('/approvals/config').catch(() => ({ enabled: false })),
    ]);
    const loaded = Array.isArray(tpls) ? tpls : [];
    // Flatten a stored chain (which may carry legacy parallel groups) into an
    // ordered list of single-approver step tokens for the drag-reorder builder.
    const parseChain = (levels) => {
      const out = [];
      (levels || []).forEach((el) => {
        if (el && typeof el === 'object' && Array.isArray(el.levels)) el.levels.forEach((x) => out.push(String(x)));
        else if (el != null) out.push(String(el));
      });
      return out;
    };
    const STEP_ICON = { manager: 'person', manager2: 'supervisor_account', department: 'apartment' };
    const stepMeta = (tok) => {
      if (tok === 'role:it') return { icon: 'groups', label: t('rt.itTeam') };
      if (tok.startsWith('emp:')) return { icon: 'account_balance', label: t('rt.specificPerson') };
      return { icon: STEP_ICON[tok] || 'person', label: t('rt.' + tok) || tok };
    };
    // One draggable step row. emp: steps carry an inline person picker + threshold.
    const stepRowHtml = (tok, threshold) => {
      const m = stepMeta(tok); const isEmp = tok.startsWith('emp:');
      return `<div class="rt-step" draggable="true" data-token="${esc(tok)}">
        <span class="rt-drag ms" title="${esc(t('rt.dragHint'))}">drag_indicator</span>
        <span class="rt-step-no"></span>
        <span class="rt-step-ic" style="background:${isEmp ? 'var(--primary)' : 'var(--surface)'};color:${isEmp ? '#fff' : 'var(--primary)'}"><span class="ms ms-sm">${m.icon}</span></span>
        ${isEmp
          ? `<div class="rt-emp-host" data-empid="${esc(tok.slice(4))}"></div>
             <input class="rt-emp-amt" type="number" min="0" step="0.01" value="${esc(threshold != null ? threshold : '')}" placeholder="${esc(t('rt.thresholdPh'))}" title="${esc(t('rt.amountThresholdHint'))}">`
          : `<span class="rt-step-label">${esc(m.label)}</span>`}
        <button class="rt-step-del" type="button" title="${esc(t('common.remove') || 'Remove')}"><span class="ms ms-sm">close</span></button>
      </div>`;
    };
    const rowHtml = (tp) => {
      const chain = parseChain((tp && tp.approvalLevels) || []);
      const threshold = (tp && tp.amountThreshold != null) ? tp.amountThreshold : '';
      return `<div class="rt-card" data-id="${esc((tp && tp.id) || '')}">
        <div class="rt-card-head">
          <div class="rt-field rt-grow"><label class="rt-lbl">${esc(t('rt.name'))}</label>
            <input class="rt-name" placeholder="${esc(t('rt.namePh'))}" value="${esc((tp && tp.name) || '')}"></div>
          <div class="rt-field rt-cat-field"><label class="rt-lbl">${esc(t('tk.category'))}</label>
            <input class="rt-cat" placeholder="${esc(t('rt.catPh'))}" value="${esc((tp && tp.category) || '')}"></div>
          <label class="rt-toggle"><input type="checkbox" class="rt-en" ${(tp && tp.enabled !== false) ? 'checked' : ''}> ${esc(t('rt.enabled'))}</label>
          <button class="btn btn-ghost btn-sm rt-del" type="button" title="${esc(t('common.remove') || 'Remove')}"><span class="ms">delete</span></button>
        </div>
        <div class="rt-field rt-desc-field"><label class="rt-lbl">${esc(t('rt.description'))} <span class="cell-sub">${esc(t('rt.descHint'))}</span></label>
          <input class="rt-desc" maxlength="2000" placeholder="${esc(t('rt.descPh'))}" value="${esc((tp && tp.description) || '')}"></div>
        <div class="rt-section">
          <div class="rt-sec-head"><span class="rt-lbl">${esc(t('rt.chainLabel'))}</span>
            <span class="rt-sec-hint">${esc(t('rt.dragHint'))}</span></div>
          <div class="rt-chain">${chain.map((tok) => stepRowHtml(tok, threshold)).join('')}</div>
          <p class="rt-chain-empty${chain.length ? ' is-hidden' : ''}">${esc(t('rt.chainEmpty'))}</p>
          <button class="btn btn-outline btn-sm rt-addstep" type="button"><span class="ms ms-sm">add</span> ${esc(t('rt.addStep'))}</button>
        </div>
      </div>`;
    };
    openModal({
      title: t('rt.title'),
      wide: true,
      body: `<div class="rt-config">
          <label class="rt-config-main">
            <input type="checkbox" id="rt-approvals-on" ${cfg.enabled ? 'checked' : ''}>
            <strong>${esc(t('rt.enableApprovals'))}</strong></label>
          <div class="rt-config-timers">
            <label class="rt-config-rem" title="${esc(t('rt.reminderHint'))}">
              <span class="ms ms-sm" style="vertical-align:-3px">notifications_active</span> ${esc(t('rt.reminderDays'))}
              <input type="number" id="rt-reminder-days" min="0" max="90" step="1" value="${esc(cfg.reminderDays || 0)}"></label>
            <label class="rt-config-rem" title="${esc(t('rt.escalateHint'))}">
              <span class="ms ms-sm" style="vertical-align:-3px">trending_up</span> ${esc(t('rt.escalateDays'))}
              <input type="number" id="rt-escalate-days" min="0" max="90" step="1" value="${esc(cfg.escalateDays || 0)}"></label>
          </div>
        </div>
        <p class="cell-sub rt-hint">${esc(t('rt.enableApprovalsSub'))} ${esc(t('rt.hint'))}</p>
        <div id="rt-list">${(loaded.length ? loaded : [null]).map(rowHtml).join('')}</div>
        <button class="btn btn-outline btn-sm rt-add-btn" id="rt-add" type="button"><span class="ms ms-sm">add</span> ${esc(t('rt.add'))}</button>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="rt-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        const listEl = $('#rt-list', ov);
        const wireDel = () => listEl.querySelectorAll('.rt-del').forEach((b) => { b.onclick = () => b.closest('.rt-card').remove(); });
        // Number every chain's steps (1,2,3…) after add / remove / reorder.
        const renumber = (scope) => {
          const cards = scope ? [scope] : [...listEl.querySelectorAll('.rt-card')];
          cards.forEach((c) => {
            const steps = [...c.querySelectorAll('.rt-chain .rt-step')];
            steps.forEach((s, i) => { const n = s.querySelector('.rt-step-no'); if (n) n.textContent = i + 1; });
            const empty = c.querySelector('.rt-chain-empty'); if (empty) empty.classList.toggle('is-hidden', steps.length > 0);
          });
        };
        // Mount a person picker on any emp step that doesn't have one yet.
        const mountPickers = () => listEl.querySelectorAll('.rt-emp-host').forEach((host) => {
          if (host._picker) return;
          host._picker = mountEmployeeSearchField(host, { name: 'rt-emp', placeholder: t('rt.finalApproverPh') });
          const empId = host.dataset.empid || '';
          if (empId) api('/employees/' + encodeURIComponent(empId))
            .then((e) => { if (e) host._picker.setSelected({ id: e.id, fullName: e.fullName, department: e.department, email: e.email }); })
            .catch(() => {});
        });
        // Drag-reorder: which step should the dragged one go before, given cursor Y.
        const getAfter = (chain, y) => {
          let closest = { offset: -Infinity, el: null };
          chain.querySelectorAll('.rt-step:not(.rt-dragging)').forEach((el) => {
            const b = el.getBoundingClientRect(); const off = y - b.top - b.height / 2;
            if (off < 0 && off > closest.offset) closest = { offset: off, el };
          });
          return closest.el;
        };
        // Options shown in the "add step" picker dialog.
        const STEP_OPTS = [
          { v: 'manager', icon: 'person', label: t('rt.manager') },
          { v: 'manager2', icon: 'supervisor_account', label: t('rt.manager2') },
          { v: 'department', icon: 'apartment', label: t('rt.department') },
          { v: 'role:it', icon: 'groups', label: t('rt.itTeam') },
          { v: 'emp', icon: 'account_balance', label: t('rt.specificPerson') },
        ];
        const wireCard = (card) => {
          const chain = card.querySelector('.rt-chain');
          const addBtn = card.querySelector('.rt-addstep');
          // Clicking "Add step" opens a small stacked dialog — robust, no dropdown
          // to dismiss. Picking an option appends the step and closes the dialog.
          addBtn.addEventListener('click', () => {
            openModal({
              title: t('rt.addStep'),
              stack: true,
              body: `<div class="rt-addgrid">${STEP_OPTS.map((o) => `<button type="button" class="rt-addopt" data-add="${esc(o.v)}"><span class="rt-addopt-ic"><span class="ms">${o.icon}</span></span><span>${esc(o.label)}</span></button>`).join('')}</div>`,
              foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>`,
              onMount(mov) {
                mov.querySelectorAll('.rt-addopt').forEach((b) => b.addEventListener('click', () => {
                  const tok = b.dataset.add === 'emp' ? 'emp:' : b.dataset.add;
                  if (tok !== 'emp:' && [...chain.querySelectorAll('.rt-step')].some((s) => s.dataset.token === tok)) { closeModal(); return; }
                  chain.insertAdjacentHTML('beforeend', stepRowHtml(tok, ''));
                  mountPickers(); renumber(card); closeModal();
                }));
              },
            });
          });
          chain.addEventListener('click', (e) => { const d = e.target.closest('.rt-step-del'); if (!d) return; d.closest('.rt-step').remove(); renumber(card); });
          chain.addEventListener('dragstart', (e) => { const s = e.target.closest('.rt-step'); if (!s) return; s.classList.add('rt-dragging'); e.dataTransfer.effectAllowed = 'move'; });
          chain.addEventListener('dragend', (e) => { const s = e.target.closest('.rt-step'); if (s) s.classList.remove('rt-dragging'); renumber(card); });
          chain.addEventListener('dragover', (e) => { e.preventDefault(); const dragging = chain.querySelector('.rt-dragging'); if (!dragging) return; const after = getAfter(chain, e.clientY); if (after == null) chain.appendChild(dragging); else chain.insertBefore(dragging, after); });
        };
        [...listEl.querySelectorAll('.rt-card')].forEach(wireCard);
        wireDel(); mountPickers(); renumber();

        $('#rt-add', ov).addEventListener('click', () => {
          listEl.insertAdjacentHTML('beforeend', rowHtml(null));
          const card = listEl.lastElementChild; wireCard(card); wireDel(); mountPickers(); renumber(card);
        });
        $('#rt-save', ov).addEventListener('click', async () => {
          try {
            await api('/approvals/config', { method: 'PUT', body: { enabled: $('#rt-approvals-on', ov).checked, reminderDays: Number($('#rt-reminder-days', ov).value) || 0, escalateDays: Number($('#rt-escalate-days', ov).value) || 0 } });
            const rows = [...listEl.querySelectorAll('.rt-card')].map((r) => {
              // Steps in their on-screen (dragged) order → an ordered token chain.
              const steps = []; let amountThreshold = null;
              [...r.querySelectorAll('.rt-chain .rt-step')].forEach((s) => {
                const tok = s.dataset.token;
                if (tok && tok.startsWith('emp')) {
                  const host = s.querySelector('.rt-emp-host'); const empId = host && host._picker ? host._picker.getId() : null;
                  if (empId) {
                    steps.push('emp:' + empId);
                    const amtRaw = (s.querySelector('.rt-emp-amt').value || '').trim();
                    if (amountThreshold == null && amtRaw !== '' && Number(amtRaw) >= 0) amountThreshold = Number(amtRaw);
                  }
                } else if (tok) steps.push(tok);
              });
              return { id: r.dataset.id || null, name: r.querySelector('.rt-name').value.trim(), description: r.querySelector('.rt-desc').value.trim(), category: r.querySelector('.rt-cat').value.trim(), approvalLevels: steps, amountThreshold, enabled: r.querySelector('.rt-en').checked };
            });
            for (const orig of loaded) if (orig.id && !rows.find((x) => x.id === orig.id)) await api('/request-templates/' + orig.id, { method: 'DELETE' });
            for (const row of rows) {
              if (!row.name) continue;
              if (row.id) await api('/request-templates/' + row.id, { method: 'PATCH', body: row });
              else await api('/request-templates', { method: 'POST', body: row });
            }
            closeModal(); toast(t('tk.saved'), 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  function openReport() {
    const fmtH = (h) => (h == null ? '—' : (h >= 24 ? (h / 24).toFixed(1) + ' ' + t('tk.daysShort') : h + ' ' + t('tk.hoursShort')));
    const pctTxt = (p) => (p == null ? '—' : '%' + p);
    const metric = (label, val, sub) => `<div class="card card-pad metric">
      <div class="metric-top"><h3 class="card-title">${esc(label)}</h3></div>
      <div class="metric-value">${esc(String(val))}</div>${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}</div>`;
    const PRIO_COLOR = { urgent: 'var(--rose-600,#e11d48)', high: 'var(--amber-600,#d97706)', medium: 'var(--primary)', low: 'var(--outline)' };
    // Grouped daily bar chart: opened (primary) vs resolved (emerald).
    const trendChart = (trend) => {
      if (!trend || !trend.length) return '';
      const max = Math.max(1, ...trend.map((d) => Math.max(d.opened, d.resolved)));
      const bw = 9; const gap = 5; const groupW = bw * 2 + 2; const pad = 8; const h = 130; const base = h - 18;
      const w = pad * 2 + trend.length * (groupW + gap);
      const bars = trend.map((d, i) => {
        const x = pad + i * (groupW + gap);
        const oh = Math.round(d.opened / max * (base - 6)); const rh = Math.round(d.resolved / max * (base - 6));
        const lbl = (i % Math.ceil(trend.length / 12) === 0) ? `<text x="${x + bw}" y="${h - 4}" font-size="9" fill="var(--on-surface-variant)" text-anchor="middle">${esc(d.date.slice(5))}</text>` : '';
        return `<rect x="${x}" y="${base - oh}" width="${bw}" height="${oh}" rx="2" fill="var(--primary)"><title>${esc(d.date)}: ${d.opened} ${esc(t('tk.reportOpened'))}</title></rect>`
          + `<rect x="${x + bw + 2}" y="${base - rh}" width="${bw}" height="${rh}" rx="2" fill="var(--emerald-600,#059669)"><title>${esc(d.date)}: ${d.resolved} ${esc(t('tk.reportResolved'))}</title></rect>${lbl}`;
      }).join('');
      return `<div class="tkr-legend"><span><i style="background:var(--primary)"></i> ${esc(t('tk.reportOpened'))}</span><span><i style="background:var(--emerald-600,#059669)"></i> ${esc(t('tk.reportResolved'))}</span></div>
        <div class="tkr-chart-scroll"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:none">${bars}<line x1="${pad}" y1="${base}" x2="${w - pad}" y2="${base}" stroke="var(--outline-variant)"/></svg></div>`;
    };
    const hBars = (items, labelFn, colorFn) => {
      const max = Math.max(1, ...items.map((x) => x.n));
      return `<div class="tkr-hbars">${items.map((x) => `<div class="tkr-hbar-row">
        <span class="tkr-hbar-label">${esc(labelFn(x))}</span>
        <div class="tkr-hbar"><i style="width:${Math.round(x.n / max * 100)}%;background:${colorFn ? colorFn(x) : 'var(--primary)'}"></i></div>
        <span class="cell-sub tkr-hbar-n">${x.n}</span></div>`).join('')}</div>`;
    };
    const renderReport = (rep) => {
      const maxN = Math.max(1, ...rep.csat.distribution.map((d) => d.n));
      return `
        <h3 class="tkr-h">${esc(t('tk.reportVolume'))}</h3>
        <div class="grid grid-4">
          ${metric(t('tk.reportOpened'), rep.volume.opened, `${rep.volume.openedIncidents} ${tkTypeLabel('incident')} · ${rep.volume.openedRequests} ${tkTypeLabel('request')}`)}
          ${metric(t('tk.reportResolved'), rep.volume.resolved)}
          ${metric(t('tk.reportClosed'), rep.volume.closed)}
          ${metric(t('tk.csat'), rep.csat.avg != null ? rep.csat.avg + ' / 5' : '—', `${rep.csat.count} ${t('tk.votes')}`)}
        </div>
        <h3 class="tkr-h">${esc(t('tk.reportTrend'))}</h3>
        ${trendChart(rep.trend)}
        <div class="grid grid-2" style="margin-top:16px">
          <div><h3 class="tkr-h" style="margin-top:0">${esc(t('tk.priorityCol'))}</h3>
            ${hBars(rep.byPriority || [], (x) => tkPriorityLabel(x.priority), (x) => PRIO_COLOR[x.priority] || 'var(--primary)')}</div>
          <div><h3 class="tkr-h" style="margin-top:0">${esc(t('tk.category'))}</h3>
            ${(rep.byCategory && rep.byCategory.length) ? hBars(rep.byCategory, (x) => x.category) : `<p class="cell-sub">${esc(t('tk.none'))}</p>`}</div>
        </div>
        <h3 class="tkr-h">${esc(t('tk.slaCol'))}</h3>
        <div class="grid grid-4">
          ${metric(t('tk.sla.response'), pctTxt(rep.sla.responseCompliance), `${t('tk.reportAvg')} ${fmtH(rep.sla.avgResponseHours)}`)}
          ${metric(t('tk.sla.resolution'), pctTxt(rep.sla.resolutionCompliance), `${t('tk.reportAvg')} ${fmtH(rep.sla.avgResolutionHours)}`)}
        </div>
        <h3 class="tkr-h">${esc(t('tk.csat'))}</h3>
        <div class="tkr-csat">${rep.csat.distribution.slice().reverse().map((d) => `<div class="tkr-csat-row">
          <span class="tkr-csat-star">${d.rating}★</span><div class="tkr-bar"><i style="width:${Math.round(d.n / maxN * 100)}%"></i></div>
          <span class="cell-sub">${d.n}</span></div>`).join('')}</div>
        <h3 class="tkr-h">${esc(t('tk.reportByAgent'))} <button class="btn btn-outline btn-sm" id="tkr-csv" style="float:right"><span class="ms ms-sm">download</span> CSV</button></h3>
        <p class="cell-sub" style="margin:-4px 0 8px">${esc(t('tk.reportAgentHint'))}</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(t('tk.assignee'))}</th><th>${esc(t('tk.reportResolved'))}</th><th>${esc(t('tk.reportClosed'))}</th><th>${esc(t('tk.reportAvgRes'))}</th><th>${esc(t('tk.slaCompliance'))}</th><th>${esc(t('tk.csat'))}</th></tr></thead>
          <tbody>${rep.agents.length ? rep.agents.map((a) => `<tr data-agent="${esc(a.userId || '')}" style="cursor:pointer">
            <td class="cell-title">${esc(a.agent)} <span class="ms ms-sm" style="vertical-align:-3px;color:var(--on-surface-variant)">chevron_right</span></td><td>${a.resolved}</td><td>${a.closed}</td>
            <td>${fmtH(a.avgResolutionHours)}</td><td>${pctTxt(a.slaCompliance)}</td><td>${a.csatAvg != null ? a.csatAvg + ' / 5' : '—'}</td></tr>`).join('')
            : `<tr><td colspan="6" class="table-empty">${esc(t('tk.none'))}</td></tr>`}</tbody>
        </table></div>`;
    };
    const exportAgents = (rep) => {
      const rows = [['Agent', 'Resolved', 'Closed', 'AvgResolutionHours', 'SLACompliance%', 'CSATAvg']];
      rep.agents.forEach((a) => rows.push([a.agent, a.resolved, a.closed, a.avgResolutionHours ?? '', a.slaCompliance ?? '', a.csatAvg ?? '']));
      const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      downloadTextFile(`ticket-report-${rep.from}_${rep.to}.csv`, csv);
    };
    const openAgentDetail = async (userId, from, to) => {
      const data = await api(`/tickets/report/agent?userId=${encodeURIComponent(userId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).catch(() => null);
      if (!data) { toast(t('common.error') || 'Error', 'error'); return; }
      const prPill = (p) => pill(TK_PRIORITY_PILL[p], tkPriorityLabel(p));
      const resolvedRows = data.resolved.map((r) => `<tr data-open="${esc(r.id || '')}" style="cursor:pointer">
          <td class="mono">${esc(r.number)}</td><td><div class="cell-title">${esc(r.subject)}</div>${r.category ? `<div class="cell-sub">${esc(r.category)}</div>` : ''}</td>
          <td>${prPill(r.priority)}</td><td>${fmtH(r.resolutionHours)}</td>
          <td>${r.slaMet == null ? '—' : (r.slaMet ? `<span class="pill pill-emerald">${esc(t('tk.sla.met'))}</span>` : `<span class="pill pill-rose">${esc(t('tk.sla.breached'))}</span>`)}</td>
          <td>${r.csatRating ? '★'.repeat(r.csatRating) : '—'}</td>
          <td class="cell-sub">${esc(String(r.resolvedAt || '').slice(0, 10))}</td></tr>`).join('');
      const openRows = data.open.map((r) => `<tr data-open="${esc(r.id || '')}" style="cursor:pointer">
          <td class="mono">${esc(r.number)}</td><td><div class="cell-title">${esc(r.subject)}</div></td>
          <td>${prPill(r.priority)}</td><td>${pill(TK_STATUS_PILL[r.status], tkStatusLabel(r.status))}</td>
          <td class="cell-sub">${esc(String(r.createdAt || '').slice(0, 10))}</td></tr>`).join('');
      openModal({
        title: `${data.agent} · ${data.from} → ${data.to}`,
        xwide: true,
        stack: true,
        body: `
          <h3 class="tkr-h" style="margin-top:0">${esc(t('tk.reportResolved'))} <span class="pill pill-slate">${data.resolved.length}</span></h3>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>#</th><th>${esc(t('tk.subject'))}</th><th>${esc(t('tk.priorityCol'))}</th><th>${esc(t('tk.reportAvgRes'))}</th><th>SLA</th><th>${esc(t('tk.csat'))}</th><th>${esc(t('tk.reportResolved'))}</th></tr></thead>
            <tbody>${resolvedRows || `<tr><td colspan="7" class="table-empty">${esc(t('tk.none'))}</td></tr>`}</tbody></table></div>
          <h3 class="tkr-h">${esc(t('tk.reportAgentOpen'))} <span class="pill pill-amber">${data.open.length}</span></h3>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>#</th><th>${esc(t('tk.subject'))}</th><th>${esc(t('tk.priorityCol'))}</th><th>${esc(t('tk.statusCol'))}</th><th>${esc(t('tk.createdCol'))}</th></tr></thead>
            <tbody>${openRows || `<tr><td colspan="5" class="table-empty">${esc(t('tk.none'))}</td></tr>`}</tbody></table></div>`,
        foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
        onMount(ov) {
          ov.querySelectorAll('tr[data-open]').forEach((tr) => tr.addEventListener('click', () => {
            if (tr.dataset.open) openTicket(tr.dataset.open);
          }));
        },
      });
    };
    const load = async (ov) => {
      const from = $('#tkr-from', ov).value; const to = $('#tkr-to', ov).value;
      const box = $('#tkr-body', ov);
      box.innerHTML = `<p class="cell-sub">${esc(t('common.loading') || '…')}</p>`;
      const rep = await api(`/tickets/report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).catch(() => null);
      if (!rep) { box.innerHTML = `<p class="cell-sub">—</p>`; return; }
      box.innerHTML = renderReport(rep);
      $('#tkr-csv', ov)?.addEventListener('click', () => exportAgents(rep));
      box.querySelectorAll('tr[data-agent]').forEach((tr) => tr.addEventListener('click', () => {
        if (tr.dataset.agent) openAgentDetail(tr.dataset.agent, rep.from, rep.to);
      }));
    };
    openModal({
      title: t('tk.report'),
      xwide: true,
      body: `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px">
          <div class="form-field"><label>${esc(t('tk.reportFrom'))}</label><input type="date" id="tkr-from"></div>
          <div class="form-field"><label>${esc(t('tk.reportTo'))}</label><input type="date" id="tkr-to"></div>
          <button class="btn btn-outline btn-sm" id="tkr-apply">${esc(t('common.apply') || 'Apply')}</button>
        </div>
        <div id="tkr-body"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        $('#tkr-from', ov).value = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        $('#tkr-to', ov).value = new Date().toISOString().slice(0, 10);
        $('#tkr-apply', ov).addEventListener('click', () => load(ov));
        load(ov);
      },
    });
  }

  async function openSlaEditor() {
    const cfg = await api('/tickets/sla').catch(() => null);
    if (!cfg) { toast(t('common.error') || 'Error', 'error'); return; }
    const row = (p) => `<tr>
      <td>${pill(TK_PRIORITY_PILL[p], tkPriorityLabel(p))}</td>
      <td><input type="number" min="1" max="100000" id="sla-${p}-resp" value="${esc(cfg[p].responseMins)}" style="width:110px"></td>
      <td><input type="number" min="1" max="100000" id="sla-${p}-res" value="${esc(cfg[p].resolveMins)}" style="width:110px"></td>
    </tr>`;
    openModal({
      title: t('tk.slaSettings'),
      body: `<p class="cell-sub" style="margin:0 0 12px">${esc(t('tk.slaHint'))}</p>
        <table class="data"><thead><tr>
          <th>${esc(t('tk.priorityCol'))}</th>
          <th>${esc(t('tk.sla.response'))} <span class="cell-sub">(${esc(t('tk.mins'))})</span></th>
          <th>${esc(t('tk.sla.resolution'))} <span class="cell-sub">(${esc(t('tk.mins'))})</span></th>
        </tr></thead><tbody>${TK_PRIORITY.map(row).join('')}</tbody></table>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="sla-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        $('#sla-save', ov).addEventListener('click', async () => {
          const body = {};
          TK_PRIORITY.forEach((p) => { body[p] = {
            responseMins: Number($(`#sla-${p}-resp`, ov).value),
            resolveMins: Number($(`#sla-${p}-res`, ov).value),
          }; });
          try { await api('/tickets/sla', { method: 'PUT', body }); closeModal(); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  // --- Workflow (status-transition) editor --------------------------------
  // Jira-like: a live directed graph of the allowed status moves + an editable
  // from→to matrix. Saves to app_settings via PUT /tickets/workflow.
  const WF_COLORS = {
    new: '#64748b', open: '#2563eb', in_progress: '#d97706', pending: '#7c3aed',
    resolved: '#059669', closed: '#475569', cancelled: '#e11d48',
  };
  const WF_TERMINAL = new Set(['resolved', 'closed', 'cancelled']);

  function wfGraph(statuses, trans) {
    const nodeW = 116, nodeH = 42, gap = 46, slot = nodeW + gap;
    const marginX = 24, centerY = 200, height = 400;
    const width = marginX * 2 + (statuses.length - 1) * slot + nodeW;
    const cx = (i) => marginX + i * slot + nodeW / 2;
    const idx = {}; statuses.forEach((s, i) => { idx[s] = i; });
    const arcs = [];
    statuses.forEach((from) => (trans[from] || []).forEach((to) => {
      const i = idx[from], j = idx[to];
      if (i == null || j == null || i === j) return;
      const span = Math.abs(j - i);
      const xi = cx(i), xj = cx(j), mx = (xi + xj) / 2;
      const up = j > i; // forward arcs bow up, backward bow down
      const y0 = up ? centerY - nodeH / 2 : centerY + nodeH / 2;
      const cpY = up ? y0 - (34 + span * 20) : y0 + (34 + span * 20);
      arcs.push(`<path d="M ${xi} ${y0} Q ${mx} ${cpY} ${xj} ${y0}" fill="none"
        stroke="${WF_COLORS[to] || '#94a3b8'}" stroke-width="2" opacity="0.75"
        marker-end="url(#wf-arrow)"></path>`);
    }));
    const nodes = statuses.map((s, i) => {
      const x = marginX + i * slot, y = centerY - nodeH / 2, c = WF_COLORS[s] || '#64748b';
      return `<g>
        <rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="10"
          fill="${c}22" stroke="${c}" stroke-width="1.5"></rect>
        <circle cx="${x + 16}" cy="${centerY}" r="5" fill="${c}"></circle>
        <text x="${x + 30}" y="${centerY + 4}" font-size="12.5" font-weight="600"
          fill="var(--on-surface)">${esc(tkStatusLabel(s))}</text>
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:none">
      <defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path></marker></defs>
      ${arcs.join('')}${nodes}</svg>`;
  }

  async function openWorkflowEditor() {
    const wf = await api('/tickets/workflow').catch(() => null);
    if (!wf) { toast(t('common.error') || 'Error', 'error'); return; }
    const statuses = wf.statuses || TK_STATUS;
    // Mutable working copy: { from: Set(to) }.
    const state = {}; statuses.forEach((s) => { state[s] = new Set(wf.transitions[s] || []); });

    const cell = (from, to) => {
      if (from === to) return '<td class="wf-cell wf-self">·</td>';
      const on = state[from].has(to);
      return `<td class="wf-cell"><label class="wf-chk"><input type="checkbox" data-from="${from}" data-to="${to}" ${on ? 'checked' : ''}><span></span></label></td>`;
    };
    const matrix = `<table class="wf-matrix"><thead><tr>
        <th class="wf-corner">${esc(t('wf.fromTo'))}</th>
        ${statuses.map((s) => `<th><span class="wf-hdr" style="color:${WF_COLORS[s]}">${esc(tkStatusLabel(s))}</span></th>`).join('')}
      </tr></thead><tbody>
        ${statuses.map((from) => `<tr>
          <th class="wf-row-h"><span class="wf-hdr" style="color:${WF_COLORS[from]}">${esc(tkStatusLabel(from))}</span>${WF_TERMINAL.has(from) ? '' : ' <span class="wf-req" title="' + esc(t('wf.needsExit')) + '">*</span>'}</th>
          ${statuses.map((to) => cell(from, to)).join('')}
        </tr>`).join('')}
      </tbody></table>`;

    openModal({
      title: t('wf.title'),
      wide: true,
      body: `<p class="cell-sub" style="margin:0 0 12px">${esc(t('wf.hint'))}</p>
        <div class="wf-graph-scroll"><div id="wf-graph">${wfGraph(statuses, wf.transitions)}</div></div>
        <p class="cell-sub" style="margin:14px 0 6px">${esc(t('wf.matrixHint'))}</p>
        <div style="overflow-x:auto">${matrix}</div>
        <p class="cell-sub" style="margin:10px 0 0"><span class="wf-req">*</span> ${esc(t('wf.needsExit'))}</p>
        <div class="wf-auto">
          <div class="wf-auto-head"><span class="ms">bolt</span> ${esc(t('wf.autoTitle'))}</div>
          <label class="wf-auto-row">
            <span>${esc(t('wf.autoClosePre'))}</span>
            <input type="number" id="wf-autoclose" min="0" max="365" step="1" value="${esc(wf.autoCloseResolvedDays || 0)}">
            <span>${esc(t('wf.autoClosePost'))}</span>
          </label>
          <p class="cell-sub" style="margin:6px 0 0">${esc(t('wf.autoCloseHint'))}</p>
        </div>`,
      foot: `<button class="btn btn-ghost" id="wf-reset" style="margin-right:auto">${esc(t('wf.reset'))}</button>
             <button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="wf-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        const toObj = () => { const o = {}; statuses.forEach((s) => { o[s] = [...state[s]]; }); return o; };
        const redraw = () => { $('#wf-graph', ov).innerHTML = wfGraph(statuses, toObj()); };
        ov.querySelectorAll('.wf-matrix input[type=checkbox]').forEach((c) => c.addEventListener('change', (e) => {
          const { from, to } = e.target.dataset;
          if (e.target.checked) state[from].add(to); else state[from].delete(to);
          redraw();
        }));
        $('#wf-save', ov).addEventListener('click', async () => {
          const autoCloseResolvedDays = Math.max(0, Math.min(365, Number($('#wf-autoclose', ov).value) || 0));
          try { await api('/tickets/workflow', { method: 'PUT', body: { transitions: toObj(), autoCloseResolvedDays } });
            closeModal(); toast(t('tk.saved'), 'success'); }
          catch (err) { toast(err.message, 'error'); }
        });
        // Reset repopulates the matrix to the built-in defaults locally; nothing is
        // persisted until Save, so Cancel still discards it.
        $('#wf-reset', ov).addEventListener('click', () => {
          const def = wf.defaults || {};
          statuses.forEach((s) => { state[s] = new Set(def[s] || []); });
          ov.querySelectorAll('.wf-matrix input[type=checkbox]').forEach((c) => {
            c.checked = state[c.dataset.from].has(c.dataset.to);
          });
          redraw();
          toast(t('wf.resetDone'), 'info');
        });
      },
    });
  }

  function openCannedEditor() {
    const rowHtml = (c) => `<div class="rt-card tk-canned-card">
      <div class="rt-card-head">
        <div class="rt-field rt-grow"><label class="rt-lbl">${esc(t('tk.cannedTitle'))}</label>
          <input class="tk-cn-title" maxlength="120" value="${esc((c && c.title) || '')}" placeholder="${esc(t('tk.cannedTitlePh'))}"></div>
        <button class="btn btn-ghost btn-sm tk-cn-del" type="button" title="${esc(t('common.remove') || 'Remove')}"><span class="ms">delete</span></button>
      </div>
      <div class="rt-field" style="margin-top:10px"><label class="rt-lbl">${esc(t('tk.cannedBody'))}</label>
        <textarea class="tk-cn-body" rows="3" maxlength="4000" placeholder="${esc(t('tk.cannedBodyPh'))}">${esc((c && c.body) || '')}</textarea></div>
    </div>`;
    openModal({
      title: t('tk.cannedManage'),
      wide: true,
      stack: true, // sit on top of the ticket detail so saving doesn't close it
      body: `<p class="cell-sub" style="margin:0 0 14px">${esc(t('tk.cannedHint'))}</p>
        <div id="tk-cn-list">${(canned.length ? canned : [{ title: '', body: '' }]).map(rowHtml).join('')}</div>
        <button class="btn btn-outline btn-sm rt-add-btn" id="tk-cn-add" type="button"><span class="ms ms-sm">add</span> ${esc(t('tk.cannedAdd'))}</button>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="tk-cn-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        const list = $('#tk-cn-list', ov);
        const wireDel = () => list.querySelectorAll('.tk-cn-del').forEach((b) => { b.onclick = () => b.closest('.tk-canned-card').remove(); });
        wireDel();
        $('#tk-cn-add', ov).addEventListener('click', () => { list.insertAdjacentHTML('beforeend', rowHtml()); wireDel(); });
        $('#tk-cn-save', ov).addEventListener('click', async () => {
          const items = [...list.querySelectorAll('.tk-canned-card')]
            .map((r) => ({ title: r.querySelector('.tk-cn-title').value.trim(), body: r.querySelector('.tk-cn-body').value.trim() }))
            .filter((x) => x.title && x.body);
          try {
            const saved = await api('/tickets/canned', { method: 'PUT', body: { items } });
            canned = Array.isArray(saved) ? saved : items;
            closeModal(); toast(t('tk.saved'), 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  function openCreate() {
    openModal({
      title: t('tk.new'),
      body: `<div class="tkc">
        <section class="tkd-sec">
          <h4 class="tkd-h">${esc(t('tk.secType'))}</h4>
          <div class="form-grid">
            ${templates.length ? `<div class="form-field full"><label>${esc(t('tk.template'))}</label>
              <select id="tk-c-tpl">
                <option value="">— ${esc(t('tk.noTemplate'))} —</option>
                ${templates.map((tp) => `<option value="${esc(tp.id)}">${esc(tp.name)}${tp.category ? ' · ' + esc(tp.category) : ''}</option>`).join('')}
              </select>
              <div class="cell-sub" id="tk-c-tpl-hint" style="margin-top:4px"></div></div>` : ''}
            <div class="form-field" id="tk-c-type-wrap"><label>${esc(t('tk.type'))}</label>
              <select id="tk-c-type"><option value="incident">${esc(tkTypeLabel('incident'))}</option><option value="request">${esc(tkTypeLabel('request'))}</option></select></div>
          </div>
        </section>
        <section class="tkd-sec">
          <h4 class="tkd-h">${esc(t('tk.secDetails'))}</h4>
          <div class="form-grid">
            <div class="form-field full"><label>${esc(t('tk.subject'))} *</label><input id="tk-c-subject" maxlength="300" placeholder="${esc(t('mtk.subjectPh'))}"></div>
            <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="tk-c-desc" rows="4" placeholder="${esc(t('mtk.descPh'))}"></textarea></div>
          </div>
        </section>
        <section class="tkd-sec">
          <h4 class="tkd-h">${esc(t('tk.secClassify'))}</h4>
          <div class="form-grid">
            <div class="form-field"><label>${esc(t('tk.impact'))}</label>
              <select id="tk-c-impact">${['low', 'medium', 'high'].map((l) => `<option value="${l}"${l === 'medium' ? ' selected' : ''}>${esc(tkPriorityLabel(l))}</option>`).join('')}</select></div>
            <div class="form-field"><label>${esc(t('tk.urgency'))}</label>
              <select id="tk-c-urgency">${['low', 'medium', 'high'].map((l) => `<option value="${l}"${l === 'medium' ? ' selected' : ''}>${esc(tkPriorityLabel(l))}</option>`).join('')}</select></div>
            <div class="form-field" id="tk-c-cat-wrap"><label>${esc(t('tk.category'))}</label>
              <select id="tk-c-cat"><option value="">${esc(t('tk.categoryNone'))}</option>${catOptions()}</select></div>
            <div class="form-field" id="tk-c-amount-wrap" style="display:none"><label>${esc(t('mtk.amount'))}</label>
              <input id="tk-c-amount" type="number" min="0" step="0.01" placeholder="0">
              <div class="cell-sub" id="tk-c-amount-hint" style="margin-top:4px"></div></div>
          </div>
        </section>
        <section class="tkd-sec">
          <h4 class="tkd-h">${esc(t('tk.secLinks'))}</h4>
          <div class="form-grid">
            <div class="form-field"><label>${esc(t('tk.requester'))}</label>
              <div id="tk-c-requester-host"></div></div>
            <div class="form-field"><label>${esc(t('tk.asset'))}</label>
              <div id="tk-c-asset-host"></div></div>
          </div>
        </section>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="tk-c-save">${esc(t('tk.create'))}</button>`,
      onMount(ov) {
        const reqPicker = mountCombobox($('#tk-c-requester-host', ov), { items: emps, labelOf: empLabel, subOf: (e) => e.email || '', placeholder: t('tk.searchPh') });
        const assetCPicker = mountCombobox($('#tk-c-asset-host', ov), { items: assets, labelOf: assetLabel, subOf: (x) => x.serialNo || x.status || '', placeholder: t('tk.searchPh') });
        // Template picker: choosing one turns this into a request (category +
        // approval chain come from the template); the type/category fields hide
        // and an amount field appears when the template gates on a threshold.
        const tplSel = $('#tk-c-tpl', ov);
        const chainStr = (levels) => (levels || []).map((el) => {
          if (el && typeof el === 'object') return '(' + (el.levels || []).map(lvlLabel).join(el.mode === 'all' ? ' & ' : ' / ') + ')';
          return lvlLabel(el);
        }).join(' → ');
        const onTpl = () => {
          const tp = templates.find((x) => x.id === (tplSel && tplSel.value));
          const typeWrap = $('#tk-c-type-wrap', ov); const catWrap = $('#tk-c-cat-wrap', ov);
          const amtWrap = $('#tk-c-amount-wrap', ov); const hint = $('#tk-c-tpl-hint', ov);
          if (tp) {
            typeWrap.style.display = 'none'; catWrap.style.display = 'none';
            const chain = Array.isArray(tp.approvalLevels) && tp.approvalLevels.length ? chainStr(tp.approvalLevels) : '';
            hint.innerHTML = `${tp.category ? `<span class="pill pill-slate">${esc(tp.category)}</span> ` : ''}${chain ? `<span class="ms ms-sm" style="vertical-align:-3px">how_to_reg</span> ${esc(t('mtk.approvalChain'))}: ${esc(chain)}` : ''}`;
            if (tp.amountThreshold != null) {
              amtWrap.style.display = '';
              $('#tk-c-amount-hint', ov).textContent = t('mtk.amountHint').replace('{n}', '₺' + Number(tp.amountThreshold).toLocaleString('tr-TR'));
            } else amtWrap.style.display = 'none';
          } else {
            typeWrap.style.display = ''; catWrap.style.display = ''; amtWrap.style.display = 'none'; hint.textContent = '';
          }
        };
        if (tplSel) { tplSel.addEventListener('change', onTpl); onTpl(); }
        $('#tk-c-save', ov).addEventListener('click', async () => {
          const tplId = tplSel && tplSel.value;
          const body = {
            subject: $('#tk-c-subject', ov).value.trim(),
            description: $('#tk-c-desc', ov).value.trim(),
            impact: $('#tk-c-impact', ov).value,
            urgency: $('#tk-c-urgency', ov).value,
            requesterEmployeeId: reqPicker.getId(),
            assetId: assetCPicker.getId(),
          };
          if (tplId) {
            body.templateId = tplId;
            const amt = Number($('#tk-c-amount', ov).value);
            if (Number.isFinite(amt) && amt >= 0 && $('#tk-c-amount-wrap', ov).style.display !== 'none') body.amount = amt;
          } else {
            body.type = $('#tk-c-type', ov).value;
            body.category = $('#tk-c-cat', ov).value.trim();
          }
          try {
            await api('/tickets', { method: 'POST', body });
            closeModal();
            toast(t('tk.created'), 'success');
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openTicket(id) {
    const tk = await api('/tickets/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!tk) return;
    // If this ticket is awaiting approval AND the signed-in user is the pending
    // approver, /me/approvals/pending returns a request whose resourceRef is the
    // ticket number — surface Approve / Reject right here so IT staff who are the
    // approver don't have to hunt for it in the portal.
    let myAppr = null;
    if (tk.approvalStatus === 'pending') {
      const pend = await api('/me/approvals/pending').catch(() => []);
      myAppr = (Array.isArray(pend) ? pend : []).find((a) => a.resourceRef === tk.number) || null;
    }
    const assignOpts = `<option value="">${esc(t('tk.unassigned'))}</option>` +
      staffList.map((u) => `<option value="${esc(u.uid)}"${u.uid === tk.assigneeUserId ? ' selected' : ''}>${esc(u.username)}</option>`).join('');
    const tkdSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB');
    const commentDocs = (docs) => (docs && docs.length) ? `<div class="tk-comment-docs">${docs.map((d) => `<a href="#" class="tk-cdoc" data-cdl="${esc(d.id)}"><span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span> <span class="tk-cdoc-name">${esc(d.filename)}</span> <span class="cell-sub">${esc(tkdSize(d.byteSize))}</span></a>`).join('')}</div>` : '';
    const comments = (tk.comments || []).map((c) => `
      <div class="tk-comment${c.internal ? ' tk-internal' : ''}">
        <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
          ${c.staffOnly ? `<span class="pill pill-slate"><span class="ms ms-sm" style="vertical-align:-2px">engineering</span> ${esc(t('tk.visStaff'))}</span>` : (c.internal ? `<span class="pill pill-amber"><span class="ms ms-sm" style="vertical-align:-2px">shield_person</span> ${esc(t('tk.visInternal'))}</span>` : '')}
          <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div>${esc(c.body).replace(/\n/g, '<br>')}</div>
        ${commentDocs(c.documents)}
      </div>`).join('') || `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`;
    const activity = (tk.activity || []).map((a) => `<li><span class="cell-sub">${esc(String(a.createdAt || '').replace('T', ' ').slice(0, 16))}</span> · ${esc(a.actorName || '')} — ${esc(a.action)}${a.detail ? ' (' + esc(a.detail) + ')' : ''}</li>`).join('');

    openModal({
      title: `${tk.number} · ${tk.subject}`,
      xwide: true,
      body: `
        <div class="tkd">
          <div class="tkd-topbar">
            <span class="tkd-typeicon tkd-type-${tk.type === 'incident' ? 'incident' : 'request'}"><span class="ms">${tk.type === 'incident' ? 'error' : 'assignment'}</span></span>
            <div class="tkd-topbar-info">
              <div class="tkd-badges">
                ${pill(TK_STATUS_PILL[tk.status] || 'pill-slate', tkStatusLabel(tk.status))}
                ${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}
                ${tk.approvalStatus ? pill({ pending: 'pill-amber', approved: 'pill-emerald', rejected: 'pill-rose' }[tk.approvalStatus] || 'pill-slate', t('mtk.ap' + tk.approvalStatus.charAt(0).toUpperCase() + tk.approvalStatus.slice(1))) : ''}
              </div>
              <div class="tkd-submeta">${esc(tkTypeLabel(tk.type))}${tk.requesterName ? ' · ' + esc(tk.requesterName) : ''} · <span class="ms ms-sm">schedule</span> ${esc(String(tk.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
            </div>
          </div>
          <div class="tkd-grid">
            <div class="tkd-main">
              <section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('tk.description'))}</h4>
                <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div>
              </section>
              <section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('tk.worklog'))}</h4>
                <div class="tk-comments">${comments}</div>
                ${canUpdate ? `<div class="tkd-reply">
                  ${(canned.length || canManage) ? `<select id="tk-d-canned" class="ops-select" style="margin-bottom:6px">
                    <option value="">${esc(t('tk.cannedPick'))}</option>
                    ${canned.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('')}
                    ${canManage ? `<option value="__manage__">— ${esc(t('tk.cannedManage'))} —</option>` : ''}
                  </select>` : ''}
                  <textarea id="tk-d-comment" rows="3" placeholder="${esc(t('tk.addComment'))}"></textarea>
                  <div class="mtk-files" id="tk-d-reply-files"></div>
                  <div class="tkd-reply-foot">
                    <div class="tkd-reply-left">
                      <label class="btn btn-ghost btn-sm" style="margin:0"><span class="ms ms-sm">attach_file</span> ${esc(t('tk.attach'))}
                        <input type="file" id="tk-d-reply-file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" multiple hidden></label>
                      <div class="tkd-vis" id="tk-d-vis" data-vis="public" title="${esc(t('tk.visHint'))}">
                        <button type="button" class="tkd-vis-opt" data-v="public"><span class="ms ms-sm">public</span> ${esc(t('tk.visPublic'))}</button>
                        <button type="button" class="tkd-vis-opt" data-v="internal"><span class="ms ms-sm">shield_person</span> ${esc(t('tk.visInternal'))}</button>
                        <button type="button" class="tkd-vis-opt" data-v="staff"><span class="ms ms-sm">engineering</span> ${esc(t('tk.visStaff'))}</button>
                      </div>
                    </div>
                    <button class="btn btn-primary btn-sm" id="tk-d-addcomment">${esc(t('tk.post'))}</button>
                  </div>
                </div>` : ''}
              </section>
              ${canDocRead ? `<section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('tk.attachments'))}</h4>
                <div id="tk-docs" class="tk-docs"><p class="cell-sub">${esc(t('common.loading') || '…')}</p></div>
                ${canDocUpload ? `<div class="tkd-upload-row"><label class="btn btn-outline btn-sm" style="margin:0">
                  <span class="ms ms-sm">upload_file</span> ${esc(t('tk.attach'))}
                  <input type="file" id="tk-doc-file" style="display:none"></label>
                  <div class="tkd-vis" id="tk-doc-vis" data-vis="public" title="${esc(t('tk.visHint'))}">
                    <button type="button" class="tkd-vis-opt" data-v="public"><span class="ms ms-sm">public</span> ${esc(t('tk.visPublic'))}</button>
                    <button type="button" class="tkd-vis-opt" data-v="internal"><span class="ms ms-sm">shield_person</span> ${esc(t('tk.visInternal'))}</button>
                    <button type="button" class="tkd-vis-opt" data-v="staff"><span class="ms ms-sm">engineering</span> ${esc(t('tk.visStaff'))}</button>
                  </div>
                  <span class="cell-sub">${esc(t('tk.attachHint'))}</span></div>` : ''}
              </section>` : ''}
              <details class="tkd-activity"><summary class="cell-sub">${esc(t('tk.activity'))}</summary>
                <ul class="tk-activity">${activity}</ul></details>
              ${(tk.similar && tk.similar.length) ? `<section class="tkd-sec tkd-sim-sec">
                <h4 class="tkd-h tkd-h-sm"><span class="ms ms-sm" style="vertical-align:-3px">history</span> ${esc(t('tk.similarTitle'))} <span class="cell-sub">(${tk.similar.length})</span></h4>
                <div class="tkd-sim-list">${tk.similar.map((s) => {
                  const solved = ['resolved', 'closed'].includes(s.status);
                  const res = solved && s.resolutionNote ? String(s.resolutionNote).trim() : '';
                  return `<div class="tkd-sim prio-${esc(s.priority || 'medium')}" data-open="${esc(s.id)}">
                    <span class="tkd-sim-no mono">${esc(s.number)}</span>
                    <div class="tkd-sim-main"><div class="tkd-sim-subj">${esc(s.subject)}</div>
                      <div class="tkd-sim-meta">${pill(TK_STATUS_PILL[s.status] || 'pill-slate', tkStatusLabel(s.status))}${s.sameRequester ? ` <span class="tkd-sim-badge">${esc(t('tk.similarSameUser'))}</span>` : ''}${s.sameCategory ? ` <span class="tkd-sim-badge tkd-sim-badge-cat">${esc(t('tk.similarSameCat'))}</span>` : ''}${s.csatRating ? ` <span class="cell-sub">${'★'.repeat(s.csatRating)}</span>` : ''} <span class="cell-sub">${esc(String(s.createdAt || '').slice(0, 10))}</span></div>
                      ${res ? `<div class="tkd-sim-res" title="${esc(res)}"><span class="ms ms-sm">lightbulb</span> <span class="tkd-sim-res-lbl">${esc(t('tk.similarSolution'))}:</span> ${esc(res.slice(0, 160))}${res.length > 160 ? '…' : ''}</div>` : ''}
                    </div>
                    <span class="ms ms-sm tkd-sim-chev">chevron_right</span>
                  </div>`;
                }).join('')}</div>
              </section>` : ''}
            </div>
            <aside class="tkd-side">
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.statusCol'))}</span>
                <select id="tk-d-status" ${canUpdate ? '' : 'disabled'}>${TK_STATUS.map((s) => `<option value="${s}"${s === tk.status ? ' selected' : ''}>${esc(tkStatusLabel(s))}</option>`).join('')}</select></div>
              <div class="tkd-2col">
                <div class="tkd-prop"><span class="tkd-plabel req">${esc(t('tk.impact'))}</span>
                  <select id="tk-d-impact" ${canUpdate ? '' : 'disabled'}><option value="">—</option>${['low', 'medium', 'high'].map((l) => `<option value="${l}"${l === tk.impact ? ' selected' : ''}>${esc(tkPriorityLabel(l))}</option>`).join('')}</select></div>
                <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.urgency'))}</span>
                  <select id="tk-d-urgency" ${canUpdate ? '' : 'disabled'}><option value="">—</option>${['low', 'medium', 'high'].map((l) => `<option value="${l}"${l === tk.urgency ? ' selected' : ''}>${esc(tkPriorityLabel(l))}</option>`).join('')}</select></div>
              </div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.priorityCol'))}</span>
                <div class="tkd-val">${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}${(tk.impact && tk.urgency && tkDerivePriority(tk.impact, tk.urgency) === tk.priority) ? ` <span class="cell-sub">${esc(t('tk.derived'))}</span>` : ''}</div></div>
              <div class="tkd-prop"><span class="tkd-plabel req">${esc(t('tk.assignee'))}</span>
                <select id="tk-d-assignee" ${canAssign ? '' : 'disabled'}>${assignOpts}</select></div>
              <div class="tkd-prop"><span class="tkd-plabel req">${esc(t('tk.category'))}</span>
                <select id="tk-d-cat" ${canUpdate ? '' : 'disabled'}><option value="">${esc(t('tk.categoryNone'))}</option>${catOptions(tk.category)}</select></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.requester'))}</span>
                <div class="tkd-val">${esc(tk.requesterName || '—')}</div></div>
              ${tk.approvalStatus ? `<div class="tkd-prop"><span class="tkd-plabel">${esc(t('rt.approval'))}</span>
                <div class="tkd-val">${pill({ pending: 'pill-amber', approved: 'pill-emerald', rejected: 'pill-rose' }[tk.approvalStatus] || 'pill-slate', t('mtk.ap' + tk.approvalStatus.charAt(0).toUpperCase() + tk.approvalStatus.slice(1)))}${tk.approvalStatus === 'pending' && tk.approvalApprover ? ` <span class="cell-sub">· ${esc(tk.approvalApprover)}</span>` : ''}</div>
                ${myAppr ? `<div class="tkd-appr-actions">
                  <button class="btn btn-primary btn-sm" id="tk-d-appr-approve"><span class="ms ms-sm">check</span> ${esc(t('ch.approve'))}</button>
                  <button class="btn btn-outline btn-sm" id="tk-d-appr-reject" style="color:var(--rose-700)"><span class="ms ms-sm">close</span> ${esc(t('ch.reject'))}</button>
                </div>` : ''}</div>` : ''}
              ${(canUpdate && tk.requesterEmployeeId && tk.approvalStatus !== 'pending') ? `<div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.approval'))}</span>
                <div><button class="btn btn-outline btn-sm" id="tk-d-send-approval"><span class="ms ms-sm">how_to_reg</span> ${esc(t('tk.sendToApproval'))}</button></div></div>` : ''}
              ${renderApprovalTimeline(tk.approvalHistory)}
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.asset'))}</span>
                <div id="tk-d-asset-host"></div></div>
              ${canLinkProblem ? `<div class="tkd-prop"><span class="tkd-plabel">${esc(t('pr.problemLink'))}</span>
                <div id="tk-d-problem-host"></div></div>`
              : (tk.problemNumber ? `<div class="tkd-prop"><span class="tkd-plabel">${esc(t('pr.problemLink'))}</span><div class="mono">${esc(tk.problemNumber)}</div></div>` : '')}
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.slaCol'))}</span>
                <div class="tk-sla tkd-sla">
                  <span>${esc(t('tk.sla.response'))}: ${tkSlaBadge(tk.sla && tk.sla.response)}${slaDue(tk.sla && tk.sla.response)}</span>
                  <span>${esc(t('tk.sla.resolution'))}: ${tkSlaBadge(tk.sla && tk.sla.resolve)}${slaDue(tk.sla && tk.sla.resolve)}</span>
                </div></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.resolutionCode'))}</span>
                <select id="tk-d-rescode" ${canUpdate ? '' : 'disabled'}><option value="">—</option>${TK_RESOLUTION_CODES.map((rc) => `<option value="${rc}"${rc === tk.resolutionCode ? ' selected' : ''}>${esc(t('tk.rescode.' + rc))}</option>`).join('')}</select></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.csat'))}</span>
                <div class="tkd-val">${tk.csatRating ? `${tkStars(tk.csatRating)}${tk.csatComment ? ` <span class="cell-sub">“${esc(tk.csatComment)}”</span>` : ''}` : `<span class="cell-sub">${esc(t('tk.csatNone'))}</span>`}</div></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.resolutionNote'))}</span>
                <textarea id="tk-d-resnote" rows="2" ${canUpdate ? '' : 'disabled'} placeholder="${esc(t('tk.resolutionNotePh'))}">${esc(tk.resolutionNote || '')}</textarea></div>
            </aside>
          </div>
        </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        const patch = async (body) => {
          try { await api('/tickets/' + encodeURIComponent(id), { method: 'PATCH', body }); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        };
        // Click a similar past ticket to open it.
        ov.querySelectorAll('.tkd-sim[data-open]').forEach((row) => row.addEventListener('click', () => {
          if (row.dataset.open) { closeModal(); openTicket(row.dataset.open); }
        }));
        // Visibility segmented selector (Everyone / Approvers-only / IT-team-only);
        // the chosen level lives on the group's data-vis.
        ov.querySelectorAll('.tkd-vis').forEach((grp) => {
          const sync = () => grp.querySelectorAll('.tkd-vis-opt').forEach((b) => b.classList.toggle('act', b.dataset.v === grp.dataset.vis));
          grp.querySelectorAll('.tkd-vis-opt').forEach((b) => b.addEventListener('click', () => { grp.dataset.vis = b.dataset.v; sync(); }));
          sync();
        });
        const visFlags = (sel) => { const v = ($(sel, ov) && $(sel, ov).dataset.vis) || 'public'; return { internal: v !== 'public', staffOnly: v === 'staff' }; };
        // Resolving/closing requires impact, category and an assignee. Pre-check
        // on the client for a friendly, translated message (backend also enforces),
        // reverting the dropdown and flagging the empty fields.
        $('#tk-d-status', ov)?.addEventListener('change', (e) => {
          const next = e.target.value;
          if (next === 'resolved' || next === 'closed') {
            const impactEl = $('#tk-d-impact', ov);
            const catEl = $('#tk-d-cat', ov);
            const asgEl = $('#tk-d-assignee', ov);
            const need = [];
            if (impactEl && !impactEl.value) need.push([impactEl, t('tk.impact')]);
            if (catEl && !catEl.value) need.push([catEl, t('tk.category')]);
            if (asgEl && !asgEl.value) need.push([asgEl, t('tk.assignee')]);
            if (need.length) {
              e.target.value = tk.status; // revert
              ov.querySelectorAll('.tkd-need').forEach((n) => n.classList.remove('tkd-need'));
              need.forEach(([el]) => { el.classList.add('tkd-need'); });
              need[0][0].focus();
              toast(t('tk.requiredBeforeClose').replace('{fields}', need.map((x) => x[1]).join(', ')), 'error');
              return;
            }
          }
          patch({ status: next });
        });
        // Clear the required-field highlight once the user fills one in.
        ['#tk-d-impact', '#tk-d-cat', '#tk-d-assignee'].forEach((sel) => $(sel, ov)?.addEventListener('change', (e) => { if (e.target.value) e.target.classList.remove('tkd-need'); }));
        $('#tk-d-send-approval', ov)?.addEventListener('click', () => {
          formModal({
            title: t('tk.sendToApproval'),
            stack: true,
            fields: [{ name: 'level', label: t('tk.approvalLevel'), type: 'select', full: true, value: 'manager', options: [
              { value: 'manager', label: t('rt.manager') },
              { value: 'manager2', label: t('rt.manager2') },
              { value: 'department', label: t('rt.department') },
            ] }],
            submitLabel: t('tk.sendToApproval'),
            async onSubmit(d) {
              // Let a failure propagate so formModal surfaces it and stays open.
              await api('/tickets/' + encodeURIComponent(id) + '/send-approval', { method: 'POST', body: { level: d.level } });
              toast(t('tk.sentToApproval'), 'success');
              // Re-open the detail (fresh approval status) after formModal auto-closes.
              setTimeout(() => openTicket(id), 0);
            },
          });
        });
        const decideAppr = async (decision) => {
          try {
            await api('/me/approvals/' + encodeURIComponent(myAppr.id) + '/decide', { method: 'POST', body: { decision } });
            toast(decision === 'approved' ? t('ch.approved') : t('ch.rejected'), 'success');
            if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
            closeModal();
            setTimeout(() => openTicket(id), 0);
          } catch (err) { toast(err.message, 'error'); }
        };
        $('#tk-d-appr-approve', ov)?.addEventListener('click', () => decideAppr('approved'));
        $('#tk-d-appr-reject', ov)?.addEventListener('click', () => decideAppr('rejected'));
        $('#tk-d-impact', ov)?.addEventListener('change', (e) => patch({ impact: e.target.value || null }));
        $('#tk-d-urgency', ov)?.addEventListener('change', (e) => patch({ urgency: e.target.value || null }));
        $('#tk-d-assignee', ov)?.addEventListener('change', (e) => patch({ assigneeUserId: e.target.value || null }));
        $('#tk-d-cat', ov)?.addEventListener('change', (e) => patch({ category: e.target.value.trim() }));
        $('#tk-d-rescode', ov)?.addEventListener('change', (e) => patch({ resolutionCode: e.target.value || null }));
        $('#tk-d-resnote', ov)?.addEventListener('change', (e) => patch({ resolutionNote: e.target.value.trim() }));
        const assetHost = $('#tk-d-asset-host', ov);
        if (assetHost) {
          const assetVal = tk.assetId ? (assetById.get(tk.assetId) || { id: tk.assetId, assetTag: tk.assetTag || tk.assetId }) : null;
          mountCombobox(assetHost, {
            items: assets, labelOf: assetLabel, subOf: (x) => x.serialNo || x.status || '', value: assetVal,
            disabled: !canUpdate, placeholder: t('tk.searchPh'),
            onSelect: (it) => patch({ assetId: it ? it.id : null }),
          });
        }
        const probHost = $('#tk-d-problem-host', ov);
        if (probHost) {
          const probVal = tk.problemId ? { id: tk.problemId, number: tk.problemNumber, title: tk.problemTitle } : null;
          mountCombobox(probHost, {
            items: problemsList, labelOf: probLabel, subOf: (p) => (p.status ? (t('pr.status.' + p.status) || p.status) : ''),
            value: probVal, placeholder: t('pr.searchPh'), emptyText: t('pr.noneToLink'),
            onSelect: (it) => patch({ problemId: it ? it.id : null }),
          });
        }
        // Attachments (reuse the vetted document store).
        if (canDocRead) {
          const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
          const loadDocs = async () => {
            const box = $('#tk-docs', ov); if (!box) return;
            // Every attachment is listed here, including files posted with a comment
            // (those also render beneath their comment).
            const docs = await api('/tickets/' + encodeURIComponent(id) + '/documents').catch(() => []);
            box.innerHTML = docs.length ? docs.map((d) => `<div class="tk-doc">
                <span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span>
                <a href="#" data-dl="${esc(d.id)}" class="tk-doc-name">${esc(d.filename)}</a>
                ${d.internal ? `<span class="pill pill-amber">${esc(t('tk.internal'))}</span>` : ''}
                <span class="cell-sub">${esc(fmtSize(d.byteSize || 0))}</span>
                ${canDocDelete ? `<button class="btn btn-outline btn-sm tk-doc-del" data-id="${esc(d.id)}" title="${esc(t('common.remove') || 'Remove')}"><span class="ms ms-sm">delete</span></button>` : ''}
              </div>`).join('') : `<p class="cell-sub">${esc(t('tk.noAttachments'))}</p>`;
            box.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); viewAuthed('/api/tickets/documents/' + a.dataset.dl + '/download?view=1'); }));
            box.querySelectorAll('.tk-doc-del').forEach((b) => b.addEventListener('click', async () => {
              try { await api('/tickets/documents/' + b.dataset.id, { method: 'DELETE' }); loadDocs(); }
              catch (err) { toast(err.message, 'error'); }
            }));
          };
          loadDocs();
          $('#tk-doc-file', ov)?.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = String(reader.result).split(',')[1] || '';
              const vf = visFlags('#tk-doc-vis');
              try { await api('/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64, filename: file.name, internal: vf.internal, staffOnly: vf.staffOnly } }); toast(t('tk.attached'), 'success'); loadDocs(); }
              catch (err) { toast(err.message, 'error'); }
              e.target.value = '';
            };
            reader.readAsDataURL(file);
          });
        }
        $('#tk-d-canned', ov)?.addEventListener('change', (e) => {
          const v = e.target.value;
          if (v === '__manage__') { e.target.value = ''; openCannedEditor(); return; }
          if (v === '') return;
          const tpl = canned[Number(v)];
          if (tpl) {
            const ta = $('#tk-d-comment', ov);
            ta.value = ta.value.trim() ? ta.value.trim() + '\n' + tpl.body : tpl.body;
            ta.focus();
          }
          e.target.value = '';
        });
        // Comment-linked files open with the same authed download path.
        ov.querySelectorAll('.tk-cdoc').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault(); viewAuthed('/api/tickets/documents/' + a.dataset.cdl + '/download?view=1');
        }));
        // Stage files on the reply, uploaded and linked to the comment after it posts.
        const replyStaged = [];
        const replyFilesBox = $('#tk-d-reply-files', ov);
        const renderReplyFiles = () => {
          if (!replyFilesBox) return;
          replyFilesBox.innerHTML = replyStaged.map((f, i) => `<div class="mtk-file">
            <span class="ms ms-sm">${f.type.startsWith('image/') ? 'image' : 'description'}</span>
            <span class="mtk-file-name">${esc(f.name)}</span>
            <button type="button" class="mtk-file-x" data-i="${i}"><span class="ms ms-sm">close</span></button></div>`).join('');
          replyFilesBox.querySelectorAll('.mtk-file-x').forEach((b) => b.addEventListener('click', () => { replyStaged.splice(Number(b.dataset.i), 1); renderReplyFiles(); }));
        };
        $('#tk-d-reply-file', ov)?.addEventListener('change', (e) => {
          for (const f of e.target.files) {
            if (!/\.(pdf|png|jpe?g|webp)$/i.test(f.name)) { toast(t('mtk.fileType').replace('{n}', f.name), 'error'); continue; }
            if (f.size > 8 * 1024 * 1024) { toast(t('mtk.fileTooBig').replace('{n}', f.name), 'error'); continue; }
            replyStaged.push(f);
          }
          e.target.value = ''; renderReplyFiles();
        });
        const readReplyB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(file); });
        $('#tk-d-addcomment', ov)?.addEventListener('click', async () => {
          const body = $('#tk-d-comment', ov).value.trim();
          if (!body && !replyStaged.length) return;
          const vf = visFlags('#tk-d-vis');
          try {
            const resp = await api('/tickets/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { body: body || t('tk.fileOnlyComment'), internal: vf.internal, staffOnly: vf.staffOnly } });
            const commentId = resp && resp.newCommentId;
            for (const f of replyStaged) {
              try { await api('/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64: await readReplyB64(f), filename: f.name, internal: vf.internal, staffOnly: vf.staffOnly, commentId } }); }
              catch { /* best-effort per file */ }
            }
            closeModal(); openTicket(id); refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  render();
  // Initial paint: reuse the open-tickets fetch for list mode; board needs all statuses.
  if (mode === 'board') refresh(); else paintList(Array.isArray(tickets) ? tickets : []);
  // Deep-link: #/tickets?open=<id> (e.g. from an asset's related-tickets list).
  if (params && params.open) openTicket(params.open);
};
