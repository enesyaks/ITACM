/**
 * Pure scheduling logic for the alert digest (no DB, no I/O — unit-testable).
 *
 * The digest can be sent automatically on a daily or weekly cadence. A tick
 * fires at most once per calendar day: `lastRunDate` (stored inside notify_json)
 * is compared against today, so a process restart or a slow tick never double-sends.
 */

/** Local-time YYYY-MM-DD stamp used as the once-per-day guard. */
function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Should the scheduled digest run right now for this notify config?
 *   - schedule must be 'daily' or 'weekly' (default 'off' → never)
 *   - digests must be enabled and the current hour must match `hour`
 *   - weekly additionally requires the current weekday to match `weekday` (0=Sun)
 *   - it must not have already run today (lastRunDate guard)
 */
function shouldRunDigest(notify, now = new Date()) {
  if (!notify || notify.enabled !== true) return false;
  const schedule = notify.schedule;
  if (schedule !== 'daily' && schedule !== 'weekly') return false;
  if (Number(notify.hour) !== now.getHours()) return false;
  if (schedule === 'weekly' && Number(notify.weekday) !== now.getDay()) return false;
  if (notify.lastRunDate === ymd(now)) return false;
  return true;
}

module.exports = { ymd, shouldRunDigest };
