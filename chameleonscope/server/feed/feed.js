#!/usr/bin/env node
/* Chameleon site feed (v2.11): the site's own data service. What every visitor of chameleonscope.com shares comes from here:

     GET /calls.json    the call journal (the server makes the calls; every page follows the same list)
     GET /board.json    the Smart Tracking ranking of wallets (built every FEED_BOARD_EVERY minutes from GMGN)
     GET /known.json    the registry of known traders (KOLs, top wallets) and their buys of the day
     GET /health        how the service runs (from this server only)

   It runs the terminal's own engine (server/feed/engine.js loads the same src/ files the page uses), so a call here is exactly a call on
   the page. No accounts, no wallets, nothing written by a visitor: it only reads the chains and publishes what every page shows.

   Each answer is built at most once every few seconds and gzipped once, whatever the number of visitors. Reads of your own Solana node
   (SOL_RPC) go through one gate, FEED_RPC_RPS a second (4), so the node keeps room for anything else that shares it.

   Run:
     node server/feed/feed.js                        (systemd: chameleon-feed, settings in /etc/chameleon/site.env)
   Options (environment):
     FEED_PORT=8790  FEED_HOST=127.0.0.1             where it answers (the Cloudflare route bot.<domain> points at 8790)
     GMGN_PROXY=http://127.0.0.1:8788/gmgn           GMGN through the site's own proxy (one budget for the proxy and this service)
     GMGN_API_KEY=...  GMGN_PLAN=free                or GMGN directly
     SOL_RPC=https://...  HOOD_RPC=https://...       your own nodes (else the public ones)
     FEED_RPC_RPS=4                                  requests a second to SOL_RPC at most
     FEED_BOARD_EVERY=20                             minutes between two builds of the ranking (0 = never)
     FEED_CACHE=server/feed/engine_cache.json        the engine's storage (the journal survives a restart)
     TL_API=http://localhost:8787                    (tests: the mock data server instead of the real sources)
   Analytics only: it never holds a wallet, never trades, never asks for a key of any wallet. */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { loadTerminal, bootLive } = require('./engine.js');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const PORT = +(process.env.FEED_PORT || 8790);
const HOST = process.env.FEED_HOST || '127.0.0.1';
const CACHE_FILE = process.env.FEED_CACHE || path.join(__dirname, 'engine_cache.json');
const STARTED_AT = Date.now();

// ---------- your own Solana node: one gate for the whole service ----------
const GATE = { url: String(process.env.SOL_RPC || '').trim(), host: '', path: '', gapMs: Math.max(20, Math.round(1000 / Math.max(1, +(process.env.FEED_RPC_RPS || 4)))), next: 0, q: [], busy: false, pausedUntil: 0, pauseMs: 0, maxQ: 300, n: 0, r429: 0 };
(() => { try { const a = new URL(GATE.url); GATE.host = a.host; GATE.path = a.pathname; } catch (e) { GATE.host = ''; } })();
const rawFetch = globalThis.fetch;
function isOwnNode(u) {
  if (!GATE.url) return false; const x = typeof u === 'string' ? u : String((u && u.url) || u || '');
  if (x === GATE.url) return true; if (!GATE.host || x.indexOf(GATE.host) < 0) return false;
  try { const a = new URL(x); return a.host === GATE.host && a.pathname === GATE.path; } catch (e) { return false; }
}
function gated(u, o) {
  const sig = o && o.signal;
  return new Promise((resolve, reject) => {
    const aborted = () => reject((sig && sig.reason) || Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    if (sig && sig.aborted) return aborted();
    if (GATE.q.length >= GATE.maxQ) return reject(new Error('the node is busy (the service keeps to its limit)'));
    const job = { u, o, resolve, reject };
    if (sig) sig.addEventListener('abort', () => { const i = GATE.q.indexOf(job); if (i >= 0) { GATE.q.splice(i, 1); aborted(); } }, { once: true });
    GATE.q.push(job); pump();
  });
}
function pump() {
  if (GATE.busy) return; GATE.busy = true;
  const step = () => {
    if (!GATE.q.length) { GATE.busy = false; return; }
    const now = Date.now(), at = Math.max(now, GATE.next, GATE.pausedUntil);
    if (at > now) { setTimeout(step, at - now); return; }
    const job = GATE.q.shift(); GATE.next = now + GATE.gapMs; GATE.n++;
    rawFetch(job.u, job.o).then(r => {
      if (r.status === 429) { GATE.r429++; const ra = +(r.headers.get('retry-after') || 0); GATE.pauseMs = Math.min(30000, GATE.pauseMs ? GATE.pauseMs * 2 : 1000); GATE.pausedUntil = Date.now() + Math.max(GATE.pauseMs, ra > 0 && ra < 120 ? ra * 1000 : 0); }
      else if (r.ok) GATE.pauseMs = 0;
      job.resolve(r);
    }, job.reject);
    setImmediate(step);
  };
  step();
}
if (GATE.url && typeof rawFetch === 'function') globalThis.fetch = function (u, o) { return isOwnNode(u) ? gated(u, o) : rawFetch(u, o); };

// ---------- the engine ----------
const engine = loadTerminal({ api: process.env.TL_API || '', gmgnKey: process.env.GMGN_API_KEY || '', gmgnPlan: process.env.GMGN_PLAN || '', gmgnProxy: process.env.GMGN_PROXY || '', solRpc: GATE.url, hoodRpc: (process.env.HOOD_RPC || '').trim(), storageFile: CACHE_FILE, launchpads: String(process.env.FEED_LAUNCHPADS || 'all').toLowerCase() === 'pump' ? 'pump' : 'all', fastLists: true });
const { TL, S, store } = engine;
const CL = TL.calls;
if (process.env.FEED_CALL_MIN_WATCH) CL.RULE.minWatch = 1000 * +process.env.FEED_CALL_MIN_WATCH; // seconds a token is watched before a call (tests shorten it)
if (TL.gmgn) TL.gmgn.slow = +(process.env.FEED_GMGN_SLOW || 3); // a third of a page's polling pace: one key for the proxy, this service and every visitor

// ---------- the ranking (GET /board.json) ----------
const BOARD = { everyMs: 60 * 1000 * +(process.env.FEED_BOARD_EVERY == null || process.env.FEED_BOARD_EVERY === '' ? 20 : process.env.FEED_BOARD_EVERY), data: { at: 0, boards: {} }, busy: false };
async function boardPass() {
  const SM = TL.smart, G = TL.gmgn;
  if (BOARD.busy || !SM || !G || !G.active() || !BOARD.everyMs) return;
  BOARD.busy = true;
  try {
    for (const chain of ['solana', 'robinhood']) for (const period of ['30d', '7d']) {
      try {
        const b = SM.build(chain, period, true); await b.promise;
        const out = SM.exportBoard(b);
        if (out.wallets.some(w => w.stats)) { BOARD.data.boards[chain + ':' + period] = out; log('board', chain, period, out.wallets.length, 'wallets,', out.wallets.filter(w => w.stats).length, 'records'); }
      } catch (e) { log('board', chain, period, 'failed:', e && e.message); }
    }
    BOARD.data.at = Date.now();
  } finally { BOARD.busy = false; }
}

// ---------- the answers: built at most every few seconds, gzipped once ----------
const ANSWER = {
  calls: { ttl: 5000, make: () => CL.export() },
  board: { ttl: 30000, make: () => BOARD.data },
  known: { ttl: 30000, make: () => (TL.known ? TL.known.export() : { v: 1, at: 0, wallets: [], trades: [] }) }
};
const served = { calls: 0, board: 0, known: 0 };
function answer(key) {
  const a = ANSWER[key], now = Date.now();
  if (!a.body || now - a.at > a.ttl) {
    let obj; try { obj = a.make(); } catch (e) { obj = { v: 1, at: 0, error: 'not ready' }; }
    a.body = Buffer.from(JSON.stringify(obj)); a.gz = a.body.length > 2048 ? zlib.gzipSync(a.body) : null; a.at = now;
  }
  return a;
}
function serve(req, res, key) {
  const a = answer(key); served[key]++;
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store');
  if (a.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.end(a.gz); return; }
  res.end(a.body);
}
function health() {
  return { ok: true, service: 'chameleon-feed', since: STARTED_AT, booted: !!store._booted, tokens: store.all().length, calls: CL.list.length,
    lastCall: CL.list.length ? Math.max.apply(null, CL.list.map(r => r.at || 0)) : null, gmgn: TL.gmgn && TL.gmgn.active() ? TL.gmgn.state : 'off',
    boardAt: BOARD.data.at, known: TL.known ? Object.keys(TL.known.list).length : 0, knownAt: TL.known ? TL.known.at : 0, served,
    node: GATE.url ? { rps: Math.round(1000 / GATE.gapMs), queue: GATE.q.length, asked: GATE.n, r429: GATE.r429 } : null, memoryMb: Math.round(process.memoryUsage().rss / 1048576) };
}
function serveHttp() {
  http.createServer((req, res) => {
    const u = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET'); res.statusCode = 204; res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end('GET only'); return; }
    if (u === '/calls.json') return serve(req, res, 'calls');
    if (u === '/board.json') return serve(req, res, 'board');
    if (u === '/known.json') return serve(req, res, 'known');
    if (u === '/health' && !req.headers['cf-connecting-ip']) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(health())); return; } // from this server only, never through the tunnel
    res.statusCode = 404; res.end('not found');
  }).listen(PORT, HOST, () => log('the site\'s data at http://' + HOST + ':' + PORT + ': /calls.json, /board.json, /known.json'))
    .on('error', e => { log('cannot listen on ' + HOST + ':' + PORT + ': ' + e.message + (e.code === 'EADDRINUSE' ? ' (another service has this port: stop it, or give this one another port with FEED_PORT)' : '')); process.exit(3); });
}

(async () => {
  log('Chameleon site feed starting' + (process.env.TL_API ? ' against ' + process.env.TL_API : '') + ', GMGN ' + (TL.gmgn && TL.gmgn.configured() ? (process.env.GMGN_PROXY ? 'through the proxy' : 'with a key') : 'off') + ', own Solana node ' + (GATE.url ? GATE.host + ' (' + Math.round(1000 / GATE.gapMs) + ' a second at most)' : 'none (public ones)'));
  serveHttp(); // the journal kept from the last run answers at once; the live one follows
  const live = await bootLive(engine, log);
  log('sources:', JSON.stringify(live), '| tokens:', store.all().length, '| calls kept:', CL.list.length, '| GMGN:', TL.gmgn && TL.gmgn.active() ? TL.gmgn.mode() : 'off');
  CL.start({ ms: 10 * 1000 }); // the calls: a pass every 10 s (the server makes them; it never follows a copy)
  CL.on('call', rec => log('CALL', rec.chain, rec.symbol, rec.kind || '', 'at', rec.mc ? '$' + Math.round(rec.mc) : '?', rec.gradWhy || ''));
  if (TL.known) { TL.known.canRefresh = true; TL.known.start(); }
  if (BOARD.everyMs) { setTimeout(() => boardPass().catch(e => log('board:', e.message)), 45 * 1000); setInterval(() => boardPass().catch(e => log('board:', e.message)), BOARD.everyMs); }
  setInterval(() => { const h = health(); log('alive:', h.tokens, 'tokens,', h.calls, 'calls,', 'served', JSON.stringify(h.served) + ',', h.memoryMb, 'MB'); served.calls = served.board = served.known = 0; }, 10 * 60 * 1000);
})().catch(e => { log('the feed failed to start:', e && e.stack || e); process.exit(1); });
