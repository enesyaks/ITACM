Views.maintenance = async function (el, params = {}) {
  const openOnly = params.open !== 'false';
  const canEdit = Auth.canIam('maintenance', 'update') || Auth.canIam('maintenance', 'manage');
  const canViewCosts = Auth.canIam('maintenance', 'view_confidential') || Auth.can('canViewMaintenanceCosts');
  const logs = await api('/maintenance' + (openOnly ? '?open=true' : ''));

  const mntRowActions = (m) => `<button class="btn btn-outline btn-sm" data-notes="${esc(m.id)}">
      <span class="ms">chat</span> ${esc(t('mnt.notes'))} (${(m.progressNotes || []).length})</button>
    ${canEdit && !m.returnDate ? `<button class="btn btn-outline btn-sm" data-closelog="${esc(m.id)}">${esc(t('common.close'))}</button>` : ''}`;

  const mntCols = columnPicker({
    storageKey: 'itacm_cols_maintenance',
    onChange: () => { const s = $('#mnt-table', el); if (s) s.innerHTML = mntTableHtml(); },
    columns: [
      { key: 'asset', label: t('dash.colAsset'), mandatory: true, tdClass: 'mono', render: (m) => esc(m.assetTag), csv: (m) => m.assetTag || '' },
      { key: 'service', label: t('mnt.colServiceCompany'), mandatory: true, tdClass: 'cell-title', render: (m) => esc(m.serviceCompany), csv: (m) => m.serviceCompany || '' },
      { key: 'issue', label: t('mnt.colIssue'), render: (m) => esc(m.issueDescription), csv: (m) => m.issueDescription || '' },
      ...(canViewCosts ? [{ key: 'cost', label: t('hw.d.cost'), render: (m) => (m.cost != null ? fmtMoney(m.cost) : '—'), csv: (m) => (m.cost != null ? m.cost : '') }] : []),
      { key: 'sent', label: t('mnt.colSent'), render: (m) => fmtDate(m.sentDate), csv: (m) => fmtDate(m.sentDate) || '' },
      { key: 'returned', label: t('mnt.colReturned'), render: (m) => (m.returnDate ? fmtDate(m.returnDate) : badge('In Repair')), csv: (m) => (m.returnDate ? fmtDate(m.returnDate) : 'In Repair') },
    ],
  });
  function mntTableHtml() {
    return `<table class="data">
      <thead><tr>${mntCols.headerCells({})}<th style="text-align:right"></th></tr></thead>
      <tbody>
        ${logs.length === 0 ? `<tr><td colspan="${mntCols.visibleColumns().length + 1}" class="table-empty">${esc(t('mnt.noLogs'))}</td></tr>` :
    logs.map((m) => `<tr>${mntCols.bodyCells(m)}<td class="actions">${mntRowActions(m)}</td></tr>`).join('')}
      </tbody>
    </table>`;
  }

  el.innerHTML = `
    ${pageHead('Maintenance & Repair', 'Track devices in service and repair costs.')}
    <div class="toolbar">
      <select id="mn-filter">
        <option value="true" ${openOnly ? 'selected' : ''}>${esc(t('mnt.openRepairs'))}</option>
        <option value="false" ${!openOnly ? 'selected' : ''}>${esc(t('mnt.allLogs'))}</option>
      </select>
      <div class="spacer"></div>
      <span class="cell-sub">${esc(t('mnt.sendHint'))}</span>
      <div style="margin-left:auto">${mntCols.gearHtml()}</div>
    </div>
    <div class="card"><div class="table-wrap" id="mnt-table">${mntTableHtml()}</div></div>`;

  mntCols.mountGear(el);

  $('#mn-filter', el).addEventListener('change', (e) => Views.maintenance(el, { open: e.target.value }));
  bindView(el, (e) => {
    const nb = e.target.closest('button[data-notes]');
    if (nb) {
      showMaintNotes(logs.find((x) => x.id === nb.dataset.notes), () => Views.maintenance(el, params));
      return;
    }
    const b = e.target.closest('button[data-closelog]'); if (!b) return;
    const m = logs.find((x) => x.id === b.dataset.closelog);
    formModal({
      title: (t('mnt.closeTitle') || 'Close repair — {tag}').replace('{tag}', m.assetTag),
      fields: [
        { name: 'cost', label: (t('mnt.finalCost') || 'Final cost ({cur})').replace('{cur}', appCurrency()), type: 'number', step: '0.01', value: m.cost },
        { name: 'scrap', label: t('mnt.outcome'), type: 'select', value: 'repaired',
          options: [{ value: 'repaired', label: t('mnt.repairedRestore') }, { value: 'scrap', label: t('mnt.beyondScrap') }] },
        { name: 'resolutionNote', label: t('mnt.resolutionNote'), type: 'textarea', full: true },
      ],
      submitLabel: t('mnt.closeRepair'),
      async onSubmit(d) {
        await api(`/maintenance/${m.id}/close`, {
          method: 'PUT',
          body: { cost: d.cost, resolutionNote: d.resolutionNote, scrap: d.scrap === 'scrap' },
        });
        toast((t('mnt.closedToast') || 'Repair closed for {tag}').replace('{tag}', m.assetTag), 'success');
        Views.maintenance(el, params);
      },
    });
  });
};

/* =============================== LICENSES ================================ */
