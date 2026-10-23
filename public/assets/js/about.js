// About page: the fingerprint, the coin ticker and the two small tool previews.

import { $, esc, avatarColor, hash32, onVisible } from './ui.js';
import { createPrint3D } from './print3d.js';

// Shown when there is no live trending list (no server, or it failed).
const FALLBACK_COINS = ['BONK', 'WIF', 'PENGU', 'FARTCOIN', 'POPCAT', 'TRUMP', 'PNUT', 'MEW', 'GOAT', 'MOODENG', 'BOME', 'PUMP', 'USELESS', 'GIGA', 'MICHI', 'CHILLGUY']
  .map((symbol) => ({ symbol, icon: null, change: null }));
const TICK_COLORS = ['#f2b84b', '#5be39c', '#ff7ab6', '#7cc7ff', '#b18cff', '#ff8a5c', '#e7e2d6', '#ffd84d', '#4fd1c5', '#f87171'];

export function initAbout(env) {
  const stage = $('#print-stage');
  const canvas = $('#print-canvas');
  const hint = $('#touch-hint');
  let print = null;
  try {
    print = createPrint3D({
      stage,
      canvas,
      onTouch: () => hint.classList.add('done'),
    });
  } catch (err) {
    console.warn('3D print unavailable', err);
  }
  if (!print) {
    canvas.hidden = true;
    // An <svg> has no .hidden property, so drop the attribute itself.
    stage.querySelector('.print-fallback').removeAttribute('hidden');
    hint.hidden = true;
  } else if (matchMedia('(hover: none)').matches) {
    hint.querySelector('[data-touch-text]').textContent = 'Tap the print';
  }

  loadCoins(env).then(({ items, live }) => {
    renderTicker(items, live);
    print?.setCoins(items);
  });
  renderMiniKolibri(env);
  const stopMoth = startMiniMoth(env);

  return {
    setActive(on) {
      print?.setVisible(on);
      stopMoth.active(on);
    },
  };
}

async function loadCoins(env) {
  if (env.mode === 'server') {
    try {
      const res = await fetch('/api/trending', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items) && data.items.length) return { items: data.items, live: data.source !== 'fallback' };
      }
    } catch {
      /* use the fallback */
    }
  }
  return { items: FALLBACK_COINS, live: false };
}

function pct(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const p = v * 100;
  const body = Math.abs(p) >= 100 ? Math.round(Math.abs(p)).toLocaleString('en-US') : Math.abs(p).toFixed(1);
  return `${p >= 0 ? '+' : '−'}${body}%`;
}

function renderTicker(items, live) {
  const run = $('#ticker-run');
  const label = document.querySelector('[data-ticker-label]');
  label.textContent = live ? 'Trending on Solana' : 'In the print';
  const one = items
    .map((c) => {
      const color = TICK_COLORS[hash32(c.symbol.toUpperCase()) % TICK_COLORS.length];
      const icon = c.icon ? `<img src="${esc(c.icon)}" alt="" loading="lazy" onerror="this.remove()">` : esc(c.symbol.slice(0, 1));
      const ch = pct(c.change);
      const tone = c.change > 0 ? 'up' : c.change < 0 ? 'down' : '';
      return `<span class="tk"><i style="--c:${color}">${icon}</i><b>$${esc(c.symbol)}</b>${ch ? `<span class="${tone}">${ch}</span>` : ''}</span>`;
    })
    .join('');
  // Two copies side by side make the loop seamless.
  run.innerHTML = one + one;
  const seconds = Math.max(30, items.length * 4.2);
  run.style.animationDuration = `${seconds}s`;
}

// ------------------------------------------------------------------ Kolibri preview

async function renderMiniKolibri(env) {
  const box = $('#mini-kolibri');
  let item = null;
  let sample = true;
  if (env.mode === 'server') {
    try {
      const res = await fetch('/api/kolibri/leaderboard?limit=5', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        item = (data.items || []).find((x) => x.summary && x.summary.grade) || null;
        if (item) sample = Boolean(env.site && env.site.demo);
      }
    } catch {
      /* fall back to the sample */
    }
  }
  if (!item) {
    const demo = (await import('./kolibri/demo-data.js')).default;
    item = demo.leaderboard[0];
    sample = true;
  }
  const s = item.summary;
  const a = item.author || {};
  const handle = a.platform === 'tg' ? `t.me/${a.handle}` : `@${a.handle}`;
  const share = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
  const ret = (v) => (typeof v === 'number' ? (v >= 1 ? `${(1 + v).toFixed(1)}x` : pct(v)) : '—');
  const bars = (await barSeries(item, env)).map((r) => {
    if (r == null) return '<i style="height:4px;background:var(--dim)"></i>';
    const h = Math.max(4, Math.min(26, Math.abs(Math.log1p(Math.abs(r) * 3)) * 9));
    return `<i style="height:${h}px;background:${r > 0 ? 'var(--up)' : 'var(--down)'};transform:translateY(${r > 0 ? -h / 2 : h / 2}px)"></i>`;
  });
  box.innerHTML = `
    <div class="mk-row">
      <span class="mk-av" style="--av:${avatarColor(item.key)}">${esc((a.name || a.handle || '?').slice(0, 1).toUpperCase())}</span>
      <span><span class="mk-name">${esc(a.name || a.handle)}</span><br><span class="mk-handle">${esc(handle)}${sample ? ' · sample' : ''}</span></span>
      <span class="grade t-${esc(s.tone || 'none')}">${esc(s.grade || '?')}</span>
    </div>
    <div class="mk-stats">
      <div><b>${s.calls}</b><span>calls</span></div>
      <div><b>${share(s.up1h)}</b><span>up after 1h</span></div>
      <div><b class="${s.med1h > 0 ? 'up' : s.med1h < 0 ? 'down' : ''}">${ret(s.med1h)}</b><span>median after 1h</span></div>
    </div>
    <div class="mk-bars">${bars.join('')}</div>`;
}

async function barSeries(item, env) {
  // The 1-hour result of the caller's recent calls, oldest first.
  let calls = null;
  if (env.mode === 'server' && !(env.site && env.site.demo)) {
    try {
      const a = item.author;
      const res = await fetch(`/api/kolibri/card?platform=${a.platform}&handle=${encodeURIComponent(a.handle)}`);
      if (res.ok) calls = (await res.json()).card?.calls || null;
    } catch {
      calls = null;
    }
  }
  if (!calls) {
    const demo = (await import('./kolibri/demo-data.js')).default;
    calls = (demo.cards[item.key] || Object.values(demo.cards)[0]).calls;
  }
  return calls
    .filter((c) => typeof c.r1h === 'number')
    .slice(0, 18)
    .reverse()
    .map((c) => c.r1h);
}

// ------------------------------------------------------------------ Moth preview

function startMiniMoth(env) {
  const box = $('#mini-moth');
  let timer = null;
  let active = true;
  let visible = false;
  let demoStore = null;
  let sample = env.mode !== 'server';

  async function snapshot() {
    if (env.mode === 'server') {
      try {
        const res = await fetch('/moth/api/snapshot?window=60', { cache: 'no-store' });
        if (res.ok) {
          sample = Boolean(env.site && env.site.demo);
          return await res.json();
        }
      } catch {
        /* fall through to the sample */
      }
    }
    if (!demoStore) {
      const { createDemoFeed } = await import('./moth/engine.js');
      demoStore = await createDemoFeed();
    }
    sample = true;
    return demoStore.snapshot(60);
  }

  async function refresh() {
    if (!active || !visible) return;
    const snap = await snapshot().catch(() => null);
    if (!snap || !snap.words) return;
    const rows = [...snap.words].sort((a, b) => b.z - a.z || b.c - a.c).slice(0, 5);
    box.innerHTML =
      rows
        .map((w) => {
          const ch = !snap.warm ? { t: '—', c: 'flat' } : !w.p ? { t: 'New', c: 'new' } : changeText(w.c, w.p);
          return `<div class="mm-row"><span class="mm-w">${esc(w.w)}</span>${spark(w.s)}<span class="mm-c">${w.c}</span><span class="mm-d ${ch.c}">${ch.t}</span></div>`;
        })
        .join('') + (sample ? '<p class="mk-handle" style="margin:10px 0 0">Sample data · open the radar for live launches</p>' : '');
  }

  onVisible(box, (v) => {
    visible = v;
    if (v) refresh();
  });
  timer = setInterval(refresh, 15000);
  return {
    active(on) {
      active = on;
      if (on) refresh();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function changeText(c, p) {
  const ratio = c / p;
  if (ratio >= 3) return { t: `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`, c: 'up' };
  const pctv = Math.round((ratio - 1) * 100);
  if (pctv === 0) return { t: '0%', c: 'flat' };
  return pctv > 0 ? { t: `+${pctv}%`, c: 'up' } : { t: `−${Math.abs(pctv)}%`, c: 'down' };
}

function spark(series) {
  const s = series || [];
  if (!s.length) return '<svg viewBox="0 0 70 18"></svg>';
  const n = s.length;
  const w = (70 - (n - 1)) / n;
  const max = Math.max(1, ...s);
  return `<svg viewBox="0 0 70 18" preserveAspectRatio="none">${s
    .map((v, i) => {
      const h = v ? Math.max(2, (v / max) * 18) : 1;
      return `<rect x="${(i * (w + 1)).toFixed(2)}" y="${(18 - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="currentColor" opacity="${v ? (0.35 + 0.65 * (i / (n - 1))).toFixed(2) : 0.2}"/>`;
    })
    .join('')}</svg>`;
}
