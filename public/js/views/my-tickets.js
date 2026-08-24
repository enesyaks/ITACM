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

  const apprCard = (a) => `<div class="tk-doc" data-appr="${esc(a.id)}" style="cursor:pointer">
      <span style="flex:1"><strong>${esc(a.summary || t('mtk.apGeneric'))}</strong>
        <span class="cell-sub"> · ${esc(t('mtk.apFrom'))} ${esc(a.requesterName || '—')}</span></span>
      <button class="btn btn-outline btn-sm appr-reject" data-id="${esc(a.id)}" style="color:var(--rose-700)">${esc(t('ch.reject'))}</button>
      <button class="btn btn-primary btn-sm appr-approve" data-id="${esc(a.id)}">${esc(t('ch.approve'))}</button>
      <span class="ms ms-sm" style="color:var(--on-surface-variant)">chevron_right</span>
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
  el.querySelectorAll('.appr-approve').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decideAppr(b.dataset.id, 'approved'); }));
  el.querySelectorAll('.appr-reject').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decideAppr(b.dataset.id, 'rejected'); }));
  const byApprId = new Map(approvals.map((a) => [a.id, a]));
  el.querySelectorAll('[data-appr]').forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const a = byApprId.get(card.dataset.appr);
    if (a) openApprDetail(a);
  }));

  // Read-only detail for a request awaiting my approval, with approve/reject.
  function openApprDetail(a) {
    const amount = a.payload && a.payload.amount;
    const n = Array.isArray(a.levels) ? a.levels.length : 0;
    const step = n > 1 ? `<span class="pill pill-slate">${(a.currentLevel || 0) + 1} / ${n}</span>` : '';
    const field = (label, val) => `<div class="form-field"><label>${esc(label)}</label><div style="padding-top:4px">${val}</div></div>`;
    openModal({
      title: a.summary || t('mtk.apGeneric'),
      wide: true,
      body: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          ${apPill('pending')}${a.resourceRef ? ` <span class="pill pill-slate"><span class="mono">${esc(a.resourceRef)}</span></span>` : ''} ${step}
        </div>
        <div class="form-grid">
          ${field(t('tk.requester'), esc(a.requesterName || '—'))}
          ${amount != null ? field(t('mtk.amount'), `<strong>₺${esc(Number(amount).toLocaleString('tr-TR'))}</strong>`) : ''}
          ${a.createdAt ? field(t('tk.createdCol'), `<span class="cell-sub">${esc(String(a.createdAt).replace('T', ' ').slice(0, 16))}</span>`) : ''}
          ${a.approverName ? field(t('mtk.apWaiting'), esc(a.approverName)) : ''}
        </div>
        ${typeof renderApprovalTimeline === 'function' ? renderApprovalTimeline(a.history) : ''}`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
             <button class="btn btn-outline" id="mtk-appr-reject" style="color:var(--rose-700)"><span class="ms ms-sm">close</span> ${esc(t('ch.reject'))}</button>
             <button class="btn btn-primary" id="mtk-appr-approve"><span class="ms ms-sm">check</span> ${esc(t('ch.approve'))}</button>`,
      onMount(ov) {
        $('#mtk-appr-approve', ov)?.addEventListener('click', () => { closeModal(); decideAppr(a.id, 'approved'); });
        $('#mtk-appr-reject', ov)?.addEventListener('click', () => { closeModal(); decideAppr(a.id, 'rejected'); });
      },
    });
  }

  // Allowed attachment types / size, mirrored from the server uploadGuard.
  const MTK_MAX_BYTES = 8 * 1024 * 1024;
  const MTK_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
  const mtkFmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  function openCreate() {
    // Files staged before the ticket exists; uploaded after it is created.
    const staged = [];
    openModal({
      title: t('mtk.new'),
      wide: true,
      body: `<p class="mtk-lead">${esc(t('mtk.createLead'))}</p>
      <div class="form-grid">
        <div class="form-field full"><label>${esc(t('mtk.kind'))}</label>
          <select id="mtk-c-kind">
            ${templates.map((tp) => `<option value="tpl:${esc(tp.id)}">${esc(tp.name)}${tp.category ? ' · ' + esc(tp.category) : ''}</option>`).join('')}
            <option value="incident">${esc(tkTypeLabel('incident'))}</option>
            <option value="request">${esc(tkTypeLabel('request'))}</option>
          </select>
          <div class="mtk-info" id="mtk-c-info" style="display:none"></div></div>
        <div class="form-field full"><label>${esc(t('tk.subject'))} *</label>
          <input id="mtk-c-subject" maxlength="300" placeholder="${esc(t('mtk.subjectPh'))}"></div>
        <div id="mtk-suggest"></div>
        <div class="form-field full" id="mtk-c-amount-wrap" style="display:none">
          <label>${esc(t('mtk.amount'))}</label>
          <input id="mtk-c-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0">
          <div class="cell-sub" id="mtk-c-amount-hint" style="margin-top:4px"></div>
        </div>
        <div class="form-field full"><label>${esc(t('tk.description'))}</label>
          <textarea id="mtk-c-desc" rows="4" placeholder="${esc(t('mtk.descPh'))}"></textarea></div>
        <div class="form-field full"><label>${esc(t('tk.attachments'))} <span class="cell-sub">(${esc(t('common.optional') || 'optional')})</span></label>
          <div class="mtk-drop" id="mtk-c-drop" tabindex="0" role="button">
            <span class="ms">cloud_upload</span>
            <div class="mtk-drop-txt"><strong>${esc(t('mtk.dropTitle'))}</strong>
              <span class="cell-sub">${esc(t('tk.attachHint'))}</span></div>
            <input type="file" id="mtk-c-file" accept="${MTK_ACCEPT}" multiple hidden>
          </div>
          <div class="mtk-files" id="mtk-c-files"></div>
        </div>
      </div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
             <button class="btn btn-primary" id="mtk-c-save">${esc(t('mtk.submit'))}</button>`,
      onMount(ov) {
        const kind = $('#mtk-c-kind', ov);
        const info = $('#mtk-c-info', ov);
        const chainHtml = (approval) => (approval || []).map((step) => {
          const names = step.approvers || [];
          const label = !names.length ? '—' : names.length === 1 ? names[0]
            : '(' + names.join(step.mode === 'all' ? ' & ' : ' / ') + ')';
          return `<span class="mtk-chain-step">${esc(label)}</span>`;
        }).join('<span class="ms ms-sm mtk-chain-arr">arrow_forward</span>');
        const amtWrap = $('#mtk-c-amount-wrap', ov);
        const fmtAmt = (n) => '₺' + Number(n).toLocaleString('tr-TR');
        const showHint = () => {
          const tp = templates.find((x) => 'tpl:' + x.id === kind.value);
          const desc = tp && tp.description ? `<div class="mtk-info-desc">${esc(tp.description)}</div>` : '';
          const chain = tp && tp.approval && tp.approval.length
            ? `<div class="mtk-chain"><span class="ms ms-sm">how_to_reg</span> <span class="mtk-chain-lbl">${esc(t('mtk.approvalChain'))}</span> ${chainHtml(tp.approval)}</div>` : '';
          if (desc || chain) { info.innerHTML = desc + chain; info.style.display = ''; }
          else { info.style.display = 'none'; }
          // Amount field only for templates that gate a step on a threshold.
          if (tp && tp.amountThreshold != null) {
            amtWrap.style.display = '';
            $('#mtk-c-amount-hint', ov).textContent = t('mtk.amountHint').replace('{n}', fmtAmt(tp.amountThreshold));
          } else {
            amtWrap.style.display = 'none';
          }
        };
        kind.addEventListener('change', showHint); showHint();

        // --- Attachments: stage locally, upload after the ticket is created ---
        const drop = $('#mtk-c-drop', ov);
        const fileInput = $('#mtk-c-file', ov);
        const filesBox = $('#mtk-c-files', ov);
        const renderFiles = () => {
          filesBox.innerHTML = staged.map((f, i) => `<div class="mtk-file">
            <span class="ms ms-sm">${f.type.startsWith('image/') ? 'image' : 'description'}</span>
            <span class="mtk-file-name">${esc(f.name)}</span>
            <span class="cell-sub">${esc(mtkFmtSize(f.size))}</span>
            <button type="button" class="mtk-file-x" data-i="${i}" title="${esc(t('common.remove') || 'Remove')}"><span class="ms ms-sm">close</span></button>
          </div>`).join('');
          filesBox.querySelectorAll('.mtk-file-x').forEach((b) => b.addEventListener('click', () => {
            staged.splice(Number(b.dataset.i), 1); renderFiles();
          }));
        };
        const addFiles = (list) => {
          for (const f of list) {
            const okType = /\.(pdf|png|jpe?g|webp)$/i.test(f.name) || /^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type);
            if (!okType) { toast(t('mtk.fileType').replace('{n}', f.name), 'error'); continue; }
            if (f.size > MTK_MAX_BYTES) { toast(t('mtk.fileTooBig').replace('{n}', f.name), 'error'); continue; }
            if (staged.some((s) => s.name === f.name && s.size === f.size)) continue;
            staged.push(f);
          }
          renderFiles();
        };
        drop.addEventListener('click', () => fileInput.click());
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
        fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev !== 'dragleave' || e.target === drop) drop.classList.remove('is-over'); }));
        drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
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
              <div class="mtk-deflect-head"><span class="ms ms-sm">lightbulb</span> ${esc(t('mtk.maybeHelp'))}</div>
              ${top.map((a) => `<div class="mtk-sug" data-a="${esc(a.id)}"><span class="ms ms-sm">menu_book</span> <span class="mtk-sug-title">${esc(a.title)}</span><span class="ms ms-sm mtk-sug-chev">expand_more</span></div>
                <div class="mtk-sug-body" data-body="${esc(a.id)}" style="display:none"></div>`).join('')}</div>`;
          suggestBox.querySelectorAll('.mtk-sug').forEach((row) => row.addEventListener('click', async () => {
            const id = row.dataset.a;
            const panel = suggestBox.querySelector(`[data-body="${id}"]`);
            if (panel.style.display === 'block') { panel.style.display = 'none'; row.classList.remove('open'); return; }
            row.classList.add('open');
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
        const readB64 = (file) => new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || '');
          r.onerror = () => reject(new Error('read failed'));
          r.readAsDataURL(file);
        });
        const saveBtn = $('#mtk-c-save', ov);
        saveBtn.addEventListener('click', async () => {
          const v = kind.value;
          const body = { subject: $('#mtk-c-subject', ov).value.trim(), description: $('#mtk-c-desc', ov).value.trim() };
          if (!body.subject) { toast(t('mtk.subjectReq') || (t('tk.subject') + ' *'), 'error'); return; }
          if (v.startsWith('tpl:')) body.templateId = v.slice(4); else body.type = v;
          if (amtWrap.style.display !== 'none') {
            const amt = Number($('#mtk-c-amount', ov).value);
            if (Number.isFinite(amt) && amt >= 0) body.amount = amt;
          }
          const label = saveBtn.innerHTML;
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<span class="btn-spin"></span>' + esc(t('mtk.submit'));
          try {
            const created = await api('/me/tickets', { method: 'POST', body });
            const id = created && created.id;
            // Upload staged attachments now that the ticket exists (best-effort).
            let failed = 0;
            for (const f of staged) {
              try {
                const base64 = await readB64(f);
                await api('/me/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64, filename: f.name } });
              } catch { failed++; }
            }
            closeModal();
            if (failed) toast(t('mtk.someAttachFailed').replace('{n}', failed), 'error');
            else toast(t('mtk.created'), 'success');
            Views.myTickets(el);
          } catch (err) {
            saveBtn.disabled = false; saveBtn.innerHTML = label;
            toast(err.message, 'error');
          }
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
      xwide: true,
      body: `
        <div class="tkd tkd-portal">
          <div class="tkd-topbar">
            ${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}
            ${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}
            <span class="tkd-chip"><span class="ms ms-sm">${tk.type === 'incident' ? 'error' : 'assignment'}</span> ${esc(tkTypeLabel(tk.type))}</span>
            ${tk.approvalStatus ? apPill(tk.approvalStatus) : ''}
            <span class="tkd-topmeta"><span class="ms ms-sm">schedule</span> ${esc(String(tk.createdAt || '').replace('T', ' ').slice(0, 16))}</span>
          </div>
          <div class="tkd-grid">
            <div class="tkd-main">
              <section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('tk.description'))}</h4>
                <div class="tk-desc">${esc(tk.description || '—').replace(/\n/g, '<br>')}</div>
              </section>
              ${tk.resolutionNote ? `<section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('mtk.resolution'))}</h4>
                <div class="tk-desc">${esc(tk.resolutionNote).replace(/\n/g, '<br>')}</div></section>` : ''}
              ${['resolved', 'closed'].includes(tk.status) ? `<section class="tkd-sec mtk-csat">
                <h4 class="tkd-h">${esc(t('mtk.rateTitle'))}</h4>
                ${tk.csatRating ? `<div>${'★'.repeat(tk.csatRating)}<span class="tk-stars-off">${'★'.repeat(5 - tk.csatRating)}</span> <span class="cell-sub">${esc(t('mtk.rateThanks'))}</span></div>`
                  : `<div class="mtk-stars">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="mtk-star" data-star="${n}" aria-label="${n}">★</button>`).join('')}</div>
                     <textarea id="mtk-csat-comment" rows="2" placeholder="${esc(t('mtk.rateComment'))}" style="margin-top:6px"></textarea>
                     <div><button class="btn btn-outline btn-sm" id="mtk-csat-send" style="margin-top:6px" disabled>${esc(t('mtk.rateSubmit'))}</button></div>`}
              </section>` : ''}
              <section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('mtk.updates'))}</h4>
                <div class="tk-comments">${comments}</div>
                ${open ? `<div class="tkd-reply">
                  <textarea id="mtk-d-comment" rows="3" placeholder="${esc(t('mtk.addComment'))}"></textarea>
                  <div class="tkd-reply-foot"><span></span><button class="btn btn-primary btn-sm" id="mtk-d-post">${esc(t('tk.post'))}</button></div>
                </div>` : `<p class="cell-sub">${esc(t('mtk.closedNote'))}</p>`}
              </section>
              <section class="tkd-sec">
                <h4 class="tkd-h">${esc(t('tk.attachments'))}</h4>
                <div id="mtk-docs" class="tk-docs"><p class="cell-sub">${esc(t('common.loading') || '…')}</p></div>
                ${open ? `<div class="tkd-upload-row"><label class="btn btn-outline btn-sm" style="margin:0">
                  <span class="ms ms-sm">upload_file</span> ${esc(t('tk.attach'))}
                  <input type="file" id="mtk-doc-file" style="display:none"></label>
                  <span class="cell-sub">${esc(t('tk.attachHint'))}</span></div>` : ''}
              </section>
            </div>
            <aside class="tkd-side">
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.statusCol'))}</span>
                <div class="tkd-val">${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}</div></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.priorityCol'))}</span>
                <div class="tkd-val">${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}</div></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.type'))}</span>
                <div class="tkd-val">${esc(tkTypeLabel(tk.type))}</div></div>
              <div class="tkd-prop"><span class="tkd-plabel">${esc(t('tk.createdCol'))}</span>
                <div class="tkd-val">${esc(String(tk.createdAt || '').replace('T', ' ').slice(0, 16))}</div></div>
              ${tk.approvalStatus ? `<div class="tkd-prop"><span class="tkd-plabel">${esc(t('rt.approval'))}</span>
                <div class="tkd-val">${apPill(tk.approvalStatus)}</div>
                ${tk.approvalStatus === 'pending' && tk.approvalApprover ? `<div class="cell-sub" style="margin-top:4px">${esc(t('mtk.apWaiting'))} <strong>${esc(tk.approvalApprover)}</strong></div>` : ''}</div>
              ${renderApprovalTimeline(tk.approvalHistory)}` : ''}
            </aside>
          </div>
        </div>`,
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
