// Loxley on the site stays paper-only and read-only, whatever is in the server's environment.
// Runs loxley's mock chain in this process (demo mode): no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// a key and a seed in the process environment must never reach loxley, nor come back out of the API
const KEY = `0x${'ab'.repeat(32)}`;
const SEED = 'test test test test test test test test test test test junk';
process.env.PRIVATE_KEY = KEY;
process.env.MNEMONIC = SEED;
process.env.LOXLEY_PASSPHRASE = 'canary-passphrase';
process.env.LOXLEY_PRIVATE_KEY = KEY;

const { createLoxley } = await import('../server/loxley/index.js');
const { LOX, firewall } = await import('../server/loxley/safe.js');
const require = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'loxley-test-'));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
let lox;
const res = () => {
  const r = { status: 0, headers: {}, body: '', writeHead(s, h) { r.status = s; r.headers = h || {}; }, write(c) { r.body += c; }, end(c) { if (c) r.body += c; r.done = true; } };
  return r;
};
const get = async (path, method = 'GET') => {
  const r = res();
  await lox.handle({ method, headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} }, r, new URL(path, 'http://x'));
  return r;
};

before(async () => {
  lox = await createLoxley({ demo: true, env: { ...process.env }, log: quiet, dataDir });
});
after(async () => {
  await lox.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('the signing modules can never load', () => {
  assert.throws(() => require(join(LOX, 'cli/trade.js')).makeTrader, /not available on the site/);
  assert.throws(() => require(join(LOX, 'cli/wallet.js')).resolveWallet, /not available on the site/);
  assert.throws(() => require(join(LOX, 'cli/live.js')).attachWallet(), /live-only/);
  const deps = require(join(LOX, 'cli/deps.js'));
  for (const k of ['createWalletClient', 'accounts', 'bip39', 'serializeTransaction', 'createPublicClient', 'http', 'custom']) assert.equal(deps[k], undefined, k);
  assert.ok(Object.isFrozen(deps));
});

test('the desk runs on paper and the firewall holds after it has run', async () => {
  await new Promise((r) => setTimeout(r, 12_000)); // a few demo launches through the feed and the sniper
  const fw = firewall();
  assert.equal(fw.intact, true);
  assert.ok(!fw.loaded.includes('cli/trade.js') && !fw.loaded.includes('cli/wallet.js'), 'the real signing files were never evaluated');
  const h = JSON.parse((await get('/api/loxley/health')).body);
  assert.equal(h.firewall.intact, true);
  const s = JSON.parse((await get('/api/loxley/state')).body);
  assert.equal(s.paper, true);
  assert.equal(s.signing, false);
  assert.ok(s.cards.length > 0, 'launches were read');
  for (const p of s.positions) {
    assert.equal(p.hash, undefined);
    assert.equal(p.book, undefined);
  }
});

test('no secret from the environment is in the desk or comes out of the API', async () => {
  const env = lox.desk.ctx.env;
  assert.equal(env.PRIVATE_KEY, '');
  assert.equal(env.MNEMONIC, '');
  assert.equal(env.LOXLEY_PASSPHRASE, '');
  for (const p of ['/api/loxley/state', '/api/loxley/health', '/api/loxley/market']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.ok(!r.body.includes(KEY.slice(2)) && !r.body.includes('canary-passphrase') && !r.body.includes('test junk'), p);
  }
});

test('every route is read-only, and reads check what they are given', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await get('/api/loxley/state', m)).status, 405);
  const bad = await get('/api/loxley/scan?token=0x123');
  assert.equal(bad.status, 400);
  assert.equal((await get('/api/loxley/nope')).status, 404);
});

test('the stream opens with the desk as it is', async () => {
  const r = res();
  await lox.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} }, r, new URL('http://x/api/loxley/stream'));
  assert.match(r.headers['content-type'], /text\/event-stream/);
  assert.match(r.body, /^retry: 5000\nevent: hello\ndata: \{/);
  assert.ok(r.body.includes('"paper":true'));
});
