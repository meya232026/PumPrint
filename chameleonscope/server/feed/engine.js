/* Chameleon site feed engine (v2.11): the terminal's own code (app_core, app_calls, app_sources, app_gmgn, app_xray, app_smart,
   app_known from the site's src/) running headless in Node. Nothing is re-implemented here: the journal, the ranking and the registry
   the site's service publishes come from exactly the code the page runs. Node 22+ (global fetch, WebSocket, crypto.subtle). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const FILES = ['app_core.js', 'app_calls.js', 'app_sources.js', 'app_gmgn.js', 'app_xray.js', 'app_smart.js', 'app_known.js'];

function installBrowserShims(opts) {
  const g = globalThis;
  const storage = Object.create(null);
  if (opts.storageFile) { try { Object.assign(storage, JSON.parse(fs.readFileSync(opts.storageFile, 'utf8'))); } catch (e) { /* first run */ } }
  // v2.11: the page's storage is written to disk at most once every 15 s (and when the process stops), not on every write. Until 2.11
  // each write of any key (the call journal, the token cache, a wallet's record, the registry) wrote the whole file at once, several
  // megabytes, a few times a second while the engine ran: the process spent its time writing and answered nothing else
  let dirty = false, flushTimer = null;
  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (!dirty || !opts.storageFile) return; dirty = false;
    try { fs.writeFileSync(opts.storageFile + '.tmp', JSON.stringify(storage)); fs.renameSync(opts.storageFile + '.tmp', opts.storageFile); } catch (e) { /* read-only disk: the cache is a convenience */ }
  };
  const persist = () => { if (!opts.storageFile) return; dirty = true; if (!flushTimer) { flushTimer = setTimeout(flush, opts.persistMs || 15000); if (flushTimer.unref) flushTimer.unref(); } };
  if (opts.storageFile) {
    process.on('exit', flush);
    for (const sig of ['SIGTERM', 'SIGINT']) if (!process.listenerCount(sig)) process.once(sig, () => { flush(); process.exit(0); });
  }
  g.window = g;
  g.localStorage = {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); persist(); },
    removeItem: k => { delete storage[k]; persist(); },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; persist(); },
    key: i => Object.keys(storage)[i] || null,
    get length() { return Object.keys(storage).length; }
  };
  const noop = () => {};
  const fakeEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, contains: () => false, toggle: noop }, setAttribute: noop, getAttribute: () => null, appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], textContent: '', innerHTML: '', hidden: false, remove: noop, focus: noop });
  g.document = { hidden: false, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: fakeEl, body: fakeEl(), documentElement: fakeEl(), title: 'Chameleon bot' };
  g.location = { search: opts.api ? '?api=' + opts.api : '', hash: '', href: 'https://chameleon.bot/', hostname: 'chameleon.bot', origin: 'https://chameleon.bot', pathname: '/', protocol: 'https:' };
  g.history = { pushState: noop, replaceState: noop, back: noop, forward: noop, length: 1, state: null };
  if (!g.navigator) g.navigator = { userAgent: 'chameleon-bot', language: 'en' };
  g.requestAnimationFrame = fn => setTimeout(fn, 16);
  g.cancelAnimationFrame = clearTimeout;
  g.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  g.Image = function () { return { set src(v) { /* no pictures on a server */ }, addEventListener: noop }; };
  if (typeof g.WebSocket !== 'function') throw new Error('Node 22 or newer is needed: this Node has no global WebSocket');
  if (typeof g.fetch !== 'function') throw new Error('Node 18 or newer is needed: this Node has no global fetch');
}

function loadTerminal(opts) {
  opts = opts || {};
  installBrowserShims(opts);
  // GMGN: a key or a proxy address given to this process is stored where the page would keep it
  // v2.11: the settings decide alone: a key, a proxy or a node that is no longer in them is taken out of the stored copy too (a cache
  // carried over from another service, or an old setting, never keeps one in use)
  const keep = (k, v) => { if (v) globalThis.localStorage.setItem(k, v); else globalThis.localStorage.removeItem(k); };
  keep('tl.gmgnKey', opts.gmgnKey); keep('tl.gmgnProxy', opts.gmgnProxy);
  if (opts.gmgnPlan) globalThis.localStorage.setItem('tl.gmgnPlan', opts.gmgnPlan);
  // v1.35: own RPC nodes (SOL_RPC / HOOD_RPC): stored where the page keeps them, app_core reads them first
  keep('tl.solRpc', opts.solRpc); keep('tl.hoodRpc', opts.hoodRpc);
  for (const f of FILES) {
    const file = path.join(SRC, f);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInThisContext(code, { filename: file });
  }
  const TL = globalThis.TL;
  if (!TL || !TL.sources) throw new Error('the terminal did not load: ' + Object.keys(globalThis.TL || {}).join(','));
  // v2.11: an engine on a server makes its own call journal, ranking and registry: it never follows a copy of them from elsewhere. The
  // site's address is written into the code (bot.<domain>/calls.json), and with the site's 2.10 code an engine that came back from a
  // slow start (the sources late, then live) would have turned into a follower of that journal and stopped making calls
  TL.CONFIG.callsFeed = ''; TL.CONFIG.boardFeed = ''; TL.CONFIG.knownFeed = '';
  TL.LAUNCHPADS = opts.launchpads === 'pump' ? 'pump' : 'all'; // v1.78: every launchpad unless told otherwise (FEED_LAUNCHPADS=pump)
  TL.LISTS_FAST = opts.fastLists !== false;                       // v1.78: Jupiter's newest / trending lists every 30 s even with GMGN as the main source
  const S = TL.sources, store = TL.store, U = TL.util;
  // a minimal ui: the sources ask it what is "on screen" (that is what gets the fast curve reads) and which network is looked at.
  // The engine looks at both networks, so the answer alternates every 5 s tick, and "on screen" means the newest live launches.
  const chains = opts.chains || ['solana', 'robinhood'];
  const state = { watch: {}, selected: null, page: null, topAge: 30, tab: 'trenches', group: 'new' };
  Object.defineProperty(state, 'net', { get() { if (chains.length === 1) return chains[0]; return Math.floor(Date.now() / 5000) % 2 ? 'robinhood' : 'solana'; } });
  TL.ui = {
    state,
    visibleIds() {
      const net = state.net, now = U.now();
      return store.all().filter(t => t.chain === net && !t.top && !t.demo && !t.partial && U.isNum(t.createdAt) && now - t.createdAt < 6 * TL.HR)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60).map(t => t.id);
    },
    visible() { return TL.ui.visibleIds().map(id => store.get(id)).filter(Boolean); },
    offer() {}, markDirty() {}, scheduleRender() {}, renderStatus() {}, onStreamToken() {}, logoArrived() {}, invalidate() {}, renderAll() {}, route() {},
    tokenHref(t) { return '#/' + (t.chain === 'robinhood' ? 'hood' : 'sol') + '/token/' + encodeURIComponent(t.address); }
  };
  S.resolveLogos = function () { return Promise.resolve(0); }; // a server shows no pictures: no picture fetching
  S.preloadLogos = function () {};
  return { TL, S, store, U };
}

// boot the way the page does: one full cycle of the sources, then the scheduler
async function bootLive(engine, log) {
  const { TL, S, store } = engine;
  store.mode = 'boot';
  let flags = null;
  try { flags = await Promise.race([S.cycle(), new Promise(res => setTimeout(() => res('timeout'), TL.CONFIG.bootTimeout || 12000))]); } catch (e) { log('boot cycle failed: ' + (e && e.message)); }
  const live = flags && flags !== 'timeout' ? flags : { solana: store.chainMode.solana === 'live', robinhood: store.chainMode.robinhood === 'live' };
  ['solana', 'robinhood'].forEach(c => { store.chainMode[c] = live[c] ? 'live' : 'offline'; });
  store.mode = 'live'; store._booted = true;
  store.recompute();
  S.start();
  return live;
}

module.exports = { loadTerminal, bootLive };
