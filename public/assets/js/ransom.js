// The site name in cut-out "ransom note" letters: every letter its own scrap of
// paper, font and angle. The layout comes from a seed, so it is stable between visits.

import { hash32, mulberry32 } from './ui.js';

const FACES = [
  { ff: '"UnifrakturMaguntia", "Old English Text MT", serif', fs: 1.08, ty: '0.03em' },
  { ff: '"Abril Fatface", Georgia, serif', fs: 1.02 },
  { ff: '"Special Elite", "Courier New", monospace', fs: 1.0, ty: '0.04em' },
  { ff: '"Bungee", Impact, sans-serif', fs: 0.86 },
  { ff: '"Rubik Mono One", "Arial Black", sans-serif', fs: 0.78 },
  { ff: '"Playfair Display", Georgia, serif', fs: 1.06, fw: 900, fst: 'italic' },
  { ff: '"Alfa Slab One", Rockwell, serif', fs: 0.92 },
  { ff: '"Rye", Georgia, serif', fs: 0.9, ty: '0.04em' },
  { ff: '"Archivo", Arial, sans-serif', fs: 1.0, fw: 900 },
];

const PAPER_LIGHT = [
  { bgc: '#f1eee6', fgc: '#121212', edge: '#faf8f3' },
  { bgc: '#d9d4c8', fgc: '#151515', edge: '#efebe3' },
  { bgc: '#e8e4da', fgc: '#2a2622', edge: '#f6f3ec' },
];
const PAPER_DARK = [
  { bgc: '#3a3936', fgc: '#f4f2ec', edge: '#f4f2ec' },
  { bgc: '#151515', fgc: '#f4f2ec', edge: '#e6e3dc' },
  { bgc: '#5a5852', fgc: '#ffffff', edge: '#eeebe4' },
];
const PAPER_ACCENT = { bgc: '#ff5a1f', fgc: '#140701', edge: '#ffd8c6' };

export function renderRansom(el, text, { seed } = {}) {
  const word = String(text || '').trim() || 'PUMPRINT';
  const rnd = mulberry32(seed ?? hash32(word.toUpperCase()));
  const letters = [...word];
  // The letter where the two words overlap gets the accent: PUM[P]RINT.
  const accentAt = Math.min(letters.length - 1, Math.max(0, Math.floor(letters.length / 2) - 1));
  el.textContent = '';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', word);
  let lastFace = -1;
  let dark = rnd() < 0.5;
  letters.forEach((ch, i) => {
    if (ch === ' ') {
      const gap = document.createElement('span');
      gap.style.width = '0.32em';
      el.append(gap);
      return;
    }
    let face = Math.floor(rnd() * FACES.length);
    if (face === lastFace) face = (face + 1 + Math.floor(rnd() * (FACES.length - 1))) % FACES.length;
    lastFace = face;
    const f = FACES[face];
    // Alternate light and dark scraps, with the odd repeat so it doesn't look regular.
    if (rnd() < 0.78) dark = !dark;
    const paper = i === accentAt ? PAPER_ACCENT : (dark ? PAPER_DARK : PAPER_LIGHT)[Math.floor(rnd() * 3)];
    const lower = i > 0 && /[A-Za-z]/.test(ch) && rnd() < 0.34;
    const span = document.createElement('span');
    span.className = 'rl';
    span.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.textContent = lower ? ch.toLowerCase() : ch.toUpperCase();
    span.append(inner);
    const s = span.style;
    s.setProperty('--ff', f.ff);
    s.setProperty('--fs', `${(f.fs * (0.92 + rnd() * 0.2)).toFixed(3)}em`);
    if (f.fw) s.setProperty('--fw', f.fw);
    if (f.fst) s.setProperty('--fst', f.fst);
    if (f.ty) s.setProperty('--ty', f.ty);
    s.setProperty('--bgc', paper.bgc);
    s.setProperty('--fgc', paper.fgc);
    s.setProperty('--edge', paper.edge);
    s.setProperty('--r', `${((rnd() - 0.5) * 15).toFixed(1)}deg`);
    s.setProperty('--y', `${((rnd() - 0.5) * 0.16).toFixed(3)}em`);
    s.setProperty('--rad', `${(rnd() * 0.08).toFixed(3)}em`);
    el.append(span);
  });
}

export function renderAllRansom(text) {
  for (const el of document.querySelectorAll('[data-ransom]')) renderRansom(el, text);
}
