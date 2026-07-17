/**
 * Server-side PDF for the handover form (Zimmet Belgesi).
 *
 * Hard rule: ONE page per document (or one page per item group when
 * documentType is "separate"). Never spill the return section — or any
 * other section — onto page 2. Comfortable spacing at scale 1; when
 * content is heavy, proportionally scale gaps/heights so everything
 * still fits on a single page.
 * Positioning only — never let PDFKit auto-paginate mid-form.
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
const M = 32; // side / top content margin
const GAP = 10; // base section gap at scale 1
const FOOTER_RESERVE = 30; // keep content clear of footer rule + text
const SCALE_MIN = 0.72;
const SCALE_MAX = 1;

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


function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Comfortable vertical sizes at scale s (gaps + block heights). */
function sizesAt(s, { empRows, assetCount, lineCount, showTerms, showReturn }) {
  const gap = GAP * s;
  const assigneeTitleH = 18 * s;
  const empRowH = 26 * s;
  const assigneeH = assigneeTitleH + empRows * empRowH + 8 * s;

  const headH = 16 * s;
  const sectionTitleBand = 22 * s;
  const rowHAssets = clamp(20 * s, 14, 20);
  const rowHLines = clamp(20 * s, 14, 20);
  const emptyFallbackRows = (!assetCount && !lineCount) ? 1 : 0;
  const assetsTableH = assetCount
    ? sectionTitleBand + headH + rowHAssets * assetCount + 2 * s
    : 0;
  const linesTableH = lineCount
    ? sectionTitleBand + headH + rowHLines * lineCount + 2 * s
    : 0;
  const emptyTableH = emptyFallbackRows
    ? sectionTitleBand + headH + rowHAssets * 1 + 2 * s
    : 0;

  const termsH = showTerms ? 70 * s : 0;
  const sigH = 72 * s;
  const sigGap = 10;
  const returnFieldsH = showReturn ? 44 * s : 0;
  const retSigH = showReturn ? 66 * s : 0;
  const afterHeaderGap = gap + 2 * s;

  const total =
    afterHeaderGap
    + assigneeH + gap
    + assetsTableH + (assetCount ? gap : 0)
    + linesTableH + (lineCount ? gap : 0)
    + emptyTableH + (emptyFallbackRows ? gap : 0)
    + (showTerms ? termsH + gap : 0)
    + sigH + gap
    + (showReturn ? returnFieldsH + gap + retSigH + gap : 0);

  return {
    s, gap, afterHeaderGap, assigneeTitleH, empRowH, assigneeH,
    headH, sectionTitleBand, rowHAssets, rowHLines,
    assetsTableH, linesTableH, emptyTableH, termsH, sigH, sigGap,
    returnFieldsH, retSigH, total,
  };
}

/** Binary-search largest s in [SCALE_MIN, SCALE_MAX] whose total fits available. */
function findScale(available, opts) {
  const at1 = sizesAt(SCALE_MAX, opts);
  if (at1.total <= available) return at1;
  let lo = SCALE_MIN;
  let hi = SCALE_MAX;
  let best = sizesAt(SCALE_MIN, opts);
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    const m = sizesAt(mid, opts);
    if (m.total <= available) {
      best = m;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
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

  // Block accidental second pages (only gi>0 separate groups may addPage).
  let allowNewPage = false;
  doc.on('pageAdded', () => {
    if (!allowNewPage) {
      // Swallow — content must stay on the current page unless allowed.
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

  const drawFooter = () => {
    at(doc, 'r', 6.5, C.muted, tpl.footerNote || L.generatedBy, M, pageH - 20, {
      width: contentW,
    });
    doc.moveTo(M, pageH - 28).lineTo(M + contentW, pageH - 28)
      .lineWidth(0.5).strokeColor(C.border).stroke();
  };

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

    /* ---------- HEADER (true two columns — no overlap) ---------- */
    const address = String(settings.companyAddress || '').trim();
    const leftW = contentW * 0.52;
    const rightW = contentW * 0.44;
    const rightX = pageW - M - rightW;
    // Meta box must sit fully inside the header (was overflowing → crooked look).
    const metaH = 28;
    const headerH = address ? 84 : 72;
    const metaY = headerH - metaH - 8;
    doc.rect(0, 0, pageW, headerH).fill(C.header);

    const logoSize = 28;
    let nameX = M;
    const nameW = leftW - (tpl.showLogo ? logoSize + 8 : 0);
    if (tpl.showLogo) {
      const logo = settings.companyLogo;
      doc.roundedRect(M, 14, logoSize, logoSize, 5).fill(C.metaBg);
      if (logo && /^data:image\/(png|jpe?g);base64,/.test(logo)) {
        try {
          doc.image(Buffer.from(logo.split(',')[1], 'base64'), M + 2, 16, { fit: [24, 24] });
        } catch {
          at(doc, 'b', 12, C.accent, (settings.companyName || 'A')[0].toUpperCase(), M, 20, {
            width: logoSize, align: 'center',
          });
        }
      } else {
        at(doc, 'b', 12, C.accent, (settings.companyName || 'A')[0].toUpperCase(), M, 20, {
          width: logoSize, align: 'center',
        });
      }
      nameX = M + logoSize + 8;
    }

    at(doc, 'b', 10, C.headerText, (settings.companyName || 'IT ASSET CONTROL PRO').toUpperCase(),
      nameX, 14, { width: nameW });
    if (address) {
      at(doc, 'r', 6.5, C.headerSoft, address, nameX, 28, { width: nameW });
      at(doc, 'r', 6, C.headerMuted, String(subtitle).toUpperCase(), nameX, 42, { width: nameW });
    } else {
      at(doc, 'r', 6.5, C.headerMuted, String(subtitle).toUpperCase(), nameX, 30, { width: nameW });
    }

    at(doc, 'b', 11, C.headerText, title, rightX, 14, { width: rightW, align: 'right' });
    if (L.titleAlt && L.titleAlt.toLowerCase() !== title.toLowerCase()) {
      at(doc, 'r', 7, C.headerMuted, `(${L.titleAlt})`, rightX, 28, { width: rightW, align: 'right' });
    }

    doc.roundedRect(rightX, metaY, rightW, metaH, 4).fill(C.metaBg);
    [[L.refId, ref, C.accent], [L.date, fmtDate(handover.transactionDate, lang), C.text]].forEach(([lab, val, col], i) => {
      const ry = metaY + 6 + i * 11;
      at(doc, 'r', 6, C.muted, lab, rightX + 8, ry, { width: rightW * 0.38 });
      at(doc, 'b', 7, col, val, rightX + rightW * 0.4, ry, { width: rightW * 0.55, align: 'right' });
    });

    /* ---------- SCALE so body + return fit on ONE page ---------- */
    const empFields = [[L.fullName, handover.employeeName]];
    if (tpl.showEmployeeId) {
      empFields.push([L.employeeId, employee ? String(employee.id).slice(0, 8).toUpperCase() : '']);
    }
    if (tpl.showDepartment) empFields.push([L.department, (employee && employee.department) || '—']);
    if (tpl.showTitle) empFields.push([L.position, (employee && employee.title) || '—']);
    const empRows = Math.ceil(empFields.length / 2);
    const showReturn = !!tpl.showReturnSection;
    const showTerms = !!tpl.showTerms;
    const available = pageH - FOOTER_RESERVE - headerH;
    const Sz = findScale(available, {
      empRows,
      assetCount: assets.length,
      lineCount: lineRows.length,
      showTerms,
      showReturn,
    });

    let y = headerH + Sz.afterHeaderGap;
    const { gap } = Sz;

    /* ---------- ASSIGNEE ---------- */
    doc.roundedRect(M, y, contentW, Sz.assigneeH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
    doc.roundedRect(M, y, contentW, Sz.assigneeTitleH, 4).fill(C.sectionBg);
    doc.rect(M, y + Sz.assigneeTitleH * 0.55, contentW, Sz.assigneeTitleH * 0.45).fill(C.sectionBg);
    at(doc, 'b', 7.5, C.accent, L.assignee.toUpperCase(), M + 8, y + 5 * Sz.s, { width: contentW - 16 });

    const half = (contentW - 20) / 2;
    empFields.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const fx = M + 10 + col * (half + 4);
      const fy = y + Sz.assigneeTitleH + 6 * Sz.s + row * Sz.empRowH;
      at(doc, 'r', 6.5, C.muted, f[0].toUpperCase(), fx, fy, { width: half });
      at(doc, 'b', 9.5, f[0] === L.employeeId ? C.accent : C.text, f[1] || '—', fx, fy + 11 * Sz.s, { width: half });
    });
    y += Sz.assigneeH + gap;

    /* ---------- TABLES (assets and/or mobile lines) ---------- */
    const padX = 8;
    const tableInner = contentW - padX * 2;

    const drawItemTable = (sectionTitle, rows, colDefs, rowH) => {
      if (!rows.length) return;
      const weightSum = colDefs.reduce((sum, c) => sum + c.weight, 0);
      let xCursor = 0;
      colDefs.forEach((c, i) => {
        if (i === colDefs.length - 1) c.w = tableInner - xCursor;
        else {
          c.w = Math.floor((c.weight / weightSum) * tableInner);
          xCursor += c.w;
        }
      });
      const tableH = Sz.sectionTitleBand + Sz.headH + rowH * rows.length + 2 * Sz.s;
      doc.roundedRect(M, y, contentW, tableH, 5).lineWidth(0.6).strokeColor(C.border).stroke();
      doc.roundedRect(M, y, contentW, 20 * Sz.s, 5).fill(C.sectionBg);
      doc.rect(M, y + 12 * Sz.s, contentW, 8 * Sz.s).fill(C.sectionBg);
      at(doc, 'b', 7.5, C.accent, sectionTitle.toUpperCase(), M + padX, y + 6 * Sz.s, { width: tableInner });
      const tableLeft = M + padX;
      let ty = y + Sz.sectionTitleBand;
      doc.rect(tableLeft, ty, tableInner, Sz.headH).fill(C.tableHead);
      let tx = tableLeft;
      colDefs.forEach((c) => {
        at(doc, 'b', 6.5, C.muted, c.t.toUpperCase(), tx + 2, ty + 4 * Sz.s, { width: c.w - 4 });
        tx += c.w;
      });
      ty += Sz.headH;
      rows.forEach((it, idx) => {
        if (idx % 2 === 1) doc.rect(tableLeft, ty, tableInner, rowH).fill(C.rowAlt);
        tx = tableLeft;
        colDefs.forEach((c) => {
          at(doc, 'r', 8, C.text, c.get(it, idx), tx + 2, ty + (rowH - 9) / 2, { width: c.w - 4 });
          tx += c.w;
        });
        ty += rowH;
        doc.moveTo(tableLeft, ty).lineTo(tableLeft + tableInner, ty)
          .lineWidth(0.35).strokeColor(C.rule).stroke();
      });
      y += tableH + gap;
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
      drawItemTable(L.assets, assets, cols, Sz.rowHAssets);
    }

    if (lineRows.length) {
      const lineCols = [
        { t: L.no, weight: 0.08, get: (it, idx) => idx + 1 },
        { t: L.colPhone, weight: 0.28, get: (it) => it.phoneNumber || it.model || '—' },
        { t: L.colOperator, weight: 0.18, get: (it) => it.operator || it.brand || '—' },
        { t: L.colPlan, weight: 0.22, get: (it) => it.plan || '—' },
        { t: L.colSim, weight: 0.24, get: (it) => it.simSerial || it.serialNumber || '—' },
      ];
      drawItemTable(L.lines, lineRows, lineCols, Sz.rowHLines);
    }

    if (!assets.length && !lineRows.length) {
      // Shouldn't happen, but keep layout stable.
      drawItemTable(L.assets, [{ brand: '—', model: '', category: '—', serialNumber: '—', conditionNote: '' }], [
        { t: L.no, weight: 0.1, get: () => 1 },
        { t: L.model, weight: 0.9, get: () => '—' },
      ], Sz.rowHAssets);
    }

    /* ---------- TERMS ---------- */
    if (showTerms) {
      const termsH = Sz.termsH;
      doc.roundedRect(M, y, contentW, termsH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      doc.roundedRect(M, y, contentW, 16 * Sz.s, 4).fill(C.sectionBg);
      doc.rect(M, y + 8 * Sz.s, contentW, 8 * Sz.s).fill(C.sectionBg);
      at(doc, 'b', 7, C.accent, L.terms.toUpperCase(), M + 8, y + 4 * Sz.s, { width: contentW - 16 });

      let termsText = L.termsBody;
      if (useCustomTerms) {
        termsText = String(settings.handoverTerms).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).join(' ');
      }
      doc.font('r').fontSize(7.5).fillColor(C.body)
        .text(termsText, M + 8, y + 20 * Sz.s, {
          width: contentW - 16,
          height: termsH - 28 * Sz.s,
          align: 'justify',
          lineGap: 1.5 * Sz.s,
          ellipsis: true,
        });
      y += termsH + gap;
    }

    /* ---------- SIGNATURES    /* ---------- SIGNATURES ---------- */
    const sigH = Sz.sigH;
    const sigGap = Sz.sigGap;
    const sigW = (contentW - sigGap) / 2;
    const drawSig = (x, top, role, name, opts = {}) => {
      const h = opts.h || sigH;
      const showDate = opts.showDate !== false;
      doc.roundedRect(x, y, sigW, h, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      at(doc, 'b', 6.5, C.accent, top.toUpperCase(), x + 8, y + 7 * Sz.s, { width: sigW - 16 });
      if (role) at(doc, 'r', 6, C.muted, role, x + 8, y + 17 * Sz.s, { width: sigW - 16 });
      const lineY = y + (opts.lineY != null ? opts.lineY : 42 * Sz.s);
      doc.moveTo(x + 8, lineY).lineTo(x + sigW - 8, lineY)
        .dash(2, { space: 2 }).lineWidth(0.6).strokeColor(C.border).stroke().undash();
      at(doc, 'b', 8.5, C.text, name || ' ', x + 8, lineY + 5 * Sz.s, { width: showDate ? sigW * 0.55 : sigW - 16 });
      at(doc, 'r', 6, C.muted, (opts.sub || L.signature).toUpperCase(), x + 8, lineY + 16 * Sz.s, {
        width: showDate ? sigW * 0.5 : sigW - 16,
      });
      if (showDate) {
        at(doc, 'r', 6.5, C.muted, `${L.date}: ______`, x + sigW * 0.5, lineY + 9 * Sz.s, {
          width: sigW * 0.45, align: 'right',
        });
      }
    };
    drawSig(M, issuedLabel, L.issuedByRole, deliveredBy || 'IT');
    drawSig(M + sigW + sigGap, receivedLabel, L.receivedByRole, handover.employeeName);
    y += sigH + gap;

    /* ---------- RETURN (always same page — never addPage) ---------- */
    if (showReturn) {
      const fieldsH = Sz.returnFieldsH;
      doc.roundedRect(M, y, contentW, fieldsH, 4).lineWidth(0.6).strokeColor(C.border).stroke();
      at(doc, 'b', 7, C.accent, L.returnSection.toUpperCase(), M + 8, y + 6 * Sz.s, { width: contentW - 16 });
      doc.font('r').fontSize(6.5).fillColor(C.body)
        .text(L.returnBody, M + 8, y + 17 * Sz.s, {
          width: contentW - 16,
          height: 12 * Sz.s,
          ellipsis: true,
          lineGap: 0.5,
        });
      const third = (contentW - 24) / 3;
      [L.returnDate, L.returnCondition, L.missingItems].forEach((lab, i) => {
        const fx = M + 8 + i * (third + 4);
        at(doc, 'r', 6, C.muted, lab.toUpperCase(), fx, y + 30 * Sz.s, { width: third });
        doc.moveTo(fx, y + 40 * Sz.s).lineTo(fx + third - 8, y + 40 * Sz.s)
          .dash(1.5, { space: 1.5 }).strokeColor(C.border).stroke().undash();
      });
      y += fieldsH + gap;

      const retSigH = Sz.retSigH;
      const savedY = y;
      drawSig(M, L.returnedBy, '', handover.employeeName, {
        h: retSigH, lineY: 40 * Sz.s, sub: L.signature, showDate: false,
      });
      y = savedY;
      drawSig(M + sigW + sigGap, L.receivedBackBy, '', ' ', {
        h: retSigH, lineY: 40 * Sz.s, sub: L.nameAndSignature || L.signature, showDate: false,
      });
      y = savedY + retSigH + gap;
    }

    /* ---------- FOOTER ---------- */
    drawFooter();
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
