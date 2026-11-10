/* Skyview — small shared helpers (no dependencies). */

/** Shown in Settings → About. Keep equal to VERSION in sw.js (scripts/check_static.mjs verifies it). */
export const APP_VERSION = '1.0.0';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const pad2 = (n) => String(n).padStart(2, '0');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for safe use inside HTML templates (text and attribute values). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** Minimal event emitter. */
export function emitter() {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt)?.delete(fn);
    },
    emit(evt, ...args) {
      map.get(evt)?.forEach((fn) => {
        try {
          fn(...args);
        } catch (err) {
          console.error('[skyview] listener failed', evt, err);
        }
      });
    },
  };
}

/* ------------------------------------------------------------------ storage */
/** localStorage wrapper that never throws (private mode, quota, blocked storage). */
export const ls = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  keys(prefix) {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    } catch {
      return [];
    }
  },
};

/* --------------------------------------------------------- wall-clock time
   Open-Meteo with timezone=auto returns ISO strings in the *location's* local
   wall-clock time, without an offset ("2026-11-05T14:00"). We never turn them
   into real instants: we compare them as wall-clock strings / UTC-epoch ints. */

/** 'YYYY-MM-DD[THH:MM]' → ms since epoch, reading the wall-clock fields as if they were UTC. */
export function wallToMs(iso) {
  if (!iso) return NaN;
  const s = iso.length <= 10 ? `${iso}T00:00` : iso.slice(0, 16);
  return Date.parse(`${s}:00Z`);
}
export const msToWall = (ms) => new Date(ms).toISOString().slice(0, 16);
export const minutesBetween = (a, b) => (wallToMs(b) - wallToMs(a)) / 60000;
export const addMinutes = (iso, min) => msToWall(wallToMs(iso) + min * 60000);
export const addDays = (dateStr, n) => msToWall(wallToMs(dateStr) + n * 864e5).slice(0, 10);

const wallFmtCache = new Map();
/** Current wall-clock time ("YYYY-MM-DDTHH:MM") at a location, from its IANA zone (or UTC offset). */
export function nowWall(tz, offsetSec, nowMs = Date.now()) {
  if (tz) {
    try {
      let fmt = wallFmtCache.get(tz);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        wallFmtCache.set(tz, fmt);
      }
      const p = {};
      for (const part of fmt.formatToParts(nowMs)) p[part.type] = part.value;
      return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
    } catch {
      /* unknown zone → fall through */
    }
  }
  if (isNum(offsetSec)) return msToWall(nowMs + offsetSec * 1000);
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function floor15(wall) {
  const m = Number(wall.slice(14, 16));
  return wall.slice(0, 14) + pad2(m - (m % 15));
}

/** Index of the last element <= value in a sorted array of ISO strings (-1 if none). */
export function lastIndexAtOrBefore(sorted, value) {
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const compassIndex = (deg) => Math.round((((deg % 360) + 360) % 360) / 45) % 8;

/* ------------------------------------------------------------------ device */
export function lowPerfDevice() {
  const n = navigator;
  const c = n.connection || {};
  return (
    (n.hardwareConcurrency && n.hardwareConcurrency <= 2) ||
    (n.deviceMemory && n.deviceMemory <= 2) ||
    c.saveData === true ||
    /(^|-)2g$/.test(c.effectiveType || '')
  );
}
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
