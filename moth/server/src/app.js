import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LaunchStore } from './store.js';
import { Hub } from './hub.js';
import { Access } from './access.js';
import { AccessKeys, ExpiringStore, RateLimiter } from './auth.js';
import { BalanceCache, fetchTokenBalance } from './solana.js';
import { createHttpHandler } from './http.js';
import { WebSocketServer } from './lib/websocket.js';
import { MarketTracker } from './market/tracker.js';
import { rpcCurveFetcher } from './market/rpc.js';
import { demoCurveFetcher } from './market/demo.js';
import { SolPrice } from './market/solprice.js';

export const VERSION = '0.2.0';
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

export function createApp({ config, log, fetchBalance, fetchCurves, solPriceFetch, now } = {}) {
  const startedAt = Date.now();
  const store = new LaunchStore({ maxWindowMin: Math.max(...config.windows), stopwords: config.extraStopwords, now });

  let secret = config.accessSecret;
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    if (config.holder.mint) log.warn('ACCESS_SECRET is not set: holder keys stop working when the server restarts. Set it in .env.');
  }
  const keys = new AccessKeys(secret, config.accessTtlDays * 24 * 60 * 60_000);
  const balances = new BalanceCache({
    fetchBalance: fetchBalance ?? ((wallet) => fetchTokenBalance({ rpcUrl: config.holder.rpcUrl, owner: wallet, mint: config.holder.mint })),
  });
  const access = new Access({ config, keys, balances, log });
  const serverInfo = () => ({ server: { name: 'Moth', version: VERSION, source: source?.status?.kind ?? null } });

  // Trading data: which tokens behind each word are being bought right now.
  const tracker = config.market
    ? new MarketTracker({
        fetchCurves: fetchCurves ?? (config.source === 'demo' ? demoCurveFetcher({ now }) : rpcCurveFetcher({ rpcUrl: config.holder.rpcUrl })),
        now,
        log,
        pollMs: config.marketPollMs,
      })
    : null;
  const solPrice = new SolPrice({ fetchImpl: solPriceFetch ?? fetch, log });
  const market = tracker
    ? {
        lead: (launches) => tracker.leader(launches),
        trading: (launches) => tracker.ranked(launches, 5),
        view: (mint) => tracker.view(mint),
        solUsd: () => solPrice.value,
      }
    : null;

  const hub = new Hub({ store, access, config, log, serverInfo, market });

  let source = null;
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

  const server = http.createServer(handler);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  hub.attach(wss);

  let tick = null;
  let marketTick = null;
  return {
    config,
    store,
    hub,
    access,
    server,
    status,
    tracker,
    solPrice,
    setSource(s) {
      source = s;
    },
    ingest(raw) {
      const launch = store.add(raw);
      if (launch) {
        tracker?.track(launch);
        hub.broadcastLaunch(launch);
      }
      return launch;
    },
    // Hands launches restored from disk to the tracker.
    trackStored() {
      if (tracker) for (const launch of store.launches()) tracker.track(launch);
    },
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ port, host: host || undefined }, () => {
          server.off('error', reject);
          tick = setInterval(() => hub.tick(), config.snapshotMs);
          hub.startRevalidation();
          if (tracker) {
            tracker.poll();
            marketTick = setInterval(() => tracker.poll(), 3000);
          }
          if (tracker && config.solPrice) solPrice.start();
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(tick);
      clearInterval(marketTick);
      solPrice.stop();
      hub.stop();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
