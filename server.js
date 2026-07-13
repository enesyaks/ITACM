/**
 * Node/Docker entry point.
 * In postgres mode the schema is applied and the first Admin is seeded
 * automatically before the HTTP server starts listening.
 */
const config = require('./src/config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Provision the DB, tolerating a Postgres that is still starting up. A slow /
 * not-yet-ready database is retried; a wrong-password (auth) failure is NOT — it
 * would never succeed, so we surface clear guidance and stop fast instead of
 * crash-looping.
 */
async function ensureDatabaseWithRetry(providers, tries = 10, delayMs = 2000) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await providers.ensureDatabase();
      return;
    } catch (err) {
      if (providers.isAuthError && providers.isAuthError(err)) {
        printPasswordGuidance();
        throw err; // fatal — do not retry
      }
      if (attempt === tries) throw err;
      console.log(`[itacm] waiting for database… (${attempt}/${tries}: ${err.message})`);
      await sleep(delayMs);
    }
  }
}

function printPasswordGuidance() {
  console.error('='.repeat(72));
  console.error('[itacm] Cannot log in to the database: password authentication failed.');
  console.error('[itacm] The POSTGRES_PASSWORD in .env does not match the EXISTING database');
  console.error('[itacm] volume (the password is fixed when the volume is first created).');
  console.error('[itacm]');
  console.error('[itacm] To change the DB password safely (keeps all data):');
  console.error('[itacm]     npm run change-db-password');
  console.error('[itacm] Or restore the previous POSTGRES_PASSWORD value in .env.');
  console.error('[itacm]');
  console.error('[itacm] DO NOT run "docker compose down -v" — it PERMANENTLY DELETES all data');
  console.error('[itacm] (assets, employees, handover receipts, document archive).');
  console.error('='.repeat(72));
}

async function main() {
  const providers = require('./src/providers');
  if (providers.ensureDatabase) {
    await ensureDatabaseWithRetry(providers);
  }

  const fs = require('fs');
  const { dataRoot } = require('./src/utils/docStorage');
  fs.mkdirSync(dataRoot(), { recursive: true });

  const { createApp } = require('./src/app');
  createApp().listen(config.port, () => {
    console.log(`[itacm] backend=${config.backend} listening on http://localhost:${config.port}`);
    console.log('[itacm] health check: GET /api/health');
  });
}

main().catch((err) => {
  console.error('[itacm] fatal startup error:', err.message);
  process.exit(1);
});
