Views.catalog = async function (el) {
  const canEdit = Auth.can('canManageAssets');
  const items = await api('/catalog');
  const cats = [...new Set(items.map((c) => c.category))];

  el.innerHTML = `
    ${pageHead('Product Catalog', 'Brand & model lists that power the asset form dropdowns.', canEdit ? `
      <button class="btn btn-outline" id="cat-import"><span class="ms">sync</span> Import from existing assets</button>
      <button class="btn btn-primary" id="cat-new"><span class="ms">add</span> Add Model</button>` : '')}
    ${items.length === 0 ? `
      <div class="card card-pad" style="text-align:center;padding:48px">
        <div class="cell-sub" style="margin-bottom:14px">The catalog is empty. Import every brand/model already in your
        inventory with one click, or add models manually.</div>
      </div>` :
      cats.map((cat) => `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>${esc(cat)} (${items.filter((c) => c.category === cat).length})</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Brand</th><th>Model</th><th style="text-align:right"></th></tr></thead>
          <tbody>
            ${items.filter((c) => c.category === cat).map((c) => `
            <tr>
              <td class="cell-title">${esc(c.brand)}</td>
              <td>${esc(c.model)}</td>
              <td class="actions">${canEdit ? `<button class="btn btn-outline btn-sm" data-del="${esc(c.id)}">Delete</button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`).join('')}`;

  if (canEdit) {
    $('#cat-new', el).addEventListener('click', () => formModal({
      title: 'Add catalog model',
      fields: [
        { name: 'category', label: 'Category *', type: 'select', required: true, value: 'Laptop',
          options: ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Network', 'Server', 'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'] },
        { name: 'brand', label: 'Brand *', required: true },
        { name: 'model', label: 'Model *', required: true, full: true },
      ],
      submitLabel: 'Add to catalog',
      async onSubmit(d) {
        await api('/catalog', { method: 'POST', body: d });
        toast(`${d.brand} ${d.model} added to catalog`, 'success');
        Views.catalog(el);
      },
    }));
    $('#cat-import', el).addEventListener('click', async () => {
      try {
        const r = await api('/catalog/import', { method: 'POST' });
        toast(`${r.imported} brand/model entries imported from inventory`, 'success');
        Views.catalog(el);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---- Office Locations (stored in settings, drives asset form dropdown) ---- */
  const locData = await api('/catalog/locations').catch(() => ({ locations: [], defaultLocation: null }));
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:4px">
      <div class="card-head">
        <h3>Office Locations (${locData.locations.length})</h3>
        ${canEdit ? '<button class="btn btn-primary btn-sm" id="loc-add"><span class="ms">add_location_alt</span> Add Location</button>' : ''}
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Location</th><th>Default</th><th style="text-align:right"></th></tr></thead>
        <tbody>
          ${locData.locations.map((l) => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:10px"><span class="ms" style="color:var(--on-surface-variant)">location_on</span>
              <span class="cell-title">${esc(l)}</span></div></td>
            <td>${locData.defaultLocation === l
              ? '<span class="pill pill-indigo">Default</span>'
              : (canEdit ? `<button class="btn btn-outline btn-sm" data-setdef="${esc(l)}">Set default</button>` : '—')}</td>
            <td class="actions">${canEdit ? `<button class="btn btn-outline btn-sm" data-delloc="${esc(l)}">Delete</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="table-foot">New assets default to the location marked as Default; each asset's location can be changed on its form.</div>
    </div>`);

  /* ---- Hardware spec lists (cpu / ram / storage) ---- */
  const specs = await api('/catalog/specs').catch(() => ({ cpu: [], ram: [], storage: [] }));
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Hardware Spec Lists</h3>
        <span class="cell-sub">These lists feed the CPU / RAM / Storage dropdowns on the asset form and the report filters.</span></div>
      <div class="card-pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
        ${['cpu', 'ram', 'storage'].map((type) => `
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span class="gs-section" style="margin:0">${type.toUpperCase()} (${specs[type].length})</span>
            ${canEdit ? `<button class="btn btn-outline btn-sm" data-addspec="${type}"><span class="ms">add</span></button>` : ''}
          </div>
          ${specs[type].map((v) => `
          <div class="history-item" style="justify-content:space-between">
            <span>${esc(v)}</span>
            ${canEdit ? `<button class="icon-btn" style="width:26px;height:26px" data-delspec="${type}" data-val="${esc(v)}" title="Delete"><span class="ms ms-sm">close</span></button>` : ''}
          </div>`).join('')}
        </div>`).join('')}
      </div>
    </div>`);

  /* ---- Product lifecycle durations + per-category EOL on/off ---- */
  const lifecycles = await api('/catalog/lifecycles').catch(() => ({}));
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Product Lifecycle Durations</h3>
        <span class="cell-sub">Months per category. Untick "EOL" to exclude a category from end-of-life tracking (e.g. accessories).</span></div>
      <div class="card-pad">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px">
          ${Object.entries(lifecycles).map(([cat, m]) => `
          <label style="font-size:12px;font-weight:600;color:var(--on-surface-variant)">
            <span style="display:flex;align-items:center;justify-content:space-between">${esc(cat)}
              <span class="tc-opt" style="padding:0;font-weight:500"><input type="checkbox" data-lc-on="${esc(cat)}"
                ${Number(m) > 0 ? 'checked' : ''} ${canEdit ? '' : 'disabled'}> EOL</span></span>
            <input type="number" min="1" max="240" data-lc="${esc(cat)}" value="${Number(m) > 0 ? Number(m) : 48}"
              style="margin-top:4px" ${(canEdit && Number(m) > 0) ? '' : 'disabled'}></label>`).join('')}
        </div>
        ${canEdit ? '<button class="btn btn-primary btn-sm" id="lc-save" style="margin-top:14px"><span class="ms">save</span> Save lifecycles</button>' : ''}
      </div>
    </div>`);

  if (canEdit) {
    // EOL checkbox toggles the months input; unticked saves as 0 (= excluded).
    el.querySelectorAll('[data-lc-on]').forEach((c) => c.addEventListener('change', () => {
      const inp = el.querySelector(`[data-lc="${c.dataset.lcOn}"]`);
      if (inp) inp.disabled = !c.checked;
    }));
    const lcSave = $('#lc-save', el);
    if (lcSave) lcSave.addEventListener('click', async () => {
      try {
        const body = Object.fromEntries([...el.querySelectorAll('[data-lc]')].map((i) => {
          const on = el.querySelector(`[data-lc-on="${i.dataset.lc}"]`);
          return [i.dataset.lc, on && !on.checked ? 0 : (Number(i.value) || 48)];
        }));
        const saved = await api('/catalog/lifecycles', { method: 'PUT', body });
        AppConfig.lifecycles = saved;
        toast('Lifecycle settings saved', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---- Company departments (feed the employee form) ---- */
  const departments = await api('/catalog/departments').catch(() => []);
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h3>Departments (${departments.length})</h3>
        ${canEdit ? '<button class="btn btn-primary btn-sm" id="dept-add"><span class="ms">add</span> Add Department</button>' : ''}
      </div>
      <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
        ${departments.length === 0 ? '<span class="cell-sub">No departments yet.</span>' :
          departments.map((d) => `
          <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
            ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-deldept="${esc(d)}" title="Delete"><span class="ms ms-sm">close</span></button>` : ''}
          </span>`).join('')}
      </div>
      <div class="table-foot">This list feeds the Department dropdown on the employee form.</div>
    </div>`);

  /* ---- Provider & contract categories ---- */
  const providerCategories = await api('/catalog/provider-categories').catch(() => AppConfig.providerCategories || []);
  const contractCategories = await api('/catalog/contract-categories').catch(() => AppConfig.contractCategories || []);
  el.insertAdjacentHTML('beforeend', `
    <div class="grid grid-2" style="margin-top:16px;gap:16px">
      <div class="card">
        <div class="card-head">
          <h3>Provider categories (${providerCategories.length})</h3>
          ${canEdit ? '<button class="btn btn-primary btn-sm" id="pcat-add"><span class="ms">add</span> Add</button>' : ''}
        </div>
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
          ${providerCategories.length === 0 ? '<span class="cell-sub">No categories yet.</span>' :
            providerCategories.map((d) => `
            <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
              ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-delpcat="${esc(d)}" title="Delete"><span class="ms ms-sm">close</span></button>` : ''}
            </span>`).join('')}
        </div>
        <div class="table-foot">Feeds the Category dropdown on Providers &amp; Contracts. Forms also allow “Other (type manually)”.</div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>Contract categories (${contractCategories.length})</h3>
          ${canEdit ? '<button class="btn btn-primary btn-sm" id="ccat-add"><span class="ms">add</span> Add</button>' : ''}
        </div>
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
          ${contractCategories.length === 0 ? '<span class="cell-sub">No categories yet.</span>' :
            contractCategories.map((d) => `
            <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
              ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-delccat="${esc(d)}" title="Delete"><span class="ms ms-sm">close</span></button>` : ''}
            </span>`).join('')}
        </div>
        <div class="table-foot">Feeds the Category dropdown when adding a contract.</div>
      </div>
    </div>`);

  if (canEdit) {
    $('#dept-add', el).addEventListener('click', () => formModal({
      title: 'Add department',
      fields: [{ name: 'name', label: 'Department name *', required: true, full: true, placeholder: 'e.g. Muhasebe' }],
      submitLabel: 'Add department',
      async onSubmit(d2) {
        const r = await api('/catalog/departments', { method: 'POST', body: { name: d2.name } });
        AppConfig.departments = r;
        toast(`Department "${d2.name}" added`, 'success');
        Views.catalog(el);
      },
    }));
    $('#pcat-add', el)?.addEventListener('click', () => formModal({
      title: 'Add provider category',
      fields: [{ name: 'name', label: 'Category *', required: true, full: true, placeholder: 'e.g. Colocation' }],
      submitLabel: 'Add category',
      async onSubmit(d2) {
        const r = await api('/catalog/provider-categories', { method: 'POST', body: { name: d2.name } });
        AppConfig.providerCategories = r;
        toast(`Provider category "${d2.name}" added`, 'success');
        Views.catalog(el);
      },
    }));
    $('#ccat-add', el)?.addEventListener('click', () => formModal({
      title: 'Add contract category',
      fields: [{ name: 'name', label: 'Category *', required: true, full: true, placeholder: 'e.g. Training' }],
      submitLabel: 'Add category',
      async onSubmit(d2) {
        const r = await api('/catalog/contract-categories', { method: 'POST', body: { name: d2.name } });
        AppConfig.contractCategories = r;
        toast(`Contract category "${d2.name}" added`, 'success');
        Views.catalog(el);
      },
    }));
  }

  if (canEdit) {
    $('#loc-add', el).addEventListener('click', () => formModal({
      title: 'Add office location',
      fields: [{ name: 'name', label: 'Location name *', required: true, full: true, placeholder: 'e.g. Ankara Branch' }],
      submitLabel: 'Add location',
      async onSubmit(d2) {
        const r = await api('/catalog/locations', { method: 'POST', body: { name: d2.name } });
        AppConfig.locations = r.locations;
        toast(`Location "${d2.name}" added`, 'success');
        Views.catalog(el);
      },
    }));
  }

  bindView(el, async (e) => {
    const b = e.target.closest('button'); if (!b || !canEdit) return;
    try {
      if (b.dataset.del) {
        await api('/catalog/' + b.dataset.del, { method: 'DELETE' });
        toast('Catalog entry removed', 'success');
        Views.catalog(el);
      } else if (b.dataset.setdef) {
        const r = await api('/catalog/locations/default', { method: 'PUT', body: { name: b.dataset.setdef } });
        AppConfig.defaultLocation = r.defaultLocation;
        toast(`Default location set to ${b.dataset.setdef}`, 'success');
        Views.catalog(el);
      } else if (b.dataset.deldept) {
        const r = await api('/catalog/departments/' + encodeURIComponent(b.dataset.deldept), { method: 'DELETE' });
        AppConfig.departments = r;
        toast(`Department "${b.dataset.deldept}" removed`, 'success');
        Views.catalog(el);
      } else if (b.dataset.delpcat) {
        const r = await api('/catalog/provider-categories/' + encodeURIComponent(b.dataset.delpcat), { method: 'DELETE' });
        AppConfig.providerCategories = r;
        toast(`Provider category "${b.dataset.delpcat}" removed`, 'success');
        Views.catalog(el);
      } else if (b.dataset.delccat) {
        const r = await api('/catalog/contract-categories/' + encodeURIComponent(b.dataset.delccat), { method: 'DELETE' });
        AppConfig.contractCategories = r;
        toast(`Contract category "${b.dataset.delccat}" removed`, 'success');
        Views.catalog(el);
      } else if (b.dataset.addspec) {
        const type = b.dataset.addspec;
        formModal({
          title: `Add ${type.toUpperCase()} option`,
          fields: [{ name: 'value', label: `${type.toUpperCase()} value *`, required: true, full: true,
            placeholder: type === 'cpu' ? 'e.g. Intel i7-1455U' : type === 'ram' ? 'e.g. 48GB' : 'e.g. 4TB SSD' }],
          submitLabel: 'Add to list',
          async onSubmit(d2) {
            const r = await api('/catalog/specs', { method: 'POST', body: { type, value: d2.value } });
            AppConfig.specOptions = r;
            toast(`"${d2.value}" added to ${type.toUpperCase()} list`, 'success');
            Views.catalog(el);
          },
        });
      } else if (b.dataset.delspec) {
        const r = await api(`/catalog/specs/${b.dataset.delspec}/${encodeURIComponent(b.dataset.val)}`, { method: 'DELETE' });
        AppConfig.specOptions = r;
        toast('Spec option removed', 'success');
        Views.catalog(el);
      } else if (b.dataset.delloc) {
        confirmModal(`Delete location "${b.dataset.delloc}"? Assets keep their stored location text.`, async () => {
          const r = await api('/catalog/locations/' + encodeURIComponent(b.dataset.delloc), { method: 'DELETE' });
          AppConfig.locations = r.locations;
          AppConfig.defaultLocation = r.defaultLocation;
          toast('Location deleted', 'success');
          Views.catalog(el);
        });
      }
    } catch (err) { toast(err.message, 'error'); }
  });
};

/* Repair progress notes: view + append; every note also lands in device history. */
/* downloadAuthed / viewAuthed live in ui.js (stacked lightbox, Bearer fetch). */

const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

async function showMaintNotes(log, onDone) {
  if (!log) return;
  const notes = log.progressNotes || [];
  const canDelDoc = Auth.can('canManageUsers');
  const docs = await api(`/maintenance/${log.id}/documents`).catch(() => []);
  openModal({
    title: `Repair notes & documents — ${log.assetTag}`,
    wide: true,
    body: `
      <div class="cell-sub" style="margin-bottom:12px">${esc(log.serviceCompany)} • ${esc(log.issueDescription)}
        • sent ${fmtDate(log.sentDate)}${log.returnDate ? ' • closed ' + fmtDate(log.returnDate) : ''}</div>

      <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">Progress Notes (${notes.length})</h3>
      ${notes.length === 0 ? '<div class="cell-sub" style="margin-bottom:8px">No progress notes yet.</div>' :
        notes.map((n) => `
        <div class="history-item" style="flex-wrap:wrap">
          <span class="when">${fmtDateTime(n.at)}</span>
          <span class="cell-sub">by ${esc(n.by || '—')}</span>
          <span style="flex-basis:100%;padding-left:2px">${esc(n.note)}</span>
        </div>`).join('')}
      <div class="form-field" style="margin-top:14px">
        <label>Add progress note <span class="ob-hint">(also recorded in the device history)</span></label>
        <textarea id="mn-new-note" placeholder="e.g. Parça bekleniyor — ekran paneli siparişi verildi"></textarea>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px">
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0">Documents (${docs.length})</h3>
        <button class="btn btn-outline btn-sm" id="mn-upload-btn"><span class="ms">upload_file</span> Upload document</button>
      </div>
      <div class="cell-sub" style="margin-bottom:8px">Service invoice, repair report or photos — kept with the device (PDF / PNG / JPEG / WebP, max 8MB).</div>
      <input type="file" id="mn-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
      ${docs.length === 0 ? '<div class="table-empty">No documents yet.</div>' : `
      <div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
        <thead><tr><th>Document</th><th>Size</th><th>Added</th><th style="text-align:right"></th></tr></thead>
        <tbody>
          ${docs.map((d) => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <span class="ms" style="color:var(--on-surface-variant)">${d.mime && d.mime.includes('pdf') ? 'picture_as_pdf' : 'image'}</span>
              <a href="#" class="cell-title doc-link" data-mdoc-view="${esc(d.id)}" title="Click to view">${esc(d.filename)}</a></div></td>
            <td class="cell-sub">${fmtBytes(d.byteSize || 0)}</td>
            <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' • ' + esc(d.uploadedByName) : ''}</td>
            <td class="actions">
              <button type="button" class="btn btn-outline btn-sm" data-mdoc-view="${esc(d.id)}" title="View"><span class="ms">visibility</span></button>
              <button type="button" class="btn btn-outline btn-sm" data-mdoc-dl="${esc(d.id)}" title="Download"><span class="ms">download</span></button>
              ${canDelDoc ? `<button type="button" class="btn btn-outline btn-sm" data-mdoc-del="${esc(d.id)}"><span class="ms">delete</span></button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}`,
    foot: `<button class="btn btn-outline" data-close>Close</button>
           <button class="btn btn-primary" id="mn-add-note"><span class="ms">add_comment</span> Add Note</button>`,
    onMount(overlay) {
      $('#mn-add-note', overlay).addEventListener('click', async () => {
        const note = $('#mn-new-note', overlay).value.trim();
        if (!note) return toast('Write a note first', 'error');
        try {
          const r = await api(`/maintenance/${log.id}/note`, { method: 'POST', body: { note } });
          toast(`Note added to ${log.assetTag} — recorded in device history`, 'success');
          log.progressNotes = [...notes, r.entry];
          showMaintNotes(log, onDone); // reopen with the new note visible
          if (onDone) onDone();
        } catch (err) { toast(err.message, 'error'); }
      });

      const upBtn = $('#mn-upload-btn', overlay);
      const upFile = $('#mn-doc-file', overlay);
      upBtn.addEventListener('click', () => upFile.click());
      upFile.addEventListener('change', async () => {
        const file = upFile.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) { toast('File too large — max 8MB (PDF, PNG, JPEG, WebP)', 'error'); return; }
        upBtn.disabled = true;
        try {
          const base64 = await new Promise((res, rej) => {
            const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
          });
          await api(`/maintenance/${log.id}/documents`, {
            method: 'POST', body: { filename: file.name, mime: file.type || 'application/pdf', base64 },
          });
          toast(`"${file.name}" uploaded to ${log.assetTag}`, 'success');
          showMaintNotes(log, onDone); // reopen with the document listed
          if (onDone) onDone();
        } catch (err) { toast(err.message, 'error'); upBtn.disabled = false; }
      });

      overlay.querySelectorAll('[data-mdoc-view]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        viewAuthed(`/api/maintenance/documents/${a.dataset.mdocView}/download`);
      }));
      overlay.querySelectorAll('[data-mdoc-dl]').forEach((b) =>
        b.addEventListener('click', () => downloadAuthed(`/api/maintenance/documents/${b.dataset.mdocDl}/download`)));
      overlay.querySelectorAll('[data-mdoc-del]').forEach((b) => b.addEventListener('click', () => {
        confirmModal('Delete this repair document permanently?', async () => {
          await api('/maintenance/documents/' + b.dataset.mdocDel, { method: 'DELETE' });
          toast('Document deleted', 'success');
          showMaintNotes(log, onDone);
          if (onDone) onDone();
        });
      }));
    },
  });
}

/* ================================ REPORTS ================================ */
function csvDownload(filename, cols, rows) {
  const csvEsc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  // \uFEFF BOM so Excel opens Turkish characters correctly.
  const csv = '\uFEFF' + [cols, ...rows].map((r) => r.map(csvEsc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
}

const REPORT_DEFS = [
  // ---- Hardware ----
  { id: 'inventory', group: 'Hardware', icon: 'devices', tone: 'indigo', title: 'Full Inventory Report',
    desc: 'Every asset with status, holder, location, purchase date and identifiers.' },
  { id: 'by-category', group: 'Hardware', icon: 'category', tone: 'blue', title: 'Assets by Category',
    desc: 'Count of assets per category, split across each status.' },
  { id: 'by-location', group: 'Hardware', icon: 'location_on', tone: 'emerald', title: 'Assets by Location',
    desc: 'How many assets sit at each office / location.' },
  { id: 'by-status', group: 'Hardware', icon: 'donut_small', tone: 'amber', title: 'Assets by Status',
    desc: 'Fleet breakdown across In Stock / Assigned / In Repair / Scrap.' },
  { id: 'in-stock', group: 'Hardware', icon: 'inventory', tone: 'emerald', title: 'Available (In Stock) Assets',
    desc: 'Devices currently free and ready to assign.' },
  { id: 'eol', group: 'Hardware', icon: 'update', tone: 'rose', title: 'End-of-Life / Replacement',
    desc: 'Assets past or nearing their lifecycle end — plan replacements.' },
  { id: 'aging', group: 'Hardware', icon: 'schedule', tone: 'blue', title: 'Asset Aging Report',
    desc: 'Every asset ranked by age in months (oldest first).' },
  { id: 'scrap', group: 'Hardware', icon: 'delete', tone: 'rose', title: 'Scrapped / Retired Assets',
    desc: 'Devices marked as scrap / retired.' },
  // ---- Assignments & People ----
  { id: 'assignments', group: 'Assignments & People', icon: 'handshake', tone: 'blue', title: 'Assigned Assets by Employee',
    desc: 'Zimmet listesi — who currently holds which device, by department.' },
  { id: 'employees', group: 'Assignments & People', icon: 'badge', tone: 'indigo', title: 'Employee Directory',
    desc: 'All employees with department, title, status and assets held.' },
  { id: 'no-assets', group: 'Assignments & People', icon: 'person_off', tone: 'amber', title: 'Employees Without Assets',
    desc: 'Active employees who currently hold no device.' },
  { id: 'handovers', group: 'Assignments & People', icon: 'assignment_turned_in', tone: 'emerald', title: 'Handover / Zimmet History',
    desc: 'Every handover transaction with date, employee and items.' },
  // ---- Software ----
  { id: 'licenses', group: 'Software', icon: 'vpn_key', tone: 'indigo', title: 'License Utilization',
    desc: 'Seat usage, utilization % and upcoming expirations.' },
  { id: 'expiring-licenses', group: 'Software', icon: 'event_busy', tone: 'rose', title: 'Expiring Licenses (90 days)',
    desc: 'License pools expiring within the next 90 days.' },
  { id: 'software', group: 'Software', icon: 'workspace_premium', tone: 'emerald', title: 'Software Assignments',
    desc: 'Which employee holds which software license, assigned when and by whom.' },
  // ---- Operations ----
  { id: 'maintenance', group: 'Operations', icon: 'build', tone: 'amber', title: 'Maintenance & Cost',
    desc: 'All repair logs with service company, duration and total cost.' },
  { id: 'open-repairs', group: 'Operations', icon: 'pending_actions', tone: 'rose', title: 'Open Repairs',
    desc: 'Devices currently in repair and how long they have been out.' },
  // ---- Consumables ----
  { id: 'consumables', group: 'Consumables', icon: 'inventory_2', tone: 'blue', title: 'Consumables Stock',
    desc: 'Stock levels vs minimum alert levels with low-stock flags.' },
  { id: 'low-stock', group: 'Consumables', icon: 'production_quantity_limits', tone: 'rose', title: 'Low-Stock Consumables',
    desc: 'Only items at or below their minimum level — the reorder list.' },
];

const REPORT_MONTH_MS = 30.44 * 86400000;
const asgName = (x) => (x.currentEmployee ? x.currentEmployee.fullName : '');

/* Each builder returns { cols, rows, summary } — all from existing endpoints. */
const REPORT_BUILDERS = {
  inventory: async () => {
    const { items } = await api('/assets?limit=2000');
    return {
      cols: ['Asset Tag', 'Category', 'Brand', 'Model', 'Serial No', 'MAC', 'Status', 'Assigned To', 'Location', 'Purchase Date'],
      rows: items.map((x) => [x.assetTag, x.category, x.brand, x.model, x.serialNumber,
        x.macEthernet || x.macWifi || '', x.status, asgName(x), x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : '']),
      summary: `${items.length} assets • ${items.filter((x) => x.status === 'Assigned').length} assigned • `
        + `${items.filter((x) => x.status === 'In Stock').length} in stock • `
        + `${items.filter((x) => x.status === 'In Repair').length} in repair • `
        + `${items.filter((x) => x.status === 'Scrap').length} scrapped`,
    };
  },

  'by-category': async () => {
    const { items } = await api('/assets?limit=2000');
    const map = {};
    items.forEach((x) => {
      const c = map[x.category] || (map[x.category] = { total: 0, 'In Stock': 0, Assigned: 0, 'In Repair': 0, Scrap: 0 });
      c.total++; if (c[x.status] != null) c[x.status]++;
    });
    const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total)
      .map(([cat, c]) => [cat, c.total, c['In Stock'], c.Assigned, c['In Repair'], c.Scrap]);
    return { cols: ['Category', 'Total', 'In Stock', 'Assigned', 'In Repair', 'Scrap'], rows,
      summary: `${items.length} assets across ${rows.length} categories` };
  },

  'by-location': async () => {
    const { items } = await api('/assets?limit=2000');
    const map = {};
    items.forEach((x) => {
      const k = x.location || '— Unassigned —';
      const c = map[k] || (map[k] = { total: 0, assigned: 0, stock: 0 });
      c.total++; if (x.status === 'Assigned') c.assigned++; if (x.status === 'In Stock') c.stock++;
    });
    const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total)
      .map(([loc, c]) => [loc, c.total, c.assigned, c.stock]);
    return { cols: ['Location', 'Total Assets', 'Assigned', 'In Stock'], rows,
      summary: `${items.length} assets across ${rows.length} locations` };
  },

  'by-status': async () => {
    const { items } = await api('/assets?limit=2000');
    const total = items.length || 1;
    const rows = ['In Stock', 'Assigned', 'In Repair', 'Scrap'].map((s) => {
      const n = items.filter((x) => x.status === s).length;
      return [s, n, Math.round((n / total) * 100) + '%'];
    });
    return { cols: ['Status', 'Count', '% of Fleet'], rows, summary: `${items.length} assets total` };
  },

  'in-stock': async () => {
    const { items } = await api('/assets?status=In Stock&limit=2000');
    return { cols: ['Asset Tag', 'Category', 'Brand', 'Model', 'Serial No', 'Location', 'Purchase Date'],
      rows: items.map((x) => [x.assetTag, x.category, x.brand, x.model, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : '']),
      summary: `${items.length} assets available to assign` };
  },

  eol: async () => {
    const { items } = await api('/assets?limit=2000');
    const rows = items
      .filter((x) => x.status !== 'Scrap' && x.purchaseDate)
      .map((x) => ({ x, l: lifecycleInfo(x) }))
      .filter((o) => o.l.eol && o.l.pct >= 90)
      .sort((a, b) => b.l.pct - a.l.pct)
      .map(({ x, l }) => [x.assetTag, x.category, `${x.brand} ${x.model}`, asgName(x),
        fmtDate(x.purchaseDate), fmtDate(l.eol), Math.min(l.pct, 100) + '%', l.overdue ? 'REPLACE NOW' : 'Due soon']);
    const overdue = rows.filter((r) => r[7] === 'REPLACE NOW').length;
    return { cols: ['Asset Tag', 'Category', 'Brand / Model', 'Assigned To', 'Purchase Date', 'EOL Date', 'Elapsed', 'State'], rows,
      summary: `${rows.length} assets at/near end-of-life • ${overdue} overdue for replacement` };
  },

  aging: async () => {
    const { items } = await api('/assets?limit=2000');
    const rows = items.filter((x) => x.purchaseDate)
      .map((x) => ({ x, age: Math.floor((Date.now() - new Date(x.purchaseDate).getTime()) / REPORT_MONTH_MS) }))
      .sort((a, b) => b.age - a.age)
      .map(({ x, age }) => [x.assetTag, x.category, `${x.brand} ${x.model}`, fmtDate(x.purchaseDate), age, x.status, asgName(x)]);
    return { cols: ['Asset Tag', 'Category', 'Brand / Model', 'Purchase Date', 'Age (months)', 'Status', 'Assigned To'], rows,
      summary: `${rows.length} assets with a purchase date` };
  },

  scrap: async () => {
    const { items } = await api('/assets?status=Scrap&limit=2000');
    return { cols: ['Asset Tag', 'Category', 'Brand / Model', 'Serial No', 'Location', 'Purchase Date'],
      rows: items.map((x) => [x.assetTag, x.category, `${x.brand} ${x.model}`, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : '']),
      summary: `${items.length} scrapped / retired assets` };
  },

  assignments: async () => {
    const [{ items }, employeesRes] = await Promise.all([
      api('/assets?status=Assigned&limit=2000'),
      api('/employees?limit=10000'),
    ]);
    const employees = employeeList(employeesRes).items;
    const dept = new Map(employees.map((p) => [p.id, p]));
    const rows = items
      .map((x) => {
        const p = x.currentEmployee ? dept.get(x.currentEmployee.id) : null;
        return [asgName(x), p ? p.department || '' : '', x.assetTag, `${x.brand} ${x.model}`, x.category, x.serialNumber];
      })
      .sort((a2, b2) => a2[0].localeCompare(b2[0]));
    return { cols: ['Employee', 'Department', 'Asset Tag', 'Brand / Model', 'Category', 'Serial No'], rows,
      summary: `${items.length} assigned assets across ${new Set(rows.map((r) => r[0])).size} employees` };
  },

  employees: async () => {
    const emps = employeeList(await api('/employees?limit=10000')).items;
    return { cols: ['Employee', 'Email', 'Department', 'Title', 'Status', 'Assets Held'],
      rows: emps.map((p) => [p.fullName, p.email, p.department || '', p.title || '', p.status, p.activeAssetCount]),
      summary: `${emps.length} employees • ${emps.filter((p) => p.status === 'Active').length} active` };
  },

  'no-assets': async () => {
    const emps = employeeList(await api('/employees?limit=10000')).items;
    const none = emps.filter((p) => p.status === 'Active' && !p.activeAssetCount);
    return { cols: ['Employee', 'Email', 'Department', 'Title'],
      rows: none.map((p) => [p.fullName, p.email, p.department || '', p.title || '']),
      summary: `${none.length} active employees hold no assets` };
  },

  handovers: async () => {
    const hs = await api('/handovers?limit=200');
    const rows = hs.slice().sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
      .map((h) => [fmtDateTime(h.transactionDate), h.employeeName, (h.items || []).length,
        (h.items || []).map((i) => i.assetTag).join(', '), h.documentType]);
    return { cols: ['Date', 'Employee', '# Items', 'Asset Tags', 'Type'], rows,
      summary: `${hs.length} handover transactions` };
  },

  licenses: async () => {
    const lics = await api('/licenses');
    return { cols: ['Software', 'Vendor', 'Used Seats', 'Total Seats', 'Utilization %', 'Expires'],
      rows: lics.map((l) => [l.softwareName, l.vendor || '', l.usedSeats, l.totalSeats,
        Math.round((l.usedSeats / l.totalSeats) * 100), fmtDate(l.expirationDate)]),
      summary: `${lics.length} license pools • ${lics.reduce((s2, l) => s2 + l.usedSeats, 0)}/`
        + `${lics.reduce((s2, l) => s2 + l.totalSeats, 0)} seats in use` };
  },

  'expiring-licenses': async () => {
    const lics = await api('/licenses');
    const now = Date.now();
    const rows = lics.map((l) => ({ l, days: Math.ceil((new Date(l.expirationDate).getTime() - now) / 86400000) }))
      .filter((o) => o.days >= 0 && o.days <= 90)
      .sort((a, b) => a.days - b.days)
      .map(({ l, days }) => [l.softwareName, l.vendor || '', fmtDate(l.expirationDate), days, `${l.usedSeats}/${l.totalSeats}`]);
    return { cols: ['Software', 'Vendor', 'Expires', 'Days Left', 'Seats (used/total)'], rows,
      summary: `${rows.length} licenses expiring within 90 days` };
  },

  software: async () => {
    const rows = await api('/licenses/assignments');
    return { cols: ['Employee', 'Software', 'Assigned At', 'Assigned By'],
      rows: rows.map((a2) => [a2.employeeName, a2.softwareName, fmtDate(a2.assignedAt), a2.assignedByName || '']),
      summary: `${rows.length} active software assignments` };
  },

  maintenance: async () => {
    const logs = await api('/maintenance?limit=2000');
    const totalCost = logs.reduce((sum, m) => sum + (Number(m.cost) || 0), 0);
    return { cols: ['Asset Tag', 'Service Company', 'Issue', 'Sent', 'Returned', 'Days', 'Cost', 'Status', 'Notes'],
      rows: logs.map((m) => {
        const sent = new Date(m.sentDate);
        const back = m.returnDate ? new Date(m.returnDate) : new Date();
        return [m.assetTag, m.serviceCompany, m.issueDescription, fmtDate(m.sentDate),
          m.returnDate ? fmtDate(m.returnDate) : '', Math.max(0, Math.round((back - sent) / 86400000)),
          fmtMoney(m.cost || 0), m.returnDate ? 'Closed' : 'Open', (m.progressNotes || []).length];
      }),
      summary: `${logs.length} repair logs • ${logs.filter((m) => !m.returnDate).length} open • `
        + `total cost ${fmtMoney(totalCost)}` };
  },

  'open-repairs': async () => {
    const logs = await api('/maintenance?limit=2000');
    const open = logs.filter((m) => !m.returnDate);
    const rows = open.map((m) => [m.assetTag, m.serviceCompany, m.issueDescription, fmtDate(m.sentDate),
      Math.max(0, Math.round((Date.now() - new Date(m.sentDate).getTime()) / 86400000)), fmtMoney(m.cost || 0)])
      .sort((a, b) => b[4] - a[4]);
    return { cols: ['Asset Tag', 'Service Company', 'Issue', 'Sent', 'Days Open', 'Est. Cost'], rows,
      summary: `${open.length} assets currently in repair` };
  },

  consumables: async () => {
    const cons = await api('/consumables');
    return { cols: ['Item', 'Stock', 'Min. Level', 'Status'],
      rows: cons.map((c) => [c.itemName, c.totalStock, c.minimumStockAlertLevel, c.lowStock ? 'LOW STOCK' : 'OK']),
      summary: `${cons.length} items • ${cons.filter((c) => c.lowStock).length} below minimum` };
  },

  'low-stock': async () => {
    const cons = await api('/consumables');
    const low = cons.filter((c) => c.lowStock);
    return { cols: ['Item', 'Stock', 'Min. Level', 'Shortfall'],
      rows: low.map((c) => [c.itemName, c.totalStock, c.minimumStockAlertLevel, Math.max(0, c.minimumStockAlertLevel - c.totalStock)]),
      summary: `${low.length} of ${cons.length} items at/below minimum` };
  },
};

async function buildReport(id) {
  const fn = REPORT_BUILDERS[id];
  if (!fn) throw new Error(`Unknown report: ${id}`);
  return fn();
}

/* ---- Custom report builder: any source × any columns × filters ---- */
const CRB_CATS = ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Network', 'Server', 'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'];
const CUSTOM_SOURCES = {
  assets: {
    label: 'Hardware Assets',
    fetch: async () => (await api('/assets?limit=2000')).items,
    columns: [
      ['assetTag', 'Asset Tag', (x) => x.assetTag],
      ['category', 'Category', (x) => x.category],
      ['brand', 'Brand', (x) => x.brand],
      ['model', 'Model', (x) => x.model],
      ['serialNumber', 'Serial No', (x) => x.serialNumber],
      ['mac', 'MAC', (x) => x.macEthernet || x.macWifi || ''],
      ['status', 'Status', (x) => x.status],
      ['employee', 'Assigned To', (x) => (x.currentEmployee ? x.currentEmployee.fullName : '')],
      ['purchaseDate', 'Purchase Date', (x) => (x.purchaseDate ? fmtDate(x.purchaseDate) : '')],
      ['cpu', 'CPU', (x) => (x.specs && x.specs.cpu) || ''],
      ['ram', 'RAM', (x) => (x.specs && x.specs.ram) || ''],
      ['storage', 'Storage', (x) => (x.specs && x.specs.storage) || ''],
      ['os', 'OS', (x) => (x.specs && x.specs.os) || ''],
      ['location', 'Location', (x) => x.location || ''],
      ['eol', 'Lifecycle EOL', (x) => { const l = lifecycleInfo(x); return l.eol ? fmtDate(l.eol) : ''; }],
      ['lifecycle', 'Lifecycle State', (x) => { const l = lifecycleInfo(x);
        return l.pct == null ? '' : (l.overdue ? 'OVERDUE' : Math.min(l.pct, 100) + '%'); }],
    ],
    filters: [
      { key: 'location', label: 'Location', type: 'select',
        get options() { return ['', ...(AppConfig.locations || [])]; },
        apply: (x, v) => x.location === v },
      { key: 'cpu', label: 'CPU', type: 'select',
        get options() { return ['', ...((AppConfig.specOptions || {}).cpu || [])]; },
        apply: (x, v) => (x.specs && x.specs.cpu) === v },
      { key: 'ram', label: 'RAM', type: 'select',
        get options() { return ['', ...((AppConfig.specOptions || {}).ram || [])]; },
        apply: (x, v) => (x.specs && x.specs.ram) === v },
      { key: 'storage', label: 'Storage', type: 'select',
        get options() { return ['', ...((AppConfig.specOptions || {}).storage || [])]; },
        apply: (x, v) => (x.specs && x.specs.storage) === v },
      { key: 'lifecycle', label: 'Lifecycle', type: 'select',
        options: [{ value: '', label: 'Lifecycle: all' }, { value: 'overdue', label: 'Past EOL (replace)' }, { value: 'ok', label: 'Within lifecycle' }],
        apply: (x, v) => (v === 'overdue' ? lifecycleInfo(x).overdue : !lifecycleInfo(x).overdue) },
      { key: 'status', label: 'Status', type: 'select', options: ['', 'In Stock', 'Assigned', 'In Repair', 'Scrap'],
        apply: (x, v) => x.status === v },
      { key: 'category', label: 'Category', type: 'select', options: ['', ...CRB_CATS],
        apply: (x, v) => x.category === v },
      { key: 'from', label: 'Purchased from', type: 'date',
        apply: (x, v) => x.purchaseDate && new Date(x.purchaseDate) >= new Date(v) },
      { key: 'to', label: 'Purchased to', type: 'date',
        apply: (x, v) => x.purchaseDate && new Date(x.purchaseDate) <= new Date(v + 'T23:59:59') },
    ],
  },
  employees: {
    label: 'Employees',
    fetch: async () => employeeList(await api('/employees?limit=10000')).items,
    columns: [
      ['fullName', 'Employee', (x) => x.fullName],
      ['email', 'Email', (x) => x.email],
      ['department', 'Department', (x) => x.department || ''],
      ['title', 'Title', (x) => x.title || ''],
      ['status', 'Status', (x) => x.status],
      ['activeAssetCount', 'Assets Held', (x) => x.activeAssetCount],
    ],
    filters: [
      { key: 'status', label: 'Status', type: 'select', options: ['', 'Active', 'Inactive'], apply: (x, v) => x.status === v },
      { key: 'department', label: 'Department contains', type: 'text',
        apply: (x, v) => (x.department || '').toLowerCase().includes(v.toLowerCase()) },
      { key: 'holders', label: 'Asset holders', type: 'select',
        options: [{ value: '', label: 'All' }, { value: 'yes', label: 'Holds assets' }, { value: 'no', label: 'Holds none' }],
        apply: (x, v) => (v === 'yes' ? x.activeAssetCount > 0 : x.activeAssetCount === 0) },
    ],
  },
  maintenance: {
    label: 'Maintenance Logs',
    fetch: async () => api('/maintenance?limit=2000'),
    columns: [
      ['assetTag', 'Asset Tag', (x) => x.assetTag],
      ['serviceCompany', 'Service Company', (x) => x.serviceCompany],
      ['issueDescription', 'Issue', (x) => x.issueDescription],
      ['sentDate', 'Sent', (x) => fmtDate(x.sentDate)],
      ['returnDate', 'Returned', (x) => (x.returnDate ? fmtDate(x.returnDate) : '')],
      ['days', 'Days', (x) => Math.max(0, Math.round(((x.returnDate ? new Date(x.returnDate) : new Date()) - new Date(x.sentDate)) / 86400000))],
      ['cost', 'Cost', (x) => fmtMoney(x.cost || 0)],
      ['state', 'State', (x) => (x.returnDate ? 'Closed' : 'Open')],
      ['notes', 'Notes', (x) => (x.progressNotes || []).map((n) => n.note).join(' | ')],
    ],
    filters: [
      { key: 'state', label: 'State', type: 'select', options: ['', 'Open', 'Closed'],
        apply: (x, v) => (x.returnDate ? 'Closed' : 'Open') === v },
      { key: 'from', label: 'Sent from', type: 'date', apply: (x, v) => new Date(x.sentDate) >= new Date(v) },
      { key: 'to', label: 'Sent to', type: 'date', apply: (x, v) => new Date(x.sentDate) <= new Date(v + 'T23:59:59') },
    ],
  },
  licenses: {
    label: 'Licenses',
    fetch: async () => api('/licenses'),
    columns: [
      ['softwareName', 'Software', (x) => x.softwareName],
      ['vendor', 'Vendor', (x) => x.vendor || ''],
      ['usedSeats', 'Used Seats', (x) => x.usedSeats],
      ['totalSeats', 'Total Seats', (x) => x.totalSeats],
      ['util', 'Utilization %', (x) => Math.round((x.usedSeats / x.totalSeats) * 100)],
      ['expirationDate', 'Expires', (x) => fmtDate(x.expirationDate)],
    ],
    filters: [
      { key: 'expiring', label: 'Expiring within (days)', type: 'number',
        apply: (x, v) => {
          const exp = new Date(x.expirationDate && x.expirationDate._seconds ? x.expirationDate._seconds * 1000 : x.expirationDate);
          const days = Math.ceil((exp - Date.now()) / 86400000);
          return days >= 0 && days <= Number(v);
        } },
    ],
  },
  software: {
    label: 'Software Assignments',
    fetch: async () => api('/licenses/assignments?includeRevoked=true'),
    columns: [
      ['employeeName', 'Employee', (x) => x.employeeName],
      ['softwareName', 'Software', (x) => x.softwareName],
      ['assignedAt', 'Assigned At', (x) => fmtDate(x.assignedAt)],
      ['assignedByName', 'Assigned By', (x) => x.assignedByName || ''],
      ['state', 'State', (x) => (x.revokedAt ? 'Revoked' : 'Active')],
      ['revokedAt', 'Revoked At', (x) => (x.revokedAt ? fmtDate(x.revokedAt) : '')],
    ],
    filters: [
      { key: 'state', label: 'State', type: 'select', options: ['', 'Active', 'Revoked'],
        apply: (x, v) => (x.revokedAt ? 'Revoked' : 'Active') === v },
    ],
  },
  consumables: {
    label: 'Consumables',
    fetch: async () => api('/consumables'),
    columns: [
      ['itemName', 'Item', (x) => x.itemName],
      ['totalStock', 'Stock', (x) => x.totalStock],
      ['minimumStockAlertLevel', 'Min. Level', (x) => x.minimumStockAlertLevel],
      ['state', 'Status', (x) => (x.lowStock ? 'LOW STOCK' : 'OK')],
    ],
    filters: [
      { key: 'low', label: 'Stock level', type: 'select',
        options: [{ value: '', label: 'All' }, { value: 'low', label: 'Low stock only' }, { value: 'ok', label: 'Healthy only' }],
        apply: (x, v) => (v === 'low' ? x.lowStock : !x.lowStock) },
    ],
  },
  handovers: {
    label: 'Handover Receipts',
    fetch: async () => api('/handovers?limit=200'),
    columns: [
      ['employeeName', 'Employee', (x) => x.employeeName],
      ['items', 'Items', (x) => (x.items || []).length],
      ['tags', 'Asset Tags', (x) => (x.items || []).map((i) => i.assetTag).join(', ')],
      ['transactionDate', 'Date', (x) => fmtDateTime(x.transactionDate)],
      ['documentType', 'Type', (x) => x.documentType],
    ],
    filters: [
      { key: 'from', label: 'From', type: 'date', apply: (x, v) => new Date(x.transactionDate) >= new Date(v) },
      { key: 'to', label: 'To', type: 'date', apply: (x, v) => new Date(x.transactionDate) <= new Date(v + 'T23:59:59') },
    ],
  },
};

/* Shared result renderer: preview table + Export CSV + Print. */
function showReportResult(slot, title, rep) {
  const shown = rep.rows.slice(0, 100);
  slot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${esc(title)} — ${new Date().toLocaleDateString()}</h3>
        <div style="display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" id="rep-print"><span class="ms">print</span> Print</button>
          <button class="btn btn-primary btn-sm" id="rep-csv"><span class="ms">download</span> Export CSV</button>
        </div>
      </div>
      <div class="card-pad" style="padding-bottom:8px"><span class="cell-sub">${esc(rep.summary)}</span></div>
      <div class="table-wrap" style="max-height:480px;overflow-y:auto"><table class="data">
        <thead><tr>${rep.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${shown.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
          ${rep.rows.length > 100 ? `<tr><td colspan="${rep.cols.length}" class="cell-sub" style="padding:10px 16px">
            Preview shows first 100 of ${rep.rows.length} rows — the CSV export contains everything.</td></tr>` : ''}
        </tbody>
      </table></div>
      <div class="table-foot">${rep.rows.length} rows</div>
    </div>`;
  slot.scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('#rep-csv', slot).addEventListener('click', () =>
    csvDownload(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`, rep.cols, rep.rows));
  $('#rep-print', slot).addEventListener('click', () => {
    $('#print-root').innerHTML = `
      <div class="receipt receipt-v2">
        <header class="r-banner">
          <div class="r-banner-left">
            <div class="r-logo">${AppConfig.companyLogo
              ? `<img src="${esc(AppConfig.companyLogo)}" alt="">`
              : esc((AppConfig.companyName || 'A')[0].toUpperCase())}</div>
            <div><h1>${esc((AppConfig.companyName || '').toUpperCase())}</h1>
              <small>${esc(title)}</small></div>
          </div>
          <div class="r-banner-right">
            <h2>${esc(title)}</h2>
            <h3>${esc(new Date().toLocaleString())}</h3>
          </div>
        </header>
        <div class="r-body">
          <p class="r-terms">${esc(rep.summary)}</p>
          <section class="r-card">
            <table class="r-items">
              <thead><tr>${rep.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
              <tbody>${rep.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </section>
        </div>
      </div>`;
    window.print();
  });
}
