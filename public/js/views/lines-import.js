
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

/** Turkish + informal aliases → canonical template keys (after space/case strip). */
const IMPORT_ALIASES = {
  employeeName: ['employeename', 'calisanadi', 'çalışanadı', 'adisoyadi', 'adsoyad', 'personeladi', 'personel'],
  employeeEmail: ['employeeemail', 'calisanemail', 'çalışanemail', 'eposta', 'email', 'mail', 'e-posta'],
  department: ['department', 'departman', 'birim', 'bolum', 'bölüm'],
  title: ['title', 'unvan', 'ünvan', 'gorev', 'görev', 'jobtitle'],
  assetTag: ['assettag', 'demirbasno', 'demirbaşno', 'etiket', 'tag', 'envanterno'],
  category: ['category', 'kategori', 'tur', 'tür'],
  brand: ['brand', 'marka'],
  model: ['model'],
  serialNumber: ['serialnumber', 'serino', 'serinumarasi', 'serinumara', 'sn'],
  mac: ['mac', 'macaddress', 'macethernet'],
  cpu: ['cpu', 'islemci', 'işlemci'],
  ram: ['ram', 'bellek'],
  storage: ['storage', 'disk', 'depolama', 'hdd', 'ssd'],
  os: ['os', 'isletimsistemi', 'işletimsistemi'],
  location: ['location', 'lokasyon', 'konum', 'yer'],
  purchaseDate: ['purchasedate', 'satinalmatarihi', 'satınalmatarihi', 'alimtarihi'],
};

function downloadImportTemplate() {
  const sample1 = ['Ahmet Yılmaz', 'ahmet.yilmaz@firma.com', 'Bilgi Teknolojileri', 'Sistem Uzmanı', '',
    'Laptop', 'Dell', 'Latitude 5540', 'SN-ORNEK-1', 'AA:BB:CC:DD:EE:FF', 'Intel i5-1235U', '16GB', '512GB SSD', 'Windows 11 Pro', 'Main Office', '2024-03-15'];
  const sample2 = ['', '', '', '', '', 'Monitor', 'LG', '27UP850', 'SN-ORNEK-2', '', '', '', '', '', 'Warehouse', '2023-11-02'];
  csvDownload('itacm-import-template.csv', IMPORT_COLUMNS, [sample1, sample2]);
  toast(t('imp.templateToast') || 'Template downloaded — fill in Excel, save as CSV, then upload', 'success');
}

function importHeaderKey(raw) {
  const stripped = String(raw || '').replace(/\s+/g, '').toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/Ş/g, 's')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/Ü/g, 'u')
    .replace(/ö/g, 'o').replace(/Ö/g, 'o')
    .replace(/ç/g, 'c').replace(/Ç/g, 'c')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [canon, aliases] of Object.entries(IMPORT_ALIASES)) {
    const list = aliases.map((a) => a.toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    if (list.includes(stripped) || stripped === canon.toLowerCase()) return canon;
  }
  return null;
}

/** Map arbitrary header spellings onto template keys; report ignored headers. */
function normalizeImportRows(rows, headersFromFile = null) {
  const ignored = [];
  const headerSource = headersFromFile
    || (rows[0] ? Object.keys(rows[0]) : []);
  const map = {};
  for (const h of headerSource) {
    const key = importHeaderKey(h);
    if (key) map[h] = key;
    else if (String(h || '').trim()) ignored.push(String(h).trim());
  }
  const out = rows.map((r) => {
    const row = {};
    for (const [k, v] of Object.entries(r)) {
      const key = map[k] || importHeaderKey(k);
      if (key) row[key] = v;
    }
    return row;
  });
  return { rows: out, ignoredHeaders: [...new Set(ignored)] };
}

function showImportModal(onDone) {
  if (!(Auth.profile && (Auth.profile.role === 'Owner' || Auth.profile.role === 'Admin'))) {
    toast(t('imp.ownerAdminOnly') || 'Inventory import is limited to Owner and Admin.', 'error');
    return;
  }

  let state = {
    step: 1,
    fileName: '',
    rows: null,
    ignoredHeaders: [],
    plan: null,
    result: null,
    awaitingConfirm: false,
  };

  const canImport = () => state.plan && state.plan.assets > 0;

  const renderSteps = () => `
    <div class="imp-steps" aria-hidden="true">
      ${[1, 2, 3, 4].map((n) => {
        const labels = [
          t('imp.stepTemplate') || 'Template',
          t('imp.stepUpload') || 'Upload',
          t('imp.stepAnalyse') || 'Analyse',
          t('imp.stepResult') || 'Result',
        ];
        const cls = n < state.step ? 'done' : (n === state.step ? 'active' : '');
        return `<div class="imp-step ${cls}"><span>${n}</span><b>${esc(labels[n - 1])}</b></div>`;
      }).join('<i></i>')}
    </div>`;

  const renderBody = () => {
    if (state.step === 4 && state.result) {
      const r = state.result;
      return `
        ${renderSteps()}
        <div class="imp-hero success">
          <span class="ms">check_circle</span>
          <div>
            <div class="cell-title">${esc(t('imp.resultTitle') || 'Import complete')}</div>
            <div class="cell-sub">${esc(t('imp.resultHint') || 'Devices, employees and zimmet handovers were created in one transaction.')}</div>
          </div>
        </div>
        <div class="imp-metrics">
          <div class="imp-metric"><span>${r.imported || r.assets || 0}</span><small>${esc(t('imp.devices') || 'Devices')}</small></div>
          <div class="imp-metric"><span>${r.assigned || 0}</span><small>${esc(t('imp.assigned') || 'Assigned')}</small></div>
          <div class="imp-metric"><span>${r.inStock || 0}</span><small>${esc(t('imp.inStock') || 'In stock')}</small></div>
          <div class="imp-metric"><span>${r.handovers || 0}</span><small>${esc(t('imp.handovers') || 'Handovers')}</small></div>
          <div class="imp-metric"><span>${r.employeesNew || 0}</span><small>${esc(t('imp.newEmployees') || 'New employees')}</small></div>
          <div class="imp-metric"><span>${r.errorCount || 0}</span><small>${esc(t('imp.skipped') || 'Skipped')}</small></div>
        </div>
        <div class="imp-actions-row">
          <a class="btn btn-outline btn-sm" href="#/employees"><span class="ms">badge</span> ${esc(t('nav.employees') || 'Employees')}</a>
          <a class="btn btn-outline btn-sm" href="#/handover"><span class="ms">assignment_turned_in</span> ${esc(t('nav.handover') || 'Handover')}</a>
          <a class="btn btn-outline btn-sm" href="#/assets"><span class="ms">devices</span> ${esc(t('nav.hardware') || 'Hardware')}</a>
          ${(r.errors && r.errors.length) ? `<button type="button" class="btn btn-outline btn-sm" id="imp-dl-errors"><span class="ms">download</span> ${esc(t('imp.downloadErrors') || 'Download errors CSV')}</button>` : ''}
        </div>
        ${(r.errors && r.errors.length) ? `
          <div class="gs-section">${esc(t('imp.skippedRows') || 'Skipped rows')}</div>
          <div class="table-wrap imp-table"><table class="data">
            <thead><tr><th style="width:70px">${esc(t('imp.colRow') || 'Row')}</th><th>${esc(t('imp.colProblem') || 'Problem')}</th></tr></thead>
            <tbody>${r.errors.slice(0, 80).map((er) => `<tr><td class="mono">${er.row}</td><td class="cell-sub">${esc(er.error)}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}`;
    }

    if (state.step >= 3 && state.plan) {
      const p = state.plan;
      const preview = p.preview || [];
      const cats = Object.entries(p.categoryCounts || {}).sort((a, b) => b[1] - a[1]);
      const confirmCard = state.awaitingConfirm ? `
        <div class="imp-confirm" role="alertdialog" aria-labelledby="imp-confirm-title">
          <div class="imp-confirm-icon"><span class="ms">rocket_launch</span></div>
          <div class="imp-confirm-body">
            <div class="cell-title" id="imp-confirm-title">${esc(t('imp.confirmTitle') || 'Ready to import?')}</div>
            <p class="cell-sub" style="margin:6px 0 0">
              ${(t('imp.confirmMsg') || 'Import {devices} device(s), create {emp} employee(s), {ho} handover(s). Skip {err} error row(s)?')
                .replace('{devices}', `<strong>${p.assets}</strong>`)
                .replace('{emp}', `<strong>${p.employeesNew}</strong>`)
                .replace('{ho}', `<strong>${p.handovers}</strong>`)
                .replace('{err}', `<strong>${p.errorCount}</strong>`)}
            </p>
            <div class="imp-confirm-actions">
              <button type="button" class="btn btn-outline" id="imp-confirm-cancel">${esc(t('common.cancel') || 'Cancel')}</button>
              <button type="button" class="btn btn-primary" id="imp-confirm-yes">
                <span class="ms">check</span> ${esc(t('imp.confirmYes') || 'Yes, import now')}
              </button>
            </div>
          </div>
        </div>` : '';
      return `
        ${renderSteps()}
        ${confirmCard}
        <div class="imp-file-chip"><span class="ms">draft</span> ${esc(state.fileName || 'file.csv')}
          <span class="cell-sub">· ${p.totalRows} ${esc(t('imp.rows') || 'rows')}</span></div>
        <div class="imp-metrics">
          <div class="imp-metric"><span>${p.assets}</span><small>${esc(t('imp.devices') || 'Devices')}</small></div>
          <div class="imp-metric accent"><span>${p.assigned || 0}</span><small>${esc(t('imp.willAssign') || 'Will assign')}</small></div>
          <div class="imp-metric"><span>${p.inStock || 0}</span><small>${esc(t('imp.willStock') || 'Will stay in stock')}</small></div>
          <div class="imp-metric"><span>${p.handovers}</span><small>${esc(t('imp.handovers') || 'Handovers')}</small></div>
          <div class="imp-metric"><span>${p.employeesNew}</span><small>${esc(t('imp.newEmployees') || 'New employees')}</small></div>
          <div class="imp-metric"><span>${p.employeesExisting || 0}</span><small>${esc(t('imp.existingEmployees') || 'Existing employees')}</small></div>
          <div class="imp-metric"><span>${p.catalogEntries || 0}</span><small>${esc(t('imp.catalogModels') || 'Catalog models')}</small></div>
          <div class="imp-metric"><span>${p.autoTagged || 0}</span><small>${esc(t('imp.autoTags') || 'Auto asset tags')}</small></div>
          <div class="imp-metric ${p.errorCount ? 'warn' : 'ok'}"><span>${p.errorCount}</span><small>${esc(t('imp.errors') || 'Errors')}</small></div>
        </div>
        ${cats.length ? `
          <div class="imp-cat-bar" title="${esc(t('imp.byCategory') || 'By category')}">
            ${cats.slice(0, 8).map(([name, n]) => {
              const pct = Math.max(8, Math.round((n / Math.max(1, p.assets)) * 100));
              return `<div class="imp-cat-chip" style="flex:${n}"><b>${esc(name)}</b><span>${n}</span></div>`;
            }).join('')}
          </div>` : ''}
        ${state.ignoredHeaders.length ? `
          <div class="imp-warn">
            <span class="ms">info</span>
            <div>${esc(t('imp.ignoredHeaders') || 'These columns were ignored (not in the template)')}: 
              <strong>${state.ignoredHeaders.map(esc).join(', ')}</strong></div>
          </div>` : ''}
        ${(p.knownLocations && p.knownLocations.length) ? `
          <div class="imp-tip">
            <span class="ms">location_on</span>
            <div><strong>${esc(t('imp.allowedLocations') || 'Allowed locations')}</strong>
              (Product Catalog): ${p.knownLocations.map(esc).join(' · ')}</div>
          </div>` : ''}
        ${p.errorCount ? `
          <div class="imp-warn">
            <span class="ms">warning</span>
            <div>${esc(t('imp.errorsSkippedHint') || 'Rows with errors will be skipped. Valid rows still import.')}
              <button type="button" class="btn btn-outline btn-sm" id="imp-dl-errors" style="margin-left:8px">${esc(t('imp.downloadErrors') || 'Download errors CSV')}</button>
            </div>
          </div>` : `
          <div class="imp-ok"><span class="ms">check_circle</span> ${esc(t('imp.allValid') || 'Every row is valid.')}</div>`}
        <div class="imp-tabs" role="tablist">
          <button type="button" class="imp-tab active" data-imp-tab="preview">${esc(t('imp.tabPreview') || 'Preview')} (${Math.min(preview.length, 60)})</button>
          <button type="button" class="imp-tab" data-imp-tab="errors">${esc(t('imp.tabErrors') || 'Errors')} (${p.errorCount})</button>
        </div>
        <div id="imp-tab-preview" class="imp-tab-panel">
          <div class="table-wrap imp-table"><table class="data">
            <thead><tr>
              <th>${esc(t('imp.colRow') || 'Row')}</th>
              <th>${esc(t('imp.colDevice') || 'Device')}</th>
              <th>${esc(t('imp.colSerial') || 'Serial')}</th>
              <th>${esc(t('imp.colEmployee') || 'Employee')}</th>
              <th>${esc(t('imp.colDestination') || 'Destination')}</th>
            </tr></thead>
            <tbody>
              ${preview.length === 0 ? `<tr><td colspan="5" class="table-empty">${esc(t('imp.noValidRows') || 'No valid rows')}</td></tr>` :
                preview.map((row) => `
                <tr>
                  <td class="mono">${row.row}</td>
                  <td>
                    <div class="cell-title">${esc(row.brand)} ${esc(row.model)}</div>
                    <div class="cell-sub">${esc(row.category)}${row.assetTag ? ` · <span class="mono">${esc(row.assetTag)}</span>` : ` · ${esc(t('imp.autoTag') || 'auto tag')}`}</div>
                  </td>
                  <td class="mono cell-sub">${esc(row.serialNumber)}</td>
                  <td>
                    ${row.employeeEmail
                      ? `<div>${esc(row.employeeName || '—')}</div>
                         <div class="cell-sub">${esc(row.employeeEmail)}
                           ${row.employeeExisting
                             ? ` · ${esc(t('imp.existing') || 'existing')}`
                             : ` · ${esc(t('imp.willCreate') || 'will create')}`}</div>`
                      : `<span class="cell-sub">—</span>`}
                  </td>
                  <td>${row.destination === 'Assigned'
                    ? `<span class="pill pill-blue">${esc(t('imp.assigned') || 'Assigned')}</span>`
                    : `<span class="pill pill-emerald">${esc(t('imp.inStock') || 'In Stock')}</span>`}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>
          ${(p.assets || 0) > preview.length ? `<div class="cell-sub" style="margin-top:6px">${esc(t('imp.previewCapped') || 'Showing first rows only — all valid rows will still import.')}</div>` : ''}
        </div>
        <div id="imp-tab-errors" class="imp-tab-panel hidden">
          <div class="table-wrap imp-table"><table class="data">
            <thead><tr><th style="width:70px">${esc(t('imp.colRow') || 'Row')}</th><th>${esc(t('imp.colProblem') || 'Problem')}</th></tr></thead>
            <tbody>
              ${(p.errors || []).length === 0
                ? `<tr><td colspan="2" class="table-empty">${esc(t('imp.noErrors') || 'No errors')}</td></tr>`
                : (p.errors || []).slice(0, 100).map((er) => `<tr><td class="mono">${er.row}</td><td class="cell-sub">${esc(er.error)}</td></tr>`).join('')}
            </tbody>
          </table></div>
        </div>`;
    }

    // Steps 1–2: template + upload
    return `
      ${renderSteps()}
      <div class="imp-split">
        <div class="imp-card">
          <div class="imp-card-icon">${iconChip('description', 'indigo')}</div>
          <div class="cell-title">${esc(t('imp.step1Title') || '1 — Template')}</div>
          <p class="cell-sub">${esc(t('imp.step1Body') || 'One row per device. Fill employee columns to create zimmet automatically; leave blank for stock.')}</p>
          <ul class="imp-bullets">
            <li>${esc(t('imp.bulletEmployees') || 'Creates employees (deduped by email)')}</li>
            <li>${esc(t('imp.bulletHandover') || 'One handover document per employee')}</li>
            <li>${esc(t('imp.bulletTags') || 'Auto asset tags when the column is empty')}</li>
          </ul>
          <button type="button" class="btn btn-outline" id="imp-template"><span class="ms">download</span> ${esc(t('imp.downloadTemplate') || 'Download CSV template')}</button>
        </div>
        <div class="imp-card" id="imp-drop">
          <div class="imp-card-icon">${iconChip('upload_file', 'emerald')}</div>
          <div class="cell-title">${esc(t('imp.step2Title') || '2 — Upload CSV')}</div>
          <p class="cell-sub">${esc(t('imp.step2Body') || 'Save from Excel as CSV (; or ,). Turkish headers like Marka / Seri No are accepted. Locations must match Product Catalog.')}</p>
          <label class="imp-dropzone" for="imp-file">
            <span class="ms">cloud_upload</span>
            <strong>${esc(t('imp.dropHint') || 'Drop CSV here or click to browse')}</strong>
            <span class="cell-sub">.csv · max 5000 rows</span>
          </label>
          <input type="file" id="imp-file" accept=".csv,text/csv" hidden>
          <div id="imp-upload-status" class="cell-sub" style="margin-top:8px"></div>
        </div>
      </div>`;
  };

  const footForStep = () => {
    if (state.step === 4) {
      return `<button class="btn btn-primary" data-close><span class="ms">done</span> ${esc(t('common.close') || 'Close')}</button>`;
    }
    if (state.step >= 3) {
      return `
        <button class="btn btn-outline" id="imp-back">${esc(t('common.back') || 'Back')}</button>
        <button class="btn btn-outline" data-close>${esc(t('common.cancel') || 'Cancel')}</button>
        <button class="btn btn-primary" id="imp-commit" ${canImport() && !state.awaitingConfirm ? '' : 'disabled'}>
          <span class="ms">rocket_launch</span>
          ${esc(t('imp.confirmImport') || 'Confirm import')}
          ${canImport() ? ` (${state.plan.assets})` : ''}
        </button>`;
    }
    return `<button class="btn btn-outline" data-close>${esc(t('common.cancel') || 'Cancel')}</button>`;
  };

  openModal({
    title: t('imp.title') || 'Import inventory & zimmet',
    wide: true,
    body: `<div id="imp-root">${renderBody()}</div>`,
    foot: `<div id="imp-foot">${footForStep()}</div>`,
    onMount(overlay) {
      const root = () => $('#imp-root', overlay);
      const foot = () => $('#imp-foot', overlay);

      const redraw = () => {
        root().innerHTML = renderBody();
        foot().innerHTML = footForStep();
        bind();
      };

      const downloadErrors = () => {
        const errors = (state.result && state.result.errors) || (state.plan && state.plan.errors) || [];
        if (!errors.length) return;
        csvDownload('itacm-import-errors.csv', ['row', 'error'], errors.map((e) => [e.row, e.error]));
        toast(t('imp.errorsDownloaded') || 'Error report downloaded', 'success');
      };

      const runAnalyse = async (file) => {
        const status = $('#imp-upload-status', overlay);
        if (status) status.textContent = t('imp.analysing') || 'Analysing…';
        try {
          const text = await file.text();
          const parsed = parseCsv(text);
          if (!parsed.length) throw new Error(t('imp.noDataRows') || 'No data rows found — is the header row intact?');
          const headers = Object.keys(parsed[0] || {});
          const norm = normalizeImportRows(parsed, headers);
          state.rows = norm.rows;
          state.ignoredHeaders = norm.ignoredHeaders;
          state.fileName = file.name;
          const plan = await api('/import/inventory', { method: 'POST', body: { rows: state.rows, dryRun: true } });
          state.plan = plan;
          state.step = 3;
          redraw();
        } catch (err) {
          if (status) status.innerHTML = `<span class="form-error">${esc(err.message)}</span>`;
          else toast(err.message, 'error');
          state.rows = null;
          state.plan = null;
        }
      };

      const bindDrop = () => {
        const drop = $('#imp-drop', overlay);
        const input = $('#imp-file', overlay);
        if (!drop || !input) return;
        const onFiles = (files) => {
          const file = files && files[0];
          if (!file) return;
          if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes('csv') && !file.type.includes('text')) {
            toast(t('imp.csvOnly') || 'Please upload a CSV file (Excel → Save as CSV).', 'error');
            return;
          }
          runAnalyse(file);
        };
        input.addEventListener('change', (e) => onFiles(e.target.files));
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('drag');
        }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove('drag');
        }));
        drop.addEventListener('drop', (e) => onFiles(e.dataTransfer.files));
      };

      const bind = () => {
        $('#imp-template', overlay)?.addEventListener('click', downloadImportTemplate);
        bindDrop();
        overlay.querySelectorAll('[data-imp-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            overlay.querySelectorAll('.imp-tab').forEach((b) => b.classList.toggle('active', b === btn));
            const tab = btn.dataset.impTab;
            $('#imp-tab-preview', overlay)?.classList.toggle('hidden', tab !== 'preview');
            $('#imp-tab-errors', overlay)?.classList.toggle('hidden', tab !== 'errors');
          });
        });
        $('#imp-dl-errors', overlay)?.addEventListener('click', downloadErrors);
        $('#imp-back', overlay)?.addEventListener('click', () => {
          state.step = 1;
          state.plan = null;
          state.rows = null;
          state.result = null;
          state.awaitingConfirm = false;
          redraw();
        });
        $('#imp-confirm-cancel', overlay)?.addEventListener('click', () => {
          state.awaitingConfirm = false;
          redraw();
        });
        const runImport = async () => {
          if (!state.rows || !canImport()) return;
          state.awaitingConfirm = false;
          const btn = $('#imp-commit', overlay);
          const yesBtn = $('#imp-confirm-yes', overlay);
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="ms">hourglass_top</span> ${esc(t('imp.importing') || 'Importing…')}`;
          }
          if (yesBtn) {
            yesBtn.disabled = true;
            yesBtn.innerHTML = `<span class="ms">hourglass_top</span> ${esc(t('imp.importing') || 'Importing…')}`;
          }
          try {
            const r = await api('/import/inventory', { method: 'POST', body: { rows: state.rows, dryRun: false } });
            state.result = r;
            state.step = 4;
            redraw();
            if (onDone) onDone();
          } catch (err) {
            toast(err.message, 'error');
            state.awaitingConfirm = false;
            redraw();
          }
        };
        $('#imp-confirm-yes', overlay)?.addEventListener('click', () => { runImport(); });
        $('#imp-commit', overlay)?.addEventListener('click', () => {
          if (!state.rows || !canImport()) return;
          state.awaitingConfirm = true;
          redraw();
          $('#imp-confirm-yes', overlay)?.focus();
        });
      };

      bind();
    },
  });
}

