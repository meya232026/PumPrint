// A caller's report card from the calls' 1m / 5m / 1h / 24h results.
// Grade: Kolibri's formula (60% share of calls up, 40% median return, pulled toward
// 50 while the sample is small) applied to the 1-hour result: would buying every call
// and selling an hour later have worked?

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../vendor/kolibri/extension/shared/score.js');

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const share = (values, pred) => (values.length ? values.filter(pred).length / values.length : null);

export const COUNTED_OUT = new Set(['unresolved', 'no-entry', 'too-old']);
export const counted = (c) => Boolean(c) && !COUNTED_OUT.has(c.status);

export function summarize(calls, now = Date.now()) {
  const all = Array.isArray(calls) ? calls : [];
  const live = all.filter(counted);
  const vals = (k) => live.map((c) => c[k]).filter(isNum);
  const r1m = vals('r1m');
  const r5m = vals('r5m');
  const r1h = vals('r1h');
  const r24 = vals('r24h');
  const peaks = vals('rPeak');
  const caps = vals('entryMc');
  const score = S.scoreFrom(r1h);
  const g = S.gradeFor(score, r1h.length);
  let best = null;
  for (const c of live) if (isNum(c.rPeak) && (!best || c.rPeak > best.rPeak)) best = c;
  const times = all.map((c) => c.postedAt).filter(isNum);
  const brief = (c) => c && { id: c.id, symbol: c.symbol || null, rPeak: c.rPeak, r1h: c.r1h, postedAt: c.postedAt };
  return {
    calls: live.length,
    tracked: all.length,
    priced1h: r1h.length,
    priced24: r24.length,
    // stored in a column that Kolibri's database calls "priced7"
    priced7: r1h.length,
    pending: live.filter((c) => !isNum(c.r24h)).length,
    skipped: all.length - live.length,
    up1m: share(r1m, (r) => r > 0),
    up5m: share(r5m, (r) => r > 0),
    up1h: share(r1h, (r) => r > 0),
    up24: share(r24, (r) => r > 0),
    med1m: S.median(r1m),
    med5m: S.median(r5m),
    med1h: S.median(r1h),
    med24: S.median(r24),
    avg1h: S.mean(r1h),
    medPeak: S.median(peaks),
    hit2x: share(peaks, (r) => r >= 1),
    medCallMc: S.median(caps),
    best: brief(best),
    score,
    grade: g.grade,
    tone: g.tone,
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: times.length ? Math.max(...times) : null,
    computedAt: now,
  };
}
