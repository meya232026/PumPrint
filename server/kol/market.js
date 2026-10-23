// Finds where a called token trades and fetches its candles.
// Markets come from Kolibri's resolver (DexScreener, Binance); candles from
// GeckoTerminal (DEX pools, 1- and 15-minute) or Binance (listed tickers).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CFG = require('../../vendor/kolibri/extension/shared/config.js');
const P = require('../../vendor/kolibri/extension/shared/prices.js');

const E = CFG.ENDPOINTS;

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

const sameAddr = (a, b) => Boolean(a && b) && (/^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);

export function marketKey(token) {
  return (token.kind === 'symbol' ? `sym:${token.symbol}` : `addr:${token.address}`) + (token.chain ? `@${token.chain}` : '');
}

/** Total supply from DexScreener (market cap / price), so a price becomes a market cap. */
export async function supplyFor(market, ctx) {
  if (!market || market.source !== 'dex' || !market.token) return null;
  try {
    const js = await ctx.fetchJson(`${E.dexscreener}/latest/dex/tokens/${market.token}`);
    const pairs = ((js && js.pairs) || []).filter((p) => p && p.baseToken && sameAddr(p.baseToken.address, market.token));
    let best = null;
    for (const p of pairs) {
      const price = num(p.priceUsd);
      const cap = num(p.marketCap) || num(p.fdv);
      if (!(price > 0) || !(cap > 0)) continue;
      const liq = num(p.liquidity && p.liquidity.usd) || 0;
      if (!best || liq > best.liq) best = { liq, supply: cap / price };
    }
    if (best && best.supply > 0) return best.supply;
  } catch {
    /* fall through */
  }
  // pump.fun style tokens always have a billion.
  if (/pump$/.test(market.token)) return 1e9;
  return null;
}

export async function resolve(token, ctx) {
  const market = await P.resolveMarket(token, ctx);
  if (!market) return null;
  market.supply = await supplyFor(market, ctx);
  return market;
}

const GECKO_FRAMES = { 60: ['minute', 1], 300: ['minute', 5], 900: ['minute', 15], 3600: ['hour', 1] };

async function geckoCandles(pool, tokenAddress, from, to, step, ctx) {
  const network = pool.network || CFG.DEX_TO_GECKO[pool.chain];
  if (!network) return [];
  const [frame, aggregate] = GECKO_FRAMES[step];
  const before = to + step;
  const limit = Math.max(5, Math.min(1000, Math.ceil((before - from) / step) + 2));
  const base = ctx.geckoKey ? E.geckoDemo : E.gecko;
  const opts = ctx.geckoKey ? { headers: { 'x-cg-demo-api-key': ctx.geckoKey } } : undefined;
  const url = `${base}/networks/${network}/pools/${pool.pool}/ohlcv/${frame}?aggregate=${aggregate}&before_timestamp=${before}&limit=${limit}&currency=usd&token=${tokenAddress}`;
  const candles = P.normGecko(await ctx.fetchJson(url, opts));
  return candles.filter((c) => c.t >= from - step && c.t <= to);
}

async function binanceCandles(market, from, to, step, ctx) {
  const interval = step === 60 ? '1m' : step === 300 ? '5m' : step === 3600 ? '1h' : '15m';
  const url = `${E.binance}/klines?symbol=${market.pair}&interval=${interval}&startTime=${from * 1000}&endTime=${to * 1000}&limit=1000`;
  return P.normBinance(await ctx.fetchJson(url));
}

/**
 * Candles for [from, to] in `step` seconds. For launchpad tokens the pool that existed
 * at the call (the bonding curve) is followed into the pool it migrated to.
 */
export async function candles(market, postedAtMs, from, to, step, ctx) {
  if (market.source === 'binance') return binanceCandles(market, from, to, step, ctx);
  const pools = (market.pools || []).slice();
  if (!pools.length) return [];
  const main = pools[0];
  // The pool that was trading when the post went out (the most liquid of those),
  // else the oldest one (a token launched together with the call).
  const existed = pools.filter((p) => !p.createdAt || p.createdAt <= postedAtMs).sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  const entryPool = existed[0] || pools.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
  let series = await geckoCandles(entryPool, market.token, from, to, step, ctx);
  const mainStart = main.createdAt ? Math.floor(main.createdAt / 1000) : null;
  if (main !== entryPool && mainStart && mainStart > from && mainStart < to) {
    const later = await geckoCandles(main, market.token, Math.max(from, mainStart - step), to, step, ctx);
    if (later.length) {
      const cut = later[0].t;
      series = series.filter((c) => c.t < cut).concat(later);
    }
  } else if (!series.length && main !== entryPool) {
    series = await geckoCandles(main, market.token, from, to, step, ctx);
  }
  return series;
}
