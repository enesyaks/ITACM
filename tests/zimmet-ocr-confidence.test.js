'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * capByOcr is module-private — the service opens a pool on require, which a unit
 * test has no business doing. Lift the function out of the source instead, so
 * the rule stays pinned without standing a database up.
 */
function loadCapByOcr() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'providers', 'postgres', 'zimmetImportService.js'),
    'utf8'
  );
  const min = /const OCR_TRUST_MIN = (\d+);/.exec(src);
  const body = src.slice(src.indexOf('function capByOcr'), src.indexOf('function pickName'));
  assert.ok(min, 'OCR_TRUST_MIN not found — did the helper move?');
  // eslint-disable-next-line no-new-func
  return new Function(`const OCR_TRUST_MIN = ${min[1]}; return (${body.trim()});`)();
}

const capByOcr = loadCapByOcr();

test('a digital PDF keeps whatever the name match earned', () => {
  // No OCR ran, so there is no reading to doubt.
  assert.strictEqual(capByOcr({ confidence: 'high' }, null).confidence, 'high');
  assert.strictEqual(capByOcr({ confidence: 'high' }, undefined).confidence, 'high');
});

test('a cleanly read scan keeps its high match', () => {
  assert.strictEqual(capByOcr({ confidence: 'high' }, 92).confidence, 'high');
  assert.strictEqual(capByOcr({ confidence: 'high' }, 75).confidence, 'high');
});

test('a poorly read scan cannot claim certainty', () => {
  // "high" invites the reviewer to click through without looking. An exact match
  // on text OCR was unsure about does not earn that.
  assert.strictEqual(capByOcr({ confidence: 'high' }, 74).confidence, 'medium');
  assert.strictEqual(capByOcr({ confidence: 'high' }, 41).confidence, 'medium');
  assert.strictEqual(capByOcr({ confidence: 'high' }, 0).confidence, 'medium');
});

test('a weak match is never demoted further, and never promoted', () => {
  assert.strictEqual(capByOcr({ confidence: 'medium' }, 20).confidence, 'medium');
  assert.strictEqual(capByOcr({ confidence: 'none' }, 20).confidence, 'none');
  assert.strictEqual(capByOcr({ confidence: 'none' }, 99).confidence, 'none');
});

test('the original match object is left alone', () => {
  // analyze() reuses the object it passed in; mutating it here would change what
  // gets written for the item.
  const original = { confidence: 'high', candidates: [{ id: 'x' }], best: { id: 'x' } };
  const capped = capByOcr(original, 30);
  assert.strictEqual(original.confidence, 'high');
  assert.strictEqual(capped.confidence, 'medium');
  assert.deepStrictEqual(capped.candidates, original.candidates);
  assert.strictEqual(capped.best, original.best);
});
