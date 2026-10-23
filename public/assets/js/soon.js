// The Telegram page while the channel is not open yet: "Coming soon" over a big, dim
// fingerprint that fills the whole background. The ridges come from the same field as
// the print on the About page, drawn once to a canvas and softened with CSS.

import { $, reduceMotion } from './ui.js';
import { renderRansom } from './ransom.js';
import { phase, gap, rho } from './print3d.js';

const SPACING = 0.0255; // ridge period in print units, as in the hero print
const PIXELS = 650000; // canvas pixel budget: the picture is blurred, so it can be coarse
const ALPHA = 0.16; // how strongly the ridges show over the page background
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function initSoon() {
  const view = $('#view-telegram');
  const bg = view.querySelector('.soon-bg');
  const canvas = $('#soon-print');
  const title = view.querySelector('[data-ransom-text]');
  renderTitle(title, title.dataset.ransomText);

  let drawn = '';
  let active = false;
  let timer = 0;

  function draw() {
    const w = bg.clientWidth;
    const h = bg.clientHeight;
    if (!w || !h) return;
    const key = `${w}x${h}`;
    if (key === drawn) return;
    drawn = key;
    paint(canvas, w, h);
    canvas.classList.add('ready');
  }

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => active && draw(), 180);
    }).observe(bg);
  }

  // The print drifts a little with the pointer.
  if (!reduceMotion && matchMedia('(hover: hover)').matches) {
    view.addEventListener('pointermove', (e) => {
      const r = view.getBoundingClientRect();
      bg.style.setProperty('--px', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      bg.style.setProperty('--py', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
  }

  return {
    setActive(on) {
      active = on;
      if (on) requestAnimationFrame(draw);
    },
  };
}

// The title in cut-out letters, grouped by word so a narrow screen breaks the line
// between the words and never inside one.
function renderTitle(el, text) {
  renderRansom(el, text);
  const words = [];
  let word = null;
  for (const node of [...el.children]) {
    if (!node.classList.contains('rl')) {
      node.remove();
      word = null;
      continue;
    }
    if (!word) {
      word = document.createElement('span');
      word.className = 'rw';
      words.push(word);
    }
    word.append(node);
  }
  el.append(...words);
}

function paint(canvas, cssW, cssH) {
  const k = Math.min(1, Math.sqrt(PIXELS / (cssW * cssH)));
  const W = Math.max(1, Math.round(cssW * k));
  const H = Math.max(1, Math.round(cssH * k));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  // The fingertip (1.27 print units tall) is a bit taller than the screen, and on wide
  // screens the ridges carry on past its edge, so the whole background is print.
  const unit = Math.max(H * 1.16, W * 0.62) / 1.27;
  const cx = W * 0.5;
  const cy = H * 0.53;
  for (let j = 0; j < H; j++) {
    const y = (cy - j) / unit;
    for (let i = 0; i < W; i++) {
      const x = (i - cx) / unit;
      const s = Math.cos((2 * Math.PI * phase(x, y)) / SPACING);
      const v = ss(0.05, 0.7, s) * gap(x, y);
      if (v < 0.004) continue;
      const inside = 0.4 + 0.6 * (1 - ss(0.9, 1.12, rho(x, y)));
      const o = (j * W + i) * 4;
      d[o] = 232;
      d[o + 1] = 226;
      d[o + 2] = 214;
      d[o + 3] = Math.round(255 * ALPHA * v * inside);
    }
  }
  ctx.putImageData(img, 0, 0);
}
