/*
 * Mobile shell: bottom nav, center scan FAB, more sheet, quick-scan asset card.
 * Depends on: api.js, ui.js, i18n.js, and scanWithCamera from stockcount.js.
 */
'use strict';

const MOBILE_PRIMARY = [
  { hash: '#/dashboard', view: 'dashboard', icon: 'dashboard', labelKey: 'nav.m.dashboard' },
  { hash: '#/assets', view: 'assets', icon: 'devices', labelKey: 'nav.m.hardware' },
  { hash: '#/employees', view: 'employees', icon: 'badge', labelKey: 'nav.m.employees' },
  { hash: '#/handover', view: 'handover', icon: 'assignment_turned_in', labelKey: 'nav.m.handover' },
];

function isMobileShell() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function parseScannedAssetCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = /^ITACPRO\|ASSET\|(.+)$/i.exec(s);
  return (m ? m[1] : s).trim();
}

async function lookupAssetByScan(raw) {
  const needle = parseScannedAssetCode(raw);
  if (!needle) return null;
  const res = await api(`/assets?search=${encodeURIComponent(needle)}&limit=30`);
  const items = (res && res.items) || [];
  const up = needle.toUpperCase();
  const exact = items.find((a) =>
    String(a.assetTag || '').toUpperCase() === up
    || String(a.serialNumber || '').toUpperCase() === up
    || String(a.qrCodeString || '') === String(raw).trim()
  );
  return exact || items[0] || null;
}

async function resolveScannedAsset(raw) {
  try {
    const asset = await lookupAssetByScan(raw);
    if (!asset) {
      toast(`${t('qs.notFound')}: ${parseScannedAssetCode(raw)}`, 'error');
      return;
    }
    showQuickAssetCard(asset);
  } catch (err) {
    toast(err.message || t('qs.lookupFailed'), 'error');
  }
}

function showQuickAssetCard(asset) {
  if (!asset) return;
  const canEdit = Auth.canIamOp('asset', 'update');
  const emp = asset.currentEmployee;
  const specs = asset.specs || {};
  const specsLine = [specs.cpu, specs.ram, specs.storage].filter(Boolean).join(' · ');

  openModal({
    title: asset.assetTag,
    body: `
      <div class="qs-card">
        <div class="qs-card-hero">
          <span class="icon-chip chip-indigo"><span class="ms">${esc(catIcon(asset.category))}</span></span>
          <div>
            <div class="qs-card-title">${esc(asset.brand)} ${esc(asset.model)}</div>
            <div class="cell-sub">${esc(asset.category)}${specsLine ? ' · ' + esc(specsLine) : ''}</div>
          </div>
          <div>${badge(asset.status)}</div>
        </div>
        <div class="qs-card-grid">
          <div><span class="qs-label">${esc(t('qs.serial'))}</span><div class="mono">${esc(asset.serialNumber || '—')}</div></div>
          <div><span class="qs-label">${esc(t('qs.location'))}</span><div>${esc(asset.location || '—')}</div></div>
          <div><span class="qs-label">${esc(t('qs.assignedTo'))}</span><div>${emp ? esc(emp.fullName) : '—'}</div></div>
          <div><span class="qs-label">MAC</span><div class="mono">${esc(asset.macEthernet || asset.macWifi || '—')}</div></div>
        </div>
      </div>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
      <button class="btn btn-outline" id="qs-detail"><span class="ms">visibility</span> ${esc(t('common.view'))}</button>
      ${canEdit && asset.status === 'Assigned' ? `<button class="btn btn-outline" id="qs-return"><span class="ms">undo</span> ${esc(t('common.return'))}</button>` : ''}
      ${canEdit && (asset.status === 'In Stock' || asset.status === 'Assigned')
        ? `<button class="btn btn-primary" id="qs-repair"><span class="ms">build</span> ${esc(t('common.repair'))}</button>` : ''}`,
    onMount(overlay) {
      $('#qs-detail', overlay).addEventListener('click', () => {
        closeModal();
        if (typeof showAssetDetail === 'function') showAssetDetail(asset.id);
        else location.hash = '#/assets';
      });
      const ret = $('#qs-return', overlay);
      if (ret) ret.addEventListener('click', () => {
        closeModal();
        formModal({
          title: `${t('common.return')} ${asset.assetTag}`,
          fields: [{ name: 'conditionNote', label: t('qs.conditionNote'), type: 'textarea', full: true }],
          submitLabel: t('common.return'),
          async onSubmit(d) {
            await api(`/assets/${asset.id}/return`, { method: 'POST', body: d });
            toast(`${asset.assetTag} → In Stock`, 'success');
          },
        });
      });
      const repair = $('#qs-repair', overlay);
      if (repair) repair.addEventListener('click', () => {
        closeModal();
        formModal({
          title: `${t('common.repair')} ${asset.assetTag}`,
          fields: [
            { name: 'serviceCompany', label: t('qs.serviceCompany'), required: true },
            { name: 'issueDescription', label: t('qs.issue'), type: 'textarea', required: true, full: true },
          ],
          submitLabel: t('common.repair'),
          async onSubmit(d) {
            await api('/maintenance', { method: 'POST', body: { ...d, assetId: asset.id } });
            toast(`${asset.assetTag} → In Repair`, 'success');
          },
        });
      });
    },
  });
}

function promptManualAssetCode() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openModal({
      title: t('qs.enterCode'),
      body: `
        <p class="cell-sub" style="margin:0 0 12px">${esc(t('qs.enterCodeHint'))}</p>
        <label>${esc(t('qs.codeOrTag'))}
          <input type="text" id="qs-manual-code" autocomplete="off" autocapitalize="characters"
            placeholder="IT-00042 / SN…" style="width:100%">
        </label>`,
      foot: `
        <button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
        <button class="btn btn-primary" id="qs-manual-go">${esc(t('qs.lookup'))}</button>`,
      onClose() { finish(null); },
      onMount(overlay) {
        const input = $('#qs-manual-code', overlay);
        const go = () => {
          const v = (input.value || '').trim();
          if (!v) { input.focus(); return; }
          finish(v);
          closeModal();
        };
        $('#qs-manual-go', overlay).addEventListener('click', go);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); go(); }
        });
        setTimeout(() => input.focus(), 50);
      },
    });
  });
}

async function startQuickScan() {
  if (!Auth.profile) return;
  // Chooser: camera / photo vs type tag (works offline from camera permission issues).
  const mode = await new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openModal({
      title: t('qs.scanAsset'),
      body: `
        <p class="cell-sub" style="margin:0 0 14px">${esc(t('qs.scanChooserHint'))}</p>
        <div class="qs-chooser">
          <button type="button" class="btn btn-primary btn-block btn-lg" id="qs-cam">
            <span class="ms">qr_code_scanner</span> ${esc(t('qs.useCamera'))}
          </button>
          <button type="button" class="btn btn-outline btn-block btn-lg" id="qs-type">
            <span class="ms">keyboard</span> ${esc(t('qs.enterCode'))}
          </button>
        </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>`,
      onClose() { finish(null); },
      onMount(overlay) {
        $('#qs-cam', overlay).addEventListener('click', () => { finish('camera'); closeModal(); });
        $('#qs-type', overlay).addEventListener('click', () => { finish('manual'); closeModal(); });
      },
    });
  });
  if (!mode) return;

  if (mode === 'manual') {
    const code = await promptManualAssetCode();
    if (code) await resolveScannedAsset(code);
    return;
  }

  if (typeof scanWithCamera !== 'function') {
    toast(t('qs.scanUnavailable'), 'error');
    return;
  }

  let captured = null;
  await scanWithCamera(async (code) => {
    if (captured) return;
    captured = code;
  }, { once: true, title: t('qs.scanAsset') });

  if (!captured) return;
  await resolveScannedAsset(captured);
}

function closeMobileMore() {
  const sheet = $('#mobile-more');
  if (sheet) sheet.classList.add('hidden');
  document.body.classList.remove('mobile-more-open');
}

function openMobileMore() {
  const sheet = $('#mobile-more');
  if (!sheet) return;
  sheet.classList.remove('hidden');
  document.body.classList.add('mobile-more-open');
}


function mobileNavAllowed(hash, route) {
  if (typeof isPortalUser === 'function' && isPortalUser()) return hash === '#/zimmetlerim';
  if (typeof isHrUser === 'function' && isHrUser()) {
    return hash === '#/hr' || hash === '#/zimmetlerim';
  }
  return !route.perm || Auth.can(route.perm);
}

function renderMobileNav() {
  const nav = $('#mobile-nav');
  if (!nav) return;
  const hash = (location.hash.split('?')[0]) || '#/dashboard';
  const itemHtml = (item) => {
    const active = hash === item.hash ? ' active' : '';
    return `<a href="${item.hash}" class="mnav-item${active}" data-mnav="${item.hash}">
      <span class="ms">${item.icon}</span>
      <span class="mnav-label">${esc(t(item.labelKey))}</span>
    </a>`;
  };
  const primaryItems = (typeof isPortalUser === "function" && isPortalUser()) ? [{ hash: "#/zimmetlerim", view: "myZimmet", icon: "inventory_2", labelKey: "nav.myZimmet" }] : (typeof isHrUser === 'function' && isHrUser())
    ? [
      { hash: '#/hr', view: 'hr', icon: 'group_add', labelKey: 'nav.hr' },
      { hash: '#/zimmetlerim', view: 'myZimmet', icon: 'inventory_2', labelKey: 'nav.myZimmet' },
    ]
    : MOBILE_PRIMARY;
  // True center FAB: equal-width left/right clusters, FAB in the middle column.
  const left = primaryItems.slice(0, 2).map(itemHtml).join('');
  const right = primaryItems.slice(2).map(itemHtml).join('') + `
    <button type="button" class="mnav-item" id="mobile-more-btn">
      <span class="ms">apps</span>
      <span class="mnav-label">${esc(t('nav.m.more'))}</span>
    </button>`;

  nav.innerHTML = `
    <div class="mnav-cluster mnav-left">${left}</div>
    <button type="button" class="mnav-fab" id="mobile-scan-fab" aria-label="${esc(t('qs.scan'))}">
      <span class="ms">qr_code_scanner</span>
    </button>
    <div class="mnav-cluster mnav-right">${right}</div>`;

  const fab = $('#mobile-scan-fab', nav);
  if (fab) fab.addEventListener('click', () => startQuickScan().catch((e) => toast(e.message, 'error')));
  const moreBtn = $('#mobile-more-btn', nav);
  if (moreBtn) moreBtn.addEventListener('click', openMobileMore);
}

function renderMobileMoreSheet() {
  const sheet = $('#mobile-more');
  if (!sheet) return;
  const hash = (location.hash.split('?')[0]) || '#/dashboard';
  const primary = new Set(MOBILE_PRIMARY.map((p) => p.hash));
  const extras = Object.entries(ROUTES)
    .filter(([h, r]) => {
      if (typeof isHrUser === 'function' && isHrUser()) {
        return (typeof HR_ALLOWED_HASHES !== 'undefined' ? HR_ALLOWED_HASHES.has(h) : (h === '#/hr' || h === '#/zimmetlerim')) && !primary.has(h);
      }
      if (typeof isPortalUser === 'function' && isPortalUser()) return false;
      return !primary.has(h) && (!r.perm || Auth.can(r.perm));
    });

  const NAV_KEY_ALIAS = { assets: 'hardware', licenses: 'software' };
  const label = (r) => {
    const primaryKey = 'nav.' + r.view;
    const alias = NAV_KEY_ALIAS[r.view] ? 'nav.' + NAV_KEY_ALIAS[r.view] : null;
    const v = t(primaryKey);
    if (v !== primaryKey) return v;
    if (alias) {
      const a = t(alias);
      if (a !== alias) return a;
    }
    return r.title;
  };

  sheet.innerHTML = `
    <div class="mobile-more-backdrop" data-more-close></div>
    <div class="mobile-more-panel" role="dialog" aria-label="${esc(t('qs.more'))}">
      <div class="mobile-more-handle"></div>
      <div class="mobile-more-title">${esc(t('qs.more'))}</div>
      <div class="mobile-more-grid">
        ${extras.map(([h, r]) => `
          <a href="${h}" class="mobile-more-item${hash === h ? ' active' : ''}" data-more-link>
            <span class="ms">${r.icon}</span>
            <span>${esc(label(r))}</span>
          </a>`).join('')}
        <button type="button" class="mobile-more-item" id="mobile-more-search">
          <span class="ms">search</span>
          <span>${esc(t('common.search'))}</span>
        </button>
        <button type="button" class="mobile-more-item" id="mobile-more-scan">
          <span class="ms">qr_code_scanner</span>
          <span>${esc(t('qs.scanAsset'))}</span>
        </button>
        <button type="button" class="mobile-more-item" id="mobile-more-settings">
          <span class="ms">settings</span>
          <span>${esc(t('common.settings'))}</span>
        </button>
      </div>
    </div>`;

  sheet.querySelectorAll('[data-more-close], [data-more-link]').forEach((el) => {
    el.addEventListener('click', () => closeMobileMore());
  });
  const search = $('#mobile-more-search', sheet);
  if (search) search.addEventListener('click', () => {
    closeMobileMore();
    if (typeof focusGlobalSearch === 'function') focusGlobalSearch();
  });
  const scan = $('#mobile-more-scan', sheet);
  if (scan) scan.addEventListener('click', () => {
    closeMobileMore();
    startQuickScan().catch((e) => toast(e.message, 'error'));
  });
  const settings = $('#mobile-more-settings', sheet);
  if (settings) settings.addEventListener('click', () => {
    closeMobileMore();
    if (typeof showSettings === 'function') showSettings();
  });
}

function setMobileChromeVisible(on) {
  document.body.classList.toggle('mobile-chrome', !!on);
  if (!on) {
    closeMobileMore();
    const nav = $('#mobile-nav');
    if (nav) nav.innerHTML = '';
    const sheet = $('#mobile-more');
    if (sheet) {
      sheet.classList.add('hidden');
      sheet.innerHTML = '';
    }
  }
}

function syncMobileChrome() {
  const appEl = $('#app');
  const appVisible = appEl && !appEl.classList.contains('hidden');
  if (!Auth.profile || !appVisible) {
    setMobileChromeVisible(false);
    return;
  }
  setMobileChromeVisible(true);
  renderMobileNav();
  renderMobileMoreSheet();
}

/* ---- responsive card-tables ----
   On phones, wide `.table-wrap > table.data` scroll horizontally and hide their
   action columns. This stamps each <td> with its header label (read from <thead>)
   and tags the wrap `.mcards`, so CSS can stack rows into no-scroll cards.
   Attribute-only mutations here don't retrigger the childList observer. */
const MCARD_MQ = window.matchMedia('(max-width: 600px)');

function labelTableCards() {
  if (!MCARD_MQ.matches) return;
  const view = document.getElementById('view');
  if (!view) return;
  view.querySelectorAll('.table-wrap').forEach((wrap) => {
    const table = wrap.querySelector('table.data');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow) return;
    const labels = Array.from(headRow.children).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody > tr').forEach((tr) => {
      const cells = Array.from(tr.children);
      if (cells.length === 1 && cells[0].hasAttribute('colspan')) return; // empty-state row
      cells.forEach((td, i) => {
        if (!td.hasAttribute('data-label')) td.setAttribute('data-label', labels[i] || '');
        if (!td.classList.contains('actions') && !td.textContent.trim() && !td.querySelector('*')) {
          td.classList.add('mcard-blank');
        }
      });
    });
    wrap.classList.add('mcards');
  });
}

let __mcardScheduled = false;
function scheduleTableCards() {
  if (__mcardScheduled) return;
  __mcardScheduled = true;
  requestAnimationFrame(() => {
    __mcardScheduled = false;
    try { labelTableCards(); } catch (_) { /* never break the app for cosmetics */ }
  });
}

function initTableCards() {
  const view = document.getElementById('view');
  if (!view || window.__mcardObserver) return;
  window.__mcardObserver = new MutationObserver(scheduleTableCards);
  window.__mcardObserver.observe(view, { childList: true, subtree: true });
  if (MCARD_MQ.addEventListener) MCARD_MQ.addEventListener('change', scheduleTableCards);
  scheduleTableCards();
}

function initMobileShell() {
  if (window.__mobileShellBound) return;
  window.__mobileShellBound = true;
  initTableCards();

  const fabTop = $('#btn-quick-scan');
  if (fabTop) fabTop.addEventListener('click', () => {
    if (!Auth.profile) return;
    startQuickScan().catch((e) => toast(e.message, 'error'));
  });

  window.addEventListener('hashchange', () => {
    if (Auth.profile && document.body.classList.contains('mobile-chrome')) {
      renderMobileNav();
      closeMobileMore();
    }
  });
  window.addEventListener('resize', () => {
    if (!isMobileShell()) closeMobileMore();
  });
  window.addEventListener('itacm:logout', () => setMobileChromeVisible(false));
}

// If app already shown (script order), sync chrome now.
if (typeof Auth !== 'undefined' && Auth.profile) {
  initMobileShell();
  syncMobileChrome();
}
