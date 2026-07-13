#!/usr/bin/env node
/**
 * Seed sample Network/Server gear for topology + rack cabinet testing.
 *
 * Idempotent: removes previous DEMO-* infra tags, then inserts a multi-site
 * topology (Main Office, Istanbul Branch, Warehouse) with parents, racks,
 * multi-U placements, and linked licenses.
 *
 *   npm run seed:infra
 *   docker compose exec api npm run seed:infra
 */
require('dotenv').config();
const config = require('../src/config');

if (config.backend !== 'postgres') {
  console.error('seed:infra runs in DATA_BACKEND=postgres mode only.');
  process.exit(1);
}

const { query, withTransaction, pool } = require('../src/providers/postgres/pool');
const { ensureDatabase } = require('../src/providers/postgres/migrate');
const { DEFAULT_LOCATIONS } = require('../src/utils/defaults');

const LOC = {
  hq: 'Main Office',
  ist: 'Istanbul Branch',
  wh: 'Warehouse',
};

function qr(tag) {
  return `ITACPRO|ASSET|${tag}`;
}

function rackLabel(start, size) {
  if (start == null) return null;
  return size > 1 ? `${start}-${start + size - 1}` : String(start);
}

async function main() {
  await ensureDatabase();

  await withTransaction(async (t) => {
    // Ensure demo locations exist in settings.
    const { rows: setRows } = await t.query('SELECT locations FROM app_settings WHERE id = 1');
    const current = (setRows[0] && setRows[0].locations) || [];
    const merged = [...new Set([
      ...(Array.isArray(current) ? current : []),
      ...DEFAULT_LOCATIONS,
      LOC.hq, LOC.ist, LOC.wh,
    ])];
    await t.query('UPDATE app_settings SET locations = $1::jsonb WHERE id = 1',
      [JSON.stringify(merged)]);

    // Responsible person (prefer BT employee, else any active).
    let { rows: emps } = await t.query(
      `SELECT id, full_name FROM employees
       WHERE status = 'Active'
       ORDER BY CASE WHEN department ILIKE '%teknoloji%' OR department ILIKE '%IT%' THEN 0 ELSE 1 END, full_name
       LIMIT 1`
    );
    if (!emps[0]) {
      const ins = await t.query(
        `INSERT INTO employees (full_name, email, department, title, status)
         VALUES ('Infra Demo Owner', 'infra.demo@firma.com.tr', 'Bilgi Teknolojileri', 'Ağ Uzmanı', 'Active')
         RETURNING id, full_name`
      );
      emps = ins.rows;
    }
    const owner = emps[0];
    console.log(`[seed:infra] responsible → ${owner.full_name}`);

    // Demo licenses (upsert by software_name).
    const licenseDefs = [
      { software_name: 'DEMO VMware vSphere', vendor: 'VMware', license_key: 'DEMO-VMW-001', total_seats: 10, days: 120 },
      { software_name: 'DEMO FortiGate Support', vendor: 'Fortinet', license_key: 'DEMO-FG-001', total_seats: 5, days: 45 },
      { software_name: 'DEMO Cisco DNA Center', vendor: 'Cisco', license_key: 'DEMO-DNA-001', total_seats: 8, days: 200 },
      { software_name: 'DEMO Windows Server Datacenter', vendor: 'Microsoft', license_key: 'DEMO-WSDC-001', total_seats: 16, days: 300 },
    ];
    const licenseIds = {};
    for (const L of licenseDefs) {
      const exp = new Date(Date.now() + L.days * 86400000);
      const found = await t.query(
        'SELECT id FROM licenses WHERE license_key = $1 LIMIT 1',
        [L.license_key]
      );
      if (found.rows[0]) {
        licenseIds[L.software_name] = found.rows[0].id;
        await t.query(
          `UPDATE licenses SET software_name=$2, vendor=$3, expiration_date=$4, total_seats=$5
           WHERE id=$1`,
          [found.rows[0].id, L.software_name, L.vendor, exp, L.total_seats]
        );
      } else {
        const { rows } = await t.query(
          `INSERT INTO licenses (software_name, vendor, license_key, total_seats, used_seats, expiration_date)
           VALUES ($1,$2,$3,$4,0,$5) RETURNING id`,
          [L.software_name, L.vendor, L.license_key, L.total_seats, exp]
        );
        licenseIds[L.software_name] = rows[0].id;
      }
    }
    console.log('[seed:infra] demo licenses ready');

    // Remove previous DEMO infra assets (cascade clears asset_licenses).
    const del = await t.query(
      `DELETE FROM assets WHERE asset_tag LIKE 'DEMO-%' RETURNING asset_tag`
    );
    if (del.rows.length) {
      console.log(`[seed:infra] removed ${del.rows.length} previous DEMO assets`);
    }

    // Catalog models used by demo gear.
    const catalog = [
      ['Network', 'Fortinet', 'FortiGate 100F'],
      ['Network', 'Cisco', 'Catalyst 9300'],
      ['Network', 'Cisco', 'Catalyst 9200'],
      ['Network', 'Ubiquiti', 'UniFi U6 Pro'],
      ['Network', 'F5', 'BIG-IP i2800'],
      ['Server', 'Dell', 'PowerEdge R750'],
      ['Server', 'Dell', 'PowerEdge R740xd'],
      ['Server', 'HPE', 'ProLiant DL380'],
      ['Server', 'Synology', 'RS3621xs+'],
    ];
    for (const [category, brand, model] of catalog) {
      await t.query(
        `INSERT INTO catalog_models (category, brand, model)
         VALUES ($1,$2,$3) ON CONFLICT (category, brand, model) DO NOTHING`,
        [category, brand, model]
      );
    }

    /**
     * Device blueprint.
     * parentTag: asset_tag of upstream device (same or cross-site).
     */
    const devices = [
      /* -------- Main Office DC -------- */
      {
        tag: 'DEMO-FW-HQ', category: 'Network', brand: 'Fortinet', model: 'FortiGate 100F',
        role: 'Firewall', location: LOC.hq, rack: 'RACK-A01', uStart: 42, uSize: 1,
        host: 'fw-hq-01', ip: '10.0.0.1', mgmt: '10.255.0.1',
        firmware: '7.2.8', parentTag: null,
        licenses: ['DEMO FortiGate Support'],
      },
      {
        tag: 'DEMO-LB-HQ', category: 'Network', brand: 'F5', model: 'BIG-IP i2800',
        role: 'Load Balancer', location: LOC.hq, rack: 'RACK-A01', uStart: 40, uSize: 1,
        host: 'lb-hq-01', ip: '10.0.0.2', mgmt: '10.255.0.2',
        firmware: '17.1.0', parentTag: 'DEMO-FW-HQ',
        licenses: [],
      },
      {
        tag: 'DEMO-SW-HQ-CORE', category: 'Network', brand: 'Cisco', model: 'Catalyst 9300',
        role: 'Switch', location: LOC.hq, rack: 'RACK-A01', uStart: 38, uSize: 1,
        host: 'sw-hq-core', ip: '10.0.0.10', mgmt: '10.255.0.10',
        firmware: '17.9.4a', parentTag: 'DEMO-FW-HQ',
        licenses: ['DEMO Cisco DNA Center'],
      },
      {
        tag: 'DEMO-SW-HQ-ACC', category: 'Network', brand: 'Cisco', model: 'Catalyst 9200',
        role: 'Switch', location: LOC.hq, rack: 'RACK-A01', uStart: 36, uSize: 1,
        host: 'sw-hq-acc', ip: '10.0.0.11', mgmt: '10.255.0.11',
        firmware: '17.9.4a', parentTag: 'DEMO-SW-HQ-CORE',
        licenses: ['DEMO Cisco DNA Center'],
      },
      {
        tag: 'DEMO-ESX-HQ-01', category: 'Server', brand: 'Dell', model: 'PowerEdge R750',
        role: 'Hypervisor', location: LOC.hq, rack: 'RACK-A01', uStart: 30, uSize: 2,
        host: 'esx-hq-01', ip: '10.0.10.11', mgmt: '10.255.10.11',
        firmware: 'ESXi 8.0U2', parentTag: 'DEMO-SW-HQ-CORE',
        licenses: ['DEMO VMware vSphere', 'DEMO Windows Server Datacenter'],
        specsExtra: { cpu: 'Intel i9-13900H', ram: '64GB', storage: '2TB SSD', os: 'VMware ESXi 8' },
      },
      {
        tag: 'DEMO-ESX-HQ-02', category: 'Server', brand: 'Dell', model: 'PowerEdge R750',
        role: 'Hypervisor', location: LOC.hq, rack: 'RACK-A01', uStart: 28, uSize: 2,
        host: 'esx-hq-02', ip: '10.0.10.12', mgmt: '10.255.10.12',
        firmware: 'ESXi 8.0U2', parentTag: 'DEMO-SW-HQ-CORE',
        licenses: ['DEMO VMware vSphere'],
        specsExtra: { cpu: 'Intel i9-13900H', ram: '64GB', storage: '2TB SSD', os: 'VMware ESXi 8' },
      },
      {
        tag: 'DEMO-STO-HQ', category: 'Server', brand: 'Synology', model: 'RS3621xs+',
        role: 'Storage', location: LOC.hq, rack: 'RACK-A01', uStart: 20, uSize: 4,
        host: 'nas-hq-01', ip: '10.0.20.5', mgmt: '10.255.20.5',
        firmware: 'DSM 7.2', parentTag: 'DEMO-SW-HQ-CORE',
        licenses: [],
      },
      {
        tag: 'DEMO-AP-HQ-01', category: 'Network', brand: 'Ubiquiti', model: 'UniFi U6 Pro',
        role: 'Access Point', location: LOC.hq, rack: null, uStart: null, uSize: null,
        host: 'ap-hq-floor3', ip: '10.0.50.21', mgmt: '10.255.50.21',
        firmware: '6.6.77', parentTag: 'DEMO-SW-HQ-ACC',
        licenses: [],
      },
      {
        tag: 'DEMO-AP-HQ-02', category: 'Network', brand: 'Ubiquiti', model: 'UniFi U6 Pro',
        role: 'Access Point', location: LOC.hq, rack: null, uStart: null, uSize: null,
        host: 'ap-hq-lobby', ip: '10.0.50.22', mgmt: '10.255.50.22',
        firmware: '6.6.77', parentTag: 'DEMO-SW-HQ-ACC',
        licenses: [],
      },
      /* Second HQ cabinet */
      {
        tag: 'DEMO-SW-HQ-B', category: 'Network', brand: 'Cisco', model: 'Catalyst 9200',
        role: 'Switch', location: LOC.hq, rack: 'RACK-A02', uStart: 40, uSize: 1,
        host: 'sw-hq-b', ip: '10.0.0.20', mgmt: '10.255.0.20',
        firmware: '17.9.4a', parentTag: 'DEMO-SW-HQ-CORE',
        licenses: [],
      },
      {
        tag: 'DEMO-SRV-HQ-APP', category: 'Server', brand: 'HPE', model: 'ProLiant DL380',
        role: 'Physical Server', location: LOC.hq, rack: 'RACK-A02', uStart: 30, uSize: 2,
        host: 'app-hq-01', ip: '10.0.10.40', mgmt: '10.255.10.40',
        firmware: 'Windows Server 2022', parentTag: 'DEMO-SW-HQ-B',
        licenses: ['DEMO Windows Server Datacenter'],
        specsExtra: { cpu: 'Intel i7-1370P', ram: '32GB', storage: '1TB SSD', os: 'Windows Server 2022' },
      },

      /* -------- Istanbul Branch -------- */
      {
        tag: 'DEMO-FW-IST', category: 'Network', brand: 'Fortinet', model: 'FortiGate 100F',
        role: 'Firewall', location: LOC.ist, rack: 'RACK-IST-01', uStart: 42, uSize: 1,
        host: 'fw-ist-01', ip: '10.10.0.1', mgmt: '10.254.0.1',
        firmware: '7.2.8', parentTag: null,
        licenses: ['DEMO FortiGate Support'],
        // WAN peer conceptually uplinks to HQ firewall (cross-site parent)
        notes: 'Site-to-site VPN peer of DEMO-FW-HQ',
      },
      {
        tag: 'DEMO-SW-IST', category: 'Network', brand: 'Cisco', model: 'Catalyst 9200',
        role: 'Switch', location: LOC.ist, rack: 'RACK-IST-01', uStart: 38, uSize: 1,
        host: 'sw-ist-01', ip: '10.10.0.10', mgmt: '10.254.0.10',
        firmware: '17.9.4a', parentTag: 'DEMO-FW-IST',
        licenses: ['DEMO Cisco DNA Center'],
      },
      {
        tag: 'DEMO-ESX-IST', category: 'Server', brand: 'Dell', model: 'PowerEdge R740xd',
        role: 'Hypervisor', location: LOC.ist, rack: 'RACK-IST-01', uStart: 28, uSize: 2,
        host: 'esx-ist-01', ip: '10.10.10.11', mgmt: '10.254.10.11',
        firmware: 'ESXi 8.0U1', parentTag: 'DEMO-SW-IST',
        licenses: ['DEMO VMware vSphere'],
        specsExtra: { cpu: 'Intel i7-1355U', ram: '32GB', storage: '1TB SSD', os: 'VMware ESXi 8' },
      },
      {
        tag: 'DEMO-AP-IST-01', category: 'Network', brand: 'Ubiquiti', model: 'UniFi U6 Pro',
        role: 'Access Point', location: LOC.ist, rack: null, uStart: null, uSize: null,
        host: 'ap-ist-office', ip: '10.10.50.21', mgmt: '10.254.50.21',
        firmware: '6.6.77', parentTag: 'DEMO-SW-IST',
        licenses: [],
      },
      // Intentional U overlap for cabinet clash testing (U36 collides with switch area — use U37 vs shared)
      {
        tag: 'DEMO-SRV-IST-SPAR', category: 'Server', brand: 'Dell', model: 'PowerEdge R750',
        role: 'Physical Server', location: LOC.ist, rack: 'RACK-IST-01', uStart: 37, uSize: 2,
        host: 'spare-ist-01', ip: '10.10.10.99', mgmt: '10.254.10.99',
        firmware: 'BIOS 2.18', parentTag: 'DEMO-SW-IST',
        licenses: [],
        notes: 'DEMO: overlaps U37–38 with switch — tests clash highlight',
        specsExtra: { cpu: 'Intel i5-1235U', ram: '16GB', storage: '512GB SSD', os: 'Windows Server 2022' },
      },

      /* -------- Warehouse -------- */
      {
        tag: 'DEMO-SW-WH', category: 'Network', brand: 'Cisco', model: 'Catalyst 9200',
        role: 'Switch', location: LOC.wh, rack: 'RACK-WH-01', uStart: 24, uSize: 1,
        host: 'sw-wh-01', ip: '10.20.0.10', mgmt: '10.253.0.10',
        firmware: '17.6.5', parentTag: null,
        licenses: [],
      },
      {
        tag: 'DEMO-SRV-WH', category: 'Server', brand: 'HPE', model: 'ProLiant DL380',
        role: 'Physical Server', location: LOC.wh, rack: 'RACK-WH-01', uStart: 10, uSize: 2,
        host: 'inv-wh-01', ip: '10.20.10.5', mgmt: '10.253.10.5',
        firmware: 'Windows Server 2019', parentTag: 'DEMO-SW-WH',
        licenses: ['DEMO Windows Server Datacenter'],
        specsExtra: { cpu: 'Intel i5-1235U', ram: '16GB', storage: '1TB SSD', os: 'Windows Server 2019' },
      },
    ];

    // Cross-site parent: Istanbul firewall uplinks conceptually to HQ firewall
    devices.find((d) => d.tag === 'DEMO-FW-IST').parentTag = 'DEMO-FW-HQ';

    const idByTag = {};
    let macSeq = 1;
    for (const d of devices) {
      const specs = {
        hostname: d.host,
        ipAddress: d.ip,
        cpu: (d.specsExtra && d.specsExtra.cpu) || null,
        ram: (d.specsExtra && d.specsExtra.ram) || null,
        storage: (d.specsExtra && d.specsExtra.storage) || null,
        os: (d.specsExtra && d.specsExtra.os) || null,
      };
      const macN = macSeq++;
      const mac = `02:DE:40:00:${String(macN).padStart(2, '0')}:${String((macN * 7) % 256).padStart(2, '0')}`;
      const { rows } = await t.query(
        `INSERT INTO assets (
           asset_tag, serial_number, brand, model, category, mac_ethernet, specs, status,
           warranty_end_date, purchase_date, qr_code_string, location, notes,
           responsible_employee_id, responsible_employee_name,
           infra_role, rack, rack_unit, rack_u_start, rack_u_size,
           firmware_version, firmware_updated_at, mgmt_ip
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,'In Stock',
           $8,$9,$10,$11,$12,
           $13,$14,
           $15,$16,$17,$18,$19,
           $20,$21,$22
         ) RETURNING id`,
        [
          d.tag,
          `SN-${d.tag}`,
          d.brand,
          d.model,
          d.category,
          mac,
          JSON.stringify(specs),
          new Date(Date.now() + 180 * 86400000),
          new Date(Date.now() - 400 * 86400000),
          qr(d.tag),
          d.location,
          d.notes || 'DEMO infra sample — safe to delete (asset_tag DEMO-*)',
          owner.id,
          owner.full_name,
          d.role,
          d.rack,
          rackLabel(d.uStart, d.uSize),
          d.uStart,
          d.uSize,
          d.firmware,
          new Date(Date.now() - 30 * 86400000),
          d.mgmt,
        ]
      );
      idByTag[d.tag] = rows[0].id;

      for (const licName of d.licenses || []) {
        const lid = licenseIds[licName];
        if (!lid) continue;
        await t.query(
          'INSERT INTO asset_licenses (asset_id, license_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [rows[0].id, lid]
        );
      }
      if ((d.licenses || []).length) {
        await t.query('UPDATE assets SET license_id = $2 WHERE id = $1',
          [rows[0].id, licenseIds[d.licenses[0]]]);
      }
    }

    // Wire parent_asset_id
    for (const d of devices) {
      if (!d.parentTag) continue;
      const parentId = idByTag[d.parentTag];
      if (!parentId) continue;
      await t.query('UPDATE assets SET parent_asset_id = $2 WHERE id = $1',
        [idByTag[d.tag], parentId]);
    }

    console.log(`[seed:infra] inserted ${devices.length} devices across ${Object.keys(LOC).length} locations`);
    console.log('[seed:infra] locations:', Object.values(LOC).join(' · '));
    console.log('[seed:infra] open #/network?view=topo  and  #/network?view=racks');
    console.log('[seed:infra] filter by location to isolate a site');
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed:infra] failed:', err.message);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
