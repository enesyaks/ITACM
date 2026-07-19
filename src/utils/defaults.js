/** Visual design themes for the zimmet / handover form.
 *  Chosen during onboarding & Settings — drives CSS class + PDF colors. */
const HANDOVER_DESIGNS = {
  terminal: {
    id: 'terminal',
    name: 'Terminal Protocol',
    desc: 'Dark navy header, violet accents — modern IT look',
    swatches: ['#131b2e', '#3525cd', '#e2dfff'],
    pdf: {
      header: '#131b2e',
      headerText: '#ffffff',
      headerMuted: '#c3c0ff',
      headerSoft: '#e2dfff',
      accent: '#3525cd',
      sectionBg: '#e2dfff',
      tableHead: '#f5f2ff',
      rowAlt: '#faf9fc',
      border: '#c7c4d8',
      rule: '#e4e1ee',
      text: '#1b1b24',
      muted: '#777587',
      body: '#464555',
      metaBg: '#ffffff',
      logoBg: '#ffffff',
    },
  },
  classic: {
    id: 'classic',
    name: 'Classic Formal',
    desc: 'Black & white corporate document — formal print look',
    swatches: ['#111111', '#ffffff', '#e8e8e8'],
    pdf: {
      header: '#111111',
      headerText: '#ffffff',
      headerMuted: '#cccccc',
      headerSoft: '#eeeeee',
      accent: '#111111',
      sectionBg: '#eeeeee',
      tableHead: '#f3f3f3',
      rowAlt: '#fafafa',
      border: '#999999',
      rule: '#dddddd',
      text: '#111111',
      muted: '#666666',
      body: '#333333',
      metaBg: '#ffffff',
      logoBg: '#ffffff',
    },
  },
  corporate: {
    id: 'corporate',
    name: 'Corporate Blue',
    desc: 'Steel-blue header and calm blue accents',
    swatches: ['#1e3a5f', '#2b6cb0', '#ebf4ff'],
    pdf: {
      header: '#1e3a5f',
      headerText: '#ffffff',
      headerMuted: '#a8c5e2',
      headerSoft: '#d6e6f5',
      accent: '#2b6cb0',
      sectionBg: '#d6e6f5',
      tableHead: '#ebf4ff',
      rowAlt: '#f7fafc',
      border: '#a0aec0',
      rule: '#e2e8f0',
      text: '#1a202c',
      muted: '#718096',
      body: '#4a5568',
      metaBg: '#ffffff',
      logoBg: '#ffffff',
    },
  },
  slate: {
    id: 'slate',
    name: 'Slate Teal',
    desc: 'Teal accents on a soft slate header',
    swatches: ['#1a2e2a', '#0d9488', '#ccfbf1'],
    pdf: {
      header: '#1a2e2a',
      headerText: '#ffffff',
      headerMuted: '#99f6e4',
      headerSoft: '#ccfbf1',
      accent: '#0f766e',
      sectionBg: '#ccfbf1',
      tableHead: '#f0fdfa',
      rowAlt: '#f8fffe',
      border: '#99a8a5',
      rule: '#dce5e3',
      text: '#134e4a',
      muted: '#5f736f',
      body: '#3f4f4c',
      metaBg: '#ffffff',
      logoBg: '#ffffff',
    },
  },
};

const HANDOVER_DESIGN_IDS = Object.keys(HANDOVER_DESIGNS);

function resolveHandoverDesign(id) {
  return HANDOVER_DESIGNS[id] || HANDOVER_DESIGNS.terminal;
}

/** Default bilingual terms text for the handover form (Zimmet Tutanağı).
 *  Editable per-instance via Settings; paragraphs are separated by blank lines. */
const DEFAULT_HANDOVER_TERMS = `I acknowledge receipt of the equipment listed above in good working condition. I understand that this equipment is the property of the company and is provided to me solely for business use. I agree to take reasonable care of these assets, follow all corporate security policies, and return them immediately upon request or termination of employment. In the event of loss, theft, or damage due to negligence, I may be held responsible for the replacement or repair costs.

Yukarıda listelenen ekipmanları çalışır durumda teslim aldığımı kabul ediyorum. Bu ekipmanların şirketin mülkiyetinde olduğunu ve tarafıma sadece iş amaçlı kullanım için tahsis edildiğini anlıyorum. Bu varlıklara makul özeni göstermeyi, tüm kurumsal güvenlik politikalarına uymayı ve talep edildiğinde veya iş akdimin feshinde derhal iade etmeyi kabul ediyorum. İhmal sonucu oluşabilecek kayıp, çalıntı veya hasar durumlarında onarım veya yenileme maliyetlerinden sorumlu tutulabileceğimi beyan ederim.`;

/** Default lifecycle duration (months) per product category — centrally
 *  managed in Settings and applied to every asset of that category. */
const DEFAULT_LIFECYCLES = {
  Laptop: 48, Desktop: 60, Monitor: 72, Television: 84, Phone: 36, Tablet: 36,
  Printer: 60, Network: 84, Server: 84, Keyboard: 36, Mouse: 36, Headset: 36,
  'Docking Station': 48, Webcam: 48, Peripheral: 36, Accessory: 36, Other: 48,
};

/** Default office locations — shown in the asset form and Product Catalog. */
const DEFAULT_LOCATIONS = [
  'Main Office',
  'Istanbul Branch',
  'Remote / Home Office',
  'Warehouse',
  'Service Center',
];

/** Default hardware spec lists — feed the asset form dropdowns and report
 *  filters; managed from the Product Catalog screen. */
const DEFAULT_SPEC_OPTIONS = {
  cpu: ['Intel i5-1235U', 'Intel i7-1355U', 'Intel i9-13900H', 'Ryzen 5 5600U', 'Ryzen 7 7840U', 'Apple M2', 'Apple M3'],
  ram: ['8GB', '16GB', '32GB', '64GB'],
  storage: ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD'],
};

/** Default company departments — shown in the employee form and managed from
 *  the Product Catalog screen. */
const DEFAULT_DEPARTMENTS = [
  'Bilgi Teknolojileri',
  'Yazılım Geliştirme',
  'Finans',
  'İnsan Kaynakları',
  'Satış',
  'Pazarlama',
  'Operasyon',
];

/** Provider types (ISP, MSP…) — Product Catalog → Providers & Contracts forms. */
const DEFAULT_PROVIDER_CATEGORIES = [
  'ISP', 'Telco', 'Cloud', 'Hardware', 'Software', 'MSP', 'Support', 'Security', 'Other',
];

/** Contract types — Product Catalog → contract form. */
const DEFAULT_CONTRACT_CATEGORIES = [
  'Connectivity', 'Support', 'License', 'Hardware', 'SaaS', 'MSP', 'Security', 'Other',
];

/** Default Zimmet Tutanağı (handover form) template — field visibility + design. */
const DEFAULT_HANDOVER_TEMPLATE = {
  design: 'terminal',
  titleEn: 'Asset Handover',
  titleTr: 'Zimmet Belgesi',
  subtitle: 'Corporate Resource Management',
  showLogo: true,
  showEmployeeId: true,
  showDepartment: true,
  showTitle: true,
  colCategory: true,
  colSerial: true,
  colMac: false,
  colCondition: true,
  showTerms: true,
  showReturnSection: false,
  deliveredByLabel: '',
  receivedByLabel: '',
  footerNote: '',
};

/** One named template per visual design (seed / onboarding). */
const DEFAULT_HANDOVER_TEMPLATES = HANDOVER_DESIGN_IDS.map((id) => ({
  id,
  name: HANDOVER_DESIGNS[id].name,
  ...DEFAULT_HANDOVER_TEMPLATE,
  design: id,
}));

const MAX_HANDOVER_TEMPLATES = 12;

/** Default barcode/asset-label design — sizes (mm) + which fields to print.
 *  Configured instance-wide from Settings → Barcode label. */
const DEFAULT_LABEL_CONFIG = {
  widthMm: 58,
  heightMm: 32,
  barcodeMm: 12,
  copies: 1,
  showLogo: true,
  showCompany: true,
  showModel: true,
  showCategory: true,
  showSerial: true,
};

/** Instance default currency (ISO 4217). Contracts may override per record. */
const DEFAULT_CURRENCY = 'TRY';

/** Leading segment of auto-generated asset tags: PREFIX-#### (e.g. IT-1001). */
const DEFAULT_ASSET_TAG_PREFIX = 'IT';

/** Common currencies offered in Settings / contract forms. */
const APP_CURRENCIES = [
  'TRY', 'USD', 'EUR', 'GBP', 'CHF', 'AED', 'SAR', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'RON', 'CZK', 'HUF', 'BGN', 'RUB', 'CNY', 'INR', 'BRL', 'MXN', 'ZAR', 'KRW', 'SGD', 'HKD', 'NZD',
];

module.exports = {
  DEFAULT_HANDOVER_TERMS,
  DEFAULT_LIFECYCLES,
  DEFAULT_LOCATIONS,
  DEFAULT_SPEC_OPTIONS,
  DEFAULT_HANDOVER_TEMPLATE,
  DEFAULT_HANDOVER_TEMPLATES,
  MAX_HANDOVER_TEMPLATES,
  DEFAULT_LABEL_CONFIG,
  DEFAULT_DEPARTMENTS,
  DEFAULT_PROVIDER_CATEGORIES,
  DEFAULT_CONTRACT_CATEGORIES,
  DEFAULT_CURRENCY,
  DEFAULT_ASSET_TAG_PREFIX,
  APP_CURRENCIES,
  HANDOVER_DESIGNS,
  HANDOVER_DESIGN_IDS,
  resolveHandoverDesign,
};
