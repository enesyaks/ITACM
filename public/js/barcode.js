/*
 * Minimal, dependency-free Code 128 (subset B) barcode generator → inline SVG.
 * Used for printable asset labels. Asset tags (e.g. "IT-1042") and the QR string
 * are all within Code 128-B (ASCII 32–126), so subset B alone is enough.
 */
(function () {
  // Canonical Code 128 bar/space width patterns, indexed by symbol value 0..106.
  const PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
  ];
  const START_B = 104;
  const STOP = 106;

  const escXml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /**
   * Render `text` as a Code 128-B barcode SVG string.
   * opts: { height, moduleWidth, margin, showText }
   */
  function code128SVG(text, opts = {}) {
    const height = opts.height || 40;
    const mw = opts.moduleWidth || 2;
    const margin = opts.margin == null ? 8 : opts.margin;
    const showText = opts.showText !== false;

    const str = String(text);
    const values = [];
    for (const ch of str) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error('Code128-B supports ASCII 32–126 only');
      values.push(code - 32);
    }
    let sum = START_B;
    values.forEach((v, i) => { sum += v * (i + 1); });
    const seq = [START_B, ...values, sum % 103, STOP];
    const widths = seq.map((v) => PATTERNS[v]).join('');

    let totalModules = 0;
    for (const d of widths) totalModules += Number(d);
    const barsW = totalModules * mw;
    const w = barsW + margin * 2;
    const textH = showText ? 15 : 0;
    const h = height + textH;

    let x = margin;
    let bars = '';
    [...widths].forEach((d, i) => {
      const width = Number(d) * mw;
      if (i % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}" fill="#000"/>`;
      x += width;
    });
    const label = showText
      ? `<text x="${(w / 2).toFixed(2)}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000">${escXml(str)}</text>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}" height="${h}" viewBox="0 0 ${w.toFixed(2)} ${h}" shape-rendering="crispEdges">${bars}${label}</svg>`;
  }

  window.code128SVG = code128SVG;
})();
