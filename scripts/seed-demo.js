#!/usr/bin/env node
/**
 * Demo data seeder (postgres mode) — a realistic company with HISTORY.
 *
 * Generates 1000–5000 employees (default 2000) plus a proportional, richer
 * fleet: hardware across every category, multi-episode ownership chains spread
 * over the past ~2.5 years (assign → return → reassign, so growth/aging/event
 * reports look real), licenses, mobile lines, past stock counts, repairs with
 * attached paperwork, and consumables.
 *
 *   SEED_EMPLOYEES=2000 npm run seed:demo -- --reset
 *
 * Inside Docker (scripts are baked into the image):
 *   docker compose exec -e SEED_EMPLOYEES=2000 api npm run seed:demo -- --reset
 */
require('dotenv').config();
const config = require('../src/config');

if (config.backend !== 'postgres') {
  console.error('seed-demo runs in DATA_BACKEND=postgres mode only.');
  process.exit(1);
}

const { pool, query, withTransaction } = require('../src/providers/postgres/pool');
const { DEFAULT_LOCATIONS } = require('../src/utils/defaults');
const { ensureDatabase } = require('../src/providers/postgres/migrate');

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chance = (p) => Math.random() < p;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const daysAhead = (d) => new Date(Date.now() + d * 86400000);
const addDays = (date, d) => new Date(date.getTime() + d * 86400000);
const hex = '0123456789ABCDEF';
const mac = () => Array.from({ length: 6 }, () => hex[rnd(16)] + hex[rnd(16)]).join(':');
const serial = (p) => p + '-' + Array.from({ length: 9 }, () => hex[rnd(16)]).join('');
const money = (lo, hi) => Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
// Weighted pick from [[value, weight], …]
const wpick = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
  return pairs[0][0];
};

/** Chunked multi-row INSERT; returns RETURNING rows in input order. */
async function insertMany(t, table, cols, rows, returning) {
  const out = [];
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = slice.map((r) => `(${cols.map((c) => `$${params.push(r[c] === undefined ? null : r[c])}`).join(',')})`);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}${returning ? ' RETURNING ' + returning : ''}`;
    const res = await t.query(sql, params);
    if (returning) out.push(...res.rows);
  }
  return out;
}

const FIRST = ['Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'Osman', 'Yusuf', 'Murat', 'Emre', 'Burak', 'Caner', 'Deniz', 'Efe', 'Furkan', 'Gökhan', 'Halil', 'Kaan', 'Kerem', 'Levent', 'Onur', 'Serkan', 'Tolga', 'Umut', 'Volkan', 'Barış', 'Cem', 'Ege', 'Sinan', 'Tarık', 'Uğur', 'Ayşe', 'Fatma', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Meryem', 'Şerife', 'Sultan', 'Hanife', 'Merve', 'Büşra', 'Esra', 'Kübra', 'Rabia', 'Selin', 'Derya', 'Ebru', 'Gamze', 'Pınar', 'Seda', 'Tuğba', 'Yasemin', 'Özge', 'Nur', 'İrem', 'Ceren', 'Melis'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Erdoğan', 'Güneş', 'Aktaş', 'Bulut', 'Turan', 'Kaplan', 'Avcı', 'Sarı', 'Erdem', 'Yavuz', 'Acar', 'Bilgin', 'Tekin', 'Ünal', 'Güler', 'Taş', 'Duman', 'Çakır'];
const DEPTS = [
  ['Yazılım Geliştirme', ['Yazılım Mühendisi', 'Kıdemli Yazılım Mühendisi', 'Takım Lideri', 'QA Mühendisi', 'DevOps Mühendisi']],
  ['Bilgi Teknolojileri', ['Sistem Yöneticisi', 'Ağ Uzmanı', 'BT Destek Uzmanı', 'Güvenlik Analisti']],
  ['Finans', ['Muhasebe Uzmanı', 'Finans Analisti', 'Bütçe Uzmanı', 'Mali İşler Müdürü']],
  ['İnsan Kaynakları', ['İK Uzmanı', 'İşe Alım Uzmanı', 'Bordro Uzmanı', 'İK Müdürü']],
  ['Satış', ['Satış Temsilcisi', 'Satış Müdürü', 'İş Geliştirme Uzmanı', 'Müşteri Yöneticisi']],
  ['Pazarlama', ['Pazarlama Uzmanı', 'Dijital Pazarlama Uzmanı', 'İçerik Editörü', 'Marka Yöneticisi']],
  ['Operasyon', ['Operasyon Uzmanı', 'Lojistik Uzmanı', 'Tedarik Uzmanı', 'Operasyon Müdürü']],
  ['Müşteri Hizmetleri', ['Müşteri Temsilcisi', 'Çağrı Merkezi Uzmanı', 'Destek Ekip Lideri']],
  ['Hukuk', ['Avukat', 'Hukuk Müşaviri', 'Uyum Uzmanı']],
  ['Tasarım', ['UI/UX Tasarımcısı', 'Grafik Tasarımcı', 'Ürün Tasarımcısı']],
  ['Üretim', ['Üretim Mühendisi', 'Kalite Kontrol Uzmanı', 'Bakım Teknisyeni']],
  ['Yönetim', ['Genel Müdür', 'Genel Müdür Yardımcısı', 'Ofis Yöneticisi', 'Yönetici Asistanı']],
];
// category → { brands: [[brand, models]], sn prefix, has specs, has mac, per-500 count, lifecycleMonthsHint }
const HW = {
  Laptop: { brands: [['Lenovo', ['ThinkPad T14', 'ThinkPad X1 Carbon', 'ThinkPad E15', 'ThinkPad P1']], ['Dell', ['Latitude 5440', 'Latitude 7430', 'XPS 13', 'Precision 5570']], ['HP', ['EliteBook 840', 'ProBook 450', 'ZBook Firefly']], ['Apple', ['MacBook Pro 14"', 'MacBook Air M2', 'MacBook Pro 16"']]], sn: 'LT', specs: true, macW: true, n: 300 },
  Desktop: { brands: [['Dell', ['OptiPlex 7010', 'OptiPlex 5000']], ['HP', ['ProDesk 400', 'EliteDesk 800']], ['Lenovo', ['ThinkCentre M70', 'ThinkStation P360']]], sn: 'DT', specs: true, macE: true, n: 55 },
  Monitor: { brands: [['Dell', ['U2723QE', 'P2422H', 'S2721DS']], ['LG', ['27UP850', '24MP60G', '34WN780']], ['Samsung', ['S27A600', 'F27T350']]], sn: 'MN', n: 150 },
  Television: { brands: [['Samsung', ['QE55Q60', 'UE50AU7100']], ['LG', ['55UP7500', '43UR78']]], sn: 'TV', n: 5 },
  Phone: { brands: [['Apple', ['iPhone 14', 'iPhone 15', 'iPhone 13']], ['Samsung', ['Galaxy S23', 'Galaxy A54', 'Galaxy S24']]], sn: 'PH', macW: true, n: 85 },
  Tablet: { brands: [['Apple', ['iPad 10.9', 'iPad Air']], ['Samsung', ['Galaxy Tab S9', 'Galaxy Tab A8']]], sn: 'TB', macW: true, n: 22 },
  Printer: { brands: [['HP', ['LaserJet Pro M404', 'LaserJet M283']], ['Canon', ['i-SENSYS MF445']], ['Brother', ['HL-L2350DW']]], sn: 'PR', macE: true, n: 18 },
  Network: { brands: [['Cisco', ['Catalyst 2960', 'Catalyst 9200']], ['Ubiquiti', ['UniFi Switch 24', 'UniFi AP AC Pro']], ['MikroTik', ['CRS326']]], sn: 'NW', macE: true, n: 18 },
  Keyboard: { brands: [['Logitech', ['MX Keys', 'K380']], ['Microsoft', ['Ergonomic Keyboard']]], sn: 'KB', n: 40 },
  Mouse: { brands: [['Logitech', ['MX Master 3S', 'M720']], ['Microsoft', ['Surface Mouse']]], sn: 'MO', n: 45 },
  Headset: { brands: [['Jabra', ['Evolve2 65', 'Evolve2 40']], ['Logitech', ['Zone Wired']]], sn: 'HS', n: 55 },
  'Docking Station': { brands: [['Dell', ['WD19', 'WD22TB4']], ['Lenovo', ['ThinkPad Dock']]], sn: 'DK', macE: true, n: 50 },
  Webcam: { brands: [['Logitech', ['C920', 'Brio 4K']], ['Microsoft', ['LifeCam HD']]], sn: 'WC', n: 25 },
};
const CPUS = ['Intel i5-1235U', 'Intel i7-1355U', 'Intel i7-1370P', 'Ryzen 5 5600U', 'Ryzen 7 7840U', 'Apple M2', 'Apple M3'];
const RAMS = ['8GB', '16GB', '32GB', '64GB'];
const DISKS = ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD'];
const OSES = ['Windows 11 Pro', 'Windows 10 Pro', 'macOS Sonoma', 'macOS Ventura', 'Ubuntu 22.04'];
const LICENSES = [
  ['Microsoft 365 E3', 'Microsoft', 300], ['Adobe Creative Cloud', 'Adobe', 40], ['JetBrains All Products', 'JetBrains', 60],
  ['Figma Organization', 'Figma', 35], ['Slack Business+', 'Slack', 450], ['Zoom Pro', 'Zoom', 120], ['AutoCAD', 'Autodesk', 15],
  ['Windows Server CAL', 'Microsoft', 200], ['ESET Endpoint Security', 'ESET', 500], ['Cisco AnyConnect VPN', 'Cisco', 400],
  ['Atlassian Jira', 'Atlassian', 150], ['GitHub Enterprise', 'GitHub', 80], ['Notion Team', 'Notion', 100], ['1Password Business', '1Password', 250],
  ['Tableau Creator', 'Salesforce', 12], ['SAP ERP User', 'SAP', 90], ['Miro Business', 'Miro', 50], ['Postman Enterprise', 'Postman', 40],
  ['SolidWorks', 'Dassault', 8], ['Camtasia', 'TechSmith', 10],
];
const CONSUMABLES = [
  ['HP 85A Toner', 3, 5], ['HP 26A Toner', 12, 5], ['Canon 052 Toner', 2, 4], ['USB-C Kablo', 45, 15], ['HDMI Kablo', 30, 10],
  ['USB-C Adaptör', 8, 10], ['Kablosuz Mouse', 25, 10], ['Klavye (TR-Q)', 18, 8], ['Laptop Çantası', 22, 10], ['Ethernet Kablosu Cat6 (3m)', 60, 20],
  ['AA Pil (4lü)', 40, 15], ['Webcam Kapağı', 100, 20], ['Laptop Standı', 6, 8], ['Docking Station', 4, 5], ['Temizlik Kiti', 14, 5],
];
const OPERATORS = ['Turkcell', 'Vodafone', 'Türk Telekom'];
const PLANS = ['Kurumsal 20GB', 'Kurumsal 30GB', 'Kurumsal Sınırsız', 'Data Only 50GB', 'Kurumsal 10GB'];
const SERVICE = ['TeknoServis A.Ş.', 'Arena Bilgisayar Servis', 'Notebook Klinik', 'Vestel Yetkili Servis', 'Bimeks Teknik'];
const ISSUES = ['Ekran arızası', 'Batarya şişmesi', 'Klavye tuş arızası', 'Anakart sorunu', 'Fan gürültüsü', 'Şarj soketi arızası', 'Yazılım kaynaklı açılmama', 'Menteşe kırığı', 'Aşırı ısınma'];
const NOTES = ['Yeni, kutulu teslim edildi', 'İkinci el, temiz durumda', 'Şarj adaptörü ile birlikte', 'Çanta ve mouse dahil', 'Ekran koruyucu takılı', ''];
const DEMO_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

async function main() {
  const force = process.argv.includes('--force');
  const reset = process.argv.includes('--reset');
  const EMP_COUNT = Math.min(5000, Math.max(50, Number(process.env.SEED_EMPLOYEES) || 2000));
  const factor = EMP_COUNT / 500;
  const scale = (b) => Math.max(1, Math.round(b * factor));
  await ensureDatabase();

  if (reset) {
    console.log('[seed] resetting domain tables (users & settings kept)…');
    await query(`TRUNCATE mobile_line_history, mobile_lines, stock_count_scans, stock_counts,
      maintenance_documents, license_assignments, licenses, handover_documents, handovers,
      maintenance_logs, asset_history, assets, consumables, catalog_models, employees
      RESTART IDENTITY CASCADE`);
  }
  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM employees');
  if (n > 20 && !force && !reset) {
    console.error(`DB already has ${n} employees. Re-run with --reset (fresh) or --force (add on top).`);
    process.exit(1);
  }

  const { rows: admins } = await query(`SELECT id, username FROM users WHERE role IN ('Owner','Admin') ORDER BY created_at LIMIT 1`);
  const admin = admins[0] || { id: 'system', username: 'System' };
  const byId = admin.id;
  const byName = admin.username;

  console.log(`[seed] target ${EMP_COUNT} employees (scale ×${factor.toFixed(1)})`);

  await withTransaction(async (t) => {
    // Departments into settings so the employee form dropdown matches the data.
    await t.query('UPDATE app_settings SET departments = $1::jsonb WHERE id = 1',
      [JSON.stringify(DEPTS.map(([d]) => d))]);

    /* ---------------- employees ---------------- */
    const usedEmails = new Set();
    const empRows = [];
    for (let i = 0; i < EMP_COUNT; i++) {
      const f = pick(FIRST); const l = pick(LAST);
      let email = `${f}.${l}`.toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ç/g, 'c')
        .replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ğ/g, 'g') + '@firma.com.tr';
      if (usedEmails.has(email)) email = email.replace('@', `${i}@`);
      usedEmails.add(email);
      const [dept, titles] = pick(DEPTS);
      empRows.push({
        full_name: `${f} ${l}`, email, department: dept, title: pick(titles),
        status: chance(0.94) ? 'Active' : 'Inactive', created_at: daysAgo(rnd(1000) + 20),
      });
    }
    const empIds = await insertMany(t, 'employees',
      ['full_name', 'email', 'department', 'title', 'status', 'created_at'], empRows, 'id');
    empRows.forEach((e, i) => { e.id = empIds[i].id; });
    const activeEmps = empRows.filter((e) => e.status === 'Active');
    console.log(`[seed] ${empRows.length} employees (${activeEmps.length} active)`);

    /* ---------------- assets ---------------- */
    let tagNo = 2000;
    const assetRows = [];
    for (const [cat, def] of Object.entries(HW)) {
      for (let i = 0; i < scale(def.n); i++) {
        const [brand, models] = pick(def.brands);
        const bought = daysAgo(rnd(1800) + 20); // up to ~5 yrs → EOL variety
        assetRows.push({
          asset_tag: `IT-${pad(tagNo++)}`, serial_number: serial(def.sn), brand, model: pick(models),
          category: cat, mac_ethernet: def.macE && chance(0.8) ? mac() : null,
          mac_wifi: def.macW && chance(0.85) ? mac() : null,
          specs: JSON.stringify(def.specs ? { cpu: pick(CPUS), ram: pick(RAMS), storage: pick(DISKS), os: pick(OSES) } : {}),
          status: 'In Stock', warranty_end_date: chance(0.75) ? addDays(bought, 365 * (1 + rnd(3))) : null,
          qr_code_string: `ITACPRO|ASSET|IT-${pad(tagNo - 1)}`, created_at: bought,
          purchase_date: bought, location: pick(DEFAULT_LOCATIONS),
        });
      }
    }
    const assetIds = await insertMany(t, 'assets',
      ['asset_tag', 'serial_number', 'brand', 'model', 'category', 'mac_ethernet', 'mac_wifi', 'specs',
        'status', 'warranty_end_date', 'qr_code_string', 'created_at', 'purchase_date', 'location'],
      assetRows, 'id');
    assetRows.forEach((a, i) => { a.id = assetIds[i].id; });
    console.log(`[seed] ${assetRows.length} assets`);

    // Catalog: every brand/model that actually exists in the fleet.
    const catKeys = [...new Set(assetRows.map((a) => `${a.category}|${a.brand}|${a.model}`))];
    await insertMany(t, 'catalog_models', ['category', 'brand', 'model'],
      catKeys.map((k) => { const [category, brand, model] = k.split('|'); return { category, brand, model }; }));

    /* ---------------- ownership history (multi-episode, spread over time) ---------------- */
    console.log('[seed] handovers, returns & history over the past ~2.5 years…');
    const shuffled = [...assetRows].sort(() => Math.random() - 0.5);
    const assignPool = shuffled.slice(0, Math.floor(shuffled.length * 0.62)); // rest stays in stock / repair / scrap
    const handovers = []; const history = []; const finalHolder = new Map();

    for (const a of assignPool) {
      const episodes = wpick([[1, 6], [2, 3], [3, 1]]);
      // earliest possible start: after purchase, within ~2.5y window
      let cursorDay = Math.min(880, Math.max(30, Math.round((Date.now() - a.purchase_date.getTime()) / 86400000) - 20));
      for (let ep = 0; ep < episodes; ep++) {
        const emp = pick(activeEmps);
        const assignAt = daysAgo(cursorDay);
        const isLast = ep === episodes - 1;
        const holdDays = 60 + rnd(360);
        const returned = !isLast || chance(0.18); // last episode usually still held
        const note = pick(NOTES);
        const item = {
          assetId: a.id, assetTag: a.asset_tag, brand: a.brand, model: a.model, category: a.category,
          serialNumber: a.serial_number, macAddress: a.mac_ethernet || a.mac_wifi || null, conditionNote: note,
        };
        handovers.push({
          employee_id: emp.id, employee_name: emp.full_name, it_user_id: byId, it_user_name: byName,
          transaction_date: assignAt, document_type: 'single', items: JSON.stringify([item]),
        });
        history.push({
          asset_id: a.id, asset_tag: a.asset_tag, employee_id: emp.id, employee_name: emp.full_name,
          action_type: 'assigned', notes: note || 'Zimmet teslim', changed_by: byId, changed_by_name: byName,
          timestamp: assignAt,
        });
        if (returned) {
          const returnAt = daysAgo(Math.max(3, cursorDay - holdDays));
          history.push({
            asset_id: a.id, asset_tag: a.asset_tag, employee_id: emp.id, employee_name: emp.full_name,
            action_type: 'returned', notes: pick(['Cihaz değişimi', 'Görev değişikliği', 'İşten ayrılış', 'Arıza nedeniyle iade']),
            changed_by: byId, changed_by_name: byName, timestamp: returnAt,
          });
          cursorDay = Math.max(3, cursorDay - holdDays - rnd(40));
        } else {
          finalHolder.set(a.id, emp); // still assigned now
        }
      }
    }
    await insertMany(t, 'handovers',
      ['employee_id', 'employee_name', 'it_user_id', 'it_user_name', 'transaction_date', 'document_type', 'items'], handovers);
    await insertMany(t, 'asset_history',
      ['asset_id', 'asset_tag', 'employee_id', 'employee_name', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'],
      history.map((h) => ({ ...h, timestamp: h.timestamp })));
    console.log(`[seed] ${handovers.length} handovers, ${history.length} history rows`);

    // Apply current holders.
    for (const [assetId, emp] of finalHolder) {
      await t.query('UPDATE assets SET status=$2, current_employee_id=$3, current_employee_name=$4 WHERE id=$1',
        [assetId, 'Assigned', emp.id, emp.full_name]);
    }
    await t.query(`UPDATE employees e SET active_asset_count =
      (SELECT COUNT(*) FROM assets a WHERE a.current_employee_id = e.id AND a.status='Assigned')`);

    /* ---------------- repairs (open + closed) + attached paperwork ---------------- */
    console.log('[seed] maintenance + repair documents…');
    const inStock = shuffled.filter((a) => !finalHolder.has(a.id));
    const nOpen = scale(30); const nClosed = scale(70);
    const openRepair = inStock.slice(0, nOpen);
    const closedRepair = inStock.slice(nOpen, nOpen + nClosed);
    const maintRows = [];
    for (const a of openRepair) {
      maintRows.push({ _asset: a, asset_id: a.id, asset_tag: a.asset_tag, service_company: pick(SERVICE),
        issue_description: pick(ISSUES), cost: money(200, 4000), sent_date: daysAgo(rnd(25) + 1),
        previous_status: 'In Stock', return_date: null, resolution_note: null });
    }
    for (const a of closedRepair) {
      const sent = daysAgo(rnd(500) + 20);
      maintRows.push({ _asset: a, asset_id: a.id, asset_tag: a.asset_tag, service_company: pick(SERVICE),
        issue_description: pick(ISSUES), cost: money(250, 3800), sent_date: sent,
        return_date: addDays(sent, 2 + rnd(25)), previous_status: 'In Stock', resolution_note: 'Onarıldı, test edildi' });
    }
    const maintIds = await insertMany(t, 'maintenance_logs',
      ['asset_id', 'asset_tag', 'service_company', 'issue_description', 'cost', 'sent_date', 'return_date', 'previous_status', 'resolution_note'],
      maintRows.map(({ _asset, ...r }) => r), 'id');
    maintRows.forEach((m, i) => { m.id = maintIds[i].id; });
    for (const a of openRepair) await t.query(`UPDATE assets SET status='In Repair' WHERE id=$1`, [a.id]);
    await insertMany(t, 'asset_history',
      ['asset_id', 'asset_tag', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'],
      maintRows.map((m) => ({ asset_id: m.asset_id, asset_tag: m.asset_tag, action_type: 'sent_to_repair',
        notes: `${m.service_company}: ${m.issue_description}`, changed_by: byId, changed_by_name: byName, timestamp: m.sent_date })));
    // A repair document on ~40% of logs.
    const docRows = maintRows.filter(() => chance(0.4)).map((m) => ({
      maintenance_id: m.id, asset_id: m.asset_id, asset_tag: m.asset_tag,
      filename: `servis-faturasi-${m.asset_tag}.pdf`, mime: 'application/pdf', byte_size: DEMO_PDF.length,
      content: DEMO_PDF, uploaded_by: byId, uploaded_by_name: byName,
    }));
    await insertMany(t, 'maintenance_documents',
      ['maintenance_id', 'asset_id', 'asset_tag', 'filename', 'mime', 'byte_size', 'content', 'uploaded_by', 'uploaded_by_name'], docRows);
    // Scrap ~7% of the still-in-stock pool.
    for (const a of inStock.slice(nOpen + nClosed, nOpen + nClosed + Math.floor(assetRows.length * 0.07))) {
      await t.query(`UPDATE assets SET status='Scrap' WHERE id=$1`, [a.id]);
    }
    console.log(`[seed] ${maintRows.length} repairs (${nOpen} open), ${docRows.length} repair docs`);

    /* ---------------- licenses + software zimmet ---------------- */
    console.log('[seed] licenses + software zimmet…');
    for (const [name, vendor, seats] of LICENSES) {
      const { rows } = await t.query(
        `INSERT INTO licenses (software_name, vendor, license_key, total_seats, expiration_date)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, vendor, `${name.slice(0, 3).toUpperCase()}-${pad(rnd(9999), 4)}-${pad(rnd(9999), 4)}`,
          seats, chance(0.2) ? daysAhead(rnd(28) + 2) : daysAhead(rnd(700) + 40)]);
      const licId = rows[0].id;
      const cap = Math.min(seats, Math.floor(seats * (0.4 + Math.random() * 0.5)));
      const holders = [...activeEmps].sort(() => Math.random() - 0.5).slice(0, cap);
      await insertMany(t, 'license_assignments',
        ['license_id', 'software_name', 'employee_id', 'employee_name', 'assigned_by', 'assigned_by_name', 'assigned_at'],
        holders.map((emp) => ({ license_id: licId, software_name: name, employee_id: emp.id, employee_name: emp.full_name,
          assigned_by: byId, assigned_by_name: byName, assigned_at: daysAgo(rnd(500)) })));
      await t.query('UPDATE licenses SET used_seats=$2 WHERE id=$1', [licId, holders.length]);
    }

    /* ---------------- mobile lines + history ---------------- */
    console.log('[seed] mobile lines…');
    const lineRows = [];
    for (let i = 0; i < scale(140); i++) {
      const num = `+90 5${pick(['30', '32', '33', '42', '05', '55'])} ${pad(rnd(999), 3)} ${pad(rnd(99), 2)} ${pad(rnd(99), 2)}`;
      lineRows.push({ phone_number: num, operator: pick(OPERATORS), plan: pick(PLANS),
        sim_serial: '8990' + Array.from({ length: 15 }, () => rnd(10)).join(''),
        monthly_cost: money(80, 400), status: wpick([['Active', 8], ['Suspended', 1], ['Cancelled', 1]]),
        created_at: daysAgo(rnd(900) + 10) });
    }
    // dedupe numbers
    const seenNum = new Set();
    const uniqueLines = lineRows.filter((l) => (seenNum.has(l.phone_number) ? false : seenNum.add(l.phone_number)));
    const lineIds = await insertMany(t, 'mobile_lines',
      ['phone_number', 'operator', 'plan', 'sim_serial', 'monthly_cost', 'status', 'created_at'], uniqueLines, 'id');
    uniqueLines.forEach((l, i) => { l.id = lineIds[i].id; });
    const lineHist = [];
    for (const l of uniqueLines) {
      if (l.status === 'Active' && chance(0.7)) {
        const emp = pick(activeEmps);
        const at = daysAgo(rnd(600) + 5);
        await t.query('UPDATE mobile_lines SET current_employee_id=$2, current_employee_name=$3 WHERE id=$1',
          [l.id, emp.id, emp.full_name]);
        lineHist.push({ line_id: l.id, phone_number: l.phone_number, employee_id: emp.id, employee_name: emp.full_name,
          action_type: 'line_assigned', notes: `${l.operator} · ${l.plan}`, changed_by: byId, changed_by_name: byName, timestamp: at });
      }
    }
    await insertMany(t, 'mobile_line_history',
      ['line_id', 'phone_number', 'employee_id', 'employee_name', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'], lineHist);
    console.log(`[seed] ${uniqueLines.length} mobile lines (${lineHist.length} assigned)`);

    /* ---------------- past stock counts ---------------- */
    console.log('[seed] stock counts…');
    for (let c = 0; c < 2; c++) {
      const when = daysAgo(rnd(200) + 40);
      const location = pick(DEFAULT_LOCATIONS);
      const inScope = assetRows.filter((a) => a.location === location);
      const scanned = inScope.filter(() => chance(0.9)); // 90% found
      const missing = inScope.filter((a) => !scanned.includes(a));
      const summary = {
        expected: inScope.length, found: scanned.length,
        missing: missing.slice(0, 50).map((a) => ({ assetTag: a.asset_tag, brand: a.brand, model: a.model, category: a.category, status: 'In Stock', location, holder: null })),
        missingCount: missing.length, unexpected: [], unexpectedCount: 0, closedBy: byName,
      };
      const { rows } = await t.query(
        `INSERT INTO stock_counts (name, location, status, created_by_name, created_at, closed_at, summary)
         VALUES ($1,$2,'closed',$3,$4,$5,$6::jsonb) RETURNING id`,
        [`${when.getFullYear()} Sayım — ${location}`, location, byName, when, addDays(when, 1), JSON.stringify(summary)]);
      await insertMany(t, 'stock_count_scans',
        ['count_id', 'raw', 'asset_id', 'asset_tag', 'matched', 'scanned_by_name', 'scanned_at'],
        scanned.map((a) => ({ count_id: rows[0].id, raw: a.asset_tag, asset_id: a.id, asset_tag: a.asset_tag,
          matched: true, scanned_by_name: byName, scanned_at: addDays(when, Math.random()) })));
    }

    /* ---------------- consumables ---------------- */
    await insertMany(t, 'consumables', ['item_name', 'total_stock', 'minimum_stock_alert_level'],
      CONSUMABLES.map(([item_name, total_stock, minimum_stock_alert_level]) => ({ item_name, total_stock, minimum_stock_alert_level })));
  });

  const stats = await query(`SELECT
    (SELECT COUNT(*) FROM employees) e, (SELECT COUNT(*) FROM assets) a,
    (SELECT COUNT(*) FROM handovers) h, (SELECT COUNT(*) FROM asset_history) hi,
    (SELECT COUNT(*) FROM license_assignments) sw, (SELECT COUNT(*) FROM mobile_lines) ml,
    (SELECT COUNT(*) FROM maintenance_logs) m, (SELECT COUNT(*) FROM stock_counts) sc`);
  console.log('[seed] done:', stats.rows[0]);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
