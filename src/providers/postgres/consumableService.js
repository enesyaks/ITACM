/** Consumable service (postgres) — stock movements are atomic via row locks. */
const { query, withTransaction } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

async function listConsumables() {
  const { rows } = await query('SELECT * FROM consumables ORDER BY item_name');
  return rows.map((c) => ({
    id: c.id,
    itemName: c.item_name,
    totalStock: c.total_stock,
    minimumStockAlertLevel: c.minimum_stock_alert_level,
    createdAt: c.created_at,
    lowStock: c.total_stock <= c.minimum_stock_alert_level,
  }));
}

async function createConsumable({ itemName, totalStock = 0, minimumStockAlertLevel = 0 }) {
  if (!itemName) throw HttpError.badRequest('itemName is required');
  const { rows } = await query(
    `INSERT INTO consumables (item_name, total_stock, minimum_stock_alert_level)
     VALUES ($1, $2, $3) RETURNING id, item_name AS "itemName"`,
    [itemName, Number(totalStock) || 0, Number(minimumStockAlertLevel) || 0]
  );
  return rows[0];
}

async function adjustStock(consumableId, delta) {
  const change = Number(delta);
  if (!Number.isInteger(change) || change === 0) {
    throw HttpError.badRequest('delta must be a non-zero integer');
  }
  if (!isUuid(consumableId)) throw HttpError.notFound(`Consumable ${consumableId} not found`);

  return withTransaction(async (t) => {
    const { rows } = await t.query('SELECT * FROM consumables WHERE id = $1 FOR UPDATE', [consumableId]);
    const c = rows[0];
    if (!c) throw HttpError.notFound(`Consumable ${consumableId} not found`);

    const next = c.total_stock + change;
    if (next < 0) throw HttpError.conflict(`${c.item_name}: only ${c.total_stock} in stock, cannot remove ${-change}`);

    await t.query('UPDATE consumables SET total_stock = $2 WHERE id = $1', [consumableId, next]);
    return {
      id: consumableId,
      itemName: c.item_name,
      totalStock: next,
      lowStock: next <= c.minimum_stock_alert_level,
    };
  });
}

module.exports = { listConsumables, createConsumable, adjustStock };
