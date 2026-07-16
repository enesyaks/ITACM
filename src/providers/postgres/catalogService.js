/** Product catalog (postgres): brand/model lists that feed the asset form. */
const { query } = require('./pool');
const { mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

async function listCatalog() {
  const { rows } = await query('SELECT * FROM catalog_models ORDER BY category, brand, model');
  return mapRows(rows);
}

/** null (inherit) or an integer 1..240; anything else is rejected. */
function normalizeLifecycleMonths(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > 240) {
    throw HttpError.badRequest('lifecycleMonths must be an integer between 1 and 240 (or blank to inherit the category default)');
  }
  return m;
}

async function addCatalogEntry({ category, brand, model, lifecycleMonths }) {
  if (!category || !brand || !model) throw HttpError.badRequest('category, brand and model are required');
  const months = normalizeLifecycleMonths(lifecycleMonths);
  try {
    const { rows } = await query(
      `INSERT INTO catalog_models (category, brand, model, lifecycle_months) VALUES ($1, $2, $3, $4) RETURNING *`,
      [category.trim(), brand.trim(), model.trim(), months]
    );
    return mapRows(rows)[0];
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`${brand} ${model} already exists in ${category}`);
    throw err;
  }
}

/** Update a catalog model's lifecycle (months). Pass null/'' to clear (inherit). */
async function updateCatalogEntry(id, { lifecycleMonths }) {
  if (!isUuid(id)) throw HttpError.notFound('Catalog entry not found');
  const months = normalizeLifecycleMonths(lifecycleMonths);
  const { rows } = await query(
    `UPDATE catalog_models SET lifecycle_months = $2 WHERE id = $1 RETURNING *`,
    [id, months]
  );
  if (!rows[0]) throw HttpError.notFound('Catalog entry not found');
  return mapRows(rows)[0];
}

async function removeCatalogEntry(id) {
  if (!isUuid(id)) throw HttpError.notFound('Catalog entry not found');
  const { rowCount } = await query('DELETE FROM catalog_models WHERE id = $1', [id]);
  if (!rowCount) throw HttpError.notFound('Catalog entry not found');
  return { id };
}

/** One-click bootstrap: pull every distinct category/brand/model already in inventory. */
async function importFromAssets() {
  const { rows } = await query(
    `INSERT INTO catalog_models (category, brand, model)
     SELECT DISTINCT category, brand, model FROM assets
     ON CONFLICT (category, brand, model) DO NOTHING
     RETURNING id`
  );
  return { imported: rows.length };
}

module.exports = { listCatalog, addCatalogEntry, updateCatalogEntry, removeCatalogEntry, importFromAssets };
