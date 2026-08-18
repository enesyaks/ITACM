/* ============================ SERVICE DESK (ITIL) ============================ */

const TK_STATUS = ['new', 'open', 'in_progress', 'pending', 'resolved', 'closed', 'cancelled'];
const TK_PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TK_STATUS_PILL = {
  new: 'pill-slate', open: 'pill-blue', in_progress: 'pill-amber', pending: 'pill-slate',
  resolved: 'pill-emerald', closed: 'pill-slate', cancelled: 'pill-rose',
};
const TK_PRIORITY_PILL = { low: 'pill-slate', medium: 'pill-blue', high: 'pill-amber', urgent: 'pill-rose' };
const tkStatusLabel = (s) => t('tk.status.' + s) || s;
const tkPriorityLabel = (p) => t('tk.priority.' + p) || p;
const tkTypeLabel = (ty) => t('tk.type.' + ty) || ty;

Views.tickets = async function (el) {
  const canCreate = Auth.canIam('ticket', 'create') || Auth.canIam('ticket', 'manage');
  const canUpdate = Auth.canIam('ticket', 'update') || Auth.canIam('ticket', 'manage');
  const canAssign = Auth.canIam('ticket', 'assign') || Auth.canIam('ticket', 'manage');

  const [tickets, staff] = await Promise.all([
    api('/tickets?open=1').catch(() => []),
    api('/auth/users').catch(() => []),
  ]);
  const staffList = Array.isArray(staff) ? staff : [];
  const staffName = (uid) => (staffList.find((u) => u.uid === uid) || {}).username || '';

  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const rowHtml = (tk) => `<tr data-open="${esc(tk.id)}" style="cursor:pointer">
      <td class="mono">${esc(tk.number)}</td>
      <td>${pill('pill-slate', tkTypeLabel(tk.type))}</td>
      <td><div class="cell-title">${esc(tk.subject)}</div>${tk.assetTag ? `<div class="cell-sub">${esc(tk.assetTag)}</div>` : ''}</td>
      <td>${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}</td>
      <td>${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</td>
      <td class="cell-sub">${esc(tk.requesterName || '—')}</td>
      <td class="cell-sub">${esc(tk.assigneeName || t('tk.unassigned'))}</td>
      <td class="cell-sub">${esc(String(tk.createdAt || '').slice(0, 10))}</td>
    </tr>`;

  const render = (list) => {
    el.innerHTML = `
      ${pageHead(t('tk.title'), t('tk.subtitle'), canCreate
        ? `<button class="btn btn-primary" id="tk-new"><span class="ms">add</span> ${esc(t('tk.new'))}</button>` : '')}
      <div class="card card-pad" style="margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select id="tk-f-status" class="ops-select">
          <option value="open">${esc(t('tk.filterOpen'))}</option>
          <option value="">${esc(t('tk.filterAll'))}</option>
          ${TK_STATUS.map((s) => `<option value="${s}">${esc(tkStatusLabel(s))}</option>`).join('')}
        </select>
        <select id="tk-f-type" class="ops-select">
          <option value="">${esc(t('tk.allTypes'))}</option>
          <option value="incident">${esc(tkTypeLabel('incident'))}</option>
          <option value="request">${esc(tkTypeLabel('request'))}</option>
        </select>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px">
          <input type="checkbox" id="tk-f-mine"> ${esc(t('tk.mineOnly'))}</label>
      </div>
      <div class="card" style="overflow-x:auto"><table class="table">
        <thead><tr>
          <th>#</th><th>${esc(t('tk.type'))}</th><th>${esc(t('tk.subject'))}</th>
          <th>${esc(t('tk.statusCol'))}</th><th>${esc(t('tk.priorityCol'))}</th>
          <th>${esc(t('tk.requester'))}</th><th>${esc(t('tk.assignee'))}</th><th>${esc(t('tk.createdCol'))}</th>
        </tr></thead>
        <tbody id="tk-rows">${list.length ? list.map(rowHtml).join('')
          : `<tr><td colspan="8" class="table-empty">${esc(t('tk.none'))}</td></tr>`}</tbody>
      </table></div>`;

    el.querySelectorAll('#tk-rows tr[data-open]').forEach((tr) =>
      tr.addEventListener('click', () => openTicket(tr.dataset.open)));
    const nb = $('#tk-new', el);
    if (nb) nb.addEventListener('click', openCreate);
    const reload = () => refresh();
    $('#tk-f-status', el)?.addEventListener('change', reload);
    $('#tk-f-type', el)?.addEventListener('change', reload);
    $('#tk-f-mine', el)?.addEventListener('change', reload);
  };

  async function refresh() {
    const status = $('#tk-f-status', el)?.value;
    const type = $('#tk-f-type', el)?.value;
    const mine = $('#tk-f-mine', el)?.checked;
    const qs = new URLSearchParams();
    if (status === 'open') qs.set('open', '1'); else if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    if (mine && Auth.profile) qs.set('assignee', Auth.profile.uid);
    const list = await api('/tickets?' + qs.toString()).catch(() => []);
    const body = $('#tk-rows', el);
    if (body) body.innerHTML = list.length ? list.map(rowHtml).join('')
      : `<tr><td colspan="8" class="table-empty">${esc(t('tk.none'))}</td></tr>`;
    el.querySelectorAll('#tk-rows tr[data-open]').forEach((tr) =>
      tr.addEventListener('click', () => openTicket(tr.dataset.open)));
  }

  function openCreate() {
    openModal({
      title: t('tk.new'),
      body: `<div class="form-grid">
        <div class="form-field"><label>${esc(t('tk.type'))}</label>
          <select id="tk-c-type"><option value="incident">${esc(tkTypeLabel('incident'))}</option><option value="request">${esc(tkTypeLabel('request'))}</option></select></div>
        <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
          <select id="tk-c-priority">${TK_PRIORITY.map((p) => `<option value="${p}"${p === 'medium' ? ' selected' : ''}>${esc(tkPriorityLabel(p))}</option>`).join('')}</select></div>
        <div class="form-field full"><label>${esc(t('tk.subject'))} *</label><input id="tk-c-subject" maxlength="300"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="tk-c-desc" rows="4"></textarea></div>
        <div class="form-field"><label>${esc(t('tk.category'))}</label><input id="tk-c-cat" maxlength="120" placeholder="${esc(t('tk.categoryPh'))}"></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="tk-c-save">${esc(t('tk.create'))}</button>`,
      onMount(ov) {
        $('#tk-c-save', ov).addEventListener('click', async () => {
          try {
            await api('/tickets', { method: 'POST', body: {
              type: $('#tk-c-type', ov).value,
              priority: $('#tk-c-priority', ov).value,
              subject: $('#tk-c-subject', ov).value.trim(),
              description: $('#tk-c-desc', ov).value.trim(),
              category: $('#tk-c-cat', ov).value.trim(),
            } });
            closeModal();
            toast(t('tk.created'), 'success');
            refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openTicket(id) {
    const tk = await api('/tickets/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!tk) return;
    const assignOpts = `<option value="">${esc(t('tk.unassigned'))}</option>` +
      staffList.map((u) => `<option value="${esc(u.uid)}"${u.uid === tk.assigneeUserId ? ' selected' : ''}>${esc(u.username)}</option>`).join('');
    const comments = (tk.comments || []).map((c) => `
      <div class="tk-comment${c.internal ? ' tk-internal' : ''}">
        <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
          ${c.internal ? `<span class="pill pill-amber">${esc(t('tk.internal'))}</span>` : ''}
          <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div>${esc(c.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('') || `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`;
    const activity = (tk.activity || []).map((a) => `<li><span class="cell-sub">${esc(String(a.createdAt || '').replace('T', ' ').slice(0, 16))}</span> · ${esc(a.actorName || '')} — ${esc(a.action)}${a.detail ? ' (' + esc(a.detail) + ')' : ''}</li>`).join('');

    openModal({
      title: `${tk.number} · ${tk.subject}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="form-field"><label>${esc(t('tk.statusCol'))}</label>
            <select id="tk-d-status" ${canUpdate ? '' : 'disabled'}>${TK_STATUS.map((s) => `<option value="${s}"${s === tk.status ? ' selected' : ''}>${esc(tkStatusLabel(s))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
            <select id="tk-d-priority" ${canUpdate ? '' : 'disabled'}>${TK_PRIORITY.map((p) => `<option value="${p}"${p === tk.priority ? ' selected' : ''}>${esc(tkPriorityLabel(p))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.assignee'))}</label>
            <select id="tk-d-assignee" ${canAssign ? '' : 'disabled'}>${assignOpts}</select></div>
          <div class="form-field"><label>${esc(t('tk.category'))}</label>
            <input id="tk-d-cat" value="${esc(tk.category || '')}" ${canUpdate ? '' : 'disabled'}></div>
          <div class="form-field full"><label>${esc(t('tk.requester'))}</label>
            <div>${esc(tk.requesterName || '—')}${tk.assetTag ? ` · <span class="ms" style="font-size:15px;vertical-align:-2px">devices</span> ${esc(tk.assetTag)}` : ''}</div></div>
          <div class="form-field full"><label>${esc(t('tk.description'))}</label>
            <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div></div>
        </div>
        <h3 style="margin:16px 0 8px">${esc(t('tk.worklog'))}</h3>
        <div class="tk-comments">${comments}</div>
        ${canUpdate ? `<div style="margin-top:10px">
          <textarea id="tk-d-comment" rows="2" placeholder="${esc(t('tk.addComment'))}"></textarea>
          <label style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:13px">
            <input type="checkbox" id="tk-d-internal"> ${esc(t('tk.internalNote'))}</label>
          <div><button class="btn btn-outline btn-sm" id="tk-d-addcomment" style="margin-top:6px">${esc(t('tk.post'))}</button></div>
        </div>` : ''}
        <details style="margin-top:14px"><summary class="cell-sub">${esc(t('tk.activity'))}</summary>
          <ul class="tk-activity">${activity}</ul></details>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        const patch = async (body) => {
          try { await api('/tickets/' + encodeURIComponent(id), { method: 'PATCH', body }); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        };
        $('#tk-d-status', ov)?.addEventListener('change', (e) => patch({ status: e.target.value }));
        $('#tk-d-priority', ov)?.addEventListener('change', (e) => patch({ priority: e.target.value }));
        $('#tk-d-assignee', ov)?.addEventListener('change', (e) => patch({ assigneeUserId: e.target.value || null }));
        $('#tk-d-cat', ov)?.addEventListener('change', (e) => patch({ category: e.target.value.trim() }));
        $('#tk-d-addcomment', ov)?.addEventListener('click', async () => {
          const body = $('#tk-d-comment', ov).value.trim();
          if (!body) return;
          try {
            await api('/tickets/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { body, internal: !!$('#tk-d-internal', ov).checked } });
            closeModal(); openTicket(id); refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  render(Array.isArray(tickets) ? tickets : []);
};
