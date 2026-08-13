/**
 * Background scheduler for the automatic alert digest.
 *
 * A lightweight 1-minute interval (no cron dependency) asks the notification
 * service whether the configured daily/weekly digest is due right now. All the
 * "is it due / has it already run today" logic lives in digestSchedule.js, so
 * this file only owns the timer lifecycle.
 *
 * The same timer sweeps abandoned zimmet-import staging once an hour — those
 * rows hold real PDF bytes and nothing else ever deletes them if the reviewer
 * simply closes the tab.
 */
const notificationService = require('../providers/postgres/notificationService');
const zimmetImportService = require('../providers/postgres/zimmetImportService');

const TICK_MS = 60 * 1000;
const PURGE_EVERY_TICKS = 60; // hourly
let timer = null;
let ticks = 0;

function start() {
  if (timer) return timer;
  timer = setInterval(() => {
    notificationService.runScheduledDigest().catch((err) => {
      console.warn('[scheduler] digest tick failed:', err.message);
    });
    if ((ticks += 1) % PURGE_EVERY_TICKS === 0) {
      zimmetImportService.purgeStale().then((r) => {
        const n = r ? (r.purgedItems || 0) + (r.clearedOrphans || 0) : 0;
        if (n) console.log(`[scheduler] cleared ${n} stale zimmet-import staging row(s)`);
      }).catch((err) => {
        console.warn('[scheduler] zimmet staging purge failed:', err.message);
      });
    }
  }, TICK_MS);
  // Don't keep the event loop alive just for the scheduler (clean shutdown / tests).
  if (timer.unref) timer.unref();
  console.log('[itacm] notification scheduler started (1-minute tick)');
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    ticks = 0;
  }
}

module.exports = { start, stop };
