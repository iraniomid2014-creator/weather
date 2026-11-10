/* Skyview — original SVG icon sprite (weather icons on a 64×64 grid, UI icons on a 24×24 stroke grid). */

/* ------------------------------------------------------------- weather icons */
const f = (n) => Math.round(n * 100) / 100;

function rays(cx, cy, r1, r2, count = 8, width = 3.4, color = '#ffc040') {
  let d = '';
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    d += `M${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}L${f(cx + Math.cos(a) * r2)} ${f(cy + Math.sin(a) * r2)}`;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
}

/** Crescent = circle 1 minus circle 2 (both given by centre and radius). */
function crescent(c1x, c1y, r1, c2x, c2y, r2) {
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const xm = c1x + (a * dx) / d;
  const ym = c1y + (a * dy) / d;
  const P = [xm + (h * dy) / d, ym - (h * dx) / d];
  const Q = [xm - (h * dy) / d, ym + (h * dx) / d];
  return `M${f(P[0])} ${f(P[1])}A${r1} ${r1} 0 1 0 ${f(Q[0])} ${f(Q[1])}A${r2} ${r2} 0 0 1 ${f(P[0])} ${f(P[1])}Z`;
}

const sun = (cx, cy, r, withRays = true) =>
  `${withRays ? rays(cx, cy, r + 4.5, r + 9) : ''}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#g-sun)"/>`;
const moon = (cx, cy, r) =>
  `<path d="${crescent(cx, cy, r, cx + r * 0.42, cy - r * 0.34, r * 0.82)}" fill="url(#g-moon)"/>`;
const stars = (pts) => pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:var(--star,#fff)" opacity=".85"/>`).join('');
const cloud = (fill = 'g-cloud', tx = 0, ty = 0, s = 1) =>
  `<g transform="translate(${tx} ${ty}) scale(${s})" fill="url(#${fill})"><circle cx="22" cy="38" r="9"/><circle cx="33" cy="31" r="12"/><circle cx="45" cy="38" r="9"/><rect x="18" y="36" width="31" height="11" rx="5.5"/></g>`;
const drops = (xs, y1, y2, w = 3.2) =>
  xs.map((x) => `<path d="M${x} ${y1}l-2.6 ${y2 - y1}" stroke="url(#g-drop)" stroke-width="${w}" stroke-linecap="round" fill="none"/>`).join('');
const flakes = (pts, r = 2.4) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" style="fill:var(--flake,#fff)"/>`).join('');
const bolt = '<path d="M34 42L26 54h6l-3 8 11-13h-6l3-7z" fill="url(#g-bolt)"/>';

const WEATHER = {
  'wx-clear-day': sun(32, 32, 11.5),
  'wx-clear-night': `${moon(31, 32, 17)}${stars([[46, 16, 1.7], [52, 28, 1.2], [14, 14, 1.3]])}`,
  'wx-partly-day': `${sun(23, 23, 8.5)}${cloud('g-cloud', 3, 8, 0.95)}`,
  'wx-partly-night': `${moon(22, 22, 11)}${stars([[40, 12, 1.4], [8, 34, 1.2]])}${cloud('g-cloud', 3, 8, 0.95)}`,
  'wx-overcast': `${cloud('g-cloud-d', -6, -7, 0.85)}${cloud('g-cloud', 4, 6, 0.95)}`,
  'wx-fog': `${cloud('g-cloud', 0, -7, 1)}<path d="M13 47h38M18 53.5h30M13 60h22M40 60h11" stroke="#b9c8da" stroke-width="3.2" stroke-linecap="round" fill="none"/>`,
  'wx-drizzle': `${cloud('g-cloud-d', 0, -4, 1)}${drops([24, 34, 44], 47, 53, 2.6)}`,
  'wx-rain': `${cloud('g-cloud-d', 0, -4, 1)}${drops([25, 35, 45], 47, 57)}`,
  'wx-rainHeavy': `${cloud('g-cloud-d', 0, -6, 1)}${drops([20, 29, 38, 47], 45, 59, 3.4)}`,
  'wx-showers-day': `${sun(22, 22, 8)}${cloud('g-cloud-d', 3, 2, 0.95)}${drops([27, 38, 49], 47, 57)}`,
  'wx-showers-night': `${moon(21, 21, 10.5)}${cloud('g-cloud-d', 3, 2, 0.95)}${drops([27, 38, 49], 47, 57)}`,
  'wx-sleet': `${cloud('g-cloud-d', 0, -4, 1)}${drops([24, 42], 47, 57)}${flakes([[33, 52], [49, 55]], 2.2)}`,
  'wx-snow': `${cloud('g-cloud', 0, -4, 1)}${flakes([[23, 52], [33, 57], [43, 52]])}`,
  'wx-snowHeavy': `${cloud('g-cloud-d', 0, -6, 1)}${flakes([[20, 49], [30, 54], [40, 49], [26, 60], [46, 56]], 2.6)}`,
  'wx-thunder': `${cloud('g-cloud-d', 0, -8, 1)}${bolt}`,
};

const GRADIENTS = `<defs>
<linearGradient id="g-sun" gradientUnits="userSpaceOnUse" x1="0" y1="10" x2="0" y2="54"><stop offset="0" stop-color="#ffe58f"/><stop offset="1" stop-color="#ffa82a"/></linearGradient>
<linearGradient id="g-moon" gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="56" y2="56"><stop offset="0" style="stop-color:var(--mn-0,#fcf7da)"/><stop offset="1" style="stop-color:var(--mn-1,#b6c2e8)"/></linearGradient>
<linearGradient id="g-cloud" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="52"><stop offset="0" style="stop-color:var(--cl-0,#ffffff)"/><stop offset="1" style="stop-color:var(--cl-1,#c3d3e7)"/></linearGradient>
<linearGradient id="g-cloud-d" gradientUnits="userSpaceOnUse" x1="0" y1="14" x2="0" y2="48"><stop offset="0" style="stop-color:var(--cld-0,#c9d4e2)"/><stop offset="1" style="stop-color:var(--cld-1,#8397ae)"/></linearGradient>
<linearGradient id="g-drop" gradientUnits="userSpaceOnUse" x1="0" y1="42" x2="0" y2="62"><stop offset="0" stop-color="#92d5ff"/><stop offset="1" stop-color="#3f90e8"/></linearGradient>
<linearGradient id="g-bolt" gradientUnits="userSpaceOnUse" x1="0" y1="40" x2="0" y2="62"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#ffaa24"/></linearGradient>
</defs>`;

/* ------------------------------------------------------------------ UI icons */
const UI = {
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h10M18 17h2"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>',
  refresh: '<path d="M19.9 13.4A8 8 0 1 1 17.1 5.9"/><path d="M19.1 3.6l.7 4.5-4.6.1z" fill="currentColor"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevDown: '<path d="M6.5 9.5l5.5 5.5 5.5-5.5"/>',
  drop: '<path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0c0-4.3 6-10.5 6-10.5z"/>',
  wind: '<path d="M3 9h10.5a2.5 2.5 0 1 0-2.5-2.5M3 14h14a2.5 2.5 0 1 1-2.5 2.5M3 19h6"/>',
  gauge: '<path d="M4.5 17.5a8.5 8.5 0 1 1 15 0"/><path d="M12 14l3.5-4"/><circle cx="12" cy="14" r="1" fill="currentColor"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  uv: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  cloud: '<path d="M7 18.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.6 9.2 4.7 4.7 0 0 0 7 18.5z"/>',
  umbrella: '<path d="M12 3.5a9 9 0 0 0-9 9h18a9 9 0 0 0-9-9z"/><path d="M12 12.5v6a2 2 0 0 0 4 0"/>',
  thermo: '<path d="M14 14.5v-9a2 2 0 0 0-4 0v9a4 4 0 1 0 4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.7" r=".8" fill="currentColor"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  wifiOff: '<path d="M3.5 3.5l17 17M8.6 12.4A9 9 0 0 1 12 11.6M5 9.2a13 13 0 0 1 4-1.8M16 12.1a9 9 0 0 0-1-.6M19 9.2a13 13 0 0 0-3.5-1.9M9.6 15.7a4.5 4.5 0 0 1 4.8 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  arrowUp: '<path d="M12 19.5v-15M6.5 10l5.5-5.5L17.5 10"/>',
  shield: '<path d="M12 3.5l7.5 2.8v5.4c0 4.4-3.2 7.8-7.5 9-4.3-1.2-7.5-4.6-7.5-9V6.3z"/>',
  sparkle: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9-1.9 5.6-1.9-5.6L4.5 11l5.6-1.9z"/>',
};

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${GRADIENTS}${Object.entries(
  WEATHER,
)
  .map(([id, body]) => `<symbol id="${id}" viewBox="0 0 64 64">${body}</symbol>`)
  .join('')}${Object.entries(UI)
  .map(
    ([id, body]) =>
      `<symbol id="i-${id}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></symbol>`,
  )
  .join('')}</svg>`;

export const UI_ICON_NAMES = Object.keys(UI);
export const WEATHER_ICON_IDS = Object.keys(WEATHER);

/** Insert the sprite once (idempotent). */
export function injectSprite() {
  if (document.getElementById('skyview-sprite')) return;
  const holder = document.createElement('div');
  holder.id = 'skyview-sprite';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = SPRITE;
  document.body.prepend(holder);
}

/** Stroke icon as an HTML string. */
export const ic = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
/** Weather icon (sprite id from weatherMeta().sprite). */
export const wx = (sprite, cls = '') =>
  `<svg class="wx ${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#${sprite}"/></svg>`;
