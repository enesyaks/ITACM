/** snake_case DB rows → the camelCase API shapes used across the app. */

const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function mapRow(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) out[toCamel(key)] = value;
  return out;
}

const mapRows = (rows) => rows.map(mapRow);

/** Assets carry nested currentEmployee + responsibleEmployee in the API contract. */
function mapAsset(row) {
  if (!row) return null;
  const a = mapRow(row);
  a.currentEmployee = row.current_employee_id
    ? { id: row.current_employee_id, fullName: row.current_employee_name }
    : null;
  a.responsibleEmployee = row.responsible_employee_id
    ? { id: row.responsible_employee_id, fullName: row.responsible_employee_name }
    : null;
  delete a.currentEmployeeId;
  delete a.currentEmployeeName;
  delete a.responsibleEmployeeId;
  delete a.responsibleEmployeeName;
  return a;
}

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

module.exports = { mapRow, mapRows, mapAsset, isUuid };
