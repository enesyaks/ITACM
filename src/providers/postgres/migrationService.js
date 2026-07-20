/**
 * Full-system migration packages (itacm-migrate-v1).
 *
 * Export: pg_dump + documents/ tarball under DATA_DIR/migrations/.
 * Import: only when app_settings.onboarded = false (first-run / empty instance).
 *
 * Called from: src/routes/migrations.routes.js, src/routes/setup.routes.js
 * Package fields: MANIFEST.json { format, createdAt ISO8601 UTC, gitSha, database,
 *   dbBytes, documentsBytes, jwtSecretRequired, notes }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createGzip, createGunzip } = require('zlib');
const config = require('../../config');
const { query, pool } = require('./pool');
const { HttpError } = require('../../utils/httpError');

const FORMAT = 'itacm-migrate-v1';
const MIN_UPLOAD_BYTES = 32;
let exportLock = null;
let importLock = null;

function dataRoot() {
  return config.dataDir || path.join(process.cwd(), 'data');
}

function migrationsRoot() {
  return path.join(dataRoot(), 'migrations');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (c) => { stdout += c; });
    if (child.stderr) child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${(stderr || stdout || '').slice(0, 800)}`));
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

function dbNameFromUrl(url) {
  try {
    const u = new URL(url);
    return (u.pathname || '/itacm').replace(/^\//, '') || 'itacm';
  } catch {
    return 'itacm';
  }
}

async function gitShaShort() {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return (stdout || '').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** Constant-time compare for setup tokens (equal-length buffers only). */
function tokensEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length === 0 || bb.length === 0) return false;
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function extractSetupToken(setupToken) {
  const t = String(setupToken || '').trim();
  if (!t) throw HttpError.badRequest('setupToken is required (X-Setup-Token header)');
  return t;
}

/**
 * Validate setup token + fresh-install gate BEFORE accepting an upload body.
 * Re-check inside importFromArchive is still OK (importLock + race safety).
 */
async function assertImportAllowed(setupToken) {
  const token = extractSetupToken(setupToken);
  const row = await assertNotOnboarded();
  if (!row.setupToken || !tokensEqual(row.setupToken, token)) {
    throw HttpError.forbidden('Invalid setup token');
  }
  return row;
}

function isUnsafeArchiveMember(name) {
  if (!name || typeof name !== 'string') return true;
  if (name.includes('\0')) return true;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:\//.test(n) || n.startsWith('//')) return true;
  const parts = n.split('/');
  if (parts.some((p) => p === '..')) return true;
  return false;
}

function assertSafeArchiveMembers(names, { requireDocumentsPrefix = false } = {}) {
  for (const name of names) {
    if (isUnsafeArchiveMember(name)) {
      throw HttpError.badRequest(`Unsafe path in archive: ${String(name).slice(0, 200)}`);
    }
    if (requireDocumentsPrefix) {
      const n = name.replace(/\\/g, '/').replace(/\/+$/, '');
      if (n !== 'documents' && !n.startsWith('documents/')) {
        throw HttpError.badRequest('documents archive must only contain paths under documents/');
      }
    }
  }
}

/** Reject symlinks / realpaths that escape workDir after extract. */
function assertExtractedTreeSafe(workDir) {
  const root = fs.realpathSync(workDir);
  const underRoot = (resolved) => resolved === root || resolved.startsWith(root + path.sep);

  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) {
        let target;
        try {
          target = fs.realpathSync(full);
        } catch {
          throw HttpError.badRequest('Archive contains invalid or dangling symlink');
        }
        if (!underRoot(target)) {
          throw HttpError.badRequest('Archive contains symlink escaping extract directory');
        }
      }
      let resolved;
      try {
        resolved = fs.realpathSync(full);
      } catch {
        throw HttpError.badRequest('Archive contains invalid path after extract');
      }
      if (!underRoot(resolved)) {
        throw HttpError.badRequest('Extracted path escapes work directory');
      }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(full);
    }
  };
  walk(workDir);
}

function readMagic(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  const buf = Buffer.alloc(4);
  try {
    fs.readSync(fd, buf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  return buf;
}

function detectArchiveKind(archivePath) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar';
  const buf = readMagic(archivePath);
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'zip';
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tar';
  throw HttpError.badRequest('Unsupported package — use .tar.gz or .zip (itacm-migrate-v1)');
}

async function listArchiveMembers(archivePath, kind) {
  if (kind === 'zip') {
    try {
      const { stdout } = await run('unzip', ['-Z1', archivePath]);
      return (stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    } catch (err) {
      throw HttpError.badRequest(`Cannot list zip members (is unzip installed?): ${err.message}`);
    }
  }
  const { stdout } = await run('tar', ['tzf', archivePath]);
  return (stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function cleanupExportArtifacts({ archivePath, pkgDir } = {}) {
  if (pkgDir) rmrf(pkgDir);
  if (archivePath) rmrf(archivePath);
}

async function saveUploadStream(req, { maxBytes = 2 * 1024 * 1024 * 1024 } = {}) {
  const dir = path.join(migrationsRoot(), 'uploads');
  ensureDir(dir);
  const dest = path.join(dir, `upload-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.bin`);
  const out = fs.createWriteStream(dest);
  let bytes = 0;
  try {
    await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.off('data', onData);
          req.destroy();
          out.destroy();
          rmrf(dest);
          reject(HttpError.badRequest(`Upload exceeds ${maxBytes} bytes`));
        }
      };
      req.on('data', onData);
      req.on('error', (err) => { out.destroy(); rmrf(dest); reject(err); });
      out.on('error', (err) => { rmrf(dest); reject(err); });
      out.on('finish', resolve);
      req.pipe(out);
    });
  } catch (err) {
    rmrf(dest);
    throw err;
  }
  if (bytes < MIN_UPLOAD_BYTES) {
    rmrf(dest);
    throw HttpError.badRequest('Upload too small to be a valid migration package');
  }
  return { path: dest, bytes };
}

async function dumpDatabase(sqlGzPath) {
  ensureDir(path.dirname(sqlGzPath));
  const out = fs.createWriteStream(sqlGzPath);
  const gzip = createGzip();
  const dump = spawn('pg_dump', ['--clean', '--if-exists', config.databaseUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  let stderr = '';
  dump.stderr.on('data', (c) => { stderr += c; });
  await new Promise((resolve, reject) => {
    dump.on('error', (err) => {
      reject(new Error(
        `pg_dump failed to start (${err.message}). Install postgresql-client in the API image.`
      ));
    });
    let pipeErr = null;
    pipeline(dump.stdout, gzip, out).catch((err) => { pipeErr = err; });
    dump.on('close', (code) => {
      if (pipeErr) reject(pipeErr);
      else if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}

async function packDocuments(tarGzPath) {
  ensureDir(path.dirname(tarGzPath));
  const docsDir = path.join(dataRoot(), 'documents');
  if (!fs.existsSync(docsDir)) {
    const empty = path.join(path.dirname(tarGzPath), '_empty_docs');
    ensureDir(path.join(empty, 'documents'));
    await run('tar', ['czf', tarGzPath, '-C', empty, 'documents']);
    rmrf(empty);
    return;
  }
  await run('tar', ['czf', tarGzPath, '-C', dataRoot(), 'documents']);
}

async function packPackageTar(pkgDir, archivePath) {
  await run('tar', ['czf', archivePath, '-C', path.dirname(pkgDir), path.basename(pkgDir)]);
}

async function createExportPackage() {
  if (exportLock) throw HttpError.conflict('An export is already in progress');
  exportLock = Date.now();
  const name = `itacm-migrate-${stamp()}`;
  const pkgDir = path.join(migrationsRoot(), name);
  const archivePath = `${pkgDir}.tar.gz`;
  try {
    ensureDir(path.join(pkgDir, 'db'));
    ensureDir(path.join(pkgDir, 'files'));
    const sqlGz = path.join(pkgDir, 'db', 'itacm.sql.gz');
    const docsGz = path.join(pkgDir, 'files', 'documents.tar.gz');
    await dumpDatabase(sqlGz);
    await packDocuments(docsGz);
    const dbBytes = fs.statSync(sqlGz).size;
    const documentsBytes = fs.statSync(docsGz).size;
    const manifest = {
      format: FORMAT,
      createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      gitSha: await gitShaShort(),
      database: dbNameFromUrl(config.databaseUrl),
      dbBytes,
      documentsBytes,
      jwtSecretRequired: true,
      notes: 'Restore with npm run migrate:import or first-launch Migrate upload. Copy JWT_SECRET from source .env so SMTP passwords decrypt.',
    };
    fs.writeFileSync(path.join(pkgDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(pkgDir, 'README.txt'), [
      `ITACM migration package (${name})`,
      '',
      'Contents',
      '  db/itacm.sql.gz           Full PostgreSQL dump (settings, users, assets, SMTP, templates, …)',
      '  files/documents.tar.gz    Uploaded PDFs/images under /app/data/documents',
      '  MANIFEST.json             Metadata',
      '',
      'Target host',
      '  1. Install same ITACM version; copy JWT_SECRET from source .env into target .env',
      '  2. docker compose up -d',
      '  3. npm run migrate:import <this-package>',
      '     (or choose "Migrate from another server" on first-open screen)',
      '',
    ].join('\n'));
    await packPackageTar(pkgDir, archivePath);
    return { pkgDir, archivePath, manifest };
  } catch (err) {
    rmrf(pkgDir);
    rmrf(archivePath);
    throw err;
  } finally {
    exportLock = null;
  }
}

async function assertNotOnboarded() {
  const { rows } = await query('SELECT onboarded, setup_token AS "setupToken" FROM app_settings WHERE id = 1');
  if (!rows[0]) throw HttpError.badRequest('app_settings missing');
  if (rows[0].onboarded) {
    throw HttpError.conflict('Instance is already onboarded — migration import is only allowed on a fresh install');
  }
  return rows[0];
}

async function extractArchive(archivePath, workDir) {
  ensureDir(workDir);
  const kind = detectArchiveKind(archivePath);
  const members = await listArchiveMembers(archivePath, kind);
  if (!members.length) throw HttpError.badRequest('Archive is empty');
  assertSafeArchiveMembers(members);

  if (kind === 'zip') {
    try {
      await run('unzip', ['-q', archivePath, '-d', workDir]);
    } catch (err) {
      throw HttpError.badRequest(`Cannot unzip package (is unzip installed?): ${err.message}`);
    }
  } else {
    await run('tar', ['xzf', archivePath, '-C', workDir]);
  }
  assertExtractedTreeSafe(workDir);

  const findPkg = (dir, depth = 0) => {
    if (depth > 3) return null;
    if (fs.existsSync(path.join(dir, 'MANIFEST.json')) || fs.existsSync(path.join(dir, 'db', 'itacm.sql.gz'))) return dir;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const hit = findPkg(path.join(dir, e.name), depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  const pkg = findPkg(workDir);
  if (!pkg) throw HttpError.badRequest('Not a valid itacm-migrate package (missing db/itacm.sql.gz)');
  const pkgReal = fs.realpathSync(pkg);
  const workReal = fs.realpathSync(workDir);
  if (pkgReal !== workReal && !pkgReal.startsWith(workReal + path.sep)) {
    throw HttpError.badRequest('Package directory escaped extract directory');
  }
  return pkg;
}

async function restoreDatabase(sqlGzPath) {
  try {
    await query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_type = 'client backend'
    `);
  } catch { /* best-effort */ }
  const gunzip = createGunzip();
  const input = fs.createReadStream(sqlGzPath).pipe(gunzip);
  await new Promise((resolve, reject) => {
    const psql = spawn('psql', ['-v', 'ON_ERROR_STOP=1', config.databaseUrl], {
      stdio: ['pipe', 'ignore', 'pipe'], env: process.env,
    });
    let stderr = '';
    psql.stderr.on('data', (c) => { stderr += c; });
    psql.on('error', (err) => {
      reject(new Error(`psql failed to start (${err.message}). Install postgresql-client in the API image.`));
    });
    psql.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql restore exited ${code}: ${stderr.slice(0, 1200)}`));
    });
    input.on('error', reject);
    input.pipe(psql.stdin);
  });
  try { await pool.query('SELECT 1'); } catch { /* next request gets a fresh client */ }
}

async function restoreDocuments(docsGzPath) {
  if (!docsGzPath || !fs.existsSync(docsGzPath)) return;
  const { stdout } = await run('tar', ['tzf', docsGzPath]);
  const names = (stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  assertSafeArchiveMembers(names, { requireDocumentsPrefix: true });

  const tmp = path.join(migrationsRoot(), `docs-restore-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  ensureDir(tmp);
  try {
    await run('tar', ['xzf', docsGzPath, '-C', tmp]);
    assertExtractedTreeSafe(tmp);
    const docsSrc = path.join(tmp, 'documents');
    if (fs.existsSync(docsSrc)) {
      const tmpReal = fs.realpathSync(tmp);
      const docsReal = fs.realpathSync(docsSrc);
      if (!docsReal.startsWith(tmpReal + path.sep) && docsReal !== tmpReal) {
        throw HttpError.badRequest('documents path escaped temp extract directory');
      }
    }
    const root = dataRoot();
    rmrf(path.join(root, 'documents'));
    ensureDir(root);
    if (fs.existsSync(docsSrc)) {
      fs.renameSync(docsSrc, path.join(root, 'documents'));
    } else {
      ensureDir(path.join(root, 'documents'));
    }
  } finally {
    rmrf(tmp);
  }
}

async function importFromArchive(archivePath, setupToken) {
  if (importLock) throw HttpError.conflict('An import is already in progress');
  importLock = Date.now();
  const workDir = path.join(migrationsRoot(), `import-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  let uploadCleanup = null;
  try {
    await assertImportAllowed(setupToken);
    if (!archivePath || !fs.existsSync(archivePath)) throw HttpError.badRequest('Migration package file not found');
    let pkgDir = archivePath;
    if (fs.statSync(archivePath).isFile()) {
      ensureDir(workDir);
      pkgDir = await extractArchive(archivePath, workDir);
      uploadCleanup = archivePath;
    }
    const sqlGz = path.join(pkgDir, 'db', 'itacm.sql.gz');
    const docsGz = path.join(pkgDir, 'files', 'documents.tar.gz');
    if (!fs.existsSync(sqlGz)) throw HttpError.badRequest('Package missing db/itacm.sql.gz');
    const manifestPath = path.join(pkgDir, 'MANIFEST.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (m.format && m.format !== FORMAT) throw HttpError.badRequest(`Unsupported package format: ${m.format}`);
      } catch (err) {
        if (err instanceof HttpError) throw err;
      }
    }
    await restoreDatabase(sqlGz);
    await restoreDocuments(docsGz);
    return {
      success: true,
      jwtSecretRequired: true,
      message: 'Import complete. Sign in with a restored Owner account. Ensure JWT_SECRET matches the source host.',
    };
  } finally {
    rmrf(workDir);
    if (uploadCleanup && String(uploadCleanup).includes(`${path.sep}uploads${path.sep}`)) rmrf(uploadCleanup);
    importLock = null;
  }
}

module.exports = {
  FORMAT,
  MIN_UPLOAD_BYTES,
  createExportPackage,
  cleanupExportArtifacts,
  importFromArchive,
  assertImportAllowed,
  tokensEqual,
  saveUploadStream,
  migrationsRoot,
};
