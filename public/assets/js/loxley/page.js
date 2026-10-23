// Loxley: the exit desk for Pons V2 launches on Robinhood Chain, on paper. The site's server runs loxley's
// own feed and paper sniper (server/loxley) and streams what they do; reads (scan, market) are loxley's own
// commands returning data. Without a server the page replays a recorded session on loxley's mock chain.
// Nothing here can trade: no key, no wallet, no signer, anywhere on the site.

import { esc, toast, copyText } from '../ui.js';
import { connectLoxley, loxleyRead } from './client.js';

const REPO = 'https://github.com/shmidtqq65/loxley';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const PONS = 'https://www.ponsfamily.com/token/';
const DEXSCREENER = 'https://dexscreener.com/robinhood/';
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '');

// ------------------------------------------------------------------ formatting

const trim = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const eth = (v, signed = false) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  const body = a === 0 ? '0' : a >= 100 ? a.toFixed(0) : a >= 1 ? trim(a.toFixed(2)) : a >= 0.001 ? trim(a.toFixed(4)) : a >= 0.000001 ? trim(a.toFixed(6)) : '<0.000001';
  return `${s}${body} ETH`;
};
const pct = (v, signed = false, d = 1) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : v < 0 ? '−' : '';
  const a = Math.abs(v);
  return `${s}${trim(a.toFixed(a >= 100 ? 0 : d))}%`;
};
const usd = (v) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${trim((v / 1e9).toFixed(2))}B`;
  if (a >= 1e6) return `$${trim((v / 1e6).toFixed(2))}M`;
  if (a >= 1e3) return `$${trim((v / 1e3).toFixed(1))}K`;
  if (a >= 1) return `$${trim(v.toFixed(2))}`;
  if (a === 0) return '$0';
  const [m, e] = a.toExponential(3).split('e');
  const zeros = -Number(e) - 1;
  if (zeros < 4) return `$${trim(a.toFixed(zeros + 3))}`;
  return `$0.0${String(zeros).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[d]).join('')}${m.replace('.', '').replace(/0+$/, '')}`;
};
const span = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
};
const tone = (v) => (v > 0 ? 'x-up' : v < 0 ? 'x-down' : '');
const VERDICT = { FIRE: ['Fire', 'up'], WATCH: ['Watch', 'warn'], SKIP: ['Skip', 'down'] };
const verdictPill = (v) => {
  const [label, cls] = VERDICT[v] || [v || '—', 'mute'];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};
const STAMP = { ENTER: 'up', CAREFUL: 'warn', AVOID: 'down' };
const stampPill = (s) => `<span class="pill ${STAMP[s] || 'mute'}">${esc(String(s || '—').toLowerCase())}</span>`;
const VOTE = { ok: 'up', warn: 'warn', bad: 'down', na: 'mute' };
const ext = (href, label) => `<a class="cy-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}<svg aria-hidden="true"><use href="#i-out"/></svg></a>`;

// ------------------------------------------------------------------ the page

export function initLoxley(env) {
  const root = document.getElementById('l-root');
  const badge = document.querySelector('[data-l-mode]');
  const site = env.site || {};
  const info = site.loxley || null;
  const serverOn = env.mode === 'server' && Boolean(info && info.on);
  const live = serverOn && info.mode === 'live';
  const ui = { active: false, conn: null, store: null, verdict: 'all', dirty: false, raf: 0, clock: null, market: null, more: false };

  root.innerHTML = `
    <div class="tool-intro">
      <h1 class="page-title">The entry is a guess. The exit is arithmetic.</h1>
      <p>Every Pons V2 launch on Robinhood Chain opens behind a 99% tax that decays to nothing in seconds. Loxley reads each launch in one multicall and scores it with rules you can read. Its sniper fires once the tax is under the ceiling, marks the position with the exact price of leaving, and leaves on its rules, on a siren, or the moment the deployer's tokens move.</p>
    </div>
    <p class="tk-note lx-paper"><svg aria-hidden="true"><use href="#i-lock"/></svg><span><b>Paper only on this site.</b> There is no wallet, key or signer anywhere on it: the desk below trades nothing, and nothing here will ever ask for a private key or a seed phrase. Real trades are Loxley's command line on your own machine, with a burner wallet: <a href="${REPO}" target="_blank" rel="noopener noreferrer">shmidtqq65/loxley</a>.</span></p>
    <div class="tk-band lx-band" id="lx-band"></div>
    <div class="tk-grid lx-grid">
      <section class="lx-main">
        <div class="tk-sec-head">
          <div><h2>Hunt</h2><p id="lx-hunt-sub">Every launch as it lands, read and scored; followed up a minute later with who bought.</p></div>
          <div class="tk-tabs" role="tablist" aria-label="Verdict" id="lx-verdicts">
            <button type="button" role="tab" data-v="all" aria-selected="true">All</button>
            <button type="button" role="tab" data-v="FIRE" aria-selected="false">Fire</button>
            <button type="button" role="tab" data-v="WATCH" aria-selected="false">Watch</button>
            <button type="button" role="tab" data-v="SKIP" aria-selected="false">Skip</button>
          </div>
        </div>
        <ol class="lx-cards" id="lx-cards"><li class="tk-empty">Opening the feed…</li></ol>
        <button type="button" class="tk-more" id="lx-more" hidden>Show more launches</button>
      </section>
      <aside class="lx-side">
        <section class="tk-card"><h3>Paper book <small id="lx-book-size"></small></h3><div id="lx-book"></div></section>
        <section class="tk-card"><h3>Tape <small>newest first</small></h3><ol class="lx-tape" id="lx-tape"></ol></section>
        <section class="tk-card"><h3>The rules in force</h3><div id="lx-rules"></div></section>
      </aside>
    </div>

    <section class="tk-sec">
      <div class="tk-sec-head"><div><h2>Read one token</h2><p>Loxley's scan: the curve or the pool, the launch record and its score, the council's eight votes on a pool, what leaving costs, and the wallet behind it.</p></div></div>
      <form class="k-search" id="lx-form" autocomplete="off">
        <label class="k-field">
          <svg aria-hidden="true"><use href="#i-search"/></svg>
          <input id="lx-q" name="token" type="text" spellcheck="false" autocapitalize="off" placeholder="0x… a token on Robinhood Chain" aria-label="Token address">
        </label>
        <button class="btn btn-accent" type="submit">Scan <svg aria-hidden="true"><use href="#i-arrow"/></svg></button>
      </form>
      <div class="cy-try" id="lx-try"></div>
      <div id="lx-scan" aria-live="polite"></div>
    </section>

    <section class="tk-sec">
      <div class="tk-sec-head"><div><h2>Market</h2><p>Everything DexScreener lists on Robinhood Chain, at its deepest pool, with the desk's stamp: what selling 1 ETH would cost, and a survival score out of 85 (the explorer's share of the score needs its key).</p></div><button type="button" class="btn btn-line btn-sm" id="lx-market-load">Load the market</button></div>
      <div id="lx-market"></div>
    </section>

    <details class="panel how lx-how">
      <summary><h2>How the desk decides</h2><svg aria-hidden="true"><use href="#i-chevron"/></svg></summary>
      <dl>
        <dt>Reading a launch</dt><dd>One multicall per launch: the dev buy, the creator tax and who receives the fees, the socials declared at launch, the wallets declared exempt from the opening tax (a bundle you could not see otherwise), the deployer's record in the window, and the launch-farm fingerprint: the same dev buy to the wei, the same tax and links from other fresh wallets inside 30 minutes.</dd>
        <dt>The score</dt><dd>Starts at 50. Every rule adds or takes away points with its reason written next to it: a 1–6% dev buy +15, a declared bundle −25, a farm −25, a deployer with five launches and no graduation −25, no socials −15. 75 and over is FIRE, 45 and over WATCH, the rest SKIP.</dd>
        <dt>The draw</dt><dd>A launch the rules let through is not bought at once: the sniper polls the opening tax and fires only when it is under the ceiling, or gives up when it stays high.</dd>
        <dt>The exits</dt><dd>Every open position is marked with the exact quote for leaving. It closes at the take profit, the stop, the trailing stop, the time limit, on a pool siren (liquidity leaving, a crash, distribution), or the moment the deployer's tokens move: DEV SOLD closes it whatever the profit.</dd>
        <dt>On this site</dt><dd>Paper only: fills are priced from the curve or quoted from the v4 pool, and nothing is sent. ${serverOn && info.pace === 'shared' ? 'It shares Robinhood Chain\'s public node with the site\'s other tools, so it reads more slowly than the command line: launches every 2 seconds, one follow-up at a minute, marks every 15 seconds.' : 'Run by the site\'s server for everyone who opens this page.'}</dd>
        <dt>Sources</dt><dd>Robinhood Chain's RPC through this site's server, Blockscout and DexScreener. Loxley is <a href="${REPO}" target="_blank" rel="noopener noreferrer">shmidtqq65/loxley</a> (MIT), unchanged: the site loads its reading and paper modules and never its wallet or trading code. Unofficial: not affiliated with Pons or Robinhood.</dd>
      </dl>
    </details>`;
  if (badge) badge.textContent = !serverOn ? 'Recorded · paper' : live ? 'Pons V2 · paper' : 'Demo chain · paper';

  const els = {
    band: root.querySelector('#lx-band'),
    cards: root.querySelector('#lx-cards'),
    more: root.querySelector('#lx-more'),
    verdicts: root.querySelector('#lx-verdicts'),
    huntSub: root.querySelector('#lx-hunt-sub'),
    book: root.querySelector('#lx-book'),
    bookSize: root.querySelector('#lx-book-size'),
    tape: root.querySelector('#lx-tape'),
    rules: root.querySelector('#lx-rules'),
    form: root.querySelector('#lx-form'),
    q: root.querySelector('#lx-q'),
    tryBox: root.querySelector('#lx-try'),
    scan: root.querySelector('#lx-scan'),
    marketBtn: root.querySelector('#lx-market-load'),
    market: root.querySelector('#lx-market'),
  };
  const linksFor = (token, curve) => (live && isAddr(token) ? [ext(PONS + token, 'Pons'), ext(`${EXPLORER}/token/${token}`, 'Blockscout'), ext(DEXSCREENER + token.toLowerCase(), 'DEX Screener'), isAddr(curve) ? ext(`https://axiom.trade/meme/${curve.toLowerCase()}?chain=robinhood`, 'Axiom') : ''].join('') : '');

  // ---------------------------------------------------------------- render: status and totals

  let status = { connected: false };
  function renderBand() {
    const s = ui.store;
    const t = s.totals();
    const st = s.state;
    const dot = !serverOn ? 'sample' : status.connected ? 'live' : 'warm';
    const where = !serverOn ? 'Recorded session' : live ? 'Robinhood Chain' : 'Demo chain';
    const sub = !serverOn ? 'made-up launches on loxley\'s mock chain' : live ? (info.pace === 'own' ? 'its own RPC, the command line\'s pace' : 'the shared public node, read slower') : 'made-up launches, minted every few seconds';
    els.band.innerHTML = `
      <div class="tk-stat"><b class="cy-chain"><span class="live-dot" data-state="${dot}"><i></i></span>${esc(status.connected || !serverOn ? where : 'Connecting')}</b><span>${esc(sub)}</span></div>
      <div class="tk-stat"><b>${t.fired}</b><span>fired on paper, ${t.passed} refused by the rules</span></div>
      <div class="tk-stat"><b>${t.closed ? `${t.wins} of ${t.closed}` : '0'}</b><span>closed in profit</span></div>
      <div class="tk-stat"><b class="${tone(t.realisedEth)}">${esc(eth(t.realisedEth, true))}</b><span>realised, ${esc(eth(t.openEth, true))} open, ${esc(st.rules ? `${st.rules.eth} ETH` : '0.01 ETH')} a shot</span></div>`;
  }

  // ---------------------------------------------------------------- render: the hunt

  const part = (p) => `<li><b class="${tone(p.v)}">${p.v > 0 ? '+' : '−'}${Math.abs(p.v)}</b> ${esc(p.k)}<small>${esc(p.note || '')}</small></li>`;
  function card(c, now) {
    const sc = c.score || { total: null, parts: [], verdict: null };
    const b = c.bonding || {};
    const door = (c.door || []).find((d) => d.eth === 0.05) || (c.door || [])[0];
    const rec = c.deployerRecord;
    const parts = [...(sc.parts || [])].filter((p) => p.v !== 0).sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    const tags = [];
    if (b.graduated) tags.push('<span class="pill acc">graduated</span>');
    if (c.farm) tags.push(`<span class="pill down">farm · ${c.farm} sibling${c.farm > 1 ? 's' : ''}</span>`);
    if (c.exempt && c.exempt.length) tags.push(`<span class="pill down">${c.exempt.length} exempt wallet${c.exempt.length > 1 ? 's' : ''}</span>`);
    if (c.feeThird) tags.push('<span class="pill warn">fees to a third party</span>');
    if (c.socials === null) tags.push('<span class="pill mute">no socials</span>');
    if (c.pair && c.pair.eth === false) tags.push(`<span class="pill mute">paired with ${esc(c.pair.symbol || 'a token')}</span>`);
    const f = c.flow;
    const flow = f
      ? `<p class="lx-flow"><b>${esc(c.after ? `after ${c.after} s` : 'so far')}</b> ${f.buyers} buyer${f.buyers === 1 ? '' : 's'} · ${esc(eth(f.quoteIn))} in · block-0 bundle ${esc(pct(f.bundlePct))} · top 5 hold ${esc(pct(f.top5Pct))}${f.devSells ? ` · <span class="x-down">dev sold ${esc(pct(f.devSoldPct))}</span>` : ''}</p>`
      : '';
    return `<li class="lx-card" data-verdict="${esc(sc.verdict || '')}" data-token="${esc(c.token)}">
      <header class="lx-card-head">
        <div class="lx-id"><b>$${esc(c.symbol || short(c.token))}</b><span>${esc(c.name && c.name !== c.symbol ? `${c.name} · ` : '')}${esc(c.at ? `${span(now - c.at)} ago` : '')}</span></div>
        <div class="lx-score"><b>${sc.total == null ? '—' : sc.total}</b>${verdictPill(sc.verdict)}</div>
      </header>
      <dl class="lx-facts">
        <div><dt>Dev buy</dt><dd>${esc(pct(c.devBuy && c.devBuy.sharePct, false, 2))}${c.devBuy && c.devBuy.eth != null ? ` · ${esc(eth(c.devBuy.eth))}` : ''}</dd></div>
        <div><dt>Creator tax</dt><dd>${esc(c.fees && c.fees.creatorTaxBps != null ? pct(c.fees.creatorTaxBps / 100) : '—')}</dd></div>
        <div><dt>Curve</dt><dd>${esc(b.fill != null ? `${pct(b.fill * 100)} filled` : '—')}</dd></div>
        <div><dt>0.05 ETH in</dt><dd>${esc(door ? `${pct(door.impact)} impact` : '—')}</dd></div>
        <div><dt>Launches · grads</dt><dd>${esc(rec ? `${rec.launches} · ${rec.grads}` : '—')}</dd></div>
      </dl>
      ${parts.length ? `<ul class="lx-parts">${parts.slice(0, 3).map(part).join('')}${parts.length > 3 ? `<li class="lx-more"><details><summary>${parts.length - 3} more reason${parts.length - 3 > 1 ? 's' : ''}</summary><ul>${parts.slice(3).map(part).join('')}</ul></details></li>` : ''}</ul>` : ''}
      ${flow}
      ${tags.length || linksFor(c.token, c.curve) ? `<div class="lx-tags">${tags.join('')}<span class="cy-links">${linksFor(c.token, c.curve)}</span></div>` : ''}
    </li>`;
  }

  function renderCards() {
    const s = ui.store.state;
    const now = Date.now();
    const list = s.cards.filter((c) => c.symbol || c.token).filter((c) => ui.verdict === 'all' || (c.score && c.score.verdict === ui.verdict));
    const shown = ui.more ? 30 : 8;
    // a card someone opened stays open through the re-render
    const opened = new Set([...els.cards.querySelectorAll('.lx-card details[open]')].map((d) => d.closest('.lx-card').dataset.token));
    const waiting = s.error ? 'Robinhood Chain did not answer yet: the desk keeps trying, launches show here as soon as it reads the factory.' : 'Waiting for the first launch.';
    els.cards.innerHTML = list.length ? list.slice(0, shown).map((c) => card(c, now)).join('') : `<li class="tk-empty">${s.cards.length ? 'No launch with this verdict in the last ones read.' : waiting}</li>`;
    if (opened.size) for (const d of els.cards.querySelectorAll('.lx-card details')) if (opened.has(d.closest('.lx-card').dataset.token)) d.open = true;
    els.more.hidden = list.length <= 8;
    els.more.textContent = ui.more ? 'Show fewer' : `Show ${Math.min(30, list.length) - 8} more`;
  }

  // ---------------------------------------------------------------- render: the book, the tape, the rules

  function renderBook() {
    const all = ui.store.positions();
    const open = all.filter((p) => p.status === 'open');
    const closed = all.filter((p) => p.status === 'closed');
    const now = Date.now();
    const rules = ui.store.state.rules;
    els.bookSize.textContent = rules ? `${rules.eth} ETH a shot, ${rules.maxOpen} open at most` : '';
    const pos = (p) => {
      const pnl = p.status === 'open' ? (p.mark ? p.mark.pnlPct : null) : p.exit ? p.exit.pnlPct : null;
      const sub = p.status === 'open'
        ? `${p.mark ? eth(p.mark.valueEth) : 'marking'} · held ${span(now - p.openedAt)}${p.peakPct != null ? ` · peak ${pct(p.peakPct, true)}` : ''}${p.venue === 'pool' ? ' · in the pool' : ''}`
        : `${p.exit ? p.exit.why : ''} · held ${span(p.exit ? p.exit.heldMs : 0)}`;
      return `<li class="lx-pos ${p.status}"><div><b>$${esc(p.symbol || short(p.token))}</b><small>${esc(sub)}${p.entryWhy ? ` · ${esc(p.entryWhy)}` : ''}</small></div><span class="${tone(pnl)}">${esc(pnl == null ? '…' : pct(pnl, true))}</span></li>`;
    };
    els.book.innerHTML = `
      ${open.length ? `<h4 class="lx-h">Open</h4><ol class="lx-poss">${open.map(pos).join('')}</ol>` : '<p class="dim lx-none">Nothing open right now.</p>'}
      ${closed.length ? `<h4 class="lx-h">Closed</h4><ol class="lx-poss">${closed.slice(0, 8).map(pos).join('')}</ol>${closed.length > 8 ? `<p class="dim lx-none">and ${closed.length - 8} earlier</p>` : ''}` : ''}`;
  }

  function line(ev) {
    const sym = (x) => `$${esc(x || '?')}`;
    switch (ev.type) {
      case 'card':
        return ev.backlog ? null : ['read', 'mute', `${sym(ev.card.symbol)} scored ${ev.card.score ? ev.card.score.total : '—'}${ev.card.score ? ` · ${ev.card.score.verdict.toLowerCase()}` : ''}`];
      case 'pass':
        return ['pass', 'mute', `${sym(ev.symbol)} ${esc(ev.rule || ev.text)}${ev.more ? ` (+${ev.more})` : ''}`];
      case 'draw':
        return ['draw', 'warn', `${sym(ev.symbol)} opening tax ${esc(ev.openingTax)}, waiting for ≤ ${esc(ev.ceiling)}`];
      case 'fire':
        return ['fire', 'up', `${sym(ev.position.symbol)} ${esc(eth(ev.position.eth))} at ${esc(pct((ev.position.openingTaxBps || 0) / 100))} tax${ev.position.drawMs != null ? `, drawn in ${esc(span(ev.position.drawMs))}` : ''}${ev.position.entryWhy ? ` · ${esc(ev.position.entryWhy)}` : ''}`];
      case 'close':
        return ['close', ev.position.exit && ev.position.exit.pnlPct > 0 ? 'up' : 'down', `${sym(ev.position.symbol)} ${esc(pct(ev.position.exit ? ev.position.exit.pnlPct : null, true))} · ${esc(ev.position.exit ? ev.position.exit.why : '')}`];
      case 'siren':
        return ['siren', 'down', `${sym(ev.symbol)} ${esc(ev.code)}: ${esc(ev.msg)}`];
      case 'moved':
        return ['dev', 'down', `${sym(ev.symbol)} deployer moved ${esc(pct(ev.devMoves && ev.devMoves.pct))} of supply`];
      case 'grad':
        return ['grad', 'acc', `${sym(ev.symbol)} graduated to the v4 pool`];
      case 'swept':
        return null;
      case 'copy':
        return ['copy', 'acc', `${esc(short(ev.wallet))} bought ${esc(eth(ev.eth))}${ev.token ? '' : ' of an unknown launch'}`];
      case 'note':
        return ['note', 'mute', esc(ev.text || '')];
      default:
        return null;
    }
  }
  function renderTape() {
    const now = Date.now();
    const rows = [];
    for (const ev of ui.store.state.log) {
      const l = line(ev);
      if (l) rows.push(`<li><span class="pill ${l[1]}">${l[0]}</span><p>${l[2]}</p><time>${esc(span(now - (ev.at || now)))}</time></li>`);
      if (rows.length >= 30) break;
    }
    els.tape.innerHTML = rows.join('') || '<li class="tk-empty">Quiet so far.</li>';
  }

  function renderRules() {
    const s = ui.store.state;
    if (!s.rulesText) return;
    const r = s.rules || {};
    els.rules.innerHTML = `
      <h4 class="lx-h">Refuses</h4><p class="lx-rule">${esc(s.rulesText.refuses)}</p>
      <h4 class="lx-h">Fires</h4><p class="lx-rule">${esc(r.eth != null ? `${r.eth} ETH when the opening tax is under ${pct((r.taxCeiling || 0) / 100)}, waiting up to ${Math.round((r.drawMax || 0) / 1000)} s` : '')}</p>
      <h4 class="lx-h">Leaves</h4><p class="lx-rule">${esc(s.rulesText.exits)}</p>`;
  }

  function render() {
    ui.raf = 0;
    if (!ui.store || !ui.active) {
      ui.dirty = true;
      return;
    }
    ui.dirty = false;
    renderBand();
    renderCards();
    renderBook();
    renderTape();
    renderRules();
    renderTry();
  }
  const soon = () => {
    if (!ui.raf) ui.raf = requestAnimationFrame(render);
  };

  // ---------------------------------------------------------------- reads: scan and market

  function renderTry() {
    let toks = [];
    if (!serverOn) toks = Object.keys(ui.sample ? ui.sample.reads : {}).filter((k) => k.startsWith('scan:')).map((k) => k.slice(5));
    else toks = ui.store.state.cards.slice(0, 5).map((c) => c.token);
    const name = (t) => {
      const c = ui.store.state.cards.find((x) => x.token.toLowerCase() === t.toLowerCase());
      const r = ui.sample && ui.sample.reads[`scan:${t.toLowerCase()}`];
      return c && c.symbol ? `$${c.symbol}` : r && r.symbol ? `$${r.symbol}` : short(t);
    };
    const html = toks.length ? `<span class="cy-try-label">${serverOn ? 'Newest launches' : 'Recorded scans'}</span>${toks.map((t) => `<button type="button" class="cy-chip" data-scan="${esc(t)}">${esc(name(t))}</button>`).join('')}` : '';
    if (els.tryBox.dataset.html !== html) {
      els.tryBox.innerHTML = html;
      els.tryBox.dataset.html = html;
    }
  }

  function scanHtml(r) {
    const head = `<header class="cy-res-head"><div><h3>$${esc(r.symbol || short(r.token))}</h3><p><span class="pill mute">${esc(r.phase || '')}</span> <code>${esc(short(r.token))}</code> <button type="button" class="icon-btn cy-copy" data-copy="${esc(r.token)}" aria-label="Copy the address"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></p></div><small>${esc(r.sample ? 'recorded on the mock chain' : 'read just now')}</small></header>`;
    const blocks = [];
    const c = r.curve;
    if (c) {
      const door = (c.door || []).find((d) => d.eth === 0.05) || (c.door || [])[0];
      blocks.push(`<h4 class="lx-h">The curve</h4><div class="tk-band cy-facts">
        <div class="tk-stat"><b>${esc(pct((c.fill || 0) * 100))}</b><span>to graduation · ${esc(eth(c.realEth))} of ${esc(eth(c.thresholdEth))}</span></div>
        <div class="tk-stat"><b>${esc(c.fdvEth != null ? eth(c.fdvEth) : '—')}</b><span>valued at · price ${esc(c.priceEth != null ? c.priceEth.toExponential(2) : '—')} ETH</span></div>
        <div class="tk-stat"><b>${esc(door ? pct(door.impact) : '—')}</b><span>impact of 0.05 ETH in</span></div>
        <div class="tk-stat"><b>${esc(c.safeEth != null ? eth(c.safeEth) : '—')}</b><span>the most that leaves under 5% impact</span></div>
      </div>`);
    }
    const l = r.launch;
    if (l) {
      const parts = [...((l.score && l.score.parts) || [])].filter((p) => p.v !== 0);
      const t = l.trades;
      blocks.push(`<h4 class="lx-h">The launch <span class="lx-sc">${l.score ? `${l.score.total} ${verdictPill(l.score.verdict)}` : ''}</span></h4>
        ${parts.length ? `<ul class="lx-parts">${parts.map(part).join('')}</ul>` : ''}
        ${t ? `<p class="lx-flow"><b>trades</b> ${t.buyers} buyers · ${t.sells} sells · block-0 bundle ${esc(pct(t.bundlePct))} · top 5 hold ${esc(pct(t.top5Pct))} · dev sold ${esc(pct(t.devSoldPct))}</p>` : ''}
        <p class="lx-flow"><b>fees</b> ${esc(l.feeThird ? 'paid to a third party, not the deployer' : 'paid to the deployer')} · creator tax ${esc(l.creatorTaxBps != null ? pct(l.creatorTaxBps / 100) : '—')}${l.exempt && l.exempt.length ? ` · <span class="x-down">${l.exempt.length} wallets exempt from the opening tax</span>` : ''}</p>`);
    }
    const co = r.council;
    if (co) {
      blocks.push(`<h4 class="lx-h">The council <span class="lx-sc">${co.survival} / 85 ${stampPill(co.stamp)}</span></h4>
        <ul class="lx-votes">${co.votes.map((v) => `<li><span class="pill ${VOTE[v.state] || 'mute'}">${esc(v.agent)}</span><span>${esc(v.text || '')}</span><small>${esc(v.reads || '')}</small></li>`).join('')}</ul>
        ${co.hard && co.hard.length ? `<p class="lx-flow x-down"><b>hard flags</b> ${esc(co.hard.join(' · '))}</p>` : ''}`);
    }
    const ex = r.exit;
    if (ex && ex.rows && ex.rows.length) {
      blocks.push(`<h4 class="lx-h">Leaving now</h4><div class="tk-table-wrap"><table class="tk-table"><thead><tr><th>Sell</th><th>Impact</th><th>Comes back</th></tr></thead><tbody>${ex.rows.map((x) => `<tr><td>${esc(eth(x.eth))}</td><td>${esc(pct(x.impact))}</td><td>${esc(eth(x.out))}</td></tr>`).join('')}</tbody></table></div>`);
    }
    const x = r.xray;
    if (x) blocks.push(`<h4 class="lx-h">The wallet behind it</h4><p class="lx-flow"><span class="pill ${x.tag && x.tag.s === 'ok' ? 'up' : x.tag && x.tag.s === 'bad' ? 'down' : 'warn'}">${esc(x.tag ? x.tag.t : '—')}</span> <code>${esc(short(x.dep))}</code> · ${x.balance != null ? `${esc(eth(x.balance))} · ` : ''}${x.ntx != null ? `${x.ntx} transactions · ` : ''}${x.launches != null ? `${x.launches} launch${x.launches === 1 ? '' : 'es'}` : ''}</p>`);
    if (!blocks.length) blocks.push('<p class="tk-empty">No curve and no pool found for this address.</p>');
    return `<article class="tk-card cy-result lx-scan">${head}${blocks.join('')}${live ? `<div class="cy-actions"><span class="cy-links">${linksFor(r.token, c && c.address)}</span></div>` : ''}</article>`;
  }

  async function scan(raw) {
    const token = String(raw || '').trim();
    if (!isAddr(token)) {
      els.scan.innerHTML = '<p class="tk-note warn"><b>That is not a token address.</b> Paste a 0x address: 0x and 40 letters and digits.</p>';
      return;
    }
    els.scan.innerHTML = '<p class="tk-empty">Reading the chain…</p>';
    try {
      const r = await loxleyRead(serverOn ? { mode: 'server' } : { mode: 'static' }, 'scan', { token });
      els.scan.innerHTML = scanHtml(r);
    } catch (err) {
      els.scan.innerHTML = `<p class="tk-note${err.status === 501 ? '' : ' warn'}"><b>${esc(err.status === 501 ? 'Scanning needs the site\'s server.' : err.status === 429 ? 'Too many reads.' : 'The read failed.')}</b> ${esc(err.status === 501 ? 'This copy of the page has none: it can open only the recorded scans above. Run the site (npm start) to scan any token.' : err.message)}</p>`;
    }
  }

  async function loadMarket() {
    els.market.innerHTML = '<p class="tk-empty">Reading DexScreener…</p>';
    try {
      const m = await loxleyRead(serverOn ? { mode: 'server' } : { mode: 'static' }, 'market');
      const rows = m.rows || [];
      els.market.innerHTML = rows.length
        ? `${!live ? '<p class="tk-note">A recorded list: the fixture loxley\'s mock chain serves, not today\'s market.</p>' : ''}<div class="tk-table-wrap"><table class="tk-table lx-market"><thead><tr><th>Token</th><th>Price</th><th>1 h</th><th>24 h</th><th>Liquidity</th><th>Volume 24 h</th><th>Age</th><th>Sell 1 ETH</th><th>Score</th><th class="l">Stamp</th></tr></thead><tbody>${rows
            .map((r) => `<tr><td>${live && isAddr(r.token) ? `<a class="sym" href="${esc(DEXSCREENER + r.token.toLowerCase())}" target="_blank" rel="noopener noreferrer">$${esc(r.symbol)}</a>` : `<b class="sym">$${esc(r.symbol)}</b>`}</td><td>${esc(usd(r.price))}</td><td class="${tone(r.chg1)}">${esc(pct(r.chg1, true))}</td><td class="${tone(r.chg24)}">${esc(pct(r.chg24, true))}</td><td>${esc(usd(r.liq))}</td><td>${esc(usd(r.vol24))}</td><td>${esc(r.ageMs != null ? span(r.ageMs) : '—')}</td><td>${esc(pct(r.exitPct))}</td><td>${r.score}</td><td class="l">${stampPill(r.stamp)}</td></tr>`)
            .join('')}</tbody></table></div><p class="dim lx-none">${m.listed} listed${m.ethUsd ? ` · ETH at ${esc(usd(m.ethUsd))}` : ''}</p>`
        : `<p class="tk-empty">DexScreener lists nothing on this chain right now.</p>`;
      els.marketBtn.textContent = 'Read again';
    } catch (err) {
      els.market.innerHTML = `<p class="tk-note warn"><b>The market did not load.</b> ${esc(err.message)}</p>`;
    }
  }

  // ---------------------------------------------------------------- events

  els.verdicts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    ui.verdict = b.dataset.v;
    for (const x of els.verdicts.querySelectorAll('[data-v]')) x.setAttribute('aria-selected', String(x === b));
    renderCards();
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    scan(els.q.value);
  });
  els.marketBtn.addEventListener('click', loadMarket);
  els.more.addEventListener('click', () => {
    ui.more = !ui.more;
    renderCards();
  });
  root.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-scan]');
    if (s) {
      els.q.value = s.dataset.scan;
      scan(s.dataset.scan);
      return;
    }
    const c = e.target.closest('[data-copy]');
    if (c) toast((await copyText(c.dataset.copy)) ? 'Address copied' : 'Could not copy');
  });

  // ---------------------------------------------------------------- the connection

  async function connect() {
    if (ui.conn) return;
    if (!serverOn) ui.sample = (await import('./sample-data.js')).default;
    ui.conn = await connectLoxley(serverOn ? { mode: 'server' } : { mode: 'static' }, {
      onHello: (store) => {
        ui.store = store;
        soon();
      },
      onEvent: () => soon(),
      onStatus: (s) => {
        status = s;
        soon();
      },
    });
    ui.store = ui.conn.store;
    soon();
  }
  // ages on the cards and the book move even when no event comes
  ui.clock = setInterval(() => {
    if (ui.active && ui.store) soon();
  }, 5000);

  return {
    setActive(on) {
      ui.active = on;
      if (on) {
        connect().catch((err) => {
          els.cards.innerHTML = `<li class="tk-empty">The desk did not open: ${esc(err.message)}</li>`;
        });
        if (ui.dirty || ui.store) soon();
      }
    },
  };
}
