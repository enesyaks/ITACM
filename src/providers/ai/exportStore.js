const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const { HttpError } = require('../../utils/httpError');

const TTL_MS = 30 * 60 * 1000;
const ID_RE = /^[a-f0-9]{32}$/;

function exportsDir() {
  return path.join(config.dataDir, 'ai-exports');
}

async function ensureDir() {
  await fs.promises.mkdir(exportsDir(), { recursive: true });
}

async function purgeExpired() {
  try {
    const dir = exportsDir();
    const names = await fs.promises.readdir(dir);
    const now = Date.now();
    await Promise.all(names.filter((n) => n.endsWith('.json')).map(async (name) => {
      const metaPath = path.join(dir, name);
      try {
        const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
        if (!meta.expiresAt || meta.expiresAt <= now) {
          const id = String(meta.id || name.replace(/\.json$/, ''));
          await fs.promises.unlink(metaPath).catch(() => {});
          await fs.promises.unlink(path.join(dir, `${id}.pdf`)).catch(() => {});
        }
      } catch {
        await fs.promises.unlink(metaPath).catch(() => {});
      }
    }));
  } catch {
  }
}

async function saveAiExport({ buffer, filename, userId, contentType = 'application/pdf' }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw HttpError.badRequest('Empty export buffer');
  }
  if (!userId) throw HttpError.forbidden('Export owner required');
  await ensureDir();
  await purgeExpired();

  const id = crypto.randomBytes(16).toString('hex');
  const safeName = String(filename || 'report.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'report.pdf';
  const expiresAt = Date.now() + TTL_MS;
  const meta = {
    id,
    filename: safeName,
    userId: String(userId),
    contentType,
    createdAt: Date.now(),
    expiresAt,
  };
  const dir = exportsDir();
  await fs.promises.writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta));
  await fs.promises.writeFile(path.join(dir, `${id}.pdf`), buffer);
  return {
    id,
    filename: safeName,
    url: `/api/ai/exports/${id}.pdf`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

async function openAiExport(id, userId) {
  const clean = String(id || '').replace(/\.pdf$/i, '').toLowerCase();
  if (!ID_RE.test(clean)) throw HttpError.notFound('Export not found');
  const dir = exportsDir();
  const metaPath = path.join(dir, `${clean}.json`);
  const filePath = path.join(dir, `${clean}.pdf`);
  let meta;
  try {
    meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf8'));
  } catch {
    throw HttpError.notFound('Export not found');
  }
  if (!meta.expiresAt || meta.expiresAt <= Date.now()) {
    await fs.promises.unlink(metaPath).catch(() => {});
    await fs.promises.unlink(filePath).catch(() => {});
    throw HttpError.notFound('Export expired');
  }
  if (String(meta.userId) !== String(userId)) {
    throw HttpError.forbidden('Export not available');
  }
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch {
    throw HttpError.notFound('Export not found');
  }
  return { meta, filePath };
}

module.exports = {
  saveAiExport,
  openAiExport,
  purgeExpired,
  TTL_MS,
  exportsDir,
};
