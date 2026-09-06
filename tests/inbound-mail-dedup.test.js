'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mailKey } = require('../src/providers/postgres/inboundMailService');

// The de-dup key is what stops the same email opening the same ticket on every
// poll when the IMAP \Seen flag does not stick. It must be identical for a
// re-read of one message and distinct for genuinely different ones.

test('the Message-ID is the key when present', () => {
  assert.strictEqual(mailKey({ messageId: '<abc@host>' }, 5), '<abc@host>');
  // The UID does not enter the key when a Message-ID exists — the same message
  // read under a different UID (after a resync) must still match.
  assert.strictEqual(mailKey({ messageId: '<abc@host>' }, 99), '<abc@host>');
});

test('a re-read of the same header-less message produces the same key', () => {
  const msg = { from: { text: 'a@b' }, subject: 'Merhaba', date: new Date('2026-01-01T00:00:00Z'), text: 'gövde' };
  assert.strictEqual(mailKey(msg, 9), mailKey(msg, 9));
});

test('different header-less messages do not collide', () => {
  const base = { from: { text: 'a@b' }, date: new Date('2026-01-01T00:00:00Z'), text: 'gövde' };
  const a = mailKey({ ...base, subject: 'Merhaba' }, 9);
  const b = mailKey({ ...base, subject: 'Farkli' }, 9);
  assert.notStrictEqual(a, b);
});

test('a header-less key is namespaced so it cannot be mistaken for a Message-ID', () => {
  const key = mailKey({ from: { text: 'a@b' }, subject: 's', text: 't' }, 3);
  assert.match(key, /^sha256:/);
});
