const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const { URL } = require('url');
const { assertSafeOutboundUrlPinned } = require('../../utils/safeOutbound');
const { HttpError } = require('../../utils/httpError');

const HOST_GATEWAY = 'host.docker.internal';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function aiAllowsPrivate() {
  return ['1', 'true', 'yes'].includes(String(process.env.AI_ALLOW_PRIVATE || '').toLowerCase());
}

let containerRuntime = null;
function isContainerRuntime() {
  if (containerRuntime == null) {
    try { containerRuntime = fs.existsSync('/.dockerenv'); }
    catch { containerRuntime = false; }
  }
  return containerRuntime;
}

let gatewayHost;
async function hostGateway() {
  if (gatewayHost !== undefined) return gatewayHost;
  try {
    await dns.lookup(HOST_GATEWAY);
    gatewayHost = HOST_GATEWAY;
  } catch {
    gatewayHost = null;
  }
  return gatewayHost;
}

async function resolveLoopbackForContainer(rawUrl) {
  if (!rawUrl || !isContainerRuntime()) return rawUrl;
  let u;
  try { u = new URL(String(rawUrl)); } catch { return rawUrl; }
  if (!LOOPBACK_HOSTS.has(u.hostname.toLowerCase())) return rawUrl;
  const gw = await hostGateway();
  if (!gw) return rawUrl;
  u.hostname = gw;
  return u.toString();
}

function containerDefaultOllamaUrl(fallback) {
  return isContainerRuntime() ? `http://${HOST_GATEWAY}:11434` : fallback;
}

async function aiFetch({
  url,
  method = 'GET',
  headers = {},
  body = null,
  timeoutMs = 120000,
  allowPrivate = false,
  signal,
} = {}) {
  const allowLocal = !!(allowPrivate || aiAllowsPrivate());
  const { href, lookup } = await assertSafeOutboundUrlPinned(url, {
    field: 'AI base URL',
    max: 500,
    allowPrivate: allowLocal,
    allowLocalhost: allowLocal,
  });
  const u = new URL(href);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
      lookup,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        ok({
          status: res.statusCode || 0,
          headers: res.headers,
          body: buf,
          text: () => buf.toString('utf8'),
          json: () => {
            try { return JSON.parse(buf.toString('utf8')); }
            catch { throw HttpError.badGateway('AI provider returned non-JSON'); }
          },
        });
      });
      res.on('error', fail);
    });

    req.on('timeout', () => {
      req.destroy();
      fail(HttpError.badGateway('AI provider timed out'));
    });
    req.on('error', (err) => fail(HttpError.badGateway(`AI provider unreachable: ${err.message}`)));

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        return fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        fail(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }, { once: true });
    }

    if (payload) req.write(payload);
    req.end();
  });
}

async function* aiStreamLines(opts) {
  const httpMod = require('http');
  const httpsMod = require('https');
  const allowLocal = !!(opts.allowPrivate || aiAllowsPrivate());
  const { href, lookup } = await assertSafeOutboundUrlPinned(opts.url, {
    field: 'AI base URL',
    max: 500,
    allowPrivate: allowLocal,
    allowLocalhost: allowLocal,
  });
  const u = new URL(href);
  const lib = u.protocol === 'https:' ? httpsMod : httpMod;
  const payload = opts.body == null
    ? null
    : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body), 'utf8');

  const res = await new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'POST',
      headers: {
        ...(opts.headers || {}),
        ...(payload ? { 'Content-Length': payload.length } : {}),
      },
      lookup,
      timeout: opts.timeoutMs || 180000,
    }, resolve);
    req.on('timeout', () => {
      req.destroy();
      reject(HttpError.badGateway('AI provider timed out'));
    });
    req.on('error', (err) => reject(HttpError.badGateway(`AI provider unreachable: ${err.message}`)));
    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy();
        return reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }
      opts.signal.addEventListener('abort', () => {
        req.destroy();
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
    if (payload) req.write(payload);
    req.end();
  });

  if ((res.statusCode || 0) >= 400) {
    const chunks = [];
    for await (const c of res) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8').slice(0, 400);
    throw HttpError.badGateway(`AI provider HTTP ${res.statusCode}: ${text}`);
  }

  let buf = '';
  for await (const chunk of res) {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.replace(/\r$/, '');
}

module.exports = {
  aiFetch,
  aiStreamLines,
  aiAllowsPrivate,
  isContainerRuntime,
  resolveLoopbackForContainer,
  containerDefaultOllamaUrl,
};
