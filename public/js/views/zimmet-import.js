/* Bulk historical zimmet PDF import — 3-step wizard:
   upload PDFs → review split forms & name matches → attach to profiles. */
Views.zimmetImport = async function (el) {
  let files = [];        // [{ name, size, base64 }]
  let batch = null;      // analyze result
  let employees = [];    // [{ id, fullName, department }] — the caller's scoped roster
  let empById = new Map();
  let assign = new Map(); // itemId → employeeId | null (null = skip)
  let openPicker = null;  // itemId whose picker is expanded, if any

  const MAX_FILES = 20;
  const MAX_FILE_BYTES = 8 * 1024 * 1024;   // uploadGuard's per-file cap
  const MAX_TOTAL_BYTES = 55 * 1024 * 1024; // the batch cap the service enforces

  const readAsDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const totalBytes = () => files.reduce((sum, f) => sum + f.size, 0);
  const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

  async function addFiles(list) {
    for (const f of Array.from(list || [])) {
      if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) continue;
      if (f.size > MAX_FILE_BYTES) { toast(t('zim.tooLarge'), 'error'); continue; }
      if (files.length >= MAX_FILES) { toast(t('zim.tooManyFiles').replace('{n}', MAX_FILES), 'error'); break; }
      // Catch an oversized batch here: past the cap the request cannot survive
      // the body parser, and a bare 413 tells the user nothing.
      if (totalBytes() + f.size > MAX_TOTAL_BYTES) {
        toast(t('zim.totalTooLarge').replace('{n}', Math.round(MAX_TOTAL_BYTES / 1024 / 1024)), 'error');
        break;
      }
      files.push({ name: f.name, size: f.size, base64: await readAsDataURL(f) });
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
              <span class="cell-sub">${esc(mb(f.size))}</span>
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
    const resetAnalyze = () => {
      analyze.disabled = false;
      analyze.innerHTML = `<span class="ms">search</span> ${esc(t('zim.analyze'))}`;
    };
    if (analyze) analyze.addEventListener('click', async () => {
      analyze.disabled = true; analyze.innerHTML = `<span class="ms">hourglass_empty</span> ${esc(t('zim.analyzing'))}`;
      try {
        batch = await api('/import/zimmet/analyze', { method: 'POST', body: { files: files.map((f) => ({ filename: f.name, base64: f.base64 })) } });
        if (batch.failures && batch.failures.length) toast(t('zim.readFail').replace('{n}', batch.failures.length), 'error');
        if (!batch.items.length) { toast(t('zim.noForms'), 'error'); resetAnalyze(); return; }
        // analyze() returns the roster it actually matched against — already
        // narrowed to this user's department scope, so the dropdown can never
        // offer an employee the commit would then reject.
        employees = batch.scopedEmployees || [];
        empById = new Map(employees.map((e) => [e.id, e]));
        // Keep only auto-matches the picker can actually display — an id the
        // roster does not contain would show as "skip" while still committing.
        assign = new Map(batch.items.map((it) => [it.id, empById.has(it.matchedEmployeeId) ? it.matchedEmployeeId : null]));
        openPicker = null;
        renderReview();
      } catch (err) { toast(err.message, 'error'); resetAnalyze(); }
    });
  }

  /* ---------- Step 2: review & attach ---------- */
  function confBadge(c) {
    if (c === 'high') return `<span class="pill pill-emerald">${esc(t('zim.confHigh'))}</span>`;
    if (c === 'medium') return `<span class="pill pill-amber">${esc(t('zim.confMedium'))}</span>`;
    return `<span class="pill pill-rose">${esc(t('zim.confNone'))}</span>`;
  }
  /**
   * One line explaining what OCR did — or why a scan came back blank. Without
   * it an unreadable scan just shows an empty name column with no reason.
   */
  function ocrNote() {
    const o = batch.ocr || {};
    const scans = batch.items.filter((it) => it.viaOcr).length;
    if (o.available && o.pages) {
      const msg = t('zim.ocrUsed').replace('{p}', o.pages).replace('{n}', scans)
        + (o.langs ? ` (${o.langs})` : '')
        + (o.truncated ? ` ${t('zim.ocrTruncated')}` : '');
      return `<div class="cell-sub" style="margin-top:6px"><span class="ms ms-sm">document_scanner</span> ${esc(msg)}</div>`;
    }
    // OCR ran but read nothing: nearly always the wrong language model, so name
    // the ones that were loaded rather than leaving the user guessing.
    if (o.available && o.enabled && !o.pages && batch.items.some((it) => !it.extractedName)) {
      return `<div class="cell-sub" style="margin-top:6px;color:var(--amber-600,#d97706)">
        <span class="ms ms-sm">document_scanner</span> ${esc(t('zim.ocrNoText').replace('{l}', o.langs || '—'))}</div>`;
    }
    // Only worth mentioning OCR is off when something actually needed it.
    const unread = batch.items.filter((it) => it.confidence === 'none' && !it.extractedName).length;
    if (!unread) return '';
    const why = o.reason === 'tesseract-missing' ? t('zim.ocrNotInstalled') : t('zim.ocrOff');
    return `<div class="cell-sub" style="margin-top:6px;color:var(--amber-600,#d97706)">
      <span class="ms ms-sm">document_scanner</span> ${esc(why)}</div>`;
  }

  /**
   * Turkish-aware client-side filter, mirroring the server's folding so that
   * typing "ayse" finds "Ayşe" and "gunes" finds "Güneş".
   */
  const TR_FOLD = { İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c' };
  const fold = (s) => String(s == null ? '' : s).replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR_FOLD[c]).toLowerCase();

  const MAX_RESULTS = 30;
  function searchEmployees(term) {
    const q = fold(term).trim();
    if (!q) return employees.slice(0, MAX_RESULTS);
    const out = [];
    for (const e of employees) {
      if (fold(e.fullName).includes(q) || fold(e.department).includes(q)) out.push(e);
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  /**
   * Assignment cell. A plain <select> is unusable at roster scale — hundreds of
   * options, no search, and one option list per row. This is a collapsed
   * summary that expands into a search box in place; expanding in the cell (not
   * as a popover) keeps it from being clipped by the table's horizontal scroll.
   */
  function empCell(it) {
    const id = assign.get(it.id) || null;
    const emp = id ? empById.get(id) : null;
    if (openPicker !== it.id) {
      const label = emp ? emp.fullName : t('zim.skip');
      return `<button type="button" class="zim-pick ${emp ? '' : 'is-empty'}" data-pick="${esc(it.id)}">
        <span class="grow">${esc(label)}</span><span class="ms ms-sm">expand_more</span></button>
        ${emp && emp.department ? `<div class="cell-sub">${esc(emp.department)}</div>` : ''}`;
    }
    return `<div class="zim-picker" data-picker="${esc(it.id)}">
      <div class="search-box"><span class="ms">search</span>
        <input type="text" data-q placeholder="${esc(t('zim.searchEmployee'))}" autocomplete="off" spellcheck="false"></div>
      <div class="emp-search-results" data-results></div>
    </div>`;
  }

  /** Rows of the open picker's result list (also the "skip" choice). */
  function pickerResults(itemId, term) {
    const rows = searchEmployees(term).map((e) => `
      <button type="button" class="emp-search-item" data-choose="${esc(e.id)}">
        <span class="avatar">${esc(initials(e.fullName))}</span>
        <span class="grow"><strong>${esc(e.fullName)}</strong>
          ${e.department ? `<span class="cell-sub">${esc(e.department)}</span>` : ''}</span>
      </button>`).join('');
    const skip = `<button type="button" class="emp-search-item" data-choose="">
      <span class="grow"><strong>${esc(t('zim.skip'))}</strong></span></button>`;
    return skip + (rows || `<div class="cell-sub" style="padding:8px 10px">${esc(t('zim.noEmployeeMatch'))}</div>`);
  }

  function renderReview() {
    el.innerHTML = `
      ${pageHead(t('zim.title'), t('zim.sub'), `<button class="btn btn-outline" id="zim-back"><span class="ms">arrow_back</span> ${esc(t('zim.back'))}</button>`)}
      <div class="card">
        <div class="card-pad" style="padding-bottom:8px">
          <span class="cell-sub">${esc(t('zim.summary').replace('{n}', batch.items.length).replace('{f}', (batch.sourceFiles || []).length))}</span>
          ${ocrNote()}
        </div>
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
              <td>${confBadge(it.confidence)}${it.viaOcr ? ` <span class="pill pill-slate" title="${esc(t('zim.ocrBadgeHint'))}">${esc(t('zim.ocrBadge'))}</span>` : ''}</td>
              <td class="zim-assign" data-cell="${esc(it.id)}">${empCell(it)}</td>
              <td style="text-align:right"><button class="btn btn-outline btn-sm" data-prev="${esc(it.id)}" data-name="${esc(it.filename)}"><span class="ms">visibility</span> ${esc(t('zim.preview'))}</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="card-pad" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-primary" id="zim-commit"><span class="ms">done_all</span> ${esc(t('zim.commit'))}</button>
          <button class="btn btn-outline" id="zim-discard"><span class="ms">delete</span> ${esc(t('zim.discard'))}</button>
          <span id="zim-warn" class="cell-sub" style="color:var(--amber-600,#d97706)"></span>
        </div>
      </div>`;

    const unassignedCount = () => batch.items.filter((it) => !assign.get(it.id)).length;
    const updateWarn = () => {
      const n = unassignedCount();
      $('#zim-warn', el).textContent = n ? t('zim.unassignedWarn').replace('{n}', n) : '';
    };
    updateWarn();
    bindAssignCells(updateWarn);

    const startOver = () => { discardBatch(); files = []; batch = null; renderUpload(); };
    $('#zim-back', el).addEventListener('click', () => confirmModal(t('zim.discardConfirm'), startOver));
    $('#zim-discard', el).addEventListener('click', () => confirmModal(t('zim.discardConfirm'), startOver));

    el.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => {
      // viewAuthed renders the PDF in a stacked lightbox — window.open() after
      // an await is swallowed by popup blockers and has no mobile story.
      viewAuthed(`/api/import/zimmet/items/${b.dataset.prev}/preview`, b.dataset.name);
    }));

    const commit = $('#zim-commit', el);
    const runCommit = async () => {
      commit.disabled = true; commit.innerHTML = `<span class="ms">hourglass_empty</span> ${esc(t('zim.committing'))}`;
      const assignments = batch.items.map((it) => ({ itemId: it.id, employeeId: assign.get(it.id) || null }));
      try {
        const r = await api('/import/zimmet/commit', { method: 'POST', body: { batchId: batch.id, assignments } });
        toast(t('zim.result').replace('{a}', r.attached).replace('{s}', r.skipped), r.failed ? 'error' : 'success');
        if (r.failed) toast(t('zim.commitFailed').replace('{n}', r.failed), 'error');
        files = []; batch = null; renderUpload();
      } catch (err) {
        toast(err.message, 'error');
        commit.disabled = false; commit.innerHTML = `<span class="ms">done_all</span> ${esc(t('zim.commit'))}`;
      }
    };
    commit.addEventListener('click', () => {
      const n = unassignedCount();
      // Committing closes the batch for good, so an accidental click must not
      // silently throw away the forms still waiting for a name.
      if (n) confirmModal(t('zim.unassignedConfirm').replace('{n}', n), runCommit);
      else runCommit();
    });
  }

  /**
   * (Re)wire the assignment cells. Only the cells that actually change are
   * re-rendered — redrawing the whole table on every keystroke would throw away
   * the focused search input.
   */
  function bindAssignCells(onChange) {
    const cell = (itemId) => $(`[data-cell="${itemId}"]`, el);
    const paint = (itemId) => {
      const td = cell(itemId);
      const item = batch.items.find((i) => i.id === itemId);
      if (td && item) { td.innerHTML = empCell(item); wire(td, itemId); }
    };

    function choose(itemId, employeeId) {
      assign.set(itemId, employeeId || null);
      openPicker = null;
      paint(itemId);
      onChange();
    }

    function wire(td, itemId) {
      const btn = $('[data-pick]', td);
      if (btn) {
        btn.addEventListener('click', () => {
          const previous = openPicker;
          openPicker = itemId;
          if (previous && previous !== itemId) paint(previous);
          paint(itemId);
          const q = $('[data-q]', cell(itemId));
          if (q) q.focus();
        });
        return;
      }
      const q = $('[data-q]', td);
      const results = $('[data-results]', td);
      if (!q || !results) return;

      const refresh = () => {
        results.innerHTML = pickerResults(itemId, q.value);
        results.querySelectorAll('[data-choose]').forEach((b) => {
          b.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus until click lands
          b.addEventListener('click', () => choose(itemId, b.dataset.choose));
        });
      };
      refresh();
      q.addEventListener('input', refresh);
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { openPicker = null; paint(itemId); }
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = results.querySelector('[data-choose]:not([data-choose=""])');
          if (first) choose(itemId, first.dataset.choose);
        }
      });
      // Leaving the field without choosing just collapses it — the current
      // assignment is untouched.
      q.addEventListener('blur', () => setTimeout(() => {
        if (openPicker === itemId && !td.contains(document.activeElement)) { openPicker = null; paint(itemId); }
      }, 120));
    }

    el.querySelectorAll('[data-cell]').forEach((td) => wire(td, td.dataset.cell));
  }

  function discardBatch() {
    if (batch && batch.id) api(`/import/zimmet/batches/${batch.id}`, { method: 'DELETE' }).catch(() => {});
  }

  renderUpload();
};
