/**
 * Pure scheduling logic for the automatic alert digest.
 * Run: node --test tests/digest-schedule.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { ymd, shouldRunDigest } = require('../src/utils/digestSchedule');

// A Thursday, 2026-07-30 at 08:00 local time. getDay() === 4.
const thu0800 = new Date(2026, 6, 30, 8, 0, 0);

test('ymd returns local YYYY-MM-DD', () => {
  assert.equal(ymd(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(ymd(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

test('off / missing schedule never runs', () => {
  assert.equal(shouldRunDigest(null, thu0800), false);
  assert.equal(shouldRunDigest({ enabled: true, schedule: 'off', hour: 8 }, thu0800), false);
  assert.equal(shouldRunDigest({ enabled: true, hour: 8 }, thu0800), false);
});

test('disabled digests never run even when scheduled', () => {
  assert.equal(shouldRunDigest({ enabled: false, schedule: 'daily', hour: 8 }, thu0800), false);
});

test('daily runs at the matching hour, once', () => {
  const notify = { enabled: true, schedule: 'daily', hour: 8, lastRunDate: null };
  assert.equal(shouldRunDigest(notify, thu0800), true);
  // Wrong hour → no.
  assert.equal(shouldRunDigest(notify, new Date(2026, 6, 30, 9, 0)), false);
  // Already stamped today → no (once-per-day guard).
  assert.equal(shouldRunDigest({ ...notify, lastRunDate: '2026-07-30' }, thu0800), false);
  // Yesterday's stamp → runs again today.
  assert.equal(shouldRunDigest({ ...notify, lastRunDate: '2026-07-29' }, thu0800), true);
});

test('weekly requires both weekday and hour to match', () => {
  const thursday = { enabled: true, schedule: 'weekly', hour: 8, weekday: 4, lastRunDate: null };
  assert.equal(shouldRunDigest(thursday, thu0800), true);
  // Same time, configured for Friday (5) → no.
  assert.equal(shouldRunDigest({ ...thursday, weekday: 5 }, thu0800), false);
  // Right day, wrong hour → no.
  assert.equal(shouldRunDigest(thursday, new Date(2026, 6, 30, 7, 0)), false);
});
