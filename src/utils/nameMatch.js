/**
 * Person-name matching for the zimmet PDF import, across the languages the app
 * ships in.
 *
 * Folds accents and Turkish letters so "Ayşe Yılmaz" from a scanned form
 * matches "Ayse Yilmaz" in the DB, then scores candidates by token overlap +
 * edit distance. Also does a REVERSE lookup: given a page's raw text and the
 * employee list, find which known names actually appear in the text — the
 * strongest signal, since the roster is authoritative.
 *
 * Non-Latin scripts (Cyrillic, Arabic, CJK, Greek…) are carried through intact
 * rather than folded to ASCII: there is nothing to fold them to. Both the
 * roster name and the page text go through the same normalisation, so matching
 * only needs the two sides to agree — not to end up as ASCII.
 */
'use strict';

const TR_MAP = { ş: 's', ı: 'i', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' };

/**
 * Case-fold accented Latin text so a marker/label regex written in plain ASCII
 * still matches "ZİMMET", "ÜBERGABEPROTOKOLL" or "PROTOKÓŁ".
 *
 * JavaScript's /i flag does NOT relate 'İ' (U+0130) to 'i', so /zimmet/i
 * silently misses "ZİMMET" — the normal casing on a Turkish form. Rather than
 * rely on /i, every marker and label pattern matches text put through here.
 *
 * EVERY entry maps ONE character to ONE character. nameFromLabel slices the
 * result back out of the source string by offset, which only holds while the
 * fold preserves length — so no ß→ss, no NFD decomposition.
 */
const FOLD = {
  // Turkish
  İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g',
  // Latin-1 / Latin-2 vowels and consonants used by de, fr, es, it, pt, nl, pl
  Ä: 'a', ä: 'a', Á: 'a', á: 'a', À: 'a', à: 'a', Â: 'a', â: 'a', Ã: 'a', ã: 'a', Å: 'a', å: 'a', Ą: 'a', ą: 'a',
  É: 'e', é: 'e', È: 'e', è: 'e', Ê: 'e', ê: 'e', Ë: 'e', ë: 'e', Ę: 'e', ę: 'e',
  Í: 'i', í: 'i', Ì: 'i', ì: 'i', Î: 'i', î: 'i', Ï: 'i', ï: 'i',
  Ó: 'o', ó: 'o', Ò: 'o', ò: 'o', Ô: 'o', ô: 'o', Õ: 'o', õ: 'o', Ö: 'o', ö: 'o', Ø: 'o', ø: 'o',
  Ú: 'u', ú: 'u', Ù: 'u', ù: 'u', Û: 'u', û: 'u', Ü: 'u', ü: 'u',
  Ç: 'c', ç: 'c', Ć: 'c', ć: 'c', Ñ: 'n', ñ: 'n', Ń: 'n', ń: 'n',
  Ł: 'l', ł: 'l', Ś: 's', ś: 's', Ź: 'z', ź: 'z', Ż: 'z', ż: 'z', Ý: 'y', ý: 'y', ÿ: 'y',
};
const FOLD_RE = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g');
function foldTr(input) {
  return String(input == null ? '' : input).replace(FOLD_RE, (ch) => FOLD[ch]).toLowerCase();
}

/**
 * Normalise a name for comparison: lowercase, accents folded, punctuation
 * dropped, whitespace collapsed.
 *
 * Letters are kept by Unicode category (\p{L}), NOT by an a-z whitelist. An
 * a-z filter erased Cyrillic, Arabic and CJK names down to an empty string, so
 * those employees could never be matched at all — the name was gone before any
 * comparison happened.
 */
function normalizeName(input) {
  if (input == null) return '';
  // Lowercase first: 'İ'→'i̇' (combining dot, stripped below), 'I'→'i', 'Ş'→'ş'…
  let s = String(input).toLowerCase();
  s = s.replace(/[şığüöç]/g, (ch) => TR_MAP[ch]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // drop combining accents
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');                // punctuation → space, any script
  return s.replace(/\s+/g, ' ').trim();
}

/** Common Turkish honorifics / label words to drop before matching. */
const STOP = new Set(['sn', 'sayin', 'bay', 'bayan', 'personel', 'ad', 'soyad', 'adi', 'soyadi']);

function tokens(input) {
  return normalizeName(input).split(' ').filter((t) => t && !STOP.has(t));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 0..1 similarity of two strings (1 = identical). */
function ratio(a, b) {
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Order-independent similarity of two names: greedily pair each token of the
 * shorter set with its best match in the longer set, average the pair ratios,
 * and penalise leftover (unmatched) tokens.
 */
function nameSimilarity(a, b) {
  const ta = tokens(a); const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Array(long.length).fill(false);
  let sum = 0;
  for (const tok of short) {
    let best = 0; let bestIdx = -1;
    long.forEach((lt, i) => {
      if (used[i]) return;
      const r = ratio(tok, lt);
      if (r > best) { best = r; bestIdx = i; }
    });
    if (bestIdx >= 0) used[bestIdx] = true;
    sum += best;
  }
  const avg = sum / short.length;
  const coverage = short.length / long.length; // penalise size mismatch
  return avg * (0.6 + 0.4 * coverage);
}

/**
 * Rank employees against an extracted name string.
 * @param {string} extracted   name read from the PDF
 * @param {Array<{id,fullName}>} employees
 * @param {number} threshold   min score to be a candidate (default 0.72)
 * @returns {{ candidates: Array<{id,fullName,score}>, confidence: 'high'|'medium'|'none', best }}
 */
function matchEmployee(extracted, employees, threshold = 0.72) {
  const scored = (employees || [])
    .map((e) => ({ id: e.id, fullName: e.fullName, score: nameSimilarity(extracted, e.fullName) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
  let confidence = 'none';
  if (scored.length) {
    const top = scored[0];
    const second = scored[1];
    // High: a strong, clearly-leading single match. A runner-up that is itself
    // an excellent match ("Ayşe Yılmaz" vs "Ayşe Yılmaz" / "Ayse Yilmez") stays
    // medium however wide the gap looks — filing a zimmet on the wrong person
    // costs far more than asking. Medium: matched but close/ambiguous.
    const clearLead = !second || (top.score - second.score >= 0.08 && second.score < 0.9);
    confidence = (top.score >= 0.92 && clearLead) ? 'high' : 'medium';
  }
  return { candidates: scored.slice(0, 5), confidence, best: scored[0] || null };
}

/**
 * Chinese/Japanese/Korean write a full name without spaces (田中太郎), and their
 * prose has no spaces to delimit it with either — so such a name is both
 * allowed as a single token and looked up as a plain substring. Three or more
 * ideographs/kana is a full name rather than a bare surname, which is what
 * makes the looser lookup safe.
 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
function isSpacelessFullName(key) {
  return CJK_RE.test(key) && key.length >= 3;
}

/**
 * Reverse match: which known employees' names appear in the page text?
 * Strong because the roster is authoritative. Returns unique matches with the
 * portion of text that hit, sorted by name length (longer = more specific).
 */
function findNamesInText(text, employees) {
  const norm = ` ${normalizeName(text).replace(/\n/g, ' ')} `;
  const hits = [];
  for (const e of employees || []) {
    const parts = tokens(e.fullName);
    const key = parts.join(' ');
    const spaceless = isSpacelessFullName(key);
    // A single-token roster entry ("Ali") would hit any form mentioning that
    // word — far too loose to auto-assign a document on. Needs a full name,
    // except in scripts that write one without spaces.
    if (parts.length < 2 && !spaceless) continue;
    // CJK prose has no spaces, so a space-delimited lookup would never fire.
    const found = spaceless ? norm.includes(key) : norm.includes(` ${key} `);
    if (found) hits.push({ id: e.id, fullName: e.fullName, key, score: 1, via: 'text' });
  }
  // "Ali Yılmaz" also matches inside "Ali Yılmaz Kaya" — when one hit's name is
  // contained in another's, only the longer (more specific) one is real.
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.key.includes(h.key)));
  return kept.sort((a, b) => b.key.length - a.key.length);
}

/**
 * "Who received this?" labels, one group per shipped UI language. Matched
 * against folded text (see foldTr), so the accented forms are written here
 * already folded: "empfanger" for Empfänger, "recu par" for reçu par.
 *
 * This is the FALLBACK path — the primary signal is finding a roster name in
 * the text (findNamesInText), which needs no labels at all. The label matters
 * when OCR mangled the name enough that the exact lookup missed and only the
 * fuzzy scorer can still place it.
 */
const LABEL_WORDS = [
  'teslim ?alan', 'zimmetlenen', 'personel', 'adi?[^\\S\\n]*soyadi?', 'kullanici',   // tr
  'received ?by', 'issued ?to', 'recipient', 'employee ?name', 'full ?name', 'employee', // en
  'empfanger', 'ubergeben ?an', 'mitarbeiter',                                       // de
  'remis ?a', 'recu ?par', 'destinataire', 'employe',                                // fr
  'recibido ?por', 'entregado ?a', 'empleado',                                       // es
  'consegnato ?a', 'ricevuto ?da', 'dipendente',                                     // it
  'recebido ?por', 'entregue ?a', 'funcionario',                                     // pt
  'ontvangen ?door', 'overhandigd ?aan', 'medewerker',                               // nl
  'odbiorca', 'przekazano', 'pracownik',                                             // pl
  'получил', 'получатель', 'сотрудник',                                              // ru
  'المستلم', 'اسم ?الموظف', 'الموظف',                                                  // ar
  '受領者', '受取人', '氏名', '社員',                                                    // ja
];
/**
 * `[^\S\n]` keeps the capture on one line — pdfText preserves line breaks, and
 * a greedy `\s` would run into whatever is typeset underneath the field. The
 * name is matched by Unicode letter class, not a-z, so Cyrillic, Arabic and CJK
 * names are captured rather than silently skipped.
 */
const LABEL_RE = new RegExp(
  `(${LABEL_WORDS.join('|')})[^\\S\\n]*[:\\-][^\\S\\n]*([\\p{L}][\\p{L}.\\t ]{2,49})`,
  'u'
);

/**
 * Keep at most the first 4 words — a label capture often trails into the next
 * field. A spaceless CJK name is one "word" already, so it survives untouched.
 */
function trimName(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().split(' ').slice(0, 4)
    .join(' ');
}

/**
 * Read the name next to a label, returned in its ORIGINAL spelling.
 * The regex runs on folded text (see foldTr) but the result is sliced out of
 * the source, so "TESLİM ALAN: Ayşe Yılmaz" yields "Ayşe Yılmaz", not "ayse…".
 */
function nameFromLabel(text) {
  const src = String(text == null ? '' : text);
  const folded = foldTr(src);
  const m = LABEL_RE.exec(folded);
  if (!m) return '';
  const start = m.index + m[0].length - m[2].length;
  // foldTr is 1:1, so offsets line up; fall back if that ever stops holding.
  const raw = folded.length === src.length ? src.slice(start, start + m[2].length) : m[2];
  return trimName(raw);
}

module.exports = {
  normalizeName, foldTr, tokens, levenshtein, ratio, nameSimilarity,
  matchEmployee, findNamesInText, nameFromLabel, trimName, LABEL_RE,
};
