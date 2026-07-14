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

async function resolveAndAssertPublicHost(hostname, { field = 'host', allowPrivate = false } = {}) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) throw HttpError.badRequest(`${field} is required`);
  if (hostLooksDangerous(host)) {
    throw HttpError.badRequest(`${field} must not target localhost or internal names`);
  }
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateOrReservedIp(host)) {
      throw HttpError.badRequest(`${field} must not be a private or reserved IP`);
    }
    return host;
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
  return host;
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

function smtpAllowsPrivate() {
  return ['1', 'true', 'yes'].includes(String(process.env.SMTP_ALLOW_PRIVATE || '').toLowerCase());
}

module.exports = {
  isPrivateOrReservedIp,
  hostLooksDangerous,
  resolveAndAssertPublicHost,
  assertSafeOutboundUrl,
  smtpAllowsPrivate,
};
