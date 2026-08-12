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

## 11. Enes'e karar soruları
1. Geçmiş PDF'ler **ITACM üretimi mi, taranmış görüntü mü, yoksa eski bir sistemin formatı mı?** (OCR gerekliliğini ve çıkarım sezgisini belirler.)
2. Her tutanak **1 sayfa mı, değişken mi?** Kişi başına ayrı dosya mı, tek büyük birleşik PDF mi yüklenecek?
3. Formların dili (Türkçe etiketler) — evet varsayıyorum, doğru mu?
4. **Düşük güvenli** eşleşmeler otomatik mi yüklensin, yoksa her zaman senin onayını mı istesin?
