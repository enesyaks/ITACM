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
  const canReadProvider = Auth.canIamOp('provider', 'read');
  const canReadContract = Auth.canIamOp('contract', 'read');
  if (!canReadProvider && !canReadContract) {
    el.innerHTML = `<div class="card card-pad"><p class="cell-sub">${esc(t('common.forbidden') || 'Access denied')}: needs <strong>provider:read</strong> or <strong>contract:read</strong>.</p></div>`;
    return;
  }

  const canEditProvider = Auth.canIam('provider', 'create') || Auth.canIam('provider', 'update') || Auth.canIam('provider', 'manage');
  const canEditContract = Auth.canIam('contract', 'create') || Auth.canIam('contract', 'update') || Auth.canIam('contract', 'manage');
  const canDeleteProvider = Auth.canIam('provider', 'delete') || Auth.canIam('provider', 'manage');
  const canDeleteContract = Auth.canIam('contract', 'delete') || Auth.canIam('contract', 'manage');
  const canCreateProvider = Auth.canIam('provider', 'create');
  const canCreateContract = Auth.canIam('contract', 'create');
  const emptySummary = {
    providers: { active: 0, total: 0 },
    contracts: { active: 0, total: 0, expired: 0 },
    expiringWithin60Days: 0,
  };

  let tab = params.tab === 'contracts' ? 'contracts' : 'providers';
  if (tab === 'contracts' && !canReadContract) tab = 'providers';
  if (tab === 'providers' && !canReadProvider && canReadContract) tab = 'contracts';

  const providerFilterId = params.providerId || '';
  const statusFilter = params.status || '';
  const searchQ = (params.q || '').trim();

  const [summary, providers, contracts] = await Promise.all([
    canReadProvider ? api('/providers/summary').catch(() => emptySummary) : Promise.resolve(emptySummary),
    canReadProvider ? api('/providers') : Promise.resolve([]),
    canReadContract ? api('/contracts') : Promise.resolve([]),
  ]);
  if (isStaleView(el)) return;

  const setTab = (next, extra = {}) => {
    if (next === 'contracts' && !canReadContract) return;
    if (next === 'providers' && !canReadProvider) return;
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
  const headActions = [
    canCreateProvider ? `<button class="btn btn-outline" id="pc-new-provider"><span class="ms">apartment</span> ${esc(t('providers.addProvider') || 'Add provider')}</button>` : '',
    canCreateContract && canReadContract ? `<button class="btn btn-primary" id="pc-new-contract"><span class="ms">description</span> ${esc(t('providers.addContract') || 'Add contract')}</button>` : '',
  ].filter(Boolean).join('');

  el.innerHTML = `
    ${pageHead(
      t('nav.providers') || 'Providers & Contracts',
      t('providers.sub') || 'Keep vendor contacts and commercial agreements in one place — renewals, support lines, account numbers.',
      headActions
    )}

    <div class="grid ${canReadContract && canReadProvider ? 'grid-4' : 'grid-2'}" style="margin-bottom:20px">
      ${canReadProvider ? `
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricProviders') || 'Active providers')}</h3>${iconChip('apartment', 'indigo')}</div>
        <div class="metric-value">${summary.providers?.active ?? 0}</div>
        <div class="cell-sub">${summary.providers?.total ?? 0} total</div>
      </div>` : ''}
      ${canReadContract ? `
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricContracts') || 'Active contracts')}</h3>${iconChip('description', 'blue')}</div>
        <div class="metric-value">${summary.contracts?.active ?? 0}</div>
        <div class="cell-sub">${summary.contracts?.total ?? 0} total</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricExpiring') || 'Expiring ≤60 days')}</h3>${iconChip('event_upcoming', summary.expiringWithin60Days ? 'amber' : 'emerald')}</div>
        <div class="metric-value">${summary.expiringWithin60Days ?? 0}</div>
      </div>
      <div class="card card-pad metric">
        <div class="metric-top"><h3 class="card-title">${esc(t('providers.metricExpired') || 'Expired')}</h3>${iconChip('event_busy', summary.contracts?.expired ? 'rose' : 'slate')}</div>
        <div class="metric-value">${summary.contracts?.expired ?? 0}</div>
      </div>` : ''}
    </div>

    ${(canReadProvider && canReadContract) ? `
    <div class="tabs" id="pc-tabs" role="tablist">
      <button type="button" class="tab ${tab === 'providers' ? 'active' : ''}" data-tab="providers" role="tab">
        <span class="ms">apartment</span> ${esc(t('providers.tabProviders') || 'Providers')}
        <span class="cell-sub" style="margin-left:6px">${providers.length}</span>
      </button>
      <button type="button" class="tab ${tab === 'contracts' ? 'active' : ''}" data-tab="contracts" role="tab">
        <span class="ms">description</span> ${esc(t('providers.tabContracts') || 'Contracts')}
        <span class="cell-sub" style="margin-left:6px">${filtersActive ? `${visibleContracts.length}/${contracts.length}` : contracts.length}</span>
      </button>
    </div>` : ''}

    <div id="pc-body"></div>`;

  const body = $('#pc-body', el);

  if (tab === 'providers') {
    renderProvidersTab(body, providers, {
      canEditProvider,
      canDeleteProvider,
      canEditContract: canEditContract && canReadContract,
      canReadContract,
      canCreateContract: canCreateContract && canReadContract,
      refresh,
      setTab,
    });
  } else {
    renderContractsTab(body, visibleContracts, providers, {
      canEditContract,
      canDeleteContract,
      refresh,
      filterProvider,
      providerFilterId,
      statusFilter,
      searchQ,
      filtersActive,
      allCount: contracts.length,
      setContractFilters,
      clearFilter: () => setTab('contracts'),
      canReadProvider,
    });
  }

  el.querySelectorAll('#pc-tabs [data-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
  });

  $('#pc-new-provider', el)?.addEventListener('click', () => openProviderForm(null, refresh));
  $('#pc-new-contract', el)?.addEventListener('click', () => openContractForm(
    filterProvider ? { providerId: filterProvider.id } : null,
    providers,
    refresh
  ));
};

function renderProvidersTab(el, providers, opts = {}) {
  const {
    canEditProvider = false,
    canDeleteProvider = false,
    canEditContract = false,
    canReadContract = false,
    canCreateContract = false,
    refresh,
    setTab,
  } = opts;
  const canReadDocs = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canUploadDocs = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
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

  const joinMeta = (parts) => parts.filter(Boolean).join('<span class="pc-sep" aria-hidden="true">·</span>');

  el.innerHTML = `
    <div class="pc-provider-list">
      ${providers.map((p) => {
        const contactList = (Array.isArray(p.contacts) && p.contacts.length)
          ? p.contacts
          : (p.contactName ? [{
            name: p.contactName,
            role: p.contactRole,
            email: p.contactEmail,
            phone: p.contactPhone,
            isPrimary: true,
          }] : []);
        const siteHref = p.website ? safeHref(p.website) : null;
        const siteLabel = p.website ? esc(String(p.website).replace(/^https?:\/\//, '')) : '';
        const companyMeta = joinMeta([
          p.email && `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`,
          p.phone && `<span class="mono">${esc(p.phone)}</span>`,
          p.website && (siteHref
            ? `<a href="${esc(siteHref)}" target="_blank" rel="noopener noreferrer">${siteLabel}</a>`
            : `<span>${siteLabel}</span>`),
          p.accountNumber && `<span class="mono">${esc(p.accountNumber)}</span>`,
        ]);
        const supportMeta = joinMeta([
          p.supportEmail && `<a href="mailto:${esc(p.supportEmail)}">${esc(p.supportEmail)}</a>`,
          p.supportPhone && `<span class="mono">${esc(p.supportPhone)}</span>`,
          p.supportPortal && (() => {
            const href = safeHref(p.supportPortal);
            return href
              ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t('providers.portal') || 'Support portal')}</a>`
              : `<span>${esc(p.supportPortal)}</span>`;
          })(),
        ]);
        return `
        <article class="card pc-provider-card" data-provider-card="${esc(p.id)}">
          <header class="pc-provider-head">
            <div class="pc-provider-identity">
              <div class="pc-provider-title-wrap">
                <div class="pc-provider-title-row">
                  <h3 class="pc-provider-title">${esc(p.name)}</h3>
                  <span class="pc-provider-pills">
                    <span class="pill pill-blue">${esc(p.category)}</span>
                    ${statusPill(p.status)}
                  </span>
                </div>
                ${companyMeta ? `<div class="pc-meta-line">${companyMeta}</div>` : ''}
              </div>
            </div>
            ${(canEditProvider || canDeleteProvider) ? `
            <div class="actions pc-provider-actions">
              ${canEditProvider ? `<button class="btn btn-outline btn-sm" data-edit-provider="${esc(p.id)}" title="Edit"><span class="ms">edit</span></button>` : ''}
              ${canDeleteProvider ? `<button class="btn btn-outline btn-sm" data-del-provider="${esc(p.id)}" title="Delete"><span class="ms">delete</span></button>` : ''}
            </div>` : ''}
          </header>

          ${p.notes ? `<p class="pc-provider-notes" title="${esc(p.notes)}">${esc(p.notes)}</p>` : ''}

          ${contactList.length ? `
          <ul class="pc-contact-list">
            ${contactList.map((c) => {
              const detail = joinMeta([
                c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
                c.phone && `<span class="mono">${esc(c.phone)}</span>`,
              ]);
              return `
              <li class="pc-contact-item ${c.isPrimary ? 'is-primary' : ''}">
                <div class="pc-contact-who">
                  <span class="pc-contact-name">${esc(c.name)}</span>
                  ${c.isPrimary ? `<span class="pc-primary-dot" title="${esc(t('providers.primaryBadge') || 'Primary')}"></span>` : ''}
                  ${c.role ? `<span class="pc-contact-role">${esc(c.role)}</span>` : ''}
                </div>
                ${detail ? `<div class="pc-contact-detail">${detail}</div>` : ''}
              </li>`;
            }).join('')}
          </ul>` : ''}

          ${supportMeta ? `
          <div class="pc-support-line">
            <span class="pc-support-label">${esc(t('providers.support') || 'Support')}</span>
            <span class="pc-meta-line">${supportMeta}</span>
          </div>` : ''}

          <footer class="pc-provider-foot">
            ${canReadDocs || canUploadDocs ? `
            <button class="btn btn-outline btn-sm" data-provider-docs="${esc(p.id)}">
              <span class="ms">attach_file</span>
              ${esc(t('common.documents') || 'Documents')}${canReadDocs ? ` (${p.documentCount || 0})` : ''}
            </button>` : ''}
            ${canReadContract ? `
            <button class="btn btn-outline btn-sm" data-show-contracts="${esc(p.id)}">
              <span class="ms">description</span>
              ${esc(t('providers.viewContracts') || 'Contracts')} (${p.contractCount || 0})
            </button>` : ''}
            ${canCreateContract ? `
            <button class="btn btn-primary btn-sm" data-add-contract-for="${esc(p.id)}">
              <span class="ms">add</span> ${esc(t('providers.addContract') || 'Add contract')}
            </button>` : ''}
          </footer>
        </article>`;
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

function renderContractsTab(el, contracts, providers, opts = {}) {
  const canViewCosts = Auth.canIam('contract', 'view_confidential') || Auth.can('canViewContractCosts');
  const canReadDocs = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canUploadDocs = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
  const {
    canEditContract = false,
    canDeleteContract = false,
    refresh,
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
                ${canReadDocs && (c.documentCount || 0) > 0 ? ` · ${c.documentCount} doc` : ''}
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
              <div>${canViewCosts && c.costAmount != null ? fmtMoney(c.costAmount, c.costCurrency) : '—'}</div>
              <div class="cell-sub">${canViewCosts ? esc(c.billingCycle || '') : ''}</div>
            </td>
            <td>${esc((c.ownerEmployee && c.ownerEmployee.fullName) || '—')}</td>
            <td>
              ${statusPill(c.status)}
              ${c.visibility === 'Confidential'
                ? `<div style="margin-top:4px"><span class="pill pill-indigo">${esc(t('providers.visibilityConfidential') || 'Confidential')}</span></div>`
                : ''}
            </td>
            <td class="actions">
              ${canReadDocs || canUploadDocs ? `
              <button class="btn btn-outline btn-sm" data-contract-docs="${esc(c.id)}" title="${esc(t('common.documents') || 'Documents')}">
                <span class="ms">attach_file</span>${canReadDocs && (c.documentCount || 0) ? ` ${c.documentCount}` : ''}
              </button>` : ''}
              ${canEditContract ? `
              <button class="btn btn-outline btn-sm" data-edit-contract="${esc(c.id)}"><span class="ms">edit</span></button>` : ''}
              ${canDeleteContract ? `
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
  let contacts = Array.isArray(provider?.contacts) && provider.contacts.length
    ? provider.contacts.map((c, i) => ({
      key: c.id || `n${i}`,
      name: c.name || '',
      role: c.role || '',
      email: c.email || '',
      phone: c.phone || '',
      isPrimary: !!c.isPrimary,
    }))
    : (provider?.contactName
      ? [{
        key: 'legacy',
        name: provider.contactName || '',
        role: provider.contactRole || '',
        email: provider.contactEmail || '',
        phone: provider.contactPhone || '',
        isPrimary: true,
      }]
      : []);

  const syncContactsFromDom = (host) => {
    host.querySelectorAll('[data-pc-idx]').forEach((card) => {
      const i = Number(card.dataset.pcIdx);
      if (!contacts[i]) return;
      contacts[i].name = card.querySelector('[data-pc-field="name"]')?.value?.trim() || '';
      contacts[i].role = card.querySelector('[data-pc-field="role"]')?.value?.trim() || '';
      contacts[i].email = card.querySelector('[data-pc-field="email"]')?.value?.trim() || '';
      contacts[i].phone = card.querySelector('[data-pc-field="phone"]')?.value?.trim() || '';
      contacts[i].isPrimary = !!card.querySelector('[data-pc-field="primary"]')?.checked;
    });
  };

  const renderContactsHtml = () => {
    if (!contacts.length) {
      return `<div class="pc-contacts-empty cell-sub">${esc(t('providers.contactsEmpty') || 'No contacts yet. Add account managers, sales, or technical contacts.')}</div>
        <button type="button" class="btn btn-outline btn-sm" data-pc-add><span class="ms">person_add</span> ${esc(t('providers.addContact') || 'Add contact')}</button>`;
    }
    const rolePh = t('providers.contactRolePh') || 'Account manager';
    return `
      <div class="pc-contact-cards">
        ${contacts.map((c, idx) => `
          <div class="pc-contact-card ${c.isPrimary ? 'is-primary' : ''}" data-pc-idx="${idx}">
            <div class="pc-contact-card-top">
              <span class="ms">person</span>
              <label class="pc-primary-toggle">
                <input type="radio" name="pc-primary" data-pc-field="primary" ${c.isPrimary ? 'checked' : ''}>
                <span>${esc(t('providers.primaryBadge') || 'Primary')}</span>
              </label>
              <div class="pc-contact-card-actions">
                <button type="button" class="btn btn-outline btn-sm" data-pc-del="${idx}" title="${esc(t('common.delete') || 'Delete')}"><span class="ms">delete</span></button>
              </div>
            </div>
            <div class="pc-contact-fields">
              <input type="text" data-pc-field="name" value="${esc(c.name)}" placeholder="${esc(t('providers.contactName') || 'Name *')}" autocomplete="off">
              <input type="text" data-pc-field="role" value="${esc(c.role)}" placeholder="${esc(rolePh)}" autocomplete="off">
              <input type="email" data-pc-field="email" value="${esc(c.email)}" placeholder="${esc(t('providers.contactEmail') || 'Email')}" autocomplete="off">
              <input type="text" data-pc-field="phone" value="${esc(c.phone)}" placeholder="${esc(t('providers.contactPhone') || 'Phone')}" autocomplete="off">
            </div>
          </div>`).join('')}
      </div>
      <button type="button" class="btn btn-outline btn-sm" data-pc-add style="margin-top:10px"><span class="ms">person_add</span> ${esc(t('providers.addContact') || 'Add contact')}</button>`;
  };

  const refreshContacts = (host) => {
    host.innerHTML = renderContactsHtml();
    bindContactHost(host);
  };

  const bindContactHost = (host) => {
    host.querySelector('[data-pc-add]')?.addEventListener('click', (e) => {
      e.preventDefault();
      syncContactsFromDom(host);
      const makePrimary = !contacts.length;
      contacts.push({
        key: `n${Date.now()}`,
        name: '', role: '', email: '', phone: '',
        isPrimary: makePrimary,
      });
      refreshContacts(host);
      host.querySelector('[data-pc-idx]:last-child [data-pc-field="name"]')?.focus();
    });
    host.querySelectorAll('[data-pc-del]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        syncContactsFromDom(host);
        const i = Number(b.dataset.pcDel);
        const wasPrimary = contacts[i]?.isPrimary;
        contacts.splice(i, 1);
        if (wasPrimary && contacts[0]) contacts[0].isPrimary = true;
        refreshContacts(host);
      });
    });
    host.querySelectorAll('[data-pc-field="primary"]').forEach((r) => {
      r.addEventListener('change', () => {
        syncContactsFromDom(host);
        contacts.forEach((c, j) => {
          c.isPrimary = host.querySelector(`[data-pc-idx="${j}"] [data-pc-field="primary"]`)?.checked || false;
        });
        host.querySelectorAll('.pc-contact-card').forEach((card) => {
          card.classList.toggle('is-primary', !!card.querySelector('[data-pc-field="primary"]')?.checked);
        });
      });
    });
  };

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
      {
        type: 'html', full: true, id: 'pc-contacts-host',
        label: 'providers.contacts',
        html: `<div id="pc-contacts-list">${renderContactsHtml()}</div>`,
      },
      { name: 'supportEmail', label: 'Support email', value: provider?.supportEmail || '' },
      { name: 'supportPhone', label: 'Support phone', value: provider?.supportPhone || '' },
      { name: 'supportPortal', label: 'Support portal URL', value: provider?.supportPortal || '', full: true },
      { name: 'notes', label: 'Notes', type: 'textarea', value: provider?.notes || '', full: true },
    ],
    onMount(overlay) {
      const list = overlay.querySelector('#pc-contacts-list');
      if (list) bindContactHost(list);
    },
    async onSubmit(d) {
      const list = document.getElementById('pc-contacts-list');
      if (list) syncContactsFromDom(list);
      const cleaned = contacts
        .map((c, i) => ({
          name: String(c.name || '').trim(),
          role: String(c.role || '').trim(),
          email: String(c.email || '').trim(),
          phone: String(c.phone || '').trim(),
          isPrimary: !!c.isPrimary,
          sortOrder: i,
        }))
        .filter((c) => c.name);
      if (contacts.some((c) => String(c.name || '').trim() === '' && (c.role || c.email || c.phone))) {
        throw new Error(t('providers.contactNameRequired') || 'Contact name is required');
      }
      if (cleaned.length && !cleaned.some((c) => c.isPrimary)) cleaned[0].isPrimary = true;
      const body = { ...d, contacts: cleaned };
      if (isEdit) {
        await api(`/providers/${provider.id}`, { method: 'PATCH', body });
        toast('Provider updated', 'success');
      } else {
        await api('/providers', { method: 'POST', body });
        toast('Provider created', 'success');
      }
      done();
    },
  });
}

async function openContractForm(contract, providers, done) {
  const isEdit = !!(contract && contract.id);
  if (!providers.length && !isEdit) {
    toast(t('providers.needProviderFirst') || 'Add a provider first, then attach a contract.', 'error');
    return;
  }
  const cats = catalogContractCategories();
  const { defs: cfDefs, values: cfValues } = await fetchCustomFields('contract', contract?.id);
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
      ...((Auth.canIam('contract', 'view_confidential') || Auth.can('canViewContractCosts')) ? [
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
      ] : []),
      {
        name: 'ownerEmployeeId', label: 'Internal owner', type: 'employeeSearch',
        value: contract?.ownerEmployee?.id || '',
        selected: contract?.ownerEmployee || null,
        selectedLabel: contract?.ownerEmployee?.fullName || '',
        full: true,
      },
      { name: 'notes', label: 'Notes', type: 'textarea', value: contract?.notes || '', full: true },
      ...customFieldsAsFormFields(cfDefs, cfValues),
    ],
    async onSubmit(d) {
      const { body, values } = peelCustomFieldPayload(d, cfDefs);
      if (!body.providerId) throw new Error('Select a provider');
      body.autoRenew = body.autoRenew === 'true' || body.autoRenew === true;
      let id = contract?.id;
      if (isEdit) {
        await api(`/contracts/${contract.id}`, { method: 'PATCH', body });
        toast('Contract updated', 'success');
      } else {
        const created = await api('/contracts', { method: 'POST', body });
        id = created?.id;
        toast('Contract created', 'success');
      }
      if (cfDefs.length && id) await saveCustomFieldValues('contract', id, values);
      done();
    },
  });
}

/** Documents archive modal for a provider or contract (PDF / PNG / JPEG / WebP). */
async function openEntityDocs({ kind, id, title, onDone }) {
  const canRead = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canDownload = Auth.canIam('document', 'download') || Auth.can('canDownloadDocuments');
  const canUpload = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
  const canDel = Auth.canIam('document', 'delete') || Auth.can('canDeleteDocuments');
  if (!canRead && !canUpload) {
    toast(t('common.forbidden') || 'You do not have permission to view documents', 'error');
    return;
  }
  const base = kind === 'provider' ? `/providers/${id}` : `/contracts/${id}`;
  const dlBase = kind === 'provider'
    ? '/api/providers/documents'
    : '/api/contracts/documents';
  const delBase = kind === 'provider' ? '/providers/documents' : '/contracts/documents';

  const fmtKB = (n) => (n >= 1024 * 1024
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`);

  try {
    const documents = canRead ? await api(`${base}/documents`).catch(() => []) : [];
    openModal({
      title: `${title} — ${t('common.documents') || 'Documents'} (${documents.length})`,
      wide: true,
      body: `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div class="cell-sub">${esc(t('providers.docsHint') || 'Upload signed contracts, SLAs, invoices or account forms (PDF, PNG, JPEG, WebP — max 8MB).')}</div>
          ${canUpload ? `<button class="btn btn-primary btn-sm" id="pc-doc-upload"><span class="ms">upload_file</span> ${esc(t('common.upload') || 'Upload')}</button>` : ''}
        </div>
        <input type="file" id="pc-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
        ${!canRead
          ? `<div class="table-empty">${esc(t('providers.docsNoRead') || 'Upload allowed — listing requires document:read.')}</div>`
          : (documents.length === 0
          ? `<div class="table-empty">${esc(t('providers.docsEmpty') || 'No documents yet.')}</div>`
          : `<div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
              <thead><tr><th>Document</th><th>Size</th><th>Added</th><th style="text-align:right"></th></tr></thead>
              <tbody>
                ${documents.map((d) => `
                <tr>
                  <td>${docFileLabel(d, { canDownload, viewAttr: 'data-pc-view' })}</td>
                  <td class="cell-sub">${fmtKB(d.byteSize || 0)}</td>
                  <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' · ' + esc(d.uploadedByName) : ''}</td>
                  <td class="actions">
                    ${docRowActions(d, { canDownload, canDel, viewAttr: 'data-pc-view', dlAttr: 'data-pc-dl', delAttr: 'data-pc-del' })}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>`)}`,
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
              openEntityDocs({ kind, id, title, onDone });
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
              openEntityDocs({ kind, id, title, onDone });
            });
          });
        });
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}
