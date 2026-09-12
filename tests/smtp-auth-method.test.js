/**
 * When does saving SMTP settings demand a password?
 *
 * This regressed in production: picking "Connected mailbox (OAuth)" and leaving
 * the password blank — the only correct way to fill that form — was rejected
 * with "SMTP password is missing", because the password guard ran before the
 * auth method was even read. The rule below is the fix, pinned.
 *
 * Pure policy, no database.
 * Run: node --test tests/smtp-auth-method.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { smtpNeedsTypedPassword } = require('../src/providers/postgres/notificationService');

const base = { authMethod: 'password', typedPass: '', storedPass: '', passCorrupt: false, user: 'a@b.com', host: 'smtp.gmail.com' };

test('an OAuth mailbox is saved with the password field empty', () => {
  for (const authMethod of ['oauth2_delegated', 'oauth2_ms']) {
    assert.equal(smtpNeedsTypedPassword({ ...base, authMethod }), false, authMethod);
  }
});

test('an OAuth mailbox is still fine when the old ciphertext is unreadable', () => {
  // The stored password is irrelevant to a method that never reads it.
  assert.equal(
    smtpNeedsTypedPassword({ ...base, authMethod: 'oauth2_delegated', passCorrupt: true }),
    false
  );
});

test('password auth with nothing stored and nothing typed is refused', () => {
  assert.equal(smtpNeedsTypedPassword(base), true);
});

test('password auth with unreadable ciphertext is refused even though one is stored', () => {
  assert.equal(smtpNeedsTypedPassword({ ...base, storedPass: 'decrypted-garbage', passCorrupt: true }), true);
});

test('a blank field keeps a stored password rather than asking again', () => {
  assert.equal(smtpNeedsTypedPassword({ ...base, storedPass: 'kept' }), false);
});

test('the masked placeholder counts as blank, not as a typed password', () => {
  assert.equal(smtpNeedsTypedPassword({ ...base, typedPass: '••••••••' }), true);
  assert.equal(smtpNeedsTypedPassword({ ...base, typedPass: '••••••••', storedPass: 'kept' }), false);
});

test('a typed password is always enough', () => {
  assert.equal(smtpNeedsTypedPassword({ ...base, typedPass: 'hunter2', passCorrupt: true }), false);
});

test('an empty form is not an error — there is no server to talk to yet', () => {
  assert.equal(smtpNeedsTypedPassword({ ...base, user: '', host: '' }), false);
});

test('an unrecognised auth method is treated as password, never waved through', () => {
  // saveMailConfig narrows anything unknown to 'password' before it gets here,
  // but the rule fails towards asking on its own too: a credential guard that
  // skips itself on an unexpected value is the wrong way round.
  assert.equal(smtpNeedsTypedPassword({ ...base, authMethod: 'something-else' }), true);
  assert.equal(smtpNeedsTypedPassword({ ...base, authMethod: undefined }), true);
});
