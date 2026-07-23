/**
 * Static guards on schema.sql + migrations/.
 *
 * Both failures below have actually happened in this codebase, and both either
 * take the whole app down or destroy ordering, with nothing else to catch them:
 *
 *  1. Two migrations sharing a number prefix (037 was used twice) — the runner
 *     keys on filename so both apply, but "is 037 deployed?" stops having an
 *     answer.
 *  2. schema.sql indexing a column that only a later migration adds. schema.sql
 *     runs FIRST and `CREATE TABLE IF NOT EXISTS` skips an existing table, so
 *     the column is not there yet and startup aborts in a crash loop.
 *
 * Pure file reads — no database.
 * Run: node --test tests/schema-consistency.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PG_DIR = path.join(__dirname, '..', 'src', 'providers', 'postgres');
const MIGRATIONS_DIR = path.join(PG_DIR, 'migrations');
const schemaSql = fs.readFileSync(path.join(PG_DIR, 'schema.sql'), 'utf8');

/** Strip -- line comments so they cannot be mistaken for statements. */
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');

test('every migration has a unique number prefix', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const byPrefix = new Map();
  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    assert.ok(m, `migration "${f}" must start with a number prefix`);
    const list = byPrefix.get(m[1]) || [];
    list.push(f);
    byPrefix.set(m[1], list);
  }
  const clashes = [...byPrefix.entries()].filter(([, list]) => list.length > 1);
  assert.deepEqual(clashes, [],
    'two migrations share a number: '
    + clashes.map(([n, l]) => n + ' → ' + l.join(' + ')).join('; '));
});

test('migrations apply in the order their numbers imply', () => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  // The runner uses plain .sort(); zero-padded prefixes make that match numeric order.
  const lexical = [...files].sort();
  const numeric = [...files].sort(
    (a, b) => Number(a.match(/^(\d+)/)[1]) - Number(b.match(/^(\d+)/)[1])
  );
  assert.deepEqual(lexical, numeric,
    'filename sort disagrees with numeric order — pad the prefixes to equal width');
});

test('schema.sql never indexes a column it has not declared', () => {
  const sql = stripComments(schemaSql);

  // A column exists at schema.sql time if it is either declared in the table's
  // CREATE TABLE body (fresh database) OR added by an unconditional
  // ALTER TABLE ... ADD COLUMN in this same file (existing database). Anything
  // else — like a column only a migration adds — is not there yet.
  const columnsByTable = new Map();
  const addCol = (table, col) => {
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table).add(col);
  };

  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    for (const line of m[2].split('\n')) {
      // Column names may be quoted ("timestamp") to dodge reserved words.
      const c = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Za-z]/);
      if (c && !['constraint', 'check', 'unique', 'primary', 'foreign'].includes(c[1].toLowerCase())) {
        addCol(m[1], c[1]);
      }
    }
    if (!columnsByTable.has(m[1])) columnsByTable.set(m[1], new Set());
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+"?([a-z_][a-z0-9_]*)"?/g)) {
    addCol(m[1], m[2]);
  }
  assert.ok(columnsByTable.size > 10, 'sanity: expected to parse many tables');

  const problems = [];
  const idxRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF NOT EXISTS\s+\w+\s+ON\s+(\w+)\s*\(([^)]*)\)([^;]*);/g;
  for (const m of sql.matchAll(idxRe)) {
    const [, table, colExpr, tail] = m;
    const known = columnsByTable.get(table);
    if (!known) continue; // table created by a migration only — out of scope here
    // Drop string literals first: WHERE status = 'scheduled' must not make
    // "scheduled" look like a column reference.
    const expr = (colExpr + ' ' + tail).replace(/'[^']*'/g, ' ');
    const referenced = new Set();
    for (const c of expr.matchAll(/[a-z_][a-z0-9_]*/g)) referenced.add(c[0]);
    for (const col of referenced) {
      if (known.has(col)) continue;
      // SQL keywords / functions / opclasses, not column names.
      if (/^(lower|upper|coalesce|desc|asc|where|is|not|null|and|or|nulls|first|last|text_pattern_ops|gin|gist|btree|true|false)$/i.test(col)) continue;
      // A column of some other table (expression indexes referencing joins).
      if ([...columnsByTable.values()].some((s) => s.has(col))) continue;
      problems.push(`${table}(${col})`);
    }
  }
  assert.deepEqual(problems, [],
    'schema.sql indexes columns it does not declare — these abort startup on an '
    + 'existing database because CREATE TABLE IF NOT EXISTS skips the table: '
    + problems.join(', '));
});

test('the HR fulfilment columns are added by a migration, not only schema.sql', () => {
  // Regression guard for the crash loop above: existing databases only get new
  // columns through a migration.
  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
  for (const col of ['fulfilled_at', 'fulfilled_handover_id']) {
    assert.ok(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}`).test(migrations),
      `${col} must be added by a migration, not only declared in schema.sql`);
  }
});
