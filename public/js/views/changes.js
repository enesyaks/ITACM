/* ===================== CHANGE ENABLEMENT (ITIL) ===================== */
/* Reuses TK_PRIORITY_PILL-style pills; risk maps to the tk-list prio- accents. */

const CH_STATUS = ['draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'implementing', 'completed', 'failed', 'closed', 'cancelled'];
const CH_TYPES = ['standard', 'normal', 'emergency'];
const CH_RISKS = ['low', 'medium', 'high'];
const CH_STATUS_PILL = {
  draft: 'pill-slate', pending_approval: 'pill-amber', approved: 'pill-emerald', rejected: 'pill-rose',
  scheduled: 'pill-blue', implementing: 'pill-blue', completed: 'pill-emerald', failed: 'pill-rose',
  closed: 'pill-slate', cancelled: 'pill-rose',
};
const CH_TYPE_PILL = { standard: 'pill-slate', normal: 'pill-blue', emergency: 'pill-rose' };
const CH_RISK_PILL = { low: 'pill-slate', medium: 'pill-amber', high: 'pill-rose' };
const chStatusLabel = (s) => t('ch.status.' + s) || s;
const chTypeLabel = (x) => t('ch.type.' + x) || x;
const chRiskLabel = (r) => t('ch.risk.' + r) || r;
const chDt = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

Views.changes = async function (el) {
  const canCreate = Auth.canIam('change', 'create') || Auth.canIam('change', 'manage');
  const canUpdate = Auth.canIam('change', 'update') || Auth.canIam('change', 'manage');
  const canApprove = Auth.canIam('change', 'approve') || Auth.canIam('change', 'manage');

  const [changes, staff] = await Promise.all([
    api('/changes').catch(() => []),
    api('/auth/users').catch(() => []),
  ]);
  const staffList = Array.isArray(staff) ? staff : [];

  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const rowHtml = (c) => `<tr data-open="${esc(c.id)}" class="tk-row prio-${esc(c.risk)}" style="cursor:pointer">
      <td class="mono tk-num">${esc(c.number)}</td>
      <td><div class="cell-title">${esc(c.title)}</div></td>
      <td>${pill(CH_TYPE_PILL[c.type], chTypeLabel(c.type))}</td>
      <td>${pill(CH_STATUS_PILL[c.status], chStatusLabel(c.status))}</td>
      <td>${pill(CH_RISK_PILL[c.risk], chRiskLabel(c.risk))}</td>
      <td class="cell-sub">${esc(c.assigneeName || t('tk.unassigned'))}</td>
      <td class="cell-sub tk-date">${esc(chDt(c.scheduledStart) || '—')}</td>
    </tr>`;

  const render = (list) => {
    el.innerHTML = `
      ${pageHead(t('ch.title'), t('ch.subtitle'), canCreate
        ? `<button class="btn btn-primary" id="ch-new"><span class="ms">add</span> ${esc(t('ch.new'))}</button>` : '')}
      <div class="card table-wrap"><table class="data tk-list">
        <thead><tr>
          <th>#</th><th>${esc(t('pr.titleCol'))}</th><th>${esc(t('tk.type'))}</th>
          <th>${esc(t('tk.statusCol'))}</th><th>${esc(t('ch.risk'))}</th>
          <th>${esc(t('tk.assignee'))}</th><th>${esc(t('ch.scheduled'))}</th>
        </tr></thead>
        <tbody id="ch-rows">${list.length ? list.map(rowHtml).join('')
          : `<tr><td colspan="7" class="table-empty">${esc(t('ch.none'))}</td></tr>`}</tbody>
      </table></div>`;
    el.querySelectorAll('#ch-rows tr[data-open]').forEach((tr) => tr.addEventListener('click', () => openChange(tr.dataset.open)));
    const nb = $('#ch-new', el);
    if (nb) nb.addEventListener('click', openCreate);
  };

  async function refresh() {
    const list = await api('/changes').catch(() => []);
    render(Array.isArray(list) ? list : []);
  }

  function openCreate() {
    openModal({
      title: t('ch.new'),
      body: `<div class="form-grid">
        <div class="form-field"><label>${esc(t('tk.type'))}</label>
          <select id="ch-c-type">${CH_TYPES.map((x) => `<option value="${x}"${x === 'normal' ? ' selected' : ''}>${esc(chTypeLabel(x))}</option>`).join('')}</select></div>
        <div class="form-field"><label>${esc(t('ch.risk'))}</label>
          <select id="ch-c-risk">${CH_RISKS.map((r) => `<option value="${r}"${r === 'medium' ? ' selected' : ''}>${esc(chRiskLabel(r))}</option>`).join('')}</select></div>
        <div class="form-field full"><label>${esc(t('pr.titleCol'))} *</label><input id="ch-c-title" maxlength="300"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="ch-c-desc" rows="3"></textarea></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="ch-c-save">${esc(t('ch.create'))}</button>`,
      onMount(ov) {
        $('#ch-c-save', ov).addEventListener('click', async () => {
          try {
            await api('/changes', { method: 'POST', body: {
              type: $('#ch-c-type', ov).value, risk: $('#ch-c-risk', ov).value,
              title: $('#ch-c-title', ov).value.trim(), description: $('#ch-c-desc', ov).value.trim(),
            } });
            closeModal(); toast(t('ch.created'), 'success'); refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openChange(id) {
    const c = await api('/changes/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!c) return;
    const assignOpts = `<option value="">${esc(t('tk.unassigned'))}</option>` +
      staffList.map((u) => `<option value="${esc(u.uid)}"${u.uid === c.assigneeUserId ? ' selected' : ''}>${esc(u.username)}</option>`).join('');
    const pendingApproval = c.status === 'pending_approval';

    openModal({
      title: `${c.number} · ${c.title}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="form-field"><label>${esc(t('tk.type'))}</label>
            <select id="ch-d-type" ${canUpdate ? '' : 'disabled'}>${CH_TYPES.map((x) => `<option value="${x}"${x === c.type ? ' selected' : ''}>${esc(chTypeLabel(x))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.statusCol'))}</label>
            <select id="ch-d-status" ${canUpdate ? '' : 'disabled'}>${CH_STATUS.map((s) => `<option value="${s}"${s === c.status ? ' selected' : ''}>${esc(chStatusLabel(s))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('ch.risk'))}</label>
            <select id="ch-d-risk" ${canUpdate ? '' : 'disabled'}>${CH_RISKS.map((r) => `<option value="${r}"${r === c.risk ? ' selected' : ''}>${esc(chRiskLabel(r))}</option>`).join('')}</select></div>
          <div class="form-field"><label>${esc(t('tk.assignee'))}</label>
            <select id="ch-d-assignee" ${canUpdate ? '' : 'disabled'}>${assignOpts}</select></div>
          <div class="form-field"><label>${esc(t('ch.start'))}</label>
            <input type="datetime-local" id="ch-d-start" value="${esc(chDt(c.scheduledStart).replace(' ', 'T'))}" ${canUpdate ? '' : 'disabled'}></div>
          <div class="form-field"><label>${esc(t('ch.end'))}</label>
            <input type="datetime-local" id="ch-d-end" value="${esc(chDt(c.scheduledEnd).replace(' ', 'T'))}" ${canUpdate ? '' : 'disabled'}></div>
          <div class="form-field full"><label>${esc(t('tk.description'))}</label>
            <div class="tk-desc">${esc(c.description || '—').replace(/\n/g, '<br>')}</div></div>
          <div class="form-field full"><label>${esc(t('ch.implPlan'))}</label>
            <textarea id="ch-d-impl" rows="2" ${canUpdate ? '' : 'disabled'}>${esc(c.implementationPlan || '')}</textarea></div>
          <div class="form-field full"><label>${esc(t('ch.rollback'))}</label>
            <textarea id="ch-d-roll" rows="2" ${canUpdate ? '' : 'disabled'}>${esc(c.rollbackPlan || '')}</textarea></div>
        </div>
        ${c.approverName ? `<p class="cell-sub" style="margin:6px 0 0">${esc(t('ch.decidedBy'))}: <strong>${esc(c.approverName)}</strong> · ${esc(chStatusLabel(c.status === 'rejected' ? 'rejected' : 'approved'))}${c.approvalNote ? ' — ' + esc(c.approvalNote) : ''}</p>` : ''}
        ${(pendingApproval && canApprove) ? `<div class="tk-bulk" style="display:flex;margin-top:14px">
          <input id="ch-approve-note" class="ops-select" placeholder="${esc(t('ch.decisionNote'))}" style="flex:1;min-width:200px">
          <button class="btn btn-outline btn-sm" id="ch-reject" style="color:var(--rose-700)">${esc(t('ch.reject'))}</button>
          <button class="btn btn-primary btn-sm" id="ch-approve">${esc(t('ch.approve'))}</button>
        </div>` : ''}`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        const patch = async (body) => {
          try { await api('/changes/' + encodeURIComponent(id), { method: 'PATCH', body }); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        };
        $('#ch-d-type', ov)?.addEventListener('change', (e) => patch({ type: e.target.value }));
        $('#ch-d-status', ov)?.addEventListener('change', (e) => { patch({ status: e.target.value }); });
        $('#ch-d-risk', ov)?.addEventListener('change', (e) => patch({ risk: e.target.value }));
        $('#ch-d-assignee', ov)?.addEventListener('change', (e) => patch({ assigneeUserId: e.target.value || null }));
        $('#ch-d-start', ov)?.addEventListener('change', (e) => patch({ scheduledStart: e.target.value || null }));
        $('#ch-d-end', ov)?.addEventListener('change', (e) => patch({ scheduledEnd: e.target.value || null }));
        $('#ch-d-impl', ov)?.addEventListener('change', (e) => patch({ implementationPlan: e.target.value.trim() }));
        $('#ch-d-roll', ov)?.addEventListener('change', (e) => patch({ rollbackPlan: e.target.value.trim() }));
        const decide = async (decision) => {
          try {
            await api('/changes/' + encodeURIComponent(id) + '/decision', { method: 'POST', body: { decision, note: $('#ch-approve-note', ov).value.trim() } });
            closeModal(); toast(decision === 'approve' ? t('ch.approved') : t('ch.rejected'), 'success'); refresh();
          } catch (err) { toast(err.message, 'error'); }
        };
        $('#ch-approve', ov)?.addEventListener('click', () => decide('approve'));
        $('#ch-reject', ov)?.addEventListener('click', () => decide('reject'));
      },
    });
  }

  render(Array.isArray(changes) ? changes : []);
};
