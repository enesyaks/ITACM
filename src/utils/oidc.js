'use strict';

/**
 * OpenID Connect client — Authorization Code flow with PKCE.
 *
 * All token handling is server-side (backchannel). openid-client validates the
 * ID token signature against the provider's JWKS and checks iss / aud / exp /
 * nonce; PKCE (code_verifier) binds the code to this browser and state guards
 * CSRF. We never hand-roll any of that. Config is env-only (see config.sso).
 */
const { Issuer, generators } = require('openid-client');
const config = require('../config');
const { HttpError } = require('./httpError');

/** True when SSO is switched on AND every required setting is present. */
function isReady() {
  const s = config.sso;
  return !!(s.enabled && s.issuer && s.clientId && s.clientSecret && s.redirectUri);
}

let clientPromise = null;

async function getClient() {
  if (!config.sso.enabled) throw HttpError.badRequest('SSO is not enabled');
  if (!isReady()) {
    throw HttpError.badRequest(
      'SSO is misconfigured — set SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET and SSO_REDIRECT_URI'
    );
  }
  if (!clientPromise) {
    clientPromise = (async () => {
      const issuer = await Issuer.discover(config.sso.issuer);
      return new issuer.Client({
        client_id: config.sso.clientId,
        client_secret: config.sso.clientSecret,
        redirect_uris: [config.sso.redirectUri],
        response_types: ['code'],
      });
    })().catch((err) => { clientPromise = null; throw err; }); // don't cache a failed discovery
  }
  return clientPromise;
}

/**
 * Start a login: returns the IdP redirect URL plus the PKCE verifier, state and
 * nonce the caller must stash (in a signed, HttpOnly cookie) for the callback.
 */
async function beginAuth() {
  const client = await getClient();
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

/**
 * Finish a login: exchange the code and return the verified ID-token claims.
 * openid-client enforces state, nonce, PKCE and full ID-token validation here.
 */
async function completeAuth(callbackUrl, { codeVerifier, state, nonce }) {
  const client = await getClient();
  const params = client.callbackParams(callbackUrl);
  const tokenSet = await client.callback(config.sso.redirectUri, params, {
    code_verifier: codeVerifier,
    state,
    nonce,
  });
  return tokenSet.claims();
}

module.exports = { isReady, beginAuth, completeAuth };
