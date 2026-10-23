// What the site takes from Canary (vendor/canary, unchanged upstream source). scripts/build-canary.mjs
// compiles this into server/canary/engine.mjs with "viem" left as an import of ./viem-shim.mjs.
//
// cli.ts and ui/web-board.ts are not part of it: both act at import time (command-line parsing, a
// server of their own, SIGINT handlers). The site runs Canary's reader, rules, store and alert sinks
// from its own watcher loop instead (server/canary/index.js).
export { FixtureReader } from "../../vendor/canary/src/chain/reader.js";
export { PonsV2Reader, ROBINHOOD_CHAIN_ID, DEFAULT_PONS_V2_FACTORY } from "../../vendor/canary/src/chain/rpc.js";
export { evaluate, DEFAULT_THRESHOLDS } from "../../vendor/canary/src/watch/signals.js";
export { Store } from "../../vendor/canary/src/watch/store.js";
export { TelegramSink, Deduped } from "../../vendor/canary/src/alert/sink.js";
export { controlAuthorized } from "../../vendor/canary/src/ui/control-auth.js";
export { loadConfig, isAddress, KeyRefused } from "../../vendor/canary/src/util/env.js";
