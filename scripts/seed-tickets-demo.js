#!/usr/bin/env node
/**
 * Seed a realistic service-desk dataset: incidents, requests, comment threads,
 * activity trails, SLA clocks and closure surveys.
 *
 * The point is not volume but *shape* — every status, priority and closure path
 * appears at least once, and the timestamps are spread over the last two months
 * so dashboards, SLA reports and trend charts have something truthful to draw.
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

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
const daysAgo = (d) => hoursAgo(d * 24);

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

    console.log(`[seed:tickets] ${removed} onceki demo kaydi silindi`);
    console.log(`[seed:tickets] ${created} kayit, ${comments} yorum olusturuldu`);
    console.log(`[seed:tickets] ${merged.length} kategori ayarlara yazildi`);
  });
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[seed:tickets] failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
