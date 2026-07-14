/** Dashboard Aggregate Engine (postgres) — pure SQL aggregation. */
const { query } = require('./pool');
const { mapRows } = require('./rowMapper');
const { DEFAULT_LIFECYCLES } = require('../../utils/defaults');

const LICENSE_EXPIRY_WINDOW_DAYS = 30;

async function getEolAssets() {
  const [lcRes, assetsRes] = await Promise.all([
    query('SELECT lifecycles FROM app_settings WHERE id = 1'),
    query(`SELECT id, asset_tag, brand, model, category, location, current_employee_id, current_employee_name, purchase_date, lifecycle_months
           FROM assets WHERE status IN ('In Stock', 'Assigned', 'In Repair')`)
  ]);

  const lc = {
    ...DEFAULT_LIFECYCLES,
    ...(lcRes.rows[0]?.lifecycles || {})
  };

  const now = Date.now();
  const overdue = [];
  const soon = [];

  assetsRes.rows.forEach((row) => {
    const pd = row.purchase_date;
    if (!pd) return;
    const purchaseMs = new Date(pd).getTime();
    if (!purchaseMs) return;

    // Per-asset override wins over the category default; a category set to 0
    // in the Product Catalog is excluded from EOL tracking entirely.
    const catMonths = lc[row.category] != null ? lc[row.category] : (lc.Other || 48);
    const months = row.lifecycle_months || catMonths;
    if (!months) return;
    const eolMs = purchaseMs + months * 30.4375 * 24 * 3600 * 1000;
    const pct = ((now - purchaseMs) / (eolMs - purchaseMs)) * 100;

    const entry = {
      id: row.id,
      assetTag: row.asset_tag,
      brand: row.brand,
      model: row.model,
      category: row.category,
      location: row.location || null,
      currentEmployee: row.current_employee_id ? { id: row.current_employee_id, fullName: row.current_employee_name } : null,
      purchaseDate: pd.toISOString ? pd.toISOString() : new Date(pd).toISOString(),
      eolDate: new Date(eolMs).toISOString(),
      pct: Math.round(pct),
    };

    if (pct >= 100) overdue.push(entry);
    else if (pct >= 90) soon.push(entry);
  });

  overdue.sort((a, b) => a.eolDate.localeCompare(b.eolDate));
  soon.sort((a, b) => b.pct - a.pct);

  return { overdue, soon };
}

function mapOnboardingRow(r) {
  return {
    id: r.id,
    startDate: r.start_date,
    employeeId: r.employee_id,
    employeeName: r.full_name,
    email: r.email,
    department: r.department,
    itemCount: r.item_count,
  };
}

async function getDashboardStats() {
  const [statusCounts, lowStock, expiring, expired, recent, eol, locDist, onboardDue, onboardSched] = await Promise.all([
    query(`SELECT status, COUNT(*)::int AS n FROM assets GROUP BY status`),
    query(
      `SELECT * FROM consumables
       WHERE total_stock <= minimum_stock_alert_level
       ORDER BY total_stock ASC`
    ),
    query(
      `SELECT *, CEIL(EXTRACT(EPOCH FROM (expiration_date - now())) / 86400)::int AS days_left
       FROM licenses
       WHERE COALESCE(status, 'active') = 'active'
         AND expiration_date >= now()
         AND expiration_date <= now() + ($1 || ' days')::interval
       ORDER BY expiration_date ASC`,
      [LICENSE_EXPIRY_WINDOW_DAYS]
    ),
    query(
      `SELECT *, CEIL(EXTRACT(EPOCH FROM (expiration_date - now())) / 86400)::int AS days_left
       FROM licenses
       WHERE COALESCE(status, 'active') = 'active'
         AND expiration_date < now()
       ORDER BY expiration_date ASC
       LIMIT 50`
    ),
    query(`SELECT * FROM handovers ORDER BY transaction_date DESC LIMIT 5`),
    getEolAssets(),
    query(`SELECT COALESCE(NULLIF(location, ''), 'Unassigned') AS loc, COUNT(*)::int AS n
           FROM assets WHERE status <> 'Scrap' AND status <> 'Sold' GROUP BY 1 ORDER BY 2 DESC`),
    query(
      `SELECT o.id, o.start_date, o.employee_id, e.full_name, e.email, e.department,
              (SELECT COUNT(*)::int FROM onboarding_items oi WHERE oi.onboarding_id = o.id) AS item_count
       FROM employee_onboardings o
       JOIN employees e ON e.id = o.employee_id
       WHERE o.status = 'scheduled' AND o.start_date <= CURRENT_DATE
       ORDER BY o.start_date ASC, e.full_name ASC
       LIMIT 20`
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT o.id, o.start_date, o.employee_id, e.full_name, e.email, e.department,
              (SELECT COUNT(*)::int FROM onboarding_items oi WHERE oi.onboarding_id = o.id) AS item_count
       FROM employee_onboardings o
       JOIN employees e ON e.id = o.employee_id
       WHERE o.status = 'scheduled'
       ORDER BY o.start_date ASC, e.full_name ASC
       LIMIT 50`
    ).catch(() => ({ rows: [] })),
  ]);

  const byStatus = Object.fromEntries(statusCounts.rows.map((r) => [r.status, r.n]));
  const total = statusCounts.rows.reduce((sum, r) => sum + r.n, 0);

  const lowStockConsumables = mapRows(lowStock.rows);
  const expiringLicenses = mapRows(expiring.rows);
  const expiredLicenses = mapRows(expired.rows);
  const onboardingDue = onboardDue.rows.map(mapOnboardingRow);
  const onboardingScheduled = onboardSched.rows.map(mapOnboardingRow);

  const recentHandovers = recent.rows
    .flatMap((h) =>
      (h.items || []).map((item) => ({
        handoverId: h.id,
        asset: `${item.brand} ${item.model}`,
        assetTag: item.assetTag,
        employee: h.employee_name,
        date: h.transaction_date,
        status: 'Assigned',
      }))
    )
    .slice(0, 5);

  return {
    assets: {
      total,
      inStock: byStatus['In Stock'] || 0,
      assigned: byStatus['Assigned'] || 0,
      inRepair: byStatus['In Repair'] || 0,
      scrap: byStatus['Scrap'] || 0,
      reserved: byStatus.Reserved || 0,
      sold: byStatus.Sold || 0,
    },
    alerts: {
      lowStockConsumables,
      lowStockCount: lowStockConsumables.length,
      expiringLicenses,
      expiringLicenseCount: expiringLicenses.length,
      expiredLicenses,
      expiredLicenseCount: expiredLicenses.length,
      eolOverdueCount: eol.overdue.length,
      eolSoonCount: eol.soon.length,
      eolOverdue: eol.overdue.slice(0, 5),
      onboardingDue,
      onboardingDueCount: onboardingDue.length,
      onboardingScheduled,
      onboardingScheduledCount: onboardingScheduled.length,
    },
    locationDistribution: locDist.rows.map((r) => ({ location: r.loc, count: r.n })),
    recentHandovers,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { getDashboardStats };

