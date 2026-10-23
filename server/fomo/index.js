// Fomo Radar on the site: GET /api/fomo/live. The archive itself ships with the page.
//
//   live   reads the archived roster's wallets on Robinhood Chain (free public RPC) and
//          GeckoTerminal for pools; needs no key. FOMO=0 turns it off.
//   demo   a made-up chain with invented wallets and tokens (server/fomo/demo.js), the last day
//          replayed at start so the page has history.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHoodRpc, HOOD_RPC } from '../hood/rpc.js';
import { HttpError, sendJson } from '../util.js';
import { createFomoStore } from './store.js';
import { createRadar, createTelegram, fomoConfig } from './radar.js';
import { createLiveChain, createEthPrice } from './chain.js';
import { createGecko } from './gecko.js';
import { createFomoDemo } from './demo.js';

const NOISE = '0x8f10b468b06c6fd214b65f87778827f7d113f996';

/** The archived roster: every Robinhood wallet the project judged, minus the one it found to be noise. */
export function loadRoster() {
  const csv = readFileSync(fileURLToPath(new URL('../../vendor/fomo/archive/traders.csv', import.meta.url)), 'utf8');
  const lines = csv.split('\n');
  const head = lines.shift().split(',');
  const col = (name) => head.indexOf(name);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // the first five columns are never quoted: address, chain, handle, score, status
    const cells = line.split(',', 5);
    const address = cells[col('address')].toLowerCase();
    if (cells[col('chain')] !== 'robinhood' || address === NOISE || !/^0x[0-9a-f]{40}$/.test(address)) continue;
    out.push({ address, handle: cells[col('fomo_handle')], score: Number(cells[col('score')]) || 0, status: cells[col('status')] });
  }
  return out;
}

export function createFomo({ dataDir, demo = false, env = process.env, log, fetchImpl = fetch, rpc: sharedRpc = null }) {
  const cfg = fomoConfig(env);
  if (!demo && env.FOMO === '0') {
    return { info: () => ({ on: false }), async handle() { throw new HttpError(404, 'off', 'Fomo Radar is off on this site (FOMO=0).'); }, close() {} };
  }
  let virtualNow = null;
  const clock = () => virtualNow ?? Math.floor(Date.now() / 1000);
  const store = createFomoStore(demo ? ':memory:' : env.FOMO_DB_PATH || join(dataDir, 'fomo.db'), cfg);

  let chain;
  let gecko;
  let eth;
  let world = null;
  if (demo) {
    world = createFomoDemo({ clock });
    store.loadRoster(world.roster);
    chain = world.chain;
    gecko = world.gecko;
    eth = { get: world.ethPrice, refresh: async () => world.ethPrice() };
    cfg.backfillHours = 30;
  } else {
    store.loadRoster(loadRoster());
    // the site's one Robinhood Chain queue when it passes one (server/index.js), else a queue of its own
    const rpc = sharedRpc || createHoodRpc({
      url: env.HOOD_RPC_URL || HOOD_RPC,
      spares: String(env.HOOD_RPC_SPARES || '').split(',').map((s) => s.trim()).filter(Boolean),
      fetchImpl,
      log,
    });
    eth = createEthPrice({ fetchImpl, log });
    chain = createLiveChain({ rpc, log, ethPrice: () => eth.get() });
    gecko = createGecko({ fetchImpl, rpm: Number(env.FOMO_GECKO_RPM || 6), log });
  }
  const telegram = demo ? null : createTelegram({ token: env.FOMO_TELEGRAM_BOT_TOKEN, chatId: env.FOMO_TELEGRAM_CHAT_ID, siteUrl: env.SITE_URL || '', fetchImpl, log });
  const radar = createRadar({ store, chain, gecko, cfg, log, clock, telegram, ethPrice: () => eth.get(), mode: demo ? 'demo' : 'live' });

  let ready = (async () => {
    await eth.refresh();
    if (demo) {
      // Read the made-up day, then replay it minute by minute so the page has a history.
      await radar.backfill();
      const end = clock();
      for (let t = end - 24 * 3600; t <= end; t += 60) {
        virtualNow = t;
        await radar.bursts(t, { replay: true });
        await radar.followups(t, { graceS: 24 * 3600 });
      }
      virtualNow = null;
      store.setMeta('live_since', end - 24 * 3600);
    }
    await radar.start();
  })().catch((err) => log.warn(`fomo start: ${err.message}`));
  const ethTimer = demo ? null : setInterval(() => eth.refresh(), 600_000);

  let cache = { at: 0, body: null };
  async function handle(req, res, url) {
    const p = url.pathname.replace(/\/+$/, '');
    if (req.method === 'GET' && p === '/api/fomo/live') {
      if (!cache.body || Date.now() - cache.at > 4000) cache = { at: Date.now(), body: radar.snapshot() };
      return sendJson(res, 200, cache.body);
    }
    throw new HttpError(404, 'not_found', 'Unknown Fomo Radar endpoint.');
  }

  return {
    radar,
    store,
    ready: () => ready,
    info: () => ({ on: true, mode: demo ? 'demo' : 'live', status: radar.state.status, roster: store.rosterCounts() }),
    handle,
    close() {
      radar.stop();
      if (ethTimer) clearInterval(ethTimer);
      store.close();
    },
  };
}
