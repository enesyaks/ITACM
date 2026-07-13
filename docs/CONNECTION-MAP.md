# ITACM — Bağlantı Haritası (Connection Map)

> Geliştirme yaparken ÖNCE buraya bak. Bir özelliğe dokunurken bu zincirin
> TÜM katmanlarını güncelle: **View (public/js/views.js) → API endpoint
> (src/routes/*.routes.js) → Service (src/providers/postgres/*Service.js) →
> Tablo (schema.sql, idempotent ALTER ile migre edilir)**.

## Çalışma şekli
- Tek Express süreci: JSON API (`/api/*`) + statik SPA (`public/`, build adımı yok).
- Docker Compose: `db` (postgres:16) + `api` (node:20). Kod imaja gömülü →
  her kod değişikliğinde `docker compose up -d --build`.
- Şema her açılışta `migrate.js` ile idempotent uygulanır (CREATE/ALTER IF NOT EXISTS).
- Auth: JWT (Bearer). Roller: Owner > Admin > Helpdesk > Viewer
  (`src/middleware/auth.js`, `src/utils/permissions.js`).

## Katman zinciri (özellik → dosyalar)

| Alan | View (views.js) | Route dosyası | Service | Tablolar |
|---|---|---|---|---|
| Dashboard | `Views.dashboard` | dashboard.routes.js | dashboardService | assets, licenses, consumables, handovers |
| Donanım | `Views.assets`, `assetForm`, `showAssetDetail` | assets.routes.js | assetService | assets, asset_history |
| Çalışanlar | `Views.employees`, `showEmployeeDetail`, `employeeForm` | employees.routes.js | employeeService, documentService | employees, handover_documents |
| Zimmet | `Views.handover`, `printHandover`, `handoverReceiptHTML` | handovers.routes.js | handoverService (+utils/handoverPdf, handoverArchive) | handovers, assets, asset_history |
| Bakım | `Views.maintenance`, `showMaintNotes` | maintenance.routes.js | maintenanceService, documentService | maintenance_logs, maintenance_documents |
| Lisanslar | `Views.licenses` | licenses.routes.js | licenseService | licenses, license_assignments |
| Sarf | `Views.consumables` | consumables.routes.js | consumableService | consumables |
| Katalog | `Views.catalog` | catalog.routes.js | catalogService, settingsService | catalog_models, app_settings (locations/lifecycles/specs/departments) |
| Raporlar | `Views.reports`, `REPORT_BUILDERS`, `CUSTOM_SOURCES` | (mevcut endpointleri okur) | — | — |
| BT Kullanıcıları | `Views.users` | auth.routes.js | authProvider | users, login_logs, user_admin_logs |
| Ayarlar/Onboarding | `showSettings`, `showTemplateCustomizer` (app.js), `#ob-*` | setup.routes.js | settingsService | app_settings |
| Belgeler (indirme) | `downloadAuthed`, `viewAuthed` | documents.routes.js + maintenance.routes.js | documentService | handover_documents, maintenance_documents |
| Stok Sayımı | `Views.stockcount` | counts.routes.js | countService | stock_counts, stock_count_scans |
| Mobil Hatlar | `Views.lines`, `showEmployeeDetail` | lines.routes.js | lineService | mobile_lines, mobile_line_history |
| Excel Migrasyonu | `showImportModal` (Assets) | import.routes.js | importService | employees, assets, catalog_models, handovers, asset_history |

## Kritik paylaşılan yardımcılar
- `public/js/ui.js`: `$`, `esc` (XSS!), `openModal/formModal/confirmModal`, `bindView`, `toast`, `badge`, `parseCsv`
- `public/js/i18n.js`: `t()` / `setLang()` / `applyStaticI18n` — dil allowlist'i `I18N_LANGS`; bilinmeyen anahtar İngilizce'ye düşer
- `public/js/api.js`: `api()` (Bearer ekler), `Auth`, `AppConfig` (= GET /api/config; app_settings'in kamuya açık kısmı — yeni ayar eklersen otomatik gelir)
- `public/js/barcode.js`: `code128SVG` — bağımlılıksız Code128-B
- `public/js/vendor/zxing.min.js`: kamera QR/barkod OKUMA (stok sayımı). Vendor edilmiş **@zxing/library** tarayıcı build'i. SHA-256 `d7cc8f69dd70bdcf3ac00c9ae572bf2acb9f4132ba379c72df842e4db918652d` — güncellerken resmi npm dağıtımıyla karşılaştır (tedarik zinciri izlenebilirliği). CSP `script-src 'self'` olduğu için yerel dosya zorunlu.
- `src/utils/uploadGuard.js`: `validateUpload` — magic-byte kontrolü; TÜM dosya yükleme rotaları bunu KULLANMALI
- `src/utils/defaults.js`: DEFAULT_LIFECYCLES / LOCATIONS / SPEC_OPTIONS / HANDOVER_TEMPLATE / DEPARTMENTS
- `src/providers/postgres/pool.js`: `query`, `withTransaction`, `ping`, `isAuthError`
- `src/providers/postgres/rowMapper.js`: snake_case→camelCase (`mapRow/mapAsset/isUuid`) — yeni kolonlar otomatik camelCase API'ye çıkar

## Tuzaklar / kurallar
1. **Yazdırma**: `#print-root` + `@media print` (app.css). Zimmet: `fitReceiptsToOnePage()` tek sayfa garantisi. Etiketler: `printAssetLabels`.
2. **Gövde limiti**: global JSON 1MB; belge yükleme rotaları kendi 12MB parser'ını kullanır ve `src/app.js`'teki bypass regex'ine eklenmelidir.
3. **CSP**: `script-src 'self'` — CDN yok; her JS `public/js/`'e konur, index.html'e eklenir.
4. **Zimmet şablonu**: `app_settings.handover_template` → hem `handoverReceiptHTML` (ekran) hem `handoverPdf.js` (sunucu) uygular. İkisini birlikte değiştir.
5. **Lifecycle**: kategori varsayılanı `app_settings.lifecycles` + cihaz bazlı `assets.lifecycle_months` override; **0 = EOL takibi kapalı**. Hesap 2 yerde: `dashboardService.getEolAssets` (sunucu) ve `lifecycleInfo` (views.js) — birlikte değiştir.
6. **.env**: `POSTGRES_PASSWORD` volume oluşturulunca sabitlenir → değiştirme yolu `npm run change-db-password`. Asla `down -v` önermek yok.
7. **Sıralı asset tag**: `nextAssetTag()` `IT-xxxx` üretir; çakışmada retry.
8. **Belge depolama**: DB içinde BYTEA (yedeklere dahil). Cloud provider entegrasyonu YOK (bilinçli).
9. **Handover "Delivered By"**: `handovers.it_user_name` oluşturulurken saklanır; reprint orijinal ismi kullanır (kullanıcı pasifse aktif kullanıcı).
