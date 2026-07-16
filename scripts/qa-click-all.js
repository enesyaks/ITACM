#!/usr/bin/env node
/**
 * Full UI click-through QA for ITACM.
 * Uses real login + verify-token profile (no fake Owner permissions).
 *
 * Usage:
 *   BASE=http://localhost:8000 EMAIL=admin@example.com PASS=Admin123! node scripts/qa-click-all.js
 *   ROLE=Viewer EMAIL=viewer@example.com PASS=Admin123! node scripts/qa-click-all.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8000';
const EMAIL = process.env.EMAIL || 'admin@example.com';
const PASS = process.env.PASS || 'Admin123!';
const ROLE_LABEL = process.env.ROLE || 'auto';
const OUT = process.env.OUT || path.join(__dirname, `qa-report-${Date.now()}.json`);

const SKIP_BTN_RE = /delete|remove|destroy|wipe|revoke|disable|enable|logout|sign out|çıkış|sil|devre dışı|block|unblock|ban|save smtp|clear smtp|run digest|create key|save webhooks|send test/i;
const SKIP_CONFIRM_RE = /are you sure|emin misiniz|confirm delete|this cannot be undone/i;

const ROUTES = [
  '#/dashboard', '#/assets', '#/network', '#/catalog', '#/licenses', '#/lines',
  '#/providers', '#/consumables', '#/employees', '#/handover', '#/maintenance',
  '#/stockcount', '#/reports', '#/audit', '#/integrations', '#/users',
];

const report = {
  base: BASE,
  email: EMAIL,
  role: ROLE_LABEL,
  startedAt: new Date().toISOString(),
  profile: null,
  routes: [],
  buttons: [],
  apiErrors: [],
  jsErrors: [],
  findings: [],
  passed: [],
};

function pass(area, msg) {
  report.passed.push({ area, msg });
  console.log(`✓ ${area}: ${msg}`);
}
function find(area, sev, msg, detail) {
  report.findings.push({ area, sev, msg, detail: detail || '' });
  console.error(`✗ [${sev}] ${area}: ${msg}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`);
}

async function loginApi() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const json = await res.json();
  if (!res.ok || !json?.data?.token) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(json)}`);
  }
  const token = json.data.token;
  const vr = await fetch(`${BASE}/api/auth/verify-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const vj = await vr.json();
  if (!vr.ok || !vj?.data) throw new Error(`verify-token failed: ${vr.status}`);
  return { token, profile: vj.data };
}

async function closeOverlays(page) {
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    const closer = page.locator('[data-close], .modal-close, button:has-text("Cancel"), button:has-text("Close"), button:has-text("Kapat"), #modal-root button.icon-btn').first();
    if (await closer.count()) {
      await closer.click({ timeout: 600, force: true }).catch(() => {});
    }
    await page.evaluate(() => {
      const root = document.getElementById('modal-root');
      if (root) root.innerHTML = '';
      document.querySelectorAll('.modal-overlay, .drawer.open, .sheet').forEach((el) => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(80);
  }
}

async function main() {
  console.log(`QA click-all → ${BASE} as ${EMAIL}`);
  const { token, profile } = await loginApi();
  report.profile = {
    email: profile.email,
    role: profile.role,
    uid: profile.uid,
    iamCount: Array.isArray(profile.iamPermissions) ? profile.iamPermissions.length : 0,
    permissions: profile.permissions || {},
  };
  report.role = profile.role || ROLE_LABEL;
  pass('auth', `Login+verify OK as ${profile.email} (${profile.role}), IAM=${report.profile.iamCount}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!/favicon|Failed to load resource|net::ERR_/i.test(t)) {
        report.jsErrors.push({ type: 'console', text: t.slice(0, 300), at: page.url() });
      }
    }
  });
  page.on('pageerror', (err) => {
    report.jsErrors.push({ type: 'pageerror', text: String(err.message || err).slice(0, 300), at: page.url() });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    const st = res.status();
    if (st >= 400) {
      report.apiErrors.push({
        status: st,
        method: res.request().method(),
        path: url.replace(BASE, ''),
        route: page.url().replace(BASE, ''),
      });
    }
  });

  // Token must be in localStorage BEFORE SPA init reads Auth.token.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, profile }) => {
    localStorage.setItem('itacm_token', token);
    localStorage.setItem('itacm_profile', JSON.stringify(profile));
  }, { token, profile });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(800);
  if (await page.locator('#login-screen:not(.hidden)').count()) {
    find('auth', 'Critical', 'Still on login after session inject+reload');
  } else {
    pass('auth', 'App shell visible after session resume');
  }

  await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Shell chrome (topbar / search only — not page body)
  for (const id of ['#btn-notifications', '#btn-settings', '#btn-help', '#global-search']) {
    await closeOverlays(page);
    const el = page.locator(id).first();
    if (!(await el.count())) {
      find('shell', 'Low', `${id} missing`);
      continue;
    }
    try {
      if (id === '#global-search') {
        await el.fill('laptop');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(900);
        pass('shell', 'Global search submitted');
      } else {
        await el.click({ timeout: 5000, force: true });
        await page.waitForTimeout(500);
        pass('shell', `${id} clicked`);
      }
    } catch (e) {
      find('shell', 'Medium', `${id} click failed`, e.message);
    }
    await closeOverlays(page);
  }

  for (const hash of ROUTES) {
    const routeResult = {
      route: hash,
      rendered: false,
      wordCount: 0,
      redirectedTo: null,
      buttonsSeen: 0,
      buttonsClicked: 0,
      buttonsSkipped: 0,
      errors: [],
    };
    const apiBefore = report.apiErrors.length;
    const jsBefore = report.jsErrors.length;

    await closeOverlays(page);
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1100);

    const current = page.url().replace(/.*(#\/[^?]*)?.*/, (_, h) => h || page.url());
    const hashNow = (page.url().match(/#\/[^?]*/ ) || ['#/?'])[0];
    if (hashNow !== hash && hash !== '#/dashboard') {
      routeResult.redirectedTo = hashNow;
      // Expected for routes gated by canManageUsers / canViewAudit / integrations
      const gated = ['#/users', '#/audit', '#/integrations'].includes(hash);
      if (gated && profile.role !== 'Owner' && profile.role !== 'Admin') {
        pass(hash, `Gated redirect → ${hashNow} (expected for ${profile.role})`);
      } else if (gated && !(profile.permissions?.canManageUsers || profile.permissions?.canViewAudit || profile.permissions?.canAccessIntegrations)) {
        pass(hash, `Gated redirect → ${hashNow}`);
      } else {
        find(hash, 'Medium', `Unexpected redirect to ${hashNow}`);
      }
    }

    let bodyText = '';
    try {
      bodyText = await page.locator('#view').innerText({ timeout: 3000 });
    } catch {
      bodyText = await page.locator('#app').innerText().catch(() => '');
    }
    routeResult.wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
    routeResult.rendered = routeResult.wordCount >= 8;

    if (/TypeError|ReferenceError|Cannot read propert|is not defined/i.test(bodyText)) {
      find(hash, 'High', 'Error text in view', bodyText.slice(0, 180));
      routeResult.errors.push('error text in view');
    } else if (!routeResult.rendered && !routeResult.redirectedTo) {
      find(hash, 'Medium', 'View appears empty');
    } else if (routeResult.rendered) {
      pass(hash, `Rendered (${routeResult.wordCount} words)`);
    }

    // Click tabs first (in #view only)
    const tabs = page.locator('#view button[data-tab], #view [role="tab"], #view .tabs button, #view .seg button');
    const tabCount = await tabs.count();
    for (let i = 0; i < Math.min(tabCount, 8); i++) {
      const t = tabs.nth(i);
      if (!(await t.isVisible().catch(() => false))) continue;
      const label = ((await t.innerText().catch(() => '')) || '').trim().slice(0, 40);
      await t.click().catch(() => {});
      await page.waitForTimeout(500);
      pass(hash, `Tab: ${label || i}`);
      report.buttons.push({ route: hash, label: `tab:${label}`, result: 'ok' });
    }

    // Buttons inside the active view only (exclude topbar material icons)
    const ICON_ONLY = /^(menu|search|notifications|help|settings|qr_code_scanner|close|more_vert|arrow_back|arrow_forward|download|upload|add|edit|delete|visibility|lock|lock_open|info|warning|check|chevron_right|chevron_left|expand_more|filter_list|refresh|tune)$/i;
    const btnHandles = await page.locator('#view button:visible, #view a.btn:visible').elementHandles();
    routeResult.buttonsSeen = btnHandles.length;
    const clickedLabels = new Set();
    const maxClicks = 18;

    for (const handle of btnHandles) {
      if (routeResult.buttonsClicked >= maxClicks) break;
      const label = ((await handle.innerText().catch(() => '')) || (await handle.getAttribute('title').catch(() => '')) || '')
        .replace(/\s+/g, ' ').trim().slice(0, 60);
      const key = label.toLowerCase();
      if (!key || clickedLabels.has(key)) continue;
      if (ICON_ONLY.test(key) && key.length < 24 && !/\s/.test(key)) continue;
      clickedLabels.add(key);

      if (SKIP_BTN_RE.test(label)) {
        routeResult.buttonsSkipped += 1;
        report.buttons.push({ route: hash, label, result: 'skipped-destructive' });
        continue;
      }

      try {
        await handle.click({ timeout: 2500 });
        await page.waitForTimeout(650);

        const bodyAfter = await page.locator('body').innerText().catch(() => '');
        if (SKIP_CONFIRM_RE.test(bodyAfter)) {
          await page.locator('button:has-text("Cancel"), button:has-text("No"), [data-close]').first().click().catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
          report.buttons.push({ route: hash, label, result: 'opened-confirm-cancelled' });
          routeResult.buttonsClicked += 1;
          pass(hash, `Confirm dialog cancelled: ${label}`);
        } else {
          const hasModal = await page.locator('.modal-foot, #modal-root .modal, [data-close], .drawer.open, .sheet').count();
          report.buttons.push({
            route: hash,
            label,
            result: hasModal ? 'opened-ui' : 'clicked',
          });
          routeResult.buttonsClicked += 1;
          pass(hash, `Click: ${label}${hasModal ? ' (modal/drawer)' : ''}`);
        }
        await closeOverlays(page);
        await page.waitForTimeout(200);
      } catch (e) {
        report.buttons.push({ route: hash, label, result: 'fail', error: e.message });
        find(hash, 'Medium', `Button click failed: ${label}`, e.message);
        await closeOverlays(page);
      }
    }

    // Try first data row if any
    const row = page.locator('#view table.data tbody tr, #view tbody tr, #view .list-row, #view .card[data-id]').first();
    if (await row.count() && await row.isVisible().catch(() => false)) {
      await row.click().catch(() => {});
      await page.waitForTimeout(700);
      const detail = await page.locator('.modal-foot, [data-close], .drawer, .detail-panel').count();
      if (detail) {
        pass(hash, 'First row opened detail');
        await closeOverlays(page);
      } else {
        pass(hash, 'First row clicked (no modal detected)');
      }
    }

    const newApi = report.apiErrors.slice(apiBefore).filter((e) => e.status >= 500);
    const newJs = report.jsErrors.slice(jsBefore);
    if (newApi.length) find(hash, 'High', `API 5xx during route`, JSON.stringify(newApi.slice(0, 3)));
    if (newJs.length) find(hash, 'Medium', `JS errors during route`, newJs.map((x) => x.text).slice(0, 2).join(' | '));

    // 403 on core read endpoints when Owner should not happen
    if (profile.role === 'Owner') {
      const denied = report.apiErrors.slice(apiBefore).filter((e) => e.status === 403 && e.method === 'GET');
      if (denied.length) find(hash, 'High', 'Owner got 403 on GET', denied.map((d) => d.path).slice(0, 4).join(', '));
    }

    report.routes.push(routeResult);
  }

  // IAM-specific probes as this role
  if (profile.role === 'Viewer' || report.profile.iamCount) {
    await page.goto(`${BASE}/#/providers`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const contractsTab = page.locator('button:has-text("Contracts"), [data-tab="contracts"]').first();
    const hasContractRead = Array.isArray(profile.iamPermissions)
      && profile.iamPermissions.some((p) => p.resource === 'contract' && p.action === 'read');
    if (!hasContractRead && profile.role !== 'Owner') {
      if (await contractsTab.count() && await contractsTab.isVisible().catch(() => false)) {
        find('providers-iam', 'Medium', 'Contracts tab visible without contract:read');
      } else {
        pass('providers-iam', 'Contracts tab hidden without contract:read');
      }
    }

    await page.goto(`${BASE}/#/reports`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const maint403 = report.apiErrors.filter((e) => e.path.includes('/maintenance') && e.status === 403 && e.route.includes('reports'));
    if (maint403.length && !(profile.iamPermissions || []).some((p) => p.resource === 'maintenance' && p.action === 'read') && profile.role !== 'Owner') {
      find('reports-iam', 'High', 'Reports page still fetching /maintenance without maintenance:read');
    } else if (profile.role !== 'Owner') {
      pass('reports-iam', 'No unexpected maintenance 403 from reports (or has maintenance:read)');
    }
  }

  await browser.close();
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.passed.length,
    findings: report.findings.length,
    routes: report.routes.length,
    buttonsClicked: report.buttons.filter((b) => b.result === 'clicked' || b.result === 'opened-ui' || b.result === 'opened-confirm-cancelled').length,
    buttonsSkipped: report.buttons.filter((b) => b.result === 'skipped-destructive').length,
    api4xx: report.apiErrors.filter((e) => e.status >= 400 && e.status < 500).length,
    api5xx: report.apiErrors.filter((e) => e.status >= 500).length,
    jsErrors: report.jsErrors.length,
    bySeverity: report.findings.reduce((a, f) => { a[f.sev] = (a[f.sev] || 0) + 1; return a; }, {}),
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report written: ${OUT}`);
  const bad = report.findings.some((f) => f.sev === 'Critical' || f.sev === 'High');
  process.exit(bad ? 2 : report.findings.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
