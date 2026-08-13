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

/* ------------------------- every shipped language ------------------------- */

// One realistic page per UI language: the title as it is actually typeset, and
// the "who received this" label line. An a-z-only normaliser erased Cyrillic,
// Arabic and CJK names to an empty string, so those employees could never be
// matched at all — this table is what stops that from coming back.
const LANGS = [
  ['tr', 'Ayşe Yılmaz', 'ZİMMET TESLİM TUTANAĞI', 'Teslim Alan: Ayşe Yılmaz'],
  ['en', 'John Smith', 'HANDOVER FORM', 'Received by: John Smith'],
  ['de', 'Jürgen Müller', 'ÜBERGABEPROTOKOLL', 'Empfänger: Jürgen Müller'],
  ['fr', 'François Lefèvre', 'PROCÈS-VERBAL DE REMISE', 'Remis à: François Lefèvre'],
  ['es', 'José Muñoz', 'ACTA DE ENTREGA', 'Recibido por: José Muñoz'],
  ['it', 'Luca Rossi', 'VERBALE DI CONSEGNA', 'Consegnato a: Luca Rossi'],
  ['pt', 'João Gonçalves', 'TERMO DE ENTREGA', 'Recebido por: João Gonçalves'],
  ['nl', 'Jeroen de Vries', 'OVERDRACHTSFORMULIER', 'Ontvangen door: Jeroen de Vries'],
  ['pl', 'Łukasz Wiśniewski', 'PROTOKÓŁ PRZEKAZANIA', 'Odbiorca: Łukasz Wiśniewski'],
  ['ru', 'Иван Петров', 'АКТ ПРИЁМА-ПЕРЕДАЧИ', 'Получил: Иван Петров'],
  ['ar', 'أحمد الشمري', 'محضر تسليم العهدة', 'المستلم: أحمد الشمري'],
  ['ja', '田中太郎', '貸与物受領書', '受領者: 田中太郎'],
];
const langRoster = LANGS.map(([, name], i) => ({ id: `e${i}`, fullName: name }));
const langPage = ([, , title, label]) => `${title}\nBelge No: 1\n${label}\nteslim edilmistir.`;

test('normalizeName keeps letters of every script instead of only a-z', () => {
  assert.equal(normalizeName('Иван Петров'), 'иван петров');
  assert.equal(normalizeName('田中太郎'), '田中太郎');
  assert.ok(normalizeName('أحمد الشمري').length > 0, 'Arabic must survive normalisation');
  // Latin folding is unchanged.
  assert.equal(normalizeName('Ayşe Yılmaz'), 'ayse yilmaz');
  assert.equal(normalizeName('Jürgen Müller'), 'jurgen muller');
  assert.equal(normalizeName('Łukasz Wiśniewski.'), 'łukasz wisniewski');
});

test('the roster name is found in the page text in every shipped language', () => {
  for (const row of LANGS) {
    const [lang, name] = row;
    const hits = findNamesInText(langPage(row), langRoster);
    assert.deepEqual(hits.map((h) => h.fullName), [name], `${lang}: reverse lookup`);
  }
});

test('the assignee label is read in every shipped language', () => {
  for (const row of LANGS) {
    const [lang, name] = row;
    assert.equal(nameFromLabel(langPage(row)), name, `${lang}: label heuristic`);
  }
});

test('a form title starts a new form in every shipped language', () => {
  for (const row of LANGS) {
    const [lang, , title] = row;
    assert.deepEqual(
      detectForms([`${title}\nsayfa`, `${title}\nsayfa`]),
      [{ from: 0, to: 0 }, { from: 1, to: 1 }],
      `${lang}: title "${title}" must start a form`
    );
  }
});

test('widening the scripts did not loosen the false-positive guards', () => {
  // A single-token Latin name is still too weak to auto-assign on.
  assert.deepEqual(findNamesInText('zimmet ali tarafindan alindi', [{ id: 'x', fullName: 'Ali' }]), []);
  // A bare CJK surname (2 chars) is a surname, not a full name.
  assert.deepEqual(findNamesInText('田中さんが受領しました', [{ id: 'y', fullName: '田中' }]), []);
  // Body copy mentioning the marker still does not split a multi-page form.
  const body = 'Isbu zimmet tutanagi iki nusha olarak duzenlenmis, devir teslim kabul edilmistir.';
  assert.deepEqual(detectForms([`ZİMMET TESLİM TUTANAĞI\nx\n${body}`, `devam\n${body}`]), [{ from: 0, to: 1 }]);
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

test('OCR models follow the instance language, not a hardcoded Turkish default', () => {
  // A Japanese instance reading its scans with a Turkish model is the bug this
  // guards; English rides along for digits, asset tags and serials.
  assert.equal(ocr.resolveLangs('ja'), 'jpn+eng');
  assert.equal(ocr.resolveLangs('ar'), 'ara+eng');
  assert.equal(ocr.resolveLangs('ru'), 'rus+eng');
  assert.equal(ocr.resolveLangs('tr'), 'tur+eng');
  assert.equal(ocr.resolveLangs('en'), 'eng', 'English needs no second model');
  // Unknown or missing language falls back rather than producing a bad code.
  assert.equal(ocr.resolveLangs('zz'), 'tur+eng');
  assert.equal(ocr.resolveLangs(undefined), 'tur+eng');
  // Every shipped UI language maps to a real Tesseract code.
  for (const lang of ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'ja']) {
    assert.match(ocr.TESSERACT_LANG[lang], /^[a-z]{3}$/, `${lang} needs a Tesseract code`);
  }
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
