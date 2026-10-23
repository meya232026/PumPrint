// A quote-only stand-in for cli/trade.js makeTrader(): the four reads the paper sniper asks a trader for
// (record, poolKey, quotePool, exitQuote), as eth_calls through loxley's own rpc gate. No wallet client, no
// account, no send: `address` is null and there is nothing that could sign. Lets `snipe --grad` fire on paper
// (a v4 quote at graduation) and marks a pool position with the quoter, like the CLI's paper mode does.

export function makeQuoter({ L, chain, env }) {
  const deps = L.require('cli/deps.js'); // the frozen subset planted by safe.js
  const { parseAbi, encodeFunctionData, decodeFunctionResult, encodeAbiParameters, keccak256, getAddress } = deps;
  const ZERO = '0x0000000000000000000000000000000000000000';
  const QUOTER = parseAbi(['function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']);
  const STATE = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)']);
  const hook = getAddress(env.PONS_HOOK), stateView = getAddress(env.V4_STATE_VIEW), quoter = getAddress(env.V4_QUOTER);
  const PHASE = ['on the curve', 'swept, pool not created yet', 'pool created', 'rescued'];
  const keys = new Map();
  const call = (to, data) => chain.call('eth_call', [{ to, data }, 'latest']);

  async function record(token) {
    const r = await chain.factoryRecord(token); if (!r) return null;
    return { token: getAddress(token), curve: r.curve, pairToken: r.pair || ZERO, poolFee: r.poolFee, tickSpacing: r.tickSpacing, phase: r.phase, phaseText: PHASE[r.phase] || 'phase ' + r.phase, pairIsEth: (r.pair || ZERO) === ZERO };
  }
  async function poolKey(rec) {
    const k0 = rec.token.toLowerCase(); if (keys.has(k0)) return keys.get(k0);
    for (const fee of [...new Set([0, Number(rec.poolFee), 0x800000])]) {
      const [c0, c1] = BigInt(rec.token) < BigInt(rec.pairToken) ? [rec.token, getAddress(rec.pairToken)] : [getAddress(rec.pairToken), rec.token];
      const key = { currency0: c0, currency1: c1, fee, tickSpacing: rec.tickSpacing == null ? 200 : Number(rec.tickSpacing), hooks: hook };
      const id = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
      try { const r = await call(stateView, encodeFunctionData({ abi: STATE, functionName: 'getSlot0', args: [id] })); const s = decodeFunctionResult({ abi: STATE, functionName: 'getSlot0', data: r }); if (s[0] > 0n) { keys.set(k0, key); return key; } } catch { /* next fee */ }
    }
    throw new Error('no initialised v4 pool for ' + rec.token);
  }
  async function quotePool(rec, key, sellingToken, amount) {
    const tokenIs0 = key.currency0.toLowerCase() === rec.token.toLowerCase();
    const zeroForOne = sellingToken ? tokenIs0 : !tokenIs0;
    const r = await call(quoter, encodeFunctionData({ abi: QUOTER, functionName: 'quoteExactInputSingle', args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: '0x' }] }));
    return { amountOut: decodeFunctionResult({ abi: QUOTER, functionName: 'quoteExactInputSingle', data: r })[0], zeroForOne };
  }
  async function exitQuote(token, tokensWei) {
    const rec = await record(token); if (!rec) return null;
    if (rec.phase === 2) { try { const key = await poolKey(rec); return { venue: 'pool', ethOut: (await quotePool(rec, key, true, BigInt(tokensWei))).amountOut, record: rec }; } catch (e) { return { venue: 'pool', ethOut: null, record: rec, note: e.message }; } }
    if (rec.phase === 0) {
      const c = await chain.curveRead(rec.curve, { full: true });
      if (c.graduated || c.ready || c.quoteReserve == null) return { venue: 'halted', ethOut: null, record: rec };
      const q = BigInt(Math.round(c.quoteReserve * 1e6)) * 10n ** 12n, t = BigInt(Math.round(c.tokenReserve * 1e6)) * 10n ** 12n, x = BigInt(tokensWei);
      const gross = (x * q) / (t + x), out = gross - (gross * BigInt(c.feeBps || 0)) / 10000n - (gross * BigInt(c.creatorTaxBps || 0)) / 10000n;
      return { venue: 'curve', ethOut: out > 0n ? out : 0n, record: rec };
    }
    return { venue: 'halted', ethOut: null, record: rec, note: rec.phaseText };
  }
  return Object.freeze({ address: null, wc: null, account: null, record, poolKey, quotePool, exitQuote });
}
