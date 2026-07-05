# ITACM — IT Asset Control Pro

> Kendi sunucunuzda barındırılabilir BT varlık yönetimi backend'i: donanım
> envanteri, çalışan zimmet işlemleri (yazdırılabilir zimmet tutanağı ile),
> yazılım lisansları, sarf malzemeleri ve arıza/bakım takibi — **seçilebilir
> veri katmanı** ile: ister **Docker Compose üzerinde PostgreSQL** ile tamamen
> kendi sunucunuzda, ister **Firebase (Auth + Firestore)** üzerinde çalıştırın.

**[🇬🇧 English documentation → README.md](README.md)**

---

## Ekran Görüntüleri

| Dashboard | Donanım Envanteri |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Donanım](docs/screenshots/hardware.png) |

| Zimmet İşlemleri | Yazdırılabilir Zimmet Tutanağı |
|---|---|
| ![Zimmet](docs/screenshots/handover.png) | ![Tutanak](docs/screenshots/print-preview.png) |

| Personel Detayı | Raporlar & Özel Rapor Oluşturucu |
|---|---|
| ![Personel](docs/screenshots/employee-detail.png) | ![Raporlar](docs/screenshots/reports.png) |

---

## Özellikler

- 🖥 **Dahili web arayüzü** — backend'in kendisi tarafından sunulur (build adımı yok): Giriş, Dashboard, Donanım Envanteri (toplu işlemler, QR kodlar, global arama), kişi bazlı cihaz geçmişli Personel Rehberi, **yazdırılabilir tutanaklı** zimmet sepeti, yazılım (lisans) zimmeti, Lisanslar, Sarf Malzemeleri, Bakım ve login denetimli BT Kullanıcı yönetimi. Başlattıktan sonra `http://localhost:8000` adresini açın.
- 🚀 **İlk kullanım sihirbazı (onboarding)** — ilk açılışta şirket adı, logo ve Admin hesabını belirleyin; marka tüm arayüze ve yazdırılan zimmet tutanaklarına uygulanır (sonradan Ayarlar'dan değiştirilebilir).
- 🧪 **Demo veri seti** — `npm run seed:demo`, postgres kurulumunu 500 personellik gerçekçi bir şirketle doldurur (773 varlık, tutanaklar, denetim geçmişi, yazılım zimmetleri).
- 🔐 **Rol tabanlı yetkilendirme** — her endpoint'te `Admin`, `Helpdesk`, `Viewer` rolleri
- 💻 **Donanım envanteri** — varlık etiketi (benzersiz, QR kodlu), seri no, MAC adresleri, teknik özellikler, garanti
- 🤝 **Atomik zimmet sepeti** — birden çok varlığı tek "ya hep ya hiç" transaction'ı ile çalışana zimmetleyin; yazdırılabilir **Zimmet Tutanağı** otomatik oluşur
- 🛠 **Bakım yaşam döngüsü** — servise gönder / geri al / hurdaya ayır; onarım öncesi zimmet durumu otomatik geri yüklenir
- 📄 **Yazılım lisansları** — koltuk (seat) havuzları, atomik tahsis/bırakma, 30 gün kala bitiş uyarıları
- 📦 **Sarf malzemeleri** — stok hareketleri ve kritik stok uyarıları
- 📊 **Dashboard özetleri** — duruma göre varlık sayıları, uyarılar, son zimmet hareketleri
- 🧾 **Tam denetim izi (audit log)** — her zimmet/iade/onarım/ilerleme notu kim/ne zaman/neden bilgisiyle kayıtlı; kullanıcı bazlı login geçmişi
- ⏳ **Ürün yaşam döngüsü yönetimi** — kategori başına yaşam süresi (ay) Ayarlar'dan merkezi olarak belirlenir; her varlıkta EOL tarihi, envanterde "EOL soon"/gecikti rozetleri ve lifecycle raporları
- 📈 **Raporlar & Özel Rapor Oluşturucu** — 6 hazır rapor + oluşturucu (7 veri kaynağı × seçilebilir kolon × filtre), Excel uyumlu CSV veya şirket antetli yazdırma
- 🗂 **Ürün kataloğu** — kategori bazlı marka/model listeleri merkezi yönetilir ve varlık formunu besler; asset tag'ler sistem tarafından sıralı atanır
- 🔁 **Tek API, iki değiştirilebilir backend** — PostgreSQL (kendi sunucun) veya Firebase (yönetilen); REST sözleşmesi birebir aynı

## Backend'inizi seçin

| | 🐘 PostgreSQL (kendi sunucun) | 🔥 Firebase (yönetilen) |
|---|---|---|
| **Kimin için** | Şirket içi kurulum, verinin tamamen sizde kalması, kapalı ağlar | Sıfır bakım, Google altyapısı |
| **Kimlik doğrulama** | Dahili E-posta/Şifre + JWT (bcrypt) | Firebase Authentication (roller custom claim'lerde) |
| **Veritabanı** | PostgreSQL 16 (şema otomatik kurulur) | Cloud Firestore (güvenlik kuralları dahil) |
| **Kurulum** | `docker compose up -d` — hepsi bu | Firebase projesi + servis hesabı |
| **Nerede çalışır** | Docker/VPS, Vercel + yönetilen Postgres | Vercel, Docker/VPS, Node çalışan her yer |

Seçim ve yapılandırma için interaktif sihirbazı çalıştırın:

```bash
npm install
npm run setup
```

Sihirbaz, yerel kullanım için çalışmaya hazır bir `.env` üretir (güçlü gizli
anahtarları sizin yerinize oluşturur) ve seçiminize göre sonraki adımları
ekrana yazar. Vercel, Railway, Render, Fly.io veya Cloud Run gibi platformlarda
aynı isimleri platformun Environment Variables / Secrets alanına girin;
uygulama değerleri çalışma zamanında `process.env` üzerinden okur.

---

## Hızlı başlangıç A — Docker Compose ile kendi sunucunuzda (önerilen)

Her şey otomatiktir: veritabanı konteyneri oluşturulur, şema uygulanır,
yetkiler ayarlanır ve ilk Admin hesabı otomatik açılır.

```bash
git clone https://github.com/<siz>/itacm.git
cd itacm
cp .env.example .env
# .env dosyasında en azından JWT_SECRET'ı doldurun (openssl rand -hex 32)
# İsterseniz ADMIN_EMAIL / ADMIN_PASSWORD belirleyin

docker compose up -d
docker compose logs api        # ← ilk çalıştırmada Admin bilgileri burada yazdırılır
curl http://localhost:8000/api/health
```

> `ADMIN_PASSWORD` boş bırakılırsa güçlü ve rastgele bir şifre üretilir ve API
> loglarında **bir kez** gösterilir. İlk girişten sonra mutlaka değiştirin.

Giriş yapıp API'yi çağırın:

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<loglardan-veya-env>"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl http://localhost:8000/api/dashboard/stats -H "Authorization: Bearer $TOKEN"
```

## Hızlı başlangıç B — Firebase (yönetilen)

### 1. Firebase projesini oluşturun

1. [console.firebase.google.com](https://console.firebase.google.com) → **Proje ekle**
2. **Authentication → Sign-in method** → **Email/Password**'ü etkinleştirin
3. **Firestore Database → Create database** (production mode)

### 2. Servis hesabı anahtarı alın — ve güvenle saklayın 🔒

**Project settings → Service accounts → Generate new private key** bir JSON
dosyası indirir. Bu dosya **projenize tam erişim sağlayan bir kimlik
bilgisidir. Asla commit etmeyin, asla repo klasörünün içine koymayın.**
(`.gitignore` güvenlik ağı olarak `*serviceAccount*.json` desenini engeller,
ama dosyaya bir parola gibi davranın.)

Uygulamaya şu yollardan **biriyle** verin:

| Yöntem | Nasıl | Nerede kullanılır |
|---|---|---|
| **Base64 env değişkeni** (önerilen) | `base64 -i key.json \| tr -d '\n'` → `FIREBASE_SERVICE_ACCOUNT_BASE64` | Vercel ve tüm PaaS secret depoları |
| Ham JSON env değişkeni | JSON'u `FIREBASE_SERVICE_ACCOUNT_JSON` içine yapıştırın | CI secret'ları |
| Dosya yolu | `GOOGLE_APPLICATION_CREDENTIALS=/repo/disinda/bir/yol/key.json` | yerel geliştirme |
| Açık ADC kullanımı | `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true` | Google Cloud runtime'ları |

`npm run setup` sihirbazı base64 dönüşümünü sizin için yapar ve anahtar
dosyasını asla projenin içine kopyalamaz.

Firebase modunda dahili web arayüzünü kullanacaksanız ayrıca bir Firebase Web
App oluşturup `FIREBASE_WEB_CONFIG` değerini tek satırlık web config JSON'u
olarak girin. Bu değer public Firebase istemci config'idir; Admin servis hesabı
anahtarı değildir.

### 3. Yapılandırın, kuralları deploy edin, ilk Admin'i oluşturun

```bash
npm run setup                # 2. seçeneği (Firebase) seçin
firebase deploy --only firestore:rules,firestore:indexes
npm start
node scripts/setUserRole.js --create admin@sirket.com 'S3cret!' 'IT Admin' Admin
```

Roller **Firebase Auth custom claim'lerinde** saklanır; yani her ID token'ın
içine kriptografik olarak gömülüdür. Rol değişince kullanıcının refresh
token'ları anında iptal edilir.

Firebase modunda **istemci**, Firebase Web SDK ile giriş yapar
(`signInWithEmailAndPassword`) ve aldığı ID token'ı
`Authorization: Bearer <ID_TOKEN>` olarak gönderir. PostgreSQL modunda ise
istemci `POST /api/auth/login` çağırır. Sonrası iki modda da birebir aynıdır.

---

## Yayına alma (Deployment)

### Vercel

1. Repo'yu GitHub'a push'layın ve Vercel'de **Import Project** deyin —
   `vercel.json` hazırdır (tüm `/api/*` trafiği tek serverless fonksiyona gider).
2. **Project Settings → Environment Variables** bölümüne Production için
   gerekli değerleri ekleyin (branch deploy istiyorsanız Preview için de
   ekleyin). Secret değerleri `vercel.json`, kaynak kod veya repo içine
   yazmayın.
   - **Firebase modu:** `DATA_BACKEND=firebase`,
     `FIREBASE_SERVICE_ACCOUNT_BASE64=<base64 servis hesabı JSON'u>`,
     `FIREBASE_WEB_CONFIG=<tek satır web config JSON'u>`
   - **Postgres modu:** `DATA_BACKEND=postgres`,
     `DATABASE_URL=<yönetilen Postgres URL>`, `PGSSL=true`,
     `JWT_SECRET=<openssl rand -hex 32>`, `ADMIN_EMAIL`,
     `ADMIN_USERNAME`, `ADMIN_PASSWORD`
3. Deploy edin. Şema ilk cold start'ta otomatik uygulanır.

Vercel Environment Variables değerlerini serverless fonksiyona `process.env`
üzerinden verir; değişiklikler sadece yeni deployment'lara uygulanır, bu yüzden
env değişikliğinden sonra yeniden deploy edin. Postgres için tercih edilen isim
`DATABASE_URL`'dir. Bir Marketplace entegrasyonu `POSTGRES_URL` üretirse ITACM
bunu fallback olarak kullanır; serverless için sağlayıcının *pooled* bağlantı
adresini tercih edin.

### VPS / şirket içi Docker

Yukarıdaki compose dosyası Docker kurulu her sunucuda aynen çalışır. 8000
portunun önüne TLS'li bir reverse proxy (Caddy/Nginx/Traefik) koyun ve
`CORS_ORIGINS` değerini frontend adresinize ayarlayın.

### Diğer platformlar (Railway, Render, Fly.io, Cloud Run…)

`Dockerfile`'ı deploy edin, bir Postgres eklentisi bağlayın ve compose ile aynı
env değişkenlerini platformun secret/env yöneticisine girin. Başka bir şey
gerekmez — kurulum açılışta otomatiktir.

---

## Yapılandırma referansı

| Değişken | Mod | Zorunlu | Açıklama |
|---|---|---|---|
| `DATA_BACKEND` | ikisi | ✅ | `postgres` veya `firebase` |
| `PORT` | ikisi | – | HTTP portu (varsayılan `8000`) |
| `CORS_ORIGINS` | ikisi | – | Virgülle ayrılmış izinli origin'ler |
| `DATABASE_URL` | postgres | ✅ | Tercih edilen Postgres URL'i: `postgres://user:pass@host:5432/db` |
| `POSTGRES_URL` | postgres | – | Platform entegrasyonu `DATABASE_URL` yerine bunu üretirse fallback olarak kullanılır |
| `PGSSL` | postgres | – | TLS'li yönetilen Postgres için `true` |
| `JWT_SECRET` | postgres | ✅ | En az 32 karakter — `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | postgres | – | Token ömrü (varsayılan `12h`) |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | postgres | – | İlk Admin (şifre boşsa otomatik üretilir) |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | firebase | ✅* | Base64 kodlu servis hesabı JSON'u |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | firebase | ✅* | Ham JSON alternatifi |
| `GOOGLE_APPLICATION_CREDENTIALS` | firebase | ✅* | Dosya yolu alternatifi (yerel geliştirme) |
| `FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS` | firebase | ✅* | Anahtar dosyası olmadan Google Cloud ADC kullanmak için `true` |
| `FIREBASE_WEB_CONFIG` | firebase | – | Public Firebase Web App config JSON'u; dahili UI login'i için gerekli |

\* Firebase Admin credential kaynaklarından tam olarak biri.

## API referansı

Tüm yanıtlar `{ success, data }` veya `{ success: false, error, details? }`
biçimindedir. `login`/`health` dışındaki tüm endpoint'ler
`Authorization: Bearer <TOKEN>` ister.

| Metot | Endpoint | Roller | Açıklama |
|---|---|---|---|
| POST | `/api/auth/login` | herkese açık | E-posta/şifre → JWT *(postgres modu)* |
| POST | `/api/auth/verify-token` | tümü | Token doğrula, profil + izinleri döndür |
| GET/POST | `/api/auth/users` | Admin | BT kullanıcılarını listele / oluştur |
| PUT | `/api/auth/users/:uid/role` | Admin | Kullanıcı rolünü değiştir |
| GET | `/api/dashboard/stats` | tümü | Sayımlar, stok & lisans uyarıları, son hareketler |
| GET | `/api/assets` | tümü | Envanter listesi — `?status=&category=&search=` |
| GET | `/api/assets/:id` | tümü | Varlık detayı + denetim geçmişi |
| POST / PUT | `/api/assets`, `/api/assets/:id` | Admin, Helpdesk | Donanım oluştur / güncelle |
| POST | `/api/assets/:id/return` | Admin, Helpdesk | Zimmetli varlığı stoğa iade et |
| POST | `/api/handovers` | Admin, Helpdesk | **Atomik zimmet sepeti** (aşağıda) |
| GET | `/api/handovers`, `/:id` | tümü | Tutanaklar (yazdırma ekranını besler) |
| GET/POST | `/api/maintenance` | Admin, Helpdesk | Onarım kayıtları / servise gönder |
| PUT | `/api/maintenance/:id/close` | Admin, Helpdesk | Onarımı kapat (hurda için `{scrap:true}`) |
| GET | `/api/employees` | tümü | Personel rehberi + zimmet personel seçici |
| POST / PUT | `/api/employees` | Admin, Helpdesk | Oluştur / güncelle (üzerinde zimmet varken pasife alınamaz) |
| GET | `/api/licenses`, `/api/consumables` | tümü | Uyarı işaretli listeler |
| POST | `/api/licenses`, `/:id/seats` | Admin, Helpdesk | Oluştur / atomik koltuk tahsis-bırakma |
| POST | `/api/consumables`, `/:id/stock` | Admin, Helpdesk | Oluştur / atomik stok hareketi |

### Atomik zimmet sepeti

```http
POST /api/handovers
{
  "employeeId": "…",
  "documentType": "single",
  "items": [
    { "assetId": "…", "conditionNote": "Yeni, kutulu" },
    { "assetId": "…", "conditionNote": "İkinci el, temiz" }
  ]
}
```

**Tek transaction** içinde (Firestore `runTransaction` / Postgres
`BEGIN … FOR UPDATE`): her varlığın `In Stock` olduğu doğrulanır → tutanak
belgesi oluşturulur → her varlık çalışana bağlı `Assigned` durumuna geçer →
çalışanın `activeAssetCount` sayacı artar → her varlık için bir denetim satırı
yazılır. Sepetteki **tek bir** varlık bile kilitliyse API, varlık bazında
çakışma listesiyle `409` döner ve **hiçbir şey yazılmaz**. Satır kilitleri /
transaction yeniden denemeleri sayesinde iki operatörün aynı laptopu aynı anda
zimmetlemesi imkânsızdır.

## Güvenlik notları

- **Gizli bilgiler asla repoda yaşamaz.** `.env` ve `*serviceAccount*.json`
  git tarafından yok sayılır; kurulum sihirbazı `.env` dosyasını `0600` izniyle
  yazar ve Firebase anahtarını dosya kopyalamak yerine env değişkenine çevirir.
  Vercel veya benzer platformlarda bu değerleri platformun Environment
  Variables / Secrets alanında saklayın; uygulama `process.env` üzerinden okur.
- **Postgres modu:** şifreler bcrypt ile hash'lenir (cost 12); JWT'ler ≥32
  karakterlik gizli anahtarla HS256 imzalanır; girişte bilinmeyen e-posta ile
  yanlış şifre aynı hatayı döndürür (hesap taraması engellenir); her istekte
  kullanıcı satırı tekrar okunur, böylece rol değişikliği/silme anında etki eder.
- **Firebase modu:** roller custom claim'lerdedir (değiştirilemez); token'lar
  `checkRevoked` ile doğrulanır; Firestore güvenlik kuralları
  ([firestore.rules](firestore.rules)) istemcilere yalnızca okuma izni verir,
  tüm yazmaları bu API'ye zorlar.
- **İletişim:** API'nin önüne daima HTTPS koyun (Vercel bunu otomatik yapar;
  VPS'te Caddy/Nginx kullanın). `CORS_ORIGINS` değerini frontend'inizin tam
  adresine ayarlayın.

## Proje yapısı

```
├── server.js                  Node/Docker girişi (postgres modunda otomatik migrasyon)
├── api/index.js               Vercel serverless girişi
├── public/                    Dahili web arayüzü (vanilla JS SPA, build adımı yok)
├── src/
│   ├── app.js                 Express uygulaması + route bağlama
│   ├── config/                Env okuma ve backend seçimi
│   ├── middleware/            Bearer auth + rol kapısı, hata yönetimi
│   ├── routes/                İnce controller'lar (backend'den bağımsız)
│   └── providers/
│       ├── firebase/          Firebase Auth + Firestore implementasyonu
│       └── postgres/          JWT auth + PostgreSQL implementasyonu (schema.sql, otomatik migrasyon)
├── scripts/setup.js           İnteraktif backend seçici (npm run setup)
├── scripts/setUserRole.js     Firebase custom-claims CLI aracı
├── docker-compose.yml         Kendi sunucunda tam yığın (API + Postgres)
├── Dockerfile
├── vercel.json
├── firestore.rules            Firestore güvenlik kuralları (firebase modu)
└── .env.example               Eksiksiz belgelenmiş yapılandırma şablonu
```

## Geliştirme

```bash
npm install
npm run setup      # veya .env'i elle yazın
npm run dev        # otomatik yeniden başlayan yerel sunucu
npm run lint       # söz dizimi denetimi
npm run migrate    # Postgres şemasını elle uygula (opsiyonel)
```

## Lisans

[MIT](LICENSE)
