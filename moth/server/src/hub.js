import { publicLaunch } from './store.js';
import { shortAddress } from './access.js';

const MAX_BUFFERED = 1024 * 1024;
const REVALIDATE_MS = 15 * 60_000;

// Talks to side panels over WebSocket.
//
// client -> server
//   { type: 'hello', key?, window?, feed? }   first message; key unlocks holder features
//   { type: 'window', window }                 switch the window (minutes)
//   { type: 'word', word, window? }            details for one word
//   { type: 'feed', on }                       live launch feed on/off
//   { type: 'ping' }
//
// server -> client
//   welcome   tier, allowed windows, holder info, recent launches
//   snapshot  top words for the client's window, every few seconds
//   launch    one new launch (when the feed is on)
//   word      details for one word
//   error     { code, message }
//   pong
export class Hub {
  constructor({ store, access, config, log, serverInfo, market = null }) {
    this.store = store;
    this.market = market;
    this.access = access;
    this.config = config;
    this.log = log;
    this.serverInfo = serverInfo;
    this.clients = new Set();
    this.cache = new Map();
    this.defaultWindow = Math.max(...config.freeWindows);
    this.revalidateTimer = null;
  }

  attach(wss) {
    wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  onConnection(ws) {
    const client = { ws, ready: false, tier: 'free', keyStatus: 'none', wallet: null, key: '', window: this.defaultWindow, feed: true };
    this.clients.add(client);
    // A client that never says hello still gets the free view.
    client.helloTimer = setTimeout(() => {
      if (!client.ready) this.hello(client, {}).catch((err) => this.log.error('hello failed', { error: err.message }));
    }, 4000);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(client, data).catch((err) => this.log.error('ws message failed', { error: err.message }));
    });
    ws.on('close', () => {
      clearTimeout(client.helloTimer);
      this.clients.delete(client);
    });
  }

  async onMessage(client, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return this.send(client, { type: 'error', code: 'bad_json', message: 'Messages must be JSON.' });
    }
    switch (msg?.type) {
      case 'hello':
        clearTimeout(client.helloTimer);
        return this.hello(client, msg);
      case 'window':
        return this.setWindow(client, Number(msg.window));
      case 'word':
        return this.sendWord(client, msg.word, Number(msg.window));
      case 'feed':
        client.feed = msg.on !== false;
        return;
      case 'ping':
        return this.send(client, { type: 'pong', t: Date.now() });
      default:
        return this.send(client, { type: 'error', code: 'unknown_type', message: `Unknown message type: ${msg?.type}` });
    }
  }

  async hello(client, msg) {
    client.key = typeof msg.key === 'string' ? msg.key.trim().slice(0, 1000) : '';
    client.feed = msg.feed !== false;
    await this.applyAccess(client, await this.access.resolve(client.key));
    const welcome = this.welcome(client, Number(msg.window));
    client.window = welcome.window;
    client.ready = true;
    this.send(client, welcome);
    if (welcome.deniedWindow) this.proRequired(client, welcome.deniedWindow);
    this.sendSnapshot(client);
  }

  // The first thing a panel gets, over WebSocket or from GET /api/welcome.
  // `who` is anything with tier, keyStatus, wallet and balance.
  welcome(who, wanted) {
    const allowed = this.access.allowedWindows(who.tier);
    const window = allowed.includes(wanted) ? wanted : this.defaultWindow;
    const denied = this.config.windows.includes(wanted) && wanted !== window ? wanted : null;
    return {
      type: 'welcome',
      ...this.serverInfo(),
      ...this.access.publicInfo(),
      ...this.tierInfo(who),
      window,
      deniedWindow: denied,
      recent: this.store.recent(25),
    };
  }

  async applyAccess(client, res) {
    client.tier = res.tier;
    client.keyStatus = res.keyStatus;
    client.wallet = res.wallet || null;
    client.balance = res.balance ?? null;
  }

  tierInfo(who) {
    return {
      tier: who.tier,
      keyStatus: who.keyStatus,
      wallet: shortAddress(who.wallet),
      balance: who.balance ?? null,
      allowed: this.access.allowedWindows(who.tier),
      alerts: this.access.canAlert(who.tier),
    };
  }

  setWindow(client, minutes) {
    if (!client.ready) return;
    if (!this.config.windows.includes(minutes)) {
      return this.send(client, { type: 'error', code: 'bad_window', message: `Window must be one of ${this.config.windows.join(', ')} minutes.` });
    }
    if (!this.access.allowedWindows(client.tier).includes(minutes)) return this.proRequired(client, minutes);
    client.window = minutes;
    this.sendSnapshot(client);
  }

  proRequired(client, minutes) {
    const holder = this.access.publicInfo().holder;
    this.send(client, {
      type: 'error',
      code: 'holder_required',
      window: minutes,
      message: `The ${minutes}m window is for $${holder?.symbol ?? 'token'} holders.`,
    });
  }

  sendWord(client, rawWord, minutes) {
    if (!client.ready) return;
    const word = String(rawWord ?? '').toLowerCase().trim().slice(0, 48);
    if (!word) return;
    const allowed = this.access.allowedWindows(client.tier);
    const win = allowed.includes(minutes) ? minutes : client.window;
    this.send(client, { type: 'word', ...this.store.details(word, win, { market: this.market }) });
  }

  sendSnapshot(client) {
    if (client.ready) this.sendRaw(client, this.snapshotJson(client.window));
  }

  snapshotJson(minutes) {
    const hit = this.cache.get(minutes);
    const now = Date.now();
    if (hit && now - hit.at < Math.max(500, this.config.snapshotMs - 250)) return hit.json;
    const snap = this.store.snapshot(minutes, { top: this.config.topN, minCount: this.config.minCount, market: this.market });
    const json = JSON.stringify({ type: 'snapshot', ...snap });
    this.cache.set(minutes, { at: now, json });
    return json;
  }

  invalidate() {
    this.cache.clear();
  }

  tick() {
    for (const client of this.clients) this.sendSnapshot(client);
  }

  broadcastLaunch(launch) {
    if (this.clients.size === 0) return;
    const json = JSON.stringify({ type: 'launch', ...publicLaunch(launch), words: launch.words });
    for (const client of this.clients) if (client.ready && client.feed) this.sendRaw(client, json);
  }

  // Holders who sold lose access within REVALIDATE_MS; new holders keep it.
  startRevalidation() {
    if (!this.access.holderMode) return;
    this.revalidateTimer = setInterval(() => this.revalidate().catch(() => {}), REVALIDATE_MS);
    this.revalidateTimer.unref();
  }

  async revalidate() {
    // One balance lookup per key per pass, even if that key is open in several browsers.
    const results = new Map();
    for (const client of this.clients) {
      if (!client.ready || !client.key) continue;
      const before = client.tier;
      if (!results.has(client.key)) results.set(client.key, await this.access.resolve(client.key, { fresh: true }));
      await this.applyAccess(client, results.get(client.key));
      if (client.tier === before) continue;
      if (!this.access.allowedWindows(client.tier).includes(client.window)) client.window = this.defaultWindow;
      this.send(client, { type: 'tier', ...this.tierInfo(client), window: client.window });
      this.sendSnapshot(client);
    }
  }

  stop() {
    clearInterval(this.revalidateTimer);
  }

  send(client, obj) {
    this.sendRaw(client, JSON.stringify(obj));
  }

  sendRaw(client, json) {
    const { ws } = client;
    if (ws.readyState !== 1) return;
    // A panel that can't keep up skips updates instead of growing the buffer.
    if (ws.bufferedAmount > MAX_BUFFERED) return;
    ws.send(json);
  }
}
