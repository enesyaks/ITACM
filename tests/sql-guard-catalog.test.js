/**
 * Guard: the AI advanced_query validator must reject PostgreSQL system-catalog
 * relations and server-metadata functions. The read-only role is confined to the
 * ai.* views, but pg_catalog is always implicitly on the search_path, so
 * unqualified catalog reads (pg_roles, pg_settings, pg_database, pg_stat_activity)
 * and functions like version()/current_database() stayed reachable and leaked
 * server version, config parameters and role names — bypassing the "curated
 * ai.* views only" model. No business data leaked (the role lacks table grants),
 * but the metadata disclosure is closed here as defence in depth.
 *
 * Static (no DB): node --test tests/sql-guard-catalog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateSql } = require('../src/providers/ai/sqlGuard');

const MUST_REJECT = [
  'SELECT rolname FROM pg_roles',
  'SELECT name, setting FROM pg_settings',
  'SELECT datname FROM pg_database',
  'SELECT * FROM pg_stat_activity',
  'SELECT usename, passwd FROM pg_shadow',
  'SELECT * FROM pg_class',
  'SELECT * FROM pg_namespace',
  'SELECT version()',
  'SELECT current_database()',
  'SELECT current_user',
  'SELECT session_user',
  'SELECT inet_server_addr()',
  'SELECT * FROM information_schema.tables',
  // hidden inside a CTE / subquery
  'WITH x AS (SELECT 1) SELECT rolname FROM pg_roles',
  'SELECT (SELECT setting FROM pg_settings WHERE name = $$port$$)',
];

const MUST_ALLOW = [
  'SELECT category, count(*) FROM assets GROUP BY category',
  'SELECT e.department, avg(a.purchase_cost) FROM ai.employees e JOIN ai.assets a ON a.assigned_to = e.id GROUP BY 1',
  'SELECT software_name, used_seats, total_seats FROM licenses ORDER BY used_seats DESC',
  'SELECT count(*) FROM handovers',
  'WITH t AS (SELECT category, count(*) n FROM assets GROUP BY category) SELECT * FROM t ORDER BY n DESC',
  'SELECT brand, model FROM assets WHERE status = $$Active$$',
];

test('advanced_query rejects system-catalog / metadata references', () => {
  for (const sql of MUST_REJECT) {
    assert.throws(() => validateSql(sql), /catalog|server-metadata|blocked|forbidden/i,
      `expected REJECT: ${sql}`);
  }
});

test('advanced_query still allows legitimate ai.* analytics', () => {
  for (const sql of MUST_ALLOW) {
    assert.doesNotThrow(() => validateSql(sql), `expected ALLOW: ${sql}`);
  }
});
