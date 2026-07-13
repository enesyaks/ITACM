/**
 * Central configuration — everything comes from environment variables.
 * Self-hosted PostgreSQL + local JWT auth (see docker-compose.yml).
 */
require('dotenv').config();
const path = require('path');

function env(name) {
  return process.env[name] || '';
}
function trimmedEnv(name) {
  return env(name).trim();
}
function firstEnv(names) {
  for (const name of names) {
    const value = trimmedEnv(name);
    if (value) return value;
  }
  return '';
}
function flagEnv(name) {
  return ['1', 'true', 'yes', 'require'].includes(trimmedEnv(name).toLowerCase());
}

const databaseUrl = firstEnv(['DATABASE_URL', 'POSTGRES_URL']);

const config = {
  backend: 'postgres',
  port: Number(trimmedEnv('PORT')) || 8000,
  corsOrigins: trimmedEnv('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),

  databaseUrl,
  pgSsl: flagEnv('PGSSL') || /[?&]sslmode=require/i.test(databaseUrl),
  jwtSecret: env('JWT_SECRET'),
  jwtExpiresIn: trimmedEnv('JWT_EXPIRES_IN') || '12h',

  // First-run admin seed
  adminEmail: trimmedEnv('ADMIN_EMAIL') || 'admin@example.com',
  adminUsername: trimmedEnv('ADMIN_USERNAME') || 'IT Admin',
  adminPassword: env('ADMIN_PASSWORD'), // generated & logged if empty

  // Uploaded documents (scans, repair paperwork) — persisted outside BYTEA.
  dataDir: trimmedEnv('DATA_DIR') || path.join(process.cwd(), 'data'),
};

function assertBackendConfig() {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is required (e.g. postgres://user:pass@localhost:5432/itacm)'
    );
  }
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET is required (min 32 chars). Generate one: openssl rand -hex 32'
    );
  }
}

module.exports = { ...config, assertBackendConfig };
