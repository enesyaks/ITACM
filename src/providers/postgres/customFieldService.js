/** Custom field definitions + values for asset / employee / contract. */
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { mapRow, mapRows, isUuid } = require('./rowMapper');

const ENTITIES = ['asset', 'employee', 'contract'];
const TYPES = ['text', 'number', 'date', 'select'];

function assertEntity(entity) {
  if (!ENTITIES.includes(entity)) throw HttpError.badRequest(`entity must be one of: ${ENTITIES.join(', ')}`);
}

function sanitizeKey(key) {
  const k = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  if (!k || !/^[a-z]/.test(k)) throw HttpError.badRequest('field_key must start with a letter (a-z0-9_)');
  return k;
}

async function listDefs(entity) {
  assertEntity(entity);
  const { rows } = await query(
    `SELECT id, entity, field_key AS "fieldKey", label, field_type AS "fieldType",
            options_json AS options, required, sort_order AS "sortOrder"
     FROM custom_field_defs WHERE entity = $1 ORDER BY sort_order, label`,
    [entity]
  );
  return rows.map((r) => ({ ...r, options: r.options || [] }));
}

async function upsertDef(body) {
  assertEntity(body.entity);
  const fieldKey = sanitizeKey(body.fieldKey || body.field_key);
  const label = String(body.label || '').trim().slice(0, 80);
  if (!label) throw HttpError.badRequest('label is required');
  const fieldType = TYPES.includes(body.fieldType || body.field_type)
    ? (body.fieldType || body.field_type) : 'text';
  const options = Array.isArray(body.options) ? body.options.map(String).slice(0, 50) : [];
  const required = !!body.required;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
  const { rows } = await query(
    `INSERT INTO custom_field_defs (entity, field_key, label, field_type, options_json, required, sort_order)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     ON CONFLICT (entity, field_key) DO UPDATE SET
       label = EXCLUDED.label, field_type = EXCLUDED.field_type, options_json = EXCLUDED.options_json,
       required = EXCLUDED.required, sort_order = EXCLUDED.sort_order
     RETURNING id, entity, field_key AS "fieldKey", label, field_type AS "fieldType",
               options_json AS options, required, sort_order AS "sortOrder"`,
    [body.entity, fieldKey, label, fieldType, JSON.stringify(options), required, sortOrder]
  );
  return { ...rows[0], options: rows[0].options || [] };
}

async function deleteDef(entity, fieldKey) {
  assertEntity(entity);
  const key = sanitizeKey(fieldKey);
  await query('DELETE FROM custom_field_values WHERE entity = $1 AND field_key = $2', [entity, key]);
  const { rowCount } = await query(
    'DELETE FROM custom_field_defs WHERE entity = $1 AND field_key = $2',
    [entity, key]
  );
  if (!rowCount) throw HttpError.notFound('Field definition not found');
  return { deleted: true };
}

async function getValues(entity, entityId) {
  assertEntity(entity);
  if (!isUuid(entityId)) return {};
  const { rows } = await query(
    `SELECT field_key, value_text FROM custom_field_values WHERE entity = $1 AND entity_id = $2`,
    [entity, entityId]
  );
  const out = {};
  for (const r of rows) out[r.field_key] = r.value_text;
  return out;
}

async function setValues(entity, entityId, values) {
  assertEntity(entity);
  if (!isUuid(entityId)) throw HttpError.badRequest('Invalid entity id');
  if (!values || typeof values !== 'object') return getValues(entity, entityId);
  const defs = await listDefs(entity);
  const byKey = Object.fromEntries(defs.map((d) => [d.fieldKey, d]));
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey[key];
    if (!def) continue;
    let val = raw == null ? '' : String(raw).trim();
    if (def.required && !val) throw HttpError.badRequest(`${def.label} is required`);
    if (def.fieldType === 'number' && val && Number.isNaN(Number(val))) {
      throw HttpError.badRequest(`${def.label} must be a number`);
    }
    if (def.fieldType === 'select' && val && def.options.length && !def.options.includes(val)) {
      throw HttpError.badRequest(`${def.label} must be one of the allowed options`);
    }
    if (!val) {
      await query(
        'DELETE FROM custom_field_values WHERE entity = $1 AND entity_id = $2 AND field_key = $3',
        [entity, entityId, key]
      );
    } else {
      await query(
        `INSERT INTO custom_field_values (entity, entity_id, field_key, value_text)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (entity, entity_id, field_key) DO UPDATE SET value_text = EXCLUDED.value_text`,
        [entity, entityId, key, val.slice(0, 2000)]
      );
    }
  }
  return getValues(entity, entityId);
}

module.exports = { listDefs, upsertDef, deleteDef, getValues, setValues, ENTITIES };
