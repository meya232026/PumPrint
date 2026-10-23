// Kolibri Search on the site: paste an X account (or a single post, or a Telegram
// channel) and get every token they called with the market cap at the call and
// what it did 1 minute, 5 minutes, 1 hour and 24 hours later.
//
// Built from Kolibri's own pieces (call extraction, market resolver, rate-limited
// fetching, SQLite store) with shorter horizons measured on 1-minute candles.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { measure, windowsFor } from './measure.js';
import { resolve, candles, marketKey, supplyFor } from './market.js';
import { groupCalls, applyResult, applyError } from './ledger.js';
import { summarize, counted } from './summary.js';
import { parseQuery, readXProfile, readXPost, readTelegram, historyStart, X_HANDLE } from './sources.js';

const require = createRequire(import.meta.url);
const CFG = require('../../vendor/kolibri/extension/shared/config.js');
const XT = require('../../vendor/kolibri/extension/shared/extract.js');
const L = require('../../vendor/kolibri/extension/shared/ledger.js');
const TG = require('../../vendor/kolibri/extension/shared/telegram-preview.js');
const { Store } = require('../../vendor/kolibri/server/src/db.js');
const { makeNet } = require('../../vendor/kolibri/server/src/net.js');

const MIN = 60_000;

export class LookupError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createKolEngine({ dataDir, env = process.env, log, fetchImpl, demo = false, now = Date.now }) {
  const clock = now;
  const xKey = env.TWITTERAPI_IO_KEY || env.X_BEARER_TOKEN || (demo ? 'demo' : '');
  const xProvider = env.TWITTERAPI_IO_KEY || demo ? 'twitterapi' : env.X_BEARER_TOKEN ? 'xapi' : null;
  const geckoKey = env.COINGECKO_DEMO_KEY || '';
  const historyDays = Number(env.KOL_HISTORY_DAYS || 30);
  const xPages = Number(env.X_LOOKUP_PAGES || (xProvider === 'xapi' ? 2 : 5));
  const xRefreshMin = Number(env.X_REFRESH_MIN || 360);
  // X data is paid per post read: a daily cap on account reads keeps the bill bounded.
  const xDaily = Number(env.X_LOOKUPS_PER_DAY || 500);
  let xDay = { day: '', used: 0 };
  const xLeft = () => {
    const day = new Date(clock()).toISOString().slice(0, 10);
    if (xDay.day !== day) xDay = { day, used: 0 };
    return xDaily - xDay.used;
  };
  const tgRefreshMin = Number(env.COLLECT_EVERY_MIN || 30);
  const limits = {
    ...CFG.RATE_LIMITS,
    'api.geckoterminal.com': Number(env.GECKO_RPM || 9),
    'api.coingecko.com': Number(env.GECKO_RPM || 25),
    'api.twitterapi.io': 120,
    'api.x.com': 40,
    'publish.twitter.com': 60,
  };
  if (demo) for (const h of Object.keys(limits)) limits[h] = 60000;
  const net = makeNet(fetchImpl || fetch, limits, 'Pumprint/1.0');
  const store = new Store(demo ? ':memory:' : env.KOL_DB_PATH || join(dataDir, 'kol.db'));

  // DexScreener answers the same token twice (market, then supply): keep answers briefly.
  const jsonCache = new Map();
  async function fetchJson(url, opts) {
    const cacheable = url.includes('api.dexscreener.com');
    const hit = cacheable && jsonCache.get(url);
    if (hit && clock() - hit.at < 2 * MIN) return hit.body;
    const body = await net.fetchJson(url, opts);
    if (cacheable) {
      jsonCache.set(url, { at: clock(), body });
      if (jsonCache.size > 300) jsonCache.delete(jsonCache.keys().next().value);
    }
    return body;
  }

  let binance = { set: null, at: 0 };
  async function binanceSymbols() {
    if (binance.set && clock() - binance.at < 12 * 3600_000) return binance.set;
    const rows = await net.fetchJson(`${CFG.ENDPOINTS.binance}/ticker/price`);
    binance = { set: new Set((Array.isArray(rows) ? rows : []).map((r) => r.symbol).filter((s) => /USDT$/.test(s))), at: clock() };
    return binance.set;
  }
  const ctx = () => ({ now: clock, fetchJson, binanceSymbols, geckoKey: geckoKey || null });

  // ---------------------------------------------------------------- ledger

  function authorOf(kol) {
    return kol ? { platform: kol.platform, handle: kol.handle, name: kol.name || kol.handle, avatar: kol.avatar || null } : null;
  }

  function scored(key) {
    return store.calls(key).filter((c) => !(c.token && c.token.major));
  }

  function refreshSummary(key) {
    const kol = store.getKol(key);
    if (!kol) return null;
    const entry = { key, author: authorOf(kol), summary: summarize(scored(key), clock()) };
    store.saveSummary(key, kol.platform, entry, clock());
    return entry;
  }

  function ingest(author, posts) {
    const key = L.authorKey(author.platform, author.handle);
    const mentions = [];
    for (const p of posts) {
      if (!Number.isFinite(p.postedAt)) continue;
      const { tokens } = XT.extractTokens(p.text, p.links, { includeMajors: true });
      mentions.push(...L.mentionsFromPost({ postId: p.postId, postedAt: p.postedAt, url: p.url, snippet: XT.snippet(p.text) }, tokens));
    }
    return store.tx(() => {
      store.upsertKol(key, author, clock());
      const added = store.addMentions(key, mentions);
      if (added || !store.calls(key).length) store.replaceCalls(key, groupCalls(store.mentions(key), store.calls(key)));
      refreshSummary(key);
      return { key, added };
    });
  }

  // ---------------------------------------------------------------- pricing

  async function priceOne(key, call) {
    const c = ctx();
    let market = call.market;
    let result;
    let error = null;
    let marketChanged;
    try {
      if (!market) {
        const mk = marketKey(call.token);
        const cached = store.market(mk, clock());
        market = cached !== undefined ? cached : await resolve(call.token, c);
        if (cached === undefined) store.setMarket(mk, market, clock());
        marketChanged = market;
      } else if (!market.supply && market.source === 'dex') {
        market = { ...market, supply: await supplyFor(market, c) };
        marketChanged = market;
      }
      if (!market) {
        result = { status: 'unresolved' };
      } else {
        const w = windowsFor(call.postedAt, clock());
        if (clock() - call.postedAt > CFG.DEX_HISTORY_DAYS * CFG.DAY && market.source === 'dex' && !geckoKey) {
          result = { status: 'too-old' };
        } else {
          const fine = w.fine.to > w.fine.from ? await candles(market, call.postedAt, w.fine.from, w.fine.to, 60, c) : [];
          const coarse = w.coarse ? await candles(market, call.postedAt, w.coarse.from, w.coarse.to, 900, c) : [];
          result = measure({ fine, coarse, postedAtMs: call.postedAt, nowMs: clock(), supply: market.supply });
        }
      }
    } catch (err) {
      error = err;
    }
    store.tx(() => {
      const current = store.calls(key).find((x) => x.id === call.id);
      if (!current) return;
      if (error) {
        if (error.status === 404) applyResult(current, marketChanged, { status: 'unresolved' }, clock());
        else applyError(current, error, clock());
      } else {
        applyResult(current, marketChanged, result, clock());
      }
      store.saveCall(key, current);
      refreshSummary(key);
    });
    if (error && error.status !== 404) log.warn(`kol: price ${key} ${call.id}: ${error.message}`);
  }

  async function priceDue(limit) {
    const due = store.dueCalls(clock(), limit || 4);
    for (const { key, call } of due) await priceOne(key, call);
    return due.length;
  }

  // ---------------------------------------------------------------- collection

  const jobs = new Map();
  const errors = new Map();

  function runJob(key, fn) {
    if (jobs.has(key)) return;
    errors.delete(key);
    const job = (async () => {
      try {
        await fn();
      } catch (err) {
        errors.set(key, friendlyError(err));
        log.warn(`kol: lookup ${key} failed: ${err.message}`);
      } finally {
        jobs.delete(key);
      }
    })();
    jobs.set(key, job);
  }

  async function collectX(handle, { refresh = false } = {}) {
    if (xLeft() <= 0) throw Object.assign(new Error('daily X read limit reached'), { code: 'x_budget' });
    xDay.used += 1;
    const key = L.authorKey('x', handle);
    const known = store.knownPostIds(key);
    const res = await readXProfile(handle, {
      provider: xProvider,
      key: xKey,
      net,
      sinceMs: historyStart(historyDays, clock()),
      maxPages: refresh ? 1 : xPages,
      knownIds: known,
    });
    const out = ingest(res.author, res.posts);
    store.setCollected(out.key, clock());
    return out;
  }

  async function collectTelegram(handle, { refresh = false } = {}) {
    const key = L.authorKey('tg', handle);
    const res = await readTelegram(handle, { net, sinceMs: historyStart(historyDays, clock()), maxPages: refresh ? 3 : 30, knownIds: store.knownPostIds(key) });
    const out = ingest(res.author, res.posts);
    store.setCollected(out.key, clock());
    return out;
  }

  function isFresh(key) {
    const kol = store.getKol(key);
    return Boolean(kol && kol.collectedAt && clock() - kol.collectedAt < 10 * MIN && store.knownPostIds(key).size > 0);
  }

  /**
   * Start reading an account or a single post. Returns { key, platform, handle, postId? }.
   * The work continues in the background; card() reports progress.
   */
  async function lookup(raw, platformHint) {
    const q = parseQuery(raw, platformHint);
    if (!q.handle) throw new LookupError(400, 'empty', 'Paste an X account, an X post link or a Telegram channel.');
    if (q.platform === 'x') {
      if (!X_HANDLE.test(q.handle)) throw new LookupError(400, 'bad_handle', 'X handles are up to 15 letters, digits or underscores.');
      if (q.postId) {
        // One post: read it right away (fast, no key needed) so the card shows it.
        let res;
        try {
          res = await readXPost(q.handle, q.postId, { net });
        } catch (err) {
          throw new LookupError(err.status === 404 ? 404 : 502, 'post_unavailable', err.status === 404 ? 'X has no public post at this link.' : 'Could not read this post from X right now. Try again in a minute.');
        }
        const out = ingest(res.author, res.posts);
        const found = store.calls(out.key).some((c) => c.postId === q.postId);
        return { key: out.key, platform: 'x', handle: res.author.handle, postId: q.postId, noCall: !found };
      }
      const key = L.authorKey('x', q.handle);
      if (!xProvider) {
        // No X data key: only posts pasted as links are known. Show those, and say so.
        if (store.getKol(key) && store.calls(key).length) return { key, platform: 'x', handle: q.handle, limited: true };
        throw new LookupError(501, 'x_unavailable', 'Reading whole X accounts needs an X data key on this server. Paste a link to one of their posts instead, or try a Telegram channel.');
      }
      if (!isFresh(key)) {
        if (xLeft() <= 0 && !jobs.has(key)) {
          throw new LookupError(429, 'x_budget', 'This site has used up today’s X reads. Paste a link to one of their posts instead, or try again tomorrow.');
        }
        runJob(key, async () => {
          const out = await collectX(q.handle);
          store.setTracked(out.key, true);
        });
      }
      return { key, platform: 'x', handle: q.handle };
    }
    if (!TG.isValidUsername(q.handle)) {
      throw new LookupError(400, 'bad_handle', 'Telegram channel names are 5 to 32 letters, digits or underscores and start with a letter.');
    }
    const key = L.authorKey('tg', q.handle);
    if (!isFresh(key)) {
      runJob(key, async () => {
        try {
          const out = await collectTelegram(q.handle);
          store.setTracked(out.key, true);
        } catch (err) {
          if (/no public preview/i.test(String(err.message)) && store.getKol(key)) store.setTracked(key, false);
          throw err;
        }
      });
    }
    return { key, platform: 'tg', handle: q.handle };
  }

  function card(key) {
    const kol = store.getKol(key);
    const collecting = jobs.has(key);
    const error = errors.get(key) || null;
    if (!kol) return collecting || error ? { key, collecting, error, queued: 0, card: null } : null;
    const all = scored(key);
    const queued = all.filter((c) => c.status === 'new' || c.status === 'error').length;
    return {
      key,
      collecting,
      error,
      queued,
      card: { author: authorOf(kol), summary: summarize(all, clock()), calls: all, total: all.filter(counted).length, updatedAt: clock() },
    };
  }

  function leaderboard(platform, limit) {
    return store.leaderboard(platform === 'x' || platform === 'tg' ? platform : null, Math.min(200, limit || 50));
  }

  // ---------------------------------------------------------------- workers

  const timers = [];
  function loop(name, everyMs, fn) {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        await fn();
      } catch (err) {
        log.warn(`kol: ${name}: ${err.message}`);
      } finally {
        busy = false;
      }
    };
    timers.push(setInterval(run, everyMs));
    setTimeout(run, 500);
  }

  function track(platform, handle) {
    const key = L.authorKey(platform, handle);
    if (!store.getKol(key)) store.upsertKol(key, { platform, handle }, clock());
    store.setTracked(key, true);
    return key;
  }

  function start() {
    loop('price', demo ? 300 : 2000, () => priceDue(demo ? 20 : 4));
    loop('collect', MIN, async () => {
      const tgStale = clock() - tgRefreshMin * MIN;
      for (const k of store.tracked('tg')) {
        if (k.collectedAt && k.collectedAt > tgStale) continue;
        try {
          await collectTelegram(k.handle, { refresh: Boolean(k.collectedAt) });
        } catch (err) {
          log.warn(`kol: refresh t.me/${k.handle}: ${err.message}`);
          store.setCollected(k.key, clock());
        }
      }
      if (!xProvider) return;
      const xStale = clock() - xRefreshMin * MIN;
      for (const k of store.tracked('x')) {
        if (k.collectedAt && k.collectedAt > xStale) continue;
        if (xLeft() <= 0) break;
        try {
          await collectX(k.handle, { refresh: Boolean(k.collectedAt) });
        } catch (err) {
          log.warn(`kol: refresh x/${k.handle}: ${err.message}`);
          store.setCollected(k.key, clock());
        }
      }
    });
  }

  function stop() {
    while (timers.length) clearInterval(timers.pop());
  }

  return {
    store,
    lookup,
    card,
    leaderboard,
    track,
    ingest,
    priceDue,
    collectX,
    collectTelegram,
    start,
    stop,
    info: () => ({ x: xProvider, historyDays, xReadsLeft: xProvider ? Math.max(0, xLeft()) : 0, ...store.stats() }),
    close() {
      stop();
      store.close();
    },
  };
}

function friendlyError(err) {
  const msg = String((err && err.message) || err);
  if (err && err.code === 'x_budget') return 'This site has used up today’s X reads. Try again tomorrow.';
  if (/no public preview/i.test(msg)) return 'This channel has no public preview on t.me, so it can’t be read. Only public channels work.';
  if (/user not found/i.test(msg) || err.status === 404) return 'X has no account with this handle, or it is private.';
  if (/HTTP 429/.test(msg)) return 'The data source is rate limiting this site. Try again in a few minutes.';
  if (/HTTP 401|HTTP 403|HTTP 402/.test(msg)) return 'The data source refused the request. The X data key on the server may be missing credit or invalid.';
  if (/abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(msg)) return 'Could not reach the data source. Try again in a minute.';
  return 'Could not read this account right now. Try again later.';
}
