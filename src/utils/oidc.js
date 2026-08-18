'use strict';

/**
 * OpenID Connect client — Authorization Code flow with PKCE.
 *
 * Stateless about config: every entry point takes an already-resolved `cfg`
 * (from ssoService: DB or env). All token handling is server-side; openid-client
 * validates the ID-token signature against the provider JWKS and checks iss /
 * aud / exp / nonce; PKCE binds the code to this browser and state guards CSRF.
 */
const { Issuer, generators } = require('openid-client');
const { HttpError } = require('./httpError');

/** True when SSO is on AND every required field is present. */
function isReady(cfg) {
  return !!(cfg && cfg.enabled && cfg.issuer && cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

// Cache the discovered client, keyed by the config that produced it, so a config
// change in the UI transparently rebuilds it.
let cache = { sig: null, client: null };
function sigOf(cfg) {
  return [cfg.issuer, cfg.clientId, cfg.redirectUri, cfg.clientSecret ? 'y' : 'n'].join('|');
}

async function getClient(cfg) {
  if (!isReady(cfg)) throw HttpError.badRequest('SSO is not enabled or is misconfigured');
  const sig = sigOf(cfg);
  if (cache.sig === sig && cache.client) return cache.client;
  const issuer = await Issuer.discover(cfg.issuer);
  const client = new issuer.Client({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uris: [cfg.redirectUri],
    response_types: ['code'],
  });
  cache = { sig, client };
  return client;
}

/** Verify the provider is reachable and returns valid OIDC metadata (no login). */
async function discover(cfg) {
  if (!cfg || !cfg.issuer) throw HttpError.badRequest('Set the issuer URL first');
  const issuer = await Issuer.discover(cfg.issuer);
  return {
    issuer: issuer.metadata.issuer,
    authorizationEndpoint: issuer.metadata.authorization_endpoint || null,
    tokenEndpoint: issuer.metadata.token_endpoint || null,
    jwksUri: issuer.metadata.jwks_uri || null,
  };
}

/** Start a login: returns the IdP redirect URL + PKCE verifier / state / nonce. */
async function beginAuth(cfg) {
  const client = await getClient(cfg);
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();
  const url = client.authorizationUrl({
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url, codeVerifier, state, nonce };
}

/** Finish a login: exchange the code and return the verified ID-token claims. */
async function completeAuth(cfg, callbackUrl, { codeVerifier, state, nonce }) {
  const client = await getClient(cfg);
  const params = client.callbackParams(callbackUrl);
  const tokenSet = await client.callback(cfg.redirectUri, params, {
    code_verifier: codeVerifier,
    state,
    nonce,
  });
  return tokenSet.claims();
}

module.exports = { isReady, discover, beginAuth, completeAuth };
