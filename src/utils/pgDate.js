/**
 * Turning a postgres DATE back into 'YYYY-MM-DD'.
 *
 * node-postgres parses DATE into a JS Date at LOCAL midnight. That breaks the
 * two obvious ways of formatting it:
 *
 *   String(d).slice(0, 10)        → "Thu Jan 01"   (postgres rejects it)
 *   d.toISOString().slice(0, 10)  → previous day everywhere east of UTC
 *                                   (Istanbul: 2026-08-01 → 2026-07-31)
 *
 * Read the local components back out instead — they are the ones pg used to
 * build the value. Strings pass through untouched, so a value that already came
 * from a form ('2026-08-01') is safe to feed in.
 */
'use strict';

/**
 * @param {Date|string|null|undefined} v
 * @returns {string|null} 'YYYY-MM-DD', or null when there is no usable date
 */
function toDateString(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.getFullYear()
      + '-' + String(v.getMonth() + 1).padStart(2, '0')
      + '-' + String(v.getDate()).padStart(2, '0');
  }
  return String(v).slice(0, 10);
}

module.exports = { toDateString };
