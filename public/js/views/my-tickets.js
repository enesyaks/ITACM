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
        ${typeof renderApprovalTimeline === 'function' ? renderApprovalTimeline(a.history) : ''}
        <div id="mtk-appr-context"></div>`,
      foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
             <button class="btn btn-outline" id="mtk-appr-reject" style="color:var(--rose-700)"><span class="ms ms-sm">close</span> ${esc(t('ch.reject'))}</button>
             <button class="btn btn-primary" id="mtk-appr-approve"><span class="ms ms-sm">check</span> ${esc(t('ch.approve'))}</button>`,
      onMount(ov) {
        $('#mtk-appr-approve', ov)?.addEventListener('click', () => { closeModal(); decideAppr(a.id, 'approved'); });
        $('#mtk-appr-reject', ov)?.addEventListener('click', () => { closeModal(); decideAppr(a.id, 'rejected'); });
        // Load the ticket's worklog + attachments for the approver — including
        // staff-internal notes/files (IT price research) the requester never sees.
        const dl = (docId) => '/api/me/approvals/' + encodeURIComponent(a.id) + '/documents/' + encodeURIComponent(docId) + '/download';
        const cdocsHtml = (docs) => (docs && docs.length) ? `<div class="tk-comment-docs">${docs.map((d) => `<a href="#" class="mtk-cdoc" data-adl="${esc(d.id)}"><span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span> <span class="tk-cdoc-name">${esc(d.filename)}</span></a>`).join('')}</div>` : '';
        api('/me/approvals/' + encodeURIComponent(a.id) + '/context').then((ctx) => {
          const host = $('#mtk-appr-context', ov); if (!host || !ctx) return;
          const comments = Array.isArray(ctx.comments) ? ctx.comments : [];
          const standalone = Array.isArray(ctx.documents) ? ctx.documents : [];
          if (!comments.length && !standalone.length && !ctx.description) return;
          const cHtml = comments.map((c) => `<div class="tk-comment${c.internal ? ' tk-internal' : ''}">
              <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
                ${c.internal ? `<span class="pill pill-amber"><span class="ms ms-sm" style="vertical-align:-2px">lock</span> ${esc(t('tk.internal'))}</span>` : ''}
                <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
              <div>${esc(c.body || '').replace(/\n/g, '<br>')}</div>${cdocsHtml(c.documents)}</div>`).join('');
          host.innerHTML = `<h3 style="margin:16px 0 8px">${esc(t('mtk.apContext'))}</h3>
            ${ctx.description ? `<div class="tk-desc" style="margin-bottom:10px">${esc(ctx.description).replace(/\n/g, '<br>')}</div>` : ''}
            ${comments.length ? `<div class="tk-comments">${cHtml}</div>` : `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`}
            ${standalone.length ? `<div class="tk-docs" style="margin-top:8px">${standalone.map((d) => `<div class="tk-doc"><span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span><a href="#" class="mtk-cdoc" data-adl="${esc(d.id)}" class="tk-doc-name">${esc(d.filename)}</a></div>`).join('')}</div>` : ''}`;
          host.querySelectorAll('.mtk-cdoc').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); viewAuthed(dl(el.dataset.adl)); }));
        }).catch(() => {});
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
    // The picker used to be a <select> holding every template plus the two plain
    // types, with the description and approval chain squeezed into a hint box
    // below it. Nobody read it: the chain rendered as one parenthesised run of
    // names and the choice was made before any of it was visible. Split in two —
    // choose what kind of request this is, then describe it.
    let choice = null;

    const fmtAmt = (n) => '₺' + Number(n).toLocaleString('tr-TR');

    // At most two names per step, then "+N". A step resolving to the whole IT
    // team otherwise prints eight names and buries the shape of the chain.
    const stepLabel = (step) => {
      const names = step.approvers || [];
      if (!names.length) return '—';
      if (names.length === 1) return names[0];
      const sep = step.mode === 'all' ? ' & ' : ' / ';
      if (names.length <= 2) return names.join(sep);
      return names.slice(0, 2).join(sep) + ' +' + (names.length - 2);
    };
    const chainHtml = (approval) => (approval || [])
      .map((step) => `<span class="mtk-chain-step">${esc(stepLabel(step))}</span>`)
      .join('<span class="ms ms-sm mtk-chain-arr">arrow_forward</span>');

    // Templates first — they are the guided path — then the two open-ended kinds.
    const options = [
      ...templates.map((tp) => ({
        value: 'tpl:' + tp.id,
        icon: 'assignment',
        name: tp.name,
        category: tp.category || '',
        description: tp.description || '',
        approval: tp.approval || [],
        amountThreshold: tp.amountThreshold,
      })),
      // No template fits: these two open a ticket with a free-text subject and no
      // chain. Grouped apart so they read as the fallback, not as one more form.
      { value: 'incident', group: t('mtk.groupOther'), icon: 'report', name: tkTypeLabel('incident'), category: '', description: t('mtk.incidentDesc'), approval: [], amountThreshold: null },
      { value: 'request', group: t('mtk.groupOther'), icon: 'inbox', name: tkTypeLabel('request'), category: '', description: t('mtk.requestDesc'), approval: [], amountThreshold: null },
    ];

    openModal({
      title: t('mtk.new'),
      wide: true,
      body: '<div id="mtk-wiz"></div>',
      foot: '<div id="mtk-foot"></div>',
      onMount(ov) {
        const wiz = $('#mtk-wiz', ov);
        const foot = $('#mtk-foot', ov);

        /* ---------------- step 1: what kind of request ---------------- */
        function renderPick() {
          // Grouped by the category the template already carries. A flat list of
          // fourteen made people scroll past what they wanted, and every card
          // repeated its category one line under the name — the heading says it
          // once instead. The filter is there because scanning beats scrolling
          // as soon as the catalogue outgrows a screen.
          const OTHER = t('mtk.other');
          const groups = [];
          const byName = new Map();
          for (const o of options) {
            const key = o.group || o.category || OTHER;
            let g = byName.get(key);
            if (!g) { g = { name: key, items: [] }; byName.set(key, g); groups.push(g); }
            g.items.push(o);
          }
          // Categories keep the order the templates were sorted in. The two
          // catch-alls go last whatever sort_order says: a template nobody
          // categorised should not be the first thing the list offers.
          const tail = new Set([OTHER, t('mtk.groupOther')]);
          groups.sort((a, b) => (tail.has(a.name) ? 1 : 0) - (tail.has(b.name) ? 1 : 0));
          const cardHtml = (o) => `
            <button type="button" class="mtk-pick-card" data-v="${esc(o.value)}"
                    data-q="${esc((o.name + ' ' + (o.category || '') + ' ' + (o.description || '')).toLowerCase())}">
              <span class="mtk-pick-ic ms">${esc(o.icon)}</span>
              <span class="mtk-pick-main">
                <span class="mtk-pick-name">${esc(o.name)}</span>
                ${o.description ? `<span class="mtk-pick-desc">${esc(o.description)}</span>` : ''}
                ${o.approval.length ? `<span class="mtk-chain mtk-chain-sm">
                    <span class="ms ms-sm">how_to_reg</span> ${chainHtml(o.approval)}</span>` : ''}
              </span>
              <span class="mtk-pick-go ms">chevron_right</span>
            </button>`;
          wiz.innerHTML = `<p class="mtk-lead">${esc(t('mtk.pickLead'))}</p>
            <div class="mtk-pick-search">
              <span class="ms ms-sm">search</span>
              <input id="mtk-pick-q" type="search" autocomplete="off"
                     placeholder="${esc(t('mtk.pickSearch'))}">
            </div>
            <div class="mtk-pick-groups" id="mtk-pick-groups">
              ${groups.map((g) => `
                <section class="mtk-pick-group" data-g="${esc(g.name)}">
                  <h4 class="mtk-pick-gh">${esc(g.name)}</h4>
                  <div class="mtk-pick-grid">${g.items.map(cardHtml).join('')}</div>
                </section>`).join('')}
              <p class="mtk-pick-empty hidden" id="mtk-pick-empty">${esc(t('mtk.pickNone'))}</p>
            </div>`;
          foot.innerHTML = `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>`;

          wiz.querySelectorAll('.mtk-pick-card').forEach((c) => c.addEventListener('click', () => {
            choice = options.find((o) => o.value === c.dataset.v) || null;
            if (choice) renderForm();
          }));

          // Filter in place: hide cards that miss, then hide a heading whose
          // cards have all gone, so the groups do not leave empty titles behind.
          const q = $('#mtk-pick-q', ov);
          const empty = $('#mtk-pick-empty', ov);
          q.addEventListener('input', () => {
            const term = q.value.trim().toLowerCase();
            let shown = 0;
            wiz.querySelectorAll('.mtk-pick-group').forEach((sec) => {
              let any = 0;
              sec.querySelectorAll('.mtk-pick-card').forEach((c) => {
                const hit = !term || c.dataset.q.includes(term);
                c.classList.toggle('hidden', !hit);
                if (hit) any += 1;
              });
              sec.classList.toggle('hidden', !any);
              shown += any;
            });
            empty.classList.toggle('hidden', shown > 0);
          });
          q.focus();
        }

        /* ---------------- step 2: describe it ---------------- */
        function renderForm() {
          const gated = choice.amountThreshold != null;
          wiz.innerHTML = `
            <div class="mtk-chosen">
              <span class="mtk-chosen-ic ms">${esc(choice.icon)}</span>
              <span class="mtk-chosen-main">
                <span class="mtk-chosen-name">${esc(choice.name)}</span>
                ${choice.approval.length ? `<span class="mtk-chain mtk-chain-sm">
                    <span class="ms ms-sm">how_to_reg</span> ${chainHtml(choice.approval)}</span>` : ''}
              </span>
              <button type="button" class="btn btn-ghost btn-sm" id="mtk-c-change">${esc(t('mtk.change'))}</button>
            </div>
            <div class="form-grid">
              <div class="form-field full"><label>${esc(t('tk.subject'))} *</label>
                <input id="mtk-c-subject" maxlength="300" placeholder="${esc(t('mtk.subjectPh'))}"></div>
              <div id="mtk-suggest"></div>
              ${gated ? `<div class="form-field full" id="mtk-c-amount-wrap">
                <label>${esc(t('mtk.amount'))}</label>
                <input id="mtk-c-amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0">
                <div class="cell-sub" style="margin-top:4px">${esc(t('mtk.amountHint').replace('{n}', fmtAmt(choice.amountThreshold)))}</div>
              </div>` : ''}
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
            </div>`;
          foot.innerHTML = `<button class="btn btn-outline" data-close>${esc(t('common.cancel'))}</button>
            <button class="btn btn-primary" id="mtk-c-save">${esc(t('mtk.submit'))}</button>`;

          // Going back keeps whatever was typed out of the way but preserves the
          // staged files: re-picking a kind should not cost the uploads.
          $('#mtk-c-change', ov).addEventListener('click', renderPick);

          /* --- Attachments: stage locally, upload after the ticket is created --- */
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
          renderFiles();

          /* --- Self-service deflection: suggest KB articles as the subject is typed --- */
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
          subj.focus();

          const readB64 = (file) => new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(new Error('read failed'));
            r.readAsDataURL(file);
          });
          const saveBtn = $('#mtk-c-save', ov);
          saveBtn.addEventListener('click', async () => {
            const body = { subject: subj.value.trim(), description: $('#mtk-c-desc', ov).value.trim() };
            if (!body.subject) { toast(t('mtk.subjectReq') || (t('tk.subject') + ' *'), 'error'); return; }
            if (choice.value.startsWith('tpl:')) body.templateId = choice.value.slice(4);
            else body.type = choice.value;
            if (gated) {
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
        }

        renderPick();
      },
    });
  }

  async function openMine(id) {
    const tk = await api('/me/tickets/' + encodeURIComponent(id)).catch((e) => { toast(e.message, 'error'); return null; });
    if (!tk) return;
    const cdocSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB');
    const commentDocs = (docs) => (docs && docs.length) ? `<div class="tk-comment-docs">${docs.map((d) => `<a href="#" class="mtk-cdoc" data-cdl="${esc(d.id)}"><span class="ms ms-sm">${(d.mime || '').startsWith('image/') ? 'image' : 'description'}</span> <span class="tk-cdoc-name">${esc(d.filename)}</span> <span class="cell-sub">${esc(cdocSize(d.byteSize))}</span></a>`).join('')}</div>` : '';
    const comments = (tk.comments || []).map((c) => `
      <div class="tk-comment">
        <div class="tk-comment-head"><strong>${esc(c.authorName || '')}</strong>
          <span class="cell-sub">${esc(String(c.createdAt || '').replace('T', ' ').slice(0, 16))}</span></div>
        <div>${esc(c.body).replace(/\n/g, '<br>')}</div>
        ${commentDocs(c.documents)}
      </div>`).join('') || `<p class="cell-sub">${esc(t('tk.noComments'))}</p>`;
    const open = !['resolved', 'closed', 'cancelled'].includes(tk.status);

    openModal({
      title: `${tk.number} · ${tk.subject}`,
      xwide: true,
      body: `
        <div class="tkd tkd-portal">
          <div class="tkd-topbar">
            <span class="tkd-typeicon tkd-type-${tk.type === 'incident' ? 'incident' : 'request'}"><span class="ms">${tk.type === 'incident' ? 'error' : 'assignment'}</span></span>
            <div class="tkd-topbar-info">
              <div class="tkd-badges">
                ${pill(TK_STATUS_PILL[tk.status], tkStatusLabel(tk.status))}
                ${pill(TK_PRIORITY_PILL[tk.priority], tkPriorityLabel(tk.priority))}
                ${tk.approvalStatus ? apPill(tk.approvalStatus) : ''}
              </div>
              <div class="tkd-submeta">${esc(tkTypeLabel(tk.type))} · <span class="ms ms-sm">schedule</span> ${esc(String(tk.createdAt || '').replace('T', ' ').slice(0, 16))}</div>
            </div>
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
                  <div class="mtk-files" id="mtk-d-reply-files"></div>
                  <div class="tkd-reply-foot">
                    <label class="btn btn-ghost btn-sm" style="margin:0"><span class="ms ms-sm">attach_file</span> ${esc(t('tk.attach'))}
                      <input type="file" id="mtk-d-reply-file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" multiple hidden></label>
                    <button class="btn btn-primary btn-sm" id="mtk-d-post">${esc(t('tk.post'))}</button>
                  </div>
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
        // Comment-linked files download via the portal authed path.
        ov.querySelectorAll('.mtk-cdoc').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault(); viewAuthed('/api/me/tickets/' + encodeURIComponent(id) + '/documents/' + a.dataset.cdl + '/download');
        }));
        // Stage reply files, uploaded and linked to the comment once it posts.
        const replyStaged = [];
        const replyFilesBox = $('#mtk-d-reply-files', ov);
        const renderReplyFiles = () => {
          if (!replyFilesBox) return;
          replyFilesBox.innerHTML = replyStaged.map((f, i) => `<div class="mtk-file">
            <span class="ms ms-sm">${f.type.startsWith('image/') ? 'image' : 'description'}</span>
            <span class="mtk-file-name">${esc(f.name)}</span>
            <button type="button" class="mtk-file-x" data-i="${i}"><span class="ms ms-sm">close</span></button></div>`).join('');
          replyFilesBox.querySelectorAll('.mtk-file-x').forEach((b) => b.addEventListener('click', () => { replyStaged.splice(Number(b.dataset.i), 1); renderReplyFiles(); }));
        };
        $('#mtk-d-reply-file', ov)?.addEventListener('change', (e) => {
          for (const f of e.target.files) {
            if (!/\.(pdf|png|jpe?g|webp)$/i.test(f.name)) { toast(t('mtk.fileType').replace('{n}', f.name), 'error'); continue; }
            if (f.size > 8 * 1024 * 1024) { toast(t('mtk.fileTooBig').replace('{n}', f.name), 'error'); continue; }
            replyStaged.push(f);
          }
          e.target.value = ''; renderReplyFiles();
        });
        const readReplyB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(file); });
        $('#mtk-d-post', ov)?.addEventListener('click', async () => {
          const body = $('#mtk-d-comment', ov).value.trim();
          if (!body && !replyStaged.length) return;
          try {
            const resp = await api('/me/tickets/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { body: body || t('tk.fileOnlyComment') } });
            const commentId = resp && resp.newCommentId;
            for (const f of replyStaged) {
              try { await api('/me/tickets/' + encodeURIComponent(id) + '/documents', { method: 'POST', body: { base64: await readReplyB64(f), filename: f.name, commentId } }); }
              catch { /* best-effort per file */ }
            }
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
          // Every attachment is listed here, including files posted with a comment
          // (those also render beneath their comment).
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
