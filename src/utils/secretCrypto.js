/** Encrypt app secrets at rest (SMTP passwords) with a key derived from JWT_SECRET. */
const crypto = require('crypto');
const config = require('../config');

const PREFIX = 'enc:v1:';

function derivedKey() {
  return crypto.createHash('sha256').update(String(config.jwtSecret || ''), 'utf8').digest();
}

function encryptSecret(plain) {
  const text = String(plain || '');
  if (!text) return '';
  if (text.startsWith(PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptSecret(stored) {
  const text = String(stored || '');
  if (!text) return '';
  if (!text.startsWith(PREFIX)) return text; // legacy plaintext until next save
  try {
    const buf = Buffer.from(text.slice(PREFIX.length), 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { encryptSecret, decryptSecret, PREFIX };
