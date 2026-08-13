/**
 * schema.sql + every migration, applied to a database that has never seen them.
 *
 * The app provisions itself on startup, so a migration that only works against
 * a database which already has the change — or one that clashes with
 * schema.sql — takes down the FIRST START of a fresh install, in a crash loop,
 * and is invisible to everyone whose database already ran it. That is the case
 * this file covers; nothing else does.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./helpers/db');

test('schema + migrations on a fresh database', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();
  t.after(() => db.teardown());
  const { query } = require('../../src/providers/postgres/pool');

  await t.test('every migration file is recorded as applied', async () => {
    const dir = path.join(__dirname, '..', '..', 'src', 'providers', 'postgres', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await query('SELECT name FROM schema_migrations ORDER BY name');
    assert.deepEqual(rows.map((r) => r.name), files,
      'schema_migrations must list exactly the migration files on disk');
  });

  await t.test('the tables the app depends on exist', async () => {
    const expected = [
      'app_settings', 'assets', 'system_audit_log', 'employees', 'handover_documents',
      'handovers', 'license_assignments', 'licenses', 'mobile_lines',
      'permission_entries', 'permission_groups', 'users', 'zimmet_import_batches',
      'zimmet_import_items',
    ];
    const { rows } = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [expected]
    );
    const found = new Set(rows.map((r) => r.table_name));
    for (const tableName of expected) {
      assert.ok(found.has(tableName), `table "${tableName}" is missing after provisioning`);
    }
  });

  await t.test('provisioning twice changes nothing (it runs on every start)', async () => {
    const before = await query('SELECT count(*)::int AS c FROM schema_migrations');
    // ensureDatabase memoises, so call the underlying path again the way a
    // second container start would.
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'providers', 'postgres', 'schema.sql'), 'utf8'
    );
    await query(schema); // schema.sql claims to be idempotent — hold it to that
    const after = await query('SELECT count(*)::int AS c FROM schema_migrations');
    assert.equal(after.rows[0].c, before.rows[0].c);
  });

  await t.test('the first Owner is seeded exactly once', async () => {
    const { rows } = await query("SELECT email, role, mfa_enabled FROM users WHERE role = 'Owner'");
    assert.equal(rows.length, 1, 'a fresh install must come up with exactly one Owner');
    assert.equal(rows[0].email, 'owner@test.local');
  });

  await t.test('built-in permission groups are present', async () => {
    const { rows } = await query('SELECT count(*)::int AS c FROM permission_groups');
    assert.ok(rows[0].c >= 4, 'Owner/Admin/Helpdesk/Viewer groups must exist');
  });
});
