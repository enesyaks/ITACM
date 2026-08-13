/**
 * Turkish-aware person-name matching for the zimmet PDF import.
 *
 * Folds Turkish letters to ASCII so "Ayşe Yılmaz" from a scanned form matches
 * "Ayse Yilmaz" in the DB, then scores candidates by token overlap + edit
 * distance. Also does a REVERSE lookup: given a page's raw text and the
 * employee list, find which known names actually appear in the text — the
 * strongest signal, since the roster is authoritative.
 */
'use strict';

const TR_MAP = { ş: 's', ı: 'i', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' };

/**
 * Case-fold Turkish text to ASCII while keeping punctuation and layout.
 * JavaScript's /i flag does NOT relate 'İ' (U+0130) to 'i', so patterns like
 * /zimmet/i or /teslim alan/i silently miss "ZİMMET" and "TESLİM ALAN" — the
 * normal casing on a Turkish form. Every marker/label regex matches folded text
 * instead. Each character maps to exactly one character, so offsets into the
 * folded string still address the original.
 */
const TR_FOLD = { İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c' };
function foldTr(input) {
  return String(input == null ? '' : input).replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => TR_FOLD[ch]).toLowerCase();
}

/** Fold Turkish letters + diacritics to ASCII, lowercase, strip punctuation. */
function normalizeName(input) {
  if (input == null) return '';
  // Lowercase first: 'İ'→'i̇' (combining dot, stripped below), 'I'→'i', 'Ş'→'ş'…
  let s = String(input).toLowerCase();
  s = s.replace(/[şığüöç]/g, (ch) => TR_MAP[ch]);
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); // drop combining accents
  s = s.replace(/[^a-z0-9\s]/g, ' ');                      // punctuation → space
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
 * Reverse match: which known employees' names appear in the page text?
 * Strong because the roster is authoritative. Returns unique matches with the
 * portion of text that hit, sorted by name length (longer = more specific).
 */
function findNamesInText(text, employees) {
  const norm = ` ${normalizeName(text).replace(/\n/g, ' ')} `;
  const hits = [];
  for (const e of employees || []) {
    const parts = tokens(e.fullName);
    // A single-token roster entry ("Ali") would hit any form mentioning that
    // word — far too loose to auto-assign a document on. Needs a full name.
    if (parts.length < 2) continue;
    const key = parts.join(' ');
    if (norm.includes(` ${key} `)) hits.push({ id: e.id, fullName: e.fullName, key, score: 1, via: 'text' });
  }
  // "Ali Yılmaz" also matches inside "Ali Yılmaz Kaya" — when one hit's name is
  // contained in another's, only the longer (more specific) one is real.
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.key.includes(h.key)));
  return kept.sort((a, b) => b.key.length - a.key.length);
}

/**
 * Assignee label heuristic (Turkish): "Teslim Alan: Ad Soyad", "Personel: …".
 * `[^\S\n]` keeps the capture on one line — pdfText preserves line breaks, and
 * a greedy `\s` would run into whatever is typeset underneath the field.
 */
const LABEL_RE = /(teslim ?alan|zimmetlenen|personel|adi?[^\S\n]*soyadi?|kullanici)[^\S\n]*[:\-][^\S\n]*([a-z][a-z.\t ]{2,49})/;

/** Keep at most the first 4 words — a label capture often trails into the next field. */
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
