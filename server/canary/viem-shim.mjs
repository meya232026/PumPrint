// "viem" as Canary sees it on this site. server/canary/engine.mjs (Canary's own source, compiled by
// scripts/build-canary.mjs) imports viem from here and from nowhere else.
//
// Canary uses six things from viem (all in vendor/canary/src/chain/rpc.ts): createPublicClient,
// encodeAbiParameters, http, keccak256, parseAbi and parseAbiItem. They come from the shared viem
// bundle in vendor/viem, which lacks parseAbiItem; for the plain signatures Canary passes,
// parseAbiItem(sig) is exactly parseAbi([sig])[0].
//
// Every transport Canary creates is wrapped in a read-only allowlist: the six JSON-RPC methods the
// reader needs. Anything else (eth_sendRawTransaction, eth_sign, ...) is refused here, before it can
// leave the process, whatever the code above asks for.
import viem from '../../vendor/viem/viem.cjs';

export const { createPublicClient, encodeAbiParameters, keccak256, parseAbi } = viem;

export function parseAbiItem(signature) {
  if (typeof signature !== 'string') throw new TypeError('canary viem shim: parseAbiItem takes one signature string');
  const items = viem.parseAbi([signature]);
  if (items.length !== 1) throw new Error(`canary viem shim: expected one ABI item from ${signature}`);
  return items[0];
}

export const READ_METHODS = new Set([
  'eth_chainId', // health()
  'eth_blockNumber', // getBlockNumber()
  'eth_getCode', // health(): is there a factory contract
  'eth_call', // readContract()
  'eth_getLogs', // TokenLaunched, CurveBuy / CurveSell, v4 Swap
  'eth_getBlockByNumber', // the timestamp of the newest trade
]);

const stats = { byMethod: Object.create(null), blocked: 0 };
export function rpcStats() {
  return { byMethod: { ...stats.byMethod }, blocked: stats.blocked };
}
export function resetRpcStats() {
  stats.byMethod = Object.create(null);
  stats.blocked = 0;
}

// The site routes every Canary request through its shared Robinhood Chain queue (server/hood/rpc.js)
// instead of viem's own HTTP transport: one rate-limited line to the node for all the site's tools.
let bridge = null;
export function useRpcBridge(fn) {
  bridge = typeof fn === 'function' ? fn : null;
}

export function http(url, config) {
  const route = bridge; // the bridge in place when the reader was made, so a later one cannot reroute it
  const factory = route
    ? viem.custom({ request: ({ method, params }) => route(method, params || [], url) }, { retryCount: 0 }) // the queue owns retries
    : viem.http(url, config);
  return (args) => {
    const transport = factory(args);
    const inner = transport.request;
    return {
      ...transport,
      request: async (req, opts) => {
        const method = req && req.method;
        if (!READ_METHODS.has(method)) {
          stats.blocked++;
          throw new Error(`canary read-only guard: JSON-RPC method ${String(method)} is not allowed`);
        }
        stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
        return inner(req, opts);
      },
    };
  };
}
