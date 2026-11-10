/* Skyview — place search that answers before the network does.
   The bundled gazetteer (data/cities.js) is matched on every keystroke; Open-Meteo geocoding results are merged in afterwards. */
import { CITIES } from '../data/cities.js';
import { pkey } from './store.js';

const ARABIC_TO_PERSIAN = { ي: 'ی', ى: 'ی', ئ: 'ی', ك: 'ک', ة: 'ه', ۀ: 'ه', أ: 'ا', إ: 'ا', آ: 'ا', ؤ: 'و' };

/** Comparison form of a name: lower-case, no accents/diacritics/ZWNJ, Arabic letter variants and Persian digits unified. */
export function norm(s) {
  let x = String(s ?? '')
    .toLowerCase()
    .replace(/[يىئكةۀأإآؤ]/g, (c) => ARABIC_TO_PERSIAN[c]);
  x = x
    .normalize('NFKD')
    .replace(/[̀-ͯ‌-‏ـً-ٰٟ]/g, '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return x.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const INDEX = CITIES.map(([en, fa, lat, lon, tz, subEn, subFa, extra], rank) => {
  const keys = [norm(en), norm(fa)];
  if (extra) keys.push(norm(extra));
  return {
    rank,
    keys: keys.map((k) => ({ k, ns: k.replace(/ /g, '') })),
    place: {
      key: pkey(lat, lon),
      name: { en, fa },
      sub: { en: subEn, fa: subFa },
      lat,
      lon,
      tz,
    },
  };
});

function scoreKey(q, qns, { k, ns }) {
  if (k === q) return 100;
  if (k.startsWith(q)) return 85;
  if (` ${k}`.includes(` ${q}`)) return 65; // a later word starts with the query
  if (q.length >= 3 && k.includes(q)) return 40;
  if (qns.length >= 3 && ns.includes(qns)) return 35; // "bandarabbas" ↔ "bandar abbas"
  return 0;
}

/** Best gazetteer matches for what the user has typed so far (instant, offline). */
export function searchLocal(query, limit = 6) {
  const q = norm(query);
  if (!q) return [];
  const qns = q.replace(/ /g, '');
  const hits = [];
  for (const e of INDEX) {
    let best = 0;
    for (const key of e.keys) {
      const s = scoreKey(q, qns, key);
      if (s > best) best = s;
    }
    if (best) hits.push({ e, s: best * 1000 - e.rank });
  }
  hits.sort((a, b) => b.s - a.s);
  return hits.slice(0, limit).map((h) => ({ ...h.e.place, local: true }));
}

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.15 && Math.abs(a.lon - b.lon) < 0.15;

/** Local hits first, then network results that are not the same city (within ~15 km of a hit already listed). */
export function mergeResults(local, remote, max = 10) {
  const out = local.slice(0, max);
  const seen = new Set(out.map((p) => p.key));
  for (const r of remote) {
    if (out.length >= max) break;
    if (seen.has(r.key) || local.some((l) => near(l, r))) continue;
    seen.add(r.key);
    out.push(r);
  }
  return out;
}
