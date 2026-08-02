const { query } = require('./pool');
const { encryptSecret, decryptSecret } = require('../../utils/secretCrypto');
const { HttpError } = require('../../utils/httpError');
const { PROVIDER_DEFAULTS, defaultBaseUrl, listProviders } = require('../ai/providers');
const { assertSafeOutboundUrl } = require('../../utils/safeOutbound');
const { aiAllowsPrivate } = require('../ai/http');

const MASK = '••••••••';
const PROVIDER_IDS = new Set(Object.keys(PROVIDER_DEFAULTS));

function envDefaults() {
  const provider = String(process.env.AI_PROVIDER || 'ollama').trim().toLowerCase() || 'ollama';
  const defaults = PROVIDER_DEFAULTS[provider]
    ? { ...PROVIDER_DEFAULTS[provider], baseUrl: defaultBaseUrl(provider) }
    : PROVIDER_DEFAULTS.ollama;
  return {
    enabled: ['1', 'true', 'yes'].includes(String(process.env.AI_ENABLED || '').toLowerCase()),
    provider,
    baseUrl: String(process.env.AI_BASE_URL || defaults.baseUrl || '').trim(),
    model: String(process.env.AI_MODEL || defaults.model || '').trim(),
    apiKey: String(process.env.AI_API_KEY || '').trim(),
    local: defaults.local,
  };
}

function materialize(raw) {
  const env = envDefaults();
  const stored = raw && typeof raw === 'object' ? raw : {};
  const provider = String(stored.provider || env.provider || 'ollama').toLowerCase();
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
  let apiKey = '';
  let apiKeyCorrupt = false;
  if (stored.apiKey) {
    const dec = decryptSecret(stored.apiKey);
    if (stored.apiKey.startsWith('enc:v1:') && !dec) apiKeyCorrupt = true;
    else apiKey = dec;
  }
  if (!apiKey && env.apiKey) apiKey = env.apiKey;

  const hasStored = stored.provider || stored.baseUrl || stored.model || stored.apiKey
    || stored.enabled != null;

  return {
    enabled: hasStored ? !!stored.enabled : !!env.enabled,
    provider,
    baseUrl: String(stored.baseUrl != null ? stored.baseUrl : env.baseUrl || defaultBaseUrl(provider) || '').trim(),
    model: String(stored.model != null ? stored.model : env.model || defaults.model || '').trim(),
    apiKey,
    apiKeyConfigured: !!apiKey,
    apiKeyCorrupt,
    local: stored.local != null ? !!stored.local : !!defaults.local,
  };
}

async function getRaw() {
  const { rows } = await query('SELECT ai_json FROM app_settings WHERE id = 1');
  return rows[0]?.ai_json || {};
}

async function getAiConfig() {
  return materialize(await getRaw());
}

function publicAiConfig(cfg) {
  return {
    enabled: !!cfg.enabled,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl || '',
    model: cfg.model || '',
    apiKey: cfg.apiKeyConfigured ? MASK : '',
    apiKeyConfigured: !!cfg.apiKeyConfigured,
    apiKeyCorrupt: !!cfg.apiKeyCorrupt,
    local: !!cfg.local,
    providers: listProviders(),
  };
}

async function getPublicAiConfig() {
  return publicAiConfig(await getAiConfig());
}

async function saveAiConfig(body = {}) {
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw HttpError.badRequest('body must be an object');
  }
  const cur = await getAiConfig();
  const provider = String(body.provider != null ? body.provider : cur.provider || 'ollama').toLowerCase();
  if (!PROVIDER_IDS.has(provider)) {
    throw HttpError.badRequest(`Unknown AI provider: ${provider}`);
  }
  const defaults = PROVIDER_DEFAULTS[provider];
  const baseUrl = String(body.baseUrl != null ? body.baseUrl : cur.baseUrl || defaultBaseUrl(provider) || '')
    .trim()
    .slice(0, 500);
  const model = String(body.model != null ? body.model : cur.model || defaults.model || '')
    .trim()
    .slice(0, 120);
  const enabled = body.enabled != null ? !!body.enabled : !!cur.enabled;
  const local = body.local != null ? !!body.local : !!defaults.local;

  if (baseUrl) {
    const allowLocal = local || provider === 'ollama' || aiAllowsPrivate();
    await assertSafeOutboundUrl(baseUrl, {
      field: 'AI base URL',
      max: 500,
      allowPrivate: allowLocal,
      allowLocalhost: allowLocal,
    });
  }

  let nextKey = cur.apiKey || '';
  if (body.apiKey !== undefined) {
    const typed = body.apiKey == null ? '' : String(body.apiKey);
    if (typed && typed !== MASK) nextKey = typed.slice(0, 500);
  }
  if (cur.apiKeyCorrupt && (!body.apiKey || body.apiKey === MASK)) {
    throw HttpError.badRequest('AI API key could not be read — enter it again and Save');
  }

  const payload = {
    enabled,
    provider,
    baseUrl,
    model,
    apiKey: nextKey ? encryptSecret(nextKey) : '',
    local,
  };
  await query('UPDATE app_settings SET ai_json = $1::jsonb WHERE id = 1', [JSON.stringify(payload)]);
  return getPublicAiConfig();
}

async function clearAiConfig() {
  await query(`UPDATE app_settings SET ai_json = '{}'::jsonb WHERE id = 1`);
  return getPublicAiConfig();
}

async function resolveRuntimeConfig(overrides = {}) {
  const cfg = await getAiConfig();
  const provider = String(overrides.provider || cfg.provider || 'ollama').toLowerCase();
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
  const merged = {
    enabled: !!cfg.enabled,
    provider,
    baseUrl: overrides.baseUrl || cfg.baseUrl || defaultBaseUrl(provider),
    model: overrides.model || cfg.model || defaults.model,
    apiKey: cfg.apiKey || '',
    local: overrides.local != null ? !!overrides.local : (cfg.local != null ? cfg.local : !!defaults.local),
  };
  if (!merged.enabled) {
    throw HttpError.badRequest('AI assistant is disabled — enable it under Integrations → AI');
  }
  return merged;
}

module.exports = {
  getAiConfig,
  getPublicAiConfig,
  saveAiConfig,
  clearAiConfig,
  resolveRuntimeConfig,
  publicAiConfig,
  envDefaults,
};
