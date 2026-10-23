// Loxley on the site, read-only. Loads the vendored CommonJS tree (vendor/loxley, unchanged) behind a firewall:
//   * cli/wallet.js and cli/trade.js can never load (a require of either throws)
//   * cli/live.js is replaced by a paper-only stand-in (sniper.js needs a few pure helpers from it)
//   * cli/deps.js (the viem bundle) is replaced by a frozen subset: ABI codec + units, no wallet client, no accounts
//   * the env is built from cli/env.js DEFAULTS only: no .env file is read, process.env secrets are never copied
// Call loadLoxley() before anything else requires a loxley module.

import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
export const LOX = fileURLToPath(new URL('../../vendor/loxley/', import.meta.url));
const at = (rel) => join(LOX, rel);
export const BLOCKED = ['cli/wallet.js', 'cli/trade.js'];
export const REPLACED = ['cli/live.js', 'cli/deps.js'];

// What the read side and the mock use from viem. Nothing that holds or uses a key.
const DEPS_KEEP = ['parseAbi', 'encodeAbiParameters', 'decodeAbiParameters', 'encodePacked', 'encodeFunctionData', 'decodeFunctionData',
  'encodeFunctionResult', 'decodeFunctionResult', 'decodeEventLog', 'parseEventLogs', 'keccak256', 'toFunctionSelector', 'toEventSelector',
  'formatEther', 'parseEther', 'formatUnits', 'parseUnits', 'getAddress', 'isAddress', 'isAddressEqual', 'maxUint48', 'maxUint128', 'maxUint160', 'maxUint256',
  // the mock chain verifies (never makes) signed transactions; demo mode only, the mock listens on 127.0.0.1
  'parseTransaction', 'recoverTransactionAddress', 'version'];

const planted = new Map();
function plant(rel, exports) {
  const file = at(rel);
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(LOX);
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
  planted.set(rel, m);
}
function refuse(rel) {
  // a Proxy that throws on any use: destructuring `const { makeTrader } = require('./trade')` throws at load time
  plant(rel, new Proxy({}, { get(_, k) { if (k === Symbol.toPrimitive || k === 'then') return undefined; throw new Error(`loxley: ${rel} is not available on the site (paper only, no keys, no signing)`); } }));
}

let loaded = null;
export function loadLoxley({ home } = {}) {
  if (loaded) return loaded;
  for (const k of Object.keys(require.cache)) if (k.startsWith(LOX) && !k.endsWith('package.json')) throw new Error('loxley: loaded before the firewall: ' + relative(LOX, k));
  // 1. the viem bundle, cut down
  const viem = require(at('vendor/viem.js'));
  const deps = Object.freeze(Object.fromEntries(DEPS_KEEP.filter((k) => k in viem).map((k) => [k, viem[k]])));
  plant('cli/deps.js', deps);
  // 2. the signing side, refused
  for (const rel of BLOCKED) refuse(rel);
  // 3. live.js: the pure helpers sniper.js imports, nothing that touches a wallet or the book
  const big = (v) => (v == null ? 0n : BigInt(v));
  const paperOnly = (name) => () => { throw new Error(`loxley: ${name} is live-only; the site runs paper only`); };
  plant('cli/live.js', Object.freeze({
    parseEth(s) { const v = parseFloat(String(s)); if (!(v > 0)) throw new Error('amount must be a positive number of ETH'); return deps.parseEther(String(v)); },
    explorerTx: (env, h) => env.EXPLORER_URL + '/tx/' + h,
    big,
    fmtEth: (wei, d) => (wei == null ? 'n/a' : Number(deps.formatEther(BigInt(wei))).toFixed(d == null ? 5 : d) + ' ETH'),
    fmtTok: (wei, dec) => { if (wei == null) return 'n/a'; const v = Number(wei) / 10 ** (dec == null ? 18 : dec); return v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(v < 1 ? 4 : 2); },
    short: (e) => (e ? String(e.shortMessage || e.message || e).split('\n')[0] : 'unknown error'),
    attachWallet: paperOnly('attachWallet'), arm: paperOnly('arm'), openPosition: paperOnly('openPosition'), applyExit: paperOnly('applyExit'), markPosition: paperOnly('markPosition'),
  }));
  // 4. a quiet terminal: no colour, no OSC-8 links, no bell (ui.bell only rings on a TTY anyway)
  const ui = require(at('cli/ui.js'));
  ui.setColour(false);
  ui.setLinks(false);
  const { DEFAULTS } = require(at('cli/env.js'));
  if (home) mkdirSync(home, { recursive: true });
  loaded = { require: (rel) => require(at(rel)), DEFAULTS, ui, home: home || null, deps };
  return loaded;
}

// The env loxley's modules expect (cli/env.js load(), minus every file and every secret).
export function makeEnv(overrides = {}) {
  const { DEFAULTS, home } = loaded || loadLoxley();
  const env = { ...DEFAULTS, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', DISCORD_WEBHOOK: '', ...overrides };
  for (const k of ['PRIVATE_KEY', 'MNEMONIC', 'LOXLEY_PASSPHRASE']) env[k] = '';
  env.LOXLEY_HOME = overrides.LOXLEY_HOME || home || '';
  env.num = (k) => { const v = parseFloat(env[k]); return Number.isFinite(v) ? v : parseFloat(DEFAULTS[k]); };
  env.bool = (k) => /^(1|true|yes|on)$/i.test(String(env[k] || ''));
  env.hasSecret = () => false;
  return env;
}

// What a test (or /api/loxley/health) can assert: every planted stand-in is still the one in the module cache, so
// the real cli/wallet.js, cli/trade.js, cli/live.js and the full viem export object were never evaluated through it.
export function firewall() {
  const files = Object.keys(require.cache).filter((k) => k.startsWith(LOX)).map((k) => relative(LOX, k)).sort();
  const standIns = [...BLOCKED, ...REPLACED];
  const intact = standIns.every((rel) => planted.get(rel) === require.cache[at(rel)]);
  // `loaded` is the real loxley code evaluated in this process; the stand-ins are listed apart
  return { intact, refused: BLOCKED, replaced: REPLACED, loaded: files.filter((f) => !standIns.includes(f)) };
}
