Views.consumables = async function (el) {
  const canCreate = Auth.canIam('consumable', 'create') || Auth.canIam('consumable', 'manage');
  const canUpdate = Auth.canIam('consumable', 'update') || Auth.canIam('consumable', 'manage');
  const items = await api('/consumables');

  el.innerHTML = `
    ${pageHead('Consumables', 'Track stock levels for toner, cables, and accessories.', canCreate ?
      `<button class="btn btn-primary" id="con-new"><span class="ms">add</span> ${esc(t('con.newItem'))}</button>` : '')}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>${esc(t('con.colItem'))}</th><th>${esc(t('con.colStock'))}</th><th>${esc(t('con.colMinLevel'))}</th><th>${esc(t('common.status'))}</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${items.length === 0 ? `<tr><td colspan="5" class="table-empty">${esc(t('con.noItems'))}</td></tr>` :
          items.map((c) => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:12px">${iconChip('inventory_2', c.lowStock ? 'rose' : 'indigo')}
              <span class="cell-title">${esc(c.itemName)}</span></div></td>
            <td><strong>${c.totalStock}</strong></td>
            <td>${c.minimumStockAlertLevel}</td>
            <td>${c.lowStock ? `<span class="pill pill-rose">${esc(t('con.lowStock'))}</span>` : `<span class="pill pill-emerald">${esc(t('con.statusOk'))}</span>`}</td>
            <td class="actions">${canUpdate ? `
              <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="-1">−1</button>
              <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="1">+1</button>
              <button class="btn btn-outline btn-sm" data-adjust="${esc(c.id)}">${esc(t('con.adjust'))}</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table></div></div>`;

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
  if (canUpdate) {
    bindView(el, async (e) => {
      const b = e.target.closest('button'); if (!b) return;
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
