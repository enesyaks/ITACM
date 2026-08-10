Views.consumables = async function (el) {
  const canCreate = Auth.canIam('consumable', 'create') || Auth.canIam('consumable', 'manage');
  const canUpdate = Auth.canIam('consumable', 'update') || Auth.canIam('consumable', 'manage');
  const canDelete = Auth.canIam('consumable', 'delete') || Auth.canIam('consumable', 'manage');
  const items = await api('/consumables');

  const conRowActions = (c) => `${canUpdate ? `
      <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="-1">−1</button>
      <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="1">+1</button>
      <button class="btn btn-outline btn-sm" data-adjust="${esc(c.id)}">${esc(t('con.adjust'))}</button>
      <button class="btn btn-outline btn-sm" data-edit="${esc(c.id)}" title="${esc(t('common.edit'))}"><span class="ms">edit</span></button>` : ''}${canDelete ? `
      <button class="btn btn-outline btn-sm" data-del="${esc(c.id)}" title="${esc(t('common.delete'))}"><span class="ms">delete</span></button>` : ''}`;

  const conCols = columnPicker({
    storageKey: 'itacm_cols_consumables',
    onChange: () => { const s = $('#con-table', el); if (s) s.innerHTML = tableHtml(); },
    columns: [
      { key: 'item', label: t('con.colItem'), mandatory: true,
        render: (c) => `<div style="display:flex;align-items:center;gap:12px">${iconChip('inventory_2', c.lowStock ? 'rose' : 'indigo')}<span class="cell-title">${esc(c.itemName)}</span></div>`, csv: (c) => c.itemName },
      { key: 'stock', label: t('con.colStock'), render: (c) => `<strong>${c.totalStock}</strong>`, csv: (c) => String(c.totalStock) },
      { key: 'min', label: t('con.colMinLevel'), render: (c) => String(c.minimumStockAlertLevel), csv: (c) => String(c.minimumStockAlertLevel) },
      { key: 'status', label: t('common.status'), mandatory: true, render: (c) => c.lowStock ? `<span class="pill pill-rose">${esc(t('con.lowStock'))}</span>` : `<span class="pill pill-emerald">${esc(t('con.statusOk'))}</span>`, csv: (c) => c.lowStock ? 'low' : 'ok' },
    ],
  });

  const tableHtml = () => `<div class="table-wrap"><table class="data">
    <thead><tr>${conCols.headerCells()}<th style="text-align:right"></th></tr></thead>
    <tbody>
      ${items.length === 0 ? `<tr><td colspan="${conCols.visibleColumns().length + 1}" class="table-empty">${esc(t('con.noItems'))}</td></tr>` :
        items.map((c) => `<tr>${conCols.bodyCells(c)}<td class="actions">${conRowActions(c)}</td></tr>`).join('')}
    </tbody>
  </table></div>`;

  el.innerHTML = `
    ${pageHead('Consumables', 'Track stock levels for toner, cables, and accessories.', `
      <div style="display:flex;gap:10px;align-items:center">${conCols.gearHtml()}
      ${canCreate ? `<button class="btn btn-primary" id="con-new"><span class="ms">add</span> ${esc(t('con.newItem'))}</button>` : ''}</div>`)}
    <div class="card"><div id="con-table">${tableHtml()}</div></div>`;
  conCols.mountGear(el);
  if (canCreate) {
    $('#con-new', el).addEventListener('click', () => formModal({
      title: t('con.newConsumable'),
      fields: [
        { name: 'itemName', label: `${t('con.itemName')} *`, required: true, full: true },
        { name: 'totalStock', label: t('con.initialStock'), type: 'number', value: 0 },
        { name: 'minimumStockAlertLevel', label: t('con.minAlert'), type: 'number', value: 0 },
      ],
      async onSubmit(d) {
        await api('/consumables', { method: 'POST', body: d });
        toast(t('con.created'), 'success');
        Views.consumables(el);
      },
    }));
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
          const r = await api(`/consumables/${b.dataset.stock}/stock`, { method: 'POST', body: { delta: Number(b.dataset.delta) } });
          toast(`Stock → ${r.totalStock}`, 'success');
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
            toast(`Stock → ${r.totalStock}`, 'success');
            Views.consumables(el);
          },
        });
      }
    });
  }
};
