/**
 * Central configuration — everything comes from environment variables.
 *
 * DATA_BACKEND selects the storage/auth provider:
 *   "postgres" — self-hosted: PostgreSQL + local JWT auth (docker compose up)
 *   "firebase" — managed: Firebase Auth + Firestore (bring your own project)
 */
require('dotenv').config();

const VALID_BACKENDS = ['postgres', 'firebase'];

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

const backend = (trimmedEnv('DATA_BACKEND') || 'postgres').toLowerCase();
if (!VALID_BACKENDS.includes(backend)) {
  throw new Error(
    `Invalid DATA_BACKEND="${process.env.DATA_BACKEND}". Use one of: ${VALID_BACKENDS.join(', ')}`
  );
}

const databaseUrl = firstEnv(['DATABASE_URL', 'POSTGRES_URL']);

const config = {
  backend,
  port: Number(trimmedEnv('PORT')) || 8000,
  corsOrigins: trimmedEnv('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),

  // --- postgres mode -------------------------------------------------------
  databaseUrl,
  pgSsl: flagEnv('PGSSL') || /[?&]sslmode=require/i.test(databaseUrl),
  jwtSecret: env('JWT_SECRET'),
  jwtExpiresIn: trimmedEnv('JWT_EXPIRES_IN') || '12h',

  // First-run admin seed (postgres mode only)
  adminEmail: trimmedEnv('ADMIN_EMAIL') || 'admin@example.com',
  adminUsername: trimmedEnv('ADMIN_USERNAME') || 'IT Admin',
  adminPassword: env('ADMIN_PASSWORD'), // generated & logged if empty

  // --- firebase mode -------------------------------------------------------
  // Preferred on PaaS (Vercel etc.): base64 of the service account JSON.
  firebaseServiceAccountBase64: env('FIREBASE_SERVICE_ACCOUNT_BASE64'),
  // Alternative: raw JSON string in one env var.
  firebaseServiceAccountJson: env('FIREBASE_SERVICE_ACCOUNT_JSON'),
  // Local dev alternative: GOOGLE_APPLICATION_CREDENTIALS file path (ADC).
  googleApplicationCredentials: trimmedEnv('GOOGLE_APPLICATION_CREDENTIALS'),
  // Google Cloud runtimes can use ADC without a key file when explicitly enabled.
  firebaseUseApplicationDefaultCredentials: flagEnv('FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS'),

  // Firebase *web app* config JSON (public, no secrets) — lets the built-in
  // UI sign in with the Firebase Web SDK in firebase mode.
  firebaseWebConfig: env('FIREBASE_WEB_CONFIG'),
};

function assertBackendConfig() {
  if (config.backend === 'postgres') {
    if (!config.databaseUrl) {
      throw new Error(
        'DATA_BACKEND=postgres requires DATABASE_URL (or a platform-injected POSTGRES_URL)'
      );
    }
    if (!config.jwtSecret || config.jwtSecret.length < 32) {
      throw new Error(
        'DATA_BACKEND=postgres requires JWT_SECRET (min 32 chars). Generate one: openssl rand -hex 32'
      );
    }
  }

  if (config.backend === 'firebase') {
    const credentialSources = [
      ['FIREBASE_SERVICE_ACCOUNT_BASE64', config.firebaseServiceAccountBase64],
      ['FIREBASE_SERVICE_ACCOUNT_JSON', config.firebaseServiceAccountJson],
      ['GOOGLE_APPLICATION_CREDENTIALS', config.googleApplicationCredentials],
      [
        'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS',
        config.firebaseUseApplicationDefaultCredentials ? 'true' : '',
      ],
    ].filter(([, value]) => Boolean(value));

    if (credentialSources.length === 0) {
      throw new Error(
        'DATA_BACKEND=firebase requires one Firebase Admin credential source: ' +
          'FIREBASE_SERVICE_ACCOUNT_BASE64 (recommended for Vercel/PaaS), ' +
          'FIREBASE_SERVICE_ACCOUNT_JSON, GOOGLE_APPLICATION_CREDENTIALS, or ' +
          'FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true for Google Cloud ADC'
      );
    }
    if (credentialSources.length > 1) {
      throw new Error(
        `DATA_BACKEND=firebase expects exactly one Firebase Admin credential source; found ${credentialSources
          .map(([name]) => name)
          .join(', ')}`
      );
    }
    if (config.firebaseWebConfig) {
      try {
        JSON.parse(config.firebaseWebConfig);
      } catch (err) {
        throw new Error(`FIREBASE_WEB_CONFIG must be valid one-line JSON: ${err.message}`);
      }
    }
  }
}

module.exports = { ...config, assertBackendConfig };
