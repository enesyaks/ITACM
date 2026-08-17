/**
 * Guard: the outbound SSRF filter must reject every spelling of a private /
 * loopback / link-local / metadata address, including the IPv6 forms that alias
 * or embed an IPv4 — IPv4-mapped in hex (::ffff:7f00:1), fully-expanded loopback
 * (0:0:0:0:0:0:0:1), NAT64 (64:ff9b::/96) and deprecated IPv4-compatible
 * (::a.b.c.d). Before the fix these bypassed isPrivateOrReservedIp because
 * normalizeIp only unwrapped the dotted-decimal `::ffff:` spelling, letting an
 * SMTP/AI host reach localhost or 169.254.169.254.
 *
 * Static (no DB / no network): node --test tests/ssrf-ip-guard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isPrivateOrReservedIp } = require('../src/utils/safeOutbound');

const MUST_BLOCK = [
  // IPv4-mapped IPv6, hex spelling
  ['::ffff:7f00:1', '127.0.0.1'],
  ['::ffff:a9fe:a9fe', '169.254.169.254 metadata'],
  ['::ffff:0a00:0001', '10.0.0.1'],
  ['::ffff:c0a8:0101', '192.168.1.1'],
  // IPv4-mapped IPv6, dotted spelling
  ['::ffff:127.0.0.1', '127.0.0.1 dotted'],
  ['::ffff:169.254.169.254', 'metadata dotted'],
  // IPv4-compatible (deprecated) and loopback spellings
  ['::127.0.0.1', 'compat loopback'],
  ['::1', 'loopback'],
  ['0:0:0:0:0:0:0:1', 'expanded loopback'],
  ['::', 'unspecified'],
  ['0:0:0:0:0:0:0:0', 'expanded unspecified'],
  // NAT64 well-known prefix embedding a private/link-local v4
  ['64:ff9b::a9fe:a9fe', 'NAT64 → 169.254.169.254'],
  ['64:ff9b::7f00:1', 'NAT64 → 127.0.0.1'],
  // Native IPv6 ULA / link-local
  ['fe80::1', 'link-local'],
  ['fc00::1', 'ULA'],
  ['fd12:3456::1', 'ULA'],
  // Zone-id suffix must not defeat the check
  ['fe80::1%eth0', 'link-local w/ zone'],
  // Plain IPv4 private ranges
  ['127.0.0.1', 'loopback v4'],
  ['10.1.2.3', 'RFC1918 10/8'],
  ['192.168.0.1', 'RFC1918 192.168/16'],
  ['172.16.0.1', 'RFC1918 172.16/12 low'],
  ['172.31.255.255', 'RFC1918 172.16/12 high'],
  ['169.254.169.254', 'link-local metadata'],
  ['100.64.0.1', 'CGNAT low'],
  ['100.127.255.255', 'CGNAT high'],
  ['0.0.0.0', 'unspecified v4'],
];

const MUST_ALLOW = [
  ['8.8.8.8', 'public DNS'],
  ['1.1.1.1', 'public DNS'],
  ['93.184.216.34', 'example.com'],
  ['2001:4860:4860::8888', 'public IPv6 DNS'],
  ['2606:4700::1111', 'public IPv6'],
  // Just outside RFC1918 172.16/12
  ['172.15.0.1', 'below 172.16/12'],
  ['172.32.0.1', 'above 172.16/12'],
  // Just outside CGNAT 100.64/10
  ['100.63.255.255', 'below 100.64/10'],
  ['100.128.0.0', 'above 100.64/10'],
];

test('SSRF filter blocks every private/loopback/metadata spelling', () => {
  for (const [ip, why] of MUST_BLOCK) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected BLOCK ${ip} (${why})`);
  }
});

test('SSRF filter allows genuine public addresses (no false positives)', () => {
  for (const [ip, why] of MUST_ALLOW) {
    assert.equal(isPrivateOrReservedIp(ip), false, `expected ALLOW ${ip} (${why})`);
  }
});

test('empty / nullish input fails closed (treated as private)', () => {
  // isPrivateOrReservedIp is only ever handed a literal IP or a DNS-resolved
  // address (hostnames go through the DNS path in resolveValidatedAddrs), so its
  // contract is: an absent address is unsafe. Non-IP strings are out of scope —
  // the URL/host layer rejects them before this function is reached.
  for (const bad of ['', null, undefined, '   ']) {
    assert.equal(isPrivateOrReservedIp(bad), true, `expected BLOCK for empty ${JSON.stringify(bad)}`);
  }
});
