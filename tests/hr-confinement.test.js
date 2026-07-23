/**
 * HR allowlist must agree with Express routing (same contract as portal-confinement).
 * Run: node --test tests/hr-confinement.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { isHrAllowedPath } = require('../src/utils/hrPolicy');

test('HR allowlist admits self-service + HR surfaces', () => {
  const allowed = [
    '/api/me',
    '/api/me/zimmet',
    '/api/hr',
    '/api/hr/categories',
    '/api/hr/requests',
    '/api/hr/requests/some-uuid',
    '/api/hr/onboard-requests',
    '/api/dashboard/hr-stats',
    '/api/config',
    '/api/auth/logout',
    '/api/auth/password',
    '/api/auth/verify-token',
    '/api/auth/my-permissions',
  ];
  for (const url of allowed) {
    assert.equal(isHrAllowedPath(url), true, 'should allow ' + url);
  }
});

test('HR allowlist refuses staff inventory surfaces', () => {
  const denied = [
    '/api/assets',
    '/api/employees',
    '/api/dashboard/stats',
    '/api/licenses',
    '/api/onboardings',
    '/api/auth/users',
    '/api/assets?next=/api/hr/',
  ];
  for (const url of denied) {
    assert.equal(isHrAllowedPath(url), false, 'should deny ' + url);
  }
});

async function probe(urls) {
  const app = express();
  app.use('/api', (req, res, next) => {
    req.hrAllowed = isHrAllowedPath(req.originalUrl);
    next();
  });
  for (const name of ['assets', 'employees', 'hr', 'me']) {
    app.use('/api/' + name, (req, res) => res.json({ router: name, allowed: req.hrAllowed }));
  }
  app.use((req, res) => res.json({ router: 'none', allowed: req.hrAllowed === true }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const out = [];
    for (const path of urls) {
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

test('no URL reaches a staff router while the HR gate reads it as allowed (except hr/me)', async () => {
  const hostile = [
    '/api/hr/../assets',
    '/api/me/../employees',
    '/api/hr/%2e%2e/assets',
    '/api/HR/requests',
    '/api/assets?x=/api/hr/',
  ];
  const results = await probe(hostile);
  for (const r of results) {
    if (r.allowed) {
      assert.ok(['hr', 'me'].includes(r.router), r.path + ' allowed but routed to ' + r.router);
    }
  }
});

test('HR-allowed /api/hr path reaches the hr router', async () => {
  const [result] = await probe(['/api/hr/categories']);
  assert.equal(result.allowed, true);
  assert.equal(result.router, 'hr');
});
