
Views.stockcount = async function (el, params = {}) {
  const canDo = Auth.can('canManageAssets');
  const counts = await api('/counts');
  const openId = params.open || (counts.find((c) => c.status === 'open') || {}).id;

  el.innerHTML = `
    ${pageHead('Stock Count', 'Physical inventory: scan devices and reconcile against the system.', canDo
      ? `<button class="btn btn-primary" id="sc-new"><span class="ms">add</span> ${esc(t('stock.startNew'))}</button>` : '')}
    <div id="sc-active"></div>
    <div class="gs-section" style="margin:20px 0 8px">${esc(t('stock.sessions'))}</div>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Session</th><th>Location</th><th>Status</th><th>Scans</th><th>Started</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${counts.length === 0 ? '<tr><td colspan="6" class="table-empty">No counts yet — start one to begin scanning.</td></tr>' :
          counts.map((c) => `
          <tr>
            <td class="cell-title">${esc(c.name)}</td>
            <td>${esc(c.location || 'All locations')}</td>
            <td>${c.status === 'open' ? '<span class="pill pill-emerald">Open</span>' : '<span class="pill pill-indigo">Closed</span>'}</td>
            <td>${c.scanCount ?? ''}</td>
            <td class="cell-sub">${fmtDateTime(c.createdAt)}${c.createdByName ? ' • ' + esc(c.createdByName) : ''}</td>
            <td class="actions">
              ${c.status === 'open'
                ? `<button class="btn btn-primary btn-sm" data-sc-open="${esc(c.id)}"><span class="ms">qr_code_scanner</span> Continue</button>`
                : `<button class="btn btn-outline btn-sm" data-sc-result="${esc(c.id)}"><span class="ms">summarize</span> Result</button>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table></div></div>`;

  const active = $('#sc-active', el);
  let currentOpen = openId; // the session shown in the live panel (poll target)

  async function renderActive(id) {
    if (!id) { active.innerHTML = ''; return; }
    currentOpen = id;
    let c;
    try { c = await api('/counts/' + id); } catch { active.innerHTML = ''; return; }
    if (c.status !== 'open') { active.innerHTML = ''; return; }
    const pct = c.expectedTotal ? Math.round((c.matchedTotal / c.expectedTotal) * 100) : 0;
    active.innerHTML = `
      <div class="card card-pad sc-panel" style="border-color:var(--primary-container);box-shadow:0 0 0 1px var(--primary-container)">
        <div class="sc-panel-head">
          <div class="sc-panel-meta">
            <div class="cell-title" style="font-size:16px">${esc(c.name)} <span class="pill pill-emerald">Open</span></div>
            <div class="cell-sub">${esc(c.location || t('stock.allLocations'))} • counted <strong>${c.matchedTotal}</strong> of
              <strong>${c.expectedTotal}</strong> expected devices (${pct}%)
              ${c.scans.length - c.matchedTotal > 0 ? ` • <span style="color:var(--rose-700)">${c.scans.length - c.matchedTotal} unknown scan(s)</span>` : ''}</div>
            <div class="seat-bar" style="margin-top:8px;max-width:340px"><i style="width:${pct}%"></i></div>
          </div>
          ${canDo ? `
          <div class="sc-panel-actions">
            <button class="btn btn-outline" id="sc-camera"><span class="ms">photo_camera</span> ${esc(t('stock.cameraBtn'))}</button>
            <button class="btn btn-danger" id="sc-close"><span class="ms">task_alt</span> ${esc(t('stock.closeCompare'))}</button>
          </div>` : ''}
        </div>
        ${canDo ? `
        <div class="search-box sc-scan-box"><span class="ms">qr_code_scanner</span>
          <input id="sc-input" placeholder="${esc(t('stock.scanPlaceholder'))}" autocomplete="off" inputmode="text" enterkeyhint="done">
        </div>
        <div class="cell-sub" style="margin-top:6px">${esc(t('stock.tipPhone'))}</div>` : ''}
        <div id="sc-recent" style="margin-top:10px">
          ${c.scans.slice(0, 8).map((s) => `
          <div class="history-item">
            <span class="when">${fmtDateTime(s.scannedAt)}</span>
            <span class="pill ${s.matched ? 'pill-emerald' : 'pill-rose'}">${s.matched ? 'OK' : 'Unknown'}</span>
            <span class="mono">${esc(s.assetTag || s.raw)}</span>
            <span class="cell-sub">by ${esc(s.scannedByName || '—')}</span>
          </div>`).join('')}
        </div>
      </div>`;

    if (!canDo) return;
    const submitScan = async (raw) => {
      if (!raw || !raw.trim()) return;
      try {
        const r = await api(`/counts/${id}/scan`, { method: 'POST', body: { raw: raw.trim() } });
        if (r.duplicate) toast(`${r.assetTag || r.raw} ${t('stock.alreadyScanned')}`, 'error');
        else if (r.matched) toast(`✓ ${r.asset.brand} ${r.asset.model} (${r.assetTag}) ${t('stock.counted')}`, 'success');
        else toast(`"${r.raw}" ${t('stock.notInInventory')}`, 'error');
        // While the camera/photo modal is open, only toast — don't rebuild the page
        // (keeps the live scanner running for rapid consecutive scans).
        const scanning = document.getElementById('scan-video') || document.getElementById('sc-photo');
        if (!scanning) renderActive(id);
      } catch (err) {
        toast(err.message, 'error');
        throw err;
      }
    };
    const inp = $('#sc-input', active);
    // Don't auto-focus on phones — it opens the keyboard and collapses the scan UI.
    if (inp && window.matchMedia('(pointer: fine)').matches) inp.focus();
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitScan(inp.value); inp.value = ''; }
    });
    $('#sc-camera', active).addEventListener('click', () => {
      scanWithCamera(submitScan).finally(() => {
        // Refresh the session panel once the user closes the scanner.
        if (currentOpen === id) renderActive(id);
      });
    });
    $('#sc-close', active).addEventListener('click', () => confirmModal(
      'Close this count and compare against the inventory? No more scans can be added afterwards.',
      async () => {
        const closed = await api(`/counts/${id}/close`, { method: 'POST' });
        toast(t('stock.countClosed'), 'success');
        Views.stockcount(el, {});
        showCountResult(closed);
      }));
  }

  function showCountResult(c) {
    const s = c.summary || {};
    const foundList = Array.isArray(s.foundDevices) ? s.foundDevices : [];
    const missingList = Array.isArray(s.missing) ? s.missing : [];
    const unexpectedList = Array.isArray(s.unexpected) ? s.unexpected : [];

    const rows = [
      ...foundList.map((m) => ({ ...m, outcome: 'found' })),
      ...missingList.map((m) => ({ ...m, outcome: 'missing' })),
      ...unexpectedList.map((u) => ({
        assetTag: u, brand: '', model: '', category: '', status: '', location: '',
        holder: '', serialNumber: '', outcome: 'unknown',
      })),
    ];

    const isAssigned = (r) => r.outcome !== 'unknown'
      && (r.status === 'Assigned' || !!(r.holder && String(r.holder).trim()));

    openModal({
      title: `${t('stock.resultTitle')} — ${c.name}`,
      wide: true,
      body: `
        <div class="grid grid-4" style="margin-bottom:16px">
          <div class="card card-pad metric"><h3 class="card-title">Expected</h3><div class="metric-value">${s.expected ?? 0}</div></div>
          <div class="card card-pad metric"><h3 class="card-title">${esc(t('stock.filterFound'))}</h3><div class="metric-value" style="color:var(--emerald-600)">${s.found ?? foundList.length}</div></div>
          <div class="card card-pad metric"><h3 class="card-title">${esc(t('stock.filterMissing'))}</h3><div class="metric-value" style="color:var(--rose-700)">${s.missingCount ?? missingList.length}</div></div>
          <div class="card card-pad metric"><h3 class="card-title">${esc(t('stock.filterUnknown'))}</h3><div class="metric-value">${s.unexpectedCount ?? unexpectedList.length}</div></div>
        </div>
        <div class="toolbar" style="margin-bottom:10px">
          <label class="cell-sub" style="display:flex;align-items:center;gap:6px">
            ${esc(t('stock.filterResult'))}
            <select id="sc-f-outcome" style="width:auto">
              <option value="all">${esc(t('stock.filterAll'))}</option>
              <option value="found">${esc(t('stock.filterFound'))}</option>
              <option value="missing">${esc(t('stock.filterMissing'))}</option>
              <option value="unknown">${esc(t('stock.filterUnknown'))}</option>
            </select>
          </label>
          <label class="cell-sub" style="display:flex;align-items:center;gap:6px">
            ${esc(t('stock.filterAssignment'))}
            <select id="sc-f-assign" style="width:auto">
              <option value="all">${esc(t('stock.filterAll'))}</option>
              <option value="assigned">${esc(t('stock.filterAssigned'))}</option>
              <option value="unassigned">${esc(t('stock.filterUnassigned'))}</option>
            </select>
          </label>
          <div class="search-box" style="flex:1;min-width:160px">
            <span class="ms">search</span>
            <input type="search" id="sc-f-q" placeholder="${esc(t('stock.searchDevices'))}" autocomplete="off">
          </div>
          <span class="spacer"></span>
          <span id="sc-f-count" class="cell-sub"></span>
        </div>
        <div class="table-wrap" style="max-height:380px;overflow-y:auto">
          <table class="data">
            <thead><tr>
              <th>${esc(t('stock.colOutcome'))}</th>
              <th>Tag</th><th>Device</th><th>Status</th><th>Location</th><th>Holder</th>
            </tr></thead>
            <tbody id="sc-f-tbody"></tbody>
          </table>
        </div>
        <div id="sc-f-empty" class="cell-sub" style="display:none;margin-top:10px">${esc(t('stock.noFilterMatch'))}</div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close') || 'Close')}</button>
        <button class="btn btn-primary" id="sc-export"><span class="ms">download</span> ${esc(t('stock.exportFiltered'))}</button>`,
      onMount(overlay) {
        const tbody = $('#sc-f-tbody', overlay);
        const empty = $('#sc-f-empty', overlay);
        const countEl = $('#sc-f-count', overlay);
        const outcomeSel = $('#sc-f-outcome', overlay);
        const assignSel = $('#sc-f-assign', overlay);
        const qInp = $('#sc-f-q', overlay);
        let filtered = rows.slice();

        const outcomeLabel = (o) => {
          if (o === 'found') return `<span class="pill pill-emerald">${esc(t('stock.filterFound'))}</span>`;
          if (o === 'missing') return `<span class="pill pill-rose">${esc(t('stock.filterMissing'))}</span>`;
          return `<span class="pill pill-amber">${esc(t('stock.filterUnknown'))}</span>`;
        };

        const apply = () => {
          const outcome = outcomeSel.value;
          const assign = assignSel.value;
          const q = (qInp.value || '').trim().toLowerCase();
          filtered = rows.filter((r) => {
            if (outcome !== 'all' && r.outcome !== outcome) return false;
            if (assign === 'assigned') {
              if (r.outcome === 'unknown' || !isAssigned(r)) return false;
            } else if (assign === 'unassigned') {
              if (r.outcome === 'unknown' || isAssigned(r)) return false;
            }
            if (q) {
              const hay = [r.assetTag, r.brand, r.model, r.category, r.status, r.location, r.holder, r.serialNumber]
                .map((x) => String(x || '').toLowerCase()).join(' ');
              if (!hay.includes(q)) return false;
            }
            return true;
          });
          countEl.textContent = `${filtered.length} / ${rows.length}`;
          empty.style.display = filtered.length ? 'none' : '';
          tbody.innerHTML = filtered.map((r) => `
            <tr>
              <td>${outcomeLabel(r.outcome)}</td>
              <td class="mono">${esc(r.assetTag || '—')}</td>
              <td>${r.outcome === 'unknown' ? '—' : `${esc(r.brand || '')} ${esc(r.model || '')}`.trim() || '—'}</td>
              <td>${r.status ? badge(r.status) : '—'}</td>
              <td class="cell-sub">${esc(r.location || '—')}</td>
              <td class="cell-sub">${esc(r.holder || '—')}</td>
            </tr>`).join('');
        };

        outcomeSel.addEventListener('change', apply);
        assignSel.addEventListener('change', apply);
        qInp.addEventListener('input', apply);
        apply();

        $('#sc-export', overlay).addEventListener('click', () => {
          const date = new Date().toISOString().slice(0, 10);
          const parts = ['stock-count', outcomeSel.value, assignSel.value, date]
            .filter((p) => p && p !== 'all');
          csvDownload(
            `${parts.join('-')}.csv`,
            ['Outcome', 'Asset Tag', 'Serial', 'Brand', 'Model', 'Category', 'Status', 'Location', 'Holder'],
            filtered.map((r) => [
              r.outcome, r.assetTag, r.serialNumber || '', r.brand, r.model,
              r.category, r.status, r.location || '', r.holder || '',
            ])
          );
        });
      },
    });
  }

  if (canDo) {
    $('#sc-new', el).addEventListener('click', () => formModal({
      title: 'Start a new stock count',
      fields: [
        { name: 'name', label: 'Count name', placeholder: `e.g. ${new Date().getFullYear()} Q${Math.ceil((new Date().getMonth() + 1) / 3)} sayım`, full: true },
        { name: 'location', label: 'Limit to location (optional)', type: 'select', value: '',
          options: [{ value: '', label: 'All locations' }, ...(AppConfig.locations || [])] },
      ],
      submitLabel: 'Start count',
      async onSubmit(d) {
        const c = await api('/counts', { method: 'POST', body: { name: d.name, location: d.location || null } });
        toast(`Count "${c.name}" started — begin scanning`, 'success');
        Views.stockcount(el, { open: c.id });
      },
    }));
  }

  bindView(el, async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.scOpen) { renderActive(b.dataset.scOpen); window.scrollTo(0, 0); }
    if (b.dataset.scResult) {
      const c = await api('/counts/' + b.dataset.scResult);
      showCountResult(c);
    }
  });

  // Live-sync scans from other devices while a session is open on screen.
  const poll = setInterval(() => {
    if (!el.isConnected) return clearInterval(poll);
    const cur = active.querySelector('#sc-input');
    // Only refresh when the operator isn't mid-typing.
    if (currentOpen && (!cur || !cur.value)) renderActive(currentOpen);
  }, 7000);

  renderActive(openId);
};

/* ============================== MOBILE LINES ============================== */
/** Search-based employee picker (works with thousands of employees). */
function pickEmployee(title, onPick) {
  openModal({
    title,
    body: `
      <div class="search-box"><span class="ms">search</span>
        <input id="pe-search" placeholder="Search by name, email or department…" autocomplete="off"></div>
      <div id="pe-list" style="max-height:300px;overflow-y:auto;margin-top:10px">
        <div class="cell-sub">Type at least 2 characters to search…</div>
      </div>`,
    foot: '<button class="btn btn-outline" data-close>Cancel</button>',
    onMount(overlay) {
      const inp = $('#pe-search', overlay);
      const list = $('#pe-list', overlay);
      let timer = null;
      const render = (emps) => {
        list.innerHTML = emps.length === 0 ? '<div class="cell-sub">No matching employees.</div>' :
          emps.map((p) => `
          <div class="emp-option" data-pe="${esc(p.id)}" data-pename="${esc(p.fullName)}">
            <span class="avatar">${esc(initials(p.fullName))}</span>
            <div class="grow"><strong>${esc(p.fullName)}</strong>
              <span class="cell-sub">${esc(p.department || '—')} • ${esc(p.email)}</span></div>
          </div>`).join('');
        list.querySelectorAll('[data-pe]').forEach((r) => r.addEventListener('click', () => {
          closeModal();
          onPick({ id: r.dataset.pe, fullName: r.dataset.pename });
        }));
      };
      inp.focus();
      inp.addEventListener('input', () => {
        clearTimeout(timer);
        const term = inp.value.trim();
        if (term.length < 2) { list.innerHTML = '<div class="cell-sub">Type at least 2 characters to search…</div>'; return; }
        timer = setTimeout(async () => {
          try { render(employeeList(await api(`/employees?status=Active&limit=30&search=${encodeURIComponent(term)}`)).items); }
          catch { render([]); }
        }, 220);
      });
    },
  });
}

Views.lines = async function (el, params = {}) {
  const canEdit = Auth.can('canManageAssets');
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.status) q.set('status', params.status);
  const items = await api('/lines?' + q.toString());
  const assigned = items.filter((l) => l.currentEmployeeId).length;
  const monthly = items.filter((l) => l.status === 'Active').reduce((s2, l) => s2 + Number(l.monthlyCost || 0), 0);

  el.innerHTML = `
    ${pageHead('Mobile Lines', 'Company SIM cards & phone numbers — who holds which line.', canEdit
      ? '<button class="btn btn-primary" id="line-new"><span class="ms">sim_card</span> New Line</button>' : '')}
    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">Total Lines</h3>${iconChip('sim_card', 'indigo')}</div>
        <div class="metric-value">${items.length}</div></div>
      <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">Assigned</h3>${iconChip('person', 'blue')}</div>
        <div class="metric-value">${assigned}</div></div>
      <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">Free</h3>${iconChip('sim_card_download', 'emerald')}</div>
        <div class="metric-value">${items.filter((l) => !l.currentEmployeeId && l.status === 'Active').length}</div></div>
      <div class="card card-pad metric"><div class="metric-top"><h3 class="card-title">Monthly Cost</h3>${iconChip('payments', 'amber')}</div>
        <div class="metric-value">${fmtMoney(monthly)}</div></div>
    </div>
    <div class="card">
      <div class="card-pad" style="padding-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div class="search-box" style="width:280px"><span class="ms">search</span>
          <input type="search" id="line-search" placeholder="Search number, operator, SIM, holder…" value="${esc(params.search || '')}"></div>
        <select id="line-status" style="width:auto">
          <option value="">All statuses</option>
          ${['Active', 'Suspended', 'Cancelled'].map((st) => `<option ${params.status === st ? 'selected' : ''}>${st}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Number</th><th>Operator / Plan</th><th>SIM Serial</th><th>Monthly</th><th>Status</th><th>Assigned To</th><th style="text-align:right"></th></tr></thead>
        <tbody>
          ${items.length === 0 ? `<tr><td colspan="7" class="table-empty">${esc(t('lines.noLinesYet'))}</td></tr>` :
            items.map((l) => `
            <tr>
              <td class="mono cell-title">${esc(l.phoneNumber)}</td>
              <td>${esc(l.operator || '—')}<div class="cell-sub">${esc(l.plan || '')}</div></td>
              <td class="mono cell-sub">${esc(l.simSerial || '—')}</td>
              <td>${l.monthlyCost != null ? fmtMoney(l.monthlyCost) : '—'}</td>
              <td>${l.status === 'Active' ? '<span class="pill pill-emerald">Active</span>'
                : l.status === 'Suspended' ? '<span class="pill pill-amber">Suspended</span>'
                : '<span class="pill pill-rose">Cancelled</span>'}</td>
              <td>${l.currentEmployeeName ? esc(l.currentEmployeeName) : '<span class="cell-sub">—</span>'}</td>
              <td class="actions">${canEdit ? `
                ${l.currentEmployeeId
                  ? `<button class="btn btn-outline btn-sm" data-line-unassign="${esc(l.id)}"><span class="ms">undo</span> Take back</button>`
                  : (l.status === 'Active' ? `<button class="btn btn-primary btn-sm" data-line-assign="${esc(l.id)}" data-num="${esc(l.phoneNumber)}"><span class="ms">person_add</span> Assign</button>` : '')}
                <button class="btn btn-outline btn-sm" data-line-edit="${esc(l.id)}">Edit</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="table-foot">${items.length} line(s)</div>
    </div>`;

  const rerender = (p) => Views.lines(el, { ...params, ...p });
  $('#line-search', el).addEventListener('change', (e) => rerender({ search: e.target.value }));
  $('#line-status', el).addEventListener('change', (e) => rerender({ status: e.target.value }));

  const lineForm = (line) => formModal({
    title: line ? `Edit ${line.phoneNumber}` : 'New Mobile Line',
    fields: [
      { name: 'phoneNumber', label: 'Phone number *', required: true, value: line?.phoneNumber, placeholder: '+90 5xx xxx xx xx' },
      { name: 'operator', label: 'Operator', value: line?.operator, placeholder: 'Turkcell / Vodafone / Türk Telekom' },
      { name: 'plan', label: 'Plan / tariff', value: line?.plan, placeholder: 'e.g. Kurumsal 20GB' },
      { name: 'simSerial', label: 'SIM serial (ICCID)', value: line?.simSerial },
      { name: 'monthlyCost', label: `Monthly cost (${appCurrency()})`, type: 'number', step: '0.01', value: line?.monthlyCost },
      { name: 'status', label: 'Status', type: 'select', value: line?.status || 'Active', options: ['Active', 'Suspended', 'Cancelled'] },
      { name: 'notes', label: 'Notes', type: 'textarea', full: true, value: line?.notes },
    ],
    async onSubmit(d) {
      if (line) await api(`/lines/${line.id}`, { method: 'PUT', body: d });
      else await api('/lines', { method: 'POST', body: d });
      toast(line ? 'Line updated' : 'Line registered', 'success');
      rerender({});
    },
  });

  if (canEdit) $('#line-new', el).addEventListener('click', () => lineForm(null));

  bindView(el, async (e) => {
    const b = e.target.closest('button'); if (!b || !canEdit) return;
    if (b.dataset.lineEdit) return lineForm(items.find((l) => l.id === b.dataset.lineEdit));
    if (b.dataset.lineAssign) {
      return pickEmployee(`Assign ${b.dataset.num} to…`, async (emp) => {
        try {
          const r = await api(`/lines/${b.dataset.lineAssign}/assign`, { method: 'POST', body: { employeeId: emp.id } });
          toast(`${r.phoneNumber} assigned to ${r.currentEmployeeName}`, 'success');
          rerender({});
        } catch (err) { toast(err.message, 'error'); }
      });
    }
    if (b.dataset.lineUnassign) {
      try {
        const r = await api(`/lines/${b.dataset.lineUnassign}/unassign`, { method: 'POST' });
        toast(`${r.phoneNumber} taken back`, 'success');
        rerender({});
      } catch (err) { toast(err.message, 'error'); }
    }
  });
};

/* ========================== EXCEL/CSV MIGRATION ========================== */
const IMPORT_COLUMNS = ['employeeName', 'employeeEmail', 'department', 'title', 'assetTag',
  'category', 'brand', 'model', 'serialNumber', 'mac', 'cpu', 'ram', 'storage', 'os', 'location', 'purchaseDate'];

function downloadImportTemplate() {
  const sample1 = ['Ahmet Yılmaz', 'ahmet.yilmaz@firma.com', 'Bilgi Teknolojileri', 'Sistem Uzmanı', '',
    'Laptop', 'Dell', 'Latitude 5540', 'SN-ORNEK-1', 'AA:BB:CC:DD:EE:FF', 'Intel i5-1235U', '16GB', '512GB SSD', 'Windows 11 Pro', 'Main Office', '2024-03-15'];
  const sample2 = ['', '', '', '', '', 'Monitor', 'LG', '27UP850', 'SN-ORNEK-2', '', '', '', '', '', 'Main Office', '2023-11-02'];
  csvDownload('itacm-import-template.csv', IMPORT_COLUMNS, [sample1, sample2]);
  toast('Template downloaded — fill it in Excel, save as CSV, then upload', 'success');
}

/** Map arbitrary header spellings (case/space tolerant) onto the template keys. */
function normalizeImportRows(rows) {
  const canon = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.toLowerCase(), c]));
  return rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      const key = canon[String(k).replace(/\s+/g, '').toLowerCase()];
      if (key) out[key] = v;
    }
    return out;
  });
}

function showImportModal(onDone) {
  let rows = null;
  openModal({
    title: 'Migrate inventory from Excel / CSV',
    wide: true,
    body: `
      <div class="gs-item" style="align-items:flex-start;margin-bottom:14px">
        ${iconChip('description', 'indigo')}
        <div style="flex:1">
          <div class="cell-title">1 — Download the template</div>
          <div class="cell-sub">One row per device. Fill the employee columns to auto-assign (zimmet) the device to that
            person; leave them blank for stock. Employees, brand/model catalog entries, asset tags and handover records
            are all created automatically.</div>
          <button class="btn btn-outline btn-sm" id="imp-template" style="margin-top:8px"><span class="ms">download</span> Download template (CSV — opens in Excel)</button>
        </div>
      </div>
      <div class="gs-item" style="align-items:flex-start;margin-bottom:14px">
        ${iconChip('upload_file', 'emerald')}
        <div style="flex:1">
          <div class="cell-title">2 — Upload your filled file</div>
          <div class="cell-sub">Save from Excel as <strong>CSV</strong> (both ; and , separators work; Turkish characters are fine).</div>
          <input type="file" id="imp-file" accept=".csv,text/csv" style="margin-top:8px">
        </div>
      </div>
      <div id="imp-preview"></div>`,
    foot: `<button class="btn btn-outline" data-close>Cancel</button>
           <button class="btn btn-primary" id="imp-commit" disabled><span class="ms">rocket_launch</span> Import</button>`,
    onMount(overlay) {
      const preview = $('#imp-preview', overlay);
      const commitBtn = $('#imp-commit', overlay);
      $('#imp-template', overlay).addEventListener('click', downloadImportTemplate);

      $('#imp-file', overlay).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        preview.innerHTML = '<div class="table-empty">Analysing…</div>';
        try {
          const text = await file.text();
          rows = normalizeImportRows(parseCsv(text));
          if (!rows.length) throw new Error('No data rows found — is the header row intact?');
          const plan = await api('/import/inventory', { method: 'POST', body: { rows, dryRun: true } });
          preview.innerHTML = `
            <div class="gs-section" style="margin:4px 0 8px">3 — Review the plan</div>
            <div class="grid grid-4" style="margin-bottom:10px">
              <div class="card card-pad metric"><h3 class="card-title">Devices</h3><div class="metric-value">${plan.assets}</div></div>
              <div class="card card-pad metric"><h3 class="card-title">New employees</h3><div class="metric-value">${plan.employeesNew}</div></div>
              <div class="card card-pad metric"><h3 class="card-title">Handovers</h3><div class="metric-value">${plan.handovers}</div></div>
              <div class="card card-pad metric"><h3 class="card-title">Errors</h3><div class="metric-value" style="color:${plan.errorCount ? 'var(--rose-700)' : 'var(--emerald-600)'}">${plan.errorCount}</div></div>
            </div>
            ${plan.errorCount ? `
            <div class="cell-sub" style="margin-bottom:6px">Rows with errors are <strong>skipped</strong>; everything else imports.</div>
            <div class="table-wrap" style="max-height:200px;overflow-y:auto"><table class="data">
              <thead><tr><th style="width:70px">Row</th><th>Problem</th></tr></thead>
              <tbody>${plan.errors.slice(0, 50).map((er) => `<tr><td class="mono">${er.row}</td><td class="cell-sub">${esc(er.error)}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="cell-sub">✓ Every row is valid.</div>'}`;
          commitBtn.disabled = plan.assets === 0;
        } catch (err) {
          preview.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
          commitBtn.disabled = true;
          rows = null;
        }
      });

      commitBtn.addEventListener('click', async () => {
        if (!rows) return;
        commitBtn.disabled = true;
        commitBtn.innerHTML = '<span class="ms">hourglass_top</span> Importing…';
        try {
          const r = await api('/import/inventory', { method: 'POST', body: { rows, dryRun: false } });
          toast(`Imported ${r.imported} device(s), ${r.handovers} handover(s), ${r.employees} employee(s)${r.errorCount ? ` — ${r.errorCount} row(s) skipped` : ''}`, 'success');
          closeModal();
          if (onDone) onDone();
        } catch (err) {
          toast(err.message, 'error');
          commitBtn.disabled = false;
          commitBtn.innerHTML = '<span class="ms">rocket_launch</span> Import';
        }
      });
    },
  });
}
