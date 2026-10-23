// What happened after a call, measured from candles:
//   entry  the price when the post went out (open of the minute it was posted in,
//          or the last trade before it)
//   1m, 5m, 1h, 24h  the last price at post + 1 minute, 5 minutes, 1 hour, 24 hours
//   peak / low       best and worst close within the first 24 hours
// Candles: [{t (sec, start), o, h, l, c}] ascending.

export const HORIZONS = [
  { key: '1m', sec: 60 },
  { key: '5m', sec: 300 },
  { key: '1h', sec: 3600 },
  { key: '24h', sec: 86400 },
];

// After a horizon passes, wait this long for candle providers to catch up.
const SETTLE_SEC = { '1m': 90, '5m': 120, '1h': 180, '24h': 1200 };

export function lastAtOrBefore(candles, t) {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

const good = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Price when the post went out, from a candle series with candles of `step` seconds. */
export function entryOf(series, t0, step) {
  if (!series || !series.length) return null;
  const i = lastAtOrBefore(series, t0);
  if (i >= 0 && series[i].t + step > t0) {
    const c = series[i];
    return { idx: i, price: good(c.o) ? c.o : c.c, at: t0 };
  }
  // No trade in the minute of the post: the last trade before it is the price at the call.
  if (i >= 0 && t0 - series[i].t <= 6 * 3600) return { idx: i, price: series[i].c, at: t0 };
  // Token started trading right after the post (launched with the call).
  if (i + 1 < series.length && series[i + 1].t - t0 <= 10 * 60) {
    const c = series[i + 1];
    return { idx: i + 1, price: good(c.o) ? c.o : c.c, at: c.t };
  }
  return null;
}

/**
 * Price at time T: the close of the candle that T falls in (T itself only counts for the
 * candle before it, so a post on the minute measures exactly 1 minute). Never earlier
 * than T. Undefined while T is still in the future.
 */
export function priceAt(series, entry, T, now) {
  if (now < T) return undefined;
  const i = lastAtOrBefore(series, T - 1);
  if (i < 0) return null;
  // No trades between the call and T: the price did not move.
  if (i < entry.idx) return entry.price;
  return series[i].c;
}

/**
 * fine:   1-minute candles from shortly before the post to post + 1 hour (or now)
 * coarse: 15-minute candles from the post to post + 24 hours (or now), may be empty
 * Returns the measurement and when it should be checked again.
 */
export function measure({ fine, coarse, postedAtMs, nowMs, supply }) {
  const t0 = Math.floor(postedAtMs / 1000);
  const now = Math.floor(nowMs / 1000);
  const out = {
    status: 'no-entry',
    entry: null,
    entryAt: null,
    entryMc: null,
    frame: null,
    nextCheckAt: null,
  };
  for (const h of HORIZONS) {
    out[`p${h.key}`] = null;
    out[`r${h.key}`] = null;
  }
  out.peak = null;
  out.peakAt = null;
  out.rPeak = null;
  out.low = null;
  out.rLow = null;

  const f = Array.isArray(fine) ? fine : [];
  const c = Array.isArray(coarse) ? coarse : [];
  let base = null;
  let baseSeries = null;
  let baseStep = 60;
  const e1 = entryOf(f, t0, 60);
  if (e1 && good(e1.price)) {
    base = e1;
    baseSeries = f;
    out.frame = '1m';
  } else {
    const e15 = entryOf(c, t0, 900);
    if (e15 && good(e15.price)) {
      base = e15;
      baseSeries = c;
      baseStep = 900;
      out.frame = '15m';
    }
  }
  if (!base) return out;

  const entry = base.price;
  out.entry = entry;
  out.entryAt = base.at * 1000;
  if (good(supply)) out.entryMc = entry * supply;

  let pending = null;
  for (const h of HORIZONS) {
    const T = t0 + h.sec;
    let p;
    if (h.sec <= 3600 && baseStep === 60) {
      // within the first hour the minute candles answer it
      p = priceAt(f, base, T, now);
    } else if (h.sec <= 3600 && baseStep !== 60) {
      // only coarse data: 1m and 5m can't be told apart from the entry
      p = h.sec < 3600 ? null : priceAt(c, base, T, now);
    } else {
      const ce = entryOf(c, t0, 900);
      p = ce ? priceAt(c, { idx: ce.idx, price: entry }, T, now) : now < T ? undefined : null;
    }
    if (p === undefined) {
      if (!pending) pending = h;
      continue;
    }
    if (good(p)) {
      out[`p${h.key}`] = p;
      out[`r${h.key}`] = p / entry - 1;
    }
  }

  // Best and worst close in the first 24 hours (or until now).
  const end = Math.min(now, t0 + 86400);
  let peak = entry;
  let peakAt = base.at;
  let low = entry;
  const scan = (series, from, to) => {
    for (let i = 0; i < series.length; i++) {
      const s = series[i];
      if (s.t < from || s.t > to) continue;
      if (!good(s.c)) continue;
      if (s.c > peak) {
        peak = s.c;
        peakAt = s.t + (series === f ? 60 : 900);
      }
      if (s.c < low) low = s.c;
    }
  };
  if (baseStep === 60) {
    scan(f, base.at - 59, Math.min(end, t0 + 3600));
    scan(c, t0 + 3600, end);
  } else {
    scan(c, base.at - 899, end);
  }
  out.peak = peak;
  out.peakAt = Math.min(peakAt, end) * 1000;
  out.rPeak = peak / entry - 1;
  out.low = low;
  out.rLow = low / entry - 1;

  if (pending) {
    out.status = 'partial';
    out.nextCheckAt = (t0 + pending.sec + SETTLE_SEC[pending.key]) * 1000;
  } else {
    out.status = 'priced';
  }
  return out;
}

/** Which candle windows a call needs right now (seconds). */
export function windowsFor(postedAtMs, nowMs) {
  const t0 = Math.floor(postedAtMs / 1000);
  const now = Math.floor(nowMs / 1000);
  const fineTo = Math.min(now, t0 + 3600 + 60);
  const coarseTo = Math.min(now, t0 + 86400 + 900);
  return {
    fine: { from: t0 - 1800, to: fineTo, step: 60 },
    // The 24-hour series is only needed once the first hour is over.
    coarse: now > t0 + 3600 ? { from: t0 - 900, to: coarseTo, step: 900 } : null,
  };
}
