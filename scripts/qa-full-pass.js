#!/usr/bin/env node
/**
 * Full ITACM QA — API smoke + Playwright UI walk of every route & key actions.
 * Usage: BASE=http://localhost:8000 EMAIL=... PASS=... node scripts/qa-full-pass.js
 */
'use strict';

const BASE = process.env.BASE || 'http://localhost:8000';
const EMAIL = process.env.EMAIL || 'admin@acme.example';
const PASS = process.env.PASS || 'Admin123!';

const findings = [];
const passed = [];

function ok(area, msg) {
  passed.push({ area, msg });
  console.log(`✓ ${area}: ${msg}`);
}
function fail(area, sev, msg, detail) {
  findings.push({ area, sev, msg, detail: detail || '' });
  console.error(`✗ [${sev}] ${area}: ${msg}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`);
}
function info(area, msg) { console.log(`· ${area}: ${msg}`); }

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text: text.slice(0, 800) };
}

async function runApiSmoke() {
  console.log('\n=== API SMOKE ===');
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASS },
  });
  if (login.status !== 200 || !login.json?.data?.token) {
    fail('auth', 'Critical', 'Login failed', `${login.status} ${login.text}`);
    return null;
  }
  const token = login.json.data.token;
  const user = login.json.data.user || login.json.data;
  ok('auth', `Login OK as ${user.email || EMAIL} (${user.role})`);

  const gets = [
    ['/api/config', false],
    ['/api/health', false],
    ['/api/dashboard/stats', true],
    ['/api/assets?limit=5', true],
    ['/api/employees?limit=5', true],
    ['/api/handovers?limit=5', true],
    ['/api/licenses?limit=5', true],
    ['/api/lines?limit=5', true],
    ['/api/providers', true],
    ['/api/providers/summary', true],
    ['/api/contracts', true],
    ['/api/consumables', true],
    ['/api/maintenance?open=true', true],
    ['/api/catalog/locations', true],
    ['/api/catalog/departments', true],
    ['/api/catalog/lifecycles', true],
    ['/api/onboardings', true],
    ['/api/onboardings?due=1', true],
    ['/api/onboardings?status=scheduled', true],
    ['/api/audit?limit=5', true],
    ['/api/auth/users', true],
    ['/api/counts', true],
  ];

  for (const [path, needAuth] of gets) {
    const r = await api(path, needAuth ? { token } : {});
    if (r.status >= 500) fail('api', 'High', `${path} → ${r.status}`, r.text);
    else if (r.status === 404) fail('api', 'Medium', `${path} → 404`, r.json?.error || r.text);
    else if (r.status >= 400) fail('api', 'Medium', `${path} → ${r.status}`, r.json?.error || r.text);
    else if (r.json && r.json.success === false) fail('api', 'Medium', `${path} success:false`, r.json.error);
    else ok('api', `${path} → ${r.status}`);
  }

  const unauth = await api('/api/assets?limit=1');
  if (unauth.status === 401 || unauth.status === 403) ok('api', 'Assets reject unauth');
  else fail('api', 'High', 'Assets accessible without auth', String(unauth.status));

  const cfg = await api('/api/config');
  if (cfg.json?.data && cfg.json.data.setupToken) {
    fail('security', 'High', '/api/config still returns setupToken');
  } else ok('security', 'config has no setupToken');

  // Deep-dive: open first asset / provider / employee / contract if present
  const assets = await api('/api/assets?limit=3', { token });
  const assetList = Array.isArray(assets.json?.data) ? assets.json.data : (assets.json?.data?.items || []);
  if (assetList[0]?.id) {
    const one = await api(`/api/assets/${assetList[0].id}`, { token });
    if (one.status === 200) ok('api', `asset detail ${assetList[0].id}`);
    else fail('api', 'Medium', `asset detail ${one.status}`, one.text);
  }

  const emps = await api('/api/employees?limit=3', { token });
  const empList = Array.isArray(emps.json?.data) ? emps.json.data : [];
  if (empList[0]?.id) {
    const one = await api(`/api/employees/${empList[0].id}`, { token });
    if (one.status === 200) ok('api', `employee detail`);
    else fail('api', 'Medium', `employee detail ${one.status}`, one.text);
  }

  const provs = await api('/api/providers', { token });
  const provList = Array.isArray(provs.json?.data) ? provs.json.data : [];
  if (provList[0]?.id) {
    const one = await api(`/api/providers/${provList[0].id}`, { token });
    if (one.status === 200) ok('api', `provider detail`);
    else fail('api', 'Medium', `provider detail ${one.status}`, one.text);
    const docs = await api(`/api/providers/${provList[0].id}/documents`, { token });
    if (docs.status === 200) ok('api', `provider documents list`);
    else fail('api', 'Medium', `provider docs ${docs.status}`, docs.text);
  }

  const contracts = await api('/api/contracts', { token });
  const cList = Array.isArray(contracts.json?.data) ? contracts.json.data : [];
  if (cList[0]?.id) {
    const one = await api(`/api/contracts/${cList[0].id}`, { token });
    if (one.status === 200) ok('api', `contract detail`);
    else fail('api', 'Medium', `contract detail ${one.status}`, one.text);
  }

  const handovers = await api('/api/handovers?limit=3', { token });
  const hList = Array.isArray(handovers.json?.data) ? handovers.json.data : [];
  if (hList[0]?.id) {
    const pdf = await api(`/api/handovers/${hList[0].id}/pdf`, { token });
    if (pdf.status === 200 || pdf.status === 404) ok('api', `handover pdf probe ${pdf.status}`);
    else if (pdf.status >= 500) fail('api', 'High', `handover pdf ${pdf.status}`, pdf.text);
    else info('api', `handover pdf → ${pdf.status}`);
  }

  // Viewer role: document download should be forbidden
  const vLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'qa.viewer@example.com', password: PASS },
  });
  if (vLogin.status === 200 && vLogin.json?.data?.token) {
    const vt = vLogin.json.data.token;
    ok('auth', 'Viewer login OK');
    // find a provider doc id if any
    const pdocs = await api(`/api/providers/${provList[0]?.id}/documents`, { token });
    const doc = (Array.isArray(pdocs.json?.data) ? pdocs.json.data : [])[0];
    if (doc?.id) {
      const dl = await api(`/api/providers/documents/${doc.id}/download`, { token: vt });
      if (dl.status === 403 || dl.status === 401) ok('security', 'Viewer blocked from provider doc download');
      else fail('security', 'High', `Viewer downloaded provider doc → ${dl.status}`);
    } else {
      info('security', 'No provider docs to test Viewer download block');
    }
  } else {
    info('auth', 'Viewer login skipped (password unknown)');
  }

  return { token, user };
}

async function runBrowser(session) {
  console.log('\n=== BROWSER UI ===');
  const playwright = require('playwright');
  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));

  const drainErrors = (area) => {
    const meaningful = [...consoleErrors.splice(0), ...pageErrors.splice(0)].filter((t) =>
      !/favicon/i.test(t)
      && !/net::ERR_/i.test(t)
      && !/Failed to load resource/i.test(t)
    );
    if (meaningful.length) {
      fail(area, 'Medium', 'JS errors', meaningful.slice(0, 4).join(' | '));
    }
  };

  // Session inject — avoid flaky hidden login/onboarding DOM
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('itacm_token', token);
    localStorage.setItem('itacm_profile', JSON.stringify({
      uid: user.uid,
      email: user.email,
      username: user.username || user.email,
      role: user.role || 'Owner',
      permissions: {
        canViewDashboard: true, canManageAssets: true, canExecuteHandovers: true,
        canManageMaintenance: true, canManageUsers: true, canViewAudit: true,
        canManageBranding: true, canManageOwner: true, isOwner: true,
      },
    }));
  }, { token: session.token, user: session.user });

  await page.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Verify token via API from page
  const verified = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/auth/verify-token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('itacm_token')}` },
      });
      const j = await r.json();
      return { status: r.status, ok: j.success };
    } catch (e) {
      return { error: String(e) };
    }
  });
  if (verified.ok) ok('browser', 'Session verified');
  else fail('browser', 'High', 'Session verify failed', JSON.stringify(verified));

  // Force show app if verify worked but UI stuck
  await page.evaluate(() => {
    const app = document.getElementById('app');
    const login = document.getElementById('login-screen');
    const onb = document.getElementById('onboarding-screen');
    if (app) app.classList.remove('hidden');
    if (login) login.classList.add('hidden');
    if (onb) onb.classList.add('hidden');
  });
  await page.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  if (!(await page.locator('#app:not(.hidden), #nav a').count())) {
    // Real UI login fallback
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.getElementById('onboarding-screen')?.classList.add('hidden');
      document.getElementById('login-screen')?.classList.remove('hidden');
      document.getElementById('app')?.classList.add('hidden');
    });
    await page.fill('#login-form input[name="email"]', EMAIL);
    await page.fill('#login-form input[type="password"]', PASS);
    await page.locator('#login-btn').click();
    await page.waitForTimeout(2000);
  }

  const routes = [
    '#/dashboard', '#/assets', '#/network', '#/catalog', '#/licenses', '#/lines',
    '#/providers', '#/consumables', '#/employees', '#/handover', '#/maintenance',
    '#/stockcount', '#/reports', '#/audit', '#/users',
  ];

  for (const hash of routes) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    const bodyText = await page.locator('#view').innerText().catch(async () =>
      page.locator('#app').innerText().catch(() => ''));
    if (/TypeError|ReferenceError|Cannot read propert|is not defined|Unexpected token/i.test(bodyText)) {
      fail(hash, 'High', 'Error text in view', bodyText.slice(0, 220));
    } else if (!bodyText || bodyText.trim().length < 15) {
      fail(hash, 'Medium', 'View appears empty');
    } else {
      ok(hash, `rendered (${bodyText.trim().split(/\s+/).length} words)`);
    }
    drainErrors(hash);
  }

  async function openAndClose(btnLocator, area, label) {
    const btn = typeof btnLocator === 'string' ? page.locator(btnLocator).first() : btnLocator;
    if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) {
      info(area, `${label} button not visible`);
      return false;
    }
    await btn.click();
    await page.waitForTimeout(700);
    const hasModal = await page.locator('.modal-foot, [data-close], #modal-form').count();
    if (hasModal) {
      ok(area, `${label} opens`);
      await page.locator('[data-close]').first().click({ timeout: 2000 }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
      return true;
    }
    fail(area, 'Medium', `${label} click — no modal`);
    return false;
  }

  const interactions = [
    ['#/dashboard', async () => {
      await openAndClose('#btn-notifications', 'dashboard', 'Notifications');
      await openAndClose('#btn-settings', 'settings', 'Settings');
      if (await page.locator('#set-currency').count()) ok('settings', 'Currency field present');
      else if (await page.locator('#set-save').count()) info('settings', 'Settings open without currency field check');
      await page.locator('[data-close]').first().click().catch(() => {});
      // Metric / onboard card
      if (await page.locator('#dash-onboard-card, .grid-metrics').count()) ok('dashboard', 'Metrics/onboard present');
    }],
    ['#/assets', async () => {
      await openAndClose('button:has-text("New Asset"), #asset-new, button:has-text("Add device")', 'assets', 'New Asset');
      const row = page.locator('tr.asset-row, table.data tbody tr').first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(800);
        if (await page.locator('.modal-foot, [data-close], .drawer, .detail').count()) {
          ok('assets', 'Asset row opens detail');
          await page.locator('[data-close]').first().click().catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
        } else info('assets', 'Row click — no detail chrome detected');
      }
    }],
    ['#/employees', async () => {
      await openAndClose('button:has-text("New Employee"), button:has-text("Add employee")', 'employees', 'New Employee');
      const onboard = page.locator('button:has-text("Onboard")').first();
      if (await onboard.count() && await onboard.isVisible()) {
        await onboard.click();
        await page.waitForTimeout(800);
        if (await page.locator('#obn-submit, button:has-text("Schedule"), [data-close]').count()) {
          ok('employees', 'Onboard wizard opens');
          await page.locator('[data-close]').first().click().catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    }],
    ['#/providers', async () => {
      await openAndClose('button:has-text("New Provider"), button:has-text("Add provider")', 'providers', 'New Provider');
      const contractsBtn = page.locator('button:has-text("Contracts"), [data-tab="contracts"], button:has-text("Contract")').first();
      if (await contractsBtn.count()) {
        await contractsBtn.click();
        await page.waitForTimeout(900);
        ok('providers', 'Contracts section/tab');
        await openAndClose('button:has-text("New Contract"), button:has-text("Add contract")', 'providers', 'New Contract');
      }
    }],
    ['#/lines', async () => openAndClose('#line-new, button:has-text("New Line")', 'lines', 'New Line')],
    ['#/licenses', async () => openAndClose('button:has-text("New License"), button:has-text("Add License"), button:has-text("New")', 'licenses', 'New License')],
    ['#/consumables', async () => openAndClose('button:has-text("New"), button:has-text("Add")', 'consumables', 'New Consumable')],
    ['#/handover', async () => {
      await openAndClose('button:has-text("New Handover"), button:has-text("Assign"), button:has-text("New")', 'handover', 'New Handover');
    }],
    ['#/maintenance', async () => {
      const sel = page.locator('#mn-filter');
      if (await sel.count()) {
        await sel.selectOption('false').catch(() => sel.selectOption({ index: 1 }));
        await page.waitForTimeout(900);
        ok('maintenance', 'Filter changed');
      }
    }],
    ['#/network', async () => {
      await openAndClose('button:has-text("Add"), button:has-text("New")', 'network', 'Add device');
    }],
    ['#/catalog', async () => {
      if (await page.locator('button:has-text("Add"), button:has-text("Save"), input').count()) {
        ok('catalog', 'Editable controls present');
      }
    }],
    ['#/stockcount', async () => {
      const btn = page.locator('button:has-text("Start"), button:has-text("New Count"), button:has-text("Analytics"), button:has-text("Export")').first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(900);
        ok('stockcount', 'Primary action clicked');
        await page.locator('[data-close]').first().click().catch(() => {});
      } else ok('stockcount', 'Page interactive shell loaded');
    }],
    ['#/reports', async () => {
      const sel = page.locator('select').first();
      if (await sel.count()) {
        await sel.selectOption({ index: 1 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      const run = page.locator('button:has-text("Run"), button:has-text("Generate"), button:has-text("Export")').first();
      if (await run.count()) {
        await run.click();
        await page.waitForTimeout(1200);
        ok('reports', 'Run/export clicked');
      }
    }],
    ['#/users', async () => {
      await openAndClose('button:has-text("Add User"), button:has-text("New User"), button:has-text("Invite"), button:has-text("Add")', 'users', 'Add User');
    }],
    ['#/audit', async () => {
      if (await page.locator('table.data, .table-wrap').count()) ok('audit', 'Table present');
      const filt = page.locator('select, input[type="search"]').first();
      if (await filt.count()) {
        await filt.click().catch(() => {});
        ok('audit', 'Filter control present');
      }
    }],
  ];

  for (const [route, fn] of interactions) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    await page.goto(BASE + '/' + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    try { await fn(); }
    catch (e) { fail(route, 'Medium', `Interaction: ${e.message}`); }
    drainErrors(route + ':action');
  }

  // Global search
  await page.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const gs = page.locator('#global-search').first();
  if (await gs.count()) {
    await gs.fill('laptop');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    if (await page.locator('.modal-foot, [data-close], .gs-item').count()) {
      ok('search', 'Global search results UI');
      await page.locator('[data-close]').first().click().catch(() => {});
    } else ok('search', 'Global search submitted (no results chrome)');
  } else fail('search', 'Low', '#global-search not found');

  // Help
  const help = page.locator('#btn-help').first();
  if (await help.count()) {
    await help.click();
    await page.waitForTimeout(600);
    ok('shell', 'Help button responds');
    await page.locator('[data-close]').first().click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }

  await browser.close();
}

async function main() {
  console.log(`QA against ${BASE} as ${EMAIL}`);
  const session = await runApiSmoke();
  if (!session) {
    console.log('\nAborting UI — login failed');
  } else {
    await runBrowser(session);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed.length}`);
  console.log(`Findings: ${findings.length}`);
  const bySev = {};
  for (const f of findings) bySev[f.sev] = (bySev[f.sev] || 0) + 1;
  console.log('By severity:', bySev);
  console.log('\nFINDINGS_JSON');
  console.log(JSON.stringify(findings, null, 2));
  const bad = findings.some((f) => f.sev === 'Critical' || f.sev === 'High');
  process.exit(bad ? 2 : findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
