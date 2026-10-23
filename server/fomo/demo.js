// A made-up Robinhood Chain for Fomo Radar's demo mode: invented wallets and handles, invented
// tokens, and the situations the radar was built for, played on a timeline. Nothing here is a real
// trader or a real token, and no network is asked.
//
//   burst      7-ish trusted wallets into one token over a quarter of an hour, a market around it
//   thin       the same into a pool that holds a few thousand dollars (the depth gate holds it)
//   crowd      the cohort is a sliver of a busy pool (the cohort-share gate holds it)
//   honeypot   the cohort buys, nobody can sell (the sell check holds it)
//   lonely     a young pool with only the cohort in it (held until somebody else trades)
//   wave       thirteen wallets get $30 each, six seconds apart (seeding: marked, never counted)
//   drift      four wallets drift in over hours (no burst)
//   gift       a swap sent to the router naming trusted wallets (direct: nobody's trade)

import { mulberry32, hashStr } from './util.js';

const SLOT_S = 45 * 60;
const BLOCK_S = 0.1;
const HANDLE_A = ['moss', 'kilo', 'tide', 'pine', 'ember', 'quartz', 'drift', 'lumen', 'cobalt', 'fable', 'harbor', 'jolt', 'nova', 'orbit', 'pixel', 'rune', 'saffron', 'thorn', 'vapor', 'willow', 'zephyr', 'brass', 'cinder', 'dune'];
const HANDLE_B = ['byte', 'fox', 'walker', 'trader', '_eth', 'ape', 'hands', 'labs', 'mint', 'otter', 'ray', 'shark', 'sol', 'wave', 'x', 'zero', '42', 'degen'];
const TOKEN_A = ['OTTER', 'MOON', 'FROG', 'HOOD', 'CRAB', 'NEON', 'GLASS', 'PIXEL', 'TURBO', 'BEAN', 'MAPLE', 'COMET', 'OWL', 'KOI', 'LLAMA', 'SPROUT', 'RIVET', 'ECHO', 'YETI', 'BOLT'];
const TOKEN_B = ['CORE', 'CAT', 'DOG', 'COIN', 'LAND', 'MAX', 'FI', 'ZILLA', 'KING', 'BOY', 'GPT', 'INU', 'PAD', 'WIFI', 'CLUB'];
const SCENARIOS = [
  ['burst', 34],
  ['thin', 8],
  ['crowd', 8],
  ['honeypot', 7],
  ['lonely', 7],
  ['wave', 8],
  ['drift', 14],
  ['gift', 6],
];

const hex = (rnd, n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rnd() * 16).toString(16);
  return s;
};

export function createFomoDemo({ seed = Math.floor(Date.now() / 86_400_000), clock = () => Math.floor(Date.now() / 1000), hoursBack = 30 } = {}) {
  const rnd0 = mulberry32(hashStr(`fomo-demo-${seed}`));
  const T0 = clock() - hoursBack * 3600 - 600;

  // ---------------------------------------------------------------- the roster (invented)
  const roster = [];
  const used = new Set();
  for (let i = 0; i < 72; i++) {
    let handle;
    do handle = HANDLE_A[Math.floor(rnd0() * HANDLE_A.length)] + HANDLE_B[Math.floor(rnd0() * HANDLE_B.length)];
    while (used.has(handle));
    used.add(handle);
    const score = i < 12 ? 80 + Math.floor(rnd0() * 16) : i < 36 ? 60 + Math.floor(rnd0() * 20) : i < 60 ? 40 + Math.floor(rnd0() * 20) : 15 + Math.floor(rnd0() * 24);
    roster.push({ address: `0x${hex(rnd0, 40)}`, handle, score, status: score >= 70 ? 'active' : score >= 40 ? 'watch' : 'dropped' });
  }
  const trusted = roster.filter((r) => r.score >= 60);
  const tracked = roster.filter((r) => r.status !== 'dropped');

  // ---------------------------------------------------------------- tokens and the timeline
  const tokens = new Map(); // mint -> token
  const slots = new Map(); // slot -> { fills }
  const usedSyms = new Set();

  function newToken(rnd, t0, kind) {
    let sym;
    do sym = TOKEN_A[Math.floor(rnd() * TOKEN_A.length)] + TOKEN_B[Math.floor(rnd() * TOKEN_B.length)];
    while (usedSyms.has(sym) && usedSyms.size < 250);
    usedSyms.add(sym);
    const p0 = 10 ** -(3 + rnd() * 2.5); // $0.00001 .. $0.001
    const tok = {
      mint: `0x${hex(rnd, 40)}`,
      pool: `0x${hex(rnd, 64)}`,
      symbol: sym,
      kind,
      createdAt: t0 - Math.floor((kind === 'lonely' ? 3 : 8 + rnd() * 50) * 60),
      p0,
      // price path after the cohort's entry: a peak and where it settles. Two in five fade
      // inside the hour, two in five go somewhere, one in five runs.
      ...(() => {
        const fate = rnd();
        if (kind === 'honeypot') return { peakX: 3 + rnd() * 5, peakAfterS: 600 + rnd() * 1800, settleX: 2 + rnd() * 2, decayS: 7200 };
        if (fate < 0.4) return { peakX: 0.95 + rnd() * 0.3, peakAfterS: 120 + rnd() * 420, settleX: 0.25 + rnd() * 0.5, decayS: 900 + rnd() * 1500 };
        if (fate < 0.8) return { peakX: 1.2 + rnd() * 1.3, peakAfterS: 300 + rnd() * 1800, settleX: 0.5 + rnd() * 1.1, decayS: 3000 + rnd() * 5000 };
        return { peakX: 2.5 + rnd() ** 1.5 * 8, peakAfterS: 600 + rnd() * 2400, settleX: 0.8 + rnd() * 2, decayS: 4000 + rnd() * 6000 };
      })(),
      liq: kind === 'thin' ? 2500 + rnd() * 5000 : 14_000 + rnd() * 90_000,
      crowdUsdPerMin: kind === 'crowd' ? 60_000 + rnd() * 80_000 : kind === 'lonely' ? 0 : 400 + rnd() * 2400,
      honeypot: kind === 'honeypot',
      entryAt: t0,
      entryEnd: t0 + 900,
    };
    tokens.set(tok.mint, tok);
    return tok;
  }

  /** Price at time t, in dollars. Flat before launch noise, rising through the entries, then the path. */
  function priceAt(tok, t) {
    const n = (k) => 1 + 0.035 * Math.sin(t / (37 + k) + tok.p0 * 1e6) + 0.02 * Math.sin(t / (11 + k));
    if (t < tok.entryAt) return tok.p0 * (0.75 + 0.25 * Math.max(0, 1 - (tok.entryAt - t) / 3600)) * n(1);
    const into = t - tok.entryAt;
    const entryLevel = tok.p0 * (1 + Math.min(1, into / Math.max(1, tok.entryEnd - tok.entryAt)) * 0.35);
    if (t <= tok.entryEnd) return entryLevel * n(2);
    const after = t - tok.entryEnd;
    const base = tok.p0 * 1.35;
    if (after <= tok.peakAfterS) return base * (1 + (tok.peakX - 1) * Math.sin((after / tok.peakAfterS) * (Math.PI / 2))) * n(3);
    const decay = Math.exp(-(after - tok.peakAfterS) / tok.decayS);
    return base * (tok.settleX + (tok.peakX - tok.settleX) * decay) * n(4);
  }

  function fill(rnd, slotKey, i, w, tok, side, ts, usd, kind = 'flow') {
    const px = priceAt(tok, ts);
    return {
      sig: `0x${slotKey}${String(i).padStart(4, '0')}:${i}`,
      tx: `0x${hashStr(`${seed}-${slotKey}-${i}`).toString(16).padStart(8, '0')}${hex(rnd, 56)}`,
      address: w.address,
      mint: tok.mint,
      side,
      usd: Math.round(usd * 100) / 100,
      eth: null,
      amount: usd / px,
      ts: Math.round(ts),
      block: Math.round((ts - T0) / BLOCK_S),
      kind,
    };
  }

  const pick = (rnd, list, n) => {
    const pool = [...list];
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  };

  function genSlot(k) {
    if (slots.has(k)) return slots.get(k);
    const rnd = mulberry32(hashStr(`slot-${seed}-${k}`));
    const start = T0 + k * SLOT_S;
    const total = SCENARIOS.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    const kind = SCENARIOS.find(([, w]) => (r -= w) < 0)[0];
    const fills = [];
    let i = 0;
    const t0 = start + 300 + rnd() * (SLOT_S - 1500);
    const tok = newToken(rnd, t0, kind);
    if (['burst', 'thin', 'crowd', 'honeypot', 'lonely'].includes(kind)) {
      // a cohort: the strongest wallets more often, over 6 to 18 minutes
      const n = 6 + Math.floor(rnd() * 4);
      const strong = [...trusted].sort((a, b) => b.score - a.score);
      const who = pick(rnd, strong.slice(0, 20), n);
      const span = 360 + rnd() * 720;
      tok.entryEnd = t0 + span;
      who.forEach((w, j) => {
        const ts = t0 + (span * j) / Math.max(1, n - 1) + rnd() * 25;
        fills.push(fill(rnd, k, i++, w, tok, 'buy', ts, 300 + rnd() ** 2 * 6500));
        if (rnd() < 0.35) fills.push(fill(rnd, k, i++, w, tok, 'buy', ts + 120 + rnd() * 600, 150 + rnd() * 1500));
      });
      // later, some of them leave (the exits feed), unless nobody can
      if (!tok.honeypot) {
        for (const w of who) {
          if (rnd() < 0.45) {
            const ts = tok.entryEnd + tok.peakAfterS * (0.6 + rnd() * 1.6);
            fills.push(fill(rnd, k, i++, w, tok, 'sell', ts, (400 + rnd() * 5000) * (priceAt(tok, ts) / tok.p0) * 0.4));
          }
        }
      }
      // and a couple of watchers that are not trusted
      for (const w of pick(rnd, tracked.filter((x) => x.score < 60), 2)) fills.push(fill(rnd, k, i++, w, tok, 'buy', t0 + rnd() * span, 80 + rnd() * 900));
    } else if (kind === 'wave') {
      const who = pick(rnd, trusted, 13);
      who.forEach((w, j) => fills.push(fill(rnd, k, i++, w, tok, 'buy', t0 + j * 6, 30 + rnd() * 4)));
    } else if (kind === 'drift') {
      const who = pick(rnd, trusted, 4);
      who.forEach((w, j) => fills.push(fill(rnd, k, i++, w, tok, 'buy', t0 + j * (3600 + rnd() * 2400), 400 + rnd() * 2000)));
    } else if (kind === 'gift') {
      const who = pick(rnd, trusted, 6);
      who.forEach((w, j) => fills.push(fill(rnd, k, i++, w, tok, 'buy', t0 + j * 20, 40 + rnd() * 80, 'direct')));
    }
    // background: the roster trading its older names, and a little dust
    const older = [...tokens.values()].filter((t) => t.entryAt < start - 1800 && !t.honeypot);
    for (let b = 0; b < 10 && older.length; b++) {
      const t = older[Math.floor(rnd() * older.length)];
      const w = tracked[Math.floor(rnd() * tracked.length)];
      const ts = start + rnd() * SLOT_S;
      fills.push(fill(rnd, k, i++, w, t, rnd() < 0.55 ? 'sell' : 'buy', ts, 60 + rnd() * 1800));
    }
    if (rnd() < 0.5 && older.length) fills.push(fill(rnd, k, i++, trusted[Math.floor(rnd() * trusted.length)], older[Math.floor(rnd() * older.length)], 'buy', start + rnd() * SLOT_S, 1 + rnd() * 3));
    const slot = { kind, tok, fills };
    slots.set(k, slot);
    return slot;
  }

  /** Every made-up fill with a timestamp in [from, to]. Slots are generated in order. */
  function fillsBetween(from, to) {
    const lastSlot = Math.floor((to - T0) / SLOT_S);
    const firstSlot = Math.max(0, Math.floor((from - T0) / SLOT_S) - 12); // drifts run for hours
    for (let k = 0; k <= lastSlot; k++) genSlot(k);
    const out = [];
    for (let k = firstSlot; k <= lastSlot; k++) for (const f of genSlot(k).fills) if (f.ts >= from && f.ts <= to) out.push(f);
    return out;
  }

  // ---------------------------------------------------------------- what the radar asks

  const blockAt = (ts) => Math.floor((ts - T0) / BLOCK_S);
  const tsOfBlock = (b) => T0 + b * BLOCK_S;

  const chain = {
    async head() {
      const now = clock();
      return { number: blockAt(now), timestamp: now };
    },
    async scan(wallets, first, last, { known = () => false } = {}) {
      const set = new Set(wallets);
      return fillsBetween(tsOfBlock(first), tsOfBlock(last)).filter((f) => set.has(f.address) && !known(f.tx));
    },
    async probeTransfer(mint) {
      const tok = tokens.get(mint);
      if (tok && tok.honeypot) return ['blocked', 'a transfer to the router reverts: execution reverted: TRADING_LOCKED'];
      return ['unknown', 'a transfer to the router goes through'];
    },
    blocksForSeconds: (s) => Math.round(s / BLOCK_S),
  };

  // Pool activity as the screener would count it at time `now`.
  function poolStats(tok, now) {
    const age = now - tok.createdAt;
    const cohortBuys = [...slots.values()].flatMap((s) => s.fills).filter((f) => f.mint === tok.mint && f.ts <= now);
    const lastHour = cohortBuys.filter((f) => f.ts >= now - 3600);
    const crowd = tok.kind === 'lonely' && now - tok.entryAt < 2400 ? 0 : Math.round(Math.min(age, 3600) / 60 * (tok.crowdUsdPerMin / 900));
    const h1Buyers = new Set(lastHour.filter((f) => f.side === 'buy').map((f) => f.address)).size + crowd;
    const sellsH1 = tok.honeypot ? 0 : lastHour.filter((f) => f.side === 'sell').length + Math.round(crowd * 0.6);
    return {
      transactions: {
        h1: { buys: h1Buyers + Math.round(crowd * 0.3), sells: sellsH1, buyers: h1Buyers, sellers: Math.round(sellsH1 * 0.8) },
        h24: { buys: cohortBuys.length + crowd * 3, sells: tok.honeypot ? 0 : sellsH1 * 3 + 1, buyers: h1Buyers * 2, sellers: sellsH1 * 2 },
      },
      createdAt: tok.createdAt,
      reserveUsd: Math.round(tok.liq * Math.min(1.6, Math.max(0.3, priceAt(tok, now) / tok.p0))),
      volH1: Math.round(tok.crowdUsdPerMin * 60 + lastHour.reduce((s, f) => s + f.usd, 0)),
    };
  }

  function candles(tok, now, stepS, limit) {
    const out = [];
    const end = Math.floor(now / stepS) * stepS;
    for (let t = end - (limit - 1) * stepS; t <= end; t += stepS) {
      if (t + stepS < tok.createdAt) continue;
      const samples = [0, 0.25, 0.5, 0.75, 1].map((q) => priceAt(tok, Math.min(now, t + q * stepS)));
      const cohort = [...slots.values()].flatMap((s) => s.fills).filter((f) => f.mint === tok.mint && f.ts >= t && f.ts < t + stepS).reduce((s, f) => s + f.usd, 0);
      out.push([t, samples[0], Math.max(...samples) * 1.01, Math.min(...samples) * 0.99, samples[4], Math.round(cohort + (tok.crowdUsdPerMin * stepS) / 60)]);
    }
    return out;
  }

  const gecko = {
    async tokens(mints) {
      const now = clock();
      return mints
        .map((m) => tokens.get(m))
        .filter(Boolean)
        .map((tok) => {
          const st = poolStats(tok, now);
          return { mint: tok.mint, symbol: tok.symbol, price: priceAt(tok, now), liquidity: st.reserveUsd, mcap: priceAt(tok, now) * 1e9, pool: tok.pool, createdAt: tok.createdAt };
        });
    },
    async pool(id) {
      const tok = [...tokens.values()].find((t) => t.pool === id);
      return tok ? poolStats(tok, clock()) : null;
    },
    async ohlcv(id, timeframe = 'minute', aggregate = 5, limit = 40) {
      const tok = [...tokens.values()].find((t) => t.pool === id);
      if (!tok) return [];
      const step = (timeframe === 'hour' ? 3600 : timeframe === 'day' ? 86400 : 60) * aggregate;
      return candles(tok, clock(), step, limit);
    },
  };

  return { roster, chain, gecko, T0, fillsBetween, tokens, ethPrice: () => 3400 };
}
