/* ======================= SELF-SERVICE TICKETS (Portal) ======================= */
/* Reuses the pills / label helpers defined in tickets.js (loaded before this). */

Views.myTickets = async function (el) {
  const [list, tplRes, apprRes] = await Promise.all([
    api('/me/tickets').catch(() => []),
    api('/me/request-templates').catch(() => []),
    api('/me/approvals/pending').catch(() => []),
  ]);
  const tickets = Array.isArray(list) ? list : [];
  const templates = Array.isArray(tplRes) ? tplRes : [];
  const approvals = Array.isArray(apprRes) ? apprRes : [];

  const pill = (cls, label) => `<span class="pill ${cls}">${esc(label)}</span>`;
  const apPill = (s) => (s === 'pending' ? pill('pill-amber', t('mtk.apPending'))
    : s === 'approved' ? pill('pill-emerald', t('mtk.apApproved'))
    : s === 'rejected' ? pill('pill-rose', t('mtk.apRejected')) : '');
  const rowHtml = (tk) => `<tr data-open="${esc(tk.id)}" style="cursor:pointer">
      <td class="mono">${esc(tk.number)}</td>
      <td>${pill('pill-slate', tkTypeLabel(tk.type))}</td>
      <td><div class="cell-title">${esc(tk.subject)}</div></td>
      <td><span class="mtk-status">${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}${tk.approvalStatus ? apPill(tk.approvalStatus) : ''}</span></td>
      <td>${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</td>
      <td class="cell-sub">${esc(String(tk.createdAt || '').slice(0, 10))}</td>
    </tr>`;

  const apprCard = (a) => `<div class="tk-doc" data-appr="${esc(a.id)}">
      <span style="flex:1"><strong>${esc(a.summary || t('mtk.apGeneric'))}</strong>
        <span class="cell-sub"> · ${esc(t('mtk.apFrom'))} ${esc(a.requesterName || '—')}</span></span>
      <button class="btn btn-outline btn-sm appr-reject" data-id="${esc(a.id)}" style="color:var(--rose-700)">${esc(t('ch.reject'))}</button>
      <button class="btn btn-primary btn-sm appr-approve" data-id="${esc(a.id)}">${esc(t('ch.approve'))}</button>
    </div>`;

  el.innerHTML = `
    ${pageHead(t('mtk.title'), t('mtk.subtitle'),
      `<button class="btn btn-primary" id="mtk-new"><span class="ms">add</span> ${esc(t('mtk.new'))}</button>`)}
    ${approvals.length ? `<div class="card card-pad" style="margin-bottom:14px">
      <h3 style="margin:0 0 10px">${esc(t('mtk.approvalsTitle'))} <span class="pill pill-amber">${approvals.length}</span></h3>
      <div class="tk-docs">${approvals.map(apprCard).join('')}</div></div>` : ''}
    <div class="card table-wrap"><table class="data mtk-list">
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
  const decideAppr = async (id, decision) => {
    try { await api('/me/approvals/' + encodeURIComponent(id) + '/decide', { method: 'POST', body: { decision } });
      toast(decision === 'approved' ? t('ch.approved') : t('ch.rejected'), 'success'); Views.myTickets(el);
    } catch (err) { toast(err.message, 'error'); }
  };
  el.querySelectorAll('.appr-approve').forEach((b) => b.addEventListener('click', () => decideAppr(b.dataset.id, 'approved')));
  el.querySelectorAll('.appr-reject').forEach((b) => b.addEventListener('click', () => decideAppr(b.dataset.id, 'rejected')));

  function openCreate() {
    openModal({
      title: t('mtk.new'),
      body: `<div class="form-grid">
        <div class="form-field full"><label>${esc(t('mtk.kind'))}</label>
          <select id="mtk-c-kind">
            ${templates.map((tp) => `<option value="tpl:${esc(tp.id)}">${esc(tp.name)}${tp.category ? ' · ' + esc(tp.category) : ''}</option>`).join('')}
            <option value="incident">${esc(tkTypeLabel('incident'))}</option>
            <option value="request">${esc(tkTypeLabel('request'))}</option>
          </select>
          <div class="cell-sub" id="mtk-c-hint" style="margin-top:4px"></div></div>
        <div class="form-field full"><label>${esc(t('tk.subject'))} *</label><input id="mtk-c-subject" maxlength="300"></div>
        <div id="mtk-suggest"></div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label><textarea id="mtk-c-desc" rows="4" placeholder="${esc(t('mtk.descPh'))}"></textarea></div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="mtk-c-save">${esc(t('mtk.submit'))}</button>`,
      onMount(ov) {
        const kind = $('#mtk-c-kind', ov);
        const hint = $('#mtk-c-hint', ov);
        const chainStr = (approval) => (approval || []).map((step) => {
          const names = step.approvers || [];
          if (!names.length) return '—';
          if (names.length === 1) return names[0];
          return '(' + names.join(step.mode === 'all' ? ' & ' : ' / ') + ')';
        }).join(' → ');
        const showHint = () => {
          const tp = templates.find((x) => 'tpl:' + x.id === kind.value);
          const chain = tp && tp.approval && tp.approval.length ? chainStr(tp.approval) : '';
          hint.innerHTML = `${tp && tp.description ? esc(tp.description) : ''}${chain ? `<div style="margin-top:2px"><span class="ms ms-sm" style="vertical-align:-3px">how_to_reg</span> ${esc(t('mtk.approvalChain'))}: ${esc(chain)}</div>` : ''}`;
        };
        kind.addEventListener('change', showHint); showHint();
        // Self-service deflection: suggest matching KB articles as the subject is typed.
        const subj = $('#mtk-c-subject', ov);
        const suggestBox = $('#mtk-suggest', ov);
        let sugTimer = null;
        const renderSuggest = async () => {
          const q = subj.value.trim();
          if (q.length < 3) { suggestBox.innerHTML = ''; return; }
          const arts = await api('/me/kb?search=' + encodeURIComponent(q)).catch(() => []);
          const top = (Array.isArray(arts) ? arts : []).slice(0, 3);
          if (!top.length) { suggestBox.innerHTML = ''; return; }
          suggestBox.innerHTML = `<div class="mtk-deflect">
              <div class="cell-sub" style="margin-bottom:6px"><span class="ms ms-sm" style="vertical-align:-3px">lightbulb</span> ${esc(t('mtk.maybeHelp'))}</div>
              ${top.map((a) => `<div class="mtk-sug" data-a="${esc(a.id)}"><span class="ms ms-sm">menu_book</span> <span>${esc(a.title)}</span></div>
                <div class="mtk-sug-body" data-body="${esc(a.id)}" style="display:none"></div>`).join('')}</div>`;
          suggestBox.querySelectorAll('.mtk-sug').forEach((row) => row.addEventListener('click', async () => {
            const id = row.dataset.a;
            const panel = suggestBox.querySelector(`[data-body="${id}"]`);
            if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
            if (!panel.dataset.loaded) {
              const a = await api('/me/kb/' + encodeURIComponent(id)).catch(() => null);
              if (a) {
                panel.innerHTML = `<div class="tk-desc" style="line-height:1.5">${esc(a.body || '—').replace(/\n/g, '<br>')}</div><div class="kb-attach" style="margin-top:8px"></div>`;
                const docs = await api('/me/kb/' + encodeURIComponent(id) + '/documents').catch(() => []);
                kbRenderAttachments(panel.querySelector('.kb-attach'), Array.isArray(docs) ? docs : [], (docId) => '/api/me/kb/' + encodeURIComponent(id) + '/documents/' + docId + '/download');
                panel.dataset.loaded = '1';
              }
            }
            panel.style.display = 'block';
          }));
        };
        subj.addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(renderSuggest, 350); });
        $('#mtk-c-save', ov).addEventListener('click', async () => {
          const v = kind.value;
          const body = { subject: $('#mtk-c-subject', ov).value.trim(), description: $('#mtk-c-desc', ov).value.trim() };
          if (v.startsWith('tpl:')) body.templateId = v.slice(4); else body.type = v;
          try {
            await api('/me/tickets', { method: 'POST', body });
            closeModal(); toast(t('mtk.created'), 'success'); Views.myTickets(el);
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
          ${tk.approvalStatus ? apPill(tk.approvalStatus) : ''}
        </div>
        ${tk.approvalStatus === 'pending' && tk.approvalApprover ? `<p class="cell-sub" style="margin:-6px 0 12px">${esc(t('mtk.apWaiting'))} <strong>${esc(tk.approvalApprover)}</strong></p>` : ''}
        <div class="form-field full" style="margin-bottom:12px"><label>${esc(t('tk.description'))}</label>
          <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div></div>
        ${tk.resolutionNote ? `<div class="form-field full" style="margin-bottom:12px"><label>${esc(t('mtk.resolution'))}</label>
          <div class="tk-desc">${esc(tk.resolutionNote).replace(/\n/g, '<br>')}</div></div>` : ''}
        ${['resolved', 'closed'].includes(tk.status) ? `<div class="mtk-csat" style="margin-bottom:12px">
          <label class="form-label">${esc(t('mtk.rateTitle'))}</label>
          ${tk.csatRating ? `<div style="padding-top:4px">${'★'.repeat(tk.csatRating)}<span class="tk-stars-off">${'★'.repeat(5 - tk.csatRating)}</span> <span class="cell-sub">${esc(t('mtk.rateThanks'))}</span></div>`
            : `<div class="mtk-stars" style="margin-top:4px">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="mtk-star" data-star="${n}" aria-label="${n}">★</button>`).join('')}</div>
               <textarea id="mtk-csat-comment" rows="2" placeholder="${esc(t('mtk.rateComment'))}" style="margin-top:6px"></textarea>
               <div><button class="btn btn-outline btn-sm" id="mtk-csat-send" style="margin-top:6px" disabled>${esc(t('mtk.rateSubmit'))}</button></div>`}
        </div>` : ''}
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
        // CSAT: pick a star rating, then submit.
        let csatValue = 0;
        const stars = [...ov.querySelectorAll('.mtk-star')];
        const paint = () => stars.forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= csatValue));
        stars.forEach((s) => s.addEventListener('click', () => { csatValue = Number(s.dataset.star); paint(); const b = $('#mtk-csat-send', ov); if (b) b.disabled = false; }));
        $('#mtk-csat-send', ov)?.addEventListener('click', async () => {
          if (!csatValue) return;
          try {
            await api('/me/tickets/' + encodeURIComponent(id) + '/csat', { method: 'POST', body: { rating: csatValue, comment: $('#mtk-csat-comment', ov).value.trim() } });
            toast(t('mtk.rateThanks'), 'success'); closeModal(); openMine(id);
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
