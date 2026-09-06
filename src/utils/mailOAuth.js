'use strict';

/**
 * OAuth2 access tokens for mail (IMAP + SMTP), using the app-only
 * client-credentials flow — no interactive sign-in, which suits an unattended
 * service-desk mailbox that the poller reads on a schedule.
 *
 * Provider-agnostic on purpose: Microsoft is wired up here, and Google slots in
 * as another entry in PROVIDERS with the same shape. Both IMAP and SMTP use the
 * same token, so callers ask for one token and pass it to whichever transport.
 *
 * Basic auth (username + password) still works and stays the default; this is
 * only reached when a mailbox declares authMethod: 'oauth2_ms'. It exists
 * because Microsoft turned basic auth off for Exchange Online and, since 2024,
 * for personal Outlook.com — a password simply will not connect there anymore.
 */

const PROVIDERS = {
  // Microsoft 365 / Exchange Online, app-only. The IMAP.AccessAsApp /
  // SMTP.SendAsApp permissions are granted to the registered app and scoped to
  // the one mailbox with an Exchange ApplicationAccessPolicy.
  microsoft: {
    tokenUrl: (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'organizations')}/oauth2/v2.0/token`,
    authorizeUrl: (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/authorize`,
    scope: 'https://outlook.office365.com/.default',
    // Delegated: a user consents to these on their own mailbox. offline_access is
    // what yields a refresh token; openid+email let us read the connected address.
    delegatedScope: 'openid email offline_access https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
  },
  // Google (Gmail / Workspace), delegated only — Google has no app-only IMAP.
  google: {
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    authorizeUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    // https://mail.google.com/ is the full-mailbox scope IMAP + SMTP need.
    delegatedScope: 'openid email https://mail.google.com/',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
  },
};

/** Build the provider's consent URL for the delegated "connect mailbox" flow. */
function buildAuthorizeUrl({ provider, tenant, clientId, redirectUri, state }) {
  const p = PROVIDERS[provider];
  if (!p || !p.authorizeUrl) throw new Error(`Provider does not support delegated OAuth: ${provider}`);
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: p.delegatedScope,
    state,
  });
  // Google only returns a refresh token when asked offline + forced to re-consent.
  if (provider === 'google') { params.set('access_type', 'offline'); params.set('prompt', 'consent'); }
  return `${p.authorizeUrl(tenant)}?${params.toString()}`;
}

/** Exchange an authorization code for tokens (delegated flow). */
async function exchangeCode({ provider, tenant, clientId, clientSecret, code, redirectUri }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown mail OAuth provider: ${provider}`);
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  });
  if (provider === 'microsoft') body.set('scope', p.delegatedScope);
  return postToken(p.tokenUrl(tenant), body);
}

/** Mint a fresh access token from a stored refresh token (delegated flow). */
async function getAccessTokenFromRefresh({ provider, tenant, clientId, clientSecret, refreshToken }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown mail OAuth provider: ${provider}`);
  const cacheKey = `refresh:${provider}:${clientId}:${String(refreshToken).slice(-12)}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.exp - 60000 > now) return { accessToken: hit.token, refreshToken };
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token', refresh_token: refreshToken,
  });
  if (provider === 'microsoft') body.set('scope', p.delegatedScope);
  const data = await postToken(p.tokenUrl(tenant), body);
  cache.set(cacheKey, { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 });
  // Providers may hand back a rotated refresh token — pass it up so it is stored.
  return { accessToken: data.access_token, refreshToken: data.refresh_token || refreshToken };
}

/** POST to a token endpoint and return the parsed body, or throw the provider's error. */
async function postToken(url, body) {
  let res; let data;
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error(`OAuth2 token endpoint unreachable: ${(err && err.message) || 'network error'}`);
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth2 token refused: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  return data;
}

/** Best-effort read of the connected address from an id_token (no verification). */
function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8'));
    return String(payload.email || payload.preferred_username || payload.upn || '').trim().toLowerCase();
  } catch { return ''; }
}

// token cache, keyed by provider+tenant+client so one warm token serves every
// poll and every outbound mail until it is close to expiry.
const cache = new Map();

/**
 * Fetch (or reuse) an app-only access token. Throws a plain Error with the
 * provider's own error_description when the grant is refused, so the operator
 * sees exactly what Azure rejected (bad secret, missing consent, wrong tenant).
 */
async function getMailToken({ provider, tenant, clientId, clientSecret } = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown mail OAuth provider: ${provider}`);
  if (!tenant || !clientId || !clientSecret) {
    throw new Error('OAuth2 needs tenant, client ID and client secret');
  }

  const key = `${provider}:${tenant}:${clientId}`;
  const now = Date.now();
  const hit = cache.get(key);
  // Refresh a minute early so a token never expires mid-connection.
  if (hit && hit.exp - 60000 > now) return hit.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: p.scope,
  });
  const data = await postToken(p.tokenUrl(tenant), body);
  cache.set(key, { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/** Drop a cached token (used when a connection is rejected as unauthorized). */
function forgetMailToken({ provider, tenant, clientId } = {}) {
  cache.delete(`${provider}:${tenant}:${clientId}`);
}

module.exports = {
  getMailToken, forgetMailToken, PROVIDERS,
  buildAuthorizeUrl, exchangeCode, getAccessTokenFromRefresh, emailFromIdToken,
};
