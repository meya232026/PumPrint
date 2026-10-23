// Starts the site in demo mode and checks every endpoint the pages use.
// Run with `npm test` (no network needed).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://localhost:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['server/index.js', '--demo'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'error', DATA_DIR: fileURLToPath(new URL('../data/test/', import.meta.url)) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  // The demo callers are read and priced in the background.
  await new Promise((r) => setTimeout(r, 2500));
});

after(() => {
  child?.kill('SIGTERM');
});

const json = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  return { status: res.status, body: await res.json() };
};

test('serves the site', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-ransom/);
  assert.match(html, /Kolibri Search/);
  assert.match(html, /Moth Radar/);
  const js = await fetch(`${BASE}/assets/js/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  const zip = await fetch(`${BASE}/downloads/moth-extension.zip`);
  assert.equal(zip.status, 200);
  assert.match(zip.headers.get('content-disposition'), /attachment/);
});

test('blocks path traversal', async () => {
  const res = await fetch(`${BASE}/..%2f..%2fpackage.json`);
  assert.notEqual(res.status, 200);
});

test('site info and trending coins', async () => {
  const site = await json('/api/site');
  assert.equal(site.body.mode, 'server');
  assert.equal(site.body.demo, true);
  assert.equal(site.body.moth.source, 'demo');
  const coins = await json('/api/trending');
  assert.ok(coins.body.items.length >= 8);
  assert.ok(coins.body.items.every((c) => typeof c.symbol === 'string'));
});

test('icon proxy only accepts known hosts', async () => {
  const res = await fetch(`${BASE}/api/icon?u=${encodeURIComponent('https://example.com/a.png')}`);
  assert.equal(res.status, 400);
});

test('moth snapshot and word details over HTTP', async () => {
  const snap = await json('/moth/api/snapshot?window=60');
  assert.equal(snap.status, 200);
  assert.ok(snap.body.total > 1000);
  assert.ok(snap.body.words.length > 10);
  const word = await json(`/moth/api/word?w=${encodeURIComponent(snap.body.words[0].w)}&window=60`);
  assert.equal(word.status, 200);
  assert.ok(word.body.count > 0);
  const page = await fetch(`${BASE}/moth/verify`);
  const html = await page.text();
  assert.match(html, /\/moth\/api\/nonce/);
});

test('moth WebSocket streams a snapshot', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}/moth/ws`);
  const types = new Set();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no snapshot over WebSocket')), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', window: 15 }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      types.add(msg.type);
      if (msg.type === 'snapshot') {
        assert.equal(msg.window, 15);
        clearTimeout(timer);
        resolve();
      }
    };
  });
  ws.close();
  assert.ok(types.has('welcome'));
});

test('kolibri lookup, card and leaderboard', async () => {
  const look = await json('/api/kolibri/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'https://t.me/s/TrenchDiary' }),
  });
  assert.equal(look.status, 200);
  assert.equal(look.body.key, 'tg:trenchdiary');
  const card = await json('/api/kolibri/card?platform=tg&handle=trenchdiary');
  assert.equal(card.status, 200);
  assert.equal(card.body.card.author.name, 'Trench Diary');
  assert.ok(card.body.card.calls.length >= 10);
  const board = await json('/api/kolibri/leaderboard');
  assert.ok(board.body.items.length >= 5);
  const x = await json('/api/kolibri/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'x.com/printdegen' }),
  });
  assert.equal(x.body.platform, 'x');
  const bad = await json('/api/kolibri/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 't.me/ab' }),
  });
  assert.equal(bad.status, 400);
});

test('kolibri reads one X post from its link', async () => {
  const card = await json('/api/kolibri/card?platform=x&handle=printdegen');
  const call = card.body.card.calls.find((c) => c.url && /\/status\//.test(c.url));
  assert.ok(call, 'the sample caller has calls with post links');
  const look = await json('/api/kolibri/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: call.url }),
  });
  assert.equal(look.status, 200);
  assert.equal(look.body.platform, 'x');
  assert.equal(look.body.postId, call.postId);
  assert.equal(look.body.noCall, false);
});

test('kolibri measures market cap at the call and 1m / 5m / 1h / 24h after it', async () => {
  const card = await json('/api/kolibri/card?platform=x&handle=printdegen');
  const calls = card.body.card.calls;
  const priced = calls.filter((c) => c.status === 'priced');
  assert.ok(priced.length >= 5);
  for (const c of priced) {
    assert.ok(c.entryMc > 0);
    for (const k of ['r1m', 'r5m', 'r1h', 'r24h']) assert.equal(typeof c[k], 'number', `${k} of ${c.symbol}`);
    assert.ok(Math.abs(c.p1h / c.entry - 1 - c.r1h) < 1e-9);
  }
  const s = card.body.card.summary;
  for (const k of ['up1m', 'up5m', 'up1h', 'up24', 'med1h', 'med24']) assert.equal(typeof s[k], 'number', k);
  assert.match(s.grade, /^[A-F]$/);
});

test('kolibri reports a channel without a public preview', async () => {
  await json('/api/kolibri/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'nosuchchannel42', platform: 'tg' }),
  });
  await new Promise((r) => setTimeout(r, 500));
  const card = await json('/api/kolibri/card?platform=tg&handle=nosuchchannel42');
  assert.equal(card.status, 200);
  assert.equal(card.body.card, null);
  assert.match(card.body.error, /public preview/);
});

test('the original Kolibri network server stays off unless asked for', async () => {
  const health = await fetch(`${BASE}/kolibri/v1/health`);
  assert.equal(health.status, 404);
  const site = await json('/api/site');
  assert.equal(site.body.kolibri.network, false);
});

test('the Telegram button has its own coming-soon page', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.match(html, /data-view="telegram"/);
  assert.match(html, /data-ransom-text="Coming soon"/);
  const js = await fetch(`${BASE}/assets/js/soon.js`);
  assert.equal(js.status, 200);
});

// ------------------------------------------------------------------ the four tools added with the Tools menu

const until = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 250));
  }
};

test('the site lists six tools and the guide, each with its own view', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  for (const v of ['kolibri', 'moth', 'chameleon', 'loxley', 'canary', 'fomo']) {
    assert.match(html, new RegExp(`data-view="${v}"`), v);
    assert.match(html, new RegExp(`href="#${v}" data-nav="${v}"`), v);
  }
  // the guide has its own tab, and every tool and the guide can go into one side of the split view
  assert.match(html, /href="#learn" data-nav="learn"/);
  assert.match(html, /data-view="learn" data-pane/);
  assert.equal((html.match(/data-tool data-pane/g) || []).length, 6);
  assert.match(html, /id="split-bar"/);
  for (const f of ['learn/page.js', 'app.js']) assert.equal((await fetch(`${BASE}/assets/js/${f}`)).status, 200, f);
  const site = await json('/api/site');
  for (const k of ['fomo', 'chameleon', 'canary', 'loxley']) assert.equal(site.body[k].on, true, k);
  assert.equal(site.body.loxley.paper, true);
  assert.equal(site.body.loxley.signing, false);
});

test('fomo radar replays its demo day and serves it', async () => {
  const live = await until(async () => {
    const r = await json('/api/fomo/live');
    return r.status === 200 && r.body.status === 'live' ? r : null;
  });
  assert.ok(Array.isArray(live.body.alerts));
  assert.ok(live.body.alerts.length > 0, 'the replayed day has alerts');
  assert.equal((await json('/api/fomo/nope')).status, 404);
});

test('chameleonscope answers from its worker', async () => {
  const feed = await until(async () => {
    const r = await json('/api/chameleon/feed?chain=solana&group=new');
    return r.status === 200 ? r : null;
  }, 30_000);
  assert.ok(feed.body && typeof feed.body === 'object');
  const side = await json('/api/chameleon/side');
  assert.equal(side.status, 200);
  const bad = await json('/api/chameleon/token?id=nope');
  assert.ok(bad.status >= 400 && bad.status < 500);
});

test('canary sweeps its demo list, scans one token and keeps control locked', async () => {
  const state = await until(async () => {
    const r = await json('/api/canary/state');
    return r.body.pass && r.body.pass.count > 1 ? r : null;
  });
  assert.equal(state.body.mode, 'demo');
  assert.equal(state.body.tokens.length, 6);
  const rules = await json('/api/canary/rules');
  assert.equal(rules.body.rules.length, 10);
  const token = state.body.tokens[0].token;
  const scan = await json(`/api/canary/scan?token=${token}`);
  assert.equal(scan.status, 200);
  assert.equal(scan.body.snapshot.token.toLowerCase(), token.toLowerCase());
  assert.equal(typeof scan.body.snapshot.liquidityWei, 'string', 'BigInts travel as strings');
  const detail = await json(`/api/canary/token?token=${token}`);
  assert.ok(detail.body.history.length >= 1);
  assert.equal((await json('/api/canary/scan?token=0x123')).status, 400);
  assert.equal((await json(`/api/canary/scan?token=0x${'9'.repeat(40)}`)).status, 404);
  const post = await json('/api/canary/watch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(post.status, 403);
});

test('loxley runs its desk on paper, read-only', async () => {
  const health = await json('/api/loxley/health');
  assert.equal(health.body.firewall.intact, true);
  const state = await until(async () => {
    const r = await json('/api/loxley/state');
    return r.body.cards && r.body.cards.length ? r : null;
  });
  assert.equal(state.body.paper, true);
  assert.equal(state.body.signing, false);
  assert.ok(state.body.rulesText.refuses.length > 0);
  for (const m of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(`${BASE}/api/loxley/state`, { method: m })).status, 405);
  assert.equal((await json('/api/loxley/scan?token=nope')).status, 400);
  // the stream opens with a hello
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/loxley/stream`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /event: hello/);
  ctrl.abort();
});
