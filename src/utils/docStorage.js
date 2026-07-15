/** Filesystem storage for uploaded documents (handover scans, repair paperwork). */
const fs = require('fs');
const path = require('path');
const config = require('../config');

function dataRoot() {
  return config.dataDir || path.join(process.cwd(), 'data');
}

function absPath(storagePath) {
  const root = path.resolve(dataRoot());
  const abs = path.resolve(root, storagePath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error('Invalid document storage path');
  }
  return abs;
}

/** Safe filesystem label: "Ayşe Yılmaz" → "Ayse_Yilmaz". */
function safeLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'doc';
  const tr = {
    ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
    ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
  };
  const ascii = raw.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => tr[ch] || ch);
  const cleaned = ascii
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 80);
  return cleaned || 'doc';
}

/** Per-person / per-asset folder: Enes(<uuid>) */
function ownerDirName(ownerLabel, ownerId) {
  const id = String(ownerId || '').trim();
  const label = safeLabel(ownerLabel || 'unknown');
  return id ? `${label}(${id})` : label;
}

/**
 * File inside the owner folder: zimmet-HF-xxx(<docId>).pdf
 * Doc id keeps names unique when the same original filename is uploaded twice.
 */
function diskFileName(id, { label, originalFilename } = {}) {
  const ext = path.extname(String(originalFilename || '')).slice(0, 16);
  const stem = path.basename(String(originalFilename || ''), ext);
  const base = safeLabel(stem || label || 'file');
  return `${base}(${id})${ext}`;
}

/**
 * Layout: documents/<kind>/<Name(ownerId)>/<file(docId).ext>
 *
 * @param {string} kind
 * @param {string} id — document UUID
 * @param {Buffer} buffer
 * @param {{ label?: string, originalFilename?: string, ownerId?: string, ownerLabel?: string }} [opts]
 */
function writeBuffer(kind, id, buffer, opts = {}) {
  const owner = ownerDirName(opts.ownerLabel || opts.label, opts.ownerId);
  const file = diskFileName(id, opts);
  const rel = path.join('documents', kind, owner, file);
  const abs = absPath(rel);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
  } catch (err) {
    if (err && (err.code === 'EACCES' || err.code === 'EPERM')) {
      const e = new Error(
        `Document storage is not writable (${dataRoot()}). `
        + 'Fix ownership of the data volume (Docker: ensure entrypoint can chown DATA_DIR).'
      );
      e.code = err.code;
      e.cause = err;
      throw e;
    }
    throw err;
  }
  return rel.split(path.sep).join('/'); // stable forward slashes in DB
}

function readBuffer(storagePath) {
  if (!storagePath) return null;
  const abs = absPath(storagePath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs);
}

function deleteFile(storagePath) {
  if (!storagePath) return;
  try {
    fs.unlinkSync(absPath(storagePath));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  writeBuffer, readBuffer, deleteFile, dataRoot, safeLabel, diskFileName, ownerDirName,
};
