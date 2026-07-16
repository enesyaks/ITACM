/*
 * Screen views, faithful to the stitch_it_asset_control_pro mockups.
 *
 * XSS policy: innerHTML only ever receives trusted static template markup
 * combined with esc()-encoded dynamic values (see ui.js). No raw user/API
 * input reaches the DOM unescaped.
 */
'use strict';

var Views = window.Views || {};
window.Views = Views;

function pageHead(title, sub, actionsHtml = '') {
  return `<div class="page-head">
    <div><h2>${esc(t(title))}</h2><div class="sub">${esc(t(sub))}</div></div>
    <div class="actions">${actionsHtml}</div>
  </div>`;
}

const CATEGORY_ICONS = {
  Laptop: 'laptop_mac', Desktop: 'desktop_windows', Monitor: 'desktop_windows', Television: 'tv',
  Phone: 'smartphone', Tablet: 'tablet', Printer: 'print', Network: 'router', Server: 'dns',
  Keyboard: 'keyboard', Mouse: 'mouse', Headset: 'headset_mic', 'Docking Station': 'dock',
  Webcam: 'videocam', Peripheral: 'mouse', Accessory: 'cable', Other: 'devices_other',
};
const catIcon = (c) => CATEGORY_ICONS[c] || 'devices_other';

/** Lifecycle: centrally-managed months per category, applied to every asset. */
function lifecycleInfo(x) {
  const lc = AppConfig.lifecycles || {};
  // Resolution: per-asset override -> catalog model default -> category default.
  // A category set to 0 in the Product Catalog is excluded from EOL tracking.
  const catMonths = lc[x.category] != null ? lc[x.category] : (lc.Other || 48);
  const months = x.lifecycleMonths || x.modelLifecycleMonths || catMonths;
  if (!months) return { months: 0, eol: null, pct: null, overdue: false, excluded: true };
  if (!x.purchaseDate) return { months, eol: null, pct: null, overdue: false };
  const start = new Date(x.purchaseDate._seconds ? x.purchaseDate._seconds * 1000 : x.purchaseDate);
  const eol = new Date(start);
  eol.setMonth(eol.getMonth() + months);
  const pct = Math.max(0, Math.round(((Date.now() - start) / (eol - start)) * 100));
  return { months, eol, pct, overdue: Date.now() > eol.getTime() };
}
function lifecycleLabel(x) {
  const l = lifecycleInfo(x);
  if (l.excluded) return 'EOL tracking off for this category';
  if (!l.eol) return `${l.months} months (no purchase date)`;
  return l.overdue
    ? `${l.months} months — EOL ${fmtDate(l.eol)} • OVERDUE, replacement due`
    : `${l.months} months — EOL ${fmtDate(l.eol)} (${Math.min(l.pct, 100)}% elapsed)`;
}

/* ---- Printable Code 128 asset labels (barcode + product info) ---- */
/* Sizes + field toggles are configured instance-wide in Settings → Barcode label
   (AppConfig.labelConfig). LABEL_DEFAULTS is only the offline fallback. */
const LABEL_DEFAULTS = { widthMm: 58, heightMm: 32, barcodeMm: 12, copies: 1,
  showLogo: true, showCompany: true, showModel: true, showCategory: true, showSerial: true };
const MM_TO_PX = 96 / 25.4; // CSS: 1mm = 96/25.4 px

function labelOpts() {
  return { ...LABEL_DEFAULTS, ...(AppConfig.labelConfig || {}) };
}

function assetLabelHTML(a, opts = LABEL_DEFAULTS) {
  let bc = '';
  try {
    bc = code128SVG(a.assetTag, { height: Math.round(opts.barcodeMm * MM_TO_PX), moduleWidth: 2, margin: 6 });
  } catch { bc = `<div class="mono">${esc(a.assetTag)}</div>`; }
  const info = [a.brand, a.model].filter(Boolean).join(' ');
  const logo = (opts.showLogo && AppConfig.companyLogo)
    ? `<img class="al-logo" src="${esc(AppConfig.companyLogo)}" alt="">` : '';
  const co = opts.showCompany
    ? `<span class="al-co">${esc((AppConfig.companyName || 'IT Asset Control Pro').toUpperCase())}</span>` : '';
  const head = (logo || co) ? `<div class="al-head">${logo}${co}</div>` : '';
  const model = (opts.showModel && info) ? `<div class="al-model">${esc(info)}</div>` : '';
  const metaParts = [];
  if (opts.showCategory && a.category) metaParts.push(`<span class="al-cat">${esc(a.category)}</span>`);
  if (opts.showSerial) metaParts.push(`<span class="al-sn mono">SN ${esc(a.serialNumber || '—')}</span>`);
  const meta = metaParts.length ? `<div class="al-meta">${metaParts.join('')}</div>` : '';
  return `<div class="asset-label" style="width:${opts.widthMm}mm;height:${opts.heightMm}mm">
    ${head}
    <div class="al-bc">${bc}</div>
    ${model}
    ${meta}
  </div>`;
}

/** Set (or clear) a dynamic @page rule so the printer's page size equals the
 *  physical label — the only reliable way to make a label/thermal printer feed
 *  and cut one label at a time from the browser. Cleared after printing so it
 *  never leaks into A4 receipt printing. */
function setLabelPrintPage(widthMm, heightMm) {
  let s = document.getElementById('label-print-style');
  if (!s) { s = document.createElement('style'); s.id = 'label-print-style'; document.head.appendChild(s); }
  s.textContent = !widthMm ? '' : `@media print {
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    .print-root { padding: 0 !important; }
    .print-root .label-page { padding: 0 !important; gap: 0 !important; margin: 0 !important; }
    .print-root .asset-label { width: ${widthMm}mm !important; height: ${heightMm}mm !important;
      border: none !important; border-radius: 0 !important; }
  }`;
}

/**
 * Print ONE label per page at exactly the label's size — every copy of every
 * asset is its own page, so a label/thermal printer feeds and cuts them one by
 * one. The label design (sizes + which fields to show) comes from Settings.
 */
function printAssetLabels(assets) {
  const list = (assets || []).filter(Boolean)
    .slice().sort((a, b) => String(a.assetTag).localeCompare(String(b.assetTag), undefined, { numeric: true }));
  if (!list.length) return toast('Select at least one asset to print labels', 'error');
  const opts = labelOpts();
  const copies = Math.min(50, Math.max(1, Math.round(opts.copies || 1)));
  const pages = [];
  for (const a of list) {
    for (let i = 0; i < copies; i++) pages.push(`<div class="label-page">${assetLabelHTML(a, opts)}</div>`);
  }
  const root = $('#print-root');
  root.classList.add('labels');
  root.innerHTML = pages.join('');
  setLabelPrintPage(opts.widthMm, opts.heightMm);
  const cleanup = () => {
    setLabelPrintPage(null);          // restore A4 @page for receipts
    root.classList.remove('labels');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000);         // safety net if afterprint never fires
  window.print();
}

/* =============================== DASHBOARD =============================== */
