/* Skyview — language, digits, units, dates. Display strings only; no weather logic here. */
import { S } from './store.js';
import { isNum, pad2, wallToMs } from './util.js';
import fa from './lang/fa.js';
import en from './lang/en.js';

const DICT = { fa, en };
let lang = 'fa';

export const getLang = () => lang;
export const isRTL = () => lang === 'fa';

export function setLanguage(next) {
  lang = DICT[next] ? next : 'fa';
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.title = t('app.title');
}

/** Translate a key. Falls back to English, then to the key itself. {name} placeholders are replaced. */
export function t(key, params) {
  let s = DICT[lang][key];
  if (s === undefined) s = DICT.en[key];
  if (s === undefined) return key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
  return dig(s); // dictionaries use 0-9; show Persian digits when that setting is on
}
export const hasKey = (key) => key in DICT[lang] || key in DICT.en;
export const allKeys = () => ({ fa: Object.keys(fa), en: Object.keys(en) });

const AR_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FC]/;
/** True when the text contains Persian/Arabic letters (not just digits and punctuation). */
export const hasLetters = (s) => AR_LETTER.test(s);
/** Wrap numbers/units in a left-to-right isolate so they keep their order inside RTL sentences.
 *  Text that contains Persian words (durations, "ب.ظ", weekday names) is left alone: it must flow with the sentence. */
export const ltr = (s) => (AR_LETTER.test(s) ? String(s) : `\u2066${s}\u2069`);
/** Join short fragments: Persian comma in Persian text, a middle dot in English (a dot would look like the Persian zero "۰"). */
export const joinList = (parts) => parts.filter(Boolean).join(lang === 'fa' ? '، ' : ' · ');
/** Remove bidi isolates (for notifications, clipboard, aria-labels). */
export const plain = (s) => String(s).replace(/[\u2066-\u2069]/g, '');

/** Fill [data-i18n] (text) and [data-i18n-attr="attr:key;attr2:key2"] inside root. */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

/* ------------------------------------------------------------------ numbers */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const persianDigits = () => lang === 'fa' && S.digits === 'fa';

/** Map 0-9 to Persian digits when that setting is on (leaves everything else untouched). */
export function dig(s) {
  s = String(s);
  return persianDigits() ? s.replace(/\d/g, (d) => FA_DIGITS[d]) : s;
}

/** Locale-aware number: Persian digits + decimal mark, real minus sign, no "-0". */
export function num(v, decimals = 0, { sign = false } = {}) {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v).toFixed(decimals);
  const zero = Number(abs) === 0;
  let s = abs;
  if (persianDigits()) s = s.replace(/\d/g, (d) => FA_DIGITS[d]).replace('.', '٫');
  if (v < 0 && !zero) return `−${s}`;
  return sign && !zero ? `+${s}` : s;
}

export const pct = (v) => (isNum(v) ? `${num(v)}${persianDigits() ? '٪' : '%'}` : '—');

/* -------------------------------------------------------------------- units */
export const tempUnit = () => (S.temp === 'f' ? '°F' : '°C');
export const toTemp = (c) => (S.temp === 'f' ? (c * 9) / 5 + 32 : c);
/** 23.4 → "23°" (or "23°C" with unit). */
export function fTemp(c, { unit = false } = {}) {
  if (!isNum(c)) return '—';
  return `${num(toTemp(c), 0)}°${unit ? (S.temp === 'f' ? 'F' : 'C') : ''}`;
}

const WIND_K = { kmh: 1, ms: 1 / 3.6, mph: 1 / 1.609344, kn: 1 / 1.852 };
const WIND_U = { kmh: 'km/h', ms: 'm/s', mph: 'mph', kn: 'kn' };
export const windUnit = () => WIND_U[S.wind];
export const toWind = (kmh) => kmh * WIND_K[S.wind];
export function fWind(kmh, { unit = true } = {}) {
  if (!isNum(kmh)) return '—';
  const s = num(toWind(kmh), S.wind === 'ms' ? 1 : 0);
  return unit ? `${s} ${WIND_U[S.wind]}` : s;
}

export const precipUnit = () => (S.precip === 'in' ? 'in' : 'mm');
export const toPrecip = (mm) => (S.precip === 'in' ? mm / 25.4 : mm);
export function fPrecip(mm, { unit = true } = {}) {
  if (!isNum(mm)) return '—';
  const v = toPrecip(mm);
  const dec = S.precip === 'in' ? 2 : v >= 10 ? 0 : 1;
  const s = Number(v.toFixed(dec)) === 0 ? num(0) : num(v, dec);
  return unit ? `${s} ${precipUnit()}` : s;
}

const PRESSURE_U = { hpa: 'hPa', mmhg: 'mmHg', inhg: 'inHg' };
export const pressureUnit = () => PRESSURE_U[S.pressure];
export const toPressure = (hpa) => (S.pressure === 'mmhg' ? hpa * 0.750062 : S.pressure === 'inhg' ? hpa * 0.02953 : hpa);
export function fPressure(hpa, { unit = true } = {}) {
  if (!isNum(hpa)) return '—';
  const s = num(toPressure(hpa), S.pressure === 'inhg' ? 2 : 0);
  return unit ? `${s} ${PRESSURE_U[S.pressure]}` : s;
}

export function fVis(m) {
  if (!isNum(m)) return '—';
  const v = S.vis === 'mi' ? m / 1609.344 : m / 1000;
  return `${num(v, v >= 10 ? 0 : 1)} ${S.vis === 'mi' ? 'mi' : 'km'}`;
}

/* -------------------------------------------------------------------- time */
/** Wall-clock "YYYY-MM-DDTHH:MM" → "14:30" or "2:30 PM". */
export function fTime(iso) {
  if (!iso) return '—';
  const hh = Number(iso.slice(11, 13));
  const mm = iso.slice(14, 16);
  if (!S.hour12) return dig(`${pad2(hh)}:${mm}`);
  const clock = dig(`${hh % 12 || 12}:${mm}`);
  return `${isRTL() ? ltr(clock) : clock} ${t(hh < 12 ? 'time.am' : 'time.pm')}`;
}
/** Short label for the hourly strip: "14:00" or "2 PM". */
export function fHour(iso) {
  const hh = Number(iso.slice(11, 13));
  if (!S.hour12) return dig(`${pad2(hh)}:00`);
  return `${dig(hh % 12 || 12)} ${t(hh < 12 ? 'time.am' : 'time.pm')}`;
}
export function fDuration(totalSeconds) {
  if (!isNum(totalSeconds)) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (m === 60) return t('dur.hm', { h: dig(h + 1), m: dig(0) });
  return h > 0 ? t('dur.hm', { h: dig(h), m: dig(m) }) : t('dur.m', { m: dig(m) });
}
export function fMinutes(min) {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return t('dur.m', { m: dig(m) });
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? t('dur.hm', { h: dig(h), m: dig(r) }) : t('dur.h', { h: dig(h) });
}

const rtfCache = new Map();
/** "5 minutes ago" for a number of milliseconds. */
export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return t('time.justNow');
  let rtf = rtfCache.get(lang);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(`${lang}-u-nu-latn`, { numeric: 'always' });
    rtfCache.set(lang, rtf);
  }
  if (s < 3600) return dig(rtf.format(-Math.max(1, Math.floor(s / 60)), 'minute'));
  if (s < 86400) return dig(rtf.format(-Math.floor(s / 3600), 'hour'));
  return dig(rtf.format(-Math.floor(s / 86400), 'day'));
}

/* ------------------------------------------------------------------- dates */
const fmtCache = new Map();
function dtf(locale, opts) {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts });
    fmtCache.set(key, f);
  }
  return f;
}
/** A calendar date as a stable instant (noon UTC) so time zones can never shift the day. */
const noonUTC = (dateStr) => new Date(wallToMs(dateStr.slice(0, 10)) + 12 * 3600e3);
// Persian UI → Jalali calendar as the primary one, Gregorian as secondary. English UI → Gregorian only.
const primary = () => (lang === 'fa' ? 'fa-IR-u-ca-persian-nu-latn' : 'en-US-u-nu-latn');
const secondary = () => (lang === 'fa' ? 'fa-IR-u-ca-gregory-nu-latn' : 'en-US-u-nu-latn');

export const weekdayName = (dateStr, style = 'long') => dtf(primary(), { weekday: style }).format(noonUTC(dateStr));
export const dayMonth = (dateStr) => dig(dtf(primary(), { day: 'numeric', month: 'long' }).format(noonUTC(dateStr)));
export const longDate = (dateStr) => dig(dtf(primary(), { weekday: 'long', day: 'numeric', month: 'long' }).format(noonUTC(dateStr)));
/** Gregorian date for Persian UI ("۵ نوامبر"); empty string for English UI (already Gregorian). */
export const altDate = (dateStr) =>
  lang === 'fa' ? dig(dtf(secondary(), { day: 'numeric', month: 'long' }).format(noonUTC(dateStr))) : '';

/* ------------------------------------------------------------------ places */
const pickText = (o) => (typeof o === 'string' ? o : (o && (o[lang] || o.fa || o.en || Object.values(o)[0])) || '');
export const coordLabel = (p) => `${num(p.lat, 2)}, ${num(p.lon, 2)}`;
export const placeTitle = (p) => pickText(p?.name) || (p ? coordLabel(p) : '');
export const placeSub = (p) => pickText(p?.sub);
