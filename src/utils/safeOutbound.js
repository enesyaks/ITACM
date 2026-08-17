/**
 * Outbound SSRF guards for Owner-configured webhooks / SMTP hosts.
 * Blocks loopback, link-local, RFC1918, unique-local IPv6, and cloud metadata.
 */
const net = require('net');
const dns = require('dns').promises;
const { HttpError } = require('./httpError');
const { sanitizeHttpUrl } = require('./httpUrl');
const { normalizeIp } = require('./setupAccess');

/**
 * Expand any valid IPv6 literal to its 16 bytes (handles `::` compression and an
 * embedded dotted-IPv4 tail). Returns null for non-IPv6 input. Used to canonicalize
 * IPv4-mapped / -compatible / NAT64 / loopback forms so they can't dodge the
 * IPv4/loopback string checks below (e.g. `::ffff:7f00:1` == 127.0.0.1).
 */
function ipv6ToBytes(input) {
  let s = String(input || '').toLowerCase().replace(/%.*$/, ''); // drop zone id
  if (net.isIP(s) !== 6) return null;
  // Fold an embedded dotted IPv4 tail (::ffff:127.0.0.1, ::127.0.0.1) into two hextets.
  const m = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) {
    const [a, b, c, d] = m[1].split('.').map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = s.slice(0, s.length - m[1].length)
      + (((a << 8) | b).toString(16)) + ':' + (((c << 8) | d).toString(16));
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPrivateOrReservedIp(ip) {
  let s = String(ip || '').trim().toLowerCase().replace(/%.*$/, '');
  if (!s) return true;
  // Canonicalize IPv6 forms that alias/embed IPv4 or loopback BEFORE normalizeIp,
  // whose `::ffff:` strip only handles the dotted-decimal spelling. Without this,
  // hex-mapped (::ffff:7f00:1 → 127.0.0.1), fully-expanded loopback (0:0:0:0:0:0:0:1),
  // NAT64 (64:ff9b::a9fe:a9fe → 169.254.169.254) and IPv4-compatible (::a.b.c.d)
  // literals slip straight past the IPv4/loopback checks below.
  if (net.isIP(s) === 6) {
    const b = ipv6ToBytes(s);
    if (b) {
      const zeroTo = (n) => b.slice(0, n).every((x) => x === 0);
      if (zeroTo(16)) return true;                 // :: unspecified
      if (zeroTo(15) && b[15] === 1) return true;  // ::1 loopback (any spelling)
      const mapped = zeroTo(10) && b[10] === 0xff && b[11] === 0xff; // ::ffff:0:0/96
      const compat = zeroTo(12);                                     // ::a.b.c.d (deprecated)
      const nat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b
        && b.slice(4, 12).every((x) => x === 0);                     // 64:ff9b::/96
      if (mapped || compat || nat64) {
        // Re-check the embedded IPv4 against the rules below.
        s = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
      }
    }
  }
  s = normalizeIp(s);
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
  // Docker Desktop / Compose host gateway — only reachable with allowPrivate/allowLocalhost.
  if (host === 'host.docker.internal') return true;
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal')) return true;
  if (host === 'kubernetes.default' || host === 'kubernetes.default.svc') return true;
  return false;
}

/**
 * Resolve a hostname and assert every candidate address is public.
 * @returns {Promise<Array<{address:string, family:number}>>} validated addresses
 *          (a single-entry list when `hostname` is already a literal IP).
 */
function isLocalhostName(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host === 'host.docker.internal';
}

async function resolveValidatedAddrs(hostname, {
  field = 'host',
  allowPrivate = false,
  allowLocalhost = false,
} = {}) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) throw HttpError.badRequest(`${field} is required`);
  // Local AI (Ollama) may explicitly opt into localhost; other outbound stays blocked.
  if (hostLooksDangerous(host) && !(allowLocalhost && isLocalhostName(host))) {
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
async function assertSafeOutboundUrl(raw, {
  max = 500, field = 'url', allowPrivate = false, allowLocalhost = false,
} = {}) {
  const href = sanitizeHttpUrl(raw, { max, field });
  if (!href) throw HttpError.badRequest(`${field} is required`);
  const u = new URL(href);
  await resolveAndAssertPublicHost(u.hostname, { field, allowPrivate, allowLocalhost });
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
async function assertSafeOutboundUrlPinned(raw, {
  max = 500, field = 'url', allowPrivate = false, allowLocalhost = false,
} = {}) {
  const href = sanitizeHttpUrl(raw, { max, field });
  if (!href) throw HttpError.badRequest(`${field} is required`);
  const u = new URL(href);
  const addrs = await resolveValidatedAddrs(u.hostname, { field, allowPrivate, allowLocalhost });
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
  isLocalhostName,
  resolveValidatedAddrs,
  resolveAndAssertPublicHost,
  assertSafeOutboundUrl,
  assertSafeOutboundUrlPinned,
  smtpAllowsPrivate,
};
