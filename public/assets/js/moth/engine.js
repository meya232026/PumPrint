// Moth without a server: the same counting code runs in the browser and answers
// with the same messages the Moth server sends over its WebSocket.
//   kind 'live'  reads new pump.fun launches straight from PumpPortal and the
//                bonding curves from a public Solana RPC
//   kind 'demo'  made-up launches and a made-up market (Moth's demo generator)

import { LaunchStore, publicLaunch } from './lib/store.js';
import { startDemo } from './lib/demo-source.js';
import { startPumpPortal } from './lib/pumpportal.js';
import { MarketTracker } from './lib/tracker.js';
import { demoCurveFetcher } from './lib/demo-market.js';
import { rpcCurveFetcher } from './lib/curve-lite.js';
import { SolPrice } from './lib/solprice.js';

export const WINDOWS = [5, 15, 60];
const PUMPPORTAL = 'wss://pumpportal.fun/api/data';
const RPC = 'https://api.mainnet-beta.solana.com';
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

export class LocalFeed {
  constructor({ kind, onMessage, onState, rpcUrl = RPC }) {
    this.kind = kind;
    this.onMessage = onMessage;
    this.onState = onState;
    this.rpcUrl = rpcUrl;
    this.window = kind === 'live' ? 15 : 60;
    this.feed = true;
    this.timers = [];
    this.source = null;
    this.ready = false;
  }

  start() {
    const store = new LaunchStore({ maxWindowMin: Math.max(...WINDOWS) });
    this.store = store;
    this.tracker = new MarketTracker({
      fetchCurves: this.kind === 'demo' ? demoCurveFetcher() : rpcCurveFetcher({ rpcUrl: this.rpcUrl }),
      log: quiet,
      pollMs: 15_000,
    });
    this.solPrice = new SolPrice({ log: quiet });
    const tracker = this.tracker;
    this.market = {
      lead: (launches) => tracker.leader(launches),
      trading: (launches) => tracker.ranked(launches, 5),
      view: (mint) => tracker.view(mint),
      solUsd: () => this.solPrice.value,
    };
    const ingest = (raw) => {
      const launch = store.add(raw);
      if (!launch) return;
      tracker.track(launch);
      if (this.ready && this.feed) this.onMessage({ type: 'launch', ...publicLaunch(launch), words: launch.words });
    };
    if (this.kind === 'demo') {
      this.source = startDemo({ onLaunch: ingest, rate: 40, backfillMin: 2 * Math.max(...WINDOWS) + 5, log: quiet });
      store.coverageStart = this.source.status.backfilledFrom;
      this.onState('open');
      this.welcome();
    } else {
      this.onState('connecting');
      this.source = startPumpPortal({ url: PUMPPORTAL, onLaunch: ingest, log: quiet });
      this.solPrice.start();
      let opened = false;
      this.timers.push(
        setInterval(() => {
          const up = Boolean(this.source.status.connected);
          if (up && !opened) {
            opened = true;
            store.coverageStart = Date.now();
            this.onState('open');
            this.welcome();
          } else if (!up && opened) {
            opened = false;
            this.onState('connecting');
          }
        }, 500),
      );
    }
    this.timers.push(setInterval(() => this.ready && this.snapshot(), 3000));
    this.timers.push(setInterval(() => tracker.poll(), 3000));
    // The first market read fills in the "trading now" lines; show them right away.
    tracker.poll().then(() => this.ready && this.snapshot());
  }

  // True once the live stream has connected at least once.
  get connected() {
    return Boolean(this.source && this.source.status && (this.source.status.connected || this.source.status.events > 0));
  }

  welcome() {
    this.ready = true;
    this.onMessage({
      type: 'welcome',
      server: { name: 'Moth', version: '0.2.0', source: this.kind === 'demo' ? 'demo' : 'browser' },
      holderMode: false,
      holder: null,
      windows: WINDOWS,
      freeWindows: WINDOWS,
      tier: 'pro',
      keyStatus: 'none',
      wallet: null,
      balance: null,
      allowed: WINDOWS,
      alerts: true,
      window: this.window,
      deniedWindow: null,
      recent: this.store.recent(25),
    });
    this.snapshot();
  }

  snapshot() {
    this.onMessage({ type: 'snapshot', ...this.store.snapshot(this.window, { top: 60, minCount: 2, market: this.market }) });
  }

  send(msg) {
    switch (msg && msg.type) {
      case 'window':
        if (WINDOWS.includes(msg.window)) {
          this.window = msg.window;
          this.snapshot();
        }
        return true;
      case 'word': {
        const word = String(msg.word || '').toLowerCase().trim().slice(0, 48);
        if (word) this.onMessage({ type: 'word', ...this.store.details(word, WINDOWS.includes(msg.window) ? msg.window : this.window, { market: this.market }) });
        return true;
      }
      case 'feed':
        this.feed = msg.on !== false;
        return true;
      default:
        return true;
    }
  }

  retryNow() {
    if (this.kind === 'live') {
      this.stop();
      this.start();
    }
  }

  restart() {
    this.retryNow();
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.source?.stop();
    this.solPrice?.stop();
    this.ready = false;
  }
}

// A demo store that only answers snapshots (used by the small preview on the About page).
export async function createDemoFeed() {
  const store = new LaunchStore({ maxWindowMin: 60 });
  const source = startDemo({
    onLaunch: (raw) => store.add(raw),
    rate: 40,
    backfillMin: 125,
    log: quiet,
  });
  store.coverageStart = source.status.backfilledFrom;
  return {
    snapshot: (w) => store.snapshot(w, { top: 20, minCount: 2 }),
    stop: () => source.stop(),
  };
}
