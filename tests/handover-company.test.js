/**
 * Multi-company handover form: whose letterhead, and what the cross-company
 * column does. Renders real PDFs and reads the text back, because the whole
 * point of the feature is what ends up printed on the signed page.
 *
 * Run: node --test tests/handover-company.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHandoverPdfBuffer } = require('../src/utils/handoverPdf');
const { extractPages } = require('../src/utils/pdfText');

const ACME = '11111111-1111-4111-8111-111111111111';
const BETA = '22222222-2222-4222-8222-222222222222';

/** Workspace-level settings: the group defaults every company falls back to. */
const SETTINGS = {
  companyName: 'Holding Group',
  companyLogo: null,
  companyAddress: null,
  handoverTerms: null,
  language: 'en',
  handoverTemplates: [],
};

const EMPLOYEE = { id: '33333333-3333-4333-8333-333333333333', department: 'IT', title: 'Engineer' };

function asset(tag, ownerId, ownerName) {
  return {
    kind: 'asset',
    assetId: `a-${tag}`,
    assetTag: tag,
    brand: 'Dell',
    model: 'Latitude 5540',
    category: 'Laptop',
    serialNumber: `SN-${tag}`,
    macAddress: null,
    conditionNote: 'New',
    ownerCompanyId: ownerId,
    ownerCompanyName: ownerName,
  };
}

function handover(items, documentType = 'single') {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    employeeName: 'Ayse Kaya',
    transactionDate: '2026-03-01T09:00:00.000Z',
    documentType,
    items,
  };
}

const render = (opts) => renderHandoverPdfBuffer({
  employee: EMPLOYEE,
  settings: SETTINGS,
  deliveredBy: 'IT Department',
  lang: 'en',
  ...opts,
});

const textOf = async (buf) => (await extractPages(buf)).pages.map((p) => p.text).join('\n');

test('the form is issued under the employee’s company, not the workspace', async () => {
  const buf = await render({
    handover: handover([asset('IT-1001', ACME, 'Acme Teknoloji')]),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
  });
  const text = await textOf(buf);
  assert.match(text, /ACME TEKNOLOJI/i);
  assert.doesNotMatch(text, /HOLDING GROUP/i);
});

test('a same-company basket prints no Owner Company column', async () => {
  // Only one company appears on the form, so the column would repeat one name
  // down every row and cost a column of width for nothing.
  const buf = await render({
    handover: handover([asset('IT-1001', ACME, 'Acme Teknoloji'), asset('IT-1002', ACME, 'Acme Teknoloji')]),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
  });
  const text = await textOf(buf);
  assert.doesNotMatch(text, /Owner Company/i);
});

test('when the column is shown, every row names its owner — including the header company', async () => {
  // A blank cell under "Owner Company" reads as missing data. The row owned by
  // the company heading the form must still say so.
  const buf = await render({
    handover: handover([
      asset('IT-1001', ACME, 'Acme Teknoloji'),
      asset('IT-2001', BETA, 'Beta Lojistik'),
    ]),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
  });
  const text = await textOf(buf);
  const row = text.split('\n').find((l) => l.includes('SN-IT-1001'));
  assert.ok(row, 'the Acme-owned row is on the page');
  assert.match(row, /Acme Teknoloji/, 'its own owner is spelled out, not left as a dash');
});

test('the Owner Company column can be switched off per template', async () => {
  // Settings → zimmet form design carries the toggle alongside the other columns.
  const buf = await render({
    handover: handover([
      asset('IT-1001', ACME, 'Acme Teknoloji'),
      asset('IT-2001', BETA, 'Beta Lojistik'),
    ]),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
    settings: { ...SETTINGS, handoverTemplates: [{ id: 'default', name: 'Standard', colOwnerCompany: false }] },
    templateId: 'default',
  });
  const text = await textOf(buf);
  assert.doesNotMatch(text, /Owner Company/i);
  // The clause still stands: the person is signing for another entity's property.
  assert.match(text, /ownership does not transfer/i);
});

test('a sister company’s device names its owner on the row and in the terms', async () => {
  const buf = await render({
    handover: handover([
      asset('IT-1001', ACME, 'Acme Teknoloji'),
      asset('IT-2001', BETA, 'Beta Lojistik'),
    ]),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
  });
  const text = await textOf(buf);
  assert.match(text, /ACME TEKNOLOJI/i, 'header stays the employee’s company');
  assert.match(text, /Owner Company/i, 'the exception column appears');
  assert.match(text, /Beta Lojistik/, 'the sister company is named on its row');
  assert.match(text, /ownership does not transfer/i, 'the terms say what the column means');
});

test('per_company splits one basket into a page per owning company', async () => {
  const buf = await render({
    handover: handover([
      asset('IT-1001', ACME, 'Acme Teknoloji'),
      asset('IT-2001', BETA, 'Beta Lojistik'),
    ], 'per_company'),
    branding: { companyId: ACME, companyName: 'Acme Teknoloji', companyLogo: null, companyAddress: null, handoverTerms: null },
  });
  const out = await extractPages(buf);
  assert.equal(out.numPages, 2, 'one page per owning company');
  // Each page carries only its own company's devices.
  const [p1, p2] = out.pages.map((p) => p.text);
  assert.match(p1, /IT-1001/);
  assert.doesNotMatch(p1, /IT-2001/);
  assert.match(p2, /IT-2001/);
  assert.doesNotMatch(p2, /IT-1001/);
});

test('a receipt with no company at all still prints under the workspace name', async () => {
  // Every handover created before multi-company existed looks like this, and a
  // reprint of one must not come out blank.
  const buf = await render({
    handover: handover([{ ...asset('IT-9001', null, null) }]),
    branding: null,
  });
  const text = await textOf(buf);
  assert.match(text, /HOLDING GROUP/i);
  assert.doesNotMatch(text, /Owner Company/i);
});

test('company terms override the workspace terms', async () => {
  const buf = await render({
    handover: handover([asset('IT-1001', ACME, 'Acme Teknoloji')]),
    branding: {
      companyId: ACME,
      companyName: 'Acme Teknoloji',
      companyLogo: null,
      companyAddress: null,
      handoverTerms: 'Acme special handover clause applies.',
    },
  });
  const text = await textOf(buf);
  assert.match(text, /Acme special handover clause applies/);
});
