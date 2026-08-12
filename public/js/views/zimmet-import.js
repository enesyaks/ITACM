/* Bulk historical zimmet PDF import — 3-step wizard:
   upload PDFs → review split forms & name matches → attach to profiles. */
Views.zimmetImport = async function (el) {
  let files = [];        // [{ name, base64 }]
  let batch = null;      // analyze result
  let employees = [];    // [{ id, fullName }] for the assignment selects

  const readAsDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  async function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) continue;
      if (f.size > 8 * 1024 * 1024) { toast(t('zim.tooLarge'), 'error'); continue; }
      files.push({ name: f.name, base64: await readAsDataURL(f) });
    }
    renderUpload();
  }

  /* ---------- Step 1: upload ---------- */
  function renderUpload() {
    el.innerHTML = `
      ${pageHead(t('zim.title'), t('zim.sub'), '')}
      <div class="card card-pad">
        <div id="zim-drop" class="zim-drop">
          <span class="ms" style="font-size:40px;color:var(--on-surface-variant)">upload_file</span>
          <div class="cell-sub" style="margin:8px 0 14px">${esc(t('zim.dropHint'))}</div>
          <button class="btn btn-outline" id="zim-pick"><span class="ms">attach_file</span> ${esc(t('zim.selectFiles'))}</button>
          <input type="file" id="zim-file" accept="application/pdf,.pdf" multiple hidden>
        </div>
        ${files.length ? `<div style="margin-top:16px">
          <div class="cell-sub" style="margin-bottom:8px">${esc(t('zim.filesSelected').replace('{n}', files.length))}</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${files.map((f, i) => `<div class="zim-file-row">
              <span class="ms">picture_as_pdf</span><span class="cell-title" style="flex:1">${esc(f.name)}</span>
              <button class="icon-btn" data-rm="${i}" title="${esc(t('common.delete') || 'Remove')}"><span class="ms ms-sm">close</span></button>
            </div>`).join('')}
          </div>
          <button class="btn btn-primary" id="zim-analyze" style="margin-top:16px"><span class="ms">search</span> ${esc(t('zim.analyze'))}</button>
        </div>` : ''}
      </div>`;

    const drop = $('#zim-drop', el);
    const input = $('#zim-file', el);
    $('#zim-pick', el).addEventListener('click', () => input.click());
    input.addEventListener('change', () => addFiles(input.files));
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { files.splice(Number(b.dataset.rm), 1); renderUpload(); }));

    const analyze = $('#zim-analyze', el);
    if (analyze) analyze.addEventListener('click', async () => {
      analyze.disabled = true; analyze.innerHTML = `<span class="ms">hourglass_empty</span> ${esc(t('zim.analyzing'))}`;
      try {
        batch = await api('/import/zimmet/analyze', { method: 'POST', body: { files: files.map((f) => ({ filename: f.name, base64: f.base64 })) } });
        if (batch.failures && batch.failures.length) toast(t('zim.readFail').replace('{n}', batch.failures.length), 'error');
        if (!batch.items.length) { toast(t('zim.noForms'), 'error'); analyze.disabled = false; analyze.innerHTML = `<span class="ms">search</span> ${esc(t('zim.analyze'))}`; return; }
        const emps = await api('/employees?limit=10000');
        employees = (Array.isArray(emps) ? emps : (emps.items || [])).map((e) => ({ id: e.id, fullName: e.fullName }));
        renderReview();
      } catch (err) { toast(err.message, 'error'); analyze.disabled = false; analyze.innerHTML = `<span class="ms">search</span> ${esc(t('zim.analyze'))}`; }
    });
  }

  /* ---------- Step 2: review & attach ---------- */
  function confBadge(c) {
    if (c === 'high') return `<span class="pill pill-emerald">${esc(t('zim.confHigh'))}</span>`;
    if (c === 'medium') return `<span class="pill pill-amber">${esc(t('zim.confMedium'))}</span>`;
    return `<span class="pill pill-rose">${esc(t('zim.confNone'))}</span>`;
  }
  function empSelect(it) {
    const opts = [`<option value="">${esc(t('zim.skip'))}</option>`]
      .concat(employees.map((e) => `<option value="${esc(e.id)}" ${e.id === it.matchedEmployeeId ? 'selected' : ''}>${esc(e.fullName)}</option>`));
    return `<select class="ops-select" data-emp="${esc(it.id)}" style="min-width:200px">${opts.join('')}</select>`;
  }

  function renderReview() {
    el.innerHTML = `
      ${pageHead(t('zim.title'), t('zim.sub'), `<button class="btn btn-outline" id="zim-back"><span class="ms">arrow_back</span> ${esc(t('zim.back'))}</button>`)}
      <div class="card">
        <div class="card-pad" style="padding-bottom:8px"><span class="cell-sub">${esc(t('zim.summary').replace('{n}', batch.items.length).replace('{f}', (batch.sourceFiles || []).length))}</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th>${esc(t('zim.colForm'))}</th><th>${esc(t('zim.colDetected'))}</th>
            <th>${esc(t('zim.colConfidence'))}</th><th>${esc(t('zim.colEmployee'))}</th>
            <th style="text-align:right">${esc(t('zim.colPreview'))}</th>
          </tr></thead>
          <tbody>
            ${batch.items.map((it) => `<tr>
              <td><div class="cell-title mono" style="font-size:12px">${esc(it.filename)}</div>
                <div class="cell-sub">${esc(t('zim.pages').replace('{from}', it.pageFrom + 1).replace('{to}', it.pageTo + 1))}</div></td>
              <td>${it.extractedName ? esc(it.extractedName) : '<span class="cell-sub">—</span>'}</td>
              <td>${confBadge(it.confidence)}</td>
              <td>${empSelect(it)}</td>
              <td style="text-align:right"><button class="btn btn-outline btn-sm" data-prev="${esc(it.id)}"><span class="ms">visibility</span> ${esc(t('zim.preview'))}</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="card-pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="zim-commit"><span class="ms">done_all</span> ${esc(t('zim.commit'))}</button>
          <button class="btn btn-outline" id="zim-discard"><span class="ms">delete</span> ${esc(t('zim.discard'))}</button>
          <span id="zim-warn" class="cell-sub" style="color:var(--amber-600,#d97706)"></span>
        </div>
      </div>`;

    const updateWarn = () => {
      const n = Array.from(el.querySelectorAll('select[data-emp]')).filter((s) => !s.value).length;
      $('#zim-warn', el).textContent = n ? t('zim.unassignedWarn').replace('{n}', n) : '';
    };
    updateWarn();
    el.querySelectorAll('select[data-emp]').forEach((s) => s.addEventListener('change', updateWarn));

    $('#zim-back', el).addEventListener('click', () => { discardBatch(); files = []; batch = null; renderUpload(); });
    $('#zim-discard', el).addEventListener('click', () => { discardBatch(); files = []; batch = null; renderUpload(); });

    el.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/import/zimmet/items/${b.dataset.prev}/preview`, { headers: { Authorization: 'Bearer ' + Auth.token } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const url = URL.createObjectURL(await res.blob());
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (err) { toast(err.message, 'error'); }
    }));

    const commit = $('#zim-commit', el);
    commit.addEventListener('click', async () => {
      commit.disabled = true; commit.innerHTML = `<span class="ms">hourglass_empty</span> ${esc(t('zim.committing'))}`;
      const assignments = Array.from(el.querySelectorAll('select[data-emp]'))
        .map((s) => ({ itemId: s.dataset.emp, employeeId: s.value || null }));
      try {
        const r = await api('/import/zimmet/commit', { method: 'POST', body: { batchId: batch.id, assignments } });
        toast(t('zim.result').replace('{a}', r.attached).replace('{s}', r.skipped), 'success');
        files = []; batch = null; renderUpload();
      } catch (err) { toast(err.message, 'error'); commit.disabled = false; commit.innerHTML = `<span class="ms">done_all</span> ${esc(t('zim.commit'))}`; }
    });
  }

  function discardBatch() {
    if (batch && batch.id) api(`/import/zimmet/batches/${batch.id}`, { method: 'DELETE' }).catch(() => {});
  }

  renderUpload();
};
