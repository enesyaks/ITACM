/* ===================== KNOWLEDGE BASE (staff) ===================== */

Views.kb = async function (el) {
  const canManage = Auth.canIam('ticket', 'manage');
  let searchTerm = '';

  const rowHtml = (a) => `<tr data-open="${esc(a.id)}" class="tk-row" style="cursor:pointer">
      <td><div class="cell-title">${esc(a.title)}</div>${a.category ? `<div class="cell-sub">${esc(a.category)}</div>` : ''}</td>
      <td>${a.published ? '<span class="pill pill-emerald">' + esc(t('kb.published')) + '</span>' : '<span class="pill pill-slate">' + esc(t('kb.draft')) + '</span>'}</td>
      <td class="cell-sub">${esc(String(a.views || 0))}</td>
      <td class="cell-sub tk-date">${esc(String(a.updatedAt || '').slice(0, 10))}</td>
    </tr>`;

  async function refresh() {
    const list = await api('/kb?search=' + encodeURIComponent(searchTerm)).catch(() => []);
    const body = $('#kb-rows', el);
    if (body) body.innerHTML = (Array.isArray(list) && list.length) ? list.map(rowHtml).join('')
      : `<tr><td colspan="4" class="table-empty">${esc(t('kb.none'))}</td></tr>`;
    el.querySelectorAll('#kb-rows tr[data-open]').forEach((tr) => tr.addEventListener('click', () => openArticle(tr.dataset.open)));
  }

  const list = await api('/kb').catch(() => []);
  el.innerHTML = `
    ${pageHead(t('kb.title'), t('kb.subtitle'), canManage
      ? `<button class="btn btn-primary" id="kb-new"><span class="ms">add</span> ${esc(t('kb.new'))}</button>` : '')}
    <div class="card card-pad" style="margin-bottom:14px">
      <input type="search" id="kb-search" class="ops-select" placeholder="${esc(t('kb.searchPh'))}" style="min-width:280px"></div>
    <div class="card table-wrap"><table class="data tk-list">
      <thead><tr><th>${esc(t('kb.article'))}</th><th>${esc(t('tk.statusCol'))}</th><th>${esc(t('kb.views'))}</th><th>${esc(t('tk.createdCol'))}</th></tr></thead>
      <tbody id="kb-rows">${(Array.isArray(list) && list.length) ? list.map(rowHtml).join('')
        : `<tr><td colspan="4" class="table-empty">${esc(t('kb.none'))}</td></tr>`}</tbody>
    </table></div>`;

  el.querySelectorAll('#kb-rows tr[data-open]').forEach((tr) => tr.addEventListener('click', () => openArticle(tr.dataset.open)));
  const nb = $('#kb-new', el);
  if (nb) nb.addEventListener('click', () => openEditor(null));
  let searchTimer = null;
  $('#kb-search', el).addEventListener('input', (e) => { searchTerm = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 300); });

  function openEditor(a) {
    openModal({
      title: a ? t('kb.edit') : t('kb.new'),
      wide: true,
      body: `<div class="form-grid">
        <div class="form-field full"><label>${esc(t('kb.articleTitle'))} *</label><input id="kb-e-title" maxlength="300" value="${esc((a && a.title) || '')}"></div>
        <div class="form-field"><label>${esc(t('tk.category'))}</label><input id="kb-e-cat" maxlength="120" value="${esc((a && a.category) || '')}"></div>
        <div class="form-field"><label>&nbsp;</label><label style="display:inline-flex;gap:6px;align-items:center;padding-top:8px"><input type="checkbox" id="kb-e-pub" ${a && a.published ? 'checked' : ''}> ${esc(t('kb.publish'))}</label></div>
        <div class="form-field full"><label>${esc(t('kb.body'))}</label><textarea id="kb-e-body" rows="10" placeholder="${esc(t('kb.bodyPh'))}">${esc((a && a.body) || '')}</textarea></div>
      </div>`,
      foot: `${a ? `<button class="btn btn-outline" id="kb-e-del" style="color:var(--rose-700);margin-right:auto">${esc(t('common.delete') || 'Delete')}</button>` : ''}
             <button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="kb-e-save">${esc(t('common.save'))}</button>`,
      onMount(ov) {
        $('#kb-e-save', ov).addEventListener('click', async () => {
          const body = { title: $('#kb-e-title', ov).value.trim(), category: $('#kb-e-cat', ov).value.trim(), body: $('#kb-e-body', ov).value.trim(), published: $('#kb-e-pub', ov).checked };
          try {
            if (a) await api('/kb/' + encodeURIComponent(a.id), { method: 'PATCH', body });
            else await api('/kb', { method: 'POST', body });
            closeModal(); toast(t('tk.saved'), 'success'); refresh();
          } catch (err) { toast(err.message, 'error'); }
        });
        $('#kb-e-del', ov)?.addEventListener('click', async () => {
          if (!(await confirmModal(t('kb.deleteConfirm')))) return;
          try { await api('/kb/' + encodeURIComponent(a.id), { method: 'DELETE' }); closeModal(); toast(t('tk.saved'), 'success'); refresh(); }
          catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openArticle(id) {
    const a = await api('/kb/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!a) return;
    openModal({
      title: a.title,
      wide: true,
      body: `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          ${a.category ? `<span class="pill pill-slate">${esc(a.category)}</span>` : ''}
          ${a.published ? `<span class="pill pill-emerald">${esc(t('kb.published'))}</span>` : `<span class="pill pill-slate">${esc(t('kb.draft'))}</span>`}
          <span class="cell-sub">${esc(String(a.views || 0))} ${esc(t('kb.views'))}</span>
        </div>
        <div class="tk-desc" style="line-height:1.6">${esc(a.body || '—').replace(/\n/g, '<br>')}</div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
             ${canManage ? `<button class="btn btn-primary" id="kb-v-edit"><span class="ms">edit</span> ${esc(t('common.edit'))}</button>` : ''}`,
      onMount(ov) { $('#kb-v-edit', ov)?.addEventListener('click', () => { closeModal(); openEditor(a); }); },
    });
  }
};
