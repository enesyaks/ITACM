/**
 * Guard: every ai.* view the read-only role can SELECT must be mapped to an app
 * permission in sqlGuard.VIEW_PERMISSIONS. The `ai` schema grants SELECT on ALL
 * TABLES (+ default privileges), so a new ai.* view added without a mapping would
 * be readable through advanced_query with only `ai:use` — bypassing the
 * per-resource RBAC every other tool enforces. This test fails the moment a view
 * is added without its permission mapping.
 *
 * Static (no DB): parses the migration SQL for CREATE VIEW ai.<name>.
 * Run: node --test tests/ai-view-permissions.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { VIEW_PERMISSIONS } = require('../src/providers/ai/sqlGuard');

function aiViewsFromMigrations() {
  const dir = path.join(__dirname, '..', 'src', 'providers', 'postgres', 'migrations');
  const views = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /create\s+(?:or\s+replace\s+)?view\s+ai\.([a-z0-9_]+)/gi;
    let m;
    while ((m = re.exec(sql)) !== null) views.add(m[1].toLowerCase());
  }
  return [...views].sort();
}

test('every ai.* view is mapped to a permission in VIEW_PERMISSIONS', () => {
  const views = aiViewsFromMigrations();
  assert.ok(views.length > 0, 'expected to find ai.* views in the migrations');
  const unmapped = views.filter((v) => !(v in VIEW_PERMISSIONS));
  assert.deepEqual(
    unmapped, [],
    `ai.* view(s) not in sqlGuard.VIEW_PERMISSIONS (readable with only ai:use): ${unmapped.join(', ')}`
  );
});

test('VIEW_PERMISSIONS has no stale entries pointing at views that no longer exist', () => {
  const views = new Set(aiViewsFromMigrations());
  const stale = Object.keys(VIEW_PERMISSIONS).filter((v) => !views.has(v));
  assert.deepEqual(stale, [], `VIEW_PERMISSIONS maps view(s) that no CREATE VIEW ai.* defines: ${stale.join(', ')}`);
});

test('every mapped permission is a non-empty string', () => {
  for (const [view, perm] of Object.entries(VIEW_PERMISSIONS)) {
    assert.equal(typeof perm, 'string');
    assert.ok(perm.length > 0, `permission for ai.${view} must be a non-empty string`);
  }
});
