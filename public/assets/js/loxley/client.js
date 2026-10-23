// Loxley's data for the page, in all three modes, through one reducer:
//   server  GET /api/loxley/state, then EventSource /api/loxley/stream (the server's own paper desk, live or --demo)
//   static  no server (static hosting, single-file preview): ./sample-data.js, a recorded demo session, replayed
//           on a loop with its clock moved to now. Everything in it is made up and the page must say so.
// Reads (scan, market, fees, dev, exit, xray) go to /api/loxley/<kind>; without a server only the recorded ones answer.

const KEEP_CARDS = 60, KEEP_LOG = 200;

export function createStore() {
  const s = { mode: null, demo: true, rules: null, rulesText: null, cards: [], positions: new Map(), passes: 0, log: [], lastSeq: 0, since: Date.now() };
  const upsertCard = (c) => { const i = s.cards.findIndex((x) => x.token === c.token); if (i >= 0) s.cards[i] = { ...s.cards[i], ...c }; else { s.cards.unshift(c); if (s.cards.length > KEEP_CARDS) s.cards.pop(); } };
  const log = (ev) => { s.log.unshift(ev); if (s.log.length > KEEP_LOG) s.log.pop(); };
  return {
    state: s,
    hello(h) {
      s.mode = h.mode; s.demo = h.mode !== 'live'; s.rules = h.rules; s.rulesText = h.rulesText || null; s.since = (h.totals && h.totals.since) || Date.now();
      s.ready = h.ready !== false; s.error = h.error || null;
      s.cards = (h.cards || []).slice(0, KEEP_CARDS); s.positions = new Map((h.positions || []).map((p) => [p.id, p])); s.passes = (h.totals && h.totals.passed) || 0;
    },
    apply(ev) {
      if (ev.seq) s.lastSeq = Math.max(s.lastSeq, ev.seq);
      switch (ev.type) {
        case 'card': upsertCard(ev.card); break;
        case 'follow': { // a follow-up may carry only what changed: merged into the card it belongs to, never a card of its own
          const i = s.cards.findIndex((x) => x.token === ev.card.token);
          if (i >= 0) s.cards[i] = { ...s.cards[i], ...ev.card, after: ev.after };
          break;
        }
        case 'grad': { const c = s.cards.find((x) => x.token === ev.token); if (c && c.bonding) c.bonding = { ...c.bonding, graduated: true }; break; }
        case 'fire': s.positions.set(ev.position.id, ev.position); break;
        case 'mark': { const p = s.positions.get(ev.id); if (p) { p.mark = ev.mark; p.peakPct = ev.peakPct; p.marks = (p.marks || 0) + 1; } break; }
        case 'close': s.positions.set(ev.position.id, ev.position); break;
        case 'pass': s.passes++; break;
        case 'note': if (/^feed open/.test(ev.text || '')) { s.ready = true; s.error = null; } break;
        default: break;
      }
      if (ev.type !== 'mark' && ev.type !== 'follow') log(ev);
    },
    totals() {
      const all = [...s.positions.values()], open = all.filter((p) => p.status === 'open'), closed = all.filter((p) => p.status === 'closed');
      const realised = closed.reduce((a, p) => a + (p.exit.outEth - p.eth), 0), unreal = open.reduce((a, p) => a + (p.mark ? p.mark.valueEth - p.eth : 0), 0);
      const wins = closed.filter((p) => p.exit.outEth > p.eth).length;
      return { fired: all.length, open: open.length, closed: closed.length, passed: s.passes, wins, realisedEth: realised, openEth: unreal, spentEth: all.reduce((a, p) => a + p.eth, 0) };
    },
    positions() { return [...s.positions.values()].sort((a, b) => b.openedAt - a.openedAt); },
  };
}

// one connection, whatever the mode. handlers: { onHello(state), onEvent(ev, state), onStatus({ mode, connected, demo }) }
export async function connectLoxley(env, handlers = {}) {
  const store = createStore();
  const status = (o) => handlers.onStatus && handlers.onStatus(o);
  if (env && env.mode === 'server') {
    let es = null, closed = false;
    const open = () => {
      es = new EventSource('/api/loxley/stream' + (store.state.lastSeq ? '?since=' + store.state.lastSeq : ''));
      es.addEventListener('hello', (m) => { store.hello(JSON.parse(m.data)); status({ mode: store.state.mode, connected: true, demo: store.state.demo }); handlers.onHello && handlers.onHello(store); });
      for (const t of ['card', 'follow', 'grad', 'swept', 'pass', 'draw', 'fire', 'mark', 'close', 'siren', 'moved', 'copy', 'note'])
        es.addEventListener(t, (m) => { const ev = JSON.parse(m.data); store.apply(ev); handlers.onEvent && handlers.onEvent(ev, store); });
      es.onerror = () => { status({ mode: store.state.mode, connected: false, demo: store.state.demo }); }; // EventSource reconnects by itself (retry: 5000, Last-Event-ID)
    };
    open();
    return { store, close() { closed = true; if (es) es.close(); }, get closed() { return closed; } };
  }
  return replaySample(store, handlers, status);
}

// the static fallback: a recorded session, its clock moved so the first `head` share has just happened, then played
async function replaySample(store, handlers, status) {
  const sample = (await import('./sample-data.js')).default;
  let timer = null, stopped = false;
  const run = () => {
    const now = Date.now(), cut = Math.floor(sample.events.length * 0.55), events = sample.events;
    const shift = now - (sample.startedAt + events[cut].t);
    // every time in the recording moves by the same amount: the event's own, and the ones inside its card or position
    const moved = (t) => (typeof t === 'number' ? t + shift : t);
    const at = (e) => {
      const ev = { ...e, at: sample.startedAt + e.t + shift, seq: e.seq };
      if (ev.card && ev.card.at) ev.card = { ...ev.card, at: moved(ev.card.at) };
      if (ev.position) ev.position = { ...ev.position, openedAt: moved(ev.position.openedAt), exit: ev.position.exit ? { ...ev.position.exit, closedAt: moved(ev.position.exit.closedAt) } : ev.position.exit };
      return ev;
    };
    store.hello({ ...sample.hello, mode: 'sample', cards: [], positions: [], totals: { since: sample.startedAt + shift, passed: 0 } });
    for (let i = 0; i < cut; i++) store.apply(at(events[i]));
    status({ mode: 'sample', connected: true, demo: true });
    handlers.onHello && handlers.onHello(store);
    let i = cut;
    const tick = () => {
      if (stopped) return;
      if (i >= events.length) { timer = setTimeout(run, 4000); return; } // loop: a fresh session
      const ev = at(events[i++]); store.apply(ev); handlers.onEvent && handlers.onEvent(ev, store);
      const next = events[i]; timer = setTimeout(tick, next ? Math.max(0, Math.min(8000, next.t - events[i - 1].t)) : 0);
    };
    tick();
  };
  run();
  return { store, close() { stopped = true; clearTimeout(timer); } };
}

// the reads, with the recorded answers as the fallback
export async function loxleyRead(env, kind, params = {}) {
  if (env && env.mode === 'server') {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch('/api/loxley/' + kind + (qs ? '?' + qs : ''), { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(body.message || 'http ' + res.status); e.status = res.status; throw e; }
    return body;
  }
  const sample = (await import('./sample-data.js')).default;
  const key = kind === 'market' ? 'market' : kind + ':' + String(params.token || params.wallet || params.address || '').toLowerCase();
  if (sample.reads && sample.reads[key]) return { ...sample.reads[key], sample: true };
  const e = new Error('This read needs the site server. The preview shows recorded samples only.'); e.status = 501; throw e;
}
