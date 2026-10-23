// Connections to this site's Moth server (/moth). The WebSocket streams the
// leaderboard; if a browser or network blocks it, the same data is polled over HTTP.
// Ported from the Moth extension (lib/connection.js, lib/polling.js).

export class SocketConnection {
  constructor({ url, hello, onMessage, onState }) {
    this.url = url;
    this.hello = hello;
    this.onMessage = onMessage;
    this.onState = onState;
    this.ws = null;
    this.attempt = 0;
    this.stopped = false;
    this.retryTimer = null;
    this.pingTimer = null;
    this.everOpened = false;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  open() {
    clearTimeout(this.retryTimer);
    this.onState('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.onState('offline');
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempt = 0;
      this.everOpened = true;
      this.send({ type: 'hello', ...this.hello() });
      this.onState('open');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.stopped) return;
      this.onState('offline');
      this.scheduleRetry();
    };
  }

  scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(15_000, 1000 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 5);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  retryNow() {
    this.attempt = 0;
    if (this.ws) this.ws.close();
    else this.open();
  }

  restart() {
    this.attempt = 0;
    const old = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    if (old) old.close();
    this.open();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

const TIER_REFRESH_MS = 5 * 60_000;

export class PollingConnection {
  constructor({ base, hello, onMessage, onState, intervalMs = 3000 }) {
    this.base = base;
    this.hello = hello;
    this.onMessage = onMessage;
    this.onState = onState;
    this.intervalMs = intervalMs;
    this.key = '';
    this.window = 60;
    this.lastT = 0;
    this.tier = null;
    this.welcomeAt = 0;
    this.timer = null;
    this.retryTimer = null;
    this.attempt = 0;
    this.failures = 0;
    this.busy = false;
    this.again = false;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.open();
  }

  async open() {
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    this.onState('connecting');
    const h = this.hello();
    this.key = h.key || '';
    try {
      const welcome = await this.get(`/api/welcome?window=${encodeURIComponent(h.window)}`);
      if (this.stopped) return;
      this.acceptWelcome(welcome, true);
      this.attempt = 0;
      this.failures = 0;
      this.onState('open');
      await this.tick();
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    } catch {
      if (this.stopped) return;
      this.onState('offline');
      this.scheduleRetry();
    }
  }

  acceptWelcome(welcome, first) {
    this.window = welcome.window;
    this.welcomeAt = Date.now();
    if (first) {
      this.lastT = Math.max(0, ...(welcome.recent || []).map((l) => l.t));
      this.tier = welcome.tier;
      this.onMessage({ ...welcome, type: 'welcome' });
      if (welcome.deniedWindow) this.onMessage({ type: 'error', code: 'holder_required', window: welcome.deniedWindow });
      return;
    }
    if (welcome.tier !== this.tier) {
      this.tier = welcome.tier;
      this.onMessage({ ...welcome, type: 'tier' });
    }
  }

  async tick() {
    if (this.stopped) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      if (Date.now() - this.welcomeAt > TIER_REFRESH_MS) {
        this.acceptWelcome(await this.get(`/api/welcome?window=${this.window}`), false);
      }
      const snap = await this.get(`/api/snapshot?window=${this.window}`);
      if (this.stopped) return;
      this.onMessage({ ...snap, type: 'snapshot' });
      const { launches = [] } = await this.get(`/api/recent?after=${this.lastT}`);
      for (const launch of [...launches].reverse()) {
        this.lastT = Math.max(this.lastT, launch.t);
        this.onMessage({ ...launch, type: 'launch' });
      }
      if (this.failures) this.onState('open');
      this.failures = 0;
    } catch (err) {
      if (this.stopped) return;
      if (err.status === 402) {
        this.busy = false;
        return this.open();
      }
      this.failures++;
      if (this.failures >= 2) {
        clearInterval(this.timer);
        this.onState('offline');
        this.scheduleRetry();
      }
    } finally {
      this.busy = false;
    }
    if (this.again) {
      this.again = false;
      this.tick();
    }
  }

  send(msg) {
    if (this.stopped) return false;
    if (msg.type === 'window') {
      this.window = msg.window;
      this.tick();
    } else if (msg.type === 'word') {
      const win = msg.window || this.window;
      this.get(`/api/word?w=${encodeURIComponent(msg.word)}&window=${win}`)
        .then((d) => this.onMessage({ ...d, type: 'word' }))
        .catch(() => {});
    }
    return true;
  }

  async get(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(this.base + path, {
        headers: this.key ? { authorization: `Bearer ${this.key}` } : {},
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(15_000, 1000 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 5);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  retryNow() {
    this.attempt = 0;
    this.open();
  }

  restart() {
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
  }
}
