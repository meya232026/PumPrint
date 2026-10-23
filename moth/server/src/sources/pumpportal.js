// Live launches from PumpPortal's free data stream (pump.fun and the other
// launchpads it covers). One connection, one subscription, reconnect with backoff.
// PumpPortal asks clients to keep a single connection — don't run many servers off one IP.

const STALE_MS = 120_000;

export function parseLaunch(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.txType !== undefined && msg.txType !== 'create') return null;
  if (typeof msg.mint !== 'string' || typeof msg.name !== 'string') return null;
  return {
    mint: msg.mint,
    name: msg.name,
    symbol: typeof msg.symbol === 'string' ? msg.symbol : '',
    pool: typeof msg.pool === 'string' && msg.pool ? msg.pool : 'pump',
    creator: typeof msg.traderPublicKey === 'string' ? msg.traderPublicKey : '',
    curve: typeof msg.bondingCurveKey === 'string' ? msg.bondingCurveKey : '',
    mc0: Number(msg.marketCapSol) || 0,
  };
}

export function startPumpPortal({ url, onLaunch, log, WebSocketImpl = globalThis.WebSocket }) {
  if (typeof WebSocketImpl !== 'function') throw new Error('This Node has no WebSocket client. Use Node 22 or newer.');
  const status = { kind: 'pumpportal', url, connected: false, connectedAt: 0, lastEventAt: 0, events: 0, reconnects: 0, lastError: '' };
  let ws = null;
  let generation = 0;
  let attempt = 0;
  let stopped = false;
  let retryTimer = null;
  let staleTimer = null;

  const connect = () => {
    if (stopped) return;
    const gen = ++generation;
    let opened = false;
    try {
      ws = new WebSocketImpl(url);
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      status.lastError = err.message;
      return retry(gen);
    }
    ws.addEventListener('open', () => {
      if (gen !== generation) return;
      opened = true;
      attempt = 0;
      status.connected = true;
      status.connectedAt = Date.now();
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      log.info('pumpportal: connected, listening for new tokens');
      armStale(gen);
    });
    ws.addEventListener('message', (ev) => {
      if (gen !== generation) return;
      armStale(gen);
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      if (msg && typeof msg.message === 'string' && !msg.mint) {
        log.debug(`pumpportal: ${msg.message}`);
        return;
      }
      const launch = parseLaunch(msg);
      if (!launch) return;
      status.events++;
      status.lastEventAt = Date.now();
      onLaunch(launch);
    });
    ws.addEventListener('error', (ev) => {
      if (gen !== generation) return;
      status.lastError = ev?.message || ev?.error?.message || 'connection error';
      // A failed handshake doesn't always fire 'close', so don't wait for it.
      setTimeout(
        () => {
          if (gen !== generation || stopped) return;
          status.connected = false;
          log.warn('pumpportal: connection failed', { error: status.lastError, retryIn: `${nextDelaySec()}s` });
          retry(gen);
          try {
            ws.close();
          } catch {
            /* already closed */
          }
        },
        opened ? 5000 : 0,
      );
    });
    ws.addEventListener('close', (ev) => {
      if (gen !== generation) return;
      status.connected = false;
      if (!stopped) log.warn('pumpportal: disconnected', { code: ev?.code, reason: ev?.reason || undefined, retryIn: `${nextDelaySec()}s` });
      retry(gen);
    });
  };

  const nextDelaySec = () => Math.min(30, 2 ** attempt);

  const retry = (gen) => {
    if (stopped || gen !== generation) return;
    generation++;
    clearTimeout(staleTimer);
    clearTimeout(retryTimer);
    const delay = nextDelaySec() * 1000 + Math.floor(Math.random() * 500);
    attempt = Math.min(attempt + 1, 6);
    status.reconnects++;
    retryTimer = setTimeout(connect, delay);
  };

  // No message for two minutes means the socket is dead even if it never said so.
  const armStale = (gen) => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (gen !== generation) return;
      log.warn('pumpportal: no data for 2 minutes, reconnecting');
      status.connected = false;
      const old = ws;
      retry(gen);
      try {
        old?.close();
      } catch {
        /* already closed */
      }
    }, STALE_MS);
  };

  connect();
  return {
    status,
    stop() {
      stopped = true;
      generation++;
      clearTimeout(retryTimer);
      clearTimeout(staleTimer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
