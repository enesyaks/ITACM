/**
 * Email-to-ticket attributes a ticket to a real employee (and cross-links into an
 * existing ticket number) only when the sender's From address is DMARC-verified.
 * The verdict is trusted ONLY from an Authentication-Results header stamped by the
 * Owner-pinned authserv-id — anything the sender embeds in the message must not
 * count, a real dmarc=fail must veto, and the pass must be bound to the From domain.
 *
 * Regression guard for the spoof where a forged `Authentication-Results: made.up;
 * dmarc=pass` header rode alongside the provider's real `dmarc=fail` and the sender
 * was accepted as the CEO.
 *
 * Run with `npm test` (node --test, no database needed).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { senderIsAuthenticated } = require('../src/providers/postgres/inboundMailService');

// Build a parsed-message stand-in the way mailparser exposes it to the service.
function msg(fromAddr, arHeaders) {
  return {
    from: { value: [{ address: fromAddr }] },
    headerLines: arHeaders.map((line) => ({ key: 'authentication-results', line })),
  };
}

const CFG = { authServId: 'mx.corp.local' };

test('a forged dmarc=pass alongside a real dmarc=fail does not authenticate', () => {
  const m = msg('ceo@victim-corp.com', [
    'Authentication-Results: mx.corp.local; spf=fail; dkim=none; dmarc=fail header.from=victim-corp.com',
    'Authentication-Results: totally.made.up; dmarc=pass header.from=victim-corp.com',
  ]);
  assert.equal(senderIsAuthenticated(m, CFG), false);
});

test('a dmarc=pass under an untrusted authserv-id is ignored', () => {
  const m = msg('ceo@victim-corp.com', [
    'Authentication-Results: attacker.example; dmarc=pass header.from=victim-corp.com',
  ]);
  assert.equal(senderIsAuthenticated(m, CFG), false);
});

test('a genuine dmarc=pass from the pinned authserv-id, aligned to From, authenticates', () => {
  const m = msg('alice@corp.local', [
    'Authentication-Results: mx.corp.local; spf=pass; dkim=pass; dmarc=pass header.from=corp.local',
  ]);
  assert.equal(senderIsAuthenticated(m, CFG), true);
});

test('a pass not bound to the From domain does not authenticate (no endsWith trick)', () => {
  const m = msg('ceo@victim-corp.com', [
    // trusted stamp, but header.from is a look-alike that only endsWith-matches
    'Authentication-Results: mx.corp.local; dmarc=pass header.from=victim-corp.com.attacker.ru',
  ]);
  assert.equal(senderIsAuthenticated(m, CFG), false);
});

test('fails closed when no authserv-id is pinned, even with a real pass', () => {
  const m = msg('alice@corp.local', [
    'Authentication-Results: mx.corp.local; dmarc=pass header.from=corp.local',
  ]);
  assert.equal(senderIsAuthenticated(m, { authServId: '' }), false);
});

test('no Authentication-Results header at all is unauthenticated', () => {
  assert.equal(senderIsAuthenticated(msg('alice@corp.local', []), CFG), false);
});
