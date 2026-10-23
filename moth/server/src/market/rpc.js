// Reads many bonding curves at once with getMultipleAccounts (100 per request).

import { decodeCurve, PUMP_PROGRAM } from './curve.js';

export function rpcCurveFetcher({ rpcUrl, fetchImpl = fetch, timeoutMs = 10_000 }) {
  return async function fetchCurves(entries) {
    const out = new Map();
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      const res = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getMultipleAccounts',
          params: [batch.map((e) => e.curve), { encoding: 'base64', commitment: 'confirmed' }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = new Error(res.status === 429 ? 'RPC rate limit' : `RPC responded ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const body = await res.json();
      if (body.error) throw new Error(`RPC error: ${body.error.message || body.error.code}`);
      const values = body.result?.value ?? [];
      batch.forEach((entry, j) => {
        const acc = values[j];
        if (!acc || acc.owner !== PUMP_PROGRAM || !Array.isArray(acc.data)) {
          out.set(entry.curve, null);
          return;
        }
        out.set(entry.curve, decodeCurve(Buffer.from(acc.data[0], 'base64')));
      });
    }
    return out;
  };
}
