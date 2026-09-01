'use strict';

/**
 * Thin LDAP/AD helper over `ldapts`.
 *
 * Scope note on outbound safety: unlike webhooks and the AI provider, a
 * directory server is *supposed* to live on a private network, so the
 * SSRF guard in safeOutbound.js is deliberately NOT applied here — it would
 * reject every real deployment. What protects this path instead is that the
 * URL is configured by a holder of `integration:manage` (never supplied by a
 * requester), and that only the scheme and port are accepted below.
 */
const { Client } = require('ldapts');
const { HttpError } = require('./httpError');

const CONNECT_TIMEOUT_MS = 8000;
const OPERATION_TIMEOUT_MS = 20000;

/** RFC 4515 §3 — escape the characters that would otherwise change a filter's meaning. */
function escapeFilter(value) {
  return String(value == null ? '' : value).replace(/[\\*()\0/]/g, (ch) => {
    switch (ch) {
      case '\\': return '\\5c';
      case '*': return '\\2a';
      case '(': return '\\28';
      case ')': return '\\29';
      case '\0': return '\\00';
      case '/': return '\\2f';
      default: return ch;
    }
  });
}

/**
 * Substitute the login name into a configured filter template.
 * The value is escaped first, so `*)(objectClass=*` can never widen the search.
 */
function renderFilter(template, username) {
  const safe = escapeFilter(username);
  return String(template || '').replace(/\{\{\s*username\s*\}\}/g, safe);
}

/**
 * AD returns objectGUID as a 16-byte binary value in a mixed-endian layout;
 * OpenLDAP's entryUUID is already a canonical string. Normalise both to the
 * usual 8-4-4-4-12 form so one column can key either directory.
 */
function normalizeGuid(value) {
  if (value == null) return '';
  if (Buffer.isBuffer(value)) {
    if (value.length !== 16) return value.toString('hex');
    const h = [...value].map((b) => b.toString(16).padStart(2, '0'));
    return [
      h[3] + h[2] + h[1] + h[0],
      h[5] + h[4],
      h[7] + h[6],
      h[8] + h[9],
      h.slice(10).join(''),
    ].join('-');
  }
  return String(value).trim();
}

/** Read one attribute off a search entry, tolerating arrays and Buffers. */
function attr(entry, name) {
  if (!entry || !name) return '';
  const v = entry[name];
  if (v == null) return '';
  const one = Array.isArray(v) ? v[0] : v;
  if (one == null) return '';
  return Buffer.isBuffer(one) ? one.toString('utf8') : String(one);
}

function assertUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) throw HttpError.badRequest('A directory URL is required (ldap:// or ldaps://)');
  let parsed;
  try { parsed = new URL(raw); } catch { throw HttpError.badRequest('The directory URL is not a valid URL'); }
  if (!['ldap:', 'ldaps:'].includes(parsed.protocol)) {
    throw HttpError.badRequest('The directory URL must start with ldap:// or ldaps://');
  }
  if (parsed.port && !/^\d+$/.test(parsed.port)) throw HttpError.badRequest('Invalid directory port');
  // Credentials in the URL would be stored and echoed back in cleartext — the
  // bind password has its own encrypted field precisely so it never sits here.
  if (parsed.username || parsed.password) {
    throw HttpError.badRequest('Put the account in the bind DN and password fields, not in the URL');
  }
  return raw;
}

/**
 * Open a connection and bind. `cfg.tlsRejectUnauthorized === false` is an
 * explicit, per-instance opt-out for the self-signed certificates that internal
 * ADs commonly use; it is off by default and surfaced as a warning in the UI.
 */
async function connect(cfg, { dn, password } = {}) {
  const url = assertUrl(cfg.url);
  const client = new Client({
    url,
    timeout: OPERATION_TIMEOUT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    tlsOptions: url.startsWith('ldaps:')
      ? { rejectUnauthorized: cfg.tlsRejectUnauthorized !== false }
      : undefined,
  });
  const bindDn = dn !== undefined ? dn : cfg.bindDn;
  const bindPassword = password !== undefined ? password : cfg.bindPassword;
  // An empty password makes most servers fall back to an *unauthenticated* bind
  // that succeeds without verifying anything — the classic LDAP auth bypass.
  // Refuse it here so no caller can accidentally rely on it.
  if (!String(bindPassword || '')) {
    await client.unbind().catch(() => {});
    throw HttpError.badRequest('A bind password is required (an empty password would be an anonymous bind)');
  }
  await client.bind(String(bindDn || ''), String(bindPassword));
  return client;
}

async function search(client, base, options = {}) {
  const { searchEntries } = await client.search(String(base || ''), {
    scope: options.scope || 'sub',
    filter: options.filter || '(objectClass=*)',
    attributes: options.attributes,
    sizeLimit: options.sizeLimit || 0,
    explicitBufferAttributes: ['objectGUID', 'objectSid'],
    paged: options.paged !== false ? { pageSize: 500 } : undefined,
  });
  return searchEntries || [];
}

async function close(client) {
  if (!client) return;
  await client.unbind().catch(() => {});
}

/** Turn an ldapts/network failure into a message an admin can act on. */
function describeError(err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  // ldapts reports protocol failures as a numeric result code with a terse
  // message ("Code: 0x31 InvalidCredentialsError"), so read the code first.
  const code = Number(err && (err.code != null ? err.code : err.resultCode));
  if (code === 49) return 'Invalid credentials — check the bind DN and password';
  if (code === 32) return 'Base DN not found — check the search base';
  if (code === 34) return 'Malformed DN — check the bind DN or search base';
  if (code === 50) return 'The bind account is not allowed to read that part of the directory';
  if (/ECONNREFUSED/i.test(msg)) return 'Connection refused — check the host and port';
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Host not found — check the directory URL';
  if (/ETIMEDOUT|timeout/i.test(msg)) return 'Timed out — the server did not answer';
  if (/self.signed|unable to verify|certificate/i.test(msg)) {
    return 'TLS certificate rejected — install the CA, or turn off certificate verification for this internal server';
  }
  if (/invalid credentials|data 52e/i.test(msg)) return 'Invalid credentials — check the bind DN and password';
  if (/data 525/i.test(msg)) return 'The bind account does not exist';
  if (/data 532|data 773/i.test(msg)) return 'The bind account password has expired';
  if (/data 533|data 775/i.test(msg)) return 'The bind account is disabled or locked out';
  if (/no such object/i.test(msg)) return 'Base DN not found — check the search base';
  return msg;
}

module.exports = {
  connect, search, close,
  escapeFilter, renderFilter, normalizeGuid, attr, assertUrl, describeError,
};
