/** Consumable service (postgres) — stock movements are atomic via row locks. */
const { query, withTransaction } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

async function listConsumables({ companyId } = {}) {
  const where = [];
  const params = [];
  if (companyId) {
    if (companyId === 'none') where.push('cs.company_id IS NULL');
    else if (!isUuid(companyId)) return [];
    else { params.push(companyId); where.push(`cs.company_id = $${params.length}`); }
  }
  const { rows } = await query(
    `SELECT cs.*, co.name AS company_name
       FROM consumables cs
       LEFT JOIN companies co ON co.id = cs.company_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY cs.item_name`,
    params
  );
  return rows.map((c) => ({
    id: c.id,
    itemName: c.item_name,
    totalStock: c.total_stock,
    minimumStockAlertLevel: c.minimum_stock_alert_level,
    companyId: c.company_id,
    companyName: c.company_name,
    createdAt: c.created_at,
    lowStock: c.total_stock <= c.minimum_stock_alert_level,
  }));
}

async function createConsumable({ itemName, totalStock = 0, minimumStockAlertLevel = 0, companyId }) {
  if (!itemName) throw HttpError.badRequest('itemName is required');
  if (companyId != null && companyId !== '' && !isUuid(companyId)) {
    throw HttpError.badRequest('companyId must be a company id');
  }
  let company = companyId || null;
  if (!company) {
    const fallback = await require('./companyService').getDefaultCompany().catch(() => null);
    company = fallback ? fallback.id : null;
  }
  const { rows } = await query(
    `INSERT INTO consumables (item_name, total_stock, minimum_stock_alert_level, company_id)
     VALUES ($1, $2, $3, $4) RETURNING id, item_name AS "itemName"`,
    [itemName, Number(totalStock) || 0, Number(minimumStockAlertLevel) || 0, company]
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

/** Edit an item's name, minimum-alert level, and/or set its absolute stock. */
async function updateConsumable(consumableId, body = {}) {
  if (!isUuid(consumableId)) throw HttpError.notFound(`Consumable ${consumableId} not found`);
  const set = [];
  const params = [consumableId];
  if (body.itemName !== undefined) {
    const name = String(body.itemName || '').trim();
    if (!name) throw HttpError.badRequest('itemName cannot be empty');
    params.push(name); set.push(`item_name = $${params.length}`);
  }
  if (body.minimumStockAlertLevel !== undefined) {
    const min = Number(body.minimumStockAlertLevel);
    if (!Number.isInteger(min) || min < 0) throw HttpError.badRequest('minimumStockAlertLevel must be a non-negative integer');
    params.push(min); set.push(`minimum_stock_alert_level = $${params.length}`);
  }
  if (body.totalStock !== undefined) {
    const total = Number(body.totalStock);
    if (!Number.isInteger(total) || total < 0) throw HttpError.badRequest('totalStock must be a non-negative integer');
    params.push(total); set.push(`total_stock = $${params.length}`);
  }
  if (!set.length) throw HttpError.badRequest('No updatable fields provided');

  const { rows } = await query(
    `UPDATE consumables SET ${set.join(', ')} WHERE id = $1
     RETURNING id, item_name AS "itemName", total_stock AS "totalStock",
               minimum_stock_alert_level AS "minimumStockAlertLevel"`,
    params
  );
  if (!rows[0]) throw HttpError.notFound(`Consumable ${consumableId} not found`);
  rows[0].lowStock = rows[0].totalStock <= rows[0].minimumStockAlertLevel;
  return rows[0];
}

async function deleteConsumable(consumableId) {
  if (!isUuid(consumableId)) throw HttpError.notFound(`Consumable ${consumableId} not found`);
  const { rows } = await query(
    'DELETE FROM consumables WHERE id = $1 RETURNING id, item_name AS "itemName"',
    [consumableId]
  );
  if (!rows[0]) throw HttpError.notFound(`Consumable ${consumableId} not found`);
  return { ...rows[0], deleted: true };
}

module.exports = { listConsumables, createConsumable, adjustStock, updateConsumable, deleteConsumable };
