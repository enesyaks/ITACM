/**
 * Where an approval mail's link lands.
 *
 * It used to open the app's front door: the approver received "X needs your
 * approval", clicked, and had to go looking for X. Now a ticket approval opens
 * that ticket and names the request, and anything else opens the approvals
 * inbox at that request. The base comes from Settings → App URL (else APP_URL),
 * so a different install produces links to its own domain.
 *
 * Pure — no database, no SMTP.
 * Run: node --test tests/approval-mail-links.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { approvalUrl } = require('../src/providers/postgres/notificationService');
const { renderTemplate, DEFAULT_EMAIL_TEMPLATES } = require('../src/utils/emailTemplates');

const T = '11111111-1111-1111-1111-111111111111';
const R = '22222222-2222-2222-2222-222222222222';

test('a ticket approval opens that ticket and names the request', () => {
  assert.equal(
    approvalUrl('https://app.itacm.site', { id: R, type: 'ticket_request', payload: { ticketId: T } }),
    `https://app.itacm.site/#/tickets?open=${T}&approval=${R}`
  );
});

test('any other approval opens the inbox at that request', () => {
  assert.equal(
    approvalUrl('https://app.itacm.site', { id: R, type: 'asset_scrap', payload: { assetId: 'x' } }),
    `https://app.itacm.site/#/approvals?open=${R}`
  );
});

test('the domain is whatever the install says it is', () => {
  const link = approvalUrl('https://itacm.sirket.com.tr/', { id: R, type: 'ticket_request', payload: { ticketId: T } });
  assert.ok(link.startsWith('https://itacm.sirket.com.tr/#/tickets'), 'a trailing slash on the setting does not double up');
});

test('a base that is not http(s) produces no link rather than a hostile one', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '', null]) {
    assert.equal(approvalUrl(bad, { id: R, type: 'ticket_request', payload: { ticketId: T } }), '', String(bad));
  }
});

test('ids are encoded, so a crafted id cannot break out of the hash', () => {
  const link = approvalUrl('https://a.example', { id: 'x&open=y#z', type: 'asset_sale' });
  assert.ok(!/[#&]open=y/.test(link.split('open=')[1] || ''), link);
});

test('the default approval mail links to the request, text and html alike', () => {
  const url = `https://app.itacm.site/#/tickets?open=${T}&approval=${R}`;
  const out = renderTemplate(DEFAULT_EMAIL_TEMPLATES.approval_request, {
    companyName: 'Neon', summary: 'Laptop', requesterName: 'Ali', resourceRef: ' (REQ-1)',
    approvalUrl: url, appUrl: 'https://app.itacm.site',
  });
  assert.ok(out.bodyHtml.includes(`href="${url.replace(/&/g, '&amp;')}"`) || out.bodyHtml.includes(`href="${url}"`), out.bodyHtml);
  assert.ok(out.bodyText.includes(url), 'the plain-text part carries the same link');
});

test('the decision mail sends the requester to their request, not the front door', () => {
  const url = `https://app.itacm.site/#/tickets?open=${T}`;
  const out = renderTemplate(DEFAULT_EMAIL_TEMPLATES.approval_decision, {
    companyName: 'Neon', summary: 'Laptop', decision: 'approved', deciderName: '',
    requestUrl: url, appUrl: 'https://app.itacm.site',
  });
  assert.ok(out.bodyText.includes(url));
  assert.ok(!/href="https:\/\/app\.itacm\.site"/.test(out.bodyHtml), 'no bare front-door link left');
});
