/**
 * Trim the conversation a reply carries back with it.
 *
 * Every mail client answers by quoting what it is answering: Gmail prefixes the
 * original with '>' under a "… tarihinde şunu yazdı:" line, Outlook draws a rule
 * of underscores and repeats the headers, older clients write
 * "-----Original Message-----". Left alone, each reply on a ticket pastes the
 * whole thread again — so the third reply contains the second, which contains
 * the first, and the worklog becomes unreadable while the desk's own footer and
 * logo alt-text pile up inside it.
 *
 * Nothing here guesses at meaning: every rule keys on a structural marker a
 * client wrote, never on what the person said. And the trim is refused when it
 * would leave nothing behind, because a mangled reply is worse than a long one —
 * the caller then keeps the original text and a human decides.
 *
 * Pure — no IMAP, no DB — so the shapes real clients produce can be pinned in
 * tests.
 */

/**
 * Lines that open a quoted original. Each must be anchored to a whole line and
 * must carry evidence it is an attribution — a date, an address, or the client's
 * own separator — so an ordinary sentence ending in "wrote:" survives.
 */
const ATTRIBUTION = [
  // Gmail/Apple Mail, Turkish: "<a@b.com> adresine sahip kullanıcı 10 Eyl 2026 Per, 10:11 tarihinde şunu yazdı:"
  /^[^\n]*\b\d{4}[^\n]*tarihinde[^\n]*yazdı\s*:?\s*$/im,
  /^[^\n]*tarihinde[^\n]*(şunu\s+yazdı|yazdı)\s*:?\s*$/im,
  // English: "On Wed, 10 Sep 2026 at 10:11, Someone <a@b.com> wrote:"
  /^\s*On\b[^\n]*\bwrote\s*:\s*$/im,
  // German / French / Spanish / Italian / Portuguese / Dutch / Polish / Russian
  /^\s*Am\b[^\n]*schrieb[^\n]*:\s*$/im,
  /^\s*Le\b[^\n]*a\s+écrit\s*:\s*$/im,
  /^\s*El\b[^\n]*escribió\s*:\s*$/im,
  /^\s*Il\b[^\n]*ha\s+scritto\s*:\s*$/im,
  /^\s*Em\b[^\n]*escreveu\s*:\s*$/im,
  /^\s*Op\b[^\n]*schreef[^\n]*:\s*$/im,
  /^[^\n]*\bnapisał\(a\)\s*:\s*$/im,
  /^[^\n]*\bнаписал\(а\)\s*:\s*$/im,
  // Explicit separators, whatever the language
  /^\s*-{2,}\s*(Original Message|Originalnachricht|Message d'origine|Mensaje original|İletilen ileti|Forwarded message)\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m, // Outlook's rule above the repeated headers
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
];

/** The first line of a '>' quote block, but only once real text precedes it. */
function firstQuoteBlock(text) {
  const lines = text.split('\n');
  let sawContent = false;
  let offset = 0;
  for (const line of lines) {
    if (/^\s*>/.test(line)) {
      if (sawContent) return offset;
    } else if (line.trim()) {
      sawContent = true;
    }
    offset += line.length + 1;
  }
  return -1;
}

/**
 * @param {string} raw the plain-text body of an inbound reply
 * @returns {string} just what this person wrote, or '' when that is nothing
 */
function stripQuotedReply(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  if (!text.trim()) return '';

  let cut = -1;
  for (const re of ATTRIBUTION) {
    const m = re.exec(text);
    // index 0 would mean the message IS the quote: there is nothing to keep, and
    // cutting there would throw the whole reply away.
    if (m && m.index > 0 && (cut === -1 || m.index < cut)) cut = m.index;
  }
  const q = firstQuoteBlock(text);
  if (q > 0 && (cut === -1 || q < cut)) cut = q;

  if (cut === -1) return text.replace(/\n{3,}/g, '\n\n').trim();

  let kept = text.slice(0, cut).replace(/\n{3,}/g, '\n\n').trim();
  // The cut can land below the attribution rather than above it: clients wrap
  // "<a@b.com> adresine sahip kullanıcı 10 Eyl 2026 Per, 10:11 / tarihinde şunu
  // yazdı:" across lines, and plenty of languages are not listed above at all.
  // So the paragraph sitting immediately over the cut is dropped when it reads
  // like an attribution — it names a date or an address and does not end like a
  // sentence. Anything a person actually wrote ends in punctuation or carries
  // neither.
  const paras = kept.split(/\n\s*\n/);
  const last = (paras[paras.length - 1] || '').trim();
  if (last && /@|\b\d{4}\b/.test(last) && !/[.!?]$/.test(last)) {
    paras.pop();
    kept = paras.join('\n\n').trim();
  }
  return kept;
}

module.exports = { stripQuotedReply };
