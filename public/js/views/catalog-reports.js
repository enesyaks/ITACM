Views.catalog = async function (el) {
  const canCreate = Auth.canIam('catalog', 'create');
  const canUpdate = Auth.canIam('catalog', 'update');
  const canDelete = Auth.canIam('catalog', 'delete');
  const canEdit = canCreate || canUpdate || canDelete;
  const items = await api('/catalog');
  const cats = [...new Set(items.map((c) => c.category))];

  // Ticket categories are managed here too (they feed the ticket forms). Only a
  // ticket manager sees this section.
  const canTicketCats = Auth.canIam('ticket', 'manage');
  const ticketCats = canTicketCats ? await api('/tickets/categories/manage').catch(() => []) : [];
  const tcChip = (c) => `<span class="tk-cat-chip" data-cat="${esc(c)}">${esc(c)}<button type="button" class="tk-cat-x" title="${esc(t('common.remove') || 'Remove')}"><span class="ms ms-sm">close</span></button></span>`;
  const tcCard = () => `<div class="card card-pad" id="tk-cat-card" style="margin-bottom:16px">
      <h3 style="margin:0 0 4px">${esc(t('tk.catManageTitle'))}</h3>
      <p class="cell-sub" style="margin:0 0 12px">${esc(t('tk.catManageHint'))}</p>
      <div id="tk-cat-chips" class="tk-cat-chips">${(Array.isArray(ticketCats) ? ticketCats : []).map(tcChip).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
        <input id="tk-cat-new" placeholder="${esc(t('tk.catAdd'))}" maxlength="120" style="flex:0 0 240px">
        <button class="btn btn-outline btn-sm" id="tk-cat-add" type="button"><span class="ms ms-sm">add</span></button>
        <span style="flex:1"></span>
        <button class="btn btn-primary btn-sm" id="tk-cat-save">${esc(t('common.save'))}</button>
      </div>
    </div>`;

  el.innerHTML = `
    ${pageHead('cat.pageTitle', 'cat.pageSub', (canCreate || canUpdate) ? `
      ${canCreate || canUpdate ? `<button class="btn btn-outline" id="cat-import"><span class="ms">sync</span> ${esc(t('cat.importExisting'))}</button>` : ''}
      ${canCreate ? `<button class="btn btn-primary" id="cat-new"><span class="ms">add</span> ${esc(t('cat.addModel'))}</button>` : ''}
    ` : '')}
    ${canTicketCats ? tcCard() : ''}
    ${items.length === 0 ? `
      <div class="card card-pad" style="text-align:center;padding:48px">
        <div class="cell-sub" style="margin-bottom:14px">${esc(t('cat.emptyHint'))}</div>
      </div>` :
      cats.map((cat) => {
        const catDef = (AppConfig.lifecycles && AppConfig.lifecycles[cat] != null) ? AppConfig.lifecycles[cat] : null;
        const catHint = catDef != null ? `${catDef} ${t('cat.mo')}` : t('cat.appDefault');
        return `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>${esc(cat)} (${items.filter((c) => c.category === cat).length})</h3></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>${esc(t('cat.colBrand'))}</th><th>${esc(t('cat.colModel'))}</th><th style="width:180px">${esc(t('cat.colLifecycle'))}</th><th style="text-align:right"></th></tr></thead>
          <tbody>
            ${items.filter((c) => c.category === cat).map((c) => `
            <tr>
              <td class="cell-title">${esc(c.brand)}</td>
              <td>${esc(c.model)}</td>
              <td>${canUpdate
                ? `<input type="number" class="lc-input" data-lc="${esc(c.id)}" min="1" max="240"
                     value="${c.lifecycleMonths != null ? esc(String(c.lifecycleMonths)) : ''}"
                     placeholder="${catDef != null ? esc(String(catDef)) : ''}"
                     title="${esc(t('cat.lcInputTitle').replace('{cat}', cat).replace('{hint}', catHint))}"
                     style="width:82px;padding:6px 8px"> <span class="cell-sub">${esc(t('cat.mo'))}</span>`
                : (c.lifecycleMonths != null ? `${esc(String(c.lifecycleMonths))} ${esc(t('cat.mo'))}` : `<span class="cell-sub">${esc(t('cat.categoryDefault').replace('{hint}', catHint))}</span>`)}</td>
              <td class="actions">${canDelete ? `<button class="btn btn-outline btn-sm" data-del="${esc(c.id)}">${esc(t('cat.delete'))}</button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
      }).join('')}`;

  if (canTicketCats) {
    const chips = $('#tk-cat-chips', el);
    const wireX = () => chips.querySelectorAll('.tk-cat-x').forEach((b) => { b.onclick = () => b.closest('.tk-cat-chip').remove(); });
    wireX();
    const addCat = () => {
      const inp = $('#tk-cat-new', el); const v = inp.value.trim();
      if (v && ![...chips.querySelectorAll('.tk-cat-chip')].some((c) => c.dataset.cat.toLowerCase() === v.toLowerCase())) {
        chips.insertAdjacentHTML('beforeend', tcChip(v)); wireX();
      }
      inp.value = ''; inp.focus();
    };
    $('#tk-cat-add', el)?.addEventListener('click', addCat);
    $('#tk-cat-new', el)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } });
    $('#tk-cat-save', el)?.addEventListener('click', async () => {
      const items = [...chips.querySelectorAll('.tk-cat-chip')].map((c) => c.dataset.cat);
      try { await api('/tickets/categories/manage', { method: 'PUT', body: { items } }); toast(t('tk.saved') || t('common.saved') || 'Saved', 'success'); }
      catch (err) { toast(err.message, 'error'); }
    });
  }

  if (canCreate) {
    // Existing brands per category — the brand field lists them so you reuse a
    // known brand (no "Dell" vs "dell" duplicates) and only type a new one via
    // "Other", which the POST below saves into the catalog for next time.
    const brandsByCat = {};
    items.forEach((c) => { (brandsByCat[c.category] = brandsByCat[c.category] || new Set()).add(c.brand); });
    const brandOpts = (cat) => [...(brandsByCat[cat] || [])].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b }));
    const otherLbl = t('cat.brandOther') || 'Other (type a new brand)…';

    $('#cat-new', el)?.addEventListener('click', () => formModal({
      title: t('cat.addModelTitle'),
      fields: [
        { name: 'category', label: t('cat.fCategory') + ' *', type: 'select', required: true, value: 'Laptop',
          options: ['Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Network', 'Server', 'Keyboard', 'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other'] },
        { name: 'brand', label: t('cat.fBrand') + ' *', type: 'selectOther', required: true,
          options: brandOpts('Laptop'), otherLabel: otherLbl, otherPlaceholder: t('cat.fBrand') },
        { name: 'model', label: t('cat.fModel') + ' *', required: true, full: true },
        { name: 'lifecycleMonths', label: t('cat.fLifecycle'), type: 'number', full: true,
          placeholder: t('cat.fLifecyclePh') },
      ],
      submitLabel: t('cat.addModelSubmit'),
      onMount(overlay) {
        const catSel = overlay.querySelector('select[name="category"]');
        const brandSel = overlay.querySelector('select[data-select-other="brand"]');
        const brandOther = overlay.querySelector('input[data-other-for="brand"]');
        if (!catSel || !brandSel) return;
        catSel.addEventListener('change', () => {
          const opts = brandOpts(catSel.value);
          brandSel.innerHTML = opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
            + `<option value="__other__">${esc(otherLbl)}</option>`;
          if (brandOther) brandOther.value = '';
          // Re-sync the "other" text box visibility (formModal listens on change).
          brandSel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      },
      async onSubmit(d) {
        await api('/catalog', { method: 'POST', body: d });
        toast(t('cat.addedToast').replace('{brand}', d.brand).replace('{model}', d.model), 'success');
        Views.catalog(el);
      },
    }));
  }
  if (canCreate || canUpdate) {
    $('#cat-import', el)?.addEventListener('click', async () => {
      try {
        const r = await api('/catalog/import', { method: 'POST' });
        toast(`${r.imported} brand/model entries imported from inventory`, 'success');
        Views.catalog(el);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // Inline per-model lifecycle edit → EOL for every asset of that brand/model.
  el.querySelectorAll('.lc-input').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const val = inp.value.trim();
      try {
        await api('/catalog/' + inp.dataset.lc, { method: 'PUT', body: { lifecycleMonths: val === '' ? null : Number(val) } });
        toast('Lifecycle updated — applies to every asset of this model', 'success');
      } catch (err) { toast(err.message, 'error'); Views.catalog(el); }
    });
  });

  /* ---- Office Locations (stored in settings, drives asset form dropdown) ---- */
  const locData = await api('/catalog/locations').catch(() => ({ locations: [], defaultLocation: null }));
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:4px">
      <div class="card-head">
        <h3>${esc(t('cat.locations'))} (${locData.locations.length})</h3>
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="loc-add"><span class="ms">add_location_alt</span> ${esc(t('cat.addLocation'))}</button>` : ''}
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>${esc(t('cat.colLocation'))}</th><th>${esc(t('cat.colDefault'))}</th><th style="text-align:right"></th></tr></thead>
        <tbody>
          ${locData.locations.map((l) => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:10px"><span class="ms" style="color:var(--on-surface-variant)">location_on</span>
              <span class="cell-title">${esc(l)}</span></div></td>
            <td>${locData.defaultLocation === l
              ? `<span class="loc-default"><span class="pill pill-indigo">${esc(t('cat.defaultPill'))}</span>${canEdit ? ` <button class="icon-btn loc-default-clear" data-cleardef="1" title="${esc(t('common.clear') || 'Clear')}" aria-label="${esc(t('common.clear') || 'Clear')}"><span class="ms ms-sm">close</span></button>` : ''}</span>`
              : (canEdit ? `<button class="btn btn-outline btn-sm" data-setdef="${esc(l)}">${esc(t('cat.setDefault'))}</button>` : '—')}</td>
            <td class="actions">${canEdit ? `<button class="btn btn-outline btn-sm" data-delloc="${esc(l)}">${esc(t('cat.delete'))}</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="table-foot">${esc(t('cat.locationsFoot'))}</div>
    </div>`);

  /* ---- Hardware spec lists (cpu / ram / storage) ---- */
  const specs = await api('/catalog/specs').catch(() => ({ cpu: [], ram: [], storage: [] }));
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>${esc(t('cat.specLists'))}</h3>
        <span class="cell-sub">${esc(t('cat.specListsSub'))}</span></div>
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
            ${canEdit ? `<button class="icon-btn" style="width:26px;height:26px" data-delspec="${type}" data-val="${esc(v)}" title="${esc(t('cat.delete'))}"><span class="ms ms-sm">close</span></button>` : ''}
          </div>`).join('')}
        </div>`).join('')}
      </div>
    </div>`);

  /* ---- Product lifecycle durations + per-category EOL on/off ---- */
  // Category defaults only — never mix with per-model .lc-input[data-lc] (UUIDs).
  const lifecycles = await api('/catalog/lifecycles').catch(() => ({}));
  const lcCats = Object.keys(lifecycles).filter((k) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k));
  el.insertAdjacentHTML('beforeend', `
    <div class="card lc-card" style="margin-top:16px">
      <div class="card-head">
        <h3>${esc(t('cat.lifecycleTitle'))}</h3>
        <span class="cell-sub">${esc(t('cat.lifecycleSub'))}</span>
      </div>
      <div class="card-pad">
        <div class="lc-grid">
          ${lcCats.map((cat) => {
            const m = Number(lifecycles[cat]);
            const on = m > 0;
            return `
            <div class="lc-item${!on ? ' is-off' : ''}">
              <div class="lc-item-top">
                <span class="lc-cat">${esc(cat)}</span>
                <label class="lc-eol">
                  <input type="checkbox" data-lc-cat-on="${esc(cat)}" ${on ? 'checked' : ''} ${canEdit ? '' : 'disabled'}>
                  <span>EOL</span>
                </label>
              </div>
              <div class="lc-months">
                <input type="number" min="1" max="240" data-lc-cat="${esc(cat)}"
                  value="${on ? m : 48}" ${(canEdit && on) ? '' : 'disabled'}>
                <span class="cell-sub">${esc(t('cat.mo'))}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="lc-save" style="margin-top:14px"><span class="ms">save</span> ${esc(t('cat.saveLifecycles'))}</button>` : ''}
      </div>
    </div>`);

  if (canEdit) {
    el.querySelectorAll('[data-lc-cat-on]').forEach((c) => c.addEventListener('change', () => {
      const item = c.closest('.lc-item');
      const inp = el.querySelector(`[data-lc-cat="${c.dataset.lcCatOn}"]`);
      if (inp) inp.disabled = !c.checked;
      if (item) item.classList.toggle('is-off', !c.checked);
    }));
    const lcSave = $('#lc-save', el);
    if (lcSave) lcSave.addEventListener('click', async () => {
      try {
        const body = Object.fromEntries([...el.querySelectorAll('[data-lc-cat]')].map((i) => {
          const on = el.querySelector(`[data-lc-cat-on="${i.dataset.lcCat}"]`);
          return [i.dataset.lcCat, on && !on.checked ? 0 : (Number(i.value) || 48)];
        }));
        const saved = await api('/catalog/lifecycles', { method: 'PUT', body });
        AppConfig.lifecycles = saved;
        toast(t('cat.lifecycleSaved'), 'success');
        Views.catalog(el);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---- Company departments (feed the employee form) ---- */
  const departments = await api('/catalog/departments').catch(() => []);
  el.insertAdjacentHTML('beforeend', `
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h3>${esc(t('cat.departments'))} (${departments.length})</h3>
        ${canEdit ? `<button class="btn btn-primary btn-sm" id="dept-add"><span class="ms">add</span> ${esc(t('cat.addDepartment'))}</button>` : ''}
      </div>
      <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
        ${departments.length === 0 ? `<span class="cell-sub">${esc(t('cat.noDepartments'))}</span>` :
          departments.map((d) => `
          <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
            ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-deldept="${esc(d)}" title="${esc(t('cat.delete'))}"><span class="ms ms-sm">close</span></button>` : ''}
          </span>`).join('')}
      </div>
      <div class="table-foot">${esc(t('cat.departmentsFoot'))}</div>
    </div>`);

  /* ---- Provider & contract categories ---- */
  const providerCategories = await api('/catalog/provider-categories').catch(() => AppConfig.providerCategories || []);
  const contractCategories = await api('/catalog/contract-categories').catch(() => AppConfig.contractCategories || []);
  el.insertAdjacentHTML('beforeend', `
    <div class="grid grid-2" style="margin-top:16px;gap:16px">
      <div class="card">
        <div class="card-head">
          <h3>${esc(t('cat.providerCategories'))} (${providerCategories.length})</h3>
          ${canEdit ? `<button class="btn btn-primary btn-sm" id="pcat-add"><span class="ms">add</span> ${esc(t('cat.add'))}</button>` : ''}
        </div>
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
          ${providerCategories.length === 0 ? `<span class="cell-sub">${esc(t('cat.noCategories'))}</span>` :
            providerCategories.map((d) => `
            <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
              ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-delpcat="${esc(d)}" title="${esc(t('cat.delete'))}"><span class="ms ms-sm">close</span></button>` : ''}
            </span>`).join('')}
        </div>
        <div class="table-foot">${esc(t('cat.providerCatFoot'))}</div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>${esc(t('cat.contractCategories'))} (${contractCategories.length})</h3>
          ${canEdit ? `<button class="btn btn-primary btn-sm" id="ccat-add"><span class="ms">add</span> ${esc(t('cat.add'))}</button>` : ''}
        </div>
        <div class="card-pad" style="display:flex;flex-wrap:wrap;gap:8px">
          ${contractCategories.length === 0 ? `<span class="cell-sub">${esc(t('cat.noCategories'))}</span>` :
            contractCategories.map((d) => `
            <span class="chip" style="display:inline-flex;align-items:center;gap:6px">${esc(d)}
              ${canEdit ? `<button class="icon-btn" style="width:20px;height:20px" data-delccat="${esc(d)}" title="${esc(t('cat.delete'))}"><span class="ms ms-sm">close</span></button>` : ''}
            </span>`).join('')}
        </div>
        <div class="table-foot">${esc(t('cat.contractCatFoot'))}</div>
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
        toast(t('cat.entryRemoved'), 'success');
        Views.catalog(el);
      } else if (b.dataset.setdef) {
        const r = await api('/catalog/locations/default', { method: 'PUT', body: { name: b.dataset.setdef } });
        AppConfig.defaultLocation = r.defaultLocation;
        toast(`Default location set to ${b.dataset.setdef}`, 'success');
        Views.catalog(el);
      } else if (b.dataset.cleardef) {
        const r = await api('/catalog/locations/default', { method: 'PUT', body: { name: null } });
        AppConfig.defaultLocation = r.defaultLocation;
        toast(t('catalog.defaultCleared') || 'Default location cleared', 'success');
        Views.catalog(el);
      } else if (b.dataset.deldept) {
        const name = b.dataset.deldept;
        // How many employees are in this department? If any, offer to move them.
        let empTotal = 0;
        try {
          const res = await api('/employees?department=' + encodeURIComponent(name) + '&limit=1');
          empTotal = res.total ?? (res.items ? res.items.length : 0);
        } catch { /* fall through — backend still guards */ }
        const others = (AppConfig.departments || []).filter((d) => d !== name);
        formModal({
          title: 'catalog.delDeptTitle',
          submitLabel: 'common.delete',
          fields: [
            { type: 'html', full: true, html: `<p class="cell-sub">${esc((t('catalog.delDeptConfirm') || 'Delete department “{name}”?').replace('{name}', name))}</p>` },
            ...(empTotal > 0 ? [
              { type: 'html', full: true, html: `<div class="banner banner-amber">${esc((t('catalog.delDeptEmp') || '{n} employee(s) are in this department — choose where to move them.').replace('{n}', empTotal))}</div>` },
              { name: 'reassignTo', label: t('catalog.delDeptMoveTo'), type: 'select', required: true, options: others.map((d) => ({ value: d, label: d })) },
            ] : []),
          ],
          async onSubmit(d) {
            const r = await api('/catalog/departments/' + encodeURIComponent(name), {
              method: 'DELETE',
              body: empTotal > 0 ? { reassignTo: d.reassignTo } : undefined,
            });
            AppConfig.departments = r;
            toast(t('cat.deptRemoved').replace('{name}', name), 'success');
            Views.catalog(el);
          },
        });
        return;
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
  const canReadDocs = Auth.canIam('document', 'read') || Auth.can('canReadDocuments');
  const canDownloadDocs = Auth.canIam('document', 'download') || Auth.can('canDownloadDocuments');
  const canUploadDocs = Auth.canIam('document', 'upload') || Auth.canIam('document', 'create') || Auth.can('canUploadDocuments');
  const canDelDoc = Auth.canIam('document', 'delete') || Auth.can('canDeleteDocuments');
  const canNote = Auth.canIam('maintenance', 'update') || Auth.canIam('maintenance', 'manage');
  const docs = canReadDocs
    ? await api(`/maintenance/${log.id}/documents`).catch(() => [])
    : [];
  openModal({
    title: (t('mnt.nTitle') || 'Repair notes & documents — {tag}').replace('{tag}', log.assetTag),
    wide: true,
    body: `
      <div class="cell-sub" style="margin-bottom:12px">${esc(log.serviceCompany)} • ${esc(log.issueDescription)}
        • ${esc((t('mnt.sentOn') || 'sent {date}').replace('{date}', fmtDate(log.sentDate)))}${log.returnDate ? ' • closed ' + fmtDate(log.returnDate) : ''}</div>

      <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0 0 6px">${esc((t('mnt.progressNotes') || 'Progress notes ({n})').replace('{n}', notes.length))}</h3>
      ${notes.length === 0 ? `<div class="cell-sub" style="margin-bottom:8px">${esc(t('mnt.noProgressNotes'))}</div>` :
        notes.map((n) => `
        <div class="history-item" style="flex-wrap:wrap">
          <span class="when">${fmtDateTime(n.at)}</span>
          <span class="cell-sub">${esc(t('common.by'))} ${esc(n.by || '—')}</span>
          <span style="flex-basis:100%;padding-left:2px">${esc(n.note)}</span>
        </div>`).join('')}
      ${canNote ? `<div class="form-field" style="margin-top:14px">
        <label>${esc(t('mnt.addProgressNote'))} <span class="ob-hint">${esc(t('mnt.alsoInHistory'))}</span></label>
        <textarea id="mn-new-note" placeholder="${esc(t('mnt.notePh'))}"></textarea>
      </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 8px">
        <h3 style="font-size:11px;text-transform:uppercase;color:var(--on-surface-variant);margin:0">${esc((t('mnt.documents') || 'Documents ({n})').replace('{n}', canReadDocs ? docs.length : '—'))}</h3>
        ${canUploadDocs ? `<button class="btn btn-outline btn-sm" id="mn-upload-btn"><span class="ms">upload_file</span> ${esc(t('mnt.uploadDocument'))}</button>` : ''}
      </div>
      <div class="cell-sub" style="margin-bottom:8px">${esc(t('mnt.docsHint'))}</div>
      <input type="file" id="mn-doc-file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" class="hidden">
      ${!canReadDocs
        ? `<div class="table-empty">${esc(t('emp.docsNoPerm'))}</div>`
        : docs.length === 0 ? `<div class="table-empty">${esc(t('mnt.noDocuments'))}</div>` : `
      <div class="table-wrap" style="border:1px solid var(--outline-variant);border-radius:var(--radius-lg)"><table class="data">
        <thead><tr><th>${esc(t('emp.docColName'))}</th><th>${esc(t('emp.docColSize'))}</th><th>${esc(t('emp.docColAdded'))}</th><th style="text-align:right"></th></tr></thead>
        <tbody>
          ${docs.map((d) => `
          <tr>
            <td>${docFileLabel(d, { canDownload: canDownloadDocs, viewAttr: 'data-mdoc-view' })}</td>
            <td class="cell-sub">${fmtBytes(d.byteSize || 0)}</td>
            <td class="cell-sub">${fmtDateTime(d.createdAt)}${d.uploadedByName ? ' • ' + esc(d.uploadedByName) : ''}</td>
            <td class="actions">
              ${docRowActions(d, { canDownload: canDownloadDocs, canDel: canDelDoc, viewAttr: 'data-mdoc-view', dlAttr: 'data-mdoc-dl', delAttr: 'data-mdoc-del' })}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}`,
    foot: `<button class="btn btn-outline" data-close>${esc(t('common.close'))}</button>
           ${canNote ? `<button class="btn btn-primary" id="mn-add-note"><span class="ms">add_comment</span> ${esc(t('mnt.addNote'))}</button>` : ''}`,
    onMount(overlay) {
      $('#mn-add-note', overlay)?.addEventListener('click', async () => {
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
      if (upBtn && upFile) {
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
      }

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
  const csvEsc = (v) => `"${csvCell(v).replace(/"/g, '""')}"`;
  // \uFEFF BOM so Excel opens Turkish characters correctly.
  const csv = '\uFEFF' + [cols, ...rows].map((r) => r.map(csvEsc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
}

/** Which IAM resource must allow list/read for each preset report. */
const REPORT_IAM = {
  inventory: 'asset',
  'by-category': 'asset',
  'by-location': 'asset',
  'by-status': 'asset',
  'in-stock': 'asset',
  eol: 'asset',
  aging: 'asset',
  depreciation: 'asset',
  scrap: 'asset',
  assignments: 'asset',
  employees: 'employee',
  'no-assets': 'employee',
  handovers: 'handover',
  licenses: 'license',
  'expiring-licenses': 'license',
  software: 'license',
  maintenance: 'maintenance',
  'open-repairs': 'maintenance',
  consumables: 'consumable',
  'low-stock': 'consumable',
};

const CUSTOM_SOURCE_IAM = {
  assets: 'asset',
  employees: 'employee',
  maintenance: 'maintenance',
  licenses: 'license',
  software: 'license',
  consumables: 'consumable',
  handovers: 'handover',
};

function iamCanList(resource) {
  return Auth.canIamOp(resource, 'read');
}

function canRunReport(id) {
  const res = REPORT_IAM[id];
  return res ? iamCanList(res) : true;
}

function visibleReportDefs() {
  return REPORT_DEFS.filter((r) => canRunReport(r.id));
}

function visibleCustomSourceKeys() {
  return Object.keys(CUSTOM_SOURCES).filter((k) => {
    const res = CUSTOM_SOURCE_IAM[k];
    return res ? iamCanList(res) : true;
  });
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
  { id: 'depreciation', group: 'Hardware', icon: 'trending_down', tone: 'amber', title: 'Asset Depreciation / Book Value',
    desc: 'Purchase cost, current book value and depreciation per asset — for finance & insurance.' },
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
      summary: t('rep.sum.inventory')
        .replace('{n}', items.length)
        .replace('{a}', items.filter((x) => x.status === 'Assigned').length)
        .replace('{s}', items.filter((x) => x.status === 'In Stock').length)
        .replace('{r}', items.filter((x) => x.status === 'In Repair').length)
        .replace('{c}', items.filter((x) => x.status === 'Scrap').length),
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
      summary: t('rep.sum.byCategory').replace('{n}', items.length).replace('{c}', rows.length) };
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
      summary: t('rep.sum.byLocation').replace('{n}', items.length).replace('{c}', rows.length) };
  },

  'by-status': async () => {
    const { items } = await api('/assets?limit=2000');
    const total = items.length || 1;
    const rows = ['In Stock', 'Assigned', 'In Repair', 'Scrap'].map((s) => {
      const n = items.filter((x) => x.status === s).length;
      return [s, n, Math.round((n / total) * 100) + '%'];
    });
    return { cols: ['Status', 'Count', '% of Fleet'], rows, summary: t('rep.sum.total').replace('{n}', items.length) };
  },

  'in-stock': async () => {
    const { items } = await api('/assets?status=In Stock&limit=2000');
    return { cols: ['Asset Tag', 'Category', 'Brand', 'Model', 'Serial No', 'Location', 'Purchase Date'],
      rows: items.map((x) => [x.assetTag, x.category, x.brand, x.model, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : '']),
      summary: t('rep.sum.inStock').replace('{n}', items.length) };
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
      summary: t('rep.sum.eol').replace('{n}', rows.length).replace('{o}', overdue) };
  },

  aging: async () => {
    const { items } = await api('/assets?limit=2000');
    const rows = items.filter((x) => x.purchaseDate)
      .map((x) => ({ x, age: Math.floor((Date.now() - new Date(x.purchaseDate).getTime()) / REPORT_MONTH_MS) }))
      .sort((a, b) => b.age - a.age)
      .map(({ x, age }) => [x.assetTag, x.category, `${x.brand} ${x.model}`, fmtDate(x.purchaseDate), age, x.status, asgName(x)]);
    return { cols: ['Asset Tag', 'Category', 'Brand / Model', 'Purchase Date', 'Age (months)', 'Status', 'Assigned To'], rows,
      summary: t('rep.sum.aging').replace('{n}', rows.length) };
  },
  depreciation: async () => {
    const { items } = await api('/assets?limit=2000');
    // Only priced assets carry a book value; skip the rest so totals are meaningful.
    const priced = items.filter((x) => Number(x.cost) > 0);
    let totalCost = 0;
    let totalBook = 0;
    const rows = priced
      .sort((a, b) => (b.depreciated || 0) - (a.depreciated || 0))
      .map((x) => {
        const cost = Number(x.cost) || 0;
        const book = x.bookValue != null ? x.bookValue : cost;
        totalCost += cost;
        totalBook += book;
        return [
          x.assetTag, x.category, `${x.brand} ${x.model}`,
          x.purchaseDate ? fmtDate(x.purchaseDate) : '—',
          fmtMoney(cost),
          x.salvageValue != null ? fmtMoney(x.salvageValue) : '—',
          x.bookValue != null ? fmtMoney(x.bookValue) : '—',
          x.depreciated != null ? fmtMoney(x.depreciated) : '—',
          x.depreciationPct != null ? `${x.depreciationPct}%` : '—',
          x.status, asgName(x),
        ];
      });
    return {
      cols: ['Asset Tag', 'Category', 'Brand / Model', 'Purchase Date', 'Purchase Cost',
        'Salvage', 'Book Value', 'Depreciated', 'Depreciated %', 'Status', 'Assigned To'],
      rows,
      summary: t('rep.sum.depreciation')
        .replace('{n}', rows.length)
        .replace('{p}', fmtMoney(totalCost))
        .replace('{b}', fmtMoney(totalBook))
        .replace('{d}', fmtMoney(totalCost - totalBook)),
    };
  },

  scrap: async () => {
    const { items } = await api('/assets?status=Scrap&limit=2000');
    return { cols: ['Asset Tag', 'Category', 'Brand / Model', 'Serial No', 'Location', 'Purchase Date'],
      rows: items.map((x) => [x.assetTag, x.category, `${x.brand} ${x.model}`, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : '']),
      summary: t('rep.sum.scrap').replace('{n}', items.length) };
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
      summary: t('rep.sumAssignedAcross')
        .replace('{n}', items.length)
        .replace('{m}', new Set(rows.map((r) => r[0])).size) };
  },

  employees: async () => {
    const emps = employeeList(await api('/employees?limit=10000')).items;
    return { cols: ['Employee', 'Email', 'Department', 'Title', 'Status', 'Assets Held'],
      rows: emps.map((p) => [p.fullName, p.email, p.department || '', p.title || '', p.status, p.activeAssetCount]),
      summary: t('rep.sum.employees').replace('{n}', emps.length).replace('{a}', emps.filter((p) => p.status === 'Active').length) };
  },

  'no-assets': async () => {
    const emps = employeeList(await api('/employees?limit=10000')).items;
    const none = emps.filter((p) => p.status === 'Active' && !p.activeAssetCount);
    return { cols: ['Employee', 'Email', 'Department', 'Title'],
      rows: none.map((p) => [p.fullName, p.email, p.department || '', p.title || '']),
      summary: t('rep.sum.noAssets').replace('{n}', none.length) };
  },

  handovers: async () => {
    const hs = await api('/handovers?limit=200');
    const rows = hs.slice().sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
      .map((h) => [fmtDateTime(h.transactionDate), h.employeeName, (h.items || []).length,
        (h.items || []).map((i) => i.assetTag).join(', '), h.documentType]);
    return { cols: ['Date', 'Employee', '# Items', 'Asset Tags', 'Type'], rows,
      summary: t('rep.sum.handovers').replace('{n}', hs.length) };
  },

  licenses: async () => {
    const lics = await api('/licenses');
    return { cols: ['Software', 'Vendor', 'Used Seats', 'Total Seats', 'Utilization %', 'Expires'],
      rows: lics.map((l) => [l.softwareName, l.vendor || '', l.usedSeats, l.totalSeats,
        Math.round((l.usedSeats / l.totalSeats) * 100), fmtDate(l.expirationDate)]),
      summary: t('rep.sum.licenses')
        .replace('{n}', lics.length)
        .replace('{u}', lics.reduce((s2, l) => s2 + l.usedSeats, 0))
        .replace('{t}', lics.reduce((s2, l) => s2 + l.totalSeats, 0)) };
  },

  'expiring-licenses': async () => {
    const lics = await api('/licenses');
    const now = Date.now();
    const rows = lics.map((l) => ({ l, days: Math.ceil((new Date(l.expirationDate).getTime() - now) / 86400000) }))
      .filter((o) => o.days >= 0 && o.days <= 90)
      .sort((a, b) => a.days - b.days)
      .map(({ l, days }) => [l.softwareName, l.vendor || '', fmtDate(l.expirationDate), days, `${l.usedSeats}/${l.totalSeats}`]);
    return { cols: ['Software', 'Vendor', 'Expires', 'Days Left', 'Seats (used/total)'], rows,
      summary: t('rep.sum.expiring').replace('{n}', rows.length) };
  },

  software: async () => {
    const rows = await api('/licenses/assignments');
    return { cols: ['Employee', 'Software', 'Assigned At', 'Assigned By'],
      rows: rows.map((a2) => [a2.employeeName, a2.softwareName, fmtDate(a2.assignedAt), a2.assignedByName || '']),
      summary: t('rep.sum.software').replace('{n}', rows.length) };
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
      summary: t('rep.sum.maintenance')
        .replace('{n}', logs.length)
        .replace('{o}', logs.filter((m) => !m.returnDate).length)
        .replace('{c}', fmtMoney(totalCost)) };
  },

  'open-repairs': async () => {
    const logs = await api('/maintenance?limit=2000');
    const open = logs.filter((m) => !m.returnDate);
    const rows = open.map((m) => [m.assetTag, m.serviceCompany, m.issueDescription, fmtDate(m.sentDate),
      Math.max(0, Math.round((Date.now() - new Date(m.sentDate).getTime()) / 86400000)), fmtMoney(m.cost || 0)])
      .sort((a, b) => b[4] - a[4]);
    return { cols: ['Asset Tag', 'Service Company', 'Issue', 'Sent', 'Days Open', 'Est. Cost'], rows,
      summary: t('rep.sum.openRepairs').replace('{n}', open.length) };
  },

  consumables: async () => {
    const cons = await api('/consumables');
    return { cols: ['Item', 'Stock', 'Min. Level', 'Status'],
      rows: cons.map((c) => [c.itemName, c.totalStock, c.minimumStockAlertLevel, c.lowStock ? 'LOW STOCK' : 'OK']),
      summary: t('rep.sum.consumables').replace('{n}', cons.length).replace('{b}', cons.filter((c) => c.lowStock).length) };
  },

  'low-stock': async () => {
    const cons = await api('/consumables');
    const low = cons.filter((c) => c.lowStock);
    return { cols: ['Item', 'Stock', 'Min. Level', 'Shortfall'],
      rows: low.map((c) => [c.itemName, c.totalStock, c.minimumStockAlertLevel, Math.max(0, c.minimumStockAlertLevel - c.totalStock)]),
      summary: t('rep.sum.lowStock').replace('{n}', low.length).replace('{t}', cons.length) };
  },
};

async function buildReport(id) {
  const fn = REPORT_BUILDERS[id];
  if (!fn) throw new Error(`Unknown report: ${id}`);
  if (!canRunReport(id)) {
    const res = REPORT_IAM[id] || 'module';
    throw new Error(`This report requires ${res}:read`);
  }
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
      { key: 'assignment', label: 'Assignment', type: 'select',
        options: [{ value: '', label: 'All' }, { value: 'assigned', label: 'Assigned' }, { value: 'unassigned', label: 'Unassigned' }],
        apply: (x, v) => (v === 'assigned' ? !!x.currentEmployee : v === 'unassigned' ? !x.currentEmployee : true) },
      { key: 'employee', label: 'Assigned to (employees)', type: 'employeeMulti',
        apply: (x, ids) => !!x.currentEmployee && ids.includes(String(x.currentEmployee.id)) },
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

// Report column headers are canonical English strings inside each report
// builder. Map the common ones to translations for DISPLAY; unknown headers
// fall through unchanged. CSV export keeps the original English headers.
const REP_COL_I18N = {
  'Employee': 'rep.col.employee',
  'Department': 'rep.col.department',
  'Asset Tag': 'rep.col.assetTag',
  'Brand / Model': 'rep.col.brandModel',
  'Category': 'rep.col.category',
  'Serial No': 'rep.col.serialNo',
  'Location': 'rep.col.location',
  'Purchase Date': 'rep.col.purchaseDate',
  'Email': 'rep.col.email',
  'Title': 'rep.col.title',
  'Status': 'common.status',
  'Assets Held': 'rep.col.assetsHeld',
  '# Items': 'rep.col.items',
  '% of Fleet': 'rep.col.fleetPct',
  'Age (months)': 'rep.col.ageMonths',
  'Asset Tags': 'rep.col.assetTags',
  'Assigned At': 'rep.col.assignedAt',
  'Assigned By': 'rep.col.assignedBy',
  'Assigned To': 'rep.col.assignedTo',
  'Assigned': 'rep.col.assigned',
  'Brand': 'rep.col.brand',
  'Cost': 'rep.col.cost',
  'Count': 'rep.col.count',
  'Date': 'rep.col.date',
  'Days Left': 'rep.col.daysLeft',
  'Days Open': 'rep.col.daysOpen',
  'Days': 'rep.col.days',
  'EOL Date': 'rep.col.eolDate',
  'Elapsed': 'rep.col.elapsed',
  'Est. Cost': 'rep.col.estCost',
  'Expires': 'rep.col.expires',
  'In Repair': 'rep.col.inRepair',
  'In Stock': 'rep.col.inStock',
  'Issue': 'rep.col.issue',
  'Item': 'rep.col.item',
  'MAC': 'rep.col.mac',
  'Min. Level': 'rep.col.minLevel',
  'Model': 'rep.col.model',
  'Notes': 'rep.col.notes',
  'Returned': 'rep.col.returned',
  'Scrap': 'rep.col.scrap',
  'Seats (used/total)': 'rep.col.seatsUsedTotal',
  'Sent': 'rep.col.sent',
  'Service Company': 'rep.col.serviceCompany',
  'Shortfall': 'rep.col.shortfall',
  'Software': 'rep.col.software',
  'State': 'rep.col.state',
  'Stock': 'rep.col.stock',
  'Total Assets': 'rep.col.totalAssets',
  'Total Seats': 'rep.col.totalSeats',
  'Total': 'rep.col.total',
  'Type': 'rep.col.type',
  'Used Seats': 'rep.col.usedSeats',
  'Utilization %': 'rep.col.utilizationPct',
  'Vendor': 'rep.col.vendor',
  'Purchase Cost': 'rep.col.purchaseCost',
  'Salvage': 'rep.col.salvage',
  'Book Value': 'rep.col.bookValue',
  'Depreciated': 'rep.col.depreciated',
  'Depreciated %': 'rep.col.depreciatedPct',
};
function repCol(name) {
  const key = REP_COL_I18N[name];
  if (!key) return name;
  const out = t(key);
  return out && out !== key ? out : name;
}

/* Shared result renderer: preview table + Export CSV + Print. */
function showReportResult(slot, title, rep) {
  const shown = rep.rows.slice(0, 100);
  slot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>${esc(title)} — ${new Date().toLocaleDateString()}</h3>
        <div style="display:flex;gap:8px">
          ${Auth.canIam('report', 'export')
            ? `<button class="btn btn-outline btn-sm" id="rep-print"><span class="ms">print</span> ${esc(t('rep.print'))}</button><button class="btn btn-primary btn-sm" id="rep-csv"><span class="ms">download</span> ${esc(t('rep.exportCsv'))}</button>`
            : ''}
        </div>
      </div>
      <div class="card-pad" style="padding-bottom:8px"><span class="cell-sub">${esc(rep.summary)}</span></div>
      <div class="table-wrap" style="max-height:480px;overflow-y:auto"><table class="data">
        <thead><tr>${rep.cols.map((c) => `<th>${esc(repCol(c))}</th>`).join('')}</tr></thead>
        <tbody>
          ${shown.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
          ${rep.rows.length > 100 ? `<tr><td colspan="${rep.cols.length}" class="cell-sub" style="padding:10px 16px">
            ${esc(t('rep.previewNote').replace('{n}', rep.rows.length))}</td></tr>` : ''}
        </tbody>
      </table></div>
      <div class="table-foot">${rep.rows.length} ${esc(t('rep.rowsLabel'))}</div>
    </div>`;
  slot.scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('#rep-csv', slot)?.addEventListener('click', () => {
    if (!Auth.canIam('report', 'export')) {
      toast(t('common.forbidden') || 'You do not have permission to export', 'error');
      return;
    }
    csvDownload(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`, rep.cols, rep.rows);
  });
  $('#rep-print', slot).addEventListener('click', () => {
    $('#print-root').innerHTML = `
      <div class="receipt receipt-v2 receipt-report">
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
              <thead><tr>${rep.cols.map((c) => `<th>${esc(repCol(c))}</th>`).join('')}</tr></thead>
              <tbody>${rep.rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </section>
        </div>
      </div>`;
    window.print();
  });
}
