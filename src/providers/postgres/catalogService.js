/** Product catalog (postgres): brand/model lists that feed the asset form. */
const { query } = require('./pool');
const { mapRows, isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');

async function listCatalog() {
  const { rows } = await query('SELECT * FROM catalog_models ORDER BY category, brand, model');
  return mapRows(rows);
}

async function addCatalogEntry({ category, brand, model }) {
  if (!category || !brand || !model) throw HttpError.badRequest('category, brand and model are required');
  try {
    const { rows } = await query(
      `INSERT INTO catalog_models (category, brand, model) VALUES ($1, $2, $3) RETURNING *`,
      [category.trim(), brand.trim(), model.trim()]
    );
    return mapRows(rows)[0];
  } catch (err) {
    if (err.code === '23505') throw HttpError.conflict(`${brand} ${model} already exists in ${category}`);
    throw err;
  }
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

module.exports = { listCatalog, addCatalogEntry, removeCatalogEntry, importFromAssets };
