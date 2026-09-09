/**
 * Advanced report as a real .xlsx workbook.
 *
 * The graphical part is done with Excel's OWN conditional-formatting data bars
 * rather than a pasted picture. A picture of a chart cannot be re-sliced, does
 * not respond to a filter and goes blurry when someone zooms in; in-cell bars
 * read at a glance AND leave every number live, so the reader can sort, filter
 * or build their own chart from the same sheet in two clicks.
 *
 * One sheet per question. Each carries a frozen header row and an auto-filter,
 * because the first thing anyone does with a report like this is sort it.
 */
const ExcelJS = require('exceljs');

const HEAD_FILL = 'FF3525CD';   // the app's primary
const BAR_COLOR = 'FF8B85E0';
const BAD_FILL = 'FFFFDAD6';
const BAD_FONT = 'FF93000A';

/** Header row + frozen pane + filter — every sheet gets the same treatment. */
function styleSheet(ws, columns, rowCount) {
  ws.columns = columns;
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (rowCount > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
}

/** In-cell bar across a numeric column — Excel draws it, so it stays live. */
function dataBar(ws, colLetter, lastRow) {
  if (lastRow < 2) return;
  ws.addConditionalFormatting({
    ref: `${colLetter}2:${colLetter}${lastRow}`,
    rules: [{
      type: 'dataBar', gradient: false, color: { argb: BAR_COLOR },
      // cfvo are the bar's endpoints. ExcelJS iterates them while serialising,
      // so omitting them does not fall back to min/max — it throws on write.
      cfvo: [{ type: 'min' }, { type: 'max' }],
      minLength: 0, maxLength: 100, showValue: true,
    }],
  });
}

/** Red-fill a cell when a predicate says the row is a miss. */
function flagRows(ws, lastRow, colLetter, formula) {
  if (lastRow < 2) return;
  ws.addConditionalFormatting({
    ref: `A2:${colLetter}${lastRow}`,
    rules: [{
      type: 'expression', formulae: [formula], priority: 1,
      style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BAD_FILL } },
        font: { color: { argb: BAD_FONT } } },
    }],
  });
}

const minutesToHours = (m) => (m == null ? null : Math.round((m / 60) * 10) / 10);

function addBreakdown(wb, title, rows, extra = {}) {
  const ws = wb.addWorksheet(title);
  styleSheet(ws, [
    { header: extra.keyHeader || 'Kırılım', key: 'k', width: 26 },
    { header: 'Çözülen', key: 'resolved', width: 11 },
    { header: 'Ölçülebilir', key: 'measurable', width: 12 },
    { header: 'Karşılanan', key: 'met', width: 12 },
    { header: 'Uyum %', key: 'compliance', width: 10 },
    { header: 'Ort. aşım (saat)', key: 'over', width: 16 },
  ], rows.length);
  rows.forEach((r) => ws.addRow({
    k: r.key, resolved: r.resolved, measurable: r.measurable, met: r.met,
    compliance: r.compliance, over: minutesToHours(r.avgOverMinutes),
  }));
  const last = rows.length + 1;
  dataBar(ws, 'B', last);
  dataBar(ws, 'E', last);
  // Under 90% compliance is the line worth seeing without reading numbers.
  flagRows(ws, last, 'F', '$E2<90');
  return ws;
}

/**
 * @param {object} data  advancedReport() output
 * @param {object} meta  { companyName, generatedAt }
 * @returns {Promise<Buffer>}
 */
async function buildAdvancedReportXlsx(data, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.companyName || 'ITACM';
  wb.created = meta.generatedAt || new Date();

  /* ---- Summary: the sheet someone opens first ---- */
  const sum = wb.addWorksheet('Özet');
  styleSheet(sum, [
    { header: 'Ölçüm', key: 'k', width: 34 },
    { header: 'Değer', key: 'v', width: 18 },
  ], 1);
  const put = (k, v) => sum.addRow({ k, v: v ?? '—' });
  put('Rapor aralığı', `${data.from} → ${data.to}`);
  put('Şirket', meta.companyName || '—');
  put('Oluşturulma', (meta.generatedAt || new Date()).toISOString().slice(0, 16).replace('T', ' '));
  if (data.workload) {
    const d = data.workload.daily;
    put('Açılan kayıt', d.reduce((s, x) => s + x.opened, 0));
    put('Çözülen kayıt', d.reduce((s, x) => s + x.resolved, 0));
    put('Net biriken (backlog)', data.workload.netBacklog);
  }
  if (data.csat) {
    const votes = data.csat.distribution.reduce((s, x) => s + x.n, 0);
    const total = data.csat.distribution.reduce((s, x) => s + x.n * x.rating, 0);
    put('Memnuniyet oyu', votes);
    put('Memnuniyet ortalaması', votes ? Math.round((total / votes) * 100) / 100 : null);
  }
  if (data.inventory) {
    put('Toplam cihaz', data.inventory.byStatus.reduce((s, x) => s + x.n, 0));
  }

  /* ---- SLA ---- */
  if (data.sla) {
    addBreakdown(wb, 'SLA · Öncelik', data.sla.byPriority, { keyHeader: 'Öncelik' });
    addBreakdown(wb, 'SLA · Kategori', data.sla.byCategory, { keyHeader: 'Kategori' });
    addBreakdown(wb, 'SLA · Temsilci', data.sla.byAgent, { keyHeader: 'Temsilci' });

    const ws = wb.addWorksheet('SLA · En kötü aşımlar');
    styleSheet(ws, [
      { header: 'No', key: 'number', width: 12 },
      { header: 'Konu', key: 'subject', width: 44 },
      { header: 'Öncelik', key: 'priority', width: 11 },
      { header: 'Kategori', key: 'category', width: 18 },
      { header: 'Talep eden', key: 'requester', width: 20 },
      { header: 'Atanan', key: 'assignee', width: 18 },
      { header: 'Aşım (saat)', key: 'over', width: 13 },
      { header: 'Çözüm (saat)', key: 'hours', width: 13 },
    ], data.sla.worst.length);
    data.sla.worst.forEach((r) => ws.addRow({
      number: r.number, subject: r.subject, priority: r.priority, category: r.category,
      requester: r.requester, assignee: r.assignee,
      over: minutesToHours(r.overMinutes), hours: r.resolutionHours,
    }));
    dataBar(ws, 'G', data.sla.worst.length + 1);
  }

  /* ---- Workload ---- */
  if (data.workload) {
    const ws = wb.addWorksheet('Trend ve iş yükü');
    styleSheet(ws, [
      { header: 'Tarih', key: 'date', width: 13 },
      { header: 'Açılan', key: 'opened', width: 10 },
      { header: 'Çözülen', key: 'resolved', width: 10 },
      { header: 'Birikme', key: 'backlog', width: 11 },
    ], data.workload.daily.length);
    data.workload.daily.forEach((r) => ws.addRow(r));
    const last = data.workload.daily.length + 1;
    dataBar(ws, 'B', last); dataBar(ws, 'C', last); dataBar(ws, 'D', last);
    // Left as a plain range on purpose: select A:C and Excel charts it in two
    // clicks, which is the point of shipping data rather than a picture.

    const hs = wb.addWorksheet('Yoğunluk');
    styleSheet(hs, [
      { header: 'Saat', key: 'hour', width: 8 },
      { header: 'Açılan kayıt', key: 'n', width: 14 },
    ], data.workload.byHour.length);
    data.workload.byHour.forEach((r) => hs.addRow(r));
    dataBar(hs, 'B', data.workload.byHour.length + 1);

    const DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    hs.addRow({}); hs.addRow({ hour: 'Gün', n: 'Açılan kayıt' });
    const dowStart = hs.rowCount;
    data.workload.byWeekday.forEach((r) => hs.addRow({ hour: DOW[r.weekday - 1] || r.weekday, n: r.n }));
    dataBar(hs, 'B', hs.rowCount);
    hs.getRow(dowStart).font = { bold: true };
  }

  /* ---- CSAT ---- */
  if (data.csat) {
    const ws = wb.addWorksheet('Memnuniyet');
    styleSheet(ws, [
      { header: 'Temsilci', key: 'k', width: 24 },
      { header: 'Oy', key: 'votes', width: 8 },
      { header: 'Ortalama', key: 'avg', width: 11 },
      { header: 'Düşük (≤2)', key: 'low', width: 12 },
    ], data.csat.byAgent.length);
    data.csat.byAgent.forEach((r) => ws.addRow({ k: r.key, votes: r.votes, avg: r.avg, low: r.low }));
    const last = data.csat.byAgent.length + 1;
    dataBar(ws, 'B', last);
    flagRows(ws, last, 'D', '$C2<3');

    const ls = wb.addWorksheet('Düşük puanlar');
    styleSheet(ls, [
      { header: 'No', key: 'number', width: 12 },
      { header: 'Konu', key: 'subject', width: 44 },
      { header: 'Puan', key: 'rating', width: 8 },
      { header: 'Yorum', key: 'comment', width: 60 },
      { header: 'Atanan', key: 'assignee', width: 18 },
      { header: 'Kategori', key: 'category', width: 18 },
    ], data.csat.lowScores.length);
    data.csat.lowScores.forEach((r) => ls.addRow(r));
  }

  /* ---- Inventory ---- */
  if (data.inventory) {
    const inv = data.inventory;
    const sheet = (title, rows, keyHeader) => {
      const ws = wb.addWorksheet(title);
      styleSheet(ws, [
        { header: keyHeader, key: 'k', width: 26 },
        { header: 'Cihaz', key: 'n', width: 10 },
      ], rows.length);
      rows.forEach((r) => ws.addRow({ k: r.key, n: r.n }));
      dataBar(ws, 'B', rows.length + 1);
    };
    sheet('Envanter · Durum', inv.byStatus, 'Durum');
    sheet('Envanter · Kategori', inv.byCategory, 'Kategori');
    sheet('Envanter · Lokasyon', inv.byLocation, 'Lokasyon');
    sheet('Envanter · Firma', inv.byCompany, 'Firma');
    sheet('Envanter · Yaş', inv.ageBuckets, 'Yaş (yıl)');

    const hs = wb.addWorksheet('Zimmet hareketleri');
    styleSheet(hs, [
      { header: 'Tarih', key: 'date', width: 13 },
      { header: 'Zimmet', key: 'n', width: 10 },
    ], inv.handoversDaily.length);
    inv.handoversDaily.forEach((r) => hs.addRow(r));
    dataBar(hs, 'B', inv.handoversDaily.length + 1);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildAdvancedReportXlsx };
