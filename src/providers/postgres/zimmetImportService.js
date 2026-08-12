/**
 * Bulk historical zimmet PDF import.
 *
 * analyze(): split each uploaded PDF into individual zimmet forms, read the
 * assignee name, fuzzy-match it to an employee, and stage the split PDFs in
 * zimmet_import_* (bytes held in `content`). Nothing is attached yet.
 * commit(): attach each staged form to the chosen employee's document archive
 * via documentService, then clear the staged bytes.
 */
'use strict';

const { query } = require('./pool');
const { HttpError } = require('../../utils/httpError');
const documentService = require('./documentService');
const { extractPages } = require('../../utils/pdfText');
const { detectForms, pagesToPdf } = require('../../utils/pdfSplit');
const nameMatch = require('../../utils/nameMatch');

const MAX_FILES = 20;
const MAX_FORMS = 300;
const MAX_PAGES_PER_FILE = 400;

// Historical zimmets can belong to former employees — match against everyone.
async function roster() {
  const { rows } = await query('SELECT id, full_name FROM employees ORDER BY full_name');
  return rows.map((r) => ({ id: r.id, fullName: r.full_name }));
}

// Assignee label heuristic (Turkish): "Teslim Alan: Ad Soyad", "Personel: …", etc.
const LABEL_RE = /(teslim\s*alan|zimmetlenen|personel|ad[ıi]?\s*soyad[ıi]?|kullan[ıi]c[ıi])\s*[:\-]?\s*([A-Za-zÇĞİıÖŞÜçğıöşü.\s]{3,50})/i;

/** Pick the assignee name for a form: authoritative reverse-match first. */
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
  const m = LABEL_RE.exec(formText || '');
  const extracted = m ? m[2].replace(/\s+/g, ' ').trim() : '';
  return { extracted, match: nameMatch.matchEmployee(extracted, emps) };
}

/**
 * @param {Array<{filename:string, buffer:Buffer}>} files  already magic-byte/size validated
 * @param {object} user
 */
async function analyze(files, user) {
  if (!files || !files.length) throw HttpError.badRequest('No PDF files provided');
  if (files.length > MAX_FILES) throw HttpError.badRequest(`Too many files (max ${MAX_FILES})`);
  const emps = await roster();

  const staged = [];
  const failures = [];
  for (const f of files) {
    let info;
    try { info = await extractPages(f.buffer); }
    catch { failures.push({ filename: f.filename, reason: 'Could not read PDF' }); continue; }
    if (info.numPages > MAX_PAGES_PER_FILE) throw HttpError.badRequest(`${f.filename}: too many pages (max ${MAX_PAGES_PER_FILE})`);
    const texts = info.pages.map((p) => p.text);
    for (const form of detectForms(texts)) {
      const idx = [];
      for (let p = form.from; p <= form.to; p++) idx.push(p);
      const buf = await pagesToPdf(f.buffer, idx);
      const formText = texts.slice(form.from, form.to + 1).join(' ');
      const picked = info.hasText ? pickName(formText, emps)
        : { extracted: '', match: { candidates: [], confidence: 'none', best: null } };
      staged.push({ ...form, filename: f.filename, buffer: buf, extracted: picked.extracted, match: picked.match, hadText: info.hasText });
    }
  }
  if (staged.length > MAX_FORMS) throw HttpError.badRequest(`Too many forms in this batch (${staged.length}, max ${MAX_FORMS})`);
  if (!staged.length) throw HttpError.badRequest('No readable forms found in the upload');

  const { rows: [batch] } = await query(
    `INSERT INTO zimmet_import_batches (status, created_by, created_by_name, source_files, item_count)
     VALUES ('pending', $1, $2, $3, $4) RETURNING id`,
    [user.uid, user.username || user.email, JSON.stringify(files.map((f) => f.filename)), staged.length]
  );
  for (const s of staged) {
    const best = s.match.best;
    const filename = `${String(s.filename).replace(/\.pdf$/i, '')}_s${s.from + 1}-${s.to + 1}.pdf`;
    await query(
      `INSERT INTO zimmet_import_items
        (batch_id, source_filename, page_from, page_to, page_count, extracted_name,
         matched_employee_id, matched_employee_name, confidence, candidates, filename, byte_size, content)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [batch.id, s.filename, s.from, s.to, (s.to - s.from + 1), s.extracted || null,
        best ? best.id : null, best ? best.fullName : null, s.match.confidence,
        JSON.stringify(s.match.candidates || []), filename, s.buffer.length, s.buffer]
    );
  }
  const result = await getBatch(batch.id);
  result.failures = failures;
  return result;
}

async function getBatch(batchId) {
  const { rows: [b] } = await query('SELECT * FROM zimmet_import_batches WHERE id = $1', [batchId]);
  if (!b) throw HttpError.notFound('Import batch not found');
  const { rows } = await query(
    `SELECT id, source_filename, page_from, page_to, page_count, extracted_name,
            matched_employee_id, matched_employee_name, confidence, candidates, filename, byte_size, status
     FROM zimmet_import_items WHERE batch_id = $1 ORDER BY source_filename, page_from`,
    [batchId]
  );
  return {
    id: b.id, status: b.status, createdAt: b.created_at, sourceFiles: b.source_files, itemCount: b.item_count,
    items: rows.map((r) => ({
      id: r.id, sourceFilename: r.source_filename, pageFrom: r.page_from, pageTo: r.page_to, pageCount: r.page_count,
      extractedName: r.extracted_name, matchedEmployeeId: r.matched_employee_id, matchedEmployeeName: r.matched_employee_name,
      confidence: r.confidence, candidates: r.candidates, filename: r.filename, byteSize: r.byte_size, status: r.status,
    })),
  };
}

async function getItemContent(itemId) {
  const { rows: [r] } = await query('SELECT content, filename, mime FROM zimmet_import_items WHERE id = $1', [itemId]);
  if (!r || !r.content) throw HttpError.notFound('Item not found');
  return { buffer: r.content, filename: r.filename, mime: r.mime || 'application/pdf' };
}

/**
 * @param {string} batchId
 * @param {Array<{itemId:string, employeeId:string|null}>} assignments  overrides; absent → use auto-match
 */
async function commit(batchId, assignments, user) {
  const { rows: [b] } = await query('SELECT status FROM zimmet_import_batches WHERE id = $1', [batchId]);
  if (!b) throw HttpError.notFound('Import batch not found');
  if (b.status !== 'pending') throw HttpError.conflict('This batch was already processed');

  const override = new Map((assignments || []).map((a) => [a.itemId, a.employeeId || null]));
  const { rows: items } = await query(
    "SELECT * FROM zimmet_import_items WHERE batch_id = $1 AND status = 'pending'", [batchId]
  );
  let attached = 0; let skipped = 0; const errors = [];
  for (const it of items) {
    const empId = override.has(it.id) ? override.get(it.id) : it.matched_employee_id;
    if (!empId) { skipped++; continue; }
    try {
      const { rows: [emp] } = await query('SELECT id, full_name FROM employees WHERE id = $1', [empId]);
      if (!emp) { errors.push({ itemId: it.id, error: 'Employee not found' }); continue; }
      await documentService.saveDocument({
        handoverId: null, employeeId: emp.id, employeeName: emp.full_name,
        kind: 'legacy_zimmet', filename: it.filename, mime: it.mime, buffer: it.content,
        uploadedBy: user.uid, uploadedByName: user.username || user.email,
      });
      await query("UPDATE zimmet_import_items SET status = 'attached', content = NULL, matched_employee_id = $2 WHERE id = $1", [it.id, emp.id]);
      attached += 1;
    } catch (e) { errors.push({ itemId: it.id, error: e.message }); }
  }
  await query("UPDATE zimmet_import_batches SET status = 'committed' WHERE id = $1", [batchId]);
  return { attached, skipped, errors };
}

async function discard(batchId) {
  await query("UPDATE zimmet_import_batches SET status = 'discarded' WHERE id = $1", [batchId]);
  await query('DELETE FROM zimmet_import_items WHERE batch_id = $1', [batchId]);
  return { discarded: true };
}

module.exports = { analyze, getBatch, getItemContent, commit, discard };
