/** Outbound webhooks with HMAC-SHA256 signature. */
const crypto = require('crypto');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { assertSafeOutboundUrl } = require('../../utils/safeOutbound');

const KNOWN_EVENTS = [
  'handover.completed',
  'employee.offboarded',
  'asset.updated',
  'license.expiring_digest',
];

const MASKED_SECRET = '••••••••';

function isBlankOrMaskedSecret(secret) {
  if (secret == null) return true;
  const s = String(secret);
  return !s || s === MASKED_SECRET;
}

function maskWebhook(w) {
  if (!w || typeof w !== 'object') return w;
  return {
    ...w,
    secret: w.secret ? MASKED_SECRET : '',
    hasSecret: !!w.secret,
  };
}

async function listWebhooks({ includeSecrets = false } = {}) {
  const { rows } = await query(
    'SELECT webhooks_json FROM app_settings WHERE id = 1'
  );
  const list = rows[0]?.webhooks_json;
  const arr = Array.isArray(list) ? list : [];
  return includeSecrets ? arr : arr.map(maskWebhook);
}

async function saveWebhooks(list) {
  if (!Array.isArray(list)) throw HttpError.badRequest('webhooks must be an array');
  const existing = await listWebhooks({ includeSecrets: true });
  const byId = Object.fromEntries(existing.map((w) => [w.id, w]));

  const cleaned = [];
  for (const w of list.slice(0, 20)) {
    const url = await assertSafeOutboundUrl(String(w.url || '').trim(), { field: 'Webhook URL', max: 500 });
    const events = Array.isArray(w.events)
      ? w.events.filter((e) => KNOWN_EVENTS.includes(e))
      : ['handover.completed'];
    const id = String(w.id || crypto.randomUUID());
    let secret;
    if (isBlankOrMaskedSecret(w.secret)) {
      secret = byId[id]?.secret || crypto.randomBytes(16).toString('hex');
    } else {
      secret = String(w.secret).slice(0, 64);
    }
    cleaned.push({
      id,
      url,
      secret,
      events: events.length ? events : ['handover.completed'],
      active: w.active !== false,
    });
  }
  await query('UPDATE app_settings SET webhooks_json = $1::jsonb WHERE id = 1', [JSON.stringify(cleaned)]);
  return cleaned.map(maskWebhook);
}

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function emit(event, payload) {
  try {
    const hooks = await listWebhooks({ includeSecrets: true });
    const targets = hooks.filter((h) => h.active && h.events.includes(event));
    if (!targets.length) return;
    const body = JSON.stringify({
      event,
      at: new Date().toISOString(),
      data: payload,
    });
    await Promise.allSettled(targets.map(async (h) => {
      // Re-validate at emit time so saved malicious URLs cannot fire after a policy tighten.
      try {
        await assertSafeOutboundUrl(h.url, { field: 'Webhook URL', max: 500 });
      } catch {
        console.warn('[webhook] skip unsafe URL for event', event);
        return;
      }
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      try {
        await fetch(h.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ITACM-Event': event,
            'X-ITACM-Signature': sign(h.secret, body),
          },
          body,
          signal: controller.signal,
          redirect: 'error',
        });
      } finally {
        clearTimeout(t);
      }
    }));
  } catch (err) {
    console.warn('[webhook] emit failed:', err.message);
  }
}

module.exports = { listWebhooks, saveWebhooks, emit, KNOWN_EVENTS, MASKED_SECRET };
