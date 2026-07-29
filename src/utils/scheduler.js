/**
 * Background scheduler for the automatic alert digest.
 *
 * A lightweight 1-minute interval (no cron dependency) asks the notification
 * service whether the configured daily/weekly digest is due right now. All the
 * "is it due / has it already run today" logic lives in digestSchedule.js, so
 * this file only owns the timer lifecycle.
 */
const notificationService = require('../providers/postgres/notificationService');

const TICK_MS = 60 * 1000;
let timer = null;

function start() {
  if (timer) return timer;
  timer = setInterval(() => {
    notificationService.runScheduledDigest().catch((err) => {
      console.warn('[scheduler] digest tick failed:', err.message);
    });
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
  }
}

module.exports = { start, stop };
