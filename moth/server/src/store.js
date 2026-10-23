import { tokenize, makeStopwords } from './tokenize.js';

const MINUTE = 60_000;
const SPAM_WINDOW_MS = 10 * MINUTE;

const round2 = (n) => Math.round(n * 100) / 100;

// Keeps every launch from the last couple of hours in arrival order and answers
// "which words are hot in the last N minutes" by scanning that list. Even at
// launchpad peak (a few thousand launches an hour) a scan is a few ms.
export class LaunchStore {
  constructor({ maxWindowMin = 60, now = () => Date.now(), stopwords = [], coverageStart } = {}) {
    this.now = now;
    this.retentionMs = 2 * maxWindowMin * MINUTE + 5 * MINUTE;
    this.stopwords = makeStopwords(stopwords);
    this.items = [];
    this.head = 0;
    this.mints = new Set();
    this.recentByCreator = new Map();
    this.coverageStart = coverageStart ?? now();
    this.ingested = 0;
    this.skipped = 0;
  }

  get size() {
    return this.items.length - this.head;
  }

  // raw: { mint, name, symbol, pool, creator, t? } — returns the stored launch or null.
  add(raw) {
    const t = Number.isFinite(raw.t) ? raw.t : this.now();
    const name = String(raw.name ?? '').trim().slice(0, 64);
    const mint = String(raw.mint ?? '');
    if (!name || !mint || this.mints.has(mint)) {
      this.skipped++;
      return null;
    }
    // One wallet launching the same name over and over is spam, not a narrative.
    const creator = String(raw.creator ?? '');
    if (creator) {
      const key = `${creator}|${name.toLowerCase()}`;
      const last = this.recentByCreator.get(key);
      if (last !== undefined && Math.abs(t - last) < SPAM_WINDOW_MS) {
        this.skipped++;
        return null;
      }
      this.recentByCreator.set(key, t);
    }
    const launch = {
      t,
      name,
      symbol: String(raw.symbol ?? '').trim().slice(0, 16),
      mint,
      pool: String(raw.pool || 'pump'),
      creator,
      curve: typeof raw.curve === 'string' ? raw.curve : '',
      mc0: Number(raw.mc0) || 0,
      words: tokenize(name, { stopwords: this.stopwords }),
    };
    // Launches arrive in order; backfilled or late ones are inserted in place.
    const last = this.items[this.items.length - 1];
    if (!last || last.t <= t) this.items.push(launch);
    else this.items.splice(this.indexAtOrAfter(t), 0, launch);
    this.mints.add(mint);
    this.ingested++;
    if ((this.ingested & 255) === 0) this.prune();
    return launch;
  }

  prune() {
    const cutoff = this.now() - this.retentionMs;
    while (this.head < this.items.length && this.items[this.head].t < cutoff) {
      this.mints.delete(this.items[this.head].mint);
      this.head++;
    }
    if (this.head > 1024 && this.head > this.items.length / 2) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    for (const [key, t] of this.recentByCreator) {
      if (t < this.now() - SPAM_WINDOW_MS) this.recentByCreator.delete(key);
    }
  }

  indexAtOrAfter(t) {
    let lo = this.head;
    let hi = this.items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.items[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Launches per minute over the last few minutes, for the "x a minute" readout.
  rate(minutes = 5) {
    const t = this.now();
    return round2((this.items.length - this.indexAtOrAfter(t - minutes * MINUTE)) / minutes);
  }

  // Previous window fully observed? If not, growth vs the previous window is meaningless.
  isWarm(windowMin, t = this.now()) {
    return this.coverageStart <= t - 2 * windowMin * MINUTE + 5_000;
  }

  // Top words for a window. For each word:
  //   c  launches in the current window          p  launches in the window before
  //   z  how unusual c is versus what p predicts (Poisson-style score, adjusted for
  //      overall launch volume); high z = rising fast
  //   s  launches per bin across the current window (sparkline)
  snapshot(windowMin, { top = 60, bins = 12, minCount = 2, market = null } = {}) {
    const t = this.now();
    const W = windowMin * MINUTE;
    const curStart = t - W;
    const prevStart = t - 2 * W;
    const binMs = W / bins;
    const warm = this.isWarm(windowMin, t);
    // While warming up, momentum compares the two halves of the observed part of the window.
    const covStart = Math.max(curStart, this.coverageStart);
    const mid = (covStart + t) / 2;
    const halvesUsable = t - covStart >= 2 * MINUTE;

    const stats = new Map();
    let total = 0;
    let prevTotal = 0;
    let firstHalf = 0;
    let secondHalf = 0;
    for (let i = this.indexAtOrAfter(prevStart); i < this.items.length; i++) {
      const it = this.items[i];
      if (it.t > t) break;
      const cur = it.t >= curStart;
      const late = it.t >= mid;
      if (cur) {
        total++;
        if (late) secondHalf++;
        else if (it.t >= covStart) firstHalf++;
      } else {
        prevTotal++;
      }
      const bin = cur ? Math.min(bins - 1, Math.floor((it.t - curStart) / binMs)) : -1;
      for (const w of it.words) {
        let st = stats.get(w);
        if (!st) {
          st = { c: 0, p: 0, a: 0, b: 0, s: null };
          stats.set(w, st);
        }
        if (cur) {
          st.c++;
          if (!st.s) st.s = new Array(bins).fill(0);
          st.s[bin]++;
          if (market) (st.l ||= []).push(it);
          if (late) st.b++;
          else if (it.t >= covStart) st.a++;
        } else {
          st.p++;
        }
      }
    }

    const scale = prevTotal > 0 ? total / prevTotal : 1;
    const halfScale = firstHalf > 0 ? secondHalf / firstHalf : 1;
    const rows = [];
    let unique = 0;
    for (const [w, st] of stats) {
      if (st.c > 0) unique++;
      if (st.c < minCount) continue;
      let z = 0;
      if (warm) {
        const expected = st.p * scale;
        z = (st.c - expected) / Math.sqrt(expected + 1);
      } else if (halvesUsable) {
        const expected = st.a * halfScale;
        z = (st.b - expected) / Math.sqrt(expected + 1);
      }
      rows.push({ w, c: st.c, p: st.p, z: round2(z), s: st.s });
    }

    const byCount = [...rows].sort((x, y) => y.c - x.c || y.z - x.z).slice(0, top);
    const byMomentum = [...rows].sort((x, y) => y.z - x.z || y.c - x.c).slice(0, top);
    const merged = new Map();
    for (const r of byCount) merged.set(r.w, r);
    for (const r of byMomentum) merged.set(r.w, r);
    const words = [...merged.values()].sort((x, y) => y.c - x.c || y.z - x.z || (x.w < y.w ? -1 : 1));

    if (market) {
      for (const row of words) {
        const lead = market.lead(stats.get(row.w).l || []);
        if (lead) row.lead = lead;
      }
    }
    const warmAt = this.coverageStart + 2 * W;
    const solUsd = market ? market.solUsd() : null;
    return { window: windowMin, ts: t, total, prevTotal, unique, warm, warmAt, rate: this.rate(5), solUsd, words };
  }

  // Everything about one word: recent launches that used it, what it's paired with, its curve.
  details(word, windowMin, { examples = 12, related = 10, bins = 12, market = null } = {}) {
    const t = this.now();
    const W = windowMin * MINUTE;
    const curStart = t - W;
    const prevStart = t - 2 * W;
    const binMs = W / bins;
    const series = new Array(bins).fill(0);
    const co = new Map();
    const list = [];
    const matching = [];
    let count = 0;
    let prev = 0;
    for (let i = this.items.length - 1; i >= this.head; i--) {
      const it = this.items[i];
      if (it.t < prevStart) break;
      if (it.t > t || !it.words.includes(word)) continue;
      if (it.t < curStart) {
        prev++;
        continue;
      }
      count++;
      series[Math.min(bins - 1, Math.floor((it.t - curStart) / binMs))]++;
      if (market) matching.push(it);
      if (list.length < examples) {
        const ex = publicLaunch(it);
        const v = market?.view(it.mint);
        if (v) Object.assign(ex, { mc: v.mc, st: v.st });
        list.push(ex);
      }
      for (const w of it.words) if (w !== word) co.set(w, (co.get(w) || 0) + 1);
    }
    const pairs = [...co.entries()]
      .filter(([, n]) => n >= 2 || count < 6)
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      .slice(0, related);
    const out = { word, window: windowMin, ts: t, warm: this.isWarm(windowMin, t), count, prev, series, related: pairs, examples: list };
    if (market) {
      out.trading = market.trading(matching);
      out.solUsd = market.solUsd();
    }
    return out;
  }

  // Counts for a watchlist, used by alerts.
  watch(words, windowMin) {
    const t = this.now();
    const W = windowMin * MINUTE;
    const curStart = t - W;
    const prevStart = t - 2 * W;
    const want = new Map(words.map((w) => [w, { word: w, count: 0, prev: 0, latest: null }]));
    for (let i = this.items.length - 1; i >= this.head; i--) {
      const it = this.items[i];
      if (it.t < prevStart) break;
      if (it.t > t) continue;
      for (const w of it.words) {
        const row = want.get(w);
        if (!row) continue;
        if (it.t >= curStart) {
          row.count++;
          if (!row.latest) row.latest = publicLaunch(it);
        } else {
          row.prev++;
        }
      }
    }
    return { window: windowMin, ts: t, warm: this.isWarm(windowMin, t), words: [...want.values()] };
  }

  *launches() {
    for (let i = this.head; i < this.items.length; i++) yield this.items[i];
  }

  recent(n = 20) {
    const out = [];
    for (let i = this.items.length - 1; i >= this.head && out.length < n; i--) {
      out.push({ ...publicLaunch(this.items[i]), words: this.items[i].words });
    }
    return out;
  }

  serialize() {
    return {
      v: 1,
      savedAt: this.now(),
      coverageStart: this.coverageStart,
      items: this.items.slice(this.head).map(({ t, name, symbol, mint, pool, creator, curve, mc0 }) => ({ t, name, symbol, mint, pool, creator, curve, mc0 })),
    };
  }

  // Restores a saved store. A short restart keeps coverage continuous; after a
  // longer gap the launches still count but growth waits for fresh history.
  restore(data, { maxGapMs = 3 * MINUTE } = {}) {
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return 0;
    const t = this.now();
    const cutoff = t - this.retentionMs;
    let n = 0;
    for (const it of data.items) {
      if (!it || !(it.t >= cutoff) || it.t > t) continue;
      if (this.add(it)) n++;
    }
    if (Number.isFinite(data.savedAt) && t - data.savedAt <= maxGapMs && Number.isFinite(data.coverageStart)) {
      this.coverageStart = Math.min(this.coverageStart, data.coverageStart);
    }
    return n;
  }
}

export function publicLaunch(it) {
  return { t: it.t, name: it.name, symbol: it.symbol, mint: it.mint, pool: it.pool };
}
