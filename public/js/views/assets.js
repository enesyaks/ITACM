/* Ghost/skeleton rows shown in place of the hardware list while a search,
 * filter, sort or page change refetches — so the update reads as a load rather
 * than a jarring full-page refresh. Pure presentation; no data attributes, so
 * the delegated row handlers on the view ignore these rows. */
function assetsSkeletonRows(rows = 8) {
  const bar = (w) => `<span class="skel" style="display:block;height:12px;width:${w}"></span>`;
  return Array.from({ length: rows }, () => `
    <tr class="hw-skel-row" aria-hidden="true">
      <td class="hw-col-check">${bar('16px')}</td>
      <td class="hw-col-id">${bar('72px')}</td>
      <td>${bar('80%')}</td>
      <td>${bar('64%')}</td>
      <td>${bar('56%')}</td>
      <td>${bar('50%')}</td>
      <td>${bar('58px')}</td>
      <td>${bar('36px')}</td>
    </tr>`).join('');
}
function assetsSkeletonCards(rows = 6) {
  const bar = (w, h = '12px') => `<span class="skel" style="display:block;height:${h};width:${w};margin:5px 0"></span>`;
  return Array.from({ length: rows }, () => `
    <div class="m-asset-card hw-skel-row" aria-hidden="true">
      <div class="m-asset-top">
        <span class="skel" style="width:34px;height:34px;border-radius:9px;flex:none"></span>
        <div style="flex:1;min-width:0">${bar('45%')}${bar('72%')}${bar('38%')}</div>
      </div>
    </div>`).join('');
}
function showAssetsSkeleton(el) {
  if (!el) return;
  const tbody = el.querySelector('table.hw-table tbody');
  if (tbody) tbody.innerHTML = assetsSkeletonRows();
  const mlist = el.querySelector('.m-asset-list');
  if (mlist) mlist.innerHTML = assetsSkeletonCards();
  el.querySelector('.hw-card')?.classList.add('is-loading');
}

/* Full-page skeleton shown on the FIRST paint of the hardware view (opening the
 * page or coming from another view), before any data has arrived. In-view
 * search/filter re-renders use showAssetsSkeleton instead, which keeps the search
 * box mounted so keystrokes are never lost. */
function renderAssetsSkeletonShell(el) {
  const bar = (w, h = '14px', r = '6px') =>
    `<span class="skel" style="display:inline-block;height:${h};width:${w};border-radius:${r}"></span>`;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:10px">
      ${bar('190px', '24px')}${bar('150px', '36px', '9px')}
    </div>
    <div style="margin:0 0 18px">${bar('55%', '12px')}</div>
    <div class="grid grid-4" style="margin-bottom:20px">
      ${Array.from({ length: 4 }, () => `<div class="card card-pad">
        <div style="display:flex;flex-direction:column;gap:12px">${bar('60%', '12px')}${bar('42%', '26px')}</div>
      </div>`).join('')}
    </div>
    <div class="toolbar" style="margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${bar('240px', '40px', '9px')}${bar('150px', '40px', '9px')}${bar('150px', '40px', '9px')}
    </div>
    <div class="card hw-card is-loading">
      <div class="m-asset-list">${assetsSkeletonCards()}</div>
      <div class="table-wrap"><table class="data hw-table"><tbody>${assetsSkeletonRows()}</tbody></table></div>
    </div>`;
}

Views.assets = async function (el, params = {}) {
  if (isStaleView(el)) return;
  // First paint (page opened / arrived from another view): show a full skeleton
  // immediately so the load is visible rather than a blank gap. A re-render of
  // the already-mounted view keeps its search box and only ghosts the rows.
  if (!el.querySelector('#asset-search')) renderAssetsSkeletonShell(el);
  const canCreate = Auth.canIam('asset', 'create');
  const canUpdate = Auth.canIam('asset', 'update') || Auth.canIam('asset', 'manage');
  const canUnassign = Auth.canIam('asset', 'unassign') || Auth.canIam('asset', 'manage');
  const canAssign = Auth.canIam('asset', 'assign') || Auth.canIam('asset', 'manage');
  const canRepair = Auth.canIam('maintenance', 'create');
  const perms = Auth.profile?.permissions || {};
  const unassignScopeOnly = !!(perms.assetUnassignScopeOnly
    || (Auth.canIam('asset', 'unassign') && !Auth.canIam('asset', 'assign') && !Auth.canIam('asset', 'manage') && !Auth.canIam('asset', 'read')));
  const assignScopeOnly = !!(perms.assetAssignScopeOnly
    || (Auth.canIam('asset', 'assign') && !Auth.canIam('asset', 'unassign') && !Auth.canIam('asset', 'manage') && !Auth.canIam('asset', 'read')));
  const assignUnassignScopeOnly = !!(perms.assetAssignUnassignScopeOnly
    || (Auth.canIam('asset', 'assign') && Auth.canIam('asset', 'unassign') && !Auth.canIam('asset', 'manage') && !Auth.canIam('asset', 'read')));
  const scopedView = unassignScopeOnly || assignScopeOnly || assignUnassignScopeOnly;
  const forcedStatuses = unassignScopeOnly
    ? ['In Stock']
    : (assignScopeOnly ? ['Assigned'] : (assignUnassignScopeOnly ? ['In Stock', 'Assigned'] : null));
  const canEdit = canCreate || canUpdate;
  const PAGE_SIZE = 50;
  const HW_SORT_KEYS = new Set(['assetTag', 'brand', 'category', 'serialNumber', 'mac', 'location', 'status']);
  const HW_SORT_LS_KEY = 'itacm_hw_sort';
  const loadHwSortPref = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(HW_SORT_LS_KEY) || 'null');
      if (raw && HW_SORT_KEYS.has(raw.sort)) {
        return { sort: raw.sort, order: raw.order === 'desc' ? 'desc' : 'asc' };
      }
    } catch { /* private mode */ }
    return { sort: 'assetTag', order: 'asc' };
  };
  const saveHwSortPref = (sort, order) => {
    try { localStorage.setItem(HW_SORT_LS_KEY, JSON.stringify({ sort, order })); } catch { /* ignore */ }
  };
  const sortHwItems = (list, sort, order) =>
    sortByKey(list, sort, order, assetFieldSortValue, 'assetTag');
  const pref = loadHwSortPref();
  const sortKey = HW_SORT_KEYS.has(params.sort) ? params.sort : pref.sort;
  const sortOrder = (params.order === 'asc' || params.order === 'desc')
    ? params.order
    : (params.sort ? 'asc' : pref.order);
  const useLifecycle = params.lifecycle === 'overdue' || params.lifecycle === 'soon';
  let page = Math.max(1, Number(params.page) || 1);
  const HW_CATS = ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'];
  const STATUSES = ['In Stock', 'Assigned', 'In Repair', 'Reserved', 'Scrap', 'Sold'];
  const selectedStatus = forcedStatuses
    ? forcedStatuses
    : csvList(params.status).filter((s) => STATUSES.includes(s));
  const selectedCats = csvList(params.category).filter((c) => HW_CATS.includes(c));
  const selectedLocs = csvList(params.location).filter((l) => (AppConfig.locations || []).includes(l));

  const q = new URLSearchParams();
  if (selectedStatus.length) q.set('status', selectedStatus.join(','));
  if (selectedCats.length) q.set('categories', selectedCats.join(','));
  else q.set('categories', HW_CATS.join(','));
  if (selectedLocs.length) q.set('location', selectedLocs.join(','));
  if (params.search) q.set('search', params.search);
  q.set('sort', sortKey);
  q.set('order', sortOrder);
  if (useLifecycle) {
    q.set('limit', '2000');
  } else {
    q.set('limit', String(PAGE_SIZE));
    q.set('offset', String((page - 1) * PAGE_SIZE));
  }
  let [{ items, total }, stats] = await Promise.all([
    api('/assets?' + q.toString()),
    scopedView
      ? Promise.resolve({ assets: { total: 0, inStock: 0, inRepair: 0, assigned: 0 } })
      : api('/dashboard/stats').catch(() => ({ assets: { total: 0, inStock: 0, inRepair: 0, assigned: 0 } })),
  ]);
  const scopeTitle = unassignScopeOnly
    ? 'In Stock — Unassign scope'
    : (assignScopeOnly
      ? 'Assigned — Assign scope'
      : (assignUnassignScopeOnly ? 'Stock & Assigned — Assign/Unassign scope' : t('hw.title')));
  const scopeSubtitle = unassignScopeOnly
    ? 'Unassign scope: only In Stock devices are listed. Other statuses stay hidden.'
    : (assignScopeOnly
      ? 'Assign scope: only Assigned devices are listed. Other statuses stay hidden.'
      : (assignUnassignScopeOnly
        ? 'Assign/Unassign scope: only In Stock and Assigned devices are listed.'
        : t('hw.sub')));
  const scopeNote = unassignScopeOnly
    ? 'Other statuses (Assigned, Repair, Scrap…) are hidden for this permission.'
    : (assignScopeOnly
      ? 'Other statuses (In Stock, Repair, Scrap…) are hidden for this permission.'
      : (assignUnassignScopeOnly
        ? 'Other statuses (Repair, Scrap, Reserved…) are hidden for this permission.'
        : null));
  const statusPill = forcedStatuses
    ? `<span class="pill pill-emerald">${esc(t('common.status'))}: ${esc(forcedStatuses.map(statusLabel).join(' / '))}</span>`
    : null;
  if (isStaleView(el)) return;
  const a = stats.assets;

  if (useLifecycle) {
    if (params.lifecycle === 'overdue') {
      items = items.filter((x) => lifecycleInfo(x).overdue && x.status !== 'Scrap' && x.status !== 'Sold');
    } else {
      items = items.filter((x) => {
        const l = lifecycleInfo(x);
        return !l.overdue && l.pct != null && l.pct >= 90 && x.status !== 'Scrap' && x.status !== 'Sold';
      });
    }
    total = items.length;
    items = sortHwItems(items, sortKey, sortOrder);
  }

  // Paging is recomputed on every results render (initial + in-place search
  // refresh) inside resultsCardHTML(); safePage is kept here because cur() reads
  // it to build the hash for filter/sort/pagination navigation.
  let safePage = Math.min(page, Math.max(1, Math.ceil((useLifecycle ? items.length : total) / PAGE_SIZE)));
  const chips = [];
  selectedStatus.forEach((s) => chips.push({ key: 'status', value: s, label: `${t('common.status')}: ${statusLabel(s)}` }));
  selectedCats.forEach((c) => chips.push({ key: 'category', value: c, label: `Category: ${c}` }));
  selectedLocs.forEach((l) => chips.push({ key: 'location', value: l, label: `Location: ${l}` }));
  if (params.lifecycle) chips.push({ key: 'lifecycle', label: `Lifecycle: ${params.lifecycle === 'overdue' ? 'Past EOL' : 'EOL soon'}` });
  if (params.search) chips.push({ key: 'search', label: `Search: ${params.search}` });

  const setHash = (next) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => { if (v) p.set(k, v); });
    const qs = p.toString();
    location.hash = '#/assets' + (qs ? '?' + qs : '');
  };
  const cur = () => ({
    search: params.search || '',
    status: selectedStatus.join(','),
    category: selectedCats.join(','),
    location: selectedLocs.join(','),
    lifecycle: params.lifecycle || '',
    sort: sortKey,
    order: sortOrder,
    page: String(safePage),
  });
  const sortTh = (key, label, extraClass = '') =>
    sortThHtml(key, label, sortKey, sortOrder, extraClass);

  // The results card (mobile list + table + pagination) is built by this closure
  // so it can be re-rendered in place on an in-view search — keeping the search
  // box mounted so the mobile keyboard never closes and no keystroke is lost.
  // It recomputes paging from the current items/total/page on every call.
  const resultsCardHTML = () => {
    const pages = Math.max(1, Math.ceil((useLifecycle ? items.length : total) / PAGE_SIZE));
    safePage = Math.min(page, pages);
    const pageItems = useLifecycle
      ? items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
      : items;
    const lifePills = (x) => {
      const l = lifecycleInfo(x);
      if (x.status === 'Scrap' || x.status === 'Sold') return '';
      if (l.overdue) return `<span class="pill pill-rose" title="${esc(t('asset.eolTitle'))}">${esc(t('asset.eol'))}</span>`;
      if (l.pct != null && l.pct >= 90) return `<span class="pill pill-amber" title="${esc(t('asset.eolSoonTitle'))}">${esc(t('asset.eolSoon'))}</span>`;
      return '';
    };
    const rowActions = (x, { mobile = false } = {}) => `<div class="hw-actions${mobile ? ' hw-actions-mobile' : ''}">
        <button type="button" class="hw-icon-btn" data-view="${esc(x.id)}" title="${esc(t('common.view'))}" aria-label="${esc(t('common.view'))}">
          <span class="ms">visibility</span>
        </button>
        ${canUpdate ? `<button type="button" class="hw-icon-btn" data-edit="${esc(x.id)}" title="${esc(t('common.edit'))}" aria-label="${esc(t('common.edit'))}">
          <span class="ms">edit</span>
        </button>` : ''}
        ${canCreate ? `<button type="button" class="hw-icon-btn" data-duplicate="${esc(x.id)}" title="${esc(t('common.duplicate'))}" aria-label="${esc(t('common.duplicate'))}">
          <span class="ms">content_copy</span>
        </button>` : ''}
        ${canUnassign && x.status === 'Assigned' ? `<button type="button" class="hw-icon-btn" data-return="${esc(x.id)}" title="${esc(t('common.return'))}" aria-label="${esc(t('common.return'))}">
          <span class="ms">undo</span>
        </button>` : ''}
        ${canRepair && (x.status === 'In Stock' || x.status === 'Assigned') ? `<button type="button" class="hw-icon-btn" data-repair="${esc(x.id)}" title="${esc(t('common.repair'))}" aria-label="${esc(t('common.repair'))}">
          <span class="ms">build</span>
        </button>` : ''}
      </div>`;
    return `
    <div class="card hw-card">
    <div class="m-asset-list">
      ${pageItems.length === 0 ? `<div class="table-empty" style="padding:24px">No assets found.</div>` :
        pageItems.map((x) => {
          const specsBits = x.specs ? [x.specs.cpu, x.specs.ram].filter(Boolean).join(', ') : '';
          return `
          <div class="m-asset-card ${x.status === 'Scrap' || x.status === 'Sold' ? 'row-scrap' : ''} ${x.status === 'Reserved' ? 'row-reserved' : ''}" data-open-asset="${esc(x.id)}">
            <div class="m-asset-top">
              <span class="icon-chip chip-indigo"><span class="ms">${esc(catIcon(x.category))}</span></span>
              <div style="flex:1;min-width:0">
                <div class="mono">${esc(x.assetTag)}</div>
                <div class="cell-title">${esc(x.brand)} ${esc(x.model)}</div>
                <div class="cell-sub">${esc(x.category)}${specsBits ? ' · ' + esc(specsBits) : ''}</div>
              </div>
              <div class="hw-status">${badge(x.status)}${lifePills(x)}</div>
            </div>
            <div class="cell-sub">${esc(x.location || '—')} · <span class="mono">${esc(x.serialNumber)}</span></div>
            ${rowActions(x, { mobile: true })}
          </div>`;
        }).join('')}
    </div>
    <div class="table-wrap"><table class="data hw-table">
      <thead><tr>
        <th class="hw-col-check"><input type="checkbox" id="sel-all" ${!(canUpdate || canUnassign || canRepair) ? 'disabled' : ''}></th>
        ${sortTh('assetTag', t('hw.colAssetId') || 'Asset ID', 'hw-col-id')}
        ${sortTh('brand', t('hw.colBrandModel') || 'Brand & Model')}
        ${sortTh('serialNumber', t('hw.colSerial') || 'Serial No')}
        ${sortTh('mac', t('hw.colMac') || 'MAC', 'hw-col-mac')}
        ${sortTh('location', t('network.colLocation') || 'Location')}
        ${sortTh('status', t('common.status'))}
        <th class="hw-col-actions"></th>
      </tr></thead>
      <tbody>
        ${pageItems.length === 0 ? '<tr><td colspan="8" class="table-empty">No assets found.</td></tr>' :
          pageItems.map((x) => {
            const specsBits = x.specs ? [x.specs.cpu, x.specs.ram].filter(Boolean).join(', ') : '';
            const mac = x.macEthernet || x.macWifi;
            return `
            <tr class="hw-row asset-row ${x.status === 'Scrap' || x.status === 'Sold' ? 'row-scrap' : ''}" data-open-asset="${esc(x.id)}">
              <td class="hw-col-check">
                <input type="checkbox" data-sel="${esc(x.id)}" ${!(canUpdate || canUnassign || canRepair) ? 'disabled' : ''}>
              </td>
              <td class="hw-col-id">
                <div class="hw-id-cell">
                  <button type="button" class="hw-qr" data-qr="${esc(x.id)}" title="${esc('Show QR code')}" aria-label="${esc('Show QR code')}">
                    <span class="ms">qr_code_2</span>
                  </button>
                  <span class="mono hw-tag">${esc(x.assetTag)}</span>
                </div>
              </td>
              <td>
                <div class="hw-product">
                  <span class="hw-cat" title="${esc(x.category)}"><span class="ms">${esc(catIcon(x.category))}</span></span>
                  <div class="hw-product-text">
                    <div class="cell-title">${esc(x.brand)} ${esc(x.model)}</div>
                    <div class="cell-sub">${esc(x.category)}${specsBits ? ' · ' + esc(specsBits) : ''}</div>
                  </div>
                </div>
              </td>
              <td class="mono hw-serial">${esc(x.serialNumber)}</td>
              <td class="mono hw-mac">${mac ? esc(mac) : '<span class="hw-na">—</span>'}</td>
              <td class="hw-loc">${esc(x.location || '—')}</td>
              <td><div class="hw-status">${badge(x.status)}${lifePills(x)}</div></td>
              <td class="actions">${rowActions(x)}</td>
            </tr>`;
          }).join('')}
      </tbody>
    </table></div>
    <div class="table-foot">
      Showing ${pageItems.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} to ${Math.min(safePage * PAGE_SIZE, useLifecycle ? items.length : total)}
      of ${total != null ? total : pageItems.length} assets
      <span class="spacer"></span>
      <button class="btn btn-outline btn-sm" data-page="${safePage - 1}" ${safePage <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <span style="padding:0 6px">Page ${safePage} / ${pages}</span>
      <button class="btn btn-outline btn-sm" data-page="${safePage + 1}" ${safePage >= pages ? 'disabled' : ''}>Next ›</button>
    </div>
    </div>`;
  };

  el.innerHTML = `
    ${pageHead(
      scopeTitle,
      scopeSubtitle,
      `
      ${(Auth.canIam('asset', 'import'))
        ? `<button class="btn btn-outline" id="asset-import"><span class="ms">upload_file</span> ${esc(t('common.importExcel'))}</button>` : ''}
      ${Auth.canIam('asset', 'export')
        ? `<button class="btn btn-outline" id="asset-export"><span class="ms">download</span> ${esc(t('common.export'))}</button>` : ''}
      ${canCreate
        ? `<button class="btn btn-primary" id="asset-new"><span class="ms">add</span> ${esc(t('common.addNewAsset'))}</button>` : ''}
    `)}

    <p class="cell-sub" style="margin:-8px 0 16px">
      ${scopeNote
        || `${esc(t('hw.networkNotePre'))}
      <a href="#/network">${esc(t('nav.network') || 'Network & Server')}</a>
      ${esc(t('hw.networkNotePost'))}`}
    </p>

    ${scopedView ? '' : `
    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.totalHardware'))}</h3>${iconChip('devices', 'indigo')}</div>
        <div class="metric-value">${a.total.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.availableStock'))}</h3>${iconChip('inventory_2', 'emerald')}</div>
        <div class="metric-value">${a.inStock.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.inRepair'))}</h3>${iconChip('build', 'amber')}</div>
        <div class="metric-value">${a.inRepair.toLocaleString()}
          ${a.inRepair ? `<span class="metric-trend trend-down" style="font-size:11px;display:inline;margin-left:6px">${esc(t('common.actionNeeded'))}</span>` : ''}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('common.assigned'))}</h3>${iconChip('handshake', 'blue')}</div>
        <div class="metric-value">${a.assigned.toLocaleString()}</div>
      </div>
    </div>`}

    <div class="toolbar" id="asset-filters">
      <div class="search-box"><span class="ms">search</span>
        <input type="search" id="asset-search" placeholder="${esc(t('asset.f.searchPh'))}" value="${esc(params.search || '')}"></div>
      ${statusPill
        || multiSelectHtml({
          id: 'status',
          allLabel: t('network.allStatuses'),
          selected: selectedStatus,
          options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
        })}
      ${multiSelectHtml({
        id: 'category',
        allLabel: t('hw.allCategories') || 'All hardware categories',
        selected: selectedCats,
        options: HW_CATS.map((c) => ({ value: c, label: c })),
      })}
      ${multiSelectHtml({
        id: 'location',
        allLabel: t('network.allLocations'),
        selected: selectedLocs,
        options: (AppConfig.locations || []).map((l) => ({ value: l, label: l })),
      })}
    </div>
    ${chips.length ? `<div class="filter-chips"><strong>Active Filters:</strong>
      ${chips.map((c) => `<span class="chip">${esc(c.label)}
        <button type="button" data-clear="${esc(c.key)}" ${c.value != null ? `data-clear-val="${esc(c.value)}"` : ''}><span class="ms">close</span></button></span>`).join('')}
      <a href="#/assets" id="clear-all">Clear All</a></div>` : ''}

    <div id="bulk-bar-slot"></div>

    <div id="asset-results">${resultsCardHTML()}</div>`;

  /* ---- multi-select bulk actions ---- */
  const selected = new Set();
  function renderBulkBar() {
    const slot = $('#bulk-bar-slot', el);
    if (selected.size === 0) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="bulk-bar">
        <span class="ms" style="color:var(--indigo-700)">check_box</span>
        <strong>${selected.size} selected</strong>
        <span class="spacer"></span>
        <button class="btn btn-outline btn-sm" id="bulk-labels"><span class="ms">barcode</span> Print Labels</button>
        ${canUnassign ? '<button class="btn btn-outline btn-sm" id="bulk-return"><span class="ms">undo</span> Return to Stock</button>' : ''}
        ${canRepair ? '<button class="btn btn-outline btn-sm" id="bulk-repair"><span class="ms">build</span> Send to Repair</button>' : ''}
        ${canUpdate ? '<button class="btn btn-danger btn-sm" id="bulk-scrap"><span class="ms">delete</span> Scrap</button>' : ''}
        <button class="btn btn-outline btn-sm" id="bulk-clear">Clear</button>
      </div>`;

    const pick = () => items.filter((x) => selected.has(x.id));

    $('#bulk-labels', slot).addEventListener('click', () => printAssetLabels(pick()));

    $('#bulk-clear', slot).addEventListener('click', () => {
      selected.clear();
      el.querySelectorAll('input[data-sel]').forEach((c) => { c.checked = false; });
      $('#sel-all', el).checked = false;
      renderBulkBar();
    });

    $('#bulk-return', slot)?.addEventListener('click', async () => {
      const targets = pick().filter((x) => x.status === 'Assigned');
      if (!targets.length) return toast('None of the selected assets are Assigned', 'error');
      let ok = 0;
      for (const x of targets) {
        try { await api(`/assets/${x.id}/return`, { method: 'POST', body: { conditionNote: 'Bulk return' } }); ok++; }
        catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
      }
      toast(`${ok}/${targets.length} asset(s) returned to stock`, 'success');
      rerender({});
    });

    $('#bulk-repair', slot)?.addEventListener('click', () => {
      const targets = pick().filter((x) => x.status === 'In Stock' || x.status === 'Assigned');
      if (!targets.length) return toast('Selected assets cannot be sent to repair', 'error');
      formModal({
        title: `Send ${targets.length} asset(s) to repair`,
        // Cost is entered later when each repair is closed (it isn't known yet).
        fields: [
          { name: 'serviceCompany', label: 'Service company *', required: true },
          { name: 'issueDescription', label: 'Issue description *', type: 'textarea', required: true, full: true },
        ],
        submitLabel: 'Send all to repair',
        async onSubmit(d) {
          let ok = 0;
          for (const x of targets) {
            try { await api('/maintenance', { method: 'POST', body: { ...d, assetId: x.id } }); ok++; }
            catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
          }
          toast(`${ok}/${targets.length} asset(s) sent to repair`, 'success');
          rerender({});
        },
      });
    });

    $('#bulk-scrap', slot)?.addEventListener('click', () => {
      const targets = pick().filter((x) => x.status === 'In Stock' || x.status === 'In Repair');
      const skipped = selected.size - targets.length;
      if (!targets.length) return toast('Only In Stock / In Repair assets can be scrapped (return assigned ones first)', 'error');
      confirmModal(
        `Scrap ${targets.length} asset(s)?${skipped ? ` (${skipped} assigned/scrapped skipped)` : ''} This marks them as end-of-life.`,
        async () => {
          let ok = 0;
          let pending = 0;
          for (const x of targets) {
            try {
              const res = await api(`/assets/${x.id}`, { method: 'PUT', body: { status: 'Scrap' } });
              // The server answers 202 with pendingApproval when the disposal
              // policy needs sign-off — the asset is NOT scrapped yet.
              if (res && res.pendingApproval) pending++; else ok++;
            } catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
          }
          if (ok) toast(`${ok}/${targets.length} asset(s) scrapped`, 'success');
          if (pending) toast(`${pending} × ${t('asset.sentForApproval')}`, 'info');
          rerender({});
        }
      );
    });
  }

  // The select-all + row checkboxes live inside #asset-results, so they must be
  // re-bound after an in-place search refresh replaces that region.
  function bindResultsSelection() {
    const selAll = $('#sel-all', el);
    if (selAll) selAll.addEventListener('change', () => {
      el.querySelectorAll('input[data-sel]').forEach((c) => {
        c.checked = selAll.checked;
        if (selAll.checked) selected.add(c.dataset.sel); else selected.delete(c.dataset.sel);
      });
      renderBulkBar();
    });
    el.querySelectorAll('input[data-sel]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) selected.add(c.dataset.sel); else selected.delete(c.dataset.sel);
      renderBulkBar();
    }));
  }
  bindResultsSelection();

  const rerender = (p) => {
    if (isStaleView(el)) return;
    // Paint ghost rows over the current results before the (async) refetch so
    // the change reads as a deliberate load, not a full-page refresh flash.
    showAssetsSkeleton(el);
    const before = location.hash;
    setHash({ ...cur(), ...p, page: p.page != null ? String(p.page) : '1' });
    // A post-mutation refresh (return / repair / scrap / edit) keeps the same
    // filters, so the hash is unchanged and no `hashchange` fires — the skeleton
    // would then be stuck forever. Re-run navigation explicitly so it is replaced
    // with fresh data (this also makes the mutation's result actually show).
    if (location.hash === before && typeof navigate === 'function') navigate();
  };

  // In-place search: refetch and repaint ONLY the results region, leaving the
  // search box mounted. A full re-render would rebuild the input and — on mobile —
  // close the keyboard on every keystroke (programmatic focus can't reopen it).
  async function refreshResults(searchVal) {
    const nextSearch = String(searchVal || '').trim();
    params.search = nextSearch; // keep cur() in sync for later filter/sort nav
    page = 1;                    // a new search starts at page 1
    // Update the URL in place (shareable / back button) WITHOUT navigating.
    try {
      const sp = new URLSearchParams(location.hash.split('?')[1] || '');
      if (nextSearch) sp.set('search', nextSearch); else sp.delete('search');
      sp.set('page', '1');
      const qs = sp.toString();
      history.replaceState(null, '', '#/assets' + (qs ? '?' + qs : ''));
    } catch { /* ignore */ }

    showAssetsSkeleton(el);
    const rq = new URLSearchParams();
    if (selectedStatus.length) rq.set('status', selectedStatus.join(','));
    if (selectedCats.length) rq.set('categories', selectedCats.join(',')); else rq.set('categories', HW_CATS.join(','));
    if (selectedLocs.length) rq.set('location', selectedLocs.join(','));
    if (nextSearch) rq.set('search', nextSearch);
    rq.set('sort', sortKey);
    rq.set('order', sortOrder);
    if (useLifecycle) { rq.set('limit', '2000'); } else { rq.set('limit', String(PAGE_SIZE)); rq.set('offset', '0'); }

    let res;
    try {
      res = await api('/assets?' + rq.toString());
    } catch (err) {
      // Never leave the skeleton stuck on a failed search — repaint the current
      // (unchanged) rows so the list stays usable, then surface the error.
      if (!isStaleView(el)) {
        const slotEl = $('#asset-results', el);
        if (slotEl) slotEl.innerHTML = resultsCardHTML();
        bindResultsSelection();
      }
      toast((err && err.message) || 'Search failed', 'error');
      return;
    }
    if (isStaleView(el)) return;
    items = res.items || [];
    total = res.total;
    if (useLifecycle) {
      if (params.lifecycle === 'overdue') {
        items = items.filter((x) => lifecycleInfo(x).overdue && x.status !== 'Scrap' && x.status !== 'Sold');
      } else {
        items = items.filter((x) => { const l = lifecycleInfo(x); return !l.overdue && l.pct != null && l.pct >= 90 && x.status !== 'Scrap' && x.status !== 'Sold'; });
      }
      total = items.length;
      items = sortHwItems(items, sortKey, sortOrder);
    }
    selected.clear();
    const slot = $('#asset-results', el);
    if (slot) slot.innerHTML = resultsCardHTML();
    bindResultsSelection();
    renderBulkBar();
  }

  bindDebouncedSearch($('#asset-search', el), {
    getValue: () => params.search || '',
    apply: (search) => { refreshResults(search); },
  });
  mountMultiSelects($('#asset-filters', el), {
    status: scopedView ? undefined : (vals) => rerender({ status: vals.join(','), page: 1 }),
    category: (vals) => rerender({ category: vals.join(','), page: 1 }),
    location: (vals) => rerender({ location: vals.join(','), page: 1 }),
  });
  if (canCreate) {
    $('#asset-new', el)?.addEventListener('click', () => assetForm(null, () => rerender({})));
  }
  if ($('#asset-import', el)) {
    $('#asset-import', el).addEventListener('click', () => showImportModal(() => rerender({})));
  }
  const expBtn = $('#asset-export', el);
  if (expBtn) {
    expBtn.addEventListener('click', () => {
      if (!Auth.canIam('asset', 'export')) {
        toast(t('common.forbidden') || 'You do not have permission to export', 'error');
        return;
      }
      exportCsv(items);
    });
  }
  const clearAll = $('#clear-all', el);
  if (clearAll) clearAll.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '#/assets';
  });

  bindView(el, async (e) => {
    if (e.target.closest('input')) return; // checkboxes have their own handlers
    if (e.target.closest('.msel')) return;
    const byId = (id) => items.find((x) => x.id === id);

    const b = e.target.closest('button');
    if (!b) {
      // Click anywhere on the row/card → open the asset detail screen.
      const row = e.target.closest('tr.asset-row, .m-asset-card');
      if (row) showAssetDetail(row.dataset.openAsset, () => rerender({}));
      return;
    }
    if (b.dataset.qr) { showQrModal(byId(b.dataset.qr)); return; }
    if (b.dataset.sort) {
      const nextSort = b.dataset.sort;
      const nextOrder = b.dataset.order === 'desc' ? 'desc' : 'asc';
      saveHwSortPref(nextSort, nextOrder);
      rerender({ sort: nextSort, order: nextOrder, page: 1 });
      return;
    }
    if (b.dataset.page) { rerender({ page: Number(b.dataset.page) }); return; }
    if (b.dataset.clear) {
      const key = b.dataset.clear;
      const val = b.dataset.clearVal;
      const next = { ...cur(), page: 1 };
      if (val != null && ['status', 'category', 'location'].includes(key)) {
        next[key] = csvList(next[key]).filter((x) => x !== val).join(',');
      } else {
        next[key] = '';
      }
      setHash(next);
      return;
    }
    if (b.dataset.view) showAssetDetail(b.dataset.view, () => rerender({}));
    if (b.dataset.edit) assetForm(byId(b.dataset.edit), () => rerender({}));
    if (b.dataset.duplicate) assetForm(duplicateAssetSeed(byId(b.dataset.duplicate)), () => rerender({}));
    if (b.dataset.return) {
      const x = byId(b.dataset.return);
      formModal({
        title: `Return ${x.assetTag} to stock`,
        fields: [{ name: 'conditionNote', label: 'Condition note', type: 'textarea', full: true }],
        submitLabel: 'Return to stock',
        async onSubmit(d) {
          await api(`/assets/${x.id}/return`, { method: 'POST', body: d });
          toast(`${x.assetTag} returned to stock`, 'success');
          rerender({});
        },
      });
    }
    if (b.dataset.repair) {
      const x = byId(b.dataset.repair);
      formModal({
        title: `Send ${x.assetTag} to repair`,
        // Cost is intentionally NOT collected here — the repair bill is only known
        // later. It is entered when the repair is closed (Maintenance → Close).
        fields: [
          { name: 'serviceCompany', label: 'Service company', required: true },
          { name: 'issueDescription', label: 'Issue description', type: 'textarea', required: true, full: true },
        ],
        submitLabel: 'Send to repair',
        async onSubmit(d) {
          await api('/maintenance', { method: 'POST', body: { ...d, assetId: x.id } });
          toast(`${x.assetTag} sent to repair`, 'success');
          rerender({});
        },
      });
    }
  });
};

function exportCsv(items) {
  const head = ['assetTag', 'brand', 'model', 'category', 'serialNumber', 'macEthernet', 'macWifi', 'status', 'employee'];
  const rows = items.map((x) => [
    x.assetTag, x.brand, x.model, x.category, x.serialNumber,
    x.macEthernet || '', x.macWifi || '', x.status, x.currentEmployee ? x.currentEmployee.fullName : '',
  ]);
  const csvEsc = (v) => `"${csvCell(v).replace(/"/g, '""')}"`;
  const csv = [head, ...rows].map((r) => r.map(csvEsc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'hardware-inventory.csv';
  a.click();
}

/**
 * Build a prefilled create-mode seed from an existing asset. Per-device
 * identity (tag, serial, MACs) and the occupied rack U slot never carry over;
 * `duplicateOf` keeps the source id/tag for the modal title and for copying
 * custom-field values onto the new record.
 */
function duplicateAssetSeed(x) {
  const clone = JSON.parse(JSON.stringify(x));
  delete clone.id;
  delete clone.assetTag;
  delete clone.serialNumber;
  delete clone.macEthernet;
  delete clone.macWifi;
  delete clone.rackUStart;
  delete clone.rackUSize;
  clone.status = 'In Stock';
  delete clone.assignedEmployeeId;
  delete clone.assignedEmployee;
  delete clone.assignedTo;
  delete clone.history; // detail-view payload only; the form never reads it
  clone.duplicateOf = { id: x.id, assetTag: x.assetTag };
  return clone;
}

async function assetForm(asset, done) {
  const s = (asset && asset.specs) || {};
  const HW_CATS = ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'];
  const INFRA_CATS = ['Network', 'Server'];
  const isEdit = !!(asset && asset.id);
  const seedCat = asset && asset.category;
  const infraMode = isEdit
    ? INFRA_CATS.includes(asset.category)
    : INFRA_CATS.includes(seedCat);
  const CATS = infraMode ? INFRA_CATS : HW_CATS;
  const [catalog, cfBundle] = await Promise.all([
    api('/catalog').catch(() => []),
    // A duplicate seed has no id yet — prefill custom-field values from the source asset.
    fetchCustomFields('asset', (asset && asset.id) || (asset && asset.duplicateOf && asset.duplicateOf.id)),
  ]);
  const cfDefs = cfBundle.defs;
  const cfValues = cfBundle.values;
  // Hardware "Other" opens a free-text category; unknown stored values reopen as Other + text.
  let categorySelect = CATS[0];
  let customCategory = '';
  if (seedCat) {
    if (infraMode) {
      categorySelect = CATS.includes(seedCat) ? seedCat : CATS[0];
    } else if (seedCat === 'Other') {
      categorySelect = 'Other';
    } else if (CATS.includes(seedCat)) {
      categorySelect = seedCat;
    } else {
      categorySelect = 'Other';
      customCategory = seedCat;
    }
  }
  const state = {
    category: categorySelect,
    customCategory,
    brand: (asset && asset.brand) || '',
    model: (asset && asset.model) || '',
    rack: (asset && asset.rack) || '',
    rackUStart: asset && asset.rackUStart != null ? Number(asset.rackUStart) : null,
  };
  const OTHER = '__other__';
  const brandsFor = (cat) => [...new Set(catalog.filter((c) => c.category === cat).map((c) => c.brand))].sort();
  const modelsFor = (cat, brand) => catalog.filter((c) => c.category === cat && c.brand === brand).map((c) => c.model).sort();

  const title = isEdit
    ? (t('asset.f.editTitle') || 'Edit {tag}').replace('{tag}', asset.assetTag)
    : (asset && asset.duplicateOf
      ? `${t('common.duplicate')} — ${asset.duplicateOf.assetTag}`
      : (infraMode ? t('asset.f.addInfra') : t('common.addNewAsset')));

  const tagField = isEdit
    ? `<div class="form-field"><label>${esc(t('asset.f.assetTag'))}</label>
        <input id="af-tag-preview" class="af-tag-preview" value="${esc(asset.assetTag)}" disabled></div>`
    : infraMode
      ? `<div class="form-field"><label>${esc(t('asset.f.assetTag'))} *</label>
          <input name="assetTag" required maxlength="64" placeholder="e.g. FW-HQ-01 / RACK-A01-U38"
            value="${esc((asset && asset.assetTag) || '')}" pattern="\\S+"></div>`
      : `<div class="form-field"><label>${esc(t('asset.f.assetTag'))} <span class="ob-hint">${esc(t('asset.f.auto'))} · ${(AppConfig.assetTagPrefix || 'IT')}-####</span></label>
          <input id="af-tag-preview" class="af-tag-preview" value="…" disabled></div>`;

  openModal({
    title,
    wide: true,
    body: `
      <form id="af" class="af-form" novalidate>
        <section class="af-sec">
          <div class="af-sec-head"><strong>${esc(t('asset.f.secIdentity'))}</strong><span>${esc(t('asset.f.secIdentitySub'))}</span></div>
          ${tagField}
          <div class="form-field"><label>${esc(t('asset.f.serial'))} *</label>
            <input name="serialNumber" required autocomplete="off" value="${esc((asset && asset.serialNumber) || '')}"></div>
          <div class="form-field"><label>${esc(t('asset.f.category'))} *</label>
            <select id="af-cat">${CATS.map((c) => `<option ${state.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            ${infraMode ? '' : `<input id="af-cat-other" class="${state.category === 'Other' ? '' : 'hidden'}" style="margin-top:6px"
              maxlength="60" placeholder="${esc(t('asset.f.customCatPh'))}"
              value="${esc(state.customCategory || '')}">`}
          </div>
          <div class="form-field"><label>${esc(t('asset.f.purchaseDate'))}</label>
            <input type="date" name="purchaseDate" value="${asset && asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : ''}"></div>
          <div class="form-field"><label>${esc(t('asset.f.purchaseCost'))} <span class="ob-hint">${esc(appCurrency())}</span></label>
            <input type="number" name="cost" min="0" step="0.01" placeholder="0.00"
              value="${asset && Number(asset.cost) > 0 ? esc(asset.cost) : ''}"></div>
          <div class="form-field"><label>${esc(t('asset.f.salvage'))} <span class="ob-hint">${esc(t('asset.f.salvageHint'))}</span></label>
            <input type="number" name="salvageValue" min="0" step="0.01" placeholder="0.00"
              value="${asset && asset.salvageValue != null ? esc(asset.salvageValue) : ''}"></div>
          <div class="form-field" id="af-location-wrap"><label id="af-location-label">${esc(t('asset.f.location'))}</label>
            <select name="location" id="af-location">
              <option value="">${esc(t('asset.f.noLocation'))}</option>
              ${(AppConfig.locations || []).map((l) => {
                const sel = asset ? asset.location === l : AppConfig.defaultLocation === l;
                return `<option ${sel ? 'selected' : ''}>${esc(l)}</option>`;
              }).join('')}
            </select></div>
          <div class="form-field full" data-f="responsible">
            <label>${esc(t('asset.f.responsible'))} * <span class="ob-hint">${esc(t('asset.f.responsibleHint'))}</span></label>
            <div id="af-responsible-host" class="emp-search-host"></div>
          </div>
        </section>

        <section class="af-sec" data-af-infra>
          <div class="af-sec-head" data-f="infraRole"><strong>${esc(t('asset.f.secInfra'))}</strong><span>${esc(t('asset.f.secInfraSub'))}</span></div>
          <div class="form-field" data-f="infraRole"><label>${esc(t('asset.f.role'))}</label>
            <select name="infraRole">
              <option value="">${esc(t('asset.f.selectRole'))}</option>
              ${['Switch', 'Firewall', 'Access Point', 'Router', 'Load Balancer', 'Hypervisor', 'Physical Server', 'Storage', 'Appliance', 'Other'].map((r) =>
                `<option ${asset && asset.infraRole === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select></div>
          <div class="form-field" data-f="rack"><label>${esc(t('asset.f.rack'))}</label>
            <div id="af-rack-slot"></div></div>
          <div class="form-field" data-f="rackUStart"><label>${esc(t('asset.f.uPos'))} <span class="ob-hint">${esc(t('asset.f.fromBottom'))}</span></label>
            <div id="af-u-slot"></div></div>
          <div class="form-field" data-f="rackUSize"><label>${esc(t('asset.f.uHeight'))}</label>
            <input type="number" name="rackUSize" id="af-u-size" min="1" max="20" placeholder="1"
              value="${asset && asset.rackUSize != null ? asset.rackUSize : (asset && asset.rackUStart != null ? 1 : '')}"></div>
          <div class="form-field" data-f="mgmtIp"><label>${esc(t('asset.f.mgmtIp'))}</label>
            <input name="mgmtIp" placeholder="e.g. 10.255.0.10" value="${esc((asset && asset.mgmtIp) || '')}"></div>
          <div class="form-field" data-f="firmwareVersion"><label>${esc(t('asset.f.firmware'))}</label>
            <input name="firmwareVersion" placeholder="e.g. 17.3.4" value="${esc((asset && asset.firmwareVersion) || '')}"></div>
          <div class="form-field" data-f="firmwareUpdatedAt"><label>${esc(t('asset.f.firmwareUpdated'))}</label>
            <input type="date" name="firmwareUpdatedAt" value="${asset && asset.firmwareUpdatedAt ? String(asset.firmwareUpdatedAt).slice(0, 10) : ''}"></div>
          <div class="form-field" data-f="warrantyEnd"><label>${esc(t('asset.f.warrantyEnds'))}</label>
            <input type="date" name="warrantyEndDate" value="${asset && asset.warrantyEndDate ? String(asset.warrantyEndDate).slice(0, 10) : ''}"></div>
          <div class="form-field full" data-f="parentDevice">
            <label>${esc(t('asset.f.parents'))} <span class="ob-hint">${esc(t('asset.f.parentsHint'))}</span></label>
            <div id="af-parents" class="af-parent-list"></div>
            <div class="cell-sub" style="margin-top:6px">${esc(t('asset.f.haHint'))}</div>
          </div>
        </section>

        <section class="af-sec">
          <div class="af-sec-head"><strong>${esc(t('asset.f.secProduct'))}</strong><span>${esc(t('asset.f.secProductSub'))}</span></div>
          <div class="form-field"><label>${esc(t('asset.f.brand'))} *</label>
            <div id="af-brand-slot"></div></div>
          <div class="form-field"><label>${esc(t('asset.f.model'))} *</label>
            <div id="af-model-slot"></div></div>
        </section>

        <section class="af-sec">
          <div class="af-sec-head" data-af-specs-head><strong>${esc(t('asset.f.secSpecs'))}</strong><span>${esc(t('asset.f.secSpecsSub'))}</span></div>
          <div class="form-field" data-f="macEthernet"><label>MAC (Ethernet)</label>
            <input name="macEthernet" placeholder="AA:BB:CC:DD:EE:FF" value="${esc((asset && asset.macEthernet) || '')}"></div>
          <div class="form-field" data-f="macWifi"><label>MAC (Wi-Fi)</label>
            <input name="macWifi" placeholder="AA:BB:CC:DD:EE:FF" value="${esc((asset && asset.macWifi) || '')}"></div>
          ${['cpu', 'ram', 'storage'].map((k) => {
            const opts = (AppConfig.specOptions || {})[k] || [];
            const cur = s[k] || '';
            const known = !cur || opts.includes(cur);
            return `<div class="form-field" data-f="${k}"><label>${k.toUpperCase()} *</label>
              <select name="${k}">
                <option value="">${esc((t('asset.f.selectPh') || 'Select {x}…').replace('{x}', k.toUpperCase()))}</option>
                ${known ? '' : `<option selected>${esc(cur)}</option>`}
                ${opts.map((o) => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
              </select></div>`;
          }).join('')}
          <div class="form-field" data-f="os"><label>OS</label><input name="os" value="${esc(s.os || '')}"></div>
          <div class="form-field" data-f="hostname"><label>${esc(t('asset.f.hostname'))}</label>
            <input name="hostname" placeholder="e.g. sw-core-01" value="${esc(s.hostname || '')}"></div>
          <div class="form-field" data-f="ipAddress"><label>${esc(t('asset.f.ipAddress'))}</label>
            <input name="ipAddress" placeholder="e.g. 10.0.0.1" value="${esc(s.ipAddress || '')}"></div>
          <div class="form-field full" data-f="relatedLicense">
            <label>${esc(t('asset.f.linkedLicenses'))} <span class="ob-hint">${esc(t('asset.f.optional'))}</span>
              <span class="af-lic-count cell-sub" id="af-lic-count"></span></label>
            <div class="af-license-wrap">
              <div class="search-box af-license-search"><span class="ms">search</span>
                <input type="search" id="af-lic-q" placeholder="${esc(t('asset.f.filterLicenses'))}" autocomplete="off"></div>
              <div id="af-licenses" class="af-license-list"></div>
            </div>
          </div>
        </section>

        <section class="af-sec">
          <div class="af-sec-head"><strong>${esc(t('asset.f.secNotes'))}</strong><span>${esc(t('asset.f.secNotesSub'))}</span></div>
          <div class="form-field full"><label>${esc(t('asset.f.note'))}</label>
            <textarea name="notes" rows="3" maxlength="2000" placeholder="${esc(t('asset.f.notePh'))}">${esc((asset && asset.notes) || '')}</textarea></div>
          ${renderCustomFieldsHtml(cfDefs, cfValues)}
        </section>
        <div id="af-error"></div>
      </form>`,
    foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
           <button class="btn btn-primary" type="submit" form="af">${esc(t('common.save'))}</button>`,
    onMount(overlay) {
      // Category-dependent fields: only show what makes sense for the device type.
      const FIELD_RULES = {
        Laptop: ['macEthernet', 'macWifi', 'cpu', 'ram', 'storage', 'os'],
        Desktop: ['macEthernet', 'macWifi', 'cpu', 'ram', 'storage', 'os'],
        Tablet: ['macWifi', 'storage', 'os'],
        Phone: ['macWifi', 'storage', 'os'],
        Monitor: [],
        Television: ['macEthernet', 'macWifi'],
        Printer: ['macEthernet', 'macWifi'],
        Network: ['macEthernet', 'hostname', 'ipAddress', 'mgmtIp', 'infraRole', 'rack', 'rackUStart', 'rackUSize',
          'firmwareVersion', 'firmwareUpdatedAt', 'warrantyEnd', 'parentDevice', 'relatedLicense', 'responsible'],
        Server: ['macEthernet', 'macWifi', 'cpu', 'ram', 'storage', 'os', 'hostname', 'ipAddress', 'mgmtIp',
          'infraRole', 'rack', 'rackUStart', 'rackUSize', 'firmwareVersion', 'firmwareUpdatedAt', 'warrantyEnd', 'parentDevice',
          'relatedLicense', 'responsible'],
        Keyboard: [], Mouse: [], Headset: [], Webcam: [],
        'Docking Station': ['macEthernet'],
        Peripheral: [], Accessory: [],
        Other: ['macEthernet', 'macWifi', 'cpu', 'ram', 'storage', 'os'],
      };
      const allowedFields = () => FIELD_RULES[state.category] || FIELD_RULES.Other;
      /** location → sorted unique rack names */
      const racksByLocation = new Map();
      /** All Network/Server devices (for rack occupancy) */
      let infraDevices = [];

      function applyFieldRules() {
        const allowed = allowedFields();
        overlay.querySelectorAll('[data-f]').forEach((w) =>
          w.classList.toggle('hidden', !allowed.includes(w.dataset.f)));
        // Hide a section only when every form-field inside is hidden
        // (Identity/Product/Notes keep core fields without data-f).
        overlay.querySelectorAll('.af-sec').forEach((sec) => {
          const fields = [...sec.querySelectorAll('.form-field')];
          if (!fields.length) return;
          const anyVisible = fields.some((f) => !f.classList.contains('hidden'));
          sec.classList.toggle('hidden', !anyVisible);
        });
        const infra = state.category === 'Network' || state.category === 'Server';
        const locLab = $('#af-location-label', overlay);
        if (locLab) {
          locLab.innerHTML = infra
            ? 'Location * <span class="ob-hint">required for Network/Server</span>'
            : 'Location';
        }
        if (infra) {
          renderRackPicker();
          renderUPicker();
        }
      }

      function racksForLocation(loc) {
        if (!loc) return [];
        return racksByLocation.get(loc) || [];
      }

      function currentLocation() {
        return ($('#af-location', overlay) && $('#af-location', overlay).value) || '';
      }

      function currentRackName() {
        const sel = $('#af-rack', overlay);
        const rt = $('#af-rack-text', overlay);
        if (sel && sel.value === OTHER) return (rt && rt.value.trim()) || state.rack || '';
        if (sel && sel.value) return sel.value;
        return (state.rack || '').trim();
      }

      function placementOf(d) {
        if (typeof NetViz !== 'undefined' && NetViz.rackPlacement) return NetViz.rackPlacement(d);
        let start = d.rackUStart != null && d.rackUStart !== '' ? Number(d.rackUStart) : null;
        let size = d.rackUSize != null && d.rackUSize !== '' ? Number(d.rackUSize) : null;
        if (!Number.isFinite(start) || start < 1) start = null;
        if (!Number.isFinite(size) || size < 1) size = null;
        if (start == null && d.rackUnit) {
          const range = String(d.rackUnit).match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
          if (range) {
            const a = Number(range[1]); const b = Number(range[2]);
            start = Math.min(a, b);
            if (size == null) size = Math.abs(b - a) + 1;
          } else {
            const n = parseInt(String(d.rackUnit), 10);
            if (Number.isFinite(n) && n >= 1) start = n;
          }
        }
        if (start != null && size == null) size = 1;
        return { start, size: size || 1 };
      }

      /** Map of U → occupant { id, assetTag } for selected location+rack (excludes self). */
      function occupancyMap() {
        const loc = currentLocation();
        const rack = currentRackName();
        const map = new Map();
        if (!loc || !rack) return map;
        const selfId = asset && asset.id;
        infraDevices.forEach((d) => {
          if (selfId && d.id === selfId) return;
          if ((d.location || '') !== loc) return;
          if ((d.rack || '').trim() !== rack) return;
          const p = placementOf(d);
          if (p.start == null) return;
          for (let u = p.start; u < p.start + p.size; u++) {
            if (!map.has(u)) map.set(u, { id: d.id, assetTag: d.assetTag });
          }
        });
        return map;
      }

      function currentUSize() {
        const sizeInp = $('#af-u-size', overlay);
        const n = sizeInp && sizeInp.value ? Number(sizeInp.value) : NaN;
        if (Number.isFinite(n) && n >= 1) return Math.min(20, Math.floor(n));
        return state.rackUStart != null ? 1 : 1;
      }

      /** Cabinet height from siblings + current draft (matches rack viz). */
      function cabinetMaxU(occ, size) {
        let needed = 42;
        const loc = currentLocation();
        const rack = currentRackName();
        if (loc && rack) {
          infraDevices.forEach((d) => {
            if ((d.location || '') !== loc) return;
            if ((d.rack || '').trim() !== rack) return;
            const p = placementOf(d);
            if (p.start != null) needed = Math.max(needed, p.start + p.size - 1);
          });
        }
        if (state.rackUStart != null) {
          needed = Math.max(needed, state.rackUStart + (size || 1) - 1);
        }
        if (typeof NetViz !== 'undefined' && NetViz.cabinetHeight) return NetViz.cabinetHeight(needed);
        if (needed <= 24) return 24;
        if (needed <= 42) return 42;
        if (needed <= 48) return 48;
        return Math.min(60, Math.ceil(needed / 6) * 6);
      }

      function rangeBlockers(start, size, occ) {
        const blockers = [];
        for (let u = start; u < start + size; u++) {
          const who = occ.get(u);
          if (who) blockers.push(`U${u} (${who.assetTag})`);
        }
        return blockers;
      }

      function renderUPicker() {
        const slot = $('#af-u-slot', overlay);
        if (!slot) return;
        const loc = currentLocation();
        const rack = currentRackName();
        const occ = occupancyMap();
        const cur = state.rackUStart;
        const size = currentUSize();
        const maxU = cabinetMaxU(occ, size);
        const freeCount = (() => {
          let n = 0;
          for (let u = 1; u <= maxU; u++) if (!occ.has(u)) n += 1;
          return n;
        })();

        if (!loc || !rack) {
          slot.innerHTML = `
            <select name="rackUStart" id="af-u-start" disabled>
              <option value="">Select location &amp; cabinet first…</option>
            </select>
            <div class="cell-sub" style="margin-top:6px">U1 is the bottom of the cabinet; pick the lowest U this device occupies.</div>`;
          return;
        }

        const opts = [];
        for (let u = maxU; u >= 1; u--) {
          const fits = u + size - 1 <= maxU;
          const blockers = fits ? rangeBlockers(u, size, occ) : [`exceeds ${maxU}U`];
          const blocked = blockers.length > 0;
          const who = occ.get(u);
          let label = `U${u}`;
          if (!fits) label = `U${u} — too high for ${size}U`;
          else if (blocked) label = `U${u} — overlaps (${blockers[0]})`;
          else if (size > 1) label = `U${u}–${u + size - 1}`;
          // Keep current start selectable even if it still clashes (so the hint can explain).
          const disabled = blocked && cur !== u;
          opts.push(`<option value="${u}" ${cur === u ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(label)}</option>`);
        }

        let clashHint = '';
        if (cur != null && size >= 1) {
          const blockers = rangeBlockers(cur, size, occ);
          if (cur + size - 1 > maxU) blockers.push(`U${cur + size - 1} (cabinet is ${maxU}U)`);
          if (blockers.length) {
            const msg = (typeof t === 'function' ? t('network.uClashHint') : '') || 'Overlaps occupied units: {list}';
            clashHint = `<div class="af-u-clash">${esc(msg.replace('{list}', blockers.join(', ')))}</div>`;
          }
        }

        slot.innerHTML = `
          <select name="rackUStart" id="af-u-start">
            <option value="">— Not in cabinet —</option>
            ${opts.join('')}
          </select>
          <div class="cell-sub" style="margin-top:6px">
            U1 = bottom · ${freeCount} free / ${maxU}U in <strong>${esc(rack)}</strong>
            ${size > 1 ? ` · height ${size}U` : ''}
          </div>
          ${clashHint}`;

        const sel = $('#af-u-start', overlay);
        sel.addEventListener('change', (e) => {
          state.rackUStart = e.target.value ? Number(e.target.value) : null;
          renderUPicker();
        });
      }

      function renderRackPicker() {
        const slot = $('#af-rack-slot', overlay);
        if (!slot) return;
        const loc = currentLocation();
        const known = racksForLocation(loc);
        const cur = state.rack || '';
        const inList = !!(cur && known.includes(cur));

        if (!loc) {
          slot.innerHTML = `
            <div class="cell-sub" style="margin-bottom:6px">Select a location to list cabinets at that site — or type a new name.</div>
            <input id="af-rack-text" placeholder="e.g. RACK-A1" value="${esc(cur)}">`;
          const rt = $('#af-rack-text', overlay);
          if (rt) {
            rt.addEventListener('input', (e) => {
              state.rack = e.target.value;
              renderUPicker();
            });
          }
          renderUPicker();
          return;
        }

        slot.innerHTML = `
          <select id="af-rack">
            <option value="">— No cabinet —</option>
            ${known.map((r) => `<option value="${esc(r)}" ${cur === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            <option value="${OTHER}" ${cur && !inList ? 'selected' : ''}>Other (new cabinet)…</option>
          </select>
          <input id="af-rack-text" class="${cur && !inList ? '' : 'hidden'}" style="margin-top:6px"
            placeholder="${esc(t('asset.f.newCabinetPh'))}" value="${inList ? '' : esc(cur)}">
          ${known.length
            ? `<div class="cell-sub" style="margin-top:6px">${known.length} cabinet${known.length === 1 ? '' : 's'} at ${esc(loc)}</div>`
            : `<div class="cell-sub" style="margin-top:6px">No cabinets at this location yet — choose Other to create one.</div>`}`;

        const sel = $('#af-rack', overlay);
        const rt = $('#af-rack-text', overlay);
        sel.addEventListener('change', (e) => {
          const v = e.target.value;
          if (v === OTHER) {
            state.rack = (rt && rt.value.trim()) || '';
            if (rt) { rt.classList.remove('hidden'); rt.focus(); }
          } else {
            state.rack = v;
            if (rt) { rt.classList.add('hidden'); rt.value = ''; }
          }
          renderUPicker();
        });
        if (rt) {
          rt.addEventListener('input', (e) => {
            if (sel.value === OTHER || !known.length) {
              state.rack = e.target.value;
              renderUPicker();
            }
          });
        }
        renderUPicker();
      }

      // Hardware only: preview next system tag (Network/Server uses manual tags).
      if (!infraMode && !isEdit) {
        api('/assets/next-tag').then((r) => {
          const inp = overlay.querySelector('#af-tag-preview');
          if (inp) inp.value = r.nextTag;
        }).catch(() => {});
      }

      function renderModel() {
        const models = modelsFor(state.category, state.brand);
        const mSlot = $('#af-model-slot', overlay);
        if (models.length === 0) {
          mSlot.innerHTML = `<input id="af-model-text" placeholder="${esc(t('asset.f.model'))}" value="${esc(state.model)}">`;
        } else {
          const known = models.includes(state.model);
          mSlot.innerHTML = `
            <select id="af-model">
              <option value="">Select model…</option>
              ${models.map((m) => `<option ${state.model === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
              <option value="${OTHER}" ${state.model && !known ? 'selected' : ''}>Other (type manually)…</option>
            </select>
            <input id="af-model-text" class="${state.model && !known ? '' : 'hidden'}" style="margin-top:6px" placeholder="${esc(t('asset.f.model'))}" value="${known ? '' : esc(state.model)}">`;
          $('#af-model', overlay).addEventListener('change', (e) => {
            const v = e.target.value;
            state.model = v === OTHER ? '' : v;
            $('#af-model-text', overlay).classList.toggle('hidden', v !== OTHER);
          });
        }
        const mt = $('#af-model-text', overlay);
        if (mt) mt.addEventListener('input', (e) => { state.model = e.target.value; });
      }

      function renderPickers() {
        const brands = brandsFor(state.category);
        const bSlot = $('#af-brand-slot', overlay);
        if (brands.length === 0) {
          bSlot.innerHTML = `<input id="af-brand-text" placeholder="${esc(t('asset.f.brand'))}" value="${esc(state.brand)}">`;
        } else {
          const known = brands.includes(state.brand);
          bSlot.innerHTML = `
            <select id="af-brand">
              <option value="">Select brand…</option>
              ${brands.map((b) => `<option ${state.brand === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
              <option value="${OTHER}" ${state.brand && !known ? 'selected' : ''}>Other (type manually)…</option>
            </select>
            <input id="af-brand-text" class="${state.brand && !known ? '' : 'hidden'}" style="margin-top:6px" placeholder="${esc(t('asset.f.brand'))}" value="${known ? '' : esc(state.brand)}">`;
          $('#af-brand', overlay).addEventListener('change', (e) => {
            const v = e.target.value;
            state.brand = v === OTHER ? '' : v;
            $('#af-brand-text', overlay).classList.toggle('hidden', v !== OTHER);
            state.model = '';
            renderModel();
          });
        }
        const bt = $('#af-brand-text', overlay);
        if (bt) bt.addEventListener('input', (e) => { state.brand = e.target.value; renderModel(); });
        renderModel();
      }

      $('#af-cat', overlay).addEventListener('change', (e) => {
        state.category = e.target.value;
        state.brand = ''; state.model = '';
        const otherInp = $('#af-cat-other', overlay);
        if (otherInp) {
          const show = state.category === 'Other';
          otherInp.classList.toggle('hidden', !show);
          if (show) {
            otherInp.focus();
          } else {
            state.customCategory = '';
            otherInp.value = '';
          }
        }
        renderPickers();
        applyFieldRules();
      });
      const catOther = $('#af-cat-other', overlay);
      if (catOther) {
        catOther.addEventListener('input', (e) => {
          state.customCategory = e.target.value;
        });
      }
      $('#af-location', overlay).addEventListener('change', () => {
        renderRackPicker();
        renderParentPicker();
      });
      const uSize = $('#af-u-size', overlay);
      if (uSize) {
        uSize.addEventListener('input', () => renderUPicker());
        uSize.addEventListener('change', () => renderUPicker());
      }
      renderPickers();
      applyFieldRules();

      api('/licenses').then((lics) => {
        const box = $('#af-licenses', overlay);
        const countEl = $('#af-lic-count', overlay);
        const qInp = $('#af-lic-q', overlay);
        if (!box) return;
        const all = lics || [];
        const cur = new Set(
          (asset && asset.licenseIds) ||
          (asset && asset.relatedLicenses && asset.relatedLicenses.map((l) => l.id)) ||
          (asset && asset.relatedLicense && asset.relatedLicense.id ? [asset.relatedLicense.id] : []) ||
          (asset && asset.licenseId ? [asset.licenseId] : [])
        );

        function updateCount() {
          if (!countEl) return;
          const n = box.querySelectorAll('input[name="licenseIds"]:checked').length;
          countEl.textContent = n ? ` · ${n} selected` : '';
        }

        function render(filter) {
          const term = (filter || '').trim().toLowerCase();
          const rows = all.filter((l) => {
            if (!term) return true;
            const hay = `${l.softwareName || ''} ${l.vendor || ''}`.toLowerCase();
            return hay.includes(term);
          });
          if (!all.length) {
            box.innerHTML = '<div class="af-license-empty">No licenses in catalog yet.</div>';
            return;
          }
          if (!rows.length) {
            box.innerHTML = '<div class="af-license-empty">No matching licenses.</div>';
            return;
          }
          box.innerHTML = rows.map((l) => `
            <label class="af-license-item${cur.has(l.id) ? ' on' : ''}">
              <input type="checkbox" name="licenseIds" value="${esc(l.id)}" ${cur.has(l.id) ? 'checked' : ''}>
              <span class="af-license-check" aria-hidden="true"><span class="ms">check</span></span>
              <span class="af-license-body">
                <span class="af-license-name">${esc(l.softwareName)}</span>
                ${l.vendor ? `<span class="af-license-meta">${esc(l.vendor)}</span>` : ''}
              </span>
              ${l.expirationDate ? `<span class="af-license-exp">${esc(fmtDate(l.expirationDate))}</span>` : ''}
            </label>`).join('');

          box.querySelectorAll('.af-license-item').forEach((lab) => {
            const inp = lab.querySelector('input');
            inp.addEventListener('change', () => {
              lab.classList.toggle('on', inp.checked);
              if (inp.checked) cur.add(inp.value);
              else cur.delete(inp.value);
              updateCount();
            });
          });
          updateCount();
        }

        render('');
        if (qInp) {
          qInp.addEventListener('input', () => render(qInp.value));
        }
      }).catch(() => {});

      let responsiblePicker = null;
      const respHost = $('#af-responsible-host', overlay);
      if (respHost) {
        const curEmp = asset && asset.responsibleEmployee
          ? { id: asset.responsibleEmployee.id, fullName: asset.responsibleEmployee.fullName }
          : null;
        responsiblePicker = mountEmployeeSearchField(respHost, {
          name: 'responsibleEmployeeId',
          selected: curEmp,
          required: true,
        });
      }

      api('/assets?categories=Network,Server&limit=2000').then((res) => {
        const list = (res && res.items) || [];
        infraDevices = list;
        racksByLocation.clear();
        list.forEach((p) => {
          const loc = (p.location || '').trim();
          const rack = (p.rack || '').trim();
          if (!loc || !rack) return;
          if (!racksByLocation.has(loc)) racksByLocation.set(loc, new Set());
          racksByLocation.get(loc).add(rack);
        });
        [...racksByLocation.entries()].forEach(([loc, set]) => {
          racksByLocation.set(loc, [...set].sort((a, b) => a.localeCompare(b)));
        });
        renderRackPicker();
        renderUPicker();

        renderParentPicker();
      }).catch(() => {});

      /** Selected parent ids — survives location filter rebuilds. */
      const selectedParentIds = new Set(
        (asset && asset.parentAssetIds && asset.parentAssetIds.length)
          ? asset.parentAssetIds
          : (asset && asset.parentAssets && asset.parentAssets.length)
            ? asset.parentAssets.map((x) => x.id)
            : (asset && (asset.parentAssetId || (asset.parentAsset && asset.parentAsset.id)))
              ? [asset.parentAssetId || asset.parentAsset.id]
              : []
      );

      function renderParentPicker() {
        const box = $('#af-parents', overlay);
        if (!box) return;
        const selfId = asset && asset.id;
        const loc = currentLocation();
        // Filter candidates by location when set; show all when cleared.
        let candidates = infraDevices.filter((p) => p.id !== selfId);
        if (loc) {
          candidates = candidates.filter((p) => (p.location || '') === loc);
          // Drop selections that are no longer at this location.
          [...selectedParentIds].forEach((id) => {
            if (!candidates.some((p) => p.id === id)) selectedParentIds.delete(id);
          });
        }
        if (!infraDevices.length) {
          box.innerHTML = '<div class="af-parent-empty">No other Network/Server devices yet.</div>';
          return;
        }
        if (loc && !candidates.length) {
          box.innerHTML = `<div class="af-parent-empty">No Network/Server devices at ${esc(loc)}.</div>`;
          return;
        }
        if (!candidates.length) {
          box.innerHTML = '<div class="af-parent-empty">No other Network/Server devices yet.</div>';
          return;
        }
        // Div rows (not <label>/<button>+input): pointerdown preventDefault
        // stops focus/scroll-into-view that was landing pointerup on the backdrop.
        box.innerHTML = candidates.map((p) => {
          const host = (p.specs && p.specs.hostname) ? ' · ' + p.specs.hostname : '';
          const role = p.infraRole ? ' · ' + p.infraRole : '';
          const on = selectedParentIds.has(p.id);
          const locHint = (!loc && p.location) ? ` · ${p.location}` : '';
          return `<div class="af-parent-item${on ? ' on' : ''}" role="checkbox" tabindex="0"
              aria-checked="${on ? 'true' : 'false'}" data-parent-id="${esc(p.id)}">
            <input type="checkbox" name="parentAssetIds" value="${esc(p.id)}" tabindex="-1"
              ${on ? 'checked' : ''} aria-hidden="true">
            <span class="af-parent-check" aria-hidden="true"><span class="ms">check</span></span>
            <span class="af-parent-body">
              <strong class="mono">${esc(p.assetTag)}</strong>
              <span class="cell-sub">${esc(p.brand)} ${esc(p.model)}${esc(role)}${esc(host)}${esc(locHint)}</span>
            </span>
          </div>`;
        }).join('');
        box.querySelectorAll('.af-parent-item').forEach((row) => {
          const inp = row.querySelector('input');
          const sync = () => {
            const checked = !!(inp && inp.checked);
            row.classList.toggle('on', checked);
            row.setAttribute('aria-checked', checked ? 'true' : 'false');
            const id = inp && inp.value;
            if (!id) return;
            if (checked) selectedParentIds.add(id);
            else selectedParentIds.delete(id);
          };
          const toggle = (e) => {
            e.preventDefault();
            if (!inp) return;
            inp.checked = !inp.checked;
            sync();
          };
          // Mouse/touch: preventDefault so the row is not focused → no sheet scroll.
          row.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'keyboard') e.preventDefault(); });
          row.addEventListener('click', toggle);
          row.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') toggle(e);
          });
        });
      }

      $('#af', overlay).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target.elements;
        const allowed = allowedFields();
        const take = (name) => (allowed.includes(name) ? f[name].value || null : null);
        let resolvedCategory = state.category;
        if (!infraMode && state.category === 'Other') {
          resolvedCategory = String(
            state.customCategory || ($('#af-cat-other', overlay) && $('#af-cat-other', overlay).value) || ''
          ).trim();
        }
        const body = {
          serialNumber: f.serialNumber.value.trim(),
          brand: state.brand.trim(),
          model: state.model.trim(),
          category: resolvedCategory,
          assetTag: (infraMode && !isEdit && f.assetTag)
            ? f.assetTag.value.trim()
            : undefined,
          purchaseDate: f.purchaseDate.value || null,
          cost: f.cost && f.cost.value !== '' ? Number(f.cost.value) : 0,
          salvageValue: f.salvageValue && f.salvageValue.value !== '' ? Number(f.salvageValue.value) : null,
          location: f.location.value || null,
          macEthernet: take('macEthernet'),
          macWifi: take('macWifi'),
          specs: {
            cpu: take('cpu'), ram: take('ram'), storage: take('storage'), os: take('os'),
            hostname: take('hostname'), ipAddress: take('ipAddress'),
          },
          notes: f.notes ? f.notes.value : '',
          licenseIds: allowed.includes('relatedLicense')
            ? [...overlay.querySelectorAll('input[name="licenseIds"]:checked')].map((c) => c.value)
            : [],
          responsibleEmployeeId: allowed.includes('responsible') && responsiblePicker
            ? responsiblePicker.getId()
            : (allowed.includes('responsible') && f.responsibleEmployeeId
              ? (f.responsibleEmployeeId.value || null) : undefined),
          infraRole: allowed.includes('infraRole') ? (f.infraRole.value || null) : null,
          rack: (() => {
            if (!allowed.includes('rack')) return null;
            const sel = $('#af-rack', overlay);
            const rt = $('#af-rack-text', overlay);
            if (sel && sel.value === OTHER) return (rt && rt.value.trim()) || null;
            if (sel && sel.value) return sel.value.trim();
            if (rt && !rt.classList.contains('hidden')) return rt.value.trim() || null;
            return (state.rack || '').trim() || null;
          })(),
          rackUStart: (() => {
            if (!allowed.includes('rackUStart')) return null;
            const sel = $('#af-u-start', overlay);
            if (sel && sel.value !== undefined) {
              return sel.value ? Number(sel.value) : null;
            }
            return state.rackUStart;
          })(),
          rackUSize: allowed.includes('rackUSize')
            ? (f.rackUSize && f.rackUSize.value
              ? Number(f.rackUSize.value)
              : (state.rackUStart != null ? 1 : null)) : null,
          mgmtIp: allowed.includes('mgmtIp') ? (f.mgmtIp.value.trim() || null) : null,
          firmwareVersion: allowed.includes('firmwareVersion') ? (f.firmwareVersion.value.trim() || null) : null,
          firmwareUpdatedAt: allowed.includes('firmwareUpdatedAt') ? (f.firmwareUpdatedAt.value || null) : null,
          warrantyEndDate: allowed.includes('warrantyEnd') ? (f.warrantyEndDate.value || null) : undefined,
          parentAssetIds: allowed.includes('parentDevice')
            ? [...overlay.querySelectorAll('input[name="parentAssetIds"]:checked')].map((c) => c.value)
            : undefined,
        };
        // Clear linked licenses / site owner / infra meta when switching away from Network/Server
        if (!allowed.includes('relatedLicense')) body.licenseIds = [];
        if (!allowed.includes('responsible')) body.responsibleEmployeeId = null;
        if (!allowed.includes('parentDevice')) body.parentAssetIds = [];
        try {
          if (!infraMode && state.category === 'Other') {
            if (!resolvedCategory) {
              throw new Error('Type a custom category name, or pick another category from the list');
            }
            if (HW_CATS.includes(resolvedCategory) && resolvedCategory !== 'Other') {
              body.category = resolvedCategory;
            } else {
              body.category = resolvedCategory.slice(0, 60);
            }
          }
          if (!body.brand || !body.model) {
            throw new Error('Brand and model are required — pick from the catalog or choose "Other" and type them');
          }
          if (infraMode || state.category === 'Network' || state.category === 'Server') {
            if (!isEdit && !body.assetTag) {
              throw new Error('Asset tag is required for Network/Server — enter it manually');
            }
            if (!body.location) throw new Error('Location is required for Network/Server equipment');
            if (responsiblePicker && !responsiblePicker.validate()) {
              throw new Error(t('network.ownerRequired') || 'Responsible person is required for Network/Server equipment');
            }
            if (!body.responsibleEmployeeId) {
              throw new Error(t('network.ownerRequired') || 'Responsible person is required for Network/Server equipment');
            }
            if (body.rack && body.rackUStart != null) {
              const size = body.rackUSize != null && body.rackUSize >= 1 ? body.rackUSize : 1;
              const occ = occupancyMap();
              const blockers = rangeBlockers(body.rackUStart, size, occ);
              const maxU = cabinetMaxU(occ, size);
              if (body.rackUStart + size - 1 > maxU) {
                blockers.push(`U${body.rackUStart + size - 1} (cabinet is ${maxU}U)`);
              }
              if (blockers.length) {
                throw new Error(
                  (typeof t === 'function' ? t('network.uClashSave') : '')
                  || 'This rack placement overlaps another device — pick free U units or reduce height.'
                );
              }
            }
          }
          // CPU / RAM / Storage are mandatory whenever the category uses them
          // (reports filter on these fields).
          for (const k of ['cpu', 'ram', 'storage']) {
            if (allowed.includes(k) && !body.specs[k]) {
              throw new Error(`${k.toUpperCase()} is required for ${state.category} — pick one from the list (manage lists in Product Catalog)`);
            }
          }
          let created;
          if (asset && asset.id) {
            const res = await api(`/assets/${asset.id}`, { method: 'PUT', body });
            // Sell/scrap can come back as 202 pendingApproval: nothing was saved,
            // so don't write custom fields or claim success for it.
            if (res && res.pendingApproval) {
              toast(t('asset.sentForApproval'), 'info');
              closeModal();
              done();
              return;
            }
            if (cfDefs.length) {
              await saveCustomFieldValues('asset', asset.id, collectCustomFieldValues(overlay, cfDefs));
            }
          } else {
            created = await api('/assets', { method: 'POST', body });
            if (cfDefs.length && created && created.id) {
              await saveCustomFieldValues('asset', created.id, collectCustomFieldValues(overlay, cfDefs));
            }
          }
          toast(
            isEdit
              ? 'Asset updated'
              : (infraMode
                ? `Device created — tag ${created.assetTag}`
                : `Asset created — tag ${created.assetTag} assigned automatically`),
            'success'
          );
          closeModal();
          done();
        } catch (err) {
          let msg = err.message;
          if (err.details && err.details.code === 'DUPLICATE_SERIAL') {
            msg = (typeof t === 'function' && t('assets.serialTaken')) || msg;
            if (err.details.assetTag) msg += ` (${err.details.assetTag})`;
          }
          toast(msg, 'error');
          const box = $('#af-error', overlay);
          if (box) box.innerHTML = '';
        }
      });
    },
  });
}

/* QR code modal — renders a scannable QR for the asset's qrCodeString. */
async function showQrModal(asset) {
  if (!asset) return;
  openModal({
    title: `QR — ${asset.assetTag}`,
    body: `
      <div style="text-align:center">
        <div id="qr-canvas-wrap" style="display:inline-block;background:#fff;padding:12px;border:1px solid var(--outline-variant);border-radius:8px">
          <div class="cell-sub">Generating…</div>
        </div>
        <div class="mono" style="margin-top:10px">${esc(asset.qrCodeString || '')}</div>
        <div class="cell-sub" style="margin-top:4px">${esc(asset.brand)} ${esc(asset.model)} · ${esc(asset.serialNumber)}</div>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>Close</button>
           <button class="btn btn-primary" id="qr-download" disabled><span class="ms">download</span> Download PNG</button>`,
    async onMount(overlay) {
      const wrap = $('#qr-canvas-wrap', overlay);
      try {
        // Generated server-side — no external library, works fully offline.
        const { dataUrl } = await api(`/assets/${asset.id}/qr`);
        wrap.innerHTML = `<img src="${esc(dataUrl)}" width="220" height="220" alt="QR">`;
        const dl = $('#qr-download', overlay);
        dl.disabled = false;
        dl.addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${asset.assetTag}-qr.png`;
          a.click();
        });
      } catch (err) {
        wrap.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      }
    },
  });
}

async function showAssetDetail(id, onChange) {
  if (!id) return;
  let x;
  let repairs;
  let repairDocs;
  let cfBundle;
  try {
    [x, repairs, repairDocs, cfBundle] = await Promise.all([
      api(`/assets/${id}`),
      api(`/maintenance?assetId=${encodeURIComponent(id)}`).catch(() => []), // Viewer role → 403 → []
      api(`/maintenance/asset/${encodeURIComponent(id)}/documents`).catch(() => []),
      fetchCustomFields('asset', id),
    ]);
  } catch (err) {
    toast((err && err.message) || t('hw.d.loadFail'), 'error');
    return;
  }
  if (!x) {
    toast(t('hw.d.notFound'), 'error');
    return;
  }
  const docsByLog = {};
  repairDocs.forEach((d) => { (docsByLog[d.maintenanceId] = docsByLog[d.maintenanceId] || []).push(d); });
  const s = x.specs || {};
  const canUpdate = Auth.canIam('asset', 'update') || Auth.canIam('asset', 'manage');
  const canCreate = Auth.canIam('asset', 'create');
  const canUnassign = Auth.canIam('asset', 'unassign') || Auth.canIam('asset', 'manage');
  const canRepair = Auth.canIam('maintenance', 'create');
  const canDownloadDocs = Auth.canIam('document', 'download') || Auth.can('canDownloadDocuments');
  const refresh = () => { if (onChange) onChange(); };
  const isInfra = x.category === 'Network' || x.category === 'Server';
  const life = lifecycleInfo(x);
  const licenses = (x.relatedLicenses && x.relatedLicenses.length)
    ? x.relatedLicenses
    : (x.relatedLicense ? [x.relatedLicense] : []);
  const rackLine = (() => {
    const p = typeof NetViz !== 'undefined' ? NetViz.rackPlacement(x) : { start: x.rackUStart, size: x.rackUSize || 1 };
    const u = p.start != null
      ? ('U' + p.start + (p.size > 1 ? '-' + (p.start + p.size - 1) : ''))
      : (x.rackUnit || '');
    return [x.rack, u].filter(Boolean).join(' · ');
  })();
  const specBits = [s.cpu, s.ram, s.storage, s.os].filter(Boolean);
  const hasInfraMeta = !!(x.infraRole || rackLine || x.firmwareVersion || x.parentAsset || (x.parentAssets && x.parentAssets.length) || x.mgmtIp);

  const kv = (label, valueHtml, { full = false, skipEmpty = true } = {}) => {
    if (skipEmpty && (valueHtml == null || valueHtml === '' || valueHtml === '—')) return '';
    return `<div class="ad-kv${full ? ' full' : ''}"><span class="ad-k">${esc(label)}</span><div class="ad-v">${valueHtml}</div></div>`;
  };
  const kvText = (label, text, opts = {}) => {
    const t0 = text == null ? '' : String(text).trim();
    if (!t0 || t0 === '—' || t0 === 'N/A') return kv(label, '', opts);
    return kv(label, `<span class="${opts.mono ? 'mono' : ''}">${esc(t0)}</span>`, opts);
  };
  const sec = (title, sub, inner) => {
    if (!inner || !String(inner).trim()) return '';
    return `<section class="ad-sec">
      <div class="ad-sec-head"><strong>${esc(title)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      <div class="ad-kv-grid">${inner}</div>
    </section>`;
  };

  const lifeHtml = (() => {
    if (life.excluded) {
      return `<div class="ad-life muted"><span class="ms">timelapse</span> ${esc(t('hw.d.eolOff'))}</div>`;
    }
    if (!life.eol) {
      return `<div class="ad-life muted"><span class="ms">timelapse</span> ${esc((t('hw.d.monthsNoPurchase') || '{n} months · no purchase date').replace('{n}', String(life.months)))}</div>`;
    }
    const pct = Math.min(Math.max(life.pct || 0, 0), 100);
    const tone = life.overdue ? 'overdue' : (pct >= 80 ? 'warn' : 'ok');
    return `<div class="ad-life ${tone}">
      <div class="ad-life-top">
        <span><span class="ms">timelapse</span> ${esc((t('hw.d.lifecycle') || 'Lifecycle · {n} mo').replace('{n}', String(life.months)))}</span>
        <span>${life.overdue ? esc(t('hw.d.replaceDue')) : `EOL ${esc(fmtDate(life.eol))}`} · ${pct}%</span>
      </div>
      <div class="ad-life-bar"><i style="width:${pct}%"></i></div>
    </div>`;
  })();

  const serialCopyBtn = (val) => `<button type="button" class="ad-copy" data-copy="${esc(val)}" title="${esc(t('common.copy'))}" aria-label="${esc(t('common.copy'))}"><span class="ms ms-sm">content_copy</span></button>`;
  const overviewHtml = [
    (x.serialNumber && String(x.serialNumber).trim() && String(x.serialNumber).trim() !== '—')
      ? kv(t('hw.d.serial'), `<span class="mono">${esc(String(x.serialNumber).trim())}</span>${serialCopyBtn(String(x.serialNumber).trim())}`)
      : kvText(t('hw.d.serial'), x.serialNumber, { mono: true }),
    kvText(t('asset.f.category'), x.category),
    kvText(t('asset.f.location'), x.location),
    kv(t('asset.f.purchaseDate'), x.purchaseDate ? esc(fmtDate(x.purchaseDate)) : ''),
    kv(t('asset.f.purchaseCost'), Number(x.cost) > 0 ? esc(fmtMoney(x.cost)) : ''),
    kv(t('hw.d.bookValue'), x.bookValue != null
      ? `${esc(fmtMoney(x.bookValue))} <span class="ad-empty">${esc((t('hw.d.deprSuffix') || '({pct}% depreciated)').replace('{pct}', x.depreciationPct))}</span>`
      : ''),
    kv(t('asset.f.warrantyEnds'), x.warrantyEndDate ? esc(fmtDate(x.warrantyEndDate)) : ''),
    isInfra
      ? ''
      : kv(t('hw.d.assignedTo'), x.currentEmployee
        ? esc(x.currentEmployee.fullName)
        : `<span class="ad-empty">${esc(t('dash.unassigned'))}</span>`, { skipEmpty: false }),
    isInfra
      ? kv(t('hw.d.responsible'), x.responsibleEmployee
        ? esc(x.responsibleEmployee.fullName)
        : `<span class="ad-empty">${esc(t('hw.d.notSet'))}</span>`, { skipEmpty: false })
      : kvText(t('hw.d.responsible'), x.responsibleEmployee && x.responsibleEmployee.fullName),
  ].join('');

  const specsHtml = [
    specBits.length
      ? kv(t('hw.d.hardware'), `<div class="ad-chips">${specBits.map((b) => `<span class="ad-chip">${esc(b)}</span>`).join('')}</div>`, { full: true, skipEmpty: false })
      : '',
    kvText('MAC Ethernet', x.macEthernet, { mono: true }),
    kvText('MAC Wi-Fi', x.macWifi, { mono: true }),
    kvText(t('asset.f.hostname'), s.hostname, { mono: true }),
    kvText(t('asset.f.ipAddress'), s.ipAddress, { mono: true }),
  ].join('');

  const infraHtml = !isInfra && !hasInfraMeta ? '' : [
    kvText(t('hw.d.role'), x.infraRole),
    kvText(t('hw.d.rackU'), rackLine),
    kvText(t('hw.d.mgmtIp'), x.mgmtIp, { mono: true }),
    kv(t('hw.d.firmware'), x.firmwareVersion
      ? `${esc(x.firmwareVersion)}${x.firmwareUpdatedAt ? ` <span class="cell-sub">· ${esc(fmtDate(x.firmwareUpdatedAt))}</span>` : ''}`
      : ''),
    kv(t('asset.f.parents'), (() => {
      const parents = (x.parentAssets && x.parentAssets.length)
        ? x.parentAssets
        : (x.parentAsset ? [x.parentAsset] : []);
      if (!parents.length) return '';
      return parents.map((pa) =>
        `<a href="#/network?view=topo&search=${encodeURIComponent(pa.assetTag)}">${esc(pa.assetTag)}</a>
         <span class="cell-sub"> · ${esc(pa.brand || '')} ${esc(pa.model || '')}</span>`
      ).join('<br>');
    })()),
  ].join('');

  const licenseHtml = licenses.length
    ? licenses.map((l) =>
      `<div class="ad-lic"><strong>${esc(l.softwareName)}</strong>
        <span class="cell-sub">${esc((t('hw.d.expires') || 'expires {date}').replace('{date}', fmtDate(l.expirationDate)))}</span></div>`).join('')
    : '';

  const cfHtml = (cfBundle.defs || []).map((d) => {
    const v = (cfBundle.values || {})[d.fieldKey];
    if (v == null || String(v).trim() === '') return '';
    return kvText(d.label, v);
  }).join('');

  const historyHtml = !(x.history || []).length
    ? `<div class="ad-empty-block">${esc(t('hw.d.noHistory'))}</div>`
    : x.history.map((h) => {
      const who = h.employeeName
        ? (h.actionType === 'returned' ? `${esc(t('hw.d.from'))} <strong>${esc(h.employeeName)}</strong>`
          : h.actionType === 'assigned' ? `${esc(t('hw.d.to'))} <strong>${esc(h.employeeName)}</strong>`
          : (h.actionType === 'placed' || h.actionType === 'responsible_changed' || h.actionType === 'created')
            ? `${esc(t('hw.d.owner'))} <strong>${esc(h.employeeName)}</strong>`
          : `${esc(t('hw.d.whileAt'))} <strong>${esc(h.employeeName)}</strong>`)
        : '';
      return `
        <div class="ad-timeline-item">
          <div class="ad-timeline-when">${esc(fmtDateTime(h.timestamp))}</div>
          <div class="ad-timeline-body">
            ${badge(h.actionType)}
            <span>${who}</span>
            <span class="cell-sub">${esc(t('common.by'))} ${esc(h.changedByName || h.changedBy || '—')}</span>
            ${h.notes ? `<div class="cell-sub ad-timeline-note">${esc(h.notes)}</div>` : ''}
          </div>
        </div>`;
    }).join('');

  const repairHtml = !repairs.length
    ? `<div class="ad-empty-block">${esc(t('hw.d.noRepairs'))}</div>`
    : repairs.map((m) => {
      const notes = (m.progressNotes || []).map((n) => (typeof n === 'string' ? n : n.note)).filter(Boolean);
      return `
        <div class="ad-timeline-item">
          <div class="ad-timeline-when">${esc(fmtDate(m.sentDate))}${m.returnDate ? ' → ' + esc(fmtDate(m.returnDate)) : ''}</div>
          <div class="ad-timeline-body">
            <span class="pill ${m.returnDate ? 'pill-emerald' : 'pill-amber'}">${m.returnDate ? esc(t('hw.d.repaired')) : esc(t('hw.d.inRepair'))}</span>
            <strong>${esc(m.serviceCompany)}</strong>
            <span class="cell-sub">${esc(m.issueDescription)}</span>
            <span class="cell-sub" style="margin-left:auto">${esc(t('hw.d.cost'))}: <strong>${fmtMoney(m.cost || 0)}</strong></span>
            ${m.resolutionNote ? `<div class="cell-sub ad-timeline-note">${esc(t('hw.d.resolution'))}: ${esc(m.resolutionNote)}</div>` : ''}
            ${notes.length ? `<div class="cell-sub ad-timeline-note">${esc(t('hw.d.notesLbl'))}: ${notes.map((n) => esc(n)).join(' · ')}</div>` : ''}
            ${(docsByLog[m.id] || []).length ? `<div class="cell-sub ad-timeline-note">
              <span class="ms ms-sm">attach_file</span> ${docInlineLinks(docsByLog[m.id], { canDownload: canDownloadDocs, viewAttr: 'data-mdoc-dl' })}</div>` : ''}
          </div>
        </div>`;
    }).join('');

  openModal({
    title: `${x.assetTag} — ${x.brand} ${x.model}`,
    wide: true,
    body: `
      <div class="ad-detail">
        <header class="ad-hero">
          <span class="ad-hero-icon"><span class="ms">${esc(catIcon(x.category))}</span></span>
          <div class="ad-hero-main">
            <div class="ad-hero-tag mono">${esc(x.assetTag)}</div>
            <div class="ad-hero-title">${esc(x.brand)} ${esc(x.model)}</div>
            <div class="ad-hero-meta">
              <span>${esc(x.category)}</span>
              ${x.location ? `<span>·</span><span>${esc(x.location)}</span>` : ''}
              ${x.serialNumber ? `<span>·</span><span class="mono">${esc(x.serialNumber)}</span>` : ''}
            </div>
          </div>
          <div class="ad-hero-status">${badge(x.status)}</div>
        </header>
        ${lifeHtml}
        ${sec(t('hw.d.secOverview'), null, overviewHtml)}
        ${sec(t('hw.d.secSpecs'), null, specsHtml)}
        ${sec(t('asset.f.secInfra'), null, infraHtml)}
        ${licenseHtml ? `<section class="ad-sec"><div class="ad-sec-head"><strong>${esc(t('hw.d.secLicenses'))}</strong></div><div class="ad-lic-list">${licenseHtml}</div></section>` : ''}
        ${String(x.notes || '').trim() ? `<section class="ad-sec"><div class="ad-sec-head"><strong>${esc(t('hw.d.secNote'))}</strong></div>
          <div class="ad-note"><span class="ms">sticky_note_2</span> ${esc(String(x.notes).trim())}</div></section>` : ''}
        ${cfHtml ? sec(t('hw.d.secCustom'), null, cfHtml) : ''}
        <section class="ad-sec">
          <div class="ad-sec-head"><strong>${esc(t('common.history'))}</strong><span>${esc(t('hw.d.historySub'))}</span></div>
          <div class="ad-timeline">${historyHtml}</div>
        </section>
        <section class="ad-sec">
          <div class="ad-sec-head"><strong>${esc(t('hw.d.secRepair'))}</strong><span>${repairs.length}</span></div>
          <div class="ad-timeline">${repairHtml}</div>
        </section>
      </div>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
      <button class="btn btn-outline" id="ad-qr"><span class="ms">qr_code_2</span> QR</button>
      <button class="btn btn-outline" id="ad-label"><span class="ms">barcode</span> ${esc(t('hw.d.label'))}</button>
      ${canUpdate ? `<button class="btn btn-outline" id="ad-edit"><span class="ms">edit</span> ${esc(t('common.edit'))}</button>` : ''}
      ${canCreate ? `<button class="btn btn-outline" id="ad-duplicate"><span class="ms">content_copy</span> ${esc(t('common.duplicate'))}</button>` : ''}
      ${canUnassign && !isInfra && x.status === 'Assigned' ? `<button class="btn btn-outline" id="ad-return"><span class="ms">undo</span> ${esc(t('common.return'))}</button>` : ''}
      ${canRepair && (x.status === 'In Stock' || x.status === 'Assigned') ? `<button class="btn btn-primary" id="ad-repair"><span class="ms">build</span> ${esc(t('common.repair'))}</button>` : ''}
      ${canUpdate && isInfra
        ? `<button class="btn btn-primary" id="ad-responsible"><span class="ms">person_search</span> ${esc(t('network.setResponsible') || 'Set responsible')}</button>`
        : ''}
      ${Auth.canIam('handover', 'create') && !isInfra && x.status === 'In Stock'
        ? `<button class="btn btn-primary" id="ad-handover"><span class="ms">assignment_turned_in</span> ${esc(t('hw.d.handover'))}</button>`
        : ''}`,
    onMount(overlay) {
      // Small copy buttons (e.g. next to the serial number) → copy to clipboard.
      overlay.querySelectorAll('.ad-copy[data-copy]').forEach((btn) => btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const val = btn.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(val);
          const prev = btn.innerHTML;
          btn.classList.add('ok');
          btn.innerHTML = '<span class="ms ms-sm">check</span>';
          toast(t('common.copied'), 'success');
          setTimeout(() => { btn.innerHTML = prev; btn.classList.remove('ok'); }, 1200);
        } catch { toast(t('common.copy') + ' ✗', 'error'); }
      }));
      $('#ad-qr', overlay).addEventListener('click', () => showQrModal(x));
      $('#ad-label', overlay).addEventListener('click', () => printAssetLabels([x]));
      // Attached repair paperwork: click → view inline in a new tab.
      overlay.querySelectorAll('[data-mdoc-dl]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        viewAuthed(`/api/maintenance/documents/${a.dataset.mdocDl}/download`);
      }));
      const adHo = $('#ad-handover', overlay);
      if (adHo) adHo.addEventListener('click', () => { closeModal(); location.hash = '#/handover'; });
      const adResp = $('#ad-responsible', overlay);
      if (adResp) adResp.addEventListener('click', () => formModal({
        title: `${t('network.setResponsible') || 'Set responsible'} — ${x.assetTag}`,
        fields: [{
          name: 'responsibleEmployeeId',
          label: t('network.responsibleHint') || 'Who to contact in an emergency *',
          type: 'employeeSearch',
          required: true,
          selected: x.responsibleEmployee || null,
          selectedLabel: x.responsibleEmployee ? x.responsibleEmployee.fullName : '',
          full: true,
        }],
        submitLabel: t('common.save') || 'Save',
        async onSubmit(d) {
          if (!d.responsibleEmployeeId) {
            throw new Error(t('network.ownerRequired') || 'Responsible person is required');
          }
          await api(`/assets/${x.id}`, {
            method: 'PUT',
            body: { responsibleEmployeeId: d.responsibleEmployeeId },
          });
          toast(t('network.responsibleSaved') || 'Responsible person updated', 'success');
          refresh();
          showAssetDetail(id, onChange);
        },
      }));
      const adEdit = $('#ad-edit', overlay);
      if (adEdit) adEdit.addEventListener('click', () => assetForm(x, () => { refresh(); showAssetDetail(id, onChange); }));
      const adDup = $('#ad-duplicate', overlay);
      if (adDup) adDup.addEventListener('click', () => assetForm(duplicateAssetSeed(x), () => refresh()));
      const adReturn = $('#ad-return', overlay);
      if (adReturn) adReturn.addEventListener('click', () => formModal({
        title: (t('hw.d.returnTitle') || 'Return {tag} to stock').replace('{tag}', x.assetTag),
        fields: [{ name: 'conditionNote', label: t('hw.d.conditionNote'), type: 'textarea', full: true }],
        submitLabel: t('hw.d.returnToStock'),
        async onSubmit(d) {
          await api(`/assets/${x.id}/return`, { method: 'POST', body: d });
          toast((t('hw.d.returnedToast') || '{tag} returned to stock').replace('{tag}', x.assetTag), 'success');
          refresh();
          showAssetDetail(id, onChange);
        },
      }));
      const adRepair = $('#ad-repair', overlay);
      if (adRepair) adRepair.addEventListener('click', () => formModal({
        title: `Send ${x.assetTag} to repair`,
        // Cost is entered later when the repair is closed (it isn't known yet).
        fields: [
          { name: 'serviceCompany', label: 'Service company *', required: true },
          { name: 'issueDescription', label: 'Issue description *', type: 'textarea', required: true, full: true },
        ],
        submitLabel: 'Send to repair',
        async onSubmit(d) {
          await api('/maintenance', { method: 'POST', body: { ...d, assetId: x.id } });
          toast(`${x.assetTag} sent to repair`, 'success');
          refresh();
          showAssetDetail(id, onChange);
        },
      }));
    },
  });
}
