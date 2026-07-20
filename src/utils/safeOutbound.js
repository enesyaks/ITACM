/**
 * Outbound SSRF guards for Owner-configured webhooks / SMTP hosts.
 * Blocks loopback, link-local, RFC1918, unique-local IPv6, and cloud metadata.
 */
const net = require('net');
const dns = require('dns').promises;
const { HttpError } = require('./httpError');
const { sanitizeHttpUrl } = require('./httpUrl');
const { normalizeIp } = require('./setupAccess');

function isPrivateOrReservedIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return true;
  if (s === '::1' || s === '0.0.0.0' || s === '::') return true;
  if (s === '127.0.0.1' || s.startsWith('127.')) return true;
  if (s.startsWith('10.')) return true;
  if (s.startsWith('192.168.')) return true;
  if (s.startsWith('169.254.')) return true;
  if (s.startsWith('100.64.') || s.startsWith('100.65.')
    || s.startsWith('100.66.') || s.startsWith('100.67.')
    || /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(s)) return true; // CGNAT 100.64/10
  const m172 = s.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  // IPv6 ULA / link-local
  if (/^(fc|fd)/i.test(s) || /^fe80:/i.test(s)) return true;
  return false;
}

function hostLooksDangerous(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal')) return true;
  if (host === 'kubernetes.default' || host === 'kubernetes.default.svc') return true;
  return false;
}

/**
 * Resolve a hostname and assert every candidate address is public.
 * @returns {Promise<Array<{address:string, family:number}>>} validated addresses
 *          (a single-entry list when `hostname` is already a literal IP).
 */
async function resolveValidatedAddrs(hostname, { field = 'host', allowPrivate = false } = {}) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) throw HttpError.badRequest(`${field} is required`);
  if (hostLooksDangerous(host)) {
    throw HttpError.badRequest(`${field} must not target localhost or internal names`);
  }
  const literal = net.isIP(host);
  if (literal) {
    if (!allowPrivate && isPrivateOrReservedIp(host)) {
      throw HttpError.badRequest(`${field} must not be a private or reserved IP`);
    }
    return [{ address: host, family: literal }];
  }
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw HttpError.badRequest(`Could not resolve ${field} "${host}"`);
  }
  if (!addrs.length) throw HttpError.badRequest(`Could not resolve ${field} "${host}"`);
  if (!allowPrivate) {
    for (const a of addrs) {
      if (isPrivateOrReservedIp(a.address)) {
        throw HttpError.badRequest(`${field} resolves to a private or reserved address`);
      }
    }
  }
  return addrs.map((a) => ({ address: a.address, family: a.family }));
}

async function resolveAndAssertPublicHost(hostname, opts = {}) {
  await resolveValidatedAddrs(hostname, opts);
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Validate http(s) webhook URL and ensure it does not resolve to private nets.
 * @returns {Promise<string>} normalized URL
 */
async function assertSafeOutboundUrl(raw, { max = 500, field = 'url', allowPrivate = false } = {}) {
  const href = sanitizeHttpUrl(raw, { max, field });
  if (!href) throw HttpError.badRequest(`${field} is required`);
  const u = new URL(href);
  await resolveAndAssertPublicHost(u.hostname, { field, allowPrivate });
  return href;
}

/**
 * Like assertSafeOutboundUrl, but also returns a `lookup` that pins the socket
 * to the exact address(es) validated here — closing the DNS-rebinding (TOCTOU)
 * window between validation and connect. Pass `lookup` to http(s).request; the
 * request still carries the original hostname, so Host header, TLS SNI and
 * certificate validation are unchanged.
 * @returns {Promise<{ href:string, lookup:Function }>}
 */
async function assertSafeOutboundUrlPinned(raw, { max = 500, field = 'url', allowPrivate = false } = {}) {
  const href = sanitizeHttpUrl(raw, { max, field });
  if (!href) throw HttpError.badRequest(`${field} is required`);
  const u = new URL(href);
  const addrs = await resolveValidatedAddrs(u.hostname, { field, allowPrivate });
  const lookup = (_hostname, options, cb) => {
    // Ignore the hostname entirely — only ever hand back pre-validated addresses,
    // so a rebind after validation cannot redirect the socket to a private IP.
    if (options && options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  };
  return { href, lookup };
}

function smtpAllowsPrivate() {
  return ['1', 'true', 'yes'].includes(String(process.env.SMTP_ALLOW_PRIVATE || '').toLowerCase());
}

module.exports = {
  isPrivateOrReservedIp,
  hostLooksDangerous,
  resolveValidatedAddrs,
  resolveAndAssertPublicHost,
  assertSafeOutboundUrl,
  assertSafeOutboundUrlPinned,
  smtpAllowsPrivate,
};
