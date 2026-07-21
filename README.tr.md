<div align="center">

# 🖥️ ITACM — IT Asset Control Pro

### Kendi sunucunuzda çalışan, her şeyi içeren BT envanter yönetimi.

Donanım ve ağ envanteri · yazdırılabilir PDF tutanaklı personel zimmetleri · yazılım lisansları · hat/SIM yönetimi · tedarikçi & sözleşmeler · onarım takibi · fiziksel sayım · tam denetim kaydı — hepsi tamamen kendi altyapınızda çalışan, mobil uyumlu dahili bir web arayüzünde.

<br />

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-22c55e.svg?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Self-hosted](https://img.shields.io/badge/Kendi%20sunucunuzda-%100-0ea5e9?style=flat-square)](#-hızlı-başlangıç--docker-compose)
[![Build adımı yok](https://img.shields.io/badge/Arayüz-Build%20adımı%20yok-f59e0b?style=flat-square)](#-proje-yapısı)
[![Mobil uyumlu](https://img.shields.io/badge/Mobil-uyumlu-8b5cf6?style=flat-square)](#-mobil-uyumlu)
[![i18n](https://img.shields.io/badge/i18n-12%20dil-14b8a6?style=flat-square)](#-öne-çıkan-özellikler)
[![Web sitesi](https://img.shields.io/badge/Web%20sitesi-itacm.site-6366f1?style=flat-square)](https://itacm.site/)

<br />

[🇬🇧 English →](README.md) · **🇹🇷 Türkçe**

<br />

![Panel](docs/screenshots/dashboard.png)

</div>

---

## 📑 İçindekiler

- [Neden ITACM?](#-neden-itacm)
- [Ekran görüntüleri](#-ekran-görüntüleri)
- [Öne çıkan özellikler](#-öne-çıkan-özellikler)
- [Modüller](#-modüller)
- [Mobil uyumlu](#-mobil-uyumlu)
- [Teknoloji](#-teknoloji)
- [Hızlı başlangıç — Docker Compose](#-hızlı-başlangıç--docker-compose)
- [Sunucuya kurulum](#-sunucuya-kurulum)
- [Yedekleme & kurtarma](#-yedekleme--kurtarma)
- [Yapılandırma referansı](#-yapılandırma-referansı)
- [API referansı](#-api-referansı)
- [Güvenlik notları](#-güvenlik-notları)
- [Proje yapısı](#-proje-yapısı)
- [Geliştirme](#-geliştirme)
- [Lisans](#-lisans)

---

## 💡 Neden ITACM?

Çoğu envanter aracı ya zamanla çürüyen bir Excel dosyası ya da kendi sunucunuzda barındıramadığınız ağır bir SaaS'tır. ITACM tam ortada durur:

- **Tek komutla çalışır.** `docker compose up -d` size veritabanını, şemayı, ilk yöneticiyi ve tam bir web arayüzünü verir — build adımı yok, ayrı bir frontend kurmanıza gerek yok.
- **Sağlam zimmetler.** Her cihaz ataması, satır kilitli ve atomik bir işlemdir; şirket markanızla **Zimmet Tutanağı** (yazdırılabilir teslim formu) üretir.
- **Tüm şirket, tek taşıma.** Cihazlar, personel, tutanaklar, sözleşmeler ve denetim geçmişi PostgreSQL'dedir. Yüklenen belgeler dosya sisteminde (`DATA_DIR/documents`); tam taşıma için `npm run migrate:export` kullanın.
- **Depoda da çalışır.** Arayüz tamamen duyarlı; mobil alt menü ve kamerayla QR/barkod tarama ile telefonunuzdan sayım yapabilir veya laptop zimmetleyebilirsiniz.
- **Sizin kalır.** Telemetri yok, üreticiye bağımlılık yok, MIT lisanslı.

---

## 📸 Ekran görüntüleri

<div align="center">

| Ağ & Sunucu topolojisi | Tedarikçi & Sözleşmeler |
|:--:|:--:|
| ![Ağ topolojisi](docs/screenshots/network-topology.png) | ![Tedarikçiler](docs/screenshots/providers.png) |
| **Hatlar (SIM/Numara)** | **Fiziksel Sayım** |
| ![Hatlar](docs/screenshots/mobile-lines.png) | ![Sayım](docs/screenshots/stock-count.png) |
| **Personel detayı — cihaz, lisans, hat** | **Sistem Denetim Kaydı** |
| ![Personel detayı](docs/screenshots/employee-detail.png) | ![Denetim kaydı](docs/screenshots/audit-log.png) |
| **Yazdırılabilir zimmet tutanağı** | **Raporlar & oluşturucu** |
| ![Yazdırma önizleme](docs/screenshots/print-preview.png) | ![Raporlar](docs/screenshots/reports.png) |
| **Donanım envanteri** | **Ürün Kataloğu — model-bazlı EOL yaşam döngüsü** |
| ![Donanım envanteri](docs/screenshots/hardware.png) | ![Ürün Kataloğu](docs/screenshots/catalog.png) |

<br />

<img src="docs/screenshots/mobile-dashboard.png" width="30%" alt="Mobil panel" />
&nbsp;&nbsp;
<img src="docs/screenshots/mobile-lines-phone.png" width="30%" alt="Telefonda hatlar" />

<sub>Alt navigasyon ve ortada QR-tarama düğmesi olan duyarlı arayüz.</sub>

</div>

> Diğer ekranlar (zimmet sepeti, ağ haritası, giriş) [`docs/screenshots/`](docs/screenshots) altında.

---

## ✨ Öne çıkan özellikler

<table>
<tr>
<td width="50%" valign="top">

### 🖥 Dahili, mobil uyumlu web arayüzü
Backend'in kendisi sunar — build adımı yok, katı same-origin CSP. 16 modül, global arama (Cmd/Ctrl+K), QR kodlar, koyu tema uyumu ve mobil alt menü + kamera tarayıcılı duyarlı kabuk. Sadece `http://localhost:8000` adresini açın.

### 🤝 Atomik zimmet sepeti
Birden çok cihazı tek "ya hep ya hiç" işlemle bir personele atayın; yazdırılabilir Zimmet Tutanağı üretir. Satır kilitleri çift atamayı imkânsız kılar; yeniden yazdırmada orijinal teslim edenin adı korunur.

### 🎨 Özelleştirilebilir zimmet tasarımları
Yazdırılan/PDF formda hangi bölüm, sütun, başlık ve etiketlerin görüneceğini canlı önizlemeyle seçin; birden çok görsel tema (`terminal`, `classic`, `corporate`, `slate`).

### 🌐 Ağ & Sunucu envanteri
Altyapı cihazları (switch, firewall, router, sunucu, depolama) kişisel zimmetin **dışında** tutulur — bunun yerine **lokasyon + sorumlu kişi** atanır. Etkileşimli **bağımlılık topolojisi** (lokasyon bazlı grafikler, uplink'ler, siteler arası ebeveynler) ve **kabinet** U-haritaları.

### 🏢 Tedarikçi & Sözleşmeler
Tedarikçiler / ISS / MSP'ler; iletişim, hesap numarası ve destek hatlarıyla birer kayıt. Yenileme tarihi, maliyet, faturalama döngüsü ve iç sahibiyle **sözleşme** ekleyin; 60 günlük yenileme uyarıları ve tedarikçi bazlı belge saklama.

### 📱 Hat / SIM yönetimi
Kurumsal SIM kartlar ve telefon numaraları birer envanter kalemi: operatör, tarife, ICCID, aylık maliyet. Geçmişiyle birlikte ata / geri al — hatlar personel profilinde ve zimmet formlarında görünür.

### 🧑‍💼 Rehberli işe alım & çıkış
Yeni çalışanın setini planlayın (cihaz + hat rezerve edin), sonra tek zimmete dönüştürün. Çıkış (offboarding) ise **işlemsel bir kontrol listesidir**: personeli pasifleştirmeden önce her cihazı, koltuğu, hattı ve altyapı sorumluluğunu iade eder, devreder, hurdaya ayırır veya satar.

### 🌳 Organizasyon şeması
**Yöneticili** departmanlar, **lead'li** takımlar ve üyeleri; ağ görünümüyle aynı düğüm-bağlantı stilinde **interaktif topoloji grafiği** olarak. Yönetici/lead'i tek tıkla ata veya değiştir, takım ekle, kişileri aralarında taşı. Departmanlar **tek kaynak**: Ürün Kataloğu'ndan eklediğin anında burada belirir, yöneticisi atanmaya hazır. Helpdesk eskalasyonu için ideal — kiminle iletişime geçileceği tek bakışta belli.

</td>
<td width="50%" valign="top">

### 🔐 Rol bazlı erişim kontrolü
`Owner`, `Admin`, `Helpdesk`, `Viewer` rolleri **her** uç noktada uygulanır ve her istekte yeniden denetlenir; değişiklikler anında geçerli olur. Sahipler hesapları devre dışı bırakabilir veya silebilir — her pasifleştirme/aktifleştirme/silme/rol değişikliği kaydedilir. Giriş yerel e-posta/parola ile; **TOTP MFA** her rol için opsiyonel, **`Owner` hesapları için zorunludur**: bir Owner uygulamayı kullanmadan önce MFA'yı etkinleştirmek zorundadır, kapatamaz ve MFA'sı olmayan hiç kimse Owner'a yükseltilemez. Ayrıca parola değişikliği ve sunucu taraflı çıkış (JWT iptali). SSO / Entra girişi yoktur.

### 🧾 Sistem geneli denetim kaydı
Cihaz, kullanıcı, belge, zimmet, giriş, ayar ve dahasını kapsayan; append-only denetim tablosunu eski alan geçmişleriyle birleştiren birleşik, filtrelenebilir zaman çizelgesi. Kaynağa, aktöre ve tarihe göre arama; sırlar saklanmadan önce maskelenir.

### ⏳ Ürün yaşam döngüsü (EOL)
EOL süreleri üç katmanda çözülür — **cihaz bazlı override → katalog modeli → kategori varsayılanı**. Ayarlar'dan kategori varsayılanını belirleyin, belirli bir katalog modeline kendi yaşam süresini verin (ör. **Apple MacBook'lar 5 yıl**, diğer laptoplar 4 yılda kalır) ya da tek bir cihazı override edin — veya bir kategori için (aksesuarlar) EOL takibini kapatın. Her cihaz EOL tarihini ve "EOL yakın" / gecikmiş işaretlerini gösterir.

### 📦 Fiziksel sayım
Bir sayım oturumu açın ve **giriş yapmış herhangi bir cihazdan** tarayın — PC'de başlayın, telefon kameranızla barkod/QR taramaya devam edin. Oturumu kapatınca canlı envanterle mutabakat: bulundu / eksik / bilinmeyen, CSV dışa aktarımıyla.

### 📥 Excel / CSV taşıma
Şablonu indirin, mevcut zimmet tablonuzla doldurun, yükleyin — kuru çalıştırma (dry-run) önizlemesi tam olarak neyin oluşturulacağını gösterir; sonra tek işlemde personeli, katalog kayıtlarını, cihazları (sıralı etiketler) ve her personel için tam geçmişli bir zimmeti otomatik oluşturur.

### 📄 Lisanslar · 🏷 etiketler · 💱 para birimi
Atomik al/bırak ve 30 günlük süre uyarılı koltuk havuzları. Taranabilir **Code 128** etiketler yazdırın (boyut/alan/kopya ayarlanabilir). Maliyetler için uygulama genelinde **görüntüleme para birimi** seçin.

### 🌍 Çok dilli arayüz
12 dil (EN, TR, DE, FR, ES, IT, PT, NL, PL, RU, AR, JA). Karşılama ekranında seçin, Ayarlar'dan dilediğiniz zaman değiştirin; çevrilmemiş metinler İngilizce'ye düşer.

</td>
</tr>
</table>

> 🚀 **İlk çalıştırma sihirbazı** şirket adınızı, logonuzu ve Owner hesabınızı ayarlar; marka arayüze ve her yazdırılan tutanağa yansır.
> 🧪 **Demo veri seti** — Docker Compose’ta Postgres varsayılan olarak host’a açılmaz; seed’i **API container içinde** çalıştırın:
> `docker compose exec api npm run seed:all -- --reset` (demo + infra + providers). Ölçek: `SEED_EMPLOYEES=200`. Demo IT/Portal şifresi: `Demo123!`.

---

## 🧩 Modüller

Kenar menü, özellik setiyle bire bir eşleşir:

| Modül | Ne yapar |
|---|---|
| **Panel** | KPI'lar, dikkat gerektirenler (lisans, düşük stok, EOL), cihaz dağılımı, son hareketler |
| **Donanım** | Tam cihaz envanteri — QR kodlar, toplu işlemler, maliyet/garanti, yaşam döngüsü, global arama |
| **Ağ & Sunucu** | Altyapı envanteri + bağımlılık topolojisi + kabinetler (lokasyon/sorumlu, kişisel zimmet değil) |
| **Ürün Kataloğu** | Onaylı marka/model (**model-bazlı EOL yaşam döngüsü** ile), kategori, lokasyon, departman & özellik seçenekleri |
| **Yazılım & Lisanslar** | Koltuk havuzları, atomik al/bırak, süre uyarıları, lisans bazlı sahip dışa aktarımı |
| **Hatlar** | SIM/telefon numarası envanteri ve atama geçmişi |
| **Tedarikçi & Sözleşmeler** | Tedarikçi rehberi + yenileme takipli ticari sözleşmeler ve belgeler |
| **Sarf Malzemeleri** | Düşük stok uyarılı stok hareketleri |
| **Personel** | Rehber, kişi bazlı detay (cihaz/lisans/hat/altyapı), işe alım & çıkış |
| **Organizasyon** | Departman → takım → üye topoloji şeması; yönetici/lead ata, kişileri taşı, helpdesk eskalasyonu |
| **Zimmet İşlemleri** | Atomik zimmet sepeti + yazdırılabilir/PDF tutanaklar |
| **Bakım & Onarım** | Servise gönder / iade / hurda, belge ekleriyle |
| **Sayım** | Kamera taramalı fiziksel sayım oturumları ve mutabakat |
| **Raporlar** | 19 hazır rapor + oluşturucu (kaynak × sütun × filtre), CSV / antetli yazdırma |
| **Denetim Kaydı** | Birleşik, filtrelenebilir hareket zaman çizelgesi (Owner/Admin) |
| **BT Kullanıcıları** | RBAC kullanıcı yönetimi — oluştur, rol, pasifleştir/aktifleştir, sil (kayıtlı) |

---

## 📱 Mobil uyumlu

Uygulamanın tamamı duyarlıdır — ayrı bir mobil build yok:

- **Alt navigasyon çubuğu** ve ortada **QR-tarama** düğmesi olan daraltılabilir kenar menü.
- Sayım ve hızlı cihaz sorgulaması için **kamerayla** barkod/QR tarama (yerleşik ZXing yapısı).
- **PC'de başla, telefonda devam et**: masaüstünde bir sayım oturumu açın, giriş yapmış herhangi bir cihazdan taramaya devam edin.
- Ana ekrana eklendiğinde iyi davranması için viewport-fit, theme-color ve web-app meta etiketleri.

---

## 🧰 Teknoloji

| Katman | Teknoloji |
|---|---|
| **Çalışma zamanı** | Node.js ≥ 20, Express 4 |
| **Veritabanı** | PostgreSQL 16 — idempotent `schema.sql` + izlenen sürümlü migration'lar, açılışta uygulanır |
| **Kimlik doğrulama** | JWT (HS256, algoritma sabitlenmiş) + bcrypt (maliyet 12), her istekte yeniden denetlenen rol middleware'i |
| **Arayüz** | Backend'in sunduğu vanilla JS SPA — **build adımı yok**, ekran başına modüllere bölünmüş |
| **PDF / etiketler** | PDFKit + QR kodlar, özel zimmet şablonları, Code 128 barkodlar |
| **Tarama** | Yerleşik ZXing tarayıcı yapısı (kamera QR/barkod) |
| **Paketleme** | Docker + Docker Compose |

---

## 🚀 Hızlı başlangıç — Docker Compose

Her şey otomatik: veritabanı konteyneri oluşturulur, şema + migration'lar uygulanır ve ilk yönetici (Owner) hesabı tanımlanır.

```bash
git clone https://github.com/<siz>/itacm.git
cd itacm

npm install
npm run setup          # güçlü sırlarla .env üretir (ya da .env.example kopyalayın)

docker compose up -d
docker compose logs api   # ilk çalıştırma Owner bilgileri burada yazdırılır
```

Ardından **http://localhost:8000** adresini açın — ilk ziyarette şirket adı/logo, zimmet tasarımı ve dil seçimi ile **Owner** hesabını oluşturan karşılama sihirbazı gelir.

> [!TIP]
> `ADMIN_PASSWORD` boş bırakılırsa güçlü rastgele bir parola üretilip API loglarında **bir kez** yazdırılır. İlk girişten sonra değiştirin.

Elle yapılandırmayı mı tercih edersiniz? `.env.example` dosyasını `.env` olarak kopyalayın, en azından `JWT_SECRET` ayarlayın (`openssl rand -hex 32`), sonra `docker compose up -d`.

---

## 🌍 Sunucuya kurulum

Compose dosyası Docker'ı olan her sunucuda değişmeden çalışır. 8000 portunun önüne TLS'li bir ters proxy (Caddy / Nginx / Traefik) koyun ve frontend origin'iniz farklıysa `CORS_ORIGINS` değerini ona göre ayarlayın.

Yönetilen platformlarda (Railway, Render, Fly.io, Cloud Run…) `Dockerfile`'ı dağıtın, bir Postgres eklentisi bağlayın ve aynı ortam değişkenlerini (`DATABASE_URL`, `PGSSL=true`, `JWT_SECRET`, `ADMIN_*`) ayarlayın. Şema ve migration'lar açılışta otomatik uygulanır.

---

## 💾 Yedekleme & kurtarma

PostgreSQL cihazlar, personel, tutanaklar, sözleşmeler, ayarlar (SMTP, şirket, zimmet şablonları) ve denetim geçmişini tutar. **Yüklenen belgeler** `app-data` volume'ünde (`DATA_DIR/documents`) durur — yalnızca veritabanında değil.

```bash
npm run backup                 # → backups/itacm-YYYYMMDD-HHMMSS.sql.gz  (yalnızca DB)
npm run restore backups/itacm-20260707-120000.sql.gz   # mevcut DB'yi değiştirir (onay ister)

# Tam sistem taşıma (DB + belgeler) — arayüzde de var:
npm run migrate:export         # → migrations/itacm-migrate-… (+ varsa .zip)
npm run migrate:import path/to/itacm-migrate-… [--yes]
```

İlk açılışta **Yeni kurulum** veya **Başka sunucudan taşı** seçilir. Kaynak `.env` içindeki `JWT_SECRET`'i hedefe kopyalayın (SMTP şifre çözümü için gerekli). Owner ayrıca **Integrations → System migration** ile dışa aktarabilir.

`backups/` / `migrations/` klasörlerini güvenli bir yere kopyalayın veya DB yedeğini cron ile zamanlayın, ör. her gün 02:00'de:

```cron
0 2 * * *  cd /path/to/ITACM && npm run backup
```

### Veritabanı parolasını değiştirme

`POSTGRES_PASSWORD`, veritabanı hacmi ilk oluşturulduğunda sabitlenir. **`.env` içinde değiştirip yeniden başlatmak işe yaramaz** — API kimlik doğrulaması başarısız olur. Veri kaybetmeden güvenle döndürmek için:

```bash
npm run change-db-password
```

> [!WARNING]
> **Asla `docker compose down -v` çalıştırmayın.** `-v` bayrağı veritabanı hacmini siler ve tüm verinizi kalıcı olarak yok eder. API `password authentication failed` derse `npm run change-db-password` çalıştırın (veya `.env`'deki eski parolayı geri koyun) — hacmi silmeyin.

---

## ⚙️ Yapılandırma referansı

| Değişken | Zorunlu | Açıklama |
|---|:---:|---|
| `PORT` / `API_PORT` | – | HTTP portu (varsayılan `8000`) |
| `CORS_ORIGINS` | – | Virgülle ayrılmış izinli origin'ler (boş = same-origin) |
| `DATABASE_URL` | ✅ | `postgres://user:pass@host:5432/db` (ya da `POSTGRES_URL`) |
| `PGSSL` | – | Yönetilen Postgres için TLS üzerinden `true` |
| `JWT_SECRET` | ✅ | En az 32 karakter — `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | – | Token ömrü (varsayılan `12h`) |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | İlk çalıştırma Owner tohumu (boşsa parola otomatik üretilir) |

Docker compose ile `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` hem veritabanı konteynerini hem de API'nin `DATABASE_URL`'ini besler.

---

## 🔌 API referansı

Tüm yanıtlar `{ success, data }` veya `{ success: false, error, details? }` biçimindedir. `login` / `health` dışındaki tüm uç noktalar `Authorization: Bearer <TOKEN>` gerektirir. Her router `authenticate` uygular; yazma/silme işlemleri ayrıca rol gerektirir.

| Metot | Uç nokta | Roller | Açıklama |
|---|---|---|---|
| POST | `/api/auth/login` | herkese açık | E-posta/parola → JWT |
| POST | `/api/auth/verify-token` | herhangi | Token doğrula, profil + izinleri döndür |
| GET/POST | `/api/auth/users` | Admin | BT kullanıcıları listele / oluştur |
| PATCH | `/api/auth/users/:uid/role` · `/status` | Admin/Owner | Rol değiştir · pasifleştir/aktifleştir (kayıtlı) |
| DELETE | `/api/auth/users/:uid` | Owner | BT kullanıcısı sil (kayıtlı) |
| GET | `/api/dashboard/stats` | tümü | KPI'lar, uyarılar, son hareketler |
| GET | `/api/assets` · `/:id` | tümü | Envanter listesi (`?status=&category=&search=`) · detay + geçmiş |
| POST/PUT | `/api/assets` · `/:id` | Admin, Helpdesk | Donanım & altyapı oluştur / güncelle |
| POST | `/api/assets/:id/return` | Admin, Helpdesk | Zimmetli cihazı stoğa iade et |
| POST | `/api/handovers` | Admin, Helpdesk | **Atomik zimmet sepeti** (aşağıda) |
| GET | `/api/handovers` · `/:id` | tümü | Tutanaklar (yazdırılabilir formu besler) |
| GET/POST | `/api/onboardings` … `/:id/complete` · `/cancel` | Admin, Helpdesk | İşe alım planla / tamamla / iptal |
| POST | `/api/employees/:id/offboard` | Admin, Helpdesk | İşlemsel çıkış (offboarding) tasfiyesi |
| GET/POST | `/api/maintenance` · `/:id/close` | Admin, Helpdesk | Onarım kayıtları / gönder / kapat (`{scrap:true}`) |
| GET | `/api/employees` | tümü | Rehber + zimmet seçici |
| POST/PUT | `/api/employees` · `/:id` | Admin, Helpdesk | Oluştur / güncelle |
| GET/POST | `/api/licenses` · `/:id/assign` · `/revoke` | Admin, Helpdesk | Koltuk havuzları + atomik al/bırak |
| GET/POST | `/api/lines` · `/:id/assign` · `/unassign` | Admin, Helpdesk | Hatlar + geçmiş |
| GET/POST | `/api/providers` · `/contracts` | Admin, Helpdesk | Tedarikçi & sözleşmeler (+ belge yükleme/indirme) |
| GET/POST | `/api/consumables` · `/:id/adjust` | Admin, Helpdesk | Stok + atomik hareketler |
| GET/POST | `/api/counts` · `/:id/scan` · `/close` | Admin, Helpdesk | Fiziksel sayım oturumları |
| GET/PUT | `/api/catalog/*` | Admin, Helpdesk | Katalog, lokasyon, departman, ayarlar |
| POST | `/api/import/inventory` | Admin, Helpdesk | Excel/CSV taşıma (kuru çalıştırma + işleme) |
| GET | `/api/audit` · `/:bucket/:id` | Owner, Admin | Birleşik denetim zaman çizelgesi + olay detayı |
| GET | `/api/documents/:id/download` | tümü | Kayıtlı belgeyi akıt (inline/attachment) |

<details>
<summary><b>Atomik zimmet sepeti — nasıl çalışır</b></summary>

<br />

```http
POST /api/handovers
{
  "employeeId": "…",
  "documentType": "single",
  "items": [
    { "assetId": "…", "conditionNote": "Yeni, kutusu açılmamış" },
    { "assetId": "…", "conditionNote": "Kullanılmış, iyi durumda" }
  ]
}
```

**Tek işlemde** (Postgres `BEGIN … FOR UPDATE`): her cihaz `In Stock` olarak doğrulanır → tutanak belgesi oluşturulur → her cihaz personele bağlı `Assigned` durumuna geçer → personelin `activeAssetCount` değeri artırılır → cihaz başına bir denetim satırı yazılır.

**Herhangi** bir cihaz kilitliyse API `409` ve cihaz bazlı çakışma listesi döner, **hiçbir şey yazılmaz**. Satır kilitleri / işlem yeniden denemeleri iki operatörün aynı laptobu aynı anda zimmetlemesini imkânsız kılar.

</details>

---

## 🔒 Güvenlik notları

- **Sırlar depoda tutulmaz.** `.env` git tarafından yok sayılır; kurulum sihirbazı onu `0600` izinle yazar ve sizin için güçlü bir `JWT_SECRET` ve DB parolası üretir. Veritabanı yedekleri (`backups/`) da git dışındadır.
- **Kimlik doğrulama:** parolalar bcrypt ile hash'lenir (maliyet 12); JWT'ler HS256 ile imzalanır ve doğrulamada algoritma **sabitlenir**; giriş tek bir hata mesajı ve sabit-zamanlı karşılaştırma kullanır (bilinmeyen e-postalar için sahte hash) — böylece hesap sayımı için kullanılamaz; her istek kullanıcı satırını yeniden denetler, rol/pasifleştirme/silme anında geçerli olur; **`Owner` hesapları TOTP MFA etkinleştirmek zorundadır** — etkinleştirene kadar middleware, MFA kaydı / token doğrulama / çıkış dışındaki tüm yolları engeller.
- **Erişim kontrolü:** her API router'ı `authenticate` uygular, değiştiren rotalar `requireRole(...)` ekler. Denetim kaydı, saklamadan önce hassas anahtarları (parola, token, key) **maskeler**.
- **Yüklemeler:** belge rotaları gerçek dosya türünü **magic byte** ile doğrular (istemcinin iddiasına değil) ve gövdeyi 12 MB ile sınırlar; indirmeler temizlenmiş bir `Content-Disposition` ayarlar. Tüm SQL parametrelidir; tüm gösterilen değerler HTML olarak kaçışlanır.
- **Sıkılaştırma:** katı Content-Security-Policy (satır içi script yok, self-only), HSTS, nosniff / frame-deny / referrer / permissions-policy başlıkları, giriş hız sınırı (20 / 15 dk / IP), global API hız sınırı (1000 / 5 dk / IP), varsayılan same-origin CORS, 1 MB varsayılan gövde limiti, `x-powered-by` kapalı, ilk kullanımdan sonra kendini kilitleyen tek seferlik onboarding uç noktası ve `npm audit`-temiz bağımlılık ağacı.
- **Taşıma:** API'nin önüne HTTPS koyun (Caddy / Nginx / Traefik). Frontend origin'iniz farklıysa `CORS_ORIGINS` değerini tam origin'inize ayarlayın.

---

## 🗂 Proje yapısı

```
├── server.js                  Node/Docker giriş noktası (açılışta migrate eder)
├── public/                    Dahili web arayüzü (vanilla JS SPA, build adımı yok)
│   ├── index.html             Uygulama kabuğu + onboarding/giriş
│   ├── css/app.css
│   └── js/
│       ├── api.js  i18n.js  ui.js  money.js  barcode.js  mobile-shell.js
│       └── views/             Ekran başına bir modül (dashboard, assets, network,
│                              providers, audit, onboarding, stockcount, …)
├── src/
│   ├── app.js                 Express app, gövde limitleri, denetim middleware'i, rota bağlama
│   ├── config/                Ortam değişkeni ayrıştırma
│   ├── middleware/            Bearer auth + rol geçidi, hata yönetimi
│   ├── routes/                İnce controller'lar (assets, providers, contracts, audit, …)
│   ├── utils/                 PDF, uploadGuard, contentDisposition, permissions, defaults
│   ├── services/              Backend'den bağımsız servis cephesi
│   └── providers/postgres/    JWT auth + PostgreSQL
│       ├── schema.sql         Idempotent temel şema
│       ├── migrations/        İzlenen sürümlü migration'lar (schema_migrations)
│       ├── migrate.js         schema.sql + bekleyen migration'ları uygular
│       └── *Service.js        assets, employees, providers, audit, offboard, onboarding, …
├── scripts/                   setup · seed-all · seed-demo · seed-infra · seed-providers · backup · restore
├── docker-compose.yml         Kendi sunucunuzda yığın (API + Postgres)
├── Dockerfile · docker-entrypoint.sh
└── .env.example               Tamamı belgeli yapılandırma şablonu
```

---

## 🧑‍💻 Geliştirme

```bash
npm install
npm run setup      # ya da .env'i elle yazın
npm run dev        # otomatik yeniden başlayan yerel sunucu
npm run lint       # sözdizimi kontrolü (server + tüm src/scripts)
npm run migrate    # şema + bekleyen migration'ları elle uygula (opsiyonel)

# Demo veri (API container içinde — host’ta `npm run seed:*` için DB portunu açmanız gerekir)
docker compose exec api npm run seed:all -- --reset              # ~100 personel + org şeması + infra + tedarikçi
docker compose exec -e SEED_EMPLOYEES=100 api npm run seed:demo -- --reset
docker compose exec api npm run seed:infra                       # ağ/sunucu cihazları + topoloji
docker compose exec api npm run seed:providers                   # tedarikçi + sözleşmeler
```

---

## 📜 Lisans

[MIT](LICENSE) lisansı altında yayımlanmıştır.

<div align="center">
<br />
<sub><a href="https://github.com/enesyakisik">Enes Yakışık</a> tarafından ❤️ ile yapıldı · ITACM işinize yararsa bir ⭐ vermeyi düşünün</sub>
</div>
