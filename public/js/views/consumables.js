Views.consumables = async function (el) {
  const canEdit = Auth.can('canManageAssets');
  const items = await api('/consumables');

  el.innerHTML = `
    ${pageHead('Consumables', 'Track stock levels for toner, cables, and accessories.', canEdit ?
      `<button class="btn btn-primary" id="con-new"><span class="ms">add</span> New Item</button>` : '')}
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Item</th><th>Stock</th><th>Min. Level</th><th>Status</th><th style="text-align:right"></th></tr></thead>
      <tbody>
        ${items.length === 0 ? '<tr><td colspan="5" class="table-empty">No consumables.</td></tr>' :
          items.map((c) => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:12px">${iconChip('inventory_2', c.lowStock ? 'rose' : 'indigo')}
              <span class="cell-title">${esc(c.itemName)}</span></div></td>
            <td><strong>${c.totalStock}</strong></td>
            <td>${c.minimumStockAlertLevel}</td>
            <td>${c.lowStock ? '<span class="pill pill-rose">Low stock</span>' : '<span class="pill pill-emerald">OK</span>'}</td>
            <td class="actions">${canEdit ? `
              <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="-1">−1</button>
              <button class="btn btn-outline btn-sm" data-stock="${esc(c.id)}" data-delta="1">+1</button>
              <button class="btn btn-outline btn-sm" data-adjust="${esc(c.id)}">Adjust…</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table></div></div>`;

  if (canEdit) {
    $('#con-new', el).addEventListener('click', () => formModal({
      title: 'New Consumable',
      fields: [
        { name: 'itemName', label: 'Item name *', required: true, full: true },
        { name: 'totalStock', label: 'Initial stock', type: 'number', value: 0 },
        { name: 'minimumStockAlertLevel', label: 'Min. alert level', type: 'number', value: 0 },
      ],
      async onSubmit(d) {
        await api('/consumables', { method: 'POST', body: d });
        toast('Consumable created', 'success');
        Views.consumables(el);
      },
    }));
    bindView(el, async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.stock) {
        try {
          const r = await api(`/consumables/${b.dataset.stock}/stock`, { method: 'POST', body: { delta: Number(b.dataset.delta) } });
          toast(`${r.itemName}: ${r.totalStock} in stock`, 'success');
          Views.consumables(el);
        } catch (err) { toast(err.message, 'error'); }
      }
      if (b.dataset.adjust) {
        const c = items.find((x) => x.id === b.dataset.adjust);
        formModal({
          title: `Adjust stock — ${c.itemName}`,
          fields: [{ name: 'delta', label: 'Change (+ restock / − consume) *', type: 'number', required: true, full: true }],
          submitLabel: 'Apply',
          async onSubmit(d) {
            const r = await api(`/consumables/${c.id}/stock`, { method: 'POST', body: { delta: d.delta } });
            toast(`${r.itemName}: ${r.totalStock} in stock`, 'success');
            Views.consumables(el);
          },
        });
      }
    });
  }
};

/* ================================= USERS ================================= */
