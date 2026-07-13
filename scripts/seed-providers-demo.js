#!/usr/bin/env node
/**
 * Seed sample providers + contracts for the Providers & Contracts screen.
 *
 * Idempotent: removes previous DEMO-* providers (and their contracts), then
 * inserts a realistic Turkish IT vendor mix with renewals soon / later / expired.
 *
 *   npm run seed:providers
 *   docker compose exec api npm run seed:providers
 */
require('dotenv').config();
const config = require('../src/config');

if (config.backend !== 'postgres') {
  console.error('seed:providers runs in DATA_BACKEND=postgres mode only.');
  process.exit(1);
}

const { withTransaction, pool } = require('../src/providers/postgres/pool');
const { ensureDatabase } = require('../src/providers/postgres/migrate');

function daysFromNow(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  await ensureDatabase();

  await withTransaction(async (t) => {
    // Prefer an IT employee as internal contract owner.
    let { rows: emps } = await t.query(
      `SELECT id, full_name FROM employees
       WHERE status = 'Active'
       ORDER BY CASE
         WHEN department ILIKE '%teknoloji%' OR department ILIKE '%IT%' THEN 0
         ELSE 1
       END, full_name
       LIMIT 1`
    );
    if (!emps[0]) {
      const ins = await t.query(
        `INSERT INTO employees (full_name, email, department, title, status)
         VALUES ('Contract Demo Owner', 'contracts.demo@firma.com.tr', 'Bilgi Teknolojileri', 'IT Müdürü', 'Active')
         RETURNING id, full_name`
      );
      emps = ins.rows;
    }
    const owner = emps[0];
    console.log(`[seed:providers] internal owner → ${owner.full_name}`);

    // Wipe previous demo rows (contracts first via CASCADE/RESTRICT — delete by name prefix).
    await t.query(`
      DELETE FROM contracts
      WHERE provider_id IN (SELECT id FROM providers WHERE name LIKE 'DEMO %')
         OR title LIKE 'DEMO %'
         OR contract_number LIKE 'DEMO-%'`);
    await t.query(`DELETE FROM providers WHERE name LIKE 'DEMO %'`);

    const providers = [
      {
        name: 'DEMO TurkNet',
        category: 'ISP',
        status: 'Active',
        website: 'https://www.turk.net',
        phone: '0850 222 0 860',
        email: 'kurumsal@turk.net',
        support_email: 'destek@turk.net',
        support_phone: '0850 222 0 860',
        support_portal: 'https://portal.turk.net',
        account_number: 'TN-88421',
        contact_name: 'Ayşe Kaya',
        contact_role: 'Kurumsal Hesap Yöneticisi',
        contact_email: 'ayse.kaya@turk.net',
        contact_phone: '0532 111 22 33',
        notes: 'HQ fiber + yedek link. Kesinti ticket’ları portal üzerinden açılır.',
      },
      {
        name: 'DEMO Turkcell Business',
        category: 'Telco',
        status: 'Active',
        website: 'https://www.turkcell.com.tr/kurumsal',
        phone: '0850 222 0 532',
        email: 'kurumsal@turkcell.com.tr',
        support_email: 'destek.kurumsal@turkcell.com.tr',
        support_phone: '532',
        support_portal: 'https://kurumsal.turkcell.com.tr',
        account_number: 'TC-BIZ-12045',
        contact_name: 'Mehmet Demir',
        contact_role: 'Mobil Filo Danışmanı',
        contact_email: 'mehmet.demir@turkcell.com.tr',
        contact_phone: '0533 444 55 66',
        notes: 'Şirket hatları ve M2M SIM’ler. Aylık fatura IT’ye gelir.',
      },
      {
        name: 'DEMO Microsoft',
        category: 'Cloud',
        status: 'Active',
        website: 'https://www.microsoft.com',
        phone: '+90 212 385 00 00',
        email: 'turkey@microsoft.com',
        support_email: 'support@microsoft.com',
        support_portal: 'https://admin.microsoft.com',
        account_number: 'MS-TENANT-DEMO',
        contact_name: 'CSP Partner Desk',
        contact_role: 'Partner support',
        contact_email: 'csp-demo@partner.microsoft.com',
        contact_phone: null,
        notes: 'M365 E3 + Azure sponsorluk. CSP üzerinden yenilenir.',
      },
      {
        name: 'DEMO Fortinet Partner TR',
        category: 'Security',
        status: 'Active',
        website: 'https://www.fortinet.com',
        phone: '+90 216 000 00 00',
        email: 'tr-sales@fortinet-partner.example',
        support_email: 'tac@fortinet.com',
        support_phone: '+1 408 235 7700',
        support_portal: 'https://support.fortinet.com',
        account_number: 'FG-CUST-7781',
        contact_name: 'Can Öztürk',
        contact_role: 'Teknik Satış',
        contact_email: 'can.ozturk@fortinet-partner.example',
        contact_phone: '0530 777 88 99',
        notes: 'Firewall / AP bakım ve 7×24 RMA.',
      },
      {
        name: 'DEMO Dell Technologies',
        category: 'Hardware',
        status: 'Active',
        website: 'https://www.dell.com',
        phone: '0850 222 33 55',
        email: 'tr-enterprise@dell.com',
        support_email: 'support_emea@dell.com',
        support_portal: 'https://www.dell.com/support',
        account_number: 'DELL-ENT-5520',
        contact_name: 'Zeynep Arslan',
        contact_role: 'Account Executive',
        contact_email: 'zeynep.arslan@dell.com',
        contact_phone: '0532 999 00 11',
        notes: 'Sunucu / storage ProSupport Plus.',
      },
      {
        name: 'DEMO CloudOps MSP',
        category: 'MSP',
        status: 'Active',
        website: 'https://cloudops-demo.example',
        phone: '+90 212 555 01 01',
        email: 'hello@cloudops-demo.example',
        support_email: 'noc@cloudops-demo.example',
        support_phone: '+90 212 555 01 02',
        support_portal: 'https://ticket.cloudops-demo.example',
        account_number: 'MSP-ITACM-01',
        contact_name: 'Burak Yılmaz',
        contact_role: 'Servis Müdürü',
        contact_email: 'burak.yilmaz@cloudops-demo.example',
        contact_phone: '0535 222 33 44',
        notes: '7×24 NOC + patch management retainer.',
      },
      {
        name: 'DEMO Eski Hosting Ltd',
        category: 'Other',
        status: 'Inactive',
        website: null,
        phone: '0212 000 00 00',
        email: 'info@eski-hosting.example',
        support_email: null,
        support_phone: null,
        support_portal: null,
        account_number: 'OLD-99',
        contact_name: null,
        contact_role: null,
        contact_email: null,
        contact_phone: null,
        notes: 'Eski hosting — migrasyon tamamlandı, kayıt arşiv.',
      },
    ];

    const providerIds = {};
    for (const p of providers) {
      const { rows } = await t.query(
        `INSERT INTO providers (
           name, category, status, website, phone, email,
           support_email, support_phone, support_portal,
           account_number, contact_name, contact_role, contact_email, contact_phone, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, name`,
        [
          p.name, p.category, p.status, p.website, p.phone, p.email,
          p.support_email, p.support_phone, p.support_portal,
          p.account_number, p.contact_name, p.contact_role, p.contact_email, p.contact_phone,
          p.notes || '',
        ]
      );
      providerIds[p.name] = rows[0].id;
      console.log(`[seed:providers] + ${rows[0].name}`);
    }

    const contracts = [
      {
        provider: 'DEMO TurkNet',
        title: 'DEMO HQ Fiber 1 Gbps',
        contract_number: 'DEMO-TN-FIBER-2024',
        category: 'Connectivity',
        status: 'Active',
        start: daysFromNow(-400),
        end: daysFromNow(25),
        renewal: daysFromNow(10),
        notice: 30,
        auto: true,
        amount: 18500,
        currency: 'TRY',
        cycle: 'Monthly',
        notes: 'Ana ofis fiber. Yenileme ≤30 gün — fiyat revizyonu bekleniyor.',
      },
      {
        provider: 'DEMO TurkNet',
        title: 'DEMO Istanbul Branch Yedek Link',
        contract_number: 'DEMO-TN-BACKUP-IST',
        category: 'Connectivity',
        status: 'Active',
        start: daysFromNow(-200),
        end: daysFromNow(180),
        renewal: daysFromNow(150),
        notice: 30,
        auto: true,
        amount: 4200,
        currency: 'TRY',
        cycle: 'Monthly',
        notes: 'Şube yedek 100 Mbps.',
      },
      {
        provider: 'DEMO Turkcell Business',
        title: 'DEMO Kurumsal Mobil Filo',
        contract_number: 'DEMO-TC-FLEET-88',
        category: 'Connectivity',
        status: 'Active',
        start: daysFromNow(-90),
        end: daysFromNow(275),
        renewal: daysFromNow(245),
        notice: 60,
        auto: false,
        amount: 42000,
        currency: 'TRY',
        cycle: 'Monthly',
        notes: '45 hat + 10 data-only SIM.',
      },
      {
        provider: 'DEMO Microsoft',
        title: 'DEMO Microsoft 365 E3',
        contract_number: 'DEMO-M365-E3',
        category: 'SaaS',
        status: 'Active',
        start: daysFromNow(-300),
        end: daysFromNow(55),
        renewal: daysFromNow(40),
        notice: 45,
        auto: true,
        amount: 18600,
        currency: 'EUR',
        cycle: 'Annual',
        notes: '120 koltuk. CSP yıllık taahhüt.',
      },
      {
        provider: 'DEMO Microsoft',
        title: 'DEMO Azure Consumption',
        contract_number: 'DEMO-AZURE-PAYG',
        category: 'SaaS',
        status: 'Active',
        start: daysFromNow(-60),
        end: null,
        renewal: null,
        notice: null,
        auto: false,
        amount: 2500,
        currency: 'USD',
        cycle: 'Monthly',
        notes: 'Pay-as-you-go — bitiş tarihi yok, aylık tavan izlenir.',
      },
      {
        provider: 'DEMO Fortinet Partner TR',
        title: 'DEMO FortiCare 24×7 + UTM Bundle',
        contract_number: 'DEMO-FG-CARE-01',
        category: 'Support',
        status: 'Active',
        start: daysFromNow(-100),
        end: daysFromNow(12),
        renewal: daysFromNow(5),
        notice: 14,
        auto: false,
        amount: 9800,
        currency: 'USD',
        cycle: 'Annual',
        notes: 'Firewall bakım — acil yenileme (≤14 gün).',
      },
      {
        provider: 'DEMO Dell Technologies',
        title: 'DEMO ProSupport Plus — Rack Servers',
        contract_number: 'DEMO-DELL-PSP-42',
        category: 'Hardware',
        status: 'Active',
        start: daysFromNow(-500),
        end: daysFromNow(220),
        renewal: daysFromNow(190),
        notice: 90,
        auto: false,
        amount: 14500,
        currency: 'USD',
        cycle: 'Annual',
        notes: '3 sunucu + 1 storage NBD/4H seçenekleri.',
      },
      {
        provider: 'DEMO CloudOps MSP',
        title: 'DEMO Managed NOC Retainer',
        contract_number: 'DEMO-MSP-NOC-2025',
        category: 'MSP',
        status: 'Active',
        start: daysFromNow(-30),
        end: daysFromNow(335),
        renewal: daysFromNow(305),
        notice: 60,
        auto: true,
        amount: 28000,
        currency: 'TRY',
        cycle: 'Monthly',
        notes: 'Patch, monitoring, on-call. SLA ekli.',
      },
      {
        provider: 'DEMO CloudOps MSP',
        title: 'DEMO Penetration Test 2025',
        contract_number: 'DEMO-MSP-PENTEST',
        category: 'Security',
        status: 'Draft',
        start: daysFromNow(20),
        end: daysFromNow(50),
        renewal: null,
        notice: null,
        auto: false,
        amount: 75000,
        currency: 'TRY',
        cycle: 'One-time',
        notes: 'Tek seferlik dış sızma testi teklifi — onay bekliyor.',
      },
      {
        provider: 'DEMO Eski Hosting Ltd',
        title: 'DEMO Shared Hosting (Arşiv)',
        contract_number: 'DEMO-OLD-HOST-2019',
        category: 'Other',
        status: 'Expired',
        start: daysFromNow(-1200),
        end: daysFromNow(-90),
        renewal: null,
        notice: 30,
        auto: false,
        amount: 1200,
        currency: 'TRY',
        cycle: 'Annual',
        notes: 'Süre doldu — kayıt tutuluyor.',
      },
      {
        provider: 'DEMO Turkcell Business',
        title: 'DEMO Eski Data Paketi',
        contract_number: 'DEMO-TC-OLD-DATA',
        category: 'Connectivity',
        status: 'Cancelled',
        start: daysFromNow(-400),
        end: daysFromNow(-60),
        renewal: null,
        notice: null,
        auto: false,
        amount: 8000,
        currency: 'TRY',
        cycle: 'Monthly',
        notes: 'Filoya geçiş sonrası iptal.',
      },
    ];

    for (const c of contracts) {
      const providerId = providerIds[c.provider];
      if (!providerId) throw new Error(`Missing provider ${c.provider}`);
      await t.query(
        `INSERT INTO contracts (
           provider_id, title, contract_number, category, status,
           start_date, end_date, renewal_date, notice_days, auto_renew,
           cost_amount, cost_currency, billing_cycle,
           owner_employee_id, owner_employee_name, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          providerId,
          c.title,
          c.contract_number,
          c.category,
          c.status,
          c.start,
          c.end,
          c.renewal,
          c.notice,
          c.auto,
          c.amount,
          c.currency,
          c.cycle,
          owner.id,
          owner.full_name,
          c.notes || '',
        ]
      );
      console.log(`[seed:providers]   ↳ ${c.title} (${c.status})`);
    }

    console.log(`[seed:providers] done — ${providers.length} providers, ${contracts.length} contracts`);
  });
}

main()
  .catch((err) => {
    console.error('[seed:providers] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
