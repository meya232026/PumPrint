// The Chameleonscope engine (vendor/chameleonscope/src, unchanged) in its own vm context, so
// nothing leaks into the host's globals. Every timer it starts is tracked, so stop() really stops it.
//
// The engine was written for a browser. Here it gets: an in-memory localStorage (saved to a file),
// a fetch that sends a browser user agent and paces the Solana RPC, and, for pump.fun's stream, a
// stand-in socket fed from the site's single PumpPortal connection (Moth's), because PumpPortal
// asks for one connection per address.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// build.py's order, minus the page-only files (app_account, app_ui, app_bottab, app_portal, app_gate)
export const ENGINE_FILES = ['demo_logos.js', 'demo_data.js', 'app_core.js', 'app_calls.js', 'demo_flow.js', 'app_sources.js', 'app_quantum.js', 'app_gmgn.js', 'app_xray.js', 'app_smart.js', 'app_known.js'];
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SOLANA_RPC_DEFAULT = 'https://solana-rpc.publicnode.com';

/** A fetch that adds a browser user agent and lets at most `rps` requests a second reach `rpcHost`. */
function pacedFetch(base, { rpcUrl, rps = 4, maxQueue = 300 }) {
  let host = '';
  try {
    host = new URL(rpcUrl).host;
  } catch {
    host = '';
  }
  const gap = 1000 / Math.max(0.5, rps);
  let chain = Promise.resolve();
  let last = 0;
  let queued = 0;
  return async function fetchImpl(input, init = {}) {
    const url = typeof input === 'string' ? input : input && input.url;
    const headers = new Headers(init.headers || (typeof input === 'object' && input.headers) || {});
    if (!headers.has('user-agent')) headers.set('user-agent', BROWSER_UA);
    const opts = { ...init, headers };
    let h = '';
    try {
      h = new URL(url).host;
    } catch {
      h = '';
    }
    if (!host || h !== host) return base(url, opts);
    if (queued >= maxQueue) throw new Error('rpc queue full');
    queued++;
    const turn = chain.then(async () => {
      const wait = last + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = turn.catch(() => {});
    try {
      await turn;
    } finally {
      queued--;
    }
    return base(url, opts);
  };
}

/** A WebSocket stand-in: open at once, sends go nowhere, messages arrive through deliver(). */
export function createFeedSocketClass() {
  const sockets = new Set();
  class FeedSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      sockets.add(this);
      setTimeout(() => {
        this.readyState = 1;
        if (typeof this.onopen === 'function') this.onopen({});
      }, 0);
    }
    send() {}
    close() {
      this.readyState = 3;
      sockets.delete(this);
      if (typeof this.onclose === 'function') this.onclose({ code: 1000 });
    }
    addEventListener(type, fn) {
      this[`on${type}`] = fn;
    }
    removeEventListener() {}
  }
  FeedSocket.CONNECTING = 0;
  FeedSocket.OPEN = 1;
  FeedSocket.CLOSING = 2;
  FeedSocket.CLOSED = 3;
  return {
    FeedSocket,
    deliver(text) {
      for (const s of sockets) if (s.readyState === 1 && typeof s.onmessage === 'function') s.onmessage({ data: text });
    },
  };
}

export function createChameleonEngine(opts = {}) {
  const src = opts.src;
  const mode = opts.mode === 'live' ? 'live' : 'demo';
  const timeouts = new Set();
  const intervals = new Set();
  const T = {
    setTimeout: (fn, ms, ...a) => {
      const h = setTimeout(() => {
        timeouts.delete(h);
        fn(...a);
      }, ms);
      timeouts.add(h);
      return h;
    },
    clearTimeout: (h) => {
      timeouts.delete(h);
      clearTimeout(h);
    },
    setInterval: (fn, ms, ...a) => {
      const h = setInterval(fn, ms, ...a);
      intervals.add(h);
      return h;
    },
    clearInterval: (h) => {
      intervals.delete(h);
      clearInterval(h);
    },
  };

  // localStorage in memory, written to a file at most every 15 s
  const store = Object.create(null);
  if (opts.storageFile) {
    try {
      Object.assign(store, JSON.parse(fs.readFileSync(opts.storageFile, 'utf8')));
    } catch {
      /* first run */
    }
  }
  let dirty = false;
  let flushTimer = null;
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!dirty || !opts.storageFile) return;
    dirty = false;
    try {
      fs.writeFileSync(`${opts.storageFile}.tmp`, JSON.stringify(store));
      fs.renameSync(`${opts.storageFile}.tmp`, opts.storageFile);
    } catch {
      /* read-only disk */
    }
  };
  const persist = () => {
    if (!opts.storageFile) return;
    dirty = true;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 15000);
      flushTimer.unref?.();
    }
  };
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
      persist();
    },
    removeItem: (k) => {
      delete store[k];
      persist();
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
      persist();
    },
    key: (i) => Object.keys(store)[i] || null,
    get length() {
      return Object.keys(store).length;
    },
  };
  const keep = (k, v) => (v ? localStorage.setItem(k, v) : localStorage.removeItem(k));
  if (mode === 'live') {
    keep('tl.gmgnKey', opts.gmgnKey);
    keep('tl.gmgnProxy', '');
    if (opts.gmgnPlan) localStorage.setItem('tl.gmgnPlan', opts.gmgnPlan);
    keep('tl.solRpc', opts.solRpc);
    keep('tl.hoodRpc', opts.hoodRpc);
  }

  const noop = () => {};
  const fakeEl = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: '',
    innerHTML: '',
    hidden: false,
    remove: noop,
    focus: noop,
  });
  const search = mode === 'demo' ? '?mode=demo' : '';
  const baseFetch = opts.fetch || globalThis.fetch;
  const sandbox = {
    console: opts.console || console,
    ...T,
    setImmediate,
    queueMicrotask,
    structuredClone,
    fetch: mode === 'live' ? pacedFetch(baseFetch, { rpcUrl: opts.solRpc || SOLANA_RPC_DEFAULT, rps: opts.rpcRps || 4 }) : baseFetch,
    AbortController,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    atob,
    btoa,
    performance,
    localStorage,
    sessionStorage: localStorage,
    document: { hidden: false, visibilityState: 'visible', addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: fakeEl, body: fakeEl(), documentElement: fakeEl(), title: 'Chameleonscope' },
    location: { search, hash: '', href: `https://chameleon.local/${search}`, hostname: 'chameleon.local', origin: 'https://chameleon.local', pathname: '/', protocol: 'https:' },
    history: { pushState: noop, replaceState: noop, back: noop, forward: noop, length: 1, state: null },
    navigator: { userAgent: BROWSER_UA, language: 'en' },
    requestAnimationFrame: (fn) => T.setTimeout(fn, 16),
    cancelAnimationFrame: (h) => T.clearTimeout(h),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    // no Image: pictures are never raced on the server
  };
  // pump.fun's stream: the site's own connection (a stand-in socket), never a second one
  if (mode === 'live' && opts.WebSocket) sandbox.WebSocket = opts.WebSocket;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox, { name: 'chameleonscope' });
  for (const f of opts.files || ENGINE_FILES) {
    const file = path.join(src, f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  const TL = sandbox.TL;
  if (!TL || !TL.sources) throw new Error('the Chameleonscope engine did not load');
  // this server keeps its own journal, ranking and registry; nothing is read from the original site
  TL.CONFIG.callsFeed = '';
  TL.CONFIG.boardFeed = '';
  TL.CONFIG.knownFeed = '';
  TL.CONFIG.gmgnProxyDefault = '';
  TL.LAUNCHPADS = opts.launchpads === 'all' ? 'all' : 'pump';
  TL.LISTS_FAST = true;
  if (TL.xray) TL.xray._bound = true;

  // the little of the page the sources ask about: which tokens are on screen (none, so the
  // engine's 1.5-second fast lane stays off on a server)
  const chains = ['solana', 'robinhood'];
  const S = TL.sources;
  const st = TL.store;
  const state = { watch: {}, selected: null, page: null, topAge: 30, tab: 'trenches', group: 'new' };
  Object.defineProperty(state, 'net', {
    get() {
      return Math.floor(Date.now() / 5000) % 2 ? chains[1] : chains[0];
    },
  });
  TL.ui = {
    state,
    visibleIds: () => [],
    visible: () => [],
    offer() {},
    markDirty() {},
    scheduleRender() {},
    renderStatus() {},
    onStreamToken() {},
    logoArrived() {},
    invalidate() {},
    renderAll() {},
    route() {},
    scheduleStrips() {},
    tokenHref: (t) => `#/${t.chain === 'robinhood' ? 'hood' : 'sol'}/token/${encodeURIComponent(t.address)}`,
  };
  S.resolveLogos = () => Promise.resolve(0);
  S.preloadLogos = () => {};

  function startDemo() {
    // src/app_ui.js bootEngine() -> finish(null) for ?mode=demo, startDemoPulse() and seedDemo()
    const U = TL.util;
    for (const chain of chains) {
      st.chainMode[chain] = 'demo';
      for (const t of TL.loadDemo(chain)) {
        st.tokens[t.id] = t;
        st.index(t);
      }
      st._list = null;
      st._rev = (st._rev || 0) + 1;
    }
    st.mode = 'demo';
    TL.demoFlow.start();
    st._booted = true;
    st.recompute();
    T.setInterval(() => {
      const all = st.all();
      if (!all.length) return;
      for (let i = 0; i < 6; i++) {
        const t = all[Math.floor(Math.random() * all.length)];
        if (t.stage === 'dead') continue;
        if (U.isNum(t.chg.m5)) t.chg.m5 = U.clamp(t.chg.m5 + (Math.random() - 0.5) * 6, -60, 120);
        if (t.tx.m5) {
          if (Math.random() > 0.5) t.tx.m5.b += 1;
          else if (Math.random() > 0.6) t.tx.m5.s += 1;
        }
        if (U.isNum(t.vol.m5)) t.vol.m5 = Math.max(0, t.vol.m5 * (0.95 + Math.random() * 0.12));
      }
      st.recompute();
    }, 9000);
    TL.calls.seedDemo();
  }

  async function startLive(o = {}) {
    // server/feed/engine.js bootLive() and feed.js's start sequence, plus the radar
    st.mode = 'boot';
    let flags = null;
    try {
      flags = await Promise.race([S.cycle(), new Promise((r) => T.setTimeout(() => r('timeout'), TL.CONFIG.bootTimeout || 12000))]);
    } catch {
      /* sources down */
    }
    const live = flags && flags !== 'timeout' ? flags : { solana: st.chainMode.solana === 'live', robinhood: st.chainMode.robinhood === 'live' };
    for (const c of chains) st.chainMode[c] = live[c] ? 'live' : 'offline';
    st.mode = 'live';
    st._booted = true;
    st.recompute();
    S.start();
    if (TL.gmgn && o.gmgnSlow) TL.gmgn.slow = o.gmgnSlow;
    TL.calls.start({ ms: 10000 });
    if (TL.known) {
      TL.known.canRefresh = true;
      TL.known.start();
    }
    if (TL.quantum) TL.quantum.start();
    return live;
  }

  return {
    TL,
    flush,
    mode,
    start: (o) => (mode === 'demo' ? (startDemo(), Promise.resolve({ demo: true })) : startLive(o)),
    stop() {
      for (const h of intervals) clearInterval(h);
      for (const h of timeouts) clearTimeout(h);
      intervals.clear();
      timeouts.clear();
      try {
        if (S.ws) S.ws.close();
      } catch {
        /* closed */
      }
      flush();
    },
  };
}
