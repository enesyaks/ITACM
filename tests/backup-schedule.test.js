/**
 * Pure scheduling + retention logic for automatic backups. No DB, no pg_dump.
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { dueDecision, toPrune } = require('../src/providers/postgres/backupService');

const at = (h) => { const d = new Date('2026-08-18T00:00:00'); d.setHours(h); return d; };

test('dueDecision — disabled never runs', () => {
  assert.equal(dueDecision({ enabled: false, hour: 3, now: at(4), latestMs: 0 }), false);
});

test('dueDecision — waits until the configured hour', () => {
  assert.equal(dueDecision({ enabled: true, hour: 3, now: at(2), latestMs: 0 }), false);
  assert.equal(dueDecision({ enabled: true, hour: 3, now: at(3), latestMs: 0 }), true);
});

test('dueDecision — runs once per day, then not again the same day', () => {
  const now = at(4);
  const earlierToday = new Date(now); earlierToday.setHours(3, 30);
  assert.equal(dueDecision({ enabled: true, hour: 3, now, latestMs: earlierToday.getTime() }), false);
});

test('dueDecision — a backup from yesterday is due again today', () => {
  const now = at(4);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  assert.equal(dueDecision({ enabled: true, hour: 3, now, latestMs: yesterday.getTime() }), true);
});

test('toPrune — keeps the newest N, removes the rest', () => {
  const names = ['d', 'c', 'b', 'a']; // newest-first
  assert.deepEqual(toPrune(names, 2), ['b', 'a']);
  assert.deepEqual(toPrune(names, 4), []);
  assert.deepEqual(toPrune(names, 10), []);
});

test('toPrune — keep is floored at 1', () => {
  assert.deepEqual(toPrune(['b', 'a'], 0), ['a']);
});
