// The paper desk: one feed (cli/feed.js), every launch read once, shown as a hunt card, handed to the paper sniper
// (cli/sniper.js with live:false and trader:null), followed up at +15 s and +60 s. Nothing here can sign: the
// sniper's live paths need a trader with a wallet client, and none exists (cli/trade.js is refused by safe.js).
//
// Events (onEvent): card · follow · grad · swept · pass · draw · fire · mark · close · siren · moved · note
// State (snapshot()): rules, totals (fired, passed, closed, spent, realised p&l, open p&l), positions, recent cards.

import { cardOf } from './card.js';

const STRIP = /^\d\d:\d\d:\d\d\s+/;

export function createPaperDesk({ L, env, log, flags = {}, sim = false, window, onEvent = () => {}, keepCards = 60, keepClosed = 200, followUps = [15000, 60000], markEveryMs = 5000, snipe = true, traderFor = null, backlog = 8 }) {
  const { makeChain } = L.require('cli/chain.js');
  const { makeSources } = L.require('cli/sources.js');
  const { makeFeed } = L.require('cli/feed.js');
  const { makeSniper, rulesFrom, refuseText, exitsText } = L.require('cli/sniper.js');
  const { makeLinks } = L.require('cli/pons.js');
  const E = L.require('cli/engine.js');
  const VERSION = L.require('package.json').version;

  let seq = 0;
  const emit = (type, o) => { const ev = { seq: ++seq, at: Date.now(), type, ...o }; try { onEvent(ev); } catch (e) { log.warn?.('loxley event handler: ' + e.message); } return ev; };

  // the sniper talks in lines (say → log.raw). Colour is off (safe.js), so a line is plain text we can read.
  let lastLine = null, considering = null;
  const onLine = (s) => {
    // a line ui.wrap() folded (only when COLUMNS is set for a non-tty process) is joined back first
    for (const raw of String(s).replace(/\n[ \t]+/g, ' ').split('\n')) {
      const line = raw.replace(STRIP, '').trim();
      if (!line) continue;
      lastLine = line;
      let m;
      if (/^pass\s+\$/.test(line)) {
        // a refusal by the rules is printed synchronously inside S.consider(L), so `considering` is that launch:
        // its symbol is cut off exactly, whatever spaces or emoji it holds
        const L0 = considering, head = L0 ? 'pass  $' + (L0.symbol || '…') : null;
        const own = head && line.startsWith(head), mm = own ? null : line.match(/^pass\s+\$(\S+)\s+(.*)$/);
        const text = own ? line.slice(head.length).trim() : mm ? mm[2] : line, r = text.match(/^score (\d+) · (.+?)(?: \(\+(\d+)\))?$/);
        emit('pass', { symbol: own ? L0.symbol : mm ? mm[1] : null, token: own ? L0.token : null, text, score: r ? Number(r[1]) : null, rule: r ? r[2] : text, more: r && r[3] ? Number(r[3]) : 0 });
      } else if ((m = line.match(/^draw\s+\$(\S+)\s+opening tax now (\S+) · waiting for ≤ (\S+)$/))) emit('draw', { symbol: m[1], openingTax: m[2], ceiling: m[3] });
      else if ((m = line.match(/^miss\s+\$(\S+)\s+(.*)$/))) emit('note', { symbol: m[1], text: 'miss: ' + m[2] });
      else if (/^GRAD\s+\$/.test(line)) emit('note', { text: line });
      // FIRE, mark, CLOSED and SIREN lines are reported from the positions themselves (structured), below
    }
  };
  const quiet = { info() {}, ok() {}, dim() {}, warn: (s) => log.warn?.('loxley: ' + s), error: (s) => log.error?.('loxley: ' + s), raw: onLine };
  const chain = makeChain(env, quiet);
  const sources = makeSources(env);
  const ctx = { env, ui: L.ui, log: quiet, flags, args: { _: [], flags }, VERSION, chain, sources };
  const links = makeLinks(env);
  const feed = makeFeed(ctx, { sim, window });
  const rules = rulesFrom(ctx, false);
  const tally = {};
  const notify = { on: true, where: 'site', stats: { sent: 0, failed: 0 }, send(text) { this.stats.sent++; emit('alert', { text }); return Promise.resolve(); } };
  // trader: null, or a quote-only reader (quotes.js) for pool quotes; never a wallet client
  const trader = traderFor ? traderFor(chain) : null;
  const S = makeSniper(ctx, rules, { live: false, trader, feed, notify, tag: 'snipe' });

  const cards = []; // newest first
  const byToken = new Map();
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };

  const posOf = (p) => ({
    id: p.id, token: p.token, curve: p.curve, deployer: p.deployer, symbol: p.symbol, status: p.status, venue: p.venue,
    openedAt: p.t, eth: p.eth, tokens: p.tokens, entryPriceEth: p.price ?? null, openingTaxBps: p.taxBps ?? null, drawMs: p.waitMs ?? null,
    entryWhy: p.entryWhy || null, graduated: !!p.graduated, marks: p.marks, peakPct: p.peak == null || !Number.isFinite(p.peak) ? null : p.peak,
    mark: p.lastMark ? { valueEth: p.lastMark.val, pnlPct: p.lastMark.pnl, priceEth: p.lastMark.price ?? null, src: p.lastMark.src, alert: p.lastMark.alert || null } : null,
    exit: p.status === 'closed' ? { why: p.why, outEth: p.out, pnlPct: p.pnl, closedAt: p.closedAt, heldMs: p.closedAt - p.t } : null,
    devMoves: p.devMoves ? { tokens: p.devMoves.tokens, pct: p.devMoves.pct ?? null, sells: p.devMoves.sells.length, transfers: p.devMoves.transfers.length } : null,
  });
  let ids = 0;
  const trackFire = (p, why) => { if (!p) return; p.id = 'paper-' + ++ids; p.entryWhy = why || null; emit('fire', { position: posOf(p) }); };

  async function consider(Lr, o = {}) {
    considering = Lr; let pending;
    try { pending = S.consider(Lr, o); } finally { considering = null; }
    const p = await pending;
    trackFire(p, o.why);
    return p;
  }

  async function onFeed(e) {
    if (e.kind === 'grad') { const Lr = byToken.get(e.token); if (Lr) Lr.graduated = true; return emit('grad', { token: e.token, symbol: Lr?.symbol ?? null, bn: e.bn }); }
    if (e.kind === 'swept') return emit('swept', { token: e.token, quoteOut: e.quoteOut ?? null, bn: e.bn });
    if (e.kind !== 'launch') return;
    let Lr;
    try { Lr = await feed.enrich(e); } catch (err) { return emit('note', { text: 'unreadable launch ' + e.token + ': ' + err.message }); }
    byToken.set(Lr.token, Lr);
    const card = cardOf(Lr, links);
    cards.unshift(card); if (cards.length > keepCards) { const old = cards.pop(); if (!S.P.positions.some((p) => p.token === old.token && p.status === 'open')) byToken.delete(old.token); }
    emit('card', { card });
    for (const ms of followUps || []) later(ms, async () => {
      const after = Math.round(ms / 1000);
      try { await feed.followUp(Lr); } catch { return; }
      const c = cardOf(Lr, links); const i = cards.findIndex((x) => x.token === c.token); if (i >= 0) cards[i] = c;
      emit('follow', { after, card: c });
    });
    if (snipe) await consider(Lr);
  }

  // the marks: the sniper's own mark(p) on every open position, every 5 s on paper (snipe.js: startMarks(5000)),
  // with each change reported as a structured event instead of a terminal line
  let marking = false, marker = null;
  async function markAll() {
    if (marking) return; marking = true;
    try {
      for (const p of S.openPositions()) {
        const before = { marks: p.marks, graduated: !!p.graduated, moved: !!p.devMoves };
        try { await S.mark(p); } catch (err) { /* next tick */ }
        if (p.devMoves && !before.moved) emit('moved', { id: p.id, symbol: p.symbol, devMoves: posOf(p).devMoves });
        if (p.graduated && !before.graduated) emit('note', { id: p.id, symbol: p.symbol, text: 'graduated while held: marks move to the pool' });
        if (p.marks > before.marks) emit('mark', { id: p.id, symbol: p.symbol, mark: posOf(p).mark, peakPct: posOf(p).peakPct });
        if (p.status === 'closed') {
          const a = p.lastMark && p.lastMark.alert;
          if (a && a.lvl === 'bad' && String(p.why).startsWith('siren')) emit('siren', { id: p.id, symbol: p.symbol, code: a.code, msg: a.msg });
          emit('close', { position: posOf(p) });
        }
      }
      // a long-lived desk prunes what it no longer shows; the totals in S.P stay
      const closed = S.P.positions.filter((p) => p.status === 'closed');
      if (closed.length > keepClosed) { const drop = new Set(closed.slice(0, closed.length - keepClosed)); S.P.positions = S.P.positions.filter((p) => !drop.has(p)); }
      if (Date.now() - prunedAt > 60000) { prunedAt = Date.now(); pruneIndex(); }
    } finally { marking = false; }
  }
  // the deployer index only ever grows in cli/feed.js (a CLI session is short). On a server that runs for weeks it is
  // cut back to WINDOW_BLOCKS, so `launches`, `grads` and `twins` keep meaning what they mean in a fresh `loxley hunt`.
  let prunedAt = Date.now();
  function pruneIndex() {
    const idx = feed.state.index, head = feed.state.head; if (!idx || !head || sim) return 0;
    const floor = head - (window != null ? window : env.num('WINDOW_BLOCKS')), before = idx.launches.length;
    const keep = idx.launches.filter((e) => e.bn >= floor || S.P.positions.some((p) => p.token === e.token && p.status === 'open'));
    if (keep.length === before) return 0;
    const kept = new Set(keep.map((e) => e.token));
    idx.launches = keep;
    for (const t of Object.keys(idx.byToken)) if (!kept.has(t)) { delete idx.byToken[t]; delete idx.grads[t]; if (idx.swept) delete idx.swept[t]; }
    for (const d of Object.keys(idx.byDeployer)) { idx.byDeployer[d] = idx.byDeployer[d].filter((e) => kept.has(e.token)); if (!idx.byDeployer[d].length) delete idx.byDeployer[d]; }
    idx.from = floor;
    return before - keep.length;
  }

  // follow (cli/commands/follow.js, paper): every CurveBuy by the tracked wallets, any curve, read from one
  // topic-filtered eth_getLogs per poll; the launch behind it goes through the same rules (or none with any:true)
  const following = { wallets: [], any: false, stop: null, mirrored: 0 };
  function follow(wallets, { any = false } = {}) {
    if (following.stop) following.stop();
    const { pad32 } = L.require('cli/chain.js');
    const list = [...new Set(wallets.map((w) => String(w).toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w)))];
    Object.assign(following, { wallets: list, any });
    if (!list.length) return following;
    const byCurve = {}; for (const e of feed.state.index.launches) byCurve[e.curve] = e;
    feed.on((e) => { if (e.kind === 'launch') byCurve[e.curve] = e; });
    const topics = [chain.T.BUY, list.map((w) => '0x' + pad32(w))];
    let last = feed.state.head, stop = false; const seen = new Set();
    following.stop = () => { stop = true; };
    (async () => {
      while (!stop) {
        const t0 = Date.now();
        try {
          const head = await chain.blockNumber();
          if (head > last) {
            const logs = await chain.getLogs(undefined, topics, last + 1, head); last = head;
            for (const lg of logs) {
              const b = chain.parseFactoryLog(lg); if (!b || b.kind !== 'buy') continue;
              const key = lg.transactionHash + ':' + lg.logIndex; if (seen.has(key)) continue; seen.add(key);
              let launch = byCurve[b.curve];
              if (!launch) { const found = await chain.getLogs(chain.factory, [chain.T.LAUNCH, null, '0x' + pad32(b.curve)], Math.max(0, head - 400000), head, { wide: true }).catch(() => []); if (found.length) launch = byCurve[b.curve] = chain.parseFactoryLog(found[0]); }
              emit('copy', { wallet: b.who, curve: b.curve, token: launch ? launch.token : null, eth: b.quote, taxEth: b.tax, bn: b.bn, tx: b.tx });
              if (!launch) continue;
              let Lr; try { Lr = await feed.enrich(launch); } catch { continue; }
              following.mirrored++;
              await consider(Lr, { skipRules: any, why: 'mirror of ' + b.who });
            }
          }
        } catch (err) { emit('note', { text: 'follow: ' + err.message }); await chain.sleep(1500); }
        const wait = env.num('POLL_MS') - (Date.now() - t0); if (wait > 0 && !stop) await chain.sleep(wait);
      }
    })();
    return following;
  }

  let st = null;
  return {
    follow, following, pruneIndex,
    S, feed, chain, sources, links, ctx, rules,
    rulesText: { refuses: refuseText(L.ui, rules, false), exits: exitsText(rules, false) },
    async start() {
      st = await feed.start();
      feed.on((e) => { onFeed(e).catch((err) => log.warn?.('loxley feed handler: ' + err.message)); });
      marker = setInterval(markAll, markEveryMs);
      emit('note', { text: 'feed open: ' + st.index.launches.length + ' launches on record · ' + Object.keys(st.index.byDeployer).length + ' wallets' + (sim ? ' · SIMULATED' : '') });
      // the newest launches on record as cards (hunt.js shows three), so the page is not empty; never sniped
      (async () => { for (const e of st.index.launches.slice(0, backlog).reverse()) { try { const Lr = await feed.enrich(e); byToken.set(Lr.token, Lr); const card = cardOf(Lr, links); cards.unshift(card); emit('card', { card, backlog: true }); } catch { /* unreadable */ } } })();
      return st;
    },
    consider, // follow mode hands mirrored launches here with { why: 'mirror of 0x…' }
    snapshot() {
      const open = S.openPositions();
      const openPnl = open.reduce((s, p) => s + (p.lastMark ? p.lastMark.val - p.eth : 0), 0);
      return {
        source: sim ? 'sim' : 'chain', paper: true, version: VERSION,
        rules: { ...rules, keyword: rules.keyword ? rules.keyword.source : null },
        totals: { fired: S.P.fired, passed: S.P.passed, closed: S.P.closed, open: open.length, spentEth: S.P.spent, realisedEth: S.P.pnl, openEth: openPnl, since: S.P.t0 },
        positions: S.P.positions.map(posOf).reverse(),
        cards,
        feed: st ? { head: feed.state.head, blockTime: feed.state.blockTime, events: feed.state.events, errors: feed.state.errors, lastError: feed.state.lastError || null, onRecord: feed.state.index.launches.length } : null,
        rpc: { calls: chain.rpc.stats.calls, rejected: chain.rpc.stats.rejected, timeouts: chain.rpc.stats.timeouts },
        lastLine,
      };
    },
    async stop({ closeAll = true } = {}) {
      if (following.stop) following.stop();
      feed.stop(); if (marker) clearInterval(marker); for (const t of timers) clearTimeout(t); timers.clear();
      if (closeAll) { const open = S.openPositions(); await S.finish(); for (const p of open) emit('close', { position: posOf(p) }); }
    },
  };
}
