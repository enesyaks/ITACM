/** Outbound webhooks with HMAC-SHA256 signature. */
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const { assertSafeOutboundUrl, assertSafeOutboundUrlPinned } = require('../../utils/safeOutbound');

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

/**
 * Fire-and-forget POST that pins the socket to a pre-validated public IP
 * (`lookup`) so DNS cannot rebind to an internal address between validation and
 * connect. Redirects are never followed (a 3xx body is simply drained), and the
 * request aborts after `timeoutMs`. Resolves once the response completes; the
 * body is discarded (webhooks are one-way).
 */
function postWebhook(href, { body, headers, lookup, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const transport = u.protocol === 'http:' ? http : https;
    const req = transport.request(
      href,
      { method: 'POST', headers, lookup, servername: u.hostname, timeout: timeoutMs },
      (res) => {
        res.resume(); // drain & discard — do not follow 3xx
        res.on('end', resolve);
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Webhook request timed out')));
    req.on('error', reject);
    req.end(body);
  });
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
      // Re-validate at emit time so saved malicious URLs cannot fire after a policy
      // tighten, and pin the connection to the validated IP (no DNS rebinding).
      let href;
      let lookup;
      try {
        ({ href, lookup } = await assertSafeOutboundUrlPinned(h.url, { field: 'Webhook URL', max: 500 }));
      } catch {
        console.warn('[webhook] skip unsafe URL for event', event);
        return;
      }
      await postWebhook(href, {
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-ITACM-Event': event,
          'X-ITACM-Signature': sign(h.secret, body),
        },
        lookup,
        timeoutMs: 8000,
      });
    }));
  } catch (err) {
    console.warn('[webhook] emit failed:', err.message);
  }
}

module.exports = { listWebhooks, saveWebhooks, emit, KNOWN_EVENTS, MASKED_SECRET };
