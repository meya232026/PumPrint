// Small pure functions: handle parsing, trending parsers, the fingerprint math.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHandle, guessPlatform } from '../server/kolibri.js';
import { parseGecko, parseDexTokens, iconUrl } from '../server/trending.js';
import { rho, ridge, domeZ } from '../public/assets/js/print3d.js';
import { measure } from '../server/kol/measure.js';
import { createKolEngine } from '../server/kol/engine.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDemoWorld } = require('../server/demo-world.cjs');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

test('cleanHandle accepts links, @handles and bare names', () => {
  assert.equal(cleanHandle('https://t.me/s/TrenchDiary'), 'TrenchDiary');
  assert.equal(cleanHandle('t.me/trenchdiary/123'), 'trenchdiary');
  assert.equal(cleanHandle('@printdegen'), 'printdegen');
  assert.equal(cleanHandle('https://x.com/printdegen/status/1'), 'printdegen');
  assert.equal(cleanHandle('  curvewatch  '), 'curvewatch');
  assert.equal(guessPlatform('https://x.com/a'), 'x');
  assert.equal(guessPlatform('t.me/abcde'), 'tg');
  assert.equal(guessPlatform('abcde'), null);
});

test('parseGecko keeps memecoins and skips majors', () => {
  const json = {
    data: [
      { attributes: { name: 'WIF / SOL', price_change_percentage: { h24: '12.5' } }, relationships: { base_token: { data: { id: 'solana_wif' } } } },
      { attributes: { name: 'SOL / USDC', price_change_percentage: { h24: '1' } }, relationships: { base_token: { data: { id: 'solana_sol' } } } },
    ],
    included: [
      { id: 'solana_wif', type: 'token', attributes: { symbol: 'WIF', name: 'dogwifhat', address: 'EKp', image_url: 'https://assets.geckoterminal.com/x.png' } },
      { id: 'solana_sol', type: 'token', attributes: { symbol: 'SOL', name: 'Wrapped SOL', address: 'So1', image_url: 'missing.png' } },
    ],
  };
  const out = parseGecko(json);
  assert.equal(out.length, 1);
  assert.equal(out[0].symbol, 'WIF');
  assert.equal(out[0].change, 0.125);
  assert.match(out[0].icon, /^\/api\/icon\?u=/);
});

test('parseDexTokens and iconUrl', () => {
  const out = parseDexTokens([{ baseToken: { address: 'A1', symbol: 'BONK', name: 'Bonk' }, priceChange: { h24: -3 }, info: { imageUrl: 'https://dd.dexscreener.com/a.png' } }]);
  assert.equal(out[0].symbol, 'BONK');
  assert.equal(out[0].change, -0.03);
  assert.equal(iconUrl('http://dd.dexscreener.com/a.png'), null);
  assert.equal(iconUrl('https://evil.example/a.png'), null);
});

test('the fingerprint stays inside its outline', () => {
  assert.ok(rho(0, 0) < 0.01);
  assert.ok(rho(0.5, 0) > 0.99);
  assert.equal(domeZ(0.6, 0), 0);
  assert.ok(domeZ(0, 0) > 0.1);
  let ridges = 0;
  for (let i = 0; i < 2000; i++) {
    const x = Math.sin(i * 12.9898) * 0.45;
    const y = Math.cos(i * 78.233) * 0.6;
    const r = ridge(x, y);
    assert.ok(r >= 0 && r <= 1);
    if (r > 0.5) ridges++;
  }
  assert.ok(ridges > 300 && ridges < 1500, `ridge share ${ridges}`);
});

// A call on the minute at a $20K market cap (supply 1B, price $0.00002).
const T0 = 1_700_000_040;
function sampleCandles({ m1 = 0.00004, m5 = 0.00001, h1 = 0.00003, d1 = 0.00006 } = {}) {
  const fine = [];
  for (let i = 0; i <= 61; i++) fine.push({ t: T0 + i * 60, o: 0.00002, h: 0.00002, l: 0.00002, c: 0.00002 });
  fine[0].c = m1; // the minute after the post
  fine[4].c = m5; // minute 5
  fine[59].c = h1; // minute 60
  const coarse = [];
  for (let i = 0; i <= 97; i++) coarse.push({ t: T0 + i * 900, o: 0.00002, h: 0.00002, l: 0.00002, c: 0.00002 });
  coarse[95].c = d1; // the quarter hour ending at 24h
  return { fine, coarse };
}

test('a call is measured against the market cap at the call', () => {
  const { fine, coarse } = sampleCandles();
  const m = measure({ fine, coarse, postedAtMs: T0 * 1000, nowMs: (T0 + 90000) * 1000, supply: 1e9 });
  assert.equal(m.status, 'priced');
  assert.equal(m.frame, '1m');
  assert.equal(Math.round(m.entryMc), 20000);
  // $20K -> $40K a minute later is 2x; -> $10K is -50%.
  assert.ok(Math.abs(m.r1m - 1) < 1e-9);
  assert.ok(Math.abs(m.r5m + 0.5) < 1e-9);
  assert.ok(Math.abs(m.r1h - 0.5) < 1e-9);
  assert.ok(Math.abs(m.r24h - 2) < 1e-9);
  assert.ok(Math.abs(m.rPeak - 2) < 1e-9);
  assert.ok(Math.abs(m.rLow + 0.5) < 1e-9);
});

test('horizons that have not happened yet wait for their own check', () => {
  const { fine } = sampleCandles();
  const m = measure({ fine: fine.slice(0, 4), coarse: [], postedAtMs: T0 * 1000, nowMs: (T0 + 200) * 1000, supply: 1e9 });
  assert.equal(m.status, 'partial');
  assert.ok(Math.abs(m.r1m - 1) < 1e-9);
  assert.equal(m.r5m, null);
  assert.equal(m.nextCheckAt, (T0 + 300 + 120) * 1000);
});

test('without an X key a post link still works and whole accounts say what is missing', async () => {
  const now = Date.now();
  const world = createDemoWorld(now);
  const engine = createKolEngine({ dataDir: '.', env: { KOL_DB_PATH: ':memory:' }, log: quiet, fetchImpl: world.fetchImpl, now: () => now });
  try {
    assert.equal(engine.info().x, null);
    const one = await engine.lookup(world.sampleTweet);
    assert.equal(one.platform, 'x');
    assert.ok(one.postId);
    assert.equal(one.noCall, false);
    const card = engine.card(one.key);
    assert.equal(card.card.calls.length, 1);
    // The account's other posts can't be read, so the card says it only has the linked ones.
    const whole = await engine.lookup(`https://x.com/${one.handle}`);
    assert.equal(whole.limited, true);
    await assert.rejects(engine.lookup('https://x.com/someoneelse'), (err) => err.status === 501 && err.code === 'x_unavailable');
  } finally {
    engine.close();
  }
});

test('paid X reads stop at the daily cap', async () => {
  const now = Date.now();
  const world = createDemoWorld(now);
  const engine = createKolEngine({
    dataDir: '.',
    env: { KOL_DB_PATH: ':memory:', TWITTERAPI_IO_KEY: 'test', X_LOOKUPS_PER_DAY: '1' },
    log: quiet,
    fetchImpl: world.fetchImpl,
    now: () => now,
  });
  try {
    const first = await engine.lookup('https://x.com/printdegen');
    await assert.rejects(engine.lookup('https://x.com/trenchqueen'), (err) => err.status === 429 && err.code === 'x_budget');
    for (let i = 0; i < 100 && engine.card(first.key)?.collecting; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(engine.card(first.key).card.calls.length > 5);
    assert.equal(engine.info().xReadsLeft, 0);
  } finally {
    engine.close();
  }
});
