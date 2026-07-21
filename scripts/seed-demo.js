#!/usr/bin/env node
/**
 * Demo data seeder (postgres mode) — QA / demo company (~100 employees by default).
 *
 * Covers: employees + org chart, IT users (all roles), assets + handovers,
 * licenses, mobile lines, repairs/docs, consumables, stock counts, onboardings,
 * sample approvals. Pair with seed:infra + seed:providers for full coverage.
 *
 * Safe for local/nat only. `--reset` wipes domain tables (keeps Owner + settings
 * + non-demo users) then reseeds. Do not run against production.
 *
 *   npm run seed:demo -- --reset
 *   SEED_EMPLOYEES=100 npm run seed:demo -- --reset
 *   npm run seed:all -- --reset
 *
 * Docker:
 *   docker compose exec -e SEED_EMPLOYEES=100 api npm run seed:demo -- --reset
 *   docker compose exec api npm run seed:all -- --reset
 *
 * Demo IT logins (password Demo123!):
 *   demo.admin@example.com     Admin
 *   demo.helpdesk@example.com  Helpdesk
 *   demo.viewer@example.com    Viewer
 *   demo.user01@example.com    Portal (matches employee email)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const config = require('../src/config');

if (config.backend !== 'postgres') {
  console.error('seed-demo runs in DATA_BACKEND=postgres mode only.');
  process.exit(1);
}

const { pool, query, withTransaction } = require('../src/providers/postgres/pool');
const { DEFAULT_LOCATIONS } = require('../src/utils/defaults');
const { ensureDatabase } = require('../src/providers/postgres/migrate');

const DEMO_PASSWORD = 'Demo123!';
const DEMO_EMAIL_RE = /^demo\.(admin|helpdesk|viewer|user\d+)@example\.com$/i;

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chance = (p) => Math.random() < p;
const pad = (n, w = 4) => String(n).padStart(w, '0');
const daysAgo = (d) => new Date(Date.now() - d * 86400000);
const daysAhead = (d) => new Date(Date.now() + d * 86400000);
const addDays = (date, d) => new Date(date.getTime() + d * 86400000);
const hex = '0123456789ABCDEF';
const mac = () => Array.from({ length: 6 }, () => hex[rnd(16)] + hex[rnd(16)]).join(':');
const money = (lo, hi) => Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
const wpick = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
  return pairs[0][0];
};

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


const FIRST = [
  'Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'Osman', 'Yusuf', 'Murat',
  'Emre', 'Burak', 'Caner', 'Deniz', 'Efe', 'Furkan', 'Gökhan', 'Halil', 'Kaan', 'Kerem',
  'Levent', 'Onur', 'Serkan', 'Tolga', 'Umut', 'Volkan', 'Barış', 'Cem', 'Ege', 'Sinan',
  'Ayşe', 'Fatma', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Merve', 'Büşra', 'Esra', 'Kübra',
  'Selin', 'Derya', 'Ebru', 'Gamze', 'Pınar', 'Seda', 'Tuğba', 'Yasemin', 'Özge', 'İrem',
  'Alex', 'Jordan', 'Sam', 'Taylor', 'Chris', 'Morgan', 'Riley', 'Casey', 'Jamie', 'Avery',
];
const LAST = [
  'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir',
  'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek',
  'Polat', 'Korkmaz', 'Güneş', 'Aktaş', 'Bulut', 'Turan', 'Kaplan', 'Erdem', 'Yavuz', 'Acar',
  'Smith', 'Johnson', 'Brown', 'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris',
];

const DEPTS = [
  ['Yönetim', ['Genel Müdür', 'Genel Müdür Yardımcısı', 'Ofis Yöneticisi', 'Yönetici Asistanı'], ['Executive']],
  ['Bilgi Teknolojileri', ['IT Müdürü', 'Sistem Yöneticisi', 'Ağ Uzmanı', 'BT Destek Uzmanı', 'Güvenlik Analisti'], ['Infrastructure', 'Service Desk']],
  ['Yazılım Geliştirme', ['Yazılım Mühendisi', 'Kıdemli Yazılım Mühendisi', 'Takım Lideri', 'QA Mühendisi', 'DevOps Mühendisi'], ['Backend', 'Frontend', 'QA']],
  ['Finans', ['Muhasebe Uzmanı', 'Finans Analisti', 'Bütçe Uzmanı', 'Mali İşler Müdürü'], ['Accounting', 'FP&A']],
  ['İnsan Kaynakları', ['İK Uzmanı', 'İşe Alım Uzmanı', 'Bordro Uzmanı', 'İK Müdürü'], ['Talent', 'People Ops']],
  ['Satış', ['Satış Temsilcisi', 'Satış Müdürü', 'İş Geliştirme Uzmanı', 'Müşteri Yöneticisi'], ['Enterprise', 'SMB']],
  ['Pazarlama', ['Pazarlama Uzmanı', 'Dijital Pazarlama Uzmanı', 'İçerik Editörü', 'Marka Yöneticisi'], ['Brand', 'Growth']],
  ['Operasyon', ['Operasyon Uzmanı', 'Lojistik Uzmanı', 'Tedarik Uzmanı', 'Operasyon Müdürü'], ['Logistics']],
  ['Müşteri Hizmetleri', ['Müşteri Temsilcisi', 'Çağrı Merkezi Uzmanı', 'Destek Ekip Lideri'], ['Support L1']],
  ['Hukuk', ['Avukat', 'Hukuk Müşaviri', 'Uyum Uzmanı'], ['Legal']],
  ['Tasarım', ['UI/UX Tasarımcısı', 'Grafik Tasarımcı', 'Ürün Tasarımcısı'], ['Product Design']],
  ['Üretim', ['Üretim Mühendisi', 'Kalite Kontrol Uzmanı', 'Bakım Teknisyeni'], ['Quality']],
];

const HW = {
  Laptop: { brands: [['Lenovo', ['ThinkPad T14', 'ThinkPad X1 Carbon', 'ThinkPad E15']], ['Dell', ['Latitude 5440', 'XPS 13']], ['HP', ['EliteBook 840']], ['Apple', ['MacBook Pro 14"', 'MacBook Air M2']]], sn: 'LT', specs: true, macW: true, n: 95 },
  Desktop: { brands: [['Dell', ['OptiPlex 7010']], ['HP', ['EliteDesk 800']], ['Lenovo', ['ThinkCentre M70']]], sn: 'DT', specs: true, macE: true, n: 14 },
  Monitor: { brands: [['Dell', ['U2723QE', 'P2422H']], ['LG', ['27UP850']], ['Samsung', ['S27A600']]], sn: 'MN', n: 70 },
  Television: { brands: [['Samsung', ['QE55Q60']], ['LG', ['55UP7500']]], sn: 'TV', n: 2 },
  Phone: { brands: [['Apple', ['iPhone 14', 'iPhone 15']], ['Samsung', ['Galaxy S23', 'Galaxy A54']]], sn: 'PH', macW: true, n: 40 },
  Tablet: { brands: [['Apple', ['iPad 10.9']], ['Samsung', ['Galaxy Tab S9']]], sn: 'TB', macW: true, n: 8 },
  Printer: { brands: [['HP', ['LaserJet Pro M404']], ['Canon', ['i-SENSYS MF445']], ['Brother', ['HL-L2350DW']]], sn: 'PR', macE: true, n: 6 },
  Network: { brands: [['Cisco', ['Catalyst 2960']], ['Ubiquiti', ['UniFi AP AC Pro']], ['MikroTik', ['CRS326']]], sn: 'NW', macE: true, n: 6 },
  Keyboard: { brands: [['Logitech', ['MX Keys']], ['Microsoft', ['Ergonomic Keyboard']]], sn: 'KB', n: 18 },
  Mouse: { brands: [['Logitech', ['MX Master 3S']], ['Microsoft', ['Surface Mouse']]], sn: 'MO', n: 18 },
  Headset: { brands: [['Jabra', ['Evolve2 65']], ['Logitech', ['Zone Wired']]], sn: 'HS', n: 22 },
  'Docking Station': { brands: [['Dell', ['WD19', 'WD22TB4']], ['Lenovo', ['ThinkPad Dock']]], sn: 'DK', macE: true, n: 28 },
  Webcam: { brands: [['Logitech', ['C920', 'Brio 4K']]], sn: 'WC', n: 10 },
};
const CPUS = ['Intel i5-1235U', 'Intel i7-1355U', 'Intel i7-1370P', 'Ryzen 5 5600U', 'Ryzen 7 7840U', 'Apple M2', 'Apple M3'];
const RAMS = ['8GB', '16GB', '32GB', '64GB'];
const DISKS = ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD'];
const OSES = ['Windows 11 Pro', 'Windows 10 Pro', 'macOS Sonoma', 'macOS Ventura', 'Ubuntu 22.04'];
const LICENSES = [
  ['Microsoft 365 E3', 'Microsoft', 120], ['Adobe Creative Cloud', 'Adobe', 20], ['JetBrains All Products', 'JetBrains', 35],
  ['Figma Organization', 'Figma', 18], ['Slack Business+', 'Slack', 110], ['Zoom Pro', 'Zoom', 50], ['AutoCAD', 'Autodesk', 6],
  ['Windows Server CAL', 'Microsoft', 80], ['ESET Endpoint Security', 'ESET', 120], ['Cisco AnyConnect VPN', 'Cisco', 100],
  ['Atlassian Jira', 'Atlassian', 60], ['GitHub Enterprise', 'GitHub', 40], ['Notion Team', 'Notion', 50], ['1Password Business', '1Password', 100],
  ['Miro Business', 'Miro', 25], ['Postman Enterprise', 'Postman', 20],
];
const CONSUMABLES = [
  ['HP 85A Toner', 3, 5], ['HP 26A Toner', 12, 5], ['Canon 052 Toner', 2, 4], ['USB-C Kablo', 45, 15], ['HDMI Kablo', 30, 10],
  ['USB-C Adaptör', 8, 10], ['Kablosuz Mouse', 25, 10], ['Klavye (TR-Q)', 18, 8], ['Laptop Çantası', 22, 10], ['Ethernet Kablosu Cat6 (3m)', 60, 20],
  ['AA Pil (4lü)', 40, 15], ['Webcam Kapağı', 100, 20], ['Laptop Standı', 6, 8], ['Temizlik Kiti', 14, 5],
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
  const EMP_COUNT = Math.min(500, Math.max(50, Number(process.env.SEED_EMPLOYEES) || 100));
  const factor = EMP_COUNT / 100;
  const scale = (b) => Math.max(1, Math.round(b * factor));
  await ensureDatabase();

  const { rows: prefixRows } = await query("SELECT COALESCE(NULLIF(TRIM(asset_tag_prefix), ''), 'IT') AS p FROM app_settings WHERE id = 1");
  const TAG_PREFIX = (prefixRows[0] && prefixRows[0].p) || 'IT';

  if (reset) {
    console.log('[seed] --reset: wiping domain tables (Owner + non-demo users + settings kept)…');
    await query(`
      TRUNCATE
        onboarding_items, employee_onboardings,
        mobile_line_history, mobile_lines,
        stock_count_scans, stock_counts,
        maintenance_documents, license_assignments, license_documents,
        asset_licenses, asset_parent_links,
        licenses, handover_documents, handovers,
        maintenance_logs, asset_history, assets,
        software_installs, consumables, catalog_models,
        approval_requests, teams, departments, employees
      RESTART IDENTITY CASCADE`);
    await query(`DELETE FROM users WHERE email ~* $1 AND role <> 'Owner'`, [DEMO_EMAIL_RE.source]);
  }

  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM employees');
  if (n > 20 && !force && !reset) {
    console.error(`DB already has ${n} employees. Re-run with --reset (fresh) or --force (add on top).`);
    process.exit(1);
  }

  const { rows: owners } = await query(`SELECT id, username, email FROM users WHERE role = 'Owner' ORDER BY created_at LIMIT 1`);
  const admin = owners[0] || { id: 'system', username: 'System', email: null };
  const byId = admin.id;
  const byName = admin.username;
  const pwdHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log(`[seed] target ${EMP_COUNT} employees (scale ×${factor.toFixed(2)}), asset tag prefix "${TAG_PREFIX}-"`);

  await withTransaction(async (t) => {
    const deptIds = {};
    for (const [name] of DEPTS) {
      const { rows } = await t.query(
        `INSERT INTO departments (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name`,
        [name]
      );
      deptIds[name] = rows[0].id;
    }
    if (reset) {
      await t.query(`DELETE FROM departments WHERE name <> ALL($1::text[])`, [DEPTS.map(([d]) => d)]);
    }
    await t.query('UPDATE app_settings SET departments = $1::jsonb WHERE id = 1',
      [JSON.stringify(DEPTS.map(([d]) => d))]);
    const { rows: locRows } = await t.query('SELECT locations FROM app_settings WHERE id = 1');
    const locs = [...new Set([
      ...(Array.isArray(locRows[0]?.locations) ? locRows[0].locations : []),
      ...DEFAULT_LOCATIONS,
    ])];
    await t.query('UPDATE app_settings SET locations = $1::jsonb WHERE id = 1', [JSON.stringify(locs)]);

    const empRows = [];
    const deptWeights = DEPTS.map((entry, i) => {
      const name = entry[0];
      const w = name === 'Yazılım Geliştirme' ? 18
        : name === 'Bilgi Teknolojileri' ? 12
        : name === 'Satış' ? 12
        : name === 'Yönetim' ? 4
        : name === 'Hukuk' ? 3
        : 8;
      return [i, w];
    });
    for (let i = 1; i <= EMP_COUNT; i++) {
      const di = wpick(deptWeights);
      const [dept, titles] = DEPTS[di];
      const f = FIRST[(i - 1) % FIRST.length];
      const l = LAST[Math.floor((i - 1) / FIRST.length) % LAST.length];
      empRows.push({
        full_name: `${f} ${l}`,
        email: `demo.user${pad(i, 2)}@example.com`,
        department: dept,
        title: pick(titles),
        status: i > Math.floor(EMP_COUNT * 0.92) ? 'Inactive' : 'Active',
        start_date: daysAgo(rnd(1200) + 30).toISOString().slice(0, 10),
        created_at: daysAgo(rnd(1000) + 20),
      });
    }
    Object.assign(empRows[0], { full_name: 'Demo Genel Müdür', department: 'Yönetim', title: 'Genel Müdür', status: 'Active' });
    Object.assign(empRows[1], { full_name: 'Demo IT Müdürü', department: 'Bilgi Teknolojileri', title: 'IT Müdürü', status: 'Active' });
    Object.assign(empRows[2], { full_name: 'Demo Helpdesk Lead', department: 'Bilgi Teknolojileri', title: 'BT Destek Uzmanı', status: 'Active' });
    Object.assign(empRows[3], { full_name: 'Demo Yazılım Lideri', department: 'Yazılım Geliştirme', title: 'Takım Lideri', status: 'Active' });

    const empIds = await insertMany(t, 'employees',
      ['full_name', 'email', 'department', 'title', 'status', 'start_date', 'created_at'],
      empRows, 'id');
    empRows.forEach((e, i) => { e.id = empIds[i].id; });
    const activeEmps = empRows.filter((e) => e.status === 'Active');
    console.log(`[seed] ${empRows.length} employees (${activeEmps.length} active, ${empRows.length - activeEmps.length} inactive)`);


    const teamIds = {};
    const deptManagers = {};
    const byDept = {};
    for (const e of activeEmps) (byDept[e.department] ||= []).push(e);
    for (const [dept] of DEPTS) {
      const members = byDept[dept] || [];
      deptManagers[dept] = members.find((m) => /müdür|lider|manager|lead|director/i.test(m.title)) || members[0];
    }
    const gm = empRows[0];
    deptManagers['Yönetim'] = gm;

    for (const [dept, , teamNames] of DEPTS) {
      const deptId = deptIds[dept];
      if (!deptId) continue;
      if (deptManagers[dept]) {
        await t.query('UPDATE departments SET manager_employee_id = $2 WHERE id = $1', [deptId, deptManagers[dept].id]);
      }
      for (const teamName of teamNames) {
        const { rows } = await t.query(
          `INSERT INTO teams (name, department_id) VALUES ($1,$2)
           ON CONFLICT (department_id, name) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [teamName, deptId]
        );
        teamIds[`${dept}|${teamName}`] = rows[0].id;
      }
    }

    for (const [dept, , teamNames] of DEPTS) {
      const members = [...(byDept[dept] || [])];
      if (!members.length) continue;
      const chunks = teamNames.map(() => []);
      members.forEach((m, i) => {
        if (deptManagers[dept] && m.id === deptManagers[dept].id && teamNames.length > 1) return;
        chunks[i % teamNames.length].push(m);
      });
      for (let ti = 0; ti < teamNames.length; ti++) {
        const tid = teamIds[`${dept}|${teamNames[ti]}`];
        const group = chunks[ti];
        if (!tid || !group.length) continue;
        const lead = group.find((m) => /lider|lead|müdür|senior|kıdemli/i.test(m.title)) || group[0];
        await t.query('UPDATE teams SET lead_employee_id = $2 WHERE id = $1', [tid, lead.id]);
        for (const m of group) {
          let mid = m.id === lead.id ? (deptManagers[dept]?.id || gm.id) : lead.id;
          if (mid === m.id) mid = deptManagers[dept]?.id !== m.id ? deptManagers[dept]?.id : gm.id;
          if (mid === m.id) mid = gm.id !== m.id ? gm.id : null;
          await t.query('UPDATE employees SET team_id = $2, manager_employee_id = $3 WHERE id = $1', [m.id, tid, mid]);
        }
      }
      const dm = deptManagers[dept];
      if (dm && dm.id !== gm.id) {
        await t.query('UPDATE employees SET manager_employee_id = $2 WHERE id = $1', [dm.id, gm.id]);
      }
    }
    const { rows: mgrSync } = await t.query('SELECT id, manager_employee_id FROM employees');
    const mgrMap = new Map(mgrSync.map((r) => [r.id, r.manager_employee_id]));
    empRows.forEach((e) => { e.manager_employee_id = mgrMap.get(e.id) || null; });
    console.log(`[seed] org chart: ${Object.keys(deptIds).length} departments, ${Object.keys(teamIds).length} teams`);

    for (const u of [
      { email: 'demo.admin@example.com', username: 'Demo Admin', role: 'Admin' },
      { email: 'demo.helpdesk@example.com', username: 'Demo Helpdesk', role: 'Helpdesk' },
      { email: 'demo.viewer@example.com', username: 'Demo Viewer', role: 'Viewer' },
    ]) {
      await t.query(
        `INSERT INTO users (username, email, password_hash, role, status, must_change_password)
         VALUES ($1,$2,$3,$4,'Active', false)
         ON CONFLICT (email) DO UPDATE SET
           username = EXCLUDED.username, password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role, status = 'Active', must_change_password = false`,
        [u.username, u.email, pwdHash, u.role]
      );
    }
    const portalEmps = activeEmps.slice(0, 12);
    for (const emp of portalEmps) {
      await t.query(
        `INSERT INTO users (username, email, password_hash, role, status, must_change_password)
         VALUES ($1,$2,$3,'Portal','Active', false)
         ON CONFLICT (email) DO UPDATE SET
           username = EXCLUDED.username, password_hash = EXCLUDED.password_hash,
           role = 'Portal', status = 'Active', must_change_password = false`,
        [emp.full_name, emp.email, pwdHash]
      );
    }
    console.log(`[seed] IT users: Admin/Helpdesk/Viewer + ${portalEmps.length} Portal (password ${DEMO_PASSWORD})`);

    let tagNo = 1000;
    let snSeq = 1;
    const assetRows = [];
    for (const [cat, def] of Object.entries(HW)) {
      for (let i = 0; i < scale(def.n); i++) {
        const [brand, models] = pick(def.brands);
        const bought = daysAgo(rnd(1800) + 20);
        const tag = `${TAG_PREFIX}-${pad(tagNo++)}`;
        assetRows.push({
          asset_tag: tag,
          serial_number: `${def.sn}-DEMO-${pad(snSeq++, 6)}`,
          brand, model: pick(models), category: cat,
          mac_ethernet: def.macE && chance(0.8) ? mac() : null,
          mac_wifi: def.macW && chance(0.85) ? mac() : null,
          specs: JSON.stringify(def.specs ? { cpu: pick(CPUS), ram: pick(RAMS), storage: pick(DISKS), os: pick(OSES) } : {}),
          status: 'In Stock',
          warranty_end_date: chance(0.75) ? addDays(bought, 365 * (1 + rnd(3))) : null,
          qr_code_string: `ITACPRO|ASSET|${tag}`,
          created_at: bought, purchase_date: bought,
          location: pick(DEFAULT_LOCATIONS), notes: 'SEED demo asset',
        });
      }
    }
    const assetIds = await insertMany(t, 'assets',
      ['asset_tag', 'serial_number', 'brand', 'model', 'category', 'mac_ethernet', 'mac_wifi', 'specs',
        'status', 'warranty_end_date', 'qr_code_string', 'created_at', 'purchase_date', 'location', 'notes'],
      assetRows, 'id');
    assetRows.forEach((a, i) => { a.id = assetIds[i].id; });
    console.log(`[seed] ${assetRows.length} assets`);

    const catKeys = [...new Set(assetRows.map((a) => `${a.category}|${a.brand}|${a.model}`))];
    await insertMany(t, 'catalog_models', ['category', 'brand', 'model'],
      catKeys.map((k) => { const [category, brand, model] = k.split('|'); return { category, brand, model }; }));


    console.log('[seed] handovers + assignment history…');
    const shuffled = [...assetRows].sort(() => Math.random() - 0.5);
    const assignPool = shuffled.slice(0, Math.floor(shuffled.length * 0.68));
    const handovers = [];
    const history = [];
    const finalHolder = new Map();
    const handoverEmpPairs = [];

    for (const a of assignPool) {
      const episodes = wpick([[1, 7], [2, 2], [3, 1]]);
      let cursorDay = Math.min(700, Math.max(30, Math.round((Date.now() - a.purchase_date.getTime()) / 86400000) - 20));
      for (let ep = 0; ep < episodes; ep++) {
        const emp = pick(activeEmps);
        const assignAt = daysAgo(cursorDay);
        const isLast = ep === episodes - 1;
        const holdDays = 45 + rnd(280);
        const returned = !isLast || chance(0.15);
        const note = pick(NOTES);
        const item = {
          assetId: a.id, assetTag: a.asset_tag, brand: a.brand, model: a.model, category: a.category,
          serialNumber: a.serial_number, macAddress: a.mac_ethernet || a.mac_wifi || null, conditionNote: note,
        };
        handovers.push({
          employee_id: emp.id, employee_name: emp.full_name, it_user_id: byId, it_user_name: byName,
          transaction_date: assignAt, document_type: 'single', items: JSON.stringify([item]),
        });
        handoverEmpPairs.push({ emp, asset: a });
        history.push({
          asset_id: a.id, asset_tag: a.asset_tag, employee_id: emp.id, employee_name: emp.full_name,
          action_type: 'assigned', notes: note || 'Zimmet teslim', changed_by: byId, changed_by_name: byName, timestamp: assignAt,
        });
        if (returned) {
          history.push({
            asset_id: a.id, asset_tag: a.asset_tag, employee_id: emp.id, employee_name: emp.full_name,
            action_type: 'returned', notes: pick(['Cihaz değişimi', 'Görev değişikliği', 'İşten ayrılış', 'Arıza nedeniyle iade']),
            changed_by: byId, changed_by_name: byName, timestamp: daysAgo(Math.max(3, cursorDay - holdDays)),
          });
          cursorDay = Math.max(3, cursorDay - holdDays - rnd(40));
        } else {
          finalHolder.set(a.id, emp);
        }
      }
    }
    const hoIds = await insertMany(t, 'handovers',
      ['employee_id', 'employee_name', 'it_user_id', 'it_user_name', 'transaction_date', 'document_type', 'items'],
      handovers, 'id');
    await insertMany(t, 'asset_history',
      ['asset_id', 'asset_tag', 'employee_id', 'employee_name', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'],
      history);
    for (const [assetId, emp] of finalHolder) {
      await t.query('UPDATE assets SET status=$2, current_employee_id=$3, current_employee_name=$4 WHERE id=$1',
        [assetId, 'Assigned', emp.id, emp.full_name]);
    }
    await t.query(`UPDATE employees e SET active_asset_count =
      (SELECT COUNT(*) FROM assets a WHERE a.current_employee_id = e.id AND a.status='Assigned')`);
    console.log(`[seed] ${handovers.length} handovers, ${finalHolder.size} currently assigned`);

    const hoDocRows = handoverEmpPairs.slice(0, 25).map((p, i) => ({
      handover_id: hoIds[i]?.id || null, employee_id: p.emp.id, employee_name: p.emp.full_name,
      kind: chance(0.5) ? 'generated' : 'scan', filename: `zimmet-${p.asset.asset_tag}.pdf`,
      mime: 'application/pdf', byte_size: DEMO_PDF.length, content: DEMO_PDF,
      uploaded_by: byId, uploaded_by_name: byName,
    }));
    if (hoDocRows.length) {
      await insertMany(t, 'handover_documents',
        ['handover_id', 'employee_id', 'employee_name', 'kind', 'filename', 'mime', 'byte_size', 'content', 'uploaded_by', 'uploaded_by_name'],
        hoDocRows);
    }

    const inStock = shuffled.filter((a) => !finalHolder.has(a.id));
    const nOpen = scale(8);
    const nClosed = scale(18);
    const openRepair = inStock.slice(0, nOpen);
    const closedRepair = inStock.slice(nOpen, nOpen + nClosed);
    const maintRows = [];
    for (const a of openRepair) {
      maintRows.push({
        asset_id: a.id, asset_tag: a.asset_tag, service_company: pick(SERVICE),
        issue_description: pick(ISSUES), cost: money(200, 4000), sent_date: daysAgo(rnd(25) + 1),
        previous_status: 'In Stock', return_date: null, resolution_note: null,
      });
    }
    for (const a of closedRepair) {
      const sent = daysAgo(rnd(400) + 20);
      maintRows.push({
        asset_id: a.id, asset_tag: a.asset_tag, service_company: pick(SERVICE),
        issue_description: pick(ISSUES), cost: money(250, 3800), sent_date: sent,
        return_date: addDays(sent, 2 + rnd(25)), previous_status: 'In Stock', resolution_note: 'Onarıldı, test edildi',
      });
    }
    const maintIds = await insertMany(t, 'maintenance_logs',
      ['asset_id', 'asset_tag', 'service_company', 'issue_description', 'cost', 'sent_date', 'return_date', 'previous_status', 'resolution_note'],
      maintRows, 'id');
    maintRows.forEach((m, i) => { m.id = maintIds[i].id; });
    for (const a of openRepair) await t.query(`UPDATE assets SET status='In Repair' WHERE id=$1`, [a.id]);
    await insertMany(t, 'asset_history',
      ['asset_id', 'asset_tag', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'],
      maintRows.map((m) => ({
        asset_id: m.asset_id, asset_tag: m.asset_tag, action_type: 'sent_to_repair',
        notes: `${m.service_company}: ${m.issue_description}`, changed_by: byId, changed_by_name: byName, timestamp: m.sent_date,
      })));
    const repairDocs = maintRows.filter(() => chance(0.45)).map((m) => ({
      maintenance_id: m.id, asset_id: m.asset_id, asset_tag: m.asset_tag,
      filename: `servis-faturasi-${m.asset_tag}.pdf`, mime: 'application/pdf', byte_size: DEMO_PDF.length,
      content: DEMO_PDF, uploaded_by: byId, uploaded_by_name: byName,
    }));
    await insertMany(t, 'maintenance_documents',
      ['maintenance_id', 'asset_id', 'asset_tag', 'filename', 'mime', 'byte_size', 'content', 'uploaded_by', 'uploaded_by_name'],
      repairDocs);

    const leftover = inStock.slice(nOpen + nClosed);
    for (const a of leftover.slice(0, Math.max(2, Math.floor(assetRows.length * 0.04)))) {
      await t.query(`UPDATE assets SET status='Scrap' WHERE id=$1`, [a.id]);
    }
    for (const a of leftover.slice(Math.floor(assetRows.length * 0.04), Math.floor(assetRows.length * 0.04) + Math.max(1, scale(3)))) {
      await t.query(`UPDATE assets SET status='Sold', notes='SEED sold demo' WHERE id=$1`, [a.id]);
    }
    for (const a of leftover.slice(Math.floor(assetRows.length * 0.06), Math.floor(assetRows.length * 0.06) + Math.max(1, scale(4)))) {
      const emp = pick(activeEmps);
      await t.query(
        `UPDATE assets SET status='Reserved', current_employee_id=$2, current_employee_name=$3, notes='SEED reserved for onboarding' WHERE id=$1`,
        [a.id, emp.id, emp.full_name]
      );
    }
    console.log(`[seed] ${maintRows.length} repairs (${nOpen} open), ${repairDocs.length} repair docs`);


    console.log('[seed] licenses + software zimmet…');
    for (const [name, vendor, seatsBase] of LICENSES) {
      const seats = Math.max(5, scale(seatsBase));
      const { rows } = await t.query(
        `INSERT INTO licenses (software_name, vendor, license_key, total_seats, expiration_date, status)
         VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
        [name, vendor, `DEMO-${name.slice(0, 3).toUpperCase()}-${pad(rnd(9999), 4)}`,
          seats, chance(0.15) ? daysAhead(rnd(28) + 2) : daysAhead(rnd(500) + 40)]
      );
      const licId = rows[0].id;
      const cap = Math.min(seats, Math.floor(seats * (0.45 + Math.random() * 0.4)));
      const holders = [...activeEmps].sort(() => Math.random() - 0.5).slice(0, cap);
      await insertMany(t, 'license_assignments',
        ['license_id', 'software_name', 'employee_id', 'employee_name', 'assigned_by', 'assigned_by_name', 'assigned_at'],
        holders.map((emp) => ({
          license_id: licId, software_name: name, employee_id: emp.id, employee_name: emp.full_name,
          assigned_by: byId, assigned_by_name: byName, assigned_at: daysAgo(rnd(400)),
        })));
      await t.query('UPDATE licenses SET used_seats=$2 WHERE id=$1', [licId, holders.length]);
    }


    console.log('[seed] mobile lines…');
    const lineRows = [];
    for (let i = 0; i < scale(45); i++) {
      lineRows.push({
        phone_number: `+90 5${pick(['30', '32', '33', '42', '05', '55'])} ${pad(100 + i, 3)} ${pad(rnd(99), 2)} ${pad(rnd(99), 2)}`,
        operator: pick(OPERATORS), plan: pick(PLANS),
        sim_serial: '8990' + pad(i, 15), monthly_cost: money(80, 400),
        status: wpick([['Active', 8], ['Suspended', 1], ['Cancelled', 1]]),
        created_at: daysAgo(rnd(700) + 10),
      });
    }
    const seenNum = new Set();
    const uniqueLines = lineRows.filter((l) => (seenNum.has(l.phone_number) ? false : seenNum.add(l.phone_number)));
    const lineIds = await insertMany(t, 'mobile_lines',
      ['phone_number', 'operator', 'plan', 'sim_serial', 'monthly_cost', 'status', 'created_at'], uniqueLines, 'id');
    uniqueLines.forEach((l, i) => { l.id = lineIds[i].id; });
    const lineHist = [];
    for (const l of uniqueLines) {
      if (l.status === 'Active' && chance(0.75)) {
        const emp = pick(activeEmps);
        const at = daysAgo(rnd(400) + 5);
        await t.query('UPDATE mobile_lines SET current_employee_id=$2, current_employee_name=$3 WHERE id=$1',
          [l.id, emp.id, emp.full_name]);
        lineHist.push({
          line_id: l.id, phone_number: l.phone_number, employee_id: emp.id, employee_name: emp.full_name,
          action_type: 'line_assigned', notes: `${l.operator} · ${l.plan}`,
          changed_by: byId, changed_by_name: byName, timestamp: at,
        });
      }
    }
    await insertMany(t, 'mobile_line_history',
      ['line_id', 'phone_number', 'employee_id', 'employee_name', 'action_type', 'notes', 'changed_by', 'changed_by_name', 'timestamp'],
      lineHist);
    console.log(`[seed] ${uniqueLines.length} mobile lines (${lineHist.length} assigned)`);


    const reservedAssets = (await t.query(`SELECT id FROM assets WHERE status='Reserved' LIMIT 8`)).rows;
    const freeLines = uniqueLines.filter((l) => l.status === 'Active' && !lineHist.find((h) => h.line_id === l.id)).slice(0, 5);
    const onboardCandidates = activeEmps.filter((e) => ![...finalHolder.values()].some((h) => h.id === e.id)).slice(0, 6);
    let oi = 0;
    for (const emp of onboardCandidates.slice(0, 3)) {
      const { rows } = await t.query(
        `INSERT INTO employee_onboardings (employee_id, start_date, status, notes, created_by, created_by_name)
         VALUES ($1,$2,'scheduled',$3,$4,$5) RETURNING id`,
        [emp.id, daysAhead(7 + oi * 3).toISOString().slice(0, 10), 'SEED: upcoming starter kit', byId, byName]
      );
      if (reservedAssets[oi]) {
        await t.query(`INSERT INTO onboarding_items (onboarding_id, asset_id, condition_note) VALUES ($1,$2,$3)`,
          [rows[0].id, reservedAssets[oi].id, 'Reserved laptop']);
      }
      if (freeLines[oi]) {
        await t.query(`INSERT INTO onboarding_items (onboarding_id, line_id, condition_note) VALUES ($1,$2,$3)`,
          [rows[0].id, freeLines[oi].id, 'New corporate line']);
        await t.query(`UPDATE mobile_lines SET reserved_for_employee_id=$2 WHERE id=$1`, [freeLines[oi].id, emp.id]);
      }
      oi++;
    }
    for (const emp of onboardCandidates.slice(3, 5)) {
      await t.query(
        `INSERT INTO employee_onboardings (employee_id, start_date, status, notes, created_by, created_by_name, completed_at)
         VALUES ($1,$2,'completed',$3,$4,$5,$6)`,
        [emp.id, daysAgo(40).toISOString().slice(0, 10), 'SEED: completed onboarding', byId, byName, daysAgo(35)]
      );
    }
    console.log('[seed] onboardings seeded');

    for (let c = 0; c < 2; c++) {
      const when = daysAgo(rnd(120) + 20);
      const location = pick(DEFAULT_LOCATIONS);
      const inScope = assetRows.filter((a) => a.location === location);
      const scanned = inScope.filter(() => chance(0.9));
      const missing = inScope.filter((a) => !scanned.includes(a));
      const summary = {
        expected: inScope.length, found: scanned.length,
        missing: missing.slice(0, 30).map((a) => ({
          assetTag: a.asset_tag, brand: a.brand, model: a.model, category: a.category, status: 'In Stock', location, holder: null,
        })),
        missingCount: missing.length, unexpected: [], unexpectedCount: 0, closedBy: byName,
      };
      const { rows } = await t.query(
        `INSERT INTO stock_counts (name, location, status, created_by_name, created_at, closed_at, summary)
         VALUES ($1,$2,'closed',$3,$4,$5,$6::jsonb) RETURNING id`,
        [`${when.getFullYear()} Sayım — ${location}`, location, byName, when, addDays(when, 1), JSON.stringify(summary)]
      );
      if (scanned.length) {
        await insertMany(t, 'stock_count_scans',
          ['count_id', 'raw', 'asset_id', 'asset_tag', 'matched', 'scanned_by_name', 'scanned_at'],
          scanned.map((a) => ({
            count_id: rows[0].id, raw: a.asset_tag, asset_id: a.id, asset_tag: a.asset_tag,
            matched: true, scanned_by_name: byName, scanned_at: addDays(when, Math.random()),
          })));
      }
    }

    await insertMany(t, 'consumables', ['item_name', 'total_stock', 'minimum_stock_alert_level'],
      CONSUMABLES.map(([item_name, total_stock, minimum_stock_alert_level]) => ({ item_name, total_stock, minimum_stock_alert_level })));


    await t.query('UPDATE app_settings SET approvals = $1::jsonb WHERE id = 1', [JSON.stringify({
      enabled: false,
      policy: {
        asset_sale: ['manager', 'department'],
        asset_scrap: ['manager', 'department'],
        license_assign: ['manager'],
      },
    })]);

    const requester = activeEmps.find((e) => e.manager_employee_id) || activeEmps[5] || activeEmps[0];
    const approverRow = requester?.manager_employee_id
      ? empRows.find((e) => e.id === requester.manager_employee_id)
      : deptManagers['Bilgi Teknolojileri'] || empRows[1];
    const scrapAsset = leftover[leftover.length - 1] || assetRows[0];
    await insertMany(t, 'approval_requests',
      ['type', 'status', 'requester_employee_id', 'requester_name', 'approver_employee_id', 'approver_name',
        'levels', 'current_level', 'payload', 'resource_ref', 'summary', 'decided_by', 'decided_at', 'decision_note'],
      [
        {
          type: 'asset_scrap', status: 'pending',
          requester_employee_id: requester.id, requester_name: requester.full_name,
          approver_employee_id: approverRow?.id || empRows[1].id,
          approver_name: approverRow?.full_name || empRows[1].full_name,
          levels: JSON.stringify(['manager', 'department']), current_level: 0,
          payload: JSON.stringify({ assetId: scrapAsset.id, assetTag: scrapAsset.asset_tag, reason: 'SEED: end of life' }),
          resource_ref: scrapAsset.asset_tag, summary: `Scrap ${scrapAsset.asset_tag} (demo pending)`,
          decided_by: null, decided_at: null, decision_note: null,
        },
        {
          type: 'license_assign', status: 'pending',
          requester_employee_id: empRows[4]?.id || requester.id,
          requester_name: empRows[4]?.full_name || requester.full_name,
          approver_employee_id: empRows[3].id, approver_name: empRows[3].full_name,
          levels: JSON.stringify(['manager']), current_level: 0,
          payload: JSON.stringify({ softwareName: 'Adobe Creative Cloud', seats: 1 }),
          resource_ref: 'Adobe Creative Cloud', summary: 'Assign Adobe CC (demo pending)',
          decided_by: null, decided_at: null, decision_note: null,
        },
        {
          type: 'asset_sale', status: 'approved',
          requester_employee_id: requester.id, requester_name: requester.full_name,
          approver_employee_id: approverRow?.id || empRows[1].id,
          approver_name: approverRow?.full_name || empRows[1].full_name,
          levels: JSON.stringify(['manager', 'department']), current_level: 1,
          payload: JSON.stringify({ assetTag: assetRows[1]?.asset_tag, buyer: 'SEED buyer' }),
          resource_ref: assetRows[1]?.asset_tag || null, summary: 'Sale approved (demo history)',
          decided_by: approverRow?.full_name || byName, decided_at: daysAgo(5), decision_note: 'SEED: approved for demo',
        },
        {
          type: 'asset_scrap', status: 'rejected',
          requester_employee_id: empRows[6]?.id || requester.id,
          requester_name: empRows[6]?.full_name || requester.full_name,
          approver_employee_id: empRows[1].id, approver_name: empRows[1].full_name,
          levels: JSON.stringify(['manager']), current_level: 0,
          payload: JSON.stringify({ reason: 'Still under warranty' }),
          resource_ref: assetRows[2]?.asset_tag || null, summary: 'Scrap rejected (demo history)',
          decided_by: empRows[1].full_name, decided_at: daysAgo(12), decision_note: 'SEED: keep in repair pool',
        },
      ]);
    console.log('[seed] approvals enabled + 4 sample requests (2 pending)');
  });


  const stats = await query(`SELECT
    (SELECT COUNT(*) FROM employees) AS employees,
    (SELECT COUNT(*) FROM employees WHERE status='Active') AS employees_active,
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM users WHERE role='Portal') AS portal_users,
    (SELECT COUNT(*) FROM assets) AS assets,
    (SELECT COUNT(*) FROM assets WHERE status='Assigned') AS assets_assigned,
    (SELECT COUNT(*) FROM handovers) AS handovers,
    (SELECT COUNT(*) FROM handover_documents) AS handover_docs,
    (SELECT COUNT(*) FROM licenses) AS licenses,
    (SELECT COUNT(*) FROM license_assignments) AS license_assignments,
    (SELECT COUNT(*) FROM mobile_lines) AS mobile_lines,
    (SELECT COUNT(*) FROM departments) AS departments,
    (SELECT COUNT(*) FROM teams) AS teams,
    (SELECT COUNT(*) FROM approval_requests) AS approvals,
    (SELECT COUNT(*) FROM consumables) AS consumables,
    (SELECT COUNT(*) FROM employee_onboardings) AS onboardings,
    (SELECT COUNT(*) FROM maintenance_logs) AS repairs`);
  console.log('[seed] done:', stats.rows[0]);
  console.log('[seed] next: npm run seed:infra && npm run seed:providers  (or npm run seed:all)');
  console.log(`[seed] demo logins → demo.admin|helpdesk|viewer|user01@example.com / ${DEMO_PASSWORD}`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
