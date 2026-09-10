/**
 * The store cupboard: toner, cables, adapters — things that get used up.
 *
 * A consumable's whole state is one relationship: how much is on the shelf
 * against how little we are willing to have. The old table printed that as two
 * numbers in two columns and then restated it a third time as a status pill,
 * which left the reader to do the arithmetic and told them nothing about
 * DEGREE — two toners against a threshold of four and six stands against eight
 * both read "low", though only the first needs ordering today.
 *
 * So stock is drawn against its own minimum, on a track where the minimum
 * always sits in the same place. Fourteen items with completely different
 * natural quantities — two toners, a hundred webcam covers — become directly
 * comparable as RISK, which is the only comparison this page is for. And what
 * is short comes first, so the top of the page is the shopping list.
 */
Views.consumables = async function (el) {
  const canCreate = Auth.canIam('consumable', 'create') || Auth.canIam('consumable', 'manage');
  const canUpdate = Auth.canIam('consumable', 'update') || Auth.canIam('consumable', 'manage');
  const canDelete = Auth.canIam('consumable', 'delete') || Auth.canIam('consumable', 'manage');
  const items = await api('/consumables');
  await Companies.load().catch(() => {});

  // The minimum sits at a fixed point on every track — that is what makes the
  // rows comparable. Above it the scale is compressed: the difference between
  // "twice the minimum" and "eight times" is not worth screen, while the
  // difference between "just under" and "just over" is the whole point.
  const MIN_AT = 38;
  const fillPct = (stock, min) => {
    if (!(min > 0)) return Math.min(100, stock > 0 ? MIN_AT : 0);
    const r = stock / min;
    return r <= 1 ? r * MIN_AT : Math.min(100, MIN_AT + ((r - 1) / 1.5) * (100 - MIN_AT));
  };

  const gauge = (c) => {
    const min = Number(c.minimumStockAlertLevel) || 0;
    const stock = Number(c.totalStock) || 0;
    const short = min > 0 && stock <= min;
    return `<span class="con-gauge${short ? ' is-short' : ''}${min > 0 ? '' : ' no-min'}"
        style="--fill:${fillPct(stock, min).toFixed(1)}%;--min:${MIN_AT}%"
        role="img" aria-label="${esc(min > 0
    ? t('con.gaugeLabel').replace('{n}', stock).replace('{m}', min)
    : t('con.gaugeNoMin').replace('{n}', stock))}"></span>`;
  };

  // The owning entity is only worth a line when it tells the rows apart. On a
  // single-entity install it was the same fourteen words down the page.
  const showCo = new Set(items.map((c) => c.companyId || '')).size > 1;

  const row = (c) => {
    const min = Number(c.minimumStockAlertLevel) || 0;
    const stock = Number(c.totalStock) || 0;
    const short = min > 0 && stock <= min;
    return `<div class="con-row${short ? ' is-short' : ''}" data-find="${esc(c.itemName.toLowerCase())}" data-id="${esc(c.id)}">
      <span class="con-name">${esc(c.itemName)}${showCo && c.companyName ? `<span class="con-co">${esc(c.companyName)}</span>` : ''}</span>
      ${gauge(c)}
      <span class="con-min">${min > 0 ? esc(t('con.minShort').replace('{n}', min)) : esc(t('con.noMin'))}</span>
      ${canUpdate ? `<span class="con-step">
        <button type="button" class="con-pm" data-stock="${esc(c.id)}" data-delta="-1"
          aria-label="${esc(t('con.tookOne'))} — ${esc(c.itemName)}"${stock <= 0 ? ' disabled' : ''}>−</button>
        <button type="button" class="con-count" data-adjust="${esc(c.id)}"
          aria-label="${esc(t('con.adjust'))} — ${esc(c.itemName)}">${stock}</button>
        <button type="button" class="con-pm" data-stock="${esc(c.id)}" data-delta="1"
          aria-label="${esc(t('con.addedOne'))} — ${esc(c.itemName)}">+</button>
      </span>` : `<span class="con-step"><span class="con-count is-static">${stock}</span></span>`}
      <span class="con-more">
        ${canUpdate ? `<button type="button" class="con-icon" data-edit="${esc(c.id)}" title="${esc(t('common.edit'))}" aria-label="${esc(t('common.edit'))} ${esc(c.itemName)}"><span class="ms ms-sm">edit</span></button>` : ''}
        ${canDelete ? `<button type="button" class="con-icon" data-del="${esc(c.id)}" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))} ${esc(c.itemName)}"><span class="ms ms-sm">delete</span></button>` : ''}
      </span>
    </div>`;
  };

  const byName = (a, b) => a.itemName.localeCompare(b.itemName, 'tr');
  const isShort = (c) => Number(c.minimumStockAlertLevel) > 0 && Number(c.totalStock) <= Number(c.minimumStockAlertLevel);
  // Shortest against its own threshold first: that is the order somebody orders in.
  const shortItems = items.filter(isShort)
    .sort((a, b) => (a.totalStock / a.minimumStockAlertLevel) - (b.totalStock / b.minimumStockAlertLevel));
  const restItems = items.filter((c) => !isShort(c)).sort(byName);

  el.innerHTML = `
    ${pageHead('con.pageTitle', 'con.pageSub', `
      <input type="search" id="con-find" class="con-find" placeholder="${esc(t('con.findPh'))}" aria-label="${esc(t('con.findPh'))}">
      ${canCreate ? `<button class="btn btn-primary" id="con-new"><span class="ms">add</span> ${esc(t('con.newItem'))}</button>` : ''}`)}
    ${items.length === 0 ? `
      <div class="card card-pad con-empty">
        <p>${esc(t('con.noItems'))}</p>
        ${canCreate ? `<button class="btn btn-primary" id="con-new-empty"><span class="ms">add</span> ${esc(t('con.newItem'))}</button>` : ''}
      </div>` : `
      ${shortItems.length ? `<section class="con-block is-short-block" id="con-short">
        <h2 class="con-h">${esc(t('con.orderTitle').replace('{n}', shortItems.length))}</h2>
        <p class="con-h-sub">${esc(t('con.orderSub'))}</p>
        <div class="con-list">${shortItems.map(row).join('')}</div>
      </section>` : `<p class="con-allgood">${esc(t('con.allStocked'))}</p>`}
      ${restItems.length ? `<section class="con-block">
        <h2 class="con-h">${esc(t('con.stockedTitle'))}</h2>
        <div class="con-list">${restItems.map(row).join('')}</div>
      </section>` : ''}
      <p class="con-nohits" id="con-nohits" hidden>${esc(t('con.noHits'))}</p>`}`;

  const find = $('#con-find', el);
  find?.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let hits = 0;
    el.querySelectorAll('.con-row').forEach((r) => {
      const on = !q || r.dataset.find.includes(q);
      r.hidden = !on;
      if (on) hits += 1;
    });
    el.querySelectorAll('.con-block').forEach((b) => {
      b.hidden = ![...b.querySelectorAll('.con-row')].some((r) => !r.hidden);
    });
    const none = $('#con-nohits', el);
    if (none) none.hidden = hits > 0;
    const good = el.querySelector('.con-allgood');
    if (good) good.hidden = !!q;
  });

  if (canCreate) {
    const openNew = () => formModal({
      title: t('con.newConsumable'),
      fields: [
        { name: 'itemName', label: `${t('con.itemName')} *`, required: true, full: true },
        { name: 'totalStock', label: t('con.initialStock'), type: 'number', value: 0 },
        { name: 'minimumStockAlertLevel', label: t('con.minAlert'), type: 'number', value: 0 },
        // Stock is kept per entity so each company's consumption reports alone.
        ...(Companies.isMulti() ? [{
          name: 'companyId', label: t('co.field'), type: 'select', full: true,
          value: Companies.defaultId() || '',
          options: [{ value: '', label: t('co.noCompany') },
            ...Companies.active().map((c) => ({ value: c.id, label: c.name }))],
        }] : []),
      ],
      async onSubmit(d) {
        await api('/consumables', { method: 'POST', body: d });
        toast(t('con.created'), 'success');
        Views.consumables(el);
      },
    });
    $('#con-new', el)?.addEventListener('click', openNew);
    $('#con-new-empty', el)?.addEventListener('click', openNew);
  }
  if (canUpdate || canDelete) {
    bindView(el, async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.edit) {
        const c = items.find((x) => x.id === b.dataset.edit);
        if (!c) return;
        formModal({
          title: 'con.editTitle',
          fields: [
            { name: 'itemName', label: `${t('con.itemName')} *`, required: true, full: true, value: c.itemName },
            { name: 'totalStock', label: t('con.colStock'), type: 'number', value: c.totalStock },
            { name: 'minimumStockAlertLevel', label: t('con.minAlert'), type: 'number', value: c.minimumStockAlertLevel },
          ],
          async onSubmit(d) {
            await api(`/consumables/${c.id}`, {
              method: 'PATCH',
              body: {
                itemName: d.itemName,
                totalStock: Number(d.totalStock),
                minimumStockAlertLevel: Number(d.minimumStockAlertLevel),
              },
            });
            toast(t('con.updated'), 'success');
            Views.consumables(el);
          },
        });
        return;
      }
      if (b.dataset.del) {
        const c = items.find((x) => x.id === b.dataset.del);
        if (!c) return;
        formModal({
          title: 'common.delete',
          submitLabel: 'common.delete',
          fields: [{ type: 'html', full: true, html: `<p class="cell-sub">${esc((t('con.deleteConfirm') || 'Delete “{name}”?').replace('{name}', c.itemName))}</p>` }],
          async onSubmit() {
            await api(`/consumables/${c.id}`, { method: 'DELETE' });
            toast(t('con.deleted'), 'success');
            Views.consumables(el);
          },
        });
        return;
      }
      if (b.dataset.stock) {
        try {
          const c = items.find((x) => x.id === b.dataset.stock);
          const r = await api(`/consumables/${b.dataset.stock}/stock`, { method: 'POST', body: { delta: Number(b.dataset.delta) } });
          toast(t('con.stockNow').replace('{name}', (c && c.itemName) || '').replace('{n}', r.totalStock), 'success');
          Views.consumables(el);
        } catch (err) { toast(err.message, 'error'); }
      }
      if (b.dataset.adjust) {
        const c = items.find((x) => x.id === b.dataset.adjust);
        formModal({
          title: (t('con.adjustTitle') || 'Adjust stock — {name}').replace('{name}', c.itemName),
          fields: [
            { name: 'delta', label: t('con.change'), type: 'number', required: true, value: 0 },
          ],
          async onSubmit(d) {
            const r = await api(`/consumables/${c.id}/stock`, { method: 'POST', body: { delta: Number(d.delta) } });
            toast(t('con.stockNow').replace('{name}', c.itemName).replace('{n}', r.totalStock), 'success');
            Views.consumables(el);
          },
        });
      }
    });
  }
};
