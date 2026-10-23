// Chameleonscope on the site: the terminal's engine (vendor/chameleonscope) running in a worker,
// read by the page through /api/chameleon/*.
//
//   live   pump.fun through the site's one PumpPortal connection, Solana RPC (SOLANA_RPC_URL,
//          paced to CHAMELEON_RPC_RPS a second), Jupiter, Robinhood Chain and Blockscout; GMGN
//          only with GMGN_API_KEY. CHAMELEON=0 turns it off.
//   demo   the terminal's own preview flow: invented launches, no network.

import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, sendJson } from '../util.js';

const SRC = fileURLToPath(new URL('../../vendor/chameleonscope/src', import.meta.url));
const CHAINS = new Set(['solana', 'robinhood']);
const GROUPS = new Set(['new', 'almost', 'graduated', 'top']);

export function createChameleon({ dataDir, demo = false, env = process.env, log, pumpTee = null }) {
  if (!demo && env.CHAMELEON === '0') {
    return { info: () => ({ on: false }), async handle() { throw new HttpError(404, 'off', 'Chameleonscope is off on this site (CHAMELEON=0).'); }, close() {} };
  }
  const workerData = {
    src: SRC,
    mode: demo ? 'demo' : 'live',
    gmgnKey: demo ? '' : env.GMGN_API_KEY || '',
    gmgnPlan: env.GMGN_PLAN || 'free',
    solRpc: demo ? '' : env.CHAMELEON_SOL_RPC || env.SOLANA_RPC_URL || '',
    hoodRpc: demo ? '' : env.HOOD_RPC_URL || '',
    rpcRps: Number(env.CHAMELEON_RPC_RPS || 4),
    storageFile: demo ? '' : join(dataDir, 'chameleon-engine.json'),
    pumpFeed: !demo && Boolean(pumpTee && pumpTee.WebSocketImpl),
    everyMs: 4000,
    rows: 30,
  };
  let worker = null;
  let snap = null;
  let started = null;
  let restarts = 0;
  let closing = false;
  let unlisten = null;
  const pending = new Map();
  let reqSeq = 0;

  function spawn() {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData, resourceLimits: { maxOldGenerationSizeMb: Number(env.CHAMELEON_MEMORY_MB || 512) } });
    worker.on('message', (m) => {
      if (m.type === 'snapshot') snap = m.data;
      else if (m.type === 'started') {
        started = Date.now();
        log.info(`chameleonscope: engine running (${workerData.mode}${workerData.gmgnKey ? ', GMGN on' : ''})`);
      } else if (m.type === 'detail') {
        const p = pending.get(m.req);
        if (p) {
          pending.delete(m.req);
          clearTimeout(p.timer);
          p.resolve(m.data);
        }
      }
    });
    worker.on('error', (err) => log.warn(`chameleonscope worker: ${err.message}`));
    worker.on('exit', (code) => {
      if (closing) return;
      restarts++;
      const wait = Math.min(300_000, 5000 * 2 ** Math.min(restarts, 6));
      log.warn(`chameleonscope worker stopped (code ${code}); restarting in ${Math.round(wait / 1000)}s`);
      setTimeout(() => !closing && spawn(), wait).unref();
    });
  }
  spawn();
  if (workerData.pumpFeed) unlisten = pumpTee.listen((text) => worker && worker.postMessage({ type: 'pump', data: text }));

  function detail(id) {
    return new Promise((resolve, reject) => {
      const req = ++reqSeq;
      const timer = setTimeout(() => {
        pending.delete(req);
        reject(new HttpError(504, 'busy', 'The terminal is busy. Try again in a moment.'));
      }, 6000);
      pending.set(req, { resolve, timer });
      worker.postMessage({ type: 'detail', id, req });
    });
  }

  const head = () => (snap ? { at: snap.at, mode: snap.mode, chainMode: snap.chainMode, demo } : null);

  async function handle(req, res, url) {
    const p = url.pathname.replace(/\/+$/, '');
    if (req.method !== 'GET') throw new HttpError(405, 'method', 'GET only.');
    if (!snap) return sendJson(res, 503, { error: 'starting', message: 'The terminal is starting. One moment.' });
    if (p === '/api/chameleon/feed') {
      const chain = url.searchParams.get('chain') || 'solana';
      const group = url.searchParams.get('group') || 'new';
      if (!CHAINS.has(chain) || !GROUPS.has(group)) throw new HttpError(400, 'bad_request', 'chain=solana|robinhood, group=new|almost|graduated|top');
      return sendJson(res, 200, { ...head(), chain, group, ...snap.feeds[chain][group] });
    }
    if (p === '/api/chameleon/side') {
      return sendJson(res, 200, { ...head(), sources: snap.sources, gmgn: snap.gmgn, solUsd: snap.solUsd, ethUsd: snap.ethUsd, radar: snap.radar, day: snap.day, calls: snap.calls, known: snap.known, counts: Object.fromEntries(Object.entries(snap.feeds).map(([c, f]) => [c, Object.fromEntries(Object.entries(f).map(([g, v]) => [g, v.total]))])) });
    }
    if (p === '/api/chameleon/token') {
      const id = String(url.searchParams.get('id') || '');
      if (!/^(solana|robinhood):[A-Za-z0-9-]{3,64}$/.test(id)) throw new HttpError(400, 'bad_request', 'Pass id=chain:address.');
      const d = await detail(id);
      if (!d) throw new HttpError(404, 'not_found', 'The terminal is not watching this token.');
      return sendJson(res, 200, d);
    }
    throw new HttpError(404, 'not_found', 'Unknown Chameleonscope endpoint.');
  }

  return {
    info: () => ({ on: true, mode: workerData.mode, running: Boolean(snap), gmgn: Boolean(snap && snap.gmgn), startedAt: started }),
    handle,
    close() {
      closing = true;
      if (unlisten) unlisten();
      if (worker) {
        worker.postMessage({ type: 'stop' });
        setTimeout(() => worker && worker.terminate(), 1500).unref();
      }
    },
  };
}
