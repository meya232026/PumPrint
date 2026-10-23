// Mock Robinhood Chain (4663) JSON-RPC with a Pons V2 factory, curves, a graduated v4 pool,
// the Pons hook, StateView and PoolManager logs. Everything here is made up.
//   node mock-rpc.mjs [port]
// Admin: POST /__mock/patch {token, set:{...}}  POST /__mock/advance {blocks, curveTrades:{token:n}, poolSwaps:{token:n}}
//        POST /__mock/mode {...}  GET /__mock/stats  POST /__mock/reset-stats  GET /__mock/world
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const viem = require('../../vendor/viem/viem.cjs');
const { parseAbi, encodeFunctionResult, decodeFunctionData, encodeAbiParameters, keccak256, toEventSelector } = viem;

export const FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
export const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
const ZERO = '0x0000000000000000000000000000000000000000';

const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
]);
const tokenAbi = parseAbi(['function symbol() view returns (string)', 'function totalSupply() view returns (uint256)', 'function decimals() view returns (uint8)', 'function balanceOf(address owner) view returns (uint256)']);
const curveAbi = parseAbi(['function realQuoteReserve() view returns (uint256)', 'function quoteFeeBalance() view returns (uint256)', 'function creatorTaxBalance() view returns (uint256)']);
const stateViewAbi = parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)', 'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)']);
const hookAbi = parseAbi(['function pendingFees(bytes32 poolId, address currency) view returns (uint256)', 'function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)']);

const SIG = {
  launch: 'TokenLaunched(address,address,address,address,uint256,uint256)',
  buy: 'CurveBuy(address,address,uint256,uint256,uint256,uint256)',
  sell: 'CurveSell(address,address,uint256,uint256,uint256,uint256)',
  swap: 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)',
};
const TOPIC = Object.fromEntries(Object.entries(SIG).map(([k, s]) => [k, toEventSelector(s)]));
const TOPIC_NAME = Object.fromEntries(Object.entries(TOPIC).map(([k, v]) => [v, k]));

const pad32 = (addr) => '0x' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const hex = (n) => '0x' + BigInt(n).toString(16);
const lc = (a) => String(a).toLowerCase();
const E18 = 10n ** 18n;

export function poolIdFor(token, pairToken, poolFee, tickSpacing) {
  const [c0, c1] = pairToken.toLowerCase() < token.toLowerCase() ? [pairToken, token] : [token, pairToken];
  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
    [c0, c1, poolFee, tickSpacing, HOOK],
  ));
}

// ------------------------------------------------------------------ the made-up world
export const A = (prefix, n) => '0x' + prefix + BigInt(n).toString(16).padStart(40 - prefix.length, '0');
export const ADDR = {
  wallet: A('5a11e7', 1),
  lantern: A('c0ffee', 1), // curve phase
  orbit: A('c0ffee', 2), // graduated pool
  nights: A('c0ffee', 3), // curve, serial deployer
  weth: A('eeee', 1), // ERC-20 pair asset of ORBIT
  notPons: A('bad0', 1),
  buyer: A('b0b0', 1),
  swapper: A('b0b0', 2),
};
for (const [k, v] of Object.entries(ADDR)) if (!/^0x[0-9a-f]{40}$/.test(v)) throw new Error(`bad mock address ${k} ${v}`);

function makeWorld(opts = {}) {
  const latest = BigInt(opts.latest ?? 53_400_000);
  const blockTimeMs = opts.blockTimeMs ?? 250; // assumption for the mock only
  const nowMs = Date.now();
  const w = {
    chainId: opts.chainId ?? 4663,
    latest,
    blockTimeMs,
    tsAnchor: { block: latest, ms: nowMs },
    tokens: new Map(), // lc(token) -> state
    logs: [], // {address, topics, data, blockNumber}
    mode: { maxLogRange: 0, logErrorCode: -32602, fail: false, hang: false },
  };

  const add = (t) => {
    w.tokens.set(lc(t.token), t);
    w.logs.push({
      address: FACTORY,
      topics: [TOPIC.launch, pad32(t.token), pad32(t.curve), pad32(t.deployer)],
      data: encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }], [t.pairToken, 1n, t.graduationThreshold]),
      blockNumber: t.launchBlock,
    });
  };
  const base = (o) => ({
    symbol: 'TOKEN', decimals: 18, totalSupply: 1_000_000_000n * E18, balances: {},
    pairToken: ZERO, graduationThreshold: 4n * E18, poolFee: 10_000, tickSpacing: 200, creatorTaxBps: 100,
    buybackEnabled: false, phase: 0, reserve: 0n, quoteFee: 0n, tax: 0n,
    liquidity: 0n, tick: 0, pendingQuoteFee: 0n, pendingQuoteTax: 0n, pendingTokenFee: 0n, pendingTokenTax: 0n,
    symbolReverts: false,
    ...o,
  });

  // LANTERN: on the curve, deployer holds 7.5%, 2.84 ETH real reserve, 31 recent trades.
  add(base({
    token: ADDR.lantern, curve: A('c0ffeec', 1), deployer: A('deadbeef', 1),
    symbol: 'LANTERN', launchBlock: latest - 9_000n, reserve: 2_840_000_000_000_000_000n, quoteFee: 21_000_000_000_000_000n, tax: 7_000_000_000_000_000n,
    balances: { [A('deadbeef', 1)]: 75_000_000n * E18, [ADDR.wallet]: 12_345_678n * E18 },
  }));
  // ORBIT: graduated (phase 2) to a v4 pool against WETH.
  add(base({
    token: ADDR.orbit, curve: A('c0ffeec', 2), deployer: A('deadbeef', 2),
    symbol: 'ORBIT', launchBlock: latest - 150_000n, pairToken: ADDR.weth, phase: 2, creatorTaxBps: 200,
    liquidity: 48_219_330_118_220_441_009n, tick: -180_000, pendingQuoteFee: 41_000_000_000_000_000n, pendingQuoteTax: 9_000_000_000_000_000n,
    pendingTokenFee: 1_250_000n * E18, pendingTokenTax: 250_000n * E18,
    balances: { [A('deadbeef', 2)]: 11_200_000n * E18, [ADDR.wallet]: 500_000n * E18 },
  }));
  // NIGHTS: on the curve, its deployer launched 14 tokens inside the index window.
  const serial = A('deadbeef', 3);
  add(base({
    token: ADDR.nights, curve: A('c0ffeec', 3), deployer: serial, symbol: 'NIGHTS',
    launchBlock: latest - 2_000n, reserve: 4_200_000_000_000_000_000n, quoteFee: 300_000_000_000_000_000n,
    balances: { [serial]: 180_000_000n * E18, [ADDR.wallet]: 1n * E18 },
  }));
  for (let i = 0; i < 13; i++) {
    add(base({ token: A('c0ffee', 0x10 + i), curve: A('c0ffeec', 0x10 + i), deployer: serial, symbol: `SER${i}`, launchBlock: latest - 300_000n + BigInt(i) * 20_000n }));
  }
  // 290 filler launches by one-off deployers spread over the 400k-block index window (some older).
  for (let i = 0; i < 290; i++) {
    add(base({ token: A('f111', i), curve: A('f112', i), deployer: A('d1d1', i), symbol: `F${i}`, launchBlock: latest - 420_000n + BigInt(i) * 1_440n }));
  }
  // one ERC-20 that is not a Pons launch, and the WETH pair asset
  w.tokens.set(lc(ADDR.notPons), base({ token: ADDR.notPons, symbol: 'NOPE', notLaunch: true, curve: ZERO, deployer: ZERO, launchBlock: 0n }));
  w.erc20 = new Map([[lc(ADDR.weth), { symbol: 'WETH', decimals: 18, totalSupply: 10n ** 24n }]]);

  // recent curve trades (last 20k blocks) and pool swaps
  const curveTrade = (t, blockNumber, sell = false) => w.logs.push({
    address: t.curve,
    topics: [sell ? TOPIC.sell : TOPIC.buy, pad32(ADDR.buyer), pad32(ADDR.buyer)],
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n ** 16n, 10n ** 22n, 10n ** 14n, 10n ** 14n]),
    blockNumber,
  });
  const lantern = w.tokens.get(lc(ADDR.lantern));
  for (let i = 0; i < 31; i++) curveTrade(lantern, latest - 8_000n + BigInt(i) * 200n, i % 4 === 3); // newest at latest-2000 (~8m20s @250ms)
  const nights = w.tokens.get(lc(ADDR.nights));
  for (let i = 0; i < 40; i++) curveTrade(nights, latest - 1_900n + BigInt(i) * 40n, i % 5 === 4);
  const orbit = w.tokens.get(lc(ADDR.orbit));
  orbit.poolId = poolIdFor(orbit.token, orbit.pairToken, orbit.poolFee, orbit.tickSpacing);
  const swap = (t, blockNumber) => w.logs.push({
    address: POOL_MANAGER,
    topics: [TOPIC.swap, t.poolId, pad32(ADDR.swapper)],
    data: encodeAbiParameters([{ type: 'int128' }, { type: 'int128' }, { type: 'uint160' }, { type: 'uint128' }, { type: 'int24' }, { type: 'uint24' }], [-(10n ** 21n), 10n ** 15n, 2n ** 96n, t.liquidity, t.tick, 10_000]),
    blockNumber,
  });
  for (let i = 0; i < 57; i++) swap(orbit, latest - 19_000n + BigInt(i) * 300n);
  w.curveTrade = curveTrade;
  w.swap = swap;
  return w;
}

// ------------------------------------------------------------------ JSON-RPC
export function startMock({ port = 0, ...opts } = {}) {
  let world = makeWorld(opts);
  const stats = { http: 0, byMethod: {}, calls: {}, getLogs: [] };
  const tsOf = (n) => Math.floor((world.tsAnchor.ms - Number(world.tsAnchor.block - BigInt(n)) * world.blockTimeMs) / 1000);

  function kindOf(addr) {
    const a = lc(addr);
    if (a === lc(FACTORY)) return 'factory';
    if (a === lc(STATE_VIEW)) return 'stateView';
    if (a === lc(HOOK)) return 'hook';
    if (world.erc20.has(a)) return 'erc20';
    if (world.tokens.has(a)) return 'token';
    for (const t of world.tokens.values()) if (lc(t.curve) === a) return 'curve';
    return null;
  }
  const curveOf = (addr) => [...world.tokens.values()].find((t) => lc(t.curve) === lc(addr));
  const byPool = (id) => [...world.tokens.values()].find((t) => t.poolId && lc(t.poolId) === lc(id));
  const revert = () => { const e = new Error('execution reverted'); e.rpc = { code: 3, message: 'execution reverted', data: '0x' }; throw e; };

  function ethCall({ to, data }) {
    const kind = kindOf(to);
    if (!kind) return '0x';
    const abi = { factory: factoryAbi, token: tokenAbi, erc20: tokenAbi, curve: curveAbi, stateView: stateViewAbi, hook: hookAbi }[kind];
    const { functionName, args } = decodeFunctionData({ abi, data });
    const key = `${kind}.${functionName}`;
    stats.calls[key] = (stats.calls[key] || 0) + 1;
    let result;
    if (kind === 'factory') {
      const t = world.tokens.get(lc(args[0]));
      result = t && !t.notLaunch
        ? { token: t.token, curve: t.curve, deployer: t.deployer, creatorFeeRecipient: t.deployer, pairToken: t.pairToken, graduationThreshold: t.graduationThreshold, poolFee: t.poolFee, tickSpacing: t.tickSpacing, creatorTaxBps: t.creatorTaxBps, buybackEnabled: t.buybackEnabled, phase: t.phase, sweptQuote: t.phase >= 1 ? t.graduationThreshold : 0n, sweptTokens: 0n, sweptAt: 0n, exists: true }
        : { token: ZERO, curve: ZERO, deployer: ZERO, creatorFeeRecipient: ZERO, pairToken: ZERO, graduationThreshold: 0n, poolFee: 0, tickSpacing: 0, creatorTaxBps: 0, buybackEnabled: false, phase: 0, sweptQuote: 0n, sweptTokens: 0n, sweptAt: 0n, exists: false };
    } else if (kind === 'token' || kind === 'erc20') {
      const t = kind === 'token' ? world.tokens.get(lc(to)) : world.erc20.get(lc(to));
      if (functionName === 'symbol') { if (t.symbolReverts) revert(); result = t.symbol; }
      if (functionName === 'decimals') result = t.decimals;
      if (functionName === 'totalSupply') result = t.totalSupply;
      if (functionName === 'balanceOf') result = (t.balances || {})[lc(args[0])] ?? 0n;
    } else if (kind === 'curve') {
      const t = curveOf(to);
      if (t.phase !== 0) revert();
      result = { realQuoteReserve: t.reserve, quoteFeeBalance: t.quoteFee, creatorTaxBalance: t.tax }[functionName];
    } else if (kind === 'stateView') {
      const t = byPool(args[0]);
      if (functionName === 'getSlot0') result = t ? [2n ** 96n, t.tick, 0, t.poolFee] : [0n, 0, 0, 0];
      if (functionName === 'getLiquidity') result = t ? t.liquidity : 0n;
    } else if (kind === 'hook') {
      const t = byPool(args[0]);
      const quote = t && lc(args[1]) === lc(t.pairToken);
      if (!t) result = 0n;
      else if (functionName === 'pendingFees') result = quote ? t.pendingQuoteFee : t.pendingTokenFee;
      else result = quote ? t.pendingQuoteTax : t.pendingTokenTax;
    }
    return encodeFunctionResult({ abi, functionName, result });
  }

  function getLogs(filter) {
    const from = BigInt(filter.fromBlock ?? '0x0');
    const to = filter.toBlock === 'latest' || filter.toBlock === undefined ? world.latest : BigInt(filter.toBlock);
    const addrs = filter.address ? (Array.isArray(filter.address) ? filter.address : [filter.address]).map(lc) : null;
    const topics = filter.topics || [];
    const t0 = topics[0];
    const names = (Array.isArray(t0) ? t0 : [t0]).map((x) => TOPIC_NAME[x] || x);
    const kind = addrs ? kindOf(addrs[0]) || (lc(addrs[0]) === lc(POOL_MANAGER) ? 'poolManager' : '?') : 'any';
    stats.getLogs.push({ kind, events: names.join('|'), fromBlock: Number(from), toBlock: Number(to), range: Number(to - from + 1n), topic1: topics[1] ? 'set' : null });
    if (world.mode.maxLogRange && to - from + 1n > BigInt(world.mode.maxLogRange)) {
      const e = new Error('range'); e.rpc = { code: world.mode.logErrorCode, message: world.mode.logErrorMessage || `query exceeds max block range ${world.mode.maxLogRange}` }; throw e;
    }
    const match = (want, got) => want === null || want === undefined || (Array.isArray(want) ? want.map(lc).includes(lc(got)) : lc(want) === lc(got));
    return world.logs
      .filter((l) => (!addrs || addrs.includes(lc(l.address))) && l.blockNumber >= from && l.blockNumber <= to && topics.every((want, i) => match(want, l.topics[i])))
      .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0))
      .map((l, i) => ({
        address: l.address, topics: l.topics, data: l.data, blockNumber: hex(l.blockNumber),
        blockHash: '0x' + l.blockNumber.toString(16).padStart(64, '0'), transactionHash: '0x' + (l.blockNumber * 1000n + BigInt(i)).toString(16).padStart(64, '0'),
        transactionIndex: '0x0', logIndex: hex(i), removed: false,
      }));
  }

  function block(tag) {
    const n = tag === 'latest' ? world.latest : BigInt(tag);
    const h = '0x' + n.toString(16).padStart(64, '0');
    return {
      number: hex(n), hash: h, parentHash: '0x' + (n - 1n).toString(16).padStart(64, '0'), timestamp: hex(tsOf(n)), nonce: '0x0000000000000000',
      sha3Uncles: '0x' + '0'.repeat(64), logsBloom: '0x' + '0'.repeat(512), transactionsRoot: h, stateRoot: h, receiptsRoot: h, miner: ZERO,
      difficulty: '0x1', totalDifficulty: '0x1', extraData: '0x', size: '0x220', gasLimit: '0x4000000000000', gasUsed: '0x0', baseFeePerGas: '0x989680',
      mixHash: h, transactions: [], uncles: [],
    };
  }

  function dispatch({ method, params = [] }) {
    stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
    switch (method) {
      case 'eth_chainId': return hex(world.chainId);
      case 'eth_blockNumber': return hex(world.latest);
      case 'eth_getCode': return lc(params[0]) === lc(FACTORY) ? '0x6080604052348015600f57600080fd5b50' : '0x';
      case 'eth_call': return ethCall(params[0]);
      case 'eth_getLogs': return getLogs(params[0]);
      case 'eth_getBlockByNumber': return block(params[0]);
      default: { const e = new Error('nope'); e.rpc = { code: -32601, message: `method ${method} not found` }; throw e; }
    }
  }

  function admin(req, res, body) {
    const u = req.url;
    const send = (v) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))); };
    if (u === '/__mock/stats') return send(stats);
    if (u === '/__mock/reset-stats') { stats.http = 0; stats.byMethod = {}; stats.calls = {}; stats.getLogs = []; return send({ ok: true }); }
    if (u === '/__mock/mode') { Object.assign(world.mode, body); return send(world.mode); }
    if (u === '/__mock/reset-world') { world = makeWorld({ ...opts, ...body }); return send({ ok: true }); }
    if (u === '/__mock/patch') {
      const t = world.tokens.get(lc(body.token));
      for (const [k, v] of Object.entries(body.set || {})) t[k] = typeof t[k] === 'bigint' ? BigInt(v) : v;
      if (body.balances) for (const [k, v] of Object.entries(body.balances)) t.balances[lc(k)] = BigInt(v);
      if (t.phase === 2 && !t.poolId) t.poolId = poolIdFor(t.token, t.pairToken, t.poolFee, t.tickSpacing);
      return send({ ok: true });
    }
    if (u === '/__mock/advance') {
      const blocks = BigInt(body.blocks || 0);
      world.latest += blocks;
      world.tsAnchor = { block: world.latest, ms: Date.now() };
      for (const [tok, n] of Object.entries(body.curveTrades || {})) for (let i = 0; i < n; i++) world.curveTrade(world.tokens.get(lc(tok)), world.latest - BigInt(i));
      for (const [tok, n] of Object.entries(body.poolSwaps || {})) for (let i = 0; i < n; i++) world.swap(world.tokens.get(lc(tok)), world.latest - BigInt(i));
      return send({ latest: world.latest.toString() });
    }
    if (u === '/__mock/world') return send({ latest: world.latest, orbitPoolId: world.tokens.get(lc(ADDR.orbit)).poolId, launches: world.logs.filter((l) => l.address === FACTORY).length });
    res.writeHead(404); res.end();
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* */ }
      if (req.url.startsWith('/__mock/')) return admin(req, res, body);
      stats.http++;
      if (world.mode.hang) return; // never answer
      if (world.mode.fail) { res.writeHead(503); return res.end('down'); }
      const one = (msg) => {
        try { return { jsonrpc: '2.0', id: msg.id, result: dispatch(msg) }; } catch (e) { return { jsonrpc: '2.0', id: msg.id, error: e.rpc || { code: -32603, message: e.message } }; }
      };
      const out = Array.isArray(body) ? body.map(one) : one(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, stats, world: () => world })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock({ port: Number(process.argv[2] || 8645) });
  console.log(`mock Robinhood Chain RPC on ${m.url}  orbit poolId ${m.world().tokens.get(lc(ADDR.orbit)).poolId}`);
}
