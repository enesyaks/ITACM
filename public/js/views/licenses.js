Views.licenses = async function (el) {
  const canEdit = Auth.canIamOp('license', 'create') || Auth.canIamOp('license', 'update');
  const canCreateLic = Auth.canIamOp('license', 'create');
  const canAssign = Auth.canIam('license', 'assign') || Auth.canIam('license', 'manage');
  const canRevoke = Auth.canIam('license', 'unassign') || canAssign;
  const canViewCosts = Auth.canIam('license', 'view_confidential') || Auth.can('canViewLicenseCosts');
  const canReadDocs = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canDownloadDocs = Auth.canIam('document', 'download') || Auth.can('canDownloadDocuments');
  const canUploadDocs = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
  const [items, providers, contracts] = await Promise.all([
    api('/licenses'),
    api('/providers').catch(() => []),
    api('/contracts').catch(() => []),
  ]);
  const providerList = Array.isArray(providers) ? providers : (providers.items || []);
  const contractList = Array.isArray(contracts) ? contracts : (contracts.items || []);

  function lifecyclePill(l) {
    const life = l.lifecycle || 'active';
    if (life === 'cancelled') return '<span class="pill pill-slate">Cancelled</span>';
    if (life === 'expired') return `<span class="pill pill-rose">Expired${l.daysLeft != null ? ` · ${Math.abs(l.daysLeft)}d` : ''}</span>`;
    if (life === 'expiring') return `<span class="pill pill-amber">${l.daysLeft}d left</span>`;
    return '<span class="pill pill-emerald">Active</span>';
  }

  function chipTone(l) {
    if (l.lifecycle === 'cancelled') return 'slate';
    if (l.lifecycle === 'expired') return 'rose';
    if (l.lifecycle === 'expiring') return 'amber';
    return 'indigo';
  }

  function purchaseHint(l) {
    const bits = [];
    if (l.providerName) bits.push(l.providerName);
    if (l.purchaseType === 'contract' && l.contractTitle) bits.push(l.contractTitle);
    if (l.purchaseType === 'invoice' && l.invoiceNumber) bits.push(`Invoice ${l.invoiceNumber}`);
    if (l.documentCount) bits.push(`${l.documentCount} file${l.documentCount === 1 ? '' : 's'}`);
    return bits.length ? `<div class="cell-sub">${esc(bits.join(' · '))}</div>` : '';
  }

  el.innerHTML = `
    ${pageHead('Software & Licenses', 'Pools, seats, provider purchase link, contracts / invoices, renewals.', canEdit ?
      `<button class="btn btn-primary" id="lic-new"><span class="ms">add</span> New License</button>` : '')}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Software</th><th>Provider</th><th>Purchase</th><th>Seats</th><th>Status</th><th>Expires</th>
        <th style="text-align:right"></th>
      </tr></thead>
      <tbody>
        ${items.length === 0 ? '<tr><td colspan="7" class="table-empty">No licenses.</td></tr>' :
          items.map((l) => {
            const used = l.usedSeats || 0;
            const pct = Math.min(100, Math.round((used / l.totalSeats) * 100));
            const parts = [];
            if (l.assignedUsers) parts.push(`${l.assignedUsers} user${l.assignedUsers === 1 ? '' : 's'}`);
            if (l.linkedAssets) parts.push(`${l.linkedAssets} device${l.linkedAssets === 1 ? '' : 's'}`);
            const seatHint = parts.length ? `<div class="cell-sub">${esc(parts.join(' · '))}</div>` : '';
            const cancelled = l.lifecycle === 'cancelled';
            const purchaseLabel = l.purchaseType === 'contract'
              ? (l.contractTitle || 'Contract')
              : l.purchaseType === 'invoice'
                ? (l.invoiceNumber ? `Invoice ${l.invoiceNumber}` : 'Invoice')
                : '—';
            return `
            <tr style="${cancelled ? 'opacity:.72' : ''}">
              <td><div style="display:flex;align-items:center;gap:12px">${iconChip('vpn_key', chipTone(l))}
                <div>
                  <span class="cell-title">${esc(l.softwareName)}</span>
                  ${l.licenseKey
                    ? `<div class="cell-sub mono">${esc(l.licenseKey)}</div>`
                    : '<div class="cell-sub">No license key</div>'}
                  ${l.renewedAt ? `<div class="cell-sub">Renewed ${fmtDate(l.renewedAt)}</div>` : ''}
                  ${cancelled && l.cancelledAt ? `<div class="cell-sub">Cancelled ${fmtDate(l.cancelledAt)}</div>` : ''}
                </div></div></td>
              <td>${esc(l.providerName || l.vendor || '—')}${purchaseHint(l)}</td>
              <td>
                <div class="cell-title" style="font-size:13px">${esc(purchaseLabel)}</div>
                ${l.purchaseAmount != null
                  ? `<div class="cell-sub">${canViewCosts ? esc(fmtMoney(l.purchaseAmount, l.purchaseCurrency)) : '—'}</div>` : ''}
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="seat-bar"><i style="width:${pct}%"></i></div>
                  <span class="cell-sub">${used}/${l.totalSeats}</span>
                </div>
                ${seatHint}
              </td>
              <td>${lifecyclePill(l)}</td>
              <td>${fmtDate(l.expirationDate)}</td>
              <td class="actions">
                <button class="btn btn-outline btn-sm" data-holders="${esc(l.id)}" title="Assigned"><span class="ms">group</span></button>
                ${Number(l.discoveredInstalls) > 0
                  ? `<button class="btn btn-outline btn-sm" data-sam="${esc(l.id)}" title="SAM — discovered installs (${Number(l.discoveredInstalls)})"><span class="ms">analytics</span></button>`
                  : ''}
                ${(canReadDocs || canUploadDocs) ? `
                <button class="btn btn-outline btn-sm" data-docs="${esc(l.id)}" title="Documents">
                  <span class="ms">attach_file</span>${canReadDocs && l.documentCount ? ` ${l.documentCount}` : ''}
                </button>` : ''}
                ${canEdit ? `
                <button class="btn btn-outline btn-sm" data-edit="${esc(l.id)}" title="Edit"><span class="ms">edit</span></button>
                ${canCreateLic ? `
                <button class="btn btn-outline btn-sm" data-duplicate="${esc(l.id)}" title="${esc(t('common.duplicate'))}"><span class="ms">content_copy</span></button>` : ''}
                ${!cancelled ? `
                <button class="btn btn-outline btn-sm" data-renew="${esc(l.id)}" title="Renew"><span class="ms">autorenew</span></button>
                <button class="btn btn-outline btn-sm" data-cancel-lic="${esc(l.id)}" title="Cancel"><span class="ms">cancel</span></button>` : `
                <button class="btn btn-primary btn-sm" data-renew="${esc(l.id)}"><span class="ms">autorenew</span> Renew</button>`}
                ` : ''}
                ${canAssign && !cancelled ? `
                <button class="btn btn-primary btn-sm" data-assign="${esc(l.id)}" title="Assign"><span class="ms">person_add</span></button>` : ''}
              </td>
            </tr>`;
          }).join('')}
      </tbody>
    </table></div></div>`;

  if (canEdit) {
    $('#lic-new', el).addEventListener('click', () => openLicenseForm({
      providers: providerList, contracts: contractList, onDone: () => Views.licenses(el),
    }));
  }

  bindView(el, async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const lic = (id) => items.find((x) => x.id === id);

    if (b.dataset.edit && canEdit) {
      openLicenseForm({
        license: lic(b.dataset.edit),
        providers: providerList,
        contracts: contractList,
        onDone: () => Views.licenses(el),
      });
      return;
    }

    if (b.dataset.duplicate && canCreateLic) {
      const l = lic(b.dataset.duplicate);
      // License keys are unique to a purchase — a copy starts without one.
      const { id, ...rest } = l;
      openLicenseForm({
        seed: {
          ...rest,
          licenseKey: '',
          softwareName: `${l.softwareName} (Copy)`,
          duplicateOf: l.softwareName,
        },
        providers: providerList,
        contracts: contractList,
        onDone: () => Views.licenses(el),
      });
      return;
    }

    if (b.dataset.docs) {
      openLicenseDocs({ license: lic(b.dataset.docs), onDone: () => Views.licenses(el),
      });
      return;
    }

    if (b.dataset.sam) {
      try {
        const report = await api(`/integrations/licenses/${b.dataset.sam}/sam`);
        openModal({
          title: `SAM — ${esc(report.softwareName)}`,
          body: `
            <p class="cell-sub">Seats ${report.totalSeats} · assigned ${report.assignedSeats} · discovered installs ${report.installedCount}
              ${report.overInstalled ? ' · <span class="pill pill-rose">Over-installed</span>' : ''}</p>
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Host / tag</th><th>Version</th><th>Seen</th></tr></thead>
              <tbody>
                ${(report.installs || []).length === 0
                  ? '<tr><td colspan="3" class="table-empty">No installs synced yet. POST /api/integrations/sync/software-installs</td></tr>'
                  : report.installs.map((x) => `<tr>
                      <td>${esc(x.hostname || x.assetTag || '—')}</td>
                      <td class="mono">${esc(x.version || '—')}</td>
                      <td class="cell-sub">${x.seenAt ? fmtDate(x.seenAt) : '—'}</td>
                    </tr>`).join('')}
              </tbody>
            </table></div>`,
          foot: '<button class="btn btn-outline" data-close>Close</button>',
        });
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    if (b.dataset.seat && canEdit) {
      try {
        await api(`/licenses/${b.dataset.seat}/seats`, { method: 'POST', body: { delta: Number(b.dataset.delta) } });
        toast('Seat pool updated', 'success');
        Views.licenses(el);
      } catch (err) { toast(err.message, 'error'); }
    }

    if (b.dataset.renew && canEdit) {
      const l = lic(b.dataset.renew);
      const defDate = (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().slice(0, 10);
      })();
      formModal({
        title: `Renew ${l.softwareName}`,
        fields: [
          { name: 'expirationDate', label: 'New expiration date *', type: 'date', required: true, value: defDate },
          { name: 'licenseKey', label: 'New license key (optional)', value: '', full: true },
        ],
        submitLabel: 'Mark renewed',
        async onSubmit(d) {
          if (!d.expirationDate) throw new Error('Expiration date is required');
          const body = { expirationDate: d.expirationDate };
          if (d.licenseKey && String(d.licenseKey).trim()) body.licenseKey = String(d.licenseKey).trim();
          await api(`/licenses/${l.id}/renew`, { method: 'POST', body });
          toast(`${l.softwareName} renewed`, 'success');
          Views.licenses(el);
        },
      });
    }

    if (b.dataset.cancelLic && canEdit) {
      const l = lic(b.dataset.cancelLic);
      formModal({
        title: `Cancel ${l.softwareName}`,
        fields: [
          { name: 'note', label: 'Reason (optional)', full: true,
            placeholder: 'e.g. Not renewing — migrated to another vendor' },
        ],
        submitLabel: 'Mark cancelled',
        async onSubmit(d) {
          await api(`/licenses/${l.id}/cancel`, { method: 'POST', body: { note: d.note || '' } });
          toast(`${l.softwareName} cancelled`, 'success');
          Views.licenses(el);
        },
      });
    }

    if (b.dataset.assign && canAssign) {
      const l = lic(b.dataset.assign);
      const employees = employeeList(await api('/employees?status=Active&limit=500')).items;
      formModal({
        title: `Assign ${l.softwareName} to employee`,
        fields: [{
          name: 'employeeId', label: 'Employee *', type: 'select', required: true,
          options: [{ value: '', label: 'Select employee…' },
            ...employees.map((p) => ({ value: p.id, label: `${p.fullName} — ${p.department || ''}` }))],
          full: true,
        }],
        submitLabel: 'Assign software',
        async onSubmit(d) {
          if (!d.employeeId) throw new Error('Select an employee');
          const r = await api(`/licenses/${l.id}/assign`, { method: 'POST', body: { employeeId: d.employeeId } });
          toast(`${r.softwareName} assigned to ${r.employeeName}`, 'success');
          Views.licenses(el);
        },
      });
    }

    if (b.dataset.holders) {
      const l = lic(b.dataset.holders);
      const [assignments, devices] = await Promise.all([
        api(`/licenses/${l.id}/assignments`),
        api(`/licenses/${l.id}/assets`),
      ]);
      const total = assignments.length + devices.length;
      const usersBlock = assignments.length === 0 ? '' : `
        <div class="cell-sub" style="margin:4px 0 8px;font-weight:600">Users (${assignments.length})</div>
        ${assignments.map((a) => `
          <div class="history-item" style="justify-content:space-between">
            <span><span class="avatar" style="width:26px;height:26px;font-size:10px;margin-right:8px">${esc(initials(a.employeeName))}</span>
              <strong>${esc(a.employeeName)}</strong></span>
            <span class="cell-sub">${fmtDate(a.assignedAt)} • by ${esc(a.assignedByName || '—')}</span>
            ${canRevoke ? `<button class="btn btn-outline btn-sm" data-revoke-lic="${esc(a.id)}">Revoke</button>` : ''}
          </div>`).join('')}`;
      const devicesBlock = devices.length === 0 ? '' : `
        <div class="cell-sub" style="margin:${assignments.length ? '16px' : '4px'} 0 8px;font-weight:600">Devices (${devices.length})</div>
        ${devices.map((a) => `
          <div class="history-item" style="justify-content:space-between">
            <span>
              <span class="mono" style="margin-right:8px">${esc(a.assetTag)}</span>
              <strong>${esc([a.brand, a.model].filter(Boolean).join(' ') || a.category || '—')}</strong>
              <span class="cell-sub" style="margin-left:8px">${esc(a.serialNumber || '')}</span>
            </span>
            <span class="cell-sub">${esc(a.status || '')}${a.location ? ' · ' + esc(a.location) : ''}</span>
          </div>`).join('')}`;
      openModal({
        title: `${l.softwareName} — Assigned (${total})`,
        body: total === 0
          ? '<div class="cell-sub">No users or devices linked to this license yet.</div>'
          : `${usersBlock}${devicesBlock}`,
        foot: `<button class="btn btn-outline" data-close>Close</button>`,
        onMount(overlay) {
          overlay.querySelectorAll('[data-revoke-lic]').forEach((rb) => rb.addEventListener('click', async () => {
            try {
              const r = await api(`/licenses/assignments/${rb.dataset.revokeLic}/revoke`, { method: 'POST' });
              toast(`${r.softwareName} revoked from ${r.employeeName}`, 'success');
              closeModal();
              Views.licenses(el);
            } catch (err) { toast(err.message, 'error'); }
          }));
        },
      });
    }
  });
};

/** Create / edit license with provider + contract or invoice purchase proof. */
function openLicenseForm({ license = null, seed = null, providers = [], contracts = [], onDone }) {
  const OTHER_PROVIDER = '__other__';
  const canCreateProvider = Auth.canIamOp('provider', 'create');
  // `src` only prefills fields; edit mode (PATCH, title, button) keys off `license`.
  // A duplicate passes `seed` so the form opens filled but saves as a new license.
  const src = license || seed;
  let providerList = providers.filter((p) => (p.status || 'Active') === 'Active' || p.id === src?.providerId);
  const toDate = (v) => (v ? String(v).slice(0, 10) : '');
  const canCosts = Auth.canIam('license', 'view_confidential') || Auth.can('canViewLicenseCosts');

  const providerOptionsHtml = (selectedId) => `
              <option value="">— Select provider —</option>
              ${providerList.map((p) =>
                `<option value="${esc(p.id)}" ${selectedId === p.id ? 'selected' : ''}>${esc(p.name)}${p.category ? ' · ' + esc(p.category) : ''}</option>`
              ).join('')}
              ${canCreateProvider
                ? `<option value="${OTHER_PROVIDER}">Other (create new provider)…</option>`
                : ''}`;

  openModal({
    title: license
      ? `Edit ${license.softwareName}`
      : (seed?.duplicateOf ? `${t('common.duplicate')} — ${seed.duplicateOf}` : 'New License'),
    wide: true,
    body: `
      <form id="lic-form" class="af-form" novalidate>
        <section class="af-sec">
          <div class="af-sec-head"><strong>License</strong><span>Product, seats &amp; expiry</span></div>
          <div class="form-field full"><label>Software *</label>
            <input name="softwareName" required autocomplete="off" placeholder="e.g. Microsoft 365 E3"
              value="${esc(src?.softwareName || '')}"></div>
          <div class="form-field full"><label>License key <span class="ob-hint">optional</span></label>
            <input name="licenseKey" class="mono" autocomplete="off" spellcheck="false"
              placeholder="Leave blank if managed by vendor portal"
              value="${esc(src?.licenseKey || '')}">
            <div class="cell-sub" style="margin-top:4px">Not required for subscription or portal-managed seats.</div>
          </div>
          <div class="form-field"><label>Total seats *</label>
            <input name="totalSeats" type="number" min="1" required value="${esc(src?.totalSeats ?? 1)}"></div>
          <div class="form-field"><label>Expiration *</label>
            <input name="expirationDate" type="date" required value="${esc(toDate(src?.expirationDate))}"></div>
        </section>

        <section class="af-sec">
          <div class="af-sec-head"><strong>Purchase / supplier</strong><span>Link a contract, or record a one-off invoice</span></div>
          <div class="form-field full"><label>Provider</label>
            <select name="providerId" id="lic-provider">
              ${providerOptionsHtml(src?.providerId || '')}
            </select>
            <div class="cell-sub" style="margin-top:4px">${canCreateProvider
              ? 'Choose Other to create a provider without leaving this form. Vendor name fills from provider.'
              : 'Create providers under Providers if missing. Vendor name fills from provider.'}</div>
          </div>
          <div class="form-field full"><label>How was this purchased?</label>
            <select name="purchaseType" id="lic-ptype">
              <option value="" ${!src?.purchaseType ? 'selected' : ''}>— Not set —</option>
              <option value="contract" ${src?.purchaseType === 'contract' ? 'selected' : ''}>Under a contract / agreement</option>
              <option value="invoice" ${src?.purchaseType === 'invoice' ? 'selected' : ''}>One-off invoice (no contract)</option>
            </select>
            <div class="cell-sub" style="margin-top:4px">If a master agreement exists, pick Contract and link it. Otherwise use Invoice.</div>
          </div>
          <div class="form-field full hidden" id="lic-contract-wrap"><label>Linked contract</label>
            <select name="contractId" id="lic-contract">
              <option value="">— Select contract —</option>
            </select>
            <div class="cell-sub" style="margin-top:4px">Only contracts for the selected provider. Upload the signed PDF under Documents after save.</div>
          </div>
          <div class="form-field full hidden" id="lic-invoice-wrap"><label>Invoice number</label>
            <input name="invoiceNumber" value="${esc(src?.invoiceNumber || '')}" placeholder="e.g. INV-2026-0142">
            <div class="cell-sub" style="margin-top:4px">Upload the invoice PDF under Documents after save.</div>
          </div>
          <div class="form-field" id="lic-purchase-date-wrap"><label>Purchase date</label>
            <input name="purchaseDate" type="date" value="${esc(toDate(src?.purchaseDate))}"></div>
          ${canCosts ? `
          <div class="form-field" id="lic-amount-wrap"><label>Amount</label>
            <input name="purchaseAmount" type="number" step="0.01" min="0" value="${esc(src?.purchaseAmount ?? '')}"></div>
          <div class="form-field" id="lic-currency-wrap"><label>Currency</label>
            <select name="purchaseCurrency">
              ${currencyOptionsForSelect(src?.purchaseCurrency || appCurrency()).map((o) =>
                `<option value="${esc(o.value)}" ${(src?.purchaseCurrency || appCurrency()) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
              ).join('')}
            </select></div>` : `
          <input type="hidden" name="purchaseAmount" value="">
          <input type="hidden" name="purchaseCurrency" value="">`}
        </section>
      </form>`,
    foot: `
      <button class="btn btn-outline" data-close>Cancel</button>
      <button class="btn btn-primary" id="lic-save">
        <span class="ms">${license ? 'save' : 'add'}</span>
        ${license ? 'Save changes' : 'Create license'}
      </button>`,
    onMount(overlay) {
      const providerSel = $('#lic-provider', overlay);
      const contractSel = $('#lic-contract', overlay);
      const typeSel = $('#lic-ptype', overlay);
      let prevProviderId = providerSel.value || '';

      const contractWrap = $('#lic-contract-wrap', overlay);
      const invoiceWrap = $('#lic-invoice-wrap', overlay);
      const invoiceInput = invoiceWrap && invoiceWrap.querySelector('input[name="invoiceNumber"]');

      function fillContracts() {
        const pid = providerSel.value;
        if (pid === OTHER_PROVIDER) return;
        const opts = contracts.filter((c) => !pid || c.providerId === pid);
        const cur = contractSel.value || src?.contractId || '';
        contractSel.innerHTML = `<option value="">— Select contract —</option>` + (opts.length
          ? opts.map((c) =>
            `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.title)}${c.contractNumber ? ' · ' + esc(c.contractNumber) : ''} (${esc(c.status || '')})</option>`
          ).join('')
          : `<option value="" disabled>${pid ? 'No contracts for this provider' : 'Select a provider first'}</option>`);
      }

      /** Contract XOR invoice — only the path that matches purchase type is shown. */
      function syncTypeUi({ clearOther = false } = {}) {
        const t = typeSel.value;
        const showContract = t === 'contract';
        const showInvoice = t === 'invoice';
        if (contractWrap) contractWrap.classList.toggle('hidden', !showContract);
        if (invoiceWrap) invoiceWrap.classList.toggle('hidden', !showInvoice);
        if (clearOther) {
          if (!showContract) contractSel.value = '';
          if (!showInvoice && invoiceInput) invoiceInput.value = '';
        }
      }

      function applyCreatedProvider(created) {
        if (!created || !created.id) return;
        if (!providerList.some((p) => p.id === created.id)) providerList.push(created);
        if (Array.isArray(providers) && !providers.some((p) => p.id === created.id)) providers.push(created);
        providerSel.innerHTML = providerOptionsHtml(created.id);
        prevProviderId = created.id;
        fillContracts();
      }

      fillContracts();
      syncTypeUi({ clearOther: false });
      providerSel.addEventListener('change', () => {
        if (providerSel.value === OTHER_PROVIDER) {
          const restore = prevProviderId;
          providerSel.value = restore;
          if (typeof openProviderForm !== 'function') {
            toast('Provider form unavailable — open Providers to create one.', 'error');
            return;
          }
          let saved = false;
          openProviderForm(null, (created) => {
            saved = true;
            applyCreatedProvider(created);
          }, {
            stack: true,
            onClose: () => {
              if (!saved) {
                providerSel.value = restore;
                prevProviderId = restore;
              }
            },
          });
          return;
        }
        prevProviderId = providerSel.value;
        fillContracts();
      });
      typeSel.addEventListener('change', () => syncTypeUi({ clearOther: true }));

      $('#lic-save', overlay).addEventListener('click', async () => {
        const form = $('#lic-form', overlay);
        if (!form.reportValidity()) return;
        const fd = new FormData(form);
        const providerId = fd.get('providerId');
        const purchaseType = fd.get('purchaseType') || null;
        // Enforce one path: contract link OR invoice number — never both.
        const contractId = purchaseType === 'contract' ? (fd.get('contractId') || null) : null;
        const invoiceNumber = purchaseType === 'invoice' ? (fd.get('invoiceNumber') || null) : null;
        if (purchaseType === 'contract' && !contractId) {
          toast('Select a linked contract, or switch purchase type to Invoice.', 'error');
          return;
        }
        const body = {
          softwareName: String(fd.get('softwareName') || '').trim(),
          licenseKey: String(fd.get('licenseKey') || '').trim(),
          totalSeats: Number(fd.get('totalSeats')),
          expirationDate: fd.get('expirationDate'),
          providerId: !providerId || providerId === OTHER_PROVIDER ? null : providerId,
          purchaseType,
          contractId,
          invoiceNumber,
          purchaseDate: fd.get('purchaseDate') || null,
          purchaseAmount: fd.get('purchaseAmount') === '' ? null : fd.get('purchaseAmount'),
          purchaseCurrency: fd.get('purchaseCurrency') || null,
        };
        const btn = $('#lic-save', overlay);
        btn.disabled = true;
        try {
          if (license) await api(`/licenses/${license.id}`, { method: 'PATCH', body });
          else await api('/licenses', { method: 'POST', body });
          toast(license ? 'License updated' : 'License created', 'success');
          closeModal();
          if (onDone) onDone();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      });
    },
  });
}

async function openLicenseDocs({ license, onDone }) {
  const canRead = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canDownload = Auth.canIam('document', 'download') || Auth.can('canDownloadDocuments');
  const canUpload = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
  const canDel = Auth.canIam('document', 'delete') || Auth.can('canDeleteDocuments');
  if (!canRead && !canUpload) {
    toast(t('common.forbidden') || 'You do not have permission to view documents', 'error');
    return;
  }
  const fmtKB = (n) => (n >= 1024 * 1024
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`);

  try {
    const documents = canRead ? await api(`/licenses/${license.id}/documents`).catch(() => []) : [];
    openModal({
      title: `${license.softwareName} — Documents (${documents.length})`,
      wide: true,
      body: `
        <div class="cell-sub" style="margin-bottom:10px">
          ${license.providerName ? `Provider: <strong>${esc(license.providerName)}</strong> · ` : ''}
          ${license.purchaseType === 'contract' && license.contractTitle
            ? `Contract: <strong>${esc(license.contractTitle)}</strong>. `
            : ''}
          Upload invoice PDF or signed agreement (PDF, PNG, JPEG, WebP — max 8MB).
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
          ${canUpload ? `
          <select id="lic-doc-kind" style="max-width:160px">
            <option value="invoice">Invoice</option>
            <option value="contract">Contract</option>
            <option value="other">Other</option>
          </select>
          <button class="btn btn-primary btn-sm" id="lic-doc-upload"><span class="ms">upload_file</span> Upload</button>` : ''}
        </div>
        <input type="file" id="lic-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
        ${!canRead
          ? '<div class="table-empty">Upload allowed — viewing requires document:read.</div>'
          : (documents.length === 0
          ? '<div class="table-empty">No documents yet.</div>'
          : `<div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
              <thead><tr><th>Document</th><th>Type</th><th>Size</th><th>Added</th><th style="text-align:right"></th></tr></thead>
              <tbody>
                ${documents.map((d) => `
                <tr>
                  <td>${docFileLabel(d, { canDownload, viewAttr: 'data-lic-view' })}</td>
                  <td><span class="pill pill-slate">${esc(d.kind || 'other')}</span></td>
                  <td class="cell-sub">${fmtKB(d.byteSize || 0)}</td>
                  <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' · ' + esc(d.uploadedByName) : ''}</td>
                  <td class="actions">
                    ${docRowActions(d, { canDownload, canDel, viewAttr: 'data-lic-view', dlAttr: 'data-lic-dl', delAttr: 'data-lic-del' })}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table></div>`)}`,
      foot: `<button class="btn btn-outline" data-close>Close</button>`,
      onMount(overlay) {
        overlay.querySelectorAll('[data-lic-view]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          viewAuthed(`/api/licenses/documents/${a.dataset.licView}/download`);
        }));
        overlay.querySelectorAll('[data-lic-dl]').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          downloadAuthed(`/api/licenses/documents/${a.dataset.licDl}/download`);
        }));
        overlay.querySelectorAll('[data-lic-del]').forEach((btn) => btn.addEventListener('click', async () => {
          if (!confirm('Delete this document?')) return;
          try {
            await api(`/licenses/documents/${btn.dataset.licDel}`, { method: 'DELETE' });
            toast('Document deleted', 'success');
            closeModal();
            openLicenseDocs({ license, onDone });
            if (onDone) onDone();
          } catch (err) { toast(err.message, 'error'); }
        }));

        const upBtn = $('#lic-doc-upload', overlay);
        const upFile = $('#lic-doc-file', overlay);
        if (upBtn && upFile) {
          upBtn.addEventListener('click', () => upFile.click());
          upFile.addEventListener('change', async () => {
            const file = upFile.files[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) {
              toast('File too large — max 8MB', 'error');
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
              const kind = $('#lic-doc-kind', overlay)?.value || 'invoice';
              await api(`/licenses/${license.id}/documents`, {
                method: 'POST',
                body: { filename: file.name, base64, kind },
              });
              toast('Document uploaded', 'success');
              closeModal();
              openLicenseDocs({ license, onDone });
              if (onDone) onDone();
            } catch (err) {
              toast(err.message, 'error');
              upBtn.disabled = false;
            }
          });
        }
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}
