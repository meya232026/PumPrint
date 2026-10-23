// Fomo Radar: when several proven fomo.family wallets enter one token on Robinhood Chain within
// minutes. The archived project's record ships with the page; the live radar is this site's server
// reading the same wallets off the chain (sample data without a server).

import { esc, onVisible } from '../ui.js';

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const POLL_MS = 15_000;

// ------------------------------------------------------------------ formatting

export const money = (v, signed = false) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  const a = Math.abs(v);
  const body = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(a >= 10 ? 0 : 2).replace(/\.00$/, '');
  return `${s}$${body}`;
};
const usdInt = (v, signed = true) => (v == null ? '—' : `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`);
const x = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 10 ? Math.round(v) : v.toFixed(2).replace(/0$/, '')}x`);
const price = (v) => {
  if (v == null || !(v > 0)) return '—';
  if (v >= 1) return `$${v.toFixed(2)}`;
  const digits = Math.max(2, -Math.floor(Math.log10(v)) + 2);
  return `$${v.toFixed(Math.min(digits, 12))}`;
};
const ago = (ts, now) => {
  const s = Math.max(0, now - ts);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateUtc = (ts, withTime = true) => {
  const d = new Date(ts * 1000);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withTime ? `${day} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : day;
};
const tone = (v) => (v > 0 ? 'x-up' : v < 0 ? 'x-down' : '');
const VERDICT = {
  '2x': ['2x+', 'up'],
  above: ['Above', 'up'],
  below: ['Below', 'down'],
  dead: ['Dead pool', 'mute'],
  seeded: ['Seeded', 'warn'],
  honeypot: ['Honeypot', 'down'],
  open: ['Open', 'acc'],
  unmeasured: ['No read', 'mute'],
};
const verdictPill = (v) => {
  const [label, cls] = VERDICT[v] || [v, 'mute'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const tokenLink = (mint, sym) => `<a class="sym" href="${EXPLORER}/token/${esc(mint)}" target="_blank" rel="noopener noreferrer">$${esc(sym || mint.slice(0, 8))}</a>`;

// ------------------------------------------------------------------ small charts

/** Cumulative paper P&L, oldest first, as a filled line. */
function equity(points, cls) {
  if (!points.length) return '';
  const W = 320;
  const H = 76;
  const ys = [0, ...points];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const px = (i) => (i / (ys.length - 1)) * W;
  const py = (v) => H - 6 - ((v - lo) / span) * (H - 12);
  const line = ys.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join('');
  const zero = py(0).toFixed(1);
  return `<svg class="fx-eq ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="zero"/>
    <path d="${line}L${W} ${zero}L0 ${zero}Z" class="area"/>
    <path d="${line}" class="ln"/>
  </svg>`;
}

/** Fills per day, the seeded share on top. */
function dayBars(days) {
  const W = 620;
  const H = 120;
  const max = Math.max(...days.map((d) => d[1]), 1);
  const bw = W / days.length;
  const bars = days
    .map((d, i) => {
      const h = (d[1] / max) * (H - 18);
      const sh = (d[4] / max) * (H - 18);
      const xx = (i * bw + 0.5).toFixed(1);
      return `<rect x="${xx}" y="${(H - 14 - h).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${h.toFixed(1)}" class="b"><title>${esc(d[0])}: ${d[1].toLocaleString('en-US')} fills, ${d[2]} wallets, ${d[3]} tokens${d[4] ? `, ${d[4]} seeded` : ''}</title></rect>${sh > 0.5 ? `<rect x="${xx}" y="${(H - 14 - h).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${sh.toFixed(1)}" class="s"/>` : ''}`;
    })
    .join('');
  const label = (i) => {
    const [, m, d] = days[i][0].split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
  };
  return `<svg class="fx-days" viewBox="0 0 ${W} ${H}" aria-hidden="true">${bars}
    <text x="0" y="${H - 1}">${label(0)}</text><text x="${W / 2}" y="${H - 1}" text-anchor="middle">${label(Math.floor(days.length / 2))}</text><text x="${W}" y="${H - 1}" text-anchor="end">${label(days.length - 1)}</text></svg>`;
}

/** One published burst: the conviction stepping up as wallets enter, then the price after. */
function caseCard(c) {
  const W = 300;
  const H = 110;
  const from = c.timeline.from;
  const to = c.timeline.to;
  let conv = 0;
  const steps = c.entries.map((e) => {
    conv += (e[2] / 100) ** 2;
    return [e[0], conv, e];
  });
  const cmax = Math.max(c.timeline.conviction_max || conv, conv, c.bar + 0.5);
  const tx = (t) => ((t - from) / Math.max(1, to - from)) * W;
  const ty = (v) => H - 8 - (v / cmax) * (H - 18);
  let path = `M0 ${ty(0).toFixed(1)}`;
  for (const [t, v] of steps) path += `H${tx(t).toFixed(1)}V${ty(v).toFixed(1)}`;
  path += `H${W}`;
  const dots = steps.map(([t, v, e]) => `<circle cx="${tx(t).toFixed(1)}" cy="${ty(v).toFixed(1)}" r="3.2"><title>${esc(e[1])} (${e[2]}) · ${money(e[3])}</title></circle>`).join('');
  const bar = ty(c.bar).toFixed(1);
  // after: the closes, in multiples of the entry, on a log scale
  const k = c.candles.filter((r) => r[4] > 0);
  let after = '';
  if (k.length > 1) {
    const lmax = Math.log(Math.max(...k.map((r) => r[2]), 1.2));
    const lmin = Math.log(Math.min(...k.map((r) => r[3]), 0.8));
    const ay = (v) => H - 8 - ((Math.log(v) - lmin) / (lmax - lmin || 1)) * (H - 18);
    const ax = (i) => (i / (k.length - 1)) * W;
    const ln = k.map((r, i) => `${i ? 'L' : 'M'}${ax(i).toFixed(1)} ${ay(r[4]).toFixed(1)}`).join('');
    after = `<svg viewBox="0 0 ${W} ${H}" class="fx-case-after" aria-hidden="true"><line x1="0" x2="${W}" y1="${ay(1).toFixed(1)}" y2="${ay(1).toFixed(1)}" class="one"/><path d="${ln}" class="ln"/></svg>`;
  }
  return `<article class="fx-case">
    <header><b>$${esc(c.symbol)}</b><span>${esc(c.date)}</span></header>
    <p class="fx-case-sum">${c.entries.length} wallets · peak <b class="x-up">${x(c.peak)}</b> after ${esc(c.peakAfter.toLowerCase())} · then ${x(c.now)} after ${esc(c.nowAfter.toLowerCase())}</p>
    <div class="fx-case-charts">
      <figure><svg viewBox="0 0 ${W} ${H}" class="fx-case-burst" aria-hidden="true"><line x1="0" x2="${W}" y1="${bar}" y2="${bar}" class="bar"/><path d="${path}" class="ln"/>${dots}</svg><figcaption>Conviction as they enter · bar at +${c.bar}</figcaption></figure>
      <figure>${after}<figcaption>${esc((c.candleLabel || 'candles').toLowerCase())} closes after, × the entry</figcaption></figure>
    </div>
    <div class="chips">${c.entries.map((e) => `<span>${esc(e[1])} <b>${e[2]}</b></span>`).join('')}</div>
  </article>`;
}

// ------------------------------------------------------------------ the page

export function initFomo(env) {
  const root = document.getElementById('f-root');
  const mode = document.querySelector('[data-f-mode]');
  const site = env.site || {};
  const serverOn = env.mode === 'server' && site.fomo && site.fomo.on;
  const sample = !serverOn || site.demo;
  const state = { archive: null, live: null, timer: null, active: false, visible: false, alertKind: 'burst', alertsAll: false, rosterAll: false, liveTab: 'signals' };

  root.innerHTML = `
    <div class="tool-intro">
      <h1 class="page-title">When the proven wallets move.</h1>
      <p>Fomo Radar follows the fomo.family traders who proved themselves on Robinhood Chain, through the wallets that actually trade. Every 20 seconds it reads their buys off the chain. A burst is several of them entering one token within minutes.</p>
    </div>
    <div id="fx-record" class="fx-record" aria-live="polite"></div>
    <section class="tk-sec" id="fx-live"></section>
    <section class="tk-sec" id="fx-archive"></section>
    <details class="panel how fx-how">
      <summary><h2>How the radar decides</h2><svg aria-hidden="true"><use href="#i-chevron"/></svg></summary>
      <dl>
        <dt>Whose trade it is</dt><dd>On this chain a relayer sends every fomo.family trade, so a wallet's buy is the token arriving from the fomo router. A swap sent straight to the router naming someone else's wallet is <i>direct</i> and counts for nothing; a buy under $5 or 2% of the wallet's usual size is <i>dust</i>; one $30 buy apiece into a queue of trusted wallets, seconds apart, is a <i>seeding wave</i>. A token several trusted wallets were seeded into leaves every feed.</dd>
        <dt>A burst</dt><dd>Conviction is Σ(score/100)² over the trusted wallets (score 60+) whose first buy of the token landed in the last 30 minutes. A burst needs +4.0 from at least 3 wallets, spread over at least 3 minutes, from at least 2 independent crews (wallets that keep buying the same tokens in the same minute count once), while the tracked wallets are selling less than half of what they bought.</dd>
        <dt>Before an alert goes out</dt><dd>The token must not refuse a sell, a pool under 30 minutes old must have somebody besides the cohort in it, the pool must hold $10K or more, the cohort must be between 3% and 90% of the pool's last half hour, and a borrowed name (a listed ticker, or a name launched here in the last 14 days) needs 1.5 times the conviction.</dd>
        <dt>The hour read</dt><dd>An hour after the alert: the pool's 5-minute candles from the alert on, in the price the last entrant paid. Peak is the highest high, the hour read is the last close, and $100 into each alert is out at the hour read. No fees or slippage.</dd>
        <dt>Sources</dt><dd>Robinhood Chain's public RPC (no key), GeckoTerminal for pools and candles. The roster and the archive come from <a href="https://github.com/cvxv666/fomo-robinhood-radar" target="_blank" rel="noopener noreferrer">cvxv666/fomo-robinhood-radar</a> (MIT), archived on 6 October 2026; the live part is ported to run on this site. Unofficial: not affiliated with fomo.family or Robinhood.</dd>
      </dl>
    </details>`;

  // ---------------------------------------------------------------- archive

  async function loadArchive() {
    if (!state.archive) state.archive = (await import('./archive-data.js')).default;
    return state.archive;
  }

  function renderRecord(a) {
    const t = a.totals;
    const curve = (kind) => {
      let sum = 0;
      return a.alerts.filter((r) => r[4] > 0 && r[1] === kind && r[15] != null).map((r) => (sum += r[15]));
    };
    const card = (kind, label, tt, cls) => `
      <article class="fx-duel ${cls}">
        <p class="eyebrow">${label} · ${tt.pushes} sent</p>
        <b class="fx-big ${tone(tt.paper.pnl)}">${usdInt(tt.paper.pnl)}</b>
        <p class="fx-duel-sub">$100 into every alert, out an hour later: ${tt.paper.trades} trades, ${Math.round(tt.paper.winRate * 100)}% closed the hour above the entry, ${tt.reached2x} touched 2x.</p>
        ${equity(curve(kind), cls)}
      </article>`;
    const c = a.caveats;
    document.getElementById('fx-record').innerHTML = `
      <div class="fx-duels">
        ${card(1, 'Burst alerts: several trusted wallets into one token inside minutes', t.bursts, 'up')}
        ${card(0, 'Launch alerts: the cohort entering something new', t.launches, 'down')}
      </div>
      <p class="tk-note"><b>Read it with care.</b> Three trades carry the burst result: ${c.top3.map((r) => `$${esc(r.sym)} ${usdInt(r.paper)}`).join(', ')}; the other ${t.bursts.paper.trades - 3} came to ${usdInt(c.restPnl)} together. Leave out the alerts later found seeded, dead or unsellable and bursts made ${usdInt(c.cleanPnl)} over ${c.cleanTrades} trades. After 22 September launches were still measured but sent to nobody: ${usdInt(c.unsentLaunchPnl)} over ${c.unsentLaunchTrades}. The archived project's own numbers, recomputed here from its alert ledger.</p>`;
  }

  function renderArchive(a) {
    const box = document.getElementById('fx-archive');
    const kinds = [
      ['burst', 'Bursts', (r) => r[1] === 1 && r[4] > 0],
      ['launch', 'Launches', (r) => r[1] === 0 && r[4] > 0],
      ['unsent', 'Launches nobody got', (r) => r[1] === 0 && r[4] === 0],
    ];
    const tape = a.tape;
    const statuses = a.roster.reduce((m, r) => ((m[r[2]] = (m[r[2]] || 0) + 1), m), {});
    const trusted = a.roster.filter((r) => r[1] >= 60).length;
    box.innerHTML = `
      <div class="tk-sec-head">
        <div><h2>The archive</h2><p>${dateUtc(Date.parse(`${tape.first_fill_utc}T00:00:00Z`) / 1000, false)} – ${dateUtc(Date.parse(`${tape.last_fill_utc}T00:00:00Z`) / 1000, false)} 2026, as the project left it when it was switched off.</p></div>
      </div>
      <div class="tk-band">
        <div class="tk-stat"><b>${tape.fills.toLocaleString('en-US')}</b><span>fills read off the chain</span></div>
        <div class="tk-stat"><b>${tape.traders_tracked}</b><span>wallets tracked, ${tape.fomo_users_resolved.toLocaleString('en-US')} profiles resolved</span></div>
        <div class="tk-stat"><b>${tape.tokens.toLocaleString('en-US')}</b><span>tokens touched</span></div>
        <div class="tk-stat"><b>${a.totals.all.pushes}</b><span>alerts to ${a.bot.subscribers} Telegram subscribers</span></div>
      </div>

      <h3 class="fx-sub">Four bursts, replayed</h3>
      <div class="fx-cases">${a.cases.map(caseCard).join('')}</div>

      <div class="fx-alerts-head">
        <h3 class="fx-sub">Every alert and what came of it</h3>
        <div class="tk-tabs" role="tablist" id="fx-kinds">${kinds.map(([k, label, f]) => `<button type="button" role="tab" data-kind="${k}" aria-selected="${k === state.alertKind}">${label} <span class="dim">${a.alerts.filter(f).length}</span></button>`).join('')}</div>
      </div>
      <div class="tk-card"><div class="tk-table-wrap" id="fx-alerts"></div></div>

      <div class="fx-two">
        <div class="tk-card"><h3>The tape by day <small>fills · seeded in amber</small></h3>${dayBars(a.days)}</div>
        <div class="tk-card"><h3>The roster <small>${a.roster.length} wallets judged</small></h3>
          <p class="fx-roster-sum">${trusted} trusted (score 60+): ${statuses.active || 0} active, ${statuses.watch || 0} on watch, ${statuses.dropped || 0} dropped. Scores were written by the project in September 2026 and are frozen.</p>
          <div class="tk-table-wrap" id="fx-roster"></div>
        </div>
      </div>`;
    box.querySelector('#fx-kinds').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      state.alertKind = b.dataset.kind;
      state.alertsAll = false;
      for (const x2 of box.querySelectorAll('#fx-kinds [data-kind]')) x2.setAttribute('aria-selected', String(x2 === b));
      renderAlertTable(a, kinds);
    });
    renderAlertTable(a, kinds);
    renderRoster(a);
  }

  function renderAlertTable(a, kinds) {
    const [, , filter] = kinds.find((k) => k[0] === state.alertKind);
    const rows = a.alerts.filter(filter).reverse();
    const shown = state.alertsAll ? rows : rows.slice(0, 15);
    const isBurst = state.alertKind === 'burst';
    const el = document.getElementById('fx-alerts');
    el.innerHTML = `<table class="tk-table">
      <thead><tr><th>Alert (UTC)</th><th class="l">Token</th><th>${isBurst ? 'Conviction' : 'Heat'}</th><th>Wallets</th><th>Pool</th><th>Peak</th><th>At</th><th>Hour</th><th class="l">Verdict</th><th>$100 →</th></tr></thead>
      <tbody>${shown
        .map(
          (r) => `<tr>
          <td class="dim">${dateUtc(r[0])}</td>
          <td class="l">${tokenLink(r[3], r[2])}</td>
          <td>${r[6] != null ? `+${r[6].toFixed(1)}` : '—'}</td>
          <td>${r[7] ?? '—'}</td>
          <td>${money(r[8])}</td>
          <td class="${r[9] >= 1 ? 'x-up' : r[9] != null ? 'x-down' : ''}">${x(r[9])}</td>
          <td class="dim">${r[10] != null ? `${r[10]}m` : '—'}</td>
          <td class="${r[11] >= 1 ? 'x-up' : r[11] != null ? 'x-down' : ''}">${x(r[11])}</td>
          <td class="l">${verdictPill(r[14])}</td>
          <td class="${tone(r[15])}">${r[15] != null ? usdInt(r[15]) : '—'}</td>
        </tr>`,
        )
        .join('')}</tbody></table>
      ${rows.length > shown.length ? `<button class="tk-more" type="button" data-more>Show all ${rows.length}</button>` : ''}`;
    el.querySelector('[data-more]')?.addEventListener('click', () => {
      state.alertsAll = true;
      renderAlertTable(a, kinds);
    });
  }

  function renderRoster(a) {
    const rows = state.rosterAll ? a.roster : a.roster.slice(0, 12);
    const el = document.getElementById('fx-roster');
    const st = { active: ['Active', 'up'], watch: ['Watch', 'warn'], dropped: ['Dropped', 'mute'] };
    el.innerHTML = `<table class="tk-table"><thead><tr><th>Trader</th><th>Score</th><th class="l">Status</th><th class="l">Style</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td><td class="l"><span class="pill ${st[r[2]]?.[1] || 'mute'}">${esc(st[r[2]]?.[0] || r[2])}</span></td><td class="l dim">${esc(r[3])}</td></tr>`).join('')}</tbody></table>
      ${state.rosterAll ? '' : `<button class="tk-more" type="button" data-more>Show all ${a.roster.length}</button>`}`;
    el.querySelector('[data-more]')?.addEventListener('click', () => {
      state.rosterAll = true;
      renderRoster(a);
    });
  }

  // ---------------------------------------------------------------- live

  async function loadLive() {
    if (serverOn) {
      try {
        const res = await fetch('/api/fomo/live', { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch {
        /* keep the last one */
      }
      return state.live;
    }
    if (!state.live) {
      const raw = (await import('./live-sample.js')).default;
      state.live = shift(raw.snapshot, Math.floor(Date.now() / 1000) - raw.builtAt);
    }
    return state.live;
  }

  function statusOf(s) {
    if (!s) return { state: 'off', text: 'Off on this site' };
    if (sample) return { state: 'sample', text: 'Sample data · made-up wallets and tokens' };
    if (s.status === 'backfilling') return { state: 'warm', text: `Warming up · reading the last ${s.backfill.hours} h (${Math.round((s.backfill.progress || 0) * 100)}%)` };
    if (s.error) return { state: 'error', text: 'The chain is not answering · retrying' };
    return { state: 'live', text: `Live · ${s.roster.tracked} wallets · ${s.lastTickAt ? ago(s.lastTickAt, s.now) : 'starting'}` };
  }

  function alertCard(p, now) {
    const span = p.who && p.who.length > 1 ? Math.max(1, Math.round((p.who[p.who.length - 1][0] - p.who[0][0]) / 60)) : null;
    const result =
      p.verdict === 'open'
        ? `<span class="pill acc">Hour read in ${Math.max(1, Math.round((p.ts + 3600 - now) / 60))} min</span>${p.nowX != null ? `<span class="dim">now ${x(p.nowX)}</span>` : ''}`
        : `<span>Peak <b class="${p.best >= 1 ? 'x-up' : 'x-down'}">${x(p.best)}</b>${p.peakMin != null ? ` at ${p.peakMin} min` : ''}</span><span>Hour <b class="${p.hour >= 1 ? 'x-up' : 'x-down'}">${x(p.hour)}</b></span>${verdictPill(p.verdict)}${p.paper != null ? `<b class="${tone(p.paper)}">${usdInt(p.paper)}</b>` : ''}`;
    return `<li class="fx-alert">
      <div class="fx-alert-top">${tokenLink(p.mint, p.sym)}<span class="pill up">Burst +${(p.conviction || 0).toFixed(1)}</span><span class="dim">${dateUtc(p.ts)} UTC · ${ago(p.ts, now)}</span></div>
      <p class="fx-alert-facts">${p.wallets} trusted wallets${span ? ` in ${span} min` : ''} · ${money(p.usd)} in · pool ${money(p.liq)}${p.share != null ? ` · ${Math.round(p.share * 100)}% of its last half hour` : ''} · entry ${price(p.px)}</p>
      <div class="fx-alert-result">${result}</div>
      <div class="chips">${(p.who || []).map((w) => `<span>${esc(w[1])} <b>${w[2]}</b></span>`).join('')}</div>
    </li>`;
  }

  function liveTable(s) {
    const now = s.now;
    if (state.liveTab === 'signals') {
      if (!s.signals.length) return '<p class="tk-empty">No token has two trusted buyers in the last 24 hours yet.</p>';
      return `<table class="tk-table"><thead><tr><th>Token</th><th>Trusted buyers</th><th>Conviction</th><th>Bought</th><th>Pool</th><th class="l">Who</th></tr></thead><tbody>${s.signals
        .map((r) => `<tr><td>${tokenLink(r.mint, r.sym)}</td><td>${r.buyers}</td><td>${r.conviction.toFixed(2)}</td><td>${money(r.usd)}</td><td>${money(r.liq)}</td><td class="l dim fx-who">${esc(r.who.slice(0, 5).join(', '))}${r.who.length > 5 ? ` +${r.who.length - 5}` : ''}</td></tr>`)
        .join('')}</tbody></table>`;
    }
    if (state.liveTab === 'fresh') {
      if (!s.fresh.length) return '<p class="tk-empty">Nothing new the cohort started buying in the last 6 hours.</p>';
      return `<table class="tk-table"><thead><tr><th>Token</th><th>Heat</th><th>Buyers</th><th>First in</th><th>Pool</th><th class="l">Who</th></tr></thead><tbody>${s.fresh
        .map((r) => `<tr><td>${tokenLink(r.mint, r.sym)}</td><td>${r.heat.toFixed(2)}</td><td>${r.buyers}</td><td class="dim">${r.leadMin != null ? `${Math.max(0, Math.round(r.leadMin))} min after the pool` : ago(r.firstTs, now)}</td><td>${money(r.liq)}</td><td class="l dim fx-who">${esc(r.who.slice(0, 5).join(', '))}</td></tr>`)
        .join('')}</tbody></table><p class="fx-small">Launches were the half of the feed that lost money (−$1,205 over 90 alerts), so they are listed here and never alerted.</p>`;
    }
    if (!s.exits.length) return '<p class="tk-empty">No token is being left by two or more trusted wallets in the last 6 hours.</p>';
    return `<table class="tk-table"><thead><tr><th>Token</th><th>Sellers</th><th>Fully out</th><th>Sold</th><th>Last sell</th><th class="l">Who</th></tr></thead><tbody>${s.exits
      .map((r) => `<tr><td>${tokenLink(r.mint, r.sym)}</td><td>${r.sellers}</td><td>${r.gone}</td><td>${money(r.usd)}</td><td class="dim">${ago(r.lastSell, now)}</td><td class="l dim fx-who">${esc(r.who.slice(0, 5).join(', '))}</td></tr>`)
      .join('')}</tbody></table>`;
  }

  function renderLive(s) {
    const box = document.getElementById('fx-live');
    const st = statusOf(s);
    if (mode) mode.textContent = sample ? 'Sample data' : st.state === 'live' ? 'Live' : 'Robinhood Chain';
    if (!s) {
      box.innerHTML = `<div class="tk-sec-head"><div><h2>Live</h2><p>The live radar is switched off on this site (FOMO=0). The archive below is the whole record.</p></div><span class="live-dot" data-state="off"><i></i>Off</span></div>`;
      return;
    }
    const now = s.now;
    const r = s.record;
    box.innerHTML = `
      <div class="tk-sec-head">
        <div><h2>Live</h2><p>A burst: +${s.rules.delta.toFixed(1)} conviction from ${s.rules.minWallets} or more trusted wallets inside ${s.rules.windowMin} minutes. Each alert is read again an hour later.</p></div>
        <span class="live-dot" data-state="${st.state}"><i></i>${esc(st.text)}</span>
      </div>
      <div class="tk-band">
        <div class="tk-stat"><b>${s.alerts.length}</b><span>alerts since ${dateUtc(s.liveSince || now, false)}</span></div>
        <div class="tk-stat"><b class="${tone(r.paper.pnl)}">${r.paper.trades ? usdInt(r.paper.pnl) : '—'}</b><span>$100 into each, out at the hour${r.paper.trades ? ` · ${r.paper.trades} closed` : ''}</span></div>
        <div class="tk-stat"><b>${s.roster.trusted}</b><span>trusted wallets of ${s.roster.tracked} read</span></div>
        <div class="tk-stat"><b>${(s.counts.fills24h || 0).toLocaleString('en-US')}</b><span>fills in the last 24 hours</span></div>
      </div>
      ${s.error && !sample ? `<p class="tk-note warn"><b>The chain is not answering right now.</b> The radar keeps retrying; alerts pick up where the tape left off.</p>` : ''}
      <div class="tk-grid fx-live-grid">
        <div>
          <div class="tk-card">
            <h3>Alerts <small>newest first</small></h3>
            ${s.alerts.length ? `<ol class="fx-alerts">${s.alerts.slice(0, 8).map((p) => alertCard(p, now)).join('')}</ol>` : `<p class="tk-empty">${s.status === 'backfilling' ? 'Reading the last days of the tape first, so the first alert is a real one.' : 'No burst yet. They are rare: about one or two a day when the project ended.'}</p>`}
          </div>
          ${s.held.length ? `<div class="tk-card fx-held"><h3>Held back <small>bursts that failed a check</small></h3><ul>${s.held.map((h) => `<li>${tokenLink(h.mint, h.sym)} <span class="dim">+${(h.conviction || 0).toFixed(1)} · ${ago(h.ts, now)}</span><p>${esc(h.held)}</p></li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="tk-card fx-tape">
          <h3>The tape <small>trusted wallets' fills</small></h3>
          ${s.tape.length ? `<ol>${s.tape.map((t) => `<li><span class="pill ${t.side === 'buy' ? 'up' : 'down'}">${t.side}</span><span class="fx-tape-main">${tokenLink(t.mint, t.sym)} <b>${money(t.usd)}</b></span><span class="fx-tape-who">${esc(t.handle)} <b>${t.score}</b></span><span class="dim">${ago(t.ts, now)}</span></li>`).join('')}</ol>` : '<p class="tk-empty">No fills read yet.</p>'}
        </div>
      </div>
      <div class="tk-card fx-feeds">
        <div class="tk-tabs" role="tablist" id="fx-live-tabs">
          ${[
            ['signals', 'Bought today'],
            ['fresh', 'Just started'],
            ['exits', 'Being left'],
          ]
            .map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === state.liveTab}">${label}</button>`)
            .join('')}
        </div>
        <div class="tk-table-wrap" id="fx-live-table">${liveTable(s)}</div>
      </div>`;
    box.querySelector('#fx-live-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      state.liveTab = b.dataset.tab;
      for (const t of box.querySelectorAll('#fx-live-tabs [data-tab]')) t.setAttribute('aria-selected', String(t === b));
      box.querySelector('#fx-live-table').innerHTML = liveTable(s);
    });
  }

  async function refresh() {
    const s = env.mode === 'server' && site.fomo && !site.fomo.on ? null : await loadLive();
    state.live = s;
    renderLive(s);
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.active || !serverOn) return;
    state.timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, POLL_MS);
  }

  (async () => {
    const a = await loadArchive();
    renderRecord(a);
    renderArchive(a);
    await refresh();
    schedule();
  })().catch((err) => {
    console.error(err);
    root.insertAdjacentHTML('beforeend', '<p class="tk-note warn"><b>Something went wrong loading the radar.</b> Reload to try again.</p>');
  });
  onVisible(root, (v) => {
    state.visible = v;
  });

  return {
    setActive(on) {
      state.active = on;
      if (on && serverOn) refresh().then(schedule);
      else clearTimeout(state.timer);
    },
  };
}

// The sample snapshot was made at build time: move its clock to now.
const TIME_KEYS = new Set(['ts', 'now', 'liveSince', 'lastTickAt', 'followupAt', 'first_ts', 'firstTs', 'lastTs', 'lastSell', 'createdAt', 'lastFill']);
export function shift(v, d) {
  if (Array.isArray(v)) return v.map((e) => shift(e, d));
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, val] of Object.entries(v)) {
    if (TIME_KEYS.has(k) && typeof val === 'number') o[k] = val + d;
    else if (k === 'who' && Array.isArray(val) && Array.isArray(val[0])) o[k] = val.map((w) => [w[0] + d, ...w.slice(1)]);
    else o[k] = shift(val, d);
  }
  return o;
}
