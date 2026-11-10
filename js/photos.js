/* Skyview — background photo of the place, from Wikipedia (REST page summary: lead image + coordinates).
   Only a *photograph of that place* is accepted: a standard article whose coordinates lie within 60 km of the place, a JPEG
   (maps, flags and diagrams are SVG/PNG), landscape, at least 960 px wide, and not a collage/map/flag by file name.
   Anything else → no photo, and the weather-tinted sky shows alone. Results (including "none") are cached per place. */
import { getJson } from './api.js';
import { photoGet, photoPut } from './store.js';

const WIKI = { en: 'https://en.wikipedia.org', fa: 'https://fa.wikipedia.org' };
const FRESH_MS = 30 * 864e5;
const FRESH_NONE_MS = 3 * 864e5;
const BAD_NAME = /collage|montage|map|flag|seal|logo|coat[_ ]of|emblem|diagram|locator|panorama/i;
const MAX_KM = 60;

function distKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Decide whether a REST page summary holds a usable photo of `place`. Returns {url, page, title} or null. */
export function pickPhoto(j, place) {
  if (!j || j.type !== 'standard') return null;
  const img = j.originalimage;
  const th = j.thumbnail;
  const co = j.coordinates;
  if (!img || !th || !co || typeof img.source !== 'string' || typeof th.source !== 'string') return null;
  if (!/\.jpe?g$/i.test(img.source) || BAD_NAME.test(decodeURIComponent(img.source.split('/').pop() || ''))) return null;
  const ratio = img.width / img.height;
  if (!(img.width >= 960) || !(ratio >= 1.2 && ratio <= 2.6)) return null;
  if (!(typeof co.lat === 'number' && typeof co.lon === 'number') || distKm(place, co) > MAX_KM) return null;
  let url = th.source;
  if (/\/\d+px-/.test(url)) url = url.replace(/\/\d+px-/, '/960px-');
  else if (img.width <= 2600) url = img.source;
  else return null;
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(url)) return null;
  const page = j.content_urls?.desktop?.page;
  return {
    url,
    page: typeof page === 'string' && /^https:\/\/(en|fa)\.wikipedia\.org\//.test(page) ? page : null,
    title: typeof j.title === 'string' ? j.title.slice(0, 80) : '',
  };
}

async function lookup(lang, title, place, signal) {
  const url = `${WIKI[lang]}/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, '_'))}`;
  try {
    return { ok: true, photo: pickPhoto(await getJson(url, { signal, retries: 0, timeout: 7000 }), place) };
  } catch (err) {
    if (err.kind === 'abort') throw err;
    // 404 = no such article (a definite answer); anything else = we don't know
    return { ok: err.status === 404, photo: null };
  }
}

/** Wikipedia photo for a place, from the cache or the network. Resolves null when there is none. */
export async function findPhoto(place, { signal } = {}) {
  const cached = photoGet(place.key);
  if (cached) {
    const age = Date.now() - cached.t;
    if (cached.none ? age < FRESH_NONE_MS : age < FRESH_MS && typeof cached.url === 'string') return cached.none ? null : cached;
  }
  const tries = [];
  if (place.name?.en) tries.push(['en', place.name.en]);
  if (place.name?.fa) tries.push(['fa', place.name.fa]);
  let definite = true;
  for (const [lang, title] of tries) {
    const r = await lookup(lang, title, place, signal);
    if (r.photo) {
      photoPut(place.key, r.photo);
      return r.photo;
    }
    if (!r.ok) definite = false;
  }
  if (tries.length && definite) photoPut(place.key, { none: true });
  return null;
}

/** Load an image off-screen; resolves true when it decoded. */
export function preload(url, ms = 9000) {
  return new Promise((resolve) => {
    const im = new Image();
    const timer = setTimeout(() => {
      im.onload = im.onerror = null;
      resolve(false);
    }, ms);
    im.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    im.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    im.referrerPolicy = 'no-referrer';
    im.decoding = 'async';
    im.src = url;
  });
}
