/* ======================= SELF-SERVICE TICKETS (Portal) ======================= */
/* Reuses the pills / label helpers defined in tickets.js (loaded before this). */

Views.myTickets = async function (el) {
  const list = await api('/me/tickets').catch(() => []);
  const tickets = Array.isArray(list) ? list : [];

  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const rowHtml = (tk) => `<tr data-open="${esc(tk.id)}" style="cursor:pointer">
      <td class="mono">${esc(tk.number)}</td>
      <td>${pill('pill-slate', tkTypeLabel(tk.type))}</td>
      <td><div class="cell-title">${esc(tk.subject)}</div></td>
      <td>${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}</td>
      <td>${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</td>
      <td class="cell-sub">${esc(String(tk.createdAt || '').slice(0, 10))}</td>
    </tr>`;

  el.innerHTML = `
    ${pageHead(t('mtk.title'), t('mtk.subtitle'),
      `<button class="btn btn-primary" id="mtk-new"><span class="ms">add</span> ${esc(t('mtk.new'))}</button>`)}
    <div class="card" style="overflow-x:auto"><table class="table">
      <thead><tr>
        <th>#</th><th>${esc(t('tk.type'))}</th><th>${esc(t('tk.subject'))}</th>
        <th>${esc(t('tk.statusCol'))}</th><th>${esc(t('tk.priorityCol'))}</th><th>${esc(t('tk.createdCol'))}</th>
      </tr></thead>
      <tbody id="mtk-rows">${tickets.length ? tickets.map(rowHtml).join('')
        : `<tr><td colspan="6" class="table-empty">${esc(t('mtk.none'))}</td></tr>`}</tbody>
    </table></div>`;

  el.querySelectorAll('#mtk-rows tr[data-open]').forEach((tr) =>
    tr.addEventListener('click', () => openMine(tr.dataset.open)));
  $('#mtk-new', el).addEventListener('click', openCreate);

  function openCreate() {
    openModal({
      title: t('mtk.new'),
      body: `<div class="form-grid">
        <div class="form-field"><label>${esc(t('tk.type'))}</label>
          <select id="mtk-c-type"><option value="incident">${esc(tkTypeLabel('incident'))}</option><option value="request">${esc(tkTypeLabel('request'))}</option></select></div>
        <div class="form-field full"><label>${esc(t('tk.subject'))} *</label><input id="mtk-c-subject" maxlength="300"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="mtk-c-desc" rows="4" placeholder="${esc(t('mtk.descPh'))}"></textarea></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="mtk-c-save">${esc(t('mtk.submit'))}</button>`,
      onMount(ov) {
        $('#mtk-c-save', ov).addEventListener('click', async () => {
          try {
            await api('/me/tickets', { method: 'POST', body: {
              type: $('#mtk-c-type', ov).value,
              subject: $('#mtk-c-subject', ov).value.trim(),
              description: $('#mtk-c-desc', ov).value.trim(),
            } });
            closeModal();
            toast(t('mtk.created'), 'success');
            Views.myTickets(el);
          } catch (err) { toast(err.message, 'error'); }
        });
      },
    });
  }

  async function openMine(id) {
    const tk = await api('/me/tickets/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!tk) return;
    const comments = (tk.comments || []).map((c) => `
      <div class="tk-comment">
        <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
          <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div>${esc(c.body).replace(/\n/g, '<br>')}</div>
      </div>`).join('') || `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`;
    const open = !['resolved', 'closed', 'cancelled'].includes(tk.status);

    openModal({
      title: `${tk.number} · ${tk.subject}`,
      wide: true,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          ${pill('pill-slate', tkTypeLabel(tk.type))}
          ${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}
          ${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}
        </div>
        <div class="form-field full" style="margin-bottom:12px"><label>${esc(t('tk.description'))}</label>
          <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div></div>
        <h3 style="margin:12px 0 8px">${esc(t('mtk.updates'))}</h3>
        <div class="tk-comments">${comments}</div>
        ${open ? `<div style="margin-top:10px">
          <textarea id="mtk-d-comment" rows="2" placeholder="${esc(t('mtk.addComment'))}"></textarea>
          <div><button class="btn btn-outline btn-sm" id="mtk-d-post" style="margin-top:6px">${esc(t('tk.post'))}</button></div>
        </div>` : `<p class="cell-sub" style="margin-top:10px">${esc(t('mtk.closedNote'))}</p>`}
        <h3 style="margin:16px 0 8px">${esc(t('tk.attachments'))}</h3>
        <div id="mtk-docs" class="tk-docs"><p class="cell-sub">${esc(t('common.loading') || '…')}</p></div>
        ${open ? `<div style="margin-top:8px"><label class="btn btn-outline btn-sm" style="margin:0">
          <span class="ms ms-sm">upload_file</span> ${esc(t('tk.attach'))}
          <input type="file" id="mtk-doc-file" style="display:none"></label>
          <span class="cell-sub" style="margin-left:8px">${esc(t('tk.attachHint'))}</span></div>` : ''}`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>`,
      onMount(ov) {
        $('#mtk-d-post', ov)?.addEventListener('click', async () => {
          const body = $('#mtk-d-comment', ov).value.trim();
          if (!body) return;
          try {
            await api('/me/tickets/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { body } });
            closeModal(); openMine(id);
          } catch (err) { toast(err.message, 'error'); }
        });
        // Own-ticket attachments (public only — server filters internal).
        const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
        const loadDocs = async () => {
          const box = $('#mtk-docs', ov); if (!box) return;
          const docs = await api('/me/tickets/' + encodeURIComponent(id) + '/documents').catch(() => []);
          box.innerHTML = docs.length ? docs.map((d) => `<div class="tk-doc">
              <span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span>
              <a href="#" data-dl="${esc(d.id)}" class="tk-doc-name">${esc(d.filename)}</a>
              <span class="cell-sub">${esc(fmtSize(d.byteSize || 0))}</span></div>`).join('')
            : `<p class="cell-sub">${esc(t('tk.noAttachments'))}</p>`;
          box.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); viewAuthed('/api/me/tickets/' + encodeURIComponent(id) + '/documents/' + a.dataset.dl + '/download'); }));
        };
        loadDocs();
        $('#mtk-doc-file', ov)?.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0]; if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = String(reader.result).split(',')[1] || '';
            try { await api('/me/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64, filename: file.name } }); toast(t('tk.attached'), 'success'); loadDocs(); }
            catch (err) { toast(err.message, 'error'); }
            e.target.value = '';
          };
          reader.readAsDataURL(file);
        });
      },
    });
  }
};
