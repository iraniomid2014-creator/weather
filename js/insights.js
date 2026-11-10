/* Skyview — pure weather logic. No DOM and no translated text: everything returns keys and numbers,
   ui.js turns them into sentences. All times are location wall-clock ISO strings ("YYYY-MM-DDTHH:MM"). */
import { isNum, lastIndexAtOrBefore, minutesBetween, compassIndex } from './util.js';

/* ------------------------------------------------------------- WMO weather codes */
// code → [text key, icon, group]
const WX = {
  0: ['clear', 'clear', 'clear'],
  1: ['mainlyClear', 'clear', 'clear'],
  2: ['partly', 'partly', 'cloudy'],
  3: ['overcast', 'overcast', 'cloudy'],
  45: ['fog', 'fog', 'fog'],
  48: ['rime', 'fog', 'fog'],
  51: ['drizzleL', 'drizzle', 'rain'],
  53: ['drizzleM', 'drizzle', 'rain'],
  55: ['drizzleH', 'drizzle', 'rain'],
  56: ['fzDrizzleL', 'sleet', 'rain'],
  57: ['fzDrizzleH', 'sleet', 'rain'],
  61: ['rainL', 'rain', 'rain'],
  63: ['rainM', 'rain', 'rain'],
  65: ['rainH', 'rainHeavy', 'rain'],
  66: ['fzRainL', 'sleet', 'rain'],
  67: ['fzRainH', 'sleet', 'rain'],
  71: ['snowL', 'snow', 'snow'],
  73: ['snowM', 'snow', 'snow'],
  75: ['snowH', 'snowHeavy', 'snow'],
  77: ['snowGrains', 'snow', 'snow'],
  80: ['showersL', 'showers', 'rain'],
  81: ['showersM', 'showers', 'rain'],
  82: ['showersH', 'rainHeavy', 'rain'],
  85: ['snowShowersL', 'snow', 'snow'],
  86: ['snowShowersH', 'snowHeavy', 'snow'],
  95: ['thunder', 'thunder', 'storm'],
  96: ['thunderHail', 'thunder', 'storm'],
  99: ['thunderHailH', 'thunder', 'storm'],
};
const DAYNIGHT_ICONS = new Set(['clear', 'partly', 'showers']);

export function weatherMeta(code, isDay = true) {
  const [key, icon, group] = WX[code] || ['unknown', 'overcast', 'cloudy'];
  const sprite = `wx-${icon}${DAYNIGHT_ICONS.has(icon) ? (isDay ? '-day' : '-night') : ''}`;
  return { code, key, icon, group, sprite, isDay: !!isDay };
}

export function skyClass(code, isDay) {
  const { group } = weatherMeta(code, isDay);
  if (group === 'storm') return 'sky-storm';
  if (group === 'rain') return 'sky-rain';
  if (group === 'snow') return 'sky-snow';
  if (group === 'fog') return 'sky-fog';
  if (group === 'cloudy') return isDay ? 'sky-cloudy-day' : 'sky-cloudy-night';
  return isDay ? 'sky-clear-day' : 'sky-clear-night';
}

/** Particle effect for the background canvas (null = none). */
export function fxFor(code) {
  const { group } = weatherMeta(code);
  if (group === 'rain' || group === 'storm') {
    const heavy = [65, 67, 82, 95, 96, 99].includes(code);
    const light = [51, 56, 61, 66, 80].includes(code);
    return { type: 'rain', density: heavy ? 1 : light ? 0.35 : 0.6, lightning: group === 'storm' };
  }
  if (group === 'snow') {
    return { type: 'snow', density: [75, 86].includes(code) ? 1 : [71, 77, 85].includes(code) ? 0.4 : 0.65, lightning: false };
  }
  return null;
}

/* ----------------------------------------------------------------- context */
/**
 * Everything the UI needs about "now" for one place. `i` is the hourly index of the current hour,
 * `di` the daily index of today — both found by comparing wall-clock strings, so they stay right even for
 * cached data and for locations in other time zones.
 */
export function buildContext(data, air, wall) {
  const H = data.hourly;
  const D = data.daily;
  const last = H.time.length - 1;
  let i = lastIndexAtOrBefore(H.time, wall);
  const stale = i < 0 || (i === last && minutesBetween(H.time[last], wall) >= 60);
  if (i < 0) i = 0;
  const today = wall.slice(0, 10);
  let di = D.time.indexOf(today);
  if (di < 0) di = Math.max(0, lastIndexAtOrBefore(D.time, today));

  const hv = (k) => (H[k] ? H[k][i] : null);
  const dv = (k) => (D[k] ? D[k][di] : null);
  const cur = data.current;
  const age = cur && cur.time ? minutesBetween(cur.time, wall) : Infinity;
  const useCur = age >= -20 && age <= 90;
  const pick = (ck, hk) => (useCur && cur[ck] != null ? cur[ck] : hv(hk));

  const day = {
    date: D.time[di],
    code: dv('weather_code'),
    max: dv('temperature_2m_max'),
    min: dv('temperature_2m_min'),
    feelsMax: dv('apparent_temperature_max'),
    feelsMin: dv('apparent_temperature_min'),
    sunrise: dv('sunrise') || null,
    sunset: dv('sunset') || null,
    daylight: dv('daylight_duration'),
    sunshine: dv('sunshine_duration'),
    uvMax: dv('uv_index_max'),
    precipSum: dv('precipitation_sum'),
    precipHours: dv('precipitation_hours'),
    popMax: dv('precipitation_probability_max'),
    windMax: dv('wind_speed_10m_max'),
    gustMax: dv('wind_gusts_10m_max'),
    windDir: dv('wind_direction_10m_dominant'),
  };

  let isDay = pick('is_day', 'is_day');
  if (isDay == null) isDay = day.sunrise && day.sunset ? (wall >= day.sunrise && wall < day.sunset ? 1 : 0) : 1;

  const now = {
    temp: pick('temperature_2m', 'temperature_2m'),
    feels: pick('apparent_temperature', 'apparent_temperature'),
    humidity: pick('relative_humidity_2m', 'relative_humidity_2m'),
    code: pick('weather_code', 'weather_code'),
    isDay: isDay === 1 || isDay === true,
    cloud: pick('cloud_cover', 'cloud_cover'),
    pressure: pick('pressure_msl', 'pressure_msl'),
    wind: pick('wind_speed_10m', 'wind_speed_10m'),
    windDir: pick('wind_direction_10m', 'wind_direction_10m'),
    gust: pick('wind_gusts_10m', 'wind_gusts_10m'),
    uv: hv('uv_index'),
    vis: hv('visibility'),
    dew: hv('dew_point_2m'),
  };
  if (!isNum(now.code)) now.code = isNum(day.code) ? day.code : 3;

  return { data, air, wall, i, di, stale, now, day, H, D };
}

/** Hourly slice starting at the current hour. */
export function hourlyRows(ctx, count = 48) {
  const { H, i } = ctx;
  const rows = [];
  for (let k = i; k < Math.min(H.time.length, i + count); k++) {
    rows.push({
      k,
      time: H.time[k],
      code: H.weather_code?.[k],
      isDay: H.is_day?.[k] !== 0,
      temp: H.temperature_2m?.[k],
      pop: H.precipitation_probability?.[k],
      precip: H.precipitation?.[k],
      wind: H.wind_speed_10m?.[k],
    });
  }
  return rows;
}

/** Daily rows from today on, plus the temperature span used to scale the range bars. */
export function dailyRows(ctx) {
  const { D, di } = ctx;
  const rows = [];
  for (let d = di; d < D.time.length; d++) {
    const g = (k) => (D[k] ? D[k][d] : null);
    rows.push({
      d,
      date: D.time[d],
      code: g('weather_code'),
      max: g('temperature_2m_max'),
      min: g('temperature_2m_min'),
      feelsMax: g('apparent_temperature_max'),
      feelsMin: g('apparent_temperature_min'),
      sunrise: g('sunrise') || null,
      sunset: g('sunset') || null,
      daylight: g('daylight_duration'),
      sunshine: g('sunshine_duration'),
      uvMax: g('uv_index_max'),
      precipSum: g('precipitation_sum'),
      precipHours: g('precipitation_hours'),
      pop: g('precipitation_probability_max'),
      wind: g('wind_speed_10m_max'),
      gust: g('wind_gusts_10m_max'),
      windDir: g('wind_direction_10m_dominant'),
    });
  }
  for (const r of rows) r.shown = dayCode(r);
  const mins = rows.map((r) => r.min).filter(isNum);
  const maxs = rows.map((r) => r.max).filter(isNum);
  const lo = mins.length ? Math.min(...mins) : 0;
  const hi = maxs.length ? Math.max(...maxs) : 1;
  return { rows, lo, hi: hi > lo ? hi : lo + 1 };
}

/* --------------------------------------------------------- daily weather code
   Open-Meteo's daily weather_code is the *most severe* code of any hour of the day, so one overcast hour (code 3) turns a
   mostly sunny day into "cloudy", and one drizzle hour into "rain". We keep the given code only when the numbers back it up
   (thunder; rain/snow with real precipitation) and otherwise describe the day by how much of the daylight the sun was out. */
const WET_MM = 0.3;
export function dayCode(r) {
  const c = r.code;
  if (!isNum(c)) return 3;
  const group = (WX[c] || [])[2];
  if (c >= 95) return c; // thunderstorms are never an artefact of one hour
  const sun = isNum(r.sunshine) && isNum(r.daylight) && r.daylight > 0 ? Math.min(1, r.sunshine / r.daylight) : null;
  if (group === 'rain' || group === 'snow') {
    const mm = isNum(r.precipSum) ? r.precipSum : null;
    const pop = isNum(r.pop) ? r.pop : null;
    const wet = mm == null ? pop != null && pop >= 40 : mm >= WET_MM || (mm >= 0.1 && pop != null && pop >= 50);
    if (wet) return c;
    if (sun == null) return 3; // a "rain" code without rain behind it: cloudy is the honest fallback
  } else if (group === 'fog') {
    if (sun == null || sun < 0.35) return c; // fog that lasts the day; morning fog that burns off falls through
  } else if (sun == null) {
    return c;
  }
  return sun >= 0.7 ? 0 : sun >= 0.45 ? 1 : sun >= 0.2 ? 2 : 3;
}

/** Rain outlook for the next 12 h, for the summary sentence. { type: nowRain|laterRain|dry, at?, endAt?, pop? } */
export function rainOutlook(ctx) {
  const { H, i, now } = ctx;
  const end = Math.min(H.time.length - 1, i + 12);
  const wetAt = (k) => {
    const pr = H.precipitation?.[k];
    const pop = H.precipitation_probability?.[k];
    return isNum(pr) && pr >= 0.3 && (pop == null || pop >= 40);
  };
  const g = weatherMeta(now.code).group;
  if (g === 'rain' || g === 'storm') {
    let endAt = null;
    for (let k = i + 1; k <= end; k++) {
      const pr = H.precipitation?.[k];
      if (isNum(pr) && pr < 0.2) {
        endAt = H.time[k];
        break;
      }
    }
    return { type: 'nowRain', endAt };
  }
  for (let k = i + 1; k <= end; k++) {
    if (wetAt(k)) {
      const pop = H.precipitation_probability?.[k];
      return { type: 'laterRain', at: H.time[k], pop: isNum(pop) ? pop : null };
    }
  }
  return { type: 'dry' };
}

/* ------------------------------------------------------------------ levels */
const AQI_BREAKS = { us: [50, 100, 150, 200, 300], eu: [20, 40, 60, 80, 100] };
/** AQI → category index 0..5 (−1 when unknown). */
export function aqiLevel(value, std = 'us') {
  if (!isNum(value)) return -1;
  const b = AQI_BREAKS[std] || AQI_BREAKS.us;
  let idx = 0;
  while (idx < b.length && value > b[idx]) idx++;
  return idx;
}
/** UV index → 0 low … 4 extreme. */
export const uvLevel = (v) => (!isNum(v) ? -1 : v < 3 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 11 ? 3 : 4);
/** Wind km/h → 0 calm … 5 storm. */
export const windLevel = (kmh) => (!isNum(kmh) ? -1 : kmh < 2 ? 0 : kmh < 20 ? 1 : kmh < 39 ? 2 : kmh < 62 ? 3 : kmh < 89 ? 4 : 5);
export { compassIndex };

/** Current air-quality sample (null when the series is missing or older than 3 h). */
export function airNow(air, wall) {
  const A = air?.hourly;
  if (!A || !Array.isArray(A.time)) return null;
  const j = lastIndexAtOrBefore(A.time, wall);
  if (j < 0 || minutesBetween(A.time[j], wall) > 180) return null;
  const g = (k) => (A[k] && isNum(A[k][j]) ? A[k][j] : null);
  const r = {
    j,
    time: A.time[j],
    us: g('us_aqi'),
    eu: g('european_aqi'),
    pm25: g('pm2_5'),
    pm10: g('pm10'),
    o3: g('ozone'),
    no2: g('nitrogen_dioxide'),
    so2: g('sulphur_dioxide'),
    co: g('carbon_monoxide'),
  };
  return r.us == null && r.eu == null ? null : r;
}

/** AQI values for the next `hours` hours, for the small forecast strip. */
export function airSeries(air, wall, std = 'us', hours = 24) {
  const A = air?.hourly;
  if (!A) return [];
  const key = std === 'eu' ? 'european_aqi' : 'us_aqi';
  const j0 = lastIndexAtOrBefore(A.time, wall);
  if (j0 < 0 || !A[key]) return [];
  const out = [];
  for (let j = j0; j < Math.min(A.time.length, j0 + hours); j++) out.push({ time: A.time[j], v: isNum(A[key][j]) ? A[key][j] : null });
  return out;
}

/* ----------------------------------------------------------------- summary */
/** Facts for the one-line summary under the current temperature. */
export function summaryFacts(ctx) {
  const { now, day } = ctx;
  return { code: now.code, hi: day.max, lo: day.min, event: rainOutlook(ctx), gust: isNum(day.gustMax) ? day.gustMax : null };
}

/** Pressure tendency over the next 3 h (forecast, not observation): rising | falling | steady. */
export function pressureTrend(ctx) {
  const { H, i } = ctx;
  const a = H.pressure_msl?.[i];
  const b = H.pressure_msl?.[Math.min(H.time.length - 1, i + 3)];
  if (!isNum(a) || !isNum(b)) return null;
  const d = b - a;
  return d >= 1 ? 'rising' : d <= -1 ? 'falling' : 'steady';
}
