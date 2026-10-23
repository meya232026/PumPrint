// A made-up market for demo launches, so the trading view can be tried offline.
// Each token gets a fate from a hash of its mint: most fizzle, some get pumped
// and dumped, a few keep running and a handful graduate. Tokens on the demo's
// narrative words do better, like real narratives.

import { stateFromMarketCap } from './curve.js';

const MIN = 60_000;
const START_MC = 28;
const HOT = ['otter', 'pizza', 'laser', 'capybara', '猫猫'];

function hash01(text, salt) {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1_000_000) / 1_000_000;
}

export function demoFate(entry) {
  const u = hash01(entry.mint, 1);
  const v = hash01(entry.mint, 2);
  const w = hash01(entry.mint, 3);
  const hot = HOT.some((word) => String(entry.name).toLowerCase().includes(word));
  const pGrad = hot ? 0.02 : 0.002;
  const pRun = hot ? 0.12 : 0.015;
  const pDump = hot ? 0.22 : 0.08;
  if (u < pGrad) return { kind: 'grad', peak: 420, rise: 10 + v * 25, phase: w * 6.28 };
  // Runners climb, hold for a while, then either fade out or get dumped.
  if (u < pGrad + pRun) return { kind: 'run', peak: 70 + v * 250, rise: 6 + w * 20, hold: 8 + v * 20, rugs: w < 0.5, phase: v * 6.28 };
  if (u < pGrad + pRun + pDump) return { kind: 'dump', peak: 50 + v * 140, rise: 2 + w * 10, crash: 0.5 + v * 3 };
  return { kind: 'dud', peak: START_MC + 0.5 + v * 6, rise: 0.3 + w * 2 };
}

// Market cap at a moment, and when trading stopped (null while it's still going).
export function demoMarket(entry, at) {
  const f = demoFate(entry);
  const m = (at - entry.t) / MIN;
  const ease = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 2;
  if (m <= 0) return { mc: START_MC, stoppedAt: null };
  if (f.kind === 'dud') {
    if (m < f.rise) return { mc: START_MC + (f.peak - START_MC) * ease(m / f.rise), stoppedAt: null };
    const d = Math.min(1, (m - f.rise) / 3);
    return { mc: f.peak - (f.peak - START_MC) * 0.9 * d, stoppedAt: d < 1 ? null : entry.t + (f.rise + 3) * MIN };
  }
  if (f.kind === 'dump') {
    if (m < f.rise) return { mc: START_MC + (f.peak - START_MC) * ease(m / f.rise), stoppedAt: null };
    const d = Math.min(1, (m - f.rise) / f.crash);
    return { mc: f.peak - (f.peak - START_MC * 1.04) * d, stoppedAt: d < 1 ? null : entry.t + (f.rise + f.crash) * MIN, peak: f.peak };
  }
  if (f.kind === 'run') {
    const top = f.peak * 1.1;
    if (m < f.rise) return { mc: (START_MC + (f.peak - START_MC) * ease(m / f.rise)) * (1 + 0.03 * Math.sin(at / 41_000 + f.phase)), stoppedAt: null, peak: f.peak };
    if (m < f.rise + f.hold) {
      const trend = f.peak + (top - f.peak) * ((m - f.rise) / f.hold);
      return { mc: trend * (1 + 0.05 * Math.sin(at / 41_000 + f.phase)), stoppedAt: null, peak: top * 1.05 };
    }
    const end = f.rise + f.hold;
    const d = Math.min(1, (m - end) / (f.rugs ? 2 : 10));
    const floor = f.rugs ? START_MC * 1.1 : top * 0.7;
    return { mc: top - (top - floor) * d, stoppedAt: d < 1 ? null : entry.t + (end + (f.rugs ? 2 : 10)) * MIN, peak: top * 1.05 };
  }
  if (m < f.rise) return { mc: (START_MC + (f.peak - START_MC) * ease(m / f.rise)) * (1 + 0.02 * Math.sin(at / 29_000 + f.phase)), stoppedAt: null };
  return { mc: 415, stoppedAt: entry.t + f.rise * MIN, complete: true };
}

export function demoCurveFetcher({ now = () => Date.now() } = {}) {
  return async function fetchCurves(entries) {
    const at = now();
    const out = new Map();
    for (const entry of entries) {
      const cur = demoMarket(entry, at);
      const state = stateFromMarketCap(cur.mc);
      state.complete = Boolean(cur.complete);
      state.lastTradeAt = cur.stoppedAt ?? at;
      state.mc5mAgo = demoMarket(entry, at - 5 * MIN).mc;
      if (cur.peak && at - entry.t > (demoFate(entry).rise || 0) * MIN) {
        state.peakMc = cur.peak;
        state.peakRealSol = stateFromMarketCap(cur.peak).realSol;
      }
      out.set(entry.curve, state);
    }
    return out;
  };
}
