// The Chameleonscope engine in a worker thread, so its recompute (up to ~200 ms at the token cap)
// never blocks the site. It posts a snapshot every few seconds and answers token detail requests.

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { createChameleonEngine, createFeedSocketClass } from './engine.mjs';
import { makeReader, seedQuantumPreview } from './snapshot.mjs';

const require = createRequire(import.meta.url);
const { makeViews } = require('./views.cjs');

const quiet = { log() {}, info() {}, warn() {}, debug() {}, error: (...a) => console.error('[chameleon]', ...a) };
const feed = createFeedSocketClass();
const eng = createChameleonEngine({ ...workerData, console: quiet, WebSocket: workerData.pumpFeed ? feed.FeedSocket : undefined });
const live = await eng.start({ gmgnSlow: 3 });
const { TL } = eng;
const V = makeViews(TL);
const reader = makeReader(TL, V, { rows: workerData.rows || 30 });
if (eng.mode === 'demo') seedQuantumPreview(TL);
const { snapshot, detail } = reader;

const post = () => {
  try {
    parentPort.postMessage({ type: 'snapshot', data: snapshot() });
  } catch (err) {
    console.error('[chameleon] snapshot failed:', err.message);
  }
};
parentPort.postMessage({ type: 'started', live });
post();
setInterval(post, workerData.everyMs || 4000);
setInterval(() => eng.flush(), 60_000);

parentPort.on('message', (m) => {
  if (m.type === 'pump') feed.deliver(m.data);
  else if (m.type === 'detail') {
    let data = null;
    try {
      data = detail(m.id);
    } catch (err) {
      data = { error: err.message };
    }
    parentPort.postMessage({ type: 'detail', req: m.req, data });
  } else if (m.type === 'stop') {
    eng.stop();
    process.exit(0);
  }
});
