/**
 * A reply must arrive as what the person wrote, not as the whole thread again.
 *
 * Every client quotes what it answers, so without trimming each reply pastes the
 * previous one back into the ticket: the third reply contains the second, which
 * contains the first, along with the desk's own footer and logo alt-text. The
 * shapes below are the ones real clients produced against this install.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { stripQuotedReply } = require('../src/utils/mailQuote');

test('Gmail in Turkish: the attribution line and everything under it goes', () => {
  const body = [
    'test',
    '',
    '<eyakisik@icloud.com> adresine sahip kullanıcı 10 Eyl 2026 Per, 10:11',
    'tarihinde şunu yazdı:',
    '',
    '> [image: Neon Elektronik A.Ş.]',
    '> Ticket INC-1519',
    '> Enes replied:',
    '> test',
  ].join('\n');
  assert.equal(stripQuotedReply(body), 'test');
});

test('Gmail in English', () => {
  const body = 'Thanks, that fixed it.\n\nOn Wed, 10 Sep 2026 at 10:11, Support <help@x.com> wrote:\n\n> Have you tried…\n';
  assert.equal(stripQuotedReply(body), 'Thanks, that fixed it.');
});

test('Outlook: the rule of underscores above the repeated headers', () => {
  const body = 'Yeni bilgi: yazıcı yine durdu.\n\n________________________________\nFrom: Support <help@x.com>\nSent: 10 September 2026 10:11\nSubject: [INC-1] Yazıcı\n';
  assert.equal(stripQuotedReply(body), 'Yeni bilgi: yazıcı yine durdu.');
});

test('the older "-----Original Message-----" separator', () => {
  const body = 'Tamamdır.\n\n-----Original Message-----\nFrom: Support\n';
  assert.equal(stripQuotedReply(body), 'Tamamdır.');
});

test('a bare quote block with no attribution line', () => {
  const body = 'Hâlâ çalışmıyor.\n\n> Yazıcıyı yeniden başlattınız mı?\n> — Destek\n';
  assert.equal(stripQuotedReply(body), 'Hâlâ çalışmıyor.');
});

test('a reply written under the quote keeps only what is above it', () => {
  // Bottom-posting would lose text — so the trim starts at the FIRST quote and
  // anything the person wrote below their client's quote is not recoverable
  // structurally. What must never happen is losing the top half as well.
  const body = 'Kısa cevap: evet.\n\n> Soru buydu\n';
  assert.equal(stripQuotedReply(body), 'Kısa cevap: evet.');
});

test('a message that is nothing but a quote is left alone', () => {
  const body = '> sadece alıntı\n> ikinci satır\n';
  assert.equal(stripQuotedReply(body), body.replace(/\n$/, ''),
    'cutting at zero would throw the entire message away — the caller decides');
});

test('a reply that is only an attribution and its quote leaves nothing', () => {
  const body = 'On Wed, 10 Sep 2026 at 10:11, Support <help@x.com> wrote:\n> hepsi bu\n';
  assert.equal(stripQuotedReply(body), '',
    'the person wrote nothing of their own — the caller substitutes "(boş yanıt)"');
});

test('an attribution in a language this file does not list is still not left stranded', () => {
  const body = 'Kiitos!\n\nke 10. syysk. 2026 klo 10.11 Support <help@x.com> kirjoitti:\n\n> Oletko kokeillut…\n';
  assert.equal(stripQuotedReply(body), 'Kiitos!');
});

test('ordinary text that merely mentions writing survives', () => {
  const body = 'I wrote:\nthe serial number is ABC-123, as you asked.';
  assert.equal(stripQuotedReply(body), body, 'no date, no address, no quote — not an attribution');
});

test('a plain reply with no quoting at all is untouched', () => {
  assert.equal(stripQuotedReply('Teşekkürler, çözüldü.'), 'Teşekkürler, çözüldü.');
});

test('empty in, empty out', () => {
  assert.equal(stripQuotedReply(''), '');
  assert.equal(stripQuotedReply(null), '');
  assert.equal(stripQuotedReply('   \n\n  '), '');
});

test('CRLF from the wire is handled', () => {
  const body = 'evet\r\n\r\n> hayır\r\n';
  assert.equal(stripQuotedReply(body), 'evet');
});

test('the shape production actually produced, end to end', () => {
  // Verbatim from a Gmail reply to a ticket_reply notification: the person wrote
  // one word and the client pasted the whole notification back, footer included.
  const body = [
    'test',
    '',
    '<eyakisik@icloud.com> adresine sahip kullanıcı 10 Eyl 2026 Per, 10:11',
    'tarihinde şunu yazdı:',
    '',
    '> [image: Neon Elektronik A.Ş.]',
    '>',
    '> Neon Elektronik A.Ş. · Service Desk',
    '> Printer Talebi',
    '>',
    '> Ticket INC-1519',
    '>',
    '> Enes replied:',
    '> test',
    '>',
    '> You can reply directly to this email to respond — keep *[INC-1519]* in',
    '> the subject and your message, and any attachments, are added to the ticket.',
    '>',
    '> Open the ticket',
    '> <https://app.itacm.site/#/tickets?open=8ce5adc1-fc51-4ce8-ba73-bb9ab2f0f6b7>',
    '> Bu e-posta ITACM · IT Asset Control Pro tarafından gönderildi.',
    '>',
  ].join('\n');
  assert.equal(stripQuotedReply(body), 'test');
});
