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
    // High: a strong, clearly-leading single match. Medium: matched but close/ambiguous.
    if (top.score >= 0.92 && (!second || top.score - second.score >= 0.08)) confidence = 'high';
    else confidence = 'medium';
  }
  return { candidates: scored.slice(0, 5), confidence, best: scored[0] || null };
}

/**
 * Reverse match: which known employees' names appear in the page text?
 * Strong because the roster is authoritative. Returns unique matches with the
 * portion of text that hit, sorted by name length (longer = more specific).
 */
function findNamesInText(text, employees) {
  const norm = ` ${normalizeName(text)} `;
  const hits = [];
  for (const e of employees || []) {
    const key = tokens(e.fullName).join(' ');
    if (key.length < 3) continue;
    if (norm.includes(` ${key} `)) hits.push({ id: e.id, fullName: e.fullName, score: 1, via: 'text' });
  }
  return hits.sort((a, b) => b.fullName.length - a.fullName.length);
}

module.exports = { normalizeName, tokens, levenshtein, ratio, nameSimilarity, matchEmployee, findNamesInText };
