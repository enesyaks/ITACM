'use strict';

/**
 * Delegated ("connect your mailbox") OAuth2 — the Jira-style flow. An operator
 * registers ITACM once as an OAuth app at Microsoft and/or Google (client id +
 * secret + redirect URI), then clicks Connect, signs in at the provider, and
 * ITACM keeps a refresh token. One connection serves both the IMAP poller and
 * the SMTP sender; no password or per-mailbox app secret is ever typed.
 *
 * This lives alongside the app-only (client-credentials) support in
 * inboundMailService/notificationService — it is an additional auth method, not a
 * replacement, and password auth stays the default.
 */
const jwt = require('jsonwebtoken');
const { query } = require('./pool');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { HttpError } = require('../../utils/httpError');
const config = require('../../config');
const {
  PROVIDERS, buildAuthorizeUrl, exchangeCode, getAccessTokenFromRefresh, emailFromIdToken,
} = require('../../utils/mailOAuth');

const SUPPORTED = ['microsoft', 'google'];

function isBlankOrMasked(v) { return !v || /^[*•]+$/.test(String(v)); }

async function appBaseUrl() {
  const { rows } = await query('SELECT notify_json FROM app_settings WHERE id = 1');
  const stored = (rows[0] && rows[0].notify_json && rows[0].notify_json.appUrl) || '';
  return String(stored).trim() || process.env.APP_URL || process.env.PUBLIC_URL || 'http://localhost:8000';
}

async function redirectUri() {
  return `${(await appBaseUrl()).replace(/\/+$/, '')}/api/integrations/mail-oauth/callback`;
}

/** The registered ITACM OAuth apps, secrets decrypted — internal use only. */
async function getAppsRaw() {
  const { rows } = await query('SELECT mail_oauth_apps FROM app_settings WHERE id = 1');
  const j = (rows[0] && rows[0].mail_oauth_apps) || {};
  const one = (p) => {
    const a = j[p] || {};
    let secret = '';
    try { secret = a.clientSecret ? decryptSecret(a.clientSecret) : ''; } catch { secret = ''; }
    return { clientId: a.clientId || '', clientSecret: secret, tenant: a.tenant || '' };
  };
  return { microsoft: one('microsoft'), google: one('google') };
}

/** Masked view for the UI. */
async function getApps() {
  const raw = await getAppsRaw();
  const mask = (a) => ({ clientId: a.clientId, tenant: a.tenant, clientSecret: a.clientSecret ? '••••••••' : '', hasSecret: !!a.clientSecret });
  return { microsoft: mask(raw.microsoft), google: mask(raw.google), redirectUri: await redirectUri() };
}

async function saveApps(input = {}) {
  const cur = await getAppsRaw();
  const stored = {};
  for (const p of SUPPORTED) {
    const inP = (input && input[p]) || {};
    const nextSecret = isBlankOrMasked(inP.clientSecret) ? (cur[p].clientSecret || '') : String(inP.clientSecret);
    stored[p] = {
      clientId: String(inP.clientId != null ? inP.clientId : cur[p].clientId || '').trim().slice(0, 300),
      tenant: String(inP.tenant != null ? inP.tenant : cur[p].tenant || '').trim().slice(0, 200),
      clientSecret: nextSecret ? encryptSecret(nextSecret) : null,
    };
  }
  await query('UPDATE app_settings SET mail_oauth_apps = $1::jsonb WHERE id = 1', [JSON.stringify(stored)]);
  return getApps();
}

/** Begin the connect flow: validate the app is configured, return the consent URL. */
async function startConnect(provider) {
  if (!SUPPORTED.includes(provider)) throw HttpError.badRequest('Unsupported provider');
  const apps = await getAppsRaw();
  const app = apps[provider];
  if (!app.clientId || !app.clientSecret) {
    throw HttpError.badRequest(`Set the ${provider} client ID and secret first (Integrations → Mail OAuth apps)`);
  }
  // Signed, short-lived state carries the provider and a nonce — no server-side
  // session needed and it cannot be forged (CSRF protection on the callback).
  const state = jwt.sign(
    { p: provider, purpose: 'mail-oauth' },
    config.jwtSecret,
    { expiresIn: '10m', issuer: 'itacm', jwtid: require('crypto').randomUUID() }
  );
  const redirect = await redirectUri();
  // The redirect URI is the single most common reason this flow fails, and the
  // failure happens AT the provider — Google refuses before redirecting back, so
  // no callback ever reaches us and the access log shows only a 200 on /start.
  // Without this line there is nothing anywhere to compare against the value
  // registered with the provider. Neither field is a secret: both travel in the
  // browser's address bar on the very next hop.
  console.log('[mail-oauth] authorize:', provider, '| redirect_uri:', redirect);
  const url = buildAuthorizeUrl({
    provider, tenant: app.tenant, clientId: app.clientId,
    redirectUri: redirect, state,
  });
  // State is returned so the route can also stash it in an HttpOnly cookie and
  // bind the callback to the same browser (CSRF protection), matching SSO.
  return { url, state };
}

/** Finish the connect flow: verify state, exchange the code, store the connection. */
async function handleCallback({ code, state, cookieState }) {
  if (!code || !state) throw HttpError.badRequest('Missing code or state');
  // The state must match the one stashed in this browser's cookie at /start — a
  // callback that did not originate here is refused (CSRF).
  if (!cookieState || cookieState !== state) {
    throw HttpError.badRequest('This sign-in did not start here — open Connect mailbox again from ITACM');
  }
  let claims;
  // Pin the algorithm, like every other verify in the codebase.
  try { claims = jwt.verify(state, config.jwtSecret, { issuer: 'itacm', algorithms: ['HS256'] }); }
  catch { throw HttpError.badRequest('The sign-in link expired or was tampered with — try connecting again'); }
  if (!claims || claims.purpose !== 'mail-oauth' || !SUPPORTED.includes(claims.p)) {
    throw HttpError.badRequest('Invalid sign-in state');
  }
  const provider = claims.p;
  const apps = await getAppsRaw();
  const app = apps[provider];
  if (!app.clientId || !app.clientSecret) throw HttpError.badRequest('OAuth app is no longer configured');

  const tokens = await exchangeCode({
    provider, tenant: app.tenant, clientId: app.clientId, clientSecret: app.clientSecret,
    code, redirectUri: await redirectUri(),
  });
  if (!tokens.refresh_token) {
    // Without a refresh token the connection cannot outlive one access token.
    throw HttpError.badRequest('The provider returned no refresh token — re-consent is required (Google: revoke prior access and try again)');
  }
  const email = emailFromIdToken(tokens.id_token) || '';
  const conn = {
    provider, email,
    refreshToken: encryptSecret(tokens.refresh_token),
    connectedAt: new Date().toISOString(),
  };
  await query('UPDATE app_settings SET mail_oauth_conn = $1::jsonb WHERE id = 1', [JSON.stringify(conn)]);
  return { provider, email };
}

async function getConnRaw() {
  const { rows } = await query('SELECT mail_oauth_conn FROM app_settings WHERE id = 1');
  const j = (rows[0] && rows[0].mail_oauth_conn) || null;
  if (!j || !j.provider) return null;
  let refreshToken = '';
  try { refreshToken = j.refreshToken ? decryptSecret(j.refreshToken) : ''; } catch { refreshToken = ''; }
  return { provider: j.provider, email: j.email || '', refreshToken, connectedAt: j.connectedAt || null };
}

async function getStatus() {
  const conn = await getConnRaw();
  if (!conn) return { connected: false };
  return { connected: !!conn.refreshToken, provider: conn.provider, email: conn.email, connectedAt: conn.connectedAt };
}

async function disconnect() {
  await query('UPDATE app_settings SET mail_oauth_conn = NULL WHERE id = 1');
  return { connected: false };
}

/**
 * Mint an access token for the connected mailbox, for the IMAP client and the
 * SMTP transport. Returns the token plus the provider's host/port and the
 * connected address (the XOAUTH2 user). Persists a rotated refresh token.
 */
async function getDelegatedToken() {
  const conn = await getConnRaw();
  if (!conn || !conn.refreshToken) throw HttpError.badRequest('No mailbox is connected — use Connect mailbox in Integrations');
  const apps = await getAppsRaw();
  const app = apps[conn.provider];
  if (!app || !app.clientId || !app.clientSecret) throw HttpError.badRequest('The OAuth app for this connection is not configured');
  const { accessToken, refreshToken } = await getAccessTokenFromRefresh({
    provider: conn.provider, tenant: app.tenant,
    clientId: app.clientId, clientSecret: app.clientSecret, refreshToken: conn.refreshToken,
  });
  if (refreshToken && refreshToken !== conn.refreshToken) {
    await query(
      "UPDATE app_settings SET mail_oauth_conn = jsonb_set(mail_oauth_conn, '{refreshToken}', to_jsonb($1::text)) WHERE id = 1",
      [encryptSecret(refreshToken)]
    );
  }
  const p = PROVIDERS[conn.provider];
  return {
    accessToken, user: conn.email, provider: conn.provider,
    imapHost: p.imapHost, imapPort: p.imapPort, smtpHost: p.smtpHost, smtpPort: p.smtpPort,
  };
}

module.exports = {
  getApps, getAppsRaw, saveApps, startConnect, handleCallback,
  getStatus, disconnect, getDelegatedToken, redirectUri, SUPPORTED,
};
