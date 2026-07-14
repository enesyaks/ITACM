/*
 * Network & Server Equipment — list, dependency topology, and rack cabinets.
 * Personal zimmet handover is intentionally excluded.
 */
'use strict';

const INFRA_ROLES = [
  'Switch', 'Firewall', 'Access Point', 'Router', 'Load Balancer',
  'Hypervisor', 'Physical Server', 'Storage', 'Appliance', 'Other',
];

const UNASSIGNED_OWNER = '__none__';
const UNPLACED_LOC = '__unplaced__';

Views.network = async function (el, params = {}) {
  if (isStaleView(el)) return;
  const canEdit = Auth.can('canManageAssets');
  const INFRA = ['Network', 'Server'];
  const STATUSES = ['In Stock', 'Assigned', 'In Repair', 'Scrap'];
  const view = ['list', 'topo', 'racks'].includes(params.view) ? params.view : 'list';
  const locationCatalog = AppConfig.locations || [];

  const selectedStatus = csvList(params.status).filter((s) => STATUSES.includes(s));
  const selectedCats = csvList(params.category).filter((c) => INFRA.includes(c));
  const selectedRoles = csvList(params.role).filter((r) => INFRA_ROLES.includes(r));
  let selectedLocs = csvList(params.location).filter((l) => l === UNPLACED_LOC || locationCatalog.includes(l));
  if (params.alert === 'unplaced') {
    selectedLocs = [...new Set([...selectedLocs, UNPLACED_LOC])];
  }
  const apiLocs = selectedLocs.filter((l) => l !== UNPLACED_LOC);

  const q = new URLSearchParams();
  q.set('categories', (selectedCats.length ? selectedCats : INFRA).join(','));
  q.set('limit', '2000');
  if (selectedStatus.length) q.set('status', selectedStatus.join(','));
  // When Unplaced is selected alone (or with real sites), fetch all locations and filter client-side.
  // Only push location to API when Unplaced is NOT part of the selection.
  if (apiLocs.length && !selectedLocs.includes(UNPLACED_LOC)) q.set('location', apiLocs.join(','));
  if (params.search) q.set('search', params.search);
  if (selectedRoles.length) q.set('infraRole', selectedRoles.join(','));

  const [{ items: raw }, empsRes] = await Promise.all([
    api('/assets?' + q.toString()),
    api('/employees?status=Active&limit=500').catch(() => ({ items: [] })),
  ]);
  if (isStaleView(el)) return;

  const employees = employeeList(empsRes).items;
  const assetItems = raw || [];
  const ownerOptions = buildOwnerOptions(assetItems);
  const validOwnerIds = new Set(ownerOptions.map((o) => o.value));
  const selectedOwners = csvList(params.responsible).filter((id) => validOwnerIds.has(id));

  let items = assetItems;
  items = filterByLocation(items, selectedLocs);
  items = filterByOwner(items, selectedOwners);

  if (params.alert === 'eol') {
    items = items.filter((x) => lifecycleInfo(x).overdue && x.status !== 'Scrap');
  } else if (params.alert === 'eolSoon') {
    items = items.filter((x) => {
      const l = lifecycleInfo(x);
      return !l.overdue && l.pct != null && l.pct >= 90 && x.status !== 'Scrap';
    });
  } else if (params.alert === 'licSoon') {
    items = items.filter((x) => assetLicenses(x).some((l) => {
      const exp = licenseExpInfo(l);
      return exp && exp.days <= 60;
    }));
  } else if (params.alert === 'warrantySoon') {
    items = items.filter((x) => {
      const w = dateDaysInfo(x.warrantyEndDate);
      return w && w.days <= 90;
    });
  }

  const pastEol = assetItems.filter((x) => lifecycleInfo(x).overdue && x.status !== 'Scrap').length;
  const warrantySoon = assetItems.filter((x) => {
    const w = dateDaysInfo(x.warrantyEndDate);
    return w && w.days <= 90 && x.status !== 'Scrap';
  }).length;
  const unplaced = assetItems.filter((x) => !x.location || !x.responsibleEmployee).length;

  const chips = [];
  selectedStatus.forEach((s) => chips.push({ key: 'status', value: s, label: `Status: ${s}` }));
  selectedCats.forEach((c) => chips.push({ key: 'category', value: c, label: `Type: ${c}` }));
  selectedRoles.forEach((r) => chips.push({ key: 'role', value: r, label: `Role: ${r}` }));
  selectedLocs.forEach((l) => chips.push({
    key: 'location',
    value: l,
    label: l === UNPLACED_LOC ? t('network.unplaced') : `Location: ${l}`,
  }));
  selectedOwners.forEach((id) => {
    chips.push({ key: 'responsible', value: id, label: `Owner: ${ownerLabel(id, ownerOptions)}` });
  });
  if (params.alert === 'eol') chips.push({ key: 'alert', label: 'Past EOL' });
  if (params.alert === 'eolSoon') chips.push({ key: 'alert', label: 'EOL soon' });
  if (params.alert === 'licSoon') chips.push({ key: 'alert', label: 'License ≤60d' });
  if (params.alert === 'warrantySoon') chips.push({ key: 'alert', label: t('network.warrantySoon') });
  if (params.search) chips.push({ key: 'search', label: `Search: ${params.search}` });

  const setHash = (next) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([k, v]) => { if (v) p.set(k, v); });
    const qs = p.toString();
    location.hash = '#/network' + (qs ? '?' + qs : '');
  };

  const cur = () => ({
    search: params.search || '',
    status: selectedStatus.join(','),
    category: selectedCats.join(','),
    role: selectedRoles.join(','),
    location: selectedLocs.join(','),
    responsible: selectedOwners.join(','),
    alert: params.alert && params.alert !== 'unplaced' ? params.alert : '',
    view,
  });

  el.innerHTML = `
    ${pageHead('nav.network', 'network.sub', `
      <button class="btn btn-outline" id="net-export"><span class="ms">download</span> ${esc(t('common.export'))}</button>
      ${canEdit ? `<button class="btn btn-primary" id="net-new"><span class="ms">add</span> ${esc(t('network.addDevice'))}</button>` : ''}`)}

    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('network.total'))}</h3>${iconChip('dns', 'indigo')}</div>
        <div class="metric-value">${assetItems.length.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric" style="cursor:pointer" id="net-m-unplaced">
        <div class="metric-top"><h3 class="card-title">${esc(t('network.needsPlacement'))}</h3>${iconChip('location_off', unplaced ? 'amber' : 'emerald')}</div>
        <div class="metric-value">${unplaced.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric" style="cursor:pointer" id="net-m-eol">
        <div class="metric-top"><h3 class="card-title">${esc(t('network.pastEol'))}</h3>${iconChip('event_busy', 'rose')}</div>
        <div class="metric-value">${pastEol.toLocaleString()}</div>
      </div>
      <div class="card card-pad metric" style="cursor:pointer" id="net-m-warranty">
        <div class="metric-top"><h3 class="card-title">${esc(t('network.warrantySoon'))}</h3>${iconChip('verified_user', warrantySoon ? 'amber' : 'emerald')}</div>
        <div class="metric-value">${warrantySoon.toLocaleString()}</div>
      </div>
    </div>

    <p class="cell-sub" style="margin:-8px 0 16px">${esc(t('network.flowHint'))}
      <span class="ob-hint"> · Asset tags are entered manually (not auto IT-xxxx).</span></p>

    <div class="tabs" id="net-views" role="tablist">
      <button type="button" class="tab ${view === 'list' ? 'active' : ''}" data-view="list" role="tab">
        <span class="ms">table_rows</span> ${esc(t('network.viewList'))}</button>
      <button type="button" class="tab ${view === 'topo' ? 'active' : ''}" data-view="topo" role="tab">
        <span class="ms">hub</span> ${esc(t('network.viewTopo'))}</button>
      <button type="button" class="tab ${view === 'racks' ? 'active' : ''}" data-view="racks" role="tab">
        <span class="ms">view_column</span> ${esc(t('network.viewRacks'))}</button>
    </div>

    <div class="toolbar" id="net-filters">
      <div class="search-box"><span class="ms">search</span>
        <input type="search" id="net-search" placeholder="${esc(t('network.searchPh'))}" value="${esc(params.search || '')}"></div>
      ${multiSelectHtml({
        id: 'status',
        allLabel: t('network.allStatuses'),
        selected: selectedStatus,
        options: STATUSES.map((s) => ({ value: s, label: s })),
      })}
      ${multiSelectHtml({
        id: 'category',
        allLabel: t('network.allTypes'),
        selected: selectedCats,
        options: INFRA.map((c) => ({ value: c, label: c })),
      })}
      ${multiSelectHtml({
        id: 'role',
        allLabel: t('network.allRoles'),
        selected: selectedRoles,
        options: INFRA_ROLES.map((r) => ({ value: r, label: r })),
      })}
      ${multiSelectHtml({
        id: 'location',
        allLabel: t('network.allLocations'),
        selected: selectedLocs,
        options: [
          { value: UNPLACED_LOC, label: t('network.unplaced') },
          ...locationCatalog.map((l) => ({ value: l, label: l })),
        ],
      })}
      ${multiSelectHtml({
        id: 'responsible',
        allLabel: t('network.allOwners'),
        selected: selectedOwners,
        options: ownerOptions,
      })}
    </div>
    ${chips.length ? `<div class="filter-chips"><strong>Active Filters:</strong>
      ${chips.map((c) => `<span class="chip">${esc(c.label)}
        <button type="button" data-clear="${esc(c.key)}" ${c.value != null ? `data-clear-val="${esc(c.value)}"` : ''}><span class="ms">close</span></button></span>`).join('')}
      <a href="#/network">Clear All</a></div>` : ''}

    <div id="bulk-bar-slot"></div>
    <div id="net-panel"></div>`;

  const panel = $('#net-panel', el);
  const refresh = () => Views.network(el, params);
  const openDevice = (id) => showAssetDetail(id, refresh);

  if (view === 'topo') {
    NetViz.renderTopology(panel, items, { onSelect: openDevice });
  } else if (view === 'racks') {
    NetViz.renderRacks(panel, items, { onSelect: openDevice });
  } else {
    panel.innerHTML = renderListTable(items, canEdit);
    mountNetworkBulk(el, items, refresh, canEdit);
  }

  bindDebouncedSearch($('#net-search', el), {
    getValue: () => params.search || '',
    apply: (search) => setHash({ ...cur(), search }),
  });

  mountMultiSelects($('#net-filters', el), {
    status: (vals) => setHash({ ...cur(), status: vals.join(',') }),
    category: (vals) => setHash({ ...cur(), category: vals.join(',') }),
    role: (vals) => setHash({ ...cur(), role: vals.join(',') }),
    location: (vals) => setHash({ ...cur(), location: vals.join(','), alert: '' }),
    responsible: (vals) => setHash({ ...cur(), responsible: vals.join(',') }),
  });

  $('#net-m-unplaced', el).addEventListener('click', () => setHash({
    ...cur(), location: UNPLACED_LOC, alert: '', view: 'list',
  }));
  $('#net-m-eol', el).addEventListener('click', () => setHash({ ...cur(), alert: 'eol', view: 'list' }));
  $('#net-m-warranty', el).addEventListener('click', () => setHash({ ...cur(), alert: 'warrantySoon', view: 'list' }));

  $('#net-export', el).addEventListener('click', () => {
    if (!items.length) {
      toast(t('network.exportEmpty') || 'Nothing to export with the current filters', 'error');
      return;
    }
    exportNetworkCsv(items);
    toast(`${items.length} ${t('network.exportDone') || 'row(s) exported'}`, 'success');
  });

  el.querySelectorAll('#net-views [data-view]').forEach((b) => {
    b.addEventListener('click', () => setHash({ ...cur(), view: b.dataset.view }));
  });

  el.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    const next = cur();
    const key = b.dataset.clear;
    const val = b.dataset.clearVal;
    if (val != null && ['status', 'category', 'role', 'location', 'responsible'].includes(key)) {
      next[key] = csvList(next[key]).filter((x) => x !== val).join(',');
    } else {
      next[key] = '';
    }
    setHash(next);
  }));

  if (canEdit) {
    $('#net-new', el).addEventListener('click', () => {
      assetForm({ category: 'Network' }, refresh);
    });
  }

  bindView(el, async (e) => {
    if (e.target.closest('input[type="checkbox"]')) return;
    if (e.target.closest('.msel')) return;
    const openId = e.target.closest('[data-open]')?.dataset.open;
    const btn = e.target.closest('button');
    if (btn?.dataset.place && canEdit) {
      const device = assetItems.find((x) => x.id === btn.dataset.place);
      if (device) openPlacementModal(device, employees, refresh);
      return;
    }
    if (btn?.dataset.view || (!btn && openId)) {
      showAssetDetail(btn?.dataset.view || openId, refresh);
      return;
    }
    if (btn?.dataset.edit && canEdit) {
      try {
        const full = await api('/assets/' + btn.dataset.edit);
        assetForm(full, refresh);
      } catch (err) { toast(err.message, 'error'); }
    }
  });
};

function exportNetworkCsv(items) {
  const cols = [
    'Asset Tag', 'Brand', 'Model', 'Category', 'Role', 'Status',
    'Hostname', 'IP', 'Mgmt IP', 'MAC Ethernet', 'MAC Wi-Fi',
    'Rack', 'Firmware', 'Firmware Updated', 'Warranty End',
    'Location', 'Responsible', 'Parent Tag',
    'Linked Licenses', 'Serial', 'Notes',
  ];
  const rows = (items || []).map((x) => {
    const s = x.specs || {};
    const lics = assetLicenses(x).map((l) => l.softwareName).filter(Boolean).join(' | ');
    return [
      x.assetTag,
      x.brand,
      x.model,
      x.category,
      x.infraRole || '',
      x.status,
      s.hostname || '',
      s.ipAddress || '',
      x.mgmtIp || '',
      x.macEthernet || '',
      x.macWifi || '',
      rackLabel(x) || '',
      x.firmwareVersion || '',
      x.firmwareUpdatedAt ? fmtDate(x.firmwareUpdatedAt) : '',
      x.warrantyEndDate ? fmtDate(x.warrantyEndDate) : '',
      x.location || '',
      x.responsibleEmployee ? x.responsibleEmployee.fullName : '',
      x.parentAsset ? x.parentAsset.assetTag : '',
      lics,
      x.serialNumber || '',
      x.notes || '',
    ];
  });
  const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  // BOM + semicolon so Excel (TR/EU) opens UTF-8 correctly.
  const csv = '\uFEFF' + [cols, ...rows].map((r) => r.map(csvEsc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `network-server-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function buildOwnerOptions(items) {
  const map = new Map();
  let hasUnassigned = false;
  for (const x of items || []) {
    if (x.responsibleEmployee?.id) {
      map.set(x.responsibleEmployee.id, x.responsibleEmployee.fullName);
    } else {
      hasUnassigned = true;
    }
  }
  const options = [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  if (hasUnassigned) {
    options.unshift({ value: UNASSIGNED_OWNER, label: t('network.unassigned') });
  }
  return options;
}

function ownerLabel(id, ownerOptions) {
  if (id === UNASSIGNED_OWNER) return t('network.unassigned');
  return ownerOptions.find((o) => o.value === id)?.label || id;
}

function filterByOwner(items, selectedOwners) {
  if (!selectedOwners.length) return items;
  return items.filter((x) => {
    const id = x.responsibleEmployee?.id;
    if (!id) return selectedOwners.includes(UNASSIGNED_OWNER);
    return selectedOwners.includes(id);
  });
}

function filterByLocation(items, selectedLocs) {
  if (!selectedLocs.length) return items;
  const wantUnplaced = selectedLocs.includes(UNPLACED_LOC);
  const sites = selectedLocs.filter((l) => l !== UNPLACED_LOC);
  return items.filter((x) => {
    const isUnplaced = !x.location || !x.responsibleEmployee;
    if (wantUnplaced && isUnplaced) return true;
    if (sites.length && x.location && sites.includes(x.location)) return true;
    return false;
  });
}

function assetLicenses(x) {
  if (x.relatedLicenses && x.relatedLicenses.length) return x.relatedLicenses;
  if (x.relatedLicense) return [x.relatedLicense];
  return [];
}

function rackLabel(x) {
  const p = NetViz.rackPlacement(x);
  if (!x.rack && p.start == null) return '';
  const u = p.start != null
    ? ('U' + p.start + (p.size > 1 ? '-' + (p.start + p.size - 1) : ''))
    : (x.rackUnit ? 'U' + x.rackUnit : '');
  return [x.rack, u].filter(Boolean).join(' · ');
}

function renderListTable(items, canEdit) {
  /* Dense list: warranty / EOL / license live on the detail page so STATUS +
     actions stay on-screen without horizontal scrolling. */
  return `<div class="card"><div class="table-wrap"><table class="data net-list">
    <thead><tr>
      <th class="net-col-check"><input type="checkbox" id="sel-all" style="width:15px;height:15px" ${!canEdit ? 'disabled' : ''}></th>
      <th>${esc(t('network.colDevice'))}</th>
      <th>${esc(t('network.colRole'))}</th>
      <th>${esc(t('network.colNetwork'))}</th>
      <th>${esc(t('network.colRack'))}</th>
      <th>${esc(t('network.colLocation'))}</th>
      <th>${esc(t('network.colOwner'))}</th>
      <th>Status</th>
      <th class="net-col-actions"></th>
    </tr></thead>
    <tbody>
      ${items.length === 0
        ? `<tr><td colspan="9" class="table-empty">${esc(t('network.empty'))}</td></tr>`
        : items.map((x) => {
          const s = x.specs || {};
          const lc = lifecycleInfo(x);
          const lics = assetLicenses(x);
          const war = dateDaysInfo(x.warrantyEndDate);
          const placed = !!(x.location && x.responsibleEmployee);
          const netBits = [
            s.hostname ? `<div class="mono">${esc(s.hostname)}</div>` : '',
            s.ipAddress ? `<div class="mono">${esc(s.ipAddress)}</div>` : '',
            x.mgmtIp ? `<div class="cell-sub mono">mgmt ${esc(x.mgmtIp)}</div>` : '',
          ].filter(Boolean).join('');
          const metaBits = [
            parentBitHtml(x),
            x.firmwareVersion ? `<div class="cell-sub">FW ${esc(x.firmwareVersion)}</div>` : '',
            eolBadgeHtml(lc),
            warBadgeHtml(war),
            licBadgeHtml(lics),
          ].filter(Boolean).join('');
          return `<tr class="net-row" data-open="${esc(x.id)}">
            <td class="net-col-check" onclick="event.stopPropagation()">
              <input type="checkbox" data-sel="${esc(x.id)}" style="width:15px;height:15px" ${!canEdit ? 'disabled' : ''}>
            </td>
            <td>
              <div class="net-device">
                <span class="ms net-device-ico">${catIcon(x.category)}</span>
                <div class="net-device-body">
                  <div class="cell-title">${esc(x.brand)} ${esc(x.model)}</div>
                  <div class="cell-sub mono">${esc(x.assetTag)}</div>
                  ${metaBits}
                </div>
              </div>
            </td>
            <td>${x.infraRole ? esc(x.infraRole) : '<span class="cell-sub">—</span>'}</td>
            <td class="net-col-net">${netBits || '<span class="cell-sub">—</span>'}</td>
            <td>${rackLabel(x) ? `<span class="mono">${esc(rackLabel(x))}</span>` : '<span class="cell-sub">—</span>'}</td>
            <td>${x.location
              ? esc(x.location)
              : `<span class="pill pill-amber">${esc(t('network.noLocation'))}</span>`}</td>
            <td>${x.responsibleEmployee
              ? esc(x.responsibleEmployee.fullName)
              : `<span class="pill pill-amber">${esc(t('network.noOwner'))}</span>`}</td>
            <td>${placed
              ? `<span class="pill pill-emerald">${esc(t('network.atSite'))}</span>`
              : `<span class="pill pill-amber">${esc(t('network.unplaced'))}</span>`}
              <div class="cell-sub">${esc(x.status)}</div></td>
            <td class="actions net-col-actions" onclick="event.stopPropagation()">
              ${canEdit ? `<button class="btn btn-primary btn-sm" data-place="${esc(x.id)}" title="${esc(t('network.setPlacement'))}">
                <span class="ms">location_on</span></button>` : ''}
              <button class="btn btn-outline btn-sm" data-view="${esc(x.id)}"><span class="ms">visibility</span></button>
              ${canEdit ? `<button class="btn btn-outline btn-sm" data-edit="${esc(x.id)}"><span class="ms">edit</span></button>` : ''}
            </td>
          </tr>`;
        }).join('')}
    </tbody>
  </table></div></div>`;
}

function parentBitHtml(x) {
  return x.parentAsset ? `<div class="cell-sub">↑ ${esc(x.parentAsset.assetTag)}</div>` : '';
}
function eolBadgeHtml(lc) {
  if (!lc || lc.excluded) return '';
  if (lc.overdue) return `<div><span class="pill pill-rose">EOL</span></div>`;
  if (lc.pct != null && lc.pct >= 90) return `<div><span class="pill pill-amber">EOL</span></div>`;
  return '';
}
function warBadgeHtml(info) {
  if (!info || info.days == null) return '';
  if (info.days < 0) return `<div><span class="pill pill-rose">${esc(t('network.colWarranty'))}</span></div>`;
  if (info.days <= 60) return `<div><span class="pill pill-amber">${esc(t('network.colWarranty'))}</span></div>`;
  return '';
}
function licBadgeHtml(lics) {
  if (!lics || !lics.length) return '';
  const label = lics.length === 1
    ? (lics[0].softwareName || lics[0].name || 'License')
    : `${lics.length} ${t('network.colLicense')}`;
  return `<div class="cell-sub">${esc(label)}</div>`;
}

/** Bulk select + actions for Network/Server list (no personal zimmet). */
function mountNetworkBulk(el, items, refresh, canEdit) {
  if (!canEdit) return;
  const selected = new Set();

  function renderBulkBar() {
    const slot = $('#bulk-bar-slot', el);
    if (!slot) return;
    if (selected.size === 0) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="bulk-bar">
        <span class="ms" style="color:var(--indigo-700)">check_box</span>
        <strong>${selected.size} ${esc(t('network.bulkSelected') || 'selected')}</strong>
        <span class="spacer"></span>
        <button class="btn btn-outline btn-sm" id="bulk-labels"><span class="ms">barcode</span> ${esc(t('network.bulkLabels') || 'Print Labels')}</button>
        <button class="btn btn-primary btn-sm" id="bulk-place"><span class="ms">location_on</span> ${esc(t('network.bulkPlace') || 'Set location & owner')}</button>
        <button class="btn btn-outline btn-sm" id="bulk-repair"><span class="ms">build</span> ${esc(t('network.bulkRepair') || 'Send to Repair')}</button>
        <button class="btn btn-danger btn-sm" id="bulk-scrap"><span class="ms">delete</span> ${esc(t('network.bulkScrap') || 'Scrap')}</button>
        <button class="btn btn-outline btn-sm" id="bulk-clear">Clear</button>
      </div>`;

    const pick = () => items.filter((x) => selected.has(x.id));

    $('#bulk-labels', slot).addEventListener('click', () => printAssetLabels(pick()));

    $('#bulk-clear', slot).addEventListener('click', () => {
      selected.clear();
      el.querySelectorAll('input[data-sel]').forEach((c) => { c.checked = false; });
      const all = $('#sel-all', el);
      if (all) all.checked = false;
      renderBulkBar();
    });

    $('#bulk-place', slot).addEventListener('click', () => {
      const targets = pick().filter((x) => x.status !== 'Scrap');
      if (!targets.length) {
        toast(t('network.bulkNonePlace') || 'No eligible devices selected', 'error');
        return;
      }
      formModal({
        title: `${t('network.bulkPlace') || 'Set location & owner'} — ${targets.length}`,
        fields: [
          {
            name: 'location', label: t('network.colLocation') + ' *', type: 'select', required: true, full: true,
            options: [
              { value: '', label: '— ' + t('network.noLocation') + ' —' },
              ...(AppConfig.locations || []).map((l) => ({ value: l, label: l })),
            ],
            value: AppConfig.defaultLocation || '',
          },
          {
            name: 'responsibleEmployeeId',
            label: t('network.colOwner') + ' *',
            type: 'employeeSearch',
            required: true,
            full: true,
          },
        ],
        submitLabel: t('network.savePlacement'),
        async onSubmit(d) {
          if (!d.location) throw new Error(t('network.locationRequired'));
          if (!d.responsibleEmployeeId) throw new Error(t('network.ownerRequired'));
          let ok = 0;
          for (const x of targets) {
            try {
              await api(`/assets/${x.id}`, {
                method: 'PUT',
                body: { location: d.location, responsibleEmployeeId: d.responsibleEmployeeId },
              });
              ok++;
            } catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
          }
          toast(`${ok}/${targets.length} ${t('network.bulkPlaceDone') || 'device(s) updated'}`, 'success');
          refresh();
        },
      });
    });

    $('#bulk-repair', slot).addEventListener('click', () => {
      const targets = pick().filter((x) => x.status === 'In Stock' || x.status === 'Assigned');
      if (!targets.length) {
        toast(t('network.bulkNoneRepair') || 'Selected devices cannot be sent to repair', 'error');
        return;
      }
      formModal({
        title: `${t('network.bulkRepair') || 'Send to Repair'} — ${targets.length}`,
        fields: [
          { name: 'serviceCompany', label: 'Service company *', required: true },
          { name: 'issueDescription', label: 'Issue description *', type: 'textarea', required: true, full: true },
        ],
        submitLabel: t('network.bulkRepair') || 'Send to Repair',
        async onSubmit(d) {
          let ok = 0;
          for (const x of targets) {
            try {
              await api('/maintenance', { method: 'POST', body: { ...d, assetId: x.id } });
              ok++;
            } catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
          }
          toast(`${ok}/${targets.length} ${t('network.bulkRepairDone') || 'sent to repair'}`, 'success');
          refresh();
        },
      });
    });

    $('#bulk-scrap', slot).addEventListener('click', () => {
      const targets = pick().filter((x) => x.status === 'In Stock' || x.status === 'In Repair');
      const skipped = selected.size - targets.length;
      if (!targets.length) {
        toast(t('network.bulkNoneScrap') || 'Only In Stock / In Repair devices can be scrapped', 'error');
        return;
      }
      confirmModal(
        `${t('network.bulkScrapConfirm') || 'Scrap'} ${targets.length} device(s)?${
          skipped ? ` (${skipped} skipped)` : ''
        }`,
        async () => {
          let ok = 0;
          for (const x of targets) {
            try {
              await api(`/assets/${x.id}`, { method: 'PUT', body: { status: 'Scrap' } });
              ok++;
            } catch (err) { toast(`${x.assetTag}: ${err.message}`, 'error'); }
          }
          toast(`${ok}/${targets.length} ${t('network.bulkScrapDone') || 'scrapped'}`, 'success');
          refresh();
        }
      );
    });
  }

  const selAll = $('#sel-all', el);
  if (selAll) {
    selAll.addEventListener('change', () => {
      el.querySelectorAll('input[data-sel]').forEach((c) => {
        c.checked = selAll.checked;
        if (selAll.checked) selected.add(c.dataset.sel);
        else selected.delete(c.dataset.sel);
      });
      renderBulkBar();
    });
  }
  el.querySelectorAll('input[data-sel]').forEach((c) => {
    c.addEventListener('change', () => {
      if (c.checked) selected.add(c.dataset.sel);
      else selected.delete(c.dataset.sel);
      if (selAll) {
        const boxes = [...el.querySelectorAll('input[data-sel]')];
        selAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
      }
      renderBulkBar();
    });
  });
}

function openPlacementModal(device, employees, onDone) {
  formModal({
    title: `${t('network.setPlacement')} — ${device.assetTag}`,
    fields: [
      {
        name: 'location', label: t('network.colLocation') + ' *', type: 'select', required: true, full: true,
        options: [
          { value: '', label: '— ' + t('network.noLocation') + ' —' },
          ...(AppConfig.locations || []).map((l) => ({ value: l, label: l })),
        ],
        value: device.location || AppConfig.defaultLocation || '',
      },
      {
        name: 'responsibleEmployeeId',
        label: t('network.colOwner') + ' *',
        type: 'employeeSearch',
        required: true,
        full: true,
        selected: device.responsibleEmployee
          ? { id: device.responsibleEmployee.id, fullName: device.responsibleEmployee.fullName }
          : null,
      },
    ],
    submitLabel: t('network.savePlacement'),
    async onSubmit(d) {
      if (!d.location) throw new Error(t('network.locationRequired'));
      if (!d.responsibleEmployeeId) throw new Error(t('network.ownerRequired'));
      await api(`/assets/${device.id}`, {
        method: 'PUT',
        body: { location: d.location, responsibleEmployeeId: d.responsibleEmployeeId },
      });
      toast(t('network.placementSaved'), 'success');
      onDone();
    },
  });
}

function licenseExpInfo(lic) {
  if (!lic || !lic.expirationDate) return null;
  return dateDaysInfo(lic.expirationDate);
}

function dateDaysInfo(raw) {
  if (!raw) return null;
  const exp = new Date(raw._seconds ? raw._seconds * 1000 : raw);
  if (Number.isNaN(exp.getTime())) return null;
  const days = Math.ceil((exp.getTime() - Date.now()) / 86400000);
  return { exp, days };
}

function eolCellHtml(lc) {
  if (lc.excluded) return '<span class="cell-sub">—</span>';
  if (!lc.eol) return `<span class="cell-sub">${lc.months} mo</span>`;
  if (lc.overdue) {
    return `<div>${fmtDate(lc.eol)}</div><span class="pill pill-rose">EOL</span>`;
  }
  if (lc.pct != null && lc.pct >= 90) {
    return `<div>${fmtDate(lc.eol)}</div><span class="pill pill-amber">${Math.min(lc.pct, 100)}%</span>`;
  }
  return `<div>${fmtDate(lc.eol)}</div><span class="cell-sub">${Math.min(lc.pct || 0, 100)}%</span>`;
}

function warrantyCellHtml(info) {
  if (!info) return '<span class="cell-sub">—</span>';
  const pill = info.days < 0 ? '<span class="pill pill-rose">ended</span>'
    : info.days <= 30 ? `<span class="pill pill-rose">${info.days}d</span>`
      : info.days <= 90 ? `<span class="pill pill-amber">${info.days}d</span>` : '';
  return `<div>${fmtDate(info.exp)}</div>${pill}`;
}

function multiLicCellHtml(lics) {
  if (!lics || !lics.length) return '<span class="cell-sub">—</span>';
  return lics.slice(0, 3).map((lic) => {
    const info = licenseExpInfo(lic);
    const pill = !info ? ''
      : info.days < 0 ? '<span class="pill pill-rose">expired</span>'
        : info.days <= 30 ? `<span class="pill pill-rose">${info.days}d</span>`
          : info.days <= 60 ? `<span class="pill pill-amber">${info.days}d</span>` : '';
    return `<div class="cell-title" style="font-size:12.5px">${esc(lic.softwareName)}</div>
      <div class="cell-sub">${fmtDate(lic.expirationDate)} ${pill}</div>`;
  }).join('') + (lics.length > 3
    ? `<div class="cell-sub">+${lics.length - 3} more</div>` : '');
}
