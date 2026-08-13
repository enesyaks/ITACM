/**
 * Bulk historical zimmet PDF import — mounted at /api/import/zimmet.
 * Gated with the same permission as the per-employee document archive
 * (handover_document:upload + employee:view_handover). The service additionally
 * confines every batch to the caller's employee:read department scope, so this
 * route cannot file documents the per-employee upload route would refuse.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { authenticate, requireAllPermissions } = require('../middleware/auth');
const { validateUpload } = require('../utils/uploadGuard');
const { contentDisposition } = require('../utils/contentDisposition');
const { HttpError } = require('../utils/httpError');
const { zimmetImportService } = require('../services');

const gate = requireAllPermissions([['handover_document', 'upload'], ['employee', 'view_handover']]);
// Only /analyze carries base64 PDFs; the other routes take small JSON bodies
// and must not be handed an 80mb parser they have no use for.
const bigJson = express.json({ limit: '80mb' });

router.use(authenticate);

/** POST /api/import/zimmet/analyze — split + match, stage a batch (no attach). */
router.post('/analyze', gate, bigJson, asyncHandler(async (req, res) => {
  const rawFiles = Array.isArray(req.body && req.body.files) ? req.body.files : [];
  if (!rawFiles.length) throw HttpError.badRequest('Provide at least one PDF file');
  if (rawFiles.length > zimmetImportService.MAX_FILES) {
    throw HttpError.badRequest(`Too many files (max ${zimmetImportService.MAX_FILES})`);
  }
  const files = rawFiles.map((f) => {
    const { buffer, mime, filename } = validateUpload(f || {});
    if (mime !== 'application/pdf') throw HttpError.badRequest(`${filename}: only PDF files are supported`);
    return { filename, buffer };
  });
  res.status(201).json({ success: true, data: await zimmetImportService.analyze(files, req.user) });
}));

/** GET /api/import/zimmet/batches/:id — re-fetch a staged batch preview. */
router.get('/batches/:id', gate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await zimmetImportService.getBatch(req.params.id, req.user) });
}));

/** GET /api/import/zimmet/items/:id/preview — stream a split form for review. */
router.get('/items/:id/preview', gate, asyncHandler(async (req, res) => {
  const { buffer, filename } = await zimmetImportService.getItemContent(req.params.id, req.user);
  // Staging only ever holds PDFs (uploadGuard sniffed the magic bytes), so the
  // type is pinned here rather than echoed back from a stored column.
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(filename, { inline: true }));
  res.send(buffer);
}));

/** POST /api/import/zimmet/commit — attach staged forms to chosen employees. */
router.post('/commit', gate, asyncHandler(async (req, res) => {
  const { batchId, assignments } = req.body || {};
  if (!batchId) throw HttpError.badRequest('batchId is required');
  res.json({ success: true, data: await zimmetImportService.commit(batchId, assignments, req.user) });
}));

/** DELETE /api/import/zimmet/batches/:id — discard staging. */
router.delete('/batches/:id', gate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await zimmetImportService.discard(req.params.id, req.user) });
}));

module.exports = router;
