// Kolibri Search on the site.
//   /api/kolibri/...   the website's search page (server/kol: X first, market cap at the
//                      call and 1m / 5m / 1h / 24h after it)
//   /kolibri/v1/...    optional: the original Kolibri network server (vendor/kolibri) for
//                      the Kolibri browser extension's network mode. KOLIBRI_NETWORK=1.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { HttpError, readJson, sendJson, stripPrefix, windowLimiter, clientIp } from './util.js';
import { createKolEngine, LookupError } from './kol/engine.js';
import { parseQuery } from './kol/sources.js';

const require = createRequire(import.meta.url);
const L = require('../vendor/kolibri/extension/shared/ledger.js');

export function cleanHandle(input) {
  return parseQuery(input).handle;
}

export function guessPlatform(input) {
  const s = String(input || '').toLowerCase();
  if (/(^|\/\/|\.)(x|twitter)\.com\//.test(s)) return 'x';
  if (/(^|\/\/)(t|telegram)\.me\//.test(s)) return 'tg';
  return null;
}

export function createKolibri({ prefix = '/kolibri', dataDir, demo = null, env = process.env, log, trustProxy = false }) {
  const engine = createKolEngine({ dataDir, env, log, fetchImpl: demo ? demo.fetchImpl : undefined, demo: Boolean(demo) });
  const allowLookup = windowLimiter(Number(env.KOLIBRI_LOOKUPS_PER_MINUTE || 12));

  // Accounts from TRACK (Telegram) and TRACK_X are read around the clock and fill the leaderboard.
  const list = (v) => String(v || '').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
  for (const h of list(env.TRACK)) engine.track('tg', h);
  for (const h of list(env.TRACK_X)) engine.track('x', h);
  engine.start();

  // The original Kolibri network server, only when asked for.
  let network = null;
  if (env.KOLIBRI_NETWORK === '1' && !demo) {
    const { loadConfig } = require('../vendor/kolibri/server/src/config.js');
    const { Store } = require('../vendor/kolibri/server/src/db.js');
    const { createApp } = require('../vendor/kolibri/server/src/core.js');
    const { createHandler } = require('../vendor/kolibri/server/src/http.js');
    const config = loadConfig({ ...env, DB_PATH: env.KOLIBRI_DB_PATH || join(dataDir, 'kolibri.db'), KOLS_FILE: join(dataDir, 'kols.json') });
    const store = new Store(config.dbPath);
    const app = createApp({ config, store, log: { warn: (...a) => log.warn(a.join(' ')), info: (...a) => log.info(a.join(' ')), log: (...a) => log.info(a.join(' ')), error: (...a) => log.error(a.join(' ')) } });
    for (const h of config.track) {
      try {
        app.track('tg', h);
      } catch {
        /* bad handle */
      }
    }
    if (config.workers) app.start();
    network = { app, store, handler: createHandler(app, config) };
  }

  async function handleSite(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (req.method === 'POST' && path === '/api/kolibri/lookup') {
        const ip = clientIp(req, trustProxy);
        if (!allowLookup(ip)) throw new HttpError(429, 'slow_down', 'Too many lookups from your address. Wait a minute.');
        const body = await readJson(req);
        const raw = String(body.query ?? body.handle ?? '');
        const platform = body.platform === 'x' || body.platform === 'tg' ? body.platform : guessPlatform(raw);
        const found = await engine.lookup(raw, platform);
        return sendJson(res, 200, { ...found, ...(engine.card(found.key) || { collecting: true, card: null }) });
      }
      if (req.method === 'GET' && path === '/api/kolibri/card') {
        const platform = url.searchParams.get('platform');
        const handle = String(url.searchParams.get('handle') || '').replace(/^@/, '');
        if ((platform !== 'x' && platform !== 'tg') || !/^[A-Za-z0-9_]{1,32}$/.test(handle)) {
          throw new HttpError(400, 'bad_request', 'Pass platform=x|tg and handle.');
        }
        const out = engine.card(L.authorKey(platform, handle));
        if (!out) throw new HttpError(404, 'not_found', 'Nothing read for this account yet.');
        return sendJson(res, 200, out);
      }
      if (req.method === 'GET' && path === '/api/kolibri/leaderboard') {
        const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
        return sendJson(res, 200, { items: engine.leaderboard(url.searchParams.get('platform'), limit), stats: engine.store.stats() });
      }
    } catch (err) {
      if (err instanceof LookupError) throw new HttpError(err.status, err.code, err.message);
      throw err;
    }
    throw new HttpError(404, 'not_found', 'Unknown Kolibri endpoint.');
  }

  return {
    engine,
    info: () => ({ ...engine.info(), network: Boolean(network) }),
    hasNetwork: () => Boolean(network),
    async handleApi(req, res) {
      if (!network) throw new HttpError(404, 'not_found', 'The Kolibri network server is off on this site (KOLIBRI_NETWORK=1 turns it on).');
      const original = stripPrefix(req, prefix);
      try {
        await network.handler(req, res);
      } finally {
        req.url = original;
      }
    },
    handleSite,
    close() {
      engine.close();
      if (network) {
        network.app.stop();
        network.store.close();
      }
    },
  };
}
