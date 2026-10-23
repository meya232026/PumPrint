// Loxley on the site, mounted under /api/loxley. Paper only, read only: no route changes anything, and no
// wallet, key or signer exists in this process (safe.js keeps cli/wallet.js and cli/trade.js from ever
// loading). One desk (the launch feed and the paper sniper) runs for every visitor; reads are cached.
//
//   GET /api/loxley/state            the paper desk now: rules, totals, positions, recent cards, feed and rpc health
//   GET /api/loxley/stream           Server-Sent Events: card · follow · grad · pass · draw · fire · mark · close · siren · moved · copy · note
//   GET /api/loxley/scan?token=0x…   one token: curve, launch, pool, council, exit table, x-ray      (cached 30 s)
//   GET /api/loxley/market           DexScreener's Robinhood Chain list with the desk's stamp       (cached 60 s)
//   GET /api/loxley/fees?token=  · /dev?wallet=  · /exit?token=&eth=  · /xray?address=           (cached 15-60 s)
//   GET /api/loxley/health           { ok, mode, firewall } — firewall.intact must be true
//
// Pace. Loxley is built to run on one person's machine, polling every half second through its own RPC
// budget. On a site that shares Robinhood Chain's public node with Fomo Radar and Canary it runs slower:
// every call goes through the site's queue (server/hood/rpc.js), launches are polled every 2 s, followed up
// once (+60 s) and open positions marked every 15 s. LOXLEY_RPC_URL (a provider of your own) gives it the
// CLI's own pace on that endpoint instead.

import { join } from 'node:path';
import { loadLoxley, makeEnv, firewall } from './safe.js';
import { createPaperDesk } from './paper.js';
import { createReads } from './reads.js';
import { makeQuoter } from './quotes.js';
import { startRpcBridge } from './rpc-bridge.js';
import { createHoodRpc } from '../hood/rpc.js';
import { windowLimiter, clientIp } from '../util.js';

// what an operator may set for loxley, from the site's own environment as LOXLEY_<KEY>. Never a key or a seed.
const ALLOWED = ['EXPLORER_URL', 'EXPLORER_API', 'EXPLORER_API_KEY', 'EXPLORER_SPACING_MS', 'DEX_URL', 'RPC_SPACING_MS', 'RPC_LOGS_SPACING_MS', 'LOGS_CHUNK', 'POLL_MS', 'WINDOW_BLOCKS', 'HTTP_TIMEOUT_MS', 'HTTP_USER_AGENT',
  'PAPER_ETH', 'MIN_SCORE', 'MAX_OPEN', 'TAX_CEILING_BPS', 'DRAW_MAX_S', 'MAX_DEV_SHARE', 'MAX_CREATOR_TAX', 'ETH_PAIRS_ONLY', 'MAX_TWINS', 'MAX_EXEMPT', 'MAX_BUNDLE_PCT', 'REQUIRE_SOCIALS', 'REFUSE_FARMS',
  'TAKE_PROFIT_PCT', 'STOP_LOSS_PCT', 'TRAILING_PCT', 'MAX_HOLD_MIN', 'PHANTOM_ETH'];
// the shared-node pace (operator values override it)
const SHARED_PACE = { RPC_SPACING_MS: '250', RPC_LOGS_SPACING_MS: '1200', POLL_MS: '2000', MAX_OPEN: '2' };

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
};

function off(reason, message) {
  return {
    info: () => ({ on: false, mode: 'off', reason }),
    async handle(req, res) {
      json(res, 503, { error: 'loxley_off', message });
    },
    async close() {},
  };
}

// Messages a visitor may see: loxley's own wording for chain and source trouble, never a URL or a raw stack.
function publicMessage(err) {
  const m = String((err && err.message) || err || '');
  if (err && err.status === 400) return m;
  if (/not a 0x|pass a 0x/i.test(m)) return 'Pass a 0x address (40 hex characters).';
  if (/no launch|no pool and no curve|factory has no launch/i.test(m)) return m.replace(/0x[0-9a-fA-F]{40}/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`);
  if (/did not answer|timeout|unreachable|rate limited|429/i.test(m)) return 'The chain or a data source did not answer in time. Try again in a minute.';
  return 'The read failed.';
}

export async function createLoxley({ demo = false, env = process.env, log = console, dataDir, rpc = null, trustProxy = false }) {
  if (!demo && env.LOXLEY === '0') return off('switched_off', 'Loxley is switched off on this site (LOXLEY=0).');
  const L = loadLoxley({ home: join(dataDir, 'loxley') });
  const op = {};
  for (const k of ALLOWED) if (env[`LOXLEY_${k}`] != null && env[`LOXLEY_${k}`] !== '') op[k] = String(env[`LOXLEY_${k}`]);

  let world = null;
  let bridge = null;
  let pace = 'demo';
  let base;
  if (demo) {
    const { startDemoWorld } = await import('./demo.js');
    world = await startDemoWorld({ L, log });
    base = { ...op, ...world.env };
  } else {
    const own = String(env.LOXLEY_RPC_URL || '').trim();
    const target = own ? createHoodRpc({ url: own, spacingMs: 20, logsSpacingMs: 100, log }) : rpc;
    if (!target) return off('no_rpc', 'Loxley has no Robinhood Chain RPC on this server.');
    // loxley posts JSON-RPC to RPC_URL: a loopback bridge hands each read to the queue, and refuses anything else
    bridge = await startRpcBridge({ call: target.call });
    pace = own ? 'own' : 'shared';
    base = { ...(pace === 'shared' ? SHARED_PACE : {}), ...op, RPC_URL: bridge.url, HTTP_TIMEOUT_MS: op.HTTP_TIMEOUT_MS || '30000' };
  }
  const lenv = makeEnv(base);

  // the event ring the stream replays from (Last-Event-ID), and the clients it fans out to
  const ring = [];
  const clients = new Set();
  const RING = 600;
  const MAX_CLIENTS = Math.max(1, Number(env.LOXLEY_MAX_STREAMS) || 300);
  const fanout = (ev) => {
    if (ev.type === 'alert') return; // the sniper's notify lines repeat fire, close and siren
    ring.push(ev);
    if (ring.length > RING) ring.shift();
    const chunk = `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(chunk);
  };
  const flags = { budget: '1000000' }; // paper: the CLI's session budget is a cap for real money, not a site rule
  const desk = createPaperDesk({
    L,
    env: lenv,
    log,
    flags,
    onEvent: fanout,
    traderFor: (chain) => makeQuoter({ L, chain, env: lenv }),
    followUps: pace === 'shared' ? [60_000] : [15_000, 60_000],
    markEveryMs: pace === 'shared' ? 15_000 : 5_000,
  });
  // The first read of the factory takes a while (WINDOW_BLOCKS in LOGS_CHUNK pieces) and fails outright when
  // the node is down: the site does not wait for it, and a failed start is retried.
  const boot = { ready: false, error: null, tries: 0, timer: null };
  (function start() {
    boot.tries++;
    desk.start().then(
      () => {
        boot.ready = true;
        boot.error = null;
        if (env.LOXLEY_FOLLOW) desk.follow(String(env.LOXLEY_FOLLOW).split(/[,\s]+/));
      },
      (e) => {
        boot.error = 'feed_down';
        log.warn(`loxley: the feed did not start (${e.message}), retrying`);
        boot.timer = setTimeout(start, Math.min(60_000, 5_000 * boot.tries));
        boot.timer.unref?.();
      },
    );
  })();

  // reads on their own gate, so a burst of visitor scans never stalls the sniper's marks
  const { makeChain } = L.require('cli/chain.js');
  const { makeSources } = L.require('cli/sources.js');
  const rctx = { ...desk.ctx, chain: makeChain(lenv, desk.ctx.log), sources: makeSources(lenv) };
  const reads = createReads({ L, ctx: rctx });
  const cache = new Map();
  const cached = (key, ms, fn) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.p;
    const p = fn().catch((e) => {
      cache.delete(key);
      throw e;
    });
    cache.set(key, { at: Date.now(), p });
    if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > 120_000) cache.delete(k);
    return p;
  };
  const perIp = windowLimiter(Math.max(1, Number(env.LOXLEY_READS_PER_MINUTE) || 20));
  const total = windowLimiter(Math.max(1, Number(env.LOXLEY_READS_PER_MINUTE_TOTAL) || 90));
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': hb\n\n');
  }, 15_000);
  heartbeat.unref?.();

  const mode = demo ? 'demo' : 'live';
  const version = L.require('package.json').version;
  const info = () => ({ on: true, mode, pace, paper: true, signing: false, ready: boot.ready, error: boot.error, version, chainId: Number(lenv.CHAIN_ID), clients: clients.size });
  const hello = () => ({ ...info(), ...desk.snapshot(), rulesText: desk.rulesText, world: world ? world.stats() : null });

  async function handle(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'read_only', message: 'Loxley on this site is read-only.' }, { allow: 'GET, HEAD' });
    const path = url.pathname.slice('/api/loxley'.length).replace(/\/+$/, '') || '/';
    const q = (k) => String(url.searchParams.get(k) || '').trim();
    if (path === '/health') return json(res, 200, { ok: true, mode, paper: true, firewall: firewall() });
    if (path === '/state') return json(res, 200, hello());
    if (path === '/stream') {
      if (clients.size >= MAX_CLIENTS) return json(res, 503, { error: 'busy', message: 'Too many live viewers right now. The page will try again.' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify(hello())}\n\n`);
      const last = Number(req.headers['last-event-id'] || q('since') || 0);
      if (last) for (const ev of ring) if (ev.seq > last) res.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    const routes = {
      '/scan': () => cached(`scan:${q('token').toLowerCase()}`, 30_000, () => reads.scan(q('token'))),
      '/market': () => cached('market', 60_000, () => reads.market({ top: 40 })),
      '/fees': () => cached(`fees:${q('token').toLowerCase()}`, 60_000, () => reads.fees(q('token'))),
      '/dev': () => cached(`dev:${q('wallet').toLowerCase()}`, 60_000, () => reads.dev(q('wallet'))),
      '/exit': () => cached(`exit:${q('token').toLowerCase()}:${q('eth')}`, 15_000, () => reads.exit(q('token'), parseFloat(q('eth')) || null)),
      '/xray': () => cached(`xray:${q('address').toLowerCase()}`, 60_000, () => reads.xray(q('address'))),
    };
    if (!routes[path]) return json(res, 404, { error: 'not_found', message: 'Unknown Loxley endpoint.' });
    if (!perIp(clientIp(req, trustProxy)) || !total('all')) return json(res, 429, { error: 'slow_down', message: 'Too many reads right now. Wait a minute.' });
    try {
      return json(res, 200, await routes[path](), path === '/market' ? { 'cache-control': 'public, max-age=30' } : {});
    } catch (err) {
      const status = err.status === 400 || err.status === 404 ? err.status : 502;
      return json(res, status, { error: status === 400 ? 'bad_request' : status === 404 ? 'not_found' : 'read_failed', message: publicMessage(err) });
    }
  }

  return {
    desk,
    reads,
    world,
    info,
    handle,
    async close() {
      clearInterval(heartbeat);
      clearTimeout(boot.timer);
      for (const res of clients) res.end();
      clients.clear();
      await desk.stop({ closeAll: false });
      if (world) await world.close();
      if (bridge) await bridge.close();
    },
  };
}
