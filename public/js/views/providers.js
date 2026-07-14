/*
 * Providers & Contracts — company vendors / ISPs / MSPs with contact details
 * and commercial agreements (renewal dates, cost, internal owner).
 */
'use strict';

const CONTRACT_STATUSES = ['Draft', 'Active', 'Expired', 'Cancelled', 'Renewed'];
const BILLING = ['Monthly', 'Quarterly', 'Annual', 'One-time', 'Other'];

function catalogProviderCategories() {
  const list = (AppConfig && AppConfig.providerCategories) || [];
  return list.length ? list : ['ISP', 'Telco', 'Cloud', 'Hardware', 'Software', 'MSP', 'Support', 'Security', 'Other'];
}

function catalogContractCategories() {
  const list = (AppConfig && AppConfig.contractCategories) || [];
  return list.length ? list : ['Connectivity', 'Support', 'License', 'Hardware', 'SaaS', 'MSP', 'Security', 'Other'];
}

function contractDaysLeft(endDate) {
  if (!endDate) return null;
  const end = new Date(String(endDate).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.ceil((end - today) / 86400000);
}

function statusPill(status) {
  const map = {
    Active: 'pill-emerald',
    Draft: 'pill-slate',
    Expired: 'pill-rose',
    Cancelled: 'pill-slate',
    Renewed: 'pill-blue',
    Inactive: 'pill-slate',
  };
  return `<span class="pill ${map[status] || 'pill-slate'}">${esc(status)}</span>`;
}

Views.providers = async function (el, params = {}) {
  if (isStaleView(el)) return;
  const canEdit = Auth.can('canManageAssets');
  const tab = params.tab === 'contracts' ? 'contracts' : 'providers';
  const providerFilterId = params.providerId || '';
  const statusFilter = params.status || '';
  const searchQ = (params.q || '').trim();

  const [summary, providers, contracts] = await Promise.all([
    api('/providers/summary'),
    api('/providers'),
    api('/contracts'),
  ]);
  if (isStaleView(el)) return;

  const setTab = (next, extra = {}) => {
    const q = new URLSearchParams();
    if (next === 'contracts') {
      q.set('tab', 'contracts');
      const providerId = extra.providerId !== undefined ? extra.providerId : '';
      const status = extra.status !== undefined ? extra.status : '';
      const text = extra.q !== undefined ? extra.q : '';
      if (providerId) q.set('providerId', providerId);
      if (status) q.set('status', status);
      if (text) q.set('q', text);
    }
    const qs = q.toString();
    location.hash = '#/providers' + (qs ? '?' + qs : '');
  };

  const setContractFilters = (patch) => {
    setTab('contracts', {
      providerId: patch.providerId !== undefined ? patch.providerId : providerFilterId,
      status: patch.status !== undefined ? patch.status : statusFilter,
      q: patch.q !== undefined ? patch.q : searchQ,
    });
  };

  const refresh = () => Views.providers(el, params);
  const filterProvider = providerFilterId
    ? providers.find((p) => p.id === providerFilterId) || null
    : null;

  let visibleContracts = contracts;
  if (providerFilterId) {
    visibleContracts = visibleContracts.filter((c) => c.providerId === providerFilterId);
  }
  if (statusFilter) {
    visibleContracts = visibleContracts.filter((c) => c.status === statusFilter);
  }
  if (searchQ) {
    const s = searchQ.toLowerCase();
    visibleContracts = visibleContracts.filter((c) =>
      [c.title, c.contractNumber, c.providerName, c.category, c.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)));
  }

  const filtersActive = !!(providerFilterId || statusFilter || searchQ);

  el.innerHTML = `
    ${pageHead(
      t('nav.providers') || 'Providers & Contracts',
      t('providers.sub') || 'Keep vendor contacts and commercial agreements in one place — renewals, support lines, account numbers.',
      canEdit ? `
        <button class="btn btn-outline" id="pc-new-provider"><span class="ms">apartment</span> ${esc(t('providers.addProvider') || 'Add provider')}</button>
        <button class="btn btn-primary" id="pc-new-contract"><span class="ms">description</span> ${esc(t('providers.addContract') || 'Add contract')}</button>` : ''
    )}

    <div class="grid grid-4" style="margin-bottom:20px">
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricProviders') || 'Active providers')}</h3>${iconChip('apartment', 'indigo')}</div>
        <div class="metric-value">${summary.providers.active}</div>
        <div class="cell-sub">${summary.providers.total} total</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricContracts') || 'Active contracts')}</h3>${iconChip('description', 'blue')}</div>
        <div class="metric-value">${summary.contracts.active}</div>
        <div class="cell-sub">${summary.contracts.total} total</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricExpiring') || 'Expiring ≤60 days')}</h3>${iconChip('event_upcoming', summary.expiringWithin60Days ? 'amber' : 'emerald')}</div>
        <div class="metric-value">${summary.expiringWithin60Days}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricExpired') || 'Expired')}</h3>${iconChip('event_busy', summary.contracts.expired ? 'rose' : 'slate')}</div>
        <div class="metric-value">${summary.contracts.expired}</div>
      </div>
    </div>

    <div class="tabs" id="pc-tabs" role="tablist">
      <button type="button" class="tab ${tab === 'providers' ? 'active' : ''}" data-tab="providers" role="tab">
        <span class="ms">apartment</span> ${esc(t('providers.tabProviders') || 'Providers')}
        <span class="cell-sub" style="margin-left:6px">${providers.length}</span>
      </button>
      <button type="button" class="tab ${tab === 'contracts' ? 'active' : ''}" data-tab="contracts" role="tab">
        <span class="ms">description</span> ${esc(t('providers.tabContracts') || 'Contracts')}
        <span class="cell-sub" style="margin-left:6px">${filtersActive ? `${visibleContracts.length}/${contracts.length}` : contracts.length}</span>
      </button>
    </div>

    <div id="pc-body"></div>`;

  const body = $('#pc-body', el);

  if (tab === 'providers') {
    renderProvidersTab(body, providers, canEdit, refresh, setTab);
  } else {
    renderContractsTab(body, visibleContracts, providers, canEdit, refresh, {
      filterProvider,
      providerFilterId,
      statusFilter,
      searchQ,
      filtersActive,
      allCount: contracts.length,
      setContractFilters,
      clearFilter: () => setTab('contracts'),
    });
  }

  el.querySelectorAll('#pc-tabs [data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });

  if (canEdit) {
    $('#pc-new-provider', el)?.addEventListener('click', () => openProviderForm(null, refresh));
    $('#pc-new-contract', el)?.addEventListener('click', () => openContractForm(
      filterProvider ? { providerId: filterProvider.id } : null,
      providers,
      refresh
    ));
  }
};

function renderProvidersTab(el, providers, canEdit, refresh, setTab) {
  if (!providers.length) {
    el.innerHTML = `
      <div class="card card-pad" style="text-align:center;padding:40px 24px">
        <div class="ms" style="font-size:36px;color:var(--slate-400);margin-bottom:8px">apartment</div>
        <div class="cell-title">${esc(t('providers.emptyProviders') || 'No providers yet')}</div>
        <p class="cell-sub" style="max-width:420px;margin:8px auto 0">
          ${esc(t('providers.emptyProvidersHint') || 'Add ISPs, MSPs, hardware vendors and support partners — then attach contracts.')}
        </p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="grid grid-2" style="gap:16px">
      ${providers.map((p) => {
        const contactBits = [
          p.contactName && `<strong>${esc(p.contactName)}</strong>${p.contactRole ? ` · ${esc(p.contactRole)}` : ''}`,
          p.contactEmail && `<a href="mailto:${esc(p.contactEmail)}">${esc(p.contactEmail)}</a>`,
          p.contactPhone && `<span class="mono">${esc(p.contactPhone)}</span>`,
        ].filter(Boolean);
        const supportBits = [
          p.supportEmail && `<a href="mailto:${esc(p.supportEmail)}">${esc(p.supportEmail)}</a>`,
          p.supportPhone && `<span class="mono">${esc(p.supportPhone)}</span>`,
          p.supportPortal && (() => {
            const href = safeHref(p.supportPortal);
            return href
              ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t('providers.portal') || 'Support portal')}</a>`
              : `<span class="cell-sub">${esc(p.supportPortal)}</span>`;
          })(),
        ].filter(Boolean);
        return `
        <div class="card card-pad" data-provider-card="${esc(p.id)}">
          <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
            <div style="display:flex;gap:12px;align-items:flex-start;min-width:0">
              ${iconChip('apartment', p.status === 'Active' ? 'indigo' : 'slate')}
              <div style="min-width:0">
                <div class="cell-title" style="font-size:16px">${esc(p.name)}</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  <span class="pill pill-blue">${esc(p.category)}</span>
                  ${statusPill(p.status)}
                  ${(p.activeContractCount || 0) > 0
                    ? `<span class="pill pill-emerald">${p.activeContractCount} ${esc(t('providers.activeContractsShort') || 'active')}</span>`
                    : ''}
                  ${(p.documentCount || 0) > 0
                    ? `<span class="pill pill-slate"><span class="ms" style="font-size:14px;vertical-align:middle">attach_file</span> ${p.documentCount}</span>`
                    : ''}
                </div>
              </div>
            </div>
            ${canEdit ? `
            <div class="actions" style="flex-shrink:0">
              <button class="btn btn-outline btn-sm" data-edit-provider="${esc(p.id)}" title="Edit"><span class="ms">edit</span></button>
              <button class="btn btn-outline btn-sm" data-del-provider="${esc(p.id)}" title="Delete"><span class="ms">delete</span></button>
            </div>` : ''}
          </div>

          <div class="grid grid-2" style="gap:12px;margin-top:16px;font-size:13px">
            <div>
              <div class="cell-sub" style="margin-bottom:4px">${esc(t('providers.companyContact') || 'Company')}</div>
              <div>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '<span class="cell-sub">—</span>'}</div>
              <div class="mono" style="margin-top:2px">${esc(p.phone || '—')}</div>
              ${p.website ? (() => {
                const href = safeHref(p.website);
                const label = esc(String(p.website).replace(/^https?:\/\//, ''));
                return href
                  ? `<div style="margin-top:2px"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`
                  : `<div style="margin-top:2px" class="cell-sub">${label}</div>`;
              })() : ''}
              ${p.accountNumber ? `<div class="cell-sub" style="margin-top:6px">Acct <span class="mono">${esc(p.accountNumber)}</span></div>` : ''}
            </div>
            <div>
              <div class="cell-sub" style="margin-bottom:4px">${esc(t('providers.primaryContact') || 'Primary contact')}</div>
              ${contactBits.length
                ? contactBits.map((b) => `<div style="margin-top:2px">${b}</div>`).join('')
                : '<span class="cell-sub">—</span>'}
              ${supportBits.length ? `
                <div class="cell-sub" style="margin:10px 0 4px">${esc(t('providers.support') || 'Support')}</div>
                ${supportBits.map((b) => `<div style="margin-top:2px">${b}</div>`).join('')}` : ''}
            </div>
          </div>

          ${p.notes ? `<p class="cell-sub" style="margin:14px 0 0;white-space:pre-wrap">${esc(p.notes)}</p>` : ''}

          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" data-provider-docs="${esc(p.id)}">
              <span class="ms">attach_file</span>
              ${esc(t('common.documents') || 'Documents')} (${p.documentCount || 0})
            </button>
            <button class="btn btn-outline btn-sm" data-show-contracts="${esc(p.id)}">
              <span class="ms">description</span>
              ${esc(t('providers.viewContracts') || 'Contracts')} (${p.contractCount || 0})
            </button>
            ${canEdit ? `
            <button class="btn btn-primary btn-sm" data-add-contract-for="${esc(p.id)}">
              <span class="ms">add</span> ${esc(t('providers.addContract') || 'Add contract')}
            </button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  el.querySelectorAll('[data-edit-provider]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = providers.find((x) => x.id === b.dataset.editProvider);
      if (p) openProviderForm(p, refresh);
    });
  });
  el.querySelectorAll('[data-del-provider]').forEach((b) => {
    b.addEventListener('click', async () => {
      const p = providers.find((x) => x.id === b.dataset.delProvider);
      if (!p) return;
      if (!confirm(`Delete provider “${p.name}”?`)) return;
      try {
        await api(`/providers/${p.id}`, { method: 'DELETE' });
        toast('Provider deleted', 'success');
        refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
  el.querySelectorAll('[data-show-contracts]').forEach((b) => {
    b.addEventListener('click', () => setTab('contracts', { providerId: b.dataset.showContracts }));
  });
  el.querySelectorAll('[data-provider-docs]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = providers.find((x) => x.id === b.dataset.providerDocs);
      if (p) openEntityDocs({
        kind: 'provider',
        id: p.id,
        title: p.name,
        canEdit,
        onDone: refresh,
      });
    });
  });
  el.querySelectorAll('[data-add-contract-for]').forEach((b) => {
    b.addEventListener('click', () => {
      openContractForm({ providerId: b.dataset.addContractFor }, providers, refresh);
    });
  });
}

function renderContractsTab(el, contracts, providers, canEdit, refresh, opts = {}) {
  const {
    filterProvider = null,
    providerFilterId = '',
    statusFilter = '',
    searchQ = '',
    filtersActive = false,
    clearFilter = null,
    setContractFilters = null,
    allCount = contracts.length,
  } = opts;

  const statuses = ['Draft', 'Active', 'Expired', 'Cancelled', 'Renewed'];
  const resultLabel = (t('providers.filterResult') || '{n} of {total}')
    .replace('{n}', String(contracts.length))
    .replace('{total}', String(allCount));

  const filterBar = `
    <div class="card card-pad" style="margin-bottom:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div class="form-field" style="flex:1;min-width:180px;margin:0">
          <label>${esc(t('common.search') || 'Search')}</label>
          <input type="search" id="pc-c-q" value="${esc(searchQ)}"
            placeholder="${esc(t('providers.filterSearch') || 'Search contracts…')}">
        </div>
        <div class="form-field" style="min-width:200px;margin:0">
          <label>${esc(t('providers.colProvider') || 'Provider')}</label>
          <select id="pc-c-provider">
            <option value="">${esc(t('providers.filterAllProviders') || 'All providers')}</option>
            ${providers.map((p) =>
              `<option value="${esc(p.id)}" ${p.id === providerFilterId ? 'selected' : ''}>${esc(p.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-field" style="min-width:150px;margin:0">
          <label>${esc(t('providers.colStatus') || 'Status')}</label>
          <select id="pc-c-status">
            <option value="">${esc(t('providers.filterAllStatuses') || 'All statuses')}</option>
            ${statuses.map((s) =>
              `<option value="${esc(s)}" ${s === statusFilter ? 'selected' : ''}>${esc(s)}</option>`
            ).join('')}
          </select>
        </div>
        ${filtersActive ? `
        <button type="button" class="btn btn-outline btn-sm" id="pc-clear-provider-filter" style="margin-bottom:2px">
          <span class="ms">filter_alt_off</span> ${esc(t('providers.filterClear') || 'Clear filters')}
        </button>` : ''}
      </div>
      <div class="cell-sub" style="margin-top:10px">
        ${esc(resultLabel)}
        ${filterProvider ? ` · ${esc(filterProvider.name)} — ${esc(t('providers.linkedContracts') || 'linked contract(s)')}` : ''}
      </div>
    </div>`;

  if (!contracts.length) {
    el.innerHTML = `
      ${filterBar}
      <div class="card card-pad" style="text-align:center;padding:40px 24px">
        <div class="ms" style="font-size:36px;color:var(--slate-400);margin-bottom:8px">description</div>
        <div class="cell-title">${esc(filtersActive
          ? (t('providers.emptyProviderContracts') || 'No contracts for this provider')
          : (t('providers.emptyContracts') || 'No contracts yet'))}</div>
        <p class="cell-sub" style="max-width:420px;margin:8px auto 0">
          ${esc(filtersActive
            ? (t('providers.emptyProviderContractsHint') || 'Add a contract for this provider, or clear the filter to see all contracts.')
            : (t('providers.emptyContractsHint') || 'Record support SLAs, circuit agreements, SaaS renewals and MSP retainers.'))}
        </p>
      </div>`;
    wireContractFilters(el, { setContractFilters, clearFilter, searchQ });
    return;
  }

  el.innerHTML = `
    ${filterBar}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr>
        <th>${esc(t('providers.colContract') || 'Contract')}</th>
        <th>${esc(t('providers.colProvider') || 'Provider')}</th>
        <th>${esc(t('providers.colTerm') || 'Term')}</th>
        <th>${esc(t('providers.colCost') || 'Cost')}</th>
        <th>${esc(t('providers.colOwner') || 'Owner')}</th>
        <th>${esc(t('providers.colStatus') || 'Status')}</th>
        <th style="text-align:right"></th>
      </tr></thead>
      <tbody>
        ${contracts.map((c) => {
          const days = contractDaysLeft(c.endDate);
          let endExtra = '';
          if (days != null && (c.status === 'Active' || c.status === 'Draft')) {
            if (days < 0) endExtra = `<span class="pill pill-rose">${esc(t('providers.overdue') || 'Overdue')}</span>`;
            else if (days <= 30) endExtra = `<span class="pill pill-rose">${days}d</span>`;
            else if (days <= 60) endExtra = `<span class="pill pill-amber">${days}d</span>`;
          }
          return `
          <tr>
            <td>
              <div class="cell-title">${esc(c.title)}</div>
              <div class="cell-sub">
                ${esc(c.category)}
                ${c.contractNumber ? ` · <span class="mono">${esc(c.contractNumber)}</span>` : ''}
                ${c.autoRenew ? ` · ${esc(t('providers.autoRenew') || 'Auto-renew')}` : ''}
                ${(c.documentCount || 0) > 0 ? ` · ${c.documentCount} doc` : ''}
              </div>
            </td>
            <td>
              <div>${esc(c.providerName || '—')}</div>
              <div class="cell-sub">${esc(c.providerCategory || '')}</div>
            </td>
            <td>
              <div class="cell-sub">${fmtDate(c.startDate) || '—'} → ${fmtDate(c.endDate) || '—'}</div>
              ${c.renewalDate ? `<div class="cell-sub">Renew ${fmtDate(c.renewalDate)}</div>` : ''}
              ${endExtra ? `<div style="margin-top:4px">${endExtra}</div>` : ''}
            </td>
            <td>
              <div>${fmtMoney(c.costAmount, c.costCurrency)}</div>
              <div class="cell-sub">${esc(c.billingCycle || '')}</div>
            </td>
            <td>${esc((c.ownerEmployee && c.ownerEmployee.fullName) || '—')}</td>
            <td>
              ${statusPill(c.status)}
              ${c.visibility === 'Confidential'
                ? `<div style="margin-top:4px"><span class="pill pill-indigo">${esc(t('providers.visibilityConfidential') || 'Confidential')}</span></div>`
                : ''}
            </td>
            <td class="actions">
              <button class="btn btn-outline btn-sm" data-contract-docs="${esc(c.id)}" title="${esc(t('common.documents') || 'Documents')}">
                <span class="ms">attach_file</span>${(c.documentCount || 0) ? ` ${c.documentCount}` : ''}
              </button>
              ${canEdit ? `
              <button class="btn btn-outline btn-sm" data-edit-contract="${esc(c.id)}"><span class="ms">edit</span></button>
              <button class="btn btn-outline btn-sm" data-del-contract="${esc(c.id)}"><span class="ms">delete</span></button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div></div>`;

  wireContractFilters(el, { setContractFilters, clearFilter, searchQ });

  el.querySelectorAll('[data-edit-contract]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = contracts.find((x) => x.id === b.dataset.editContract);
      if (c) openContractForm(c, providers, refresh);
    });
  });
  el.querySelectorAll('[data-contract-docs]').forEach((b) => {
    b.addEventListener('click', () => {
      const c = contracts.find((x) => x.id === b.dataset.contractDocs);
      if (c) openEntityDocs({
        kind: 'contract',
        id: c.id,
        title: c.title,
        canEdit,
        onDone: refresh,
      });
    });
  });
  el.querySelectorAll('[data-del-contract]').forEach((b) => {
    b.addEventListener('click', async () => {
      const c = contracts.find((x) => x.id === b.dataset.delContract);
      if (!c) return;
      if (!confirm(`Delete contract “${c.title}”?`)) return;
      try {
        await api(`/contracts/${c.id}`, { method: 'DELETE' });
        toast('Contract deleted', 'success');
        refresh();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function wireContractFilters(el, { setContractFilters, clearFilter, searchQ }) {
  if (!setContractFilters) return;
  const providerSel = $('#pc-c-provider', el);
  const statusSel = $('#pc-c-status', el);
  const qInput = $('#pc-c-q', el);

  providerSel?.addEventListener('change', () => {
    setContractFilters({ providerId: providerSel.value || '' });
  });
  statusSel?.addEventListener('change', () => {
    setContractFilters({ status: statusSel.value || '' });
  });

  let timer = null;
  qInput?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = (qInput.value || '').trim();
      if (next === (searchQ || '')) return;
      setContractFilters({ q: next });
    }, 350);
  });
  qInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timer);
      setContractFilters({ q: (qInput.value || '').trim() });
    }
  });

  $('#pc-clear-provider-filter', el)?.addEventListener('click', () => {
    if (clearFilter) clearFilter();
    else setContractFilters({ providerId: '', status: '', q: '' });
  });
}


function openProviderForm(provider, done) {
  const isEdit = !!(provider && provider.id);
  const cats = catalogProviderCategories();
  formModal({
    title: isEdit ? (t('providers.editProvider') || 'Edit provider') : (t('providers.addProvider') || 'Add provider'),
    wide: true,
    fields: [
      { name: 'name', label: 'Name *', required: true, value: provider?.name || '' },
      {
        name: 'category', label: 'Category', type: 'selectOther', required: true,
        value: provider?.category || cats[0] || '',
        options: cats.map((c) => ({ value: c, label: c })),
        otherPlaceholder: 'e.g. Colocation / Consulting…',
        otherRequiredMsg: 'Type a custom category',
      },
      {
        name: 'status', label: 'Status', type: 'select',
        value: provider?.status || 'Active',
        options: ['Active', 'Inactive'].map((s) => ({ value: s, label: s })),
      },
      { name: 'website', label: 'Website', value: provider?.website || '', placeholder: 'https://…' },
      { name: 'email', label: 'Company email', value: provider?.email || '' },
      { name: 'phone', label: 'Company phone', value: provider?.phone || '' },
      { name: 'accountNumber', label: 'Account / customer #', value: provider?.accountNumber || '' },
      { name: 'taxId', label: 'Tax / VAT ID', value: provider?.taxId || '' },
      { name: 'contactName', label: 'Primary contact', value: provider?.contactName || '' },
      { name: 'contactRole', label: 'Contact role', value: provider?.contactRole || '', placeholder: 'Account manager' },
      { name: 'contactEmail', label: 'Contact email', value: provider?.contactEmail || '' },
      { name: 'contactPhone', label: 'Contact phone', value: provider?.contactPhone || '' },
      { name: 'supportEmail', label: 'Support email', value: provider?.supportEmail || '' },
      { name: 'supportPhone', label: 'Support phone', value: provider?.supportPhone || '' },
      { name: 'supportPortal', label: 'Support portal URL', value: provider?.supportPortal || '', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', value: provider?.notes || '', full: true },
    ],
    async onSubmit(d) {
      if (isEdit) {
        await api(`/providers/${provider.id}`, { method: 'PATCH', body: d });
        toast('Provider updated', 'success');
      } else {
        await api('/providers', { method: 'POST', body: d });
        toast('Provider created', 'success');
      }
      done();
    },
  });
}

function openContractForm(contract, providers, done) {
  const isEdit = !!(contract && contract.id);
  if (!providers.length && !isEdit) {
    toast(t('providers.needProviderFirst') || 'Add a provider first, then attach a contract.', 'error');
    return;
  }
  const cats = catalogContractCategories();
  formModal({
    title: isEdit ? (t('providers.editContract') || 'Edit contract') : (t('providers.addContract') || 'Add contract'),
    wide: true,
    fields: [
      { name: 'title', label: 'Title *', required: true, value: contract?.title || '', full: true },
      {
        name: 'providerId', label: 'Provider *', type: 'select', required: true,
        value: contract?.providerId || '',
        options: [
          { value: '', label: 'Select provider…' },
          ...providers.map((p) => ({ value: p.id, label: `${p.name} (${p.category})` })),
        ],
        full: true,
      },
      { name: 'contractNumber', label: 'Contract #', value: contract?.contractNumber || '' },
      {
        name: 'category', label: 'Category', type: 'selectOther', required: true,
        value: contract?.category || cats[0] || '',
        options: cats.map((c) => ({ value: c, label: c })),
        otherPlaceholder: 'e.g. Colocation / Training…',
        otherRequiredMsg: 'Type a custom category',
      },
      {
        name: 'status', label: 'Status', type: 'select',
        value: contract?.status || 'Active',
        options: CONTRACT_STATUSES.map((s) => ({ value: s, label: s })),
      },
      ...(Auth.can('canViewConfidentialContracts')
        ? [{
          name: 'visibility',
          label: t('providers.visibility') || 'Visibility',
          type: 'select',
          value: contract?.visibility || 'Public',
          options: [
            { value: 'Public', label: t('providers.visibilityPublic') || 'Public — all IT users' },
            { value: 'Confidential', label: t('providers.visibilityConfidentialOpt') || 'Confidential — Owner / Admin only' },
          ],
          full: true,
        }]
        : []),
      {
        name: 'billingCycle', label: 'Billing cycle', type: 'select',
        value: contract?.billingCycle || 'Annual',
        options: BILLING.map((b) => ({ value: b, label: b })),
      },
      {
        name: 'startDate', label: 'Start date', type: 'date',
        value: contract?.startDate ? String(contract.startDate).slice(0, 10) : '',
      },
      {
        name: 'endDate', label: 'End date', type: 'date',
        value: contract?.endDate ? String(contract.endDate).slice(0, 10) : '',
      },
      {
        name: 'renewalDate', label: 'Renewal date', type: 'date',
        value: contract?.renewalDate ? String(contract.renewalDate).slice(0, 10) : '',
      },
      {
        name: 'noticeDays', label: 'Notice period (days)', type: 'number',
        value: contract?.noticeDays != null ? contract.noticeDays : '',
      },
      {
        name: 'autoRenew', label: 'Auto-renew', type: 'select',
        value: contract?.autoRenew ? 'true' : 'false',
        options: [
          { value: 'false', label: 'No' },
          { value: 'true', label: 'Yes' },
        ],
      },
      {
        name: 'costAmount', label: 'Cost amount', type: 'number', step: '0.01',
        value: contract?.costAmount != null ? contract.costAmount : '',
      },
      {
        name: 'costCurrency', label: 'Currency', type: 'selectOther',
        value: contract?.costCurrency || appCurrency(),
        options: currencyOptionsForSelect(contract?.costCurrency || appCurrency()),
        otherLabel: 'Other ISO code…',
        otherPlaceholder: 'e.g. USD',
        otherRequiredMsg: 'Enter a 3-letter currency code',
      },
      {
        name: 'ownerEmployeeId', label: 'Internal owner', type: 'employeeSearch',
        value: contract?.ownerEmployee?.id || '',
        selected: contract?.ownerEmployee || null,
        selectedLabel: contract?.ownerEmployee?.fullName || '',
        full: true,
      },
      { name: 'notes', label: 'Notes', type: 'textarea', value: contract?.notes || '', full: true },
    ],
    async onSubmit(d) {
      if (!d.providerId) throw new Error('Select a provider');
      d.autoRenew = d.autoRenew === 'true' || d.autoRenew === true;
      if (isEdit) {
        await api(`/contracts/${contract.id}`, { method: 'PATCH', body: d });
        toast('Contract updated', 'success');
      } else {
        await api('/contracts', { method: 'POST', body: d });
        toast('Contract created', 'success');
      }
      done();
    },
  });
}

/** Documents archive modal for a provider or contract (PDF / PNG / JPEG / WebP). */
async function openEntityDocs({ kind, id, title, canEdit, onDone }) {
  const canDel = Auth.can('canManageUsers');
  const base = kind === 'provider' ? `/providers/${id}` : `/contracts/${id}`;
  const dlBase = kind === 'provider'
    ? '/api/providers/documents'
    : '/api/contracts/documents';
  const delBase = kind === 'provider' ? '/providers/documents' : '/contracts/documents';

  const fmtKB = (n) => (n >= 1024 * 1024
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`);

  try {
    const documents = await api(`${base}/documents`).catch(() => []);
    const canOpenDocs = Auth.can('canExecuteHandovers');
    openModal({
      title: `${title} — ${t('common.documents') || 'Documents'} (${documents.length})`,
      wide: true,
      body: `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div class="cell-sub">${esc(t('providers.docsHint') || 'Upload signed contracts, SLAs, invoices or account forms (PDF, PNG, JPEG, WebP — max 8MB).')}</div>
          ${canEdit ? `<button class="btn btn-primary btn-sm" id="pc-doc-upload"><span class="ms">upload_file</span> ${esc(t('common.upload') || 'Upload')}</button>` : ''}
        </div>
        <input type="file" id="pc-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
        ${documents.length === 0
          ? `<div class="table-empty">${esc(t('providers.docsEmpty') || 'No documents yet.')}</div>`
          : `<div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
              <thead><tr><th>Document</th><th>Size</th><th>Added</th><th style="text-align:right"></th></tr></thead>
              <tbody>
                ${documents.map((d) => `
                <tr>
                  <td><div style="display:flex;align-items:center;gap:8px">
                    <span class="ms" style="color:var(--on-surface-variant)">${d.mime && d.mime.includes('pdf') ? 'picture_as_pdf' : 'image'}</span>
                    ${canOpenDocs
                      ? `<a href="#" class="cell-title" data-pc-view="${esc(d.id)}">${esc(d.filename)}</a>`
                      : `<span class="cell-title">${esc(d.filename)}</span>`}
                  </div></td>
                  <td class="cell-sub">${fmtKB(d.byteSize || 0)}</td>
                  <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' · ' + esc(d.uploadedByName) : ''}</td>
                  <td class="actions">
                    ${canOpenDocs ? `
                    <button type="button" class="btn btn-outline btn-sm" data-pc-view="${esc(d.id)}" title="${esc(t('common.view') || 'View')}"><span class="ms">visibility</span></button>
                    <button type="button" class="btn btn-outline btn-sm" data-pc-dl="${esc(d.id)}" title="${esc(t('common.download') || 'Download')}"><span class="ms">download</span></button>` : ''}
                    ${canDel ? `<button type="button" class="btn btn-outline btn-sm" data-pc-del="${esc(d.id)}"><span class="ms">delete</span></button>` : ''}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>`}`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close') || 'Close')}</button>`,
      onMount(overlay) {
        overlay.querySelectorAll('[data-pc-view]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          viewAuthed(`${dlBase}/${a.dataset.pcView}/download`);
        }));
        overlay.querySelectorAll('[data-pc-dl]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          downloadAuthed(`${dlBase}/${a.dataset.pcDl}/download`);
        }));

        const upBtn = $('#pc-doc-upload', overlay);
        const upFile = $('#pc-doc-file', overlay);
        if (upBtn && upFile) {
          upBtn.addEventListener('click', () => upFile.click());
          upFile.addEventListener('change', async () => {
            const file = upFile.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
              toast('File too large — max 8MB (PDF, PNG, JPEG, WebP)', 'error');
              return;
            }
            upBtn.disabled = true;
            try {
              const base64 = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = rej;
                r.readAsDataURL(file);
              });
              await api(`${base}/documents`, {
                method: 'POST',
                body: { filename: file.name, base64 },
              });
              toast(`"${file.name}" uploaded`, 'success');
              closeModal();
              if (onDone) onDone();
              openEntityDocs({ kind, id, title, canEdit, onDone });
            } catch (err) {
              toast(err.message, 'error');
              upBtn.disabled = false;
            }
          });
        }

        overlay.querySelectorAll('[data-pc-del]').forEach((b) => {
          b.addEventListener('click', () => {
            confirmModal('Delete this document permanently?', async () => {
              await api(`${delBase}/${b.dataset.pcDel}`, { method: 'DELETE' });
              toast('Document deleted', 'success');
              closeModal();
              if (onDone) onDone();
              openEntityDocs({ kind, id, title, canEdit, onDone });
            });
          });
        });
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}
