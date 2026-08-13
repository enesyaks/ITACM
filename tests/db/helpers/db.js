/**
 * Integration-test harness: a real PostgreSQL, provisioned from scratch.
 *
 * SAFETY: this never touches an existing database. It connects to the server in
 * TEST_DATABASE_URL, CREATEs a scratch database with a random name, points the
 * app at that, and DROPs it afterwards. Even pointed at a production server the
 * blast radius is one database it created itself — but do not do that.
 *
 * `process.env.DATABASE_URL` is rewritten at REQUIRE time, before any service is
 * loaded, because src/providers/postgres/pool.js builds its Pool from config at
 * module load. Require this helper before anything from src/.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.TEST_DATABASE_URL || '';
const SCRATCH = `itacm_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

/** Why the suite cannot run, or null when it can. */
const skipReason = ADMIN_URL
  ? null
  : 'TEST_DATABASE_URL is not set — run `npm run test:db`, which starts a throwaway Postgres';

function urlFor(dbName) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${dbName}`;
  return u.toString();
}

// Redirect the app at the scratch database NOW, so every later require sees it.
if (ADMIN_URL) {
  process.env.DATABASE_URL = urlFor(SCRATCH);
  // Documents are written to the filesystem, not the database — send them to a
  // temp dir so a test run never drops files into the repo's data/.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'itacm-test-'));
  // migrate.js seeds an Owner and a setup token; give them deterministic values
  // so a test run never depends on generated secrets.
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(40, 'x');
  process.env.ADMIN_EMAIL = 'owner@test.local';
  process.env.ADMIN_PASSWORD = 'TestOwner123!';
}

async function adminQuery(sql) {
  const c = new Client({ connectionString: urlFor('postgres') });
  await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

/** Create the scratch database and apply schema.sql + every migration. */
async function setup() {
  await adminQuery(`CREATE DATABASE ${SCRATCH}`);
  // Required after the database exists, so the pool connects to the right one.
  const { ensureDatabase } = require('../../../src/providers/postgres/migrate');
  await ensureDatabase();
  return SCRATCH;
}

/** Drop the scratch database. Safe to call twice. */
async function teardown() {
  const { pool } = require('../../../src/providers/postgres/pool');
  await pool.end().catch(() => {});
  await adminQuery(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`).catch(() => {});
  if (process.env.DATA_DIR && process.env.DATA_DIR.includes('itacm-test-')) {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

/* ---------------------------- fixtures ---------------------------- */

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeEmployee(overrides = {}) {
  const { query } = require('../../../src/providers/postgres/pool');
  const n = uniq();
  const { rows } = await query(
    `INSERT INTO employees (full_name, email, department, status)
     VALUES ($1, $2, $3, $4) RETURNING id, full_name`,
    [overrides.fullName || `Test Person ${n}`, overrides.email || `p${n}@test.local`,
      overrides.department || 'IT', overrides.status || 'Active']
  );
  return rows[0];
}

async function makeAsset(overrides = {}) {
  const { query } = require('../../../src/providers/postgres/pool');
  const n = uniq();
  const tag = overrides.assetTag || `TST-${n}`;
  const { rows } = await query(
    `INSERT INTO assets (asset_tag, brand, model, category, status, qr_code_string)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, asset_tag, status`,
    [tag, overrides.brand || 'Dell', overrides.model || 'Latitude 5400',
      overrides.category || 'Laptop', overrides.status || 'In Stock', tag]
  );
  return rows[0];
}

async function makeLicense(overrides = {}) {
  const { query } = require('../../../src/providers/postgres/pool');
  const n = uniq();
  const { rows } = await query(
    `INSERT INTO licenses (software_name, license_key, total_seats, used_seats, expiration_date)
     VALUES ($1, $2, $3, 0, now() + interval '1 year') RETURNING id, software_name, total_seats, used_seats`,
    [overrides.softwareName || `Suite ${n}`, overrides.licenseKey || `KEY-${n}`, overrides.totalSeats || 1]
  );
  return rows[0];
}

const IT_USER = { uid: '00000000-0000-0000-0000-0000000000ff', username: 'Tester', email: 'tester@test.local', role: 'Admin' };

/** Run n functions at once and report which resolved and which threw. */
async function race(fns) {
  const settled = await Promise.allSettled(fns.map((f) => f()));
  return {
    ok: settled.filter((s) => s.status === 'fulfilled').map((s) => s.value),
    failed: settled.filter((s) => s.status === 'rejected').map((s) => s.reason),
  };
}

module.exports = {
  skipReason, setup, teardown, SCRATCH,
  makeEmployee, makeAsset, makeLicense, IT_USER, race,
};
