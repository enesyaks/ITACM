'use strict';

/**
 * Scheduled database backups with retention + restore verification.
 *
 * Off by default (BACKUP_ENABLED=1 to turn on). The 1-minute scheduler tick calls
 * runIfDue(), which runs at most once per day at/after BACKUP_HOUR — it uses the
 * newest existing backup's date as "already ran today", so it survives restarts
 * without a separate state file and never double-dumps.
 *
 * Each dump is streamed `pg_dump --clean --if-exists | gzip` to
 * <BACKUP_DIR|DATA_DIR/backups>/itacm-YYYY-MM-DD_HH-mm-ss.sql.gz, then VERIFIED
 * by fully decompressing it and confirming the pg_dump header — proving the
 * archive is complete and restorable, not silently truncated. Old backups beyond
 * BACKUP_KEEP are pruned. Every outcome is written to the audit log.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createGzip, createGunzip } = require('zlib');
const { pipeline } = require('stream/promises');
const config = require('../../config');

const BACKUP_RE = /^itacm-.*\.sql\.gz$/;

function backupDir() {
  return config.backup.dir || path.join(config.dataDir, 'backups');
}

function stamp(now = new Date()) {
  return now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
}

/* ----------------------------- pure decisions ----------------------------- */

/** Should a scheduled backup run right now? Pure so it can be unit-tested. */
function dueDecision({ enabled, hour, now, latestMs }) {
  if (!enabled) return false;
  if (now.getHours() < hour) return false;
  if (!latestMs) return true; // never backed up
  return new Date(latestMs).toDateString() !== now.toDateString();
}

/** Given backup names newest-first, which to delete to keep only `keep`. Pure. */
function toPrune(namesNewestFirst, keep) {
  const n = Math.max(1, Number(keep) || 1);
  return namesNewestFirst.slice(n);
}

/* ------------------------------ filesystem -------------------------------- */

function listBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => BACKUP_RE.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { name: f, path: p, bytes: st.size, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function dumpTo(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const out = fs.createWriteStream(filePath);
  const gzip = createGzip();
  const dump = spawn('pg_dump', ['--clean', '--if-exists', config.databaseUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let stderr = '';
  dump.stderr.on('data', (c) => { stderr += c; });
  await new Promise((resolve, reject) => {
    dump.on('error', (err) => reject(new Error(
      `pg_dump failed to start (${err.message}). Install postgresql-client in the API image.`
    )));
    let pipeErr = null;
    pipeline(dump.stdout, gzip, out).catch((err) => { pipeErr = err; });
    dump.on('close', (code) => {
      if (pipeErr) reject(pipeErr);
      else if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

/**
 * Restore-verification: fully decompress the archive (which fails on a truncated
 * or corrupt gzip) and confirm it carries the pg_dump header. Resolves true only
 * when the whole stream inflated cleanly AND looks like a database dump.
 */
function verifyBackup(filePath) {
  return new Promise((resolve) => {
    let head = '';
    let sawMarker = false;
    const gunzip = createGunzip();
    const rs = fs.createReadStream(filePath);
    gunzip.on('data', (c) => {
      if (head.length < 4096) head += c.toString('utf8');
      if (!sawMarker && /PostgreSQL database dump/i.test(head)) sawMarker = true;
    });
    gunzip.on('end', () => resolve(sawMarker));
    gunzip.on('error', () => resolve(false));
    rs.on('error', () => resolve(false));
    rs.pipe(gunzip);
  });
}

function audit(action, summary, meta) {
  try {
    return require('./auditService')
      .logEvent({ action, source: 'system', summary, meta: meta || null })
      .catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

let running = false;

/** Run one backup now: dump → verify → prune → audit. */
async function runBackup() {
  if (running) return { skipped: 'in-progress' };
  running = true;
  const file = path.join(backupDir(), `itacm-${stamp()}.sql.gz`);
  try {
    await dumpTo(file);
    const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const verified = await verifyBackup(file);
    if (!verified) {
      await audit('backup.failed', `Database backup could not be verified: ${path.basename(file)}`,
        { file: path.basename(file), bytes, verified: false });
      running = false;
      return { ok: false, file, bytes, verified: false };
    }
    const removed = toPrune(listBackups().map((b) => b.name), config.backup.keep);
    for (const name of removed) {
      try { fs.unlinkSync(path.join(backupDir(), name)); } catch { /* ignore */ }
    }
    await audit('backup.created',
      `Database backup created and verified (${(bytes / 1048576).toFixed(1)} MB)`,
      { file: path.basename(file), bytes, verified: true, pruned: removed.length });
    running = false;
    return { ok: true, file, bytes, verified: true, pruned: removed };
  } catch (err) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    await audit('backup.failed', `Database backup failed: ${err.message}`, { error: String(err.message).slice(0, 400) });
    running = false;
    throw err;
  }
}

/** Called every scheduler tick; runs a backup only when one is due. */
async function runIfDue(now = new Date()) {
  const latest = listBackups()[0];
  const due = dueDecision({
    enabled: config.backup.enabled,
    hour: config.backup.hour,
    now,
    latestMs: latest ? latest.mtimeMs : 0,
  });
  if (!due) return null;
  return runBackup().catch((err) => {
    console.warn('[backup] scheduled backup failed:', err.message);
    return null;
  });
}

module.exports = { runBackup, runIfDue, listBackups, verifyBackup, dueDecision, toPrune, backupDir };
