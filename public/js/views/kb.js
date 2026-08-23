/* ===================== KNOWLEDGE BASE (staff) ===================== */

/* Fetch an authed file as a blob and point an <img>/<iframe> at it (the tag
   can't send the bearer token itself). */
async function kbAuthedBlob(el, url) {
  try {
    const tok = localStorage.getItem('itacm_token');
    const res = await fetch(url, { headers: { authorization: 'Bearer ' + tok } });
    if (!res.ok) return;
    el.src = URL.createObjectURL(await res.blob());
  } catch { /* leave it blank */ }
}

/* Render an article's attachments: images inline, PDFs in an inline viewer,
   other files as download links. */
function kbRenderAttachments(box, docs, urlFor) {
  if (!box) return;
  if (!docs.length) { box.innerHTML = ''; return; }
  box.innerHTML = docs.map((d) => {
    const mime = d.mime || '';
    if (mime.startsWith('image/')) return `<img class="kb-img" data-blob="${esc(d.id)}" alt="${esc(d.filename)}">`;
    if (mime === 'application/pdf') return `<div class="kb-pdf">
        <div class="kb-pdf-head"><span class="ms ms-sm">picture_as_pdf</span> <span style="flex:1">${esc(d.filename)}</span>
          <a href="#" data-dl="${esc(d.id)}" class="cell-sub">${esc(t('kb.openFull'))}</a></div>
        <iframe class="kb-pdf-frame" data-blob="${esc(d.id)}" title="${esc(d.filename)}"></iframe></div>`;
    return `<div class="tk-doc"><span class="ms ms-sm">description</span><a href="#" data-dl="${esc(d.id)}" class="tk-doc-name">${esc(d.filename)}</a></div>`;
  }).join('');
  box.querySelectorAll('[data-blob]').forEach((el) => kbAuthedBlob(el, urlFor(el.dataset.blob)));
  box.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); viewAuthed(urlFor(a.dataset.dl)); }));
}

Views.kb = async function (el) {
  const canManage = Auth.canIam('ticket', 'manage');
  // Only privileged staff may hand out a shareable article link.
  const canShare = ['Owner', 'Admin', 'Helpdesk'].includes(Auth.profile && Auth.profile.role);
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
      </div>
      ${a ? `<h3 style="margin:14px 0 8px">${esc(t('kb.attachments'))}</h3>
        <div id="kb-e-attach" class="kb-attach"></div>
        <div style="margin-top:8px"><label class="btn btn-outline btn-sm" style="margin:0">
          <span class="ms ms-sm">image</span> ${esc(t('kb.addImage'))}<input type="file" id="kb-e-file" style="display:none"></label>
          <span class="cell-sub" style="margin-left:8px">${esc(t('tk.attachHint'))}</span></div>`
        : `<p class="cell-sub" style="margin-top:10px">${esc(t('kb.saveFirst'))}</p>`}`,
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
        // Attachment management (edit mode only).
        if (a) {
          const attachBox = $('#kb-e-attach', ov);
          const loadDocs = async () => {
            const docs = await api('/kb/' + encodeURIComponent(a.id) + '/documents').catch(() => []);
            const list = Array.isArray(docs) ? docs : [];
            if (!list.length) { attachBox.innerHTML = `<p class="cell-sub">${esc(t('tk.noAttachments'))}</p>`; return; }
            attachBox.innerHTML = list.map((d) => `<div class="tk-doc">
                <span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span>
                <span class="tk-doc-name" style="flex:1">${esc(d.filename)}</span>
                <button class="btn btn-outline btn-sm kb-doc-del" data-id="${esc(d.id)}"><span class="ms ms-sm">delete</span></button>
              </div>`).join('');
            attachBox.querySelectorAll('.kb-doc-del').forEach((b) => b.addEventListener('click', async () => {
              try { await api('/kb/documents/' + b.dataset.id, { method: 'DELETE' }); loadDocs(); } catch (err) { toast(err.message, 'error'); }
            }));
          };
          loadDocs();
          $('#kb-e-file', ov)?.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async () => {
              try { await api('/kb/' + encodeURIComponent(a.id) + '/documents', { method: 'POST', body: { base64: String(reader.result).split(',')[1] || '', filename: file.name } }); toast(t('tk.attached'), 'success'); loadDocs(); }
              catch (err) { toast(err.message, 'error'); }
              e.target.value = '';
            };
            reader.readAsDataURL(file);
          });
        }
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
        <div class="tk-desc" style="line-height:1.6">${esc(a.body || '—').replace(/\n/g, '<br>')}</div>
        <div id="kb-v-attach" class="kb-attach" style="margin-top:12px"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
             ${canShare ? `<button class="btn btn-outline" id="kb-v-share"><span class="ms">link</span> ${esc(t('kb.copyLink'))}</button>` : ''}
             ${canManage ? `<button class="btn btn-primary" id="kb-v-edit"><span class="ms">edit</span> ${esc(t('common.edit'))}</button>` : ''}`,
      async onMount(ov) {
        // Reflect the open article in the URL so it can be copied/shared directly.
        history.replaceState(null, '', '#/kb?a=' + encodeURIComponent(a.id));
        $('#kb-v-share', ov)?.addEventListener('click', async () => {
          const url = `${location.origin}${location.pathname}#/kb?a=${encodeURIComponent(a.id)}`;
          try { await navigator.clipboard.writeText(url); toast(t('kb.linkCopied'), 'success'); }
          catch { toast(url, 'info'); }
        });
        $('#kb-v-edit', ov)?.addEventListener('click', () => { closeModal(); openEditor(a); });
        const docs = await api('/kb/' + encodeURIComponent(a.id) + '/documents').catch(() => []);
        kbRenderAttachments($('#kb-v-attach', ov), Array.isArray(docs) ? docs : [], (docId) => '/api/kb/documents/' + docId + '/download');
      },
      onClose() { history.replaceState(null, '', '#/kb'); },
    });
  }

  // Deep link: #/kb?a=<id> opens that article directly (shared links).
  const deep = (location.hash.split('?')[1] || '').match(/(?:^|&)a=([^&]+)/);
  if (deep) openArticle(decodeURIComponent(deep[1]));
};
