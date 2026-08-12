/**
 * PDF splitting for the zimmet import (write side) — pure pdf-lib.
 * Groups pages into individual forms via a header marker, and slices a set of
 * pages into a standalone PDF buffer.
 */
'use strict';

const { PDFDocument } = require('pdf-lib');

/** Default form-start markers (folded/loose): "zimmet", "teslim tutana(ğı)", "devir teslim". */
const DEFAULT_MARKER = /(z[iı]mmet|teslim\s*tutana|devir\s*teslim|handover|zimmet\s*teslim)/i;

/**
 * Group pages into forms from their per-page text.
 * A page whose text matches the marker starts a new form; pages without it
 * belong to the current form. If no page matches, the whole doc is one form.
 * @param {string[]} pageTexts
 * @returns {Array<{from:number,to:number}>}  0-based inclusive ranges
 */
function detectForms(pageTexts, { markerRe } = {}) {
  const re = markerRe || DEFAULT_MARKER;
  const n = pageTexts.length;
  if (n <= 1) return n ? [{ from: 0, to: 0 }] : [];
  const starts = [];
  pageTexts.forEach((t, i) => { if (re.test(t || '')) starts.push(i); });
  if (!starts.length) return [{ from: 0, to: n - 1 }];
  if (starts[0] !== 0) starts.unshift(0); // pages before the first marker → first form
  return starts.map((s, k) => ({ from: s, to: (k + 1 < starts.length ? starts[k + 1] - 1 : n - 1) }));
}

/**
 * Copy the given 0-based page indices into a new standalone PDF.
 * @returns {Promise<Buffer>}
 */
async function pagesToPdf(srcBuffer, pageIndices) {
  const src = await PDFDocument.load(srcBuffer);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageIndices);
  copied.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/** Number of pages in a PDF (cheap; used for validation/limits). */
async function pageCount(srcBuffer) {
  const src = await PDFDocument.load(srcBuffer);
  return src.getPageCount();
}

module.exports = { detectForms, pagesToPdf, pageCount, DEFAULT_MARKER };
