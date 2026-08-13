/**
 * Bulk zimmet PDF import — form splitting + Turkish name matching.
 *
 * These two pieces decide which pages become a document and whose profile it
 * lands on, and both fail silently: an over-eager split shreds one form into
 * three, and a loose name match files someone's zimmet on a colleague. Pure
 * functions, no database.
 *
 * Run: node --test tests/zimmet-import.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');

const { detectForms, pagesToPdf, splitForms, pageCount } = require('../src/utils/pdfSplit');
const {
  normalizeName, nameSimilarity, matchEmployee, findNamesInText, nameFromLabel,
} = require('../src/utils/nameMatch');

/* ------------------------- splitting ------------------------- */

// Page text as pdfText produces it: real line breaks, title on its own line.
const TITLE = 'ZİMMET TESLİM TUTANAĞI';
// A real form repeats the marker words in its body copy and footer — that must
// not be read as the start of a new form.
const BODY = ['Aşağıda özellikleri yazılı demirbaşlar tarafıma teslim edilmiştir.',
  'İşbu zimmet tutanağı iki nüsha olarak düzenlenmiş ve devir teslim şartları',
  'taraflarca kabul edilmiştir.'].join('\n');
const titlePage = (who) => `${TITLE}\nBelge No: 2024/17\nTeslim Alan: ${who}\n${BODY}`;

test('detectForms matches a Turkish uppercase title (İ is not /i/-equal to i)', () => {
  // The whole feature hinged on this: JS /i does not fold 'İ' to 'i'.
  assert.deepEqual(detectForms([`${TITLE}\nAli Vural`, 'devam sayfası']), [{ from: 0, to: 1 }]);
});

test('detectForms starts a new form on each title page', () => {
  const pages = [titlePage('Ali Vural'), BODY, BODY, titlePage('Ayşe Yılmaz'), BODY];
  assert.deepEqual(detectForms(pages), [{ from: 0, to: 2 }, { from: 3, to: 4 }]);
});

test('detectForms does not split on the marker appearing in body copy', () => {
  // Every page mentions "zimmet"/"devir teslim" mid-paragraph; only page 0 is a
  // title page. Matching anywhere would shred this one form into three.
  const pages = [titlePage('Ali Vural'), `Devam sayfası\n${BODY}`, `Ek liste\n${BODY}`];
  assert.deepEqual(detectForms(pages), [{ from: 0, to: 2 }]);
});

test('detectForms treats one-page-per-form uploads as one form each', () => {
  const pages = [titlePage('Ali'), titlePage('Ayşe'), titlePage('Mehmet')];
  assert.deepEqual(detectForms(pages), [{ from: 0, to: 0 }, { from: 1, to: 1 }, { from: 2, to: 2 }]);
});

test('detectForms keeps pages before the first marker with the first form', () => {
  const pages = ['Kapak sayfası', titlePage('Ali'), 'devam', titlePage('Ayşe')];
  assert.deepEqual(detectForms(pages), [{ from: 0, to: 0 }, { from: 1, to: 2 }, { from: 3, to: 3 }]);
});

test('detectForms falls back to a single form when nothing matches', () => {
  assert.deepEqual(detectForms(['bir', 'iki', 'üç']), [{ from: 0, to: 2 }]);
  assert.deepEqual(detectForms(['tek']), [{ from: 0, to: 0 }]);
  assert.deepEqual(detectForms([]), []);
});

test('pagesToPdf slices the requested pages into a standalone PDF', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i++) doc.addPage([200, 200]);
  const src = Buffer.from(await doc.save());
  assert.equal(await pageCount(src), 5);

  const out = await pagesToPdf(src, [1, 2]);
  assert.equal(await pageCount(out), 2);
  assert.equal(out.subarray(0, 4).toString(), '%PDF'); // still a real PDF
});

test('splitForms cuts every range from one parse of the source', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 5; i++) doc.addPage([200, 200]);
  const src = Buffer.from(await doc.save());

  const parts = await splitForms(src, [{ from: 0, to: 2 }, { from: 3, to: 4 }]);
  assert.equal(parts.length, 2);
  assert.deepEqual(await Promise.all(parts.map(pageCount)), [3, 2]);
  assert.deepEqual(await splitForms(src, []), []);
});

/* ------------------------- name matching ------------------------- */

test('normalizeName folds Turkish letters, case and punctuation to ASCII', () => {
  assert.equal(normalizeName('Ayşe Yılmaz'), 'ayse yilmaz');
  assert.equal(normalizeName('İbrahim ÖZTÜRK'), 'ibrahim ozturk');
  assert.equal(normalizeName('Çağla  Gündoğdu.'), 'cagla gundogdu');
  assert.equal(normalizeName(null), '');
});

test('nameSimilarity ignores word order and survives a scan typo', () => {
  assert.ok(nameSimilarity('Yılmaz Ayşe', 'Ayşe Yılmaz') > 0.95);
  assert.ok(nameSimilarity('Ayse Yilmoz', 'Ayşe Yılmaz') > 0.8);
  assert.ok(nameSimilarity('Mehmet Demir', 'Ayşe Yılmaz') < 0.5);
});

test('matchEmployee only reports high confidence for a clear leader', () => {
  const emps = [
    { id: '1', fullName: 'Ayşe Yılmaz' },
    { id: '2', fullName: 'Ayse Yilmez' },
    { id: '3', fullName: 'Mehmet Demir' },
  ];
  // Two near-identical roster names → ambiguous, never auto-attach.
  assert.equal(matchEmployee('Ayşe Yılmaz', emps).confidence, 'medium');
  const clear = matchEmployee('Mehmet Demir', emps);
  assert.equal(clear.confidence, 'high');
  assert.equal(clear.best.id, '3');
  assert.equal(matchEmployee('', emps).confidence, 'none');
  assert.equal(matchEmployee('Zeynep Kara', emps).confidence, 'none');
});

test('findNamesInText matches a roster name inside form text, Turkish-folded', () => {
  const emps = [{ id: '1', fullName: 'Ayşe Yılmaz' }, { id: '2', fullName: 'Mehmet Demir' }];
  const hits = findNamesInText('Teslim Alan: AYSE YILMAZ / IT Departmanı', emps);
  assert.deepEqual(hits.map((h) => h.id), ['1']);
});

test('findNamesInText ignores single-word roster entries', () => {
  // "Ali" would otherwise hit any form containing the word.
  const emps = [{ id: '1', fullName: 'Ali' }];
  assert.deepEqual(findNamesInText('Zimmet ali tarafından teslim alınmıştır', emps), []);
});

test('findNamesInText prefers the longer name when one contains another', () => {
  const emps = [{ id: '1', fullName: 'Ali Yılmaz' }, { id: '2', fullName: 'Ali Yılmaz Kaya' }];
  const hits = findNamesInText('Teslim Alan: Ali Yılmaz Kaya', emps);
  assert.deepEqual(hits.map((h) => h.id), ['2']);
});

/* ------------------------- label heuristic ------------------------- */

test('nameFromLabel reads an uppercase Turkish label and keeps the spelling', () => {
  // "TESLİM ALAN" is the usual casing and /i never matched its dotted İ.
  assert.equal(nameFromLabel('TESLİM ALAN: Ayşe Yılmaz\nTarih: 01.02.2024'), 'Ayşe Yılmaz');
  assert.equal(nameFromLabel('Adı Soyadı : Mehmet Demir'), 'Mehmet Demir');
  assert.equal(nameFromLabel('Personel- Ali Vural'), 'Ali Vural');
});

test('nameFromLabel stops at the end of the line and caps runaway captures', () => {
  assert.equal(nameFromLabel('Teslim Alan: Ayşe Yılmaz\nTeslim Eden: Ali Vural'), 'Ayşe Yılmaz');
  assert.equal(nameFromLabel('Personel: Bir Iki Uc Dort Bes Alti'), 'Bir Iki Uc Dort');
});

test('nameFromLabel returns empty when no label is present', () => {
  assert.equal(nameFromLabel('ZİMMET TESLİM TUTANAĞI\nBelge No: 2024/17'), '');
  assert.equal(nameFromLabel(null), '');
});

/* ------------------------- OCR image handling ------------------------- */

const ocr = require('../src/utils/pdfOcr');

test('encodeBmp24 writes a readable BMP with padded, bottom-up BGR rows', () => {
  // 2×2: row0 = red, blue; row1 = green, white.
  const rgb = Buffer.from([255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 255]);
  const bmp = ocr.encodeBmp24(rgb, 2, 2, 150);

  assert.equal(bmp.subarray(0, 2).toString(), 'BM');
  assert.equal(bmp.readUInt32LE(10), 54);      // pixel offset
  assert.equal(bmp.readInt32LE(18), 2);        // width
  assert.equal(bmp.readInt32LE(22), 2);        // height, positive = bottom-up
  assert.equal(bmp.readUInt16LE(28), 24);      // bpp
  assert.equal(bmp.readInt32LE(38), Math.round(150 / 0.0254)); // DPI → px/metre
  // 2px × 3B = 6B, padded to 8B per row.
  assert.equal(bmp.length, 54 + 8 * 2);
  // Bottom-up: the file's first row is the image's LAST row (green, white), BGR.
  assert.deepEqual([...bmp.subarray(54, 60)], [0, 255, 0, 255, 255, 255]);
  assert.deepEqual([...bmp.subarray(62, 68)], [0, 0, 255, 255, 0, 0]);
});

test('toRgb24 flattens RGBA onto white so a transparent scan is not black', () => {
  const rgba = Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 255]);
  const out = ocr.toRgb24({ kind: ocr.RGBA_32BPP, width: 2, height: 1, data: rgba });
  assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]); // transparent → white
});

test('toRgb24 expands 1bpp and inverts a mostly-dark page', () => {
  // 8×1, one lit pixel: as-is that is 7/8 dark, so it must come back inverted.
  const out = ocr.toRgb24({ kind: ocr.GRAYSCALE_1BPP, width: 8, height: 1, data: Uint8Array.from([0b10000000]) });
  assert.equal(out.length, 24);
  assert.deepEqual([...out.subarray(0, 3)], [0, 0, 0]);       // the lit pixel, inverted
  assert.deepEqual([...out.subarray(3, 6)], [255, 255, 255]); // background → white
});

test('toRgb24 returns null for an image kind it cannot read', () => {
  assert.equal(ocr.toRgb24({ kind: 99, width: 2, height: 2, data: new Uint8Array(12) }), null);
  assert.equal(ocr.toRgb24({ kind: ocr.RGB_24BPP, width: 0, height: 0, data: null }), null);
});

test('availability never throws and reports a reason whenever OCR cannot run', () => {
  // Asserted as invariants, not fixed values: whether ZIMMET_OCR happens to be
  // set in the developer's .env must not decide whether the suite passes.
  const a = ocr.availability();
  assert.equal(typeof a.enabled, 'boolean');
  assert.equal(typeof a.available, 'boolean');
  assert.ok(!a.available || a.enabled, 'available implies enabled');
  assert.equal(a.available, a.reason === null, 'a reason is given exactly when OCR is unavailable');
  if (!a.enabled) assert.equal(a.reason, 'disabled');
  assert.ok(a.langs.length > 0);
});
