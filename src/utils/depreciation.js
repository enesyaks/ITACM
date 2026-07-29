/**
 * Straight-line asset depreciation — a thin money layer on top of the existing
 * EOL lifecycle. Pure functions, no DB / I/O, so they are unit-testable and the
 * exact same lifecycle-resolution rule feeds both the EOL date and the book value.
 *
 * Lifecycle resolution (canonical order, shared with the dashboard EOL engine):
 *   per-asset override → catalog model default → category default → 'Other'.
 * A category whose lifecycle is 0 is "excluded from depreciation" and keeps full value.
 */
const { DEFAULT_LIFECYCLES } = require('./defaults');

const MS_PER_MONTH = 30.4375 * 24 * 3600 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;

/** Built-in category defaults with the instance's per-category overrides on top. */
function resolveLifecycles(stored) {
  return { ...DEFAULT_LIFECYCLES, ...(stored || {}) };
}

/** EOL/depreciation window in months for one asset. Returns 0 when disabled. */
function resolveLifeMonths({ assetMonths, modelMonths, category }, lifecycles) {
  const lc = lifecycles || DEFAULT_LIFECYCLES;
  const catMonths = lc[category] != null ? lc[category] : (lc.Other || 48);
  const months = assetMonths || modelMonths || catMonths;
  return Number(months) || 0;
}

/**
 * Straight-line book value at `now`. Returns null when it cannot be computed
 * (no positive cost, or no purchase date) so callers can render "—".
 * A non-depreciating asset (lifeMonths <= 0) keeps its full cost.
 */
function bookValue({ cost, purchaseDate, lifeMonths, salvage = 0 }, now = Date.now()) {
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return null;
  if (!purchaseDate) return null;
  const pMs = new Date(purchaseDate).getTime();
  if (!pMs) return null;

  const months = Number(lifeMonths) || 0;
  if (months <= 0) return round2(c);

  const sv = Math.max(0, Math.min(c, Number(salvage) || 0));
  const elapsed = (now - pMs) / MS_PER_MONTH;
  const frac = Math.max(0, Math.min(1, elapsed / months));
  return round2(c - (c - sv) * frac);
}

/**
 * Full depreciation summary for one asset row. `lifecycles` is the merged
 * category map (see resolveLifecycles). When the value can't be computed every
 * money field is null but `lifeMonths` is still returned for display.
 */
function depreciationFor(
  { cost, purchaseDate, assetMonths, modelMonths, category, salvage },
  lifecycles,
  now = Date.now()
) {
  const lifeMonths = resolveLifeMonths({ assetMonths, modelMonths, category }, lifecycles);
  const value = bookValue({ cost, purchaseDate, lifeMonths, salvage }, now);
  if (value == null) {
    return { bookValue: null, depreciated: null, depreciationPct: null, lifeMonths };
  }
  const c = Number(cost);
  const depreciated = round2(c - value);
  const depreciationPct = c > 0 ? Math.round((depreciated / c) * 100) : 0;
  return { bookValue: value, depreciated, depreciationPct, lifeMonths };
}

module.exports = { resolveLifecycles, resolveLifeMonths, bookValue, depreciationFor, round2 };
