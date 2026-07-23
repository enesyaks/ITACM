Views.dashboard = async function (el) {
  const d = await api('/dashboard/stats');
  const hrOn = d.alerts.hrOnboardPending || 0;
  const hrOff = d.alerts.hrOffboardPending || 0;
  // Mirrors the server gate on POST /hr/requests/:id/acknowledge.
  const canAckHr = typeof Auth.canIamOp === 'function' && Auth.canIamOp('hr_request', 'update');
  let hrPending = [];
  if ((hrOn || hrOff) && canAckHr) {
    hrPending = await api('/hr/requests?status=pending').catch(() => []);
    if (!Array.isArray(hrPending)) hrPending = [];
  }
  const a = d.assets;
  const lowest = d.alerts.lowStockConsumables[0];
  const eolOverdue = d.alerts.eolOverdueCount || 0;
  const eolSoon = d.alerts.eolSoonCount || 0;
  const onboardSched = d.alerts.onboardingScheduled || [];
  const onboardDueCount = d.alerts.onboardingDueCount || 0;
  const todayStr = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();
  const attnItems = (d.alerts.expiredLicenseCount ? 1 : 0) + (d.alerts.expiringLicenseCount ? 1 : 0)
    + (lowest ? 1 : 0) + (eolOverdue ? 1 : 0) + (onboardDueCount ? 1 : 0)
    + (hrOn ? 1 : 0) + (hrOff ? 1 : 0);

  const donut = (() => {
    const dist = (d.locationDistribution || []).slice(0, 4);
    const total = (d.locationDistribution || []).reduce((s, x) => s + x.count, 0) || 1;
    const colors = ['#3525cd', '#2f80ed', '#00b8a9', '#94a3b8'];
    const rings = dist.map((x, i) => {
      const r = 84 - i * 17;
      const c = 2 * Math.PI * r;
      const frac = Math.max(0.02, x.count / total);
      return `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#eceaf5" stroke-width="11"/>
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}"
          transform="rotate(-90 100 100)"/>`;
    }).join('');
    return `<svg width="196" height="196" viewBox="0 0 200 200" role="img" aria-label="Assets by location">
      ${rings}<text x="100" y="107" text-anchor="middle" font-size="16" font-weight="700" fill="#464555">${total}</text></svg>`;
  })();
  const locColors = ['#3525cd', '#2f80ed', '#00b8a9', '#94a3b8'];

  el.innerHTML = `
    ${pageHead('Dashboard Overview', 'System status, hardware distribution, and operational metrics.', `
      <span class="cell-sub" style="display:flex;align-items:center;gap:6px"><span class="ms ms-sm">sync</span> Last updated: Just now</span>
      ${Auth.canIam('report', 'read') || Auth.canIam('report', 'export')
        ? '<button class="btn btn-outline" data-go="#/reports"><span class="ms">download</span> Export Report</button>'
        : ''}`)}

    <div class="dash-grid">
      <div>
        <!-- 2x2 metric cards -->
        <div class="grid-metrics" style="margin-bottom:20px">
          <div class="card metric2 tint-indigo">
            <div class="metric2-head">${iconChip('monitor', 'indigo')}
              <span class="trend-chip up"><span class="ms">trending_up</span> ${a.inStock} in stock</span></div>
            <div class="metric2-label">Total Assets</div>
            <div class="metric2-value">${a.total.toLocaleString()}</div>
          </div>
          <div class="card metric2 tint-blue">
            <div class="metric2-head">${iconChip('handshake', 'blue')}
              <span class="trend-chip up"><span class="ms">trending_up</span> assigned</span></div>
            <div class="metric2-label">Active Handovers</div>
            <div class="metric2-value">${a.assigned.toLocaleString()}</div>
          </div>
          <div class="card metric2 tint-amber">
            <div class="metric2-head">${iconChip('build', 'amber')}
              <span class="trend-chip flat"><span class="ms">remove</span> ${a.inRepair ? 'In service' : 'None open'}</span></div>
            <div class="metric2-label">Items in Repair</div>
            <div class="metric2-value">${a.inRepair.toLocaleString()}</div>
          </div>
          <div class="card metric2 tint-rose">
            <div class="metric2-head">${iconChip('inventory_2', 'rose')}
              <span class="trend-chip ${d.alerts.lowStockCount ? 'down' : 'flat'}">
                <span class="ms">${d.alerts.lowStockCount ? 'trending_down' : 'remove'}</span>
                ${d.alerts.lowStockCount ? 'Needs attention' : 'All healthy'}</span></div>
            <div class="metric2-label">Low Stock Items</div>
            <div class="metric2-value">${d.alerts.lowStockCount}</div>
          </div>
        </div>

        ${onboardSched.length ? `
        <div class="card" style="margin-bottom:20px" id="dash-onboard-card">
          <div class="card-head" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Scheduled Onboarding</h3>
              <div class="cell-sub" style="margin-top:2px">${onboardDueCount
                ? `${onboardDueCount} due for zimmet · ${onboardSched.length} total scheduled`
                : `${onboardSched.length} upcoming — reminder appears on the start day`}</div>
            </div>
            ${onboardDueCount
              ? '<button class="btn btn-primary btn-sm" data-open-onboard-due>Open due</button>'
              : '<span class="pill pill-indigo">Scheduled</span>'}
          </div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Employee</th><th>Start date</th><th>Reserved</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${onboardSched.map((o) => {
                const sd = String(o.startDate || '').slice(0, 10);
                const due = sd && sd <= todayStr;
                return `<tr>
                  <td><div class="cell-title">${esc(o.employeeName)}</div>
                    <div class="cell-sub">${esc(o.department || o.email || '')}</div></td>
                  <td>${fmtDate(o.startDate)}</td>
                  <td>${o.itemCount || 0} item(s)</td>
                  <td>${due
                    ? '<span class="pill pill-rose">Due</span>'
                    : '<span class="pill pill-indigo">Upcoming</span>'}</td>
                  <td style="text-align:right">
                    <button class="btn btn-outline btn-sm" data-open-onboard="${esc(o.id)}">Open</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>` : ''}


        ${(hrOn || hrOff) ? `
        <div class="card" style="margin-bottom:20px" id="dash-hr-card">
          <div class="card-head" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">HR Requests</h3>
              <div class="cell-sub" style="margin-top:2px">${hrOn} onboard · ${hrOff} offboard pending</div>
            </div>
          </div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Type</th><th>Employee</th><th>Date</th><th>Items</th><th></th></tr></thead>
            <tbody>
              ${hrPending.length === 0 ? '<tr><td colspan="5" class="table-empty">Pending requests exist but could not be loaded.</td></tr>' :
                hrPending.slice(0, 8).map((r) => `
                <tr class="row-click" data-hr-detail="${esc(r.id)}" style="cursor:pointer">
                  <td><span class="pill ${r.type === 'offboard' ? 'pill-rose' : 'pill-indigo'}">${esc(r.type)}</span></td>
                  <td><div class="cell-title">${esc(r.fullName || '')}</div>
                    <div class="cell-sub">${esc(r.email || '')}</div></td>
                  <td>${esc(String(r.eventDate || '').slice(0, 10))}</td>
                  <td class="cell-sub">${esc((r.items || []).map((i) => i.category + '×' + i.qty).join(', ') || '—')}</td>
                  <td style="text-align:right">
                    <button class="btn btn-outline btn-sm" data-hr-detail="${esc(r.id)}">${esc(t('hr.review'))}</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>` : ''}

        <!-- Recent handover activity -->
        <div class="card" style="margin-bottom:20px">
          <div class="card-head" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Recent Handover Activity</h3>
              <div class="cell-sub" style="margin-top:2px">Latest asset assignments and returns.</div>
            </div>
            <button class="btn btn-outline btn-sm" data-go="#/handover">View All</button>
          </div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Asset</th><th>Employee</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              ${d.recentHandovers.length === 0 ? '<tr><td colspan="4" class="table-empty">No handovers yet.</td></tr>' :
                d.recentHandovers.map((h) => `
                <tr>
                  <td><div style="display:flex;align-items:center;gap:12px">
                    <span class="icon-chip" style="background:var(--surface-container);color:var(--on-surface-variant)"><span class="ms">laptop_mac</span></span>
                    <div><div class="cell-title">${esc(h.asset)}</div><div class="cell-sub mono">${esc(h.assetTag)}</div></div>
                  </div></td>
                  <td><div style="display:flex;align-items:center;gap:8px">
                    <span class="avatar" style="width:28px;height:28px;font-size:10px">${esc(initials(h.employee))}</span>
                    ${esc(h.employee)}</div></td>
                  <td>${fmtDate(h.date)}</td>
                  <td>${badge('Completed')}</td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>

        <!-- Lifecycle EOL devices -->
        <div class="card">
          <div class="card-head" style="align-items:flex-start">
            <div>
              <h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Lifecycle EOL Devices</h3>
              <div class="cell-sub" style="margin-top:2px">${eolOverdue} overdue • ${eolSoon} approaching end of lifecycle.</div>
            </div>
            <button class="btn btn-outline btn-sm" data-go="#/assets?lifecycle=overdue">Review</button>
          </div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Asset</th><th>Location</th><th>Holder</th><th>Purchased</th><th>EOL Date</th></tr></thead>
            <tbody>
              ${(d.alerts.eolOverdue || []).length === 0 ? '<tr><td colspan="5" class="table-empty">No devices past their lifecycle. 🎉</td></tr>' :
                d.alerts.eolOverdue.map((x) => `
                <tr class="asset-row" data-open-asset="${esc(x.id)}" style="cursor:pointer">
                  <td><div class="cell-title">${esc(x.brand)} ${esc(x.model)}</div><div class="cell-sub mono">${esc(x.assetTag)}</div></td>
                  <td class="cell-sub">${esc(x.location || '—')}</td>
                  <td>${x.currentEmployee ? esc(x.currentEmployee.fullName) : '<span class="cell-sub">In stock</span>'}</td>
                  <td>${fmtDate(x.purchaseDate)}</td>
                  <td><span class="pill pill-rose">${fmtDate(x.eolDate)}</span></td>
                </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>

      <div>
        <!-- Attention Required -->
        <div class="card attn-card" style="margin-bottom:20px">
          <div class="attn-head">
            <div><h3>Attention Required</h3>
              <div class="cell-sub">${attnItems} item${attnItems === 1 ? '' : 's'} need your review.</div></div>
            <span class="attn-count">${attnItems}</span>
          </div>
          ${attnItems === 0 ? '<div class="table-empty">All clear. 🎉</div>' : ''}
          ${(hrOn || hrOff) ? `
          <div class="attn-item indigo">
            ${iconChip('group_add', 'indigo')}
            <div style="flex:1"><strong>HR requests pending</strong>
              <span class="cell-sub">${hrOn} onboard · ${hrOff} offboard awaiting IT.</span>
              <div style="text-align:right"><button class="attn-link" data-scroll-to="dash-hr-card">Review <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
          ${onboardDueCount ? `
          <div class="attn-item indigo">
            ${iconChip('event_available', 'indigo')}
            <div style="flex:1"><strong>Onboarding due</strong>
              <span class="cell-sub">${onboardDueCount} new hire${onboardDueCount > 1 ? 's' : ''} need zimmet today.</span>
              <div style="text-align:right"><button class="attn-link" data-open-onboard-due>Open <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
          ${d.alerts.expiredLicenseCount ? `
          <div class="attn-item rose">
            ${iconChip('vpn_key_off', 'rose')}
            <div style="flex:1"><strong>Expired Licenses</strong>
              <span class="cell-sub">${d.alerts.expiredLicenseCount} software license${d.alerts.expiredLicenseCount > 1 ? 's' : ''} past expiration — renew or cancel.</span>
              <div style="text-align:right"><button class="attn-link" data-go="#/licenses">Review <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
          ${d.alerts.expiringLicenseCount ? `
          <div class="attn-item amber">
            ${iconChip('vpn_key', 'amber')}
            <div style="flex:1"><strong>License Expirations</strong>
              <span class="cell-sub">${d.alerts.expiringLicenseCount} software license${d.alerts.expiringLicenseCount > 1 ? 's' : ''} expiring in 30 days.</span>
              <div style="text-align:right"><button class="attn-link" data-go="#/licenses">Review <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
          ${lowest ? `
          <div class="attn-item rose">
            ${iconChip('inventory_2', 'rose')}
            <div style="flex:1"><strong>Low Hardware Stock</strong>
              <span class="cell-sub">${esc(lowest.itemName)} stock is critically low (${lowest.totalStock} remaining).</span>
              <div style="text-align:right"><button class="attn-link" data-go="#/consumables">Reorder <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
          ${eolOverdue ? `
          <div class="attn-item rose">
            ${iconChip('history_toggle_off', 'rose')}
            <div style="flex:1"><strong>Lifecycle EOL</strong>
              <span class="cell-sub">${eolOverdue} device${eolOverdue > 1 ? 's' : ''} past their lifecycle — replacement due.</span>
              <div style="text-align:right"><button class="attn-link" data-go="#/assets?lifecycle=overdue">Review <span class="ms ms-sm">arrow_forward</span></button></div>
            </div>
          </div>` : ''}
        </div>

        <!-- Asset distribution by location (click for detail popup) -->
        <div class="card" id="dist-card" style="margin-bottom:20px;cursor:pointer" title="Click for detailed breakdown">
          <div class="card-head" style="border-bottom:none;padding-bottom:0;align-items:flex-start">
            <div><h3 style="font-size:16px;text-transform:none;letter-spacing:0;color:var(--on-surface)">Asset Distribution</h3>
              <div class="cell-sub" style="margin-top:2px">By primary location — click for details</div></div>
            <span class="ms" style="color:var(--outline)">open_in_full</span>
          </div>
          <div class="donut-wrap">${donut}</div>
          <div style="padding-bottom:12px">
            ${(d.locationDistribution || []).slice(0, 4).map((x, i) => `
            <div class="loc-legend">
              <span class="dot" style="background:${locColors[i]}"></span>
              ${esc(x.location)}
              <strong>${x.count}</strong>
            </div>`).join('')}
          </div>
        </div>

        <!-- Expiring / expired licenses -->
        <div class="card">
          <div class="card-head"><h3>License Expiry</h3></div>
          ${!(d.alerts.expiredLicenses || []).length && !d.alerts.expiringLicenses.length
            ? '<div class="table-empty">No expired or soon-expiring licenses.</div>'
            : ''}
          ${(d.alerts.expiredLicenses || []).slice(0, 4).map((l) => `
            <div class="exp-item">
              ${iconChip('vpn_key_off', 'rose')}
              <div>
                <strong>${esc(l.softwareName)}</strong>
                <span class="cell-sub">${l.totalSeats} Seats${l.vendor ? ' • ' + esc(l.vendor) : ''}</span>
                <div class="exp-days urgent">Expired ${Math.abs(l.daysLeft)} day${Math.abs(l.daysLeft) === 1 ? '' : 's'} ago</div>
              </div>
            </div>`).join('')}
          ${d.alerts.expiringLicenses.slice(0, 4).map((l) => `
            <div class="exp-item">
              ${iconChip('vpn_key', l.daysLeft <= 14 ? 'amber' : 'indigo')}
              <div>
                <strong>${esc(l.softwareName)}</strong>
                <span class="cell-sub">${l.totalSeats} Seats${l.vendor ? ' • ' + esc(l.vendor) : ''}</span>
                <div class="exp-days ${l.daysLeft <= 7 ? 'urgent' : ''}">Exp. in ${l.daysLeft} Days</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  bindView(el, (e) => {
    const row = e.target.closest('tr[data-open-asset]');
    if (row) { showAssetDetail(row.dataset.openAsset); return; }
    if (e.target.closest('#dist-card')) { showLocationBreakdown(); return; }
    if (e.target.closest('[data-open-onboard-due]')) {
      if (typeof openOnboardingDueModal === 'function') {
        openOnboardingDueModal({ force: true }).catch((err) => toast(err.message, 'error'));
      }
      return;
    }
    const ob = e.target.closest('[data-open-onboard]');
    if (ob && typeof openOnboardingDueModal === 'function') {
      openOnboardingDueModal({ force: true, focusId: ob.dataset.openOnboard }).catch((err) => toast(err.message, 'error'));
      return;
    }
    const hrRow = e.target.closest('[data-hr-detail]');
    if (hrRow) {
      openHrRequestModal(hrRow.dataset.hrDetail, el).catch((err) => toast(err.message, 'error'));
      return;
    }
    const scrollTo = e.target.closest('[data-scroll-to]');
    if (scrollTo) {
      const target = document.getElementById(scrollTo.dataset.scrollTo);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const b = e.target.closest('[data-go]');
    if (b) location.hash = b.dataset.go;
  });
};

/**
 * HR request review dialog — the approval surface for IT.
 *
 * HR files a ticket on its own page; IT never opens that page. Everything
 * needed to decide is shown here (who, when, what kit, who asked), and the
 * decision is taken from this dialog: Approve provisions the employee +
 * scheduled onboarding, Reject withdraws the ticket with a reason.
 */
async function openHrRequestModal(requestId, el) {
  const r = await api('/hr/requests/' + encodeURIComponent(requestId));
  const canAct = typeof Auth.canIamOp === 'function' && Auth.canIamOp('hr_request', 'update');
  const isOffboard = r.type === 'offboard';
  const row = (label, value) => (value
    ? `<tr><td class="cell-sub" style="width:150px">${esc(label)}</td>
         <td>${esc(value)}</td></tr>`
    : '');
  const itemsHtml = (r.items || []).length
    ? `<div class="table-wrap" style="margin-top:14px"><table class="data">
         <thead><tr><th>${esc(t('hr.equipment'))}</th><th style="width:80px">${esc(t('hr.items'))}</th></tr></thead>
         <tbody>${r.items.map((i) => `<tr><td>${esc(i.category)}</td><td>${Number(i.qty) || 1}</td></tr>`).join('')}</tbody>
       </table></div>`
    : '';

  openModal({
    title: t(isOffboard ? 'hr.reviewOffboard' : 'hr.reviewOnboard') + ' — ' + (r.fullName || ''),
    body: `
      <div class="table-wrap"><table class="data"><tbody>
        ${row(t('hr.employee'), r.fullName)}
        ${row(t('hr.email'), r.email)}
        ${row(t('hr.department'), r.department)}
        ${row(t('hr.title'), r.title)}
        ${row(t(isOffboard ? 'hr.endDate' : 'hr.startDate'), String(r.eventDate || '').slice(0, 10))}
        ${row(t('hr.requestedBy'), r.createdByName)}
        ${row(t('hr.status'), t(r.status === 'acknowledged' ? 'hr.statusAcknowledged'
    : r.status === 'cancelled' ? 'hr.statusCancelled' : 'hr.statusPending'))}
        ${row(t('hr.notes'), r.notes)}
      </tbody></table></div>
      ${itemsHtml}
      <p class="cell-sub" style="margin:14px 0 0">${esc(t(isOffboard ? 'hr.offboardHint' : 'hr.onboardHint'))}</p>`,
    foot: `
      <button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
      ${canAct && r.status === 'pending' ? `
        <button class="btn btn-outline" id="hr-reject">${esc(t('hr.reject'))}</button>
        <button class="btn btn-primary" id="hr-approve">${esc(t('hr.approve'))}</button>` : ''}`,
    onMount(overlay) {
      const approve = overlay.querySelector('#hr-approve');
      const reject = overlay.querySelector('#hr-reject');
      if (approve) {
        approve.addEventListener('click', async () => {
          approve.disabled = true;
          try {
            const res = await api('/hr/requests/' + encodeURIComponent(r.id) + '/acknowledge', { method: 'POST' });
            closeModal();
            toast(res && res.onboardingId
              ? (t('hr.ackOnboardOk'))
              : (t('hr.ackOk')), 'success');
            // An approved offboard ticket is only half the job — hand IT straight
            // to that employee's offboarding checklist instead of making them
            // hunt for the person in the directory.
            if (res && res.type === 'offboard' && res.employeeId) {
              location.hash = '#/employees?offboard=' + encodeURIComponent(res.employeeId);
              return;
            }
            Views.dashboard(el);
          } catch (err) {
            approve.disabled = false;
            toast(err.message, 'error');
          }
        });
      }
      if (reject) {
        reject.addEventListener('click', async () => {
          const reason = prompt(t('hr.cancelReason'), '');
          if (reason === null) return;
          reject.disabled = true;
          try {
            await api('/hr/requests/' + encodeURIComponent(r.id) + '/cancel', {
              method: 'POST',
              body: { reason: reason },
            });
            closeModal();
            toast(t('hr.cancelOk'), 'success');
            Views.dashboard(el);
          } catch (err) {
            reject.disabled = false;
            toast(err.message, 'error');
          }
        });
      }
    },
  });
}

/* Detailed asset-distribution popup: per-location totals, status split,
   category mix and value share, with click-through to filtered inventory. */
async function showLocationBreakdown() {
  const { items } = await api('/assets?limit=2000');
  const locs = new Map();
  for (const x of items) {
    const key = x.location || 'Unassigned';
    if (!locs.has(key)) locs.set(key, { total: 0, statuses: {}, categories: {} });
    const L = locs.get(key);
    L.total++;
    L.statuses[x.status] = (L.statuses[x.status] || 0) + 1;
    L.categories[x.category] = (L.categories[x.category] || 0) + 1;
  }
  const rows = [...locs.entries()].sort((a, b) => b[1].total - a[1].total);
  const grand = items.length || 1;
  const SC = { 'Assigned': '#3525cd', 'In Stock': '#c3c0ff', 'In Repair': '#f59e0b', 'Scrap': '#ffb4ab' };

  openModal({
    title: `Asset Distribution by Location (${items.length} assets)`,
    wide: true,
    body: rows.map(([name, L]) => {
      const topCats = Object.entries(L.categories).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([c, n]) => `${c} ${n}`).join(' • ');
      return `
      <div style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span class="ms" style="color:var(--on-surface-variant)">location_on</span>
          <strong style="font-size:14.5px">${esc(name)}</strong>
          <span class="cell-sub">${Math.round((L.total / grand) * 100)}% of fleet</span>
          <span style="margin-left:auto;display:flex;align-items:center;gap:8px">
            <span class="badge-count">${L.total}</span>
            <button class="btn btn-outline btn-sm" data-loc-view="${esc(name === 'Unassigned' ? '' : name)}">View assets</button>
          </span>
        </div>
        <div style="display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--surface-container);margin-bottom:8px">
          ${Object.entries(SC).map(([st, color]) =>
            L.statuses[st] ? `<span style="width:${(L.statuses[st] / L.total) * 100}%;background:${color}" title="${st}: ${L.statuses[st]}"></span>` : '').join('')}
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap" class="cell-sub">
          ${Object.entries(SC).map(([st, color]) =>
            L.statuses[st] ? `<span style="display:flex;align-items:center;gap:5px">
              <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>${st}: <strong>${L.statuses[st]}</strong></span>` : '').join('')}
          <span style="margin-left:auto">${esc(topCats)}</span>
        </div>
      </div>`;
    }).join(''),
    foot: '<button class="btn btn-outline" data-close>Close</button>',
    onMount(overlay) {
      overlay.querySelectorAll('[data-loc-view]').forEach((b) => b.addEventListener('click', () => {
        closeModal();
        location.hash = '#/assets' + (b.dataset.locView ? '?location=' + encodeURIComponent(b.dataset.locView) : '');
      }));
    },
  });
}

/* ================================ ASSETS ================================= */
