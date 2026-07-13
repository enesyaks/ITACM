/* =============================== EMPLOYEES =============================== */
Views.employees = async function (el, params = {}) {
  if (isStaleView(el)) return;
  const canEdit = Auth.can('canManageAssets');
  const PAGE = 50;
  const page = Math.max(1, Number(params.page) || 1);
  const EMP_STATUSES = ['Active', 'Inactive'];
  const selectedStatus = csvList(params.status).filter((s) => EMP_STATUSES.includes(s));
  const deptCatalog = AppConfig.departments || [];
  const selectedDepts = csvList(params.department).filter((d) => deptCatalog.includes(d));

  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (selectedStatus.length) q.set('status', selectedStatus.join(','));
  if (selectedDepts.length) q.set('department', selectedDepts.join(','));
  q.set('limit', String(PAGE));
  q.set('offset', String((page - 1) * PAGE));
  const { items, total, summary } = employeeList(await api('/employees?' + q.toString()));
  if (isStaleView(el)) return;

  const withAssets = summary ? summary.withAssets : items.filter((x) => x.activeAssetCount > 0).length;
  const coverage = total ? Math.round((withAssets / total) * 1000) / 10 : 0;
  const inactive = summary ? summary.inactive : items.filter((x) => x.status === 'Inactive').length;
  const activeCount = summary ? summary.active : (total - inactive);

  const chips = [];
  selectedStatus.forEach((s) => chips.push({ key: 'status', value: s, label: `Status: ${s}` }));
  selectedDepts.forEach((d) => chips.push({ key: 'department', value: d, label: `Department: ${d}` }));
  if (params.search) chips.push({ key: 'search', label: `Search: ${params.search}` });

  const setHash = (next) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => { if (v) p.set(k, v); });
    const qs = p.toString();
    location.hash = '#/employees' + (qs ? '?' + qs : '');
  };
  const cur = () => ({
    search: params.search || '',
    status: selectedStatus.join(','),
    department: selectedDepts.join(','),
    page: String(page),
  });

  el.innerHTML = `
    ${pageHead('Employee Directory', 'Manage personnel and their assigned IT assets.', canEdit ?
      `<button class="btn btn-outline" id="emp-onboard"><span class="ms">person_add</span> ${esc(t('emp.onboard'))}</button>
       <button class="btn btn-primary" id="emp-new"><span class="ms">person_add</span> ${esc(t('common.addNewEmployee'))}</button>` : '')}

    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.totalEmployees'))}</h3>${iconChip('group', 'indigo')}</div>
        <div class="metric-value">${total.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.withActiveAssets'))}</h3>${iconChip('devices', 'blue')}</div>
        <div class="metric-value">${withAssets.toLocaleString()}</div>
        <div class="metric-trend trend-flat">${coverage}% ${esc(t('common.coverage'))}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.active'))}</h3>${iconChip('how_to_reg', 'emerald')}</div>
        <div class="metric-value">${activeCount.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.inactive'))}</h3>${iconChip('person_off', 'rose')}</div>
        <div class="metric-value">${inactive.toLocaleString()}</div>
        <div class="metric-trend ${inactive ? 'trend-down' : 'trend-flat'}">${inactive ? esc(t('common.assetsToRecover')) : '—'}</div>
      </div>
    </div>

    <div class="toolbar" id="emp-filters">
      <div class="search-box"><span class="ms">search</span>
        <input type="search" id="emp-search" placeholder="Search by name, ID, or email…" value="${esc(params.search || '')}"></div>
      ${multiSelectHtml({
        id: 'status',
        allLabel: t('network.allStatuses'),
        selected: selectedStatus,
        options: EMP_STATUSES.map((s) => ({ value: s, label: s })),
      })}
      ${multiSelectHtml({
        id: 'department',
        allLabel: t('emp.allDepartments') || 'All departments',
        selected: selectedDepts,
        options: deptCatalog.map((d) => ({ value: d, label: d })),
      })}
    </div>
    ${chips.length ? `<div class="filter-chips"><strong>Active Filters:</strong>
      ${chips.map((c) => `<span class="chip">${esc(c.label)}
        <button type="button" data-clear="${esc(c.key)}" ${c.value != null ? `data-clear-val="${esc(c.value)}"` : ''}><span class="ms">close</span></button></span>`).join('')}
      <a href="#/employees">Clear All</a></div>` : ''}

    <div class="card">
      <div class="m-emp-list" id="emp-mlist"></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Employee</th><th>ID / Sicil No</th><th>Department</th><th>Assigned Assets</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead>
        <tbody id="emp-tbody"></tbody>
      </table></div>
      <div class="table-foot" id="emp-foot"></div>
    </div>`;

  /* Server-side pagination (50 rows per page). */
  const pages = Math.max(1, Math.ceil(total / PAGE));
  function renderPage() {
    const slice = items;
    const empty = total === 0
      ? '<tr><td colspan="6" class="table-empty">No employees found.</td></tr>'
      : slice.map((x) => `
        <tr class="emp-row" data-open="${esc(x.id)}" style="cursor:pointer" title="View assigned assets">
          <td><div style="display:flex;align-items:center;gap:12px">
            <span class="avatar">${esc(initials(x.fullName))}</span>
            <div><div class="cell-title">${esc(x.fullName)}</div><div class="cell-sub">${esc(x.email)}</div></div>
          </div></td>
          <td class="mono">${esc(String(x.id).slice(0, 8).toUpperCase())}</td>
          <td>${esc(x.department || '—')}<div class="cell-sub">${esc(x.title || '')}</div></td>
          <td><span class="badge-count ${x.activeAssetCount === 0 ? 'zero' : ''}">${x.activeAssetCount}</span></td>
          <td>${badge(x.status)}</td>
          <td class="actions">
            <button class="btn btn-outline btn-sm" data-assets="${esc(x.id)}"><span class="ms">devices</span> ${esc(t('common.assets'))}</button>
            ${canEdit ? `<button class="btn btn-outline btn-sm" data-edit="${esc(x.id)}">${esc(t('common.edit'))}</button>` : ''}
          </td>
        </tr>`).join('');
    $('#emp-tbody', el).innerHTML = empty;

    const mlist = $('#emp-mlist', el);
    if (mlist) {
      mlist.innerHTML = total === 0
        ? `<div class="table-empty" style="padding:24px">No employees found.</div>`
        : slice.map((x) => `
          <div class="m-emp-card" data-open="${esc(x.id)}">
            <div class="m-emp-top">
              <span class="avatar">${esc(initials(x.fullName))}</span>
              <div style="flex:1;min-width:0">
                <div class="cell-title">${esc(x.fullName)}</div>
                <div class="cell-sub">${esc(x.email)}</div>
                <div class="m-emp-meta">${esc(x.department || '—')}${x.title ? ' · ' + esc(x.title) : ''}</div>
              </div>
              ${badge(x.status)}
            </div>
            <div class="cell-sub">${esc(t('common.assets'))}: <strong>${x.activeAssetCount}</strong></div>
            <div class="m-emp-actions">
              <button class="btn btn-outline btn-sm" data-assets="${esc(x.id)}"><span class="ms">devices</span> ${esc(t('common.assets'))}</button>
              ${canEdit ? `<button class="btn btn-outline btn-sm" data-edit="${esc(x.id)}">${esc(t('common.edit'))}</button>` : ''}
            </div>
          </div>`).join('');
    }
    const from = total ? (page - 1) * PAGE + 1 : 0;
    const to = Math.min(page * PAGE, total);
    const btns = [];
    for (let p = Math.max(1, page - 2); p <= Math.min(pages, Math.max(1, page - 2) + 4); p++) btns.push(p);
    const showing = t('common.showingOf')
      .replace('{from}', String(from))
      .replace('{to}', String(to))
      .replace('{total}', total.toLocaleString());
    $('#emp-foot', el).innerHTML = `${esc(showing)}
      <span class="spacer"></span>
      <div class="pager">
        <button data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${esc(t('common.prev'))}</button>
        ${btns.map((p) => `<button data-pg="${p}" class="${p === page ? 'on' : ''}">${p}</button>`).join('')}
        <button data-pg="${page + 1}" ${page >= pages ? 'disabled' : ''}>${esc(t('common.next'))}</button>
      </div>`;
    $('#emp-foot', el).querySelectorAll('[data-pg]').forEach((b) =>
      b.addEventListener('click', () => {
        if (isStaleView(el)) return;
        setHash({ ...cur(), page: b.dataset.pg });
      }));
  }
  renderPage();

  bindDebouncedSearch($('#emp-search', el), {
    getValue: () => params.search || '',
    apply: (search) => setHash({ ...cur(), search, page: 1 }),
  });
  mountMultiSelects($('#emp-filters', el), {
    status: (vals) => setHash({ ...cur(), status: vals.join(','), page: 1 }),
    department: (vals) => setHash({ ...cur(), department: vals.join(','), page: 1 }),
  });
  el.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    const next = cur();
    const key = b.dataset.clear;
    const val = b.dataset.clearVal;
    if (val != null && ['status', 'department'].includes(key)) {
      next[key] = csvList(next[key]).filter((x) => x !== val).join(',');
    } else {
      next[key] = '';
    }
    next.page = 1;
    setHash(next);
  }));
  if (canEdit) {
    $('#emp-new', el).addEventListener('click', () => employeeForm(null, () => setHash(cur())));
    $('#emp-onboard', el)?.addEventListener('click', () => openOnboardWizard(null));
  }
  bindView(el, (e) => {
    if (e.target.closest('.msel')) return;
    const btn = e.target.closest('button');
    if (btn && btn.dataset.edit) {
      employeeForm(items.find((x) => x.id === btn.dataset.edit), () => setHash(cur()));
      return;
    }
    if (btn && btn.dataset.assets) {
      showEmployeeDetail(items.find((x) => x.id === btn.dataset.assets));
      return;
    }
    const row = e.target.closest('tr.emp-row, .m-emp-card');
    if (row) showEmployeeDetail(items.find((x) => x.id === row.dataset.open));
  });
};

/* Employee detail: assigned assets + handover receipts + form regeneration. */
function empDeviceHistoryBadge(type) {
  const map = {
    placed: { pill: 'pill-indigo', icon: 'location_on', label: t('emp.histPlaced') },
    responsible_changed: { pill: 'pill-indigo', icon: 'person_search', label: t('emp.histResponsible') },
    created: { pill: 'pill-blue', icon: 'add_circle', label: t('emp.histCreated') },
    updated: { pill: 'pill-slate', icon: 'edit', label: t('emp.histUpdated') },
    status_changed: { pill: 'pill-amber', icon: 'sync', label: t('emp.histStatus') },
    sold: { pill: 'pill-blue', icon: 'sell', label: t('emp.offboardSell') },
    assigned: { pill: 'pill-indigo', icon: 'assignment_turned_in', label: 'assigned' },
    returned: { pill: 'pill-emerald', icon: 'undo', label: 'returned' },
    sent_to_repair: { pill: 'pill-amber', icon: 'build', label: 'sent_to_repair' },
    repair_update: { pill: 'pill-amber', icon: 'build', label: 'repair_update' },
  };
  const m = map[type];
  if (!m) return badge(type);
  return `<span class="pill ${m.pill}"><span class="ms ms-sm">${m.icon}</span> ${esc(m.label)}</span>`;
}

async function showEmployeeDetail(emp) {
  if (!emp) return;
  const canEdit = Auth.can('canManageAssets');
  const canDelDoc = Auth.can('canManageUsers');
  const [assetsRes, infraRes, receipts, allSoftware, history, documents, lines] = await Promise.all([
    api(`/assets?employeeId=${encodeURIComponent(emp.id)}&status=Assigned&limit=500`),
    api(`/assets?responsibleEmployeeId=${encodeURIComponent(emp.id)}&categories=Network,Server&limit=500`).catch(() => ({ items: [] })),
    api(`/handovers?employeeId=${encodeURIComponent(emp.id)}&limit=20`),
    // includeRevoked so past software zimmet also shows in the history timeline.
    api(`/licenses/assignments?employeeId=${encodeURIComponent(emp.id)}&includeRevoked=true`),
    api(`/employees/${encodeURIComponent(emp.id)}/history?limit=50`).catch(() => []),
    api(`/employees/${encodeURIComponent(emp.id)}/documents`).catch(() => []),
    api(`/lines?employeeId=${encodeURIComponent(emp.id)}`).catch(() => []),
  ]);
  const assets = assetsRes.items;
  const infra = (infraRes && infraRes.items) || [];
  const software = allSoftware.filter((s) => !s.revokedAt); // active only, for the overview

  // Merge device + software + mobile-line events into one activity timeline.
  const swEvents = [];
  allSoftware.forEach((s) => {
    swEvents.push({ ts: s.assignedAt, type: 'software_assigned', label: s.softwareName, by: s.assignedByName, kind: 'software' });
    if (s.revokedAt) swEvents.push({ ts: s.revokedAt, type: 'software_revoked', label: s.softwareName, by: s.revokedByName || '', kind: 'software' });
  });
  const timeline = [
    ...history.map((h) => ({
      ts: h.timestamp,
      type: h.actionType,
      label: h.label || h.assetTag,
      by: h.changedByName,
      notes: h.notes,
      kind: h.kind || 'device',
    })),
    ...swEvents,
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const fmtKB = (n) => (n >= 1024 * 1024 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  openModal({
    title: `${emp.fullName} — Assigned Assets`,
    wide: true,
    body: `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <span class="avatar" style="width:44px;height:44px;font-size:15px">${esc(initials(emp.fullName))}</span>
        <div>
          <div class="cell-title" style="font-size:16px">${esc(emp.fullName)}</div>
          <div class="cell-sub">${esc(emp.title || '—')} • ${esc(emp.department || '—')} • ${esc(emp.email)}</div>
        </div>
        <span style="margin-left:auto">${badge(emp.status)}</span>
      </div>

      <div class="tabs">
        <button class="tab active" data-tab="overview">${esc(t('common.overview'))}</button>
        <button class="tab" data-tab="history">${esc(t('common.history'))} (${timeline.length})</button>
        <button class="tab" data-tab="documents">${esc(t('common.documents'))} (${documents.length})</button>
      </div>
      <div id="tab-overview">
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--on-surface-variant);margin:0 0 8px">
        ${esc(t('emp.assignedAssets'))} (${assets.length})</h3>
      ${assets.length === 0 ? `<div class="cell-sub" style="margin-bottom:16px">${esc(t('emp.noAssets'))}</div>` : `
      <div class="table-wrap" style="margin-bottom:18px;border:1px solid var(--outline-variant);border-radius:var(--radius-lg)">
        <table class="data">
          <thead><tr><th>Asset Tag</th><th>Brand &amp; Model</th><th>Serial No</th><th>Category</th>${canEdit ? '<th style="text-align:right"></th>' : ''}</tr></thead>
          <tbody>
            ${assets.map((a) => `
            <tr>
              <td class="mono">${esc(a.assetTag)}</td>
              <td><div style="display:flex;align-items:center;gap:8px">
                <span class="ms" style="color:var(--on-surface-variant)">${catIcon(a.category)}</span>
                <span class="cell-title">${esc(a.brand)} ${esc(a.model)}</span></div></td>
              <td class="mono">${esc(a.serialNumber)}</td>
              <td class="cell-sub">${esc(a.category)}</td>
              ${canEdit ? `<td class="actions">
                <button class="btn btn-outline btn-sm" data-return-asset="${esc(a.id)}">
                  <span class="ms">undo</span> Return</button></td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}

      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--on-surface-variant);margin:0 0 8px">
        ${esc(t('emp.infraResponsible'))} (${infra.length})</h3>
      ${infra.length === 0 ? `<div class="cell-sub" style="margin-bottom:16px">${esc(t('emp.noInfra'))}</div>` : `
      <div class="table-wrap" style="margin-bottom:18px;border:1px solid var(--outline-variant);border-radius:var(--radius-lg)">
        <table class="data">
          <thead><tr><th>Asset Tag</th><th>Device</th><th>Location</th><th>Category</th></tr></thead>
          <tbody>
            ${infra.map((a) => `
            <tr>
              <td class="mono">${esc(a.assetTag)}</td>
              <td><div style="display:flex;align-items:center;gap:8px">
                <span class="ms" style="color:var(--on-surface-variant)">${catIcon(a.category)}</span>
                <span class="cell-title">${esc(a.brand)} ${esc(a.model)}</span></div></td>
              <td>${esc(a.location || '—')}</td>
              <td class="cell-sub">${esc(a.category)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}

      <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px">
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--on-surface-variant);margin:0">
          ${esc(t('emp.assignedSoftware'))} (${software.length})</h3>
        ${canEdit ? `<button class="btn btn-outline btn-sm" id="emp-assign-sw"><span class="ms">add</span> ${esc(t('emp.assignSoftware'))}</button>` : ''}
      </div>
      ${software.length === 0 ? `<div class="cell-sub" style="margin-bottom:16px">${esc(t('emp.noSoftware'))}</div>` : `
      <div style="margin-bottom:18px">
        ${software.map((s) => `
        <div class="history-item" style="justify-content:space-between">
          <span><span class="ms" style="color:var(--on-surface-variant);margin-right:8px">vpn_key</span>
            <strong>${esc(s.softwareName)}</strong></span>
          <span class="cell-sub">${fmtDate(s.assignedAt)} • by ${esc(s.assignedByName || '—')}</span>
          ${canEdit ? `<button class="btn btn-outline btn-sm" data-revoke-sw="${esc(s.id)}">Revoke</button>` : ''}
        </div>`).join('')}
      </div>`}

      <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px">
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--on-surface-variant);margin:0">
          ${esc(t('emp.mobileLines'))} (${lines.length})</h3>
        ${canEdit ? `<button class="btn btn-outline btn-sm" id="emp-assign-line"><span class="ms">add</span> ${esc(t('emp.assignLine'))}</button>` : ''}
      </div>
      ${lines.length === 0 ? `<div class="cell-sub" style="margin-bottom:16px">${esc(t('emp.noLines'))}</div>` : `
      <div class="table-wrap" style="margin-bottom:18px;border:1px solid var(--outline-variant);border-radius:var(--radius-lg)">
        <table class="data">
          <thead><tr><th>${esc(t('lines.phone'))}</th><th>${esc(t('lines.operator'))}</th><th>${esc(t('lines.plan'))}</th><th>${esc(t('lines.sim'))}</th>${canEdit ? '<th style="text-align:right"></th>' : ''}</tr></thead>
          <tbody>
            ${lines.map((l) => `
            <tr>
              <td class="mono cell-title">${esc(l.phoneNumber)}</td>
              <td>${esc(l.operator || '—')}</td>
              <td class="cell-sub">${esc(l.plan || '—')}</td>
              <td class="mono cell-sub">${esc(l.simSerial || '—')}</td>
              ${canEdit ? `<td class="actions">
                <button class="btn btn-outline btn-sm" data-return-line="${esc(l.id)}">
                  <span class="ms">undo</span> ${esc(t('emp.unassign'))}</button></td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}

      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--on-surface-variant);margin:0 0 8px">
        ${esc(t('emp.handoverReceipts'))} (${receipts.length})</h3>
      ${receipts.length === 0 ? '<div class="cell-sub">No handover receipts yet.</div>' :
        receipts.map((h) => `
        <div class="history-item" style="justify-content:space-between">
          <span class="when">${fmtDateTime(h.transactionDate)}</span>
          <span>${(h.items || []).length} item(s) • <span class="cell-sub">${esc(h.documentType)}</span></span>
          <button class="btn btn-outline btn-sm" data-reprint="${esc(h.id)}"><span class="ms">print</span> Reprint Form</button>
        </div>`).join('')}

      </div>
      <div id="tab-history" class="hidden">
        <div class="cell-sub" style="margin-bottom:10px">${esc(t('emp.historyHint'))}</div>
        ${timeline.length === 0 ? `<div class="table-empty">${esc(t('emp.noHistory'))}</div>` :
          `<div style="max-height:340px;overflow-y:auto">` +
          timeline.map((ev) => `
          <div class="history-item" style="flex-wrap:wrap">
            <span class="when">${fmtDateTime(ev.ts)}</span>
            <span>${ev.kind === 'software'
              ? `<span class="pill ${ev.type === 'software_revoked' ? 'pill-rose' : 'pill-indigo'}"><span class="ms ms-sm">vpn_key</span> ${esc(ev.type === 'software_revoked' ? t('emp.swRevoked') : t('emp.swAssigned'))}</span>`
              : ev.kind === 'line'
                ? `<span class="pill ${ev.type === 'line_unassigned' ? 'pill-rose' : 'pill-blue'}"><span class="ms ms-sm">sim_card</span> ${esc(ev.type === 'line_unassigned' ? t('emp.lineReturned') : t('emp.lineAssigned'))}</span>`
                : empDeviceHistoryBadge(ev.type)}</span>
            <span class="mono">${esc(ev.label)}</span>
            <span class="cell-sub">by ${esc(ev.by || '—')}</span>
            ${ev.notes ? `<span class="cell-sub" style="flex-basis:100%;padding-left:2px">↳ ${esc(ev.notes)}</span>` : ''}
          </div>`).join('') + '</div>'}
      </div>

      <div id="tab-documents" class="hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div class="cell-sub">Handover forms are auto-archived here. Upload signed/scanned copies (PDF or image).</div>
          ${canEdit ? '<button class="btn btn-primary btn-sm" id="doc-upload-btn"><span class="ms">upload_file</span> Upload scan</button>' : ''}
        </div>
        <input type="file" id="doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
        ${documents.length === 0 ? '<div class="table-empty">No documents yet. Execute a handover or upload a signed scan.</div>' : `
        <div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
          <thead><tr><th>Document</th><th>Type</th><th>Size</th><th>Added</th><th style="text-align:right"></th></tr></thead>
          <tbody>
            ${documents.map((d) => `
            <tr>
              <td><div style="display:flex;align-items:center;gap:8px">
                <span class="ms" style="color:var(--on-surface-variant)">${d.mime && d.mime.includes('pdf') ? 'picture_as_pdf' : 'image'}</span>
                <a href="#" class="cell-title doc-link" data-doc-view="${esc(d.id)}" title="Click to view">${esc(d.filename)}</a></div></td>
              <td>${d.kind === 'scan' ? '<span class="pill pill-emerald">Signed scan</span>' : '<span class="pill pill-indigo">Generated</span>'}</td>
              <td class="cell-sub">${fmtKB(d.byteSize || 0)}</td>
              <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' • ' + esc(d.uploadedByName) : ''}</td>
              <td class="actions">
                <button type="button" class="btn btn-outline btn-sm" data-doc-view="${esc(d.id)}" title="${esc(t('common.view'))}"><span class="ms">visibility</span></button>
                <button type="button" class="btn btn-outline btn-sm" data-doc-dl="${esc(d.id)}" title="${esc(t('common.download'))}"><span class="ms">download</span></button>
                ${canDelDoc ? `<button type="button" class="btn btn-outline btn-sm" data-doc-del="${esc(d.id)}"><span class="ms">delete</span></button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>`,
    foot: `
      <button class="btn btn-outline" data-close>Close</button>
      ${canEdit && emp.status === 'Active' ? `
        <button class="btn btn-outline" id="emp-onboard-one"><span class="ms">event_available</span> ${esc(t('emp.onboard'))}</button>
        <button class="btn btn-outline" id="emp-offboard"><span class="ms">person_off</span> ${esc(t('emp.offboard'))}</button>` : ''}
      <button class="btn btn-primary" id="emp-print-current" ${assets.length === 0 ? 'disabled' : ''}>
        <span class="ms">print</span> Generate Current Asset Form</button>`,
    onMount(overlay) {
      // Tab switching
      overlay.querySelectorAll('.tab').forEach((tb) => tb.addEventListener('click', () => {
        overlay.querySelectorAll('.tab').forEach((t2) => t2.classList.toggle('active', t2 === tb));
        $('#tab-overview', overlay).classList.toggle('hidden', tb.dataset.tab !== 'overview');
        $('#tab-history', overlay).classList.toggle('hidden', tb.dataset.tab !== 'history');
        $('#tab-documents', overlay).classList.toggle('hidden', tb.dataset.tab !== 'documents');
      }));

      const obnBtn = $('#emp-onboard-one', overlay);
      if (obnBtn) obnBtn.addEventListener('click', () => {
        closeModal();
        openOnboardWizard(emp);
      });

      const obBtn = $('#emp-offboard', overlay);
      if (obBtn) obBtn.addEventListener('click', () => {
        closeModal();
        openOffboardWizard(emp);
      });

      // Filename or eye icon → stacked document lightbox (keeps employee modal open).
      overlay.querySelectorAll('[data-doc-view]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        viewAuthed(`/api/documents/${a.dataset.docView}/download`);
      }));

      // Authenticated document download (Bearer token can't ride on a plain <a>).
      overlay.querySelectorAll('[data-doc-dl]').forEach((a) => a.addEventListener('click', async (e) => {
        e.preventDefault();
        downloadAuthed(`/api/documents/${a.dataset.docDl}/download`);
      }));

      // Upload a signed/scanned copy.
      const upBtn = $('#doc-upload-btn', overlay);
      const upFile = $('#doc-file', overlay);
      if (upBtn && upFile) {
        upBtn.addEventListener('click', () => upFile.click());
        upFile.addEventListener('change', async () => {
          const file = upFile.files[0];
          if (!file) return;
          if (file.size > 8 * 1024 * 1024) { toast('File too large — max 8MB (PDF, PNG, JPEG, WebP)', 'error'); return; }
          upBtn.disabled = true;
          try {
            const base64 = await new Promise((res, rej) => {
              const r = new FileReader();
              r.onload = () => res(r.result);
              r.onerror = rej;
              r.readAsDataURL(file);
            });
            await api(`/employees/${emp.id}/documents`, {
              method: 'POST',
              body: { filename: file.name, mime: file.type || 'application/pdf', base64, employeeName: emp.fullName },
            });
            toast(`"${file.name}" uploaded to ${emp.fullName}'s archive`, 'success');
            showEmployeeDetail(emp);
          } catch (err) { toast(err.message, 'error'); upBtn.disabled = false; }
        });
      }

      // Delete an archived document.
      overlay.querySelectorAll('[data-doc-del]').forEach((b) => b.addEventListener('click', () => {
        confirmModal('Delete this archived document permanently?', async () => {
          await api('/documents/' + b.dataset.docDel, { method: 'DELETE' });
          toast('Document deleted', 'success');
          showEmployeeDetail(emp);
        });
      }));

      // Software zimmet: assign a license seat to this employee.
      const swBtn = $('#emp-assign-sw', overlay);
      if (swBtn) swBtn.addEventListener('click', async () => {
        const licenses = (await api('/licenses')).filter((l) => l.usedSeats < l.totalSeats);
        formModal({
          title: `Assign software to ${emp.fullName}`,
          fields: [{
            name: 'licenseId', label: 'Software / License *', type: 'select', required: true,
            options: [{ value: '', label: licenses.length ? 'Select software…' : 'No licenses with free seats' },
              ...licenses.map((l) => ({ value: l.id, label: `${l.softwareName} (${l.usedSeats}/${l.totalSeats} seats)` }))],
            full: true,
          }],
          submitLabel: 'Assign software',
          async onSubmit(d) {
            if (!d.licenseId) throw new Error('Select a license');
            const r = await api(`/licenses/${d.licenseId}/assign`, { method: 'POST', body: { employeeId: emp.id } });
            toast(`${r.softwareName} assigned to ${r.employeeName}`, 'success');
            showEmployeeDetail(emp);
          },
        });
      });

      // Software zimmet düşürme: revoke a license from this employee.
      overlay.querySelectorAll('[data-revoke-sw]').forEach((rb) => rb.addEventListener('click', async () => {
        try {
          const r = await api(`/licenses/assignments/${rb.dataset.revokeSw}/revoke`, { method: 'POST' });
          toast(`${r.softwareName} revoked from ${r.employeeName}`, 'success');
          showEmployeeDetail(emp);
        } catch (err) { toast(err.message, 'error'); }
      }));

      // Mobile line zimmet: assign a free Active line to this employee.
      const lineBtn = $('#emp-assign-line', overlay);
      if (lineBtn) lineBtn.addEventListener('click', async () => {
        const free = (await api('/lines?status=Active')).filter((l) => !l.currentEmployeeId);
        formModal({
          title: `Assign mobile line to ${emp.fullName}`,
          fields: [{
            name: 'lineId', label: 'Mobile line *', type: 'select', required: true, full: true,
            options: [{ value: '', label: free.length ? 'Select a line…' : 'No unassigned Active lines' },
              ...free.map((l) => ({
                value: l.id,
                label: `${l.phoneNumber}${l.operator ? ' · ' + l.operator : ''}${l.plan ? ' · ' + l.plan : ''}`,
              }))],
          }],
          submitLabel: 'Assign line',
          async onSubmit(d) {
            if (!d.lineId) throw new Error('Select a line');
            const r = await api(`/lines/${d.lineId}/assign`, { method: 'POST', body: { employeeId: emp.id } });
            toast(`${r.phoneNumber} assigned to ${r.currentEmployeeName}`, 'success');
            showEmployeeDetail(emp);
          },
        });
      });

      overlay.querySelectorAll('[data-return-line]').forEach((b) => b.addEventListener('click', () => {
        const line = lines.find((x) => x.id === b.dataset.returnLine);
        confirmModal(`Unassign ${line ? line.phoneNumber : 'this line'} from ${emp.fullName}?`, async () => {
          await api(`/lines/${b.dataset.returnLine}/unassign`, { method: 'POST' });
          toast('Mobile line returned', 'success');
          showEmployeeDetail(emp);
        });
      }));

      // Return (zimmet düşürme): take an asset off this employee, back to stock.
      overlay.querySelectorAll('[data-return-asset]').forEach((b) => b.addEventListener('click', () => {
        const a = assets.find((x) => x.id === b.dataset.returnAsset);
        formModal({
          title: `Return ${a.assetTag} — ${a.brand} ${a.model}`,
          fields: [{
            name: 'conditionNote', label: 'Return condition note', type: 'textarea', full: true,
            placeholder: 'e.g. Returned in working condition / Çalışır durumda iade edildi',
          }],
          submitLabel: 'Return to stock',
          async onSubmit(d) {
            await api(`/assets/${a.id}/return`, { method: 'POST', body: d });
            toast(`${a.assetTag} returned to stock — removed from ${emp.fullName}`, 'success');
            // Refresh the employees table underneath, then reopen this detail.
            if (location.hash === '#/employees') Views.employees($('#view'));
            const fresh = await api(`/employees/${emp.id}`).catch(() => emp);
            showEmployeeDetail(fresh);
          },
        });
      }));
      // Reprint a past receipt exactly as it was recorded.
      overlay.querySelectorAll('[data-reprint]').forEach((b) => b.addEventListener('click', async () => {
        printHandover(await api('/handovers/' + b.dataset.reprint));
      }));
      // Regenerate a fresh Zimmet Tutanağı covering everything currently assigned
      // (devices + mobile lines).
      const cur = $('#emp-print-current', overlay);
      if (cur) cur.addEventListener('click', () => {
        const assetItems = assets.map((a) => ({
          kind: 'asset',
          assetTag: a.assetTag,
          brand: a.brand,
          model: a.model,
          category: a.category,
          serialNumber: a.serialNumber,
          macAddress: a.macEthernet || a.macWifi || null,
          conditionNote: 'In use / Kullanımda',
        }));
        const lineItems = (lines || []).map((l) => ({
          kind: 'line',
          lineId: l.id,
          phoneNumber: l.phoneNumber,
          operator: l.operator,
          plan: l.plan,
          simSerial: l.simSerial,
          conditionNote: 'In use / Kullanımda',
        }));
        printHandover({
          id: emp.id,
          employeeId: emp.id,
          employeeName: emp.fullName,
          transactionDate: new Date().toISOString(),
          documentType: 'single',
          items: [...assetItems, ...lineItems],
        });
      });
    },
  });
}

async function openOffboardWizard(emp) {
  let checklist;
  try {
    checklist = await api(`/employees/${encodeURIComponent(emp.id)}/offboarding`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const c = checklist.counts || {};
  const excludeIds = [emp.id];

  const hwActions = `
    <option value="return">${esc(t('emp.offboardReturn'))}</option>
    <option value="reassign">${esc(t('emp.offboardReassign'))}</option>
    <option value="scrap">${esc(t('emp.offboardScrap'))}</option>
    <option value="sell">${esc(t('emp.offboardSell'))}</option>`;
  const lineActions = `
    <option value="unassign">${esc(t('emp.offboardUnassign'))}</option>
    <option value="reassign">${esc(t('emp.offboardReassign'))}</option>`;
  const licActions = `
    <option value="revoke">${esc(t('emp.offboardRevoke'))}</option>
    <option value="reassign">${esc(t('emp.offboardReassign'))}</option>`;
  const infraActions = `
    <option value="clear">${esc(t('emp.offboardClear'))}</option>
    <option value="reassign">${esc(t('emp.offboardReassign'))}</option>`;

  function rowHtml(kind, id, label, sub, actionsHtml) {
    return `
      <tr data-ob-row="${esc(kind)}" data-id="${esc(id)}">
        <td>
          <div class="cell-title">${esc(label)}</div>
          ${sub ? `<div class="cell-sub">${esc(sub)}</div>` : ''}
        </td>
        <td>
          <select class="ob-action" style="min-width:150px">${actionsHtml}</select>
        </td>
        <td style="min-width:260px;vertical-align:top">
          <div class="ob-to-host emp-search-host hidden"></div>
          ${kind === 'asset' ? `
          <div class="ob-sale-host hidden">
            <div class="ob-sale-grid">
              <label class="ob-sale-field">
                <span>${esc(t('emp.offboardSalePrice'))}</span>
                <input type="text" class="ob-sale-price" placeholder="${esc(moneyExample(1500))}" maxlength="40">
              </label>
              <label class="ob-sale-field">
                <span>${esc(t('emp.offboardSaleApprovedBy'))} *</span>
                <input type="text" class="ob-sale-approved" placeholder="${esc(t('emp.offboardSaleApprovedByPh'))}" maxlength="120" required>
              </label>
              <label class="ob-sale-field">
                <span>${esc(t('emp.offboardSaleBuyer'))}</span>
                <input type="text" class="ob-sale-buyer" placeholder="${esc(t('emp.offboardSaleBuyerPh'))}" maxlength="120">
              </label>
              <label class="ob-sale-field">
                <span>${esc(t('emp.offboardSaleDate'))}</span>
                <input type="date" class="ob-sale-date">
              </label>
              <label class="ob-sale-field ob-sale-full">
                <span>${esc(t('emp.offboardSaleNote'))}</span>
                <input type="text" class="ob-sale-note" placeholder="${esc(t('emp.offboardSaleNotePh'))}" maxlength="500">
              </label>
            </div>
          </div>` : ''}
        </td>
      </tr>`;
  }

  const assetRows = (checklist.assets || []).map((a) =>
    rowHtml('asset', a.id, `${a.brand} ${a.model}`, `${a.assetTag} · ${a.category}`, hwActions)
  ).join('');
  const licRows = (checklist.licenses || []).map((l) =>
    rowHtml('license', l.id, l.softwareName, fmtDate(l.assignedAt), licActions)
  ).join('');
  const lineRows = (checklist.lines || []).map((l) =>
    rowHtml('line', l.id, l.phoneNumber, [l.operator, l.plan].filter(Boolean).join(' · '), lineActions)
  ).join('');
  const infraRows = (checklist.infra || []).map((a) =>
    rowHtml('infra', a.id, `${a.brand} ${a.model}`,
      `${a.assetTag} · ${a.location || t('network.noLocation')} · ${a.infraRole || a.category}`,
      infraActions)
  ).join('');

  function section(title, count, presetBtns, rows) {
    if (!count) return '';
    return `
      <div class="ob-board-section">
        <div class="ob-board-head">
          <h3>${esc(title)} (${count})</h3>
          <div class="ob-board-presets">${presetBtns}</div>
        </div>
        <div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg);margin-bottom:14px">
          <table class="data">
            <thead><tr><th>Item</th><th>Action</th><th>${esc(t('emp.offboardColDetails'))}</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  openModal({
    title: `${t('emp.offboardTitle')} — ${emp.fullName}`,
    wide: true,
    body: `
      <p class="cell-sub" style="margin:0 0 12px">${esc(t('emp.offboardHint'))}</p>
      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(t('emp.offboardAssets'))}</h3></div>
          <div class="metric-value" style="font-size:22px">${c.assets || 0}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(t('emp.offboardSoftware'))}</h3></div>
          <div class="metric-value" style="font-size:22px">${c.licenses || 0}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(t('emp.offboardLines'))}</h3></div>
          <div class="metric-value" style="font-size:22px">${c.lines || 0}</div></div>
        <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">${esc(t('emp.offboardInfra'))}</h3></div>
          <div class="metric-value" style="font-size:22px">${c.infra || 0}</div></div>
      </div>
      ${(c.total || 0) === 0
        ? `<div class="banner banner-amber" style="margin-bottom:12px">${esc(t('emp.offboardEmpty'))}</div>`
        : ''}
      ${section(t('emp.offboardAssets'), c.assets, `
        <button type="button" class="btn btn-outline btn-sm" data-preset="asset:return">${esc(t('emp.offboardPresetReturn'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="asset:reassign">${esc(t('emp.offboardPresetReassign'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="asset:scrap">${esc(t('emp.offboardPresetScrap'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="asset:sell">${esc(t('emp.offboardPresetSell'))}</button>
      `, assetRows)}
      ${section(t('emp.offboardSoftware'), c.licenses, `
        <button type="button" class="btn btn-outline btn-sm" data-preset="license:revoke">${esc(t('emp.offboardPresetRevoke'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="license:reassign">${esc(t('emp.offboardPresetReassign'))}</button>
      `, licRows)}
      ${section(t('emp.offboardLines'), c.lines, `
        <button type="button" class="btn btn-outline btn-sm" data-preset="line:unassign">${esc(t('emp.offboardPresetUnassign'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="line:reassign">${esc(t('emp.offboardPresetReassign'))}</button>
      `, lineRows)}
      ${section(t('emp.offboardInfra'), c.infra, `
        <button type="button" class="btn btn-outline btn-sm" data-preset="infra:clear">${esc(t('emp.offboardPresetClear'))}</button>
        <button type="button" class="btn btn-outline btn-sm" data-preset="infra:reassign">${esc(t('emp.offboardPresetReassign'))}</button>
      `, infraRows)}
      <label class="ob-check" style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input type="checkbox" id="ob-deactivate" checked>
        <span>${esc(t('emp.offboardDeactivate'))}</span>
      </label>
      <div id="ob-bulk-target" class="hidden" style="margin-top:12px;max-width:480px">
        <label class="cell-sub">${esc(t('emp.offboardPickPerson'))}</label>
        <div id="ob-bulk-host" class="emp-search-host" style="margin-top:6px"></div>
      </div>
      <div id="ob-sale-bulk" class="ob-sale-bulk hidden">
        <div class="ob-sale-bulk-head">
          <span class="ms ms-sm">sell</span>
          <strong>${esc(t('emp.offboardSaleBulkTitle'))}</strong>
          <span class="cell-sub">${esc(t('emp.offboardSaleBulkHint'))}</span>
        </div>
        <div class="ob-sale-grid">
          <label class="ob-sale-field">
            <span>${esc(t('emp.offboardSalePrice'))}</span>
            <input type="text" id="ob-sale-bulk-price" placeholder="${esc(moneyExample(1500))}" maxlength="40">
          </label>
          <label class="ob-sale-field">
            <span>${esc(t('emp.offboardSaleApprovedBy'))} *</span>
            <input type="text" id="ob-sale-bulk-approved" placeholder="${esc(t('emp.offboardSaleApprovedByPh'))}" maxlength="120">
          </label>
          <label class="ob-sale-field">
            <span>${esc(t('emp.offboardSaleBuyer'))}</span>
            <input type="text" id="ob-sale-bulk-buyer" placeholder="${esc(t('emp.offboardSaleBuyerPh'))}" maxlength="120">
          </label>
          <label class="ob-sale-field">
            <span>${esc(t('emp.offboardSaleDate'))}</span>
            <input type="date" id="ob-sale-bulk-date">
          </label>
          <label class="ob-sale-field ob-sale-full">
            <span>${esc(t('emp.offboardSaleNote'))}</span>
            <input type="text" id="ob-sale-bulk-note" placeholder="${esc(t('emp.offboardSaleNotePh'))}" maxlength="500">
          </label>
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="ob-sale-bulk-apply">${esc(t('emp.offboardSaleBulkApply'))}</button>
      </div>
      <div id="ob-error" class="form-error hidden" style="margin-top:10px"></div>`,
    foot: `
      <button class="btn btn-outline" data-close>Cancel</button>
      <button class="btn btn-primary" id="ob-submit"><span class="ms">person_off</span> ${esc(t('emp.offboardSubmit'))}</button>`,
    onMount(overlay) {
      const pickers = new Map();

      function mountRowPicker(tr) {
        const host = tr.querySelector('.ob-to-host');
        if (!host || pickers.has(tr)) return;
        const picker = mountEmployeeSearchField(host, {
          name: `ob-to-${tr.dataset.obRow}-${tr.dataset.id}`,
          excludeIds,
          placeholder: t('common.searchEmployee') || t('emp.offboardPickPerson'),
        });
        pickers.set(tr, picker);
      }

      function syncToSelect(tr) {
        const act = tr.querySelector('.ob-action')?.value;
        const host = tr.querySelector('.ob-to-host');
        const saleHost = tr.querySelector('.ob-sale-host');
        if (host) {
          const showReassign = act === 'reassign';
          host.classList.toggle('hidden', !showReassign);
          if (showReassign) mountRowPicker(tr);
          else pickers.get(tr)?.clear();
        }
        if (saleHost) {
          saleHost.classList.toggle('hidden', act !== 'sell');
        }
        syncSaleBulk();
      }

      function syncSaleBulk() {
        const box = $('#ob-sale-bulk', overlay);
        if (!box) return;
        const anySell = [...overlay.querySelectorAll('tr[data-ob-row="asset"]')].some(
          (tr) => tr.querySelector('.ob-action')?.value === 'sell'
        );
        box.classList.toggle('hidden', !anySell);
      }

      function readSaleFrom(el) {
        if (!el) return null;
        const approvedBy = (el.querySelector('.ob-sale-approved')?.value || '').trim();
        const price = (el.querySelector('.ob-sale-price')?.value || '').trim();
        const buyer = (el.querySelector('.ob-sale-buyer')?.value || '').trim();
        const date = (el.querySelector('.ob-sale-date')?.value || '').trim();
        const note = (el.querySelector('.ob-sale-note')?.value || '').trim();
        if (!approvedBy && !price && !buyer && !date && !note) return null;
        return { approvedBy, price, buyer, date, note };
      }

      function writeSaleTo(host, sale) {
        if (!host || !sale) return;
        const set = (sel, v) => { const i = host.querySelector(sel); if (i && v != null) i.value = v; };
        set('.ob-sale-price', sale.price || '');
        set('.ob-sale-approved', sale.approvedBy || '');
        set('.ob-sale-buyer', sale.buyer || '');
        set('.ob-sale-date', sale.date || '');
        set('.ob-sale-note', sale.note || '');
      }

      overlay.querySelectorAll('[data-ob-row]').forEach((tr) => {
        syncToSelect(tr);
        tr.querySelector('.ob-action')?.addEventListener('change', () => syncToSelect(tr));
      });

      $('#ob-sale-bulk-apply', overlay)?.addEventListener('click', () => {
        const sale = {
          price: ($('#ob-sale-bulk-price', overlay)?.value || '').trim(),
          approvedBy: ($('#ob-sale-bulk-approved', overlay)?.value || '').trim(),
          buyer: ($('#ob-sale-bulk-buyer', overlay)?.value || '').trim(),
          date: ($('#ob-sale-bulk-date', overlay)?.value || '').trim(),
          note: ($('#ob-sale-bulk-note', overlay)?.value || '').trim(),
        };
        overlay.querySelectorAll('tr[data-ob-row="asset"]').forEach((tr) => {
          if (tr.querySelector('.ob-action')?.value !== 'sell') return;
          writeSaleTo(tr.querySelector('.ob-sale-host'), sale);
        });
      });

      let pendingPreset = null;
      const bulkBox = $('#ob-bulk-target', overlay);
      const bulkHost = $('#ob-bulk-host', overlay);
      let bulkPicker = null;

      function ensureBulkPicker() {
        if (bulkPicker || !bulkHost) return;
        bulkPicker = mountEmployeeSearchField(bulkHost, {
          name: 'ob-bulk-person',
          excludeIds,
          placeholder: t('common.searchEmployee') || t('emp.offboardPickPerson'),
          onChange(selected) {
            if (!pendingPreset || !selected?.id) return;
            const { kind, action } = pendingPreset;
            overlay.querySelectorAll(`tr[data-ob-row="${kind}"]`).forEach((tr) => {
              const sel = tr.querySelector('.ob-action');
              if (sel) sel.value = action;
              syncToSelect(tr);
              pickers.get(tr)?.setSelected(selected);
            });
            pendingPreset = null;
            bulkBox.classList.add('hidden');
            bulkPicker?.clear();
          },
        });
      }

      overlay.querySelectorAll('[data-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [kind, action] = btn.dataset.preset.split(':');
          if (action === 'reassign') {
            pendingPreset = { kind, action };
            ensureBulkPicker();
            bulkBox.classList.remove('hidden');
            bulkPicker?.clear();
            return;
          }
          pendingPreset = null;
          bulkBox.classList.add('hidden');
          overlay.querySelectorAll(`tr[data-ob-row="${kind}"]`).forEach((tr) => {
            const sel = tr.querySelector('.ob-action');
            if (sel) { sel.value = action; syncToSelect(tr); }
          });
        });
      });

      function rowTargetId(tr) {
        return pickers.get(tr)?.getId() || undefined;
      }

      $('#ob-submit', overlay).addEventListener('click', async () => {
        const errEl = $('#ob-error', overlay);
        errEl.classList.add('hidden');
        const payload = {
          assets: [],
          licenses: [],
          lines: [],
          infra: [],
          deactivate: !!$('#ob-deactivate', overlay)?.checked,
        };
        try {
          overlay.querySelectorAll('tr[data-ob-row="asset"]').forEach((tr) => {
            const action = tr.querySelector('.ob-action').value;
            const toEmployeeId = rowTargetId(tr);
            if (action === 'reassign' && !toEmployeeId) throw new Error(t('emp.offboardNeedTarget'));
            const item = { assetId: tr.dataset.id, action, toEmployeeId };
            if (action === 'sell') {
              const sale = readSaleFrom(tr.querySelector('.ob-sale-host'));
              if (!sale?.approvedBy) throw new Error(t('emp.offboardNeedSale'));
              item.sale = sale;
            }
            payload.assets.push(item);
          });
          overlay.querySelectorAll('tr[data-ob-row="license"]').forEach((tr) => {
            const action = tr.querySelector('.ob-action').value;
            const toEmployeeId = rowTargetId(tr);
            if (action === 'reassign' && !toEmployeeId) throw new Error(t('emp.offboardNeedTarget'));
            payload.licenses.push({ assignmentId: tr.dataset.id, action, toEmployeeId });
          });
          overlay.querySelectorAll('tr[data-ob-row="line"]').forEach((tr) => {
            const action = tr.querySelector('.ob-action').value;
            const toEmployeeId = rowTargetId(tr);
            if (action === 'reassign' && !toEmployeeId) throw new Error(t('emp.offboardNeedTarget'));
            payload.lines.push({ lineId: tr.dataset.id, action, toEmployeeId });
          });
          overlay.querySelectorAll('tr[data-ob-row="infra"]').forEach((tr) => {
            const action = tr.querySelector('.ob-action').value;
            const toEmployeeId = rowTargetId(tr);
            if (action === 'reassign' && !toEmployeeId) throw new Error(t('emp.offboardNeedTarget'));
            payload.infra.push({ assetId: tr.dataset.id, action, toEmployeeId });
          });

          $('#ob-submit', overlay).disabled = true;
          await api(`/employees/${encodeURIComponent(emp.id)}/offboard`, { method: 'POST', body: payload });
          toast(t('emp.offboardDone'), 'success');
          closeModal();
          if (location.hash.startsWith('#/employees')) {
            const params = Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));
            const viewEl = document.getElementById('view');
            if (viewEl) Views.employees(viewEl, params);
          }
        } catch (err) {
          $('#ob-submit', overlay).disabled = false;
          errEl.textContent = err.message || String(err);
          errEl.classList.remove('hidden');
        }
      });
    },
  });
}

function employeeForm(emp, done) {
  formModal({
    title: emp ? `Edit ${emp.fullName}` : 'Add New Employee',
    fields: [
      { name: 'fullName', label: 'Full name *', required: true, value: emp?.fullName },
      { name: 'email', label: 'Email *', type: 'email', required: true, value: emp?.email },
      // Departments are managed centrally in Product Catalog; keep an unknown
      // legacy value selectable so editing an old employee doesn't lose it.
      { name: 'department', label: 'Department', type: 'select', value: emp?.department || '',
        options: [{ value: '', label: '— No department —' },
          ...(emp?.department && !(AppConfig.departments || []).includes(emp.department) ? [emp.department] : []),
          ...(AppConfig.departments || [])] },
      { name: 'title', label: 'Title', value: emp?.title },
      { name: 'status', label: 'Status', type: 'select', value: emp?.status || 'Active', options: ['Active', 'Inactive'] },
    ],
    async onSubmit(d) {
      if (emp) await api(`/employees/${emp.id}`, { method: 'PUT', body: d });
      else await api('/employees', { method: 'POST', body: d });
      toast(emp ? 'Employee updated' : 'Employee created', 'success');
      done();
    },
  });
}

