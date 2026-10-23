// pump.fun bonding curve math. Every pump.fun token trades against its own
// bonding-curve account until it "graduates" to PumpSwap; reading that account
// tells us the token's price, market cap and how much SOL is in it.

import { createHash } from 'node:crypto';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const DISCRIMINATOR = createHash('sha256').update('account:BondingCurve').digest().subarray(0, 8);

// Launch parameters of a pump.fun curve, in whole tokens and SOL.
export const INITIAL_VIRTUAL_SOL = 30;
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
export const INITIAL_REAL_TOKENS = 793_100_000;
export const TOTAL_SUPPLY = 1_000_000_000;
const K = INITIAL_VIRTUAL_SOL * INITIAL_VIRTUAL_TOKENS;

// Account layout: 8-byte discriminator, then u64 virtual token reserves,
// virtual SOL reserves, real token reserves, real SOL reserves, total supply,
// and a bool "complete". Later fields (creator, flags) aren't needed.
export function decodeCurve(data) {
  if (!data || data.length < 49 || !data.subarray(0, 8).equals(DISCRIMINATOR)) return null;
  const u64 = (offset) => Number(data.readBigUInt64LE(offset));
  return {
    vTok: u64(8) / 1e6,
    vSol: u64(16) / 1e9,
    realTok: u64(24) / 1e6,
    realSol: u64(32) / 1e9,
    supply: u64(40) / 1e6,
    complete: data[48] === 1,
  };
}

export function marketCapSol(state) {
  if (!state || !state.vTok) return 0;
  return (state.vSol / state.vTok) * (state.supply || TOTAL_SUPPLY);
}

// How far along the curve the token is: 0 at launch, 1 when it graduates.
export function curveProgress(state) {
  if (!state) return 0;
  if (state.complete) return 1;
  return Math.min(1, Math.max(0, 1 - state.realTok / INITIAL_REAL_TOKENS));
}

// The curve state for a given market cap (used by the demo market).
export function stateFromMarketCap(mcSol) {
  const vSol = Math.sqrt((Math.max(mcSol, 1) * K) / TOTAL_SUPPLY);
  const vTok = K / vSol;
  const realTok = Math.max(0, INITIAL_REAL_TOKENS - (INITIAL_VIRTUAL_TOKENS - vTok));
  return { vSol, vTok, realSol: Math.max(0, vSol - INITIAL_VIRTUAL_SOL), realTok, supply: TOTAL_SUPPLY, complete: realTok <= 0 };
}

export function encodeCurve(state) {
  const buf = Buffer.alloc(81);
  DISCRIMINATOR.copy(buf, 0);
  const put = (offset, value, scale) => buf.writeBigUInt64LE(BigInt(Math.round(value * scale)), offset);
  put(8, state.vTok, 1e6);
  put(16, state.vSol, 1e9);
  put(24, state.realTok, 1e6);
  put(32, state.realSol, 1e9);
  put(40, state.supply ?? TOTAL_SUPPLY, 1e6);
  buf[48] = state.complete ? 1 : 0;
  return buf;
}
