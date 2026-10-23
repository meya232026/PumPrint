// Canary on the site: the read-only Pons V2 watchtower (vendor/canary, MIT) run from the site's own
// watcher loop. Canary's web board (src/ui/web-board.ts) is not used: it starts a server of its own at
// import time. Everything here calls Canary's engine (server/canary/engine.mjs) directly:
//   reader.snapshot / positions / health    PonsV2Reader, or Canary's FixtureReader in demo mode
//   evaluate(before, after, thresholds)     Canary's ten deterministic rules
//   Store, Deduped + TelegramSink, controlAuthorized, loadConfig (refuses signing material)
//
// Every chain read goes through the site's shared Robinhood Chain queue (server/hood/rpc.js) and
// through the read-only allowlist in viem-shim.mjs. There is no key, no signer, no transaction path.
//
//   GET  /api/canary/state                 the server watch list, latest snapshots, the signal feed, chain health
//   GET  /api/canary/token?token=0x...     one watched token: snapshot, history, its signals
//   GET  /api/canary/scan?token=0x...      a one-shot read of any Pons V2 token, nothing stored (rate limited, cached 15 s)
//   GET  /api/canary/rules                 the rules and the thresholds in force
//   POST /api/canary/watch   {"token"}     add a token to the server watch list   (operator only, see controlAllowed)
//   POST /api/canary/unwatch {"token"}     take it off
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as C from './engine.mjs';
import { useRpcBridge } from './viem-shim.mjs';
import { HttpError, readJson, sendJson, windowLimiter, clientIp } from '../util.js';
import { createCanaryDemo } from './demo.js';

const PHASES = ['CURVE', 'SWEPT', 'POOL', 'RESCUED'];
export const RULES = [
  ['deployer-balance-drop', 'leave', 'devSellPct', 'The deployer\'s token balance fell by more than this many points of supply between sweeps. A sell, a transfer and a burn look the same.'],
  ['curve-reserve-drop', 'leave', 'liquidityDropPct', 'The curve\'s real quote reserve fell by more than this, both sweeps still on the curve.'],
  ['pool-liquidity-drop', 'leave', 'poolLiquidityDropPct', 'Active Uniswap v4 liquidity fell by more than this, both sweeps in the pool.'],
  ['fees-swept', 'warn', null, 'Pending curve fees (quote fees plus creator tax) went down. A balance moved; who moved it is not claimed.'],
  ['pool-token-fees-moved', 'warn', null, 'Pending launch-token fees on the Pons hook went down.'],
  ['pool-price-move', 'warn', 'poolPriceMovePct', 'The pool price moved by this much or more, either way. Volatility, not a direction call.'],
  ['pool-swap-burst', 'warn', 'poolSwapBurstCount', 'This many more swaps or more entered the recent window since the last sweep.'],
  ['volume-dead', 'warn', 'volumeDeadMinutes', 'The newest curve trade is this old or older. An unknown last trade stays quiet.'],
  ['serial-deployer', 'warn', 'serialDeployerCount', 'The deployer has this many launches or more in the indexed window. Frequency, not a verdict.'],
  ['phase-change', 'info', null, 'The Pons V2 phase changed: curve, swept, pool or rescued.'],
];
const UNIT = { devSellPct: 'points', liquidityDropPct: '%', poolLiquidityDropPct: '%', poolPriceMovePct: '%', poolSwapBurstCount: 'swaps', volumeDeadMinutes: 'min', serialDeployerCount: 'launches' };
// Canary's own variable names, read here with a CANARY_ prefix so they cannot collide with the site's other tools.
const KEYS = ['PONS_V2_FACTORY', 'WALLETS', 'TOKENS', 'POLL_SECONDS', 'TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID',
  'DEV_SELL_PCT', 'LIQUIDITY_DROP_PCT', 'VOLUME_DEAD_MINUTES', 'SERIAL_DEPLOYER_COUNT', 'POOL_LIQUIDITY_DROP_PCT', 'POOL_PRICE_MOVE_PCT',
  'POOL_SWAP_BURST_COUNT', 'INDEX_LOOKBACK_BLOCKS', 'TRADE_LOOKBACK_BLOCKS', 'LOG_CHUNK_BLOCKS', 'DISCOVERY_MAX_TOKENS'];
// What Canary refuses to run next to (src/util/env.ts), checked across the whole server environment.
const SIGNING = ['PRIVATE_KEY', 'SECRET_KEY', 'MNEMONIC', 'SEED_PHRASE', 'WALLET_PRIVATE_KEY'];
// Rules that describe a level rather than a change fire on every sweep; the feed keeps their rising edge.
const LEVEL_RULES = new Set(['serial-deployer', 'volume-dead']);
const RANK = { leave: 0, warn: 1, info: 2 };
const HISTORY = 360;
const ALERTS = 1000;

const replacer = (_k, v) => (typeof v === 'bigint' ? `${v}n` : v); // Canary's on-disk BigInt format
const reviver = (_k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
// Canary's reviver turns any "<digits>n" string into a BigInt, a deployer-chosen symbol like "420n" included.
const STRING_FIELDS = ['token', 'symbol', 'pairSymbol', 'curve', 'deployer', 'pairToken', 'poolId'];
export function strings(s) {
  if (s) for (const k of STRING_FIELDS) if (typeof s[k] === 'bigint') s[k] = `${s[k]}n`;
  return s;
}
const wire = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))); // BigInt -> decimal string
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]]));
// display only: whole and fraction split in BigInt first, so 2e23 raw units read as 200000, not 199999.99999999997
const units = (raw, decimals) => {
  if (raw === undefined || raw === null) return null;
  const b = BigInt(raw);
  const scale = 10n ** BigInt(Math.min(77, Math.max(0, decimals)));
  return Number(b / scale) + Number(b % scale) / Number(scale);
};

/** Canary's variables from CANARY_*, plus any signing material in the environment for loadConfig to refuse. */
export function canaryEnv(env) {
  const out = {};
  for (const k of SIGNING) if (env[k] !== undefined) out[k] = env[k];
  for (const k of KEYS) if (env[`CANARY_${k}`] !== undefined && env[`CANARY_${k}`] !== '') out[k] = env[`CANARY_${k}`];
  return out;
}

// Error texts from viem carry RPC URLs (keys in the path included) and request bodies: never shown as they are.
export function publicError(err) {
  const m = String((err && err.message) || err);
  if (/not a (Pons V2 )?launch|no fixture for/i.test(m)) return { code: 'not_pons', message: 'Not a Pons V2 launch from the configured factory.' };
  if (/deadline|took too long|timed? ?out|aborted/i.test(m)) return { code: 'rpc_timeout', message: 'The Robinhood Chain RPC did not answer in time.' };
  if (/rate limited|http 429/i.test(m)) return { code: 'rpc_busy', message: 'The Robinhood Chain RPC is rate limiting reads right now.' };
  if (/unreachable|HTTP request failed|fetch failed|ECONNREFUSED|ENOTFOUND|socket|rpc http/i.test(m)) return { code: 'rpc_unavailable', message: 'The Robinhood Chain RPC is unavailable.' };
  if (/read-only guard/.test(m)) return { code: 'blocked', message: 'A non-read RPC method was blocked.' };
  return { code: 'read_failed', message: 'The chain read failed.' };
}

/** The numbers a person reads, from one Canary snapshot. */
export function view(s) {
  const pairDec = s.pairDecimals ?? 18;
  return {
    phase: PHASES[s.phase] ?? 'UNKNOWN',
    pair: s.pairSymbol ?? 'QUOTE',
    pairDecimals: s.pairDecimals ?? 18,
    tokenDecimals: s.tokenDecimals ?? 18,
    devPct: s.devHoldPct,
    reserve: s.phase === 2 ? null : units(s.liquidityWei, pairDec), // pair units, curve only
    quoteFees: units(s.feesPendingWei, pairDec),
    tokenFees: s.poolPendingTokenFeesWei === undefined ? null : units(s.poolPendingTokenFeesWei, s.tokenDecimals ?? 18),
    price: s.poolPriceQuotePerToken ?? null, // pair per token, pool only
    poolLiquidity: s.poolLiquidity === undefined ? null : s.poolLiquidity.toString(), // raw v4 L, not TVL
    tick: s.poolTick ?? null,
    trades: s.trades,
    lastTradeAt: s.lastTradeAt || null, // 0 = unknown, or none in the lookback window
    deployer: s.deployer ?? null,
    deployerLaunches: s.deployerLaunches,
    creatorTaxPct: s.creatorTaxBps === undefined ? null : s.creatorTaxBps / 100,
  };
}

function memoryStore() {
  const m = new Map();
  return { get: (t) => m.get(t.toLowerCase()), put: (s) => m.set(s.token.toLowerCase(), s), save() {} };
}

function off(reason, message) {
  return {
    info: () => ({ on: false, mode: 'off', reason }),
    state: () => ({ mode: 'off', reason, message }),
    async handle(req, res, url) {
      if (req.method === 'GET' && url.pathname.replace(/\/+$/, '') === '/api/canary/state') return sendJson(res, 200, { mode: 'off', reason, message });
      return sendJson(res, 503, { error: 'canary_off', message });
    },
    close() {},
  };
}

export function createCanary({ dataDir, demo = false, env = process.env, log, rpc = null, trustProxy = false, now = Date.now, autostart = true }) {
  if (!demo && env.CANARY === '0') return off('switched_off', 'Canary is switched off on this site (CANARY=0).');
  const cenv = canaryEnv(env);
  let cfg;
  try {
    cfg = C.loadConfig(cenv); // throws KeyRefused when PRIVATE_KEY, MNEMONIC, SEED_PHRASE, ... is set
  } catch (err) {
    log.error(`canary: off: ${err.message}`);
    return off('signing_material', 'Canary found signing material (a private key or a seed phrase) in the server environment and refuses to run next to it. Remove it: the site never signs.');
  }
  if (!demo && !rpc) return off('no_rpc', 'Canary has no Robinhood Chain RPC on this server.');
  const thresholds = {
    devSellPct: cfg.devSellPct, liquidityDropPct: cfg.liquidityDropPct, volumeDeadMinutes: cfg.volumeDeadMinutes, serialDeployerCount: cfg.serialDeployerCount,
    poolLiquidityDropPct: cfg.poolLiquidityDropPct, poolPriceMovePct: cfg.poolPriceMovePct, poolSwapBurstCount: cfg.poolSwapBurstCount,
  };
  const maxTokens = Math.max(1, Number(env.CANARY_MAX_TOKENS) || 20);
  const pollSeconds = demo ? Math.max(1, Number(env.CANARY_DEMO_SECONDS) || 4) : Math.max(10, cfg.pollSeconds);
  const deadlineMs = Math.max(5_000, Number(env.CANARY_SNAPSHOT_DEADLINE_MS) || 30_000);
  const walletRefreshMs = Math.max(1, Number(env.CANARY_WALLET_REFRESH_MIN) || 15) * 60_000;
  const controlToken = String(env.CANARY_CONTROL_TOKEN || '').trim();
  const statusWindowMs = demo ? pollSeconds * 2500 : 15 * 60_000; // Canary's board keeps a signal on a token for 15 min
  const dir = join(dataDir, 'canary');
  if (!demo) mkdirSync(dir, { recursive: true });

  // ---------------------------------------------------------------- engine
  let reader;
  let world = null;
  const index = { ready: demo, building: false, error: null, launches: 0 };
  if (demo) {
    world = createCanaryDemo(C, now);
    reader = world.reader;
  } else {
    // Canary's reads through the site's shared Robinhood queue; the queue spaces calls, waits out 429s,
    // asks spare endpoints and splits log ranges the node will not answer whole.
    const hex = (h) => (typeof h === 'string' && /^0x[0-9a-f]+$/i.test(h) ? parseInt(h, 16) : null);
    useRpcBridge((method, params) => {
      if (method === 'eth_getLogs' && params[0] && !params[0].blockHash) {
        const { fromBlock, toBlock, ...filter } = params[0];
        const a = hex(fromBlock);
        const b = hex(toBlock);
        if (a !== null && b !== null) return rpc.logs(a, b, filter);
      }
      return rpc.call(method, params, { logs: method === 'eth_getLogs' });
    });
    reader = new C.PonsV2Reader({
      rpcUrl: 'site-queue',
      factory: cfg.ponsFactory,
      indexLookbackBlocks: cfg.indexLookbackBlocks,
      tradeLookbackBlocks: cfg.tradeLookbackBlocks,
      logChunkBlocks: cfg.logChunkBlocks,
      pinnedTokens: cfg.tokens.filter(C.isAddress),
      discoveryMaxTokens: cfg.discoveryMaxTokens,
      indexCachePath: join(dir, 'launch-index.json'),
    });
    useRpcBridge(null);
    // The launch index (deployer history) costs many log reads to build. One build at a time, and a
    // one-shot scan never waits for the first one: its deployer count is reported as not known yet.
    const refresh = reader.refreshIndex.bind(reader);
    let building = null;
    reader.refreshIndex = (force) => {
      if (building) return index.ready ? building : Promise.resolve();
      index.building = true;
      building = refresh(force)
        .then(() => {
          index.ready = true;
          index.error = null;
          index.launches = reader.index.size;
        })
        .catch((err) => {
          index.error = publicError(err).code;
          throw err;
        })
        .finally(() => {
          building = null;
          index.building = false;
        });
      return index.ready ? building : building.catch(() => {});
    };
  }
  const disk = demo ? memoryStore() : new C.Store(dir); // DATA_DIR/canary/.canary/snapshots.json
  const store = { get: (t) => strings(disk.get(t)), put: (x) => disk.put(x), save: () => disk.save() };
  const sink = new C.Deduped(!demo && cfg.telegramToken && cfg.telegramChatId ? [new C.TelegramSink(cfg.telegramToken, cfg.telegramChatId)] : []);
  const withDeadline = (p, ms, what) => {
    let timer;
    return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${what} deadline ${ms} ms`)), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer));
  };

  // ---------------------------------------------------------------- state
  const watched = new Map(); // lc token -> watcher
  const histories = new Map(); // lc token -> snapshots, newest last
  let alerts = []; // newest last, each { ...Alert, at, before }
  let health = { status: 'probing', checkedAt: 0, chainId: null, block: null };
  let pass = { running: false, count: 0, at: 0, ms: 0 };
  let lastDiscovery = 0;
  let tick = 0;

  const memoryFile = join(dir, 'memory.json');
  const watchlistFile = join(dir, 'watchlist.json');
  const writeAtomic = (file, value) => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, replacer));
    renameSync(tmp, file);
  };
  if (!demo && existsSync(memoryFile)) {
    try {
      const m = JSON.parse(readFileSync(memoryFile, 'utf8'), reviver);
      for (const [k, v] of Object.entries(m.samples || {})) if (C.isAddress(k)) histories.set(k, v.slice(-HISTORY).map(strings));
      alerts = (m.alerts || []).map(strings).filter((a) => C.isAddress(a.token)).slice(-ALERTS);
    } catch (err) {
      log.warn(`canary: memory file unreadable, starting clean: ${err.message}`);
    }
  }
  const saveMemory = () => {
    if (!demo) writeAtomic(memoryFile, { version: 1, updatedAt: now(), samples: Object.fromEntries(histories), alerts });
  };
  const saveWatchlist = () => {
    if (!demo) writeAtomic(watchlistFile, { version: 1, tokens: [...watched.values()].filter((w) => w.source === 'operator').map((w) => w.token.toLowerCase()).sort() });
  };

  function add(token, source) {
    const key = token.toLowerCase();
    if (watched.has(key)) return { ok: true, started: false };
    if (watched.size >= maxTokens) return { ok: false, status: 409, code: 'watch_full', message: `The server watches at most ${maxTokens} tokens.` };
    watched.set(key, { token, source, symbol: null, addedAt: now(), sweeps: 0, lastSweepAt: 0, ms: 0, errors: 0, error: null, fired: [] });
    return { ok: true, started: true };
  }
  for (const t of cfg.tokens.filter(C.isAddress)) add(t, 'env');
  if (demo) for (const t of world.tokens) add(t, 'demo');
  if (!demo && existsSync(watchlistFile)) {
    try {
      for (const t of JSON.parse(readFileSync(watchlistFile, 'utf8')).tokens || []) if (C.isAddress(t)) add(t, 'operator');
    } catch {
      /* a fresh list */
    }
  }
  const wallets = demo ? [world.wallet] : cfg.wallets.filter(C.isAddress);

  // The worst of what fired on the latest sweep and what the feed holds inside the status window.
  function statusOf(token, at = now()) {
    const key = token.toLowerCase();
    const w = watched.get(key);
    const recent = [...(w ? w.fired : []), ...alerts.filter((a) => a.token.toLowerCase() === key && at - a.at < statusWindowMs)];
    if (recent.some((a) => a.level === 'leave')) return 'LEAVE';
    if (recent.some((a) => a.level === 'warn')) return 'WATCH';
    if (recent.some((a) => a.level === 'info')) return 'INFO';
    return 'QUIET';
  }

  async function discover() {
    lastDiscovery = now();
    for (const wallet of wallets) {
      try {
        const held = await withDeadline(reader.positions(wallet), 180_000, 'positions');
        for (const p of held) if (add(p.token, 'wallet').ok === false) break;
      } catch (err) {
        log.warn(`canary: wallet discovery ${wallet.slice(0, 8)}: ${publicError(err).code}`);
      }
    }
  }

  async function sweepOnce() {
    if (pass.running) return;
    pass.running = true;
    const started = now();
    try {
      if (demo) world.advance(tick++);
      if (wallets.length && now() - lastDiscovery > walletRefreshMs) await discover();
      for (const w of [...watched.values()].slice(0, maxTokens)) {
        const t0 = now();
        try {
          const after = await withDeadline(reader.snapshot(w.token), deadlineMs, 'snapshot');
          const before = store.get(w.token);
          const fired = C.evaluate(before, after, thresholds, now());
          store.put(after);
          const key = w.token.toLowerCase();
          histories.set(key, [...(histories.get(key) || []), after].slice(-HISTORY));
          const prev = new Set(w.fired.map((a) => a.rule));
          for (const a of fired) {
            if (!(LEVEL_RULES.has(a.rule) && prev.has(a.rule))) {
              alerts.push({ ...a, at: after.at, before: before ? pick(view(before), ['devPct', 'reserve', 'price', 'trades']) : null });
            }
            await sink.send(a); // Canary's Deduped: same token and rule once per 30 min; Telegram only when set up
          }
          Object.assign(w, { symbol: after.symbol, sweeps: w.sweeps + 1, lastSweepAt: now(), ms: now() - t0, errors: 0, error: null, fired: fired.sort((x, y) => RANK[x.level] - RANK[y.level]) });
        } catch (err) {
          const e = publicError(err);
          Object.assign(w, { errors: w.errors + 1, lastSweepAt: now(), ms: now() - t0, error: e });
          log.warn(`canary: ${w.token} ${e.code}`);
          if (e.code === 'not_pons' && w.source === 'operator') {
            watched.delete(w.token.toLowerCase());
            saveWatchlist();
          }
        }
      }
      if (alerts.length > ALERTS) alerts = alerts.slice(-ALERTS);
      store.save();
      saveMemory();
    } catch (err) {
      log.warn(`canary: sweep: ${err.message}`);
    } finally {
      pass = { running: false, count: pass.count + 1, at: now(), ms: now() - started };
    }
  }

  async function probe() {
    try {
      const h = await withDeadline(reader.health(), 60_000, 'health');
      health = h.ok
        ? { status: 'ok', checkedAt: now(), chainId: h.chainId, block: String(h.block) }
        : { status: 'error', checkedAt: now(), chainId: h.chainId ?? null, block: null, error: h.chainId && h.chainId !== C.ROBINHOOD_CHAIN_ID ? 'wrong_chain' : publicError(h.error).code };
    } catch (err) {
      health = { status: 'error', checkedAt: now(), chainId: null, block: null, error: publicError(err).code };
    }
  }

  const timers = [];
  let stopped = false;
  function start() {
    if (!autostart) return;
    (async () => {
      await probe();
      if (!demo) await reader.refreshIndex().catch(() => {}); // the first sweep and the first scans want deployer history
      if (!stopped) await sweepOnce();
    })().catch((err) => log.warn(`canary start: ${err.message}`));
    timers.push(setInterval(() => void sweepOnce(), pollSeconds * 1000));
    timers.push(setInterval(() => {
      void probe();
      if (!demo) void reader.refreshIndex().catch(() => {}); // a no-op inside 5 min of the last build; keeps "newest launches" fresh
    }, demo ? 30_000 : 60_000));
    for (const t of timers) t.unref?.();
  }

  // ---------------------------------------------------------------- views
  function tokenRow(w, at) {
    const s = store.get(w.token);
    return {
      token: w.token,
      symbol: s ? s.symbol : w.symbol,
      source: w.source,
      status: s ? statusOf(w.token, at) : w.error ? 'ERROR' : 'PENDING',
      sweeps: w.sweeps,
      lastSweepAt: w.lastSweepAt || null,
      sweepMs: w.ms,
      error: w.error,
      signals: w.fired.map((a) => ({ rule: a.rule, level: a.level, headline: a.headline, was: a.was ?? null, now: a.now ?? null })),
      view: s ? view(s) : null,
      at: s ? s.at : null,
    };
  }
  // The newest launches in the index, offered on the page as tokens to try a scan on.
  const SECONDS_PER_BLOCK = 0.1008; // Robinhood Chain, measured (server/fomo/chain.js)
  function recentLaunches(n = 6) {
    if (demo) return world.tokens.map((token) => ({ token, ageS: null }));
    const head = Number(health.block || 0);
    return [...reader.index.values()]
      .sort((a, b) => (a.launchBlock > b.launchBlock ? -1 : a.launchBlock < b.launchBlock ? 1 : 0))
      .slice(0, n)
      .map((e) => ({ token: e.token, ageS: head && e.launchBlock ? Math.max(0, Math.round((head - Number(e.launchBlock)) * SECONDS_PER_BLOCK)) : null }));
  }

  function state(req) {
    const at = now();
    const day = alerts.filter((a) => at - a.at < 86_400_000);
    return {
      mode: demo ? 'demo' : 'live',
      now: at,
      chain: { id: C.ROBINHOOD_CHAIN_ID, ...health },
      index: { ready: index.ready, building: index.building, launches: index.launches, error: index.error },
      pass: { count: pass.count, at: pass.at || null, ms: pass.ms, running: pass.running, pollSeconds, nextAt: pass.at ? pass.at + pollSeconds * 1000 : null },
      limits: { maxTokens, watched: watched.size },
      control: { mode: demo ? 'demo' : controlToken ? 'key' : 'local', allowed: !demo && Boolean(req) && controlAllowed(req) },
      telegram: Boolean(!demo && cfg.telegramToken && cfg.telegramChatId),
      wallets: wallets.length,
      thresholds,
      windows: { tradeBlocks: cfg.tradeLookbackBlocks, indexBlocks: cfg.indexLookbackBlocks },
      stats: { leave24h: day.filter((a) => a.level === 'leave').length, watch24h: day.filter((a) => a.level === 'warn').length, info24h: day.filter((a) => a.level === 'info').length },
      tokens: [...watched.values()].map((w) => tokenRow(w, at)),
      alerts: wire(alerts.slice(-100).reverse()),
      recent: recentLaunches(),
    };
  }
  function tokenDetail(token) {
    const key = token.toLowerCase();
    const w = watched.get(key);
    if (!w) return null;
    const at = now();
    return {
      ...tokenRow(w, at),
      snapshot: store.get(w.token) ? wire(store.get(w.token)) : null,
      history: (histories.get(key) || []).map((s) => ({ at: s.at, phase: PHASES[s.phase] ?? 'UNKNOWN', ...pick(view(s), ['devPct', 'reserve', 'price', 'trades', 'quoteFees', 'tokenFees', 'poolLiquidity']) })),
      alerts: wire(alerts.filter((a) => a.token.toLowerCase() === key).slice(-50).reverse()),
    };
  }

  // ---------------------------------------------------------------- one-shot scan
  const allowScan = windowLimiter(Math.max(1, Number(env.CANARY_SCANS_PER_MINUTE) || 12));
  const allowAll = windowLimiter(Math.max(1, Number(env.CANARY_SCANS_PER_MINUTE_TOTAL) || 60));
  const scanCache = new Map();
  const inflight = new Map();
  let scansRunning = 0;
  async function scan(token) {
    const key = token.toLowerCase();
    const fresh = store.get(token);
    if (watched.has(key) && fresh && now() - fresh.at < pollSeconds * 1000) return { snapshot: wire(fresh), view: view(fresh), at: fresh.at, indexReady: index.ready, cached: true };
    const hit = scanCache.get(key);
    if (hit && now() - hit.at < 15_000) return { ...hit.value, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    if (scansRunning >= 3) throw new HttpError(503, 'busy', 'Canary is reading other tokens. Try again in a few seconds.');
    if (!allowAll('all')) throw new HttpError(429, 'busy', 'The site is scanning a lot right now. Try again in a minute.');
    const job = (async () => {
      scansRunning++;
      try {
        const s = await withDeadline(reader.snapshot(token), deadlineMs, 'snapshot');
        const value = { snapshot: wire(s), view: view(s), at: s.at, indexReady: index.ready };
        scanCache.set(key, { at: now(), value });
        if (scanCache.size > 250) for (const [k, v] of scanCache) if (now() - v.at > 60_000) scanCache.delete(k);
        return { ...value, cached: false };
      } finally {
        scansRunning--;
      }
    })();
    inflight.set(key, job);
    try {
      return await job;
    } finally {
      inflight.delete(key);
    }
  }

  // ---------------------------------------------------------------- HTTP
  const header = (req, name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] || '' : v || '';
  };
  // Canary's own rule (src/ui/control-auth.ts): with CANARY_CONTROL_TOKEN set, the x-canary-control header
  // must match it; without one, only a direct request on a server bound to 127.0.0.1 (HOST) may control.
  function controlAllowed(req) {
    return C.controlAuthorized({
      boundHost: String(env.HOST || ''),
      configuredToken: controlToken,
      suppliedToken: header(req, 'x-canary-control'),
      forwardedFor: header(req, 'x-forwarded-for'),
      remoteAddress: req.socket.remoteAddress || '',
    });
  }
  const tokenParam = (url) => {
    const t = String(url.searchParams.get('token') || '').trim();
    if (!C.isAddress(t)) throw new HttpError(400, 'bad_token', 'Paste a 0x token address (40 hex characters).');
    return t;
  };

  // Canary's own errors carry messages written for visitors (publicError): a 5xx among them is a chain or
  // load problem worth saying as it is, not the site's generic "something broke".
  async function handle(req, res, url) {
    try {
      return await route(req, res, url);
    } catch (err) {
      if (err instanceof HttpError && err.status >= 500) return sendJson(res, err.status, { error: err.code, message: err.message });
      throw err;
    }
  }

  async function route(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '');
    if (req.method === 'GET' && path === '/api/canary/state') return sendJson(res, 200, state(req));
    if (req.method === 'GET' && path === '/api/canary/rules') {
      return sendJson(res, 200, { thresholds, rules: RULES.map(([rule, level, key, when]) => ({ rule, level, threshold: key ? thresholds[key] : null, unit: key ? UNIT[key] : null, when })) });
    }
    if (req.method === 'GET' && path === '/api/canary/token') {
      const out = tokenDetail(tokenParam(url));
      if (!out) throw new HttpError(404, 'not_watched', 'This token is not on the server watch list. A scan reads it once.');
      return sendJson(res, 200, out);
    }
    if (req.method === 'GET' && path === '/api/canary/scan') {
      const token = tokenParam(url);
      if (!allowScan(clientIp(req, trustProxy))) throw new HttpError(429, 'slow_down', 'Too many scans from your address. Wait a minute.');
      try {
        return sendJson(res, 200, { ok: true, ...(await scan(token)) });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const e = publicError(err);
        if (demo && e.code === 'not_pons') throw new HttpError(404, 'not_pons', 'The demo knows only its six made-up tokens.');
        throw new HttpError(e.code === 'not_pons' ? 404 : 502, e.code, e.message);
      }
    }
    if (req.method === 'POST' && (path === '/api/canary/watch' || path === '/api/canary/unwatch')) {
      if (demo) throw new HttpError(403, 'demo', 'The demo watch list is fixed.');
      if (!/^application\/json\b/i.test(header(req, 'content-type'))) throw new HttpError(415, 'json_only', 'Send application/json.');
      if (!controlAllowed(req)) throw new HttpError(403, 'locked', 'Changing the server watch list needs the Canary control key.');
      const body = await readJson(req, 2048);
      const token = String(body.token || '').trim();
      if (!C.isAddress(token)) throw new HttpError(400, 'bad_token', 'Send a 0x token address.');
      if (path.endsWith('/unwatch')) {
        const had = watched.delete(token.toLowerCase());
        saveWatchlist();
        return sendJson(res, 200, { ok: true, stopped: had });
      }
      const r = add(token, 'operator');
      if (!r.ok) throw new HttpError(r.status, r.code, r.message);
      saveWatchlist();
      if (r.started) void sweepOnce();
      return sendJson(res, 200, r);
    }
    throw new HttpError(404, 'not_found', 'Unknown Canary endpoint.');
  }

  start();
  return {
    reader, // for tests
    sweepOnce,
    probe,
    state,
    info: () => ({ on: true, mode: demo ? 'demo' : 'live', rpc: health.status, watched: watched.size, maxTokens, pollSeconds, control: demo ? 'demo' : controlToken ? 'key' : 'local', telegram: Boolean(!demo && cfg.telegramToken && cfg.telegramChatId) }),
    handle,
    close() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      try {
        store.save();
        saveMemory();
      } catch (err) {
        log.warn(`canary: save on close: ${err.message}`);
      }
    },
  };
}
