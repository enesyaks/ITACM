/**
 * OCR fallback for SCANNED zimmet PDFs (bulk import, phase 2).
 *
 * A scan has no text layer, so pdfText returns nothing and the importer can
 * neither split forms nor read a name. Here each page's embedded image is read
 * with Tesseract, producing the same `{page, text}` shape pdfText does — the
 * rest of the pipeline (form splitting, name matching) is unchanged.
 *
 * No rasterisation, and therefore no canvas: pdfjs already decodes the page's
 * image XObject (DCT/CCITT/JBIG2/Flate all come back as plain pixels), and a
 * scanned page IS one image. We wrap those pixels in a BMP — an uncompressed
 * container that is ~30 lines to write and that Tesseract reads natively — and
 * hand it over. Rendering through @napi-rs/canvas was the obvious route and it
 * segfaults on image-drawing pages, besides needing a native module in an
 * Alpine image.
 *
 * tesseract.js is an OPTIONAL dependency and the feature is off unless
 * ZIMMET_OCR is set, so an install that only imports digital PDFs pays nothing
 * and one where `npm ci --omit=optional` ran still boots — availability() then
 * reports why OCR is unavailable instead of the import failing.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { pdfjs, toPdfjsData } = require('./pdfText');

/** pdfjs ImageKind. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** Ignore decorative marks (logos, signature stamps) — a page scan is big. */
const MIN_IMAGE_PIXELS = 50000; // ~224×224
const MAX_IMAGES_PER_PAGE = 4;

let _tesseract = null;
function tesseractLib() {
  if (_tesseract !== null) return _tesseract;
  // eslint-disable-next-line global-require, import/no-unresolved
  try { _tesseract = require('tesseract.js'); } catch { _tesseract = false; }
  return _tesseract;
}

/**
 * UI language → Tesseract language code, for the twelve languages the app ships
 * in. A Japanese instance should not be trying to read its scans with a Turkish
 * model; when ZIMMET_OCR_LANGS is unset the instance language decides.
 */
const TESSERACT_LANG = {
  en: 'eng', tr: 'tur', de: 'deu', fr: 'fra', es: 'spa', it: 'ita',
  pt: 'por', nl: 'nld', pl: 'pol', ru: 'rus', ar: 'ara', ja: 'jpn',
};

/**
 * Which Tesseract models to load. An explicit ZIMMET_OCR_LANGS always wins;
 * otherwise the instance language plus English, which carries the digits, asset
 * tags and serial numbers that appear on a form whatever its language.
 * @param {string} [instanceLang] settings.language ("tr", "ar", …)
 */
function resolveLangs(instanceLang) {
  const explicit = String(config.ocr.langs || '').trim();
  if (explicit && explicit !== 'tur+eng') return explicit; // operator override
  const mapped = TESSERACT_LANG[String(instanceLang || '').slice(0, 2).toLowerCase()];
  if (!mapped) return explicit || 'tur+eng';
  return mapped === 'eng' ? 'eng' : `${mapped}+eng`;
}

/** Does the configured language directory hold the traineddata we need? */
function localLangs(langs, langPath) {
  const wanted = String(langs || '').split('+').map((s) => s.trim()).filter(Boolean);
  if (!wanted.length || !langPath) return false;
  return wanted.every((l) => {
    try { return fs.statSync(path.join(langPath, `${l}.traineddata`)).size > 0; }
    catch { return false; }
  });
}

/**
 * Why OCR can or cannot run right now — surfaced to the import UI so a scan
 * that came back unreadable has an explanation instead of a shrug.
 *
 * @param {boolean} [enabledOverride] the Owner's Integrations toggle, which
 *        wins over the ZIMMET_OCR env default. Omit to use the env value.
 * @param {string} [instanceLang] settings.language, used to pick the models.
 * @returns {{enabled:boolean, available:boolean, reason:string|null, langs:string, offline:boolean}}
 */
function availability(enabledOverride, instanceLang) {
  const { langPath } = config.ocr;
  const langs = resolveLangs(instanceLang);
  const enabled = enabledOverride === undefined ? !!config.ocr.enabled : !!enabledOverride;
  const offline = localLangs(langs, langPath);
  if (!enabled) return { enabled: false, available: false, reason: 'disabled', langs, offline };
  if (!tesseractLib()) return { enabled: true, available: false, reason: 'tesseract-missing', langs, offline };
  return { enabled: true, available: true, reason: null, langs, offline };
}

const isAvailable = (enabledOverride) => availability(enabledOverride).available;

/* ------------------------------ pixels ------------------------------ */

/**
 * Normalise a pdfjs image object to packed 24-bit RGB.
 * @returns {Buffer|null} width*height*3 bytes, or null for a kind we cannot read
 */
function toRgb24({ kind, width, height, data }) {
  if (!data || !width || !height) return null;
  const px = width * height;
  const out = Buffer.allocUnsafe(px * 3);

  if (kind === RGB_24BPP) {
    // Already packed RGB — copy straight across.
    Buffer.from(data.buffer, data.byteOffset, px * 3).copy(out);
    return out;
  }
  if (kind === RGBA_32BPP) {
    // Composite onto white: a transparent scan background must not read black.
    for (let i = 0, o = 0; i < px; i++) {
      const a = data[i * 4 + 3] / 255;
      out[o++] = Math.round(data[i * 4] * a + 255 * (1 - a));
      out[o++] = Math.round(data[i * 4 + 1] * a + 255 * (1 - a));
      out[o++] = Math.round(data[i * 4 + 2] * a + 255 * (1 - a));
    }
    return out;
  }
  if (kind === GRAYSCALE_1BPP) {
    // Packed 1bpp, rows padded to a byte. Polarity differs between an image
    // mask and a plain bilevel image, so the page is inverted below if it comes
    // out mostly dark — a document scan is light-background by definition.
    const rowBytes = (width + 7) >> 3;
    let dark = 0;
    for (let y = 0, o = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        if (!bit) dark++;
        out[o++] = v; out[o++] = v; out[o++] = v;
      }
    }
    if (dark > px * 0.6) for (let i = 0; i < out.length; i++) out[i] = 255 - out[i];
    return out;
  }
  return null;
}

/**
 * Wrap packed RGB in an uncompressed 24-bit BMP.
 * Rows are stored bottom-up as BGR and padded to a 4-byte boundary; the pixels
 * -per-metre fields carry the DPI, without which Tesseract assumes 70 and reads
 * noticeably worse.
 * @returns {Buffer}
 */
function encodeBmp24(rgb, width, height, dpi = 96) {
  const rowRaw = width * 3;
  const rowSize = rowRaw + ((4 - (rowRaw % 4)) % 4);
  const imgSize = rowSize * height;
  const out = Buffer.alloc(54 + imgSize);
  const ppm = Math.round((Number(dpi) || 96) / 0.0254);

  out.write('BM', 0);
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);          // pixel data offset
  out.writeUInt32LE(40, 14);          // BITMAPINFOHEADER
  out.writeInt32LE(width, 18);
  out.writeInt32LE(height, 22);       // positive → bottom-up rows
  out.writeUInt16LE(1, 26);           // planes
  out.writeUInt16LE(24, 28);          // bits per pixel
  out.writeUInt32LE(imgSize, 34);
  out.writeInt32LE(ppm, 38);
  out.writeInt32LE(ppm, 42);

  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * rowSize;
    const s = y * rowRaw;
    for (let x = 0; x < width; x++) {
      out[o++] = rgb[s + x * 3 + 2];  // B
      out[o++] = rgb[s + x * 3 + 1];  // G
      out[o++] = rgb[s + x * 3];      // R
    }
  }
  return out;
}

/** Decoded page images, largest first, as BMP buffers ready for Tesseract. */
async function pageImages(page, lib) {
  const ops = await page.getOperatorList();
  const names = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === lib.OPS.paintImageXObject || fn === lib.OPS.paintJpegXObject) {
      names.push(ops.argsArray[i][0]);
    }
  }

  const viewport = page.getViewport({ scale: 1 });
  const out = [];
  for (const name of names) {
    let obj;
    try { obj = await new Promise((res, rej) => { try { page.objs.get(name, res); } catch (e) { rej(e); } }); }
    catch { continue; }
    if (!obj || obj.width * obj.height < MIN_IMAGE_PIXELS) continue;
    const rgb = toRgb24(obj);
    if (!rgb) continue;
    // The scan's own resolution, from how many pixels cover the page width.
    const dpi = Math.max(72, Math.round(obj.width / (viewport.width / 72)));
    out.push({ area: obj.width * obj.height, bmp: encodeBmp24(rgb, obj.width, obj.height, dpi) });
  }
  return out.sort((a, b) => b.area - a.area).slice(0, MAX_IMAGES_PER_PAGE).map((i) => i.bmp);
}

/* ------------------------------- OCR ------------------------------- */

/**
 * OCR a PDF's pages.
 *
 * @param {Buffer} buffer
 * @param {{maxPages?:number, langs?:string}} [opts]
 *        maxPages caps how many pages are read (the caller holds a whole-batch
 *        budget); pages past it come back empty rather than failing.
 * @returns {Promise<{pages:Array<{page:number,text:string}>, ocrPages:number,
 *                    numPages:number, truncated:boolean, langs:string}>}
 */
async function ocrPages(buffer, opts = {}) {
  const tesseract = tesseractLib();
  if (!tesseract) throw new Error('OCR is not available on this server');

  const langs = opts.langs || resolveLangs(opts.instanceLang);
  const maxPages = Math.max(0, opts.maxPages == null ? config.ocr.maxPages : opts.maxPages);
  const langPath = config.ocr.langPath;

  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: toPdfjsData(buffer),
    isEvalSupported: false,
    // Force plain typed arrays out of page.objs instead of an ImageBitmap.
    isOffscreenCanvasSupported: false,
  }).promise;
  const numPages = doc.numPages; // read before destroy() below invalidates it

  // One worker for the whole document — starting one per page costs more than
  // the recognition itself.
  const workerOpts = { cachePath: langPath };
  if (localLangs(langs, langPath)) {
    // Read vendored traineddata off disk instead of the CDN, so a self-hosted
    // (or air-gapped) box never has to reach the internet.
    workerOpts.langPath = langPath;
    workerOpts.gzip = false;
  }
  const worker = await tesseract.createWorker(langs, 1, workerOpts);

  const pages = [];
  let ocrCount = 0;
  try {
    for (let i = 1; i <= numPages; i++) {
      if (ocrCount >= maxPages) { pages.push({ page: i, text: '' }); continue; }
      const page = await doc.getPage(i);
      const chunks = [];
      try {
        for (const bmp of await pageImages(page, lib)) {
          const { data } = await worker.recognize(bmp);
          if (data && data.text) chunks.push(data.text);
        }
      } finally {
        page.cleanup();
      }
      if (chunks.length) ocrCount += 1;
      pages.push({
        page: i,
        text: chunks.join('\n').replace(/[^\S\n]+/g, ' ').replace(/\n{2,}/g, '\n').trim(),
      });
    }
  } finally {
    await worker.terminate().catch(() => {});
    await doc.cleanup().catch(() => {});
    await doc.destroy().catch(() => {});
  }

  return { pages, ocrPages: ocrCount, numPages, truncated: ocrCount < numPages, langs };
}

module.exports = {
  ocrPages, availability, isAvailable, localLangs, resolveLangs, TESSERACT_LANG,
  encodeBmp24, toRgb24, GRAYSCALE_1BPP, RGB_24BPP, RGBA_32BPP,
};
