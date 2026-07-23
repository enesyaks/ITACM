/** Express app — served by server.js (local & Docker). */
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // TRUST_PROXY: only enable behind a real reverse proxy that strips/sets
  // X-Forwarded-For. Default OFF so clients cannot spoof req.ip (setup token /
  // rate-limit bypass). Set TRUST_PROXY=1 (or hop count) when nginx/traefik sits in front.
  (() => {
    const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (!raw || raw === '0' || raw === 'false' || raw === 'no') {
      app.set('trust proxy', false);
    } else if (/^\d+$/.test(raw)) {
      app.set('trust proxy', Number(raw));
    } else if (raw === '1' || raw === 'true' || raw === 'yes') {
      app.set('trust proxy', 1);
    } else {
      app.set('trust proxy', false);
    }
  })();

  // Baseline security headers (no external dependency needed). CSP allows
  // only our own code plus Google Fonts. blob: is required so authenticated
  // document previews (PDF iframe / image) can render from createObjectURL.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: blob:",
    "media-src 'self' blob: https:",
    "frame-src 'self' blob: https://www.youtube-nocookie.com",
    "child-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'self' blob:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.use((req, res, next) => {
    const headers = {
      'Content-Security-Policy': CSP,
      'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // camera=(self) — stock-count barcode scanning on phones needs getUserMedia.
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    };
    // Allow document preview iframes; keep DENY for everything else.
    if (!/\/documents\/[^/]+\/download\/?$/.test(req.path)) {
      headers['X-Frame-Options'] = 'DENY';
    }
    res.set(headers);
    next();
  });

  // Coarse abuse guard for the whole API: 1000 requests / 5 min / IP.
  const { rateLimitIp } = require('./utils/setupAccess');
  const apiHits = new Map();
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    const ipKey = rateLimitIp(req);
    let entry = apiHits.get(ipKey);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 5 * 60 * 1000 };
      apiHits.set(ipKey, entry);
    }
    if (++entry.count > 1000) {
      return res.status(429).json({ success: false, error: 'Too many requests — slow down' });
    }
    // Memory guard: sweep only EXPIRED buckets so a flood of throwaway IPs cannot
    // wipe live counters and reset an active abuser's window.
    if (apiHits.size > 10000) {
      for (const [key, e] of apiHits) {
        if (now > e.resetAt) apiHits.delete(key);
      }
    }
    next();
  });

  // CORS: same-origin only unless CORS_ORIGINS is configured explicitly.
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false }));

  // 1MB JSON everywhere, except the document-scan upload route which has its
  // own larger (12MB) parser — otherwise this global parser would reject the
  // scan before the route is reached.
  const jsonSmall = express.json({ limit: '1mb' });
  app.use((req, res, next) => {
    // Document-upload routes carry base64 scans and use their own 12MB parser;
    // skip the small global parser so it doesn't reject them first.
    if (req.method === 'POST' && /^\/api\/(employees|maintenance|providers|contracts)\/[^/]+\/documents\/?$/.test(req.path)) return next();
    if (req.method === 'POST' && req.path === '/api/import/inventory') return next(); // big CSV payloads
    if (req.method === 'POST' && /^\/api\/integrations\/sync\//.test(req.path)) return next(); // sync JSON up to 6mb on route
    if (req.method === 'POST' && req.path === '/api/setup/migrate') return next(); // raw migration archive body
    return jsonSmall(req, res, next);
  });

  // Built-in web UI (public/) — served by the same process, no build step.
  app.use(express.static(PUBLIC_DIR));

  // Capture successful mutating API calls into system_audit_log (fire-and-forget).
  // Must be registered BEFORE routes so res.on('finish') is attached in time.
  app.use('/api', (req, res, next) => {
    res.on('finish', () => {
      try {
        const { auditService } = require('./providers');
        if (auditService && typeof auditService.logFromRequest === 'function') {
          auditService.logFromRequest(req, res).catch(() => {});
        }
      } catch { /* ignore */ }
    });
    next();
  });

  // Liveness + DB readiness. Returns 503 when the database can't answer so that
  // Docker/orchestrator healthchecks detect a degraded API (process up, DB down).
  app.get('/api/health', async (req, res) => {
    const connected = await require('./providers').ping();
    let dataDir = { path: config.dataDir, writable: false };
    try {
      const fs = require('fs');
      const probe = require('path').join(config.dataDir, '.itacm-health');
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      dataDir.writable = true;
    } catch (err) {
      dataDir.error = err.message;
    }
    res.status(connected ? 200 : 503).json({
      success: connected,
      service: 'itacm-backend',
      backend: config.backend,
      db: { connected },
      dataDir,
    });
  });

  // Public bootstrap info for the UI: branding + onboarding state (no secrets).
  app.get('/api/config', async (req, res) => {
    let settings = { companyName: 'IT Asset Control Pro', companyLogo: null, onboarded: false };
    let configError = null;
    try {
      const { settingsService } = require('./providers');
      settings = await settingsService.getSettings();
      // Ensure a setup key exists (logged once) before UI loads — never return it here.
      if (!settings.onboarded) await settingsService.ensureSetupToken();
    } catch (err) {
      configError = 'Database unavailable: ' + err.message;
    }
    const onboardingVideoUrl = String(process.env.ONBOARDING_VIDEO_URL || '').trim() || null;
    const { roleRequiresMfa } = require('./utils/mfaPolicy');
    // UI uses this to skip the mandatory Owner MFA enrollment modal when off.
    const ownerMfaRequired = roleRequiresMfa('Owner');
    res.json({
      success: true,
      data: {
        backend: config.backend,
        configError,
        onboardingVideoUrl,
        ownerMfaRequired,
        ...settings,
      },
    });
  });

  app.use('/api', require('./routes/setup.routes'));
  app.use('/api/migrations', require('./routes/migrations.routes'));
  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api/dashboard', require('./routes/dashboard.routes'));
  app.use('/api/assets', require('./routes/assets.routes'));
  app.use('/api/employees', require('./routes/employees.routes'));
  app.use('/api/org', require('./routes/org.routes'));
  app.use('/api/approvals', require('./routes/approvals.routes'));
  app.use('/api/onboardings', require('./routes/onboarding.routes'));
  app.use('/api/handovers', require('./routes/handovers.routes'));
  app.use('/api/maintenance', require('./routes/maintenance.routes'));
  app.use('/api/licenses', require('./routes/licenses.routes'));
  app.use('/api/consumables', require('./routes/consumables.routes'));
  app.use('/api/catalog', require('./routes/catalog.routes'));
  app.use('/api/documents', require('./routes/documents.routes'));
  app.use('/api/counts', require('./routes/counts.routes'));
  app.use('/api/lines', require('./routes/lines.routes'));
  app.use('/api/providers', require('./routes/providers.routes'));
  app.use('/api/contracts', require('./routes/contracts.routes'));
  app.use('/api/import', require('./routes/import.routes'));
  app.use('/api/audit', require('./routes/audit.routes'));
  app.use('/api/integrations', require('./routes/integrations.routes'));
  app.use('/api/ack', require('./routes/ack.routes'));
  app.use('/api/me', require('./routes/me.routes'));
  app.use('/api/hr', require('./routes/hr.routes'));

  // API + missing static assets stay 404; anything else falls back to the SPA shell.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media/')) {
      return notFoundHandler(req, res);
    }
    // Never SPA-fallback known static extensions (avoids HTML as "video" 200s).
    if (/\.(js|css|map|png|jpe?g|gif|svg|webp|ico|mp4|webm|pdf|woff2?)$/i.test(req.path)) {
      return notFoundHandler(req, res);
    }
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
