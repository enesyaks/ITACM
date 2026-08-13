/**
 * Per-page text extraction for the zimmet PDF import (read side).
 * pdfjs-dist is ESM-only; load it lazily via dynamic import from CommonJS.
 * `isEvalSupported:false` — never eval font programs from an untrusted PDF.
 */
'use strict';

let _pdfjs = null;
async function pdfjs() {
  if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
}

/** pdfjs rejects a Node Buffer (a Uint8Array subclass) — hand it a plain one. */
function toPdfjsData(buffer) {
  return (buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)) ? buffer : new Uint8Array(buffer);
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{ numPages:number, pages:Array<{page:number,text:string}>, hasText:boolean }>}
 */
async function extractPages(buffer) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: toPdfjsData(buffer), useSystemFonts: true, isEvalSupported: false,
  }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      // Keep pdfjs' end-of-line hints as real newlines: label heuristics
      // ("Teslim Alan: <name>") must stop at the end of the line instead of
      // swallowing whatever is typeset underneath.
      const text = tc.items
        .map((it) => (it.str || '') + (it.hasEOL ? '\n' : ' '))
        .join('')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      pages.push({ page: i, text });
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
  const hasText = pages.some((p) => p.text.length > 8);
  return { numPages: pages.length, pages, hasText };
}

module.exports = { extractPages, pdfjs, toPdfjsData };
