// Chameleonscope: the trenches of pump.fun (Solana) and Pons (Robinhood Chain) in one terminal.
// Every launch goes through the rug gate; what passes gets a verdict. Calls are written at the
// cap they were made at and followed to the end. Reads this site's engine (/api/chameleon/*), or
// a frozen sample of the terminal's preview mode without a server.

import { esc, hash32 } from '../ui.js';

const POLL_MS = 5000;
const CHAINS = [
  ['solana', 'Solana', 'pump.fun'],
  ['robinhood', 'Robinhood Chain', 'Pons'],
];
const GROUPS = [
  ['new', 'New'],
  ['almost', 'Almost bonded'],
  ['graduated', 'Migrated'],
  ['top', 'Top'],
];
const VERDICT = { STRONG: 'up', WATCH: 'warn', CAUTION: 'down', AVOID: 'down', RUGGED: 'down' };
const STATUS = { runner: ['Runner', 'up'], hit: ['Hit 2x', 'up'], open: ['Open', 'acc'], flat: ['Flat', 'mute'], faded: ['Faded', 'mute'], rugged: ['Rugged', 'down'] };

// ------------------------------------------------------------------ formatting

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function usd(v) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${s}$${Math.round(a)}`;
}
const pct = (v, digits = 0) => (isNum(v) ? `${(v * 100).toFixed(digits)}%` : '—');
const chg = (v) => {
  if (!isNum(v)) return '<span class="dim">—</span>';
  const a = Math.abs(v);
  const body = a >= 1000 ? `${Math.round(a / 100) / 10}K` : a >= 100 ? Math.round(a) : a.toFixed(1);
  return `<span class="${v >= 0 ? 'x-up' : 'x-down'}">${v >= 0 ? '+' : '−'}${body}%</span>`;
};
const xm = (v) => (isNum(v) ? `${v >= 10 ? Math.round(v) : v.toFixed(2).replace(/0$/, '')}x` : '—');
const age = (ms, now) => {
  if (!isNum(ms)) return '—';
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
const verdictPill = (v) => (v ? `<span class="pill ${VERDICT[v] || 'mute'}">${esc(v)}</span>` : '');

/** The token's picture, or a drawn stand-in from its address. */
function avatar(t, size = 40) {
  const h = hash32(String(t.address || t.id || t.symbol || '?'));
  const a = h % 360;
  const b = (a + 40 + (h >> 9) % 80) % 360;
  const letter = esc(String(t.symbol || '?').replace(/^\$/, '').slice(0, 2).toUpperCase());
  const img = t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="cs-av" style="--a:${a};--b:${b};width:${size}px;height:${size}px">${letter}${img}</span>`;
}

function links(t) {
  const sol = t.chain === 'solana';
  const out = sol
    ? [
        ['pump.fun', `https://pump.fun/coin/${t.address}`],
        ['GMGN', `https://gmgn.ai/sol/token/${t.address}`],
        ['DEX Screener', `https://dexscreener.com/solana/${t.address}`],
        ['Solscan', `https://solscan.io/token/${t.address}`],
      ]
    : [
        ['Pons', `https://www.ponsfamily.com/token/${t.address}`],
        ['GMGN', `https://gmgn.ai/robinhood/token/${t.address}`],
        ['Blockscout', `https://robinhoodchain.blockscout.com/token/${t.address}`],
      ];
  return out.map(([label, href]) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join('');
}

// ------------------------------------------------------------------ the page

export function initChameleon(env) {
  const root = document.getElementById('c-root');
  const badge = document.querySelector('[data-c-mode]');
  const site = env.site || {};
  const serverOn = env.mode === 'server' && site.chameleon && site.chameleon.on;
  const sample = !serverOn || site.demo;
  const state = { chain: 'solana', group: 'new', feed: null, side: null, timer: null, active: false, demo: null, open: null };

  root.innerHTML = `
    <div class="tool-intro">
      <h1 class="page-title">Every coin, observed.</h1>
      <p>The trenches of pump.fun and Robinhood Chain's Pons in one terminal. Every launch is checked the second it lands: dev share, bundles, snipers, insiders, mint and freeze rights, copies, serial deployers. A coin that fails never shows. The rest get a verdict: STRONG, WATCH or CAUTION.</p>
    </div>
    <div class="cs-controls">
      <div class="seg" role="radiogroup" aria-label="Chain" id="cs-chains">${CHAINS.map(([k, label]) => `<button type="button" role="radio" data-chain="${k}" aria-checked="${k === state.chain}">${label}</button>`).join('')}</div>
      <div class="tk-tabs" role="tablist" id="cs-groups">${GROUPS.map(([k, label]) => `<button type="button" role="tab" data-group="${k}" aria-selected="${k === state.group}">${label} <span class="cs-n" data-n="${k}"></span></button>`).join('')}</div>
    </div>
    <p class="cs-summary" id="cs-summary" aria-live="polite"></p>
    <div class="tk-grid cs-layout">
      <div class="cs-main">
        <div class="cs-cols" aria-hidden="true"><span>Token</span><span>Cap</span><span>Vol 1h</span><span>1h</span><span>Holders</span><span>Dev · top 10</span><span>Verdict</span></div>
        <ol class="cs-feed" id="cs-feed"></ol>
      </div>
      <aside class="cs-side" id="cs-side"></aside>
    </div>
    <details class="panel how cs-how">
      <summary><h2>How the terminal judges a coin</h2><svg aria-hidden="true"><use href="#i-chevron"/></svg></summary>
      <dl>
        <dt>The rug gate</dt><dd>A coin is hidden when any one sign shows: Jupiter's suspicious flag, a honeypot, live mint or freeze rights, an upgradeable contract, wash trading, unlocked liquidity, a copy of a name launched in the last day, the dev holding 10% or more on the curve (5% after migration), bundles, snipers or insiders at 30% or more, a top 10 holding half the supply, or a deployer with five launches and none graduated. Coins that already rugged, went stale or never found buyers are hidden too.</dd>
        <dt>The verdict</dt><dd>Three scores from 0 to 100, safety, momentum and community, each made of named rules you can read on the coin's card. STRONG needs safety 70+, momentum 65+, and a coin at least 5 minutes old with 20 holders and 20 trades in the last hour. CAUTION is safety under 60. Everything else is WATCH.</dd>
        <dt>Calls</dt><dd>The terminal calls a coin itself, at most four an hour per chain: a bond call 4 to 30 minutes after migration when it holds its graduation cap with real volume, and a breakout when it sets a new high well above it. Every call is written at the cap of that moment and followed for a week: the peak, the 2x to 100x marks, and the rug if it comes.</dd>
        <dt>Quantum radar</dt><dd>Coins named on the quantum narrative (quantum, qubit, quant, Q-Day, post-quantum, Schrödinger and the rest), behind the same gate, hottest first: an hour's volume plus four times the last five minutes.</dd>
        <dt>Sources</dt><dd>pump.fun's stream (PumpPortal), the Solana RPC, Jupiter, Robinhood Chain's own nodes and Blockscout, all read by this site's server. Smart money and KOL buys come from GMGN and need a GMGN key on the server. The engine is <a href="https://github.com/shmidtqq65/chameleonscope" target="_blank" rel="noopener noreferrer">shmidtqq65/chameleonscope</a> (MIT), unchanged, running behind this page.</dd>
      </dl>
    </details>
    <div class="cs-sheet" id="cs-sheet" hidden>
      <div class="cs-sheet-bg" data-close></div>
      <section class="cs-sheet-card" role="dialog" aria-modal="true" aria-label="Token" tabindex="-1"></section>
    </div>`;
  if (badge) badge.textContent = sample ? 'Sample data' : 'Solana · Robinhood Chain';

  const els = {
    chains: root.querySelector('#cs-chains'),
    groups: root.querySelector('#cs-groups'),
    feed: root.querySelector('#cs-feed'),
    side: root.querySelector('#cs-side'),
    summary: root.querySelector('#cs-summary'),
    sheet: root.querySelector('#cs-sheet'),
    card: root.querySelector('.cs-sheet-card'),
  };

  // ---------------------------------------------------------------- data

  async function demo() {
    if (!state.demo) {
      const d = (await import('./demo-data.js')).default;
      const shift = Date.now() - d.builtAt;
      const move = (o) => {
        if (Array.isArray(o)) return o.map(move);
        if (!o || typeof o !== 'object') return o;
        const r = {};
        for (const [k, v] of Object.entries(o)) r[k] = (k === 'createdAt' || k === 'at' || k === 'graduatedAt') && isNum(v) ? v + shift : move(v);
        return r;
      };
      state.demo = { snap: move(d.snap), details: move(d.details) };
    }
    return state.demo;
  }

  async function load() {
    if (serverOn) {
      try {
        const [f, s] = await Promise.all([
          fetch(`/api/chameleon/feed?chain=${state.chain}&group=${state.group}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
          fetch('/api/chameleon/side', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (f) state.feed = f;
        else if (state.feed && (state.feed.chain !== state.chain || state.feed.group !== state.group)) state.feed = null;
        if (s) state.side = s;
      } catch {
        /* keep what we have; the next poll asks again */
      }
      return;
    }
    const d = await demo();
    const snap = d.snap;
    state.feed = { at: snap.at, mode: 'demo', chain: state.chain, group: state.group, ...snap.feeds[state.chain][state.group] };
    state.side = { at: snap.at, mode: 'demo', radar: snap.radar, day: snap.day, calls: snap.calls, known: snap.known, gmgn: false, counts: Object.fromEntries(Object.entries(snap.feeds).map(([c, g]) => [c, Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.total]))])) };
  }

  // ---------------------------------------------------------------- render

  function renderFeed() {
    const f = state.feed;
    const now = Date.now();
    if (!f) {
      els.feed.innerHTML = '<li class="tk-empty">The terminal is starting.</li>';
      return;
    }
    const counts = (state.side && state.side.counts && state.side.counts[state.chain]) || {};
    for (const el of els.groups.querySelectorAll('[data-n]')) el.textContent = counts[el.dataset.n] ?? '';
    const chainMode = f.chainMode ? f.chainMode[state.chain] : f.mode;
    const label = CHAINS.find((c) => c[0] === state.chain);
    els.summary.innerHTML = `${f.total} on ${label[1]} pass the gate${f.hidden ? ` · <b>${f.hidden}</b> hidden by it` : ''}${f.checking ? ` · ${f.checking} being checked` : ''}${chainMode === 'offline' ? ' · <span class="x-down">this chain is not answering right now</span>' : ''}`;
    if (!f.rows.length) {
      els.feed.innerHTML = `<li class="tk-empty">${state.group === 'top' ? 'No established coins listed yet.' : 'Nothing here passes the gate right now.'}</li>`;
      return;
    }
    els.feed.innerHTML = f.rows
      .map((t) => {
        const curve = isNum(t.curve) && !t.complete ? `<span class="cs-curve" title="Bonding curve ${pct(t.curve)}"><i style="width:${Math.max(3, Math.round(t.curve * 100))}%"></i></span>` : '';
        const call = t.call ? `<span class="pill acc" title="Called at ${usd(t.call.mcAtCall)}">Call ${xm(t.call.peakX)}</span>` : '';
        const q = t.quantum ? `<span class="pill mute">${esc(t.quantum)}</span>` : '';
        const flags = (t.flags || []).filter((x) => x.startsWith('!')).slice(0, 2).map((x) => `<span class="cs-flag">${esc(x.slice(1))}</span>`).join('');
        return `<li><button type="button" class="cs-row" data-id="${esc(t.id)}">
          <span class="cs-tok">${avatar(t)}<span class="cs-name"><b>$${esc(t.symbol || '?')}</b> <span class="dim">${esc(t.name || '')}</span><span class="cs-meta">${age(t.createdAt, now)} · ${esc(t.stage || '')}${curve}${call}${q}${flags}</span></span></span>
          <span class="cs-num" data-k="Cap">${usd(t.mc)}</span>
          <span class="cs-num" data-k="Vol 1h">${usd(t.vol)}</span>
          <span class="cs-num" data-k="1h">${chg(t.chg)}</span>
          <span class="cs-num" data-k="Holders">${isNum(t.holders) ? t.holders.toLocaleString('en-US') : '—'}</span>
          <span class="cs-num cs-risk" data-k="Dev · top 10">${pct(t.facts && t.facts.devPct)} · ${pct(t.facts && t.facts.top10)}</span>
          <span class="cs-verdict">${verdictPill(t.verdict)}<span class="cs-scores" title="Safety ${t.scores?.safety ?? '?'} · momentum ${t.scores?.momentum ?? '?'} · community ${t.scores?.community ?? '?'}">${['safety', 'momentum', 'community'].map((k) => `<i style="--v:${(t.scores && t.scores[k]) || 0}"></i>`).join('')}</span></span>
        </button></li>`;
      })
      .join('');
  }

  function renderSide() {
    const s = state.side;
    if (!s) {
      els.side.innerHTML = '';
      return;
    }
    const now = Date.now();
    const radar = s.radar && s.radar[state.chain];
    const day = s.day && s.day[state.chain];
    const calls = (s.calls || []).filter((c) => c.chain === state.chain).slice(0, 8);
    const ix = radar && radar.index;
    const radarHtml =
      radar && radar.cards.length
        ? `<p class="cs-ix">${usd(ix.vol1h)} traded in the hour · ${ix.n} coin${ix.n === 1 ? '' : 's'} moving${ix.leader ? ` · leader <b>$${esc(ix.leader)}</b>` : ''}</p>
          <ol class="cs-radar">${radar.cards
            .slice(0, 6)
            .map((c) => `<li><button type="button" data-id="${esc(c.id)}"><span class="cs-radar-top"><b>$${esc(c.symbol)}</b><span class="pill mute">${esc(c.word || '')}</span><span class="cs-radar-mc">${usd(c.mc)} ${chg(c.chg1h)}</span></span><span class="cs-heat"><i style="width:${c.heatPctOfLeader}%"></i></span></button></li>`)
            .join('')}</ol>`
        : '<p class="tk-empty">No quantum coin is moving on this chain right now.</p>';
    const callsHtml = calls.length
      ? `<ol class="cs-calls">${calls
          .map((c) => {
            const [label, cls] = STATUS[c.status] || [c.status || '—', 'mute'];
            return `<li><button type="button" data-id="${esc(c.id)}"><span class="cs-call-top"><b>$${esc(c.symbol || '?')}</b>${c.kind ? `<span class="dim">${esc(c.kind)}</span>` : ''}<span class="pill ${cls}">${esc(label)}</span><span class="dim cs-ago">${age(c.at, now)} ago</span></span><span class="cs-call-x">called at ${usd(c.mc)} · peak <b class="${c.peakX >= 1 ? 'x-up' : 'x-down'}">${xm(c.peakX)}</b> · now ${xm(c.nowX)}</span></button></li>`;
          })
          .join('')}</ol>`
      : '<p class="tk-empty">No call yet on this chain. The terminal makes at most four an hour, and only on coins that pass the strict bar.</p>';
    const dayHtml = day
      ? `<div class="cs-day"><div><b>${day.launches.toLocaleString('en-US')}</b><span>launched</span></div><div><b>${day.graduated.toLocaleString('en-US')}</b><span>bonded</span></div><div><b>${day.runners}</b><span>runners</span></div></div>${day.best ? `<p class="cs-best">Best: <button type="button" data-id="${esc(day.best.id)}">$${esc(day.best.symbol)}</button> at ${usd(day.best.mc)}${day.best.x ? `, ${xm(day.best.x)} from launch` : ''}</p>` : ''}`
      : '';
    const knownRows = (s.known || []).filter((k) => k.chain === state.chain).slice(0, 6);
    const knownHtml = s.gmgn
      ? knownRows.length
        ? `<ol class="cs-known">${knownRows.map((k) => `<li><b>${esc(k.tw ? `@${k.tw}` : k.tier || 'trader')}</b> bought <b>$${esc(k.symbol || '?')}</b> for ${usd(k.usd)} <span class="dim">${age(k.at, now)} ago</span></li>`).join('')}</ol>`
        : '<p class="tk-empty">No known trader bought a coin in the feed in the last 20 minutes.</p>'
      : `<p class="tk-empty">${sample ? 'Known traders and smart money come from GMGN on the live site.' : 'Smart money and KOL buys turn on with a GMGN key on the server (GMGN_API_KEY).'}</p>`;
    els.side.innerHTML = `
      <section class="tk-card"><h3>Quantum radar <small>${state.chain === 'solana' ? 'Solana' : 'Robinhood Chain'}</small></h3>${radarHtml}</section>
      <section class="tk-card"><h3>Calls <small>written at the cap, followed 7 days</small></h3>${callsHtml}</section>
      <section class="tk-card"><h3>Last 24 hours</h3>${dayHtml}</section>
      <section class="tk-card"><h3>Known traders <small>KOLs and proven wallets</small></h3>${knownHtml}</section>`;
  }

  // ---------------------------------------------------------------- the token card

  async function openToken(id) {
    state.open = id;
    els.sheet.hidden = false;
    document.documentElement.classList.add('cs-locked');
    els.card.innerHTML = '<p class="tk-empty">Reading the coin…</p>';
    els.card.focus();
    let d = null;
    if (serverOn) {
      try {
        const res = await fetch(`/api/chameleon/token?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
        d = res.ok ? await res.json() : null;
      } catch {
        d = null;
      }
    } else {
      d = (await demo()).details[id] || null;
    }
    if (state.open !== id) return;
    if (!d) {
      els.card.innerHTML = `<button class="icon-btn cs-x" type="button" data-close aria-label="Close"><svg aria-hidden="true"><use href="#i-close"/></svg></button><p class="tk-empty">${sample ? 'The sample only has the first coins of each feed. On the live site every coin opens.' : 'The terminal is no longer watching this coin.'}</p>`;
      return;
    }
    const now = Date.now();
    const sc = d.scores || {};
    const bar = (k, label) => `<div class="cs-score"><span>${label}</span><b>${sc[k] ?? '—'}</b><i><em style="width:${sc[k] || 0}%"></em></i></div>`;
    const reasons = (k) =>
      (d.reasons[k] || []).length
        ? `<ul class="cs-reasons">${d.reasons[k].map((r) => `<li><span>${esc(r.label)}</span><b class="${r.pts > 0 ? 'x-up' : r.pts < 0 ? 'x-down' : 'dim'}">${r.pts > 0 ? '+' : r.pts < 0 ? '−' : ''}${Math.abs(r.pts)}</b></li>`).join('')}</ul>`
        : '<p class="dim cs-none">No rule fired.</p>';
    const f = d.facts || {};
    const yes = (v, good) => (v === true ? (good ? 'yes' : '<b class="x-down">yes</b>') : v === false ? (good ? '<b class="x-down">no</b>' : 'no') : '—');
    const dev = d.dev || {};
    const call = d.call;
    els.card.innerHTML = `
      <button class="icon-btn cs-x" type="button" data-close aria-label="Close"><svg aria-hidden="true"><use href="#i-close"/></svg></button>
      <header class="cs-head">${avatar(d, 56)}<div><h2>$${esc(d.symbol || '?')}</h2><p>${esc(d.name || '')}</p><p class="dim">${esc(d.chain === 'solana' ? 'Solana' : 'Robinhood Chain')} · ${esc(d.launchpad || '')} · ${age(d.createdAt, now)} old · ${esc(d.stage || '')}</p></div>${verdictPill(d.verdict)}</header>
      ${d.hidden ? `<p class="tk-note warn"><b>Hidden from the feed:</b> ${esc(d.hidden)}</p>` : ''}
      <div class="tk-band cs-facts">
        <div class="tk-stat"><b>${usd(d.mc)}</b><span>market cap${isNum(d.peakX) && d.peakX > 1 ? ` · peaked ${xm(d.peakX)}` : ''}</span></div>
        <div class="tk-stat"><b>${usd(d.liq)}</b><span>liquidity</span></div>
        <div class="tk-stat"><b>${isNum(d.holders) ? d.holders.toLocaleString('en-US') : '—'}</b><span>holders</span></div>
        <div class="tk-stat"><b>${usd(d.vol && d.vol.h1)}</b><span>volume, last hour</span></div>
      </div>
      <div class="cs-scores-big">${bar('safety', 'Safety')}${bar('momentum', 'Momentum')}${bar('community', 'Community')}</div>
      <div class="cs-why">
        <div><h3>Safety</h3>${reasons('safety')}</div>
        <div><h3>Momentum</h3>${reasons('momentum')}</div>
        <div><h3>Community</h3>${reasons('community')}</div>
      </div>
      <h3 class="cs-h">The checks</h3>
      <dl class="cs-checks">
        <div><dt>Dev holds</dt><dd>${pct(dev.pct, 1)}${dev.sold ? ' · <b class="x-down">sold</b>' : ''}</dd></div>
        <div><dt>Dev's launches</dt><dd>${dev.launches ?? '—'}${isNum(dev.graduated) ? `, ${dev.graduated} graduated` : ''}</dd></div>
        <div><dt>Top 10 of what circulates</dt><dd>${pct(f.top10)}</dd></div>
        <div><dt>Snipers</dt><dd>${pct(f.sniperPct)}</dd></div>
        <div><dt>Bundles</dt><dd>${pct(f.bundlePct)}</dd></div>
        <div><dt>Insiders</dt><dd>${pct(f.insiderPct)}</dd></div>
        <div><dt>Mint right live</dt><dd>${yes(f.mintAuth, false)}</dd></div>
        <div><dt>Freeze right live</dt><dd>${yes(f.freezeAuth, false)}</dd></div>
        <div><dt>Liquidity locked</dt><dd>${yes(f.lpLocked, true)}</dd></div>
      </dl>
      ${d.flags.length ? `<div class="chips cs-flags">${d.flags.map((x) => `<span class="${x.hard ? 'hard' : ''}">${esc(x.label)}</span>`).join('')}</div>` : ''}
      ${call ? `<p class="tk-note"><b>Called ${age(call.at, now)} ago at ${usd(call.mc)}${call.kind ? ` (${esc(call.kind)})` : ''}.</b> Peak ${xm(call.peakX)}, now ${xm(call.nowX)}.${call.gradWhy ? ` ${esc(call.gradWhy)}.` : ''}</p>` : ''}
      ${d.description ? `<p class="cs-desc">${esc(d.description)}</p>` : ''}
      <div class="cs-links">${links(d)}</div>
      <p class="cs-addr"><code>${esc(d.address)}</code></p>`;
  }

  function closeSheet() {
    state.open = null;
    els.sheet.hidden = true;
    document.documentElement.classList.remove('cs-locked');
  }

  // ---------------------------------------------------------------- events

  els.chains.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chain]');
    if (!b || b.dataset.chain === state.chain) return;
    state.chain = b.dataset.chain;
    for (const x of els.chains.querySelectorAll('[data-chain]')) x.setAttribute('aria-checked', String(x === b));
    refresh();
  });
  els.groups.addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b || b.dataset.group === state.group) return;
    state.group = b.dataset.group;
    for (const x of els.groups.querySelectorAll('[data-group]')) x.setAttribute('aria-selected', String(x === b));
    refresh();
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const b = e.target.closest('[data-id]');
    if (b && !els.sheet.contains(b)) openToken(b.dataset.id);
    return undefined;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.sheet.hidden) closeSheet();
  });

  async function refresh() {
    await load();
    renderFeed();
    renderSide();
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.active || !serverOn) return;
    state.timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, POLL_MS);
  }

  refresh();
  return {
    setActive(on) {
      state.active = on;
      if (on) refresh().then(schedule);
      else {
        clearTimeout(state.timer);
        closeSheet();
      }
    },
  };
}
