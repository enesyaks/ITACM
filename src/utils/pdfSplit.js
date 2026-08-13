/**
 * PDF splitting for the zimmet import (write side) — pure pdf-lib.
 * Groups pages into individual forms via a header marker, and slices a set of
 * pages into a standalone PDF buffer.
 */
'use strict';

const { PDFDocument } = require('pdf-lib');

// Titles are matched against Turkish-folded text: /i does not relate 'İ' to
// 'i', so "ZİMMET TESLİM TUTANAĞI" — the normal casing on a Turkish form —
// never matched a /z[iı]mmet/i marker and the whole upload collapsed into one
// form.
const { foldTr } = require('./nameMatch');

/** Form-start markers, matched against folded text: "zimmet", "teslim tutana(gi)", "devir teslim". */
const DEFAULT_MARKER = /(zimmet|teslim ?tutana|devir ?teslim|handover)/;

/**
 * A form title is a short, few-worded heading near the top of a page. The
 * marker words also run through body copy and footers of a multi-page form
 * ("…işbu zimmet tutanağı iki nüsha olarak düzenlenmiş…"), so matching anywhere
 * on the page would start a new form on every page and shred one 3-page form
 * into three. Length + word count separate "ZİMMET TESLİM TUTANAĞI" from a
 * sentence that merely mentions it.
 */
const HEAD_LINES = 6;
const MAX_TITLE_LEN = 60;
const MAX_TITLE_WORDS = 8;

/** Does this page open a new form? (pdfText keeps real line breaks.) */
function isFormStart(text, re) {
  return foldTr(text).split('\n', HEAD_LINES).some((raw) => {
    const line = raw.trim();
    return line.length <= MAX_TITLE_LEN
      && line.split(/\s+/).length <= MAX_TITLE_WORDS
      && re.test(line);
  });
}

/**
 * Group pages into forms from their per-page text.
 * A page whose heading matches the marker starts a new form; pages without one
 * continue the current form. If no page matches, the whole doc is one form.
 * @param {string[]} pageTexts
 * @param {{markerRe?:RegExp}} [opts]  markerRe is tested against Turkish-folded, lowercased text
 * @returns {Array<{from:number,to:number}>}  0-based inclusive ranges
 */
function detectForms(pageTexts, { markerRe } = {}) {
  const re = markerRe || DEFAULT_MARKER;
  const n = (pageTexts || []).length;
  if (n <= 1) return n ? [{ from: 0, to: 0 }] : [];
  const starts = [];
  pageTexts.forEach((t, i) => { if (isFormStart(t, re)) starts.push(i); });
  if (!starts.length) return [{ from: 0, to: n - 1 }];
  if (starts[0] !== 0) starts.unshift(0); // pages before the first marker → first form
  return starts.map((s, k) => ({ from: s, to: (k + 1 < starts.length ? starts[k + 1] - 1 : n - 1) }));
}

/** Copy pages out of an already-loaded source document. */
async function sliceFrom(src, pageIndices) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageIndices);
  copied.forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
}

/**
 * Copy the given 0-based page indices into a new standalone PDF.
 * @returns {Promise<Buffer>}
 */
async function pagesToPdf(srcBuffer, pageIndices) {
  return sliceFrom(await PDFDocument.load(srcBuffer), pageIndices);
}

/**
 * Cut a source PDF into one buffer per page range, parsing the source ONCE.
 * Calling pagesToPdf in a loop re-parses the whole document per form, which on
 * a 300-form upload means 300 full parses of the same file.
 * @param {Buffer} srcBuffer
 * @param {Array<{from:number,to:number}>} ranges  0-based inclusive
 * @returns {Promise<Buffer[]>}  aligned with `ranges`
 */
async function splitForms(srcBuffer, ranges) {
  const src = await PDFDocument.load(srcBuffer);
  const out = [];
  for (const r of ranges) {
    const idx = [];
    for (let p = r.from; p <= r.to; p++) idx.push(p);
    out.push(await sliceFrom(src, idx));
  }
  return out;
}

/** Number of pages in a PDF (cheap; used for validation/limits). */
async function pageCount(srcBuffer) {
  const src = await PDFDocument.load(srcBuffer);
  return src.getPageCount();
}

module.exports = { detectForms, pagesToPdf, splitForms, pageCount, DEFAULT_MARKER };
