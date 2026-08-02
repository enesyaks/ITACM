/**
 * Branded inventory report PDF for the AI assistant (build_report).
 * Uses PDFKit + DejaVu (same stack as handover forms).
 */
const PDFDocument = require('pdfkit');
const path = require('path');
const { resolveHandoverDesign } = require('./defaults');

const FONT_DIR = path.dirname(require.resolve('dejavu-fonts-ttf/package.json'));
const F = {
  regular: path.join(FONT_DIR, 'ttf', 'DejaVuSans.ttf'),
  bold: path.join(FONT_DIR, 'ttf', 'DejaVuSans-Bold.ttf'),
  oblique: path.join(FONT_DIR, 'ttf', 'DejaVuSans-Oblique.ttf'),
};

const A4 = { w: 595.28, h: 841.89 };
const M = 40;
const FOOTER_H = 36;
const PDF_ROW_CAP = 60;
const CHART_COLORS = ['#3525cd', '#4f46e5', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf'];

const LABELS = {
  generated: { en: 'Generated', tr: 'Oluşturulma' },
  filters: { en: 'Filters', tr: 'Filtreler' },
  pageOf: { en: 'Page {page} of {pages}', tr: 'Sayfa {page} / {pages}' },
  chart: { en: 'Distribution', tr: 'Dağılım' },
  data: { en: 'Data', tr: 'Veri' },
  truncated: {
    en: 'Showing {shown} of {total} rows in this PDF.',
    tr: 'Bu PDF\'de {total} satırdan {shown} tanesi gösteriliyor.',
  },
  liveNote: {
    en: 'Live inventory data · Confidential · ITACM',
    tr: 'Canlı envanter verisi · Gizli · ITACM',
  },
  noData: { en: 'No rows to display.', tr: 'Gösterilecek satır yok.' },
  records: { en: '{n} records', tr: '{n} kayıt' },
};

function L(lang, key, vars) {
  const row = LABELS[key];
  const code = String(lang || 'en').slice(0, 2).toLowerCase() === 'tr' ? 'tr' : 'en';
  let raw = (row && (row[code] || row.en)) || key;
  if (vars) raw = String(raw).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m));
  return raw;
}

function at(doc, font, size, color, text, x, y, opts = {}) {
  doc.font(font).fontSize(size).fillColor(color);
  doc.text(String(text ?? ''), x, y, {
    lineBreak: false,
    ellipsis: true,
    ...opts,
    height: opts.height != null ? opts.height : size + 2,
  });
}

function fmtStamp(d, lang) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  if (Number.isNaN(dt.getTime())) return '—';
  const locale = lang === 'tr' ? 'tr-TR' : 'en-GB';
  return dt.toLocaleString(locale, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function slugPdfFilename(base) {
  const TR = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  const slug = String(base || '')
    .toLowerCase()
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/[çğıöşü]/g, (c) => TR[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'itacm-report'}.pdf`;
}

function drawBarChart(doc, items, x, y, w, h, C) {
  const list = (items || []).slice(0, 12);
  if (!list.length) return y;
  const max = Math.max(1, ...list.map((it) => Number(it.value) || 0));
  const rowH = Math.min(22, Math.floor(h / Math.max(list.length, 1)));
  const labelW = Math.min(140, Math.floor(w * 0.32));
  const valW = 48;
  const barW = w - labelW - valW - 12;
  let cy = y;
  list.forEach((it, i) => {
    const v = Number(it.value) || 0;
    const bw = Math.max(2, Math.round((v / max) * barW));
    at(doc, 'r', 8, C.text, it.label || '—', x, cy + 4, { width: labelW - 4 });
    doc.roundedRect(x + labelW, cy + 3, barW, rowH - 6, 3).fill('#eef0f8');
    doc.roundedRect(x + labelW, cy + 3, bw, rowH - 6, 3).fill(CHART_COLORS[i % CHART_COLORS.length]);
    const pct = it.pct != null ? ` (${it.pct}%)` : '';
    at(doc, 'b', 8, C.text, `${v}${pct}`, x + labelW + barW + 6, cy + 4, { width: valW });
    cy += rowH;
  });
  return cy + 4;
}

function drawPieChart(doc, items, x, y, size, C) {
  const list = (items || []).slice(0, 10);
  if (!list.length) return y;
  const total = list.reduce((s, it) => s + (Number(it.value) || 0), 0) || 1;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.38;
  const ir = r * 0.55;
  let angle = -Math.PI / 2;
  list.forEach((it, i) => {
    const frac = Math.max(0, (Number(it.value) || 0) / total);
    const sweep = frac * Math.PI * 2;
    if (sweep < 0.0001) return;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a1);
    const yi0 = cy + ir * Math.sin(a1);
    const xi1 = cx + ir * Math.cos(a0);
    const yi1 = cy + ir * Math.sin(a0);
    const large = sweep > Math.PI ? 1 : 0;
    doc.save();
    doc.path(`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`)
      .fill(CHART_COLORS[i % CHART_COLORS.length]);
    doc.restore();
  });

  const legendX = x + size + 12;
  let ly = y + 8;
  list.forEach((it, i) => {
    doc.roundedRect(legendX, ly + 2, 8, 8, 2).fill(CHART_COLORS[i % CHART_COLORS.length]);
    const pct = it.pct != null ? ` · ${it.pct}%` : '';
    at(doc, 'r', 8, C.text, `${it.label || '—'}  ${it.value}${pct}`, legendX + 14, ly, {
      width: 200,
    });
    ly += 16;
  });
  return Math.max(y + size, ly) + 8;
}

/**
 * @returns {Promise<Buffer>}
 */
function buildReportPdf({
  lang = 'en',
  title,
  companyName,
  companyLogo,
  companyAddress,
  filtersLabel,
  chart,
  cols,
  rows,
  totalRows,
  truncated = false,
  generatedAt,
} = {}) {
  const code = String(lang || 'en').slice(0, 2).toLowerCase() === 'tr' ? 'tr' : 'en';
  const C = resolveHandoverDesign('terminal').pdf;
  const pageW = A4.w;
  const pageH = A4.h;
  const contentW = pageW - M * 2;
  const brand = String(companyName || 'IT Asset Control Pro').trim() || 'IT Asset Control Pro';
  const reportTitle = String(title || L(code, 'data')).trim() || L(code, 'data');
  const allRows = Array.isArray(rows) ? rows : [];
  const preview = allRows.slice(0, PDF_ROW_CAP);
  const knownTotal = Math.max(allRows.length, Number(totalRows) || 0);
  const isTrunc = !!truncated || preview.length < knownTotal;
  const colDefs = (Array.isArray(cols) && cols.length)
    ? cols.map((t) => String(t))
    : [];
  const stamp = fmtStamp(generatedAt || new Date(), code);

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      autoFirstPage: true,
      bufferPages: true,
    });
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.registerFont('r', F.regular).registerFont('b', F.bold).registerFont('i', F.oblique);

    const headerH = companyAddress ? 88 : 76;
    const drawHeader = () => {
      doc.rect(0, 0, pageW, headerH).fill(C.header);
      const logoSize = 30;
      let nameX = M;
      if (companyLogo && /^data:image\/(png|jpe?g);base64,/.test(companyLogo)) {
        doc.roundedRect(M, 16, logoSize, logoSize, 5).fill(C.metaBg);
        try {
          doc.image(Buffer.from(companyLogo.split(',')[1], 'base64'), M + 3, 19, { fit: [24, 24] });
        } catch {
          at(doc, 'b', 12, C.accent, brand[0].toUpperCase(), M, 22, { width: logoSize, align: 'center' });
        }
        nameX = M + logoSize + 10;
      } else {
        doc.roundedRect(M, 16, logoSize, logoSize, 5).fill(C.metaBg);
        at(doc, 'b', 12, C.accent, brand[0].toUpperCase(), M, 22, { width: logoSize, align: 'center' });
        nameX = M + logoSize + 10;
      }
      at(doc, 'b', 11, C.headerText, brand.toUpperCase(), nameX, 18, { width: contentW * 0.55 });
      if (companyAddress) {
        at(doc, 'r', 7, C.headerSoft, String(companyAddress), nameX, 34, { width: contentW * 0.55 });
        at(doc, 'r', 7, C.headerMuted, 'ITACM REPORT', nameX, 48, { width: contentW * 0.55 });
      } else {
        at(doc, 'r', 7, C.headerMuted, 'ITACM REPORT', nameX, 36, { width: contentW * 0.55 });
      }
      at(doc, 'b', 12, C.headerText, reportTitle, M, headerH - 28, { width: contentW });
    };

    const ensureSpace = (need) => {
      if (doc.y + need > pageH - FOOTER_H - 8) {
        doc.addPage();
        drawHeader();
        doc.y = headerH + 16;
      }
    };

    drawHeader();
    let y = headerH + 16;

    doc.roundedRect(M, y, contentW, 36, 5).fill('#f5f2ff');
    at(doc, 'r', 8, C.muted, L(code, 'generated').toUpperCase(), M + 12, y + 8, { width: 100 });
    at(doc, 'b', 9, C.text, stamp, M + 110, y + 7, { width: 200 });
    at(doc, 'r', 8, C.muted, L(code, 'records', { n: knownTotal }), M + contentW - 120, y + 8, {
      width: 108,
      align: 'right',
    });
    y += 44;

    if (filtersLabel && String(filtersLabel).trim() && String(filtersLabel) !== 'none' && String(filtersLabel) !== 'yok') {
      ensureSpace(40);
      at(doc, 'b', 8, C.accent, L(code, 'filters').toUpperCase(), M, y, { width: contentW });
      y += 14;
      doc.font('r').fontSize(9).fillColor(C.body);
      const filterText = String(filtersLabel);
      const fh = doc.heightOfString(filterText, { width: contentW });
      doc.text(filterText, M, y, { width: contentW, lineGap: 2 });
      y += Math.max(14, fh) + 10;
      doc.y = y;
    } else {
      doc.y = y;
    }

    const chartItems = chart && Array.isArray(chart.items) ? chart.items : [];
    if (chartItems.length) {
      ensureSpace(160);
      y = doc.y;
      at(doc, 'b', 9, C.accent, L(code, 'chart').toUpperCase(), M, y, { width: contentW });
      y += 16;
      doc.roundedRect(M, y, contentW, chart.type === 'pie' ? 160 : Math.min(280, 28 + chartItems.slice(0, 12).length * 22), 6)
        .lineWidth(0.6).strokeColor(C.border).stroke();
      const innerY = y + 12;
      if (chart.type === 'pie') {
        drawPieChart(doc, chartItems, M + 16, innerY, 130, C);
        y += 168;
      } else {
        const endY = drawBarChart(doc, chartItems, M + 14, innerY, contentW - 28, 250, C);
        y = Math.max(endY, y + 40) + 8;
      }
      doc.y = y + 8;
    }

    ensureSpace(60);
    y = doc.y;
    at(doc, 'b', 9, C.accent, L(code, 'data').toUpperCase(), M, y, { width: contentW });
    y += 14;

    if (!preview.length || !colDefs.length) {
      at(doc, 'i', 9, C.muted, L(code, 'noData'), M, y, { width: contentW });
      doc.y = y + 20;
    } else {
      const nCols = colDefs.length;
      const weights = colDefs.map((_, i) => (i === 0 ? 1.4 : 1));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      const colWs = weights.map((w, i) => {
        if (i === nCols - 1) return 0;
        return Math.floor((w / weightSum) * contentW);
      });
      colWs[nCols - 1] = contentW - colWs.slice(0, -1).reduce((a, b) => a + b, 0);
      const rowH = 18;
      const headH = 20;

      const drawTableHead = (ty) => {
        doc.rect(M, ty, contentW, headH).fill(C.tableHead);
        let tx = M;
        colDefs.forEach((label, i) => {
          at(doc, 'b', 7, C.muted, String(label).toUpperCase(), tx + 4, ty + 5, { width: colWs[i] - 8 });
          tx += colWs[i];
        });
        return ty + headH;
      };

      y = drawTableHead(y);
      preview.forEach((row, idx) => {
        if (y + rowH > pageH - FOOTER_H - 8) {
          doc.addPage();
          drawHeader();
          y = headerH + 16;
          y = drawTableHead(y);
        }
        if (idx % 2 === 1) doc.rect(M, y, contentW, rowH).fill(C.rowAlt);
        let tx = M;
        const cells = Array.isArray(row) ? row : [row];
        for (let i = 0; i < nCols; i += 1) {
          at(doc, 'r', 7.5, C.text, cells[i] != null ? String(cells[i]) : '', tx + 4, y + 4, {
            width: colWs[i] - 8,
          });
          tx += colWs[i];
        }
        y += rowH;
      });
      doc.y = y;

      if (isTrunc) {
        y += 10;
        if (y + 20 > pageH - FOOTER_H - 8) {
          doc.addPage();
          drawHeader();
          y = headerH + 16;
        }
        at(doc, 'i', 8, C.muted, L(code, 'truncated', { shown: preview.length, total: knownTotal }), M, y, {
          width: contentW,
        });
        doc.y = y + 14;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      doc.moveTo(M, pageH - 28).lineTo(M + contentW, pageH - 28)
        .lineWidth(0.5).strokeColor(C.border).stroke();
      at(doc, 'r', 7, C.muted, L(code, 'liveNote'), M, pageH - 20, { width: contentW * 0.62 });
      at(doc, 'r', 7, C.muted, L(code, 'pageOf', { page: i + 1, pages: range.count }), M + contentW * 0.62, pageH - 20, {
        width: contentW * 0.38,
        align: 'right',
      });
    }

    doc.end();
  });
}

module.exports = {
  buildReportPdf,
  slugPdfFilename,
  PDF_ROW_CAP,
  LABELS,
};
