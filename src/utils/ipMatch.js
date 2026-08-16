'use strict';

/**
 * Dependency-free IP / CIDR matching, used to exempt trusted networks (e.g. an
 * office egress IP behind NAT) from the coarse per-IP rate limit. Handles bare
 * IPs (exact match), IPv4 CIDRs, and IPv6 CIDRs — including IPv4-mapped v6.
 */

function v4Bytes(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const b = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return b.every((n) => n >= 0 && n <= 255) ? b : null;
}

function v6Bytes(ip) {
  let s = String(ip);
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4) → fold into two hextets.
  const tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const b = v4Bytes(tail[2]);
    if (!b) return null;
    s = tail[1] + (((b[0] << 8) | b[1]).toString(16)) + ':' + (((b[2] << 8) | b[3]).toString(16));
  }
  if (s.indexOf(':') === -1) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const back = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (back === null) {
    groups = head;
  } else {
    const fill = 8 - head.length - back.length;
    if (fill < 0) return null;
    groups = head.concat(Array(fill).fill('0'), back);
  }
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function toBytes(ip) {
  const v4 = v4Bytes(ip);
  if (v4) return v4;
  const v6 = v6Bytes(ip);
  if (!v6) return null;
  // Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d) to 4 bytes so it matches v4 CIDRs.
  const mapped = v6.slice(0, 12).every((b, i) => (i < 10 ? b === 0 : b === 0xff));
  return mapped ? v6.slice(12) : v6;
}

/** Is `ip` inside `cidr`? `cidr` may be a bare address (exact) or addr/prefix. */
function ipInCidr(ip, cidr) {
  if (!ip || !cidr) return false;
  const slash = cidr.indexOf('/');
  const net = slash === -1 ? cidr : cidr.slice(0, slash);
  const ipB = toBytes(ip);
  const netB = toBytes(net);
  if (!ipB || !netB || ipB.length !== netB.length) return false;
  const bits = slash === -1 ? ipB.length * 8 : Number(cidr.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0 || bits > ipB.length * 8) return false;
  let remaining = bits;
  for (let i = 0; i < ipB.length && remaining > 0; i += 1) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((ipB[i] & mask) !== (netB[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

/** True if `ip` matches any entry in `list` (array of IPs/CIDRs). */
function ipInCidrList(ip, list) {
  return Array.isArray(list) && list.some((c) => ipInCidr(ip, c));
}

module.exports = { ipInCidr, ipInCidrList, toBytes };
