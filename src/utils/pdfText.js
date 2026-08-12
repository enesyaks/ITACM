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

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{ numPages:number, pages:Array<{page:number,text:string}>, hasText:boolean }>}
 */
async function extractPages(buffer) {
  const lib = await pdfjs();
  // pdfjs rejects a Node Buffer (a Uint8Array subclass) — hand it a plain one.
  const data = (buffer instanceof Uint8Array && !Buffer.isBuffer(buffer))
    ? buffer : new Uint8Array(buffer);
  const doc = await lib.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map((it) => it.str || '').join(' ').replace(/\s+/g, ' ').trim();
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

module.exports = { extractPages };
