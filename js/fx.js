/* Skyview — background weather particles (rain / snow) and lightning flash.
   Light on purpose: ≤150 simple particles, DPR capped at 1.5, paused while the tab is hidden. */
import { clamp, reducedMotion } from './util.js';

export function createFx(canvas, flashEl) {
  const g = canvas.getContext('2d');
  let effect = null;
  let parts = [];
  let raf = 0;
  let last = 0;
  let W = 0;
  let H = 0;
  let flashTimer = 0;
  let light = false;

  function size() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    parts = [];
    light = document.documentElement.dataset.theme === 'light';
    if (!effect) return;
    const area = W * H;
    if (effect.type === 'rain') {
      const n = Math.round(clamp((area / 9000) * effect.density, 18, 150));
      for (let k = 0; k < n; k++) {
        parts.push({ x: Math.random() * (W + 80), y: Math.random() * H, l: 10 + Math.random() * 16, v: 520 + Math.random() * 380, a: 0.22 + Math.random() * 0.34 });
      }
    } else {
      const n = Math.round(clamp((area / 14000) * effect.density, 18, 90));
      for (let k = 0; k < n; k++) {
        parts.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.6, v: 28 + Math.random() * 52, ph: Math.random() * 6.28, a: 0.45 + Math.random() * 0.4 });
      }
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    g.clearRect(0, 0, W, H);
    if (!effect) return;
    if (effect.type === 'rain') {
      g.lineWidth = 1.2;
      g.lineCap = 'round';
      for (const p of parts) {
        p.y += p.v * dt;
        p.x -= p.v * dt * 0.18;
        if (p.y > H + 20) {
          p.y = -20;
          p.x = Math.random() * (W + 80);
        }
        g.strokeStyle = light ? `rgba(50,95,150,${p.a + 0.12})` : `rgba(200,225,255,${p.a})`;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + p.l * 0.18, p.y - p.l);
        g.stroke();
      }
    } else {
      for (const p of parts) {
        p.ph += dt * 1.1;
        p.y += p.v * dt;
        p.x += Math.sin(p.ph) * 18 * dt;
        if (p.y > H + 8) {
          p.y = -8;
          p.x = Math.random() * W;
        }
        g.fillStyle = light ? `rgba(110,140,180,${p.a})` : `rgba(255,255,255,${p.a})`;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, 6.2832);
        g.fill();
      }
    }
  }

  function start() {
    if (raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    g.clearRect(0, 0, W, H);
  }

  function scheduleFlash() {
    clearTimeout(flashTimer);
    if (!effect?.lightning) return;
    flashTimer = setTimeout(() => {
      if (!document.hidden && flashEl) {
        flashEl.classList.remove('on');
        void flashEl.offsetWidth; // restart the CSS animation
        flashEl.classList.add('on');
      }
      scheduleFlash();
    }, 5000 + Math.random() * 9000);
  }

  /** effect: {type:'rain'|'snow', density, lightning} or null. enabled=false forces "off". */
  function set(next, enabled = true) {
    effect = enabled && next && !reducedMotion() ? next : null;
    size();
    seed();
    if (effect) start();
    else stop();
    scheduleFlash();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (effect) start();
  });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      size();
      seed();
    }, 150);
  });

  return { set, reseed: () => seed(), isActive: () => !!effect };
}
