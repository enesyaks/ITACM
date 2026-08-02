/**
 * AI assistant API.
 *   GET  /api/ai/status          — provider/model availability (auth)
 *   GET  /api/ai/config          — public config (integration:read)
 *   PUT  /api/ai/config          — save config (integration:manage)
 *   DELETE /api/ai/config        — clear config (integration:manage)
 *   GET  /api/ai/exports/:id.pdf — short-lived report PDF download (auth, owner)
 *   POST /api/ai/query           — SSE agentic query (auth, staff)
 */
const express = require('express');
const fs = require('fs');
const router = express.Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { aiConfigService, auditService } = require('../services');
const { runAgentQuery, listProviders, aiFetch, normalizeLang, localLabel } = require('../providers/ai');
const { openAiExport } = require('../providers/ai/exportStore');
const { contentDisposition } = require('../utils/contentDisposition');
const { HttpError } = require('../utils/httpError');

function isStaff(user) {
  return user && !['Portal', 'HR'].includes(user.role);
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

router.get('/status', authenticate, asyncHandler(async (req, res) => {
  if (!isStaff(req.user)) throw HttpError.forbidden('AI assistant is not available for this role');
  const cfg = await aiConfigService.getAiConfig();
  const enabled = !!cfg.enabled;
  const lang = normalizeLang(req.query?.lang);
  res.json({
    success: true,
    data: {
      enabled,
      provider: cfg.provider,
      model: cfg.model,
      local: !!cfg.local,
      label: enabled && cfg.model
        ? `${cfg.model} · ${cfg.local ? localLabel(lang) : cfg.provider}`
        : null,
      providers: listProviders(),
    },
  });
}));

router.get('/config', authenticate, requirePermission('integration', 'read'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await aiConfigService.getPublicAiConfig() });
}));

router.put('/config', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  req.audit = { action: 'ai.config.save', source: 'ai', summary: 'AI assistant settings updated' };
  res.json({ success: true, data: await aiConfigService.saveAiConfig(req.body || {}) });
}));

router.delete('/config', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  req.audit = { action: 'ai.config.clear', source: 'ai', summary: 'AI assistant settings cleared' };
  res.json({ success: true, data: await aiConfigService.clearAiConfig() });
}));

/** Quick connectivity probe (lists Ollama models or hits OpenAI-style /models). */
router.post('/test', authenticate, requirePermission('integration', 'manage'), asyncHandler(async (req, res) => {
  const cfg = await aiConfigService.resolveRuntimeConfig(req.body || {});
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  if (cfg.provider === 'ollama' || cfg.local) {
    const url = `${base || 'http://127.0.0.1:11434'}/api/tags`;
    const r = await aiFetch({ url, method: 'GET', allowPrivate: true, timeoutMs: 8000 });
    if (r.status >= 400) throw HttpError.badGateway(`Ollama probe HTTP ${r.status}`);
    const data = r.json();
    const models = (data.models || []).map((m) => m.name).filter(Boolean).slice(0, 50);
    return res.json({ success: true, data: { ok: true, provider: cfg.provider, models } });
  }
  if (cfg.provider === 'anthropic') {
    return res.json({
      success: true,
      data: { ok: !!cfg.apiKey, provider: cfg.provider, note: 'API key present — chat will validate on first query' },
    });
  }
  const url = `${base}/models`;
  const headers = { Accept: 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const r = await aiFetch({
    url, method: 'GET', headers, allowPrivate: !!cfg.local, timeoutMs: 12000,
  });
  if (r.status >= 400) throw HttpError.badGateway(`Provider probe HTTP ${r.status}: ${r.text().slice(0, 200)}`);
  const data = r.json();
  const models = (data.data || []).map((m) => m.id).filter(Boolean).slice(0, 50);
  res.json({ success: true, data: { ok: true, provider: cfg.provider, models } });
}));

/** Short-lived report PDF produced by build_report (owner-only). */
router.get('/exports/:id', authenticate, asyncHandler(async (req, res) => {
  if (!isStaff(req.user)) throw HttpError.forbidden('AI assistant is not available for this role');
  const { meta, filePath } = await openAiExport(req.params.id, req.user.uid);
  res.setHeader('Content-Type', meta.contentType || 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(meta.filename || 'report.pdf'));
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(filePath).pipe(res);
}));

router.post('/query', authenticate, asyncHandler(async (req, res) => {
  if (!isStaff(req.user)) throw HttpError.forbidden('AI assistant is not available for this role');

  const prompt = String(req.body?.prompt || req.body?.message || '').trim();
  if (!prompt) throw HttpError.badRequest('prompt is required');
  if (prompt.length > 4000) throw HttpError.badRequest('prompt too long (max 4000)');

  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const lang = normalizeLang(req.body?.lang);
  const overrides = {};
  if (req.body?.provider) overrides.provider = req.body.provider;
  if (req.body?.model) overrides.model = req.body.model;

  const config = await aiConfigService.resolveRuntimeConfig(overrides);
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  writeSse(res, 'open', { ok: true });

  const toolsUsed = [];
  try {
    for await (const ev of runAgentQuery({
      config,
      prompt,
      history,
      lang,
      user: req.user,
      signal: ac.signal,
    })) {
      if (ev.type === 'tool_end') toolsUsed.push(ev.name);
      writeSse(res, ev.type, ev);
    }
    auditService.logEvent({
      action: 'ai.query',
      source: 'ai',
      summary: `AI query (${toolsUsed.length ? toolsUsed.join(',') : 'chat'}): ${prompt.slice(0, 120)}`,
      actorId: req.user.uid,
      actorEmail: req.user.email,
      actorName: req.user.username,
      entityType: 'ai',
      meta: { provider: config.provider, model: config.model, tools: toolsUsed },
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(() => {});
  } catch (err) {
    if (err?.name !== 'AbortError') {
      const rawErr = String(err?.message || 'AI query failed');
      // Mask internal paths or stack trace leaks
      const safeErr = rawErr.replace(/(?:\/[a-zA-Z0-9_.-]+)+/g, '[path]').replace(/at\s+.*:\d+:\d+/g, '').trim();
      writeSse(res, 'error', { type: 'error', error: safeErr || 'AI query failed' });
    }
  }
  res.end();
}));

module.exports = router;
