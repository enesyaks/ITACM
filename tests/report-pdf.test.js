/**
 * AI report PDF builder + export store (no DB).
 * Run: node --test tests/report-pdf.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildReportPdf, slugPdfFilename, PDF_ROW_CAP } = require('../src/utils/reportPdf');

test('slugPdfFilename normalizes Turkish and spaces', () => {
  assert.equal(slugPdfFilename('Ana Ofis Cihazları'), 'ana-ofis-cihazlari.pdf');
  assert.equal(slugPdfFilename('Location Distribution!!!'), 'location-distribution.pdf');
  assert.equal(slugPdfFilename(''), 'itacm-report.pdf');
});

test('buildReportPdf returns a PDF buffer for empty chart/table', async () => {
  const buf = await buildReportPdf({
    lang: 'en',
    title: 'Empty report',
    companyName: 'ITACM Test',
    filtersLabel: 'none',
    chart: { type: 'bar', items: [] },
    cols: ['A', 'B'],
    rows: [],
    totalRows: 0,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);
  assert.equal(buf.slice(0, 4).toString('utf8'), '%PDF');
});

test('buildReportPdf draws bar chart and truncates long tables', async () => {
  const items = [
    { label: 'HQ', value: 40, pct: 40 },
    { label: 'Branch', value: 30, pct: 30 },
    { label: 'Remote', value: 30, pct: 30 },
  ];
  const rows = Array.from({ length: PDF_ROW_CAP + 25 }, (_, i) => [
    `TAG-${i}`, `Cat`, `Brand Model`, `In Stock`, `—`, `HQ`,
  ]);
  const buf = await buildReportPdf({
    lang: 'tr',
    title: 'Lokasyon dağılımı',
    companyName: 'Demo Co',
    filtersLabel: 'group_by=location',
    chart: { type: 'bar', items },
    cols: ['Etiket', 'Kategori', 'Marka', 'Durum', 'Zimmetli', 'Lokasyon'],
    rows,
    totalRows: rows.length,
    truncated: true,
  });
  assert.ok(buf.length > 2000);
  assert.equal(buf.slice(0, 4).toString('utf8'), '%PDF');
});

test('buildReportPdf draws pie chart without throwing', async () => {
  const buf = await buildReportPdf({
    lang: 'en',
    title: 'Status distribution',
    companyName: 'ITACM',
    chart: {
      type: 'pie',
      items: [
        { label: 'Assigned', value: 12, pct: 60 },
        { label: 'In Stock', value: 8, pct: 40 },
      ],
    },
    cols: ['Status', 'Count', '%'],
    rows: [
      ['Assigned', '12', '60'],
      ['In Stock', '8', '40'],
    ],
    totalRows: 2,
  });
  assert.equal(buf.slice(0, 4).toString('utf8'), '%PDF');
});

test('export store save/open enforces owner and expiry metadata', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itacm-ai-exp-'));
  const prev = process.env.DATA_DIR;
  process.env.DATA_DIR = tmp;
  // Re-require with fresh DATA_DIR — config reads env at load time, so mock via path override.
  const config = require('../src/config');
  const originalDataDir = config.dataDir;
  config.dataDir = tmp;
  try {
    // Clear require cache for exportStore so it picks up mutated config.dataDir via exportsDir()
    delete require.cache[require.resolve('../src/providers/ai/exportStore')];
    const { saveAiExport, openAiExport } = require('../src/providers/ai/exportStore');
    const saved = await saveAiExport({
      buffer: Buffer.from('%PDF-1.4 test'),
      filename: 'demo-report.pdf',
      userId: 'user-a',
    });
    assert.ok(saved.id);
    assert.ok(saved.url.startsWith('/api/ai/exports/'));
    assert.equal(saved.filename, 'demo-report.pdf');
    assert.ok(saved.expiresAt);

    const opened = await openAiExport(saved.id, 'user-a');
    assert.equal(opened.meta.userId, 'user-a');
    assert.ok(fs.existsSync(opened.filePath));

    await assert.rejects(() => openAiExport(saved.id, 'user-b'), /not available|403|Forbidden/i);
    await assert.rejects(() => openAiExport('deadbeefdeadbeefdeadbeefdeadbeef', 'user-a'), /not found/i);
  } finally {
    config.dataDir = originalDataDir;
    if (prev == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    delete require.cache[require.resolve('../src/providers/ai/exportStore')];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('attachReportPdf returns null when user cannot export', async () => {
  const { attachReportPdf } = require('../src/providers/ai/tools');
  // Monkey-patch services via require cache is heavy — call with no user.
  const out = await attachReportPdf({ user: null, lang: 'en' }, {
    title: 'x',
    cols: ['a'],
    rows: [['1']],
  });
  assert.equal(out, null);
});
