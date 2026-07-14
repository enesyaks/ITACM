/**
 * Transactional HTML email layout for ITACM notifications.
 * Table-based markup for Outlook / Apple Mail / Gmail compatibility.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BRAND = '#2f2a7a';
const INK = '#1a1d26';
const MUTED = '#5c6570';
const LINE = '#e6e8ee';
const SURFACE = '#f4f5f8';

/**
 * @param {{ companyName: string, eyebrow?: string, title: string, intro?: string,
 *           sections?: Array<{ heading: string, rows: string[] }>,
 *           meta?: Array<{ label: string, value: string }>,
 *           footerNote?: string }} opts
 */
function renderEmail(opts) {
  const company = esc(opts.companyName || 'ITACM');
  const eyebrow = opts.eyebrow ? esc(opts.eyebrow) : '';
  const title = esc(opts.title || '');
  const intro = opts.intro ? esc(opts.intro) : '';
  const footerNote = esc(opts.footerNote || 'This message was sent by ITACM (IT Asset Control).');

  const metaHtml = (opts.meta || []).length
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid ${LINE};border-radius:10px;overflow:hidden">
        ${(opts.meta || []).map((m, i) => `
          <tr>
            <td style="padding:12px 14px;background:${i % 2 ? SURFACE : '#ffffff'};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${MUTED};width:38%;border-bottom:1px solid ${LINE}">${esc(m.label)}</td>
            <td style="padding:12px 14px;background:${i % 2 ? SURFACE : '#ffffff'};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${INK};font-weight:600;border-bottom:1px solid ${LINE}">${esc(m.value)}</td>
          </tr>`).join('')}
      </table>`
    : '';

  const sectionsHtml = (opts.sections || []).map((sec) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">
      <tr>
        <td style="padding:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${MUTED};font-weight:700">
          ${esc(sec.heading)}
        </td>
      </tr>
      <tr>
        <td style="padding:0;border:1px solid ${LINE};border-radius:10px;overflow:hidden;background:#fff">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${(sec.rows || []).slice(0, 25).map((row, i) => `
              <tr>
                <td style="padding:11px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.45;color:${INK};border-bottom:${i === Math.min((sec.rows || []).length, 25) - 1 ? '0' : `1px solid ${LINE}`};background:${i % 2 ? SURFACE : '#ffffff'}">
                  ${esc(row)}
                </td>
              </tr>`).join('')}
          </table>
        </td>
      </tr>
    </table>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
          <tr>
            <td style="height:4px;background:${BRAND};font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND};font-weight:700;margin:0 0 6px">${company}</div>
              ${eyebrow ? `<div style="font-size:12px;color:${MUTED};margin:0 0 10px">${eyebrow}</div>` : ''}
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:${INK};font-weight:700">${title}</h1>
              ${intro ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:${MUTED}">${intro}</p>` : ''}
              ${metaHtml}
              ${sectionsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid ${LINE};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:${MUTED}">
              ${footerNote}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [
    company,
    eyebrow,
    title,
    intro,
    ...(opts.meta || []).map((m) => `${m.label}: ${m.value}`),
    ...(opts.sections || []).flatMap((s) => [`\n${s.heading}`, ...(s.rows || []).map((r) => `- ${r}`)]),
    `\n${opts.footerNote || 'This message was sent by ITACM (IT Asset Control).'}`,
  ].filter(Boolean);

  return { html, text: textParts.join('\n') };
}

module.exports = { renderEmail, esc };
