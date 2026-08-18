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

// App version — single source of truth is package.json. Surfaced to the UI via
// /api/config and /api/health so the frontend can announce updates to the Owner.
const appVersion = (() => {
  try { return require('../../package.json').version || '0.0.0'; }
  catch { return '0.0.0'; }
})();

const config = {
  backend: 'postgres',
  appVersion,
  port: Number(trimmedEnv('PORT')) || 8000,
  corsOrigins: trimmedEnv('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),

  databaseUrl,
  pgSsl: flagEnv('PGSSL') || /[?&]sslmode=require/i.test(databaseUrl),
  // When true, skip CA verification (legacy / managed Postgres with weird chains).
  // Prefer mounting a CA and leaving this false in production.
  pgSslInsecure: flagEnv('PGSSL_INSECURE'),
  jwtSecret: env('JWT_SECRET'),
  jwtExpiresIn: trimmedEnv('JWT_EXPIRES_IN') || '12h',
  // Opt-in longer session when the user checks "Remember me" at login.
  jwtRememberExpiresIn: trimmedEnv('JWT_REMEMBER_EXPIRES_IN') || '30d',

  // First-run admin seed
  adminEmail: trimmedEnv('ADMIN_EMAIL') || 'admin@example.com',
  adminUsername: trimmedEnv('ADMIN_USERNAME') || 'IT Admin',
  adminPassword: env('ADMIN_PASSWORD'), // generated & logged if empty

  // Uploaded documents (scans, repair paperwork) — persisted outside BYTEA.
  dataDir: trimmedEnv('DATA_DIR') || path.join(process.cwd(), 'data'),

  /**
   * Abuse / brute-force controls. Keyed by WHO, not only WHERE, so a whole
   * office behind one NAT IP isn't throttled as a single visitor:
   *   - coarse per-IP API guard (src/app.js) — DoS backstop, exempt for trusted CIDRs
   *   - per-user API fairness (src/middleware/auth.js) — after auth, keyed on uid
   *   - per-account login lockout (authProvider) — keyed on email, persisted in DB
   * All limits are env-tunable so a large office can loosen them without a code change.
   */
  security: {
    apiRateLimit: Number(trimmedEnv('API_RATE_LIMIT')) || 1000,
    apiRateWindowMs: (Number(trimmedEnv('API_RATE_WINDOW_SEC')) || 300) * 1000,
    userRateLimit: Number(trimmedEnv('USER_RATE_LIMIT')) || 600,
    userRateWindowMs: (Number(trimmedEnv('USER_RATE_WINDOW_SEC')) || 300) * 1000,
    loginFailLimit: Number(trimmedEnv('LOGIN_FAIL_LIMIT')) || 10,
    loginLockMs: (Number(trimmedEnv('LOGIN_LOCK_MIN')) || 15) * 60 * 1000,
    // IPs/CIDRs exempt from the coarse per-IP API guard — e.g. the office egress
    // behind NAT. Per-account login lockout still applies. Comma separated.
    trustedCidrs: trimmedEnv('RATE_LIMIT_TRUSTED_CIDRS').split(',').map((s) => s.trim()).filter(Boolean),
  },

  /**
   * Automatic nightly database backups (OFF by default). When on, the scheduler
   * runs `pg_dump | gzip` once a day at BACKUP_HOUR into BACKUP_DIR (default
   * DATA_DIR/backups), verifies each archive is a complete, restorable dump, and
   * keeps the newest BACKUP_KEEP files. Needs postgresql-client in the image
   * (already present — the migration export uses it too).
   */
  backup: {
    enabled: flagEnv('BACKUP_ENABLED'),
    hour: Math.min(23, Math.max(0, Number(trimmedEnv('BACKUP_HOUR')) || 3)),
    keep: Math.max(1, Number(trimmedEnv('BACKUP_KEEP')) || 7),
    dir: trimmedEnv('BACKUP_DIR') || '',
  },

  /**
   * Single-provider SSO via OpenID Connect (OFF by default). Invite-only: SSO
   * signs in users who already exist in ITACM, never creates accounts. Config is
   * env-only so the client secret never lives in the DB or UI. The redirect URI
   * must be registered verbatim at the IdP.
   */
  sso: {
    enabled: flagEnv('SSO_ENABLED'),
    issuer: trimmedEnv('SSO_ISSUER'),
    clientId: trimmedEnv('SSO_CLIENT_ID'),
    clientSecret: env('SSO_CLIENT_SECRET'),
    redirectUri: trimmedEnv('SSO_REDIRECT_URI'),
    allowedDomains: trimmedEnv('SSO_ALLOWED_DOMAINS')
      .split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
    buttonLabel: trimmedEnv('SSO_BUTTON_LABEL') || 'Sign in with SSO',
    // Require SSO for staff — non-Owner accounts can't use a password (Owner
    // keeps a break-glass password so a broken IdP never locks everyone out).
    requireSso: flagEnv('SSO_REQUIRE'),
  },

  // Opt-in upstream update check. When on, the server asks GitHub once a day
  // whether a newer release exists and surfaces it to the Owner. OFF by default
  // so air-gapped / offline installs never reach out. GITHUB_TOKEN is optional
  // (only needed for a private repo or to lift the 60-req/hr anon rate limit).
  updateCheck: flagEnv('UPDATE_CHECK'),
  updateRepo: trimmedEnv('UPDATE_CHECK_REPO') || 'enesyaks/ITACM',
  updateToken: firstEnv(['UPDATE_CHECK_TOKEN', 'GITHUB_TOKEN']),

  /**
   * OCR for scanned zimmet PDFs (bulk import, phase 2) — OFF by default.
   * Reading pages is CPU-heavy and pulls an optional dependency (tesseract.js),
   * so an install that never imports scans pays nothing. maxPages is a
   * whole-batch budget: analyze() is a plain HTTP request and OCR runs ~2s per
   * page, so this is what keeps it from running past a proxy timeout.
   */
  ocr: {
    enabled: flagEnv('ZIMMET_OCR'),
    langs: trimmedEnv('ZIMMET_OCR_LANGS') || 'tur+eng',
    // Local traineddata directory; falls back to the tesseract.js CDN if empty.
    langPath: trimmedEnv('ZIMMET_OCR_LANG_PATH')
      || path.join(trimmedEnv('DATA_DIR') || path.join(process.cwd(), 'data'), 'tessdata'),
    maxPages: Number(trimmedEnv('ZIMMET_OCR_MAX_PAGES')) || 40,
  },
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
