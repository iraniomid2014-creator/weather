/* Skyview — application shell: data flow, offline cache, dialogs, background, service worker. */
import { $, $$, debounce, nowWall, lowPerfDevice } from './util.js';
import * as store from './store.js';
import { S, setSetting } from './store.js';
import * as api from './api.js';
import { t, setLanguage, applyStatic, getLang, placeTitle, placeSub, plain, fTemp, ago } from './i18n.js';
import { injectSprite } from './icons.js';
import * as I from './insights.js';
import * as ui from './ui.js';
import { mountChart } from './charts.js';
import { createFx } from './fx.js';
import { norm, searchLocal, mergeResults } from './places.js';
import { findPhoto, preload } from './photos.js';

const FRESH_MS = 8 * 60 * 1000; // a forecast younger than this is shown as is and not refetched
const REFRESH_MS = 12 * 60 * 1000; // auto-refresh while the app stays open
const AIR_FRESH_MS = 30 * 60 * 1000;

const state = {
  place: null,
  data: null,
  air: null,
  airT: 0,
  airErr: null,
  airLoading: false,
  fetchedAt: 0,
  offline: false,
  error: null,
  loading: false,
  view: null,
  photo: null,
  installEvent: null,
  swWaiting: null,
};
let fx = null;
let chartCtl = null;
let refreshCtl = null;
let airCtl = null;
let photoCtl = null;
let photoToken = 0;
let searchCtl = null;
let searchResults = [];
let activeResult = -1;
let updateRequested = false;
let accLang = '';
const lastHtml = new WeakMap();
const remoteCache = new Map();

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------ theme + sky */
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
const effectiveTheme = () => (S.theme === 'auto' ? (darkQuery?.matches ? 'dark' : 'light') : S.theme);

function applyTheme() {
  document.documentElement.setAttribute('data-theme', effectiveTheme());
  fx?.reseed();
  syncThemeColor();
}
/** Browser UI colour follows the sky gradient (read from the .sky element, where the sky-* class lives). */
function syncThemeColor() {
  const color = getComputedStyle(el('sky')).getPropertyValue('--sky-a').trim();
  const meta = $('meta[name="theme-color"]');
  if (color && meta) meta.setAttribute('content', color);
}
let fxKey = '';
function setSky(v) {
  const cls = I.skyClass(v.ctx.now.code, v.ctx.now.isDay);
  el('sky').className = `sky ${cls}`;
  const root = document.documentElement;
  root.dataset.sky = cls.slice(4); // clear-day | clear-night | cloudy-day | cloudy-night | rain | storm | snow | fog
  const fxOn = S.effects === 'on' || (S.effects === 'auto' && !lowPerfDevice());
  root.dataset.glass = fxOn ? 'on' : 'off';
  root.dataset.fx = fxOn ? 'on' : 'off';
  // (re)seed the particles only when the effect really changes — not on every tick
  const effect = I.fxFor(v.ctx.now.code);
  const key = `${fxOn}|${effect ? `${effect.type}:${effect.density}:${effect.lightning}` : ''}`;
  if (key !== fxKey) {
    fxKey = key;
    fx?.set(effect, fxOn);
  }
  syncThemeColor();
}

/* --------------------------------------------------------- background photo */
function hidePhoto() {
  if (!state.photo) return;
  state.photo = null;
  el('bg-photo').classList.remove('on');
  renderFoot();
}
function showPhoto(ph) {
  const node = el('bg-photo');
  node.style.backgroundImage = `url("${ph.url}")`;
  node.classList.add('on');
  state.photo = ph;
  renderFoot();
}
async function applyPhoto(place) {
  const token = ++photoToken;
  photoCtl?.abort();
  if (S.photo !== 'on' || navigator.onLine === false || navigator.connection?.saveData) return hidePhoto();
  if (state.photo && state.photo.key !== place.key) hidePhoto(); // the old city's picture must not linger behind the new one
  const ctl = (photoCtl = new AbortController());
  let ph = null;
  try {
    ph = await findPhoto(place, { signal: ctl.signal });
  } catch {
    return; // aborted by a newer request
  }
  if (token !== photoToken) return;
  if (!ph || !(await preload(ph.url)) || token !== photoToken) {
    if (token === photoToken) hidePhoto();
    return;
  }
  showPhoto({ ...ph, key: place.key });
}

/* ----------------------------------------------------------------- rendering */
function focusSelector(node) {
  const d = node.dataset || {};
  if (!d.action) return null;
  return `[data-action="${d.action}"]${d.val != null ? `[data-val="${d.val}"]` : ''}${d.key ? `[data-key="${d.key}"]` : ''}`;
}
/** Replace a node's HTML only when it changed; keep keyboard focus on the same control. Returns true when it did change. */
function renderInto(node, html, sig = html) {
  if (!node) return false;
  node.hidden = !html;
  if (lastHtml.get(node) === sig) return false;
  const active = document.activeElement;
  const sel = active && node.contains(active) ? focusSelector(active) : null;
  node.innerHTML = html;
  lastHtml.set(node, sig);
  if (sel) node.querySelector(sel)?.focus({ preventScroll: true });
  return true;
}

/** Re-render a ribbon section, keeping its horizontal scroll position unless `reset` (new hour: "now" moves to the start). */
function renderRibbon(id, html, reset = false) {
  const node = el(id);
  const prev = node.querySelector('.ribbon')?.scrollLeft || 0;
  if (renderInto(node, html) && !reset && prev) {
    const strip = node.querySelector('.ribbon');
    if (strip) strip.scrollLeft = prev;
  }
}

function derive() {
  const { place, data, air } = state;
  const wall = nowWall(data.tz, data.utcOffset);
  const ctx = I.buildContext(data, air, wall);
  return {
    place, data, air, wall, ctx,
    aq: I.airNow(air, wall),
    airLoading: state.airLoading,
    airErr: state.airErr,
    fetchedAt: state.fetchedAt,
    offline: state.offline,
  };
}

let lastHour = '';
function renderStage(v) {
  const newHour = lastHour !== `${v.place.key}|${v.ctx.i}`;
  lastHour = `${v.place.key}|${v.ctx.i}`;
  renderRibbon('s-hourly', ui.hourlyHTML(v), newHour);
  renderRibbon('s-daily', ui.dailyHTML(v));
  renderAccs(v);
}

function ensureAccs() {
  const host = el('s-accs');
  host.hidden = false;
  if (accLang === getLang() && host.firstElementChild) return;
  accLang = getLang();
  chartCtl?.destroy();
  chartCtl = null;
  host.innerHTML = ui.accordionsHTML();
}

function renderAccs(v) {
  ensureAccs();
  for (const [id] of ui.ACCORDIONS) {
    const d = $(`.acc[data-acc="${id}"]`, el('s-accs'));
    if (!d) continue;
    const pv = $(`[data-pv="${id}"]`, d);
    const html = ui.accPreview(id, v);
    if (pv.dataset.h !== html) {
      pv.innerHTML = html;
      pv.dataset.h = html;
    }
    if (d.open) renderAccBody(id, d, v);
  }
}

function renderAccBody(id, d, v) {
  const body = $(`[data-body="${id}"]`, d);
  const changed = renderInto(body, ui.accBodyHTML(id, v));
  if (id !== 'chart') return;
  if (changed || !chartCtl) {
    chartCtl?.destroy();
    chartCtl = mountChart(body.querySelector('.chart-host'), () => ({ ctx: state.view.ctx, metric: ui.uiState.metric, hours: ui.uiState.hours }));
  } else chartCtl.draw();
}

function renderAcc(id) {
  const d = $(`.acc[data-acc="${id}"]`, el('s-accs'));
  if (!d || !state.view) return;
  if (d.open) renderAccBody(id, d, state.view);
  const pv = $(`[data-pv="${id}"]`, d);
  const html = ui.accPreview(id, state.view);
  if (pv.dataset.h !== html) {
    pv.innerHTML = html;
    pv.dataset.h = html;
  }
}

function renderTopbar() {
  const p = state.place;
  el('place-name').textContent = p ? placeTitle(p) : '…';
  el('place-sub').textContent = p ? placeSub(p) : '';
  el('place-sub').hidden = !p || !placeSub(p);
  const fav = !!p && store.isFavorite(p);
  const btn = el('btn-fav');
  btn.setAttribute('aria-pressed', String(fav));
  const label = t(fav ? 'pl.removeFav' : 'pl.addFav');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function renderBanners(v) {
  const list = [];
  if (state.offline) {
    list.push({ id: 'offline', kind: 'warn', icon: 'wifiOff', text: t('st.offlineBanner', { ago: ago(Date.now() - state.fetchedAt) }), action: 'refresh', actionLabel: t('st.retry') });
  }
  if (v?.ctx.stale && !state.offline) list.push({ id: 'stale', kind: 'warn', icon: 'clock', text: t('st.stale'), action: 'refresh', actionLabel: t('st.retry') });
  if (state.swWaiting) list.push({ id: 'update', kind: 'info', icon: 'download', text: t('app.updateReady'), action: 'apply-update', actionLabel: t('app.update') });
  renderInto(el('banners'), ui.bannersHTML(list));
}

/** Footer: the "updated … ago" text is patched in place so the footer is not rebuilt every tick. */
function renderFoot() {
  const v = state.view;
  const foot = el('foot');
  renderInto(foot, ui.footHTML(v, state.photo, true));
  const a = foot.querySelector('.js-ago');
  if (a && v) a.textContent = ui.agoLine(v);
}

function updateTitle(v) {
  document.title = v ? plain(`${fTemp(v.ctx.now.temp)} ${placeTitle(state.place)} – ${t('app.name')}`) : t('app.title');
}

/** Full re-render from current state (cheap: unchanged HTML is not touched). */
function render() {
  renderTopbar();
  if (!state.place) return;
  if (!state.data) {
    state.view = null;
    renderInto(el('s-hourly'), state.error ? ui.errorHTML(state.error) : ui.skeletonHTML());
    renderInto(el('s-daily'), '');
    el('s-accs').hidden = true;
    renderBanners(null);
    renderFoot();
    updateTitle(null);
    return;
  }
  const v = derive();
  state.view = v;
  setSky(v);
  renderBanners(v);
  renderStage(v);
  renderFoot();
  updateTitle(v);
}

/* ------------------------------------------------------------------ loading */
function loadPlace(place) {
  const p = store.setCurrent(place);
  state.place = p;
  state.error = null;
  state.offline = false;
  state.airErr = null;
  airCtl?.abort();
  state.airLoading = false;
  const cached = store.cacheGet(p.key);
  if (cached) {
    state.data = cached.forecast;
    state.air = cached.air || null;
    state.airT = cached.airT || 0;
    state.fetchedAt = cached.t || cached.forecast.fetchedAt || 0;
  } else {
    state.data = null;
    state.air = null;
    state.airT = 0;
    state.fetchedAt = 0;
  }
  ui.uiState.day = null;
  render();
  applyPhoto(p); // runs alongside the forecast request; the sky shows meanwhile
  const fresh = state.data && Date.now() - state.fetchedAt < FRESH_MS;
  if (!fresh) return refresh({ force: true });
  if (airOpen()) loadAir();
  return Promise.resolve();
}

function setSpin(on) {
  el('btn-refresh')?.classList.toggle('spin', on);
  el('btn-refresh')?.setAttribute('aria-busy', String(on));
}

/** Forecast only: air quality is a separate, lazy request (see loadAir). */
async function refresh({ force = false } = {}) {
  const place = state.place;
  if (!place) return;
  if (!force && state.data && Date.now() - state.fetchedAt < FRESH_MS && !state.offline) return;
  refreshCtl?.abort();
  const ctl = (refreshCtl = new AbortController());
  state.loading = true;
  setSpin(true);
  try {
    const fc = await api.getForecast(place, { signal: ctl.signal });
    if (ctl.signal.aborted || state.place.key !== place.key) return;
    state.data = fc;
    state.fetchedAt = fc.fetchedAt;
    state.offline = false;
    state.error = null;
    cachePlace();
    if (fc.tz && place.tz !== fc.tz) store.patchCurrent({ tz: fc.tz });
    state.place = store.getCurrent();
  } catch (err) {
    if (err?.kind === 'abort') return;
    if (state.data) {
      state.offline = true;
      ui.toast(t('err.toastStale'));
    } else {
      state.error = err;
    }
  } finally {
    if (refreshCtl === ctl) {
      state.loading = false;
      setSpin(false);
    }
  }
  render();
  if (airOpen()) loadAir();
}

function cachePlace() {
  if (state.place && state.data) store.cachePut(state.place.key, { t: state.fetchedAt, forecast: state.data, air: state.air, airT: state.airT });
}

const airOpen = () => !!$('.acc[data-acc="air"]', el('s-accs'))?.open;

async function loadAir({ force = false } = {}) {
  const place = state.place;
  if (!place || !state.data) return;
  if (!force && state.air && Date.now() - state.airT < AIR_FRESH_MS) return;
  if (state.airLoading && !force) return;
  airCtl?.abort();
  const ctl = (airCtl = new AbortController());
  state.airLoading = true;
  state.airErr = null;
  refreshAirView();
  try {
    const air = await api.getAir(place, { signal: ctl.signal });
    if (ctl.signal.aborted || state.place.key !== place.key) return;
    state.air = air;
    state.airT = Date.now();
    cachePlace();
  } catch (err) {
    if (err?.kind === 'abort') return;
    state.airErr = err;
  } finally {
    if (airCtl === ctl) {
      state.airLoading = false;
      refreshAirView();
    }
  }
}
function refreshAirView() {
  if (!state.data) return;
  state.view = derive();
  renderAcc('air');
}

/* ------------------------------------------------------------ places + geo */
const dlgPlaces = () => el('dlg-places');
const dlgSettings = () => el('dlg-settings');

function renderPlaceLists() {
  const favs = store.getFavorites();
  const recents = store.getRecents().filter((r) => !favs.some((f) => f.key === r.key));
  el('place-favs').hidden = !favs.length;
  el('place-recents').hidden = !recents.length;
  el('fav-list').innerHTML = favs.map((p, i) => ui.placeItemHTML(p, { kind: 'fav', i })).join('');
  el('recent-list').innerHTML = recents.map((p, i) => ui.placeItemHTML(p, { kind: 'recent', i })).join('');
  const showResults = searchResults.length > 0;
  el('place-results').innerHTML = searchResults.map((p, i) => ui.placeItemHTML(p, { kind: 'result', i })).join('');
  el('place-results').hidden = !showResults;
  el('place-q').setAttribute('aria-expanded', String(showResults));
  setActiveResult(activeResult);
}
function listFor(kind) {
  if (kind === 'fav') return store.getFavorites();
  if (kind === 'result') return searchResults;
  const favs = store.getFavorites();
  return store.getRecents().filter((r) => !favs.some((f) => f.key === r.key));
}
function setActiveResult(i) {
  activeResult = i;
  $$('#place-results .pitem').forEach((li, k) => {
    li.classList.toggle('active', k === i);
    li.setAttribute('aria-selected', String(k === i));
  });
  const q = el('place-q');
  if (i >= 0) q.setAttribute('aria-activedescendant', `pi-result-${i}`);
  else q.removeAttribute('aria-activedescendant');
}
function placeMsg(text, isErr = false) {
  const m = el('place-msg');
  m.textContent = text;
  m.classList.toggle('err', isErr);
}

function openPlaces() {
  renderPlaceLists();
  placeMsg('');
  if (!dlgPlaces().open) dlgPlaces().showModal();
  requestAnimationFrame(() => el('place-q').focus());
}

/** Show a result list, keeping the highlighted entry if it is still there (so a late network answer never moves the cursor). */
function setResults(list, keepKey) {
  searchResults = list;
  const at = keepKey ? list.findIndex((p) => p.key === keepKey) : -1;
  activeResult = list.length ? Math.max(0, at) : -1;
  renderPlaceLists();
}

const remoteKey = (q) => `${getLang()}|${norm(q)}`;
const runRemote = debounce(async (q) => {
  searchCtl?.abort();
  const ctl = (searchCtl = new AbortController());
  const key = remoteKey(q);
  let remote = remoteCache.get(key);
  try {
    if (!remote) {
      remote = await api.searchPlaces(q, getLang(), { signal: ctl.signal });
      remoteCache.set(key, remote);
      if (remoteCache.size > 40) remoteCache.delete(remoteCache.keys().next().value);
    }
  } catch (err) {
    if (err.kind === 'abort') return;
    placeMsg(searchResults.length ? '' : t(err.kind === 'rate' ? 'err.rate' : 'pl.searchFail'), !searchResults.length);
    return;
  }
  if (ctl.signal.aborted || el('place-q').value.trim() !== q) return;
  const merged = mergeResults(searchLocal(q), remote);
  setResults(merged, searchResults[activeResult]?.key);
  placeMsg(merged.length ? '' : t('pl.none'));
}, 200);

function onSearchInput() {
  const q = el('place-q').value.trim();
  runRemote.cancel();
  searchCtl?.abort();
  if (!q) {
    placeMsg('');
    return setResults([]);
  }
  // the bundled gazetteer answers on every keystroke; the network only adds what it does not know
  const cached = q.length >= 2 ? remoteCache.get(remoteKey(q)) : null;
  const list = mergeResults(searchLocal(q), cached || []);
  setResults(list);
  if (q.length < 2) return placeMsg(list.length ? '' : t('pl.minChars'));
  if (cached) return placeMsg(list.length ? '' : t('pl.none'));
  placeMsg(t('pl.searching'));
  runRemote(q);
}

function choosePlace(p) {
  if (!p) return;
  if (dlgPlaces().open) dlgPlaces().close();
  searchResults = [];
  el('place-q').value = '';
  window.scrollTo({ top: 0 });
  loadPlace(p);
}

function useMyLocation() {
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    const msg = t(window.isSecureContext ? 'pl.geoUnavailable' : 'pl.geoSecure');
    dlgPlaces().open ? placeMsg(msg, true) : ui.toast(msg);
    return;
  }
  if (dlgPlaces().open) placeMsg(t('pl.locating'));
  else ui.toast(t('pl.locating'), { ms: 2500 });
  const btn = $('[data-action="locate-me"]', dlgPlaces());
  btn?.setAttribute('disabled', '');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      btn?.removeAttribute('disabled');
      const { latitude: lat, longitude: lon } = pos.coords;
      const place = store.makePlace({ lat, lon, name: null, sub: null });
      choosePlace(place);
      try {
        // the rounded coordinates, not the raw GPS fix: a city-level name needs nothing more, and nothing more leaves the device
        const named = await api.reversePlace(place.lat, place.lon, getLang());
        const cur = store.getCurrent();
        if (named && cur && cur.key === place.key) {
          store.patchCurrent({ name: { ...(cur.name || {}), ...named.name }, sub: { ...(cur.sub || {}), ...named.sub } });
          state.place = store.getCurrent();
          render();
          applyPhoto(state.place); // the name is what finds the photo
        }
      } catch {
        /* keep coordinates as the title */
      }
    },
    (err) => {
      btn?.removeAttribute('disabled');
      const key = err.code === 1 ? 'pl.geoDenied' : err.code === 3 ? 'pl.geoTimeout' : 'pl.geoUnavailable';
      dlgPlaces().open ? placeMsg(t(key), true) : ui.toast(t(key));
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

/* ----------------------------------------------------------------- settings */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

function renderSettings() {
  const body = el('settings-body');
  const top = body.scrollTop;
  body.innerHTML = ui.settingsHTML({ canInstall: !!state.installEvent, isIOS: isIOS(), standalone: isStandalone() });
  body.scrollTop = top;
}

function parseVal(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function applyLanguage() {
  setLanguage(S.lang);
  applyStatic();
  render();
  if (dlgPlaces().open) renderPlaceLists();
}

function onSetting(key, value) {
  if (!setSetting(key, value)) return;
  if (key === 'lang') applyLanguage();
  else if (key === 'theme') applyTheme();
  else if (key === 'photo') {
    if (value === 'on' && state.place) applyPhoto(state.place);
    else {
      photoToken++;
      photoCtl?.abort();
      hidePhoto();
    }
  } else render();
  if (dlgSettings().open) renderSettings();
}

async function resetEverything() {
  if (!window.confirm(t('set.resetConfirm'))) return;
  store.resetAll();
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch {
    /* best effort */
  }
  location.replace(location.pathname);
}

/* ------------------------------------------------------------------ SW */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (!reg) return;
    const announce = (worker) => {
      state.swWaiting = worker;
      if (state.view) renderBanners(state.view);
    };
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) announce(nw);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('[skyview] service worker registration failed', err);
  }
}

/* ------------------------------------------------------------------- events */
function onClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, val, key, kind, i } = target.dataset;
  switch (action) {
    case 'open-places': return openPlaces();
    case 'open-settings':
      renderSettings();
      return dlgSettings().open ? undefined : dlgSettings().showModal();
    case 'close-dialog': return target.closest('dialog')?.close();
    case 'refresh':
      if (airOpen()) loadAir({ force: true });
      return refresh({ force: true });
    case 'reload-air': return loadAir({ force: true });
    case 'toggle-fav-current': {
      if (!state.place) return;
      const on = store.toggleFavorite(state.place);
      ui.toast(t(on ? 'pl.addedFav' : 'pl.removedFav'));
      return renderTopbar();
    }
    case 'pick-day': {
      const k = Number(val);
      ui.uiState.day = ui.uiState.day === k ? null : k;
      if (state.view) renderRibbon('s-daily', ui.dailyHTML(state.view));
      return ui.uiState.day != null && $(`.dcell[data-val="${k}"]`)?.focus({ preventScroll: true });
    }
    case 'chart-hours': ui.uiState.hours = Number(val); return state.view && renderAcc('chart');
    case 'chart-metric': ui.uiState.metric = val; return state.view && renderAcc('chart');
    case 'set': return onSetting(key, parseVal(val));
    case 'install': {
      const ev = state.installEvent;
      if (!ev) return;
      ev.prompt();
      return ev.userChoice.finally(() => {
        state.installEvent = null;
        if (dlgSettings().open) renderSettings();
      });
    }
    case 'reset-all': return resetEverything();
    case 'locate-me': return useMyLocation();
    case 'pick-place': return choosePlace(listFor(kind)[Number(i)]);
    case 'toggle-fav': {
      const p = listFor(kind)[Number(i)];
      if (p) store.toggleFavorite(p);
      renderPlaceLists();
      return renderTopbar();
    }
    case 'remove-recent': {
      const p = listFor('recent')[Number(i)];
      if (p) store.removeRecent(p.key);
      return renderPlaceLists();
    }
    case 'apply-update':
      updateRequested = true;
      return state.swWaiting?.postMessage({ type: 'SKIP_WAITING' });
    default:
  }
}

/** An accordion was opened or closed: its body is built only now (closed ones cost nothing). */
function onToggle(e) {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('acc')) return;
  const id = d.dataset.acc;
  if (d.open) ui.uiState.open.add(id);
  else ui.uiState.open.delete(id);
  if (d.open) {
    if (state.view) renderAcc(id);
    if (id === 'air') loadAir();
  } else if (id === 'chart') {
    chartCtl?.destroy();
    chartCtl = null;
    lastHtml.delete($('[data-body="chart"]', d));
  }
}

function onKeydown(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const modal = document.querySelector('dialog[open]');
  // radio groups: arrow keys move between options
  if (e.target.getAttribute?.('role') === 'radio' && /^Arrow(Left|Right)$/.test(e.key)) {
    const group = [...e.target.parentElement.querySelectorAll('[role="radio"]')];
    const rtl = document.documentElement.dir === 'rtl';
    const step = (e.key === 'ArrowRight') === !rtl ? 1 : -1;
    const next = group[(group.indexOf(e.target) + step + group.length) % group.length];
    e.preventDefault();
    next.focus();
    next.click();
    return;
  }
  if (!typing && !modal && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '/') { e.preventDefault(); openPlaces(); }
    else if (e.key === 'r') refresh({ force: true });
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPlaces();
  }
}

/** Mouse users can drag a ribbon sideways (touch and trackpads scroll natively). */
function wireRibbonDrag() {
  let strip = null;
  let startX = 0;
  let startLeft = 0;
  let moved = false;
  document.addEventListener('pointerdown', (e) => {
    moved = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const s = e.target.closest?.('.ribbon');
    if (!s || s.scrollWidth <= s.clientWidth) return;
    strip = s;
    startX = e.clientX;
    startLeft = s.scrollLeft;
  });
  document.addEventListener('pointermove', (e) => {
    if (!strip) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 6) return;
    moved = true;
    strip.classList.add('dragging');
    strip.scrollLeft = startLeft - dx;
  });
  const end = () => {
    if (strip) strip.classList.remove('dragging');
    strip = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  // a drag must not count as a click on the day under the pointer
  document.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
}

function wireSearch() {
  const q = el('place-q');
  q.addEventListener('input', onSearchInput);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && searchResults.length) { e.preventDefault(); setActiveResult((activeResult + 1) % searchResults.length); }
    else if (e.key === 'ArrowUp' && searchResults.length) { e.preventDefault(); setActiveResult((activeResult - 1 + searchResults.length) % searchResults.length); }
  });
  el('place-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (searchResults.length) choosePlace(searchResults[Math.max(0, activeResult)]);
    else if (q.value.trim().length >= 2) runRemote(q.value.trim());
  });
  dlgPlaces().addEventListener('close', () => {
    runRemote.cancel();
    searchCtl?.abort();
    searchResults = [];
    activeResult = -1;
    q.value = '';
  });
}

/* --------------------------------------------------------------------- init */
function init() {
  setLanguage(S.lang);
  injectSprite();
  applyStatic();
  applyTheme();
  fx = createFx(el('fx'), el('flash'));

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('toggle', onToggle, true);
  $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
  wireSearch();
  wireRibbonDrag();
  darkQuery?.addEventListener?.('change', () => S.theme === 'auto' && applyTheme());
  window.addEventListener('online', () => refresh({ force: true }));
  window.addEventListener('offline', () => { if (state.data) { state.offline = true; render(); } });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvent = e; if (dlgSettings().open) renderSettings(); });
  window.addEventListener('appinstalled', () => { state.installEvent = null; });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.data && Date.now() - state.fetchedAt > FRESH_MS) refresh({ force: true });
  });
  const onScroll = () => el('topbar').classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });

  loadPlace(store.getCurrent() || store.DEFAULT_PLACE);

  setInterval(() => {
    if (document.hidden || !state.data) return;
    render();
    if (Date.now() - state.fetchedAt > REFRESH_MS && !state.loading) refresh({ force: true });
  }, 30000);
  registerSW();
  // a small handle for automated tests
  window.__skyview = { state, S, render, refresh, loadPlace, loadAir, ui, chart: () => chartCtl };
}

init();
