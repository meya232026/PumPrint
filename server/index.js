#!/usr/bin/env node
// Pumprint site server: the website and its six tools (Kolibri Search, Moth Radar, Chameleonscope,
// Loxley, Canary, Fomo Radar) in one process.
// Node 22.13 or newer, no npm install needed.
//
//   npm start        live data (pump.fun launches, Telegram channels, real prices)
//   npm run demo     made-up data, works without internet

import http from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../vendor/moth/server/src/log.js';
import { createStatic } from './static.js';
import { createMoth } from './moth.js';
import { createKolibri } from './kolibri.js';
import { createTrending } from './trending.js';
import { createFomo } from './fomo/index.js';
import { createChameleon } from './chameleon/index.js';
import { createCanary } from './canary/index.js';
import { createLoxley } from './loxley/index.js';
import { createHoodRpc, HOOD_RPC } from './hood/rpc.js';
import { createPumpTee } from './pumptee.js';
import { HttpError, sendJson } from './util.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = process.env;
const demo = process.argv.includes('--demo') || env.DEMO === '1';
const port = Number(env.PORT || 8080);
const host = env.HOST || '';
const dataDir = env.DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url));
const trustProxy = env.TRUST_PROXY !== '0';
const log = createLogger(env.LOG_LEVEL || 'info');
mkdirSync(dataDir, { recursive: true });

const require = createRequire(import.meta.url);
const demoWorld = demo ? require('./demo-world.cjs').createDemoWorld(Date.now()) : null;

const statics = createStatic(fileURLToPath(new URL('../public/', import.meta.url)), { cacheFiles: env.NODE_ENV !== 'development' });
const trending = createTrending({ log, offline: demo });
const server = http.createServer((req, res) => {
  route(req, res).catch((err) => fail(res, err));
});

const pumpTee = demo ? null : createPumpTee();
const moth = await createMoth({ server, prefix: '/moth', dataDir, demo, env, log, WebSocketImpl: pumpTee && pumpTee.WebSocketImpl });
const kolibri = createKolibri({ prefix: '/kolibri', dataDir, demo: demoWorld, env, log, trustProxy });
// One queue to Robinhood Chain for every tool that reads it (Fomo Radar, Canary, Loxley): the public node
// rate-limits per client, so the tools share one budget instead of competing for it.
const hood = demo
  ? null
  : createHoodRpc({ url: env.HOOD_RPC_URL || HOOD_RPC, spares: String(env.HOOD_RPC_SPARES || '').split(',').map((s) => s.trim()).filter(Boolean), log });
const fomo = createFomo({ dataDir, demo, env, log, rpc: hood });
const chameleon = createChameleon({ dataDir, demo, env, log, pumpTee });
const canary = createCanary({ dataDir, demo, env, log, rpc: hood, trustProxy });
const loxley = await createLoxley({ dataDir, demo, env, log, rpc: hood, trustProxy });
if (demoWorld) {
  // Demo mode: read the made-up callers once so the leaderboard is full.
  (async () => {
    for (const c of demoWorld.callers) {
      try {
        await kolibri.engine.lookup(c.platform === 'x' ? `x.com/${c.handle}` : `t.me/${c.handle}`, c.platform);
      } catch (err) {
        log.warn(`demo caller ${c.handle}: ${err.message}`);
      }
    }
  })();
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;

  if (p === '/moth' || p.startsWith('/moth/')) return moth.handle(req, res);
  if (p === '/kolibri' || p.startsWith('/kolibri/')) return kolibri.handleApi(req, res);
  if (p.startsWith('/api/kolibri/')) return kolibri.handleSite(req, res, url);
  if (p.startsWith('/api/fomo/')) return fomo.handle(req, res, url);
  if (p.startsWith('/api/chameleon/')) return chameleon.handle(req, res, url);
  if (p.startsWith('/api/canary/')) return canary.handle(req, res, url);
  if (p.startsWith('/api/loxley/')) return loxley.handle(req, res, url);

  if (req.method === 'GET' && p === '/api/site') {
    return sendJson(res, 200, {
      mode: 'server',
      demo,
      moth: moth.info(),
      kolibri: kolibri.info(),
      fomo: fomo.info(),
      chameleon: chameleon.info(),
      canary: canary.info(),
      loxley: loxley.info(),
    });
  }
  if (req.method === 'GET' && p === '/api/trending') return sendJson(res, 200, await trending.get(), { 'cache-control': 'public, max-age=60' });
  if (req.method === 'GET' && p === '/api/icon') return trending.icon(req, res, url);
  if (req.method === 'GET' && p === '/health') return sendJson(res, 200, { ok: true });
  // The Moth status page asks for its icon and font from the server root.
  if (req.method === 'GET' && (p === '/static/moth.svg' || p === '/static/fraunces-600.woff2')) {
    req.url = `/moth${req.url}`;
    return moth.handle(req, res);
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await statics(req, res, p)) return undefined;
    if (!p.startsWith('/api/') && !/\.[a-z0-9]{2,5}$/i.test(p)) {
      // Unknown page paths get the site itself.
      if (await statics(req, res, '/index.html')) return undefined;
    }
  }
  throw new HttpError(404, 'not_found', 'Nothing here.');
}

function fail(res, err) {
  const status = err instanceof HttpError ? err.status : err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) log.error('request failed', { error: err.message });
  if (res.headersSent) return res.end();
  sendJson(res, status, { error: err.code || 'error', message: status >= 500 ? 'Something broke on the server.' : err.message });
}

server.on('clientError', (err, socket) => socket.destroy());
server.listen({ port, host: host || undefined }, () => {
  log.info(`Pumprint is listening on http://localhost:${port}${demo ? ' (demo data)' : ''}`);
  log.info(`  Moth Radar API:     /moth (WebSocket /moth/ws), source: ${moth.info().source}`);
  const x = kolibri.info().x;
  log.info(`  Kolibri Search API: /api/kolibri, X profiles: ${x === 'twitterapi' ? 'twitterapi.io' : x === 'xapi' ? 'X API' : 'off (post links and Telegram still work)'}${kolibri.hasNetwork() ? ', network server: /kolibri/v1' : ''}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') log.error(`Port ${port} is taken. Set another PORT in .env.`);
  else log.error(`server error: ${err.message}`);
  process.exit(1);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  log.info(`${signal} received, shutting down`);
  setTimeout(() => process.exit(0), 4000).unref();
  try {
    await moth.close();
  } catch (err) {
    log.warn(`moth close: ${err.message}`);
  }
  kolibri.close();
  fomo.close();
  chameleon.close();
  canary.close();
  try {
    await loxley.close();
  } catch (err) {
    log.warn(`loxley close: ${err.message}`);
  }
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
