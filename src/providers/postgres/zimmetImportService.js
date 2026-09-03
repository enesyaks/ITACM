/**
 * Bulk historical zimmet PDF import.
 *
 * analyze(): split each uploaded PDF into individual zimmet forms, read the
 * assignee name, fuzzy-match it to an employee, and stage the split PDFs in
 * zimmet_import_* (bytes held in `content`). Nothing is attached yet.
 * commit(): attach each staged form to the chosen employee's document archive
 * via documentService, then clear the staged bytes.
 *
 * Staging holds real document bytes, so every read/write here is scoped to the
 * caller's `employee:read` department constraint — the bulk path must not become
 * a way around the per-employee upload gate — and abandoned batches are purged
 * on a timer (purgeStale) instead of sitting in the database forever.
 */
'use strict';

const { query, withTransaction } = require('./pool');
const { isUuid } = require('./rowMapper');
const { HttpError } = require('../../utils/httpError');
const documentService = require('./documentService');
const permissionService = require('./permissionService');
const { extractPages } = require('../../utils/pdfText');
const { detectForms, splitForms, pageCount } = require('../../utils/pdfSplit');
const nameMatch = require('../../utils/nameMatch');
const pdfOcr = require('../../utils/pdfOcr');
const settingsService = require('./settingsService');
const config = require('../../config');

const MAX_FILES = 20;
const MAX_FORMS = 300;
const MAX_PAGES_PER_FILE = 400;
// The router parses up to 80mb of JSON and base64 inflates by ~4/3, so anything
// past ~55MB of PDF could never have arrived intact. Reject it with a real
// message instead of letting body-parser answer 413 with none.
const MAX_TOTAL_BYTES = 55 * 1024 * 1024;
/** Abandoned batches (tab closed mid-review) are purged after this long. */
const STAGING_TTL_HOURS = 24;

/**
 * Employees this user may file documents against.
 * Historical zimmets can belong to former employees, so there is no active
 * filter — but a department-scoped account only ever sees (and can only ever
 * attach to) its own departments, exactly like /api/employees.
 * @returns {Promise<{list:Array<{id,fullName}>, departments:string[]|null}>}
 */
async function roster(user) {
  const scope = await permissionService.getConstraintScope(user, 'employee', 'read', 'department');
  if (scope !== null && !scope.length) {
    throw HttpError.forbidden('Access denied: no department scope for employee:read');
  }
  const { rows } = scope === null
    ? await query('SELECT id, full_name, department FROM employees ORDER BY full_name')
    : await query(
      `SELECT id, full_name, department FROM employees
       WHERE lower(coalesce(department, '')) = ANY($1::text[]) ORDER BY full_name`,
      [scope.map((d) => String(d).toLowerCase())]
    );
  // department rides along so the review picker can tell two people with the
  // same name apart — the exact case that leaves a match "uncertain".
  return {
    list: rows.map((r) => ({ id: r.id, fullName: r.full_name, department: r.department || null })),
    departments: scope,
  };
}

/** Is this employee inside the caller's department scope? */
async function assertInScope(employeeId, departments) {
  const { rows: [emp] } = await query('SELECT id, full_name, department FROM employees WHERE id = $1', [employeeId]);
  if (!emp) return null;
  if (departments === null) return emp;
  const dept = String(emp.department || '').toLowerCase();
  return departments.some((d) => String(d).toLowerCase() === dept) ? emp : null;
}

/** Pick the assignee name for a form: authoritative reverse-match first. */
/**
 * A name is only as trustworthy as the reading it came from.
 *
 * `high` means "this is the person" and the reviewer is invited to click through
 * without looking. That claim rests on an exact name match — but an exact match
 * on badly-read text is still badly-read text, and OCR happily returns a clean
 * string it is not sure about. Below the threshold the item drops to `medium`,
 * which in the review screen means "check this one".
 *
 * Nothing is promoted: a weak match stays weak however well the page scanned.
 */
const OCR_TRUST_MIN = 75;

function capByOcr(match, ocrConfidence) {
  if (!Number.isFinite(ocrConfidence)) return match;            // digital PDF
  if (ocrConfidence >= OCR_TRUST_MIN) return match;
  if (match.confidence !== 'high') return match;
  return { ...match, confidence: 'medium' };
}

function pickName(formText, emps) {
  const hits = nameMatch.findNamesInText(formText, emps);
  if (hits.length === 1) {
    const h = hits[0];
    return { extracted: h.fullName, match: { candidates: [{ id: h.id, fullName: h.fullName, score: 1 }], confidence: 'high', best: h } };
  }
  if (hits.length > 1) {
    return {
      extracted: hits.map((h) => h.fullName).join(', '),
      match: { candidates: hits.slice(0, 5).map((h) => ({ id: h.id, fullName: h.fullName, score: 1 })), confidence: 'medium', best: hits[0] },
    };
  }
  const extracted = nameMatch.nameFromLabel(formText);
  return { extracted, match: nameMatch.matchEmployee(extracted, emps) };
}

/**
 * @param {Array<{filename:string, buffer:Buffer}>} files  already magic-byte/size validated
 * @param {object} user
 */
async function analyze(files, user) {
  if (!files || !files.length) throw HttpError.badRequest('No PDF files provided');
  if (files.length > MAX_FILES) throw HttpError.badRequest(`Too many files (max ${MAX_FILES})`);
  const total = files.reduce((sum, f) => sum + f.buffer.length, 0);
  if (total > MAX_TOTAL_BYTES) {
    throw HttpError.badRequest(`Upload is too large (max ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB per batch)`);
  }
  const { list: emps, departments } = await roster(user);

  const staged = [];
  const failures = [];
  // Whole-batch OCR budget. analyze() answers one HTTP request and OCR costs
  // ~2s a page, so this — not a per-file cap — is what keeps a batch of scans
  // from running past the proxy timeout.
  // The Owner's Integrations toggle decides; ZIMMET_OCR is only the default it
  // starts from. A settings read must never take the import down with it.
  let ocrSetting; let instanceLang;
  try {
    const s = await settingsService.getSettings();
    ocrSetting = s.zimmetOcr;
    instanceLang = s.language; // also picks the OCR models for a non-Turkish instance
  } catch { ocrSetting = undefined; }
  const ocrStatus = pdfOcr.availability(ocrSetting, instanceLang);
  let ocrBudget = ocrStatus.available ? config.ocr.maxPages : 0;
  let ocrUsedPages = 0;
  let ocrTruncated = false;

  for (const f of files) {
    // Page count comes straight from the PDF trailer — check the limit before
    // paying for text extraction on a 5000-page file.
    let pages;
    try { pages = await pageCount(f.buffer); }
    catch { failures.push({ filename: f.filename, reason: 'Could not read PDF' }); continue; }
    if (pages > MAX_PAGES_PER_FILE) {
      failures.push({ filename: f.filename, reason: `Too many pages (${pages}, max ${MAX_PAGES_PER_FILE})` });
      continue;
    }

    let info;
    try { info = await extractPages(f.buffer); }
    catch { failures.push({ filename: f.filename, reason: 'Could not read PDF' }); continue; }
    let texts = info.pages.map((p) => p.text);
    // Per-page OCR confidence, parallel to `texts`. Empty for a digital PDF.
    let pageConf = [];
    let readable = info.hasText;
    let viaOcr = false;

    // Phase 2: a scan has no text layer at all. OCR gives the splitter and the
    // name matcher the same page texts a digital PDF would have, so the whole
    // pipeline below is identical either way.
    if (!info.hasText && ocrBudget > 0) {
      try {
        const r = await pdfOcr.ocrPages(f.buffer, { maxPages: ocrBudget, langs: ocrStatus.langs });
        texts = r.pages.map((p) => p.text);
        pageConf = r.pages.map((p) => p.conf);
        ocrBudget -= r.ocrPages;
        ocrUsedPages += r.ocrPages;
        if (r.truncated) ocrTruncated = true;
        readable = texts.some((t) => t.length > 8);
        viaOcr = readable;
        if (!readable) failures.push({ filename: f.filename, reason: 'OCR found no text on this scan' });
      } catch (e) {
        // A failed scan is not a failed batch — the reviewer assigns it by hand.
        failures.push({ filename: f.filename, reason: `OCR failed: ${e.message}` });
      }
    } else if (!info.hasText && ocrStatus.available) {
      ocrTruncated = true; // budget already spent on earlier files
    }

    const forms = detectForms(texts);
    if (staged.length + forms.length > MAX_FORMS) {
      throw HttpError.badRequest(`Too many forms in this batch (max ${MAX_FORMS}) — split the upload`);
    }
    const buffers = await splitForms(f.buffer, forms);
    forms.forEach((form, i) => {
      const formText = texts.slice(form.from, form.to + 1).join('\n');
      const picked = readable ? pickName(formText, emps)
        : { extracted: '', match: { candidates: [], confidence: 'none', best: null } };
      // The worst page the form spans, because one unreadable page is enough to
      // put the name in doubt — averaging would hide it behind the clean ones.
      const spanConf = pageConf.slice(form.from, form.to + 1).filter((c) => Number.isFinite(c));
      const ocrConfidence = spanConf.length ? Math.min(...spanConf) : null;
      staged.push({
        ...form, filename: f.filename, buffer: buffers[i],
        extracted: picked.extracted,
        match: capByOcr(picked.match, ocrConfidence),
        viaOcr,
        ocrConfidence,
      });
    });
  }
  if (!staged.length) {
    throw HttpError.badRequest('No readable forms found in the upload', { failures });
  }

  // One transaction: a half-written batch would show the reviewer fewer forms
  // than the upload actually contained, and they would commit it anyway.
  const batchId = await withTransaction(async (t) => {
    const { rows: [batch] } = await t.query(
      `INSERT INTO zimmet_import_batches (status, created_by, created_by_name, source_files, item_count)
       VALUES ('pending', $1, $2, $3, $4) RETURNING id`,
      [user.uid, user.username || user.email, JSON.stringify(files.map((f) => f.filename)), staged.length]
    );
    for (const s of staged) {
      const best = s.match.best;
      const filename = `${String(s.filename).replace(/\.pdf$/i, '')}_s${s.from + 1}-${s.to + 1}.pdf`;
      await t.query(
        `INSERT INTO zimmet_import_items
          (batch_id, source_filename, page_from, page_to, page_count, extracted_name,
           matched_employee_id, matched_employee_name, confidence, candidates, filename, byte_size,
           content, via_ocr, ocr_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [batch.id, s.filename, s.from, s.to, (s.to - s.from + 1), s.extracted || null,
          best ? best.id : null, best ? best.fullName : null, s.match.confidence,
          JSON.stringify(s.match.candidates || []), filename, s.buffer.length, s.buffer,
          !!s.viaOcr, Number.isFinite(s.ocrConfidence) ? s.ocrConfidence : null]
      );
    }
    return batch.id;
  });

  const result = await getBatch(batchId, user);
  result.failures = failures;
  result.scopedEmployees = emps;
  result.ocr = {
    enabled: ocrStatus.enabled,
    available: ocrStatus.available,
    reason: ocrStatus.reason,
    // Which models ran, and whether their data was on disk — the review screen
    // needs both to explain a scan that came back blank.
    langs: ocrStatus.langs,
    offline: ocrStatus.offline,
    pages: ocrUsedPages,
    truncated: ocrTruncated,
  };
  return result;
}

async function getBatch(batchId, user) {
  if (!isUuid(batchId)) throw HttpError.notFound('Import batch not found');
  const { rows: [b] } = await query('SELECT * FROM zimmet_import_batches WHERE id = $1', [batchId]);
  if (!b) throw HttpError.notFound('Import batch not found');
  // Staging holds documents the creator picked; nobody else reviews their batch.
  if (user && b.created_by && String(b.created_by) !== String(user.uid)) {
    throw HttpError.notFound('Import batch not found');
  }
  const { rows } = await query(
    `SELECT id, source_filename, page_from, page_to, page_count, extracted_name,
            matched_employee_id, matched_employee_name, confidence, candidates, filename, byte_size,
            status, error, via_ocr, ocr_confidence
     FROM zimmet_import_items WHERE batch_id = $1 ORDER BY source_filename, page_from`,
    [batchId]
  );
  return {
    id: b.id, status: b.status, createdAt: b.created_at, sourceFiles: b.source_files, itemCount: b.item_count,
    items: rows.map((r) => ({
      id: r.id, sourceFilename: r.source_filename, pageFrom: r.page_from, pageTo: r.page_to, pageCount: r.page_count,
      extractedName: r.extracted_name, matchedEmployeeId: r.matched_employee_id, matchedEmployeeName: r.matched_employee_name,
      confidence: r.confidence, candidates: r.candidates, filename: r.filename, byteSize: r.byte_size,
      status: r.status, error: r.error, viaOcr: r.via_ocr, ocrConfidence: r.ocr_confidence,
    })),
  };
}

async function getItemContent(itemId, user) {
  if (!isUuid(itemId)) throw HttpError.notFound('Item not found');
  const { rows: [r] } = await query(
    `SELECT i.content, i.filename, i.mime, b.created_by
     FROM zimmet_import_items i JOIN zimmet_import_batches b ON b.id = i.batch_id
     WHERE i.id = $1`,
    [itemId]
  );
  if (!r || !r.content) throw HttpError.notFound('Item not found');
  if (user && r.created_by && String(r.created_by) !== String(user.uid)) {
    throw HttpError.notFound('Item not found');
  }
  return { buffer: r.content, filename: r.filename, mime: r.mime || 'application/pdf' };
}

/**
 * @param {string} batchId
 * @param {Array<{itemId:string, employeeId:string|null}>} assignments  overrides; absent → use auto-match
 */
async function commit(batchId, assignments, user) {
  if (!isUuid(batchId)) throw HttpError.notFound('Import batch not found');
  if (assignments != null && !Array.isArray(assignments)) {
    throw HttpError.badRequest('assignments must be an array of { itemId, employeeId }');
  }
  const { rows: [owner] } = await query('SELECT created_by, status FROM zimmet_import_batches WHERE id = $1', [batchId]);
  if (!owner || (owner.created_by && String(owner.created_by) !== String(user.uid))) {
    throw HttpError.notFound('Import batch not found');
  }
  // Claim the batch in one statement: a double-clicked "Attach" (or two tabs)
  // must not run the attach loop twice and file every document in duplicate.
  const { rows: [claimed] } = await query(
    "UPDATE zimmet_import_batches SET status = 'committed' WHERE id = $1 AND status = 'pending' RETURNING id",
    [batchId]
  );
  if (!claimed) throw HttpError.conflict('This batch was already processed');

  const { departments } = await roster(user);
  const override = new Map((assignments || [])
    .filter((a) => a && typeof a.itemId === 'string')
    .map((a) => [a.itemId, a.employeeId || null]));
  const { rows: items } = await query(
    "SELECT * FROM zimmet_import_items WHERE batch_id = $1 AND status = 'pending'", [batchId]
  );

  let attached = 0; let skipped = 0; const errors = [];
  for (const it of items) {
    const empId = override.has(it.id) ? override.get(it.id) : it.matched_employee_id;
    if (!empId) {
      // Nothing to attach — drop the staged bytes now rather than leaving the
      // PDF sitting in the staging table after the batch is closed.
      await query("UPDATE zimmet_import_items SET status = 'skipped', content = NULL WHERE id = $1", [it.id]);
      skipped++;
      continue;
    }
    try {
      const emp = isUuid(empId) ? await assertInScope(empId, departments) : null;
      if (!emp) throw HttpError.notFound('Employee not found or outside your scope');
      await documentService.saveDocument({
        handoverId: null, employeeId: emp.id, employeeName: emp.full_name,
        kind: 'legacy_zimmet', filename: it.filename, mime: it.mime, buffer: it.content,
        uploadedBy: user.uid, uploadedByName: user.username || user.email,
      });
      await query(
        "UPDATE zimmet_import_items SET status = 'attached', content = NULL, matched_employee_id = $2, matched_employee_name = $3 WHERE id = $1",
        [it.id, emp.id, emp.full_name]
      );
      attached += 1;
    } catch (e) {
      errors.push({ itemId: it.id, filename: it.filename, error: e.message });
      await query(
        "UPDATE zimmet_import_items SET status = 'failed', content = NULL, error = $2 WHERE id = $1",
        [it.id, String(e.message).slice(0, 500)]
      );
    }
  }
  return { batchId, attached, skipped, failed: errors.length, errors };
}

async function discard(batchId, user) {
  if (!isUuid(batchId)) throw HttpError.notFound('Import batch not found');
  const { rows: [b] } = await query('SELECT created_by FROM zimmet_import_batches WHERE id = $1', [batchId]);
  if (!b || (b.created_by && String(b.created_by) !== String(user.uid))) {
    throw HttpError.notFound('Import batch not found');
  }
  await query("UPDATE zimmet_import_batches SET status = 'discarded' WHERE id = $1", [batchId]);
  await query('DELETE FROM zimmet_import_items WHERE batch_id = $1', [batchId]);
  return { discarded: true };
}

/**
 * Drop staged PDF bytes nothing will ever use again. Called on a timer from
 * utils/scheduler — without it every abandoned review leaves its split
 * documents in the database indefinitely.
 *
 * Two cases: a batch the reviewer never finished (tab closed), and leftovers in
 * an already-closed batch — commit claims the batch up front, so a crash
 * halfway through the attach loop would otherwise strand the remaining bytes.
 */
async function purgeStale(ttlHours = STAGING_TTL_HOURS) {
  const hours = Number(ttlHours) || STAGING_TTL_HOURS;

  const orphans = await query(
    `UPDATE zimmet_import_items i
        SET content = NULL,
            status = CASE WHEN i.status = 'pending' THEN 'skipped' ELSE i.status END
       FROM zimmet_import_batches b
      WHERE i.batch_id = b.id AND b.status <> 'pending' AND i.content IS NOT NULL`
  );

  const abandoned = await query(
    `DELETE FROM zimmet_import_items i
      USING zimmet_import_batches b
      WHERE i.batch_id = b.id
        AND b.status = 'pending'
        AND b.created_at < now() - make_interval(hours => $1)`,
    [hours]
  );
  if (abandoned.rowCount) {
    await query(
      `UPDATE zimmet_import_batches SET status = 'discarded'
        WHERE status = 'pending' AND created_at < now() - make_interval(hours => $1)`,
      [hours]
    );
  }
  return { purgedItems: abandoned.rowCount, clearedOrphans: orphans.rowCount };
}

module.exports = {
  analyze, getBatch, getItemContent, commit, discard, purgeStale,
  MAX_FILES, MAX_FORMS, MAX_TOTAL_BYTES, STAGING_TTL_HOURS,
};
