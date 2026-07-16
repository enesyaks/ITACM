
Views.reports = async function (el) {
  if (!Auth.canIam('report', 'read') && !Auth.canIam('report', 'export')) {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">Reports requires <strong>report:read</strong>.</p></div>`;
    return;
  }
  const canExport = Auth.canIam('report', 'export');
  const canMaintList = iamCanList('maintenance');
  const canAssetList = iamCanList('asset');
  const presetReports = visibleReportDefs();
  const customSourceKeys = visibleCustomSourceKeys();
  const FEATURED = new Set(['inventory', 'eol', 'in-stock', 'assignments', 'open-repairs', 'expiring-licenses', 'low-stock']);

  const [assetsRes, maintenance] = await Promise.all([
    canAssetList ? api('/assets?limit=2000').catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
    canMaintList ? api('/maintenance?limit=2000').catch(() => []) : Promise.resolve([]),
  ]);
  const assets = assetsRes.items || [];
  const state = { range: 30, tab: 'ready', group: 'all', q: '' };
  const toDate = (v) => new Date(v && v._seconds ? v._seconds * 1000 : v);
  const MONTH_MS = 30.44 * 86400000;

  function computeKpis() {
    const now = Date.now();
    const rangeMs = state.range ? state.range * 86400000 : Infinity;
    const inRange = (d) => d && (now - toDate(d).getTime()) <= rangeMs;
    const active = assets.filter((x) => x.status !== 'Scrap');
    const purchased = assets.filter((x) => x.purchaseDate && inRange(x.purchaseDate));
    const lc = AppConfig.lifecycles || {};
    const withPd = active.filter((x) => x.purchaseDate);
    const avgAge = withPd.length
      ? Math.round(withPd.reduce((s, x) => s + (now - toDate(x.purchaseDate).getTime()), 0) / withPd.length / MONTH_MS) : 0;
    const avgLifecycle = active.length
      ? Math.round(active.reduce((s, x) => s + (lc[x.category] || lc.Other || 48), 0) / active.length) : 0;
    const maintInRange = (maintenance || []).filter((m) => inRange(m.sentDate));
    const spend = maintInRange.reduce((s, m) => s + Number(m.cost || 0), 0);
    const openRepairs = (maintenance || []).filter((m) => !m.returnDate).length;
    const eolSoon = active.filter((x) => {
      const l = lifecycleInfo(x);
      return l.eol && l.pct >= 90;
    }).length;
    return {
      totalActive: active.length,
      purchased: purchased.length,
      avgLifecycle,
      avgAge,
      spend,
      openRepairs,
      eolSoon,
      inStock: active.filter((x) => x.status === 'In Stock').length,
      assigned: active.filter((x) => x.status === 'Assigned').length,
    };
  }

  const groups = [...new Set(presetReports.map((r) => r.group))];

  el.innerHTML = `
    ${pageHead('Reports', 'Ready-made lists for common questions — or build your own.', `
      <select id="rep-range" class="rep-range" title="KPI window">
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="365">Last 12 months</option>
        <option value="0">All time</option>
      </select>
    `)}

    <div id="rep-kpis" class="rep-kpi-row"></div>

    <div class="rep-tabs" role="tablist">
      <button type="button" class="rep-tab on" data-rep-tab="ready" role="tab">
        <span class="ms">folder_open</span> Ready reports
        <em>${presetReports.length}</em>
      </button>
      <button type="button" class="rep-tab" data-rep-tab="custom" role="tab">
        <span class="ms">tune</span> Build your own
      </button>
    </div>

    <div id="rep-panel-ready" class="rep-panel">
      <div class="rep-ready-toolbar">
        <div class="search-box rep-ready-search">
          <span class="ms">search</span>
          <input type="search" id="rep-q" placeholder="Search reports…" autocomplete="off">
        </div>
        <div class="rep-group-pills" id="rep-groups">
          <button type="button" class="rep-pill on" data-group="all">All</button>
          <button type="button" class="rep-pill" data-group="featured">Recommended</button>
          ${groups.map((g) => `<button type="button" class="rep-pill" data-group="${esc(g)}">${esc(g)}</button>`).join('')}
        </div>
      </div>
      <div id="rep-preset-grid" class="rep-preset-grid"></div>
      ${presetReports.length === 0
        ? `<div class="card card-pad"><p class="cell-sub">No preset reports for your permissions. You need <strong>report:read</strong> plus the matching module read (e.g. <strong>maintenance:read</strong> for repair reports).</p></div>`
        : ''}
    </div>

    <div id="rep-panel-custom" class="rep-panel hidden">
      ${customSourceKeys.length === 0
        ? `<div class="card card-pad"><p class="cell-sub">No data sources available — enable read on asset, employee, license, etc.</p></div>`
        : `<div class="rep-builder">
          <div class="rep-builder-step">
            <div class="rep-builder-step-label"><span>1</span> Choose data source</div>
            <div class="rep-source-grid" id="crb-sources">
              ${customSourceKeys.map((k, i) => `
                <button type="button" class="rep-source-card${i === 0 ? ' on' : ''}" data-source="${esc(k)}">
                  <strong>${esc(CUSTOM_SOURCES[k].label)}</strong>
                  <span>${CUSTOM_SOURCES[k].columns.length} columns</span>
                </button>`).join('')}
            </div>
            <input type="hidden" id="crb-source" value="${esc(customSourceKeys[0] || '')}">
          </div>
          <div class="rep-builder-step">
            <div class="rep-builder-step-label"><span>2</span> Filters <em>optional</em></div>
            <div id="crb-filters" class="rep-builder-filters"></div>
          </div>
          <div class="rep-builder-step">
            <div class="rep-builder-step-label"><span>3</span> Columns
              <button type="button" class="btn btn-outline btn-sm" id="crb-all">All</button>
              <button type="button" class="btn btn-outline btn-sm" id="crb-none">None</button>
            </div>
            <div id="crb-cols" class="rep-builder-cols"></div>
          </div>
          <div class="rep-builder-actions">
            <button id="crb-generate" class="btn btn-primary">
              <span class="ms">table_view</span> Generate report
            </button>
            <span class="cell-sub">Preview up to 100 rows · CSV export includes everything</span>
          </div>
        </div>`}
    </div>

    <div id="report-result" class="rep-result"></div>`;

  function renderKpis() {
    const a = computeKpis();
    const rangeLabel = state.range === 0 ? 'all time' : `last ${state.range}d`;
    $('#rep-kpis', el).innerHTML = `
      <div class="card rep-kpi">
        <div class="rep-kpi-head"><span class="rep-kpi-label">Active inventory</span>${iconChip('devices', 'indigo')}</div>
        <div class="rep-kpi-value">${a.totalActive.toLocaleString()}
          <span class="trend-chip flat">${a.assigned} assigned · ${a.inStock} in stock</span></div>
      </div>
      <div class="card rep-kpi">
        <div class="rep-kpi-head"><span class="rep-kpi-label">New assets</span>${iconChip('shopping_cart', 'emerald')}</div>
        <div class="rep-kpi-value">${a.purchased}
          <span class="trend-chip flat">${esc(rangeLabel)}</span></div>
      </div>
      <div class="card rep-kpi">
        <div class="rep-kpi-head"><span class="rep-kpi-label">Lifecycle</span>${iconChip('timelapse', 'amber')}</div>
        <div class="rep-kpi-value">${a.avgAge}<small>mo avg age</small>
          <span class="trend-chip ${a.eolSoon ? 'down' : 'flat'}">${a.eolSoon} near EOL</span></div>
      </div>
      <div class="card rep-kpi">
        <div class="rep-kpi-head"><span class="rep-kpi-label">Repairs</span>${iconChip('build', 'rose')}</div>
        <div class="rep-kpi-value">${canMaintList ? a.openRepairs : '—'}
          <span class="trend-chip flat">${canMaintList ? `${fmtMoney(a.spend)} · ${esc(rangeLabel)}` : 'no access'}</span></div>
      </div>`;
  }

  function filteredPresets() {
    const q = state.q.trim().toLowerCase();
    return presetReports.filter((r) => {
      if (state.group === 'featured' && !FEATURED.has(r.id)) return false;
      if (state.group !== 'all' && state.group !== 'featured' && r.group !== state.group) return false;
      if (!q) return true;
      return `${r.title} ${r.desc} ${r.group}`.toLowerCase().includes(q);
    });
  }

  function renderPresets() {
    const grid = $('#rep-preset-grid', el);
    if (!grid) return;
    const list = filteredPresets();
    if (!list.length) {
      grid.innerHTML = `<div class="rep-empty cell-sub">No reports match this filter.</div>`;
      return;
    }
    // Featured first when showing all
    const ordered = state.group === 'all'
      ? [...list].sort((a, b) => Number(FEATURED.has(b.id)) - Number(FEATURED.has(a.id)) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title))
      : list;
    grid.innerHTML = ordered.map((r) => `
      <button type="button" class="rep-preset-card${FEATURED.has(r.id) ? ' is-featured' : ''}" data-report="${esc(r.id)}">
        <div class="rep-preset-top">
          ${iconChip(r.icon, r.tone)}
          ${FEATURED.has(r.id) ? '<span class="rep-badge">Recommended</span>' : `<span class="rep-badge muted">${esc(r.group)}</span>`}
        </div>
        <div class="rep-preset-title">${esc(r.title)}</div>
        <div class="rep-preset-desc">${esc(r.desc)}</div>
        <div class="rep-preset-go"><span>Open</span><span class="ms">arrow_forward</span></div>
      </button>`).join('');
  }

  function setTab(tab) {
    state.tab = tab;
    el.querySelectorAll('.rep-tab').forEach((b) => b.classList.toggle('on', b.dataset.repTab === tab));
    $('#rep-panel-ready', el).classList.toggle('hidden', tab !== 'ready');
    $('#rep-panel-custom', el).classList.toggle('hidden', tab !== 'custom');
  }

  function renderBuilder() {
    const srcSel = $('#crb-source', el);
    if (!srcSel) return;
    const def = CUSTOM_SOURCES[srcSel.value];
    if (!def) return;
    el.querySelectorAll('.rep-source-card').forEach((b) =>
      b.classList.toggle('on', b.dataset.source === srcSel.value));
    $('#crb-cols', el).innerHTML = def.columns.map(([k, label]) => `
      <label class="rep-col-chip">
        <input type="checkbox" value="${esc(k)}" checked>
        <span>${esc(label)}</span>
      </label>`).join('');
    $('#crb-filters', el).innerHTML = def.filters.length
      ? def.filters.map((f) => {
        if (f.type === 'select') {
          return `<div class="form-field"><label>${esc(f.label)}</label>
            <select data-filter="${esc(f.key)}">
              ${f.options.map((o) => {
                const v = typeof o === 'object' ? o.value : o;
                const l = typeof o === 'object' ? o.label : (o === '' ? 'All' : o);
                return `<option value="${esc(v)}">${esc(l)}</option>`;
              }).join('')}
            </select></div>`;
        }
        return `<div class="form-field"><label>${esc(f.label)}</label>
          <input type="${esc(f.type)}" data-filter="${esc(f.key)}" placeholder="${esc(f.label)}"></div>`;
      }).join('')
      : '<div class="cell-sub">No filters for this source — all rows will be included.</div>';
  }

  $('#rep-range', el).addEventListener('change', (e) => {
    state.range = Number(e.target.value);
    renderKpis();
  });
  el.querySelectorAll('[data-rep-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.repTab)));
  $('#rep-q', el)?.addEventListener('input', (e) => { state.q = e.target.value; renderPresets(); });
  el.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
    state.group = b.dataset.group;
    el.querySelectorAll('[data-group]').forEach((x) => x.classList.toggle('on', x === b));
    renderPresets();
  }));

  el.querySelectorAll('.rep-source-card').forEach((b) => b.addEventListener('click', () => {
    $('#crb-source', el).value = b.dataset.source;
    renderBuilder();
  }));
  $('#crb-all', el)?.addEventListener('click', () => {
    el.querySelectorAll('#crb-cols input').forEach((c) => { c.checked = true; });
  });
  $('#crb-none', el)?.addEventListener('click', () => {
    el.querySelectorAll('#crb-cols input').forEach((c) => { c.checked = false; });
  });

  $('#crb-generate', el)?.addEventListener('click', async () => {
    const srcSel = $('#crb-source', el);
    const def = CUSTOM_SOURCES[srcSel.value];
    const slot = $('#report-result', el);
    slot.innerHTML = '<div class="table-empty">Generating report…</div>';
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
        el.querySelector(`#crb-cols input[value="${k}"]`)?.checked);
      if (selCols.length === 0) throw new Error('Select at least one column');
      showReportResult(slot, `Custom — ${def.label}`, {
        cols: selCols.map(([, label]) => label),
        rows: rows.map((r) => selCols.map(([, , get]) => get(r))),
        summary: `${rows.length} rows • ${def.label}`
          + (activeFilters.length ? ` • ${activeFilters.join('; ')}` : ''),
      });
    } catch (err) {
      slot.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  });

  bindView(el, async (e) => {
    const card = e.target.closest('[data-report]'); if (!card) return;
    const def = REPORT_DEFS.find((r) => r.id === card.dataset.report);
    if (!def) return;
    const slot = $('#report-result', el);
    slot.innerHTML = '<div class="table-empty">Generating report…</div>';
    try {
      showReportResult(slot, def.title, await buildReport(def.id));
    } catch (err) {
      slot.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
    }
  });

  renderKpis();
  renderPresets();
  renderBuilder();
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
