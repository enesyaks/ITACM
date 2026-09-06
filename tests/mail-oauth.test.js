'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  getMailToken, forgetMailToken, PROVIDERS, buildAuthorizeUrl, emailFromIdToken,
} = require('../src/utils/mailOAuth');

function withFetch(impl, fn) {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (...args) => { calls++; return impl(...args); };
  return Promise.resolve(fn(() => calls)).finally(() => { global.fetch = original; });
}

const creds = { provider: 'microsoft', tenant: 't-1', clientId: 'c-1', clientSecret: 's-1' };

test('an unknown provider is rejected', async () => {
  await assert.rejects(() => getMailToken({ ...creds, provider: 'nope' }), /Unknown mail OAuth provider/);
});

test('missing credentials are rejected before any network call', async () => {
  await withFetch(() => { throw new Error('should not be called'); }, async () => {
    await assert.rejects(() => getMailToken({ provider: 'microsoft' }), /tenant, client ID and client secret/);
  });
});

test('a token is fetched once and then served from cache', async () => {
  forgetMailToken(creds);
  await withFetch(
    async () => ({ ok: true, json: async () => ({ access_token: 'tok-abc', expires_in: 3600 }) }),
    async (callCount) => {
      const a = await getMailToken(creds);
      const b = await getMailToken(creds);
      assert.strictEqual(a, 'tok-abc');
      assert.strictEqual(b, 'tok-abc');
      assert.strictEqual(callCount(), 1, 'second call should be served from cache');
    }
  );
  forgetMailToken(creds);
});

test('a refused grant surfaces the provider error description', async () => {
  forgetMailToken({ ...creds, clientId: 'bad' });
  await withFetch(
    async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'bad secret' }) }),
    async () => {
      await assert.rejects(() => getMailToken({ ...creds, clientId: 'bad' }), /OAuth2 token refused: bad secret/);
    }
  );
});

test('the Microsoft provider points at the right hosts', () => {
  assert.strictEqual(PROVIDERS.microsoft.imapHost, 'outlook.office365.com');
  assert.strictEqual(PROVIDERS.microsoft.smtpHost, 'smtp.office365.com');
  assert.match(PROVIDERS.microsoft.tokenUrl('contoso'), /login\.microsoftonline\.com\/contoso\//);
});

test('the Google provider points at Gmail hosts', () => {
  assert.strictEqual(PROVIDERS.google.imapHost, 'imap.gmail.com');
  assert.strictEqual(PROVIDERS.google.smtpHost, 'smtp.gmail.com');
});

test('a Google consent URL forces offline + re-consent so a refresh token comes back', () => {
  const url = buildAuthorizeUrl({ provider: 'google', clientId: 'cid', redirectUri: 'https://app/cb', state: 'st' });
  assert.match(url, /accounts\.google\.com/);
  assert.match(url, /access_type=offline/);
  assert.match(url, /prompt=consent/);
  assert.match(url, /scope=[^&]*mail\.google\.com/);
});

test('a Microsoft consent URL carries the tenant and offline_access', () => {
  const url = buildAuthorizeUrl({ provider: 'microsoft', tenant: 'common', clientId: 'cid', redirectUri: 'https://app/cb', state: 'st' });
  assert.match(url, /login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize/);
  assert.match(url, /scope=[^&]*offline_access/);
});

test('the connected address is read from the id_token', () => {
  const claims = Buffer.from(JSON.stringify({ email: 'Desk@Contoso.com' })).toString('base64');
  assert.strictEqual(emailFromIdToken(`h.${claims}.s`), 'desk@contoso.com');
  assert.strictEqual(emailFromIdToken('not-a-jwt'), '');
});
