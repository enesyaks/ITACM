# Plan: Toplu Geçmiş Zimmet PDF İçe Aktarımı (Bulk Historical Zimmet PDF Import)

**Durum:** Taslak / planlama · **Branch:** `feat/bulk-zimmet-pdf-import`

## 1. Amaç

Sistemi ilk kurup varlıkları içe aktardıktan sonra, kullanıcıların **eski/geçmiş zimmet tutanağı PDF'lerini** doğru çalışanların profiline dağıtmak. Kullanıcı bir veya birden çok PDF yükler (bir PDF içinde birden fazla tutanak olabilir); sistem:

1. Toplu PDF'i tek tek tutanaklara **böler**,
2. Her tutanaktaki **zimmetlenen kişinin adını** okur,
3. Bu adı sistemdeki bir çalışanla **eşler**,
4. Eşleşirse PDF'i o çalışanın profiline (`handover_documents`) **yükler**,
5. Eşleşmezse/belirsizse bir **liste** sunar ve kullanıcıdan hangi profile yükleneceğini **seçmesini** ister.

## 2. Mevcut altyapı (yeniden kullanılacak)

| Parça | Yer | Not |
|---|---|---|
| Belge kaydetme | `documentService.saveDocument({employeeId, kind, filename, mime, buffer, ...})` | `handover_documents` tablosuna yazar + `docStorage.writeBuffer('handover', id, buffer)` |
| Çalışan belge arşivi | `GET/POST /api/employees/:id/documents` | Profilde zaten görünür; izin: `handover_document:*` + `employee:view_handover` |
| Upload güvenliği | `uploadGuard.validateUpload()` | Magic-byte tür doğrulama + 8MB sınırı + `safeFilename` |
| Şema | `handover_documents(kind, filename, mime, byte_size, content, storage_path, employee_id, employee_name…)` | `kind` alanı ile arşiv tipini ayırırız (`legacy_zimmet`) |
| Import UX deseni | `importService` (dry-run önizleme → commit) | Aynı "önce önizle, sonra onayla" akışını izleriz |

**Kritik eksik:** PDF **okuma ve bölme** kütüphanesi yok (yalnızca `pdfkit` üretim için). Yeni bağımlılık eklenecek.

## 3. Kullanıcı akışı (3 adımlı sihirbaz)

```
[1] Yükle            [2] Analiz & Önizleme          [3] Eşleştir & Onayla
─────────────        ────────────────────────       ──────────────────────
Bir/çok PDF sürükle   Sistem böler + isim okur +      Eşleşmeyenleri elle
(toplu olabilir)      çalışanla eşler; her tutanak    seç (dropdown);
                      için: [ad] [eşleşen çalışan]    "Onayla" → profillere
                      [güven %] [sayfa aralığı]       yüklenir
```

- **Adım 2 (analiz):** Hiçbir şey kalıcı yazılmaz — bölünmüş PDF'ler geçici olarak "staging" alanında tutulur.
- **Güven seviyeleri:** 🟢 Yüksek (otomatik eşleşti) · 🟡 Belirsiz (birden çok aday) · 🔴 Bulunamadı. Yalnızca 🟡/🔴 kullanıcı müdahalesi ister.
- **Adım 3 (commit):** Her tutanak seçilen çalışanın profiline `saveDocument(kind='legacy_zimmet')` ile eklenir; staging temizlenir.

## 4. Teknik mimari

### 4.1 Yeni bağımlılıklar
- **`pdf-lib`** (MIT, saf JS) — PDF yükle, sayfaları ayırıp yeni PDF'ler üret (bölme).
- **`pdfjs-dist`** (Mozilla, MIT) — sayfa bazında **metin çıkarımı** (isim okuma + bölme sınırı tespiti).
- **`tesseract.js`** (OCR, opsiyonel — **Faz 2**) — metin katmanı olmayan **taranmış** PDF'ler için. Ağır (wasm + dil verisi); opt-in yapılır.

### 4.2 Yeni backend parçaları
- `src/utils/pdfSplit.js` — PDF'i tutanaklara böler (bkz. §5).
- `src/utils/pdfText.js` — sayfa bazında metin çıkarır (pdfjs).
- `src/utils/nameMatch.js` — Türkçe-duyarlı normalize + bulanık eşleştirme (bkz. §6).
- `src/providers/postgres/zimmetImportService.js` — analiz (böl→oku→eşle) + commit (attach).
- `src/routes/zimmetImport.routes.js` — yeni uç noktalar (§7).

### 4.3 Staging (geçici saklama)
İki seçenek — **DB tablosu önerilir**:
- `zimmet_import_batches(id, created_by, created_at, status, source_count)`
- `zimmet_import_items(id, batch_id, source_filename, page_from, page_to, extracted_name, matched_employee_id, confidence, status, staged_path)`
- Bölünmüş PDF'ler `DATA_DIR/staging/zimmet/<batchId>/<itemId>.pdf` altında; commit veya iptal/TTL ile silinir.

## 5. PDF bölme stratejisi (en zor kısım)

Bir "toplu PDF"in nerede bitip yenisinin başladığını bilmek gerekir. Kademeli yaklaşım:

1. **Ayrı dosyalar** → Kullanıcı kişi başına bir PDF yüklediyse: bölme yok, dosya = tutanak. (En basit, çoğu durumu kapsar.)
2. **Marker tabanlı** → Her tutanağın ilk sayfasındaki tekrarlayan başlığı (ör. "ZİMMET TESLİM TUTANAĞI", belge no deseni) metinde ara; bu başlığı içeren her sayfa yeni tutanak başlatır, arası önceki tutanağa ait. (ITACM üretimi PDF'ler için sağlam.)
3. **Sabit N sayfa** → Her tutanak N sayfaysa (ör. 1), N'e böl.
4. **Elle sayfa aralığı** → Önizleme ekranında kullanıcı sınırları düzeltebilir (nihai emniyet).

**Öneri:** Marker tabanlı otomatik + önizlemede elle düzeltme; ayrı dosya durumunu doğal olarak destekle.

## 6. İsim okuma + eşleştirme

### 6.1 İsim çıkarımı
- **ITACM üretimi PDF:** bilinen şablon düzeni → "Teslim Alan / Personel" etiketinin yanındaki metni al.
- **Eski/legacy PDF:** iki yöntem:
  - **Etiket-yakını:** "Ad Soyad", "Personel", "Teslim Alan", "Zimmetlenen", "Kullanıcı" etiketlerinin yakınındaki metni al.
  - **Ters eşleştirme (güçlü):** Sayfa metnini çıkar, **sistemdeki her çalışan adını metinde ara** — geçen ad kuvvetli sinyaldir (çünkü çalışan listesi elimizde).

### 6.2 Eşleştirme algoritması (`nameMatch.js`)
- **Normalize:** Türkçe küçük harf (İ/ı, Ş, Ğ, Ü, Ö, Ç), aksan/noktalama temizliği, fazla boşluk, ünvan atma.
- **Exact normalize eşleşme** → 🟢 yüksek güven (otomatik).
- **Tek bulanık aday** (token-sort + Levenshtein oranı > eşik) → 🟢/🟡 (yalnız tek aday eşiği geçerse otomatik).
- **Çok aday / eşik altı** → 🔴 elle seçim (dropdown).

## 7. API uç noktaları

| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/api/import/zimmet/analyze` | Bir/çok PDF → böl+oku+eşle → batch önizleme döner (staging'e yazar) |
| GET | `/api/import/zimmet/batches/:id` | Önizlemeyi tekrar getir |
| GET | `/api/import/zimmet/items/:id/preview` | Bölünmüş tek PDF'i incelemek için stream |
| POST | `/api/import/zimmet/commit` | `{batchId, assignments:[{itemId, employeeId}]}` → profillere ekle |
| DELETE | `/api/import/zimmet/batches/:id` | Staging'i iptal et/temizle |

**İzin:** `handover_document:upload` + `employee:view_handover` (mevcut modeli yeniden kullan). Owner/Admin fallback ile erişir; özel gruplar açıkça verilmeli. Analiz ayrıca `employee:read` ister (eşleştirme için liste).

## 8. Güvenlik

- Her bölünmüş dosya için `uploadGuard` (magic-byte + 8MB) yeniden uygulanır.
- Batch başına **toplam boyut + tutanak sayısı sınırı** (DoS'a karşı).
- OCR (Faz 2) CPU-yoğun → sayfa/boyut sınırı, opt-in.
- Staging dosyaları web-kökü dışında, yalnızca API üzerinden erişilir; commit/iptal/TTL ile temizlenir.
- Çıkarılan metin **güvenilmez veri** — gösterimde `esc()`, hiçbir yerde eval/SQL'e gömme yok.
- Commit **tek transaction**; kısmi başarı durumunda net rapor.
- Audit: her attach `document.upload` olarak zaten loglanır; batch analiz/commit için ek audit olayı eklenir.

## 9. Kenar durumlar
- Metin katmanı olmayan (taranmış) PDF → Faz 1'de "okunamadı, elle seç" olarak işaretle; Faz 2 OCR.
- Aynı ada sahip iki çalışan → 🟡 belirsiz, elle seçim.
- Zaten yüklenmiş aynı tutanak → içerik hash'i ile duplikasyon uyarısı (opsiyonel).
- Bozuk/şifreli PDF → hata yakala, item'ı "başarısız" işaretle, batch'i bozma.
- Çok büyük batch → parça parça işleme / ilerleme göstergesi.

## 10. Fazlar
- **Faz 1 (çekirdek):** çok-dosya yükleme, metin-katmanı çıkarımı, ters isim-eşleştirme, önizleme + elle atama, commit attach, marker/elle bölme. (ITACM üretimi + metin katmanlı legacy PDF'leri kapsar.)
- **Faz 2:** taranmış PDF'ler için OCR (tesseract.js, opt-in).
- **Faz 3:** cila — küçük resim önizleme, yüksek-güvenlileri toplu kabul, geri alma, duplikasyon tespiti.

## 11. Uygulama durumu (Faz 1 — tamamlandı)

Faz 1 planlandığı gibi çıktı; aşağıdakiler plandan **sapan veya plana eklenen** kararlar:

| Konu | Karar |
|---|---|
| Staging depolama | `DATA_DIR/staging/...` yerine `zimmet_import_items.content` (bytea). Dosya sistemi ile DB arasında ikinci bir tutarlılık sorunu doğmuyor; commit/iptal/TTL'de tek yerden siliniyor. |
| TTL temizliği | `zimmetImportService.purgeStale()` — `utils/scheduler` saatte bir çağırıyor. 24 saati geçen `pending` batch'ler silinir; kapanmış batch'lerde kalan byte'lar (commit ortasında çökme) boşaltılır. |
| İzin kapsamı | Rota izni plandaki gibi (`handover_document:upload` + `employee:view_handover`), **ek olarak** aday listesi ve commit hedefi kullanıcının `employee:read` departman kısıtıyla sınırlanır — toplu yol, tekil yükleme yolunun reddedeceği bir profile belge yazamaz. Batch'ler yalnızca sahibine görünür. |
| Bölme markörü | Sayfanın herhangi bir yerinde değil, **ilk 6 satırdaki kısa bir başlık satırında** aranır. Gövde metnindeki "…işbu zimmet tutanağı…" ifadesi 3 sayfalık tek formu 3 forma bölüyordu. |
| Türkçe büyük harf | JS'in `/i` bayrağı `İ` (U+0130) ile `i`'yi eşleştirmez: `ZİMMET`, `TESLİM ALAN` gibi **normal form yazımları hiç yakalanmıyordu**. Tüm markör/etiket regex'leri `nameMatch.foldTr()` ile katlanmış metin üzerinde çalışır. |
| Güven eşiği | "Yüksek" için tek başına puan farkı yetmez; ikinci aday da iyi bir eşleşmeyse (≥0.90) sonuç **belirsiz** kalır (§9'daki "aynı ada sahip iki çalışan" durumu). Ters eşleşmede tek kelimelik roster kayıtları yok sayılır. |
| Limitler | Dosya başına 8MB (uploadGuard), batch başına 20 dosya / 55MB / 300 form / dosya başına 400 sayfa. Sayfa sınırı metin çıkarımından **önce** kontrol edilir. |
| Audit | `describeRequest` kuralları eklendi: `import.zimmet.analyze` / `.commit` / `.discard`. |
| Commit atomikliği | Tek transaction yerine **batch claim** (`UPDATE … WHERE status='pending' RETURNING`) + tutanak bazında rapor. `saveDocument` dosya sistemine de yazdığı için tek transaction gerçek bir garanti vermiyordu; çift tıklama/çift sekme artık iki kez ekleyemez. |
| Testler | `tests/zimmet-import.test.js` — bölme ve isim eşleştirme (DB'siz saf fonksiyonlar). |

Faz 3 (küçük resim, toplu kabul, geri alma, duplikasyon) açık.

## 12. Uygulama durumu (Faz 2 — OCR, tamamlandı)

Taranmış (metin katmanı olmayan) PDF'ler artık otomatik okunuyor. **Varsayılan kapalı** — `ZIMMET_OCR=1` ile açılır.

**Plandan sapan tek büyük karar: rasterization yok.**
Beklenen yol "pdfjs ile sayfayı canvas'a çiz → OCR"du. `@napi-rs/canvas` görüntü içeren sayfaları çizerken **segfault** veriyor (SIGSEGV/SIGABRT, Node 26 + arm64), üstelik Alpine imajına native modül sokuyordu. Yerine: **taranmış sayfa zaten tek bir görüntüdür** — pdfjs o görüntüyü bizim için çözüyor (DCT/CCITT/JBIG2/Flate hepsi düz piksel olarak geliyor), biz pikselleri sıkıştırmasız bir **BMP**'ye sarıp Tesseract'a veriyoruz. Sonuç: native bağımlılık yok, alpine/musl/arm64'te aynı şekilde çalışıyor, rasterization maliyeti de yok.

| Konu | Karar |
|---|---|
| Açma/kapama | **Ayarlar → Entegrasyonlar**'daki Owner anahtarı (DB'de `app_settings.zimmet_ocr`). `ZIMMET_OCR` env'i yalnızca varsayılan; anahtar bir kez kullanıldığında onu ezer, yani açıp kapatmak için restart gerekmez. `update_check` ile aynı üç durumlu desen (NULL = env'i devral). |
| Bağımlılık | Yalnızca `tesseract.js` (Apache-2.0), **optionalDependency**. `npm ci --omit=optional` yapılmış bir kurulum yine açılır; `availability()` nedeni bildirir, import patlamaz. |
| Dil verisi | `DATA_DIR/tessdata/<lang>.traineddata`. Dosyalar oradaysa sunucu **hiç internete çıkmaz** (hava boşluklu kurulum). Yoksa tesseract.js kendi CDN'inden çeker. Varsayılan `tur+eng`. |
| Bütçe | `ZIMMET_OCR_MAX_PAGES` (varsayılan 40) **batch başına** — dosya başına değil. `analyze()` tek bir HTTP isteği ve OCR sayfa başına ~2sn; proxy timeout'una girmemesini sağlayan şey bu. Bütçe biterse kalan sayfalar boş döner ve arayüz bunu söyler. |
| Boru hattına etkisi | OCR metni, dijital PDF'in metin katmanıyla **aynı yere** besleniyor: bölme (`detectForms`) ve isim eşleştirme değişmedi. Yani çok formlu bir **tarama** da doğru bölünüyor. |
| İzlenebilirlik | `zimmet_import_items.via_ocr` + arayüzde "OCR" rozeti — OCR çıktısı metin katmanından daha az güvenilir, inceleyen bunu görmeli. |
| Hata durumu | OCR hatası batch'i düşürmez; ilgili dosya `failures[]`'a düşer, form elle atanır. |
| Görüntü ayrıntıları | RGBA beyaza yassıltılır (şeffaf tarama siyah okunmasın), 1bpp maskeler açılır ve sayfa çoğunlukla koyuysa ters çevrilir, BMP başlığına DPI yazılır (yoksa Tesseract 70dpi varsayıp gözle görülür kötü okuyor). |
| Migration | 050 — `via_ocr`, `error`, `failed` statüsü. 049 zaten uygulanmış veritabanları için idempotent tamamlayıcı. |

**Ölçüm (örnek dosya, 5 sayfalık tarama, 4 tutanak):** 14 sn, 4/4 tutanak doğru bölündü, 3'ü otomatik yüksek güvenle eşleşti, listede olmayan 1 isim elle seçime düştü. Örnek dosyalar: `docs/samples/zimmet-ornek-dijital.pdf` ve `docs/samples/zimmet-ornek-tarama.pdf`.

**Bilinen sınır:** Sayfa başına en fazla 4 görüntü OCR'lanır ve çok küçük görüntüler (logo, kaşe) atlanır. Sayfayı onlarca parçaya bölen egzotik tarayıcı çıktılarında eksik okuma olabilir.

## 13. Uygulama durumu (çok dillilik — tamamlandı)

Başlangıçta yalnızca Türkçe (ve kısmen İngilizce) belgeler okunuyordu. Artık uygulamanın gönderildiği **12 dilin hepsinde** çalışıyor.

**Asıl hata tek satırdaydı.** `normalizeName` şu filtreyi uyguluyordu:

```js
s.replace(/[^a-z0-9\s]/g, ' ')   // a-z dışındaki her şey silinir
```

`أحمد الشمري` → **boş string**. Rusça, Japonca, Yunanca aynı. Yani isim karşılaştırma aşamasına gelmeden yok oluyordu — "eşleşemedi" değil, "ortada isim kalmadı". Latin dilleri kurtuluyordu çünkü hem roster hem PDF metni aynı bozulmadan geçtiği için yine birbirini tutuyordu. Filtre `\p{L}` (her alfabeden harf) oldu.

| Parça | Ne değişti |
|---|---|
| `normalizeName` | ASCII beyaz listesi yerine Unicode harf sınıfı. Kiril/Arapça/CJK isimler artık korunuyor. |
| `foldTr` | Aksan haritası 12 dilin Latin harflerini kapsayacak şekilde genişletildi (ä, é, ł, ñ, ø, ó…). **Her giriş 1 karakter → 1 karakter**, çünkü `nameFromLabel` sonucu kaynak metinden offset ile kesiyor; NFD ya da ß→ss bu değişmezliği bozardı. |
| Ters arama (CJK) | Japonca/Çince isim boşluksuz tek kelimedir (`田中太郎`) — "en az 2 kelime" kuralı hepsini eliyordu. 3+ ideograf tam isim sayılıyor ve CJK metninde boşluk sınırı olmadığı için düz alt-dize aranıyor. 2 karakterli soyadı (`田中`) hâlâ reddediliyor. |
| Form başlıkları | 12 dilin tutanak başlığı eklendi (`ÜBERGABEPROTOKOLL`, `АКТ ПРИЁМА-ПЕРЕДАЧИ`, `محضر تسليم`, `貸与物受領書`…). Başlıklardaki boşluklar tire de kabul ediyor — Fransızca `PROCÈS-VERBAL` bu yüzden kaçıyordu. |
| Etiket okuma | 12 dilin "teslim alan" karşılıkları + isim yakalama sınıfı `[a-z]` yerine `\p{L}`. |
| OCR dili | `ZIMMET_OCR_LANGS` boşsa **instance dilinden** türetiliyor (`ja` → `jpn+eng`). Japonca bir kurulumun taramalarını Türkçe modelle okumaya çalışması anlamsızdı. Açık ayar her zaman kazanır. |

**Doğrulama:** 12 dilin tamamında ters arama + etiket + bölme testleri (`tests/zimmet-import.test.js`), ayrıca 5 dilde (tr/de/fr/pl/ru) gerçek PDF üretip pdfjs ile okuyup uçtan uca eşleştirme — 5/5. Arapça ve CJK metin işleme düzeyinde doğrulandı; pdfkit'te Arapça shaping olmadığı için o dilde gerçek PDF üretilemedi.

**Yanlış pozitif korumaları korundu:** tek kelimelik Latin isim (`Ali`) hâlâ reddediliyor, gövde metnindeki marker çok sayfalı formu hâlâ bölmüyor.

**Bilinen sınır:** OCR için ilgili dilin `traineddata` dosyası gerekiyor (`ara`, `rus`, `jpn`… hepsi tessdata_fast'ta mevcut). Dosya yoksa tesseract.js CDN'e çıkar; hava boşluklu kurulumda inceleme ekranı hangi dillerin yüklü olduğunu yazıp eksik dosyayı işaret ediyor.

## 14. Enes'e karar soruları
1. Geçmiş PDF'ler **ITACM üretimi mi, taranmış görüntü mü, yoksa eski bir sistemin formatı mı?** (OCR gerekliliğini ve çıkarım sezgisini belirler.)
2. Her tutanak **1 sayfa mı, değişken mi?** Kişi başına ayrı dosya mı, tek büyük birleşik PDF mi yüklenecek?
3. Formların dili (Türkçe etiketler) — evet varsayıyorum, doğru mu?
4. **Düşük güvenli** eşleşmeler otomatik mi yüklensin, yoksa her zaman senin onayını mı istesin?
