/* ===================== NOTIFICATIONS (portal + staff) ===================== */
/* A full-page feed of the signed-in user's in-app notifications. Portal users
   have no topbar bell, so this is their way to see assignments, approval
   requests and decisions. Reuses notifIcon() and refreshNotifBadge() from app.js. */

Views.notifications = async function (el) {
  const rowHtml = (n) => `<div class="ntf-row ${n.readAt ? '' : 'is-unread'}" data-id="${esc(n.id)}" data-link="${esc(n.link || '')}" style="cursor:pointer">
      ${iconChip(notifIcon(n.type), n.readAt ? 'slate' : 'indigo')}
      <div class="ntf-body">
        <div class="ntf-title">${esc(n.title)}</div>
        ${n.body ? `<div class="cell-sub">${esc(n.body)}</div>` : ''}
        <div class="cell-sub ntf-time">${esc(String(n.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
      </div>
      ${n.link ? '<span class="ms ms-sm" style="color:var(--on-surface-variant)">chevron_right</span>' : ''}
    </div>`;

  const load = async () => {
    const d = await api('/me/notifications?limit=50').catch(() => ({ items: [], unread: 0 }));
    const items = Array.isArray(d.items) ? d.items : [];
    const anyUnread = items.some((n) => !n.readAt);
    el.innerHTML = `
      ${pageHead(t('notif.title'), t('notif.subtitle'),
        anyUnread ? `<button class="btn btn-outline" id="ntf-readall"><span class="ms">done_all</span> ${esc(t('notif.markAllRead'))}</button>` : '')}
      <div class="card">${items.length
        ? `<div class="ntf-list">${items.map(rowHtml).join('')}</div>`
        : `<div class="table-empty" style="padding:32px">${esc(t('notif.none'))}</div>`}</div>`;

    $('#ntf-readall', el)?.addEventListener('click', async () => {
      try { await api('/me/notifications/read-all', { method: 'POST' }); if (typeof refreshNotifBadge === 'function') refreshNotifBadge(); load(); }
      catch (err) { toast(err.message, 'error'); }
    });
    el.querySelectorAll('.ntf-row').forEach((row) => row.addEventListener('click', async () => {
      const id = row.dataset.id; const link = row.dataset.link;
      if (row.classList.contains('is-unread')) {
        await api('/me/notifications/' + encodeURIComponent(id) + '/read', { method: 'POST' }).catch(() => {});
        if (typeof refreshNotifBadge === 'function') refreshNotifBadge();
      }
      if (link) location.hash = link; else load();
    }));
  };

  await load();
};
