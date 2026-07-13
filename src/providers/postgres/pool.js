const { Pool } = require('pg');
const config = require('../../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.pgSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

// Without this, an error on an idle client (DB restart, network blip) is emitted
// as an 'error' event on the pool with no listener → unhandled → process crash.
// Log it instead; the pool discards the bad client and hands out a fresh one.
pool.on('error', (err) => {
  console.error('[pool] idle client error:', err.message);
});

const query = (text, params) => pool.query(text, params);

/** True if a DB error is an authentication failure (wrong POSTGRES_PASSWORD). */
const isAuthError = (err) => err && (err.code === '28P01' || /password authentication failed/i.test(err.message || ''));

/** Lightweight liveness probe for the health endpoint. Resolves false (never throws)
 *  if the DB can't answer within `timeoutMs`. */
async function ping(timeoutMs = 2000) {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('db ping timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** BEGIN/COMMIT/ROLLBACK wrapper — the Postgres equivalent of firestore.runTransaction(). */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, ping, isAuthError };
