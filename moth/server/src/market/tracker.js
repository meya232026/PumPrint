// Follows the bonding curve of every recent launch so the panel can tell which
// tokens are actually being traded, which went quiet and which were dumped.
//
// Polling is tiered to stay gentle on the RPC: tokens that traded in the last
// five minutes are read every pollMs, tokens idle up to 15 minutes every 4×,
// the rest every 12×, and graduated tokens not at all.

import { curveProgress, marketCapSol } from './curve.js';
import { bondingCurveAddress } from './pda.js';

const MIN = 60_000;
const SAMPLE_KEEP_MS = 12 * MIN;
const ACTIVE_MS = 90_000;
// Below these market caps (SOL) a token is still at its launch price: a trading
// one has only seen sniper bots, a quiet one is a launch nobody bought into.
const ACTIVE_MIN_MC = 31;
const TRACTION_MC = 40;
const STATUS_RANK = { active: 0, graduated: 1, quiet: 2, dumped: 3 };

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

export class MarketTracker {
  constructor({ fetchCurves, now = () => Date.now(), log, pollMs = 15_000, maxAgeMs = 65 * MIN, maxPerPass = 1500 }) {
    this.fetchCurves = fetchCurves;
    this.now = now;
    this.log = log;
    this.pollMs = pollMs;
    this.maxAgeMs = maxAgeMs;
    this.maxPerPass = maxPerPass;
    this.tokens = new Map();
    this.busy = false;
    this.failures = 0;
    this.backoffUntil = 0;
    this.stats = { polls: 0, accounts: 0, errors: 0, lastError: '', lastPollAt: 0 };
  }

  track(launch) {
    if (!launch?.mint || this.tokens.has(launch.mint)) return;
    if (this.now() - launch.t > this.maxAgeMs) return;
    // pump.fun launches without a curve address (older saved history) get it derived from the mint.
    let curve = launch.curve;
    if (!curve && (!launch.pool || launch.pool === 'pump')) {
      try {
        curve = bondingCurveAddress(launch.mint);
      } catch {
        curve = '';
      }
    }
    if (!curve) return;
    const mc0 = Number(launch.mc0) || 0;
    this.tokens.set(launch.mint, {
      mint: launch.mint,
      curve,
      t: launch.t,
      name: launch.name,
      symbol: launch.symbol,
      pool: launch.pool,
      mc0,
      mc: null,
      realSol: 0,
      progress: 0,
      complete: false,
      peakMc: mc0,
      peakReal: 0,
      lastChangeAt: 0,
      nextPollAt: 0,
      misses: 0,
      samples: [],
    });
  }

  get size() {
    return this.tokens.size;
  }

  async poll() {
    const now = this.now();
    if (this.busy || now < this.backoffUntil) return;
    for (const [mint, e] of this.tokens) if (now - e.t > this.maxAgeMs) this.tokens.delete(mint);
    const batch = [];
    for (const e of this.tokens.values()) if (e.nextPollAt <= now) batch.push(e);
    if (!batch.length) return;
    batch.sort((a, b) => a.nextPollAt - b.nextPollAt);
    batch.length = Math.min(batch.length, this.maxPerPass);

    this.busy = true;
    try {
      const states = await this.fetchCurves(batch);
      const at = this.now();
      for (const e of batch) this.update(e, states.has(e.curve) ? states.get(e.curve) : undefined, at);
      this.failures = 0;
      this.stats.polls++;
      this.stats.accounts += batch.length;
      this.stats.lastPollAt = at;
    } catch (err) {
      this.failures++;
      this.stats.errors++;
      this.stats.lastError = err.message;
      const wait = Math.min(5 * MIN, this.pollMs * 2 ** this.failures);
      this.backoffUntil = now + wait;
      if (this.failures === 1 || this.failures % 10 === 0) {
        this.log?.warn('market: could not read token curves from Solana', { error: err.message, retryIn: `${Math.round(wait / 1000)}s` });
      }
    } finally {
      this.busy = false;
    }
  }

  update(e, state, now) {
    if (state === undefined) {
      e.nextPollAt = now + this.pollMs;
      return;
    }
    if (state === null) {
      e.misses++;
      e.nextPollAt = e.misses >= 3 ? Infinity : now + 2 * this.pollMs;
      return;
    }
    e.misses = 0;
    const mc = marketCapSol(state);
    const first = e.mc === null;
    const ref = first ? e.mc0 : e.mc;
    // A moving price means trades. On the very first reading we only trust that
    // for brand-new tokens; an old token's drift since launch says nothing about now.
    if (ref && Math.abs(mc - ref) / ref > 0.0005 && (!first || now - e.t <= 2 * this.pollMs)) e.lastChangeAt = now;
    // Simulated markets (demo) can say when the last trade happened and what the price was 5 minutes ago.
    if (Number.isFinite(state.lastTradeAt)) e.lastChangeAt = Math.max(e.lastChangeAt, state.lastTradeAt);
    if (first && Number.isFinite(state.mc5mAgo)) e.samples.push({ t: now - 5 * MIN, mc: state.mc5mAgo });
    if (Number.isFinite(state.peakMc)) e.peakMc = Math.max(e.peakMc, state.peakMc);
    if (Number.isFinite(state.peakRealSol)) e.peakReal = Math.max(e.peakReal, state.peakRealSol);

    e.mc = mc;
    e.realSol = state.realSol;
    e.progress = curveProgress(state);
    e.complete = Boolean(state.complete);
    e.peakMc = Math.max(e.peakMc, mc);
    e.peakReal = Math.max(e.peakReal, state.realSol);
    e.samples.push({ t: now, mc });
    while (e.samples.length > 2 && e.samples[0].t < now - SAMPLE_KEEP_MS) e.samples.shift();

    const idle = now - (e.lastChangeAt || e.t);
    const tier = idle < 5 * MIN ? 1 : idle < 15 * MIN ? 4 : 12;
    e.nextPollAt = e.complete ? Infinity : now + tier * this.pollMs;
  }

  statusOf(e, now) {
    if (e.complete) return 'graduated';
    const drained = e.peakReal >= 1.5 && e.realSol <= e.peakReal * 0.3;
    const crashed = e.peakMc >= 60 && e.mc <= e.peakMc * 0.5;
    if (drained || crashed) return 'dumped';
    if (e.lastChangeAt && now - e.lastChangeAt <= ACTIVE_MS) return 'active';
    return 'quiet';
  }

  worthShowing(e, st) {
    if (st === 'dumped') return false;
    if (st === 'quiet') return e.mc >= TRACTION_MC;
    if (st === 'active') return e.mc >= ACTIVE_MIN_MC;
    return true;
  }

  // Market cap now versus about five minutes ago (or since launch for younger tokens).
  changeOf(e, now) {
    // A graduated token trades on PumpSwap now; its curve price is frozen and says nothing.
    if (e.complete) return null;
    const target = now - 5 * MIN;
    let ref = null;
    for (const s of e.samples) {
      if (s.t <= target) ref = s;
      else break;
    }
    const base = ref?.mc ?? (now - e.t <= 5 * MIN && e.mc0 ? e.mc0 : e.samples[0]?.mc);
    return base ? round2(e.mc / base - 1) : null;
  }

  view(mint) {
    const e = this.tokens.get(mint);
    if (!e || e.mc === null) return null;
    const now = this.now();
    return { mc: round1(e.mc), ch: this.changeOf(e, now), st: this.statusOf(e, now), pg: Math.round(e.progress * 100) };
  }

  // The token carrying a word right now: the top of ranked(), so the line under a
  // word and the first row of "Trading now" always agree.
  leader(launches) {
    const top = this.ranked(launches, 1)[0];
    return top ? { m: top.mint, n: top.name, s: top.symbol, p: top.pool, mc: top.mc, ch: top.ch, st: top.st } : null;
  }

  // Tokens worth a look for a word, best first. Dumped ones and launches nobody bought are left out.
  ranked(launches, limit = 5) {
    const now = this.now();
    const out = [];
    for (const l of launches) {
      const e = this.tokens.get(l.mint);
      if (!e || e.mc === null) continue;
      const st = this.statusOf(e, now);
      if (!this.worthShowing(e, st)) continue;
      out.push({ mint: e.mint, name: e.name, symbol: e.symbol, pool: e.pool, t: e.t, mc: round1(e.mc), ch: this.changeOf(e, now), st, pg: Math.round(e.progress * 100) });
    }
    out.sort((a, b) => STATUS_RANK[a.st] - STATUS_RANK[b.st] || b.mc - a.mc);
    return out.slice(0, limit);
  }

  summary() {
    let active = 0;
    let dumped = 0;
    let graduated = 0;
    const now = this.now();
    for (const e of this.tokens.values()) {
      if (e.mc === null) continue;
      const st = this.statusOf(e, now);
      if (st === 'active') active++;
      else if (st === 'dumped') dumped++;
      else if (st === 'graduated') graduated++;
    }
    return { tracked: this.tokens.size, active, dumped, graduated, ...this.stats, backoff: Math.max(0, this.backoffUntil - now) };
  }
}
