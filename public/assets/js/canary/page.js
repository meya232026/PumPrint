// Canary: a read-only watchtower for Pons V2 positions on Robinhood Chain. The site's server sweeps its
// watch list with Canary's own engine. A visitor can scan any token once, or keep up to five watched in
// this tab: the page scans them every minute and runs Canary's own rules (rules.js, compiled from its
// source) on each read against the one before. Without a server it plays a recorded demo cycle.

import { esc, local, copyText, toast } from '../ui.js';
import { evaluate } from './rules.js';

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const PONS = 'https://www.ponsfamily.com/token/';
const DEXSCREENER = 'https://dexscreener.com/robinhood/';
const REPO = 'https://github.com/Gipppp121/canary';
const TAB_KEY = 'pumprint.canary.tab.v1';
const KEY_KEY = 'pumprint.canary.control';
const TAB_MAX = 5;
const TAB_EVERY_MS = 60_000;
const STATUS_WINDOW_MS = 15 * 60_000;
const SECONDS_PER_BLOCK = 0.1008;
const LEVEL_RULES = new Set(['serial-deployer', 'volume-dead']);
const BIG_FIELDS = ['liquidityWei', 'feesPendingWei', 'poolLiquidity', 'poolPendingTokenFeesWei'];
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const lc = (a) => String(a || '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ formatting

const SUB = '₀₁₂₃₄₅₆₇₈₉';
const trim = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
/** Any positive amount, readable at any size: 4.2, 1.5M, 0.0₇1524. */
export function amount(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${trim((a / 1e9).toFixed(2))}B`;
  if (a >= 1e6) return `${sign}${trim((a / 1e6).toFixed(2))}M`;
  if (a >= 1e4) return `${sign}${trim((a / 1e3).toFixed(1))}K`;
  if (a >= 1) return `${sign}${trim(a.toFixed(a >= 100 ? 0 : 2))}`;
  const [m, e] = a.toExponential(3).split('e');
  const zeros = -Number(e) - 1; // zeros right after the point
  if (zeros < 4) return `${sign}${trim(a.toFixed(zeros + 3))}`;
  const digits = m.replace('.', '').replace(/0+$/, '') || '0';
  return `${sign}0.0${String(zeros).split('').map((d) => SUB[d]).join('')}${digits}`;
}
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${trim(v.toFixed(Math.abs(v) >= 10 ? 1 : 2))}%`);
const int = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
/** Raw Uniswap v4 liquidity (L): a size, not dollars. */
const rawL = (s) => {
  if (s == null) return '—';
  const n = Number(s);
  if (!Number.isFinite(n)) return '—';
  if (n < 1e6) return int(n);
  const e = Math.floor(Math.log10(n));
  return `${trim((n / 10 ** e).toFixed(2))}e${e}`;
};
const span = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
};
const ago = (t, ref) => (t ? `${span(ref - t)} ago` : 'not known');
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');
const STATUS = { QUIET: ['Quiet', 'up'], WATCH: ['Watch', 'warn'], LEAVE: ['Leave', 'down'], INFO: ['Info', 'info'], PENDING: ['Reading', 'mute'], ERROR: ['No read', 'mute'] };
const statusPill = (s) => {
  const [label, cls] = STATUS[s] || [s, 'mute'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const LEVEL = { leave: ['Leave', 'down'], warn: ['Watch', 'warn'], info: ['Info', 'info'] };
const levelPill = (l) => {
  const [label, cls] = LEVEL[l] || [l, 'mute'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const worst = (alerts) => (alerts.some((a) => a.level === 'leave') ? 'LEAVE' : alerts.some((a) => a.level === 'warn') ? 'WATCH' : alerts.some((a) => a.level === 'info') ? 'INFO' : 'QUIET');
const ext = (href, label) => `<a class="cy-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}<svg aria-hidden="true"><use href="#i-out"/></svg></a>`;
const links = (token) => (isAddr(token) ? [ext(PONS + token, 'Pons'), ext(`${EXPLORER}/token/${token}`, 'Blockscout'), ext(DEXSCREENER + lc(token), 'DEX Screener')].join('') : '');

/** The readings of a view a person compares: on the curve, or in the pool. */
function facts(v, { indexReady = true, windowMin = null, now = Date.now() } = {}) {
  if (!v) return '';
  const pool = v.phase === 'POOL';
  const cells = [
    ['Deployer holds', pct(v.devPct), 'of the supply'],
    pool ? ['Pool price', amount(v.price), `${v.pair} per token`] : ['Curve reserve', amount(v.reserve), v.pair],
    pool ? ['Active liquidity', rawL(v.poolLiquidity), 'raw v4 L, not dollars'] : ['Pending fees', amount(v.quoteFees), `${v.pair}, fees and creator tax`],
    [pool ? 'Swaps' : 'Trades', int(v.trades), windowMin ? `in the last ≈${windowMin} min` : 'in the recent window'],
    ['Last trade', v.lastTradeAt ? span(Math.max(0, now - v.lastTradeAt)) : '—', v.lastTradeAt ? 'ago' : 'none in the window, or not known'],
    ['Deployer launches', indexReady ? int(v.deployerLaunches) : '…', indexReady ? 'in the indexed window' : 'history still loading'],
  ];
  if (pool) cells.push(['Pending token fees', amount(v.tokenFees), 'on the Pons hook']);
  cells.push(['Creator tax', pct(v.creatorTaxPct), 'on every trade']);
  // filled to a multiple of four, so the grid has no hole at two columns or four
  const pad = (4 - (cells.length % 4)) % 4;
  return cells.map(([k, val, sub]) => `<div class="tk-stat"><b>${esc(val)}</b><span>${esc(k)} · ${esc(sub)}</span></div>`).join('') + '<div class="tk-stat" aria-hidden="true"></div>'.repeat(pad);
}

// Raw integer units to whole ones, for display: split in BigInt first so large counts stay exact.
const whole = (raw, decimals = 18) => {
  try {
    const b = BigInt(String(raw).replace(/n$/, ''));
    const scale = 10n ** BigInt(Math.max(0, Math.min(36, decimals)));
    return Number(b / scale) + Number(b % scale) / Number(scale);
  } catch {
    return null;
  }
};
/** "was → now" of an alert, in units a person reads. */
function delta(a, v) {
  if (a.was == null || a.now == null) return '';
  const pair = (v && v.pair) || 'ETH';
  const pd = (v && v.pairDecimals) ?? 18;
  const td = (v && v.tokenDecimals) ?? 18;
  let was = a.was;
  let now = a.now;
  if (a.rule === 'curve-reserve-drop' || a.rule === 'fees-swept') [was, now] = [`${amount(whole(a.was, pd))} ${pair}`, `${amount(whole(a.now, pd))} ${pair}`];
  else if (a.rule === 'pool-token-fees-moved') [was, now] = [`${amount(whole(a.was, td))} tokens`, `${amount(whole(a.now, td))} tokens`];
  else if (a.rule === 'pool-liquidity-drop') [was, now] = [`${rawL(a.was)} L`, `${rawL(a.now)} L`];
  else if (a.rule === 'pool-price-move') [was, now] = [amount(Number(a.was)), amount(Number(a.now))];
  else if (a.rule === 'pool-swap-burst') [was, now] = [`${a.was} swaps`, `${a.now} swaps`];
  return `<p class="cy-delta"><span>before</span> ${esc(was)} <i aria-hidden="true">→</i> <span>now</span> ${esc(now)}</p>`;
}
/** Canary's detail line, with its raw wei counts put into whole units. */
function detail(a, v) {
  const m = String(a.detail || '').match(/^(\d{4,}) (wei|raw token units) (.*)$/);
  if (!m) return a.detail || '';
  const isWei = m[2] === 'wei';
  const n = whole(m[1], isWei ? (v && v.pairDecimals) ?? 18 : (v && v.tokenDecimals) ?? 18);
  return `${amount(n)} ${isWei ? (v && v.pair) || 'ETH' : 'tokens'} ${m[3]}`;
}

function sparkline(points, label, fmt) {
  const pts = points.filter((p) => p[1] != null && Number.isFinite(p[1]));
  if (pts.length < 2) return `<figure class="cy-spark"><div class="cy-spark-empty">One reading so far</div><figcaption>${esc(label)}</figcaption></figure>`;
  const W = 220;
  const H = 54;
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0] || t0 + 1;
  const px = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const py = (v) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join('');
  return `<figure class="cy-spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>
    <figcaption>${esc(label)} <b>${esc(fmt(ys[ys.length - 1]))}</b><small>${esc(fmt(lo))} – ${esc(fmt(hi))}</small></figcaption></figure>`;
}

// Canary's snapshots carry BigInts; the API sends them as decimal strings.
function revive(s) {
  if (!s) return s;
  const out = { ...s };
  for (const k of BIG_FIELDS) if (typeof out[k] === 'string' && /^\d+$/.test(out[k])) out[k] = BigInt(out[k]);
  return out;
}

const session = {
  get(k) {
    try {
      return sessionStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set(k, v) {
    try {
      if (v) sessionStorage.setItem(k, v);
      else sessionStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

// ------------------------------------------------------------------ the page

export function initCanary(env) {
  const root = document.getElementById('y-root');
  const badge = document.querySelector('[data-y-mode]');
  const site = env.site || {};
  const info = site.canary || null;
  const serverOn = env.mode === 'server' && Boolean(info && info.on);
  const offReason = env.mode === 'server' && info && !info.on ? info.reason : null;
  const ui = { list: 'server', level: 'all', active: false, timer: null, frameTimer: null, tabTimer: null, open: null, frame: 0 };
  let data = null; // the latest state (server) or the current frame (sample)
  let sample = null; // the recorded demo cycle
  let rules = null;
  let lastScan = null;
  const tab = Object.assign({ list: [], last: {}, view: {}, fired: {}, hist: {}, alerts: [] }, serverOn ? local.get(TAB_KEY, {}) : {});
  tab.list = (tab.list || []).filter((t) => isAddr(t.token)).slice(0, TAB_MAX);

  root.innerHTML = `
    <div class="tool-intro">
      <h1 class="page-title">What happens after the buy.</h1>
      <p>Canary watches Pons V2 positions on Robinhood Chain. Every sweep reads the deployer's share, the curve reserve or the pool, the fees and the trades, and compares them with the sweep before. A change that crosses one of ten plain rules turns a token from QUIET to WATCH or LEAVE. No key, no signer, no transaction path: it reads, it never moves funds.</p>
    </div>
    <div id="cy-off"></div>
    <div class="tk-band cy-band" id="cy-band"></div>

    <section class="tk-sec">
      <div class="tk-sec-head"><div><h2>Scan a token</h2><p>Paste a Pons V2 token address. One read of the chain, nothing stored. A single read shows the state now; WATCH and LEAVE need a read before it to compare with.</p></div></div>
      <form class="k-search cy-search" id="cy-form" autocomplete="off">
        <label class="k-field">
          <svg aria-hidden="true"><use href="#i-search"/></svg>
          <input id="cy-q" name="token" type="text" spellcheck="false" autocapitalize="off" placeholder="0x… a Pons V2 token on Robinhood Chain" aria-label="Pons V2 token address">
        </label>
        <button class="btn btn-accent" type="submit">Scan <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
      </form>
      <div class="cy-try" id="cy-try"></div>
      <div id="cy-result" aria-live="polite"></div>
    </section>

    <section class="tk-sec">
      <div class="tk-sec-head">
        <div><h2>Watching</h2><p id="cy-watch-sub"></p></div>
        <div class="tk-tabs" role="tablist" aria-label="Watch list" id="cy-lists">
          <button type="button" role="tab" data-list="server" aria-selected="true">On the server <b data-n="server"></b></button>
          <button type="button" role="tab" data-list="tab" aria-selected="false">In this tab <b data-n="tab"></b></button>
        </div>
      </div>
      <div class="cy-board">
        <div class="cy-cols" aria-hidden="true"><span>Status</span><span>Token</span><span>Phase</span><span>Deployer</span><span>Reserve · price</span><span>Trades</span><span>Last trade</span><span>Why</span></div>
        <ol class="cy-grid" id="cy-grid"></ol>
      </div>
      <div id="cy-watch-foot"></div>
    </section>

    <section class="tk-sec">
      <div class="tk-sec-head">
        <div><h2>Flight recorder</h2><p>Every signal a sweep produced, newest first: the rule that noticed it, and the reading before beside the one after.</p></div>
        <div class="tk-tabs" role="tablist" aria-label="Signal level" id="cy-levels">
          <button type="button" role="tab" data-level="all" aria-selected="true">All</button>
          <button type="button" role="tab" data-level="leave" aria-selected="false">Leave</button>
          <button type="button" role="tab" data-level="warn" aria-selected="false">Watch</button>
          <button type="button" role="tab" data-level="info" aria-selected="false">Info</button>
        </div>
      </div>
      <ol class="cy-feed" id="cy-feed"></ol>
    </section>

    <section class="tk-sec">
      <div class="tk-sec-head"><div><h2>Ten rules, no model</h2><p>Each rule is a plain function over two sweeps, so the same reads always give the same answer. The thresholds are the ones in force here.</p></div></div>
      <div class="cy-rules" id="cy-rules"></div>
    </section>

    <details class="panel how cy-how">
      <summary><h2>How Canary reads the chain</h2><svg aria-hidden="true"><use href="#i-chevron"/></svg></summary>
      <dl>
        <dt>On the curve</dt><dd>The deployer's balance as a share of the supply, the curve's real quote reserve, its pending fees (quote fees plus creator tax), the CurveBuy and CurveSell events of the recent window, and how many launches the same deployer made in the indexed window.</dd>
        <dt>After graduation</dt><dd>Canary rebuilds the Pons pool id from the launch record and reads the Uniswap v4 pool directly: the price from the tick, the active liquidity, the swaps of the recent window and the hook's pending fees. Curve rules stop at graduation and pool rules start only when both sweeps are in the pool, so a migration can never pass for a drained reserve.</dd>
        <dt>Evidence, not intent</dt><dd>A balance drop can be a sell, a transfer or a burn; fees moving is not a creator claim; a price move is volatility, not a direction. Canary names the measured change and leaves the reading to you. None of its signals is a trade instruction.</dd>
        <dt>Unknown stays unknown</dt><dd>Public nodes refuse some log reads. A failed read becomes "not known", never zero: an unknown last trade cannot set off the dead-volume rule. Trade counts cover a bounded recent window, not the token's life.</dd>
        <dt>In this tab</dt><dd>Tokens you keep here are scanned every minute while this page is open, and Canary's own rules (its source, compiled for the browser) compare each read with the last one this browser saw. The list stays in this browser only. Telegram alerts come from the server's watch list, when its operator turns them on.</dd>
        <dt>Sources</dt><dd>Robinhood Chain's public RPC through this site's server, one shared and rate-limited queue for all its Robinhood tools; every request passes a read-only allowlist of six JSON-RPC methods. Canary is <a href="${REPO}" target="_blank" rel="noopener noreferrer">Gipppp121/canary</a> v0.4 (MIT), unchanged, running behind this page. Unofficial: not affiliated with Pons, Robinhood or Uniswap.</dd>
      </dl>
    </details>
    <div class="cs-sheet" id="cy-sheet" hidden>
      <div class="cs-sheet-bg" data-close></div>
      <section class="cs-sheet-card" role="dialog" aria-modal="true" aria-label="Token" tabindex="-1"></section>
    </div>`;

  const els = {
    off: root.querySelector('#cy-off'),
    band: root.querySelector('#cy-band'),
    form: root.querySelector('#cy-form'),
    q: root.querySelector('#cy-q'),
    tryBox: root.querySelector('#cy-try'),
    result: root.querySelector('#cy-result'),
    lists: root.querySelector('#cy-lists'),
    sub: root.querySelector('#cy-watch-sub'),
    grid: root.querySelector('#cy-grid'),
    foot: root.querySelector('#cy-watch-foot'),
    levels: root.querySelector('#cy-levels'),
    feed: root.querySelector('#cy-feed'),
    rules: root.querySelector('#cy-rules'),
    sheet: root.querySelector('#cy-sheet'),
    card: root.querySelector('#cy-sheet .cs-sheet-card'),
  };
  if (badge) badge.textContent = !serverOn ? 'Sample data' : info.mode === 'demo' ? 'Demo data · read-only' : 'Robinhood Chain · read-only';
  if (!serverOn || info.mode === 'demo') {
    const b = els.lists.querySelector('[data-list="server"]');
    b.firstChild.textContent = 'Demo list ';
  }
  if (offReason) {
    els.off.innerHTML = `<p class="tk-note warn"><b>Canary is off on this server.</b> ${esc(offReason === 'signing_material' ? 'It found a private key or a seed phrase in the server environment and refuses to run next to one. The site never signs: remove it and restart.' : offReason === 'switched_off' ? 'It was switched off with CANARY=0.' : 'It could not start.')} Below is a recorded demo cycle.</p>`;
  }

  // ---------------------------------------------------------------- data

  const controlHeaders = () => {
    const k = session.get(KEY_KEY);
    return k ? { 'x-canary-control': k } : {};
  };
  async function api(path, opts = {}) {
    const res = await fetch(path, { cache: 'no-store', ...opts, headers: { ...controlHeaders(), ...(opts.headers || {}) } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const e = new Error((body && body.message) || `The server answered ${res.status}.`);
      e.status = res.status;
      e.code = body && body.error;
      throw e;
    }
    return body;
  }

  async function loadSample() {
    if (!sample) sample = (await import('./demo-data.js')).default;
    rules = rules || sample.rules;
    return sample;
  }
  function sampleFrame(i) {
    const f = sample.frames[i];
    return {
      mode: 'sample',
      now: f.now,
      chain: f.chain,
      index: { ready: true },
      pass: f.pass,
      limits: sample.limits,
      control: { mode: 'demo', allowed: false },
      thresholds: sample.thresholds,
      stats: f.stats,
      tokens: f.tokens,
      alerts: sample.alerts.filter((a) => a.at <= f.now),
      recent: sample.frames[0].tokens.map((t) => ({ token: t.token, symbol: t.symbol })),
    };
  }

  async function refresh() {
    if (serverOn) {
      try {
        data = await api('/api/canary/state');
        if (!rules) rules = await api('/api/canary/rules');
      } catch (err) {
        if (!data) {
          els.band.innerHTML = `<p class="tk-empty">Canary did not answer: ${esc(err.message)}</p>`;
          return;
        }
      }
    } else {
      await loadSample();
      data = sampleFrame(ui.frame);
    }
    render();
  }

  // ---------------------------------------------------------------- render

  const ref = () => (data ? data.now || Date.now() : Date.now());
  const windowMin = () => (data && data.windows ? Math.round((data.windows.tradeBlocks * SECONDS_PER_BLOCK) / 60) : null);

  function renderBand() {
    const c = data.chain || {};
    const live = c.status === 'ok';
    const dot = !serverOn ? 'sample' : live ? 'live' : c.status === 'probing' ? 'warm' : 'error';
    const chainText = !serverOn ? 'Recorded demo' : live ? `Block ${Number(c.block).toLocaleString('en-US')}` : c.status === 'probing' ? 'Connecting' : 'RPC unreachable';
    const p = data.pass || {};
    els.band.innerHTML = `
      <div class="tk-stat"><b class="cy-chain"><span class="live-dot" data-state="${dot}"><i></i></span>${esc(chainText)}</b><span>Robinhood Chain${serverOn && data.mode === 'demo' ? ', made up' : ''}${p.at ? ` · last sweep ${esc(ago(p.at, ref()))}` : ''}</span></div>
      <div class="tk-stat"><b>${int((data.tokens || []).length)}</b><span>${serverOn && data.mode === 'live' ? 'watched on the server' : 'made-up tokens watched'}, a sweep every ${int(p.pollSeconds)} s</span></div>
      <div class="tk-stat"><b class="${data.stats.leave24h ? 'x-down' : ''}">${int(data.stats.leave24h)}</b><span>LEAVE signals in 24 h</span></div>
      <div class="tk-stat"><b>${int(data.stats.watch24h)}</b><span>WATCH signals in 24 h</span></div>`;
  }

  function renderTry() {
    const rec = (data.recent || []).filter((r) => isAddr(r.token));
    if (!rec.length) {
      els.tryBox.innerHTML = serverOn && data.index && data.index.building ? '<p class="cy-try-note">Reading the newest Pons V2 launches…</p>' : '';
      els.tryBox.dataset.html = '';
      return;
    }
    const label = serverOn && data.mode === 'live' ? 'Newest launches' : 'Demo tokens';
    const name = (r) => {
      const row = (data.tokens || []).find((t) => lc(t.token) === lc(r.token));
      return row && row.symbol ? `$${row.symbol}` : short(r.token);
    };
    const html = `<span class="cy-try-label">${label}</span>${rec.map((r) => `<button type="button" class="cy-chip" data-try="${esc(r.token)}">${esc(name(r))}${r.ageS != null ? `<small>${esc(span(r.ageS * 1000))}</small>` : ''}</button>`).join('')}`;
    if (els.tryBox.dataset.html !== html) {
      els.tryBox.innerHTML = html;
      els.tryBox.dataset.html = html;
    }
  }

  function tabStatus(key) {
    const at = Date.now();
    return worst([...(tab.fired[key] || []), ...tab.alerts.filter((a) => lc(a.token) === key && at - a.at < STATUS_WINDOW_MS)]);
  }
  function tabRows() {
    return tab.list.map((it) => {
      const key = lc(it.token);
      const v = tab.view[key] || null;
      const fired = tab.fired[key] || [];
      return { token: it.token, symbol: it.symbol, source: 'tab', status: v ? tabStatus(key) : it.error ? 'ERROR' : 'PENDING', view: v, signals: fired, error: it.error ? { message: it.error } : null, at: it.at || null };
    });
  }

  // The signal that explains a row's status: from its latest sweep, else the newest one of that level.
  function why(r) {
    const level = { LEAVE: 'leave', WATCH: 'warn', INFO: 'info' }[r.status];
    if (!level) return null;
    const pool = r.source === 'tab' ? tab.alerts : data.alerts || [];
    return (r.signals || []).find((a) => a.level === level) || pool.find((a) => a.level === level && lc(a.token) === lc(r.token)) || null;
  }

  function row(r, now) {
    const v = r.view;
    const sig = why(r);
    const pool = v && v.phase === 'POOL';
    const src = r.source === 'wallet' ? 'from a wallet' : r.source === 'env' ? 'pinned' : r.source === 'tab' ? 'this tab' : r.source === 'demo' ? 'demo' : 'operator';
    return `<li><button type="button" class="cy-row" data-open="${esc(r.token)}" data-from="${r.source === 'tab' ? 'tab' : 'server'}">
      <span class="cy-st">${statusPill(r.status)}</span>
      <span class="cy-tok"><b>${r.symbol ? `$${esc(r.symbol)}` : esc(short(r.token))}</b><small>${esc(short(r.token))} · ${esc(src)}</small></span>
      <span class="cy-c" data-k="Phase">${v ? `<span class="pill mute">${esc(v.phase.toLowerCase())}</span>` : '—'}</span>
      <span class="cy-c" data-k="Deployer">${v ? esc(pct(v.devPct)) : '—'}</span>
      <span class="cy-c" data-k="${pool ? 'Price' : 'Reserve'}">${v ? esc(pool ? amount(v.price) : `${amount(v.reserve)} ${v.pair}`) : '—'}</span>
      <span class="cy-c" data-k="Trades">${v ? esc(int(v.trades)) : '—'}</span>
      <span class="cy-c" data-k="Last trade">${v && v.lastTradeAt ? `${esc(span(Math.max(0, now - v.lastTradeAt)))} ago` : '—'}</span>
      <span class="cy-sig">${sig ? `${levelPill(sig.level)}<em>${esc(sig.headline)}</em>` : r.error ? `<em class="dim">${esc(r.error.message)}</em>` : '<em class="dim">No threshold crossed</em>'}</span>
    </button></li>`;
  }

  function renderWatch() {
    const server = data.tokens || [];
    const mine = tabRows();
    for (const b of els.lists.querySelectorAll('[data-n]')) b.textContent = String(b.dataset.n === 'server' ? server.length : mine.length);
    const list = ui.list === 'tab' ? mine : server;
    const now = ui.list === 'tab' ? Date.now() : ref();
    els.sub.textContent = ui.list === 'tab'
      ? `Up to ${TAB_MAX} tokens, kept in this browser and scanned every minute while this page is open.`
      : serverOn && data.mode === 'live'
        ? `Swept every ${data.pass.pollSeconds} s for everyone who opens this page${data.telegram ? ', with Telegram alerts' : ''}. ${data.wallets ? `Positions of ${data.wallets} wallet${data.wallets > 1 ? 's' : ''} are found among recent launches.` : ''}`
        : 'Six made-up tokens on a scripted tape that sets off every rule once a cycle.';
    els.grid.innerHTML = list.length
      ? list.map((r) => row(r, now)).join('')
      : `<li class="tk-empty">${ui.list === 'tab' ? (serverOn ? 'Nothing here yet. Scan a token and keep it in this tab.' : 'Watching in a tab needs the site\'s server: scans go through it.') : 'The server watches nothing yet.'}</li>`;
    // the operator's controls, and how to get them
    let foot = '';
    if (ui.list === 'server' && serverOn && data.mode === 'live') {
      const c = data.control || {};
      if (c.allowed) foot = `<p class="tk-note">You can change this list: scan a token and add it, or open one to take it off. ${c.mode === 'key' ? '<button type="button" class="cy-textbtn" data-act="key-forget">Forget the key</button>' : ''}</p>`;
      else if (c.mode === 'key') {
        foot = `<details class="cy-op"><summary>Operator</summary><form class="cy-key" data-act="key"><input type="password" name="key" autocomplete="off" placeholder="Canary control key" aria-label="Canary control key"><button class="btn btn-line btn-sm" type="submit">Unlock</button></form><p class="dim">The key set as CANARY_CONTROL_TOKEN on the server. It is kept for this browser session only and sent as a header, never in a link.</p></details>`;
      } else {
        foot = '<p class="tk-note">The server list is set by the site\'s operator: <code>CANARY_TOKENS</code> or <code>CANARY_WALLETS</code> in its .env, or the board itself when the site runs on 127.0.0.1, or with <code>CANARY_CONTROL_TOKEN</code> for a public site.</p>';
      }
    }
    // only when it changes: the operator's key field must survive the polls
    if (els.foot.dataset.html !== foot) {
      els.foot.innerHTML = foot;
      els.foot.dataset.html = foot;
    }
  }

  function event(a, now, { withSymbol = true } = {}) {
    const row = (data.tokens || []).find((t) => lc(t.token) === lc(a.token)) || tabRows().find((t) => lc(t.token) === lc(a.token));
    const v = row && row.view;
    const vs = a.prevAt ? ` · against the read ${span(Math.max(0, a.at - a.prevAt))} before` : '';
    return `<li class="cy-ev" data-level="${esc(a.level)}">
      ${levelPill(a.level)}
      <div class="cy-ev-main">
        <button type="button" class="cy-ev-head" data-open="${esc(a.token)}" data-from="${a.mine ? 'tab' : 'server'}">${esc(withSymbol ? a.headline : a.headline.replace(/^[^:]*:\s*/, ''))}</button>
        <p>${esc(detail(a, v))}</p>
        ${delta(a, v)}
      </div>
      <div class="cy-ev-meta"><code>${esc(a.rule)}</code><time>${esc(ago(a.at, now))}${a.mine ? ' · this tab' : ''}${esc(vs)}</time></div>
    </li>`;
  }

  function renderFeed() {
    const now = ref();
    const all = [...(data.alerts || []), ...(serverOn ? tab.alerts : [])].sort((x, y) => y.at - x.at);
    const list = ui.level === 'all' ? all : all.filter((a) => a.level === ui.level);
    els.feed.innerHTML = list.length
      ? list.slice(0, 60).map((a) => event(a, a.mine ? Date.now() : now)).join('')
      : `<li class="tk-empty">${all.length ? 'No signal of this level yet.' : 'No signal yet. The first sweep only records; signals come from the comparisons after it.'}</li>`;
  }

  function renderRules() {
    if (!rules || els.rules.childElementCount) return;
    const thr = (r) => (r.threshold == null ? 'any decrease' : r.rule === 'pool-price-move' ? `±${r.threshold}%` : r.rule === 'pool-swap-burst' || r.rule === 'serial-deployer' ? `${r.threshold}+ ${r.unit}` : r.rule === 'volume-dead' ? `${r.threshold}+ min` : `> ${r.threshold}${r.unit === '%' ? '%' : ` ${r.unit}`}`);
    els.rules.innerHTML = rules.rules
      .map((r) => `<article class="cy-rule">${levelPill(r.level)}<h3><code>${esc(r.rule)}</code></h3><b>${esc(r.rule === 'phase-change' ? 'any change' : thr(r))}</b><p>${esc(r.when)}</p></article>`)
      .join('');
  }

  function render() {
    if (!data) return;
    renderBand();
    renderTry();
    renderWatch();
    renderFeed();
    renderRules();
    if (ui.open && !els.sheet.hidden) openToken(ui.open.token, ui.open.from, { quiet: true });
  }

  // ---------------------------------------------------------------- scan

  function scanCard(r) {
    const s = r.snapshot;
    const v = r.view;
    const snap = revive(s);
    const now = evaluate(undefined, snap, data.thresholds || undefined, Date.now()); // the rules a single read can set off
    const inTab = tab.list.some((t) => lc(t.token) === lc(s.token));
    const onServer = (data.tokens || []).some((t) => lc(t.token) === lc(s.token));
    const canServer = serverOn && data.control && data.control.allowed && !onServer;
    return `<article class="tk-card cy-result">
      <header class="cy-res-head">
        <div><h3>$${esc(s.symbol)}</h3><p><span class="pill mute">${esc(v.phase.toLowerCase())}</span> <code>${esc(short(s.token))}</code> <button type="button" class="icon-btn cy-copy" data-copy="${esc(s.token)}" aria-label="Copy the address"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></p></div>
        <small>${esc(r.cached ? 'read a few seconds ago' : 'read just now')}</small>
      </header>
      <div class="tk-band cy-facts">${facts(v, { indexReady: r.indexReady !== false, windowMin: windowMin(), now: Date.now() })}</div>
      ${now.length ? `<ul class="cy-now">${now.map((a) => `<li>${levelPill(a.level)}<span>${esc(a.headline)}</span></li>`).join('')}</ul>` : ''}
      <p class="cy-res-note">One read shows the state now. ${inTab ? 'It is in this tab: Canary reads it every minute and compares.' : 'Keep it in this tab and Canary reads it every minute, comparing each read with the last.'}</p>
      <div class="cy-actions">
        ${inTab ? '<span class="pill up">In this tab</span>' : `<button type="button" class="btn btn-light btn-sm" data-act="tab-add" data-token="${esc(s.token)}" data-symbol="${esc(s.symbol)}">Watch in this tab</button>`}
        ${onServer ? '<span class="pill mute">On the server list</span>' : canServer ? `<button type="button" class="btn btn-line btn-sm" data-act="server-add" data-token="${esc(s.token)}">Add to the server list</button>` : ''}
        <span class="cy-links">${links(s.token)}</span>
      </div>
    </article>`;
  }

  async function scan(raw) {
    const token = String(raw || '').trim();
    if (!isAddr(token)) {
      els.result.innerHTML = '<p class="tk-note warn"><b>That is not a token address.</b> Paste the 0x address of a Pons V2 token: 0x and 40 letters and digits.</p>';
      return;
    }
    if (!serverOn) {
      const row = (data.tokens || []).find((t) => lc(t.token) === lc(token));
      if (row) return openToken(row.token, 'server');
      els.result.innerHTML = '<p class="tk-note"><b>Scanning needs the site\'s server.</b> A scan reads Robinhood Chain through it, and this copy of the page has none. Run the site (<code>npm start</code>) to scan any Pons V2 token; the demo tokens above open from the board.</p>';
      return;
    }
    els.result.innerHTML = '<p class="tk-empty">Reading the chain…</p>';
    try {
      lastScan = await api(`/api/canary/scan?token=${encodeURIComponent(token)}`);
      els.result.innerHTML = scanCard(lastScan);
    } catch (err) {
      lastScan = null;
      els.result.innerHTML = `<p class="tk-note warn"><b>${esc(err.code === 'not_pons' ? 'Not a Pons V2 launch.' : err.status === 429 ? 'Too many scans.' : 'The read failed.')}</b> ${esc(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------- watching in this tab

  const saveTab = () => {
    tab.alerts = tab.alerts.slice(0, 100);
    local.set(TAB_KEY, tab);
  };
  function tabAdd(token, symbol) {
    if (tab.list.some((t) => lc(t.token) === lc(token))) return;
    if (tab.list.length >= TAB_MAX) {
      toast(`This tab keeps ${TAB_MAX} tokens at most. Take one off first.`);
      return;
    }
    tab.list.push({ token, symbol: symbol || null, addedAt: Date.now() });
    // the scan just made is the first read to compare with
    if (lastScan && lc(lastScan.snapshot.token) === lc(token)) takeRead(tab.list[tab.list.length - 1], lastScan);
    saveTab();
    ui.list = 'tab';
    for (const b of els.lists.querySelectorAll('[data-list]')) b.setAttribute('aria-selected', String(b.dataset.list === 'tab'));
    render();
    if (lastScan) els.result.innerHTML = scanCard(lastScan);
    scheduleTab(TAB_EVERY_MS);
  }
  function tabRemove(token) {
    const key = lc(token);
    tab.list = tab.list.filter((t) => lc(t.token) !== key);
    for (const k of ['last', 'view', 'fired', 'hist']) delete tab[k][key];
    tab.alerts = tab.alerts.filter((a) => lc(a.token) !== key);
    saveTab();
    render();
  }
  function takeRead(it, r) {
    const key = lc(it.token);
    const after = revive(r.snapshot);
    const prev = tab.last[key];
    const before = prev ? revive(prev) : undefined;
    const fired = evaluate(before, after, data.thresholds || undefined, Date.now());
    const had = new Set((tab.fired[key] || []).map((a) => a.rule));
    for (const a of fired) {
      if (LEVEL_RULES.has(a.rule) && had.has(a.rule)) continue;
      tab.alerts.unshift({ rule: a.rule, level: a.level, token: a.token, symbol: a.symbol, headline: a.headline, detail: a.detail, was: a.was ?? null, now: a.now ?? null, at: after.at, prevAt: before ? before.at : null, mine: true });
    }
    tab.fired[key] = fired.map((a) => ({ rule: a.rule, level: a.level, headline: a.headline }));
    tab.last[key] = r.snapshot;
    tab.view[key] = r.view;
    const v = r.view;
    tab.hist[key] = [...(tab.hist[key] || []), [after.at, v.devPct, v.phase === 'POOL' ? v.price : v.reserve, v.trades, v.phase]].slice(-120);
    Object.assign(it, { symbol: after.symbol, at: after.at, error: null });
  }
  async function tabSweep() {
    for (const it of [...tab.list]) {
      if (!tab.list.includes(it)) continue;
      try {
        takeRead(it, await api(`/api/canary/scan?token=${encodeURIComponent(it.token)}`));
      } catch (err) {
        it.error = err.status === 429 || err.status === 503 ? 'Busy, read next minute' : err.message;
        if (err.code === 'not_pons') tabRemove(it.token);
      }
      await sleep(1200);
    }
    saveTab();
    render();
  }
  function scheduleTab(ms) {
    clearTimeout(ui.tabTimer);
    if (!serverOn || !tab.list.length) return;
    ui.tabTimer = setTimeout(async () => {
      await tabSweep();
      scheduleTab(TAB_EVERY_MS);
    }, ms);
  }

  // ---------------------------------------------------------------- the token sheet

  async function tokenData(token, from) {
    const key = lc(token);
    if (from === 'tab') {
      const r = tabRows().find((t) => lc(t.token) === key);
      if (!r) return null;
      return { ...r, snapshot: tab.last[key] || null, history: (tab.hist[key] || []).map(([at, devPct, level, trades, phase]) => ({ at, devPct, trades, phase, reserve: phase === 'POOL' ? null : level, price: phase === 'POOL' ? level : null })), alerts: tab.alerts.filter((a) => lc(a.token) === key), now: Date.now() };
    }
    if (!serverOn) {
      const r = (data.tokens || []).find((t) => lc(t.token) === key);
      const d = sample.details[key];
      if (!r || !d) return null;
      return { ...r, snapshot: d.snapshot, history: d.history.filter((h) => h.at <= data.now), alerts: (data.alerts || []).filter((a) => lc(a.token) === key), now: data.now };
    }
    const d = await api(`/api/canary/token?token=${encodeURIComponent(token)}`);
    return { ...d, now: data.now };
  }

  async function openToken(token, from = 'server', { quiet = false } = {}) {
    if (!isAddr(token)) return;
    ui.open = { token, from };
    if (!quiet) {
      els.sheet.hidden = false;
      document.documentElement.classList.add('cs-locked');
      els.card.innerHTML = '<p class="tk-empty">Reading…</p>';
      els.card.focus();
    }
    let d = null;
    try {
      d = await tokenData(token, from);
    } catch (err) {
      if (!quiet) els.card.innerHTML = `<button type="button" class="icon-btn cs-x" data-close aria-label="Close"><svg aria-hidden="true"><use href="#i-close"/></svg></button><p class="tk-empty">${esc(err.message)}</p>`;
      return;
    }
    if (!ui.open || ui.open.token !== token) return;
    if (!d) {
      els.card.innerHTML = '<button type="button" class="icon-btn cs-x" data-close aria-label="Close"><svg aria-hidden="true"><use href="#i-close"/></svg></button><p class="tk-empty">This token is not on a watch list any more.</p>';
      return;
    }
    const v = d.view;
    const s = d.snapshot || {};
    const pool = v && v.phase === 'POOL';
    const h = d.history || [];
    const scroll = els.card.scrollTop;
    const canStop = from === 'tab' || (serverOn && data.control && data.control.allowed && d.source === 'operator');
    const addrs = [
      ['Token', s.token || token],
      ['Deployer', s.deployer],
      ['Curve', s.curve],
      ['Pair', s.pairToken && !/^0x0{40}$/i.test(s.pairToken) ? s.pairToken : null],
      ['Pool id', s.poolId],
    ].filter(([, a]) => a);
    els.card.innerHTML = `
      <button type="button" class="icon-btn cs-x" data-close aria-label="Close"><svg aria-hidden="true"><use href="#i-close"/></svg></button>
      <div class="cs-head"><div><h2>${d.symbol ? `$${esc(d.symbol)}` : esc(short(token))}</h2><p class="dim">${v ? `${esc(v.phase.toLowerCase())} · paired with ${esc(v.pair)}` : 'not read yet'} · ${esc(from === 'tab' ? 'watched in this tab' : 'watched on the server')}</p></div>${statusPill(d.status)}</div>
      ${v ? `<div class="tk-band cs-facts cy-facts">${facts(v, { windowMin: windowMin(), now: from === 'tab' ? Date.now() : d.now || Date.now() })}</div>` : ''}
      ${(d.signals || []).length ? `<h3 class="cs-h">On the latest sweep</h3><ul class="cy-now">${d.signals.map((a) => `<li>${levelPill(a.level)}<span>${esc(a.headline)}</span></li>`).join('')}</ul>` : ''}
      <h3 class="cs-h">${h.length} sweep${h.length === 1 ? '' : 's'}${h.length > 1 ? `, over ${esc(span(h[h.length - 1].at - h[0].at))}` : ''}</h3>
      <div class="cy-sparks">
        ${sparkline(h.map((x) => [x.at, x.devPct]), 'Deployer share', pct)}
        ${pool ? sparkline(h.map((x) => [x.at, x.price]), 'Pool price', amount) : sparkline(h.map((x) => [x.at, x.reserve]), `Curve reserve, ${v ? v.pair : ''}`, amount)}
        ${sparkline(h.map((x) => [x.at, x.trades]), pool ? 'Swaps in the window' : 'Trades in the window', int)}
      </div>
      <h3 class="cs-h">Signals</h3>
      ${(d.alerts || []).length ? `<ol class="cy-feed cy-feed-sm">${d.alerts.slice(0, 20).map((a) => event(a, a.mine ? Date.now() : d.now || Date.now(), { withSymbol: false })).join('')}</ol>` : '<p class="cs-none dim">None yet: every sweep so far stayed under the thresholds.</p>'}
      <h3 class="cs-h">Addresses</h3>
      <dl class="cy-addrs">${addrs.map(([k, a]) => `<div><dt>${esc(k)}</dt><dd><code>${esc(short(a))}</code><button type="button" class="icon-btn cy-copy" data-copy="${esc(a)}" aria-label="Copy the ${esc(k.toLowerCase())} address"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></dd></div>`).join('')}</dl>
      <div class="cy-actions">${links(token)}${canStop ? `<button type="button" class="btn btn-line btn-sm" data-act="${from === 'tab' ? 'tab-remove' : 'server-remove'}" data-token="${esc(token)}">Stop watching</button>` : ''}</div>
      <p class="tk-note">Evidence, not intent. A deployer balance drop can be a sell, a transfer or a burn; Canary names what its reads prove and leaves the reading to you. Not a trade instruction.</p>`;
    if (quiet) els.card.scrollTop = scroll;
  }

  function closeSheet() {
    ui.open = null;
    els.sheet.hidden = true;
    document.documentElement.classList.remove('cs-locked');
  }

  // ---------------------------------------------------------------- events

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    scan(els.q.value);
  });
  els.lists.addEventListener('click', (e) => {
    const b = e.target.closest('[data-list]');
    if (!b) return;
    ui.list = b.dataset.list;
    for (const x of els.lists.querySelectorAll('[data-list]')) x.setAttribute('aria-selected', String(x === b));
    renderWatch();
  });
  els.levels.addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    ui.level = b.dataset.level;
    for (const x of els.levels.querySelectorAll('[data-level]')) x.setAttribute('aria-selected', String(x === b));
    renderFeed();
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-act="key"]');
    if (!f) return;
    e.preventDefault();
    session.set(KEY_KEY, String(new FormData(f).get('key') || '').trim());
    await refresh();
    if (!(data.control && data.control.allowed)) {
      session.set(KEY_KEY, '');
      toast('That key did not unlock the list.');
    } else toast('Unlocked for this session.');
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      toast((await copyText(copy.dataset.copy)) ? 'Address copied' : 'Could not copy');
      return undefined;
    }
    const tryB = e.target.closest('[data-try]');
    if (tryB) {
      els.q.value = tryB.dataset.try;
      return scan(tryB.dataset.try);
    }
    const act = e.target.closest('[data-act]');
    if (act && act.tagName === 'BUTTON') {
      const token = act.dataset.token;
      if (act.dataset.act === 'tab-add') return tabAdd(token, act.dataset.symbol);
      if (act.dataset.act === 'tab-remove') {
        tabRemove(token);
        return closeSheet();
      }
      if (act.dataset.act === 'key-forget') {
        session.set(KEY_KEY, '');
        return refresh();
      }
      if (act.dataset.act === 'server-add' || act.dataset.act === 'server-remove') {
        try {
          await api(`/api/canary/${act.dataset.act === 'server-add' ? 'watch' : 'unwatch'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
          toast(act.dataset.act === 'server-add' ? 'Added to the server list' : 'Taken off the server list');
          if (act.dataset.act === 'server-remove') closeSheet();
          await refresh();
          if (lastScan) els.result.innerHTML = scanCard(lastScan);
        } catch (err) {
          toast(err.message);
        }
        return undefined;
      }
    }
    const open = e.target.closest('[data-open]');
    if (open && !els.card.contains(open)) return openToken(open.dataset.open, open.dataset.from);
    return undefined;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.sheet.hidden) closeSheet();
  });

  // ---------------------------------------------------------------- timers

  function schedule() {
    clearTimeout(ui.timer);
    if (!ui.active) return;
    const every = serverOn ? Math.max(4000, Math.min(15_000, ((data && data.pass && data.pass.pollSeconds) || 15) * 1000)) : (sample && sample.step) || 4000;
    ui.timer = setTimeout(async () => {
      if (!serverOn && sample) ui.frame = (ui.frame + 1) % sample.frames.length;
      await refresh();
      schedule();
    }, every);
  }

  refresh();
  scheduleTab(4000);
  return {
    setActive(on) {
      ui.active = on;
      if (on) refresh().then(schedule);
      else {
        clearTimeout(ui.timer);
        closeSheet();
      }
    },
  };
}
