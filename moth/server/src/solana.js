// Reads how many of the holder token a wallet owns, via any Solana JSON-RPC.
// Works for classic SPL and Token-2022 mints (the RPC infers the program from the mint).

export async function fetchTokenBalance({ rpcUrl, owner, mint, fetchImpl = fetch, timeoutMs = 8000 }) {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC responded ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC error: ${body.error.message || body.error.code}`);
  let total = 0;
  for (const acc of body.result?.value ?? []) {
    const amount = acc?.account?.data?.parsed?.info?.tokenAmount;
    const ui = amount ? Number(amount.uiAmountString ?? amount.uiAmount ?? 0) : 0;
    if (Number.isFinite(ui)) total += ui;
  }
  return total;
}

// Caches balances so a reconnecting panel doesn't hit the RPC every time.
// If the RPC fails, the last known balance is used.
export class BalanceCache {
  constructor({ fetchBalance, ttlMs = 10 * 60_000 }) {
    this.fetchBalance = fetchBalance;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.inflight = new Map();
  }

  async get(wallet, { fresh = false } = {}) {
    const hit = this.cache.get(wallet);
    if (!fresh && hit && Date.now() - hit.at < this.ttlMs) return hit.balance;
    const pending = this.inflight.get(wallet);
    if (pending) return pending;
    const p = Promise.resolve()
      .then(() => this.fetchBalance(wallet))
      .then((balance) => {
        this.cache.set(wallet, { balance, at: Date.now() });
        return balance;
      })
      .catch((err) => {
        if (hit) return hit.balance;
        throw err;
      })
      .finally(() => this.inflight.delete(wallet));
    this.inflight.set(wallet, p);
    return p;
  }
}
