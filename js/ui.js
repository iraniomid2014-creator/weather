/* Skyview — HTML builders for the ribbons, accordions, sheets and banners. Output is plain strings;
   every dynamic value goes through esc() and numbers/units are LTR-isolated (<span class="n">) for RTL safety. */
import { esc, isNum, clamp, APP_VERSION } from './util.js';
import { S, isFavorite } from './store.js';
import {
  t, ltr, hasLetters, joinList, num, pct, dig, getLang, fTemp, toTemp, tempUnit, fWind, fPrecip, fPressure, fVis, fTime, fHour,
  fDuration, ago, longDate, altDate, dayMonth, weekdayName, placeTitle, placeSub,
} from './i18n.js';
import { weatherMeta, summaryFacts, aqiLevel, uvLevel, windLevel, compassIndex, airSeries, hourlyRows, dailyRows, pressureTrend } from './insights.js';
import { ic, wx } from './icons.js';
import { METRICS } from './charts.js';

/** Numbers and Latin units read left-to-right even in Persian text; text with Persian words flows with the sentence. */
const n = (s) => (hasLetters(s) ? esc(s) : `<span class="n">${esc(s)}</span>`);
const timeRel = (iso, wall) => (iso.slice(0, 10) === wall.slice(0, 10) ? fTime(iso) : `${weekdayName(iso, 'short')} ${fTime(iso)}`);

/* Persistent UI choices (survive re-renders). `day` = index of the selected day in the 14-day ribbon (null = none). */
export const uiState = { metric: 'temp', hours: 24, day: null, open: new Set() };
export const ACCORDIONS = [
  ['now', 'sparkle', 'acc.now'],
  ['chart', 'gauge', 'chart.title'],
  ['details', 'eye', 'd.title'],
  ['air', 'shield', 'air.title'],
];

/* ----------------------------------------------------------------- ribbons */
const popPill = (p, min = 10) => (isNum(p) && p >= min ? `<span class="pop">${ic('drop')}${n(pct(p))}</span>` : '<span class="pop"></span>');

export function hourlyHTML(v) {
  const { ctx } = v;
  const rows = hourlyRows(ctx, 48);
  let prevDate = ctx.wall.slice(0, 10);
  const cells = rows
    .map((r, k) => {
      const first = k === 0;
      const meta = weatherMeta(first ? ctx.now.code : r.code, first ? ctx.now.isDay : r.isDay);
      const temp = first ? ctx.now.temp : r.temp;
      const date = r.time.slice(0, 10);
      const dayLabel = date !== prevDate ? weekdayName(date) : '';
      prevDate = date;
      const label = `${first ? t('hourly.now') : fHour(r.time)}: ${t(`wx.${meta.key}`)}, ${fTemp(temp)}`;
      return `<li class="hcell${first ? ' now' : ''}${dayLabel ? ' newday' : ''}" aria-label="${esc(label)}">
        <span class="h-day">${esc(dayLabel)}</span>
        <span class="h-t">${first ? esc(t('hourly.now')) : n(fHour(r.time))}</span>
        ${wx(meta.sprite)}
        <span class="h-v">${n(fTemp(temp))}</span>
        ${popPill(r.pop)}
      </li>`;
    })
    .join('');
  return `<h2 class="sect-t" id="h-hourly">${esc(t('hourly.title'))}</h2>
    <div class="panel"><ul class="ribbon" tabindex="0" aria-labelledby="h-hourly">${cells}</ul></div>`;
}

export function dailyHTML(v) {
  const { rows, lo, hi } = dailyRows(v.ctx);
  const span = hi - lo;
  const cells = rows
    .map((r, k) => {
      const meta = weatherMeta(r.shown, true);
      const a = isNum(r.min) ? ((r.min - lo) / span) * 100 : 0;
      const b = isNum(r.max) ? ((r.max - lo) / span) * 100 : 100;
      const name = k === 0 ? t('daily.today') : k === 1 ? t('daily.tomorrow') : weekdayName(r.date);
      const sel = uiState.day === k;
      const label = `${name} ${dayMonth(r.date)}: ${t(`wx.${meta.key}`)}, ${t('hero.hi')} ${fTemp(r.max)}, ${t('hero.lo')} ${fTemp(r.min)}`;
      return `<li><button type="button" class="dcell${sel ? ' sel' : ''}${k === 0 ? ' today' : ''}" data-action="pick-day" data-val="${k}" aria-expanded="${sel}" aria-controls="dday" aria-label="${esc(label)}">
        <span class="d-name">${esc(name)}</span>
        <span class="d-date">${esc(dayMonth(r.date))}</span>
        ${wx(meta.sprite)}
        <span class="d-max">${n(fTemp(r.max))}</span>
        <span class="vbar" aria-hidden="true"><i style="--a:${a.toFixed(1)}%;--b:${b.toFixed(1)}%"></i></span>
        <span class="d-min">${n(fTemp(r.min))}</span>
        ${popPill(r.pop)}
      </button></li>`;
    })
    .join('');
  return `<h2 class="sect-t" id="h-daily">${esc(t('daily.title', { d: dig(rows.length) }))}</h2>
    <div class="panel"><ul class="ribbon daily" aria-labelledby="h-daily">${cells}</ul></div>
    <div class="dday" id="dday" role="region" ${uiState.day == null ? 'hidden' : ''} aria-label="${esc(t('daily.detail', { day: uiState.day == null ? '' : dayName(rows[uiState.day]?.date, uiState.day) }))}">${uiState.day == null ? '' : dayDetailHTML(v, uiState.day)}</div>
    ${uiState.day == null ? `<p class="hint-line">${esc(t('daily.hint'))}</p>` : ''}`;
}

function dayName(date, k) {
  return k === 0 ? t('daily.today') : k === 1 ? t('daily.tomorrow') : weekdayName(date);
}

export function dayDetailHTML(v, k) {
  const { rows } = dailyRows(v.ctx);
  const r = rows[k];
  if (!r) return '';
  const meta = weatherMeta(r.shown, true);
  const alt = altDate(r.date);
  const uvTxt = isNum(r.uvMax) ? `${num(r.uvMax, 0)} (${t(`uv.${uvLevel(r.uvMax)}`)})` : '—';
  const dirTxt = isNum(r.windDir) ? t('wind.from', { dir: t(`dir.${compassIndex(r.windDir)}`) }) : '';
  const dd = (label, val) => `<div><dt>${esc(label)}</dt><dd>${val}</dd></div>`;
  return `<div class="dday-h">${wx(meta.sprite)}<div><b>${esc(longDate(r.date))}${alt ? ` (${esc(alt)})` : ''}</b><span>${esc(t(`wx.${meta.key}`))}</span></div>
      <button type="button" class="icon-btn" data-action="pick-day" data-val="${k}" aria-label="${esc(t('common.close'))}">${ic('close')}</button></div>
    <dl>
      ${dd(t('wk.feels'), `${n(fTemp(r.feelsMin))} – ${n(fTemp(r.feelsMax))}`)}
      ${dd(t('wk.pop'), isNum(r.pop) ? n(pct(r.pop)) : '—')}
      ${dd(t('wk.rain'), n(fPrecip(r.precipSum)))}
      ${dd(t('wk.rainHours'), isNum(r.precipHours) ? esc(`${num(r.precipHours, 0)} ${t('unit.h')}`) : '—')}
      ${dd(t('wk.wind'), `${n(fWind(r.wind))}${dirTxt ? ` ${esc(dirTxt)}` : ''}`)}
      ${dd(t('wk.gust'), n(fWind(r.gust)))}
      ${dd(t('wk.uv'), esc(uvTxt))}
      ${dd(t('wk.sun'), isNum(r.sunshine) ? esc(fDuration(r.sunshine)) : '—')}
    </dl>`;
}

/* -------------------------------------------------------------- accordions */
export function accordionsHTML() {
  return `<div class="accs">${ACCORDIONS.map(
    ([id, icon, key]) => `<details class="acc" data-acc="${id}"${uiState.open.has(id) ? ' open' : ''}>
      <summary><span class="acc-ic">${ic(icon)}</span><span class="acc-t">${esc(t(key))}</span><span class="acc-pv" data-pv="${id}"></span>${ic('chevDown', 'chev')}</summary>
      <div class="acc-b" data-body="${id}"></div>
    </details>`,
  ).join('')}</div>`;
}

/** Short text shown on the closed accordion row. */
export function accPreview(id, v) {
  if (id === 'now') {
    const meta = weatherMeta(v.ctx.now.code, v.ctx.now.isDay);
    return `<b>${n(fTemp(v.ctx.now.temp))}</b> ${esc(t(`wx.${meta.key}`))}`;
  }
  if (id === 'air' && v.aq) {
    const std = S.aqi;
    const val = std === 'eu' ? v.aq.eu : v.aq.us;
    if (isNum(val)) return `<i class="dot lv${Math.max(0, aqiLevel(val, std))}"></i><b>${n(num(val))}</b> ${esc(t(`aqi.${std}.${Math.max(0, aqiLevel(val, std))}`))}`;
  }
  return '';
}

export function accBodyHTML(id, v) {
  if (id === 'now') return nowBodyHTML(v);
  if (id === 'chart') return chartBodyHTML();
  if (id === 'details') return detailsHTML(v);
  if (id === 'air') return airHTML(v);
  return '';
}

/* ------------------------------------------------------------ current conditions */
function summaryText(v) {
  const { ctx } = v;
  const f = summaryFacts(ctx);
  const cond = t(`wx.${weatherMeta(f.code, ctx.now.isDay).key}`);
  const out = [];
  if (isNum(f.hi) && isNum(f.lo)) out.push(t('sum.range', { cond, hi: ltr(fTemp(f.hi)), lo: ltr(fTemp(f.lo)) }));
  else out.push(`${cond}.`);
  const e = f.event;
  if (e.type === 'nowRain') {
    out.push(t('sum.nowRain'));
    if (e.endAt) out.push(t('sum.endingRainAt', { time: ltr(timeRel(e.endAt, ctx.wall)) }));
  } else if (e.type === 'laterRain') out.push(t('sum.laterRain', { time: ltr(timeRel(e.at, ctx.wall)) }));
  else out.push(t('sum.dry'));
  if (f.gust != null && f.gust >= 50) out.push(t('sum.gust', { v: ltr(fWind(f.gust)) }));
  return out.join(' ');
}

export function nowBodyHTML(v) {
  const { ctx } = v;
  const { now, day } = ctx;
  const meta = weatherMeta(now.code, now.isDay);
  const alt = altDate(ctx.wall);
  return `<div class="now-top"><span>${esc(longDate(ctx.wall))}${alt ? ` (${esc(alt)})` : ''}</span><span>${esc(t('hero.localTime'))} ${n(fTime(ctx.wall))}</span></div>
    <div class="now-main">
      ${wx(meta.sprite, 'now-ic')}
      <div class="now-temp" aria-label="${esc(fTemp(now.temp, { unit: true }))}"><span class="n">${esc(num(toTemp(now.temp)))}</span><span class="unit n">${esc(tempUnit())}</span></div>
    </div>
    <div class="now-cond">${esc(t(`wx.${meta.key}`))}</div>
    <div class="now-sub">
      <span>${esc(t('hero.feels'))} <b>${n(fTemp(now.feels))}</b></span>
      <span>${esc(t('hero.hi'))} <b>${n(fTemp(day.max))}</b></span>
      <span>${esc(t('hero.lo'))} <b>${n(fTemp(day.min))}</b></span>
    </div>
    <p class="now-sum">${esc(summaryText(v))}</p>`;
}

export function agoLine(v) {
  return t(v.offline ? 'st.cached' : 'st.updated', { ago: ago(Date.now() - v.fetchedAt) });
}

/* ------------------------------------------------------------------ chart */
export function chartBodyHTML() {
  const seg = [24, 48, 72]
    .map((h) => `<button type="button" role="radio" aria-checked="${uiState.hours === h}" data-action="chart-hours" data-val="${h}">${esc(t('chart.hoursN', { h: dig(h) }))}</button>`)
    .join('');
  const chips = METRICS.map((m) => `<button type="button" class="chip" role="radio" aria-checked="${uiState.metric === m}" data-action="chart-metric" data-val="${m}">${esc(t(`m.${m}`))}</button>`).join('');
  return `<div class="acc-tools"><div class="seg sm" role="radiogroup" aria-label="${esc(t('chart.range'))}">${seg}</div></div>
    <div class="chips" role="radiogroup" aria-label="${esc(t('chart.metric'))}">${chips}</div>
    <div class="chart-host"><div class="chart-wrap"></div><div class="legend"></div></div>`;
}

/* ---------------------------------------------------------------- details */
function visWord(m) {
  if (!isNum(m)) return '';
  return t(m >= 10000 ? 'vis.good' : m >= 4000 ? 'vis.moderate' : m >= 1000 ? 'vis.poor' : 'vis.veryPoor');
}
function cloudWord(c) {
  if (!isNum(c)) return '';
  return t(c < 20 ? 'cloud.clear' : c < 60 ? 'cloud.few' : c < 90 ? 'cloud.mostly' : 'cloud.full');
}

export function detailsHTML(v) {
  const { ctx } = v;
  const { now, day } = ctx;
  const tile = (icon, label, value, sub = '', extra = '') =>
    `<div class="tile"><div class="tile-h">${ic(icon)}<span>${esc(label)}</span></div><div class="tile-v">${value}</div>${extra}${sub ? `<div class="tile-s">${sub}</div>` : ''}</div>`;
  const trend = pressureTrend(ctx);
  const wl = windLevel(now.wind);
  const dir = isNum(now.windDir) ? t('wind.from', { dir: t(`dir.${compassIndex(now.windDir)}`) }) : '';
  const arrow = isNum(now.windDir) ? `<span class="wind-arrow" style="--r:${Math.round(now.windDir + 180)}deg">${ic('arrowUp')}</span>` : '';
  const uv = now.uv;
  const uvX = isNum(uv) ? Math.round(clamp(uv / 11, 0, 1) * 100) : 0;
  const diff = isNum(now.feels) && isNum(now.temp) ? toTemp(now.feels) - toTemp(now.temp) : null;
  const feelsSub = diff == null ? '' : Math.abs(diff) < 1 ? t('d.feelsSame') : t(diff > 0 ? 'd.feelsWarmer' : 'd.feelsCooler', { v: ltr(num(Math.abs(diff), 0) + '°') });
  return `<div class="tiles">
      ${tile('thermo', t('d.feels'), n(fTemp(now.feels)), esc(feelsSub))}
      ${tile('drop', t('d.humidity'), n(pct(now.humidity)), esc(t('d.dew', { v: ltr(fTemp(now.dew)) })))}
      ${tile('wind', t('d.wind'), `${n(fWind(now.wind))}${arrow}`, esc(joinList([dir, wl >= 0 ? t(`wind.l${wl}`) : '', isNum(now.gust) ? t('d.gust', { v: ltr(fWind(now.gust)) }) : ''])))}
      ${tile('gauge', t('d.pressure'), n(fPressure(now.pressure)), esc(trend ? t(`trend.${trend}`) : ''))}
      ${tile('eye', t('d.visibility'), n(fVis(now.vis)), esc(visWord(now.vis)))}
      ${tile('uv', t('d.uv'), isNum(uv) ? n(num(uv, uv < 10 ? 1 : 0)) : '—', esc(isNum(uv) ? t(`uv.${uvLevel(uv)}`) : ''), isNum(uv) ? `<div class="uvbar" aria-hidden="true"><i style="--x:${uvX}%"></i></div>` : '')}
      ${tile('cloud', t('d.clouds'), n(pct(now.cloud)), esc(cloudWord(now.cloud)))}
      ${tile('umbrella', t('d.rainToday'), n(fPrecip(day.precipSum)), esc(joinList([isNum(day.precipHours) ? t('d.rainHours', { h: ltr(dig(Math.round(day.precipHours))) }) : '', isNum(day.popMax) ? t('d.popMax', { p: ltr(pct(day.popMax)) }) : ''])))}
    </div>`;
}

/* -------------------------------------------------------------------- air */
const US_B = [0, 50, 100, 150, 200, 300, 500];
const EU_B = [0, 20, 40, 60, 80, 100, 150];
function scalePos(value, std) {
  const b = std === 'eu' ? EU_B : US_B;
  const lvl = aqiLevel(value, std);
  const lo = b[lvl];
  const hi = b[lvl + 1];
  return clamp(((lvl + clamp((value - lo) / (hi - lo), 0, 1)) / 6) * 100, 0, 100);
}

export function airHTML(v) {
  const std = S.aqi;
  const seg = ['us', 'eu']
    .map((k) => `<button type="button" role="radio" aria-checked="${std === k}" data-action="set" data-key="aqi" data-val="${k}">${esc(t(`air.${k}`))}</button>`)
    .join('');
  const tools = `<div class="acc-tools"><div class="seg sm" role="radiogroup" aria-label="${esc(t('air.std'))}">${seg}</div></div>`;
  const aq = v.aq;
  const value = aq ? (std === 'eu' ? aq.eu : aq.us) : null;
  if (!aq || !isNum(value)) {
    if (v.airLoading) return `${tools}<div class="skel h2" aria-busy="true" aria-label="${esc(t('air.loading'))}"></div>`;
    if (v.airErr) {
      return `${tools}<p class="empty">${ic('wifiOff')}${esc(t('air.error'))}</p>
        <button type="button" class="btn ghost sm" data-action="reload-air">${ic('refresh')}<span>${esc(t('st.retry'))}</span></button>`;
    }
    return `${tools}<p class="empty">${ic('info')}${esc(t('air.unavailable'))}</p>`;
  }
  const lvl = aqiLevel(value, std);
  const series = airSeries(v.air, v.ctx.wall, std, 24);
  const top = std === 'eu' ? 120 : 250;
  const strip = series.length > 3
    ? `<div class="air-fc" role="img" aria-label="${esc(t('air.fcLabel'))}">${series.map((p) => `<i class="lv${Math.max(0, aqiLevel(p.v, std))}" style="--h:${Math.round(clamp((p.v ?? 0) / top, 0.06, 1) * 100)}%"></i>`).join('')}</div>
       <div class="air-fc-l" aria-hidden="true"><span>${esc(t('hourly.now'))}</span><span>${esc(t('air.fcEnd', { h: dig(series.length) }))}</span></div>`
    : '';
  const pol = (label, val) => `<div><dt>${label}</dt><dd>${isNum(val) ? n(`${num(val, val < 10 ? 1 : 0)} µg/m³`) : '—'}</dd></div>`;
  return `${tools}
    <div class="air-main">
      <div class="aqi-badge lv${lvl}"><span class="aqi-v">${n(num(value))}</span><span class="aqi-u">${esc(std === 'eu' ? 'EAQI' : 'US AQI')}</span></div>
      <div class="aqi-txt"><b>${esc(t(`aqi.${std}.${lvl}`))}</b><p>${esc(t(`aqi.adv.${lvl}`))}</p></div>
    </div>
    <div class="scale" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((k) => `<i class="lv${k}"></i>`).join('')}<i class="mark" style="--x:${scalePos(value, std).toFixed(1)}%"></i></div>
    ${strip}
    <dl class="poll">${pol('PM2.5', aq.pm25)}${pol('PM10', aq.pm10)}${pol('O₃', aq.o3)}${pol('NO₂', aq.no2)}${pol('SO₂', aq.so2)}${pol('CO', aq.co)}</dl>
    <p class="note">${esc(t('air.note'))}</p>`;
}

/* ---------------------------------------------------- skeleton / error / foot */
export const skeletonHTML = () =>
  `<div aria-busy="true"><div class="skel sk-title"></div><div class="skel sk-hourly"></div><div class="skel sk-title"></div><div class="skel sk-daily"></div></div>`;

export function errorHTML(err) {
  const key = err?.kind === 'rate' ? 'err.rate' : err?.kind === 'timeout' ? 'err.timeout' : err?.kind === 'bad' ? 'err.bad' : 'err.network';
  return `<div class="card err-box" role="alert">${ic('wifiOff')}<h2>${esc(t('err.title'))}</h2><p>${esc(t(key))}</p>
    ${err?.kind === 'bad' && err.message ? `<p class="muted n" style="direction:ltr">${esc(err.message)}</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button type="button" class="btn" data-action="refresh">${ic('refresh')}<span>${esc(t('st.retry'))}</span></button>
    <button type="button" class="btn ghost" data-action="open-places">${ic('search')}<span>${esc(t('pl.change'))}</span></button></div></div>`;
}

/** `stable` leaves the live "updated … ago" text empty: app.js uses it as the re-render signature and patches the text in place. */
export function footHTML(v, photo, stable = false) {
  const link = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  const parts = [];
  if (v) parts.push(`<span class="fi js-ago">${stable ? '' : esc(agoLine(v))}</span>`);
  parts.push(`<span class="fi">${esc(t('foot.data'))} ${link('https://open-meteo.com/', 'Open-Meteo.com')} <bdi>(CC BY 4.0)</bdi></span>`);
  if (photo) {
    const label = getLang() === 'fa' ? 'ویکی‌پدیا' : 'Wikipedia';
    parts.push(`<span class="fi">${esc(t('foot.photo'))} ${photo.page ? link(esc(photo.page), esc(label)) : esc(label)}</span>`);
  }
  return parts.join('');
}

/* ----------------------------------------------------------------- banners */
export function bannersHTML(list) {
  return list
    .map(
      (b) => `<div class="banner ${b.kind || ''}" role="${b.kind === 'info' ? 'status' : 'alert'}" data-banner="${esc(b.id)}">${ic(b.icon || 'info')}<p>${esc(b.text)}</p>${b.action ? `<button type="button" class="btn" data-action="${esc(b.action)}">${esc(b.actionLabel)}</button>` : ''}</div>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ places */
export function placeItemHTML(p, { kind, i }) {
  const fav = isFavorite(p);
  const role = kind === 'result' ? ' role="option" aria-selected="false"' : '';
  return `<li class="pitem" id="pi-${kind}-${i}"${role}>
      <button type="button" class="pitem-main" data-action="pick-place" data-kind="${kind}" data-i="${i}"><b>${esc(placeTitle(p))}</b><small>${esc(placeSub(p) || `${num(p.lat, 2)}, ${num(p.lon, 2)}`)}</small></button>
      <button type="button" class="icon-btn" data-action="toggle-fav" data-kind="${kind}" data-i="${i}" aria-pressed="${fav}" aria-label="${esc(t(fav ? 'pl.removeFav' : 'pl.addFav'))}">${ic('star')}</button>
      ${kind === 'recent' ? `<button type="button" class="icon-btn" data-action="remove-recent" data-i="${i}" aria-label="${esc(t('pl.removeRecent'))}">${ic('close')}</button>` : ''}
    </li>`;
}

/* ---------------------------------------------------------------- settings */
const seg = (key, opts, labelFn = (x) => x) =>
  `<div class="seg" role="radiogroup" aria-label="${esc(t(`set.${key}`))}">${opts
    .map(([val, label, raw]) => `<button type="button" role="radio" aria-checked="${S[key] === val}" data-action="set" data-key="${key}" data-val="${val}">${raw ? esc(label) : esc(labelFn(label))}</button>`)
    .join('')}</div>`;

export function settingsHTML({ canInstall, isIOS, standalone }) {
  const row = (label, control, sub = '') => `<div class="set-row"><span class="lbl">${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span>${control}</div>`;
  const fa = getLang() === 'fa';
  return `<section class="set-group"><h3>${esc(t('set.appearance'))}</h3>
      ${row(t('set.lang'), seg('lang', [['fa', 'فارسی', 1], ['en', 'English', 1]]))}
      ${row(t('set.theme'), seg('theme', [['auto', 'set.themeAuto'], ['dark', 'set.themeDark'], ['light', 'set.themeLight']], t))}
      ${fa ? row(t('set.digits'), seg('digits', [['fa', '۱۲۳', 1], ['latn', '123', 1]])) : ''}
      ${row(t('set.photo'), seg('photo', [['on', 'set.fxOn'], ['off', 'set.fxOff']], t), t('set.photoSub'))}
      ${row(t('set.effects'), seg('effects', [['auto', 'set.fxAuto'], ['on', 'set.fxOn'], ['off', 'set.fxOff']], t), t('set.effectsSub'))}
    </section>
    <section class="set-group"><h3>${esc(t('set.units2'))}</h3>
      ${row(t('set.temp'), seg('temp', [['c', '°C', 1], ['f', '°F', 1]]))}
      ${row(t('set.wind'), seg('wind', [['kmh', 'km/h', 1], ['ms', 'm/s', 1], ['mph', 'mph', 1], ['kn', 'kn', 1]]))}
      ${row(t('set.precip'), seg('precip', [['mm', 'mm', 1], ['in', 'in', 1]]))}
      ${row(t('set.pressure'), seg('pressure', [['hpa', 'hPa', 1], ['mmhg', 'mmHg', 1], ['inhg', 'inHg', 1]]))}
      ${row(t('set.vis'), seg('vis', [['km', 'km', 1], ['mi', 'mi', 1]]))}
      ${row(t('set.hour12'), `<div class="seg" role="radiogroup" aria-label="${esc(t('set.hour12'))}">${[[false, '24h'], [true, '12h']].map(([val, label]) => `<button type="button" role="radio" aria-checked="${S.hour12 === val}" data-action="set" data-key="hour12" data-val="${val}">${label}</button>`).join('')}</div>`)}
      ${row(t('set.aqi'), seg('aqi', [['us', 'US AQI', 1], ['eu', 'EU AQI', 1]]))}
    </section>
    <section class="set-group"><h3>${esc(t('set.app'))}</h3>
      ${canInstall && !standalone ? row(t('set.install'), `<button type="button" class="btn" data-action="install">${ic('download')}<span>${esc(t('set.installBtn'))}</span></button>`) : ''}
      ${isIOS && !standalone ? `<p class="note" style="margin:0 0 6px">${esc(t('set.installIOS'))}</p>` : ''}
      ${row(t('set.reset'), `<button type="button" class="btn danger" data-action="reset-all">${ic('trash')}<span>${esc(t('set.resetBtn'))}</span></button>`, t('set.resetSub'))}
    </section>
    <section class="set-group"><h3>${esc(t('set.about'))}</h3>
      <div class="credits">
        <p>${esc(t('about.text'))}</p>
        <p>${esc(t('credit.weather'))}: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> — CC BY 4.0</p>
        <p>${esc(t('credit.photo'))}: <a href="https://www.wikipedia.org/" target="_blank" rel="noopener noreferrer">Wikipedia</a> / Wikimedia Commons</p>
        <p>${esc(t('credit.geocode'))}: Open-Meteo Geocoding · Nominatim (OSM)</p>
        <p>${esc(t('credit.font'))}: <a href="https://github.com/rastikerdar/vazirmatn" target="_blank" rel="noopener noreferrer">Vazirmatn</a> (OFL)</p>
        <p class="muted">${esc(t('about.version'))} <span class="n">${esc(APP_VERSION)}</span></p>
      </div>
    </section>`;
}

/* ------------------------------------------------------------------- toast */
export function toast(text, { action, onAction, ms = 4200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const close = () => el.remove();
  if (action) el.querySelector('button').addEventListener('click', () => { close(); onAction?.(); });
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, ms);
}
