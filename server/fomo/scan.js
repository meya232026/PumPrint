// Reading the roster's fills off Robinhood Chain. Port of sources/rpc.py from
// cvxv666/fomo-robinhood-radar (MIT).
//
// How a fomo.family trade looks on chain 4663: a relayer submits it, so the trader's wallet is
// never the transaction's `from`. Every fill is routed through one contract, and the wallet's only
// leg is the token arriving from it (a buy) or leaving to it (a sell). Two topic-filtered
// eth_getLogs calls (every Transfer from any roster wallet, every Transfer to one) cover the whole
// roster; receipts give each fill's dollar size.

import { toHex, fromHex } from '../hood/rpc.js';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const DECIMALS_SELECTOR = '0x313ce567';
export const BALANCE_SELECTOR = '0x70a08231';
export const TRANSFER_SELECTOR = '0xa9059cbb';
export const DEFAULT_DECIMALS = 18;

export const ROUTER = '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f';
export const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
export const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
// Assets a swap is priced in rather than positions anyone takes. Never a signal.
export const QUOTE_TOKENS = { [WETH]: ['WETH', 18], [USDG]: ['USDG', 6] };

export const topicFor = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
export const addressFromTopic = (topic) => `0x${topic.slice(-40).toLowerCase()}`;

/** One ERC-20 Transfer log into {token, frm, to, raw (BigInt), tx, index, block}, or null. */
export function parseTransfer(entry) {
  const topics = (entry && entry.topics) || [];
  if (topics.length < 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) return null;
  try {
    const data = entry.data || '0x';
    return {
      token: String(entry.address).toLowerCase(),
      frm: addressFromTopic(topics[1]),
      to: addressFromTopic(topics[2]),
      raw: data === '0x' || data === '' ? 0n : BigInt(data.length > 66 ? `0x${data.slice(2, 66)}` : data),
      tx: String(entry.transactionHash).toLowerCase(),
      index: fromHex(entry.logIndex),
      block: fromHex(entry.blockNumber),
    };
  } catch {
    return null;
  }
}

/** Only the legs traded against a router, one per transaction. */
export function routedFills(transfers, wallets, routers) {
  const fills = new Map();
  for (const t of transfers) {
    let side;
    let wallet;
    if (wallets.has(t.to) && routers.has(t.frm)) {
      side = 'buy';
      wallet = t.to;
    } else if (wallets.has(t.frm) && routers.has(t.to)) {
      side = 'sell';
      wallet = t.frm;
    } else continue;
    fills.set(t.tx, { side, wallet, mint: t.token, raw: t.raw, index: t.index, block: t.block });
  }
  return fills;
}

/** `direct` when the transaction was sent to the router itself (nobody's own trade), else `flow`. */
export function fillKind(receipt, routers) {
  return routers.has(String((receipt && receipt.to) || '').toLowerCase()) ? 'direct' : 'flow';
}

/** The largest single leg of each quote asset in the transaction, in whole units (never summed). */
export function quoteLegs(receipt) {
  const biggest = new Map();
  for (const e of (receipt && receipt.logs) || []) {
    const t = parseTransfer(e);
    if (t && QUOTE_TOKENS[t.token] && t.raw > (biggest.get(t.token) || 0n)) biggest.set(t.token, t.raw);
  }
  const out = {};
  for (const [token, raw] of biggest) out[token] = units(raw, QUOTE_TOKENS[token][1]);
  return out;
}

/** A fill's dollar size: USDG is a dollar, WETH needs a price. USDG wins when both appear. */
export function fillUsd(legs, ethPrice) {
  if (legs[USDG] != null) return legs[USDG];
  if (legs[WETH] != null && ethPrice) return legs[WETH] * ethPrice;
  return null;
}

/** A raw integer amount in whole units, without losing the big ones to float maths first. */
export function units(raw, decimals) {
  const d = BigInt(Math.max(0, Math.min(36, decimals | 0)));
  const scale = 10n ** d;
  const whole = raw / scale;
  const frac = raw % scale;
  return Number(whole) + Number(frac) / Number(scale);
}

/**
 * The scanner: every routed fill in one block range, dated, sized and priced.
 * `rpc` is a hood rpc client; `ethPrice()` gives WETH in dollars.
 */
export function createScanner({ rpc, routers = [ROUTER], ethPrice = () => null, log = null }) {
  const routerSet = new Set(routers.map((r) => r.toLowerCase()));
  const decimals = new Map();

  async function decimalsOf(mints) {
    const want = [...new Set(mints)].filter((m) => !decimals.has(m));
    if (want.length) {
      const res = await rpc.batch('eth_call', want.map((m) => [{ to: m, data: DECIMALS_SELECTOR }, 'latest']));
      want.forEach((m, i) => {
        let v = DEFAULT_DECIMALS;
        try {
          v = res[i] && res[i] !== '0x' ? Number(BigInt(res[i])) : DEFAULT_DECIMALS;
        } catch {
          v = DEFAULT_DECIMALS;
        }
        decimals.set(m, v >= 0 && v <= 36 ? v : DEFAULT_DECIMALS);
      });
    }
    return Object.fromEntries(mints.map((m) => [m, decimals.get(m) ?? DEFAULT_DECIMALS]));
  }

  async function transfers(wallets, from, to, outgoing) {
    const topics = [TRANSFER_TOPIC, null, null];
    topics[outgoing ? 1 : 2] = wallets.map(topicFor);
    const raw = await rpc.logs(from, to, { topics });
    return raw.map(parseTransfer).filter(Boolean);
  }

  /** Fills in [first, last]. `known(tx)` says a transaction is already stored (no receipt then). */
  async function scan(wallets, first, last, { known = () => false } = {}) {
    const list = [...wallets];
    const all = [...(await transfers(list, first, last, true)), ...(await transfers(list, first, last, false))];
    const fills = routedFills(all, new Set(list), routerSet);
    if (!fills.size) return [];

    // Blocks land on a fixed interval: two dated blocks date every log in between.
    const lastTs = await rpc.blockTimestamp(last);
    let perBlock = 0.1;
    const near = [...rpc.probes.keys()].filter((b) => b !== last && Math.abs(last - b) > 0 && Math.abs(last - b) <= 200_000);
    if (near.length && last - first < 5000) {
      const ref = near.reduce((a, b) => (Math.abs(last - b) < Math.abs(last - a) ? b : a));
      perBlock = Math.abs((lastTs - rpc.probes.get(ref)) / (last - ref)) || 0.1;
    } else if (last > first) {
      const firstTs = await rpc.blockTimestamp(first);
      perBlock = (lastTs - firstTs) / (last - first) || 0.1;
    }

    const txs = [...fills.keys()].filter((tx) => !known(tx));
    const receipts = txs.length ? await rpc.batch('eth_getTransactionReceipt', txs.map((tx) => [tx])) : [];
    const dec = await decimalsOf([...new Set([...fills.values()].map((f) => f.mint))]);
    const price = ethPrice();
    const out = [];
    txs.forEach((tx, i) => {
      const f = fills.get(tx);
      const receipt = receipts[i];
      const legs = receipt ? quoteLegs(receipt) : {};
      out.push({
        sig: `${tx}:${f.index}`,
        tx,
        address: f.wallet,
        mint: f.mint,
        side: f.side,
        usd: fillUsd(legs, price),
        eth: legs[WETH] ?? null,
        amount: units(f.raw, dec[f.mint]),
        ts: Math.round(lastTs - (last - f.block) * perBlock),
        block: f.block,
        kind: receipt ? fillKind(receipt, routerSet) : null,
      });
    });
    if (log && out.length) log.debug(`fomo scan ${first}..${last}: ${all.length} transfers, ${fills.size} fills, ${out.length} new`);
    return out;
  }

  /** Simulate the first step of a sell: the holder moving 1% to the router. */
  async function probeTransfer(mint, holder) {
    let units0;
    try {
      const raw = await rpc.call('eth_call', [{ to: mint, data: BALANCE_SELECTOR + topicFor(holder).slice(2) }, 'latest']);
      units0 = raw && raw !== '0x' ? BigInt(raw) : 0n;
    } catch (err) {
      return ['unknown', `balance unreadable: ${err.message}`];
    }
    if (units0 <= 0n) return ['unknown', 'the holder has nothing left to move'];
    const amount = units0 / 100n > 0n ? units0 / 100n : 1n;
    const to = [...routerSet][0];
    const data = (n) => TRANSFER_SELECTOR + topicFor(to).slice(2) + n.toString(16).padStart(64, '0');
    try {
      const raw = await rpc.call('eth_call', [{ from: holder, to: mint, data: data(amount) }, 'latest']);
      if (raw && raw !== '0x' && BigInt(raw) === 0n) return ['blocked', 'a transfer to the router returns false'];
      // A transfer to the router going through says less than one to the pool would: unknown.
      return ['unknown', 'a transfer to the router goes through'];
    } catch (err) {
      const m = String(err.message).toLowerCase();
      if (/max tx|maxtx|max transaction|exceeds max|max wallet|maxwallet|amount too large|exceeds limit/.test(m)) {
        try {
          await rpc.call('eth_call', [{ from: holder, to: mint, data: data(units0 / 100000n > 0n ? units0 / 100000n : 1n) }, 'latest']);
          return ['unknown', 'a transfer goes through at a hundred-thousandth (one percent exceeds its max tx)'];
        } catch (err2) {
          return ['blocked', `a transfer to the router reverts even at a hundred-thousandth: ${String(err2.message).slice(0, 100)}`];
        }
      }
      return ['blocked', `a transfer to the router reverts: ${String(err.message).slice(0, 120)}`];
    }
  }

  return { scan, decimalsOf, probeTransfer, toHex };
}
