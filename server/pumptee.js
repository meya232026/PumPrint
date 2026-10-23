// One PumpPortal connection for the whole site. Moth opens it; this wrapper also subscribes to
// migrations and hands every raw message to other listeners (Chameleonscope), because PumpPortal
// asks clients to keep a single connection per address.

export function createPumpTee() {
  const listeners = new Set();
  const Base = globalThis.WebSocket;

  class TeeSocket {
    constructor(url, protocols) {
      this.ws = protocols ? new Base(url, protocols) : new Base(url);
      this.ws.addEventListener('open', () => {
        try {
          this.ws.send(JSON.stringify({ method: 'subscribeMigration' }));
        } catch {
          /* closed already */
        }
      });
      this.ws.addEventListener('message', (ev) => {
        if (!listeners.size) return;
        const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
        for (const fn of listeners) {
          try {
            fn(text);
          } catch {
            /* a listener's problem stays its own */
          }
        }
      });
    }
    get readyState() {
      return this.ws.readyState;
    }
    get binaryType() {
      return this.ws.binaryType;
    }
    set binaryType(v) {
      this.ws.binaryType = v;
    }
    addEventListener(type, fn, opts) {
      this.ws.addEventListener(type, fn, opts);
    }
    removeEventListener(type, fn, opts) {
      this.ws.removeEventListener(type, fn, opts);
    }
    send(data) {
      this.ws.send(data);
    }
    close(code, reason) {
      this.ws.close(code, reason);
    }
  }

  return {
    WebSocketImpl: typeof Base === 'function' ? TeeSocket : undefined,
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
