/**
 * Guard: advanced_query must not surface financial/confidential columns to a user
 * who lacks `<resource>:view_confidential`. The REST routes hide cost fields with
 * redactCosts(); the ai_ro role CAN read the same columns, so sqlGuard flags every
 * query that references them (by name or via a column wildcard) and the tool then
 * demands view_confidential — mirroring the REST gate.
 *
 * Static (no DB): exercises sqlGuard.confidentialResourcesTouched() and checks the
 * column map stays consistent with the ai.* views and the REST cost map.
 * Run: node --test tests/ai-confidential-columns.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  confidentialResourcesTouched,
  CONFIDENTIAL_COLUMNS_BY_RESOURCE,
  VIEW_PERMISSIONS,
} = require('../src/providers/ai/sqlGuard');
const { COST_FIELDS_BY_RESOURCE } = require('../src/utils/financialAccess');

test('a query naming a confidential column flags its resource', () => {
  assert.deepEqual(confidentialResourcesTouched('SELECT asset_tag, cost FROM assets'), ['asset']);
  assert.deepEqual(confidentialResourcesTouched('SELECT software_name, purchase_amount FROM licenses'), ['license']);
  assert.deepEqual(confidentialResourcesTouched('SELECT title, cost_amount FROM ai.contracts'), ['contract']);
  assert.deepEqual(confidentialResourcesTouched('SELECT service_company, cost FROM maintenance'), ['maintenance']);
});

test('an alias on a confidential column is still caught (the column is named in the SQL)', () => {
  assert.deepEqual(confidentialResourcesTouched('SELECT cost AS revenue FROM assets'), ['asset']);
});

test('a confidential column used only in WHERE is caught (fail-closed)', () => {
  assert.deepEqual(
    confidentialResourcesTouched('SELECT phone_number FROM mobile_lines WHERE monthly_cost > 100'),
    ['line']
  );
});

test('a column wildcard over a confidential view flags the resource', () => {
  assert.deepEqual(confidentialResourcesTouched('SELECT * FROM assets'), ['asset']);
  assert.deepEqual(confidentialResourcesTouched('SELECT a.* FROM assets a'), ['asset']);
});

test('non-financial queries are NOT flagged (no false positives)', () => {
  assert.deepEqual(confidentialResourcesTouched('SELECT asset_tag, brand FROM assets'), []);
  assert.deepEqual(confidentialResourcesTouched('SELECT count(*) AS n FROM assets'), []);
  assert.deepEqual(confidentialResourcesTouched('SELECT total_seats * 2 AS cap FROM licenses'), []);
  assert.deepEqual(confidentialResourcesTouched('SELECT full_name FROM employees'), []);
});

test('every confidential resource is a known VIEW_PERMISSIONS target', () => {
  const known = new Set(Object.values(VIEW_PERMISSIONS));
  for (const resource of Object.keys(CONFIDENTIAL_COLUMNS_BY_RESOURCE)) {
    assert.ok(known.has(resource), `CONFIDENTIAL_COLUMNS_BY_RESOURCE has "${resource}", absent from VIEW_PERMISSIONS`);
  }
});

test('every confidential resource is also cost-redacted on the REST layer', () => {
  for (const resource of Object.keys(CONFIDENTIAL_COLUMNS_BY_RESOURCE)) {
    assert.ok(
      Array.isArray(COST_FIELDS_BY_RESOURCE[resource]) && COST_FIELDS_BY_RESOURCE[resource].length > 0,
      `${resource} is gated in advanced_query but not in financialAccess.COST_FIELDS_BY_RESOURCE`
    );
  }
});

test('every declared confidential column actually appears in the ai.* migrations', () => {
  const dir = path.join(__dirname, '..', 'src', 'providers', 'postgres', 'migrations');
  let sqlAll = '';
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.sql')) sqlAll += `\n${fs.readFileSync(path.join(dir, file), 'utf8').toLowerCase()}`;
  }
  for (const [resource, cols] of Object.entries(CONFIDENTIAL_COLUMNS_BY_RESOURCE)) {
    for (const col of cols) {
      assert.ok(
        new RegExp(`\\b${col}\\b`).test(sqlAll),
        `confidential column "${col}" (${resource}) not found in any ai.* migration — stale map?`
      );
    }
  }
});
