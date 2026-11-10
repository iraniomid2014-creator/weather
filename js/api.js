/* Skyview — network layer (Open-Meteo, Nominatim, Wikipedia). Every call is abortable and time-limited. */
import { pkey } from './store.js';

const URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const URL_AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const URL_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const URL_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

export class ApiError extends Error {
  /** kind: network | timeout | abort | rate | bad | server | http | data */
  constructor(kind, message, status = 0) {
    super(message || kind);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export async function getJson(url, { signal, timeout = 12000, retries = 1 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new ApiError('abort');
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeout);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        let reason = '';
        try {
          reason = (await res.json())?.reason || '';
        } catch {
          /* body is not JSON */
        }
        const kind = res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : res.status === 400 ? 'bad' : 'http';
        throw new ApiError(kind, reason || `HTTP ${res.status}`, res.status);
      }
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw new ApiError('abort');
      if (err instanceof ApiError) last = err;
      else if (timedOut) last = new ApiError('timeout', 'Request timed out');
      else last = new ApiError('network', err?.message || 'Network error');
      const retryable = last.kind === 'network' || last.kind === 'timeout' || last.kind === 'server';
      if (!retryable || attempt === retries) throw last;
      await new Promise((r) => setTimeout(r, 700));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw last;
}

/* ----------------------------------------------------------------- forecast */
const CURRENT = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'is_day',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
];
const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'is_day',
];
const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'daylight_duration',
  'sunshine_duration',
  'uv_index_max',
  'precipitation_sum',
  'precipitation_hours',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
];

/**
 * Forecast for one place: 14 days, 72 hours. Times come back as the location's local wall-clock (timezone=auto).
 * `sunshine_duration` is what lets the UI tell a sunny day from a cloudy one (see insights.dayCode). If the server ever
 * rejects that variable (HTTP 400), the request is repeated once without it, so the forecast never fails because of it.
 */
export async function getForecast(place, { days = 14, signal } = {}) {
  const build = (daily) =>
    new URLSearchParams({
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      current: CURRENT.join(','),
      hourly: HOURLY.join(','),
      daily: daily.join(','),
      timezone: 'auto',
      forecast_days: String(days),
      forecast_hours: '72',
    });
  let j;
  try {
    j = await getJson(`${URL_FORECAST}?${build(DAILY)}`, { signal });
  } catch (err) {
    if (err.kind !== 'bad') throw err;
    j = await getJson(`${URL_FORECAST}?${build(DAILY.filter((k) => k !== 'sunshine_duration'))}`, { signal });
  }
  if (!j || !j.hourly || !Array.isArray(j.hourly.time) || !j.daily || !Array.isArray(j.daily.time)) {
    throw new ApiError('data', 'Unexpected forecast response');
  }
  return {
    fetchedAt: Date.now(),
    days,
    lat: j.latitude,
    lon: j.longitude,
    elevation: j.elevation,
    tz: j.timezone || place.tz || null,
    utcOffset: j.utc_offset_seconds,
    current: j.current || null,
    hourly: j.hourly,
    daily: j.daily,
  };
}

/* ------------------------------------------------------------------ air quality */
export async function getAir(place, { signal } = {}) {
  const q = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    hourly: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide',
    timezone: 'auto',
    forecast_days: '2',
  });
  const j = await getJson(`${URL_AIR}?${q}`, { signal });
  if (!j || !j.hourly || !Array.isArray(j.hourly.time)) throw new ApiError('data', 'Unexpected air-quality response');
  return { fetchedAt: Date.now(), tz: j.timezone || null, hourly: j.hourly };
}

/* ------------------------------------------------------------------ geocoding */
/** City search. Open-Meteo needs >= 2 characters ("2 characters match exactly, 3+ fuzzy"). */
export async function searchPlaces(query, lang, { signal } = {}) {
  const q = new URLSearchParams({ name: query, count: '8', language: lang, format: 'json' });
  const j = await getJson(`${URL_GEOCODE}?${q}`, { signal, retries: 0, timeout: 9000 });
  const sep = lang === 'fa' ? '، ' : ', ';
  return (j?.results || []).map((r) => ({
    key: pkey(r.latitude, r.longitude),
    name: { [lang]: r.name },
    sub: { [lang]: [r.admin1, r.country].filter(Boolean).join(sep) },
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone || null,
  }));
}

/** Name for a coordinate (Nominatim). Returns null when nothing usable comes back. */
export async function reversePlace(lat, lon, lang, { signal } = {}) {
  const q = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(2), // ~1 km: more precision would only reveal the exact position and buys nothing at zoom 10 (city level)
    lon: lon.toFixed(2),
    zoom: '10',
    addressdetails: '1',
    'accept-language': lang === 'fa' ? 'fa,en' : 'en',
  });
  const j = await getJson(`${URL_REVERSE}?${q}`, { signal, retries: 0, timeout: 8000 });
  const a = j?.address || {};
  const name = a.city || a.town || a.village || a.municipality || a.county || a.suburb || a.state || j?.name;
  if (!name) return null;
  const sep = lang === 'fa' ? '، ' : ', ';
  const subParts = [a.state && a.state !== name ? a.state : '', a.country].filter(Boolean);
  return { name: { [lang]: name }, sub: { [lang]: subParts.join(sep) } };
}
