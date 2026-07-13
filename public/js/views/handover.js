/* =============================== HANDOVERS =============================== */
Views.handover = async function (el) {
  const canDo = Auth.can('canExecuteHandovers');
  const [initialEmpsRes, past] = await Promise.all([
    api('/employees?status=Active&limit=50'),
    api('/handovers?limit=8'),
  ]);
  let empList = employeeList(initialEmpsRes).items; // current employee search results (fetched server-side)
  let stock = [];
  let stockTotal = 0;
  let freeLines = [];
  const basket = new Map(); // assetId -> { asset, note }
  const lineBasket = new Map(); // lineId -> { line, note }
  // empObj holds the SELECTED employee object so it survives a new search that
  // no longer contains them.
  const state = { emp: null, empObj: null, hwFilter: '', lineFilter: '', docType: 'single' };

  /* ---- static shell: rendered ONCE so search inputs never lose focus ---- */
  el.innerHTML = `
    ${pageHead(t('page.handover.title'), t('page.handover.sub'),
      '<span class="draft-chip">Draft Mode</span>')}
    <div class="ho-grid">
      <div>
        <div class="card card-pad" style="margin-bottom:20px">
          <div class="section-title" style="margin-bottom:14px"><span class="ms">person_search</span> ${esc(t('handover.selectEmployee'))}</div>
          <div class="search-box" style="margin-bottom:14px"><span class="ms">search</span>
            <input type="search" id="ho-emp-search" placeholder="${esc(t('handover.searchEmployee'))}"></div>
          <div id="ho-emp-list" style="max-height:320px;overflow-y:auto"></div>
        </div>

        <div class="card">
          <div class="card-pad" style="padding-bottom:10px">
            <div class="section-title" style="justify-content:space-between">
              <span style="display:flex;align-items:center;gap:10px"><span class="ms">devices</span>
                <span id="ho-stock-count">${esc(t('handover.availableHardware'))}</span></span>
              <span class="stock-chip">In Stock Only</span>
            </div>
          </div>
          <div style="padding:0 20px 12px">
            <div class="search-box"><span class="ms">search</span>
              <input type="search" id="ho-hw-search" placeholder="${esc(t('handover.searchHardware'))}"></div>
          </div>
          <div class="table-wrap" style="max-height:280px;overflow-y:auto"><table class="data">
            <thead><tr><th style="width:34px"></th><th>Asset Name</th><th>Tag / SN</th><th style="text-align:right">Category</th></tr></thead>
            <tbody id="ho-stock-body"></tbody>
          </table></div>
        </div>

        <div class="card" style="margin-top:20px">
          <div class="card-pad" style="padding-bottom:10px">
            <div class="section-title" style="justify-content:space-between">
              <span style="display:flex;align-items:center;gap:10px"><span class="ms">sim_card</span>
                <span id="ho-line-count">${esc(t('handover.availableLines'))}</span></span>
              <span class="stock-chip">${esc(t('handover.unassignedOnly'))}</span>
            </div>
          </div>
          <div style="padding:0 20px 12px">
            <div class="search-box"><span class="ms">search</span>
              <input type="search" id="ho-line-search" placeholder="${esc(t('handover.searchLines'))}"></div>
          </div>
          <div class="table-wrap" style="max-height:220px;overflow-y:auto"><table class="data">
            <thead><tr><th style="width:34px"></th><th>${esc(t('lines.phone'))}</th><th>${esc(t('lines.operator'))}</th><th>${esc(t('lines.plan'))}</th></tr></thead>
            <tbody id="ho-line-body"></tbody>
          </table></div>
        </div>

        <div class="card" style="margin-top:20px">
          <div class="card-head"><h3>${esc(t('handover.recentReceipts'))}</h3></div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Employee</th><th>Items</th><th>Date</th><th>Type</th><th style="text-align:right"></th></tr></thead>
            <tbody>
              ${past.length === 0 ? '<tr><td colspan="5" class="table-empty">No receipts yet.</td></tr>' :
                past.map((h) => `
                <tr><td class="cell-title">${esc(h.employeeName)}</td><td>${(h.items || []).length}</td>
                  <td>${fmtDateTime(h.transactionDate)}</td><td class="cell-sub">${esc(h.documentType)}</td>
                  <td class="actions"><button class="btn btn-outline btn-sm" data-print="${esc(h.id)}"><span class="ms">print</span> Print</button></td></tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>

      <div>
        <div id="ho-sel-emp" style="margin-bottom:16px"></div>
        <div class="card basket-card">
        <div class="basket-head">
          <span class="ms ms-lg">shopping_basket</span>
          <div class="grow">
            <h3>${esc(t('handover.basket'))}</h3>
            <p id="ho-basket-sub">0 items selected</p>
          </div>
          <span class="basket-count" id="ho-basket-count">0</span>
        </div>
        <div class="basket-body" id="ho-basket-items"></div>
        <div class="doc-gen">
          <h4>Document Generation</h4>
          ${typeof handoverTplSelectHtml === 'function' ? handoverTplSelectHtml(
            (AppConfig.handoverTemplates && AppConfig.handoverTemplates[0] && AppConfig.handoverTemplates[0].id) || 'default'
          ) : ''}
          <label class="doc-option">
            <input type="radio" name="doctype" value="single" checked>
            <span><strong>Single Unified Document</strong>
              <span class="cell-sub">Generates one master protocol listing all items.</span></span>
          </label>
          <label class="doc-option">
            <input type="radio" name="doctype" value="separate">
            <span><strong>Separate Documents</strong>
              <span class="cell-sub">Generates individual protocols per asset / line.</span></span>
          </label>
        </div>
        <div class="basket-foot">
          <button class="btn btn-primary btn-lg btn-block" id="ho-submit" disabled>
            <span class="ms">print</span> Confirm Handover &amp; Print Form
          </button>
          <p class="basket-caption">This action will record the transaction and open the print dialog.</p>
        </div>
        </div>
      </div>
    </div>`;

  /* ---- partial renderers ---- */
  function basketTotal() { return basket.size + lineBasket.size; }

  function renderEmps() {
    const list = $('#ho-emp-list', el);
    list.innerHTML = (empList.length === 0 ? '<div class="table-empty">No matching employees.</div>' :
      empList.map((p) => `
      <div class="emp-option ${state.emp === p.id ? 'selected' : ''}" data-emp="${esc(p.id)}">
        <span class="avatar">${esc(initials(p.fullName))}</span>
        <div class="grow">
          <strong>${esc(p.fullName)}</strong>
          <span class="cell-sub">${esc(p.title || '—')} • ${esc(p.department || '—')}</span>
        </div>
        <span class="emp-radio"></span>
      </div>`).join('')) +
      (empList.length >= 50 ? `<div class="cell-sub" style="padding:8px 2px">Showing first 50 — type a name to search all employees…</div>` : '');
    list.querySelectorAll('[data-emp]').forEach((r) => r.addEventListener('click', () => {
      state.emp = r.dataset.emp;
      state.empObj = empList.find((p) => p.id === r.dataset.emp) || state.empObj;
      renderEmps();
      renderSelEmp();
      renderBasket();
    }));
  }

  /* Server-side employee search (debounced) so all employees are reachable,
     not just a client-filtered slice of the first page. */
  let empSearchTimer = null;
  async function searchEmps(term) {
    const q = new URLSearchParams({ status: 'Active', limit: '50' });
    if (term) q.set('search', term);
    try { empList = employeeList(await api('/employees?' + q.toString())).items; } catch { empList = []; }
    renderEmps();
  }

  async function loadStock() {
    const q = new URLSearchParams({ status: 'In Stock', limit: '500' });
    if (state.hwFilter) q.set('search', state.hwFilter);
    const res = await api('/assets?' + q.toString());
    stock = (res.items || []).filter((x) => x.category !== 'Network' && x.category !== 'Server');
    stockTotal = stock.length;
    renderStock();
  }

  async function loadLines() {
    const q = new URLSearchParams({ status: 'Active', limit: '500' });
    if (state.lineFilter) q.set('search', state.lineFilter);
    const all = await api('/lines?' + q.toString()).catch(() => []);
    freeLines = all.filter((l) => !l.currentEmployeeId && !l.reservedForEmployeeId);
    renderLines();
  }

  function renderStock() {
    $('#ho-stock-count', el).textContent = `${t('handover.availableHardware')} (${stockTotal})`;
    const rows = stock.slice(0, 200);
    const tbody = $('#ho-stock-body', el);
    tbody.innerHTML = (rows.length === 0
      ? '<tr><td colspan="4" class="table-empty">No in-stock assets match your search.</td></tr>'
      : rows.map((x) => `
        <tr class="hw-row" data-hw="${esc(x.id)}">
          <td><input type="checkbox" ${basket.has(x.id) ? 'checked' : ''} ${!canDo ? 'disabled' : ''}></td>
          <td><div style="display:flex;align-items:center;gap:10px"><span class="ms" style="color:var(--on-surface-variant)">${catIcon(x.category)}</span>
            <span class="cell-title">${esc(x.brand)} ${esc(x.model)}</span></div></td>
          <td class="mono">${esc(x.assetTag)} · ${esc(x.serialNumber)}</td>
          <td style="text-align:right" class="cell-sub">${esc(x.category)}</td>
        </tr>`).join('')) +
      (stock.length > 200 ? `<tr><td colspan="4" class="cell-sub" style="padding:10px 16px">Showing first 200 of ${stock.length} — refine the search…</td></tr>` : '');
    tbody.querySelectorAll('[data-hw]').forEach((r) => r.addEventListener('click', () => {
      if (!canDo) return;
      const id = r.dataset.hw;
      if (basket.has(id)) basket.delete(id);
      else {
        const asset = stock.find((x) => x.id === id);
        basket.set(id, { asset, note: '' });
        const assetNote = String((asset && asset.notes) || '').trim();
        if (assetNote) {
          toast(`${asset.assetTag}: ${assetNote}`, 'warning');
        }
      }
      r.querySelector('input').checked = basket.has(id);
      renderBasket();
    }));
  }

  function renderLines() {
    $('#ho-line-count', el).textContent = `${t('handover.availableLines')} (${freeLines.length})`;
    const tbody = $('#ho-line-body', el);
    tbody.innerHTML = freeLines.length === 0
      ? `<tr><td colspan="4" class="table-empty">${esc(t('handover.noFreeLines'))}</td></tr>`
      : freeLines.map((l) => `
        <tr class="hw-row" data-line="${esc(l.id)}">
          <td><input type="checkbox" ${lineBasket.has(l.id) ? 'checked' : ''} ${!canDo ? 'disabled' : ''}></td>
          <td class="mono cell-title">${esc(l.phoneNumber)}</td>
          <td>${esc(l.operator || '—')}</td>
          <td class="cell-sub">${esc(l.plan || '—')}</td>
        </tr>`).join('');
    tbody.querySelectorAll('[data-line]').forEach((r) => r.addEventListener('click', () => {
      if (!canDo) return;
      const id = r.dataset.line;
      if (lineBasket.has(id)) lineBasket.delete(id);
      else lineBasket.set(id, { line: freeLines.find((x) => x.id === id), note: '' });
      r.querySelector('input').checked = lineBasket.has(id);
      renderBasket();
    }));
  }

  function renderSelEmp() {
    const box = $('#ho-sel-emp', el);
    const p = state.empObj;
    if (!p) {
      box.innerHTML = `
        <div class="card card-pad" style="border-style:dashed;text-align:center;color:var(--outline);padding:22px">
          <span class="ms" style="font-size:30px">person_search</span>
          <div style="margin-top:6px;font-size:13px">${esc(t('handover.pickEmployeeHint'))}</div>
        </div>`;
      return;
    }
    box.innerHTML = `
      <div class="card card-pad" style="border-color:var(--primary-container);box-shadow:0 0 0 1px var(--primary-container)">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="avatar" style="width:46px;height:46px;font-size:15px">${esc(initials(p.fullName))}</span>
          <div style="flex:1;min-width:0">
            <div class="cell-title" style="font-size:15px">${esc(p.fullName)}</div>
            <div class="cell-sub">${esc(p.title || '—')} • ${esc(p.department || '—')}</div>
            <div class="cell-sub">${esc(p.email)}</div>
          </div>
          <button class="icon-btn" id="ho-clear-emp" title="Clear selection"><span class="ms">close</span></button>
        </div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:12px;padding-top:12px;border-top:1px solid var(--surface-container)">
          <span class="cell-sub">Currently holds <strong>${p.activeAssetCount}</strong> asset(s)</span>
          <span style="margin-left:auto">${badge(p.status)}</span>
        </div>
      </div>`;
    $('#ho-clear-emp', box).addEventListener('click', () => {
      state.emp = null;
      state.empObj = null;
      renderEmps();
      renderSelEmp();
      renderBasket();
    });
  }

  function renderBasket() {
    const selEmp = state.empObj;
    const total = basketTotal();
    $('#ho-basket-sub', el).textContent =
      `${total} item${total === 1 ? '' : 's'} selected${selEmp ? ' for ' + selEmp.fullName : ''}`
      + (lineBasket.size ? ` · ${lineBasket.size} ${t('handover.lines').toLowerCase()}` : '');
    $('#ho-basket-count', el).textContent = total;

    const body = $('#ho-basket-items', el);
    if (total === 0) {
      body.innerHTML = `<div class="table-empty">${esc(t('handover.basketEmpty'))}</div>`;
    } else {
      const assetBlocks = [...basket.values()].map(({ asset, note }) => `
        <div class="basket-item">
          <div class="basket-item-top">
            <span class="icon-chip"><span class="ms">${catIcon(asset.category)}</span></span>
            <div class="grow">
              <strong>${esc(asset.brand)} ${esc(asset.model)}</strong>
              <span class="cell-sub mono">${esc(asset.assetTag)}</span>
            </div>
            <button class="icon-btn" data-remove="${esc(asset.id)}" title="Remove"><span class="ms">close</span></button>
          </div>
          ${String(asset.notes || '').trim() ? `<div class="basket-asset-note"><span class="ms ms-sm">sticky_note_2</span> ${esc(String(asset.notes).trim())}</div>` : ''}
          <div class="basket-note-label">Delivery Condition Note</div>
          <input data-note="${esc(asset.id)}" placeholder="Optional condition note…" value="${esc(note)}">
        </div>`);
      const lineBlocks = [...lineBasket.values()].map(({ line, note }) => `
        <div class="basket-item">
          <div class="basket-item-top">
            <span class="icon-chip"><span class="ms">sim_card</span></span>
            <div class="grow">
              <strong class="mono">${esc(line.phoneNumber)}</strong>
              <span class="cell-sub">${esc(line.operator || '—')}${line.plan ? ' · ' + esc(line.plan) : ''}</span>
            </div>
            <button class="icon-btn" data-remove-line="${esc(line.id)}" title="Remove"><span class="ms">close</span></button>
          </div>
          <div class="basket-note-label">${esc(t('handover.lineNote'))}</div>
          <input data-line-note="${esc(line.id)}" placeholder="${esc(t('handover.lineNotePh'))}" value="${esc(note)}">
        </div>`);
      body.innerHTML = assetBlocks.join('') + lineBlocks.join('');
    }

    body.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      basket.delete(b.dataset.remove);
      renderStock();
      renderBasket();
    }));
    body.querySelectorAll('[data-remove-line]').forEach((b) => b.addEventListener('click', () => {
      lineBasket.delete(b.dataset.removeLine);
      renderLines();
      renderBasket();
    }));
    body.querySelectorAll('[data-note]').forEach((i) => i.addEventListener('change', () => {
      basket.get(i.dataset.note).note = i.value;
    }));
    body.querySelectorAll('[data-line-note]').forEach((i) => i.addEventListener('change', () => {
      lineBasket.get(i.dataset.lineNote).note = i.value;
    }));

    $('#ho-submit', el).disabled = !canDo || total === 0 || !state.emp;
  }

  /* ---- static bindings (attached once — inputs keep focus while typing) ---- */
  $('#ho-emp-search', el).addEventListener('input', (e) => {
    const term = e.target.value.trim();
    clearTimeout(empSearchTimer);
    empSearchTimer = setTimeout(() => searchEmps(term), 220);
  });
  let hwTimer;
  $('#ho-hw-search', el).addEventListener('input', (e) => {
    state.hwFilter = e.target.value.trim();
    clearTimeout(hwTimer);
    hwTimer = setTimeout(() => loadStock().catch((err) => toast(err.message, 'error')), 300);
  });
  let lineTimer;
  $('#ho-line-search', el).addEventListener('input', (e) => {
    state.lineFilter = e.target.value.trim();
    clearTimeout(lineTimer);
    lineTimer = setTimeout(() => loadLines().catch((err) => toast(err.message, 'error')), 300);
  });
  el.querySelectorAll('input[name="doctype"]').forEach((r) => r.addEventListener('change', () => {
    state.docType = r.value;
  }));
  el.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', async () => {
    printHandover(await api('/handovers/' + b.dataset.print));
  }));
  $('#ho-submit', el).addEventListener('click', async () => {
    const items = [...basket.values()].map(({ asset, note }) => ({ assetId: asset.id, conditionNote: note }));
    const lines = [...lineBasket.values()].map(({ line, note }) => ({ lineId: line.id, conditionNote: note }));
    const tplSel = $('#ho-tpl-select', el);
    const templateId = tplSel ? tplSel.value : null;
    try {
      const receipt = await api('/handovers', {
        method: 'POST',
        body: { employeeId: state.emp, documentType: state.docType, items, lines, templateId },
      });
      const bits = [];
      if (receipt.assetCount) bits.push(`${receipt.assetCount} asset(s)`);
      if (receipt.lineCount) bits.push(`${receipt.lineCount} line(s)`);
      toast(`Handover recorded — ${bits.join(' + ') || receipt.itemCount + ' item(s)'} → ${receipt.employee.fullName}`, 'success');
      const full = await api('/handovers/' + receipt.handoverId);
      printHandover(full);
      Views.handover(el); // reload lists
    } catch (err) {
      const detail = err.details ? ' — ' + err.details.map((d) => `${d.assetTag || d.phoneNumber || d.assetId || d.lineId}: ${d.reason}`).join('; ') : '';
      toast(err.message + detail, 'error');
    }
  });

  renderEmps();
  renderSelEmp();
  renderBasket();
  await Promise.all([loadStock(), loadLines()]);
};

/* Printable receipt — matches the print_preview_handover_form mockup */
// Scale each receipt so it fits exactly one A4 page. #print-root is display:none
// off-print, so it's laid out off-screen at A4 width to measure real height, then
// shrunk via `zoom` when content would spill to a 2nd sheet.
function fitReceiptsToOnePage() {
  // A4 @96dpi ≈ 794×1123. CSS sets 210×297mm with ~7–8mm padding; measure the
  // intrinsic content height without the forced A4 min-height so zoom is honest.
  const PRINT_W = 794;
  // Usable height inside 297mm with ~7mm vertical padding (avoids a stray 2nd sheet).
  const PRINT_H = 1050;
  const pr = $('#print-root');
  const restore = pr.getAttribute('style') || '';
  pr.setAttribute('style', 'display:block;position:fixed;left:-10000px;top:0;width:' + PRINT_W + 'px');
  pr.querySelectorAll('.receipt').forEach((r) => {
    r.style.zoom = '';
    r.style.transform = '';
    r.style.transformOrigin = '';
    r.style.width = '';
    r.style.height = 'auto';
    r.style.minHeight = '0';
    r.style.maxHeight = 'none';
    const h = r.scrollHeight;
    if (h > PRINT_H) {
      // Chrome print honors `zoom` and keeps layout box correct for page breaks.
      const z = Math.max(0.55, PRINT_H / h);
      r.style.zoom = z.toFixed(4);
    }
    r.style.height = '';
    r.style.minHeight = '';
    r.style.maxHeight = '';
  });
  pr.setAttribute('style', restore);
}

/* One Zimmet Belgesi receipt as HTML — Stitch "Terminal Protocol" layout.
   Labels follow the active UI language (i18n). Shared by print + template preview. */
function handoverReceiptHTML(ctx, tpl) {
  const lang = (typeof i18nLang === 'function' && i18nLang()) || 'en';
  const title = (lang === 'tr' && tpl.titleTr) ? tpl.titleTr
    : (lang === 'en' && tpl.titleEn) ? tpl.titleEn
      : (tpl.titleEn || tpl.titleTr || t('handover.title'));
  const subtitle = tpl.subtitle || t('handover.subtitle');

  const infoField = (label, value, accent) => `
    <div class="f">
      <small>${esc(label)}</small>
      <div${accent ? ' class="accent"' : ''}>${esc(value || '—')}</div>
    </div>`;
  const empFields = [infoField(t('handover.fullName'), ctx.employeeName)];
  if (tpl.showEmployeeId) empFields.push(infoField(t('handover.employeeId'), ctx.employeeId, true));
  if (tpl.showDepartment) empFields.push(infoField(t('handover.department'), ctx.department));
  if (tpl.showTitle) empFields.push(infoField(t('handover.position'), ctx.title));

  // Column widths always sum to 100% so the table fills the card (no empty right void).
  // Keep MODEL from stealing space when MAC/CONDITION are on (avoids a hollow gap before SERIAL).
  const cols = [{ h: t('handover.colNo'), weight: 0.06, cell: (i, idx) => idx + 1 }];
  if (tpl.colCategory) cols.push({ h: t('handover.colCategory'), weight: 0.14, cell: (i) => esc(i.category || '—') });
  cols.push({
    h: t('handover.colModel'),
    weight: (tpl.colMac && tpl.colCondition) ? 0.22 : (tpl.colMac || tpl.colCondition) ? 0.28 : 0.36,
    cell: (i) => `${esc(i.brand)} ${esc(i.model)}`,
  });
  if (tpl.colSerial) cols.push({ h: t('handover.colSerial'), weight: 0.20, cls: 'mono', cell: (i) => esc(i.serialNumber) });
  if (tpl.colMac) cols.push({ h: t('handover.colMac'), weight: 0.18, cls: 'mono', cell: (i) => esc(i.macAddress || 'N/A') });
  if (tpl.colCondition) {
    cols.push({
      h: t('handover.colCondition'),
      weight: 0.20,
      cell: (i) => esc(i.conditionNote || 'New'),
    });
  }
  const wSum = cols.reduce((s, c) => s + c.weight, 0);
  cols.forEach((c) => { c.pct = (c.weight / wSum) * 100; });
  // Fix float drift on the last column
  const pctUsed = cols.slice(0, -1).reduce((s, c) => s + c.pct, 0);
  cols[cols.length - 1].pct = 100 - pctUsed;

  const allItems = ctx.items || [];
  const lineItems = allItems.filter((i) => i.kind === 'line');
  const assetItems = allItems.filter((i) => i.kind !== 'line');
  // Legacy receipts (no kind) → all treated as assets
  const assets = (assetItems.length || lineItems.length) ? assetItems : allItems;

  const colgroup = `<colgroup>${cols.map((c) => `<col style="width:${c.pct.toFixed(2)}%">`).join('')}</colgroup>`;
  const thead = `<tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr>`;
  const bodyRows = assets.map((i, idx) =>
    `<tr>${cols.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ''}>${c.cell(i, idx)}</td>`).join('')}</tr>`).join('');

  const lineTable = lineItems.length ? `
        <section class="r-card">
          <div class="r-card-h"><span class="ms">sim_card</span> ${esc(t('handover.lines'))}</div>
          <table class="r-items">
            <colgroup>
              <col style="width:8%"><col style="width:28%"><col style="width:18%">
              <col style="width:22%"><col style="width:24%">
            </colgroup>
            <thead><tr>
              <th>${esc(t('handover.colNo'))}</th>
              <th>${esc(t('handover.colPhone'))}</th>
              <th>${esc(t('handover.colOperator'))}</th>
              <th>${esc(t('handover.colPlan'))}</th>
              <th>${esc(t('handover.colSim'))}</th>
            </tr></thead>
            <tbody>
              ${lineItems.map((i, idx) => `<tr>
                <td>${idx + 1}</td>
                <td class="mono">${esc(i.phoneNumber || i.model || '—')}</td>
                <td>${esc(i.operator || i.brand || '—')}</td>
                <td>${esc(i.plan || '—')}</td>
                <td class="mono">${esc(i.simSerial || i.serialNumber || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </section>` : '';

  const assetsSection = assets.length ? `
        <section class="r-card">
          <div class="r-card-h"><span class="ms">devices_other</span> ${esc(t('handover.assets'))}</div>
          <table class="r-items">
            ${colgroup}
            <thead>${thead}</thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </section>` : '';

  const issuedLabel = t('handover.issuedBy');
  const receivedLabel = t('handover.receivedBy');
  const address = (ctx.companyAddress || '').trim();
  const design = ['terminal', 'classic', 'corporate', 'slate'].includes(tpl.design)
    ? tpl.design : 'terminal';

  return `
    <div class="receipt receipt-v2 design-${design}">
      <header class="r-banner">
        <div class="r-banner-left">
          ${tpl.showLogo ? `<div class="r-logo">${ctx.companyLogo
            ? `<img src="${esc(ctx.companyLogo)}" alt="logo">`
            : esc((ctx.companyName || 'A')[0].toUpperCase())}</div>` : ''}
          <div>
            <h1>${esc((ctx.companyName || 'IT ASSET CONTROL PRO').toUpperCase())}</h1>
            ${address ? `<div class="r-address">${esc(address)}</div>` : ''}
            <small>${esc(subtitle)}</small>
          </div>
        </div>
        <div class="r-banner-right">
          <h2>${esc(title)}</h2>
          ${t('handover.titleAlt') && t('handover.titleAlt').toLowerCase() !== String(title).toLowerCase()
            ? `<h3>(${esc(t('handover.titleAlt'))})</h3>` : ''}
          <div class="r-meta">
            <span>${esc(t('handover.refId'))}</span><strong class="mono accent">${esc(ctx.formNo)}${esc(ctx.formSuffix || '')}</strong>
            <span>${esc(t('handover.date'))}</span><strong class="mono">${esc(ctx.dateStr)}</strong>
          </div>
        </div>
      </header>

      <div class="r-body">
        <section class="r-card">
          <div class="r-card-h"><span class="ms">person</span> ${esc(t('handover.assignee'))}</div>
          <div class="r-info${empFields.length >= 3 ? ' r-info-3' : ''}">${empFields.join('')}</div>
        </section>

        ${assetsSection}
        ${lineTable}

        ${tpl.showTerms ? `<section class="r-card r-terms-card">
          <div class="r-card-h"><span class="ms">gavel</span> ${esc(t('handover.terms'))}</div>
          <div class="r-terms">${ctx.termsHtml || ''}</div>
        </section>` : ''}

        <section class="r-sigs">
          <div class="sig">
            <p class="sig-label">${esc(issuedLabel)} <span>${esc(t('handover.issuedByRole'))}</span></p>
            <div class="sig-line"></div>
            <div class="sig-foot">
              <div>
                <strong>${esc(ctx.deliveredByName || 'IT Department')}</strong>
                <small>${esc(t('handover.signature'))}</small>
              </div>
              <div class="sig-date"><small>${esc(t('handover.date'))}:</small> <span class="sig-date-line"></span></div>
            </div>
          </div>
          <div class="sig">
            <p class="sig-label">${esc(receivedLabel)} <span>${esc(t('handover.receivedByRole'))}</span></p>
            <div class="sig-line"></div>
            <div class="sig-foot">
              <div>
                <strong>${esc(ctx.employeeName)}</strong>
                <small>${esc(t('handover.signature'))}</small>
              </div>
              <div class="sig-date"><small>${esc(t('handover.date'))}:</small> <span class="sig-date-line"></span></div>
            </div>
          </div>
        </section>

        ${tpl.showReturnSection ? `<section class="r-card r-return">
          <div class="r-card-h">${esc(t('handover.returnSection'))}</div>
          <p class="r-terms">${esc(t('handover.returnBody'))}</p>
          <div class="r-info r-info-3">
            <div class="f"><small>${esc(t('handover.returnDate'))}</small><div class="r-write-line">&nbsp;</div></div>
            <div class="f"><small>${esc(t('handover.returnCondition'))}</small><div class="r-write-line">&nbsp;</div></div>
            <div class="f"><small>${esc(t('handover.missingItems'))}</small><div class="r-write-line">&nbsp;</div></div>
          </div>
          <div class="r-sigs r-return-sigs">
            <div class="sig">
              <p class="sig-label">${esc(t('handover.returnedBy'))}</p>
              <div class="sig-line"></div>
              <div class="sig-foot">
                <div>
                  <strong>${esc(ctx.employeeName)}</strong>
                  <small>${esc(t('handover.signature'))}</small>
                </div>
              </div>
            </div>
            <div class="sig">
              <p class="sig-label">${esc(t('handover.receivedBackBy'))}</p>
              <div class="sig-line"></div>
              <div class="sig-foot">
                <div>
                  <strong>&nbsp;</strong>
                  <small>${esc(t('handover.nameAndSignature'))}</small>
                </div>
              </div>
            </div>
          </div>
        </section>` : ''}

        <footer class="r-footer">
          <p><span class="ms">verified_user</span> ${esc(tpl.footerNote || t('handover.generatedBy'))}</p>
        </footer>
      </div>
    </div>`;
}

async function printHandover(h) {
  let emp = null;
  try {
    emp = await api('/employees/' + encodeURIComponent(h.employeeId)).catch(() => null);
  } catch { /* print with what we have */ }

  const items = h.items || [];
  const groups = h.documentType === 'separate' ? items.map((i) => [i]) : [items];
  const formNo = 'HF-' + String(h.id || '').slice(0, 8).toUpperCase();
  const dateStr = fmtDate(h.transactionDate);

  // Prefer localized default terms; only use Settings override when it differs
  // from the stock bilingual default (so language switching actually works).
  const stockDefault = `I acknowledge receipt of the equipment listed above`;
  const stored = String(AppConfig.handoverTerms || '').trim();
  const useCustom = stored && !stored.startsWith(stockDefault);
  const termsHtml = useCustom
    ? stored.split(/\n\s*\n/).filter((p) => p.trim())
      .map((p) => `<p>${esc(p.trim())}</p>`).join('')
    : `<p>${esc(t('handover.termsBody'))}</p>`;

  const ctxBase = {
    companyName: AppConfig.companyName, companyLogo: AppConfig.companyLogo,
    companyAddress: AppConfig.companyAddress,
    formNo, dateStr,
    pageTotal: groups.length,
    employeeName: h.employeeName,
    employeeId: emp ? String(emp.id).slice(0, 8).toUpperCase() : '',
    department: emp && emp.department, title: emp && emp.title,
    deliveredByName: (h.itUserName && h.itUserActive !== false)
      ? h.itUserName
      : ((Auth.profile && Auth.profile.username) || h.itUserName || 'IT Department'),
    termsHtml,
  };

  let selectedTplId = h.templateId
    || (AppConfig.handoverTemplates && AppConfig.handoverTemplates[0] && AppConfig.handoverTemplates[0].id)
    || 'default';

  function buildPrintRoot(tplId) {
    const tpl = resolveHandoverTpl(tplId);
    selectedTplId = tpl.id || tplId;
    $('#print-root').innerHTML = groups.map((group, gi) => handoverReceiptHTML({
      ...ctxBase,
      formSuffix: groups.length > 1 ? '-' + (gi + 1) : '',
      pageNum: gi + 1,
      items: group,
    }, tpl)).join('');
  }

  buildPrintRoot(selectedTplId);

  openModal({
    title: t('handover.printPreview'),
    wide: true,
    body: `
      ${handoverTplSelectHtml(selectedTplId)}
      <div class="edit-hint"><span class="ms ms-sm">edit</span>
        ${esc(t('handover.editHint'))}</div>
      <div class="preview-scroll" id="ho-preview-scroll">
      ${groups.map((_, gi) => `<div class="preview-paper" contenteditable="true" spellcheck="false">${
        $('#print-root').children[gi].outerHTML
      }</div>`).join('')}
    </div>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
      ${h.transactionDate && h.employeeId && h.id && h.id !== h.employeeId
        ? `<button class="btn btn-outline" id="do-download"><span class="ms">download</span> ${esc(t('common.download'))} PDF</button>` : ''}
      <button class="btn btn-primary" id="do-print"><span class="ms">print</span> ${esc(t('common.print'))}</button>`,
    onMount(overlay) {
      const refreshPreview = () => {
        const sel = $('#ho-tpl-select', overlay);
        buildPrintRoot(sel ? sel.value : selectedTplId);
        const scroll = $('#ho-preview-scroll', overlay);
        if (scroll) {
          scroll.innerHTML = groups.map((_, gi) => `<div class="preview-paper" contenteditable="true" spellcheck="false">${
            $('#print-root').children[gi].outerHTML
          }</div>`).join('');
        }
      };
      const sel = $('#ho-tpl-select', overlay);
      if (sel) sel.addEventListener('change', refreshPreview);

      $('#do-print', overlay).addEventListener('click', () => {
        const edited = [...overlay.querySelectorAll('.preview-paper')]
          .map((p) => sanitizePrintHtml(p.innerHTML)).join('');
        $('#print-root').innerHTML = edited;
        fitReceiptsToOnePage();
        window.print();
      });
      const dl = $('#do-download', overlay);
      if (dl) dl.addEventListener('click', async () => {
        dl.disabled = true;
        try {
          const lang = (typeof i18nLang === 'function' && i18nLang()) || 'en';
          const tplQ = selectedTplId ? `&templateId=${encodeURIComponent(selectedTplId)}` : '';
          const resp = await fetch(`/api/handovers/${h.id}/pdf?lang=${encodeURIComponent(lang)}${tplQ}`, {
            headers: { Authorization: 'Bearer ' + Auth.token },
          });
          if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            throw new Error(j.error || 'PDF could not be generated');
          }
          const blob = await resp.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `zimmet-HF-${String(h.id).slice(0, 8).toUpperCase()}.pdf`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          toast(t('common.download') + ' PDF', 'success');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          dl.disabled = false;
        }
      });
    },
  });
}

/* ============================== MAINTENANCE ============================== */
