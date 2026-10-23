// What came of an alert, and the record they add up to. Port of pipeline/hot.py (outcome),
// pipeline/pushes.py (measure) and pipeline/record.py from cvxv666/fomo-robinhood-radar (MIT).
// The archive's own numbers are recomputed with the same functions at build time.

export const STAKE = 100;
export const DEAD_USD = 2000; // a pool that traded less than this in the hour had nobody in it
export const TRAIL_DROP = 0.2;
export const FOLLOWUP_MIN = 60;
export const MIN_CANDLE_VOLUME_USD = 200;

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * What the price did after an alert, in the price the cohort paid (`px`).
 * Two witnesses: the tracked fills after it (`tapePrices`, exact but biased low) and the pool's
 * own 5-minute candles [ts, o, h, l, c, v] when they agree with the fill price.
 */
export function outcome({ px, ts, horizonS = FOLLOWUP_MIN * 60, candles = [], tapePrices = [], quotePrice = null, burstUsd = 0 }) {
  if (!px) return { best: null, last: null, now: null, trail: null, fills: 0 };
  const later = tapePrices;
  let best = later.length ? Math.max(...later) / px : null;
  let quote = quotePrice ? quotePrice / px : null;
  // The candle that contains the alert counts, and nothing earlier.
  let since = candles.filter((c) => c[0] >= ts - 300 && c[0] <= ts + horizonS);
  // A pool that saw less volume than the cohort itself put in is not where the cohort traded.
  const floor = Math.max(MIN_CANDLE_VOLUME_USD, burstUsd * 0.5);
  const volume = since.filter((c) => c.length > 5 && c[5]).map((c) => c[5]);
  if (volume.length && volume.reduce((s, v) => s + v, 0) < floor) since = [];
  // Candles in another unit than the fill (v4 pools come back off by exactly a thousand).
  if (since.length) {
    const ratio = since[0][1] / px;
    const unit = [1, 1e3, 1e-3, 1e6, 1e-6].find((u) => ratio / u >= 0.2 && ratio / u <= 5);
    since = unit === undefined ? [] : since.map((c) => [c[0], c[1] / unit, c[2] / unit, c[3] / unit, c[4] / unit, ...c.slice(5)]);
  }
  let trail = null;
  if (since.length) {
    best = Math.max(...since.map((c) => c[2])) / px;
    quote = since[since.length - 1][4] / px;
    // the trail: out at the first candle whose low is a fifth under the running high
    let high = px;
    trail = undefined;
    for (let i = 0; i < since.length; i++) {
      const c = since[i];
      if (i === 0) {
        if (c[3] <= px * (1 - TRAIL_DROP)) {
          trail = 1 - TRAIL_DROP;
          break;
        }
        high = Math.max(high, c[4]);
        continue;
      }
      high = Math.max(high, c[2]);
      if (c[3] <= high * (1 - TRAIL_DROP)) {
        trail = (high * (1 - TRAIL_DROP)) / px;
        break;
      }
    }
    if (trail === undefined) trail = since[since.length - 1][4] / px;
  }
  return {
    best: best != null ? round2(best) : null,
    last: later.length ? round2(later[later.length - 1] / px) : null,
    now: quote != null ? round2(quote) : null,
    trail: trail != null ? round2(trail) : null,
    fills: later.length,
  };
}

/** The hour-later read of one alert: peak and when, now, volume since, the trail. */
export function measure({ px, ts, now, candles = [], tapePrices = [], quotePrice = null, burstUsd = 0 }) {
  const o = outcome({ px, ts, candles, tapePrices, quotePrice, burstUsd });
  const after = candles.filter((c) => c[0] >= ts - 300 && c[0] <= now);
  let peakMin = null;
  if (after.length && o.best != null) {
    const hi = after.reduce((a, c) => (c[2] > a[2] ? c : a));
    peakMin = Math.max(0, Math.round((hi[0] + 150 - ts) / 60));
  }
  const vol = after.length ? Math.round(after.reduce((s, c) => s + (c.length > 5 ? c[5] || 0 : 0), 0)) : null;
  return { best: o.best, peakMin, now: o.now, vol, trail: o.trail, witness: candles.length ? 'candles' : o.best != null ? 'tape' : 'none' };
}

// pipeline/record.py: verdict()
export function verdict(r, now) {
  if (r.unsellable) return 'honeypot';
  if (r.seeded) return 'seeded';
  if (r.followupAt == null) return now - r.ts < FOLLOWUP_MIN * 60 + 1800 ? 'open' : 'unmeasured';
  if (r.best == null) return 'unmeasured';
  if (r.vol != null && r.vol < DEAD_USD) return 'dead';
  if (r.best >= 2) return '2x';
  return r.best > 1 ? 'above' : 'below';
}

/** One alert read as a $100 paper trade: in at the entry, out at the hour (or the trail). */
export function judge(r, now) {
  const v = verdict(r, now);
  const closed = v !== 'open' && v !== 'unmeasured';
  const paper = closed && (r.hour != null || v === 'honeypot') ? (v === 'honeypot' ? -STAKE : round2(STAKE * (r.hour - 1))) : null;
  const paperTrail = closed && (r.trail != null || v === 'honeypot') ? (v === 'honeypot' ? -STAKE : round2(STAKE * (r.trail - 1))) : null;
  return { ...r, verdict: v, paper, paperTrail };
}

export function totals(rs) {
  const measured = rs.filter((r) => r.best != null && r.verdict !== 'open' && r.verdict !== 'unmeasured');
  const clean = measured.filter((r) => !['seeded', 'honeypot', 'dead'].includes(r.verdict));
  const bests = clean.map((r) => r.best).sort((a, b) => a - b);
  const block = (key) => {
    const xs = rs.filter((r) => r[key] != null);
    const wins = xs.filter((r) => r[key] > 0);
    return {
      trades: xs.length,
      pnl: round2(xs.reduce((s, r) => s + r[key], 0)),
      wins: wins.length,
      winRate: xs.length ? Math.round((wins.length / xs.length) * 1000) / 1000 : null,
      best: xs.length ? Math.max(...xs.map((r) => r[key])) : null,
      worst: xs.length ? Math.min(...xs.map((r) => r[key])) : null,
    };
  };
  return {
    pushes: rs.length,
    bursts: rs.filter((r) => r.kind === 'burst').length,
    launches: rs.filter((r) => r.kind === 'launch').length,
    measured: measured.length,
    clean: clean.length,
    aboveEntry: clean.filter((r) => r.best > 1).length,
    reached2x: clean.filter((r) => r.best >= 2).length,
    medianBest: bests.length ? bests[Math.floor(bests.length / 2)] : null,
    seeded: rs.filter((r) => r.verdict === 'seeded').length,
    dead: rs.filter((r) => r.verdict === 'dead').length,
    honeypot: rs.filter((r) => r.verdict === 'honeypot').length,
    paper: block('paper'),
    trail: block('paperTrail'),
  };
}
