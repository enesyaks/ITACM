/* ===================== PROBLEM MANAGEMENT (ITIL) ===================== */
/* Reuses TK_PRIORITY(_PILL) / tkPriorityLabel / tkStatusLabel from tickets.js. */

const PR_STATUS = ['new', 'investigating', 'known_error', 'resolved', 'closed'];
const PR_STATUS_PILL = { new: 'pill-slate', investigating: 'pill-blue', known_error: 'pill-amber', resolved: 'pill-emerald', closed: 'pill-slate' };
const prStatusLabel = (s) => t('pr.status.' + s) || s;

Views.problems = async function (el) {
  const canCreate = Auth.canIam('problem', 'create') || Auth.canIam('problem', 'manage');
  const canUpdate = Auth.canIam('problem', 'update') || Auth.canIam('problem', 'manage');

  const [problems, staff, incRes] = await Promise.all([
    api('/problems').catch(() => []),
    api('/auth/users').catch(() => []),
    api('/tickets?type=incident&limit=500').catch(() => []),
  ]);
  const staffList = Array.isArray(staff) ? staff : [];
  const incidents = Array.isArray(incRes) ? incRes : [];
  const incLabel = (i) => `${i.number} · ${i.subject}`;
  const incIdByLabel = new Map(incidents.map((i) => [incLabel(i), i.id]));
  const incOptions = incidents.map((i) => `<option value="${esc(incLabel(i))}">`).join('');

  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const rowHtml = (p) => `<tr data-open="${esc(p.id)}" class="tk-row prio-${esc(p.priority)}" style="cursor:pointer">
      <td class="mono tk-num">${esc(p.number)}</td>
      <td><div class="cell-title">${esc(p.title)}</div></td>
      <td>${pill(PR_STATUS_PILL[p.status], prStatusLabel(p.status))}</td>
      <td>${pill(TK_PRIORITY_PILL[p.priority], tkPriorityLabel(p.priority))}</td>
      <td class="cell-sub">${esc(String(p.incidentCount || 0))}</td>
      <td>${p.assigneeName ? esc(p.assigneeName) : `<span class="cell-sub">${esc(t('tk.unassigned'))}</span>`}</td>
      <td class="cell-sub tk-date">${esc(String(p.createdAt || '').slice(0, 10))}</td>
    </tr>`;

  const render = (list) => {
    el.innerHTML = `
      ${pageHead(t('pr.title'), t('pr.subtitle'), canCreate
        ? `<button class="btn btn-primary" id="pr-new"><span class="ms">add</span> ${esc(t('pr.new'))}</button>` : '')}
      <div class="card table-wrap"><table class="data tk-list">
        <thead><tr>
          <th>#</th><th>${esc(t('pr.titleCol'))}</th><th>${esc(t('tk.statusCol'))}</th>
          <th>${esc(t('tk.priorityCol'))}</th><th>${esc(t('pr.incidents'))}</th>
          <th>${esc(t('tk.assignee'))}</th><th>${esc(t('tk.createdCol'))}</th>
        </tr></thead>
        <tbody id="pr-rows">${list.length ? list.map(rowHtml).join('')
          : `<tr><td colspan="7" class="table-empty">${esc(t('pr.none'))}</td></tr>`}</tbody>
      </table></div>`;
    el.querySelectorAll('#pr-rows tr[data-open]').forEach((tr) => tr.addEventListener('click', () => openProblem(tr.dataset.open)));
    const nb = $('#pr-new', el);
    if (nb) nb.addEventListener('click', openCreate);
  };

  async function refresh() {
    const list = await api('/problems').catch(() => []);
    render(Array.isArray(list) ? list : []);
  }

  function openCreate() {
    openModal({
      title: t('pr.new'),
      body: `<div class="form-grid">
        <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
          <select id="pr-c-priority">${TK_PRIORITY.map((p) => `<option value="${p}"${p === 'medium' ? ' selected' : ''}>${esc(tkPriorityLabel(p))}</option>`).join('')}</select></div>
        <div class="form-field full"><label>${esc(t('pr.titleCol'))} *</label><input id="pr-c-title" maxlength="300"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="pr-c-desc" rows="4"></textarea></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="pr-c-save">${esc(t('pr.create'))}</button>`,
      onMount(ov) {
        $('#pr-c-save', ov).addEventListener('click', async () => {
          try {
            await api('/problems', { method: 'POST', body: {
              priority: $('#pr-c-priority', ov).value,
              title: $('#pr-c-title', ov).value.trim(),
              description: $('#pr-c-desc', ov).value.trim(),
            } });
            closeModal(); toast(t('pr.created'), 'success'); refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openProblem(id) {
    const p = await api('/problems/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!p) return;
    const assignOpts = `<option value="">${esc(t('tk.unassigned'))}</option>` +
      staffList.map((u) => `<option value="${esc(u.uid)}"${u.uid === p.assigneeUserId ? ' selected' : ''}>${esc(u.username)}</option>`).join('');
    const incRows = (p.incidents || []).map((i) => `<div class="pr-inc prio-${esc(i.priority || 'medium')}" data-inc="${esc(i.id)}">
        <span class="pr-inc-no mono">${esc(i.number)}</span>
        <div class="pr-inc-main">
          <div class="pr-inc-subj">${esc(i.subject)}</div>
          <div class="pr-inc-pills">
            ${i.priority ? pill(TK_PRIORITY_PILL[i.priority], tkPriorityLabel(i.priority)) : ''}
            ${pill(TK_STATUS_PILL[i.status] || 'pill-slate', tkStatusLabel(i.status))}
          </div>
        </div>
        ${canUpdate ? `<button class="btn btn-ghost btn-sm pr-unlink" data-tid="${esc(i.id)}" title="${esc(t('pr.unlink'))}"><span class="ms ms-sm">link_off</span></button>` : ''}
      </div>`).join('') || `<div class="pr-inc-empty"><span class="ms">link_off</span> ${esc(t('pr.noIncidents'))}</div>`;

    openModal({
      title: `${p.number} · ${p.title}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="form-field"><label>${esc(t('tk.statusCol'))}</label>
            <select id="pr-d-status" ${canUpdate ? '' : 'disabled'}>${PR_STATUS.map((s) => `<option value="${s}"${s === p.status ? ' selected' : ''}>${esc(prStatusLabel(s))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.priorityCol'))}</label>
            <select id="pr-d-priority" ${canUpdate ? '' : 'disabled'}>${TK_PRIORITY.map((x) => `<option value="${x}"${x === p.priority ? ' selected' : ''}>${esc(tkPriorityLabel(x))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.assignee'))}</label>
            <select id="pr-d-assignee" ${canUpdate ? '' : 'disabled'}>${assignOpts}</select></div>
          <div class="form-field full"><label>${esc(t('tk.description'))}</label>
            <div class="tk-desc">${esc(p.description || '—').replace(/\n/g, '<br>')}</div></div>
          <div class="form-field full"><label>${esc(t('pr.rootCause'))}</label>
            <textarea id="pr-d-root" rows="2" ${canUpdate ? '' : 'disabled'} placeholder="${esc(t('pr.rootCausePh'))}">${esc(p.rootCause || '')}</textarea></div>
          <div class="form-field full"><label>${esc(t('pr.workaround'))}</label>
            <textarea id="pr-d-work" rows="2" ${canUpdate ? '' : 'disabled'} placeholder="${esc(t('pr.workaroundPh'))}">${esc(p.workaround || '')}</textarea></div>
        </div>
        <h3 style="margin:16px 0 8px">${esc(t('pr.incidents'))} <span class="cell-sub">(${p.incidents ? p.incidents.length : 0})</span></h3>
        <div class="pr-inc-list">${incRows}</div>
        ${canUpdate ? `<div class="pr-link-row">
          <div id="pr-link-host" class="pr-link-host"></div>
          <button class="btn btn-primary btn-sm" id="pr-link-btn"><span class="ms ms-sm">add_link</span> ${esc(t('pr.link'))}</button>
        </div>` : ''}`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        const patch = async (body) => {
          try { await api('/problems/' + encodeURIComponent(id), { method: 'PATCH', body }); toast(t('tk.saved'), 'success'); }
          catch (err) { toast(err.message, 'error'); }
        };
        $('#pr-d-status', ov)?.addEventListener('change', (e) => patch({ status: e.target.value }).then(refresh));
        $('#pr-d-priority', ov)?.addEventListener('change', (e) => patch({ priority: e.target.value }).then(refresh));
        $('#pr-d-assignee', ov)?.addEventListener('change', (e) => patch({ assigneeUserId: e.target.value || null }).then(refresh));
        $('#pr-d-root', ov)?.addEventListener('change', (e) => patch({ rootCause: e.target.value.trim() }));
        $('#pr-d-work', ov)?.addEventListener('change', (e) => patch({ workaround: e.target.value.trim() }));
        ov.querySelectorAll('.pr-unlink').forEach((b) => b.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await api('/problems/' + encodeURIComponent(id) + '/link/' + b.dataset.tid, { method: 'DELETE' }); closeModal(); openProblem(id); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        }));
        // Click an incident card to open that ticket (deep-link).
        ov.querySelectorAll('.pr-inc[data-inc]').forEach((row) => row.addEventListener('click', () => {
          closeModal(); location.hash = '#/tickets?open=' + encodeURIComponent(row.dataset.inc);
        }));
        // Searchable combobox of incidents not already linked to this problem.
        const linkedIds = new Set((p.incidents || []).map((i) => i.id));
        const linkHost = $('#pr-link-host', ov);
        const linkPicker = linkHost ? mountCombobox(linkHost, {
          items: incidents.filter((i) => !linkedIds.has(i.id)),
          labelOf: (i) => i.number + ' · ' + i.subject,
          subOf: (i) => tkStatusLabel(i.status),
          placeholder: t('pr.linkIncident'),
        }) : null;
        $('#pr-link-btn', ov)?.addEventListener('click', async () => {
          const tid = linkPicker && linkPicker.getId();
          if (!tid) { toast(t('pr.pickIncident'), 'error'); return; }
          try { await api('/problems/' + encodeURIComponent(id) + '/link', { method: 'POST', body: { ticketId: tid } }); closeModal(); openProblem(id); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  render(Array.isArray(problems) ? problems : []);
};
