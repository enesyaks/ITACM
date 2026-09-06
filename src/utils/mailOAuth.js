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
    tokenUrl: (tenant) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    scope: 'https://outlook.office365.com/.default',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
  },
};

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
  let res; let data;
  try {
    res = await fetch(p.tokenUrl(tenant), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    throw new Error(`OAuth2 token endpoint unreachable: ${(err && err.message) || 'network error'}`);
  }
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth2 token refused: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  }
  cache.set(key, { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/** Drop a cached token (used when a connection is rejected as unauthorized). */
function forgetMailToken({ provider, tenant, clientId } = {}) {
  cache.delete(`${provider}:${tenant}:${clientId}`);
}

module.exports = { getMailToken, forgetMailToken, PROVIDERS };
