'use strict';

/**
 * SSO (OIDC) configuration store. UI-managed config lives encrypted in
 * app_settings.sso_json (client secret via secretCrypto, same as SMTP). Once an
 * issuer is saved in the DB it wins; otherwise the SSO_* env vars are used, so
 * either configuration path works. The plaintext secret never leaves the server.
 */
const { query } = require('./pool');
const config = require('../../config');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { HttpError } = require('../../utils/httpError');

function normDomains(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  return list.map((s) => String(s).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

async function readRaw() {
  try {
    const { rows } = await query('SELECT sso_json FROM app_settings WHERE id = 1');
    return (rows[0] && rows[0].sso_json) || {};
  } catch {
    return {};
  }
}

/** Effective config (DB wins once an issuer is saved; else env). Secret decrypted. */
async function getSsoConfig() {
  const db = await readRaw();
  const dbActive = !!String(db.issuer || '').trim();
  const cfg = dbActive
    ? {
      source: 'db',
      enabled: !!db.enabled,
      issuer: String(db.issuer || '').trim(),
      clientId: String(db.clientId || '').trim(),
      clientSecret: decryptSecret(db.clientSecret || ''),
      redirectUri: String(db.redirectUri || '').trim(),
      allowedDomains: normDomains(db.allowedDomains),
      buttonLabel: String(db.buttonLabel || '').trim() || 'Sign in with SSO',
      requireSso: !!db.requireSso,
    }
    : {
      source: 'env',
      enabled: config.sso.enabled,
      issuer: config.sso.issuer,
      clientId: config.sso.clientId,
      clientSecret: config.sso.clientSecret,
      redirectUri: config.sso.redirectUri,
      allowedDomains: config.sso.allowedDomains,
      buttonLabel: config.sso.buttonLabel,
      requireSso: config.sso.requireSso,
    };
  cfg.secretConfigured = !!cfg.clientSecret;
  cfg.ready = !!(cfg.enabled && cfg.issuer && cfg.clientId && cfg.clientSecret && cfg.redirectUri);
  return cfg;
}

/** Admin view for the Integrations UI — never includes the secret. */
async function getSsoForUi() {
  const c = await getSsoConfig();
  return {
    source: c.source,
    enabled: c.enabled,
    issuer: c.issuer,
    clientId: c.clientId,
    redirectUri: c.redirectUri,
    allowedDomains: c.allowedDomains,
    buttonLabel: c.buttonLabel,
    requireSso: c.requireSso,
    secretConfigured: c.secretConfigured,
    ready: c.ready,
  };
}

function isBlankOrMasked(s) {
  const t = String(s == null ? '' : s).trim();
  return t === '' || /^[•*]+$/.test(t);
}

/**
 * Enabling SSO decides WHO CAN SIGN IN, which is a user-management decision
 * rather than an integration setting. Whoever can turn it on while also
 * choosing the issuer can stand up an identity provider of their own that
 * asserts `email_verified` for an existing address and sign in as that user —
 * the same escalation the directory integration gates on. `integration:manage`
 * alone (the group you would hand someone for SMTP and webhooks) is therefore
 * not enough. Gated on the value being SAVED, so an enabled switch cannot be
 * kept while the issuer underneath it is re-pointed.
 */
async function assertSignInRights(enabled, user) {
  if (!enabled || !user) return; // internal callers act as the system
  const perms = require('./permissionService');
  const ok = await perms.checkPermission(user, 'user_management', 'manage')
    || await perms.checkPermission(user, 'user_management', 'update');
  if (!ok) throw HttpError.forbidden('Enabling SSO sign-in needs the user-management permission');
}

async function saveSsoConfig(input, user = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw HttpError.badRequest('sso must be an object');
  }
  const cur = await readRaw();
  // Blank / masked secret = keep the one already stored (never persist the placeholder).
  const curSecret = decryptSecret(cur.clientSecret || '');
  const nextSecret = isBlankOrMasked(input.clientSecret) ? curSecret : String(input.clientSecret).slice(0, 400);

  const issuer = String(input.issuer || '').trim().slice(0, 300);
  const clientId = String(input.clientId || '').trim().slice(0, 300);
  const redirectUri = String(input.redirectUri || '').trim().slice(0, 400);
  const enabled = !!input.enabled;

  if (enabled) {
    if (!issuer || !clientId || !redirectUri) {
      throw HttpError.badRequest('SSO needs an issuer, a client ID and a redirect URI');
    }
    if (!nextSecret) throw HttpError.badRequest('SSO needs a client secret');
    if (!/^https:\/\//i.test(issuer)) throw HttpError.badRequest('SSO issuer must be an https URL');
    try { void new URL(redirectUri); } catch { throw HttpError.badRequest('Redirect URI must be a full URL'); }
  }

  const payload = {
    enabled,
    issuer,
    clientId,
    clientSecret: encryptSecret(nextSecret),
    redirectUri,
    allowedDomains: normDomains(input.allowedDomains),
    buttonLabel: String(input.buttonLabel || '').trim().slice(0, 60),
    requireSso: !!input.requireSso,
  };
  await assertSignInRights(payload.enabled, user);
  await query('UPDATE app_settings SET sso_json = $1::jsonb WHERE id = 1', [JSON.stringify(payload)]);
  return getSsoForUi();
}

module.exports = { getSsoConfig, getSsoForUi, saveSsoConfig };
