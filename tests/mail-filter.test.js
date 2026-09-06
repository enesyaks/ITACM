/**
 * Inbound-mail filtering: the sender blocklist and the bulk-mail test.
 * Pure logic, no DB, no IMAP. Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addressOf, normalizeBlockEntry, parseBlocklist, isBlockedSender, bulkReason,
} = require('../src/utils/mailFilter');

/** Build a parsed-message stand-in from plain header lines. */
const msg = (headers) => ({
  headerLines: Object.entries(headers).map(([k, v]) => ({ key: k.toLowerCase(), line: `${k}: ${v}` })),
});

test('addressOf — unwraps display names and lowercases', () => {
  assert.equal(addressOf('News <NEWS@Medium.com>'), 'news@medium.com');
  assert.equal(addressOf('  a@b.com '), 'a@b.com');
  assert.equal(addressOf('Enes'), '');
  assert.equal(addressOf(null), '');
});

test('normalizeBlockEntry — accepts an address or a domain, rejects the rest', () => {
  assert.equal(normalizeBlockEntry('News@Medium.COM'), 'news@medium.com');
  assert.equal(normalizeBlockEntry('medium.com'), 'medium.com');
  assert.equal(normalizeBlockEntry('@medium.com'), 'medium.com');
  assert.equal(normalizeBlockEntry('*@medium.com'), 'medium.com');
  assert.equal(normalizeBlockEntry('Newsletter <news@medium.com>'), 'news@medium.com');
  // Not addresses, not domains.
  assert.equal(normalizeBlockEntry('medium'), '');
  assert.equal(normalizeBlockEntry('a@b'), '');
  assert.equal(normalizeBlockEntry('two words'), '');
  assert.equal(normalizeBlockEntry(''), '');
  assert.equal(normalizeBlockEntry('a@' + 'x'.repeat(300) + '.com'), '');
});

test('parseBlocklist — normalises, drops rejects and duplicates, caps size', () => {
  assert.deepEqual(
    parseBlocklist(['News@Medium.com', 'news@medium.com', '@medium.com', 'nonsense', '']),
    ['news@medium.com', 'medium.com']
  );
  // A pasted blob is split on newlines/commas/semicolons.
  assert.deepEqual(parseBlocklist('a@b.com, c.com\nd@e.com'), ['a@b.com', 'c.com', 'd@e.com']);
  assert.equal(parseBlocklist(Array.from({ length: 20 }, (_, i) => `u${i}@x.com`), { max: 5 }).length, 5);
  assert.deepEqual(parseBlocklist(null), []);
});

test('isBlockedSender — exact address match', () => {
  const list = parseBlocklist(['news@medium.com']);
  assert.equal(isBlockedSender('news@medium.com', list), true);
  assert.equal(isBlockedSender('News <NEWS@MEDIUM.COM>', list), true);
  assert.equal(isBlockedSender('other@medium.com', list), false);
});

test('isBlockedSender — a domain entry covers its subdomains only', () => {
  const list = parseBlocklist(['medium.com']);
  assert.equal(isBlockedSender('news@medium.com', list), true);
  assert.equal(isBlockedSender('x@mail.medium.com', list), true);
  // Suffix matching must be dot-anchored: a look-alike domain is not covered.
  assert.equal(isBlockedSender('x@notmedium.com', list), false);
  assert.equal(isBlockedSender('x@medium.com.attacker.ru', list), false);
});

test('isBlockedSender — empty list or unparseable sender blocks nothing', () => {
  assert.equal(isBlockedSender('a@b.com', []), false);
  assert.equal(isBlockedSender('a@b.com', null), false);
  assert.equal(isBlockedSender('', parseBlocklist(['b.com'])), false);
});

test('bulkReason — flags the headers only a sending platform sets', () => {
  assert.equal(bulkReason(msg({ 'List-Unsubscribe': '<https://medium.com/unsub>' })), 'list-unsubscribe');
  assert.equal(bulkReason(msg({ 'List-Id': 'digest <digest.medium.com>' })), 'list-id');
  assert.equal(bulkReason(msg({ Precedence: 'bulk' })), 'precedence');
  assert.equal(bulkReason(msg({ Precedence: 'list' })), 'precedence');
  assert.equal(bulkReason(msg({ 'Auto-Submitted': 'auto-replied' })), 'auto-submitted');
  assert.equal(bulkReason(msg({ 'X-Auto-Response-Suppress': 'All' })), 'x-auto-response-suppress');
  assert.equal(bulkReason(msg({ 'Feedback-ID': '1:2:3:mailer' })), 'feedback-id');
});

test('bulkReason — a person writing from a mail client is never bulk', () => {
  const human = msg({
    From: 'Ayse <ayse@sirket.com>',
    Subject: 'Yazicidan cikti alamiyorum',
    'Message-ID': '<abc@sirket.com>',
    'User-Agent': 'Mozilla Thunderbird',
    'Auto-Submitted': 'no',
  });
  assert.equal(bulkReason(human), '');
  // Marketing words in the subject are not a signal — only headers count.
  assert.equal(bulkReason(msg({ Subject: 'BÜYÜK İNDİRİM! Kampanya son gün' })), '');
  assert.equal(bulkReason({}), '');
  assert.equal(bulkReason(null), '');
});
