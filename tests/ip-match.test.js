/**
 * CIDR matching for the trusted-network rate-limit exemption. Pure logic, no DB.
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ipInCidr, ipInCidrList } = require('../src/utils/ipMatch');

test('ipInCidr — IPv4', () => {
  assert.equal(ipInCidr('203.0.113.7', '203.0.113.0/24'), true);
  assert.equal(ipInCidr('203.0.114.7', '203.0.113.0/24'), false);
  assert.equal(ipInCidr('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(ipInCidr('11.1.2.3', '10.0.0.0/8'), false);
  assert.equal(ipInCidr('192.168.1.50', '192.168.1.0/24'), true);
});

test('ipInCidr — bare address is an exact match', () => {
  assert.equal(ipInCidr('203.0.113.7', '203.0.113.7'), true);
  assert.equal(ipInCidr('203.0.113.8', '203.0.113.7'), false);
});

test('ipInCidr — IPv4-mapped IPv6 unwraps to match a v4 CIDR', () => {
  assert.equal(ipInCidr('::ffff:203.0.113.7', '203.0.113.0/24'), true);
});

test('ipInCidr — IPv6', () => {
  assert.equal(ipInCidr('2001:db8::1', '2001:db8::/32'), true);
  assert.equal(ipInCidr('2001:db9::1', '2001:db8::/32'), false);
});

test('ipInCidr — malformed input never matches', () => {
  assert.equal(ipInCidr('1.2.3.4', ''), false);
  assert.equal(ipInCidr('', '10.0.0.0/8'), false);
  assert.equal(ipInCidr('not-an-ip', '10.0.0.0/8'), false);
  assert.equal(ipInCidr('1.2.3.4', '10.0.0.0/40'), false); // prefix out of range
});

test('ipInCidrList — any entry matches', () => {
  const list = ['10.0.0.0/8', '203.0.113.0/24'];
  assert.equal(ipInCidrList('203.0.113.7', list), true);
  assert.equal(ipInCidrList('8.8.8.8', list), false);
  assert.equal(ipInCidrList('203.0.113.7', []), false);
});
