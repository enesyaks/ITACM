/**
 * Inbound-mail filtering: an explicit sender blocklist, and a deliberately
 * narrow "this is bulk mail, not a support request" test.
 *
 * Pure — no IMAP, no DB — so both rules can be unit-tested and reasoned about
 * on their own. The bulk test reads headers only, never the subject or body:
 * guessing from words ("indirim", "sale", "unsubscribe" in the text) is how a
 * real request from a supplier ends up silently dropped. Every signal used here
 * is one a mass-sending platform sets and a person writing from their mail
 * client does not.
 */

/** 'Foo <A@B.COM>' | 'a@b.com' → 'a@b.com'. Empty when there's no address. */
function addressOf(value) {
  let s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return '';
  const angled = s.match(/<([^>]+)>/);
  if (angled) s = angled[1].trim();
  s = s.replace(/^[<\s]+|[>\s,;]+$/g, '');
  return s.includes('@') ? s : '';
}

/**
 * Normalise one blocklist entry. Exactly two shapes are accepted:
 *   a@b.com   → that single address
 *   b.com     → every address at that domain and its subdomains
 * `@b.com` and `*@b.com` are accepted as ways of writing the domain form.
 * Anything else (spaces, bare words, an address with no domain) returns ''.
 */
function normalizeBlockEntry(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!s || s.length > 200) return '';
  const angled = s.match(/<([^>]+)>/);
  if (angled) s = angled[1].trim();
  s = s.replace(/^\*@/, '@').replace(/^@/, '');
  s = s.replace(/^[<\s]+|[>\s,;]+$/g, '');
  if (!s || s.length > 200) return '';
  if (s.includes('@')) {
    return /^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
  }
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}

/** Clean a whole list: normalise, drop rejects and duplicates, cap the size. */
function parseBlocklist(input, { max = 500 } = {}) {
  const list = Array.isArray(input)
    ? input
    : String(input == null ? '' : input).split(/[\n,;]+/);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const e = normalizeBlockEntry(raw);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Is this sender on the list? An entry with '@' matches that address exactly;
 * a bare domain matches the domain itself and anything under it. The subdomain
 * test is anchored on a dot so `medium.com` cannot be matched by
 * `medium.com.attacker.ru`.
 */
function isBlockedSender(from, list) {
  const addr = addressOf(from);
  if (!addr || !Array.isArray(list) || !list.length) return false;
  const domain = addr.split('@')[1] || '';
  if (!domain) return false;
  for (const entry of list) {
    if (!entry) continue;
    if (entry.includes('@')) {
      if (addr === entry) return true;
    } else if (domain === entry || domain.endsWith('.' + entry)) {
      return true;
    }
  }
  return false;
}

/** headerLines → { 'list-id': 'value', … }. First occurrence of a key wins. */
function headerValues(parsed) {
  const out = Object.create(null);
  const lines = (parsed && parsed.headerLines) || [];
  for (const h of lines) {
    const key = String((h && h.key) || '').toLowerCase();
    if (!key || key in out) continue;
    const line = String((h && h.line) || '');
    const colon = line.indexOf(':');
    out[key] = colon === -1 ? '' : line.slice(colon + 1).trim();
  }
  return out;
}

/**
 * Why this message looks like bulk/automated mail, or '' when it doesn't.
 *
 * - list-unsubscribe / list-id: set by every mailing-list and newsletter
 *   platform (RFC 2369 / 2919). A reply typed by a person never carries them.
 * - precedence: bulk|junk|list — the long-standing convention for "do not
 *   auto-reply to this".
 * - auto-submitted (RFC 3834) other than 'no': vacation replies, bounces,
 *   notification robots. Skipping these is also what stops a ticket
 *   acknowledgement and an out-of-office bouncing off each other forever.
 * - x-auto-response-suppress: Exchange's equivalent marker.
 * - feedback-id: set by high-volume senders for Google Postmaster Tools.
 *
 * A mailing list used *as* the support inbox would trip list-id, which is why
 * the caller keeps this off unless an operator turns it on.
 */
function bulkReason(parsed) {
  const h = headerValues(parsed);
  if (h['list-unsubscribe']) return 'list-unsubscribe';
  if (h['list-id']) return 'list-id';
  if (/^(bulk|junk|list)\b/.test(String(h['precedence'] || '').toLowerCase())) return 'precedence';
  const auto = String(h['auto-submitted'] || '').toLowerCase().trim();
  if (auto && !/^no\b/.test(auto)) return 'auto-submitted';
  if (h['x-auto-response-suppress']) return 'x-auto-response-suppress';
  if (h['feedback-id']) return 'feedback-id';
  return '';
}

module.exports = { addressOf, normalizeBlockEntry, parseBlocklist, isBlockedSender, bulkReason };
