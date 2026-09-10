/**
 * The two pages this server renders itself, for people with no session: the
 * mailbox-OAuth callback and the satisfaction page.
 *
 * Both carry an inline script, and the app's CSP is script-src 'self' with no
 * 'unsafe-inline' — so without a nonce the browser drops that script and the
 * page silently loses behaviour. It did: the OAuth page's state-stripping and
 * countdown never ran in production, and nothing said so. These pin the nonce
 * and the escaping.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCsatPage } = require('../src/utils/csatPage');
const { renderMailOAuthPage } = require('../src/utils/mailOAuthPage');

const TICKET = { number: 'INC-1', status: 'resolved', resolutionNote: 'Toner degistirildi' };

test('an inline script is nonced, or the CSP drops it', () => {
  const html = renderCsatPage({ ticket: TICKET, token: 'a'.repeat(48), nonce: 'r4nd0m==' });
  assert.match(html, /<script nonce="r4nd0m=="/);
  const oauth = renderMailOAuthPage({ ok: true, email: 'a@b.com', nonce: 'r4nd0m==' });
  assert.match(oauth, /<script nonce="r4nd0m=="/);
});

test('without a nonce the pages still render — they just stop narrating', () => {
  const html = renderCsatPage({ ticket: TICKET, token: 'a'.repeat(48) });
  assert.match(html, /<script>/);
  assert.match(html, /<form method="POST"/, 'the part that matters never needed JavaScript');
});

test('nothing a person wrote can become markup', () => {
  const evil = '<img src=x onerror=alert(1)>"><script>alert(2)</script>';
  const html = renderCsatPage({
    ticket: { ...TICKET, number: evil, resolutionNote: evil },
    token: evil, company: evil, nonce: evil,
  });
  assert.ok(!html.includes('<img src=x'), 'no tag is formed');
  assert.ok(!html.includes('<script>alert(2)'), 'and no script');
  assert.ok(html.includes('&lt;img src=x'), 'it is shown as the text it is');
});

test('the rating a link carried is a number or nothing', () => {
  for (const picked of [0, 6, -1, NaN, '3; drop table']) {
    const html = renderCsatPage({ ticket: TICKET, token: 'a'.repeat(48), picked });
    assert.ok(!/<input[^>]*checked/.test(html), `"${picked}" must not preselect a star`);
  }
  assert.match(renderCsatPage({ ticket: TICKET, token: 'a'.repeat(48), picked: 4 }), /id="r4"[^>]*checked/);
});

test('a spent link shows the score and no way to change it', () => {
  const html = renderCsatPage({ ticket: { ...TICKET, csatRating: 4 }, error: 'rated', lang: 'tr' });
  assert.match(html, /Zaten değerlendirildi/);
  assert.ok(!html.includes('<form'), 'nothing left to submit');
  assert.match(html, /★★★★☆/);
});

test('an expired link points somewhere useful instead of nowhere', () => {
  const html = renderCsatPage({ ticket: TICKET, error: 'expired', lang: 'tr', windowDays: 30 });
  assert.match(html, /30 gün/);
  assert.match(html, /maili yanıtlayın/, 'a dead end is not an acceptable last screen');
  assert.ok(!html.includes('<form'));
});

test('the form says what the link is good for', () => {
  const html = renderCsatPage({ ticket: TICKET, token: 'a'.repeat(48), lang: 'tr', windowDays: 30 });
  assert.match(html, /30 gün açık ve bir kez kullanılabilir/);
});

test('a dead link says so without hinting at what exists', () => {
  const html = renderCsatPage({ ticket: null, error: 'gone', lang: 'tr' });
  assert.match(html, /geçerli değil/);
  assert.ok(!html.includes('<form'), 'nothing to submit');
});
