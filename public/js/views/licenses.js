Views.licenses = async function (el) {
  const canEdit = Auth.can('canManageAssets');
  const items = await api('/licenses');

  el.innerHTML = `
    ${pageHead('Software & Licenses', 'Track license pools, seat usage, and renewal dates.', canEdit ?
      `<button class="btn btn-primary" id="lic-new"><span class="ms">add</span> New License</button>` : '')}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Software</th><th>Vendor</th><th>License Key</th><th>Seats</th><th>Expires</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${items.length === 0 ? '<tr><td colspan="6" class="table-empty">No licenses.</td></tr>' :
          items.map((l) => {
            const pct = Math.min(100, Math.round((l.usedSeats / l.totalSeats) * 100));
            const exp = new Date(l.expirationDate && l.expirationDate._seconds ? l.expirationDate._seconds * 1000 : l.expirationDate);
            const days = Math.ceil((exp - Date.now()) / 86400000);
            return `
            <tr>
              <td><div style="display:flex;align-items:center;gap:12px">${iconChip('vpn_key', days <= 30 ? 'amber' : 'indigo')}
                <span class="cell-title">${esc(l.softwareName)}</span></div></td>
              <td>${esc(l.vendor || '—')}</td>
              <td class="mono">${esc(l.licenseKey)}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="seat-bar"><i style="width:${pct}%"></i></div>
                  <span class="cell-sub">${l.usedSeats}/${l.totalSeats}</span>
                </div>
              </td>
              <td>${fmtDate(l.expirationDate)} ${days <= 30 ? `<span class="pill ${days <= 7 ? 'pill-rose' : 'pill-amber'}">${days}d</span>` : ''}</td>
              <td class="actions">
                <button class="btn btn-outline btn-sm" data-holders="${esc(l.id)}"><span class="ms">group</span> Users</button>
                ${canEdit ? `
                <button class="btn btn-primary btn-sm" data-assign="${esc(l.id)}"><span class="ms">person_add</span> Assign</button>
                <button class="btn btn-outline btn-sm" data-seat="${esc(l.id)}" data-delta="1">+ seat</button>
                <button class="btn btn-outline btn-sm" data-seat="${esc(l.id)}" data-delta="-1">− seat</button>` : ''}</td>
            </tr>`;
          }).join('')}
      </tbody>
    </table></div></div>`;

  if (canEdit) {
    $('#lic-new', el).addEventListener('click', () => formModal({
      title: 'New License',
      fields: [
        { name: 'softwareName', label: 'Software *', required: true },
        { name: 'vendor', label: 'Vendor' },
        { name: 'licenseKey', label: 'License key *', required: true },
        { name: 'totalSeats', label: 'Total seats *', type: 'number', required: true },
        { name: 'expirationDate', label: 'Expiration date *', type: 'date', required: true },
      ],
      async onSubmit(d) {
        await api('/licenses', { method: 'POST', body: d });
        toast('License created', 'success');
        Views.licenses(el);
      },
    }));
  }

  bindView(el, async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const lic = (id) => items.find((x) => x.id === id);

    if (b.dataset.seat && canEdit) {
      try {
        const r = await api(`/licenses/${b.dataset.seat}/seats`, { method: 'POST', body: { delta: Number(b.dataset.delta) } });
        toast(`${r.softwareName}: ${r.usedSeats}/${r.totalSeats} seats used`, 'success');
        Views.licenses(el);
      } catch (err) { toast(err.message, 'error'); }
    }

    // Software zimmet: assign a seat to an employee
    if (b.dataset.assign && canEdit) {
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

    // Who currently holds this license
    if (b.dataset.holders) {
      const l = lic(b.dataset.holders);
      const assignments = await api(`/licenses/${l.id}/assignments`);
      openModal({
        title: `${l.softwareName} — Assigned Users (${assignments.length})`,
        body: assignments.length === 0 ? '<div class="cell-sub">No active assignments.</div>' :
          assignments.map((a) => `
          <div class="history-item" style="justify-content:space-between">
            <span><span class="avatar" style="width:26px;height:26px;font-size:10px;margin-right:8px">${esc(initials(a.employeeName))}</span>
              <strong>${esc(a.employeeName)}</strong></span>
            <span class="cell-sub">${fmtDate(a.assignedAt)} • by ${esc(a.assignedByName || '—')}</span>
            ${canEdit ? `<button class="btn btn-outline btn-sm" data-revoke-lic="${esc(a.id)}">Revoke</button>` : ''}
          </div>`).join(''),
        foot: `<button class="btn btn-outline" data-close>Close</button>
          ${assignments.length ? '<button class="btn btn-primary" id="lic-export"><span class="ms">download</span> Export CSV</button>' : ''}`,
        onMount(overlay) {
          const exp = $('#lic-export', overlay);
          if (exp) exp.addEventListener('click', () => csvDownload(
            `${l.softwareName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-assignments-${new Date().toISOString().slice(0, 10)}.csv`,
            ['Software', 'Employee', 'Email', 'Department', 'Assigned At', 'Assigned By'],
            assignments.map((a) => [l.softwareName, a.employeeName, a.employeeEmail || '', a.department || '', fmtDate(a.assignedAt), a.assignedByName || ''])
          ));
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

/* ============================== CONSUMABLES ============================== */
