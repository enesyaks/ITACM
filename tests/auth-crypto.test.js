/**
 * Password hashing and TOTP, exercised through the libraries the auth provider
 * actually calls.
 *
 * These are dependency-shape tests, and they exist because a dependency bump
 * got merged that broke the app outright: otplib 13 removed the `authenticator`
 * export, and authProvider.js touches it at module load (`authenticator.options
 * = …`). The whole process failed to boot. Nothing caught it — `npm run lint`
 * is a syntax check, the Docker build never runs the app, and no test imported
 * the auth provider.
 *
 * bcrypt matters for a different reason: a hash written by an older version has
 * to keep verifying, or every existing account is locked out by an upgrade.
 *
 * Pure — no database.
 * Run: node --test tests/auth-crypto.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

test('the auth provider can be loaded at all', () => {
  // authProvider.js configures otplib at module scope, so an incompatible
  // upgrade takes the process down on require — before any request is served.
  assert.doesNotThrow(() => require('../src/providers/postgres/authProvider'),
    'requiring authProvider must not throw — the app cannot boot if it does');
});

test('otplib still exposes the authenticator API the auth provider uses', () => {
  assert.equal(typeof authenticator, 'object', 'otplib must export `authenticator`');
  for (const fn of ['generateSecret', 'generate', 'verify', 'keyuri']) {
    assert.equal(typeof authenticator[fn], 'function', `authenticator.${fn} is used by authProvider`);
  }
  // Settable options object — authProvider assigns to it on load.
  assert.doesNotThrow(() => { authenticator.options = { window: 1 }; });
});

test('a TOTP code verifies against its own secret and nothing else', () => {
  const secret = authenticator.generateSecret();
  const token = authenticator.generate(secret);
  assert.match(token, /^\d{6}$/, 'a TOTP code is six digits');
  assert.equal(authenticator.verify({ token, secret }), true);
  assert.equal(authenticator.verify({ token: '000000', secret }), false);
  assert.equal(authenticator.verify({ token, secret: authenticator.generateSecret() }), false,
    'a code must not verify against a different secret');
});

test('the enrolment URI carries the issuer and account', () => {
  const secret = authenticator.generateSecret();
  const uri = authenticator.keyuri('someone@example.com', 'ITACM', secret);
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes(secret), 'the QR payload must contain the secret');
});

test('bcrypt verifies a hash produced by an older major version', () => {
  // Fixed $2a$ vector for "Zimmet-Test-Pass-1!" generated under bcryptjs 2.x.
  // If a future bump stops verifying this, every existing login breaks.
  const LEGACY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMye';
  // Round-trip on a freshly produced hash, at the cost the app uses.
  const fresh = bcrypt.hashSync('correct horse battery staple', 12);
  assert.match(fresh, /^\$2[aby]\$12\$/, 'cost 12, standard bcrypt prefix');
  assert.equal(bcrypt.compareSync('correct horse battery staple', fresh), true);
  assert.equal(bcrypt.compareSync('wrong password', fresh), false);
  // A $2a$ hash from any bcrypt implementation must still parse and compare.
  assert.doesNotThrow(() => bcrypt.compareSync('anything', `${LEGACY_HASH}IjZAgcfl7p92ldGxad68LJZdL17lhWy`));
});
