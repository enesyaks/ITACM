/**
 * Builds the handover PDF for a receipt and (best-effort) stores it in the
 * per-employee document archive. Shared by the /pdf endpoint and the
 * auto-archive step that runs after every handover.
 */
const { renderHandoverPdfBuffer } = require('./handoverPdf');

async function buildReceiptPdf(handoverId, currentUserName, lang, templateIdOverride) {
  const { handoverService, employeeService, settingsService } = require('../services');
  const handover = await handoverService.getHandover(handoverId);
  const settings = await settingsService.getSettings();
  let employee = null;
  try {
    employee = await employeeService.getEmployee(handover.employeeId);
  } catch { /* render without dept/title */ }

  // "Delivered By" is the ORIGINAL assigner; only when that account is
  // disabled/deleted does the current user's name appear instead.
  const deliveredBy = (handover.itUserName && handover.itUserActive !== false)
    ? handover.itUserName
    : (currentUserName || handover.itUserName || 'IT Department');

  const formNo = 'HF-' + String(handover.id).slice(0, 8).toUpperCase();
  const templateId = templateIdOverride || handover.templateId || null;
  const buffer = await renderHandoverPdfBuffer({
    handover, employee, settings, deliveredBy,
    lang: lang || settings.language || 'en',
    templateId,
  });
  return { handover, buffer, formNo, filename: `zimmet-${formNo}.pdf` };
}

/** Store the generated receipt PDF against the employee (never throws). */
async function archiveReceipt(handoverId, itUser) {
  try {
    const { documentService } = require('../services');
    const { handover, buffer, filename } = await buildReceiptPdf(handoverId);
    await documentService.saveDocument({
      handoverId: handover.id,
      employeeId: handover.employeeId,
      employeeName: handover.employeeName,
      kind: 'generated',
      filename,
      mime: 'application/pdf',
      buffer,
      uploadedBy: itUser && itUser.uid,
      uploadedByName: itUser && (itUser.username || itUser.email),
    });
  } catch (err) {
    // Archiving must never break the handover itself.
    console.error('[archive] failed to store handover PDF:', err.message);
  }
}

module.exports = { buildReceiptPdf, archiveReceipt };
