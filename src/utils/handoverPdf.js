/**
 * Server-side PDF for the handover form (Zimmet Belgesi).
 *
 * Compact A4 single-page layout (one page per document group). Absolute
 * positioning only — never let PDFKit auto-paginate mid-form.
 */
const PDFDocument = require('pdfkit');
const path = require('path');
const { DEFAULT_HANDOVER_TEMPLATE, DEFAULT_HANDOVER_TERMS, resolveHandoverDesign } = require('./defaults');
const { handoverLabels } = require('./handoverLabels');

const FONT_DIR = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
const F = {
  regular: path.join(FONT_DIR, 'ttf', 'DejaVuSans.ttf'),
  bold: path.join(FONT_DIR, 'ttf', 'DejaVuSans-Bold.ttf'),
  oblique: path.join(FONT_DIR, 'ttf', 'DejaVuSans-Oblique.ttf'),
};

const A4 = { w: 595.28, h: 841.89 };
const M = 28; // side / top content margin

const fmtDate = (v, lang) => {
  const d = v && v.toDate ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const locale = ({ en: 'en-GB', tr: 'tr-TR', de: 'de-DE' })[lang] || 'en-GB';
  return d.toLocaleDateString(locale);
};

/** Absolute text that never triggers PDFKit's auto page-break. */
function at(doc, font, size, color, text, x, y, opts = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ''), x, y, {
    lineBreak: false,
    ellipsis: true,
    ...opts,
    // height 1 line unless caller sets height for wrapped blocks
    height: opts.height != null ? opts.height : size + 2,
  });
}

function buildHandoverPdf(stream, { handover, employee, settings, deliveredBy, lang: langOverride, templateId }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: true,
    bufferPages: true,
  });
  doc.pipe(stream);
  doc.registerFont('r', F.regular).registerFont('b', F.bold).registerFont('i', F.oblique);

  // Block accidental second pages from text overflow.
  let allowNewPage = false;
  doc.on('pageAdded', () => {
    if (!allowNewPage) {
      // Swallow — content must stay on the current page.
    }
  });

  const lang = langOverride || settings.language || 'en';
  const L = handoverLabels(lang);
  const pageW = A4.w;
  const pageH = A4.h;
  const contentW = pageW - M * 2;
  const items = handover.items || [];
  const groups = handover.documentType === 'separate' ? items.map((i) => [i]) : [items];
  const formNo = 'HF-' + String(handover.id || '').slice(0, 8).toUpperCase();
  const tplList = (settings.handoverTemplates && settings.handoverTemplates.length)
    ? settings.handoverTemplates
    : [{ ...DEFAULT_HANDOVER_TEMPLATE, ...(settings.handoverTemplate || {}), id: 'default', name: 'Standard' }];
  const wantId = templateId || handover.templateId;
  const tpl = { ...DEFAULT_HANDOVER_TEMPLATE, ...(tplList.find((t) => t.id === wantId) || tplList[0]) };
  const C = resolveHandoverDesign(tpl.design).pdf;

  const useCustomTerms = settings.handoverTerms
    && String(settings.handoverTerms).trim() !== String(DEFAULT_HANDOVER_TERMS).trim();

  // Always prefer localized labels over stored English template strings.
  const issuedLabel = L.issuedBy;
  const receivedLabel = L.receivedBy;
  const title = L.title;
  const subtitle = (tpl.subtitle && tpl.subtitle !== DEFAULT_HANDOVER_TEMPLATE.subtitle)
    ? tpl.subtitle
    : L.subtitle;

  groups.forEach((group, gi) => {
    if (gi > 0) {
      allowNewPage = true;
      doc.addPage();
      allowNewPage = false;
    }
    const ref = `${formNo}${groups.length > 1 ? `-${gi + 1}` : ''}`;
    const assetRows = group.filter((it) => it.kind !== 'line');
    const lineRows = group.filter((it) => it.kind === 'line');
    // Legacy receipts have no kind — treat as assets.
    const assets = assetRows.length || lineRows.length ? assetRows : group;
    const nItems = Math.max(assets.length + lineRows.length, 1);

    /* ---------- HEADER ---------- */
    const address = String(settings.companyAddress || '').trim();
    const headerH = address ? 72 : 58;
    doc.rect(0, 0, pageW, headerH).fill(C.header);

    const logoSize = 28;
    let nameX = M;
    if (tpl.showLogo) {
      const logo = settings.companyLogo;
      doc.roundedRect(M, 12, logoSize, logoSize, 5).fill(C.metaBg);
      if (logo && /^data:image\/(png|jpe?g);base64,/.test(logo)) {
        try {
          doc.image(Buffer.from(logo.split(',')[1], 'base64'), M + 2, 14, { fit: [24, 24] });
        } catch {
          at(doc, 'b', 12, C.accent, (settings.companyName || 'A')[0].toUpperCase(), M, 18, {
            width: logoSize, align: 'center',
          });
        }
      } else {
        at(doc, 'b', 12, C.accent, (settings.companyName || 'A')[0].toUpperCase(), M, 18, {
          width: logoSize, align: 'center',
        });
      }
      nameX = M + logoSize + 8;
    }

    at(doc, 'b', 10, C.headerText, (settings.companyName || 'IT ASSET CONTROL PRO').toUpperCase(),
      nameX, 12, { width: contentW * 0.48 });
    if (address) {
      at(doc, 'r', 6, C.headerSoft, address, nameX, 24, { width: contentW * 0.48 });
      at(doc, 'r', 5.5, C.headerMuted, String(subtitle).toUpperCase(), nameX, 34, { width: contentW * 0.48 });
    } else {
      at(doc, 'r', 6, C.headerMuted, String(subtitle).toUpperCase(), nameX, 26, { width: contentW * 0.48 });
    }

    at(doc, 'b', 11, C.headerText, title, M, 12, { width: contentW, align: 'right' });
    if (L.titleAlt && L.titleAlt.toLowerCase() !== title.toLowerCase()) {
      at(doc, 'r', 6.5, C.headerMuted, `(${L.titleAlt})`, M, 24, { width: contentW, align: 'right' });
    }

    const metaW = 128;
    const metaX = pageW - M - metaW;
    const metaY = address ? 40 : 36;
    doc.roundedRect(metaX, metaY, metaW, 26, 4).fill(C.metaBg);
    [[L.refId, ref, C.accent], [L.date, fmtDate(handover.transactionDate, lang), C.text]].forEach(([lab, val, col], i) => {
      const ry = metaY + 5 + i * 11;
      at(doc, 'r', 6, C.muted, lab, metaX + 6, ry, { width: 46 });
      at(doc, 'b', 6.5, col, val, metaX + 50, ry, { width: metaW - 56, align: 'right' });
    });

    let y = headerH + 8;

    /* ---------- ASSIGNEE ---------- */
    const empFields = [[L.fullName, handover.employeeName]];
    if (tpl.showEmployeeId) {
      empFields.push([L.employeeId, employee ? String(employee.id).slice(0, 8).toUpperCase() : '']);
    }
    if (tpl.showDepartment) empFields.push([L.department, (employee && employee.department) || '—']);
    if (tpl.showTitle) empFields.push([L.position, (employee && employee.title) || '—']);
    const empRows = Math.ceil(empFields.length / 2);
    const assigneeH = 18 + empRows * 22 + 6;

    doc.roundedRect(M, y, contentW, assigneeH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
    doc.roundedRect(M, y, contentW, 16, 4).fill(C.sectionBg);
    doc.rect(M, y + 8, contentW, 8).fill(C.sectionBg);
    at(doc, 'b', 7, C.accent, L.assignee.toUpperCase(), M + 7, y + 4, { width: contentW - 14 });

    const half = (contentW - 18) / 2;
    empFields.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const fx = M + 9 + col * (half + 4);
      const fy = y + 20 + row * 22;
      at(doc, 'r', 5.5, C.muted, f[0].toUpperCase(), fx, fy, { width: half });
      at(doc, 'b', 8.5, f[0] === L.employeeId ? C.accent : C.text, f[1] || '—', fx, fy + 9, { width: half });
    });
    y += assigneeH + 6;

    /* ---------- TABLES (assets and/or mobile lines) ---------- */
    const padX = 8;
    const tableInner = contentW - padX * 2;
    const showReturn = !!tpl.showReturnSection;
    const reserveBottom = (tpl.showTerms ? 58 : 0) + 70 + 18 + (showReturn ? 118 : 0)
      + (lineRows.length && assets.length ? 28 : 0);
    const tableBudget = Math.max(50, pageH - y - reserveBottom - M);
    const sectionCount = (assets.length ? 1 : 0) + (lineRows.length ? 1 : 0) || 1;
    const perSectionBudget = Math.floor(tableBudget / sectionCount);
    const headH = 15;

    const drawItemTable = (title, rows, colDefs) => {
      if (!rows.length) return;
      const weightSum = colDefs.reduce((s, c) => s + c.weight, 0);
      let xCursor = 0;
      colDefs.forEach((c, i) => {
        if (i === colDefs.length - 1) c.w = tableInner - xCursor;
        else {
          c.w = Math.floor((c.weight / weightSum) * tableInner);
          xCursor += c.w;
        }
      });
      const rowH = Math.max(12, Math.min(16, Math.floor((perSectionBudget - 20 - headH) / Math.max(rows.length, 1))));
      const tableH = 20 + headH + rowH * rows.length + 2;
      doc.roundedRect(M, y, contentW, tableH, 5).lineWidth(0.6).strokeColor(C.border).stroke();
      doc.roundedRect(M, y, contentW, 18, 5).fill(C.sectionBg);
      doc.rect(M, y + 10, contentW, 8).fill(C.sectionBg);
      at(doc, 'b', 7.5, C.accent, title.toUpperCase(), M + padX, y + 5, { width: tableInner });
      const tableLeft = M + padX;
      let ty = y + 20;
      doc.rect(tableLeft, ty, tableInner, headH).fill(C.tableHead);
      let tx = tableLeft;
      colDefs.forEach((c) => {
        at(doc, 'b', 6, C.muted, c.t.toUpperCase(), tx + 2, ty + 4, { width: c.w - 4 });
        tx += c.w;
      });
      ty += headH;
      rows.forEach((it, idx) => {
        if (idx % 2 === 1) doc.rect(tableLeft, ty, tableInner, rowH).fill(C.rowAlt);
        tx = tableLeft;
        colDefs.forEach((c) => {
          at(doc, 'r', 7.5, C.text, c.get(it, idx), tx + 2, ty + (rowH - 8) / 2, { width: c.w - 4 });
          tx += c.w;
        });
        ty += rowH;
        doc.moveTo(tableLeft, ty).lineTo(tableLeft + tableInner, ty)
          .lineWidth(0.35).strokeColor(C.rule).stroke();
      });
      y += tableH + 6;
    };

    if (assets.length) {
      const cols = [{ t: L.no, weight: 0.06, get: (it, idx) => idx + 1 }];
      if (tpl.colCategory) cols.push({ t: L.category, weight: 0.14, get: (it) => it.category || '—' });
      cols.push({
        t: L.model,
        weight: (tpl.colMac && tpl.colCondition) ? 0.22 : (tpl.colMac || tpl.colCondition) ? 0.28 : 0.36,
        get: (it) => `${it.brand || ''} ${it.model || ''}`.trim(),
      });
      if (tpl.colSerial) cols.push({ t: L.serial, weight: 0.20, get: (it) => it.serialNumber || '—' });
      if (tpl.colMac) cols.push({ t: L.mac, weight: 0.18, get: (it) => it.macAddress || 'N/A' });
      if (tpl.colCondition) cols.push({ t: L.condition, weight: 0.20, get: (it) => it.conditionNote || 'New' });
      drawItemTable(L.assets, assets, cols);
    }

    if (lineRows.length) {
      const lineCols = [
        { t: L.no, weight: 0.08, get: (it, idx) => idx + 1 },
        { t: L.colPhone, weight: 0.28, get: (it) => it.phoneNumber || it.model || '—' },
        { t: L.colOperator, weight: 0.18, get: (it) => it.operator || it.brand || '—' },
        { t: L.colPlan, weight: 0.22, get: (it) => it.plan || '—' },
        { t: L.colSim, weight: 0.24, get: (it) => it.simSerial || it.serialNumber || '—' },
      ];
      drawItemTable(L.lines, lineRows, lineCols);
    }

    if (!assets.length && !lineRows.length) {
      // Shouldn't happen, but keep layout stable.
      drawItemTable(L.assets, [{ brand: '—', model: '', category: '—', serialNumber: '—', conditionNote: '' }], [
        { t: L.no, weight: 0.1, get: () => 1 },
        { t: L.model, weight: 0.9, get: () => '—' },
      ]);
    }

    /* ---------- TERMS (capped height) ---------- */
    if (tpl.showTerms) {
      const termsH = 56;
      doc.roundedRect(M, y, contentW, termsH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      doc.roundedRect(M, y, contentW, 14, 4).fill(C.sectionBg);
      doc.rect(M, y + 7, contentW, 7).fill(C.sectionBg);
      at(doc, 'b', 6.5, C.accent, L.terms.toUpperCase(), M + 7, y + 3, { width: contentW - 14 });

      let termsText = L.termsBody;
      if (useCustomTerms) {
        termsText = String(settings.handoverTerms).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).join(' ');
      }
      doc.font('r').fontSize(6.5).fillColor(C.body)
        .text(termsText, M + 7, y + 17, {
          width: contentW - 14,
          height: termsH - 22,
          align: 'justify',
          lineGap: 0.5,
          ellipsis: true,
        });
      y += termsH + 6;
    }

    /* ---------- SIGNATURES ---------- */
    const sigH = 62;
    const sigGap = 8;
    const sigW = (contentW - sigGap) / 2;
    const drawSig = (x, top, role, name, opts = {}) => {
      const h = opts.h || sigH;
      const showDate = opts.showDate !== false;
      doc.roundedRect(x, y, sigW, h, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      at(doc, 'b', 6, C.accent, top.toUpperCase(), x + 7, y + 6, { width: sigW - 14 });
      if (role) at(doc, 'r', 5.5, C.muted, role, x + 7, y + 15, { width: sigW - 14 });
      // Room for handwritten signature between label and dashed line
      const lineY = y + (opts.lineY || 36);
      doc.moveTo(x + 7, lineY).lineTo(x + sigW - 7, lineY)
        .dash(2, { space: 2 }).lineWidth(0.6).strokeColor(C.border).stroke().undash();
      at(doc, 'b', 8, C.text, name || ' ', x + 7, lineY + 4, { width: showDate ? sigW * 0.55 : sigW - 14 });
      at(doc, 'r', 5.5, C.muted, (opts.sub || L.signature).toUpperCase(), x + 7, lineY + 14, {
        width: showDate ? sigW * 0.5 : sigW - 14,
      });
      if (showDate) {
        at(doc, 'r', 6, C.muted, `${L.date}: ______`, x + sigW * 0.5, lineY + 8, {
          width: sigW * 0.45, align: 'right',
        });
      }
    };
    drawSig(M, issuedLabel, L.issuedByRole, deliveredBy || 'IT');
    drawSig(M + sigW + sigGap, receivedLabel, L.receivedByRole, handover.employeeName);
    y += sigH + 6;

    /* ---------- RETURN (fields + signature boxes with writing room) ---------- */
    if (showReturn && y + 118 < pageH - 28) {
      const fieldsH = 40;
      doc.roundedRect(M, y, contentW, fieldsH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      at(doc, 'b', 6.5, C.accent, L.returnSection.toUpperCase(), M + 7, y + 5, { width: contentW - 14 });
      doc.font('r').fontSize(6).fillColor(C.body)
        .text(L.returnBody, M + 7, y + 15, { width: contentW - 14, height: 10, ellipsis: true, lineGap: 0 });
      const third = (contentW - 22) / 3;
      [L.returnDate, L.returnCondition, L.missingItems].forEach((lab, i) => {
        const fx = M + 7 + i * (third + 4);
        at(doc, 'r', 5.5, C.muted, lab.toUpperCase(), fx, y + 26, { width: third });
        doc.moveTo(fx, y + 36).lineTo(fx + third - 8, y + 36)
          .dash(1.5, { space: 1.5 }).strokeColor(C.border).stroke().undash();
      });
      y += fieldsH + 6;

      const retSigH = 66;
      const savedY = y;
      drawSig(M, L.returnedBy, '', handover.employeeName, {
        h: retSigH, lineY: 38, sub: L.signature, showDate: false,
      });
      y = savedY;
      drawSig(M + sigW + sigGap, L.receivedBackBy, '', ' ', {
        h: retSigH, lineY: 38, sub: L.nameAndSignature || L.signature, showDate: false,
      });
      y = savedY + retSigH + 4;
    }

    /* ---------- FOOTER (always at bottom of the A4 page) ---------- */
    at(doc, 'r', 6.5, C.muted, tpl.footerNote || L.generatedBy, M, pageH - 18, {
      width: contentW,
    });
    doc.moveTo(M, pageH - 26).lineTo(M + contentW, pageH - 26)
      .lineWidth(0.5).strokeColor(C.border).stroke();
  });

  doc.end();
}

function renderHandoverPdfBuffer(opts) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new (require('stream').PassThrough)();
    sink.on('data', (c) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try {
      buildHandoverPdf(sink, opts);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildHandoverPdf, renderHandoverPdfBuffer };
