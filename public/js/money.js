/* Shared money formatting + currency helpers (app default + per-record override). */
'use strict';

const APP_CURRENCY_OPTIONS = [
  { value: 'TRY', label: 'TRY — Turkish Lira' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'CHF', label: 'CHF — Swiss Franc' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'SAR', label: 'SAR — Saudi Riyal' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
  { value: 'SEK', label: 'SEK — Swedish Krona' },
  { value: 'NOK', label: 'NOK — Norwegian Krone' },
  { value: 'DKK', label: 'DKK — Danish Krone' },
  { value: 'PLN', label: 'PLN — Polish Złoty' },
  { value: 'RON', label: 'RON — Romanian Leu' },
  { value: 'CZK', label: 'CZK — Czech Koruna' },
  { value: 'HUF', label: 'HUF — Hungarian Forint' },
  { value: 'BGN', label: 'BGN — Bulgarian Lev' },
  { value: 'CNY', label: 'CNY — Chinese Yuan' },
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'BRL', label: 'BRL — Brazilian Real' },
  { value: 'SGD', label: 'SGD — Singapore Dollar' },
  { value: 'HKD', label: 'HKD — Hong Kong Dollar' },
];

function appCurrency() {
  const c = (typeof AppConfig !== 'undefined' && AppConfig.currency) || 'TRY';
  return String(c).toUpperCase().slice(0, 3) || 'TRY';
}

function moneyLocale() {
  try {
    if (typeof i18nLang === 'function') return i18nLang() || undefined;
  } catch { /* ignore */ }
  return (typeof AppConfig !== 'undefined' && AppConfig.language) || undefined;
}

/** Format an amount with currency (defaults to instance AppConfig.currency). */
function fmtMoney(amount, currency) {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const code = String(currency || appCurrency()).toUpperCase().slice(0, 3) || appCurrency();
  try {
    return new Intl.NumberFormat(moneyLocale(), {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString(moneyLocale(), { maximumFractionDigits: 2 })} ${code}`.trim();
  }
}

/** Short symbol/example for placeholders (e.g. sale price). */
function moneyExample(sample = 1500) {
  return fmtMoney(sample, appCurrency());
}

function currencyOptionsForSelect(selected) {
  const cur = String(selected || appCurrency()).toUpperCase();
  const list = APP_CURRENCY_OPTIONS.map((o) => ({ ...o }));
  if (cur && !list.some((o) => o.value === cur)) {
    list.unshift({ value: cur, label: cur });
  }
  return list;
}
