
Views.reports = async function (el) {
  if (!Auth.canIam('report', 'read') && !Auth.canIam('report', 'export')) {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">Reports requires <strong>report:read</strong>.</p></div>`;
    return;
  }
  const canExport = Auth.canIam('report', 'export');
  const canMaintList = iamCanList('maintenance');
  const canHandoverList = iamCanList('handover');
  const canAssetList = iamCanList('asset');
  const presetReports = visibleReportDefs();
  const customSourceKeys = visibleCustomSourceKeys();
  /* ---- data for the analytics layer (only fetch modules the user may list) ---- */
  const [assetsRes, maintenance, handovers] = await Promise.all([
    canAssetList ? api('/assets?limit=2000').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    canMaintList ? api('/maintenance?limit=2000').catch(() => []) : Promise.resolve([]),
    canHandoverList ? api('/handovers?limit=200').catch(() => []) : Promise.resolve([]),
  ]);
  const assets = assetsRes.items;
  const state = { range: 30, page: 1 };
  const PAGE = 8;
  const toDate = (v) => new Date(v && v._seconds ? v._seconds * 1000 : v);
  const MONTH_MS = 30.44 * 86400000;

  function computeAnalytics() {
    const now = Date.now();
    const rangeMs = state.range ? state.range * 86400000 : Infinity;
    const inRange = (d) => d && (now - toDate(d).getTime()) <= rangeMs && toDate(d).getTime() <= now + 86400000;

    const active = assets.filter((x) => x.status !== 'Scrap');
    const purchased = assets.filter((x) => x.purchaseDate && inRange(x.purchaseDate));
    const prior = state.range ? assets.filter((x) => {
      if (!x.purchaseDate) return false;
      const age = now - toDate(x.purchaseDate).getTime();
      return age > rangeMs && age <= rangeMs * 2;
    }) : [];
    const procTrend = prior.length ? Math.round(((purchased.length - prior.length) / prior.length) * 100) : null;

    const lc = AppConfig.lifecycles || {};
    const avgLifecycle = active.length
      ? Math.round(active.reduce((s, x) => s + (lc[x.category] || lc.Other || 48), 0) / active.length) : 0;
    const withPd = active.filter((x) => x.purchaseDate);
    const avgAge = withPd.length
      ? Math.round(withPd.reduce((s, x) => s + (now - toDate(x.purchaseDate).getTime()), 0) / withPd.length / MONTH_MS) : 0;

    const maintInRange = maintenance.filter((m) => inRange(m.sentDate));
    const spend = maintInRange.reduce((s, m) => s + Number(m.cost || 0), 0);
    const openRepairs = maintenance.filter((m) => !m.returnDate).length;

    // Inventory growth: cumulative fleet size at each of the last 10 month-ends
    const growth = [];
    const base = new Date(); base.setDate(1);
    for (let i = 9; i >= 0; i--) {
      const m = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
      growth.push({
        label: m.toLocaleString('en', { month: 'short' }),
        value: assets.filter((x) => x.purchaseDate && toDate(x.purchaseDate).getTime() < end).length,
      });
    }

    const STATUSES = [
      ['Assigned', '#3525cd'], ['In Stock', '#c3c0ff'], ['In Repair', '#565e74'], ['Scrap', '#ffb4ab'],
    ];
    const statusData = STATUSES.map(([s, color]) => ({
      status: s, color, count: assets.filter((x) => x.status === s).length,
    }));

    const events = [
      ...handovers.flatMap((h) => (h.items || []).map((i) => ({
        date: toDate(h.transactionDate), type: 'Handover',
        model: `${i.brand} ${i.model}`, tag: i.assetTag, who: h.employeeName, cost: null,
      }))),
      ...assets.filter((x) => x.purchaseDate).map((x) => ({
        date: toDate(x.purchaseDate), type: 'Procurement',
        model: `${x.brand} ${x.model}`, tag: x.assetTag, who: 'IT Stock', cost: null,
      })),
      ...maintenance.map((m) => ({
        date: toDate(m.sentDate), type: 'Repair',
        model: m.assetTag, tag: m.assetTag, who: m.serviceCompany, cost: Number(m.cost || 0),
      })),
    ].filter((e) => inRange(e.date)).sort((a, b) => b.date - a.date);

    return { totalActive: active.length, purchased, procTrend, avgLifecycle, avgAge, spend, openRepairs, growth, statusData, events };
  }

  /* ---- static shell: analytics slot + existing builder/presets kept below ---- */
  el.innerHTML = `
    ${pageHead('Reports & Analytics', 'Comprehensive view of your IT asset landscape.', `
      <select id="rep-range" style="width:auto">
        <option value="30">Last 30 Days</option>
        <option value="90">Last 90 Days</option>
        <option value="365">Last 12 Months</option>
        <option value="0">All Time</option>
      </select>
      ${canExport ? '<button class="btn btn-outline" id="rep-export-events"><span class="ms">download</span> Export Report</button>' : ''}
    `)}

    <div id="rep-analytics"></div>

    <div class="gs-section" style="margin:24px 0 8px">Custom Report Builder</div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-pad">
        ${customSourceKeys.length === 0
          ? '<div class="cell-sub">No data sources available — enable read on asset, employee, license, etc.</div>'
          : `<div class="form-grid">
          <div class="form-field">
            <label>Data source</label>
            <select id="crb-source">
              ${customSourceKeys.map((k) => `<option value="${k}">${esc(CUSTOM_SOURCES[k].label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-field"><label>Filters <span class="ob-hint">(leave empty to include everything)</span></label>
            <div id="crb-filters" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div></div>
          <div class="form-field full"><label>Columns</label>
            <div id="crb-cols" style="display:flex;flex-wrap:wrap;gap:8px"></div></div>
        </div>
        <button id="crb-generate" class="btn btn-primary" style="margin-top:14px">
          <span class="ms">table_view</span> Generate Report</button>`}
      </div>
    </div>

    <div class="gs-section" style="margin-bottom:8px">Preset Reports <span class="ob-hint">(${presetReports.length} available — click to preview, then export CSV or print)</span></div>
    ${presetReports.length === 0
      ? '<div class="card card-pad"><p class="cell-sub">No preset reports available for your permissions. <strong>report:read</strong> opens this page; each report also needs the matching module read (e.g. <strong>maintenance:read</strong> for repair reports).</p></div>'
      : [...new Set(presetReports.map((r) => r.group))].map((group) => `
      <div class="rep-group-label">${esc(group)}</div>
      <div class="grid grid-2" style="margin-bottom:14px">
        ${presetReports.filter((r) => r.group === group).map((r) => `
        <div class="card card-pad gs-item" data-report="${r.id}" style="align-items:flex-start;cursor:pointer">
          ${iconChip(r.icon, r.tone)}
          <div style="flex:1">
            <div class="cell-title" style="font-size:15px">${esc(r.title)}</div>
            <div class="cell-sub">${esc(r.desc)}</div>
          </div>
          <span class="ms" style="color:var(--outline)">chevron_right</span>
        </div>`).join('')}
      </div>`).join('')}
    <div id="report-result" style="margin-top:20px"></div>`;

  /* ---- analytics renderer (re-runs on range / page change only) ---- */
  function renderAnalytics() {
    const a = computeAnalytics();
    const rangeLabel = state.range === 0 ? 'all time' : `last ${state.range} days`;

    const maxG = Math.max(...a.growth.map((g) => g.value), 1);
    const barsHtml = a.growth.map((g, i) => `
      <div class="bar-col" title="${esc(g.label)}: ${g.value} assets">
        <div class="bar ${i === a.growth.length - 1 ? 'hot' : ''}" style="height:${Math.max(3, (g.value / maxG) * 100)}%"></div>
        <span class="bar-label">${esc(g.label)}</span>
      </div>`).join('');

    const totalStatus = a.statusData.reduce((s, x) => s + x.count, 0) || 1;
    let acc = 0;
    const R = 74, C = 2 * Math.PI * R;
    const segs = a.statusData.map((x) => {
      const frac = x.count / totalStatus;
      const seg = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${x.color}" stroke-width="22"
        stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}"
        stroke-dashoffset="${(-acc * C).toFixed(1)}" transform="rotate(-90 100 100)"/>`;
      acc += frac;
      return seg;
    }).join('');

    const pages = Math.max(1, Math.ceil(a.events.length / PAGE));
    state.page = Math.min(state.page, pages);
    const rows = a.events.slice((state.page - 1) * PAGE, state.page * PAGE);
    const evtPill = { Procurement: 'pill-indigo', Handover: 'pill-blue', Repair: 'pill-rose' };
    const pageBtns = [];
    for (let p = Math.max(1, state.page - 2); p <= Math.min(pages, Math.max(1, state.page - 2) + 4); p++) pageBtns.push(p);

    $('#rep-analytics', el).innerHTML = `
      <div class="grid grid-4" style="margin-bottom:20px">
        <div class="card rep-kpi">
          <div class="rep-kpi-head"><span class="rep-kpi-label">Total Active<br>Inventory</span>${iconChip('devices', 'indigo')}</div>
          <div class="rep-kpi-value">${a.totalActive.toLocaleString()}
            <span class="trend-chip up"><span class="ms">trending_up</span> +${a.purchased.length} ${rangeLabel}</span></div>
        </div>
        <div class="card rep-kpi">
          <div class="rep-kpi-head"><span class="rep-kpi-label">Avg Asset<br>Lifecycle</span>${iconChip('history_toggle_off', 'blue')}</div>
          <div class="rep-kpi-value">${a.avgLifecycle} <small>months</small>
            <span class="trend-chip flat"><span class="ms">schedule</span> avg age ${a.avgAge} mo</span></div>
        </div>
        <div class="card rep-kpi">
          <div class="rep-kpi-head"><span class="rep-kpi-label">Procurement<br>(${esc(rangeLabel)})</span>${iconChip('shopping_cart', 'emerald')}</div>
          <div class="rep-kpi-value">${a.purchased.length} <small>assets</small>
            ${a.procTrend != null ? `<span class="trend-chip ${a.procTrend >= 0 ? 'up' : 'down'}">
              <span class="ms">${a.procTrend >= 0 ? 'trending_up' : 'trending_down'}</span> ${a.procTrend >= 0 ? '+' : ''}${a.procTrend}%</span>` : ''}</div>
        </div>
        <div class="card rep-kpi">
          <div class="rep-kpi-head"><span class="rep-kpi-label">Maintenance<br>Spend</span>${iconChip('build', 'amber')}</div>
          <div class="rep-kpi-value">${canMaintList ? fmtMoney(a.spend) : '—'}
            <span class="trend-chip ${canMaintList && a.openRepairs ? 'down' : 'flat'}"><span class="ms">build</span> ${canMaintList ? `${a.openRepairs} open` : 'locked'}</span></div>
        </div>
      </div>

      <div class="dash-grid" style="margin-bottom:20px">
        <div class="card">
          <div class="card-head"><h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Inventory Growth</h3>
            <span class="cell-sub">cumulative fleet size, last 10 months</span></div>
          <div style="display:flex">
            <div class="bar-axis"><span>${maxG}</span><span>${Math.round(maxG / 2)}</span><span>0</span></div>
            <div class="bars" style="flex:1">${barsHtml}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Asset Status</h3></div>
          <div class="donut-wrap" style="padding-top:14px">
            <svg width="190" height="190" viewBox="0 0 200 200" role="img" aria-label="Asset status distribution">
              ${segs}
              <text x="100" y="98" text-anchor="middle" font-size="26" font-weight="800" fill="#1b1b24">${totalStatus.toLocaleString()}</text>
              <text x="100" y="118" text-anchor="middle" font-size="12" fill="#777587">Total</text>
            </svg>
          </div>
          <div style="padding-bottom:12px">
            ${a.statusData.map((x) => `
            <div class="status-legend">
              <span class="sw" style="background:${x.color}"></span>${esc(x.status)}
              <strong>${Math.round((x.count / totalStatus) * 100)}%</strong>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Recent Procurement &amp; Handover Trends</h3>
          <span class="cell-sub">${a.events.length} events • ${esc(rangeLabel)}</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Event Type</th><th>Asset Model</th><th>Assigned To</th><th style="text-align:right">Value/Cost</th></tr></thead>
          <tbody>
            ${rows.length === 0 ? '<tr><td colspan="5" class="table-empty">No events in this window.</td></tr>' :
              rows.map((e) => `
              <tr>
                <td class="mono">${toDate(e.date).toISOString().slice(0, 10)}</td>
                <td><span class="pill ${evtPill[e.type]}">${e.type}</span></td>
                <td><span class="cell-title">${esc(e.model)}</span> <span class="cell-sub mono">${esc(e.tag)}</span></td>
                <td>${esc(e.who)}</td>
                <td style="text-align:right" class="mono">${e.cost != null ? fmtMoney(e.cost) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="table-foot">
          Showing ${a.events.length === 0 ? 0 : (state.page - 1) * PAGE + 1} to ${Math.min(state.page * PAGE, a.events.length)} of ${a.events.length} entries
          <span class="spacer"></span>
          <div class="pager">
            <button data-pg="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
            ${pageBtns.map((p) => `<button data-pg="${p}" class="${p === state.page ? 'on' : ''}">${p}</button>`).join('')}
            <button data-pg="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      </div>`;

    $('#rep-analytics', el).querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
      state.page = Number(b.dataset.pg);
      renderAnalytics();
    }));
  }

  $('#rep-range', el).addEventListener('change', (e) => {
    state.range = Number(e.target.value);
    state.page = 1;
    renderAnalytics();
  });
  $('#rep-export-events', el)?.addEventListener('click', () => {
    const a = computeAnalytics();
    csvDownload(
      `analytics-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Event Type', 'Asset Model', 'Asset Tag', 'Assigned To', 'Cost'],
      a.events.map((e) => [toDate(e.date).toISOString().slice(0, 10), e.type, e.model, e.tag, e.who,
        e.cost != null ? fmtMoney(e.cost) : ''])
    );
    toast('Analytics report exported as CSV', 'success');
  });
  renderAnalytics();

  /* ---- custom builder wiring (unchanged behaviour) ---- */
  const srcSel = $('#crb-source', el);
  function renderBuilder() {
    if (!srcSel) return;
    const def = CUSTOM_SOURCES[srcSel.value];
    if (!def) return;
    $('#crb-cols', el).innerHTML = def.columns.map(([k, label]) => `
      <label class="chip" style="cursor:pointer"><input type="checkbox" value="${k}" checked
        style="width:14px;height:14px;accent-color:var(--primary-container)"> ${esc(label)}</label>`).join('');
    $('#crb-filters', el).innerHTML = def.filters.map((f) => {
      if (f.type === 'select') {
        return `<select data-filter="${f.key}" title="${esc(f.label)}">
          ${f.options.map((o) => {
            const v = typeof o === 'object' ? o.value : o;
            const l = typeof o === 'object' ? o.label : (o === '' ? `${f.label}: all` : o);
            return `<option value="${esc(v)}">${esc(l)}</option>`;
          }).join('')}</select>`;
      }
      return `<input type="${f.type}" data-filter="${f.key}" placeholder="${esc(f.label)}" title="${esc(f.label)}">`;
    }).join('') || '<span class="cell-sub">No filters for this source.</span>';
  }
  srcSel?.addEventListener('change', renderBuilder);
  renderBuilder();

  $('#crb-generate', el)?.addEventListener('click', async () => {
    const def = CUSTOM_SOURCES[srcSel.value];
    const slot = $('#report-result', el);
    slot.innerHTML = '<div class="table-empty">Generating custom report…</div>';
    try {
      let rows = await def.fetch();
      const activeFilters = [];
      el.querySelectorAll('#crb-filters [data-filter]').forEach((inp) => {
        const v = inp.value;
        if (v === '' || v == null) return;
        const f = def.filters.find((x) => x.key === inp.dataset.filter);
        rows = rows.filter((r) => f.apply(r, v));
        activeFilters.push(`${f.label}: ${v}`);
      });
      const selCols = def.columns.filter(([k]) =>
        el.querySelector(`#crb-cols input[value="${k}"]`).checked);
      if (selCols.length === 0) throw new Error('Select at least one column');
      showReportResult(slot, `Custom — ${def.label}`, {
        cols: selCols.map(([, label]) => label),
        rows: rows.map((r) => selCols.map(([, , get]) => get(r))),
        summary: `${rows.length} rows • ${def.label}` +
          (activeFilters.length ? ` • filters: ${activeFilters.join('; ')}` : ' • no filters'),
      });
    } catch (err) {
      slot.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  });

  /* ---- preset cards ---- */
  bindView(el, async (e) => {
    const card = e.target.closest('[data-report]'); if (!card) return;
    const def = REPORT_DEFS.find((r) => r.id === card.dataset.report);
    const slot = $('#report-result', el);
    slot.innerHTML = '<div class="table-empty">Generating report…</div>';
    try {
      showReportResult(slot, def.title, await buildReport(def.id));
    } catch (err) {
      slot.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  });
};

/* ============================== STOCK COUNT ============================== */
/*
 * Physical inventory flow: open a session, scan asset barcodes/QRs (handheld
 * scanner types into the box; the camera button uses ZXing + BarcodeDetector),
 * then close to compare scans against the inventory. Sessions live on the
 * server, so a count started on the PC can be continued from a phone.
 */
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (loadZXing._p) return loadZXing._p;
  loadZXing._p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/zxing.min.js';
    s.async = true;
    s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing failed to load')));
    s.onerror = () => reject(new Error('Could not load barcode scanner library'));
    document.head.appendChild(s);
  });
  return loadZXing._p;
}

/** Hints tuned for ITACM labels (Code 128) + asset QR codes. */
function zxingHints(ZX) {
  const hints = new Map();
  hints.set(ZX.DecodeHintType.TRY_HARDER, true);
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.CODE_128,
    ZX.BarcodeFormat.QR_CODE,
    ZX.BarcodeFormat.CODE_39,
    ZX.BarcodeFormat.CODE_93,
    ZX.BarcodeFormat.EAN_13,
    ZX.BarcodeFormat.EAN_8,
    ZX.BarcodeFormat.ITF,
    ZX.BarcodeFormat.DATA_MATRIX,
  ]);
  return hints;
}

function zxingReader(ZX) {
  return new ZX.BrowserMultiFormatReader(zxingHints(ZX), 250);
}

const BD_FORMATS = ['qr_code', 'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'data_matrix'];

async function detectWithBarcodeDetector(source) {
  if (!('BarcodeDetector' in window)) return '';
  try {
    const detector = new BarcodeDetector({ formats: BD_FORMATS });
    const codes = await detector.detect(source);
    if (codes[0] && codes[0].rawValue) return String(codes[0].rawValue).trim();
  } catch { /* unsupported format / frame */ }
  return '';
}

/** Load a File into an HTMLImageElement (honours EXIF orientation via createImageBitmap when available). */
async function imageFromFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      const url = canvas.toDataURL('image/jpeg', 0.92);
      return loadHtmlImage(url);
    } catch { /* fall through */ }
  }
  return loadHtmlImage(URL.createObjectURL(file), true);
}

function loadHtmlImage(src, revoke) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (revoke) URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = () => {
      if (revoke) URL.revokeObjectURL(src);
      reject(new Error('Could not load image'));
    };
    img.src = src;
  });
}

/** Draw image (optionally center-cropped) scaled so the long edge ≤ maxEdge. */
function canvasFromImage(img, maxEdge, crop = 1) {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const cw = Math.max(1, Math.floor(sw * crop));
  const ch = Math.max(1, Math.floor(sh * crop));
  const sx = Math.floor((sw - cw) / 2);
  const sy = Math.floor((sh - ch) / 2);
  const scale = Math.min(1, maxEdge / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * scale));
  const h = Math.max(1, Math.round(ch * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, w, h);
  return canvas;
}

async function decodeCanvasWithZXing(ZX, canvas) {
  const reader = zxingReader(ZX);
  // Prefer decode from a data-URL image — most reliable across ZXing builds.
  const img = await loadHtmlImage(canvas.toDataURL('image/jpeg', 0.9));
  try {
    const result = await reader.decodeFromImageElement(img);
    return result && result.getText ? result.getText().trim() : '';
  } catch {
    return '';
  }
}

/** Fast, synchronous single-frame decode straight off a canvas (no data-URL
 *  round-trip) using ZXing's low-level bitmap API. Used by the live camera loop
 *  where we decode many frames per second. Returns '' when no code is found. */
function decodeFrameWithZXing(ZX, reader, canvas) {
  try {
    const source = new ZX.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(source));
    const result = reader.decodeBitmap(bitmap);
    return result && result.getText ? result.getText().trim() : '';
  } catch {
    return ''; // NotFoundException on most frames — expected.
  }
}

/**
 * Decode a barcode/QR from a camera photo. Tries BarcodeDetector + ZXing across
 * several scales and a center crop — phone cameras often shoot 12MP+ images that
 * raw ZXing decodeFromImageUrl fails on.
 */
async function decodeBarcodeFromFile(file) {
  const img = await imageFromFile(file);
  const ZX = await loadZXing();

  // BarcodeDetector on the full (orientation-corrected) image first — fast on Chromium.
  const fromBd = await detectWithBarcodeDetector(img);
  if (fromBd) return fromBd;

  const attempts = [
    { max: 1280, crop: 1 },
    { max: 960, crop: 1 },
    { max: 1600, crop: 1 },
    { max: 1280, crop: 0.72 },
    { max: 800, crop: 0.55 },
    { max: 640, crop: 1 },
  ];
  for (const a of attempts) {
    const canvas = canvasFromImage(img, a.max, a.crop);
    const bd = await detectWithBarcodeDetector(canvas);
    if (bd) return bd;
    const zx = await decodeCanvasWithZXing(ZX, canvas);
    if (zx) return zx;
  }
  return '';
}

/** Photo / capture fallback — works on http://LAN-IP where live getUserMedia is blocked.
 *  Stays open after each successful read so rapid counting is possible.
 *  Resolves when the user closes the modal. */
function scanWithPhoto(onCode, opts = {}) {
  const once = !!(opts && opts.once);
  const title = (opts && opts.title) || t('stock.scanCameraTitle');
  return new Promise((resolve) => {
    openModal({
      title,
      body: `
      <p class="cell-sub" style="margin:0 0 14px">${esc(t('stock.photoHint'))}</p>
      <input type="file" id="sc-photo" accept="image/*" capture="environment" class="hidden">
      <button type="button" class="btn btn-primary btn-block btn-lg" id="sc-photo-btn">
        <span class="ms">photo_camera</span> ${esc(t('stock.takePhoto'))}</button>
      <div id="sc-photo-status" class="cell-sub" style="margin-top:12px;text-align:center"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onClose: () => resolve(),
      onMount(overlay) {
        const input = $('#sc-photo', overlay);
        const status = $('#sc-photo-status', overlay);
        $('#sc-photo-btn', overlay).addEventListener('click', () => input.click());
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) return;
          status.textContent = t('stock.decoding');
          try {
            const code = await decodeBarcodeFromFile(file);
            if (!code) {
              status.textContent = t('stock.noCodeInPhoto');
              return;
            }
            status.textContent = code;
            await onCode(code);
            if (once) closeModal();
            else status.textContent = t('stock.keepScanning');
          } catch {
            status.textContent = t('stock.noCodeInPhoto');
          }
        });
      },
    });
  });
}

/** Live continuous camera scan (HTTPS / localhost). Camera stays open until the
 *  user taps Stop — each hit only fires via onCode. Pass `{ once: true }` to
 *  close after the first successful read (quick-scan asset lookup). */
async function scanWithCamera(onCode, opts = {}) {
  const once = !!(opts && opts.once);
  const title = (opts && opts.title) || t('stock.scanCameraTitle');
  const canLive = window.isSecureContext
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!canLive) return scanWithPhoto(onCode, opts);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        // Help autofocus lock onto nearby labels when the browser supports it.
        advanced: [{ focusMode: 'continuous' }],
      },
    });
  } catch (err) {
    // Retry without advanced constraints (some browsers reject the whole call).
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err2) {
      const name = (err2 && err2.name) || (err && err.name) || '';
      if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError' || name === 'SecurityError') {
        return scanWithPhoto(onCode, opts);
      }
      toast('Camera access failed — type the tag or serial, or try again', 'error');
      return;
    }
  }

  return new Promise((resolve) => {
    let last = ''; let lastAt = 0; let timer = null; let busy = false;
    let switchingToPhoto = false;
    const cleanup = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
    };
    const setFeedback = (text, ok) => {
      const hint = document.getElementById('scan-last');
      if (!hint) return;
      hint.textContent = text;
      hint.style.color = ok === true ? 'var(--emerald-600)' : ok === false ? 'var(--rose-700)' : '';
    };
    const accept = async (v) => {
      if (!v || busy) return;
      const code = String(v).trim();
      if (!code) return;
      if (code === last && Date.now() - lastAt < 1800) return;
      last = code; lastAt = Date.now();
      busy = true;
      setFeedback(code, null);
      try {
        await onCode(code);
        if (once) {
          closeModal();
          return;
        }
        setFeedback(`${code} · ${t('stock.keepScanning')}`, true);
      } catch {
        setFeedback(code, false);
      } finally {
        busy = false;
      }
    };

    openModal({
      title,
      body: `
      <video id="scan-video" class="sc-scan-video" autoplay muted playsinline webkit-playsinline></video>
      <div class="cell-sub" style="margin-top:8px;text-align:center">${esc(t('stock.tipPhone'))}</div>
      <div id="scan-last" style="text-align:center;margin-top:8px;font-weight:700;min-height:1.4em"></div>`,
      foot: `<button class="btn btn-outline" id="sc-photo-fallback">${esc(t('stock.takePhoto'))}</button>
        <button class="btn btn-primary" id="scan-stop">${esc(once ? t('common.close') : t('stock.stopScanning'))}</button>`,
      onClose() {
        cleanup();
        if (!switchingToPhoto) resolve();
      },
      async onMount(overlay) {
        const video = $('#scan-video', overlay);
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        video.srcObject = stream;
        try { await video.play(); } catch { /* autoplay policies */ }
        $('#scan-stop', overlay).addEventListener('click', () => closeModal());
        // If live decode struggles (blurry label), jump to the photo decoder.
        $('#sc-photo-fallback', overlay).addEventListener('click', () => {
          switchingToPhoto = true;
          cleanup();
          closeModal();
          resolve(scanWithPhoto(onCode, opts));
        });

        // Decoders. We drive the decode ourselves off live video frames rather than
        // relying on ZXing's continuous video decoder, which silently fails to emit
        // results on some browsers (notably iOS Safari). Every frame is tried with
        // BarcodeDetector (Chromium) and/or ZXing's fast bitmap API (everywhere).
        let ZX = null;
        try { ZX = await loadZXing(); } catch { /* offline / blocked */ }
        const reader = ZX ? zxingReader(ZX) : null;

        let detector = null;
        if ('BarcodeDetector' in window) {
          try { detector = new BarcodeDetector({ formats: BD_FORMATS }); } catch { detector = null; }
        }

        // No decoder at all → fall back to the photo picker.
        if (!detector && !reader) {
          switchingToPhoto = true;
          cleanup();
          closeModal();
          resolve(scanWithPhoto(onCode, opts));
          return;
        }

        const scratch = document.createElement('canvas');
        const sctx = scratch.getContext('2d', { willReadFrequently: true });
        // Draw the current video frame (optionally center-cropped) into `scratch`.
        const grab = (maxEdge, crop) => {
          const vw = video.videoWidth, vh = video.videoHeight;
          if (!vw || !vh) return null;
          const cw = Math.max(1, Math.floor(vw * crop));
          const ch = Math.max(1, Math.floor(vh * crop));
          const sx = Math.floor((vw - cw) / 2);
          const sy = Math.floor((vh - ch) / 2);
          const scale = Math.min(1, maxEdge / Math.max(cw, ch));
          scratch.width = Math.max(1, Math.round(cw * scale));
          scratch.height = Math.max(1, Math.round(ch * scale));
          sctx.drawImage(video, sx, sy, cw, ch, 0, 0, scratch.width, scratch.height);
          return scratch;
        };
        // Full frame catches far/large codes; a center crop zooms into small labels.
        const passes = [[1280, 1], [1024, 0.6]];

        let scanning = false; // guard against overlapping async ticks
        timer = setInterval(async () => {
          if (busy || scanning || video.readyState < 2 || !video.videoWidth) return;
          scanning = true;
          try {
            for (const [maxEdge, crop] of passes) {
              const frame = grab(maxEdge, crop);
              if (!frame) break;
              if (detector) {
                const codes = await detector.detect(frame);
                if (codes[0] && codes[0].rawValue) { accept(codes[0].rawValue); return; }
              }
              if (reader) {
                const code = decodeFrameWithZXing(ZX, reader, frame);
                if (code) { accept(code); return; }
              }
            }
          } catch { /* frame not ready / no code */ } finally { scanning = false; }
        }, 250);
      },
    });
  });
}
