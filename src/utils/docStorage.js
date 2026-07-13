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

function writeBuffer(kind, id, buffer) {
  const rel = path.join('documents', kind, String(id));
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

module.exports = { writeBuffer, readBuffer, deleteFile, dataRoot };
