/**
 * Automatic database provisioning for postgres mode.
 *
 * Runs on every server start:
 *   1. Applies schema.sql — fully idempotent (CREATE ... IF NOT EXISTS).
 *   2. Runs versioned migrations tracked in schema_migrations.
 *   3. Seeds the first Owner user if the users table is empty.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./pool');
const config = require('../../config');
const { ensureSetupToken } = require('./settingsService');

const MIGRATION_LOCK_ID = 758231004;
let ensured = null;

async function ensureDatabase() {
  if (!ensured) ensured = provision();
  return ensured;
}

async function runMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log('[itacm] migration applied:', file);
  }
}

async function provision() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(schema);
    await runMigrations(client);
    await seedAdmin();
    await ensureSetupToken();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
  console.log('[itacm] PostgreSQL schema ready');
}

async function seedAdmin() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const generated = !config.adminPassword;
  const password = config.adminPassword || crypto.randomBytes(12).toString('base64url');
  const hash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'Owner')`,
    [config.adminUsername, config.adminEmail.toLowerCase(), hash]
  );

  console.log('='.repeat(64));
  console.log('[itacm] First-run setup: Owner account created');
  console.log(`[itacm]   email:    ${config.adminEmail.toLowerCase()}`);
  if (generated) {
    try {
      const dir = config.dataDir || path.join(process.cwd(), 'data');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, '.itacm-bootstrap-password');
      fs.writeFileSync(file, `${password}\n`, { mode: 0o600 });
      console.log(`[itacm]   password: (written once to ${file} — delete after first login)`);
    } catch (err) {
      console.log('[itacm]   password: (generated — failed to write file; set ADMIN_PASSWORD env)');
      console.log(`[itacm]   write error: ${err.message}`);
    }
    console.log('[itacm]   ^ CHANGE the password after first login, then remove the file.');
  } else {
    console.log('[itacm]   password: (from ADMIN_PASSWORD env var)');
  }
  console.log('='.repeat(64));
}

// Allow running standalone: `npm run migrate`
if (require.main === module) {
  ensureDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[itacm] migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { ensureDatabase };
