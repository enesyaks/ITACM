Views.users = async function (el) {
  const items = await api('/auth/users');
  // Only an Owner may see/assign the Owner role.
  const roleOptions = Auth.can('canManageOwner') ? ['Owner', 'Admin', 'Helpdesk', 'Viewer'] : ['Admin', 'Helpdesk', 'Viewer'];
  el.innerHTML = `
    ${pageHead('IT Users', 'Manage system operators and their roles.',
      `<button class="btn btn-primary" id="user-new"><span class="ms">person_add</span> New IT User</button>`)}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Created</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${items.map((u) => `
        <tr style="${u.status === 'Disabled' ? 'opacity:.55' : ''}">
          <td><div style="display:flex;align-items:center;gap:12px">
            <span class="avatar">${esc(initials(u.username))}</span>
            <span class="cell-title">${esc(u.username)}</span></div></td>
          <td>${esc(u.email)}</td>
          <td>${badge(u.role)}</td>
          <td>${u.status === 'Disabled' ? '<span class="pill pill-rose">Disabled</span>' : '<span class="pill pill-emerald">Active</span>'}</td>
          <td>${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : '<span class="cell-sub">Never</span>'}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td class="actions">
            <button class="btn btn-outline btn-sm" data-logins="${esc(u.uid)}" data-uname="${esc(u.username)}" data-uemail="${esc(u.email)}">
              <span class="ms">history</span> Logins</button>
            <select data-role="${esc(u.uid)}" style="width:auto" ${(u.role === 'Owner' && !Auth.can('canManageOwner')) ? 'disabled title="Only an Owner can change an Owner"' : ''}>
              ${roleOptions.map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            ${Auth.can('canManageOwner') && u.uid !== (Auth.profile && Auth.profile.uid) ? `
            <button class="btn btn-outline btn-sm" data-toggle-status="${esc(u.uid)}" data-cur="${esc(u.status || 'Active')}" title="${u.status === 'Disabled' ? 'Re-enable this account' : 'Disable sign-in for this account'}">
              <span class="ms">${u.status === 'Disabled' ? 'lock_open' : 'block'}</span> ${u.status === 'Disabled' ? 'Enable' : 'Disable'}</button>
            <button class="btn btn-danger btn-sm" data-del-user="${esc(u.uid)}" data-uname="${esc(u.username)}"><span class="ms">delete</span></button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div></div>`;

  $('#user-new', el).addEventListener('click', () => formModal({
    title: 'New IT User',
    fields: [
      { name: 'username', label: 'Display name *', required: true },
      { name: 'email', label: 'Email *', type: 'email', required: true },
      { name: 'password', label: 'Password *', type: 'password', required: true },
      { name: 'role', label: 'Role *', type: 'select', value: 'Helpdesk', options: roleOptions },
    ],
    submitLabel: 'Create user',
    async onSubmit(d) {
      await api('/auth/users', { method: 'POST', body: d });
      toast(`${d.role} user created`, 'success');
      Views.users(el);
    },
  }));

  el.querySelectorAll('select[data-role]').forEach((s) => s.addEventListener('change', async () => {
    try {
      await api(`/auth/users/${s.dataset.role}/role`, { method: 'PUT', body: { role: s.value } });
      toast('Role updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
      Views.users(el);
    }
  }));

  el.querySelectorAll('button[data-logins]').forEach((b) => b.addEventListener('click', async () => {
    const [logs, adminLogs] = await Promise.all([
      api(`/auth/users/${b.dataset.logins}/logins`),
      api(`/auth/users/admin-logs?email=${encodeURIComponent(b.dataset.uemail || '')}`).catch(() => []),
    ]);
    openModal({
      title: `Account history — ${b.dataset.uname}`,
      body: `
        ${adminLogs.length === 0 ? '' : `
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">Admin actions</h3>
        ${adminLogs.map((a) => `
        <div class="history-item">
          <span class="when">${fmtDateTime(a.timestamp)}</span>
          <span class="pill ${a.action === 'deleted' || a.action === 'disabled' ? 'pill-rose' : a.action === 'enabled' ? 'pill-emerald' : 'pill-indigo'}">${esc(a.action)}</span>
          ${a.detail ? `<span class="cell-sub">${esc(a.detail)}</span>` : ''}
          <span class="cell-sub">by ${esc(a.byName)}</span>
        </div>`).join('')}
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:14px 0 6px">Logins</h3>`}
        ${logs.length === 0 ? '<div class="cell-sub">No logins recorded yet.</div>' : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>When</th><th>IP</th><th>Client</th></tr></thead>
          <tbody>
            ${logs.map((l) => `
            <tr>
              <td>${fmtDateTime(l.timestamp)}</td>
              <td class="mono">${esc(l.ip || '—')}</td>
              <td class="cell-sub" title="${esc(l.userAgent || '')}">${esc(String(l.userAgent || '—').slice(0, 60))}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}`,
      foot: '<button class="btn btn-outline" data-close>Close</button>',
    });
  }));

  // Owner-only account administration: disable/enable and delete (audited).
  el.querySelectorAll('button[data-toggle-status]').forEach((b) => b.addEventListener('click', async () => {
    const next = b.dataset.cur === 'Disabled' ? 'Active' : 'Disabled';
    try {
      await api(`/auth/users/${b.dataset.toggleStatus}/status`, { method: 'PUT', body: { status: next } });
      toast(next === 'Disabled' ? 'Account disabled — sign-in blocked' : 'Account re-enabled', 'success');
      Views.users(el);
    } catch (err) { toast(err.message, 'error'); }
  }));
  el.querySelectorAll('button[data-del-user]').forEach((b) => b.addEventListener('click', () => {
    confirmModal(`Permanently delete the account "${b.dataset.uname}"? Their handover history is kept.`, async () => {
      try {
        await api(`/auth/users/${b.dataset.delUser}`, { method: 'DELETE' });
        toast('Account deleted — recorded in the audit log', 'success');
        Views.users(el);
      } catch (err) { toast(err.message, 'error'); }
    });
  }));
};

/* ============================ PRODUCT CATALOG ============================ */
