/**
 * The product catalogue — the estate's controlled vocabulary.
 *
 * It answers three questions, and the old layout answered none of them well:
 * what may be typed into an asset form (fourteen stacked tables, one per
 * category), how long we keep each kind of thing (a number in a box, with the
 * category's own default hidden in a tooltip), and which entries are actually
 * carried by anybody (nothing said).
 *
 * So the lifespan is DRAWN rather than typed, on one scale shared by every
 * category: a monitor's 84 months is visibly three phones. A tick marks the
 * category default, and whether an entry inherits it or overrides it is the
 * shape of the span against that tick rather than a word next to it. The brand
 * is a spine instead of a column repeating "Dell" eight times, and the index on
 * the left turns fourteen pages of scrolling into one.
 */
Views.catalog = async function (el) {
  const canCreate = Auth.canIam('catalog', 'create');
  const canUpdate = Auth.canIam('catalog', 'update');
  const canDelete = Auth.canIam('catalog', 'delete');
  const canEdit = canCreate || canUpdate || canDelete;
  // Everything the page shows is fetched up front, so the sections can be laid
  // out in the order a person needs them rather than the order they load.
  const canCompanies = Auth.canIam('settings', 'manage');
  const [items, lifecycles, locData, specs, departments, providerCategories, contractCategories, companies] =
    await Promise.all([
      api('/catalog'),
      api('/catalog/lifecycles').catch(() => ({})),
      api('/catalog/locations').catch(() => ({ locations: [], defaultLocation: null })),
      api('/catalog/specs').catch(() => ({ cpu: [], ram: [], storage: [] })),
      api('/catalog/departments').catch(() => []),
      api('/catalog/provider-categories').catch(() => AppConfig.providerCategories || []),
      api('/catalog/contract-categories').catch(() => AppConfig.contractCategories || []),
      canCompanies ? api('/companies?counts=1').catch(() => []) : Promise.resolve([]),
    ]);
  const cats = [...new Set(items.map((c) => c.category))];
  const lcCats = Object.keys(lifecycles).filter((k) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k));

  // Ticket categories are managed here too (they feed the ticket forms). Only a
  // ticket manager sees this section — and it sits at the END: this page is
  // about products, and ticket categories are a tenant, not the headline.
  const canTicketCats = Auth.canIam('ticket', 'manage');
  const ticketCats = canTicketCats ? await api('/tickets/categories/manage').catch(() => []) : [];

  const catDefault = (cat) => ((AppConfig.lifecycles && AppConfig.lifecycles[cat] != null)
    ? Number(AppConfig.lifecycles[cat]) : null);
  const monthsOf = (c) => (c.lifecycleMonths != null ? Number(c.lifecycleMonths) : catDefault(c.category));

  // One scale for the whole page — that is what makes the spans comparable at
  // all. Rounded up to the next year so the axis lands on a whole number.
  const longest = Math.max(24, ...items.map((c) => monthsOf(c) || 0).filter(Number.isFinite));
  const SCALE = Math.ceil(longest / 12) * 12;
  const pct = (m) => Math.max(0, Math.min(100, (Number(m) / SCALE) * 100));

  /**
   * A lifespan, drawn AND set as a length.
   *
   * A native range input under the paint: draggable, reachable from the keyboard
   * and announced to a screen reader — none of which a div with a mousedown
   * handler would be. The fill runs to the value; the tick stands where the
   * category's default is, so an inherited figure parks the handle exactly on it
   * and an override visibly pulls away from it.
   */
  const spanSet = ({ value, tick, id, kind, label, disabled }) => {
    const own = Number.isFinite(value) ? value : null;
    const eff = own != null ? own : (Number.isFinite(tick) ? tick : null);
    const differs = own != null && Number.isFinite(tick) && own !== tick;
    const cls = ['span-set', eff == null ? 'is-none' : '', differs ? 'is-own' : '',
      Number.isFinite(tick) ? '' : 'no-tick'].filter(Boolean).join(' ');
    return `<span class="${cls}" style="--pct:${pct(eff || 0).toFixed(2)}%;--tick:${pct(tick || 0).toFixed(2)}%">
        <input type="range" min="1" max="${SCALE}" step="1" value="${eff || 0}"
          data-span="${esc(kind)}" data-for="${esc(id)}"${disabled ? ' disabled' : ''}
          aria-label="${esc(label)}">
      </span>`;
  };

  const row = (c) => {
    const own = c.lifecycleMonths != null ? Number(c.lifecycleMonths) : null;
    const def = catDefault(c.category);
    const eff = own != null ? own : def;
    const used = Number(c.inUse) || 0;
    const name = `${c.brand} ${c.model}`;
    return `<div class="cat-row" data-find="${esc((name + ' ' + c.category).toLowerCase())}">
      <span class="cat-model" title="${esc(name)}">${esc(c.model)}</span>
      <span class="cat-used${used ? '' : ' is-zero'}" data-unit="${esc(t('cat.unit'))}" title="${esc(used ? t('cat.inUseTitle').replace('{n}', used) : t('cat.unusedTitle'))}">${used || '—'}</span>
      ${spanSet({ value: own, tick: def, id: c.id, kind: 'model', disabled: !canUpdate, label: `${t('cat.colLifecycle')} — ${name}` })}
      <span class="cat-months">
        ${canUpdate
    ? `<input type="number" class="cat-lc" data-lc="${esc(c.id)}" min="1" max="240" inputmode="numeric"
             value="${own != null ? esc(String(own)) : ''}" placeholder="${def != null ? esc(String(def)) : '—'}"
             aria-label="${esc(t('cat.colLifecycle'))} — ${esc(name)}">`
    : `<span class="cat-lc-static">${Number.isFinite(eff) ? esc(String(eff)) : '—'}</span>`}
        <span class="cat-mo">${esc(t('cat.mo'))}</span>
      </span>
      <span class="cat-rowend">${canDelete ? `<button class="cat-del" data-del="${esc(c.id)}" title="${esc(t('cat.delete'))}" aria-label="${esc(t('cat.delete'))} ${esc(name)}"><span class="ms ms-sm">delete</span></button>` : ''}</span>
    </div>`;
  };

  const group = (cat) => {
    const mine = items.filter((c) => c.category === cat);
    const brands = [...new Set(mine.map((c) => c.brand))].sort((a, b) => a.localeCompare(b, 'tr'));
    const def = catDefault(cat);
    return `<section class="cat-group" id="cat-g-${esc(cat.replace(/\W+/g, '-'))}" data-cat="${esc(cat)}">
      <header class="cat-group-head">
        <h3>${esc(cat)}</h3>
        <span class="cat-count">${mine.length} ${esc(t('cat.modelWord'))}</span>
        <span class="cat-def">${def != null ? esc(t('cat.catDefaultShort').replace('{n}', def)) : esc(t('cat.appDefault'))}</span>
      </header>
      ${brands.map((b) => `<div class="cat-brand-block">
        <div class="cat-brand">${esc(b)}</div>
        ${mine.filter((c) => c.brand === b).map(row).join('')}
      </div>`).join('')}
    </section>`;
  };

  /**
   * One chrome for every list on this page. Eight of them used to be eight
   * cards, which said they were eight unrelated features instead of one
   * vocabulary with eight parts.
   */
  const vocab = (id, title, { count = null, sub = '', action = '' } = {}) => `
    <section class="vocab" id="v-${id}" data-vocab="${esc(title)}">
      <div class="vocab-head">
        <h2>${esc(title)}</h2>
        ${count != null ? `<span class="vocab-n">${count}</span>` : ''}
        ${action}
      </div>
      ${sub ? `<p class="vocab-sub">${esc(sub)}</p>` : ''}
      <div class="vocab-body"></div>
    </section>`;

  el.innerHTML = `
    ${pageHead('cat.pageTitle', 'cat.pageSub', (canCreate || canUpdate) ? `
      ${canCreate || canUpdate ? `<button class="btn btn-outline" id="cat-import"><span class="ms">sync</span> ${esc(t('cat.importExisting'))}</button>` : ''}
      ${canCreate ? `<button class="btn btn-primary" id="cat-new"><span class="ms">add</span> ${esc(t('cat.addModel'))}</button>` : ''}
    ` : '')}
    <div class="cat-layout">
      <aside class="cat-index">
        <input type="search" id="cat-find" class="cat-find" placeholder="${esc(t('cat.findPh'))}" aria-label="${esc(t('cat.findPh'))}">
        <nav class="cat-nav" id="cat-nav" aria-label="${esc(t('cat.pageTitle'))}"></nav>
        <p class="cat-legend">
          <span class="cat-legend-key"><span class="cat-legend-track"><span class="cat-legend-span"></span><span class="cat-legend-tick"></span></span></span>
          ${esc(t('cat.legend').replace('{n}', SCALE))}
        </p>
      </aside>
      <div id="cat-sections"></div>
    </div>`;

  const sections = $('#cat-sections', el);
  const addSection = (id, title, opts, body) => {
    sections.insertAdjacentHTML('beforeend', vocab(id, title, opts));
    const host = sections.lastElementChild.querySelector('.vocab-body');
    if (body) host.innerHTML = body;
    return host;
  };

  // The category defaults come FIRST: every model measured below is measured
  // against one of these, so the page reads in the order the numbers depend on
  // each other rather than in the order the features were built.
  addSection('lifespans', t('cat.lifecycleTitle'), { sub: t('cat.lifecycleSub'), count: lcCats.length }, `
    <div class="lcx-grid">
      ${lcCats.map((cat) => {
    const m = Number(lifecycles[cat]);
    const on = m > 0;
    return `<div class="lcx-row${on ? '' : ' is-off'}">
          <span class="lcx-cat">${esc(cat)}</span>
          ${spanSet({ value: on ? m : 48, tick: null, id: cat, kind: 'cat', disabled: !canEdit || !on, label: `${t('cat.lifecycleTitle')} — ${cat}` })}
          <span class="cat-months">
            <input type="number" class="cat-lc" min="1" max="240" data-lc-cat="${esc(cat)}" inputmode="numeric"
              value="${on ? m : 48}"${(canEdit && on) ? '' : ' disabled'} aria-label="${esc(cat)} ${esc(t('cat.mo'))}">
            <span class="cat-mo">${esc(t('cat.mo'))}</span>
          </span>
          <label class="lcx-eol"><input type="checkbox" data-lc-cat-on="${esc(cat)}"${on ? ' checked' : ''}${canEdit ? '' : ' disabled'}> EOL</label>
        </div>`;
  }).join('')}
    </div>
    ${canEdit ? `<button class="btn btn-primary btn-sm lcx-save" id="lc-save">${esc(t('cat.saveLifecycles'))}</button>` : ''}`);

  addSection('models', t('cat.modelsTitle'), { count: items.length, sub: t('cat.modelsSub') },
    items.length === 0
      ? `<div class="cat-empty"><p>${esc(t('cat.emptyHint'))}</p>
           ${canCreate ? `<button class="btn btn-primary" id="cat-new-empty"><span class="ms">add</span> ${esc(t('cat.addModel'))}</button>` : ''}</div>`
      : `${cats.map(group).join('')}<p class="cat-nohits" id="cat-nohits" hidden>${esc(t('cat.noHits'))}</p>`);

  // Search filters rows in place and hides a group that has nothing left, so the
  // index and the page keep the same shape instead of re-rendering under you.
  const find = $('#cat-find', el);
  find?.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let hits = 0;
    el.querySelectorAll('.cat-group').forEach((g) => {
      let shown = 0;
      g.querySelectorAll('.cat-row').forEach((r) => {
        const on = !q || r.dataset.find.includes(q);
        r.hidden = !on;
        if (on) shown += 1;
      });
      g.querySelectorAll('.cat-brand-block').forEach((b) => {
        b.hidden = ![...b.querySelectorAll('.cat-row')].some((r) => !r.hidden);
      });
      g.hidden = shown === 0;
      hits += shown;
    });
    const none = $('#cat-nohits', el);
    if (none) none.hidden = hits > 0;
  });

  el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = el.querySelector(`.cat-group[data-cat="${CSS.escape(a.dataset.jump)}"]`);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));

  if (canCreate) {
    // Existing brands per category — the brand field lists them so you reuse a
    // known brand (no "Dell" vs "dell" duplicates) and only type a new one via
    // "Other", which the POST below saves into the catalog for next time.
    const brandsByCat = {};
    items.forEach((c) => { (brandsByCat[c.category] = brandsByCat[c.category] || new Set()).add(c.brand); });
    const brandOpts = (cat) => [...(brandsByCat[cat] || [])].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b }));
    const otherLbl = t('cat.brandOther') || 'Other (type a new brand)…';

    const openNew = () => formModal({
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
    });
    // Two doors to the same form: the header button, and the one the empty state
    // offers — an empty screen is an invitation to act, not a shrug.
    $('#cat-new', el)?.addEventListener('click', openNew);
    $('#cat-new-empty', el)?.addEventListener('click', openNew);
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

  // Inline per-model lifespan edit → EOL for every asset of that brand/model.
  // The bar is already kept in step by the range wiring below; this is the save.
  el.querySelectorAll('.cat-lc[data-lc]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const val = inp.value.trim();
      try {
        await api('/catalog/' + inp.dataset.lc, { method: 'PUT', body: { lifecycleMonths: val === '' ? null : Number(val) } });
        toast(t('cat.lcSaved'), 'success');
      } catch (err) { toast(err.message, 'error'); Views.catalog(el); }
    });
  });

  /* ---- Companies (legal entities) ----
     A holding runs several entities under one install: each has its own staff,
     its own devices and its own letterhead on the zimmet form. Writes are gated
     on settings:manage, the same permission that guards company branding. */
  // The full records carry tax numbers, addresses and letterhead logos, so the
  // server only serves them to settings:manage. Don't render an empty card at
  // everyone else — the panel simply isn't theirs.
  const companyName = (id) => {
    const c = companies.find((x) => x.id === id);
    return c ? c.name : '';
  };
  if (canCompanies) addSection('companies', t('co.title'),
    { count: companies.length, sub: t('co.foot'),
      action: `<button class="btn btn-outline btn-sm" id="co-add"><span class="ms ms-sm">domain_add</span> ${esc(t('co.add'))}</button>` }, `
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>${esc(t('co.colName'))}</th>
          <th>${esc(t('co.colParent'))}</th>
          <th>${esc(t('co.colBranding'))}</th>
          <th>${esc(t('co.colUsage'))}</th>
          <th style="text-align:right"></th>
        </tr></thead>
        <tbody>
          ${companies.length === 0
            ? `<tr><td colspan="5" class="table-empty">${esc(t('co.empty'))}</td></tr>`
            : companies.map((c) => `
          <tr>
            <td>
              <div style="display:flex;align-items:center;gap:10px">
                ${c.logo
                  ? `<img src="${esc(c.logo)}" alt="" style="width:24px;height:24px;object-fit:contain;border-radius:4px">`
                  : `<span class="ms" style="color:var(--on-surface-variant)">domain</span>`}
                <span class="cell-title">${esc(c.name)}</span>
                ${c.isDefault ? `<span class="pill pill-indigo">${esc(t('cat.defaultPill'))}</span>` : ''}
                ${c.active === false ? `<span class="pill">${esc(t('co.inactive'))}</span>` : ''}
              </div>
              ${c.code ? `<div class="cell-sub mono">${esc(c.code)}</div>` : ''}
            </td>
            <td class="cell-sub">${esc(companyName(c.parentId) || '—')}</td>
            <td class="cell-sub">${esc(c.logo ? t('co.ownLogo') : t('co.inheritsLogo'))}</td>
            <td class="cell-sub">${esc(
              t('co.usage')
                .replace('{a}', c.assetCount)
                .replace('{e}', c.employeeCount)
            )}</td>
            <td class="actions">
              ${canCompanies ? `
                ${c.isDefault ? '' : `<button class="btn btn-outline btn-sm" data-co-default="${esc(c.id)}">${esc(t('cat.setDefault'))}</button>`}
                <button class="btn btn-outline btn-sm" data-co-edit="${esc(c.id)}">${esc(t('common.edit'))}</button>
                ${c.isDefault ? '' : `<button class="btn btn-outline btn-sm" data-co-del="${esc(c.id)}">${esc(t('cat.delete'))}</button>`}
              ` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`);

  if (canCompanies) bindCompanyCard(el, companies);

  /* ---- Office Locations (stored in settings, drives asset form dropdown) ---- */
  addSection('locations', t('cat.locations'),
    { count: locData.locations.length, sub: t('cat.locationsSub'),
      action: canEdit ? `<button class="btn btn-outline btn-sm" id="loc-add"><span class="ms ms-sm">add_location_alt</span> ${esc(t('cat.addLocation'))}</button>` : '' }, `
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
      </table></div>`);

  /* ---- Hardware spec lists (cpu / ram / storage) ---- */
  // Three lists of the same kind of thing, so they sit side by side as words
  // rather than as three tables — what matters is which values exist, not rows.
  const specLabel = { cpu: t('cat.specCpu'), ram: t('cat.specRam'), storage: t('cat.specStorage') };
  addSection('specs', t('cat.specLists'), { sub: t('cat.specListsSub') }, `
      <div class="vocab-cols">
        ${['cpu', 'ram', 'storage'].map((type) => `
        <div>
          <div class="vocab-col-head">
            <h3>${esc(specLabel[type])}</h3>
            <span class="vocab-n">${specs[type].length}</span>
            ${canEdit ? `<button class="btn btn-outline btn-sm" data-addspec="${type}" style="margin-left:auto" aria-label="${esc(specLabel[type])} — ${esc(t('cat.add'))}"><span class="ms ms-sm">add</span></button>` : ''}
          </div>
          <div class="vocab-words">
            ${specs[type].length === 0 ? `<span class="vocab-empty">${esc(t('cat.noneYet'))}</span>` : ''}
            ${specs[type].map((v) => `<span class="vocab-word">${esc(v)}
              ${canEdit ? `<button type="button" data-delspec="${type}" data-val="${esc(v)}" title="${esc(t('cat.delete'))}" aria-label="${esc(t('cat.delete'))} ${esc(v)}"><span class="ms ms-sm">close</span></button>` : ''}</span>`).join('')}
          </div>
        </div>`).join('')}
      </div>`);

  if (canEdit) {
    el.querySelectorAll('[data-lc-cat-on]').forEach((c) => c.addEventListener('change', () => {
      const row = c.closest('.lcx-row');
      const inp = el.querySelector(`[data-lc-cat="${CSS.escape(c.dataset.lcCatOn)}"]`);
      if (inp) inp.disabled = !c.checked;
      const range = row && row.querySelector('input[type="range"]');
      if (range) range.disabled = !c.checked;
      if (row) row.classList.toggle('is-off', !c.checked);
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


  /* ---- the word lists ----
     Ticket categories, departments, supplier and contract categories are the
     same kind of thing — a set of allowed words with no properties of their own
     — so they get one treatment, one way to add and one way to remove, and they
     sit together instead of each owning a card. */
  const wordList = (list, delAttr, emptyText) => `
    <div class="vocab-words">
      ${list.length === 0 ? `<span class="vocab-empty">${esc(emptyText)}</span>` : ''}
      ${list.map((d) => `<span class="vocab-word">${esc(d)}
        ${canEdit ? `<button type="button" ${delAttr}="${esc(d)}" title="${esc(t('cat.delete'))}" aria-label="${esc(t('cat.delete'))} ${esc(d)}"><span class="ms ms-sm">close</span></button>` : ''}</span>`).join('')}
    </div>`;

  if (canTicketCats) {
    const tcList = Array.isArray(ticketCats) ? ticketCats : [];
    // Saved on the spot, like every other list here. This one used to collect
    // edits behind its own Save button, so one list behaved unlike the three
    // under it and a half-finished edit was lost by navigating away.
    const saveTicketCats = async (next, done) => {
      try {
        await api('/tickets/categories/manage', { method: 'PUT', body: { items: next } });
        toast(done, 'success');
        Views.catalog(el);
      } catch (err) { toast(err.message, 'error'); }
    };
    addSection('ticket-cats', t('tk.catManageTitle'),
      { count: tcList.length, sub: t('tk.catManageHint'),
        action: canEdit ? `<button class="btn btn-outline btn-sm" id="tk-cat-add"><span class="ms ms-sm">add</span> ${esc(t('tk.catAdd'))}</button>` : '' },
      wordList(tcList, 'data-deltcat', t('cat.noCategories')));

    $('#tk-cat-add', el)?.addEventListener('click', () => formModal({
      title: t('tk.catAdd'),
      fields: [{ name: 'name', label: t('tk.catManageTitle'), required: true, full: true }],
      submitLabel: t('tk.catAdd'),
      async onSubmit(d2) {
        const name = String(d2.name || '').trim();
        if (!name || tcList.some((c) => c.toLowerCase() === name.toLowerCase())) return;
        await saveTicketCats([...tcList, name], t('cat.addedWord').replace('{w}', name));
      },
    }));
    el.querySelector('#v-ticket-cats')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-deltcat]');
      if (!b) return;
      saveTicketCats(tcList.filter((c) => c !== b.dataset.deltcat),
        t('cat.removedWord').replace('{w}', b.dataset.deltcat));
    });
  }


  addSection('departments', t('cat.departments'),
    { count: departments.length, sub: t('cat.departmentsFoot'),
      action: canEdit ? `<button class="btn btn-outline btn-sm" id="dept-add"><span class="ms ms-sm">add</span> ${esc(t('cat.addDepartment'))}</button>` : '' },
    wordList(departments, 'data-deldept', t('cat.noDepartments')));

  addSection('supplier-cats', t('cat.providerCategories'),
    { count: providerCategories.length, sub: t('cat.providerCatFoot'),
      action: canEdit ? `<button class="btn btn-outline btn-sm" id="pcat-add"><span class="ms ms-sm">add</span> ${esc(t('cat.add'))}</button>` : '' },
    wordList(providerCategories, 'data-delpcat', t('cat.noCategories')));

  addSection('contract-cats', t('cat.contractCategories'),
    { count: contractCategories.length, sub: t('cat.contractCatFoot'),
      action: canEdit ? `<button class="btn btn-outline btn-sm" id="ccat-add"><span class="ms ms-sm">add</span> ${esc(t('cat.add'))}</button>` : '' },
    wordList(contractCategories, 'data-delccat', t('cat.noCategories')));

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

  /* ---- the index, built from the sections that are actually here ----
     Permissions decide which sections exist, so the rail is read off the page
     rather than written twice and left to drift. */
  const nav = $('#cat-nav', el);
  if (nav) {
    nav.innerHTML = [...sections.querySelectorAll('.vocab')].map((sec) => {
      const title = sec.dataset.vocab;
      const n = sec.querySelector('.vocab-n');
      const subs = sec.id === 'v-models'
        ? cats.map((c) => `<a href="#cat-g-${esc(c.replace(/\W+/g, '-'))}" class="is-sub" data-jump="${esc(c)}">
             <span>${esc(c)}</span><span class="cat-nav-n">${items.filter((x) => x.category === c).length}</span></a>`).join('')
        : '';
      return `<a href="#${sec.id}" data-jump-sec="${sec.id}">
          <span>${esc(title)}</span>${n ? `<span class="cat-nav-n">${esc(n.textContent)}</span>` : ''}
        </a>${subs}`;
    }).join('');
  }

  const goTo = (target) => target?.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
  });
  el.querySelectorAll('[data-jump-sec]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); goTo(el.querySelector('#' + a.dataset.jumpSec));
  }));
  el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); goTo(el.querySelector(`.cat-group[data-cat="${CSS.escape(a.dataset.jump)}"]`));
  }));

  /* ---- dragging a lifespan ----
     The bar is the control, so grabbing it changes the number and the number
     changes the bar. Dragging repaints live; the save happens on release, which
     is what `change` means for a range input — otherwise a single drag would
     fire a request for every pixel crossed. */
  const paint = (set, months, tick) => {
    set.style.setProperty('--pct', `${Math.max(0, Math.min(100, (months / SCALE) * 100)).toFixed(2)}%`);
    set.classList.toggle('is-own', Number.isFinite(tick) && months !== tick);
    set.classList.remove('is-none');
  };
  el.querySelectorAll('.span-set input[type="range"]').forEach((range) => {
    const set = range.closest('.span-set');
    const row = range.closest('.cat-row, .lcx-row');
    const num = row && row.querySelector('input[type="number"]');
    const tickPct = parseFloat(set.style.getPropertyValue('--tick')) || 0;
    const tick = Math.round((tickPct / 100) * SCALE) || null;
    range.addEventListener('input', () => {
      const m = Number(range.value);
      paint(set, m, tick);
      if (num) num.value = String(m);
    });
    range.addEventListener('change', () => {
      if (num) num.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Typing a number moves the handle, so the two are never out of step.
    num?.addEventListener('input', () => {
      const m = num.value.trim() === '' ? (Number(num.placeholder) || 0) : Number(num.value);
      if (!Number.isFinite(m)) return;
      range.value = String(Math.max(1, Math.min(SCALE, m)));
      paint(set, m, tick);
    });
  });

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

/* ---- Companies: add / edit / default / delete ---- */

/**
 * The company form. Every branding field is optional: left blank, the entity
 * inherits the workspace values from Settings, which is what keeps a
 * single-company install working exactly as it did before companies existed.
 */
function companyFormModal(el, existing, companies) {
  const isEdit = !!existing;
  // Held outside the form because formModal has no file control — the picker
  // writes the data URL here and onSubmit reads it.
  let pendingLogo;

  const parentOptions = [{ value: '', label: t('co.noParent') }]
    .concat(companies
      .filter((c) => !existing || c.id !== existing.id)
      .map((c) => ({ value: c.id, label: c.name })));

  formModal({
    title: isEdit ? 'co.editTitle' : 'co.addTitle',
    wide: true,
    submitLabel: 'common.save',
    fields: [
      { name: 'name', label: t('co.fName'), required: true, value: existing?.name || '' },
      { name: 'code', label: t('co.fCode'), value: existing?.code || '', placeholder: 'ACME' },
      { name: 'legalName', label: t('co.fLegalName'), full: true, value: existing?.legalName || '' },
      { name: 'parentId', label: t('co.fParent'), type: 'select', options: parentOptions, value: existing?.parentId || '' },
      { name: 'taxOffice', label: t('co.fTaxOffice'), value: existing?.taxOffice || '' },
      { name: 'taxNo', label: t('co.fTaxNo'), value: existing?.taxNo || '' },
      { name: 'email', label: t('co.fEmail'), value: existing?.email || '' },
      { name: 'phone', label: t('co.fPhone'), value: existing?.phone || '' },
      { name: 'address', label: t('co.fAddress'), type: 'textarea', full: true, value: existing?.address || '' },
      {
        type: 'html', full: true, label: t('co.fLogo'),
        html: `
          <div style="display:flex;align-items:center;gap:12px">
            <div id="co-logo-preview" style="width:44px;height:44px;border-radius:8px;border:1px solid var(--outline-variant);
                 display:flex;align-items:center;justify-content:center;overflow:hidden">
              ${existing?.logo
                ? `<img src="${esc(existing.logo)}" alt="" style="max-width:100%;max-height:100%">`
                : `<span class="ms" style="color:var(--on-surface-variant)">domain</span>`}
            </div>
            <input type="file" id="co-logo-file" accept="image/png,image/jpeg,image/svg+xml" class="hidden">
            <button type="button" class="btn btn-outline btn-sm" id="co-logo-pick">${esc(t('co.pickLogo'))}</button>
            <button type="button" class="btn btn-outline btn-sm" id="co-logo-clear">${esc(t('co.clearLogo'))}</button>
          </div>
          <div class="ob-hint">${esc(t('co.logoHint'))}</div>`,
      },
      {
        name: 'handoverTerms', label: t('co.fTerms'), type: 'textarea', full: true,
        value: existing?.handoverTerms || '', placeholder: t('co.termsPh'),
      },
      ...(isEdit && !existing.isDefault
        ? [{ name: 'active', label: t('co.fActive'), type: 'checkbox', full: true, value: existing.active !== false }]
        : []),
    ],
    onMount(overlay) {
      const fileEl = $('#co-logo-file', overlay);
      $('#co-logo-pick', overlay).addEventListener('click', () => fileEl.click());
      $('#co-logo-clear', overlay).addEventListener('click', () => {
        pendingLogo = null;
        $('#co-logo-preview', overlay).innerHTML = `<span class="ms" style="color:var(--on-surface-variant)">domain</span>`;
      });
      fileEl.addEventListener('change', () => {
        const file = fileEl.files && fileEl.files[0];
        if (!file) return;
        // The logo is stored inline as a data URL and embedded in every PDF, so
        // an oversized file bloats each generated document, not just this row.
        if (file.size > 300 * 1024) {
          toast(t('co.logoTooBig'), 'error');
          fileEl.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          pendingLogo = String(reader.result);
          $('#co-logo-preview', overlay).innerHTML = `<img src="${esc(pendingLogo)}" alt="" style="max-width:100%;max-height:100%">`;
        };
        reader.readAsDataURL(file);
      });
    },
    async onSubmit(d) {
      const body = {
        name: d.name,
        code: d.code || null,
        legalName: d.legalName || null,
        parentId: d.parentId || null,
        taxOffice: d.taxOffice || null,
        taxNo: d.taxNo || null,
        email: d.email || null,
        phone: d.phone || null,
        address: d.address || null,
        handoverTerms: d.handoverTerms || null,
      };
      if (pendingLogo !== undefined) body.logo = pendingLogo;
      if ('active' in d) body.active = !!d.active;

      if (isEdit) await api('/companies/' + encodeURIComponent(existing.id), { method: 'PATCH', body });
      else await api('/companies', { method: 'POST', body });
      Companies.invalidate();
      toast(t(isEdit ? 'co.saved' : 'co.created').replace('{name}', d.name), 'success');
      Views.catalog(el);
    },
  });
}

function bindCompanyCard(el, companies) {
  const byId = (id) => companies.find((c) => c.id === id);

  $('#co-add', el)?.addEventListener('click', () => companyFormModal(el, null, companies));

  // The section, not a card: the companies list is one vocabulary among eight.
  $('#v-companies', el)?.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.coEdit) {
        companyFormModal(el, byId(b.dataset.coEdit), companies);
      } else if (b.dataset.coDefault) {
        await api('/companies/' + encodeURIComponent(b.dataset.coDefault) + '/default', { method: 'PUT' });
        Companies.invalidate();
        toast(t('co.defaultSet').replace('{name}', byId(b.dataset.coDefault)?.name || ''), 'success');
        Views.catalog(el);
      } else if (b.dataset.coDel) {
        const c = byId(b.dataset.coDel);
        formModal({
          title: 'co.delTitle',
          submitLabel: 'common.delete',
          fields: [{
            type: 'html', full: true,
            html: `<p class="cell-sub">${esc(t('co.delConfirm').replace('{name}', c?.name || ''))}</p>`,
          }],
          async onSubmit() {
            // The server refuses while the company still owns anything — that
            // message is the useful one, so let it through unchanged.
            await api('/companies/' + encodeURIComponent(c.id), { method: 'DELETE' });
            Companies.invalidate();
            toast(t('co.deleted').replace('{name}', c.name), 'success');
            Views.catalog(el);
          },
        });
      }
    } catch (err) { toast(err.message, 'error'); }
  });
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
  'by-company': 'asset',
  'cross-company': 'asset',
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

const COMPANY_ONLY_REPORTS = new Set(['by-company', 'cross-company']);

function visibleReportDefs() {
  // A single-company install has nothing to compare, so those two reports would
  // only ever print one row and an empty list.
  const multi = repMultiCompany();
  return REPORT_DEFS.filter((r) => canRunReport(r.id) && (multi || !COMPANY_ONLY_REPORTS.has(r.id)));
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
  // ---- Companies (holding installs only) ----
  { id: 'by-company', group: 'Companies', icon: 'domain', tone: 'indigo', title: 'Inventory by Company',
    desc: 'What each group company owns — people, devices and their status split.' },
  { id: 'cross-company', group: 'Companies', icon: 'swap_horiz', tone: 'amber', title: 'Cross-Company Assignments',
    desc: 'Devices held by an employee of a different group company than the owner.' },
  // ---- Consumables ----
  { id: 'consumables', group: 'Consumables', icon: 'inventory_2', tone: 'blue', title: 'Consumables Stock',
    desc: 'Stock levels vs minimum alert levels with low-stock flags.' },
  { id: 'low-stock', group: 'Consumables', icon: 'production_quantity_limits', tone: 'rose', title: 'Low-Stock Consumables',
    desc: 'Only items at or below their minimum level — the reorder list.' },
];

const REPORT_MONTH_MS = 30.44 * 86400000;
const asgName = (x) => (x.currentEmployee ? x.currentEmployee.fullName : '');

/* ---- Company scope (holding installs) ----
   One selector on the Reports page scopes every preset report, so a group with
   several entities can pull "Acme only" numbers without hand-filtering a CSV.
   Empty means every company. On a single-company install none of this shows:
   the extra column and the filter would be a column of one repeated name. */
let reportCompanyId = '';

function setReportCompany(id) { reportCompanyId = id || ''; }
function getReportCompany() { return reportCompanyId; }

/** True when the Company column and filter are worth showing at all. */
function repMultiCompany() {
  return typeof Companies !== 'undefined' && Companies.isMulti();
}

/** Append the active company scope to a report's API call. */
function repQ(path) {
  if (!reportCompanyId) return path;
  return path + (path.includes('?') ? '&' : '?') + 'companyId=' + encodeURIComponent(reportCompanyId);
}

/** Column header list with the Company column appended when it earns its place. */
const withCo = (cols) => (repMultiCompany() ? [...cols, 'Company'] : cols);
/** Matching row tail. */
const rowCo = (row, name) => (repMultiCompany() ? [...row, name || '—'] : row);

/** The company scope, spelled out for a report summary line. */
function repScopeNote() {
  if (!reportCompanyId || typeof Companies === 'undefined') return '';
  const name = Companies.nameOf(reportCompanyId);
  return name ? ` · ${name}` : '';
}

/* Each builder returns { cols, rows, summary } — all from existing endpoints. */
const REPORT_BUILDERS = {
  inventory: async () => {
    const { items } = await api(repQ('/assets?limit=2000'));
    return {
      cols: withCo(['Asset Tag', 'Category', 'Brand', 'Model', 'Serial No', 'MAC', 'Status', 'Assigned To', 'Location', 'Purchase Date']),
      rows: items.map((x) => rowCo([x.assetTag, x.category, x.brand, x.model, x.serialNumber,
        x.macEthernet || x.macWifi || '', x.status, asgName(x), x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : ''], x.companyName)),
      summary: t('rep.sum.inventory')
        .replace('{n}', items.length)
        .replace('{a}', items.filter((x) => x.status === 'Assigned').length)
        .replace('{s}', items.filter((x) => x.status === 'In Stock').length)
        .replace('{r}', items.filter((x) => x.status === 'In Repair').length)
        .replace('{c}', items.filter((x) => x.status === 'Scrap').length),
    };
  },

  'by-category': async () => {
    const { items } = await api(repQ('/assets?limit=2000'));
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
    const { items } = await api(repQ('/assets?limit=2000'));
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
    const { items } = await api(repQ('/assets?limit=2000'));
    const total = items.length || 1;
    const rows = ['In Stock', 'Assigned', 'In Repair', 'Scrap'].map((s) => {
      const n = items.filter((x) => x.status === s).length;
      return [s, n, Math.round((n / total) * 100) + '%'];
    });
    return { cols: ['Status', 'Count', '% of Fleet'], rows, summary: t('rep.sum.total').replace('{n}', items.length) };
  },

  'in-stock': async () => {
    const { items } = await api(repQ('/assets?status=In Stock&limit=2000'));
    return { cols: withCo(['Asset Tag', 'Category', 'Brand', 'Model', 'Serial No', 'Location', 'Purchase Date']),
      rows: items.map((x) => rowCo([x.assetTag, x.category, x.brand, x.model, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : ''], x.companyName)),
      summary: t('rep.sum.inStock').replace('{n}', items.length) };
  },

  eol: async () => {
    const { items } = await api(repQ('/assets?limit=2000'));
    const rows = items
      .filter((x) => x.status !== 'Scrap' && x.purchaseDate)
      .map((x) => ({ x, l: lifecycleInfo(x) }))
      .filter((o) => o.l.eol && o.l.pct >= 90)
      .sort((a, b) => b.l.pct - a.l.pct)
      .map(({ x, l }) => rowCo([x.assetTag, x.category, `${x.brand} ${x.model}`, asgName(x),
        fmtDate(x.purchaseDate), fmtDate(l.eol), Math.min(l.pct, 100) + '%', l.overdue ? 'REPLACE NOW' : 'Due soon'], x.companyName));
    const overdue = rows.filter((r) => r[7] === 'REPLACE NOW').length;
    return { cols: withCo(['Asset Tag', 'Category', 'Brand / Model', 'Assigned To', 'Purchase Date', 'EOL Date', 'Elapsed', 'State']), rows,
      summary: t('rep.sum.eol').replace('{n}', rows.length).replace('{o}', overdue) };
  },

  aging: async () => {
    const { items } = await api(repQ('/assets?limit=2000'));
    const rows = items.filter((x) => x.purchaseDate)
      .map((x) => ({ x, age: Math.floor((Date.now() - new Date(x.purchaseDate).getTime()) / REPORT_MONTH_MS) }))
      .sort((a, b) => b.age - a.age)
      .map(({ x, age }) => rowCo([x.assetTag, x.category, `${x.brand} ${x.model}`, fmtDate(x.purchaseDate), age, x.status, asgName(x)], x.companyName));
    return { cols: withCo(['Asset Tag', 'Category', 'Brand / Model', 'Purchase Date', 'Age (months)', 'Status', 'Assigned To']), rows,
      summary: t('rep.sum.aging').replace('{n}', rows.length) };
  },
  depreciation: async () => {
    const { items } = await api(repQ('/assets?limit=2000'));
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
        return rowCo([
          x.assetTag, x.category, `${x.brand} ${x.model}`,
          x.purchaseDate ? fmtDate(x.purchaseDate) : '—',
          fmtMoney(cost),
          x.salvageValue != null ? fmtMoney(x.salvageValue) : '—',
          x.bookValue != null ? fmtMoney(x.bookValue) : '—',
          x.depreciated != null ? fmtMoney(x.depreciated) : '—',
          x.depreciationPct != null ? `${x.depreciationPct}%` : '—',
          x.status, asgName(x),
        ], x.companyName);
      });
    return {
      cols: withCo(['Asset Tag', 'Category', 'Brand / Model', 'Purchase Date', 'Purchase Cost',
        'Salvage', 'Book Value', 'Depreciated', 'Depreciated %', 'Status', 'Assigned To']),
      rows,
      summary: t('rep.sum.depreciation')
        .replace('{n}', rows.length)
        .replace('{p}', fmtMoney(totalCost))
        .replace('{b}', fmtMoney(totalBook))
        .replace('{d}', fmtMoney(totalCost - totalBook)),
    };
  },

  scrap: async () => {
    const { items } = await api(repQ('/assets?status=Scrap&limit=2000'));
    return { cols: withCo(['Asset Tag', 'Category', 'Brand / Model', 'Serial No', 'Location', 'Purchase Date']),
      rows: items.map((x) => rowCo([x.assetTag, x.category, `${x.brand} ${x.model}`, x.serialNumber, x.location || '',
        x.purchaseDate ? fmtDate(x.purchaseDate) : ''], x.companyName)),
      summary: t('rep.sum.scrap').replace('{n}', items.length) };
  },

  assignments: async () => {
    const [{ items }, employeesRes] = await Promise.all([
      api(repQ('/assets?status=Assigned&limit=2000')),
      api(repQ('/employees?limit=10000')),
    ]);
    const employees = employeeList(employeesRes).items;
    const dept = new Map(employees.map((p) => [p.id, p]));
    const multi = repMultiCompany();
    const rows = items
      .map((x) => {
        const p = x.currentEmployee ? dept.get(x.currentEmployee.id) : null;
        const base = [asgName(x), p ? p.department || '' : '', x.assetTag, `${x.brand} ${x.model}`, x.category, x.serialNumber];
        // Two companies, not one: who employs the holder, and who owns the
        // device. They differ on a cross-company handover and that difference
        // is exactly what this report exists to make visible.
        return multi
          ? [...base, p ? p.companyName || '—' : '—', x.companyName || '—']
          : base;
      })
      .sort((a2, b2) => a2[0].localeCompare(b2[0]));
    return {
      cols: repMultiCompany()
        ? ['Employee', 'Department', 'Asset Tag', 'Brand / Model', 'Category', 'Serial No', 'Employee Company', 'Owner Company']
        : ['Employee', 'Department', 'Asset Tag', 'Brand / Model', 'Category', 'Serial No'],
      rows,
      summary: t('rep.sumAssignedAcross')
        .replace('{n}', items.length)
        .replace('{m}', new Set(rows.map((r) => r[0])).size) + repScopeNote() };
  },

  employees: async () => {
    const emps = employeeList(await api(repQ('/employees?limit=10000'))).items;
    return { cols: withCo(['Employee', 'Email', 'Department', 'Title', 'Status', 'Assets Held']),
      rows: emps.map((p) => rowCo([p.fullName, p.email, p.department || '', p.title || '', p.status, p.activeAssetCount], p.companyName)),
      summary: t('rep.sum.employees').replace('{n}', emps.length).replace('{a}', emps.filter((p) => p.status === 'Active').length) };
  },

  'no-assets': async () => {
    const emps = employeeList(await api(repQ('/employees?limit=10000'))).items;
    const none = emps.filter((p) => p.status === 'Active' && !p.activeAssetCount);
    return { cols: withCo(['Employee', 'Email', 'Department', 'Title']),
      rows: none.map((p) => rowCo([p.fullName, p.email, p.department || '', p.title || ''], p.companyName)),
      summary: t('rep.sum.noAssets').replace('{n}', none.length) };
  },

  handovers: async () => {
    const hs = await api(repQ('/handovers?limit=200'));
    const rows = hs.slice().sort((a, b) => new Date(b.transactionDate) - new Date(a.transactionDate))
      .map((h) => rowCo([fmtDateTime(h.transactionDate), h.employeeName, (h.items || []).length,
        (h.items || []).map((i) => i.assetTag).join(', '), h.documentType],
      (h.companySnapshot && h.companySnapshot.companyName) || h.companyName));
    return { cols: withCo(['Date', 'Employee', '# Items', 'Asset Tags', 'Type']), rows,
      summary: t('rep.sum.handovers').replace('{n}', hs.length) + repScopeNote() };
  },

  /* One line per entity: what each company in the group actually owns. The
     answer to "how much hardware sits on Acme's books" without exporting the
     full inventory and pivoting it by hand. */
  'by-company': async () => {
    const [{ items }, employeesRes] = await Promise.all([
      api(repQ('/assets?limit=2000')),
      api(repQ('/employees?limit=10000')).catch(() => ({ items: [] })),
    ]);
    const emps = employeeList(employeesRes).items;
    const map = new Map();
    const bucket = (name) => {
      const k = name || '— Unassigned —';
      if (!map.has(k)) map.set(k, { total: 0, assigned: 0, stock: 0, repair: 0, scrap: 0, people: 0 });
      return map.get(k);
    };
    items.forEach((x) => {
      const c = bucket(x.companyName);
      c.total += 1;
      if (x.status === 'Assigned') c.assigned += 1;
      if (x.status === 'In Stock') c.stock += 1;
      if (x.status === 'In Repair') c.repair += 1;
      if (x.status === 'Scrap') c.scrap += 1;
    });
    emps.forEach((p) => { bucket(p.companyName).people += 1; });
    const rows = [...map.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, c]) => [name, c.people, c.total, c.assigned, c.stock, c.repair, c.scrap]);
    return {
      cols: ['Company', 'Employees', 'Total Assets', 'Assigned', 'In Stock', 'In Repair', 'Scrap'],
      rows,
      summary: t('rep.sum.byCompany')
        .replace('{n}', items.length)
        .replace('{c}', rows.length),
    };
  },

  /* Devices sitting with someone who works for a DIFFERENT group company. This
     is the list that quietly grows and causes the year-end argument about whose
     asset register a laptop belongs on. */
  'cross-company': async () => {
    const [{ items }, employeesRes] = await Promise.all([
      api(repQ('/assets?status=Assigned&limit=2000')),
      api('/employees?limit=10000'),
    ]);
    const byId = new Map(employeeList(employeesRes).items.map((p) => [p.id, p]));
    const rows = items
      .map((x) => ({ x, p: x.currentEmployee ? byId.get(x.currentEmployee.id) : null }))
      .filter(({ x, p }) => p && p.companyId && x.companyId && p.companyId !== x.companyId)
      .map(({ x, p }) => [asgName(x), p.companyName || '—', p.department || '',
        x.assetTag, `${x.brand} ${x.model}`, x.category, x.companyName || '—'])
      .sort((a, b) => String(a[6]).localeCompare(String(b[6])) || String(a[0]).localeCompare(String(b[0])));
    return {
      cols: ['Employee', 'Employee Company', 'Department', 'Asset Tag', 'Brand / Model', 'Category', 'Owner Company'],
      rows,
      summary: t('rep.sum.crossCompany')
        .replace('{n}', rows.length)
        .replace('{c}', new Set(rows.map((r) => r[6])).size),
    };
  },

  licenses: async () => {
    const lics = await api(repQ('/licenses'));
    return { cols: withCo(['Software', 'Vendor', 'Used Seats', 'Total Seats', 'Utilization %', 'Expires']),
      rows: lics.map((l) => rowCo([l.softwareName, l.vendor || '', l.usedSeats, l.totalSeats,
        Math.round((l.usedSeats / l.totalSeats) * 100), fmtDate(l.expirationDate)], l.companyName)),
      summary: t('rep.sum.licenses')
        .replace('{n}', lics.length)
        .replace('{u}', lics.reduce((s2, l) => s2 + l.usedSeats, 0))
        .replace('{t}', lics.reduce((s2, l) => s2 + l.totalSeats, 0)) };
  },

  'expiring-licenses': async () => {
    const lics = await api(repQ('/licenses'));
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
    const cons = await api(repQ('/consumables'));
    return { cols: withCo(['Item', 'Stock', 'Min. Level', 'Status']),
      rows: cons.map((c) => rowCo([c.itemName, c.totalStock, c.minimumStockAlertLevel, c.lowStock ? 'LOW STOCK' : 'OK'], c.companyName)),
      summary: t('rep.sum.consumables').replace('{n}', cons.length).replace('{b}', cons.filter((c) => c.lowStock).length) };
  },

  'low-stock': async () => {
    const cons = await api(repQ('/consumables'));
    const low = cons.filter((c) => c.lowStock);
    return { cols: withCo(['Item', 'Stock', 'Min. Level', 'Shortfall']),
      rows: low.map((c) => rowCo([c.itemName, c.totalStock, c.minimumStockAlertLevel, Math.max(0, c.minimumStockAlertLevel - c.totalStock)], c.companyName)),
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
    fetch: async () => (await api(repQ('/assets?limit=2000'))).items,
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
    fetch: async () => employeeList(await api(repQ('/employees?limit=10000'))).items,
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
    // Scoped to one entity → print under that entity's name. Unscoped, or on a
    // single-company install, the workspace branding still heads the page.
    const scoped = getReportCompany() && typeof Companies !== 'undefined'
      ? Companies.byId(getReportCompany())
      : null;
    const brandName = (scoped && scoped.name) || AppConfig.companyName || '';
    // A scoped company with no logo of its own inherits the group logo, exactly
    // like the zimmet form does.
    const brandLogo = scoped
      ? (Companies.logo(scoped.id) || AppConfig.companyLogo)
      : AppConfig.companyLogo;
    $('#print-root').innerHTML = `
      <div class="receipt receipt-v2 receipt-report">
        <header class="r-banner">
          <div class="r-banner-left">
            <div class="r-logo">${brandLogo
              ? `<img src="${esc(brandLogo)}" alt="">`
              : esc((brandName || 'A')[0].toUpperCase())}</div>
            <div><h1>${esc(brandName.toUpperCase())}</h1>
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
