/* ================================ APPROVALS ================================ */
/* Two queues: requests routed to me and requests I raised. Only meaningful once
 * the workflow is switched on from Organization. Strings follow the app language
 * via T(en, tr); other languages fall back to English. */
Views.approvals = async function (el) {
  if (isStaleView(el)) return;
  const _lng = (typeof window.i18nLang === 'function' ? window.i18nLang() : 'en');
  const T = (en, tr) => (_lng === 'tr' ? tr : en);

  const TYPE_LABEL = {
    license_assign: T('Software / license assignment', 'Yazılım / lisans zimmeti'),
    asset_sale: T('Asset sale', 'Cihaz satışı'),
    asset_scrap: T('Asset scrap', 'Cihaz hurdaya ayırma'),
  };
  const statusPill = (s) => ({
    pending: `<span class="pill pill-amber"><span class="ms ms-sm">schedule</span> ${esc(T('Pending', 'Bekliyor'))}</span>`,
    approved: `<span class="pill pill-emerald"><span class="ms ms-sm">check</span> ${esc(T('Approved', 'Onaylandı'))}</span>`,
    rejected: `<span class="pill pill-rose"><span class="ms ms-sm">close</span> ${esc(T('Rejected', 'Reddedildi'))}</span>`,
    cancelled: `<span class="pill pill-slate">${esc(T('Cancelled', 'İptal'))}</span>`,
  }[s] || badge(s));
  const when = (d) => (typeof fmtDateTime === 'function' ? fmtDateTime(d) : new Date(d).toLocaleString());

  async function decide(id, decision) {
    if (decision === 'rejected') {
      formModal({
        title: T('Reject request', 'Talebi reddet'),
        fields: [{ name: 'note', label: T('Reason (optional)', 'Neden (opsiyonel)'), type: 'textarea', full: true, maxlength: 1000 }],
        submitLabel: T('Reject', 'Reddet'),
        async onSubmit(d) {
          await api(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { decision: 'rejected', note: d.note } });
          toast(T('Request rejected', 'Talep reddedildi'), 'success');
          await load();
        },
      });
      return;
    }
    confirmModal(T('Approve this request? The related action will run once approved.', 'Bu talep onaylansın mı? Onaylanınca ilgili aksiyon çalıştırılacak.'), async () => {
      try {
        await api(`/approvals/${encodeURIComponent(id)}/decide`, { method: 'POST', body: { decision: 'approved' } });
        toast(T('Approved — action processed', 'Onaylandı — aksiyon işleme alındı'), 'success');
        await load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function pendingRow(r) {
    return `
      <tr>
        <td><div class="cell-title">${esc(TYPE_LABEL[r.type] || r.type)}</div>
          <div class="cell-sub">${esc(r.summary || '')}</div></td>
        <td>${esc(r.requesterName || '—')}</td>
        <td class="cell-sub">${esc(when(r.createdAt))}</td>
        <td class="actions">
          <button class="btn btn-primary btn-sm" data-approve="${esc(r.id)}"><span class="ms">check</span> ${esc(T('Approve', 'Onayla'))}</button>
          <button class="btn btn-outline btn-sm" data-reject="${esc(r.id)}"><span class="ms">close</span> ${esc(T('Reject', 'Reddet'))}</button>
        </td>
      </tr>`;
  }
  function mineRow(r) {
    return `
      <tr>
        <td><div class="cell-title">${esc(TYPE_LABEL[r.type] || r.type)}</div>
          <div class="cell-sub">${esc(r.summary || '')}</div></td>
        <td>${esc(r.approverName || '—')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="cell-sub">${esc(when(r.createdAt))}${r.decidedAt ? ' · ' + esc(when(r.decidedAt)) : ''}</td>
      </tr>`;
  }

  function render(pending, mine, config) {
    el.innerHTML = `
      ${pageHead(T('Approvals', 'Onaylar'), T('Approve requests you manage; track requests you raised.', 'Yöneticisi olduğun talepleri onayla; açtığın talepleri izle.'))}
      ${!config || !config.enabled ? `
        <div class="card card-pad" style="margin-bottom:16px;border-left:3px solid var(--outline-variant)">
          <div class="cell-title"><span class="ms" style="vertical-align:-3px">info</span> ${esc(T('The approval workflow is currently off', 'Onay akışı şu an kapalı'))}</div>
          <div class="cell-sub" style="margin-top:2px">${esc(T('Turn it on from the Organization page and requests will appear here.', 'Organizasyon sayfasından açtığında talepler burada görünür.'))}</div>
        </div>` : ''}

      <div class="card" style="margin-bottom:18px">
        <div class="card-head" style="padding:14px 16px"><h3 class="card-title" style="text-transform:none;font-size:14px">
          <span class="ms" style="vertical-align:-3px">inbox</span> ${esc(T('Waiting for my approval', 'Onayımı bekleyenler'))}
          <span class="badge-count ${pending.length ? '' : 'zero'}">${pending.length}</span></h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(T('Type', 'Tür'))}</th><th>${esc(T('Requester', 'Talep eden'))}</th><th>${esc(T('Date', 'Tarih'))}</th><th style="text-align:right">${esc(T('Action', 'İşlem'))}</th></tr></thead>
          <tbody>${pending.length ? pending.map(pendingRow).join('') : `<tr><td colspan="4" class="table-empty">${esc(T('No pending approvals.', 'Bekleyen onay yok.'))}</td></tr>`}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-head" style="padding:14px 16px"><h3 class="card-title" style="text-transform:none;font-size:14px">
          <span class="ms" style="vertical-align:-3px">outbox</span> ${esc(T('My requests', 'Taleplerim'))}
          <span class="badge-count ${mine.length ? '' : 'zero'}">${mine.length}</span></h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(T('Type', 'Tür'))}</th><th>${esc(T('Approver', 'Onaycı'))}</th><th>${esc(T('Status', 'Durum'))}</th><th>${esc(T('Date', 'Tarih'))}</th></tr></thead>
          <tbody>${mine.length ? mine.map(mineRow).join('') : `<tr><td colspan="4" class="table-empty">${esc(T('You have not raised any requests yet.', 'Henüz talep açmadın.'))}</td></tr>`}</tbody>
        </table></div>
      </div>`;

    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.approve, 'approved')));
    el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.reject, 'rejected')));
  }

  async function load() {
    const [pending, mine, config] = await Promise.all([
      api('/approvals/pending').catch(() => []),
      api('/approvals/mine').catch(() => []),
      api('/approvals/config').catch(() => null),
    ]);
    if (isStaleView(el)) return;
    render(pending || [], mine || [], config);
  }

  try {
    await load();
  } catch (err) {
    if (isStaleView(el)) return;
    el.innerHTML = `<div class="card card-pad"><div class="form-error">${esc(err.message)}</div></div>`;
  }
};
