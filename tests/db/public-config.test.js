/**
 * What /api/config tells a stranger.
 *
 * The endpoint has to answer before anybody signs in — the login and first-run
 * screens render from it — and it used to answer with the whole settings row:
 * the postal address, every department, every office and warehouse, the
 * asset-tag scheme, the approval policy, the handover terms. No credentials,
 * but a finished map of the organisation for anyone who could reach the URL.
 *
 * Driven over real HTTP against a real database, because the split is a
 * property of the response, not of a function somebody can rename.
 *
 * Run: npm run test:db
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('./helpers/db');

test('public config', db.skipReason ? { skip: db.skipReason } : {}, async (t) => {
  await db.setup();

  const { query } = require('../../src/providers/postgres/pool');
  const { createApp } = require('../../src/app');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((r) => server.close(r)).then(() => db.teardown()));

  await query(
    `UPDATE app_settings
        SET company_address = 'Gizli Sokak 1, Istanbul',
            departments = '["Gizli Departman"]'::jsonb,
            locations = '["Gizli Depo"]'::jsonb
      WHERE id = 1`
  );

  const cfg = async (token) => {
    const res = await fetch(`${base}/api/config`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    assert.equal(res.status, 200, 'the endpoint stays public — a stranger gets an answer, just a smaller one');
    return (await res.json()).data;
  };

  await t.test('a stranger learns branding and nothing about the organisation', async () => {
    const o = await cfg();
    assert.equal(o.scope, 'public');
    // What the login / first-run screens actually read.
    assert.equal(typeof o.companyName, 'string');
    assert.ok('companyLogo' in o && 'onboarded' in o && 'language' in o);
    assert.ok(o.sso && typeof o.sso.enabled === 'boolean', 'the SSO button still knows whether to show');

    for (const leaked of ['departments', 'locations', 'companyAddress', 'handoverTerms',
      'handoverTemplates', 'approvals', 'lifecycles', 'specOptions', 'labelConfig',
      'assetTagPrefix', 'documentStorage', 'providerCategories', 'contractCategories']) {
      assert.equal(o[leaked], undefined, `${leaked} must not reach an anonymous caller`);
    }
    const body = JSON.stringify(o);
    assert.ok(!body.includes('Gizli'), 'nothing from the settings row leaks by another name');
  });

  await t.test('a signed-in caller gets the settings the app renders from', async () => {
    const { rows: [u] } = await query(
      `INSERT INTO users (username, email, password_hash, role, status)
       VALUES ($1, $1 || '@test.local', 'x', 'Viewer', 'Active') RETURNING id, email, role, username`,
      [`cfgprobe_${Date.now()}`]
    );
    // Signed the same way issueSession does, so this exercises the real
    // verification path rather than a stub that agrees with itself.
    const token = require('jsonwebtoken').sign(
      { sub: u.id, email: u.email, role: u.role, jti: require('crypto').randomUUID() },
      require('../../src/config').jwtSecret,
      { expiresIn: '1h', issuer: 'itacm', algorithm: 'HS256' }
    );

    const o = await cfg(token);
    assert.equal(o.scope, 'full');
    assert.deepEqual(o.departments, ['Gizli Departman']);
    assert.deepEqual(o.locations, ['Gizli Depo']);
    assert.equal(o.companyAddress, 'Gizli Sokak 1, Istanbul');
  });

  await t.test('a token that does not verify is treated as a stranger, not as an error', async () => {
    for (const bad of ['garbage', 'a.b.c', 'itacm_notarealkey']) {
      const o = await cfg(bad);
      assert.equal(o.scope, 'public', bad);
      assert.equal(o.departments, undefined, bad);
    }
  });
});
