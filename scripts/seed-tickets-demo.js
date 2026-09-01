#!/usr/bin/env node
/**
 * Seed a realistic service-desk dataset: incidents, requests, comment threads,
 * activity trails, SLA clocks and closure surveys.
 *
 * Two layers. The *shape* layer is a hand-written set where every status,
 * priority and closure path appears at least once, spread over the last two
 * months. The *history* layer generates a year of traffic on top, sized from the
 * headcount, so a 200-person instance looks like a 200-person instance: trends
 * that build over months, a realistic closed/open ratio, SLA breaches at a
 * believable rate, and satisfaction scores on a fraction of what closed.
 *
 * The generator is deterministic (fixed PRNG seed): re-running produces the same
 * dataset, so a screenshot taken today still matches the data tomorrow.
 *
 * Sizing: SEED_TICKET_HISTORY=0 turns the history layer off; any other number
 * overrides the headcount-derived default.
 *
 * Idempotent: previously seeded tickets are removed first (comments and activity
 * cascade), so running it twice does not double the dataset.
 *
 *   npm run seed:tickets
 *   docker compose exec api npm run seed:tickets
 */
require('dotenv').config();
const config = require('../src/config');

if (config.backend !== 'postgres') {
  console.error('seed:tickets runs in DATA_BACKEND=postgres mode only.');
  process.exit(1);
}

const { query, withTransaction, pool } = require('../src/providers/postgres/pool');
const { ensureDatabase } = require('../src/providers/postgres/migrate');

// Every row this script writes carries this marker so a re-run can find and
// remove exactly its own tickets without touching anything a human created.
const SEED_MARK = 'Demo Seed';

const CATEGORIES = [
  'Donanım', 'Yazılım', 'Ağ / İnternet', 'E-posta', 'Yazıcı',
  'Hesap ve Erişim', 'Telefon / Hat', 'Lisans', 'Diğer',
];

// Mirrors ticketService: the generated history must obey the same Impact ×
// Urgency derivation and the same SLA windows the app applies, or the reports
// drawn from it would describe rules that do not exist.
const PRIORITY_MATRIX = {
  high: { high: 'urgent', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
};
const SLA_TARGETS = {
  urgent: { response: 30, resolve: 240 },
  high: { response: 60, resolve: 480 },
  medium: { response: 240, resolve: 1440 },
  low: { response: 480, resolve: 2880 },
};

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
const daysAgo = (d) => hoursAgo(d * 24);

/**
 * Deterministic PRNG (mulberry32). A demo dataset that reshuffles on every run
 * makes "is this a bug or just new random data?" impossible to answer.
 */
function rng(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng();
const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const between = (lo, hi) => lo + rand() * (hi - lo);

/**
 * Move a timestamp onto a plausible working moment: weekdays, 08:00–18:30, with
 * a lunch dip. Tickets opened uniformly around the clock would make the
 * hour-of-day and weekday charts obviously synthetic.
 */
function workingMoment(date) {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() + 1);        // Sunday → Monday
  else if (day === 6) d.setDate(d.getDate() + 2);   // Saturday → Monday
  const hour = chance(0.12) ? Math.floor(between(12, 13)) : Math.floor(between(8, 18));
  d.setHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
  return d;
}

/**
 * The dataset. Times are expressed as "hours ago" so the set stays fresh
 * whenever it is seeded — a fixed calendar date would age into meaninglessness.
 */
const TICKETS = [
  // ---- Kapanmis, cozulmus, memnuniyet puani verilmis -----------------------
  {
    type: 'incident', subject: 'Toplantı odası projeksiyonu görüntü vermiyor',
    description: 'B blok 3. kat toplantı odasındaki projeksiyon HDMI kablosuyla görüntü almıyor. Sunum 14:00 için gerekli.',
    status: 'closed', priority: 'high', category: 'Donanım',
    impact: 'medium', urgency: 'high',
    createdAgo: 24 * 21, firstResponseAgo: 24 * 21 - 1, resolvedAgo: 24 * 21 - 4, closedAgo: 24 * 20,
    responseDueAgo: 24 * 21 - 2, resolveDueAgo: 24 * 21 - 8,
    resolutionCode: 'fixed', resolutionNote: 'HDMI kablosu arızalıydı, yedek kabloyla değiştirildi.',
    csat: 5, csatComment: 'Çok hızlı çözüldü, teşekkürler.',
    comments: [
      { body: 'Odaya çıkıyorum, 10 dakikaya oradayım.', internal: false, agoOffset: 1 },
      { body: 'Kablo test cihazında kopuk çıktı. Depodan yedek alındı.', internal: true, agoOffset: 3 },
      { body: 'Değiştirildi, görüntü geldi. Sunum öncesi test edildi.', internal: false, agoOffset: 4 },
    ],
  },
  {
    type: 'request', subject: 'Yeni başlayan personel için dizüstü bilgisayar',
    description: 'Pazartesi başlayacak yeni satış temsilcisi için dizüstü, çanta ve mouse talebi.',
    status: 'closed', priority: 'medium', category: 'Donanım',
    impact: 'low', urgency: 'medium',
    createdAgo: 24 * 30, firstResponseAgo: 24 * 30 - 3, resolvedAgo: 24 * 27, closedAgo: 24 * 26,
    responseDueAgo: 24 * 30 - 8, resolveDueAgo: 24 * 25,
    resolutionCode: 'fixed', resolutionNote: 'Dizüstü kuruldu, zimmet tutanağı imzalandı.',
    csat: 4, csatComment: 'Biraz geç oldu ama sorunsuz.',
    comments: [
      { body: 'Talep alındı. Stokta uygun model var, kuruluma alıyorum.', internal: false, agoOffset: 3 },
      { body: 'Standart imaj yüklendi, ofis lisansı atandı.', internal: true, agoOffset: 48 },
      { body: 'Cihaz hazır, zimmet için İK ile randevu verildi.', internal: false, agoOffset: 70 },
    ],
  },
  {
    type: 'incident', subject: 'Kullanıcı parolasını unuttu',
    description: 'Muhasebe departmanından bir kullanıcı domain parolasını hatırlamıyor.',
    status: 'closed', priority: 'low', category: 'Hesap ve Erişim',
    impact: 'low', urgency: 'low',
    createdAgo: 24 * 12, firstResponseAgo: 24 * 12 - 0.5, resolvedAgo: 24 * 12 - 1, closedAgo: 24 * 11,
    responseDueAgo: 24 * 12 - 4, resolveDueAgo: 24 * 11,
    resolutionCode: 'user_education', resolutionNote: 'Parola sıfırlandı, parola yöneticisi kullanımı anlatıldı.',
    csat: 5, csatComment: null,
    comments: [
      { body: 'Kimlik doğrulaması yapıldı, geçici parola verildi.', internal: false, agoOffset: 0.5 },
    ],
  },

  // ---- Cozulmus ama henuz kapanmamis --------------------------------------
  {
    type: 'incident', subject: 'Depo yazıcısı kağıt sıkıştırıyor',
    description: 'Depo katındaki yazıcı her 5-6 sayfada bir kağıt sıkıştırıyor. Sevkiyat etiketleri basılamıyor.',
    status: 'resolved', priority: 'medium', category: 'Yazıcı',
    impact: 'medium', urgency: 'medium',
    createdAgo: 24 * 4, firstResponseAgo: 24 * 4 - 2, resolvedAgo: 24 * 1,
    responseDueAgo: 24 * 4 - 4, resolveDueAgo: 24 * 1 + 6,
    resolutionCode: 'fixed', resolutionNote: 'Besleme silindiri temizlendi, aşınan ayırıcı pad değiştirildi.',
    comments: [
      { body: 'Yerinde baktım, besleme silindirinde toz birikmiş.', internal: true, agoOffset: 2 },
      { body: 'Temizlik ve parça değişimi yapıldı, 50 sayfa test basıldı, sorun yok.', internal: false, agoOffset: 72 },
    ],
  },
  {
    type: 'request', subject: 'Ek monitör talebi',
    description: 'Yazılım ekibinden iki kişi için ikinci monitör talebi.',
    status: 'resolved', priority: 'low', category: 'Donanım',
    impact: 'low', urgency: 'low',
    createdAgo: 24 * 9, firstResponseAgo: 24 * 9 - 5, resolvedAgo: 24 * 2,
    responseDueAgo: 24 * 9 - 8, resolveDueAgo: 24 * 1,
    resolutionCode: 'fixed', resolutionNote: 'Depodaki iki adet 24 inç monitör zimmetlendi.',
    comments: [
      { body: 'Stokta iki monitör var, ayırdım.', internal: true, agoOffset: 5 },
    ],
  },

  // ---- Aktif calisilan ----------------------------------------------------
  {
    type: 'incident', subject: 'VPN bağlantısı sürekli kopuyor',
    description: 'Uzaktan çalışan üç kullanıcı VPN bağlantısının 10-15 dakikada bir koptuğunu bildiriyor.',
    status: 'in_progress', priority: 'high', category: 'Ağ / İnternet',
    impact: 'high', urgency: 'high',
    createdAgo: 30, firstResponseAgo: 29,
    responseDueAgo: 28, resolveDueAgo: -18,
    comments: [
      { body: 'Üç kullanıcıda da aynı saatlerde kopma var, ortak nokta arıyorum.', internal: true, agoOffset: 1 },
      { body: 'Firewall oturum zaman aşımı ayarına bakıyoruz, güncelleme geldiğinde haber vereceğim.', internal: false, agoOffset: 6 },
      { body: 'Log analizi: kopmalar yedekleme penceresiyle çakışıyor. Bant genişliği şüphesi.', internal: true, agoOffset: 20 },
    ],
  },
  {
    type: 'incident', subject: 'ERP raporları çok yavaş açılıyor',
    description: 'Ay sonu raporları 5 dakikadan uzun sürüyor, bazen zaman aşımına düşüyor.',
    status: 'in_progress', priority: 'urgent', category: 'Yazılım',
    impact: 'high', urgency: 'high',
    createdAgo: 8, firstResponseAgo: 7.5,
    responseDueAgo: 7, resolveDueAgo: -4,
    comments: [
      { body: 'Veritabanı tarafında uzun süren sorgu var, indeks eksikliği olabilir.', internal: true, agoOffset: 1 },
      { body: 'Tedarikçiye ticket açıldı, öncelikli olarak işaretlendi.', internal: false, agoOffset: 3 },
    ],
  },
  {
    type: 'request', subject: 'Yeni CRM lisansı talebi',
    description: 'Satış ekibine katılan iki kişi için CRM kullanıcı lisansı gerekiyor.',
    status: 'open', priority: 'medium', category: 'Lisans',
    impact: 'medium', urgency: 'medium',
    createdAgo: 20, firstResponseAgo: 19,
    responseDueAgo: 16, resolveDueAgo: -50,
    comments: [
      { body: 'Bütçe onayı için yöneticiye iletildi.', internal: false, agoOffset: 1 },
    ],
  },

  // ---- Bekleyen (uçuncu tarafa ya da kullaniciya bagli) --------------------
  {
    type: 'incident', subject: 'Fiber hat kesintisi — şube',
    description: 'İstanbul şubesinde internet tamamen kesik. Operatöre arıza kaydı açıldı.',
    status: 'pending', priority: 'urgent', category: 'Telefon / Hat',
    impact: 'high', urgency: 'high',
    createdAgo: 14, firstResponseAgo: 13.5,
    responseDueAgo: 13, resolveDueAgo: -10,
    comments: [
      { body: 'Operatör arıza kaydı: TT-884213. Ekip yönlendirildi.', internal: false, agoOffset: 0.5 },
      { body: 'Operatör tahmini çözüm süresi 6 saat verdi. Yedek 4G modem devrede.', internal: true, agoOffset: 2 },
    ],
  },
  {
    type: 'request', subject: 'Muhasebe klasörüne erişim yetkisi',
    description: 'Yeni muhasebe uzmanı için paylaşımlı klasör okuma-yazma yetkisi talebi.',
    status: 'pending', priority: 'low', category: 'Hesap ve Erişim',
    impact: 'low', urgency: 'low',
    createdAgo: 40, firstResponseAgo: 38,
    responseDueAgo: 32, resolveDueAgo: -80,
    comments: [
      { body: 'Departman yöneticisinin onayı bekleniyor.', internal: false, agoOffset: 2 },
    ],
  },

  // ---- Yeni, henuz dokunulmamis -------------------------------------------
  {
    type: 'incident', subject: 'Outlook takvim davetleri gitmiyor',
    description: 'Bir kullanıcı gönderdiği toplantı davetlerinin karşı tarafa ulaşmadığını söylüyor.',
    status: 'new', priority: 'medium', category: 'E-posta',
    impact: 'medium', urgency: 'medium',
    createdAgo: 3,
    responseDueAgo: -1, resolveDueAgo: -21,
    comments: [],
  },
  {
    type: 'incident', subject: 'Kamera kaydı görüntülenemiyor',
    description: 'Güvenlik kamerası arşivinden geçen haftanın kaydı açılmıyor.',
    status: 'new', priority: 'low', category: 'Donanım',
    impact: 'low', urgency: 'low',
    createdAgo: 6,
    responseDueAgo: -2, resolveDueAgo: -42,
    comments: [],
  },
  {
    type: 'request', subject: 'Ekran kartı yükseltmesi',
    description: 'Tasarım ekibinden bir kullanıcı 3B render için ekran kartı yükseltmesi talep ediyor.',
    status: 'new', priority: 'low', category: 'Donanım',
    impact: 'low', urgency: 'low',
    createdAgo: 1.5,
    responseDueAgo: -6, resolveDueAgo: -70,
    comments: [],
  },

  // ---- SLA ihlali yasanmis olanlar ----------------------------------------
  {
    type: 'incident', subject: 'Kasa yazıcısı fiş basmıyor',
    description: 'Mağaza kasasındaki fiş yazıcısı hiç çıktı vermiyor, satış kapanışı yapılamıyor.',
    status: 'open', priority: 'urgent', category: 'Yazıcı',
    impact: 'high', urgency: 'high',
    createdAgo: 26, firstResponseAgo: 20,
    responseDueAgo: 25, resolveDueAgo: 8,
    responseBreachedAgo: 25, resolveBreachedAgo: 8,
    comments: [
      { body: 'Geç dönüş için özür dileriz, hafta sonu nöbeti devrede değildi.', internal: false, agoOffset: 6 },
      { body: 'Yedek yazıcı gönderildi, arızalı cihaz servise alınacak.', internal: true, agoOffset: 7 },
    ],
  },
  {
    type: 'incident', subject: 'Ortak alan diski dolu',
    description: 'Paylaşımlı dosya sunucusunda yer kalmadı, kullanıcılar kayıt yapamıyor.',
    status: 'resolved', priority: 'high', category: 'Yazılım',
    impact: 'high', urgency: 'medium',
    createdAgo: 24 * 6, firstResponseAgo: 24 * 6 - 1, resolvedAgo: 24 * 5,
    responseDueAgo: 24 * 6 - 2, resolveDueAgo: 24 * 5 + 10,
    resolveBreachedAgo: 24 * 5 + 10,
    resolutionCode: 'workaround', resolutionNote: 'Eski arşiv yedek diske taşındı. Kalıcı çözüm için disk genişletme planlandı.',
    comments: [
      { body: 'Acil olarak 200 GB arşiv taşındı, kullanıcılar tekrar yazabiliyor.', internal: false, agoOffset: 20 },
      { body: 'Kalıcı çözüm ayrı bir talep olarak açılacak.', internal: true, agoOffset: 22 },
    ],
  },

  // ---- Farkli kapanis yollari ---------------------------------------------
  {
    type: 'incident', subject: 'Ekranda yeşil çizgiler',
    description: 'Kullanıcı monitöründe zaman zaman yeşil yatay çizgiler görüldüğünü bildirdi.',
    status: 'closed', priority: 'low', category: 'Donanım',
    impact: 'low', urgency: 'low',
    createdAgo: 24 * 16, firstResponseAgo: 24 * 16 - 2, resolvedAgo: 24 * 15, closedAgo: 24 * 14,
    responseDueAgo: 24 * 16 - 6, resolveDueAgo: 24 * 13,
    resolutionCode: 'not_reproducible', resolutionNote: 'Üç gün gözlemlendi, sorun tekrarlamadı. Kullanıcı tekrarında yeniden açacak.',
    csat: 3, csatComment: 'Sorun tekrar ederse ne yapacağımı bilmiyorum.',
    comments: [
      { body: 'Kabloyu değiştirip üç gün gözlemleyelim.', internal: false, agoOffset: 2 },
      { body: 'Üç gün boyunca tekrar etmedi.', internal: true, agoOffset: 24 },
    ],
  },
  {
    type: 'incident', subject: 'E-posta gelmiyor (aynı konu ikinci kayıt)',
    description: 'Kullanıcı aynı sorun için ikinci kez kayıt açtı.',
    status: 'closed', priority: 'medium', category: 'E-posta',
    impact: 'medium', urgency: 'medium',
    createdAgo: 24 * 10, firstResponseAgo: 24 * 10 - 1, resolvedAgo: 24 * 10 - 1, closedAgo: 24 * 10 - 1,
    responseDueAgo: 24 * 10 - 4, resolveDueAgo: 24 * 9,
    resolutionCode: 'duplicate', resolutionNote: 'Aynı konudaki önceki kayıtla birleştirildi.',
    comments: [
      { body: 'Bu kayıt önceki talebinizle aynı konuda, oradan devam ediyoruz.', internal: false, agoOffset: 1 },
    ],
  },
  {
    type: 'incident', subject: 'Klavye tuşları takılıyor',
    description: 'Kullanıcı klavyesinde birkaç tuşun takıldığını bildirdi.',
    status: 'closed', priority: 'low', category: 'Donanım',
    impact: 'low', urgency: 'low',
    createdAgo: 24 * 8, firstResponseAgo: 24 * 8 - 3, resolvedAgo: 24 * 8 - 4, closedAgo: 24 * 7,
    responseDueAgo: 24 * 8 - 6, resolveDueAgo: 24 * 7,
    resolutionCode: 'no_fault', resolutionNote: 'Klavye temizlendi, donanım arızası bulunamadı.',
    csat: 4, csatComment: null,
    comments: [],
  },
  {
    type: 'request', subject: 'Toplantı odasına konferans telefonu',
    description: 'Büyük toplantı odası için konferans telefonu talebi.',
    status: 'cancelled', priority: 'low', category: 'Telefon / Hat',
    impact: 'low', urgency: 'low',
    createdAgo: 24 * 18, firstResponseAgo: 24 * 18 - 6, closedAgo: 24 * 15,
    responseDueAgo: 24 * 18 - 8, resolveDueAgo: 24 * 12,
    comments: [
      { body: 'Talep sahibi bütçe döneminde tekrar değerlendirileceğini belirterek kaydı kapattı.', internal: false, agoOffset: 72 },
    ],
  },
];

async function main() {
  await ensureDatabase();

  await withTransaction(async (t) => {
    // --- Kategori listesini ayarlara yaz --------------------------------------
    // The ticket form reads this list; without it the category dropdown only
    // offers values that already appear on existing tickets.
    const { rows: setRows } = await t.query(
      'SELECT ticket_categories_json FROM app_settings WHERE id = 1'
    );
    const existing = (setRows[0] && setRows[0].ticket_categories_json) || [];
    const merged = [...new Set([...(Array.isArray(existing) ? existing : []), ...CATEGORIES])];
    await t.query(
      'UPDATE app_settings SET ticket_categories_json = $1::jsonb WHERE id = 1',
      [JSON.stringify(merged)]
    );

    // --- Onceki demo kayitlarini temizle --------------------------------------
    // Comments and activity carry ON DELETE CASCADE, so removing the tickets is
    // enough. Only rows this script wrote are touched.
    const { rowCount: removed } = await t.query(
      'DELETE FROM tickets WHERE created_by_name = $1',
      [SEED_MARK]
    );

    // --- Baglanacak gercek kayitlari topla ------------------------------------
    // Tickets look hollow without a requester and an affected asset, so the seed
    // reuses whatever the other demo scripts already created.
    const { rows: employees } = await t.query(
      'SELECT id, full_name FROM employees ORDER BY created_at LIMIT 25'
    );
    const { rows: agents } = await t.query(
      "SELECT id, username FROM users WHERE role IN ('Admin', 'Helpdesk') ORDER BY created_at LIMIT 5"
    );
    const { rows: assets } = await t.query(
      'SELECT id, asset_tag FROM assets ORDER BY created_at LIMIT 25'
    );

    const pick = (arr, i) => (arr.length ? arr[i % arr.length] : null);

    let created = 0;
    let comments = 0;

    for (let i = 0; i < TICKETS.length; i++) {
      const d = TICKETS[i];

      const seq = d.type === 'request' ? 'ticket_request_seq' : 'ticket_incident_seq';
      const prefix = d.type === 'request' ? 'REQ' : 'INC';
      const { rows: nrows } = await t.query(`SELECT nextval('${seq}') AS n`);
      const number = `${prefix}-${nrows[0].n}`;

      const requester = pick(employees, i);
      const agent = pick(agents, i);
      // Only hardware-flavoured records get an asset; a network outage tied to a
      // single laptop would read as noise.
      const asset = ['Donanım', 'Yazıcı'].includes(d.category) ? pick(assets, i) : null;

      const at = (h) => (h == null ? null : hoursAgo(h));

      const { rows: ins } = await t.query(
        `INSERT INTO tickets (
           number, type, subject, description, status, priority, category,
           impact, urgency,
           requester_employee_id, assignee_user_id, asset_id,
           created_by_name,
           first_response_at, resolved_at, closed_at,
           response_due_at, resolve_due_at,
           response_breached_at, resolve_breached_at,
           resolution_code, resolution_note,
           csat_rating, csat_comment, csat_at,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8,$9,
           $10,$11,$12,
           $13,
           $14,$15,$16,
           $17,$18,
           $19,$20,
           $21,$22,
           $23,$24,$25,
           $26,$26
         ) RETURNING id`,
        [
          number, d.type, d.subject, d.description, d.status, d.priority, d.category,
          d.impact || null, d.urgency || null,
          requester ? requester.id : null,
          // A brand new ticket has not been picked up yet.
          d.status === 'new' ? null : (agent ? agent.id : null),
          asset ? asset.id : null,
          SEED_MARK,
          at(d.firstResponseAgo), at(d.resolvedAgo), at(d.closedAgo),
          at(d.responseDueAgo), at(d.resolveDueAgo),
          at(d.responseBreachedAgo), at(d.resolveBreachedAgo),
          d.resolutionCode || null, d.resolutionNote || null,
          d.csat || null, d.csatComment || null, d.csat ? at(d.closedAgo) : null,
          at(d.createdAgo),
        ]
      );
      const ticketId = ins[0].id;
      created++;

      // --- Yorumlar ----------------------------------------------------------
      for (const c of d.comments || []) {
        await t.query(
          `INSERT INTO ticket_comments (ticket_id, author_name, body, internal, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            ticketId,
            c.internal ? (agent ? agent.username : SEED_MARK) : (requester ? requester.full_name : SEED_MARK),
            c.body, c.internal, at(d.createdAgo - c.agoOffset),
          ]
        );
        comments++;
      }

      // --- Hareket kaydi -----------------------------------------------------
      // The trail mirrors what the app itself would have written, so the ticket
      // detail page does not look suspiciously empty.
      const trail = [['created', `Kayıt açıldı: ${number}`, d.createdAgo]];
      if (d.firstResponseAgo != null) trail.push(['first_response', 'İlk yanıt verildi', d.firstResponseAgo]);
      if (d.status !== 'new') trail.push(['assigned', agent ? `Atandı: ${agent.username}` : 'Atandı', d.firstResponseAgo ?? d.createdAgo]);
      if (d.responseBreachedAgo != null) trail.push(['sla_breach', 'İlk yanıt SLA süresi aşıldı', d.responseBreachedAgo]);
      if (d.resolveBreachedAgo != null) trail.push(['sla_breach', 'Çözüm SLA süresi aşıldı', d.resolveBreachedAgo]);
      if (d.resolvedAgo != null) trail.push(['resolved', d.resolutionNote || 'Çözüldü', d.resolvedAgo]);
      if (d.closedAgo != null) trail.push([d.status === 'cancelled' ? 'cancelled' : 'closed', d.status === 'cancelled' ? 'Talep iptal edildi' : 'Kayıt kapatıldı', d.closedAgo]);
      if (d.csat) trail.push(['csat', `Memnuniyet puanı: ${d.csat}/5`, d.closedAgo]);

      for (const [action, detail, ago] of trail) {
        await t.query(
          `INSERT INTO ticket_activity (ticket_id, actor_name, action, detail, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [ticketId, agent ? agent.username : SEED_MARK, action, detail, at(ago)]
        );
      }
    }

    /* ---------------------------------------------------------------------
     * Gecmis trafigi — hacim katmani
     * ------------------------------------------------------------------- */
    // Sized from headcount so the dataset matches the company it describes:
    // roughly three tickets per person per year, which is what a desk this size
    // actually logs, capped so a huge directory cannot produce a seed that takes
    // minutes to write.
    const { rows: headRows } = await t.query("SELECT count(*)::int AS n FROM employees WHERE status = 'Active'");
    const headcount = (headRows[0] && headRows[0].n) || 0;
    const envHistory = process.env.SEED_TICKET_HISTORY;
    const historyCount = envHistory != null && envHistory !== ''
      ? Math.max(0, Math.min(5000, Number(envHistory) || 0))
      : Math.min(1500, Math.round(headcount * 3));

    let history = 0;
    let historyComments = 0;
    if (historyCount > 0) {
      const { rows: allEmployees } = await t.query(
        "SELECT id, full_name FROM employees WHERE status = 'Active' ORDER BY created_at LIMIT 500"
      );
      const { rows: allAssets } = await t.query('SELECT id FROM assets ORDER BY created_at LIMIT 300');
      const roster = allEmployees.length ? allEmployees : employees;
      const desk = agents.length ? agents : [];

      // Category mix weighted the way a real queue skews, rather than uniform.
      const CATEGORY_MIX = [
        ['Donanım', 0.20], ['Yazılım', 0.18], ['Ağ / İnternet', 0.14], ['E-posta', 0.11],
        ['Yazıcı', 0.10], ['Hesap ve Erişim', 0.12], ['Telefon / Hat', 0.06],
        ['Lisans', 0.05], ['Diğer', 0.04],
      ];
      const pickCategory = () => {
        let r = rand();
        for (const [name, w] of CATEGORY_MIX) { if ((r -= w) <= 0) return name; }
        return 'Diğer';
      };
      const SUBJECTS = {
        'Donanım': ['Laptop açılmıyor', 'Ekran görüntü vermiyor', 'Klavye tuşları çalışmıyor', 'Şarj adaptörü arızalı', 'Docking station tanınmıyor', 'Bilgisayar aşırı ısınıyor'],
        'Yazılım': ['Excel dosyayı açmıyor', 'Uygulama sürekli kapanıyor', 'Windows güncellemesi takıldı', 'Muhasebe programı hata veriyor', 'Tarayıcı çok yavaş'],
        'Ağ / İnternet': ['İnternet kesintisi', 'VPN bağlanmıyor', 'Wi-Fi sürekli düşüyor', 'Ağ sürücüsüne erişilemiyor', 'Toplantı odasında bağlantı yok'],
        'E-posta': ['Outlook senkronize olmuyor', 'Gelen kutusu doldu', 'Toplu e-posta spam\'e düşüyor', 'İmza güncellenmesi', 'Paylaşılan kutuya erişim'],
        'Yazıcı': ['Yazıcı kağıt sıkıştırıyor', 'Toner değişimi', 'Ağ yazıcısı görünmüyor', 'Baskı kalitesi bozuk', 'Tarayıcı fonksiyonu çalışmıyor'],
        'Hesap ve Erişim': ['Parola sıfırlama', 'Yeni klasör yetkisi', 'Hesap kilitlendi', 'Portal erişimi talebi', 'Ortak sürücü yetkisi'],
        'Telefon / Hat': ['Hat açılmıyor', 'Yeni SIM talebi', 'Kurumsal hat devri', 'Yurt dışı kullanım açılması'],
        'Lisans': ['Office lisansı talebi', 'AutoCAD lisans yenileme', 'Lisans süresi doldu uyarısı', 'Yeni kullanıcı lisansı'],
        'Diğer': ['Toplantı odası kurulumu', 'Yeni personel kurulumu', 'Cihaz teslim talebi', 'Genel bilgi talebi'],
      };
      const RESOLUTIONS = [
        ['fixed', 'Sorun giderildi ve kullanıcı onayladı.'],
        ['fixed', 'Cihaz değişimi yapıldı.'],
        ['workaround', 'Geçici çözüm uygulandı, kalıcı düzeltme planlandı.'],
        ['duplicate', 'Aynı konuda açılmış başka kayıtla birleştirildi.'],
        ['not_reproducible', 'Sorun tekrarlanamadı, kullanıcı ile kapatıldı.'],
        ['no_fault', 'Cihazda arıza bulunmadı, kullanım kaynaklı.'],
        ['user_education', 'Kullanıcıya doğru kullanım anlatıldı.'],
      ];
      const CSAT_NOTES = ['Hızlı dönüş, teşekkürler.', 'Sorun tek seferde çözüldü.', 'İlgi için teşekkürler.', 'Biraz uzun sürdü ama çözüldü.', null, null];

      const rows = [];
      const extras = []; // comments + activity, written after the tickets
      // Volume grows towards the present: the same company logs more tickets as
      // it grows, and a flat year reads as generated.
      for (let i = 0; i < historyCount; i++) {
        const progress = (i + 1) / historyCount;
        const daysBack = Math.round(365 * Math.pow(1 - progress, 1.35));
        const createdAt = workingMoment(daysAgo(daysBack));
        const ageDays = (Date.now() - createdAt.getTime()) / 86400000;

        const type = chance(0.28) ? 'request' : 'incident';
        const category = pickCategory();
        const subject = pickOne(SUBJECTS[category] || SUBJECTS['Diğer']);
        const impact = pickOne(['low', 'low', 'medium', 'medium', 'medium', 'high']);
        const urgency = pickOne(['low', 'medium', 'medium', 'high']);
        const priority = PRIORITY_MATRIX[impact][urgency];

        // Anything older than a month is almost certainly finished; recent days
        // carry the open queue.
        let status;
        if (ageDays > 30) status = chance(0.97) ? 'closed' : 'cancelled';
        else if (ageDays > 7) status = pickOne(['closed', 'closed', 'closed', 'resolved', 'cancelled']);
        else status = pickOne(['new', 'open', 'in_progress', 'in_progress', 'pending', 'resolved', 'closed', 'closed']);

        const targets = SLA_TARGETS[priority];
        const responseDue = new Date(createdAt.getTime() + targets.response * 60000);
        const resolveDue = new Date(createdAt.getTime() + targets.resolve * 60000);

        const responded = status !== 'new';
        // ~12% miss the first-response target, ~9% the resolution target.
        const responseLate = responded && chance(0.12);
        const firstResponseAt = responded
          ? new Date(createdAt.getTime() + targets.response * 60000 * (responseLate ? between(1.2, 3) : between(0.15, 0.9)))
          : null;

        const finished = ['resolved', 'closed', 'cancelled'].includes(status);
        const resolveLate = finished && chance(0.09);
        const resolvedAt = finished
          ? new Date(createdAt.getTime() + targets.resolve * 60000 * (resolveLate ? between(1.15, 2.6) : between(0.2, 0.95)))
          : null;
        const closedAt = ['closed', 'cancelled'].includes(status)
          ? new Date((resolvedAt || createdAt).getTime() + between(1, 48) * 3600000)
          : null;

        const [resolutionCode, resolutionNote] = status === 'cancelled'
          ? ['duplicate', 'Talep sahibi tarafından geri çekildi.']
          : (finished ? pickOne(RESOLUTIONS) : [null, null]);

        const csat = status === 'closed' && chance(0.35)
          ? pickOne([5, 5, 5, 4, 4, 4, 3, 2])
          : null;

        const requester = roster.length ? roster[Math.floor(rand() * roster.length)] : null;
        const agent = desk.length && status !== 'new' ? desk[Math.floor(rand() * desk.length)] : null;
        const asset = ['Donanım', 'Yazıcı'].includes(category) && allAssets.length && chance(0.6)
          ? allAssets[Math.floor(rand() * allAssets.length)]
          : null;

        rows.push({
          type, subject, category, impact, urgency, priority, status,
          createdAt, firstResponseAt, resolvedAt, closedAt,
          responseDue, resolveDue,
          responseBreachedAt: responseLate ? responseDue : null,
          resolveBreachedAt: resolveLate ? resolveDue : null,
          resolutionCode, resolutionNote, csat,
          csatComment: csat ? pickOne(CSAT_NOTES) : null,
          assetId: asset ? asset.id : null,
          requesterId: requester ? requester.id : null,
          requesterName: requester ? requester.full_name : null,
          agentId: agent ? agent.id : null,
          agentName: agent ? agent.username : null,
        });
      }

      // Numbers in one round trip rather than a nextval per row.
      const incCount = rows.filter((r) => r.type === 'incident').length;
      const reqCount = rows.length - incCount;
      const { rows: incNums } = await t.query(
        "SELECT nextval('ticket_incident_seq') AS n FROM generate_series(1, $1)", [Math.max(incCount, 1)]
      );
      const { rows: reqNums } = await t.query(
        "SELECT nextval('ticket_request_seq') AS n FROM generate_series(1, $1)", [Math.max(reqCount, 1)]
      );
      let incIdx = 0; let reqIdx = 0;

      for (const r of rows) {
        const number = r.type === 'incident'
          ? `INC-${incNums[incIdx++].n}`
          : `REQ-${reqNums[reqIdx++].n}`;
        const { rows: ins } = await t.query(
          `INSERT INTO tickets (
             number, type, subject, description, status, priority, category, impact, urgency,
             requester_employee_id, assignee_user_id, asset_id, created_by_name,
             first_response_at, resolved_at, closed_at, response_due_at, resolve_due_at,
             response_breached_at, resolve_breached_at, resolution_code, resolution_note,
             csat_rating, csat_comment, csat_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26)
           RETURNING id`,
          [number, r.type, r.subject,
            `${r.subject}. ${r.requesterName || 'Personel'} tarafından bildirildi.`,
            r.status, r.priority, r.category, r.impact, r.urgency,
            r.requesterId, r.agentId, r.assetId, SEED_MARK,
            r.firstResponseAt, r.resolvedAt, r.closedAt, r.responseDue, r.resolveDue,
            r.responseBreachedAt, r.resolveBreachedAt, r.resolutionCode, r.resolutionNote,
            r.csat, r.csatComment, r.csat ? r.closedAt : null, r.createdAt]
        );
        const id = ins[0].id;
        history++;

        if (r.firstResponseAt && chance(0.55)) {
          await t.query(
            `INSERT INTO ticket_comments (ticket_id, author_name, body, internal, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [id, r.agentName || SEED_MARK, pickOne([
              'Konuyu inceliyorum, kısa süre içinde döneceğim.',
              'Uzaktan bağlanıp kontrol ettim, işlem sürüyor.',
              'Yedek cihaz hazırlandı, teslim için haber vereceğim.',
              'Tedarikçiye ilettim, dönüş bekleniyor.',
            ]), false, r.firstResponseAt]
          );
          historyComments++;
        }
        if (r.resolvedAt && chance(0.3)) {
          await t.query(
            `INSERT INTO ticket_comments (ticket_id, author_name, body, internal, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [id, r.agentName || SEED_MARK, pickOne([
              'Parça değişimi yapıldı, maliyet muhasebeye iletildi.',
              'Kök neden ağ anahtarındaki port arızası.',
              'Kullanıcıya kısa bir eğitim verildi.',
            ]), true, r.resolvedAt]
          );
          historyComments++;
        }

        const trail = [['created', `Kayıt açıldı: ${number}`, r.createdAt]];
        if (r.firstResponseAt) trail.push(['first_response', 'İlk yanıt verildi', r.firstResponseAt]);
        if (r.agentName) trail.push(['assigned', `Atandı: ${r.agentName}`, r.firstResponseAt || r.createdAt]);
        if (r.responseBreachedAt) trail.push(['sla_breach', 'İlk yanıt SLA süresi aşıldı', r.responseBreachedAt]);
        if (r.resolveBreachedAt) trail.push(['sla_breach', 'Çözüm SLA süresi aşıldı', r.resolveBreachedAt]);
        if (r.resolvedAt) trail.push(['resolved', r.resolutionNote || 'Çözüldü', r.resolvedAt]);
        if (r.closedAt) trail.push([r.status === 'cancelled' ? 'cancelled' : 'closed', r.status === 'cancelled' ? 'Talep iptal edildi' : 'Kayıt kapatıldı', r.closedAt]);
        if (r.csat) trail.push(['csat', `Memnuniyet puanı: ${r.csat}/5`, r.closedAt]);
        for (const [action, detail, when] of trail) {
          await t.query(
            `INSERT INTO ticket_activity (ticket_id, actor_name, action, detail, created_at) VALUES ($1,$2,$3,$4,$5)`,
            [id, r.agentName || SEED_MARK, action, detail, when]
          );
        }
      }
    }

    /* ---------------------------------------------------------------------
     * Problem / Degisiklik / Bilgi Bankasi
     * ------------------------------------------------------------------- */
    // The service desk is more than the ticket list: without these three the
    // Problems, Changes and Knowledge Base screens open empty and cannot be
    // judged. Kept small and hand-written — they are reference records, not
    // volume, and each one is the kind of entry a real desk would file.
    await t.query('DELETE FROM problems WHERE created_by_name = $1', [SEED_MARK]);
    await t.query('DELETE FROM changes WHERE requested_by_name = $1', [SEED_MARK]);
    await t.query('DELETE FROM kb_articles WHERE author_name = $1', [SEED_MARK]);

    const deskAgent = agents[0] || null;
    const PROBLEMS = [
      ['Toplantı odalarında tekrarlayan Wi-Fi kopmaları', 'Üç toplantı odasında bağlantı düzenli olarak düşüyor.', 'known_error', 'high',
       'Erişim noktalarının kanal çakışması (11 ve 6 aynı anda).', 'Odalara kablolu bağlantı bırakıldı.', 45, null],
      ['Muhasebe uygulaması ay sonunda donuyor', 'Kapanış döneminde uygulama yanıt vermiyor.', 'investigating', 'high',
       null, 'Kapanış saatleri dışında çalışma önerildi.', 22, null],
      ['Kat 3 yazıcısında kağıt sıkışması', 'Aynı cihazda tekrarlayan sıkışma.', 'resolved', 'medium',
       'Besleme silindiri aşınmış.', 'Yedek yazıcıya yönlendirme.', 80, 12],
      ['VPN oturumlarının 2 saatte düşmesi', 'Uzak çalışanlarda oturum süresi kısa.', 'closed', 'medium',
       'Güvenlik duvarı oturum zaman aşımı 7200 sn.', 'Zaman aşımı 28800 sn yapıldı.', 120, 95],
      ['Yeni personel hesaplarının gecikmesi', 'İşe giriş günü hesap hazır olmuyor.', 'known_error', 'medium',
       'İK bildiriminin BT’ye ulaşması ortalama 2 gün sürüyor.', 'İK formu ITACM talebine bağlandı.', 60, null],
      ['Ortak sürücüde yavaşlık', 'Dosya açılışları gün ortasında yavaşlıyor.', 'new', 'low', null, null, 6, null],
    ];
    let problemsMade = 0;
    const problemIds = [];
    for (const [title, desc, status, priority, rootCause, workaround, ago, closedAgo] of PROBLEMS) {
      const { rows: n } = await t.query("SELECT nextval('problem_seq') AS n").catch(() => ({ rows: [{ n: null }] }));
      const number = n[0].n != null ? `PRB-${n[0].n}` : `PRB-${1000 + problemsMade}`;
      const { rows: ins } = await t.query(
        `INSERT INTO problems (number, title, description, status, priority, root_cause, workaround,
                               assignee_user_id, created_by_name, resolved_at, closed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [number, title, desc, status, priority, rootCause, workaround,
          deskAgent ? deskAgent.id : null, SEED_MARK,
          ['resolved', 'closed'].includes(status) ? daysAgo(closedAgo ?? ago / 2) : null,
          status === 'closed' ? daysAgo(closedAgo ?? ago / 3) : null,
          daysAgo(ago)]
      );
      problemIds.push(ins[0].id);
      problemsMade++;
    }
    // Tie a few history incidents to the recurring problems, which is what makes
    // the "linked incidents" panel worth opening.
    if (problemIds.length) {
      await t.query(
        `UPDATE tickets SET problem_id = $1
          WHERE id IN (SELECT id FROM tickets WHERE created_by_name = $2 AND category = 'Ağ / İnternet'
                        ORDER BY created_at DESC LIMIT 6)`,
        [problemIds[0], SEED_MARK]
      );
      await t.query(
        `UPDATE tickets SET problem_id = $1
          WHERE id IN (SELECT id FROM tickets WHERE created_by_name = $2 AND category = 'Yazıcı'
                        ORDER BY created_at DESC LIMIT 4)`,
        [problemIds[2], SEED_MARK]
      );
    }

    const CHANGES = [
      ['Güvenlik duvarı yazılım güncellemesi', 'Üretici tarafından yayımlanan kritik yamanın uygulanması.', 'normal', 'completed', 'medium', 30, 28],
      ['Ana switch yığınına yeni üye eklenmesi', 'Kat 4 için port kapasitesi artırımı.', 'normal', 'closed', 'medium', 60, 55],
      ['E-posta arşivleme politikası değişikliği', 'Arşiv süresi 1 yıldan 3 yıla çıkarılıyor.', 'normal', 'approved', 'low', 8, null],
      ['Yedekleme penceresinin öne alınması', 'Yedekleme 02:00 yerine 23:30’da başlayacak.', 'standard', 'scheduled', 'low', 5, null],
      ['ERP sunucusu bellek yükseltmesi', '32 GB → 64 GB yükseltme, planlı kesinti.', 'normal', 'pending_approval', 'high', 3, null],
      ['Acil: sertifika yenileme', 'Süresi dolan portal sertifikasının değiştirilmesi.', 'emergency', 'completed', 'high', 12, 12],
      ['VPN zaman aşımı ayarı', 'Oturum süresi 8 saate çıkarılıyor (PRB kaydına bağlı).', 'normal', 'closed', 'low', 90, 88],
      ['Kablosuz kanal planı revizyonu', 'Toplantı odalarındaki çakışmanın giderilmesi.', 'normal', 'implementing', 'medium', 2, null],
    ];
    let changesMade = 0;
    for (const [title, desc, type, status, risk, ago, doneAgo] of CHANGES) {
      const { rows: n } = await t.query("SELECT nextval('change_seq') AS n").catch(() => ({ rows: [{ n: null }] }));
      const number = n[0].n != null ? `CHG-${n[0].n}` : `CHG-${1000 + changesMade}`;
      const approved = ['approved', 'scheduled', 'implementing', 'completed', 'closed'].includes(status);
      await t.query(
        `INSERT INTO changes (number, title, description, type, status, risk,
                              implementation_plan, rollback_plan, assignee_user_id,
                              requested_by_name, approver_name, approved_at,
                              scheduled_start, scheduled_end, completed_at, closed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
        [number, title, desc, type, status, risk,
          'Bakım penceresinde uygulanacak, öncesinde yedek alınacak.',
          'Değişiklik geri alınır, önceki yapılandırma yedekten yüklenir.',
          deskAgent ? deskAgent.id : null, SEED_MARK,
          approved ? 'BT Müdürü' : null, approved ? daysAgo(ago - 1) : null,
          daysAgo(ago - 2), daysAgo(ago - 2), doneAgo != null ? daysAgo(doneAgo) : null,
          status === 'closed' ? daysAgo(doneAgo ?? ago) : null, daysAgo(ago)]
      );
      changesMade++;
    }

    const KB = [
      ['VPN nasıl bağlanılır?', 'Hesap ve Erişim', true, 'Kurumsal VPN istemcisini açın, kullanıcı adınızı e-posta adresiniz olarak girin ve tek kullanımlık kodu onaylayın. Bağlantı düşerse önce Wi-Fi yerine kablolu ağı deneyin.'],
      ['Parolamı unuttum, ne yapmalıyım?', 'Hesap ve Erişim', true, 'Giriş ekranındaki "Parolamı unuttum" bağlantısını kullanın. Kurumsal dizin hesabınız varsa parolanız BT tarafından sıfırlanmaz; kendi kimlik doğrulama akışınızdan geçer.'],
      ['Yazıcıya nasıl bağlanırım?', 'Yazıcı', true, 'Ayarlar → Yazıcılar → Ekle yolunu izleyin ve kat numaranızla eşleşen cihazı seçin. Görünmüyorsa ağ sürücüsüne erişiminiz olduğundan emin olun.'],
      ['Toner değişimi talebi nasıl açılır?', 'Yazıcı', true, 'Servis Masası → Yeni Talep → Yazıcı kategorisi. Cihazın kat ve model bilgisini eklemeniz değişim süresini kısaltır.'],
      ['Outlook senkronizasyon sorunları', 'E-posta', true, 'Önce çevrimdışı çalışma kapalı mı kontrol edin, ardından profil onarımı yapın. Sorun sürerse posta kutusu boyutunuzu kontrol edin.'],
      ['Yeni personel kurulum listesi', 'Diğer', true, 'Bilgisayar, hesap açılışı, e-posta, telefon hattı ve zimmet tutanağı. İK talebi açıldığında liste otomatik oluşturulur.'],
      ['Zimmet tutanağı nasıl imzalanır?', 'Diğer', true, 'Teslim sırasında çıktı alınır, iki nüsha imzalanır ve bir nüsha taranarak personel kaydına yüklenir.'],
      ['Wi-Fi kopmaları için ilk kontroller', 'Ağ / İnternet', true, 'Cihazınızı 5 GHz ağa alın, sürücüyü güncelleyin ve toplantı odalarında kablolu bağlantıyı tercih edin.'],
      ['Lisans talebi süreci', 'Lisans', true, 'Talep yöneticinizin onayına düşer, onay sonrası satın alma ekibine iletilir. Ortalama süre 3 iş günüdür.'],
      ['Cihazım çalınırsa / kaybolursa', 'Donanım', true, 'Derhal BT’ye bildirin. Uzaktan kilitleme uygulanır, hattınız geçici olarak kapatılır ve tutanak düzenlenir.'],
      ['Ekran görüntüsü nasıl alınır?', 'Diğer', false, 'Taslak — ekip içi kullanım için hazırlanıyor.'],
      ['Sunucu odası giriş kuralları', 'Diğer', false, 'Taslak — güvenlik ekibiyle birlikte gözden geçirilecek.'],
    ];
    let kbMade = 0;
    for (const [title, category, published, body] of KB) {
      await t.query(
        `INSERT INTO kb_articles (title, body, category, published, author_name, views, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [title, body, category, published, SEED_MARK,
          published ? Math.floor(between(20, 400)) : 0, daysAgo(between(10, 200))]
      );
      kbMade++;
    }

    console.log(`[seed:tickets] ${removed} onceki demo kaydi silindi`);
    console.log(`[seed:tickets] ${created} sekil kaydi, ${comments} yorum olusturuldu`);
    console.log(`[seed:tickets] ${history} gecmis kaydi (${historyComments} yorum) — son 12 ay`);
    console.log(`[seed:tickets] ${problemsMade} problem, ${changesMade} degisiklik, ${kbMade} bilgi bankasi makalesi`);
    console.log(`[seed:tickets] ${merged.length} kategori ayarlara yazildi`);
  });
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[seed:tickets] failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
