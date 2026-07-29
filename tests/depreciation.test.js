/**
 * Straight-line depreciation math + lifecycle resolution.
 * Run: node --test tests/depreciation.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveLifecycles, resolveLifeMonths, bookValue, depreciationFor,
} = require('../src/utils/depreciation');

const MS_PER_MONTH = 30.4375 * 24 * 3600 * 1000;
const monthsAgo = (n, from = Date.now()) => new Date(from - n * MS_PER_MONTH);

test('resolveLifecycles overlays overrides on the built-in defaults', () => {
  const lc = resolveLifecycles({ Laptop: 60 });
  assert.equal(lc.Laptop, 60);      // override wins
  assert.equal(lc.Monitor, 72);     // default preserved
});

test('resolveLifeMonths follows asset → model → category → Other', () => {
  const lc = resolveLifecycles({ Laptop: 48 });
  assert.equal(resolveLifeMonths({ assetMonths: 24, modelMonths: 60, category: 'Laptop' }, lc), 24);
  assert.equal(resolveLifeMonths({ modelMonths: 60, category: 'Laptop' }, lc), 60);
  assert.equal(resolveLifeMonths({ category: 'Laptop' }, lc), 48);
  assert.equal(resolveLifeMonths({ category: 'NonExistent' }, lc), lc.Other);
});

test('bookValue is full cost when brand new, salvage at end of life', () => {
  const now = Date.now();
  // Brand new (purchased now) → full cost.
  assert.equal(bookValue({ cost: 40000, purchaseDate: new Date(now), lifeMonths: 48 }, now), 40000);
  // Halfway (24/48) → ~50%.
  assert.equal(bookValue({ cost: 40000, purchaseDate: monthsAgo(24, now), lifeMonths: 48 }, now), 20000);
  // Past end of life → floored at salvage (0 here).
  assert.equal(bookValue({ cost: 40000, purchaseDate: monthsAgo(60, now), lifeMonths: 48 }, now), 0);
});

test('salvage value is the depreciation floor', () => {
  const now = Date.now();
  // Fully depreciated but salvage 5000 → book value never drops below 5000.
  assert.equal(bookValue({ cost: 40000, purchaseDate: monthsAgo(60, now), lifeMonths: 48, salvage: 5000 }, now), 5000);
  // Halfway with salvage 10000 → 40000 - (30000 * 0.5) = 25000.
  assert.equal(bookValue({ cost: 40000, purchaseDate: monthsAgo(24, now), lifeMonths: 48, salvage: 10000 }, now), 25000);
});

test('non-depreciating and unpriced assets', () => {
  const now = Date.now();
  // lifeMonths 0 (category excluded) → keeps full cost.
  assert.equal(bookValue({ cost: 500, purchaseDate: monthsAgo(120, now), lifeMonths: 0 }, now), 500);
  // No cost or no purchase date → null (cannot compute).
  assert.equal(bookValue({ cost: 0, purchaseDate: new Date(now), lifeMonths: 48 }, now), null);
  assert.equal(bookValue({ cost: 40000, purchaseDate: null, lifeMonths: 48 }, now), null);
});

test('depreciationFor returns value + depreciated + pct together', () => {
  const now = Date.now();
  const lc = resolveLifecycles({ Laptop: 48 });
  const d = depreciationFor({
    cost: 40000, purchaseDate: monthsAgo(24, now), category: 'Laptop',
  }, lc, now);
  assert.equal(d.lifeMonths, 48);
  assert.equal(d.bookValue, 20000);
  assert.equal(d.depreciated, 20000);
  assert.equal(d.depreciationPct, 50);
});

test('depreciationFor yields nulls when uncomputable but keeps lifeMonths', () => {
  const lc = resolveLifecycles();
  const d = depreciationFor({ cost: 0, category: 'Laptop' }, lc);
  assert.equal(d.bookValue, null);
  assert.equal(d.depreciated, null);
  assert.equal(d.depreciationPct, null);
  assert.equal(d.lifeMonths, lc.Laptop);
});
