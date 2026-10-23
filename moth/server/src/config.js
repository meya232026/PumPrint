// All settings come from environment variables (or a .env file next to package.json).
// See .env.example for what each one does.

import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_FILE = fileURLToPath(new URL('../data/launches.json', import.meta.url));

export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const list = (value, fallback) =>
    String(value ?? fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const num = (value, fallback) => {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const demo = argv.includes('--demo') || env.SOURCE === 'demo';
  const windows = [...new Set(list(env.WINDOWS, '5,15,60').map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 360)
    .sort((a, b) => a - b);
  if (windows.length === 0) windows.push(60);
  const freeWindows = list(env.FREE_WINDOWS, String(windows[windows.length - 1]))
    .map(Number)
    .filter((n) => windows.includes(n));

  return {
    port: num(env.PORT, 8787),
    // Empty means every interface, IPv4 and IPv6, so both localhost and 127.0.0.1 work.
    host: env.HOST || '',
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/+$/, ''),
    source: demo ? 'demo' : env.SOURCE || 'pumpportal',
    pumpportalUrl: env.PUMPPORTAL_WS || 'wss://pumpportal.fun/api/data',
    windows,
    freeWindows: freeWindows.length ? freeWindows : [windows[windows.length - 1]],
    topN: num(env.TOP_N, 60),
    minCount: num(env.MIN_COUNT, 2),
    snapshotMs: Math.max(1000, num(env.SNAPSHOT_INTERVAL_MS, 3000)),
    extraStopwords: list(env.STOPWORDS_EXTRA, ''),
    dataFile: env.DATA_FILE ?? DEFAULT_DATA_FILE,
    holder: {
      mint: String(env.HOLDER_MINT || '').trim(),
      symbol: String(env.HOLDER_SYMBOL || 'MOTH').replace(/^\$/, ''),
      minBalance: num(env.HOLDER_MIN_BALANCE, 1),
      rpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      buyUrl: env.HOLDER_BUY_URL || '',
    },
    accessSecret: env.ACCESS_SECRET || '',
    accessTtlDays: num(env.ACCESS_TTL_DAYS, 30),
    demoRate: num(env.DEMO_RATE, 40),
    // Trading data: reads each recent token's bonding curve through SOLANA_RPC_URL.
    market: String(env.MARKET || 'on').toLowerCase() !== 'off',
    marketPollMs: Math.max(5000, num(env.MARKET_POLL_MS, 15000)),
    solPrice: String(env.SOL_PRICE || 'on').toLowerCase() !== 'off',
    logLevel: env.LOG_LEVEL || 'info',
  };
}
