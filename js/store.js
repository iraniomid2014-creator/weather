/* Skyview — settings, saved places, the per-place offline cache and the background-photo cache. */
import { ls, emitter, isNum } from './util.js';

const bus = emitter();
export const on = bus.on;
export const emit = bus.emit;

const K = {
  settings: 'skyview1.settings',
  places: 'skyview1.places',
  cache: 'skyview1.cache.',
  photo: 'skyview1.photo.',
};
export const STORAGE_PREFIX = 'skyview1.';

const ENUM = {
  lang: ['fa', 'en'],
  theme: ['auto', 'dark', 'light'],
  digits: ['fa', 'latn'],
  temp: ['c', 'f'],
  wind: ['kmh', 'ms', 'mph', 'kn'],
  precip: ['mm', 'in'],
  pressure: ['hpa', 'mmhg', 'inhg'],
  vis: ['km', 'mi'],
  aqi: ['us', 'eu'],
  effects: ['auto', 'on', 'off'],
  photo: ['on', 'off'],
};
const BOOL = ['hour12'];

function defaults() {
  const nav = ((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
  const us = nav === 'en-us';
  return {
    lang: 'fa',
    theme: 'auto',
    digits: 'fa',
    hour12: us,
    temp: us ? 'f' : 'c',
    wind: us ? 'mph' : 'kmh',
    precip: us ? 'in' : 'mm',
    pressure: us ? 'inhg' : 'hpa',
    vis: us ? 'mi' : 'km',
    aqi: 'us',
    effects: 'auto',
    photo: 'on',
  };
}

function validValue(key, v) {
  if (key in ENUM) return ENUM[key].includes(v);
  if (BOOL.includes(key)) return typeof v === 'boolean';
  return false;
}

/* -------------------------------------------------------- migration (Nimbus 3.x)
   Skyview takes over from the previous app (Nimbus) on the same address. Carry over the user's settings and places once (values are validated
   by the loaders below), then delete every nimbus3.* key: those caches have another shape and can hold stale data. */
const OLD_PREFIX = 'nimbus3.';
const LEGACY_KEYS = ['nimbus_settings', 'nimbus_install_dismissed'];
const SETTING_KEYS = ['lang', 'theme', 'digits', 'hour12', 'temp', 'wind', 'precip', 'pressure', 'vis', 'aqi', 'effects'];

function migrateLegacy() {
  const hasNew = ls.get(K.settings, null) !== null || ls.get(K.places, null) !== null;
  const oldKeys = ls.keys(OLD_PREFIX);
  if (!hasNew && oldKeys.length) {
    const oldS = ls.get(OLD_PREFIX + 'settings', null);
    if (oldS && typeof oldS === 'object') {
      const keep = {};
      for (const k of SETTING_KEYS) if (k in oldS) keep[k] = oldS[k];
      ls.set(K.settings, keep);
    }
    const oldP = ls.get(OLD_PREFIX + 'places', null);
    if (oldP && typeof oldP === 'object') ls.set(K.places, oldP);
  }
  oldKeys.forEach((k) => ls.del(k));
  LEGACY_KEYS.forEach((k) => ls.del(k));
}
migrateLegacy();

/** Live settings object (read it freely; change it only through setSetting). */
export const S = (() => {
  const base = defaults();
  const saved = ls.get(K.settings, {}) || {};
  for (const key of Object.keys(base)) {
    if (key in saved && validValue(key, saved[key])) base[key] = saved[key];
  }
  return base;
})();

export function setSetting(key, value) {
  if (!(key in S) || !validValue(key, value)) return false;
  if (S[key] === value) return true;
  S[key] = value;
  ls.set(K.settings, S);
  emit('settings', key, value);
  return true;
}

/* ------------------------------------------------------------------- places
   A place: { key, name:{fa,en}|null, sub:{fa,en}|null, lat, lon, tz }.
   name/sub are per-language so a saved place reads well after a language switch. */
export const pkey = (lat, lon) => `${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;

export const validPlace = (p) =>
  !!p && typeof p === 'object' && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function cleanText(o) {
  if (typeof o === 'string') return o.slice(0, 120);
  if (!o || typeof o !== 'object') return null;
  const out = {};
  for (const lang of ['fa', 'en']) if (typeof o[lang] === 'string' && o[lang]) out[lang] = o[lang].slice(0, 120);
  return Object.keys(out).length ? out : null;
}

export function makePlace(o) {
  return {
    key: pkey(o.lat, o.lon),
    name: cleanText(o.name),
    sub: cleanText(o.sub),
    // ~1 km is plenty for weather, and keeps a GPS fix from leaking into shared links, the cache and API requests
    lat: +(+o.lat).toFixed(2),
    lon: +(+o.lon).toFixed(2),
    tz: typeof o.tz === 'string' ? o.tz : null,
  };
}

export const DEFAULT_PLACE = makePlace({
  name: { fa: 'تهران', en: 'Tehran' },
  sub: { fa: 'تهران، ایران', en: 'Tehran, Iran' },
  lat: 35.6892,
  lon: 51.389,
  tz: 'Asia/Tehran',
});

function loadPlaces() {
  const raw = ls.get(K.places, null);
  const out = { current: null, favorites: [], recents: [] };
  if (raw && typeof raw === 'object') {
    if (validPlace(raw.current)) out.current = makePlace(raw.current);
    if (Array.isArray(raw.favorites)) out.favorites = raw.favorites.filter(validPlace).map(makePlace).slice(0, 20);
    if (Array.isArray(raw.recents)) out.recents = raw.recents.filter(validPlace).map(makePlace).slice(0, 8);
  }
  return out;
}
const P = loadPlaces();
const savePlaces = () => {
  ls.set(K.places, P);
  emit('places');
};

export const getCurrent = () => P.current;
export const getFavorites = () => P.favorites.slice();
export const getRecents = () => P.recents.slice();
export const isFavorite = (p) => P.favorites.some((f) => f.key === p.key);

export function setCurrent(place) {
  const p = makePlace(place);
  P.current = p;
  P.recents = [p, ...P.recents.filter((r) => r.key !== p.key)].slice(0, 8);
  savePlaces();
  return p;
}
/** Update name/sub of the current place after a late reverse-geocode, without touching recents order. */
export function patchCurrent(patch) {
  if (!P.current) return;
  P.current = makePlace({ ...P.current, ...patch });
  P.recents = P.recents.map((r) => (r.key === P.current.key ? P.current : r));
  P.favorites = P.favorites.map((f) => (f.key === P.current.key ? { ...f, name: P.current.name, sub: P.current.sub } : f));
  savePlaces();
}
export function toggleFavorite(place) {
  const p = makePlace(place);
  if (isFavorite(p)) P.favorites = P.favorites.filter((f) => f.key !== p.key);
  else P.favorites = [p, ...P.favorites].slice(0, 20);
  savePlaces();
  return isFavorite(p);
}
export function removeFavorite(key) {
  P.favorites = P.favorites.filter((f) => f.key !== key);
  savePlaces();
}
export function removeRecent(key) {
  P.recents = P.recents.filter((r) => r.key !== key);
  savePlaces();
}
export function clearRecents() {
  P.recents = [];
  savePlaces();
}

/* -------------------------------------------------------------------- cache
   One entry per place: { v, t, forecast, air }. Newest 8 are kept; an entry of another shape (v) is ignored. */
const MAX_CACHE = 8;
export const CACHE_V = 1;

export function cacheGet(key) {
  const e = ls.get(K.cache + key, null);
  return e && e.v === CACHE_V && e.forecast ? e : null;
}

function evict(prefix, keepCount, exceptKey) {
  const rows = ls
    .keys(prefix)
    .filter((k) => k !== exceptKey)
    .map((k) => ({ k, t: (ls.get(k, null) || {}).t || 0 }))
    .sort((a, b) => b.t - a.t);
  rows.slice(keepCount).forEach((r) => ls.del(r.k));
}

export function cachePut(key, entry) {
  const full = K.cache + key;
  const row = { ...entry, v: CACHE_V };
  if (!ls.set(full, row)) {
    evict(K.cache, 0, full); // quota hit: drop every other place, then retry once
    return ls.set(full, row);
  }
  evict(K.cache, MAX_CACHE - 1, full);
  return true;
}

/* ------------------------------------------------------------ photo cache
   { t, url, page, title } for a place that has a usable photo, { t, none: true } when it has none (so we don't ask again). */
const MAX_PHOTOS = 24;
export const photoGet = (key) => {
  const e = ls.get(K.photo + key, null);
  return e && typeof e === 'object' && typeof e.t === 'number' ? e : null;
};
export function photoPut(key, entry) {
  const full = K.photo + key;
  if (!ls.set(full, { ...entry, t: Date.now() })) {
    evict(K.photo, 0, full);
    return;
  }
  evict(K.photo, MAX_PHOTOS - 1, full);
}

/** Remove everything this app stored (settings, places, caches, photos) and anything the previous generation (Nimbus) left. */
export function resetAll() {
  [...ls.keys(STORAGE_PREFIX), ...ls.keys(OLD_PREFIX), ...LEGACY_KEYS].forEach((k) => ls.del(k));
}
