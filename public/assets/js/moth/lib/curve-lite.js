// pump.fun bonding curve math for the browser (Moth's curve.js without node:crypto).
// Every pump.fun token trades against its own bonding-curve account until it graduates.

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
// sha256("account:BondingCurve")[0..8]
const DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

export const INITIAL_VIRTUAL_SOL = 30;
export const INITIAL_VIRTUAL_TOKENS = 1_073_000_000;
export const INITIAL_REAL_TOKENS = 793_100_000;
export const TOTAL_SUPPLY = 1_000_000_000;
const K = INITIAL_VIRTUAL_SOL * INITIAL_VIRTUAL_TOKENS;

// bytes: Uint8Array of the account data.
export function decodeCurve(bytes) {
  if (!bytes || bytes.length < 49) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== DISCRIMINATOR[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u64 = (offset) => Number(view.getBigUint64(offset, true));
  return {
    vTok: u64(8) / 1e6,
    vSol: u64(16) / 1e9,
    realTok: u64(24) / 1e6,
    realSol: u64(32) / 1e9,
    supply: u64(40) / 1e6,
    complete: bytes[48] === 1,
  };
}

export function marketCapSol(state) {
  if (!state || !state.vTok) return 0;
  return (state.vSol / state.vTok) * (state.supply || TOTAL_SUPPLY);
}

export function curveProgress(state) {
  if (!state) return 0;
  if (state.complete) return 1;
  return Math.min(1, Math.max(0, 1 - state.realTok / INITIAL_REAL_TOKENS));
}

export function stateFromMarketCap(mcSol) {
  const vSol = Math.sqrt((Math.max(mcSol, 1) * K) / TOTAL_SUPPLY);
  const vTok = K / vSol;
  const realTok = Math.max(0, INITIAL_REAL_TOKENS - (INITIAL_VIRTUAL_TOKENS - vTok));
  return { vSol, vTok, realSol: Math.max(0, vSol - INITIAL_VIRTUAL_SOL), realTok, supply: TOTAL_SUPPLY, complete: realTok <= 0 };
}

// getMultipleAccounts from the browser, 100 curves per request.
export function rpcCurveFetcher({ rpcUrl, timeoutMs = 10_000 }) {
  return async function fetchCurves(entries) {
    const out = new Map();
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [batch.map((e) => e.curve), { encoding: 'base64', commitment: 'confirmed' }] }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(res.status === 429 ? 'RPC rate limit' : `RPC responded ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`RPC error: ${body.error.message || body.error.code}`);
      const values = body.result?.value ?? [];
      batch.forEach((entry, j) => {
        const acc = values[j];
        if (!acc || acc.owner !== PUMP_PROGRAM || !Array.isArray(acc.data)) {
          out.set(entry.curve, null);
          return;
        }
        const bin = atob(acc.data[0]);
        const bytes = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        out.set(entry.curve, decodeCurve(bytes));
      });
    }
    return out;
  };
}
