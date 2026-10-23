// Fomo Radar's parsers on real chain 4663 fixtures, and Canary's adapter, from the rules down to a
// mock Pons V2 chain read through the site's own Robinhood queue. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTransfer, routedFills, fillKind, quoteLegs, fillUsd, USDG, WETH, ROUTER, topicFor, addressFromTopic } from '../server/fomo/scan.js';
import { createCanary, canaryEnv, publicError, view, strings } from '../server/canary/index.js';
import { http as guardedHttp } from '../server/canary/viem-shim.mjs';
import { createHoodRpc } from '../server/hood/rpc.js';
import { startMock, ADDR } from './fixtures/pons-mock.mjs';

const FIX = fileURLToPath(new URL('../vendor/fomo/fixtures/', import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf8'));
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

// ------------------------------------------------------------------ Fomo Radar (ported from the project's own tests)

test('fomo: a topic round-trips to the address', () => {
  const addr = '0x0a6ebed0155edb4b21d92ad02897a626cd90119e';
  const topic = topicFor(addr);
  assert.equal(topic.length, 66);
  assert.ok(topic.startsWith(`0x${'0'.repeat(24)}`));
  assert.equal(addressFromTopic(topic), addr);
});

test('fomo: every fixture log parses as a Transfer, and nothing else does', () => {
  const logs = fixture('rpc_transfer_logs.json');
  const parsed = logs.logs.map(parseTransfer);
  assert.ok(parsed.every(Boolean));
  assert.equal(parsed[0].to, logs.wallet.toLowerCase());
  assert.ok(parsed[0].raw > 0n && parsed[0].tx.startsWith('0x'));
  assert.equal(parseTransfer({ topics: [], address: '0x1' }), null);
  assert.equal(parseTransfer({ topics: ['0xdead', '0x1', '0x2'], address: '0x1' }), null);
});

test('fomo: only the legs facing the router are fills, and the side follows the leg', () => {
  const logs = fixture('rpc_transfer_logs.json');
  const transfers = logs.logs.map(parseTransfer);
  const wallet = logs.wallet.toLowerCase();
  const fills = routedFills(transfers, new Set([wallet]), new Set([logs.router.toLowerCase()]));
  assert.ok(fills.size > 0 && fills.size < transfers.length, 'some legs are trades and some are not');
  for (const f of fills.values()) {
    assert.equal(f.wallet, wallet);
    assert.ok(f.side === 'buy' || f.side === 'sell');
  }
  assert.equal(routedFills(transfers, new Set([wallet]), new Set(['0xsomeoneelse'])).size, 0);
  const leg = (frm, to) => ({ token: '0xtok', frm, to, raw: 5n, tx: `0x${frm}${to}`, index: 1, block: 100 });
  const two = routedFills([leg('0xrouter', '0xme'), leg('0xme', '0xrouter')], new Set(['0xme']), new Set(['0xrouter']));
  assert.deepEqual([...two.values()].map((f) => f.side).sort(), ['buy', 'sell']);
});

test('fomo: the quote is the largest hop, never the sum, and USDG wins over WETH', () => {
  const receipt = fixture('rpc_receipt.json');
  const legs = quoteLegs(receipt);
  const usdg = receipt.logs.map(parseTransfer).filter((t) => t && t.token === USDG).map((t) => Number(t.raw));
  assert.ok(legs[USDG] > 0);
  assert.equal(legs[USDG], Math.max(...usdg) / 1e6);
  assert.ok(legs[USDG] < usdg.reduce((a, b) => a + b, 0) / 1e6);
  assert.equal(fillUsd({ [USDG]: 120.5, [WETH]: 1 }, 2500), 120.5);
  assert.equal(fillUsd({ [WETH]: 2 }, 2500), 5000);
  assert.equal(fillUsd({ [WETH]: 2 }, null), null);
  assert.equal(fillUsd({}, 2500), null);
});

test('fomo: a swap sent to the router itself is nobody\'s trade', () => {
  const r = fixture('rpc_receipts_gift_vs_genuine.json');
  const routers = new Set([ROUTER]);
  assert.equal(fillKind(r.direct_gift, routers), 'direct');
  assert.equal(fillKind(r.genuine_buy, routers), 'flow');
});

// ------------------------------------------------------------------ Canary

test('canary: only CANARY_ variables reach it, and signing material anywhere turns it off', () => {
  const env = canaryEnv({ TOKENS: '0xshould-not-pass', TELEGRAM_TOKEN: 'other-tool', CANARY_TOKENS: '0xmine', CANARY_POLL_SECONDS: '60' });
  assert.equal(env.TOKENS, '0xmine');
  assert.equal(env.POLL_SECONDS, '60');
  assert.equal(env.TELEGRAM_TOKEN, undefined);
  const off = createCanary({ dataDir: '/nonexistent', demo: true, autostart: false, env: { PRIVATE_KEY: '0xabc' }, log: quiet });
  assert.equal(off.info().on, false);
  assert.equal(off.info().reason, 'signing_material');
  assert.equal(createCanary({ dataDir: '/nonexistent', env: { CANARY: '0' }, log: quiet }).info().reason, 'switched_off');
});

test('canary: errors reach a visitor without URLs, and numbers are read in whole units', () => {
  const leaky = publicError(new Error('HTTP request failed. URL: https://rpc.example/v2/SECRETKEY Request body: {...}'));
  assert.equal(leaky.code, 'rpc_unavailable');
  assert.ok(!JSON.stringify(leaky).includes('SECRETKEY'));
  assert.equal(publicError(new Error('0xabc is not a launch from the configured Pons V2 factory')).code, 'not_pons');
  const v = view({ phase: 0, pairSymbol: 'ETH', pairDecimals: 18, devHoldPct: 7.5, liquidityWei: 2_840_000_000_000_000_000n, feesPendingWei: 28_000_000_000_000_000n, trades: 31, lastTradeAt: 0, deployerLaunches: 2, creatorTaxBps: 100 });
  assert.equal(v.phase, 'CURVE');
  assert.equal(v.reserve, 2.84);
  assert.equal(v.quoteFees, 0.028);
  assert.equal(v.lastTradeAt, null, '0 means not known, never a time');
  assert.equal(v.creatorTaxPct, 1);
  // Canary's own store reviver makes "<digits>n" into a BigInt: a symbol like that is given back as text
  assert.equal(strings({ symbol: 420n, token: '0x1' }).symbol, '420n');
});

test('canary: the transport refuses every JSON-RPC method that is not a read', async () => {
  const transport = guardedHttp('http://127.0.0.1:9')({ chain: undefined, retryCount: 0 });
  await assert.rejects(transport.request({ method: 'eth_sendRawTransaction', params: ['0x00'] }), /read-only guard/);
  await assert.rejects(transport.request({ method: 'eth_sign', params: [] }), /read-only guard/);
  await assert.rejects(transport.request({ method: 'eth_accounts', params: [] }), /read-only guard/);
});

test('canary: the demo cycle sets off LEAVE, WATCH and INFO through Canary\'s own rules', async () => {
  let t = Date.UTC(2026, 9, 1);
  const c = createCanary({ dataDir: '/nonexistent', demo: true, autostart: false, now: () => t, env: {}, log: quiet });
  await c.probe();
  const seen = new Set();
  for (let i = 0; i < 13; i++) {
    t += 4000;
    await c.sweepOnce();
    for (const a of c.state(null).alerts) seen.add(`${a.level}:${a.rule}`);
  }
  for (const want of ['leave:deployer-balance-drop', 'leave:curve-reserve-drop', 'leave:pool-liquidity-drop', 'warn:fees-swept', 'warn:pool-price-move', 'warn:pool-swap-burst', 'warn:pool-token-fees-moved', 'warn:volume-dead', 'warn:serial-deployer', 'info:phase-change']) {
    assert.ok(seen.has(want), want);
  }
  c.close();
});

test('canary: a live sweep through the site queue catches a deployer drop and a pool drain', async () => {
  const mock = await startMock({ port: 0 });
  const rpc = createHoodRpc({ url: mock.url, spacingMs: 1, logsSpacingMs: 2, log: quiet });
  const dir = mkdtempSync(join(tmpdir(), 'canary-'));
  const post = (p, b) => fetch(mock.url + p, { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
  const c = createCanary({ dataDir: dir, demo: false, autostart: false, rpc, env: { CANARY_TOKENS: `${ADDR.lantern},${ADDR.orbit}` }, log: quiet });
  try {
    await c.probe();
    assert.equal(c.state(null).chain.status, 'ok');
    await c.reader.refreshIndex();
    await c.sweepOnce();
    const first = c.state(null);
    assert.deepEqual(first.tokens.map((x) => x.status), ['QUIET', 'QUIET']);
    // the deployer of LANTERN moves 5 points of supply out; ORBIT's pool loses 58% of its liquidity
    await post('/__mock/patch', { token: ADDR.lantern, balances: { [`0xdeadbeef${'1'.padStart(32, '0')}`]: (25_000_000n * 10n ** 18n).toString() } });
    await post('/__mock/patch', { token: ADDR.orbit, set: { liquidity: '20000000000000000000' } });
    await new Promise((r) => setTimeout(r, 4200)); // viem keeps the block number for 4 s
    await c.sweepOnce();
    const s = c.state(null);
    const byToken = Object.fromEntries(s.tokens.map((x) => [x.token.toLowerCase(), x]));
    assert.equal(byToken[ADDR.lantern.toLowerCase()].status, 'LEAVE');
    assert.ok(byToken[ADDR.lantern.toLowerCase()].signals.some((a) => a.rule === 'deployer-balance-drop'));
    assert.equal(byToken[ADDR.orbit.toLowerCase()].status, 'LEAVE');
    assert.ok(s.alerts.some((a) => a.rule === 'pool-liquidity-drop' && a.before && a.before.price > 0));
    // a one-shot scan of something that is not a launch is a 404, with no RPC detail in it
    const res = { status: 0, body: '', writeHead(st) { this.status = st; }, end(b) { this.body = b; } };
    await assert.rejects(
      c.handle({ method: 'GET', headers: {}, socket: { remoteAddress: '10.0.0.1' } }, res, new URL(`http://x/api/canary/scan?token=${ADDR.notPons}`)),
      (err) => err.status === 404 && err.code === 'not_pons' && !/127\.0\.0\.1/.test(err.message),
    );
    // and control stays locked without the key
    await assert.rejects(
      c.handle({ method: 'POST', headers: { 'content-type': 'application/json' }, socket: { remoteAddress: '10.0.0.1' }, on() {} }, res, new URL('http://x/api/canary/watch')),
      (err) => err.status === 403,
    );
  } finally {
    c.close();
    mock.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
