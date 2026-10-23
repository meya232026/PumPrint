// The radar's view of Robinhood Chain over the public RPC, plus the price of ether.

import { createScanner, WETH } from './scan.js';

export const SECONDS_PER_BLOCK = 0.1008;

export function createLiveChain({ rpc, log, ethPrice }) {
  const scanner = createScanner({ rpc, ethPrice, log });
  return {
    head: () => rpc.head(),
    scan: (wallets, first, last, opts) => scanner.scan(wallets, first, last, opts),
    probeTransfer: (mint, holder) => scanner.probeTransfer(mint, holder),
    blocksForSeconds: (s) => Math.round(s / SECONDS_PER_BLOCK),
  };
}

/** WETH in dollars from DexScreener, refreshed every ten minutes. */
export function createEthPrice({ fetchImpl = fetch, log, fixed = null }) {
  let price = fixed;
  let at = 0;
  async function refresh() {
    if (fixed) return fixed;
    if (Date.now() - at < 600_000 && price) return price;
    at = Date.now();
    try {
      const res = await fetchImpl(`https://api.dexscreener.com/tokens/v1/robinhood/${WETH}`, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const pairs = await res.json();
        const prices = (Array.isArray(pairs) ? pairs : []).map((p) => Number(p.priceUsd)).filter((v) => Number.isFinite(v) && v > 0);
        if (prices.length) price = Math.max(...prices);
      }
    } catch (err) {
      log.debug(`fomo eth price: ${err.message}`);
    }
    return price;
  }
  return { get: () => price, refresh };
}
