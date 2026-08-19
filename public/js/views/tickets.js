/* ============================ SERVICE DESK (ITIL) ============================ */

const TK_STATUS = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'];
const TK_BOARD_COLUMNS = ['new', 'open', 'in_progress', 'pending', 'resolved'];
const TK_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TK_STATUS_PILL = {
  new: 'pill-slate', open: 'pill-blue', in_progress: 'pill-amber', pending: 'pill-slate',
  resolved: 'pill-emerald', closed: 'pill-slate', cancelled: 'pill-rose',
};
const TK_PRIORITY_PILL = { low: 'pill-slate', medium: 'pill-blue', high: 'pill-amber', urgent: 'pill-rose' };
const tkStatusLabel = (s) => t('tk.status.' + s) || s;
const tkPriorityLabel = (p) => t('tk.priority.' + p) || p;
const tkTypeLabel = (ty) => t('tk.type.' + ty) || ty;

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
  const canDocRead = Auth.canIam('document', 'read');
  const canDocUpload = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create');
  const canDocDelete = Auth.canIam('document', 'delete');
  let mode = localStorage.getItem('tk_mode') === 'board' ? 'board' : 'list';

  const [tickets, staff, empRes, assetRes, stats0, catsRes, cannedRes] = await Promise.all([
    api('/tickets?open=1').catch(() => []),
    api('/auth/users').catch(() => []),
    api('/employees?status=Active&limit=1000').catch(() => ({ items: [] })),
    api('/assets?limit=1000').catch(() => ({ items: [] })),
    api('/tickets/stats').catch(() => null),
    api('/tickets/categories').catch(() => []),
    api('/tickets/canned').catch(() => []),
  ]);
  const catList = Array.isArray(catsRes) ? catsRes : [];
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
    return `<div class="grid grid-4" style="margin-bottom:16px">
      ${card(t('tk.kpiOpen'), s.open, 'confirmation_number', 'indigo')}
      ${card(t('tk.kpiUnassigned'), s.unassigned, 'person_off', s.unassigned ? 'amber' : 'emerald')}
      ${card(t('tk.kpiBreached'), s.breached, 'warning', s.breached ? 'rose' : 'emerald')}
      ${card(t('tk.kpiResolvedToday'), s.resolvedToday, 'task_alt', 'blue')}
    </div>`;
  };
  const staffList = Array.isArray(staff) ? staff : [];
  const staffName = (uid) => (staffList.find((u) => u.uid === uid) || {}).username || '';

  // Searchable pickers (datalist): build unique label→id maps for requester + asset.
  const emps = Array.isArray(empRes) ? empRes : (empRes.items || []);
  const assets = Array.isArray(assetRes) ? assetRes : (assetRes.items || []);
  const empLabel = (e) => [e.fullName, e.department || e.title].filter(Boolean).join(' · ') || e.fullName || '—';
  const assetLabel = (x) => [x.assetTag, [x.brand, x.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  const empById = new Map(emps.map((e) => [e.id, e]));
  const assetById = new Map(assets.map((x) => [x.id, x]));
  const empIdByLabel = new Map(emps.map((e) => [empLabel(e), e.id]));
  const assetIdByLabel = new Map(assets.map((x) => [assetLabel(x), x.id]));
  const empOptions = emps.map((e) => `<option value="${esc(empLabel(e))}">`).join('');
  const assetOptions = assets.map((x) => `<option value="${esc(assetLabel(x))}">`).join('');

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
        `${canManage ? `<button class="btn btn-outline" id="tk-sla"><span class="ms">schedule</span> ${esc(t('tk.slaSettings'))}</button>` : ''}`
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

  function openCannedEditor() {
    const rowHtml = (c) => `<div class="tk-canned-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">
      <input class="tk-cn-title" placeholder="${esc(t('tk.cannedTitle'))}" maxlength="120" value="${esc((c && c.title) || '')}" style="flex:0 0 190px">
      <textarea class="tk-cn-body" rows="2" placeholder="${esc(t('tk.cannedBody'))}" maxlength="4000" style="flex:1">${esc((c && c.body) || '')}</textarea>
      <button class="btn btn-outline btn-sm tk-cn-del" type="button" title="${esc(t('common.remove') || 'Remove')}"><span class="ms ms-sm">delete</span></button>
    </div>`;
    openModal({
      title: t('tk.cannedManage'),
      wide: true,
      body: `<p class="cell-sub" style="margin:0 0 12px">${esc(t('tk.cannedHint'))}</p>
        <div id="tk-cn-list">${(canned.length ? canned : [{ title: '', body: '' }]).map(rowHtml).join('')}</div>
        <button class="btn btn-outline btn-sm" id="tk-cn-add" type="button"><span class="ms ms-sm">add</span> ${esc(t('tk.cannedAdd'))}</button>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="tk-cn-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        const list = $('#tk-cn-list', ov);
        const wireDel = () => list.querySelectorAll('.tk-cn-del').forEach((b) => { b.onclick = () => b.closest('.tk-canned-row').remove(); });
        wireDel();
        $('#tk-cn-add', ov).addEventListener('click', () => { list.insertAdjacentHTML('beforeend', rowHtml()); wireDel(); });
        $('#tk-cn-save', ov).addEventListener('click', async () => {
          const items = [...list.querySelectorAll('.tk-canned-row')]
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
      body: `<div class="form-grid">
        <div class="form-field"><label>${esc(t('tk.type'))}</label>
          <select id="tk-c-type"><option value="incident">${esc(tkTypeLabel('incident'))}</option><option value="request">${esc(tkTypeLabel('request'))}</option></select></div>
        <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
          <select id="tk-c-priority">${TK_PRIORITY.map((p) => `<option value="${p}"${p === 'medium' ? ' selected' : ''}>${esc(tkPriorityLabel(p))}</option>`).join('')}</select></div>
        <div class="form-field full"><label>${esc(t('tk.subject'))} *</label><input id="tk-c-subject" maxlength="300"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="tk-c-desc" rows="4"></textarea></div>
        <div class="form-field"><label>${esc(t('tk.category'))}</label><input id="tk-c-cat" maxlength="120" placeholder="${esc(t('tk.categoryPh'))}"></div>
        <div class="form-field"><label>${esc(t('tk.requester'))}</label>
          <input id="tk-c-requester" list="tk-emp-list" autocomplete="off" placeholder="${esc(t('tk.searchPh'))}"><datalist id="tk-emp-list">${empOptions}</datalist></div>
        <div class="form-field"><label>${esc(t('tk.asset'))}</label>
          <input id="tk-c-asset" list="tk-asset-list" autocomplete="off" placeholder="${esc(t('tk.searchPh'))}"><datalist id="tk-asset-list">${assetOptions}</datalist></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="tk-c-save">${esc(t('tk.create'))}</button>`,
      onMount(ov) {
        $('#tk-c-save', ov).addEventListener('click', async () => {
          try {
            await api('/tickets', { method: 'POST', body: {
              type: $('#tk-c-type', ov).value,
              priority: $('#tk-c-priority', ov).value,
              subject: $('#tk-c-subject', ov).value.trim(),
              description: $('#tk-c-desc', ov).value.trim(),
              category: $('#tk-c-cat', ov).value.trim(),
              requesterEmployeeId: empIdByLabel.get($('#tk-c-requester', ov).value.trim()) || null,
              assetId: assetIdByLabel.get($('#tk-c-asset', ov).value.trim()) || null,
            } });
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
    const assignOpts = `<option value="">${esc(t('tk.unassigned'))}</option>` +
      staffList.map((u) => `<option value="${esc(u.uid)}"${u.uid === tk.assigneeUserId ? ' selected' : ''}>${esc(u.username)}</option>`).join('');
    const comments = (tk.comments || []).map((c) => `
      <div class="tk-comment${c.internal ? ' tk-internal' : ''}">
        <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
          ${c.internal ? `<span class="pill pill-amber">${esc(t('tk.internal'))}</span>` : ''}
          <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div>${esc(c.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('') || `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`;
    const activity = (tk.activity || []).map((a) => `<li><span class="cell-sub">${esc(String(a.createdAt || '').replace('T', ' ').slice(0, 16))}</span> · ${esc(a.actorName || '')} — ${esc(a.action)}${a.detail ? ' (' + esc(a.detail) + ')' : ''}</li>`).join('');

    openModal({
      title: `${tk.number} · ${tk.subject}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="form-field"><label>${esc(t('tk.statusCol'))}</label>
            <select id="tk-d-status" ${canUpdate ? '' : 'disabled'}>${TK_STATUS.map((s) => `<option value="${s}"${s === tk.status ? ' selected' : ''}>${esc(tkStatusLabel(s))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
            <select id="tk-d-priority" ${canUpdate ? '' : 'disabled'}>${TK_PRIORITY.map((p) => `<option value="${p}"${p === tk.priority ? ' selected' : ''}>${esc(tkPriorityLabel(p))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.assignee'))}</label>
            <select id="tk-d-assignee" ${canAssign ? '' : 'disabled'}>${assignOpts}</select></div>
          <div class="form-field"><label>${esc(t('tk.category'))}</label>
            <input id="tk-d-cat" value="${esc(tk.category || '')}" ${canUpdate ? '' : 'disabled'}></div>
          <div class="form-field"><label>${esc(t('tk.requester'))}</label>
            <div style="padding-top:6px">${esc(tk.requesterName || '—')}</div></div>
          <div class="form-field"><label>${esc(t('tk.asset'))}</label>
            <input id="tk-d-asset" list="tk-asset-list" autocomplete="off" ${canUpdate ? '' : 'disabled'}
              value="${esc(tk.assetId && assetById.has(tk.assetId) ? assetLabel(assetById.get(tk.assetId)) : (tk.assetTag || ''))}"
              placeholder="${esc(t('tk.searchPh'))}"><datalist id="tk-asset-list">${assetOptions}</datalist></div>
          <div class="form-field full"><label>${esc(t('tk.slaCol'))}</label>
            <div class="tk-sla">
              <span>${esc(t('tk.sla.response'))}: ${tkSlaBadge(tk.sla && tk.sla.response)}${slaDue(tk.sla && tk.sla.response)}</span>
              <span>${esc(t('tk.sla.resolution'))}: ${tkSlaBadge(tk.sla && tk.sla.resolve)}${slaDue(tk.sla && tk.sla.resolve)}</span>
            </div></div>
          <div class="form-field full"><label>${esc(t('tk.description'))}</label>
            <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div></div>
        </div>
        <h3 style="margin:16px 0 8px">${esc(t('tk.worklog'))}</h3>
        <div class="tk-comments">${comments}</div>
        ${canUpdate ? `<div style="margin-top:10px">
          ${(canned.length || canManage) ? `<select id="tk-d-canned" class="ops-select" style="margin-bottom:6px">
            <option value="">${esc(t('tk.cannedPick'))}</option>
            ${canned.map((c, i) => `<option value="${i}">${esc(c.title)}</option>`).join('')}
            ${canManage ? `<option value="__manage__">— ${esc(t('tk.cannedManage'))} —</option>` : ''}
          </select>` : ''}
          <textarea id="tk-d-comment" rows="2" placeholder="${esc(t('tk.addComment'))}"></textarea>
          <label style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:13px">
            <input type="checkbox" id="tk-d-internal"> ${esc(t('tk.internalNote'))}</label>
          <div><button class="btn btn-outline btn-sm" id="tk-d-addcomment" style="margin-top:6px">${esc(t('tk.post'))}</button></div>
        </div>` : ''}
        ${canDocRead ? `<h3 style="margin:16px 0 8px">${esc(t('tk.attachments'))}</h3>
          <div id="tk-docs" class="tk-docs"><p class="cell-sub">${esc(t('common.loading') || '…')}</p></div>
          ${canDocUpload ? `<div style="margin-top:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><label class="btn btn-outline btn-sm" style="margin:0">
            <span class="ms ms-sm">upload_file</span> ${esc(t('tk.attach'))}
            <input type="file" id="tk-doc-file" style="display:none"></label>
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="tk-doc-internal"> ${esc(t('tk.docInternal'))}</label>
            <span class="cell-sub">${esc(t('tk.attachHint'))}</span></div>` : ''}` : ''}
        <details style="margin-top:14px"><summary class="cell-sub">${esc(t('tk.activity'))}</summary>
          <ul class="tk-activity">${activity}</ul></details>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        const patch = async (body) => {
          try { await api('/tickets/' + encodeURIComponent(id), { method: 'PATCH', body }); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        };
        $('#tk-d-status', ov)?.addEventListener('change', (e) => patch({ status: e.target.value }));
        $('#tk-d-priority', ov)?.addEventListener('change', (e) => patch({ priority: e.target.value }));
        $('#tk-d-assignee', ov)?.addEventListener('change', (e) => patch({ assigneeUserId: e.target.value || null }));
        $('#tk-d-cat', ov)?.addEventListener('change', (e) => patch({ category: e.target.value.trim() }));
        $('#tk-d-asset', ov)?.addEventListener('change', (e) => {
          const v = e.target.value.trim();
          if (!v) { patch({ assetId: null }); return; }
          const id = assetIdByLabel.get(v);
          if (id) patch({ assetId: id }); else toast(t('tk.assetUnknown'), 'error');
        });
        // Attachments (reuse the vetted document store).
        if (canDocRead) {
          const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
          const loadDocs = async () => {
            const box = $('#tk-docs', ov); if (!box) return;
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
              const internal = !!($('#tk-doc-internal', ov) && $('#tk-doc-internal', ov).checked);
              try { await api('/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64, filename: file.name, internal } }); toast(t('tk.attached'), 'success'); loadDocs(); }
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
        $('#tk-d-addcomment', ov)?.addEventListener('click', async () => {
          const body = $('#tk-d-comment', ov).value.trim();
          if (!body) return;
          try {
            await api('/tickets/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { body, internal: !!$('#tk-d-internal', ov).checked } });
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
