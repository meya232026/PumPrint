// Moth Radar on the site: the original Moth server (vendor/moth) mounted under a
// path prefix of the site's own HTTP server. Same API and WebSocket protocol as
// the standalone server, so the Moth browser extension can use this address too:
//   https://your-site/moth      (REST: /moth/api/..., WebSocket: /moth/ws)

import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadConfig } from '../vendor/moth/server/src/config.js';
import { LaunchStore } from '../vendor/moth/server/src/store.js';
import { Hub } from '../vendor/moth/server/src/hub.js';
import { Access } from '../vendor/moth/server/src/access.js';
import { AccessKeys, ExpiringStore, RateLimiter } from '../vendor/moth/server/src/auth.js';
import { BalanceCache, fetchTokenBalance } from '../vendor/moth/server/src/solana.js';
import { createHttpHandler } from '../vendor/moth/server/src/http.js';
import { WebSocketServer } from '../vendor/moth/server/src/lib/websocket.js';
import { MarketTracker } from '../vendor/moth/server/src/market/tracker.js';
import { rpcCurveFetcher } from '../vendor/moth/server/src/market/rpc.js';
import { demoCurveFetcher } from '../vendor/moth/server/src/market/demo.js';
import { SolPrice } from '../vendor/moth/server/src/market/solprice.js';
import { loadState, saveState } from '../vendor/moth/server/src/persist.js';
import { startPumpPortal } from '../vendor/moth/server/src/sources/pumpportal.js';
import { startDemo } from '../vendor/moth/server/src/sources/demo.js';
import { VERSION } from '../vendor/moth/server/src/app.js';
import { stripPrefix } from './util.js';

const PUBLIC_DIR = fileURLToPath(new URL('../vendor/moth/server/public/', import.meta.url));

export async function createMoth({ server, prefix = '/moth', dataDir, demo = false, env = process.env, log, WebSocketImpl }) {
  const config = loadConfig(
    {
      ...env,
      SOURCE: demo ? 'demo' : env.MOTH_SOURCE || 'pumpportal',
      DATA_FILE: env.MOTH_DATA_FILE ?? join(dataDir, 'moth-launches.json'),
    },
    [],
  );
  const startedAt = Date.now();
  const store = new LaunchStore({ maxWindowMin: Math.max(...config.windows), stopwords: config.extraStopwords });

  let secret = config.accessSecret;
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    if (config.holder.mint) log.warn('moth: ACCESS_SECRET is not set, holder keys stop working when the server restarts');
  }
  const keys = new AccessKeys(secret, config.accessTtlDays * 24 * 60 * 60_000);
  const balances = new BalanceCache({
    fetchBalance: (wallet) => fetchTokenBalance({ rpcUrl: config.holder.rpcUrl, owner: wallet, mint: config.holder.mint }),
  });
  const access = new Access({ config, keys, balances, log });

  const tracker = config.market
    ? new MarketTracker({
        fetchCurves: config.source === 'demo' ? demoCurveFetcher() : rpcCurveFetcher({ rpcUrl: config.holder.rpcUrl }),
        log,
        pollMs: config.marketPollMs,
      })
    : null;
  const solPrice = new SolPrice({ log });
  const market = tracker
    ? {
        lead: (launches) => tracker.leader(launches),
        trading: (launches) => tracker.ranked(launches, 5),
        view: (mint) => tracker.view(mint),
        solUsd: () => solPrice.value,
      }
    : null;

  let source = null;
  const serverInfo = () => ({ server: { name: 'Moth', version: VERSION, source: source?.status?.kind ?? null } });
  const hub = new Hub({ store, access, config, log, serverInfo, market });

  const status = () => ({
    name: 'Moth',
    version: VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    source: source?.status ?? null,
    launches: { stored: store.size, ingested: store.ingested, skipped: store.skipped, perMinute: store.rate(5) },
    clients: hub.clients.size,
    market: tracker ? { ...tracker.summary(), solUsd: solPrice.value } : null,
    ...access.publicInfo(),
  });

  const handler = createHttpHandler({
    config,
    store,
    hub,
    access,
    keys,
    balances,
    nonces: new ExpiringStore({ ttlMs: 5 * 60_000 }),
    sessions: new ExpiringStore({ ttlMs: 10 * 60_000 }),
    limiter: new RateLimiter({ limit: 20, windowMs: 60_000 }),
    log,
    publicDir: PUBLIC_DIR,
    status,
    market,
  });

  const wss = new WebSocketServer({ server, path: `${prefix}/ws`, maxPayload: 16 * 1024 });
  hub.attach(wss);

  const ingest = (raw) => {
    const launch = store.add(raw);
    if (launch) {
      tracker?.track(launch);
      hub.broadcastLaunch(launch);
    }
    return launch;
  };

  // Launches from the last two hours survive a restart (not in demo mode).
  const persist = Boolean(config.dataFile) && config.source !== 'demo';
  if (persist) {
    const restored = store.restore(await loadState(config.dataFile, log));
    if (restored) log.info(`moth: restored ${restored} launches from ${config.dataFile}`);
    if (tracker) for (const launch of store.launches()) tracker.track(launch);
  }

  if (config.source === 'demo') {
    source = startDemo({ onLaunch: ingest, rate: config.demoRate, backfillMin: 2 * Math.max(...config.windows) + 5, log });
    store.coverageStart = source.status.backfilledFrom;
  } else {
    if (typeof globalThis.WebSocket !== 'function') throw new Error('Moth needs Node 22 or newer for live launches.');
    source = startPumpPortal({ url: config.pumpportalUrl, onLaunch: ingest, log, ...(WebSocketImpl ? { WebSocketImpl } : {}) });
  }

  const timers = [setInterval(() => hub.tick(), config.snapshotMs)];
  hub.startRevalidation();
  if (tracker) {
    tracker.poll();
    timers.push(setInterval(() => tracker.poll(), 3000));
    if (config.solPrice) solPrice.start();
  }
  const save = async () => {
    if (!persist) return;
    try {
      await saveState(config.dataFile, store.serialize());
    } catch (err) {
      log.warn('moth: could not save launches', { error: err.message });
    }
  };
  if (persist) timers.push(setInterval(save, 60_000));

  // The wallet verification page calls /api/... and /static/... from the server root;
  // here the API lives under the prefix, so serve a copy with the paths adjusted.
  let verifyHtml = null;
  async function serveVerify(res) {
    if (!verifyHtml) {
      const raw = await readFile(join(PUBLIC_DIR, 'verify.html'), 'utf8');
      verifyHtml = raw
        .replaceAll("'/api/", `'${prefix}/api/`)
        .replaceAll('`/api/', `\`${prefix}/api/`)
        .replaceAll('"/api/', `"${prefix}/api/`)
        .replaceAll('"/static/', `"${prefix}/static/`);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(verifyHtml);
  }

  return {
    config,
    store,
    status,
    info: () => ({
      source: source?.status?.kind ?? null,
      connected: Boolean(source?.status?.connected),
      windows: config.windows,
      holderMode: access.holderMode,
    }),
    async handle(req, res) {
      const original = stripPrefix(req, prefix);
      try {
        if (req.method === 'GET' && req.url.split('?')[0] === '/verify') return await serveVerify(res);
        return await handler(req, res);
      } finally {
        req.url = original;
      }
    },
    async close() {
      for (const t of timers) clearInterval(t);
      solPrice.stop();
      hub.stop();
      source?.stop();
      wss.close();
      await save();
    },
  };
}
