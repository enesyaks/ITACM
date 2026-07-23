/**
 * The Portal allowlist is the single lock that keeps a self-service employee
 * login off every staff route. It works by string-matching req.originalUrl,
 * which means it is only as good as its agreement with what Express actually
 * routes that same URL to. A traversal, an encoding trick or a case variant
 * that the gate reads as "/api/me/..." but Express delivers to /api/assets
 * would hand a portal user the whole inventory — and nothing at runtime would
 * complain, because both halves look correct in isolation.
 *
 * So these tests assert the pairing, not the gate alone: for every hostile URL,
 * whatever router Express picks must either be /api/me or must have been
 * refused by the gate.
 *
 * Run with `npm test` (node --test, no database needed).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

// src/middleware/auth.js applies this exact predicate to req.originalUrl.
const { isPortalAllowedPath } = require('../src/utils/portalPolicy');

test('portal allowlist admits only self-service paths', () => {
  const allowed = [
    '/api/me',
    '/api/me/',
    '/api/me/zimmet',
    '/api/me/zimmet?x=1',
    '/api/auth/logout',
    '/api/auth/password',
    '/api/auth/verify-token',
    '/api/auth/my-permissions',
    '/api/auth/mfa',
    '/api/auth/mfa/setup',
    '/api/auth/mfa/enable',
    '/api/auth/mfa/disable',
  ];
  for (const url of allowed) {
    assert.equal(isPortalAllowedPath(url), true, `should allow ${url}`);
  }
});

test('portal allowlist refuses every staff surface', () => {
  const denied = [
    '/api/assets',
    '/api/assets/some-uuid',
    '/api/employees',
    '/api/employees/some-uuid/history',
    '/api/licenses',
    '/api/lines',
    '/api/contracts',
    '/api/documents/some-uuid/download',
    '/api/audit',
    '/api/dashboard',
    '/api/integrations',
    '/api/org',
    '/api/approvals/pending',
    '/api/handovers',
    '/api/counts',
    '/api/import/inventory',
    '/api/setup',
    // Auth endpoints deliberately outside the portal set.
    '/api/auth/users',
    '/api/auth/login-logs',
    // Query strings must not smuggle an allowed prefix in.
    '/api/assets?next=/api/me/',
    '/api/employees?redirect=/api/me',
    // Near-misses on the prefix itself.
    '/api/method',
    '/api/mexico/zimmet',
    '',
    '/',
  ];
  for (const url of denied) {
    assert.equal(isPortalAllowedPath(url), false, `should deny ${url}`);
  }
});

/**
 * Mounts the same routers app.js does (as bare markers) behind the same gate
 * middleware/auth.js applies, then reports which router won and what the gate
 * decided — the two facts that must never disagree.
 */
async function probe(urls) {
  const app = express();
  app.use('/api', (req, res, next) => {
    req.portalAllowed = isPortalAllowedPath(req.originalUrl);
    next();
  });
  for (const name of ['assets', 'employees', 'licenses', 'documents', 'audit', 'me']) {
    app.use(`/api/${name}`, (req, res) => res.json({ router: name, allowed: req.portalAllowed }));
  }
  app.use((req, res) => res.json({ router: 'none', allowed: req.portalAllowed === true }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const out = [];
    for (const path of urls) {
      // eslint-disable-next-line no-await-in-loop
      const body = await new Promise((resolve) => {
        const req = http.request({ port, path, method: 'GET' }, (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => resolve(buf));
        });
        req.on('error', () => resolve('{"router":"error","allowed":false}'));
        req.end();
      });
      out.push({ path, ...JSON.parse(body) });
    }
    return out;
  } finally {
    server.close();
  }
}

test('no URL reaches a staff router while the gate reads it as self-service', async () => {
  const hostile = [
    '/api/me/../assets',
    '/api/me/%2e%2e/assets',
    '/api/me/..%2fassets',
    '/api/me/zimmet/../../assets',
    '/api/me/./../employees',
    '/api/me//../licenses',
    '/api/ME/../ASSETS',
    '/api/me;/assets',
    '/api/me%2f..%2fassets',
    '/API/ASSETS',
    '/api/ASSETS',
    '/api/assets/',
    '//api/assets',
    '/api/assets?x=/api/me/',
    '/api/documents/x/download?y=/api/me',
    '/api/audit#/api/me/',
  ];

  const results = await probe(hostile);
  for (const r of results) {
    if (r.allowed) {
      assert.equal(
        r.router,
        'me',
        `${r.path} passed the portal gate but Express routed it to "${r.router}"`
      );
    }
  }
});

test('a portal-allowed URL still reaches the self-service router', async () => {
  const [result] = await probe(['/api/me/zimmet']);
  assert.equal(result.allowed, true);
  assert.equal(result.router, 'me');
});
