#!/usr/bin/env node
// Moth server: reads new token launches, counts the words in their names,
// and streams the leaderboard to the side panel over WebSocket.
//
//   npm start          live launches from PumpPortal
//   npm run demo       fake launches, no network needed

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { createApp } from './app.js';
import { loadState, saveState } from './persist.js';
import { startPumpPortal } from './sources/pumpportal.js';
import { startDemo } from './sources/demo.js';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const config = loadConfig();
const log = createLogger(config.logLevel);
const app = createApp({ config, log });
const persist = Boolean(config.dataFile) && config.source !== 'demo';

if (persist) {
  const restored = app.store.restore(await loadState(config.dataFile, log));
  if (restored) log.info(`restored ${restored} launches from ${config.dataFile}`);
  app.trackStored();
}

let source;
if (config.source === 'demo') {
  source = startDemo({ onLaunch: app.ingest, rate: config.demoRate, backfillMin: 2 * Math.max(...config.windows) + 5, log });
  // The backfill is complete history, so growth numbers work from the first second.
  app.store.coverageStart = source.status.backfilledFrom;
} else if (config.source === 'pumpportal') {
  if (typeof globalThis.WebSocket !== 'function') {
    log.error(`Live launches need Node 22 or newer, and this is Node ${process.versions.node}. Install the LTS from https://nodejs.org, or run the demo with --demo.`);
    process.exit(1);
  }
  source = startPumpPortal({ url: config.pumpportalUrl, onLaunch: app.ingest, log });
} else {
  log.error(`Unknown SOURCE "${config.source}". Use pumpportal or demo.`);
  process.exit(1);
}
app.setSource(source);

try {
  await app.listen();
} catch (err) {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${config.port} is already taken. Moth is probably running in another window; close that one, or set a different PORT in server/.env.`);
  } else {
    log.error(`could not listen on ${config.host}:${config.port}: ${err.message}`);
  }
  process.exit(1);
}

const mode = app.access.holderMode
  ? `holder mode ($${config.holder.symbol}, min ${config.holder.minBalance})`
  : 'open mode (no HOLDER_MINT, everything unlocked)';
log.info(`Moth is listening on http://localhost:${config.port} — source: ${config.source}, ${mode}`);

let saveTimer = null;
const save = async () => {
  if (!persist) return;
  try {
    await saveState(config.dataFile, app.store.serialize());
  } catch (err) {
    log.warn('could not save launches', { error: err.message });
  }
};
if (persist) saveTimer = setInterval(save, 60_000);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down`);
  clearInterval(saveTimer);
  source.stop();
  await save();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
