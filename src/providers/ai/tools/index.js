const { resolveLifecycles, resolveLifeMonths, bookValue } = require('../../../utils/depreciation');
const { HttpError } = require('../../../utils/httpError');

function services() {
  return require('../../../services');
}

const SUPPORTED_LANGS = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'ja'];

function normalizeLang(value) {
  const code = String(value || '').trim().slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(code) ? code : 'en';
}

const STRINGS = {
  atLeast: { en: 'at least ', tr: 'en az ' },
  unitCount: { en: 'count', tr: 'adet' },

  subInStock: { en: 'in stock', tr: 'stokta' },
  tagAssigned: { en: 'assigned', tr: 'zimmetli' },
  tagStock: { en: 'stock', tr: 'stok' },
  tagDevice: { en: 'device', tr: 'cihaz' },
  tagLine: { en: 'line', tr: 'hat' },
  seats: { en: '{used}/{total} seats', tr: '{used}/{total} koltuk' },
  deviceCount: { en: '{n} devices', tr: '{n} cihaz' },
  docCount: { en: '{n} documents', tr: '{n} belge' },
  contractCount: { en: '{n} contracts', tr: '{n} sözleşme' },
  endsOn: { en: 'ends {date}', tr: 'bitiş {date}' },
  lineFree: { en: 'free', tr: 'boşta' },
  consumableStock: { en: 'stock {n} · min {min}', tr: 'stok {n} · min {min}' },
  tagLowStock: { en: 'low stock', tr: 'az stok' },
  tagStockOk: { en: 'stock ok', tr: 'stok ok' },
  serviceFallback: { en: 'service', tr: 'servis' },
  tagOpen: { en: 'open', tr: 'açık' },
  tagClosed: { en: 'closed', tr: 'kapalı' },
  scanCount: { en: '{n} scans', tr: '{n} tarama' },
  itemCount: { en: '{n} items', tr: '{n} kalem' },
  tagAcked: { en: 'acknowledged', tr: 'onaylı' },
  tagPending: { en: 'pending', tr: 'bekliyor' },
  yes: { en: 'yes', tr: 'evet' },
  no: { en: 'no', tr: 'hayır' },

  actReturned: { en: 'returned', tr: 'geri alındı' },
  actAssigned: { en: 'assigned', tr: 'zimmet verildi' },
  actSentToRepair: { en: 'sent to repair', tr: 'onarıma gönderildi' },

  linkAssets: { en: 'open in inventory', tr: 'envanterde aç' },
  linkEmployee: { en: 'open employee', tr: 'çalışanı aç' },
  linkDepartment: { en: 'open department', tr: 'departmanı aç' },
  linkEmployees: { en: 'open in employees', tr: 'çalışanlarda aç' },
  linkLicenses: { en: 'open in licenses', tr: 'lisanslarda aç' },
  linkContracts: { en: 'open contracts', tr: 'sözleşmeleri aç' },
  linkLines: { en: 'open lines', tr: 'hatları aç' },
  linkConsumables: { en: 'open consumables', tr: 'sarfları aç' },
  linkMaintenance: { en: 'open maintenance', tr: 'bakımı aç' },
  linkStockCounts: { en: 'open stock counts', tr: 'sayımları aç' },
  linkHandover: { en: 'open handovers', tr: 'handover aç' },

  fileEmployeesAll: { en: 'employees-all', tr: 'calisanlar-tumu' },
  fileEmployees: { en: 'employees', tr: 'calisanlar' },
  fileLicenses: { en: 'licenses', tr: 'lisanslar' },
  fileContracts: { en: 'contracts', tr: 'sozlesmeler' },
  fileProviders: { en: 'contracted-providers', tr: 'sozlesmeli-tedarikciler' },
  fileDocs: { en: 'employees-with-documents', tr: 'belgesi-olan-calisanlar' },
  fileInventory: { en: 'inventory', tr: 'envanter' },
  fileAssigned: { en: 'assigned-devices', tr: 'zimmetli-cihazlar' },
  fileByCategory: { en: 'category-breakdown', tr: 'kategori-dagilimi' },
  fileHistory: { en: 'assignment-history-{name}', tr: 'zimmet-gecmisi-{name}' },

  assetNoEmployeeMatch: { en: 'No employee matches "{who}". Try a fuller name, or list active employees.', tr: '"{who}" için eşleşen çalışan yok. Daha tam ad deneyin veya aktif çalışanları listeleyin.' },
  employeeNotFoundSuggest: {
    en: 'No employee named "{who}". Closest matches: {names}. Pick one (exact spelling), or list active employees.',
    tr: '"{who}" adında çalışan yok. Yakın eşleşmeler: {names}. Birini tam adıyla seçin veya aktif çalışanları listeleyin.',
  },
  employeeAmbiguous: {
    en: '{n} employees match "{who}" — pick one: {names}.',
    tr: '"{who}" için {n} çalışan eşleşti — birini seçin: {names}.',
  },
  employeeOnlyThese: {
    en: 'Live directory — only these people match (do not invent other names): {names}.',
    tr: 'Canlı dizin — yalnızca bu kişiler eşleşiyor (başka isim uydurma): {names}.',
  },
  fuEmployeeDevices: { en: '{name} devices?', tr: '{name} üzerindeki cihazlar?' },
  fuEmployeeHistory: { en: '{name} assignment history?', tr: '{name} zimmet geçmişi?' },
  assetFound: { en: 'Found {prefix}{n} {noun}', tr: '{prefix}{n} {noun} bulundu' },
  assetBreakAssigned: { en: '{n} assigned', tr: '{n} zimmetli' },
  assetBreakStock: { en: '{n} in stock', tr: '{n} stokta' },
  assetNoneWho: {
    en: 'No devices found for {who}. They may have returned everything — check assignment history, or broaden the name.',
    tr: '{who} için cihaz bulunamadı. Hepsi iade edilmiş olabilir — zimmet geçmişine bakın veya adı genişletin.',
  },
  assetNoneCriteria: {
    en: 'No devices match the criteria. Try another location, status, or category — or open the location distribution.',
    tr: 'Kriterlere uyan cihaz yok. Başka lokasyon, durum veya kategori deneyin — ya da lokasyon dağılımına bakın.',
  },

  licenseNoun: { en: 'licenses', tr: 'lisans' },
  licenseNounLife: { en: 'licenses ({life})', tr: 'lisans ({life})' },
  licenseNone: { en: 'No matching licenses.', tr: 'Eşleşen lisans yok.' },

  employeeNounActive: { en: 'active employees', tr: 'aktif çalışan' },
  employeeNounInactive: { en: 'inactive employees', tr: 'inaktif çalışan' },
  employeeNoun: { en: 'employees', tr: 'çalışan' },
  employeeBreakdown: {
    en: '{active} active, {inactive} inactive — {total} employees in total.',
    tr: '{active} aktif, {inactive} inaktif — toplam {total} çalışan.',
  },
  employeeNone: { en: 'No matching employees.', tr: 'Eşleşen çalışan yok.' },

  contractNoun: { en: 'contracts', tr: 'sözleşme' },
  contractNounStatus: { en: '{status} contracts', tr: '{status} sözleşme' },
  contractExpirySuffix: { en: ' (≤{days} days)', tr: ' (≤{days} gün)' },
  contractNone: { en: 'No matching contracts{suffix}.', tr: 'Eşleşen sözleşme yok{suffix}.' },
  providerNoun: { en: 'contracted providers', tr: 'sözleşmeli tedarikçi' },
  providerSummary: { en: '{n} providers with {contracts} contracts.', tr: '{n} tedarikçi ile {contracts} sözleşme.' },
  providerNone: { en: 'No contracted providers.', tr: 'Sözleşmeli tedarikçi yok.' },

  docNoun: { en: 'employees have documents on their profile', tr: 'çalışanın profilinde belge var' },
  docPartial: {
    en: '{n} employees have documents on their profile (showing the first {shown}).',
    tr: '{n} çalışanın profilinde belge var (ilk {shown} gösteriliyor).',
  },
  docNone: { en: 'No employee has documents on their profile.', tr: 'Profiline belge yüklenmiş çalışan yok.' },

  opsNoEmployee: { en: 'No employee found for "{who}".', tr: '"{who}" için çalışan bulunamadı.' },
  opsNone: { en: 'No matching {noun}.', tr: 'Eşleşen {noun} yok.' },
  lineNounEmployee: { en: 'lines held by {name}', tr: '{name} üzerindeki hat' },
  lineNounStatus: { en: '{status} lines', tr: '{status} hat' },
  lineNoun: { en: 'mobile lines', tr: 'mobil hat' },
  consumableNounLow: { en: 'low-stock consumables', tr: 'az stoklu sarf' },
  consumableNoun: { en: 'consumables', tr: 'sarf malzemesi' },
  maintenanceNounOpen: { en: 'open maintenance records', tr: 'açık bakım' },
  maintenanceNounClosed: { en: 'closed maintenance records', tr: 'kapanmış bakım' },
  maintenanceNoun: { en: 'maintenance/repair records', tr: 'bakım/onarım' },
  stockCountNoun: { en: 'stock counts', tr: 'stok sayımı' },
  stockCountNone: { en: 'No stock counts.', tr: 'Stok sayımı yok.' },
  handoverNounEmployee: { en: 'handover forms for {name}', tr: '{name} handover formu' },
  handoverNoun: { en: 'handover forms', tr: 'handover formu' },
  opsUnknownDomain: {
    en: 'Unknown domain: {domain}. Use line|consumable|maintenance|stock_count|handover.',
    tr: 'Bilinmeyen domain: {domain}. line|consumable|maintenance|stock_count|handover kullan.',
  },

  historyEmployeeRequired: { en: 'An employee name is required (employee).', tr: 'Çalışan adı gerekli (employee).' },
  historyLabelReturned: { en: 'returned', tr: 'geri alınan' },
  historyLabelAssigned: { en: 'assigned', tr: 'verilen' },
  historyLabelAny: { en: 'history', tr: 'geçmiş' },
  historyKindLine: { en: 'lines', tr: 'hat' },
  historyKindDevice: { en: 'devices', tr: 'cihaz' },
  historyKindAny: { en: 'records', tr: 'kayıt' },
  historyNoun: { en: '{name} — {label} {kind}', tr: '{name} — {label} {kind}' },
  historySummary: { en: '{name} — {prefix}{n} {label} {kind}.', tr: '{name} — {prefix}{n} {label} {kind}.' },
  historyNone: { en: 'No {label} {kind} for {name}.', tr: '{name} için {label} {kind} yok.' },
  historyNoneHint: {
    en: ' (They may still hold assigned devices — check with search_assets.)',
    tr: ' (Hâlâ üzerinde zimmetli cihaz olabilir — search_assets ile bak.)',
  },

  reportByCategory: { en: '{prefix}{n} devices, {categories} categories.', tr: '{prefix}{n} cihaz, {categories} kategori.' },
  reportInventory: { en: '{prefix}{n} devices (inventory).', tr: '{prefix}{n} cihaz (envanter).' },
  reportAssigned: { en: '{prefix}{n} assigned devices.', tr: '{prefix}{n} zimmetli cihaz.' },

  reportPlanList: {
    en: 'Plan: {title} (filter: {filters}). {prefix}{n} records.',
    tr: 'Plan: {title} (filtre: {filters}). {prefix}{n} kayıt.',
  },
  reportPlanGroup: {
    en: 'Plan: {title} by {group} (filter: {filters}). {prefix}{n} records.',
    tr: 'Plan: {title} — {group} dağılımı (filtre: {filters}). {prefix}{n} kayıt.',
  },
  reportTitleList: { en: 'Device list', tr: 'Cihaz listesi' },
  reportTitleAtLocation: { en: 'Devices at {location}', tr: '{location} cihaz listesi' },
  reportTitleDistribution: { en: 'Distribution report', tr: 'Dağılım raporu' },
  reportNoLocation: {
    en: 'Plan: no location matched "{query}". Known locations: {known}.',
    tr: 'Plan: "{query}" ile eşleşen lokasyon yok. Bilinenler: {known}.',
  },
  reportResolvedLocation: {
    en: 'resolved location={location}',
    tr: 'eşleşen lokasyon={location}',
  },
  reportFilterNone: { en: 'none', tr: 'yok' },
  reportGroupLocation: { en: 'location', tr: 'lokasyon' },
  reportGroupStatus: { en: 'status', tr: 'durum' },
  reportGroupCategory: { en: 'category', tr: 'kategori' },
  reportUnknownBucket: { en: 'Unknown', tr: 'Bilinmiyor' },
  fuCategoryDist: { en: 'category distribution?', tr: 'kategori dağılımı?' },
  fuLocationDist: { en: 'location distribution?', tr: 'lokasyon dağılımı?' },
  fuStatusDist: { en: 'status distribution?', tr: 'durum dağılımı?' },
  fuDownloadCsv: { en: 'download CSV', tr: 'CSV indir' },
  fuDownloadPdf: { en: 'download PDF', tr: 'PDF indir' },
  fuEolOnes: { en: 'EOL devices?', tr: 'EOL olanlar?' },
  fuCategoryAt: { en: '{location} by category', tr: '{location} kategori dağılımı' },
  fuStatusAt: { en: '{location} by status', tr: '{location} durum dağılımı' },
  fuEolAt: { en: 'EOL devices at {location}?', tr: '{location} EOL cihazlar?' },
  fuWarrantySoonAt: { en: 'warranties ending soon at {location}?', tr: '{location} garantisi bitmek üzere olanlar?' },
  fuTryOtherStatus: { en: 'try In Stock / Assigned?', tr: 'Stokta / Zimmetli dene?' },
  fuTryKnownLocations: { en: 'location distribution of all sites', tr: 'tüm lokasyonların dağılımı' },
  metricTotal: { en: 'total', tr: 'toplam' },
  metricAssigned: { en: 'assigned', tr: 'zimmetli' },
  metricStock: { en: 'in stock', tr: 'stokta' },
  metricEol: { en: 'EOL', tr: 'EOL' },
  fileReport: { en: 'report', tr: 'rapor' },
  fileLocationDist: { en: 'location-distribution', tr: 'lokasyon-dagilimi' },
  fileStatusDist: { en: 'status-distribution', tr: 'durum-dagilimi' },
  colLocation: { en: 'Location', tr: 'Lokasyon' },
  colStatus: { en: 'Status', tr: 'Durum' },
  colCategory: { en: 'Category', tr: 'Kategori' },
  colCount: { en: 'Count', tr: 'Adet' },
  colPct: { en: '%', tr: '%' },
  pdfTag: { en: 'Tag', tr: 'Etiket' },
  pdfBrandModel: { en: 'Brand / Model', tr: 'Marka / Model' },
  pdfAssigned: { en: 'Assigned to', tr: 'Zimmetli' },

  compSummary: { en: 'Comprehensive search for "{query}": {parts} found.', tr: '"{query}" için kapsamlı arama: {parts} bulundu.' },
  compNone: {
    en: 'No matching records for "{query}". Try a fuller name, a department, or a software/vendor keyword.',
    tr: '"{query}" için eşleşen kayıt yok. Daha tam ad, departman veya yazılım/tedarikçi anahtar kelimesi deneyin.',
  },
  compDevices: { en: '{n} hardware devices', tr: '{n} donanım cihazı' },
  compCost: { en: ' (Total Cost: ${cost}, Book Value: ${bookValue})', tr: ' (Toplam maliyet: ${cost}, defter değeri: ${bookValue})' },
  compEmployees: { en: '{n} employees', tr: '{n} çalışan' },
  compLicenses: { en: '{n} software licenses', tr: '{n} yazılım lisansı' },
  compContracts: { en: '{n} contracts', tr: '{n} sözleşme' },
  compLines: { en: '{n} mobile lines', tr: '{n} mobil hat' },
  compDocs: { en: '{n} employees with documents', tr: '{n} belgeli çalışan' },
  compConsumables: { en: '{n} consumables', tr: '{n} sarf malzemesi' },
  compMaintenance: { en: '{n} maintenance records', tr: '{n} bakım kaydı' },
  compStockCounts: { en: '{n} stock counts', tr: '{n} stok sayımı' },
  compHandovers: { en: '{n} handover records', tr: '{n} handover kaydı' },

  secDevices: { en: 'Hardware Devices', tr: 'Donanım Cihazları' },
  secEmployees: { en: 'Employees', tr: 'Çalışanlar' },
  secLicenses: { en: 'Software Licenses', tr: 'Yazılım Lisansları' },
  secContracts: { en: 'Contracts', tr: 'Sözleşmeler' },
  secLines: { en: 'Mobile Lines', tr: 'Mobil Hatlar' },
  secDocuments: { en: 'Documents', tr: 'Belgeler' },
  secConsumables: { en: 'Consumables', tr: 'Sarf Malzemeleri' },
  secMaintenance: { en: 'Maintenance / Repair', tr: 'Bakım / Onarım' },
  secStockCounts: { en: 'Stock Counts', tr: 'Stok Sayımları' },
  secHandovers: { en: 'Handover Forms', tr: 'Handover Formları' },

  toolHardware: { en: 'hardware', tr: 'donanım' },
  toolEmployee: { en: 'employee', tr: 'çalışan' },
  toolLicense: { en: 'license', tr: 'lisans' },
  toolContract: { en: 'contract', tr: 'sözleşme' },
  toolHistory: { en: 'history', tr: 'geçmiş' },
  toolReport: { en: 'report', tr: 'rapor' },
  toolDocument: { en: 'document', tr: 'belge' },
  toolOps: { en: 'operations', tr: 'operasyon' },
  toolComprehensive: { en: 'comprehensive search', tr: 'kapsamlı arama' },
  toolResult: { en: 'result', tr: 'sonuç' },

  fuListActiveEmployees: { en: 'list active employees', tr: 'aktif çalışanları listele' },
  fuStockLaptops: { en: 'laptops in stock?', tr: 'stoktaki dizüstüler?' },
  fuWhichDevices: { en: 'which devices?', tr: 'hangi cihazlar?' },
  fuReturned: { en: 'returned ones?', tr: 'geri alınanlar?' },
  fuNeverAssignedStock: { en: 'never-assigned stock?', tr: 'hiç zimmetlenmemiş stok?' },
  fuList: { en: 'list them', tr: 'listele' },
  fuEverAssignedStock: { en: 'previously assigned stock?', tr: 'daha önce zimmetlenmiş stok?' },
  fuEol: { en: 'end-of-life devices?', tr: 'ömrünü dolduranlar?' },
  fuTheirLicenses: { en: 'their licenses?', tr: 'lisansları?' },
  fuWarrantyEnded: { en: 'expired warranties?', tr: 'garantisi bitenler?' },
  fuReplacementCost: { en: 'replacement cost?', tr: 'değişim maliyeti?' },
  fuExpiringLicenses: { en: 'expiring licenses?', tr: 'süresi biten lisanslar?' },
  fuUnusedSeats: { en: 'unused seats?', tr: 'kullanılmayan koltuklar?' },
  fuEmployeesWithDocs: { en: 'employees with documents?', tr: 'belgesi olan çalışanlar?' },
  fuShowAssigned: { en: 'show assigned devices', tr: 'zimmetli cihazları göster' },
  fuReturnedDevices: { en: 'returned devices?', tr: 'geri alınan cihazlar?' },
  fuEmployeesNoAssets: { en: 'employees without assets?', tr: 'varlıksız çalışanlar?' },
  fuListContracts: { en: 'list contracts', tr: 'sözleşmeleri listele' },
  fuActiveContracts: { en: 'active contracts?', tr: 'aktif sözleşmeler?' },
  fuWhichProviders: { en: 'which providers?', tr: 'hangi tedarikçilerle?' },
  fuExpiringContracts: { en: 'contracts expiring soon?', tr: 'süresi yaklaşan sözleşmeler?' },
  fuListActiveContracts: { en: 'list active contracts', tr: 'aktif sözleşmeleri listele' },
  fuExpiringSoon: { en: 'expiring soon?', tr: 'süresi yaklaşanlar?' },
  fuListWithDocs: { en: 'list those with documents', tr: 'belgesi olanları listele' },
  fuActiveEmployeeCount: { en: 'active employee count?', tr: 'aktif çalışan sayısı?' },
  fuHowManyEmployees: { en: 'how many employees?', tr: 'kaç çalışan var?' },
  fuWhoHasHandoverDocs: { en: 'who has handover documents?', tr: 'zimmet belgeleri kimde?' },
  fuListActiveLines: { en: 'list active lines', tr: 'aktif hatları listele' },
  fuAssignedLines: { en: 'assigned lines?', tr: 'zimmetli hatlar?' },
  fuHowManyActiveLines: { en: 'how many active lines?', tr: 'kaç aktif hat?' },
  fuConsumables: { en: 'consumables?', tr: 'sarf malzemeleri?' },
  fuLowStock: { en: 'low-stock consumables?', tr: 'az stoklu sarflar?' },
  fuLowStockOnes: { en: 'the low-stock ones?', tr: 'az stoklu olanlar?' },
  fuOpenMaintenance: { en: 'open maintenance?', tr: 'açık bakımlar?' },
  fuListOpenMaintenance: { en: 'list open maintenance', tr: 'açık bakımları listele' },
  fuStockCounts: { en: 'stock counts?', tr: 'stok sayımları?' },
  fuHowManyOpenMaintenance: { en: 'how many open maintenance records?', tr: 'kaç açık bakım?' },
  fuConsumableStock: { en: 'consumable stock?', tr: 'sarf stokları?' },
  fuOpenCounts: { en: 'open counts?', tr: 'açık sayımlar?' },
  fuHandoverForms: { en: 'handover forms?', tr: 'handover formları?' },
  fuHowManyOpenCounts: { en: 'how many open counts?', tr: 'kaç açık sayım?' },
  fuMobileLines: { en: 'mobile lines?', tr: 'mobil hatlar?' },
  fuListHandovers: { en: 'list handover forms', tr: 'handover formlarını listele' },
  fuPendingForms: { en: 'forms awaiting acknowledgement?', tr: 'onay bekleyen formlar?' },
  fuHowManyHandovers: { en: 'how many handover forms?', tr: 'kaç handover formu?' },
  fuCurrentDevices: { en: 'devices currently held?', tr: 'şu an üzerindeki cihazlar?' },
  fuAssignedOnes: { en: 'assigned ones?', tr: 'zimmet verilenler?' },
  fuStockDevices: { en: 'devices in stock?', tr: 'stoktaki cihazlar?' },
  fuEolReport: { en: 'EOL report', tr: 'EOL raporu' },
  fuAssignmentList: { en: 'assignment list', tr: 'zimmet listesi' },
  fuEolAssigned: { en: 'end-of-life assigned devices?', tr: 'ömrünü dolduran zimmetler?' },
  fuStockStatus: { en: 'stock status?', tr: 'stok durumu?' },
  fuSampleReturned: { en: 'Burak Yılmaz returned items', tr: 'Burak Yılmaz geri alınanlar' },
  fuHistoryFor: { en: 'assignment history for "{query}"', tr: '"{query}" için zimmet geçmişi' },
  fuFreeStockDevices: { en: 'free devices in stock', tr: 'stoktaki boş cihazlar' },
  fuTheirDevices: { en: 'devices held by "{query}"?', tr: '"{query}" üzerindeki cihazlar?' },
  fuTheirLines: { en: 'lines held by "{query}"?', tr: '"{query}" üzerindeki hatlar?' },
  fuReturnExcess: { en: 'Return excess devices', tr: 'Fazla cihazları geri al' },
  fuCalcReplacement: { en: 'EOL replacement cost for "{query}"?', tr: '"{query}" EOL değişim maliyeti?' },
  fuCheckExpiry: { en: 'expiring licenses & contracts?', tr: 'süresi yaklaşan lisans / sözleşmeler?' },
  fuGroupByEmployee: { en: 'Group by employee', tr: 'Çalışana göre grupla' },
  fuCreateHandover: { en: 'Create handover form', tr: 'Handover formu oluştur' },
};

function tr(lang, key, vars) {
  const row = STRINGS[key];
  if (!row) return key;
  const code = normalizeLang(lang);
  const raw = row[code] != null ? row[code] : row.en;
  if (raw == null) return key;
  if (!vars) return raw;
  return String(raw).replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m));
}

function countSentence(lang, n, noun, approx) {
  return `${approx ? tr(lang, 'atLeast') : ''}${n} ${noun}.`;
}

const TOOL_LABEL_KEYS = {
  search_assets: 'toolHardware',
  find_employees: 'toolEmployee',
  list_licenses: 'toolLicense',
  list_contracts: 'toolContract',
  handover_history: 'toolHistory',
  run_report: 'toolReport',
  build_report: 'toolReport',
  document_summary: 'toolDocument',
  query_operations: 'toolOps',
  unified_search: 'toolComprehensive',
};

function toolLabel(name, lang) {
  const key = TOOL_LABEL_KEYS[name];
  if (!key) return name || tr(lang, 'toolResult');
  return tr(lang, key);
}

const TOOL_DEFS = [
  {
    name: 'search_assets',
    description:
      'Search IT hardware/assets. Filter by text search, category (Laptop, Desktop, Monitor, Phone, Tablet, Printer, Server, Network, Other), status (In Stock, Assigned, In Repair, Scrap, Sold), location, department (via assigned employee), lifecycle (eol/soon/ok), and assignment history (ever vs never zimmet\'ed via asset_history assigned/returned). "stokta daha önce zimmetlenmiş" → status=In Stock + history=ever_assigned; "hiç zimmetlenmemiş" → history=never_assigned. ever+never within the same status/filters ≈ total in that scope.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free-text: tag, serial, IMEI, brand, model, hostname, MAC' },
        category: { type: 'string', description: 'Exact category, e.g. Laptop' },
        status: { type: 'string', description: 'CSV statuses, e.g. Assigned,In Stock' },
        location: { type: 'string', description: 'Location filter' },
        department: { type: 'string', description: 'Department of assigned employee (e.g. finans, Marketing)' },
        employee: { type: 'string', description: 'Assigned employee name (partial match, e.g. Burak Yılmaz)' },
        lifecycle: { type: 'string', enum: ['eol', 'soon', 'ok', 'any'], description: 'EOL filter; default any' },
        history: {
          type: 'string',
          enum: ['ever_assigned', 'never_assigned', 'any'],
          description:
            'ever_assigned = at least one asset_history assigned/returned row; never_assigned = none; any = ignore history (default)',
        },
        previously_assigned: {
          type: 'string',
          enum: ['true', 'false', 'any'],
          description: 'Alias: true→ever_assigned, false→never_assigned, any→any',
        },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = only return the number (for "kaç cihaz" questions); list = full rows' },
        limit: { type: 'integer', description: 'Max rows (default 40, max 100)' },
      },
    },
  },
  {
    name: 'list_licenses',
    description:
      'List software licenses / seat pools (Adobe, Slack, Microsoft 365, …). NOT vendor contracts — for sözleşmeler / provider contracts use list_contracts.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter by software name or vendor' },
        lifecycle: { type: 'string', enum: ['active', 'expiring', 'expired', 'cancelled', 'any'] },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = only the number for "kaç lisans" questions' },
        limit: { type: 'integer', description: 'Max rows (default 40, max 100)' },
      },
    },
  },
  {
    name: 'list_contracts',
    description:
      'Vendor / supplier contracts (Providers & Contracts). "kaç sözleşme", "hangi providerlarla sözleşme imzalanmış", contract count. group=provider → unique providers that have ≥1 contract. "süresi yaklaşan / bitmek üzere / expiring" → expiringWithinDays=90. Do NOT use for software licenses or mobile lines.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter by contract title, number, or provider name' },
        status: {
          type: 'string',
          enum: ['Active', 'Draft', 'Expired', 'Cancelled', 'Renewed', 'any'],
          description: 'Contract status; default any',
        },
        expiringWithinDays: {
          type: 'integer',
          description: 'Only Active/Draft contracts ending within N days (e.g. 60 or 90 for süresi yaklaşan)',
        },
        group: {
          type: 'string',
          enum: ['contract', 'provider'],
          description: 'contract = list contracts (default); provider = providers with signed contracts',
        },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = number only' },
        limit: { type: 'integer', description: 'Max rows (default 40, max 100)' },
      },
    },
  },
  {
    name: 'find_employees',
    description:
      'Find employees by name, email, title, or department. For "kaç çalışan" use mode=count. "aktif ve inaktif" / total headcount → status=any (returns both counts). Default status=Active.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name / email / title search' },
        department: { type: 'string', description: 'Exact or CSV department' },
        status: { type: 'string', enum: ['Active', 'Inactive', 'any'], description: 'Default Active; any = aktif+inaktif breakdown' },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = only the number for "kaç çalışan" questions' },
        limit: { type: 'integer', description: 'Max rows (default 40, max 100); ignored in count mode' },
      },
    },
  },
  {
    name: 'document_summary',
    description:
      'Profil/zimmet belgesi özeti: kaç çalışanın profiline (≥1) belge yüklenmiş; isteğe bağlı liste. "kaç kullanıcın profiline belge yüklenmiş", "belgesi olan çalışanlar" için bunu kullan. Kaynak: handover_documents (çalışan Documents sekmesi).',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional employee name / email / department filter' },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = only how many employees have docs; list = those employees' },
        limit: { type: 'integer', description: 'Max employee rows in list mode (default 40)' },
      },
    },
  },
  {
    name: 'handover_history',
    description:
      'Zimmet geçmişi: bir çalışandan GERİ ALINAN (returned / iade) veya ona VERİLEN (assigned) cihaz ve mobil hat kayıtları. "geri almışız", "iade", "teslim alınan", "hangi cihazları aldık" soruları için bunu kullan — search_assets değil. Mevcut zimmet için search_assets / query_operations domain=line kullan. "kaç iade" → mode=count.',
    parameters: {
      type: 'object',
      required: ['employee'],
      properties: {
        employee: { type: 'string', description: 'Employee name (e.g. Burak Yılmaz)' },
        action: {
          type: 'string',
          enum: ['returned', 'assigned', 'any'],
          description: 'returned = geri alınanlar (default for iade/geri al questions); assigned = verilenler; any = hepsi',
        },
        item_kind: {
          type: 'string',
          enum: ['device', 'line', 'any'],
          description: 'device = sadece cihaz; line = sadece hat; any = ikisi (default)',
        },
        mode: { type: 'string', enum: ['list', 'count'], description: 'count = filtered event total only' },
        limit: { type: 'integer', description: 'Max rows (default 40, max 100)' },
      },
    },
  },
  {
    name: 'query_operations',
    description:
      'Operasyonel kayıtlar: mobil hatlar (SIM), sarf malzemeleri, bakım/onarım, stok sayımı, zimmet/handover formları. Yazılım lisansı veya tedarikçi sözleşmesi için kullanma.',
    parameters: {
      type: 'object',
      required: ['domain'],
      properties: {
        domain: { type: 'string', enum: ['line', 'consumable', 'maintenance', 'stock_count', 'handover'] },
        mode: { type: 'string', enum: ['list', 'count'] },
        search: { type: 'string' },
        employee: { type: 'string' },
        status: { type: 'string', description: 'domain-specific filter string' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'run_report',
    description:
      'Run a built-in inventory report. report_id one of: eol, inventory, assignments, expiring-licenses, employees, in-stock, by-category, by-location, by-status. Prefer build_report for custom location/filter mixable reports. Do NOT use for "kaç çalışan" counts — use find_employees mode=count instead.',
    parameters: {
      type: 'object',
      required: ['report_id'],
      properties: {
        report_id: {
          type: 'string',
          enum: [
            'eol', 'inventory', 'assignments', 'expiring-licenses', 'employees',
            'in-stock', 'by-category', 'by-location', 'by-status',
          ],
        },
        limit: { type: 'integer', description: 'Max rows (default 50, max 100)' },
      },
    },
  },
  {
    name: 'build_report',
    description:
      'Mixable inventory REPORT builder. Use for “rapor”, “dağılım”, “grafik”, office/location device lists. Always put a one-sentence PLAN in summary first (what filters/group/chart). Prefer this over run_report for custom filters. entity=asset in Phase 1. format=both attaches CSV + branded PDF downloads in the UI — do not invent download links.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        location: { type: 'string' },
        status: { type: 'string', description: 'CSV statuses' },
        category: { type: 'string' },
        search: { type: 'string' },
        lifecycle: { type: 'string', enum: ['any', 'eol', 'soon', 'ok'] },
        group_by: { type: 'string', enum: ['none', 'location', 'status', 'category'] },
        chart: {
          type: 'string',
          enum: ['none', 'bar', 'pie'],
          description: 'bar/pie for distribution; default bar when group_by!=none and user asks grafik/dağılım, else none for plain lists',
        },
        format: { type: 'string', enum: ['preview', 'csv', 'both'], description: 'default both' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'unified_search',
    description:
      'Unified cross-domain search across hardware assets, software licenses, mobile lines, contracts, and documents for a person, department, location, or free-text query. Use for "Burak hakkındaki tüm kayıtlar", "Finans tüm varlıklar", or broad multi-domain investigations.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free-text search: person name, department, location, tag, vendor' },
        employee: { type: 'string', description: 'Employee name filter' },
        department: { type: 'string', description: 'Department filter' },
        limit: { type: 'integer', description: 'Max rows per section (default 20)' },
      },
    },
  },
  {
    name: 'advanced_query',
    description:
      'Advanced analytical query. Write ONE read-only PostgreSQL SELECT (aggregations, JOINs, GROUP BY, AVG/SUM/COUNT, cross-domain math) when the specific tools cannot express the question — e.g. "hangi departmanda ortalama cihaz yaşı en yüksek", "markaya göre toplam bakım maliyeti", "en çok lisansı olan 5 çalışan". For simple lists/counts prefer the dedicated tools. SELECT only, read-only; search_path is already "ai" so use unqualified view names. '
      + 'Available ai views: '
      + 'assets(asset_tag, serial_number, imei, imei2, brand, model, category, status[In Stock|Assigned|Reserved|Repair|Sold], current_employee_name, responsible_employee_name, location, warranty_end_date, purchase_date, cost, salvage_value, lifecycle_months, infra_role, created_at); '
      + 'asset_history(asset_tag, employee_name, action_type, notes, at); '
      + 'employees(full_name, email, department, title, status[Active|Inactive], active_asset_count, start_date, team_id, manager_employee_id); '
      + 'departments(name); teams(name, department_id, lead_employee_id); '
      + 'licenses(software_name, vendor, total_seats, used_seats, status, expiration_date, purchase_amount, purchase_currency, provider_id, contract_id); '
      + 'license_assignments(software_name, employee_name, assigned_at, revoked_at); '
      + 'contracts(title, category, status, start_date, end_date, renewal_date, auto_renew, cost_amount, cost_currency, billing_cycle, owner_employee_name); '
      + 'providers(name, category, status); '
      + 'mobile_lines(phone_number, operator, plan, monthly_cost, status, current_employee_name); '
      + 'consumables(item_name, total_stock, minimum_stock_alert_level); '
      + 'maintenance(asset_tag, service_company, issue_description, cost, sent_date, return_date, previous_status); '
      + 'stock_counts(name, location, status, created_at, closed_at); '
      + 'handovers(employee_name, transaction_date, document_type); '
      + 'catalog_models(category, brand, model, lifecycle_months); '
      + 'audit_log(action, source, summary, actor_name, entity_type, entity_label, created_at).',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'One read-only SELECT/WITH query against the ai.* views. No writes, no semicolons, no other schemas.' },
      },
      required: ['sql'],
    },
  },
];

function clampLimit(n, def = 40, max = 100) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(max, Math.floor(v));
}

function isCountMode(args) {
  return String(args?.mode || '').toLowerCase() === 'count';
}

function normalizeAssignmentHistory(args = {}) {
  const hist = String(args.history || '').toLowerCase().trim();
  if (['ever_assigned', 'ever', 'previously_assigned', 'assigned_before'].includes(hist)) {
    return 'ever_assigned';
  }
  if (['never_assigned', 'never', 'not_assigned', 'unassigned_history'].includes(hist)) {
    return 'never_assigned';
  }
  if (hist === 'any') return 'any';

  const pa = args.previously_assigned;
  if (pa === true || pa === 1) return 'ever_assigned';
  if (pa === false || pa === 0) return 'never_assigned';
  const paStr = String(pa ?? '').toLowerCase().trim();
  if (['true', 'yes', '1'].includes(paStr)) return 'ever_assigned';
  if (['false', 'no', '0'].includes(paStr)) return 'never_assigned';
  return 'any';
}

function filterByAssignmentHistory(items, everAssignedIds, mode) {
  if (mode === 'any' || !mode) return items || [];
  const set = everAssignedIds instanceof Set
    ? everAssignedIds
    : new Set((everAssignedIds || []).map((id) => String(id)));
  const list = items || [];
  if (mode === 'ever_assigned') return list.filter((a) => set.has(String(a.id)));
  if (mode === 'never_assigned') return list.filter((a) => !set.has(String(a.id)));
  return list;
}

function countPayload({ total, noun, tools, followups, uiKind, links, csv, approx, meta, lang }) {
  const n = Number(total) || 0;
  return {
    summary: countSentence(lang, n, noun, approx),
    rows: n > 0
      ? [{ id: 'stat-count', kind: 'stat', title: String(n), subtitle: noun, tags: [tr(lang, 'unitCount')] }]
      : [],
    meta: { totalMatched: n, totalScanned: n, mode: 'count', live: true, tools, ...(meta || {}) },
    followups: followups || [],
    ui: uiPayload(uiKind || 'stat', { links, csv }),
  };
}

const SCAN_PAGE = 500;
const SCAN_CAP = 5000;
const CSV_ROW_CAP = 1000;
const HISTORY_SCAN = 500;

async function scanAssets(assetService, filters, cap = SCAN_CAP) {
  const items = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += SCAN_PAGE) {
    const listed = await assetService.listAssets({
      ...filters,
      limit: Math.min(SCAN_PAGE, cap - offset),
      offset,
    });
    const page = listed.items || [];
    total = listed.total ?? (offset + page.length);
    items.push(...page);
    if (page.length < SCAN_PAGE) break;
    if (items.length >= total) break;
  }
  return { items, total, truncated: items.length < total };
}

function uiPayload(kind, { links, csv, reportId, chart, pdf, metrics } = {}) {
  const ui = { kind };
  if (reportId) ui.reportId = reportId;
  const list = (links || []).filter(Boolean);
  if (list.length) ui.links = list;
  if (csv && csv.rows && csv.rows.length) ui.csv = csv;
  if (chart && Array.isArray(chart.items) && chart.items.length) ui.chart = chart;
  if (pdf && pdf.url && pdf.filename) ui.pdf = pdf;
  if (Array.isArray(metrics) && metrics.length) ui.metrics = metrics;
  return ui;
}

function buildReportFollowups(lang, { groupBy, location, n, empty } = {}) {
  const loc = location ? String(location).trim() : '';
  const fus = [];
  if (empty || !n) {
    fus.push(tr(lang, 'fuTryKnownLocations'), tr(lang, 'fuTryOtherStatus'), tr(lang, 'fuStockLaptops'));
    return fus.slice(0, 3);
  }
  if (groupBy === 'none') {
    if (loc) {
      fus.push(tr(lang, 'fuCategoryAt', { location: loc }));
      fus.push(tr(lang, 'fuStatusAt', { location: loc }));
      fus.push(tr(lang, 'fuWarrantySoonAt', { location: loc }));
    } else {
      fus.push(tr(lang, 'fuCategoryDist'), tr(lang, 'fuLocationDist'), tr(lang, 'fuEolOnes'));
    }
  } else if (groupBy === 'location') {
    fus.push(tr(lang, 'fuCategoryDist'), tr(lang, 'fuStatusDist'), tr(lang, 'fuEolOnes'));
  } else if (groupBy === 'category') {
    fus.push(tr(lang, 'fuLocationDist'), tr(lang, 'fuStatusDist'), tr(lang, 'fuEolOnes'));
  } else {
    fus.push(tr(lang, 'fuLocationDist'), tr(lang, 'fuCategoryDist'), tr(lang, 'fuEolOnes'));
  }
  return fus.slice(0, 3);
}

function buildAssetFollowups(lang, {
  employee, historyMode, lifeFilter, location, empty, countMode,
} = {}) {
  if (employee) {
    return empty
      ? [tr(lang, 'fuReturned'), tr(lang, 'fuListActiveEmployees')]
      : (countMode
        ? [tr(lang, 'fuWhichDevices'), tr(lang, 'fuReturned')]
        : [tr(lang, 'fuEol'), tr(lang, 'fuTheirLicenses'), tr(lang, 'fuReturned')]);
  }
  if (empty) {
    const fus = [];
    if (location) fus.push(tr(lang, 'fuTryKnownLocations'));
    fus.push(tr(lang, 'fuTryOtherStatus'), tr(lang, 'fuLocationDist'), tr(lang, 'fuStockLaptops'));
    return fus.slice(0, 3);
  }
  if (historyMode === 'ever_assigned') {
    return [tr(lang, 'fuNeverAssignedStock'), tr(lang, 'fuList')];
  }
  if (historyMode === 'never_assigned') {
    return [tr(lang, 'fuEverAssignedStock'), tr(lang, 'fuList')];
  }
  if (lifeFilter === 'eol') {
    return [tr(lang, 'fuWarrantyEnded'), tr(lang, 'fuReplacementCost')];
  }
  if (location) {
    return [
      tr(lang, 'fuCategoryAt', { location }),
      tr(lang, 'fuEolAt', { location }),
      tr(lang, 'fuWarrantySoonAt', { location }),
    ];
  }
  return countMode
    ? [tr(lang, 'fuEol'), tr(lang, 'fuStockLaptops')]
    : [tr(lang, 'fuCategoryDist'), tr(lang, 'fuEol'), tr(lang, 'fuStockLaptops')];
}

function buildAssetMetrics(lang, { total, assigned, stock, eol }) {
  const metrics = [{ label: tr(lang, 'metricTotal'), value: total }];
  if (assigned) metrics.push({ label: tr(lang, 'metricAssigned'), value: assigned });
  if (stock) metrics.push({ label: tr(lang, 'metricStock'), value: stock });
  if (eol) metrics.push({ label: tr(lang, 'metricEol'), value: eol });
  return metrics.length > 1 ? metrics : [];
}

const TR_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

function foldAscii(s) {
  return String(s || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => TR_ASCII[c] || c)
    .replace(/\u0307/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveLocationFuzzy(query, knownLocations) {
  const q = foldAscii(query);
  if (!q) return { match: null, score: 0, known: knownLocations || [] };
  const known = [...new Set((knownLocations || []).map((l) => String(l || '').trim()).filter(Boolean))];
  if (!known.length) return { match: null, score: 0, known: [] };

  let best = null;
  let bestScore = 0;
  for (const loc of known) {
    const l = foldAscii(loc);
    if (!l) continue;
    let score = 0;
    if (l === q) score = 3;
    else if (l.startsWith(q) || q.startsWith(l)) score = 2;
    else if (l.includes(q) || q.includes(l)) score = 1;
    if (score > bestScore || (score === bestScore && best && loc.length < best.length)) {
      bestScore = score;
      best = loc;
    }
  }
  return { match: bestScore > 0 ? best : null, score: bestScore, known };
}

const LOCATION_JUNK = new Set([
  'bulunan', 'bulunanlar', 'olan', 'olanlar', 'listesini', 'listesi', 'listele', 'liste',
  'raporu', 'raporunu', 'rapor', 'report', 'cihaz', 'cihazlar', 'cihazlarin', 'cihazların',
  'device', 'devices', 'the', 'a', 'an', 've', 'and', 'ile', 'icin', 'için', 'bazli', 'bazlı',
  'dagilim', 'dağılım', 'distribution', 'grafik', 'chart',
]);

function isLocationJunk(value) {
  const q = foldAscii(value);
  if (!q || q.length < 2) return true;
  if (LOCATION_JUNK.has(q)) return true;
  return /^(bulunan|listesini|cihaz|device|rapor)/i.test(String(value || '').trim());
}

function findKnownLocationInText(text, knownLocations) {
  const folded = foldAscii(text);
  if (!folded) return null;
  const known = [...new Set((knownLocations || []).map((l) => String(l || '').trim()).filter(Boolean))];
  let best = null;
  let bestLen = 0;
  for (const loc of known) {
    const l = foldAscii(loc);
    if (!l || l.length < 2) continue;
    if (folded.includes(l) && l.length > bestLen) {
      best = loc;
      bestLen = l.length;
    }
  }
  return best;
}

function extractLocationQuery(prompt) {
  const p = String(prompt || '');
  if (!p.trim()) return null;

  const named = p.match(
    /\b((?:main|head|central|remote|home|service|istanbul|ankara|izmir|bursa|antalya|kad[iı]k[oö]y)[\w\s/.-]{0,40}?(?:office|ofis|branch|şube|sube|center|centre|warehouse|depo|merkez))\b/i
  );
  if (named && named[1] && !isLocationJunk(named[1])) return named[1].trim();

  const beforeOfis = p.match(
    /([A-ZÇĞİÖŞÜa-zçğıöşü0-9][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s/.-]{0,40}?)\s+ofis(?:inde|indeki|inin|i|te|ten|e)?\b/i
  );
  if (beforeOfis && beforeOfis[1] && !isLocationJunk(beforeOfis[1])) {
    const cand = `${beforeOfis[1].trim()} Ofis`;
    return beforeOfis[1].trim().length >= 2 ? beforeOfis[1].trim() : cand;
  }

  const afterKw = p.match(
    /(?:ofis|office|lokasyon|location)\s*[=:]?\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s/.-]{0,40}?)(?=\s+(?:bulunan|cihaz|device|list|rapor|report|dağılım|dagilim)|[.!?]|$)/i
  );
  if (afterKw && afterKw[1] && !isLocationJunk(afterKw[1])) return afterKw[1].trim();

  const beforeBulunan = p.match(
    /\b([A-ZÇĞİÖŞÜa-zçğıöşü0-9][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s/.-]{1,40}?)\s+bulunan\s+(?:cihaz|device)/i
  );
  if (beforeBulunan && beforeBulunan[1] && !isLocationJunk(beforeBulunan[1])) {
    return beforeBulunan[1].trim();
  }

  const city = p.match(/\b(istanbul|ankara|izmir|bursa|antalya|kadıköy|kadikoy|hq|headquarters)\b/i);
  if (city) return city[1];
  return null;
}

async function resolveAssetLocation(locationQuery, settingsLocs, assetService) {
  const q = String(locationQuery || '').trim();
  if (!q || isLocationJunk(q)) {
    return { match: null, known: settingsLocs || [], query: q };
  }
  let known = [...new Set((settingsLocs || []).map((l) => String(l || '').trim()).filter(Boolean))];
  const embedded = findKnownLocationInText(q, known);
  if (embedded) return { match: embedded, known, query: q };

  let fuzzy = resolveLocationFuzzy(q, known);
  if (!fuzzy.match && assetService) {
    const probe = await scanAssets(assetService, {}, SCAN_PAGE);
    const fromAssets = [...new Set(probe.items.map((a) => a.location).filter(Boolean))];
    known = [...new Set([...known, ...fromAssets])];
    const embedded2 = findKnownLocationInText(q, known);
    if (embedded2) return { match: embedded2, known, query: q };
    fuzzy = resolveLocationFuzzy(q, known);
  }
  return { match: fuzzy.match || null, known: fuzzy.known || known, query: q };
}

function aggregateAssetsBy(items, groupBy, lang = 'en') {
  const field = groupBy === 'location' || groupBy === 'status' || groupBy === 'category'
    ? groupBy
    : null;
  if (!field) return [];
  const unknown = tr(lang, 'reportUnknownBucket');
  const counts = new Map();
  for (const a of items || []) {
    const raw = a && a[field] != null ? String(a[field]).trim() : '';
    const key = raw || unknown;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = Math.max(1, (items || []).length);
  return [...counts.entries()]
    .map(([label, value]) => ({
      label,
      value,
      pct: Math.round((value / total) * 100),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function csvFilename(base) {
  const slug = String(base || '')
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => TR_ASCII[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'itacm-liste'}.csv`;
}

function pdfFilename(base) {
  return csvFilename(base).replace(/\.csv$/i, '.pdf');
}

async function attachReportPdf(ctx, {
  title,
  filtersLabel,
  chart,
  cols,
  rows,
  totalRows,
  truncated,
  settings,
}) {
  if (!ctx?.user || !(await canExport(ctx.user, 'asset'))) return null;
  try {
    const { buildReportPdf, slugPdfFilename } = require('../../../utils/reportPdf');
    const { saveAiExport } = require('../exportStore');
    const lang = normalizeLang(ctx.lang);
    const filename = slugPdfFilename(title || tr(lang, 'fileReport'));
    const buffer = await buildReportPdf({
      lang,
      title: title || tr(lang, 'fileReport'),
      companyName: settings?.companyName,
      companyLogo: settings?.companyLogo,
      companyAddress: settings?.companyAddress,
      filtersLabel,
      chart,
      cols,
      rows,
      totalRows,
      truncated,
      generatedAt: new Date(),
    });
    return saveAiExport({
      buffer,
      filename,
      userId: ctx.user.uid || ctx.user.id,
      contentType: 'application/pdf',
    });
  } catch {
    return null;
  }
}

function buildCsv({ filename, cols, rows, total, truncated = false, cap = CSV_ROW_CAP }) {
  const all = Array.isArray(rows) ? rows : [];
  const capped = all.slice(0, cap);
  const known = Math.max(all.length, Number(total) || 0);
  return {
    filename: csvFilename(filename),
    cols,
    rows: capped,
    truncated: !!truncated || capped.length < known,
  };
}

const ASSET_LIFECYCLE_PARAM = { eol: 'overdue', soon: 'soon' };

const ASSET_PAGE_CATEGORIES = [
  'Laptop', 'Desktop', 'Monitor', 'Television', 'Phone', 'Tablet', 'Printer', 'Keyboard',
  'Mouse', 'Headset', 'Docking Station', 'Webcam', 'Peripheral', 'Accessory', 'Other',
];

function hashLink(path, params, label) {
  const qs = Object.entries(params)
    .filter(([, v]) => String(v ?? '').trim() !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim())}`)
    .join('&');
  return { label, href: qs ? `${path}?${qs}` : path };
}

function buildAssetListLink(args = {}, historyMode = 'any', lang = 'en', label = null) {
  if (args.employee || args.department) return null;
  if (historyMode && historyMode !== 'any') return null;
  const cats = String(args.category || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (cats.some((c) => !ASSET_PAGE_CATEGORIES.includes(c))) return null;
  return hashLink('#/assets', {
    status: args.status,
    category: args.category,
    location: args.location,
    search: args.search,
    lifecycle: ASSET_LIFECYCLE_PARAM[String(args.lifecycle || '').toLowerCase()],
  }, label || tr(lang, 'linkAssets'));
}

function buildEmployeeListLink(args = {}, lang = 'en', labelKey = 'linkEmployee') {
  const status = ['Active', 'Inactive'].includes(args.status) ? args.status : undefined;
  return {
    ...hashLink('#/employees', {
      search: args.search,
      department: args.department,
      status,
    }, tr(lang, labelKey)),
    kind: 'employee',
  };
}

const EXPORT_CHECKS = {
  asset: [
    { resource: 'asset', action: 'export' },
    { resource: 'asset', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  employee: [
    { resource: 'employee', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  license: [
    { resource: 'license', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  contract: [
    { resource: 'contract', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  line: [
    { resource: 'line', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  consumable: [
    { resource: 'consumable', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  maintenance: [
    { resource: 'maintenance', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  stock_count: [
    { resource: 'stock_count', action: 'manage' },
    { resource: 'report', action: 'export' },
  ],
  handover: [
    { resource: 'report', action: 'export' },
  ],
};

async function canExport(user, kind) {
  const { permissionService } = services();
  try {
    return !!(await permissionService.checkAnyPermission(user, EXPORT_CHECKS[kind] || EXPORT_CHECKS.asset));
  } catch {
    return false;
  }
}

const CSV_COLS = {
  asset: {
    en: ['Tag', 'Category', 'Brand', 'Model', 'Serial', 'Status', 'Assigned to', 'Department', 'Location', 'EOL Date'],
    tr: ['Etiket', 'Kategori', 'Marka', 'Model', 'Seri No', 'Durum', 'Zimmetli', 'Departman', 'Lokasyon', 'EOL Tarihi'],
  },
  employee: {
    en: ['Full Name', 'Email', 'Department', 'Title', 'Status', 'Active Devices'],
    tr: ['Ad Soyad', 'E-posta', 'Departman', 'Unvan', 'Durum', 'Aktif Cihaz'],
  },
  license: {
    en: ['Software', 'Vendor', 'Total Seats', 'Used', 'Expiry Date', 'Status'],
    tr: ['Yazılım', 'Üretici', 'Toplam Lisans', 'Kullanılan', 'Bitiş Tarihi', 'Durum'],
  },
  history: {
    en: ['Date', 'Action', 'Device/Line', 'Tag', 'Employee', 'Note'],
    tr: ['Tarih', 'İşlem', 'Cihaz/Hat', 'Etiket', 'Çalışan', 'Not'],
  },
  document: {
    en: ['Full Name', 'Department', 'Document Count'],
    tr: ['Ad Soyad', 'Departman', 'Belge Sayısı'],
  },
  contract: {
    en: ['Title', 'Contract No', 'Provider', 'Category', 'Status', 'Start', 'End'],
    tr: ['Başlık', 'Sözleşme No', 'Tedarikçi', 'Kategori', 'Durum', 'Başlangıç', 'Bitiş'],
  },
  provider: {
    en: ['Provider', 'Category', 'Contract Count', 'Statuses'],
    tr: ['Tedarikçi', 'Kategori', 'Sözleşme Sayısı', 'Durumlar'],
  },
  line: {
    en: ['Number', 'Operator', 'Plan', 'SIM', 'Status', 'Assigned to'],
    tr: ['Numara', 'Operatör', 'Tarife', 'SIM', 'Durum', 'Zimmetli'],
  },
  consumable: {
    en: ['Item', 'Stock', 'Min. Alert', 'Low Stock'],
    tr: ['Malzeme', 'Stok', 'Min. Uyarı', 'Az Stok'],
  },
  maintenance: {
    en: ['Tag', 'Service', 'Issue', 'Sent', 'Returned', 'Status'],
    tr: ['Etiket', 'Servis', 'Sorun', 'Gönderim', 'Dönüş', 'Durum'],
  },
  stock_count: {
    en: ['Name', 'Location', 'Status', 'Scans', 'Created By', 'Date'],
    tr: ['Ad', 'Lokasyon', 'Durum', 'Tarama', 'Oluşturan', 'Tarih'],
  },
  handover: {
    en: ['Employee', 'Type', 'Items', 'Date', 'IT', 'Acknowledged'],
    tr: ['Çalışan', 'Tür', 'Kalem', 'Tarih', 'IT', 'Onay'],
  },
  category: {
    en: ['Category', 'Count'],
    tr: ['Kategori', 'Adet'],
  },
};

function csvCols(kind, lang) {
  const row = CSV_COLS[kind];
  if (!row) return [];
  return row[normalizeLang(lang)] || row.en;
}

const ASSET_CSV_COLS = CSV_COLS.asset.en;

function assetCsvRow(a, life) {
  return [
    a.assetTag || '',
    a.category || '',
    a.brand || '',
    a.model || '',
    a.serialNumber || '',
    a.status || '',
    a.currentEmployee?.fullName || a._holderName || '',
    a._department || '',
    a.location || '',
    life?.eolDate || '',
  ];
}

function employeeCsvRow(e) {
  return [
    e.fullName || '',
    e.email || '',
    e.department || '',
    e.title || '',
    e.status || '',
    e.activeAssetCount != null ? String(e.activeAssetCount) : '',
  ];
}

function licenseCsvRow(l) {
  return [
    l.softwareName || '',
    l.vendor || '',
    l.totalSeats != null ? String(l.totalSeats) : '',
    l.usedSeats != null ? String(l.usedSeats) : '',
    l.expirationDate || '',
    l.lifecycle || '',
  ];
}

function contractCsvRow(c) {
  return [
    c.title || '',
    c.contractNumber || '',
    c.providerName || '',
    c.category || '',
    c.status || '',
    c.startDate || '',
    c.endDate || '',
  ];
}

async function assertDocRead(user) {
  const { permissionService } = services();
  const ok = await permissionService.checkAnyPermission(user, [
    { resource: 'handover_document', action: 'read' },
    { resource: 'handover_document', action: 'manage' },
    { resource: 'document', action: 'read' },
    { resource: 'document', action: 'manage' },
  ]);
  if (!ok) throw HttpError.forbidden('Access denied: handover_document/document:read');
}

function eolInfo(asset, lifecycles, now = Date.now()) {
  const months = resolveLifeMonths({
    assetMonths: asset.lifecycleMonths,
    modelMonths: asset.modelLifecycleMonths,
    category: asset.category,
  }, lifecycles);
  if (!months || !asset.purchaseDate) {
    return { months, eolDate: null, pct: null, overdue: false, soon: false, label: null };
  }
  const start = new Date(asset.purchaseDate).getTime();
  if (!start) return { months, eolDate: null, pct: null, overdue: false, soon: false, label: null };
  const eol = new Date(start);
  eol.setMonth(eol.getMonth() + months);
  const pct = Math.max(0, Math.round(((now - start) / (eol.getTime() - start)) * 100));
  const overdue = now > eol.getTime();
  const soon = !overdue && pct >= 90;
  return {
    months,
    eolDate: eol.toISOString().slice(0, 10),
    pct,
    overdue,
    soon,
    label: overdue ? 'EOL' : (soon ? 'EOL soon' : null),
  };
}

async function assertPerm(user, resource, action) {
  const { permissionService } = services();
  const checks = [
    { resource, action },
    { resource, action: 'manage' },
  ];
  if (resource === 'asset' && action === 'read') {
    checks.push({ resource: 'asset', action: 'assign' }, { resource: 'asset', action: 'unassign' });
  }
  const ok = await permissionService.checkAnyPermission(user, checks);
  if (!ok) throw HttpError.forbidden(`Access denied: ${resource}:${action}`);
}

// Gate the confidential/financial columns of an ai.* view. Checked exactly, with
// no read→manage/assign broadening: view_confidential is a distinct, explicitly
// granted permission (never implied by manage) — see utils/iamSchema.
async function assertConfidential(user, resource) {
  const { permissionService } = services();
  const ok = await permissionService.checkPermission(user, resource, 'view_confidential');
  if (!ok) throw HttpError.forbidden(`Access denied: ${resource}:view_confidential`);
}

function assetRow(a, life, lang) {
  const holder = a.currentEmployee?.fullName || a._holderName || null;
  const dept = a._department || null;
  const href = `#/assets?search=${encodeURIComponent(a.assetTag || '')}`;
  let bv = null;
  if (a.cost != null && a.purchaseDate && life?.months) {
    bv = bookValue({ cost: a.cost, purchaseDate: a.purchaseDate, lifeMonths: life.months, salvage: a.salvageValue });
  }

  return {
    id: a.id,
    kind: 'asset',
    title: `${a.assetTag || '—'} · ${[a.brand, a.model].filter(Boolean).join(' ') || a.category || 'Device'}`,
    subtitle: [holder || (a.status === 'In Stock' ? tr(lang, 'subInStock') : a.status), dept || a.location]
      .filter(Boolean).join(' · '),
    tags: [
      life?.label,
      a.status === 'Assigned'
        ? tr(lang, 'tagAssigned')
        : (a.status === 'In Stock' ? tr(lang, 'tagStock') : a.status),
    ].filter(Boolean),
    status: a.status,
    category: a.category,
    assetTag: a.assetTag,
    href,
    _cost: a.cost != null ? Number(a.cost) : 0,
    _bookValue: bv != null ? Number(bv) : (a.cost != null ? Number(a.cost) : 0),
    _lifeOverdue: !!life?.overdue
  };
}

function assetNoun(lang, { inStock, employeeName, department, lifeFilter, historyMode, category }) {
  const cat = category ? String(category).toLowerCase() : '';
  if (normalizeLang(lang) === 'tr') {
    const statusLabel = inStock ? 'stokta ' : '';
    const whoLabel = employeeName ? `${employeeName} üzerinde ` : (department ? `${department} ` : '');
    const lifeLabel = lifeFilter === 'eol' ? 'ömrünü doldurmuş ' : (lifeFilter === 'soon' ? 'EOL yaklaşan ' : '');
    const histLabel = historyMode === 'ever_assigned'
      ? 'daha önce zimmetlenmiş '
      : (historyMode === 'never_assigned' ? 'hiç zimmetlenmemiş ' : '');
    const catLabel = cat ? `${cat} ` : 'cihaz ';
    return `${statusLabel}${whoLabel}${lifeLabel}${histLabel}${catLabel}`.replace(/\s+/g, ' ').trim() || 'cihaz';
  }
  const parts = [];
  if (lifeFilter === 'eol') parts.push('end-of-life');
  else if (lifeFilter === 'soon') parts.push('nearing-EOL');
  if (historyMode === 'ever_assigned') parts.push('previously assigned');
  else if (historyMode === 'never_assigned') parts.push('never-assigned');
  if (cat) parts.push(cat);
  parts.push('devices');
  let noun = parts.join(' ');
  if (inStock) noun += ' in stock';
  if (employeeName) noun += ` held by ${employeeName}`;
  else if (department) noun += ` in ${department}`;
  return noun;
}

async function toolCihazAra(args, ctx) {
  const { assetService, employeeService, settingsService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'asset', 'read');
  const limit = clampLimit(args.limit, args.employee ? 100 : 40);
  const settings = await settingsService.getSettings();
  const lifecycles = resolveLifecycles(settings.lifecycles);
  const settingsLocs = Array.isArray(settings.locations) ? settings.locations : [];

  let resolvedLocation = args.location ? String(args.location).trim() : '';
  if (resolvedLocation) {
    const resolved = await resolveAssetLocation(resolvedLocation, settingsLocs, assetService);
    if (!resolved.match) {
      const sample = (resolved.known || []).slice(0, 6).join(', ') || '—';
      return {
        summary: tr(lang, 'reportNoLocation', { query: resolvedLocation, known: sample }),
        rows: [],
        meta: { totalScanned: 0, tools: ['search_assets'] },
        followups: [tr(lang, 'fuTryKnownLocations'), tr(lang, 'fuLocationDist'), tr(lang, 'fuStockLaptops')],
        ui: uiPayload('asset_list', {}),
      };
    }
    resolvedLocation = resolved.match;
  }

  let matchedEmployees = [];
  if (args.department || args.employee) {
    await assertPerm(ctx.user, 'employee', 'read');
    if (args.employee && !args.department) {
      const lookup = await resolveEmployeeLookup(employeeService, String(args.employee));
      if (lookup.ambiguous || (!lookup.match && lookup.suggestions.length)) {
        const who = String(args.employee);
        const names = lookup.suggestions.map((e) => e.fullName).filter(Boolean);
        if (lookup.ambiguous || !lookup.match) {
          return {
            summary: names.length
              ? (lookup.ambiguous
                ? tr(lang, 'employeeAmbiguous', { who, n: names.length, names: names.join(', ') })
                : tr(lang, 'employeeNotFoundSuggest', { who, names: names.join(', ') }))
              : tr(lang, 'assetNoEmployeeMatch', { who }),
            rows: lookup.suggestions.slice(0, 8).map((e) => ({
              id: e.id,
              kind: 'employee',
              title: e.fullName || '—',
              subtitle: [e.title, e.department].filter(Boolean).join(' · '),
              tags: [e.status, e.activeAssetCount != null ? tr(lang, 'deviceCount', { n: e.activeAssetCount }) : null].filter(Boolean),
              href: `#/employees?search=${encodeURIComponent(e.fullName || '')}`,
            })),
            meta: { totalScanned: 0, tools: ['search_assets', 'find_employees'], suggestions: names },
            followups: employeeSuggestFollowups(lookup.suggestions, lang),
            ui: uiPayload('employee_list', {
              links: [{ label: tr(lang, 'linkEmployees'), href: '#/employees' }],
            }),
          };
        }
      }
      if (lookup.match) matchedEmployees = [lookup.match, ...lookup.suggestions.filter((e) => e.id !== lookup.match.id)].slice(0, 5);
    }
    if (!matchedEmployees.length) {
      const emps = await employeeService.listEmployees({
        department: args.department ? String(args.department) : undefined,
        search: args.employee ? String(args.employee) : undefined,
        status: 'Active',
        limit: args.employee ? 20 : 5000,
      });
      matchedEmployees = emps.items || [];
    }
    if (!matchedEmployees.length) {
      const who = args.employee || args.department;
      if (args.employee) {
        const lookup = await resolveEmployeeLookup(employeeService, String(args.employee));
        return employeeNotFoundResult(lang, String(who), lookup.suggestions, ['search_assets', 'find_employees']);
      }
      return {
        summary: tr(lang, 'assetNoEmployeeMatch', { who }),
        rows: [],
        meta: { totalScanned: 0, tools: ['search_assets', 'find_employees'] },
        followups: [tr(lang, 'fuListActiveEmployees'), tr(lang, 'fuStockLaptops')],
      };
    }
  }

  let items = [];
  let totalScanned = 0;
  let scanTruncated = false;

  if (matchedEmployees.length) {
    const perEmp = await Promise.all(
      matchedEmployees.slice(0, args.employee ? 5 : 100).map(async (e) => {
        const scan = await scanAssets(assetService, {
          employeeId: e.id,
          category: args.category || undefined,
          status: args.status || undefined, // all statuses held by this person
          search: args.search || undefined,
          location: resolvedLocation || undefined,
        }, SCAN_PAGE);
        const rows = scan.items.map((a) => {
          a._department = e.department;
          a._holderName = e.fullName;
          return a;
        });
        return { items: rows, total: scan.total, truncated: scan.truncated };
      })
    );
    for (const block of perEmp) {
      items.push(...block.items);
      totalScanned += block.total;
      if (block.truncated) scanTruncated = true;
    }
  } else {
    const scan = await scanAssets(assetService, {
      search: args.search || undefined,
      category: args.category || undefined,
      status: args.status || undefined,
      location: resolvedLocation || undefined,
    });
    items = scan.items;
    totalScanned = scan.total;
    scanTruncated = scan.truncated;
  }

  const lifeFilter = String(args.lifecycle || 'any').toLowerCase();
  const enriched = items.map((a) => ({ a, life: eolInfo(a, lifecycles) }));
  let filtered = enriched;
  if (lifeFilter === 'eol') filtered = enriched.filter((x) => x.life.overdue);
  else if (lifeFilter === 'soon') filtered = enriched.filter((x) => x.life.soon || x.life.overdue);
  else if (lifeFilter === 'ok') filtered = enriched.filter((x) => !x.life.overdue && !x.life.soon);

  const historyMode = normalizeAssignmentHistory(args);
  if (historyMode !== 'any') {
    const everIds = await assetService.listEverAssignedAssetIds(filtered.map((x) => x.a.id));
    const everSet = new Set(everIds.map((id) => String(id)));
    const kept = filterByAssignmentHistory(filtered.map((x) => x.a), everSet, historyMode);
    const keepIds = new Set(kept.map((a) => String(a.id)));
    filtered = filtered.filter((x) => keepIds.has(String(x.a.id)));
  }

  const slice = filtered.slice(0, limit);
  const assigned = filtered.filter((x) => x.a.status === 'Assigned').length;
  const stock = filtered.filter((x) => x.a.status === 'In Stock').length;
  const employeeName = args.employee ? (matchedEmployees[0]?.fullName || args.employee) : null;
  const department = args.employee ? null : (args.department || null);
  const toolsMeta = matchedEmployees.length ? ['search_assets', 'find_employees'] : ['search_assets'];
  const noun = assetNoun(lang, {
    inStock: /\bin stock\b/i.test(String(args.status || '')),
    employeeName,
    department,
    lifeFilter,
    historyMode,
    category: args.category,
  });

  const link = !filtered.length
    ? null
    : (matchedEmployees.length
      ? buildEmployeeListLink(
        args.employee
          ? { search: employeeName, status: 'Active' }
          : { department: matchedEmployees[0]?.department || args.department, status: 'Active' },
        lang,
        args.employee ? 'linkEmployee' : 'linkDepartment'
      )
      : buildAssetListLink({ ...args, location: resolvedLocation || args.location }, historyMode, lang));
  const csv = (await canExport(ctx.user, 'asset'))
    ? buildCsv({
      filename: noun,
      cols: csvCols('asset', lang),
      rows: filtered.map((x) => assetCsvRow(x.a, x.life)),
      truncated: scanTruncated,
    })
    : null;

  const eolCount = filtered.filter((x) => x.life?.overdue).length;
  const followCtx = {
    employee: args.employee || null,
    historyMode,
    lifeFilter,
    location: resolvedLocation || null,
    empty: !filtered.length,
    countMode: isCountMode(args),
  };
  const followups = buildAssetFollowups(lang, followCtx);
  const metrics = !filtered.length || isCountMode(args)
    ? []
    : buildAssetMetrics(lang, {
      total: filtered.length,
      assigned,
      stock,
      eol: eolCount,
    });

  if (isCountMode(args)) {
    return countPayload({
      total: filtered.length,
      noun,
      lang,
      tools: toolsMeta,
      approx: scanTruncated,
      meta: { historyFilter: historyMode, ...(scanTruncated ? { scanTruncated: true } : {}) },
      followups,
      uiKind: 'stat',
      links: [link],
      csv,
    });
  }

  const breakdown = assigned || stock
    ? ` — ${tr(lang, 'assetBreakAssigned', { n: assigned })}`
      + (stock ? `, ${tr(lang, 'assetBreakStock', { n: stock })}` : '') + '.'
    : '.';
  return {
    summary: filtered.length
      ? tr(lang, 'assetFound', {
        prefix: scanTruncated ? tr(lang, 'atLeast') : '',
        n: filtered.length,
        noun,
      }) + breakdown
      : (employeeName || department
        ? tr(lang, 'assetNoneWho', { who: employeeName || department })
        : tr(lang, 'assetNoneCriteria')),
    rows: slice.map((x) => assetRow(x.a, x.life, lang)),
    meta: {
      totalMatched: filtered.length,
      totalScanned,
      live: true,
      tools: toolsMeta,
      historyFilter: historyMode,
      ...(scanTruncated ? { scanTruncated: true } : {}),
      employeeCounts: matchedEmployees.slice(0, 5).map((e) => ({
        name: e.fullName,
        activeAssetCount: e.activeAssetCount,
      })),
    },
    followups,
    ui: uiPayload('asset_list', { links: [link], csv, metrics }),
  };
}

async function toolLisansListele(args, ctx) {
  const { licenseService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'license', 'read');
  const privileged = ctx.user.role === 'Owner' || ctx.user.role === 'Admin';
  const limit = clampLimit(args.limit);
  const all = await licenseService.listLicenses({ limit: 1000, privileged: !!privileged, includeCancelled: true });
  const q = String(args.search || '').trim().toLowerCase();
  const life = String(args.lifecycle || 'any').toLowerCase();
  let items = all;
  if (q) {
    items = items.filter((l) =>
      String(l.softwareName || '').toLowerCase().includes(q)
      || String(l.vendor || '').toLowerCase().includes(q));
  }
  if (life !== 'any') items = items.filter((l) => String(l.lifecycle || '').toLowerCase() === life);

  const scanTruncated = all.length >= 1000;
  const link = !q && life === 'any' ? { label: tr(lang, 'linkLicenses'), href: '#/licenses' } : null;
  const licenseFile = tr(lang, 'fileLicenses');
  const noun = life !== 'any' ? tr(lang, 'licenseNounLife', { life }) : tr(lang, 'licenseNoun');
  const csv = (await canExport(ctx.user, 'license'))
    ? buildCsv({
      filename: life !== 'any' ? `${licenseFile}-${life}` : licenseFile,
      cols: csvCols('license', lang),
      rows: items.map(licenseCsvRow),
      truncated: scanTruncated,
    })
    : null;

  if (isCountMode(args)) {
    return countPayload({
      total: items.length,
      noun,
      lang,
      tools: ['list_licenses'],
      approx: scanTruncated,
      meta: scanTruncated ? { scanTruncated: true } : undefined,
      followups: [tr(lang, 'fuExpiringLicenses'), tr(lang, 'fuList')],
      links: [link],
      csv,
    });
  }

  const slice = items.slice(0, limit);
  return {
    summary: items.length
      ? countSentence(lang, items.length, noun, scanTruncated)
      : tr(lang, 'licenseNone'),
    rows: slice.map((l) => ({
      id: l.id,
      kind: 'license',
      title: l.softwareName || '—',
      subtitle: [
        l.vendor,
        tr(lang, 'seats', { used: l.usedSeats ?? 0, total: l.totalSeats ?? 0 }),
        l.expirationDate || null,
      ].filter(Boolean).join(' · '),
      tags: [l.lifecycle].filter(Boolean),
      href: '#/licenses',
    })),
    meta: {
      totalMatched: items.length,
      live: true,
      tools: ['list_licenses'],
      ...(scanTruncated ? { scanTruncated: true } : {}),
    },
    followups: [tr(lang, 'fuExpiringLicenses'), tr(lang, 'fuUnusedSeats')],
    ui: uiPayload('license_list', { links: [link], csv }),
  };
}

async function toolCalisanGetir(args, ctx) {
  const { employeeService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'employee', 'read');
  const countOnly = isCountMode(args);
  const limit = countOnly ? 1 : clampLimit(args.limit);
  const rawStatus = String(args.status || '').trim();
  const wantAny = rawStatus.toLowerCase() === 'any';
  const statusFilter = wantAny
    ? undefined
    : (['Active', 'Inactive'].includes(rawStatus) ? rawStatus : 'Active');
  const baseFilters = {
    search: args.search || undefined,
    department: args.department || undefined,
  };

  if (countOnly && wantAny) {
    const [activeData, inactiveData] = await Promise.all([
      employeeService.listEmployees({ ...baseFilters, status: 'Active', limit: 1 }),
      employeeService.listEmployees({ ...baseFilters, status: 'Inactive', limit: 1 }),
    ]);
    const active = activeData.total ?? 0;
    const inactive = inactiveData.total ?? 0;
    const total = active + inactive;
    const link = buildEmployeeListLink(baseFilters, lang, 'linkEmployees');
    let csv = null;
    if (await canExport(ctx.user, 'employee')) {
      const forCsv = (await employeeService.listEmployees({
        ...baseFilters,
        limit: CSV_ROW_CAP,
      })).items || [];
      csv = buildCsv({
        filename: tr(lang, 'fileEmployeesAll'),
        cols: csvCols('employee', lang),
        rows: forCsv.map(employeeCsvRow),
        total,
      });
    }
    return {
      summary: tr(lang, 'employeeBreakdown', { active, inactive, total }),
      rows: [
        {
          id: 'stat-active',
          kind: 'stat',
          title: String(active),
          subtitle: tr(lang, 'employeeNounActive'),
          tags: [tr(lang, 'unitCount')],
        },
        {
          id: 'stat-inactive',
          kind: 'stat',
          title: String(inactive),
          subtitle: tr(lang, 'employeeNounInactive'),
          tags: [tr(lang, 'unitCount')],
        },
      ],
      meta: {
        totalMatched: total,
        totalScanned: total,
        mode: 'count',
        live: true,
        tools: ['find_employees'],
        breakdown: { active, inactive },
      },
      followups: [tr(lang, 'fuEmployeesWithDocs'), tr(lang, 'fuShowAssigned')],
      ui: uiPayload('stat', { links: [link], csv }),
    };
  }

  const filters = { ...baseFilters, status: statusFilter };
  const data = await employeeService.listEmployees({ ...filters, limit });
  const total = data.total ?? (data.items || []).length;
  const noun = statusFilter === 'Inactive'
    ? tr(lang, 'employeeNounInactive')
    : tr(lang, 'employeeNounActive');

  const link = buildEmployeeListLink(filters, lang, 'linkEmployees');
  let csv = null;
  if (await canExport(ctx.user, 'employee')) {
    const forCsv = total > (data.items || []).length
      ? (await employeeService.listEmployees({ ...filters, limit: CSV_ROW_CAP })).items || []
      : (data.items || []);
    csv = buildCsv({
      filename: `${tr(lang, 'fileEmployees')}${filters.department ? `-${filters.department}` : ''}`,
      cols: csvCols('employee', lang),
      rows: forCsv.map(employeeCsvRow),
      total,
    });
  }

  if (countOnly) {
    return countPayload({
      total,
      noun,
      lang,
      tools: ['find_employees'],
      followups: [tr(lang, 'fuEmployeesWithDocs'), tr(lang, 'fuShowAssigned')],
      links: [link],
      csv,
    });
  }

  const items = data.items || [];
  const names = items.map((e) => e.fullName).filter(Boolean);
  const summary = items.length
    ? `${countSentence(lang, total, tr(lang, 'employeeNoun'))} ${tr(lang, 'employeeOnlyThese', { names: names.slice(0, 12).join(', ') })}`
    : tr(lang, 'employeeNone');
  return {
    summary,
    rows: items.map((e) => ({
      id: e.id,
      kind: 'employee',
      title: e.fullName || '—',
      subtitle: [e.title, e.department, e.email].filter(Boolean).join(' · '),
      tags: [
        e.status,
        e.activeAssetCount != null ? tr(lang, 'deviceCount', { n: e.activeAssetCount }) : null,
      ].filter(Boolean),
      href: `#/employees?search=${encodeURIComponent(e.fullName || '')}`,
    })),
    meta: { totalMatched: total, live: true, tools: ['find_employees'], names },
    followups: items.length === 1
      ? [
        tr(lang, 'fuEmployeeDevices', { name: items[0].fullName }),
        tr(lang, 'fuEmployeeHistory', { name: items[0].fullName }),
      ]
      : [tr(lang, 'fuShowAssigned'), tr(lang, 'fuReturnedDevices'), tr(lang, 'fuEmployeesNoAssets')],
    ui: uiPayload('employee_list', { links: [link], csv }),
  };
}

async function toolSozlesmeListele(args, ctx) {
  const { providerService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'contract', 'read');
  const countOnly = isCountMode(args);
  const limit = clampLimit(args.limit);
  const rawStatus = String(args.status || 'any').trim();
  const status = ['Active', 'Draft', 'Expired', 'Cancelled', 'Renewed'].includes(rawStatus)
    ? rawStatus
    : undefined;
  const groupProviders = String(args.group || '').toLowerCase() === 'provider';
  let expiringWithinDays;
  if (args.expiringWithinDays != null && args.expiringWithinDays !== '') {
    const days = Number(args.expiringWithinDays);
    if (Number.isInteger(days) && days >= 0) expiringWithinDays = days;
  }
  const contracts = await providerService.listContracts({
    status,
    search: args.search || undefined,
    expiringWithinDays,
    user: ctx.user,
  });
  const total = contracts.length;
  const link = { label: tr(lang, 'linkContracts'), href: '#/providers?tab=contracts' };
  const expireNoun = expiringWithinDays != null
    ? tr(lang, 'contractExpirySuffix', { days: expiringWithinDays })
    : '';

  let csv = null;
  if (await canExport(ctx.user, 'contract')) {
    if (groupProviders) {
      const byProv = new Map();
      for (const c of contracts) {
        const key = c.providerId || c.providerName || '—';
        const cur = byProv.get(key) || {
          name: c.providerName || '—',
          category: c.providerCategory || '',
          n: 0,
          statuses: new Set(),
        };
        cur.n += 1;
        if (c.status) cur.statuses.add(c.status);
        byProv.set(key, cur);
      }
      csv = buildCsv({
        filename: tr(lang, 'fileProviders'),
        cols: csvCols('provider', lang),
        rows: [...byProv.values()].map((p) => [
          p.name, p.category, String(p.n), [...p.statuses].join(', '),
        ]),
        total: byProv.size,
      });
    } else {
      csv = buildCsv({
        filename: tr(lang, 'fileContracts'),
        cols: csvCols('contract', lang),
        rows: contracts.map(contractCsvRow),
        total,
      });
    }
  }

  if (countOnly) {
    if (groupProviders) {
      const providerCount = new Set(contracts.map((c) => c.providerId || c.providerName)).size;
      return countPayload({
        total: providerCount,
        noun: tr(lang, 'providerNoun'),
        lang,
        tools: ['list_contracts'],
        followups: [tr(lang, 'fuListContracts'), tr(lang, 'fuActiveContracts')],
        links: [link],
        csv,
        meta: { contractCount: total },
      });
    }
    return countPayload({
      total,
      noun: (status
        ? tr(lang, 'contractNounStatus', { status: status.toLowerCase() })
        : tr(lang, 'contractNoun')) + expireNoun,
      lang,
      tools: ['list_contracts'],
      followups: [tr(lang, 'fuWhichProviders'), tr(lang, 'fuExpiringContracts')],
      links: [link],
      csv,
    });
  }

  if (groupProviders) {
    const byProv = new Map();
    for (const c of contracts) {
      const key = c.providerId || c.providerName || '—';
      const cur = byProv.get(key) || {
        id: key,
        name: c.providerName || '—',
        category: c.providerCategory || '',
        n: 0,
        statuses: new Set(),
      };
      cur.n += 1;
      if (c.status) cur.statuses.add(c.status);
      byProv.set(key, cur);
    }
    const providers = [...byProv.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, limit);
    return {
      summary: providers.length
        ? tr(lang, 'providerSummary', { n: providers.length, contracts: total })
        : tr(lang, 'providerNone'),
      rows: providers.map((p) => ({
        id: String(p.id),
        kind: 'provider',
        title: p.name,
        subtitle: [p.category, tr(lang, 'contractCount', { n: p.n })].filter(Boolean).join(' · '),
        tags: [...p.statuses],
        href: `#/providers?tab=contracts&search=${encodeURIComponent(p.name)}`,
      })),
      meta: { totalMatched: byProv.size, contractCount: total, live: true, tools: ['list_contracts'] },
      followups: [tr(lang, 'fuListActiveContracts'), tr(lang, 'fuExpiringSoon')],
      ui: uiPayload('provider_list', { links: [link], csv }),
    };
  }

  const slice = contracts.slice(0, limit);
  return {
    summary: slice.length
      ? countSentence(lang, total, tr(lang, 'contractNoun') + expireNoun)
      : tr(lang, 'contractNone', { suffix: expireNoun }),
    rows: slice.map((c) => ({
      id: c.id,
      kind: 'contract',
      title: c.title || c.contractNumber || '—',
      subtitle: [c.providerName, c.category, c.endDate ? tr(lang, 'endsOn', { date: c.endDate }) : null]
        .filter(Boolean).join(' · '),
      tags: [c.status].filter(Boolean),
      href: `#/providers?tab=contracts`,
    })),
    meta: { totalMatched: total, live: true, tools: ['list_contracts'] },
    followups: [tr(lang, 'fuWhichProviders'), tr(lang, 'fuActiveContracts')],
    ui: uiPayload('contract_list', { links: [link], csv }),
  };
}

async function toolBelgeOzet(args, ctx) {
  const { documentService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'employee', 'read');
  await assertDocRead(ctx.user);
  const limit = clampLimit(args.limit);
  const data = await documentService.summarizeEmployeesWithDocs({
    search: args.search || undefined,
    limit,
  });
  const total = data.totalEmployeesWithDocs || 0;

  let csv = null;
  if (await canExport(ctx.user, 'employee')) {
    const forCsv = total > (data.items || []).length
      ? (await documentService.summarizeEmployeesWithDocs({ search: args.search || undefined, limit: 100 })).items || []
      : (data.items || []);
    csv = buildCsv({
      filename: tr(lang, 'fileDocs'),
      cols: csvCols('document', lang),
      rows: forCsv.map((e) => [e.fullName || '', e.department || '', String(e.documentCount ?? '')]),
      total,
    });
  }

  if (isCountMode(args)) {
    return countPayload({
      total,
      noun: tr(lang, 'docNoun'),
      lang,
      tools: ['document_summary'],
      followups: [tr(lang, 'fuListWithDocs'), tr(lang, 'fuActiveEmployeeCount')],
      csv,
    });
  }

  const items = data.items || [];
  return {
    summary: total
      ? (items.length < total
        ? tr(lang, 'docPartial', { n: total, shown: items.length })
        : countSentence(lang, total, tr(lang, 'docNoun')))
      : tr(lang, 'docNone'),
    rows: items.map((e) => ({
      id: e.id,
      kind: 'employee',
      title: e.fullName || '—',
      subtitle: [e.title, e.department, e.email].filter(Boolean).join(' · '),
      tags: [tr(lang, 'docCount', { n: e.documentCount }), e.status].filter(Boolean),
      href: `#/employees?search=${encodeURIComponent(e.fullName || '')}`,
    })),
    meta: {
      totalMatched: total,
      totalScanned: total,
      live: true,
      tools: ['document_summary'],
    },
    followups: [tr(lang, 'fuHowManyEmployees'), tr(lang, 'fuWhoHasHandoverDocs')],
    ui: uiPayload('employee_list', { csv }),
  };
}

const ACTION_KEYS = {
  returned: 'actReturned',
  assigned: 'actAssigned',
  sent_to_repair: 'actSentToRepair',
};

function actionLabel(actionType, lang) {
  const key = ACTION_KEYS[actionType];
  return key ? tr(lang, key) : (actionType || '');
}

function mapOpsMaintenanceOpen(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s || s === 'any' || s === 'all') return undefined;
  if (['open', 'açık', 'acik', 'ongoing', 'in_progress', 'in-progress', 'aktif'].includes(s)) return true;
  if (['closed', 'kapalı', 'kapali', 'done', 'completed', 'kapatılmış', 'kapatilmis'].includes(s)) return false;
  return undefined;
}

function isConsumableLowStockFilter(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s) return false;
  return (
    ['low_stock', 'low-stock', 'lowstock', 'az_stok', 'az-stok'].includes(s)
    || /low\s*stock|az\s*stok|düşük\s*stok|dusuk\s*stok/.test(s)
  );
}

function scoreEmployeeName(query, fullName) {
  const q = foldAscii(query);
  const n = foldAscii(fullName);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q) || q.startsWith(n)) return 80;
  const qTok = q.split(/\s+/).filter(Boolean);
  const nTok = n.split(/\s+/).filter(Boolean);
  if (!qTok.length || !nTok.length) return n.includes(q) || q.includes(n) ? 40 : 0;
  let hits = 0;
  for (const t of qTok) {
    if (nTok.some((x) => x === t || x.startsWith(t) || t.startsWith(x))) hits += 1;
  }
  if (!hits) return n.includes(q) ? 30 : 0;
  const ratio = hits / qTok.length;
  let score = Math.round(50 * ratio) + hits * 10;
  if (qTok.length >= 2 && hits === qTok.length) score += 20;
  if (nTok[0] && qTok[0] && nTok[0] === qTok[0]) score += 15;
  return score;
}

function uniqueEmployees(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

async function resolveEmployeeLookup(employeeService, name, { limit = 8 } = {}) {
  const q = String(name || '').trim();
  if (!q) return { match: null, suggestions: [], ambiguous: false };

  const tokens = q.split(/\s+/).filter(Boolean);
  const searches = [q];
  if (tokens.length >= 2) {
    searches.push(tokens[0], tokens[tokens.length - 1]);
  } else if (tokens.length === 1 && tokens[0].length >= 2) {
    searches.push(tokens[0]);
  }

  let people = [];
  for (const s of searches) {
    let batch = (await employeeService.listEmployees({ search: s, status: 'Active', limit: 20 })).items || [];
    if (!batch.length) {
      batch = (await employeeService.listEmployees({ search: s, limit: 20 })).items || [];
    }
    people.push(...batch);
  }
  people = uniqueEmployees(people);

  const ranked = people
    .map((e) => ({ e, score: scoreEmployeeName(q, e.fullName || '') }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.e.fullName).localeCompare(String(b.e.fullName)));

  if (!ranked.length) {
    return { match: null, suggestions: [], ambiguous: false };
  }

  const top = ranked[0];
  const strong = ranked.filter((x) => x.score >= 70);
  const near = ranked.filter((x) => x.score >= 40).slice(0, limit);

  if (top.score >= 90 && (strong.length <= 1 || strong[0].score - (strong[1]?.score || 0) >= 15)) {
    return { match: top.e, suggestions: near.map((x) => x.e).filter((e) => e.id !== top.e.id).slice(0, 5), ambiguous: false };
  }
  if (strong.length === 1 && top.score >= 65) {
    return { match: top.e, suggestions: near.map((x) => x.e).filter((e) => e.id !== top.e.id).slice(0, 5), ambiguous: false };
  }
  if (near.length >= 2 && top.score < 90) {
    return { match: null, suggestions: near.map((x) => x.e), ambiguous: true };
  }
  if (top.score >= 55) {
    return { match: top.e, suggestions: near.map((x) => x.e).filter((e) => e.id !== top.e.id).slice(0, 5), ambiguous: false };
  }
  return { match: null, suggestions: near.map((x) => x.e), ambiguous: false };
}

async function resolveEmployeeByName(employeeService, name) {
  const { match } = await resolveEmployeeLookup(employeeService, name);
  return match;
}

function employeeSuggestFollowups(suggestions, lang) {
  const names = (suggestions || []).slice(0, 3).map((e) => e.fullName).filter(Boolean);
  const chips = names.map((n) => tr(lang, 'fuEmployeeDevices', { name: n }));
  chips.push(tr(lang, 'fuListActiveEmployees'));
  return chips;
}

function employeeNotFoundResult(lang, who, suggestions, tools) {
  const names = (suggestions || []).slice(0, 5).map((e) => e.fullName).filter(Boolean);
  const summary = names.length
    ? tr(lang, 'employeeNotFoundSuggest', { who, names: names.join(', ') })
    : tr(lang, 'opsNoEmployee', { who });
  return {
    summary,
    rows: (suggestions || []).slice(0, 5).map((e) => ({
      id: e.id,
      kind: 'employee',
      title: e.fullName || '—',
      subtitle: [e.title, e.department, e.email].filter(Boolean).join(' · '),
      tags: [e.status, e.activeAssetCount != null ? tr(lang, 'deviceCount', { n: e.activeAssetCount }) : null].filter(Boolean),
      href: `#/employees?search=${encodeURIComponent(e.fullName || '')}`,
    })),
    meta: {
      tools,
      employeeQuery: who,
      suggestions: names,
    },
    followups: employeeSuggestFollowups(suggestions, lang),
    ui: uiPayload('employee_list', {
      links: [{ label: tr(lang, 'linkEmployees'), href: '#/employees' }],
    }),
  };
}

async function toolOpsSorgula(args, ctx) {
  const lang = normalizeLang(ctx?.lang);
  const domain = String(args.domain || '').toLowerCase().trim();
  const countOnly = isCountMode(args);
  const limit = clampLimit(args.limit);
  const search = args.search ? String(args.search).trim() : undefined;
  const status = args.status != null ? String(args.status).trim() : undefined;
  const employeeName = args.employee ? String(args.employee).trim() : undefined;

  if (domain === 'line') {
    const { lineService, employeeService } = services();
    await assertPerm(ctx.user, 'line', 'read');
    let employeeId;
    let emp = null;
    if (employeeName) {
      await assertPerm(ctx.user, 'employee', 'read');
      const lookup = await resolveEmployeeLookup(employeeService, employeeName);
      if (!lookup.match) {
        return employeeNotFoundResult(lang, employeeName, lookup.suggestions, ['query_operations', 'find_employees']);
      }
      emp = lookup.match;
      employeeId = emp.id;
    }
    const lineStatus = ['Active', 'Suspended', 'Cancelled'].includes(status) ? status : undefined;
    const scanLimit = countOnly ? 5000 : Math.max(limit, 500);
    const items = await lineService.listLines({
      status: lineStatus,
      employeeId,
      search,
      limit: scanLimit,
    });
    const total = items.length;
    const noun = emp
      ? tr(lang, 'lineNounEmployee', { name: emp.fullName })
      : (lineStatus ? tr(lang, 'lineNounStatus', { status: lineStatus.toLowerCase() }) : tr(lang, 'lineNoun'));
    const link = { label: tr(lang, 'linkLines'), href: '#/lines' };
    const csv = (await canExport(ctx.user, 'line'))
      ? buildCsv({
        filename: noun,
        cols: csvCols('line', lang),
        rows: items.map((l) => [
          l.phoneNumber || '',
          l.operator || '',
          l.plan || '',
          l.simSerial || '',
          l.status || '',
          l.currentEmployeeName || '',
        ]),
        total,
      })
      : null;
    if (countOnly) {
      return countPayload({
        total,
        noun,
        lang,
        tools: ['query_operations'],
        followups: [tr(lang, 'fuListActiveLines'), tr(lang, 'fuAssignedLines')],
        links: [link],
        csv,
        meta: { domain: 'line' },
      });
    }
    const slice = items.slice(0, limit);
    return {
      summary: total ? countSentence(lang, total, noun) : tr(lang, 'opsNone', { noun }),
      rows: slice.map((l) => ({
        id: l.id,
        kind: 'line',
        title: l.phoneNumber || '—',
        subtitle: [
          l.operator,
          l.plan,
          l.currentEmployeeName || (l.status === 'Active' ? tr(lang, 'lineFree') : null),
        ].filter(Boolean).join(' · '),
        tags: [l.status].filter(Boolean),
        href: `#/lines?search=${encodeURIComponent(l.phoneNumber || '')}`,
      })),
      meta: { totalMatched: total, live: true, tools: ['query_operations'], domain: 'line' },
      followups: [tr(lang, 'fuHowManyActiveLines'), tr(lang, 'fuConsumables')],
      ui: uiPayload('line_list', { links: [link], csv }),
    };
  }

  if (domain === 'consumable') {
    const { consumableService } = services();
    await assertPerm(ctx.user, 'consumable', 'read');
    let items = await consumableService.listConsumables();
    const q = (search || '').toLowerCase();
    if (q) {
      items = items.filter((c) => String(c.itemName || '').toLowerCase().includes(q));
    }
    const lowOnly = isConsumableLowStockFilter(status);
    if (lowOnly) items = items.filter((c) => !!c.lowStock);
    const total = items.length;
    const noun = lowOnly ? tr(lang, 'consumableNounLow') : tr(lang, 'consumableNoun');
    const link = { label: tr(lang, 'linkConsumables'), href: '#/consumables' };
    const csv = (await canExport(ctx.user, 'consumable'))
      ? buildCsv({
        filename: noun,
        cols: csvCols('consumable', lang),
        rows: items.map((c) => [
          c.itemName || '',
          c.totalStock != null ? String(c.totalStock) : '',
          c.minimumStockAlertLevel != null ? String(c.minimumStockAlertLevel) : '',
          c.lowStock ? tr(lang, 'yes') : tr(lang, 'no'),
        ]),
        total,
      })
      : null;
    if (countOnly) {
      return countPayload({
        total,
        noun,
        lang,
        tools: ['query_operations'],
        followups: [tr(lang, 'fuLowStock'), tr(lang, 'fuList')],
        links: [link],
        csv,
        meta: { domain: 'consumable' },
      });
    }
    const slice = items.slice(0, limit);
    return {
      summary: total ? countSentence(lang, total, noun) : tr(lang, 'opsNone', { noun }),
      rows: slice.map((c) => ({
        id: c.id,
        kind: 'consumable',
        title: c.itemName || '—',
        subtitle: tr(lang, 'consumableStock', {
          n: c.totalStock ?? 0,
          min: c.minimumStockAlertLevel ?? 0,
        }),
        tags: [c.lowStock ? tr(lang, 'tagLowStock') : tr(lang, 'tagStockOk')].filter(Boolean),
        href: '#/consumables',
      })),
      meta: { totalMatched: total, live: true, tools: ['query_operations'], domain: 'consumable' },
      followups: [tr(lang, 'fuLowStockOnes'), tr(lang, 'fuOpenMaintenance')],
      ui: uiPayload('consumable_list', { links: [link], csv }),
    };
  }

  if (domain === 'maintenance') {
    const { maintenanceService } = services();
    await assertPerm(ctx.user, 'maintenance', 'read');
    const openFlag = mapOpsMaintenanceOpen(status);
    const scanLimit = countOnly ? 2000 : Math.max(limit, 200);
    let items = await maintenanceService.listMaintenanceLogs({
      open: openFlag === true ? true : undefined,
      limit: scanLimit,
    });
    if (openFlag === false) items = items.filter((m) => !!m.returnDate);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((m) =>
        String(m.assetTag || '').toLowerCase().includes(q)
        || String(m.serviceCompany || '').toLowerCase().includes(q)
        || String(m.issueDescription || '').toLowerCase().includes(q));
    }
    const total = items.length;
    const noun = openFlag === true
      ? tr(lang, 'maintenanceNounOpen')
      : (openFlag === false ? tr(lang, 'maintenanceNounClosed') : tr(lang, 'maintenanceNoun'));
    const link = { label: tr(lang, 'linkMaintenance'), href: '#/maintenance' };
    const csv = (await canExport(ctx.user, 'maintenance'))
      ? buildCsv({
        filename: noun,
        cols: csvCols('maintenance', lang),
        rows: items.map((m) => [
          m.assetTag || '',
          m.serviceCompany || '',
          m.issueDescription || '',
          m.sentDate ? String(m.sentDate).slice(0, 10) : '',
          m.returnDate ? String(m.returnDate).slice(0, 10) : '',
          m.returnDate ? tr(lang, 'tagClosed') : tr(lang, 'tagOpen'),
        ]),
        total,
      })
      : null;
    if (countOnly) {
      return countPayload({
        total,
        noun,
        lang,
        tools: ['query_operations'],
        followups: [tr(lang, 'fuListOpenMaintenance'), tr(lang, 'fuStockCounts')],
        links: [link],
        csv,
        meta: { domain: 'maintenance' },
      });
    }
    const slice = items.slice(0, limit);
    return {
      summary: total ? countSentence(lang, total, noun) : tr(lang, 'opsNone', { noun }),
      rows: slice.map((m) => ({
        id: m.id,
        kind: 'maintenance',
        title: `${m.assetTag || '—'} · ${m.serviceCompany || tr(lang, 'serviceFallback')}`,
        subtitle: [
          m.issueDescription || null,
          m.sentDate ? String(m.sentDate).slice(0, 10) : null,
        ].filter(Boolean).join(' · '),
        tags: [m.returnDate ? tr(lang, 'tagClosed') : tr(lang, 'tagOpen')],
        href: `#/maintenance`,
      })),
      meta: { totalMatched: total, live: true, tools: ['query_operations'], domain: 'maintenance' },
      followups: [tr(lang, 'fuHowManyOpenMaintenance'), tr(lang, 'fuConsumableStock')],
      ui: uiPayload('maintenance_list', { links: [link], csv }),
    };
  }

  if (domain === 'stock_count') {
    const { countService } = services();
    await assertPerm(ctx.user, 'stock_count', 'read');
    const scanLimit = countOnly ? 200 : Math.max(limit, 50);
    let items = await countService.listCounts({ limit: scanLimit });
    const st = String(status || '').toLowerCase();
    if (st === 'open' || st === 'açık' || st === 'acik') {
      items = items.filter((c) => String(c.status || '').toLowerCase() === 'open');
    } else if (st === 'closed' || st === 'kapalı' || st === 'kapali') {
      items = items.filter((c) => String(c.status || '').toLowerCase() === 'closed');
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((c) =>
        String(c.name || '').toLowerCase().includes(q)
        || String(c.location || '').toLowerCase().includes(q));
    }
    const total = items.length;
    const noun = tr(lang, 'stockCountNoun');
    const link = { label: tr(lang, 'linkStockCounts'), href: '#/stockcount' };
    const csv = (await canExport(ctx.user, 'stock_count'))
      ? buildCsv({
        filename: noun,
        cols: csvCols('stock_count', lang),
        rows: items.map((c) => [
          c.name || '',
          c.location || '',
          c.status || '',
          c.scanCount != null ? String(c.scanCount) : '',
          c.createdByName || '',
          c.createdAt ? String(c.createdAt).slice(0, 16).replace('T', ' ') : '',
        ]),
        total,
      })
      : null;
    if (countOnly) {
      return countPayload({
        total,
        noun,
        lang,
        tools: ['query_operations'],
        followups: [tr(lang, 'fuOpenCounts'), tr(lang, 'fuHandoverForms')],
        links: [link],
        csv,
        meta: { domain: 'stock_count' },
      });
    }
    const slice = items.slice(0, limit);
    return {
      summary: total ? countSentence(lang, total, noun) : tr(lang, 'stockCountNone'),
      rows: slice.map((c) => ({
        id: c.id,
        kind: 'stock_count',
        title: c.name || '—',
        subtitle: [
          c.location,
          c.status,
          c.scanCount != null ? tr(lang, 'scanCount', { n: c.scanCount }) : null,
        ].filter(Boolean).join(' · '),
        tags: [c.status].filter(Boolean),
        href: '#/stockcount',
      })),
      meta: { totalMatched: total, live: true, tools: ['query_operations'], domain: 'stock_count' },
      followups: [tr(lang, 'fuHowManyOpenCounts'), tr(lang, 'fuMobileLines')],
      ui: uiPayload('stock_count_list', { links: [link], csv }),
    };
  }

  if (domain === 'handover') {
    const { handoverService, employeeService } = services();
    await assertPerm(ctx.user, 'handover', 'read');
    let employeeId;
    let emp = null;
    if (employeeName) {
      await assertPerm(ctx.user, 'employee', 'read');
      const lookup = await resolveEmployeeLookup(employeeService, employeeName);
      if (!lookup.match) {
        return employeeNotFoundResult(lang, employeeName, lookup.suggestions, ['query_operations', 'find_employees']);
      }
      emp = lookup.match;
      employeeId = emp.id;
    }
    const scanLimit = countOnly ? 200 : Math.max(limit, 50);
    let items = await handoverService.listHandovers({ employeeId, limit: scanLimit });
    const st = String(status || '').toLowerCase();
    if (st === 'pending' || st === 'ack_pending' || st === 'onay_bekleyen') {
      items = items.filter((h) => !!h.ackPending);
    } else if (st === 'acked' || st === 'acknowledged' || st === 'onaylı' || st === 'onayli') {
      items = items.filter((h) => !!h.acknowledged);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((h) =>
        String(h.employeeName || '').toLowerCase().includes(q)
        || String(h.itUserName || '').toLowerCase().includes(q)
        || String(h.documentType || '').toLowerCase().includes(q));
    }
    const total = items.length;
    const noun = emp ? tr(lang, 'handoverNounEmployee', { name: emp.fullName }) : tr(lang, 'handoverNoun');
    const link = { label: tr(lang, 'linkHandover'), href: '#/handover' };
    const csv = (await canExport(ctx.user, 'handover'))
      ? buildCsv({
        filename: noun,
        cols: csvCols('handover', lang),
        rows: items.map((h) => [
          h.employeeName || '',
          h.documentType || '',
          Array.isArray(h.items) ? String(h.items.length) : '',
          h.transactionDate ? String(h.transactionDate).slice(0, 16).replace('T', ' ') : '',
          h.itUserName || '',
          h.acknowledged ? tr(lang, 'tagAcked') : (h.ackPending ? tr(lang, 'tagPending') : ''),
        ]),
        total,
      })
      : null;
    if (countOnly) {
      return countPayload({
        total,
        noun,
        lang,
        tools: ['query_operations'],
        followups: [tr(lang, 'fuPendingForms'), tr(lang, 'fuMobileLines')],
        links: [link],
        csv,
        meta: { domain: 'handover' },
      });
    }
    const slice = items.slice(0, limit);
    return {
      summary: total ? countSentence(lang, total, noun) : tr(lang, 'opsNone', { noun }),
      rows: slice.map((h) => ({
        id: h.id,
        kind: 'handover',
        title: h.employeeName || '—',
        subtitle: [
          h.documentType,
          Array.isArray(h.items) ? tr(lang, 'itemCount', { n: h.items.length }) : null,
          h.transactionDate ? String(h.transactionDate).slice(0, 16).replace('T', ' ') : null,
        ].filter(Boolean).join(' · '),
        tags: [h.acknowledged ? tr(lang, 'tagAcked') : (h.ackPending ? tr(lang, 'tagPending') : null)]
          .filter(Boolean),
        href: '#/handover',
      })),
      meta: { totalMatched: total, live: true, tools: ['query_operations'], domain: 'handover' },
      followups: [tr(lang, 'fuHowManyHandovers'), tr(lang, 'fuOpenMaintenance')],
      ui: uiPayload('handover_list', { links: [link], csv }),
    };
  }

  return {
    summary: tr(lang, 'opsUnknownDomain', { domain: domain || '—' }),
    rows: [],
    meta: { tools: ['query_operations'] },
    followups: [tr(lang, 'fuListActiveLines'), tr(lang, 'fuLowStock')],
  };
}

async function toolZimmetGecmisi(args, ctx) {
  const { employeeService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'employee', 'read');
  await assertPerm(ctx.user, 'asset', 'read');
  const limit = clampLimit(args.limit);
  const countOnly = isCountMode(args);
  const action = String(args.action || 'returned').toLowerCase();
  const itemKind = String(args.item_kind || 'any').toLowerCase();
  const name = String(args.employee || '').trim();
  if (!name) {
    return {
      summary: tr(lang, 'historyEmployeeRequired'),
      rows: [],
      meta: { tools: ['handover_history'] },
      followups: [tr(lang, 'fuSampleReturned')],
    };
  }

  const empLookup = await resolveEmployeeLookup(employeeService, name);
  if (!empLookup.match) {
    return employeeNotFoundResult(
      lang,
      name,
      empLookup.suggestions,
      ['handover_history', 'find_employees'],
    );
  }
  const emp = empLookup.match;

  const history = await employeeService.getEmployeeHistory(emp.id, HISTORY_SCAN);
  const scanTruncated = history.length >= HISTORY_SCAN;
  let events = history;
  if (itemKind === 'device') events = history.filter((h) => h.kind === 'device' || !h.kind);
  else if (itemKind === 'line') events = history.filter((h) => h.kind === 'line');
  if (action === 'returned') events = events.filter((h) => h.actionType === 'returned');
  else if (action === 'assigned') events = events.filter((h) => h.actionType === 'assigned');

  const slice = events.slice(0, limit);
  const label = action === 'returned'
    ? tr(lang, 'historyLabelReturned')
    : (action === 'assigned' ? tr(lang, 'historyLabelAssigned') : tr(lang, 'historyLabelAny'));
  const kindLabel = itemKind === 'line'
    ? tr(lang, 'historyKindLine')
    : (itemKind === 'device' ? tr(lang, 'historyKindDevice') : tr(lang, 'historyKindAny'));
  const link = buildEmployeeListLink({ search: emp.fullName }, lang, 'linkEmployee');
  const csv = (await canExport(ctx.user, 'asset'))
    ? buildCsv({
      filename: tr(lang, 'fileHistory', { name: emp.fullName || '' }),
      cols: csvCols('history', lang),
      rows: events.map((h) => [
        h.timestamp ? String(h.timestamp).slice(0, 16).replace('T', ' ') : '',
        actionLabel(h.actionType, lang),
        h.kind === 'line' ? tr(lang, 'tagLine') : tr(lang, 'tagDevice'),
        h.label || '',
        h.employeeName || emp.fullName || '',
        h.notes || '',
      ]),
      truncated: scanTruncated,
    })
    : null;

  if (countOnly) {
    return countPayload({
      total: events.length,
      noun: tr(lang, 'historyNoun', { name: emp.fullName, label, kind: kindLabel }),
      lang,
      tools: ['handover_history'],
      approx: scanTruncated,
      meta: {
        ...(scanTruncated ? { scanTruncated: true } : {}),
        employee: { id: emp.id, fullName: emp.fullName },
        itemKind,
        action,
      },
      followups: action === 'returned'
        ? [tr(lang, 'fuCurrentDevices'), tr(lang, 'fuAssignedOnes')]
        : [tr(lang, 'fuReturned'), tr(lang, 'fuCurrentDevices')],
      links: [link],
      csv,
    });
  }

  return {
    summary: events.length
      ? tr(lang, 'historySummary', {
        name: emp.fullName,
        prefix: scanTruncated ? tr(lang, 'atLeast') : '',
        n: events.length,
        label,
        kind: kindLabel,
      })
      : tr(lang, 'historyNone', { name: emp.fullName, label, kind: kindLabel }) +
        (action === 'returned' ? tr(lang, 'historyNoneHint') : ''),
    rows: slice.map((h) => ({
      id: h.id,
      kind: 'history',
      title: `${h.label || '—'} · ${actionLabel(h.actionType, lang) || '—'}`,
      subtitle: [
        h.timestamp ? String(h.timestamp).slice(0, 16).replace('T', ' ') : null,
        h.changedByName || null,
        h.notes || null,
      ].filter(Boolean).join(' · '),
      tags: [h.actionType, h.kind === 'line' ? tr(lang, 'tagLine') : tr(lang, 'tagDevice')].filter(Boolean),
      href: h.kind === 'line'
        ? (h.label ? `#/lines?search=${encodeURIComponent(h.label)}` : '#/lines')
        : (h.label ? `#/assets?search=${encodeURIComponent(h.label)}` : '#/employees'),
    })),
    meta: {
      totalMatched: events.length,
      totalScanned: history.length,
      live: true,
      tools: ['handover_history'],
      ...(scanTruncated ? { scanTruncated: true } : {}),
      employee: { id: emp.id, fullName: emp.fullName, activeAssetCount: emp.activeAssetCount },
      itemKind,
      action,
    },
    followups: action === 'returned'
      ? [tr(lang, 'fuCurrentDevices'), tr(lang, 'fuAssignedOnes')]
      : [tr(lang, 'fuReturned'), tr(lang, 'fuCurrentDevices')],
    ui: uiPayload('history_list', { links: [link], csv }),
  };
}

async function runReport(reportId, limit, ctx) {
  const lang = normalizeLang(ctx?.lang);
  const id = String(reportId || '').toLowerCase();
  if (id === 'eol') {
    return toolCihazAra({ lifecycle: 'eol', limit }, ctx);
  }
  if (id === 'in-stock') {
    return toolCihazAra({ status: 'In Stock', limit }, ctx);
  }
  if (id === 'inventory' || id === 'by-category') {
    const { assetService, settingsService } = services();
    await assertPerm(ctx.user, 'asset', 'read');
    const scan = await scanAssets(assetService, {});
    const items = scan.items;
    const canCsv = await canExport(ctx.user, 'asset');
    if (id === 'by-category') {
      const counts = {};
      for (const a of items) counts[a.category || 'Other'] = (counts[a.category || 'Other'] || 0) + 1;
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const rows = ranked
        .slice(0, limit)
        .map(([cat, n]) => ({
          id: cat,
          kind: 'stat',
          title: cat,
          subtitle: tr(lang, 'deviceCount', { n }),
          tags: [],
        }));
      return {
        summary: tr(lang, 'reportByCategory', {
          prefix: scan.truncated ? tr(lang, 'atLeast') : '',
          n: items.length,
          categories: ranked.length,
        }),
        rows,
        meta: {
          totalScanned: scan.total,
          live: true,
          tools: ['run_report'],
          ...(scan.truncated ? { scanTruncated: true } : {}),
        },
        followups: [tr(lang, 'fuEol'), tr(lang, 'fuStockDevices')],
        ui: uiPayload('report', {
          reportId: id,
          links: [buildAssetListLink({}, 'any', lang)],
          csv: canCsv
            ? buildCsv({
              filename: tr(lang, 'fileByCategory'),
              cols: csvCols('category', lang),
              rows: ranked.map(([cat, n]) => [cat, String(n)]),
              truncated: scan.truncated,
            })
            : null,
        }),
      };
    }
    const settings = await settingsService.getSettings();
    const lifecycles = resolveLifecycles(settings.lifecycles);
    const enriched = items.map((a) => ({ a, life: eolInfo(a, lifecycles) }));
    return {
      summary: tr(lang, 'reportInventory', {
        prefix: scan.truncated ? tr(lang, 'atLeast') : '',
        n: scan.total,
      }),
      rows: enriched.slice(0, limit).map((x) => assetRow(x.a, x.life, lang)),
      meta: {
        totalScanned: scan.total,
        live: true,
        tools: ['run_report'],
        ...(scan.truncated ? { scanTruncated: true } : {}),
      },
      followups: [tr(lang, 'fuEolReport'), tr(lang, 'fuAssignmentList')],
      ui: uiPayload('report', {
        reportId: id,
        links: [buildAssetListLink({}, 'any', lang)],
        csv: canCsv
          ? buildCsv({
            filename: tr(lang, 'fileInventory'),
            cols: csvCols('asset', lang),
            rows: enriched.map((x) => assetCsvRow(x.a, x.life)),
            truncated: scan.truncated,
          })
          : null,
      }),
    };
  }
  if (id === 'assignments') {
    const { assetService, settingsService } = services();
    await assertPerm(ctx.user, 'asset', 'read');
    const scan = await scanAssets(assetService, { status: 'Assigned' });
    const settings = await settingsService.getSettings();
    const lifecycles = resolveLifecycles(settings.lifecycles);
    const enriched = scan.items.map((a) => ({ a, life: eolInfo(a, lifecycles) }));
    return {
      summary: tr(lang, 'reportAssigned', {
        prefix: scan.truncated ? tr(lang, 'atLeast') : '',
        n: scan.total,
      }),
      rows: enriched.slice(0, limit).map((x) => assetRow(x.a, x.life, lang)),
      meta: {
        totalScanned: scan.total,
        live: true,
        tools: ['run_report'],
        ...(scan.truncated ? { scanTruncated: true } : {}),
      },
      followups: [tr(lang, 'fuEolAssigned'), tr(lang, 'fuStockStatus')],
      ui: uiPayload('report', {
        reportId: id,
        links: [buildAssetListLink({ status: 'Assigned' }, 'any', lang)],
        csv: (await canExport(ctx.user, 'asset'))
          ? buildCsv({
            filename: tr(lang, 'fileAssigned'),
            cols: csvCols('asset', lang),
            rows: enriched.map((x) => assetCsvRow(x.a, x.life)),
            truncated: scan.truncated,
          })
          : null,
      }),
    };
  }
  if (id === 'by-location') {
    return toolRaporUret({ group_by: 'location', chart: 'bar', format: 'both', limit }, ctx);
  }
  if (id === 'by-status') {
    return toolRaporUret({ group_by: 'status', chart: 'bar', format: 'both', limit }, ctx);
  }
  if (id === 'expiring-licenses') {
    return toolLisansListele({ lifecycle: 'expiring', limit }, ctx);
  }
  if (id === 'employees') {
    return toolCalisanGetir({ status: 'Active', limit }, ctx);
  }
  throw HttpError.badRequest(`Unknown report_id: ${reportId}`);
}

async function toolRaporUret(args, ctx) {
  const { assetService, settingsService } = services();
  const lang = normalizeLang(ctx?.lang);
  await assertPerm(ctx.user, 'asset', 'read');

  const limit = clampLimit(args.limit, 50);
  const groupByRaw = String(args.group_by || 'none').toLowerCase();
  const groupBy = ['location', 'status', 'category'].includes(groupByRaw) ? groupByRaw : 'none';
  let chartType = String(args.chart || '').toLowerCase();
  if (!chartType || chartType === 'any') {
    chartType = groupBy !== 'none' ? 'bar' : 'none';
  }
  if (!['none', 'bar', 'pie'].includes(chartType)) chartType = groupBy !== 'none' ? 'bar' : 'none';
  const format = ['preview', 'csv', 'both'].includes(String(args.format || '').toLowerCase())
    ? String(args.format).toLowerCase()
    : 'both';
  const lifeFilter = String(args.lifecycle || 'any').toLowerCase();
  const status = args.status ? String(args.status).trim() : '';
  const category = args.category ? String(args.category).trim() : '';
  const search = args.search ? String(args.search).trim() : '';
  const locationQuery = args.location ? String(args.location).trim() : '';

  const settings = await settingsService.getSettings();
  const lifecycles = resolveLifecycles(settings.lifecycles);
  const settingsLocs = Array.isArray(settings.locations) ? settings.locations : [];

  let resolvedLocation = null;
  let locationNote = null;
  if (locationQuery) {
    const resolved = await resolveAssetLocation(locationQuery, settingsLocs, assetService);
    if (!resolved.match) {
      const sample = (resolved.known || []).slice(0, 6).join(', ') || '—';
      return {
        summary: tr(lang, 'reportNoLocation', { query: locationQuery, known: sample }),
        rows: [],
        meta: {
          totalMatched: 0,
          totalScanned: 0,
          live: true,
          tools: ['build_report'],
          plan: {
            title: args.title || null,
            location: locationQuery,
            status: status || null,
            category: category || null,
            group_by: groupBy,
            chart: chartType,
            format,
          },
        },
        followups: buildReportFollowups(lang, { groupBy, location: null, n: 0, empty: true }),
        ui: uiPayload('report', {}),
      };
    }
    resolvedLocation = resolved.match;
    if (foldAscii(resolvedLocation) !== foldAscii(locationQuery)) {
      locationNote = tr(lang, 'reportResolvedLocation', { location: resolvedLocation });
    }
  }

  const filters = {
    ...(resolvedLocation ? { location: resolvedLocation } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(search ? { search } : {}),
  };
  const scan = await scanAssets(assetService, filters);
  const enriched = scan.items.map((a) => ({ a, life: eolInfo(a, lifecycles) }));
  let filtered = enriched;
  if (lifeFilter === 'eol') filtered = enriched.filter((x) => x.life.overdue);
  else if (lifeFilter === 'soon') filtered = enriched.filter((x) => x.life.soon || x.life.overdue);
  else if (lifeFilter === 'ok') filtered = enriched.filter((x) => !x.life.overdue && !x.life.soon);

  const assets = filtered.map((x) => x.a);
  const n = assets.length;
  const prefix = scan.truncated ? tr(lang, 'atLeast') : '';

  const filterParts = [];
  if (resolvedLocation) filterParts.push(`location=${resolvedLocation}`);
  else if (locationQuery) filterParts.push(`location=${locationQuery}`);
  if (status) filterParts.push(`status=${status}`);
  if (category) filterParts.push(`category=${category}`);
  if (search) filterParts.push(`search=${search}`);
  if (lifeFilter && lifeFilter !== 'any') filterParts.push(`lifecycle=${lifeFilter}`);
  if (locationNote) filterParts.push(locationNote);
  const filtersLabel = filterParts.length ? filterParts.join(', ') : tr(lang, 'reportFilterNone');

  const defaultTitle = groupBy !== 'none'
    ? tr(lang, 'reportTitleDistribution')
    : (resolvedLocation
      ? tr(lang, 'reportTitleAtLocation', { location: resolvedLocation })
      : tr(lang, 'reportTitleList'));
  const title = String(args.title || '').trim() || defaultTitle;

  const plan = {
    title,
    location: resolvedLocation || locationQuery || null,
    status: status || null,
    category: category || null,
    group_by: groupBy,
    chart: chartType,
    format,
  };

  const groupLabelKey = {
    location: 'reportGroupLocation',
    status: 'reportGroupStatus',
    category: 'reportGroupCategory',
  }[groupBy];

  const summary = groupBy === 'none'
    ? tr(lang, 'reportPlanList', { title, filters: filtersLabel, prefix, n })
    : tr(lang, 'reportPlanGroup', {
      title,
      group: tr(lang, groupLabelKey),
      filters: filtersLabel,
      prefix,
      n,
    });

  const wantCsv = format === 'csv' || format === 'both';
  const wantPreview = format === 'preview' || format === 'both';
  const canCsv = wantCsv && (await canExport(ctx.user, 'asset'));
  const link = buildAssetListLink({
    location: resolvedLocation || undefined,
    status: status || undefined,
    category: category || undefined,
    search: search || undefined,
    lifecycle: lifeFilter !== 'any' ? lifeFilter : undefined,
  }, 'any', lang);

  const followups = buildReportFollowups(lang, {
    groupBy,
    location: resolvedLocation || null,
    n,
    empty: !n,
  });

  if (groupBy !== 'none') {
    const items = aggregateAssetsBy(assets, groupBy, lang);
    const colKey = groupBy === 'location' ? 'colLocation'
      : (groupBy === 'status' ? 'colStatus' : 'colCategory');
    const rows = wantPreview
      ? items.slice(0, limit).map((it) => ({
        id: `stat-${groupBy}-${it.label}`,
        kind: 'stat',
        title: it.label,
        subtitle: tr(lang, 'deviceCount', { n: it.value }),
        tags: [`${it.pct}%`],
      }))
      : [];
    const chart = chartType !== 'none' && items.length
      ? { type: chartType === 'pie' ? 'pie' : 'bar', items }
      : null;
    const csv = canCsv
      ? buildCsv({
        filename: groupBy === 'location'
          ? tr(lang, 'fileLocationDist')
          : (groupBy === 'status' ? tr(lang, 'fileStatusDist') : tr(lang, 'fileByCategory')),
        cols: [tr(lang, colKey), tr(lang, 'colCount'), tr(lang, 'colPct')],
        rows: items.map((it) => [it.label, String(it.value), String(it.pct)]),
        truncated: scan.truncated,
      })
      : null;
    const tableCols = [tr(lang, colKey), tr(lang, 'colCount'), tr(lang, 'colPct')];
    const tableRows = items.map((it) => [it.label, String(it.value), String(it.pct)]);
    const pdf = canCsv
      ? await attachReportPdf(ctx, {
        title,
        filtersLabel,
        chart,
        cols: tableCols,
        rows: tableRows,
        totalRows: items.length,
        truncated: scan.truncated,
        settings,
      })
      : null;
    return {
      summary,
      rows,
      meta: {
        totalMatched: n,
        totalScanned: scan.total,
        live: true,
        tools: ['build_report'],
        plan,
        ...(scan.truncated ? { scanTruncated: true } : {}),
      },
      followups,
      ui: uiPayload('report', { links: [link], csv, chart, pdf, reportId: `uret-${groupBy}` }),
    };
  }

  const slice = wantPreview ? filtered.slice(0, limit) : [];
  const csv = canCsv
    ? buildCsv({
      filename: title || tr(lang, 'fileReport'),
      cols: csvCols('asset', lang),
      rows: filtered.map((x) => assetCsvRow(x.a, x.life)),
      truncated: scan.truncated,
    })
    : null;

  const listCols = [
    tr(lang, 'pdfTag'),
    tr(lang, 'colCategory'),
    tr(lang, 'pdfBrandModel'),
    tr(lang, 'colStatus'),
    tr(lang, 'pdfAssigned'),
    tr(lang, 'colLocation'),
  ];
  const listRows = filtered.map((x) => {
    const a = x.a;
    const brandModel = [a.brand, a.model].filter(Boolean).join(' ') || '—';
    return [
      a.assetTag || '—',
      a.category || '—',
      brandModel,
      a.status || '—',
      (a.currentEmployee && a.currentEmployee.fullName) || '—',
      a.location || '—',
    ];
  });
  const pdf = canCsv
    ? await attachReportPdf(ctx, {
      title,
      filtersLabel,
      chart: null,
      cols: listCols,
      rows: listRows,
      totalRows: n,
      truncated: scan.truncated,
      settings,
    })
    : null;

  return {
    summary,
    rows: slice.map((x) => assetRow(x.a, x.life, lang)),
    meta: {
      totalMatched: n,
      totalScanned: scan.total,
      live: true,
      tools: ['build_report'],
      plan,
      ...(scan.truncated ? { scanTruncated: true } : {}),
    },
    followups,
    ui: uiPayload('report', { links: n ? [link] : [], csv, pdf, reportId: 'uret-list' }),
  };
}

async function toolRaporCalistir(args, ctx) {
  return runReport(args.report_id || args.reportId, clampLimit(args.limit, 50), ctx);
}

const SENSITIVE_KEY_RE = /password|secret|apikey|api_key|token|auth|hash|privatekey|private_key/i;

function sanitizeRow(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeRow);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[MASKED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeRow(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function toolKapsamliSorgula(args, ctx) {
  const lang = normalizeLang(ctx?.lang);
  const queryText = String(args.search || args.employee || args.department || '').trim();
  if (!queryText) {
    throw HttpError.badRequest('unified_search requires a search term, employee, or department');
  }

  const limit = clampLimit(args.limit, 15);
  const subCtx = { ...ctx, forceCount: false };

  const results = await Promise.allSettled([
    toolCihazAra({ search: queryText, employee: args.employee, department: args.department, limit }, subCtx),
    toolCalisanGetir({ search: queryText, department: args.department, limit }, subCtx),
    toolLisansListele({ search: queryText, limit }, subCtx),
    toolSozlesmeListele({ search: queryText, limit }, subCtx),
    toolOpsSorgula({ domain: 'line', search: queryText, employee: args.employee, limit }, subCtx),
    toolBelgeOzet({ search: queryText, limit }, subCtx),
    toolOpsSorgula({ domain: 'consumable', search: queryText, limit }, subCtx),
    toolOpsSorgula({ domain: 'maintenance', search: queryText, limit }, subCtx),
    toolOpsSorgula({ domain: 'stock_count', search: queryText, limit }, subCtx),
    toolOpsSorgula({ domain: 'handover', search: queryText, employee: args.employee, limit }, subCtx),
  ]);

  const allRows = [];
  const summaries = [];
  const toolsUsed = ['unified_search'];
  let totalCost = 0;
  let totalBookValue = 0;
  let hasEol = false;

  const [devRes, empRes, licRes, conRes, lineRes, docRes, consRes, maintRes, countRes, handRes] =
    results.map((r) => (r.status === 'fulfilled' ? r.value : null));

  if (devRes?.rows?.length) {
    devRes.rows.forEach(r => {
      totalCost += (r._cost || 0);
      totalBookValue += (r._bookValue || 0);
      if (r._lifeOverdue) hasEol = true;
    });
    let costStr = '';
    if (totalCost > 0) {
      costStr = tr(lang, 'compCost', {
        cost: totalCost.toLocaleString(),
        bookValue: totalBookValue.toLocaleString(),
      });
    }
    summaries.push(tr(lang, 'compDevices', { n: devRes.rows.length }) + costStr);
    allRows.push({ id: 'sec-dev', kind: 'section', title: tr(lang, 'secDevices') });
    allRows.push(...devRes.rows.map(sanitizeRow));
    toolsUsed.push('search_assets');
  }
  if (empRes?.rows?.length) {
    summaries.push(tr(lang, 'compEmployees', { n: empRes.rows.length }));
    allRows.push({ id: 'sec-emp', kind: 'section', title: tr(lang, 'secEmployees') });
    allRows.push(...empRes.rows.map(sanitizeRow));
    toolsUsed.push('find_employees');
  }
  if (licRes?.rows?.length) {
    summaries.push(tr(lang, 'compLicenses', { n: licRes.rows.length }));
    allRows.push({ id: 'sec-lic', kind: 'section', title: tr(lang, 'secLicenses') });
    allRows.push(...licRes.rows.map(sanitizeRow));
    toolsUsed.push('list_licenses');
  }
  if (conRes?.rows?.length) {
    summaries.push(tr(lang, 'compContracts', { n: conRes.rows.length }));
    allRows.push({ id: 'sec-con', kind: 'section', title: tr(lang, 'secContracts') });
    allRows.push(...conRes.rows.map(sanitizeRow));
    toolsUsed.push('list_contracts');
  }
  if (lineRes?.rows?.length) {
    summaries.push(tr(lang, 'compLines', { n: lineRes.rows.length }));
    allRows.push({ id: 'sec-line', kind: 'section', title: tr(lang, 'secLines') });
    allRows.push(...lineRes.rows.map(sanitizeRow));
    toolsUsed.push('query_operations');
  }
  if (docRes?.rows?.length) {
    summaries.push(tr(lang, 'compDocs', { n: docRes.rows.length }));
    allRows.push({ id: 'sec-doc', kind: 'section', title: tr(lang, 'secDocuments') });
    allRows.push(...docRes.rows.map(sanitizeRow));
    toolsUsed.push('document_summary');
  }
  if (consRes?.rows?.length) {
    summaries.push(tr(lang, 'compConsumables', { n: consRes.rows.length }));
    allRows.push({ id: 'sec-cons', kind: 'section', title: tr(lang, 'secConsumables') });
    allRows.push(...consRes.rows.map(sanitizeRow));
    toolsUsed.push('query_operations');
  }
  if (maintRes?.rows?.length) {
    summaries.push(tr(lang, 'compMaintenance', { n: maintRes.rows.length }));
    allRows.push({ id: 'sec-maint', kind: 'section', title: tr(lang, 'secMaintenance') });
    allRows.push(...maintRes.rows.map(sanitizeRow));
    toolsUsed.push('query_operations');
  }
  if (countRes?.rows?.length) {
    summaries.push(tr(lang, 'compStockCounts', { n: countRes.rows.length }));
    allRows.push({ id: 'sec-count', kind: 'section', title: tr(lang, 'secStockCounts') });
    allRows.push(...countRes.rows.map(sanitizeRow));
    toolsUsed.push('query_operations');
  }
  if (handRes?.rows?.length) {
    summaries.push(tr(lang, 'compHandovers', { n: handRes.rows.length }));
    allRows.push({ id: 'sec-hand', kind: 'section', title: tr(lang, 'secHandovers') });
    allRows.push(...handRes.rows.map(sanitizeRow));
    toolsUsed.push('query_operations');
  }

  const totalMatched = allRows.filter((r) => r.kind !== 'section').length;
  const summaryText = totalMatched > 0
    ? tr(lang, 'compSummary', { query: queryText, parts: summaries.join(', ') })
    : tr(lang, 'compNone', { query: queryText });

  const dynamicFollowups = [];
  if (totalMatched === 0) {
    dynamicFollowups.push(
      tr(lang, 'fuListActiveEmployees'),
      tr(lang, 'fuFreeStockDevices'),
      tr(lang, 'fuExpiringContracts'),
    );
  } else {
    if (devRes?.rows?.length) {
      dynamicFollowups.push(tr(lang, 'fuTheirDevices', { query: queryText }));
      dynamicFollowups.push(tr(lang, 'fuHistoryFor', { query: queryText }));
    }
    if (hasEol) dynamicFollowups.push(tr(lang, 'fuCalcReplacement', { query: queryText }));
    if (conRes?.rows?.length > 0 || licRes?.rows?.length > 0) {
      dynamicFollowups.push(tr(lang, 'fuCheckExpiry'));
    }
    if (lineRes?.rows?.length) {
      dynamicFollowups.push(tr(lang, 'fuTheirLines', { query: queryText }));
    }
    if (dynamicFollowups.length < 2) {
      dynamicFollowups.push(tr(lang, 'fuFreeStockDevices'), tr(lang, 'fuExpiringContracts'));
    }
  }

  return {
    summary: summaryText,
    rows: allRows,
    followups: dynamicFollowups.slice(0, 4),
    ui: { kind: 'multi' },
    meta: { totalMatched, totalScanned: totalMatched, mode: 'list', tools: [...new Set(toolsUsed)] },
  };
}

const SQL_RESULT_STRINGS = {
  en: { rows: (n) => `${n} row${n === 1 ? '' : 's'} returned.`, capped: 'showing the first 200', empty: 'No rows matched.', missing: 'No SQL was provided.', denied: 'You do not have permission to query that data.' },
  tr: { rows: (n) => `${n} satır döndü.`, capped: 'ilk 200 satır gösteriliyor', empty: 'Eşleşen satır yok.', missing: 'Sorgu (SQL) verilmedi.', denied: 'Bu veriyi sorgulama yetkiniz yok.' },
  de: { rows: (n) => `${n} Zeile${n === 1 ? '' : 'n'} zurückgegeben.`, capped: 'erste 200 Zeilen', empty: 'Keine Zeilen gefunden.', missing: 'Keine SQL angegeben.', denied: 'Sie sind nicht berechtigt, diese Daten abzufragen.' },
  fr: { rows: (n) => `${n} ligne${n === 1 ? '' : 's'} renvoyée${n === 1 ? '' : 's'}.`, capped: '200 premières lignes', empty: 'Aucune ligne trouvée.', missing: 'Aucune requête fournie.', denied: "Vous n'êtes pas autorisé à interroger ces données." },
  es: { rows: (n) => `${n} fila${n === 1 ? '' : 's'} devuelta${n === 1 ? '' : 's'}.`, capped: 'primeras 200 filas', empty: 'Sin filas coincidentes.', missing: 'No se proporcionó SQL.', denied: 'No tiene permiso para consultar esos datos.' },
};
function sqlStrings(lang) {
  return SQL_RESULT_STRINGS[normalizeLang(lang)] || SQL_RESULT_STRINGS.en;
}

async function toolGelismisSorgu(args, ctx) {
  const lang = normalizeLang(ctx?.lang);
  const s = sqlStrings(lang);
  const sql = String(args?.sql || args?.query || '').trim();
  if (!sql) return { summary: s.missing, rows: [], error: true, meta: { tools: ['advanced_query'] } };

  const { runReadOnlyQuery, referencedResources, confidentialResourcesTouched } = require('../sqlGuard');

  // Enforce the same per-resource RBAC the dedicated tools use: the caller must
  // hold read on every ai.* view the query touches. Without this, advanced_query
  // would let any staff user read data (contracts, costs, lines…) their role is
  // denied elsewhere in the app.
  try {
    for (const resource of referencedResources(sql)) {
      await assertPerm(ctx?.user, resource, 'read');
    }
    // Financial columns (cost, purchase_amount, monthly_cost…) are hidden behind
    // `<resource>:view_confidential` on the REST routes (redactCosts). The ai_ro
    // role can read them, so any query that references those columns must hold
    // the same confidential permission here — otherwise advanced_query is a hole
    // straight through the cost redaction the rest of the app enforces.
    for (const resource of confidentialResourcesTouched(sql)) {
      await assertConfidential(ctx?.user, resource);
    }
  } catch (err) {
    return { summary: err.message || s.denied, rows: [], error: true, meta: { tools: ['advanced_query'] } };
  }

  let out;
  try {
    out = await runReadOnlyQuery(sql);
  } catch (err) {
    return { summary: err.message || 'Query failed', rows: [], error: true, meta: { tools: ['advanced_query'] } };
  }

  try {
    services().auditService?.logEvent?.({
      action: 'ai.query.sql',
      source: 'ai',
      summary: `AI SQL (${out.rowCount} rows): ${String(out.sql).replace(/\s+/g, ' ').slice(0, 180)}`,
      actorId: ctx?.user?.uid,
      actorEmail: ctx?.user?.email,
      actorName: ctx?.user?.username,
      entityType: 'ai',
      meta: { sql: out.sql, rowCount: out.rowCount },
    }).catch(() => {});
  } catch { /* audit is best-effort */ }

  let preview = '';
  if (out.rowCount > 0 && out.columns.length === 2) {
    const [k, v] = out.columns;
    preview = ` ${out.rows.slice(0, 6).map((r) => `${r[k]}: ${r[v]}`).join(' · ')}`;
  }
  const summary = out.rowCount === 0
    ? s.empty
    : `${s.rows(out.rowCount)}${preview}${out.truncated ? ` (${s.capped})` : ''}`;

  const arrayRows = out.rows.map((r) => out.columns.map((c) => r[c]));
  const csv = out.rowCount
    ? buildCsv({ filename: 'advanced-query', cols: out.columns, rows: arrayRows, total: out.rowCount, truncated: out.truncated })
    : null;

  let chart = null;
  if (out.rowCount > 1 && out.columns.length === 2) {
    const [k, v] = out.columns;
    const items = out.rows.map((r) => ({ label: String(r[k] ?? '—'), value: Number(r[v]) }));
    if (items.length === out.rows.length && items.every((it) => Number.isFinite(it.value))) {
      chart = { type: 'bar', items: items.slice(0, 12) };
    }
  }

  return {
    summary,
    rows: [],
    ui: {
      kind: 'table',
      table: { columns: out.columns, rows: out.rows, sql: out.sql },
      ...(csv ? { csv } : {}),
      ...(chart ? { chart } : {}),
    },
    meta: { tools: ['advanced_query'], live: true, kind: 'table', rowCount: out.rowCount, truncated: out.truncated },
  };
}

const EXECUTORS = {
  search_assets: toolCihazAra,
  advanced_query: toolGelismisSorgu,
  list_licenses: toolLisansListele,
  list_contracts: toolSozlesmeListele,
  find_employees: toolCalisanGetir,
  document_summary: toolBelgeOzet,
  handover_history: toolZimmetGecmisi,
  query_operations: toolOpsSorgula,
  run_report: toolRaporCalistir,
  build_report: toolRaporUret,
  unified_search: toolKapsamliSorgula,
};

function getToolDefs() {
  return TOOL_DEFS;
}

const COUNTABLE_TOOLS = [
  'search_assets', 'list_licenses', 'list_contracts', 'find_employees', 'document_summary', 'query_operations', 'handover_history',
];

async function executeTool(name, args, ctx) {
  const a = { ...(args && typeof args === 'object' ? args : {}) };
  if (ctx?.forceCount && COUNTABLE_TOOLS.includes(name) && !a.mode) {
    a.mode = 'count';
  }
  if (
    (ctx?.forceCount || isCountMode(a))
    && name === 'run_report'
    && String(a.report_id || a.reportId || '').toLowerCase() === 'employees'
  ) {
    return toolCalisanGetir({ mode: 'count', search: a.search, department: a.department, status: a.status }, ctx);
  }
  const fn = EXECUTORS[name];
  if (!fn) throw HttpError.badRequest(`Unknown tool: ${name}`);
  return fn(a, ctx);
}

module.exports = {
  TOOL_DEFS,
  getToolDefs,
  executeTool,
  eolInfo,
  clampLimit,
  isCountMode,
  countPayload,
  countSentence,
  normalizeLang,
  SUPPORTED_LANGS,
  tr,
  toolLabel,
  csvCols,
  assetNoun,
  normalizeAssignmentHistory,
  filterByAssignmentHistory,
  scanAssets,
  buildAssetListLink,
  buildEmployeeListLink,
  buildCsv,
  csvFilename,
  pdfFilename,
  uiPayload,
  assetCsvRow,
  ASSET_CSV_COLS,
  SCAN_PAGE,
  SCAN_CAP,
  CSV_ROW_CAP,
  mapOpsMaintenanceOpen,
  isConsumableLowStockFilter,
  sanitizeRow,
  toolKapsamliSorgula,
  resolveLocationFuzzy,
  findKnownLocationInText,
  extractLocationQuery,
  isLocationJunk,
  resolveEmployeeLookup,
  scoreEmployeeName,
  foldAscii,
  resolveAssetLocation,
  aggregateAssetsBy,
  foldAscii,
  attachReportPdf,
  buildReportFollowups,
  buildAssetFollowups,
  buildAssetMetrics,
};
