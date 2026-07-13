/**
 * Format and append sale metadata onto asset notes / history.
 */
const { HttpError } = require('./httpError');

function trimStr(v, max) {
  if (v == null) return '';
  return String(v).trim().slice(0, max);
}

/**
 * @returns {{ approvedBy: string, price: string, buyer: string, saleDate: string, note: string }|null}
 */
function normalizeSale(sale, { required = false } = {}) {
  if (sale == null || typeof sale !== 'object') {
    if (required) {
      throw HttpError.badRequest('Sale details are required when marking an asset as Sold');
    }
    return null;
  }
  const approvedBy = trimStr(sale.approvedBy, 120);
  const price = trimStr(sale.price, 40);
  const buyer = trimStr(sale.buyer, 120);
  const saleDate = trimStr(sale.date || sale.saleDate, 32);
  const note = trimStr(sale.note, 500);
  if (required && !approvedBy) {
    throw HttpError.badRequest('Who approved the sale (approvedBy) is required');
  }
  if (!approvedBy && !price && !buyer && !saleDate && !note) return null;
  return { approvedBy, price, buyer, saleDate, note };
}

function formatSaleSummary(sale) {
  if (!sale) return '';
  const bits = [];
  if (sale.price) bits.push(`Price: ${sale.price}`);
  if (sale.approvedBy) bits.push(`Approved by: ${sale.approvedBy}`);
  if (sale.buyer) bits.push(`Buyer: ${sale.buyer}`);
  if (sale.saleDate) bits.push(`Date: ${sale.saleDate}`);
  if (sale.note) bits.push(sale.note);
  return bits.join(' · ');
}

function formatSaleNoteBlock(sale) {
  if (!sale) return '';
  const dateLabel = sale.saleDate || new Date().toISOString().slice(0, 10);
  return [
    `--- Sale ${dateLabel} ---`,
    sale.price ? `Price: ${sale.price}` : null,
    sale.approvedBy ? `Approved by: ${sale.approvedBy}` : null,
    sale.buyer ? `Buyer: ${sale.buyer}` : null,
    sale.note ? `Note: ${sale.note}` : null,
  ].filter(Boolean).join('\n');
}

function appendSaleToNotes(existing, sale, { maxLen = 2000 } = {}) {
  const block = formatSaleNoteBlock(sale);
  if (!block) return existing || '';
  const prev = String(existing || '').trim();
  const next = prev ? `${prev}\n\n${block}` : block;
  return maxLen ? next.slice(0, maxLen) : next;
}

module.exports = {
  normalizeSale,
  formatSaleSummary,
  formatSaleNoteBlock,
  appendSaleToNotes,
};
