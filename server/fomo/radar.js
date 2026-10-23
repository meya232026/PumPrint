// Fomo Radar, live: the trusted fomo.family wallets' fills read off Robinhood Chain every 20
// seconds, and an alert when several of them enter one token within minutes. Port of the live
// path of cvxv666/fomo-robinhood-radar (MIT): pipeline/watch.py, hot.py, provenance.py, noise.py,
// crews.py, safety.py, pushes.py.

import { measure, judge, totals, FOLLOWUP_MIN } from './record.js';
import { WETH } from './scan.js';

export const LISTED_TICKERS = new Set(
  `BTC ETH USDT XRP BNB SOL USDC DOGE TRX ADA HYPE LINK XLM SUI BCH AVAX HBAR LTC SHIB TON LEO DOT
UNI XMR DAI PEPE AAVE CRO NEAR ETC ONDO APT MNT TAO ICP PI POL KAS ALGO ARB VET RENDER FIL ATOM
OKB FET ENA WLD SEI BONK JUP QNT INJ TIA STX IMX GRT OP FLOKI FLR WIF LDO SAND CRV XDC THETA
NEXO GALA PYTH IOTA JASMY RAY BSV KAIA ENS BTT CAKE ZEC XTZ EOS FLOW MANA AXS NEO EGLD CFX AR
DYDX ROSE CHZ RUNE PENDLE MKR SNX COMP APE TRUMP VIRTUAL PENGU SPX FARTCOIN PUMP WBTC WETH
STETH USDG USDE FDUSD TUSD PAXG XAUT PYUSD MATIC LUNA LUNC FTT BRETT MOG TURBO POPCAT MEW`.split(/\s+/),
);

export function fomoConfig(env = {}) {
  const n = (k, d) => (env[k] !== undefined && env[k] !== '' ? Number(env[k]) : d);
  return {
    pollS: n('FOMO_POLL_S', 20),
    startBackBlocks: 600,
    maxRangeBlocks: 6000,
    backfillHours: n('FOMO_BACKFILL_H', 72),
    backfillWindowBlocks: n('FOMO_BACKFILL_WINDOW_BLOCKS', 50_000),
    // provenance
    dustAbsUsd: 5,
    dustRatio: 0.02,
    seedMinWallets: 3,
    seedWindowH: 24,
    seedWaveMinWallets: 5,
    seedWaveMaxGapS: 45,
    seedWaveMaxUsd: 500,
    noiseFillsPerHour: 300,
    // bursts
    hotDelta: n('FOMO_HOT_DELTA', 4.0),
    hotWindowMin: n('FOMO_HOT_WINDOW_MIN', 30),
    hotMinWallets: n('FOMO_HOT_MIN_WALLETS', 3),
    hotMinSpanS: 180,
    hotMinCrews: 2,
    crewDays: 7,
    crewGapS: 90,
    crewMinShared: 4,
    crewMinShare: 0.5,
    hotMaxSellRatio: 0.5,
    hotYoungS: 1800,
    hotMinLiqUsd: n('FOMO_MIN_LIQ_USD', 10_000),
    hotMinCohortShare: 0.03,
    hotMaxCohortShare: 0.9,
    cloneHours: 24,
    namesakeDays: 14,
    namesakeBarMult: 1.5,
    realertHours: 12,
    sellSilenceMinBuys: 8,
    sellSilenceMinAgeS: 1800,
    sellSilenceFloorS: 300,
    followupMin: FOLLOWUP_MIN,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 90) => String(s || '').slice(0, n);

/**
 * chain: { head(), scan(wallets, first, last, {known}), probeTransfer(mint, holder), blocksForSeconds(s) }
 * gecko: { tokens(mints), pool(id), ohlcv(id, tf, agg, limit) }
 */
export function createRadar({ store, chain, gecko, cfg, log, clock = () => Math.floor(Date.now() / 1000), telegram = null, ethPrice = () => null, mode = 'live' }) {
  const state = {
    mode,
    status: 'starting',
    error: null,
    liveSince: null,
    lastBlock: Number(store.getMeta('last_block')) || 0,
    lastTickAt: null,
    head: null,
    backfill: { hours: cfg.backfillHours, done: false, progress: 0 },
    ticks: 0,
    fills: 0,
    alerts: 0,
  };
  let wallets = [];
  let rosterAt = 0;
  const timers = new Map();
  let stopped = false;

  function roster() {
    if (!wallets.length || Date.now() - rosterAt > 600_000) {
      wallets = store.tracked();
      rosterAt = Date.now();
    }
    return wallets;
  }

  // ---------------------------------------------------------------- the tape

  async function scanRange(first, last, now) {
    const fills = await chain.scan(roster(), first, last, { known: (tx) => store.knownTx(tx) });
    const added = store.insertFills(fills, now);
    if (added) {
      store.classify(now - 3600, now);
      const junk = store.sweepNoise(now);
      if (junk.length) {
        wallets = [];
        log.warn(`fomo: quarantined ${junk.length} hyperactive address(es)`);
      }
    }
    return added;
  }

  /** On a fresh start, read back FOMO_BACKFILL_H hours, newest first, before raising alerts. */
  async function backfill() {
    const done = store.getMeta('backfill_done');
    const now = clock();
    if (done && now - Number(done) < 6 * 3600 && state.lastBlock) {
      state.backfill = { ...state.backfill, done: true, progress: 1 };
      return;
    }
    state.status = 'backfilling';
    const head = await chain.head();
    const span = chain.blocksForSeconds(cfg.backfillHours * 3600);
    const oldest = Math.max(head.number - span, 1);
    let last = head.number;
    const total = head.number - oldest;
    while (last > oldest && !stopped) {
      const first = Math.max(last - cfg.backfillWindowBlocks + 1, oldest);
      try {
        await scanRange(first, last, clock());
      } catch (err) {
        log.warn(`fomo backfill ${first}..${last}: ${short(err.message)}`);
        await sleep(5000);
        continue;
      }
      state.backfill.progress = Math.min(1, (head.number - first) / Math.max(1, total));
      last = first - 1;
    }
    const t = clock();
    store.classify(t - cfg.backfillHours * 3600, t);
    store.refreshMedians(t);
    store.computeCrews(t);
    store.setMeta('crews_at', t);
    if (!state.lastBlock) {
      state.lastBlock = head.number;
      store.setMeta('last_block', head.number);
    }
    store.setMeta('backfill_done', t);
    state.backfill = { ...state.backfill, done: true, progress: 1 };
  }

  async function tick() {
    const now = clock();
    const head = await chain.head();
    state.head = head.number;
    let first = state.lastBlock ? state.lastBlock + 1 : head.number - cfg.startBackBlocks;
    first = Math.max(first, head.number - cfg.maxRangeBlocks, 0);
    if (head.number >= first) {
      state.fills += await scanRange(first, head.number, now);
      state.lastBlock = head.number;
      store.setMeta('last_block', head.number);
    }
    state.ticks++;
    state.lastTickAt = now;
    await bursts(now);
  }

  // ---------------------------------------------------------------- bursts and their gates

  async function name(mints, now) {
    const want = mints.filter((m) => {
      const t = store.token(m);
      return !t || !t.symbol || !t.checked_at || now - t.checked_at > 900;
    });
    if (!want.length) return;
    try {
      for (const t of await gecko.tokens(want)) store.upsertToken(t, now);
    } catch (err) {
      log.debug(`fomo naming: ${err.message}`);
    }
  }

  async function sellCheck(mint, now) {
    const t = store.token(mint);
    if (!t) return { sellable: null, note: 'unknown token' };
    if (t.sell_checked_at && now - t.sell_checked_at < 600) return { sellable: t.sellable, note: t.sell_note };
    if (t.sellable === 0 && !String(t.sell_note || '').includes('not one sell')) return { sellable: 0, note: t.sell_note };
    if (!t.pool_address && t.liquidity_usd === 0) {
      const note = 'only trap pools (fee over 10%): no market to sell into';
      store.setSellable(mint, 0, note, now);
      return { sellable: 0, note };
    }
    let verdict = null;
    let note = 'nothing to go on yet';
    for (const holder of store.holdersToTry(mint)) {
      try {
        const [st, why] = await chain.probeTransfer(mint, holder);
        note = why;
        if (st === 'blocked') {
          verdict = 0;
          break;
        }
        if (st === 'ok') {
          verdict = 1;
          break;
        }
      } catch (err) {
        note = `transfer probe failed: ${short(err.message, 60)}`;
      }
    }
    if (verdict !== 0 && store.cohortSold(mint)) {
      verdict = 1;
      note = 'a tracked wallet sold it';
    }
    if (verdict !== 0 && t.pool_address) {
      try {
        const p = await gecko.pool(t.pool_address);
        const tx = (p && p.transactions && p.transactions.h24) || {};
        const buys = Number(tx.buys || 0);
        const sells = Number(tx.sells || 0);
        const age = p && p.createdAt ? now - p.createdAt : null;
        const wait = Math.floor(Math.max(cfg.sellSilenceFloorS, Math.min(cfg.sellSilenceMinAgeS, (cfg.sellSilenceMinAgeS * cfg.sellSilenceMinBuys) / Math.max(1, buys))));
        if (sells > 0 && verdict === null) {
          verdict = 1;
          note = `${sells} sells against ${buys} buys in the pool's last day`;
        } else if (sells === 0 && buys >= cfg.sellSilenceMinBuys && age != null && age >= wait && verdict === null) {
          verdict = 0;
          note = `${buys} buys and not one sell in the pool's last day, ${Math.floor(age / 60)} minutes in`;
        }
      } catch {
        /* the screener being busy is not a verdict */
      }
    }
    store.setSellable(mint, verdict, note, now);
    return { sellable: verdict, note };
  }

  /** Why an alert for this burst is held, or null when it goes out. */
  async function gate(h, now) {
    const sell = await sellCheck(h.mint, now);
    if (sell.sellable === 0) return `unsellable: ${sell.note}`;
    const t = store.token(h.mint) || {};
    const pool = t.pool_address ? await gecko.pool(t.pool_address).catch(() => null) : null;
    // a token the cohort found minutes ago needs somebody else in the pool
    const first = store.firstBuy(h.mint);
    if (first != null && now - first < cfg.hotYoungS && pool) {
      const tx = (pool.transactions && pool.transactions.h1) || {};
      if (Number(tx.sells || 0) === 0 && Number(tx.buyers || 0) <= h.wallets) {
        return `${Math.floor((now - first) / 60)} min old and nobody in the pool but the ${Number(tx.buyers || 0)} buyers we counted, no sell yet`;
      }
    }
    // a name pushed today already needs half again the conviction
    const twins = store.namesakes(h.sym, h.mint, now - cfg.cloneHours * 3600);
    if (store.pushedAny(twins, now - cfg.cloneHours * 3600) && h.conviction < cfg.namesakeBarMult * cfg.hotDelta) {
      return `a $${h.sym} was alerted in the last ${cfg.cloneHours}h and conviction ${h.conviction.toFixed(1)} is under ${(cfg.namesakeBarMult * cfg.hotDelta).toFixed(1)}`;
    }
    // depth
    const liq = pool && pool.reserveUsd != null ? pool.reserveUsd : t.liquidity_usd ?? null;
    h.liq = liq;
    if (cfg.hotMinLiqUsd > 0) {
      if (liq == null) return 'no depth on record and the screener cannot say: nobody can see this pool yet';
      if (liq < cfg.hotMinLiqUsd) return `the pool holds $${Math.round(liq).toLocaleString('en-US')}, under $${cfg.hotMinLiqUsd.toLocaleString('en-US')}`;
    }
    // the cohort's share of the pool's last half hour
    if (t.pool_address && h.usd) {
      try {
        const c = await gecko.ohlcv(t.pool_address, 'minute', 1, 35);
        const vol = c.filter((x) => x[0] >= now - 1800 && x[0] <= now).reduce((s, x) => s + (x[5] || 0), 0);
        if (vol > 0) {
          h.cohortShare = Math.round(Math.min(1, h.usd / vol) * 1000) / 1000;
          if (h.cohortShare < cfg.hotMinCohortShare) return `the cohort is ${Math.round(h.cohortShare * 100)}% of the pool's last half hour: following the crowd, not leading it`;
          if (h.cohortShare >= cfg.hotMaxCohortShare) return `the cohort is ${Math.round(h.cohortShare * 100)}% of the pool's last half hour: nobody to sell to`;
        }
      } catch {
        /* unknown share passes */
      }
    }
    // a borrowed name
    const sym = String(h.sym || '').replace(/^\$/, '').toUpperCase();
    const earlier = store.namesakes(h.sym, h.mint, now - cfg.namesakeDays * 86400);
    if ((LISTED_TICKERS.has(sym) || earlier.length) && h.conviction < cfg.namesakeBarMult * cfg.hotDelta) {
      return LISTED_TICKERS.has(sym) ? `$${sym} is a listed ticker's name, and conviction is under ${(cfg.namesakeBarMult * cfg.hotDelta).toFixed(1)}` : `another $${sym} launched here in the last ${cfg.namesakeDays} days, and conviction is under ${(cfg.namesakeBarMult * cfg.hotDelta).toFixed(1)}`;
    }
    return null;
  }

  async function bursts(now, { replay = false } = {}) {
    const found = store.hotNow(now);
    for (const h of found) {
      if (!store.recordBurst(h)) continue;
      await name([h.mint], now);
      const t = store.token(h.mint);
      if (t && t.symbol) h.sym = t.symbol;
      let held = null;
      try {
        held = await gate(h, now);
      } catch (err) {
        held = `could not check: ${short(err.message, 60)}`;
      }
      const id = store.recordPush('burst', h, now, { held });
      if (!id) continue;
      if (held) {
        log.info(`fomo: burst on ${h.sym} held: ${held}`);
        continue;
      }
      state.alerts++;
      log.info(`fomo: BURST ${h.sym} +${h.conviction} from ${h.wallets} wallets`);
      if (telegram && !replay) telegram.burst(h).then((ok) => ok && store.markTold(id)).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- the hour-later read

  async function followups(now, { graceS = 1800 } = {}) {
    for (const p of store.duePushes(now, graceS)) {
      let candles = [];
      if (p.pool) {
        try {
          candles = await gecko.ohlcv(p.pool, 'minute', 5, 40);
        } catch {
          continue; // the screener is busy; next round then
        }
        if (!candles.length) continue;
      }
      const t = store.token(p.mint) || {};
      const m = measure({
        px: p.px,
        ts: p.ts,
        now,
        candles,
        tapePrices: store.fillPrices(p.mint, p.ts, Math.min(now, p.ts + cfg.followupMin * 60)),
        quotePrice: t.price_usd,
        burstUsd: p.usd || 0,
      });
      store.closePush(p.id, m, now);
      if (telegram) telegram.followup(p, m).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- upkeep

  async function upkeep(now) {
    await name(store.tokensToName(now), now);
    store.refreshMedians(now);
    const crewsAt = Number(store.getMeta('crews_at') || 0);
    if (now - crewsAt > 6 * 3600) {
      store.computeCrews(now);
      store.setMeta('crews_at', now);
    }
  }

  // ---------------------------------------------------------------- loops

  function loop(fn, everyMs, label) {
    const run = async () => {
      if (stopped) return;
      const started = Date.now();
      try {
        await fn();
        if (label === 'tick') {
          state.error = null;
          if (state.backfill.done) state.status = 'live';
        }
      } catch (err) {
        if (label === 'tick') {
          state.error = short(err.message, 140);
          state.status = state.backfill.done ? 'retrying' : state.status;
        }
        log.warn(`fomo ${label}: ${short(err.message, 140)}`);
      }
      if (!stopped) timers.set(label, setTimeout(run, Math.max(1000, everyMs - (Date.now() - started))));
    };
    timers.set(label, setTimeout(run, label === 'tick' ? 0 : everyMs));
  }

  async function start() {
    try {
      await backfill();
    } catch (err) {
      state.error = `backfill: ${short(err.message, 120)}`;
      log.warn(`fomo backfill failed: ${err.message}; starting from the head`);
      state.backfill = { ...state.backfill, done: true, progress: 1, skipped: true };
    }
    state.liveSince = state.liveSince || clock();
    if (!store.getMeta('live_since')) store.setMeta('live_since', state.liveSince);
    state.liveSince = Number(store.getMeta('live_since'));
    state.status = 'live';
    try {
      await upkeep(clock());
    } catch (err) {
      log.warn(`fomo upkeep: ${short(err.message, 120)}`);
    }
    loop(tick, cfg.pollS * 1000, 'tick');
    loop(() => followups(clock()), 120_000, 'followups');
    loop(() => upkeep(clock()), 15 * 60_000, 'upkeep');
  }

  function stop() {
    stopped = true;
    for (const t of timers.values()) clearTimeout(t);
  }

  // ---------------------------------------------------------------- what the page reads

  function snapshot() {
    const now = clock();
    const pushes = store.pushes(now, 30).map((p) =>
      judge(
        {
          id: p.id,
          ts: p.ts,
          kind: p.kind,
          mint: p.mint,
          sym: p.sym,
          px: p.px,
          conviction: p.conviction,
          wallets: p.wallets,
          usd: p.usd,
          liq: p.liq,
          share: p.cohort_share,
          held: p.held,
          who: JSON.parse(p.who || '[]'),
          followupAt: p.followup_at,
          best: p.best,
          peakMin: p.peak_min,
          hour: p.now_x,
          trail: p.trail_x,
          vol: p.vol_usd,
          unsellable: p.sellable === 0,
          seeded: store.seededInfo(p.mint, now).seeded,
          nowX: p.price && p.px ? Math.round((p.price / p.px) * 100) / 100 : null,
        },
        now,
      ),
    );
    const alerts = pushes.filter((p) => !p.held);
    const held = pushes.filter((p) => p.held).slice(0, 12);
    const roster = store.rosterCounts();
    return {
      mode: state.mode,
      status: state.status,
      error: state.error,
      now,
      liveSince: state.liveSince,
      head: state.head,
      lastTickAt: state.lastTickAt,
      backfill: state.backfill,
      roster: { tracked: roster.tracked || 0, trusted: roster.trusted || 0 },
      counts: store.counts(now),
      rules: { delta: cfg.hotDelta, windowMin: cfg.hotWindowMin, minWallets: cfg.hotMinWallets, minLiq: cfg.hotMinLiqUsd },
      alerts,
      held,
      record: totals(alerts),
      signals: store.signals(now).slice(0, 15),
      fresh: store.fresh(now).tokens.slice(0, 10),
      exits: store.exits(now).slice(0, 10),
      tape: store.tape(now, 30),
    };
  }

  return { start, stop, tick, bursts, followups, upkeep, backfill, snapshot, state, scanRange };
}

/** Optional Telegram channel for the alerts (FOMO_TELEGRAM_BOT_TOKEN + FOMO_TELEGRAM_CHAT_ID). */
export function createTelegram({ token, chatId, siteUrl = '', fetchImpl = fetch, log }) {
  if (!token || !chatId) return null;
  const money = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`);
  async function send(text) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      return res.ok;
    } catch (err) {
      log.warn(`fomo telegram: ${err.message}`);
      return false;
    }
  }
  return {
    burst: (h) =>
      send(
        [
          `BURST · $${h.sym}`,
          `+${h.conviction.toFixed(1)} conviction from ${h.wallets} trusted wallets in ${Math.max(1, Math.round((h.lastTs - h.firstTs) / 60))} min`,
          `${money(h.usd || 0)} in${h.liq ? ` · pool ${money(h.liq)}` : ''}`,
          h.entries.map((e) => `${e[1]} ${e[2]}`).join(', '),
          `https://robinhoodchain.blockscout.com/token/${h.mint}`,
          siteUrl ? `${siteUrl.replace(/\/$/, '')}/#fomo` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
    followup: (p, m) =>
      send(`$${p.sym} an hour later: ${m.best != null ? `peak ${m.best}x${m.peakMin != null ? ` at ${m.peakMin} min` : ''}` : 'no read'}${m.now != null ? `, now ${m.now}x` : ''}.`),
  };
}

export const ETH_TOKEN = WETH;
