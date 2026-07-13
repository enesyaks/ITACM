Views.maintenance = async function (el, params = {}) {
  const openOnly = params.open !== 'false';
  const logs = await api('/maintenance' + (openOnly ? '?open=true' : ''));

  el.innerHTML = `
    ${pageHead('Maintenance & Repair', 'Track devices in service and repair costs.')}
    <div class="toolbar">
      <select id="mn-filter">
        <option value="true" ${openOnly ? 'selected' : ''}>Open repairs</option>
        <option value="false" ${!openOnly ? 'selected' : ''}>All logs</option>
      </select>
      <div class="spacer"></div>
      <span class="cell-sub">To send an asset to repair, use the Repair action in Hardware Inventory.</span>
    </div>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Asset</th><th>Service Company</th><th>Issue</th><th>Cost</th><th>Sent</th><th>Returned</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${logs.length === 0 ? '<tr><td colspan="7" class="table-empty">No maintenance logs.</td></tr>' :
          logs.map((m) => `
          <tr>
            <td class="mono">${esc(m.assetTag)}</td>
            <td class="cell-title">${esc(m.serviceCompany)}</td>
            <td>${esc(m.issueDescription)}</td>
            <td>${m.cost != null ? fmtMoney(m.cost) : '—'}</td>
            <td>${fmtDate(m.sentDate)}</td>
            <td>${m.returnDate ? fmtDate(m.returnDate) : badge('In Repair')}</td>
            <td class="actions">
              <button class="btn btn-outline btn-sm" data-notes="${esc(m.id)}">
                <span class="ms">chat</span> Notes (${(m.progressNotes || []).length})</button>
              ${!m.returnDate ? `<button class="btn btn-outline btn-sm" data-closelog="${esc(m.id)}">Close</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table></div></div>`;

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
      title: `Close repair — ${m.assetTag}`,
      fields: [
        { name: 'cost', label: `Final cost (${appCurrency()})`, type: 'number', step: '0.01', value: m.cost },
        { name: 'scrap', label: 'Outcome', type: 'select', value: 'repaired',
          options: [{ value: 'repaired', label: 'Repaired — restore asset' }, { value: 'scrap', label: 'Beyond repair — scrap asset' }] },
        { name: 'resolutionNote', label: 'Resolution note', type: 'textarea', full: true },
      ],
      submitLabel: 'Close repair',
      async onSubmit(d) {
        await api(`/maintenance/${m.id}/close`, {
          method: 'PUT',
          body: { cost: d.cost, resolutionNote: d.resolutionNote, scrap: d.scrap === 'scrap' },
        });
        toast(`Repair closed for ${m.assetTag}`, 'success');
        Views.maintenance(el, params);
      },
    });
  });
};

/* =============================== LICENSES ================================ */
