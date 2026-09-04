'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const { extractPages } = require('../src/utils/pdfText');

/** A real two-page PDF, so the reader is exercised end to end rather than mocked. */
async function makePdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of lines) {
    const page = doc.addPage([420, 300]);
    page.drawText(text, { x: 40, y: 220, size: 14, font });
  }
  return Buffer.from(await doc.save());
}

test('a readable PDF comes back with its text and does not throw on cleanup', async () => {
  // This is the regression that broke bulk zimmet import: pdfjs 6.3 dropped
  // destroy() from the document proxy, and the old call threw from the finally
  // block AFTER the pages had been read. Every upload then reported
  // "Could not read PDF" for a file that had just parsed perfectly.
  const buf = await makePdf(['Teslim Alan: Ahmet Yilmaz', 'Teslim Alan: Ayse Kaya']);
  const out = await extractPages(buf);

  assert.strictEqual(out.numPages, 2);
  assert.strictEqual(out.pages.length, 2);
  assert.ok(out.hasText, 'a page of real text should register as readable');
  assert.match(out.pages[0].text, /Ahmet Yilmaz/);
  assert.match(out.pages[1].text, /Ayse Kaya/);
});

test('a page with no text is reported as unreadable rather than failing', async () => {
  // An empty page is what a scan looks like before OCR; the importer relies on
  // hasText being false here to decide whether to fall back.
  const doc = await PDFDocument.create();
  doc.addPage([420, 300]);
  const out = await extractPages(Buffer.from(await doc.save()));

  assert.strictEqual(out.numPages, 1);
  assert.strictEqual(out.hasText, false);
});

test('reading the same buffer twice works, so nothing is left half-torn-down', async () => {
  // Guards the cleanup path itself: a document that is not released properly
  // shows up as a failure on a later call, not the one that leaked.
  const buf = await makePdf(['first', 'second']);
  const a = await extractPages(buf);
  const b = await extractPages(buf);

  assert.strictEqual(a.numPages, b.numPages);
  assert.strictEqual(a.pages[0].text, b.pages[0].text);
});
