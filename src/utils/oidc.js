'use strict';

/**
 * OpenID Connect client — Authorization Code flow with PKCE.
 *
 * Stateless about config: every entry point takes an already-resolved `cfg`
 * (from ssoService: DB or env). All token handling is server-side; openid-client
 * validates the ID-token signature against the provider JWKS and checks iss /
 * aud / exp / nonce; PKCE binds the code to this browser and state guards CSRF.
 *
 * Written against openid-client v6, which dropped the v5 `Issuer` class and
 * `generators` helper for standalone functions. Keeping the v5 shape here after
 * the dependency moved is what made every sign-in fail with
 * "Cannot read properties of undefined (reading 'discover')".
 */
const oidcClient = require('openid-client');
const { HttpError } = require('./httpError');

/** True when SSO is on AND every required field is present. */
function isReady(cfg) {
  return !!(cfg && cfg.enabled && cfg.issuer && cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

// Cache the discovered configuration, keyed by the config that produced it, so a
// config change in the UI transparently rebuilds it.
let cache = { sig: null, config: null };
function sigOf(cfg) {
  return [cfg.issuer, cfg.clientId, cfg.redirectUri, cfg.clientSecret ? 'y' : 'n'].join('|');
}

/** Discovered provider metadata + client credentials, ready to use. */
async function getConfig(cfg) {
  if (!isReady(cfg)) throw HttpError.badRequest('SSO is not enabled or is misconfigured');
  const sig = sigOf(cfg);
  if (cache.sig === sig && cache.config) return cache.config;
  const config = await oidcClient.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
  cache = { sig, config };
  return config;
}

/** Verify the provider is reachable and returns valid OIDC metadata (no login). */
async function discover(cfg) {
  if (!cfg || !cfg.issuer) throw HttpError.badRequest('Set the issuer URL first');
  // Discovery alone needs no client credentials, so this still answers for a
  // half-filled form — which is the point of the "Test" button.
  const config = await oidcClient.discovery(new URL(cfg.issuer), cfg.clientId || 'discovery-probe');
  const meta = config.serverMetadata();
  return {
    issuer: meta.issuer,
    authorizationEndpoint: meta.authorization_endpoint || null,
    tokenEndpoint: meta.token_endpoint || null,
    jwksUri: meta.jwks_uri || null,
  };
}

/**
 * Start a login: returns the IdP redirect URL + PKCE verifier / state / nonce.
 *
 * `prompt` is passed through to the provider. Left unset on a normal sign-in,
 * which is the point of SSO: an existing session should not be re-challenged.
 * The login screen sends 'select_account' after a refusal, where the opposite is
 * true — the provider would otherwise replay the identity that was just turned
 * away and the person could never reach the account picker.
 */
async function beginAuth(cfg, { prompt } = {}) {
  const config = await getConfig(cfg);
  const codeVerifier = oidcClient.randomPKCECodeVerifier();
  const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
  const state = oidcClient.randomState();
  const nonce = oidcClient.randomNonce();
  const url = oidcClient.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    ...(prompt ? { prompt } : {}),
  }).href;
  return { url, codeVerifier, state, nonce };
}

/** Finish a login: exchange the code and return the verified ID-token claims. */
async function completeAuth(cfg, callbackUrl, { codeVerifier, state, nonce }) {
  const config = await getConfig(cfg);
  const tokens = await oidcClient.authorizationCodeGrant(config, new URL(callbackUrl), {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce,
  });
  const claims = tokens.claims();
  if (!claims) throw HttpError.unauthorized('The provider returned no ID token');
  return claims;
}

module.exports = { isReady, discover, beginAuth, completeAuth };
