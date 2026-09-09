/**
 * The receipt a requester gets when their ticket is opened.
 *
 * Two rules carry the whole feature, and both are easy to get backwards:
 *   - someone the install knows is always written back to;
 *   - an address that matches nobody (only the email intake produces those) is
 *     answered ONLY when the desk has switched that on. An automatic reply to an
 *     unknown address tells whoever sent it that the mailbox is live, which is
 *     what a spam run is looking for — so it stays off by default.
 *
 * Plus the thing an operator notices first: the link in service-desk mail has to
 * open the ticket, not the app's front door.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { ackTarget } = require('../src/providers/postgres/ticketService');
const { ticketUrl, DEFAULT_NOTIFY } = require('../src/providers/postgres/notificationService');
const { TEMPLATE_KEYS, TEMPLATE_PLACEHOLDERS, mergeTemplates, renderTemplate } = require('../src/utils/emailTemplates');

test('a requester the system knows is always acknowledged', () => {
  assert.deepEqual(
    ackTarget({ requesterEmail: 'ada@corp.local', senderEmail: 'ada@corp.local', ackUnknown: false }),
    { to: 'ada@corp.local', known: true }
  );
});

test('an unknown sender hears nothing unless the desk opted in', () => {
  assert.equal(ackTarget({ requesterEmail: '', senderEmail: 'outsider@example.com', ackUnknown: false }), null);
  assert.deepEqual(
    ackTarget({ requesterEmail: '', senderEmail: 'outsider@example.com', ackUnknown: true }),
    { to: 'outsider@example.com', known: false }
  );
});

test('opting in never invents a recipient out of nothing', () => {
  assert.equal(ackTarget({ requesterEmail: '', senderEmail: '', ackUnknown: true }), null);
  assert.equal(ackTarget({ requesterEmail: '  ', senderEmail: '   ', ackUnknown: true }), null);
});

test('answering outsiders is off by default, the receipt itself is on', () => {
  assert.equal(DEFAULT_NOTIFY.ackUnknownSenders, false);
  assert.equal(DEFAULT_NOTIFY.ticketAck, true);
});

test('a ticket link opens that ticket', () => {
  assert.equal(
    ticketUrl('https://app.itacm.site', 'abc-123'),
    'https://app.itacm.site/#/tickets?open=abc-123'
  );
  // A stored app URL may carry a trailing slash; the link must not double up.
  assert.equal(
    ticketUrl('https://app.itacm.site/', 'abc-123'),
    'https://app.itacm.site/#/tickets?open=abc-123'
  );
  // No ticket to point at → the front door, never a dangling "?open=".
  assert.equal(ticketUrl('https://app.itacm.site', null), 'https://app.itacm.site');
});

test('every service-desk template is editable and offers the deep link', () => {
  for (const key of ['ticket_ack', 'ticket_update', 'ticket_reply', 'sla_breach']) {
    assert.ok(TEMPLATE_KEYS.includes(key), `${key} must be listed, or it is neither editable nor sendable`);
    assert.ok(TEMPLATE_PLACEHOLDERS[key].includes('ticketUrl'), `${key} must offer {{ticketUrl}}`);
  }
});

test('the receipt renders with the number, the subject and a link to the ticket', () => {
  const tpl = mergeTemplates({}).ticket_ack;
  const out = renderTemplate(tpl, {
    companyName: 'Acme', requesterName: 'Ada', ticketNumber: 'INC-1042',
    subject: 'Printer offline', priority: 'high',
    ticketUrl: 'https://app.itacm.site/#/tickets?open=abc-123',
    appUrl: 'https://app.itacm.site',
  });
  assert.match(out.subject, /INC-1042/);
  assert.match(out.bodyHtml, /href="https:\/\/app\.itacm\.site\/#\/tickets\?open=abc-123"/);
  assert.match(out.bodyText, /INC-1042/);
  assert.match(out.bodyText, /app\.itacm\.site\/#\/tickets\?open=abc-123/);
  assert.doesNotMatch(out.bodyHtml, /\{\{/, 'no placeholder is left unfilled');
});
