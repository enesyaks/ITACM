const { pool } = require('../postgres/pool');
const { HttpError } = require('../../utils/httpError');

const AI_ROLE = 'itacm_ai_ro';
const STATEMENT_TIMEOUT = '5000ms';
const MAX_ROWS = 200;
const MAX_SQL_LEN = 4000;
const MAX_CELL_CHARS = 400;

const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|merge|upsert|into|drop|alter|create|truncate|grant|revoke|comment|copy|call|do|vacuum|analyze|reindex|cluster|lock|set|reset|show|begin|start|commit|rollback|savepoint|release|execute|prepare|deallocate|listen|notify|unlisten|discard|refresh|import|declare|fetch|move|close|attach|detach)\b/i;
const BLOCKED_FUNCTIONS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_get|lo_put|dblink|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|current_setting|set_config|txid_current|pg_catalog|information_schema)\b/i;

// Each ai.* view maps to the app permission a user must already hold to read it,
// so advanced_query cannot bypass the per-resource RBAC the other tools enforce.
const VIEW_PERMISSIONS = {
  assets: 'asset',
  asset_history: 'asset',
  catalog_models: 'catalog',
  employees: 'employee',
  departments: 'employee',
  teams: 'employee',
  licenses: 'license',
  license_assignments: 'license',
  contracts: 'contract',
  providers: 'provider',
  mobile_lines: 'line',
  consumables: 'consumable',
  maintenance: 'maintenance',
  stock_counts: 'stock_count',
  handovers: 'handover',
  audit_log: 'audit',
};

function stripComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

// Return the distinct app resources a query touches. Matching is whole-word and
// covers both `ai.<view>` and the bare `<view>` (search_path=ai). Over-matching a
// column/alias that happens to share a view name only ADDS a required permission,
// so the check is fail-safe: it can never grant access, only withhold it.
function referencedResources(rawSql) {
  const bare = stripComments(rawSql).toLowerCase();
  const resources = new Set();
  for (const [view, resource] of Object.entries(VIEW_PERMISSIONS)) {
    if (new RegExp(`\\b(?:ai\\.)?${view}\\b`).test(bare)) resources.add(resource);
  }
  return [...resources];
}

function validateSql(raw) {
  let sql = String(raw || '').trim();
  if (!sql) throw HttpError.badRequest('SQL is empty');
  if (sql.length > MAX_SQL_LEN) throw HttpError.badRequest('SQL is too long');
  sql = sql.replace(/;\s*$/, '').trim(); // allow one trailing semicolon only

  const bare = stripComments(sql).trim();
  if (bare.includes(';')) throw HttpError.badRequest('Only a single statement is allowed');
  if (!/^(select|with)\b/i.test(bare)) {
    throw HttpError.badRequest('Only read-only SELECT / WITH queries are allowed');
  }
  if (FORBIDDEN_KEYWORDS.test(bare)) throw HttpError.badRequest('Query contains a forbidden keyword');
  if (BLOCKED_FUNCTIONS.test(bare)) throw HttpError.badRequest('Query references a blocked function or schema');
  return sql;
}

function withLimit(sql) {
  return /\blimit\s+\d+\b[^)]*$/i.test(sql) ? sql : `${sql}\nLIMIT ${MAX_ROWS}`;
}

function clampCell(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : v;
  }
  if (typeof v === 'string' && v.length > MAX_CELL_CHARS) return `${v.slice(0, MAX_CELL_CHARS)}…`;
  return v;
}

let roleAvailable = null;
async function isAvailable() {
  if (roleAvailable != null) return roleAvailable;
  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [AI_ROLE]);
    roleAvailable = rows.length > 0;
  } catch {
    roleAvailable = false;
  }
  return roleAvailable;
}

async function runReadOnlyQuery(rawSql) {
  if (!(await isAvailable())) {
    throw HttpError.badRequest('Advanced query is unavailable on this install (AI read-only role not provisioned)');
  }
  const validated = validateSql(rawSql);
  const finalSql = withLimit(validated);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL default_transaction_read_only = on');
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await client.query('SET LOCAL search_path = ai');
    await client.query(`SET LOCAL ROLE ${AI_ROLE}`);

    let result;
    try {
      result = await client.query(finalSql);
    } catch (err) {
      const msg = String(err?.message || 'query failed');
      if (/statement timeout/i.test(msg)) throw HttpError.badRequest('Query timed out (too heavy) — narrow it down');
      if (/permission denied/i.test(msg)) throw HttpError.badRequest('Query touched a table outside the allowed ai.* views');
      throw HttpError.badRequest(`Query error: ${msg.replace(/^error:\s*/i, '').slice(0, 200)}`);
    }

    const columns = (result.fields || []).map((f) => f.name);
    const allRows = Array.isArray(result.rows) ? result.rows : [];
    const rows = allRows.slice(0, MAX_ROWS).map((r) => {
      const out = {};
      for (const c of columns) out[c] = clampCell(r[c]);
      return out;
    });
    return {
      columns,
      rows,
      rowCount: allRows.length,
      truncated: allRows.length > MAX_ROWS,
      sql: finalSql,
    };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

module.exports = {
  validateSql,
  withLimit,
  runReadOnlyQuery,
  isAvailable,
  referencedResources,
  VIEW_PERMISSIONS,
  AI_ROLE,
  MAX_ROWS,
};
