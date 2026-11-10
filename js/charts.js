/* Skyview — hourly SVG chart with pointer / touch / keyboard scrubbing.
   The time axis is mirrored in RTL (Persian reads right → left, so "now" sits on the right). */
import { isNum, clamp, esc } from './util.js';
import {
  isRTL, t, num, pct, dig, fTemp, toTemp, fWind, toWind, windUnit, fPrecip, toPrecip, precipUnit,
  fPressure, toPressure, pressureUnit, tempUnit, fTime, fHour, weekdayName,
} from './i18n.js';
import { uvLevel, compassIndex, weatherMeta } from './insights.js';

export const METRICS = ['temp', 'precip', 'wind', 'humidity', 'uv', 'pressure'];

const PAD_S = 42; // room for y labels on the start side
const PAD_E = 12;
const PAD_T = 22;
const HEIGHT = 220;
const r2 = (n) => Math.round(n * 100) / 100;

/* ----------------------------------------------------------------- helpers */
function extent(arrays) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) for (const v of a) if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}
function niceDomain([lo, hi], minSpan) {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.14;
  return [lo - pad, hi + pad];
}
function niceTicks(lo, hi, target = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}
/** Fritsch–Carlson monotone cubic through points sorted by ascending x (no overshoot between samples). */
function monotone(pts) {
  const n = pts.length;
  if (n < 2) return '';
  const dx = [];
  const m = [];
  const tan = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  tan[0] = m[0];
  tan[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
    } else {
      const a = tan[i] / m[i];
      const b = tan[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const k = 3 / Math.sqrt(s);
        tan[i] = k * a * m[i];
        tan[i + 1] = k * b * m[i];
      }
    }
  }
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r2(pts[i][0] + h)} ${r2(pts[i][1] + tan[i] * h)} ${r2(pts[i + 1][0] - h)} ${r2(pts[i + 1][1] - tan[i + 1] * h)} ${r2(pts[i + 1][0])} ${r2(pts[i + 1][1])}`;
  }
  return d;
}

/* ------------------------------------------------------------------- model */
function buildModel(ctx, metric, hours) {
  const { H, i } = ctx;
  const n = Math.max(2, Math.min(hours, H.time.length - i));
  const idxs = Array.from({ length: n }, (_, j) => i + j);
  const col = (key, conv = (v) => v) => idxs.map((k) => (isNum(H[key]?.[k]) ? conv(H[key][k]) : null));
  const at = (key, j) => H[key]?.[idxs[j]];
  const model = {
    metric, n, idxs,
    times: idxs.map((k) => H.time[k]),
    night: idxs.map((k) => H.is_day?.[k] === 0),
    mode: 'edge', series: [], bars: null, secondary: null, empty: false,
    ticks: null, domain: [0, 1], tickFmt: (v) => num(v), legend: [], arrows: false, tip: null,
  };

  switch (metric) {
    case 'temp': {
      const a = col('temperature_2m', toTemp);
      const b = col('apparent_temperature', toTemp);
      model.series = [{ cls: '', vals: a, area: true, fmt: (v) => `${num(v)}°`, extremes: true }, { cls: 's2', vals: b }];
      model.domain = niceDomain(extent([a, b]), tempUnit() === '°F' ? 10 : 6);
      model.tickFmt = (v) => `${num(v)}°`;
      model.legend = [{ cls: '', label: t('chart.temp') }, { cls: 's2', label: t('chart.feels') }];
      model.tip = (j) => ({
        rows: [
          { cls: '', label: t('chart.temp'), value: fTemp(at('temperature_2m', j)) },
          { cls: 's2', label: t('chart.feels'), value: fTemp(at('apparent_temperature', j)) },
        ],
        note: isNum(at('weather_code', j)) ? t(`wx.${weatherMeta(at('weather_code', j)).key}`) : '',
      });
      break;
    }
    case 'precip': {
      const mm = col('precipitation', toPrecip);
      const pop = col('precipitation_probability');
      const top = Math.max(S_INCH() ? 0.08 : 2, extent([mm])[1] * 1.2 || 0);
      model.mode = 'slot';
      model.bars = { vals: mm, cls: () => '' };
      model.secondary = { cls: 's3', vals: pop };
      model.domain = [0, top];
      model.ticks = niceTicks(0, top, 3);
      model.tickFmt = (v) => num(v, S_INCH() ? 2 : v < 1 && v > 0 ? 1 : 0);
      model.legend = [{ cls: 'bar', label: `${t('chart.amount')} (${precipUnit()})` }, { cls: 's3', label: t('chart.prob') }];
      model.tip = (j) => ({
        rows: [
          { cls: 'bar', label: t('chart.amount'), value: fPrecip(at('precipitation', j)) },
          { cls: 's3', label: t('chart.prob'), value: pct(at('precipitation_probability', j)) },
        ],
      });
      break;
    }
    case 'wind': {
      const w = col('wind_speed_10m', toWind);
      const g = col('wind_gusts_10m', toWind);
      const top = Math.max(S_MS() ? 6 : 20, extent([w, g])[1] * 1.15 || 0);
      model.series = [{ cls: '', vals: w }, { cls: 's2', vals: g }];
      model.domain = [0, top];
      model.ticks = niceTicks(0, top, 3);
      model.tickFmt = (v) => num(v);
      model.arrows = true;
      model.legend = [{ cls: '', label: `${t('chart.wind')} (${windUnit()})` }, { cls: 's2', label: t('chart.gust') }];
      model.tip = (j) => {
        const dir = at('wind_direction_10m', j);
        return {
          rows: [
            { cls: '', label: t('chart.wind'), value: fWind(at('wind_speed_10m', j)) },
            { cls: 's2', label: t('chart.gust'), value: fWind(at('wind_gusts_10m', j)) },
          ],
          note: isNum(dir) ? t('wind.from', { dir: t(`dir.${compassIndex(dir)}`) }) : '',
        };
      };
      break;
    }
    case 'humidity': {
      const v = col('relative_humidity_2m');
      model.series = [{ cls: '', vals: v, area: true }];
      model.domain = [0, 100];
      model.ticks = [0, 50, 100];
      model.tickFmt = (x) => `${num(x)}%`;
      model.legend = [{ cls: '', label: t('chart.humidity') }];
      model.tip = (j) => ({ rows: [{ cls: '', label: t('chart.humidity'), value: pct(at('relative_humidity_2m', j)) }] });
      break;
    }
    case 'uv': {
      const v = col('uv_index');
      const top = Math.max(8, Math.ceil((extent([v])[1] || 0) + 1));
      model.mode = 'slot';
      model.bars = { vals: v, cls: (x) => `uv${Math.max(0, uvLevel(x))}` };
      model.domain = [0, top];
      model.ticks = niceTicks(0, top, 3);
      model.tickFmt = (x) => num(x);
      model.legend = [{ cls: 'bar', label: t('chart.uv') }];
      model.tip = (j) => {
        const u = at('uv_index', j);
        return { rows: [{ cls: 'bar', label: t('chart.uv'), value: isNum(u) ? num(u, 1) : '—' }], note: isNum(u) ? t(`uv.${uvLevel(u)}`) : '' };
      };
      break;
    }
    default: {
      const p = col('pressure_msl', toPressure);
      const span = pressureUnit() === 'inHg' ? 0.24 : pressureUnit() === 'mmHg' ? 6 : 8;
      model.series = [{ cls: '', vals: p, area: true }];
      model.domain = niceDomain(extent([p]), span);
      model.tickFmt = (x) => num(x, pressureUnit() === 'inHg' ? 2 : 0);
      model.legend = [{ cls: '', label: `${t('chart.pressure')} (${pressureUnit()})` }];
      model.tip = (j) => ({ rows: [{ cls: '', label: t('chart.pressure'), value: fPressure(at('pressure_msl', j)) }] });
    }
  }

  const hasData = model.bars ? model.bars.vals.some(isNum) : model.series.some((s) => s.vals.some(isNum));
  model.empty = !hasData;
  return model;
}
const S_INCH = () => precipUnit() === 'in';
const S_MS = () => windUnit() === 'm/s';

/* -------------------------------------------------------------------- chart */
export function mountChart(host, getOpts) {
  const wrap = host.querySelector('.chart-wrap');
  const legendEl = host.querySelector('.legend');
  let width = 0;
  let model = null;
  let geo = null;
  let idx = -1;
  let hideTimer = 0;
  let raf = 0;

  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-roledescription', t('chart.role'));

  function draw() {
    const { ctx, metric, hours } = getOpts();
    width = Math.round(wrap.clientWidth);
    if (!width) return;
    const rtl = isRTL();
    model = buildModel(ctx, metric, hours);
    const padB = model.arrows ? 52 : 30;
    const plotW = width - PAD_S - PAD_E;
    const plotH = HEIGHT - PAD_T - padB;
    const plotL = rtl ? PAD_E : PAD_S;
    const plotR = plotL + plotW;
    const bottom = PAD_T + plotH;
    const n = model.n;
    const slot = plotW / n;
    const step = plotW / Math.max(1, n - 1);
    const unit = model.mode === 'slot' ? slot : step;
    const xAt = (j) => {
      const f = model.mode === 'slot' ? (j + 0.5) / n : j / (n - 1);
      return rtl ? width - PAD_S - f * plotW : PAD_S + f * plotW;
    };
    const [lo, hi] = model.domain;
    const yAt = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * plotH;
    const yPop = (v) => PAD_T + (1 - clamp(v, 0, 100) / 100) * plotH;
    geo = { rtl, plotW, plotL, plotR, n, xAt, yAt, yPop, mode: model.mode, unit, bottom, padB };

    legendEl.innerHTML = model.legend.map((l) => `<span><i class="${l.cls}"></i>${esc(l.label)}</span>`).join('');
    const summaryVals = (model.series[0]?.vals || model.bars?.vals || []).filter(isNum);
    wrap.setAttribute(
      'aria-label',
      model.empty
        ? t('chart.noData')
        : t('chart.aria', { metric: t(`m.${metric}`), hours: dig(model.n), min: model.tickFmt(Math.min(...summaryVals)), max: model.tickFmt(Math.max(...summaryVals)) }),
    );

    if (model.empty) {
      wrap.innerHTML = `<p class="empty" style="height:100%;justify-content:center">${esc(t('chart.noData'))}</p>`;
      return;
    }

    let svg = `<svg viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}" aria-hidden="true" focusable="false">`;
    svg += `<defs><linearGradient id="chg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ch-stop-a"/><stop offset="1" class="ch-stop-b"/></linearGradient></defs>`;

    // night bands
    for (let j = 0; j < n; ) {
      if (!model.night[j]) { j++; continue; }
      let e = j;
      while (e + 1 < n && model.night[e + 1]) e++;
      const xa = xAt(j);
      const xb = xAt(e);
      const left = Math.max(plotL, Math.min(xa, xb) - unit / 2);
      const right = Math.min(plotR, Math.max(xa, xb) + unit / 2);
      svg += `<rect class="ch-night" x="${r2(left)}" y="${PAD_T}" width="${r2(Math.max(0, right - left))}" height="${plotH}" rx="6"/>`;
      j = e + 1;
    }
    // grid + y labels
    const ticks = model.ticks || niceTicks(lo, hi, 4);
    for (const v of ticks) {
      const y = yAt(v);
      if (y < PAD_T - 1 || y > bottom + 1) continue;
      svg += `<line class="ch-grid" x1="${plotL}" x2="${plotR}" y1="${r2(y)}" y2="${r2(y)}"/>`;
      svg += `<text class="ch-txt" x="${rtl ? width - 6 : 6}" y="${r2(y + 4)}" text-anchor="${rtl ? 'end' : 'start'}">${esc(model.tickFmt(v))}</text>`;
    }
    // day separators
    for (let j = 1; j < n; j++) {
      if (model.times[j].slice(11, 16) !== '00:00') continue;
      const bx = model.mode === 'slot' ? xAt(j) + (rtl ? slot / 2 : -slot / 2) : xAt(j);
      svg += `<line class="ch-day-sep" x1="${r2(bx)}" x2="${r2(bx)}" y1="${PAD_T - 4}" y2="${bottom}"/>`;
      svg += `<text class="ch-txt accent" x="${r2(bx + (rtl ? -5 : 5))}" y="${PAD_T - 7}" text-anchor="${rtl ? 'end' : 'start'}">${esc(weekdayName(model.times[j], 'short'))}</text>`;
    }
    // bars
    if (model.bars) {
      const bw = Math.max(3, Math.min(22, slot * 0.64));
      model.bars.vals.forEach((v, j) => {
        if (!isNum(v)) return;
        const y = yAt(Math.min(v, hi));
        const h = Math.max(v > 0 ? 2 : 0, bottom - y);
        svg += `<rect class="ch-bar ${model.bars.cls(v)}" x="${r2(xAt(j) - bw / 2)}" y="${r2(bottom - h)}" width="${r2(bw)}" height="${r2(h)}" rx="3"/>`;
      });
    }
    // lines (+ area)
    const linePts = (vals, yFn) => {
      const pts = [];
      vals.forEach((v, j) => { if (isNum(v)) pts.push([xAt(j), yFn(v)]); });
      return rtl ? pts.reverse() : pts;
    };
    model.series.forEach((s) => {
      const pts = linePts(s.vals, yAt);
      if (pts.length < 2) return;
      const d = monotone(pts);
      if (s.area) svg += `<path d="${d}L${r2(pts[pts.length - 1][0])} ${bottom}L${r2(pts[0][0])} ${bottom}Z" fill="url(#chg)"/>`;
      svg += `<path class="ch-line ${s.cls}" d="${d}"/>`;
    });
    if (model.secondary) {
      const pts = linePts(model.secondary.vals, yPop);
      if (pts.length >= 2) svg += `<path class="ch-line ${model.secondary.cls}" d="${monotone(pts)}"/>`;
    }
    // temperature extremes
    const main = model.series[0];
    if (main?.extremes) {
      let iMax = -1;
      let iMin = -1;
      main.vals.forEach((v, j) => {
        if (!isNum(v)) return;
        if (iMax < 0 || v > main.vals[iMax]) iMax = j;
        if (iMin < 0 || v < main.vals[iMin]) iMin = j;
      });
      const label = (j, dy) => `<text class="ch-txt strong" x="${r2(clamp(xAt(j), plotL + 12, plotR - 12))}" y="${r2(yAt(main.vals[j]) + dy)}" text-anchor="middle">${esc(main.fmt(main.vals[j]))}</text>`;
      if (iMax >= 0) svg += label(iMax, -9);
      if (iMin >= 0 && iMin !== iMax && main.vals[iMin] !== main.vals[iMax]) svg += label(iMin, 18);
    }
    // x labels (+ wind arrows)
    const minGap = 54;
    const every = [1, 2, 3, 4, 6, 8, 12].find((e) => e * unit >= minGap) || 12;
    for (let j = 0; j < n; j += every) {
      const x = xAt(j);
      if (j > 0 && (rtl ? x < plotL + 16 : x > plotR - 16)) continue;
      const text = j === 0 ? t('hourly.now') : fHour(model.times[j]);
      svg += `<text class="ch-txt${j === 0 ? ' strong' : ''}" x="${r2(x)}" y="${HEIGHT - 6}" text-anchor="middle">${esc(text)}</text>`;
      if (model.arrows) {
        const dir = H_DIR(ctx, model.idxs[j]);
        if (isNum(dir)) svg += `<g transform="translate(${r2(x)} ${HEIGHT - 30}) rotate(${Math.round(dir + 180)})"><path class="ch-arrow" d="M0 -7L4.6 6L0 3L-4.6 6Z"/></g>`;
      }
    }
    // cursor (hidden until used)
    svg += `<g class="ch-cursor" id="chc" visibility="hidden"><line y1="${PAD_T}" y2="${bottom}"/>`;
    model.series.forEach((s, k) => { svg += `<circle class="${s.cls}" r="4.6" data-s="${k}"/>`; });
    if (model.secondary) svg += `<circle class="${model.secondary.cls}" r="4.2" data-s="p"/>`;
    svg += '</g></svg>';
    wrap.innerHTML = `${svg}<div class="chart-tip" role="presentation"></div><div class="sr-only" aria-live="polite"></div>`;
    if (idx >= 0) show(Math.min(idx, n - 1), false);
  }

  function idxFromX(px) {
    const f = geo.rtl ? (width - PAD_S - px) / geo.plotW : (px - PAD_S) / geo.plotW;
    return geo.mode === 'slot' ? clamp(Math.floor(f * geo.n), 0, geo.n - 1) : clamp(Math.round(f * (geo.n - 1)), 0, geo.n - 1);
  }

  function show(j, announce = true) {
    if (!model || model.empty || !geo) return;
    idx = j;
    const svg = wrap.querySelector('svg');
    const cur = svg?.querySelector('#chc');
    const tip = wrap.querySelector('.chart-tip');
    if (!cur || !tip) return;
    const x = geo.xAt(j);
    cur.setAttribute('visibility', 'visible');
    const line = cur.querySelector('line');
    line.setAttribute('x1', r2(x));
    line.setAttribute('x2', r2(x));
    cur.querySelectorAll('circle').forEach((c) => {
      const key = c.dataset.s;
      const v = key === 'p' ? model.secondary.vals[j] : model.series[Number(key)].vals[j];
      if (!isNum(v)) { c.setAttribute('visibility', 'hidden'); return; }
      c.setAttribute('visibility', 'visible');
      c.setAttribute('cx', r2(x));
      c.setAttribute('cy', r2(key === 'p' ? geo.yPop(v) : geo.yAt(v)));
    });
    const info = model.tip(j);
    const time = model.times[j];
    const title = `${weekdayName(time, 'short')} ${j === 0 ? t('hourly.now') : fTime(time)}`;
    const html =
      `<b>${esc(title)}</b>` +
      info.rows.map((r) => `<div><span class="legend" style="display:inline-flex;margin:0 0 0 6px"><i class="${r.cls}"></i></span>${esc(r.label)}: <span class="n">${esc(r.value)}</span></div>`).join('') +
      (info.note ? `<div class="muted">${esc(info.note)}</div>` : '');
    tip.innerHTML = html;
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    let left = x + 14;
    if (left + tw > width) left = x - tw - 14;
    tip.style.left = `${Math.max(0, r2(left))}px`;
    if (announce) {
      const live = wrap.querySelector('[aria-live]');
      if (live) live.textContent = `${title}. ${info.rows.map((r) => `${r.label} ${r.value}`).join('، ')}`;
    }
  }

  function hide() {
    idx = -1;
    wrap.querySelector('#chc')?.setAttribute('visibility', 'hidden');
    wrap.querySelector('.chart-tip')?.classList.remove('on');
  }

  const onPointer = (e) => {
    if (!geo || !model || model.empty) return;
    clearTimeout(hideTimer);
    const rect = wrap.getBoundingClientRect();
    show(idxFromX(e.clientX - rect.left));
  };
  const onUp = (e) => {
    if (e.pointerType !== 'mouse') hideTimer = setTimeout(hide, 2600);
  };
  const onKey = (e) => {
    if (!geo || !model || model.empty) return;
    const dir = geo.rtl ? -1 : 1;
    let next = idx < 0 ? 0 : idx;
    if (e.key === 'ArrowRight') next += dir;
    else if (e.key === 'ArrowLeft') next -= dir;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = geo.n - 1;
    else if (e.key === 'Escape') { hide(); return; }
    else return;
    e.preventDefault();
    show(clamp(next, 0, geo.n - 1));
  };
  wrap.addEventListener('pointerdown', onPointer);
  wrap.addEventListener('pointermove', onPointer);
  wrap.addEventListener('pointerup', onUp);
  wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  wrap.addEventListener('keydown', onKey);
  wrap.addEventListener('blur', hide);

  const ro = new ResizeObserver(() => {
    const w = Math.round(wrap.clientWidth);
    if (!w || Math.abs(w - width) <= 1) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });
  ro.observe(wrap);
  draw();

  return {
    draw,
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(hideTimer);
    },
    /** For tests: current model summary. */
    debug: () => ({ width, n: model?.n, empty: model?.empty }),
  };
}

const H_DIR = (ctx, k) => ctx.H.wind_direction_10m?.[k];
