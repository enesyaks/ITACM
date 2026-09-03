const { pool } = require('../postgres/pool');
const { HttpError } = require('../../utils/httpError');

const AI_ROLE = 'itacm_ai_ro';
const STATEMENT_TIMEOUT = '5000ms';
const MAX_ROWS = 200;
const MAX_SQL_LEN = 4000;
const MAX_CELL_CHARS = 400;

const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|merge|upsert|into|drop|alter|create|truncate|grant|revoke|comment|copy|call|do|vacuum|analyze|reindex|cluster|lock|set|reset|show|begin|start|commit|rollback|savepoint|release|execute|prepare|deallocate|listen|notify|unlisten|discard|refresh|import|declare|fetch|move|close|attach|detach)\b/i;
const BLOCKED_FUNCTIONS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_import|lo_export|lo_get|lo_put|dblink|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|current_setting|set_config|txid_current|pg_catalog|information_schema)\b/i;

// The read-only role is confined to the ai.* views, but PostgreSQL always keeps
// pg_catalog implicitly on the search_path — so unqualified catalog relations
// (pg_roles, pg_settings, pg_database, pg_stat_activity, …) and server-metadata
// functions stay reachable and leak version / config / role names even though no
// business data is exposed. The ai.* views never use a pg_/information_schema name,
// so rejecting them outright is fail-safe. Complements the DB-role privileges.
const BLOCKED_CATALOG = /\b(pg_[a-z0-9_]+|information_schema|version|current_database|current_catalog|current_schema|current_user|session_user|current_role|inet_server_addr|inet_server_port|inet_client_addr|inet_client_port)\b/i;

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

// Cost / financial columns of the ai.* views that the REST layer hides behind
// `<resource>:view_confidential` (see utils/financialAccess). advanced_query runs
// under the ai_ro role, which CAN read these columns — so without this the tool
// would hand a user with only `<resource>:read` the very figures redactCosts()
// masks for them elsewhere. Column names are the snake_case ai.* view columns.
const CONFIDENTIAL_COLUMNS_BY_RESOURCE = {
  asset: ['cost', 'salvage_value'],
  contract: ['cost_amount'],
  license: ['purchase_amount'],
  line: ['monthly_cost'],
  maintenance: ['cost'],
};

// A `*` that expands view columns (`SELECT *`, `t.*`, `, *`) — NOT `count(*)` or a
// `col * 2` multiplication, both of which name no confidential column on their own.
function hasWildcardSelect(bareLower) {
  if (/\bselect\s+\*/.test(bareLower)) return true;      // SELECT *
  if (/[a-z_][a-z0-9_]*\s*\.\s*\*/.test(bareLower)) return true; // t.*
  if (/,\s*\*(?:\s|,|$)/.test(bareLower)) return true;   // , *
  return false;
}

// Resources whose CONFIDENTIAL columns this query could surface — because it
// names one of those columns anywhere (SELECT, WHERE, HAVING…) or uses a column
// wildcard that would expand them. Naming the column in the SQL text is the only
// way to reference its value, so a `cost AS revenue` alias is still caught (the
// word `cost` is present); `SELECT *` is caught by the wildcard rule. Fail-safe:
// it can only ADD a required view_confidential check, never remove one.
function confidentialResourcesTouched(rawSql) {
  const bare = stripComments(rawSql).toLowerCase();
  const wild = hasWildcardSelect(bare);
  const out = new Set();
  for (const resource of referencedResources(rawSql)) {
    const cols = CONFIDENTIAL_COLUMNS_BY_RESOURCE[resource];
    if (!cols) continue;
    if (wild || cols.some((c) => new RegExp(`\\b${c}\\b`).test(bare))) out.add(resource);
  }
  return [...out];
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
  if (BLOCKED_CATALOG.test(bare)) throw HttpError.badRequest('Query references a system catalog or server-metadata function');
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
  confidentialResourcesTouched,
  CONFIDENTIAL_COLUMNS_BY_RESOURCE,
  VIEW_PERMISSIONS,
  AI_ROLE,
  MAX_ROWS,
};
