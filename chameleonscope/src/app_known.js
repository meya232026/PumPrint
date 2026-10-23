/* Chameleon - known traders (v1.48): the KOLs, influencers and consistently profitable wallets GMGN knows by name, kept as one
   registry for the site and its data service, plus their buys as they happen.
   GMGN's KOL feed (/v1/user/kol) lists the last hundred trades of tagged wallets with the wallet's name, X handle, picture and
   tags (kol, smart_degen, top_followed ...); read every 30 seconds it misses nothing, since a hundred KOL trades take seven or
   eight minutes. Every wallet seen goes into the registry; the data service reads each one's 30-day and 7-day GMGN record and publishes the
   registry (GET /known.json), so a visitor's page knows Cupsey by name before Cupsey trades again. A buy is an alert when the
   trader is in the top tier (GMGN's "top followed" KOLs, or a wallet whose record is in profit over 30 days and over the last
   week), the buy is at least $500, and the token is one the feed shows and would show a person: cleared the gate, not rugged,
   not a big old coin. One alert per trader and token per six hours, two per token per hour.
   v1.49: nothing is pushed unasked. The module marks a buy as qualified (a KOL, top or proven trader, $500+, a shown token) and
   raises the event; who gets told is decided by the reader: the site by K.prefs (cards off until the person turns them on, their
   own threshold and tiers). A person can also watch wallets of their own choice (K.watch): a
   watched wallet's buys are read from the feeds, or from its GMGN activity when the feeds do not carry it, and always qualify. */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store;
  var K = TL.known = { list: {}, trades: [], handlers: {}, started: false, at: 0, feedAt: {}, tried: {}, alerted: {}, remoteAt: 0, canRefresh: false, refreshAt: 0, watch: {}, watchAt: {}, stats: { feeds: 0, trades: 0, alerts: 0 } };
  var KEY = 'tl.known1', TKEY = 'tl.knowntr1', PKEY = 'tl.knownprefs1', WKEY = 'tl.knownwatch1', SOL = 'So11111111111111111111111111111111111111112';
  K.RULE = { minUsd: 500, tiers: ['top', 'proven', 'kol'], watchMinUsd: 100, tokenMinMc: 15000, tokenMinVol1h: 5000, tokenMaxAge: 3 * TL.DAY, perPair: 6 * TL.HR, perTokenHour: 3, perDay: 80,
    feedEvery: { solana: 30 * TL.SEC, robinhood: 60 * TL.SEC }, smartEvery: 90 * TL.SEC, watchEvery: 2 * TL.MIN, watchMax: 8, keep: 24 * TL.HR, maxTrades: 3000, maxWallets: 1200, topFollowers: 20000, statsTtl: 12 * TL.HR };
  // v1.49: what this page shows of it, the person's choice, kept in this browser: cards off until turned on, their threshold and tiers,
  // the panel folded or open, how the trade list is filtered and sorted
  K.prefs = { alerts: false, minUsd: 500, tiers: 'top', notify: false, collapsed: false, side: 'buy', min: 0, mine: false, inFeed: false, sort: 'time' };
  try { var savedPrefs = JSON.parse(localStorage.getItem(PKEY) || 'null'); if (savedPrefs && typeof savedPrefs === 'object') Object.keys(K.prefs).forEach(function (k) { if (savedPrefs[k] !== undefined) K.prefs[k] = savedPrefs[k]; }); } catch (e) {}
  K.savePrefs = function () { try { localStorage.setItem(PKEY, JSON.stringify(K.prefs)); } catch (e) {} };
  try { var savedWatch = JSON.parse(localStorage.getItem(WKEY) || 'null'); if (savedWatch && typeof savedWatch === 'object') K.watch = savedWatch; } catch (e) {}
  K.saveWatch = function () { try { localStorage.setItem(WKEY, JSON.stringify(K.watch)); } catch (e) {} };
  var STABLE = /^(USDC|USDT|USD1|USDS|PYUSD|WSOL|SOL|WETH|ETH)$/i;
  K.TIER = { top: ['Top KOL', 'the most followed KOL wallets on GMGN'], proven: ['Proven', 'in profit over 30 days and over the last week'], kol: ['KOL', 'a known account tagged by GMGN'], smart: ['Smart money', 'tagged smart money by GMGN'], named: ['Named', 'a wallet with a public name'], watch: ['My trader', 'a wallet you chose to watch'] };
  function slug(chain) { return chain === 'robinhood' ? 'robinhood' : 'sol'; }
  function num(v) { var x = U.num(v); return x === null ? null : x; }
  function secs(v) { var x = U.num(v); if (!x || x <= 0) return 0; return x < 1e12 ? x * 1000 : x; }
  function G() { return TL.gmgn; }
  function active() { var g = G(); return !!(g && g.active && g.active() && g.request); }

  // ---------- storage ----------
  K.load = function () {
    var now = U.now();
    try { var raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && raw.list) K.list = raw.list; } catch (e) {}
    try { var tr = JSON.parse(localStorage.getItem(TKEY) || 'null'); if (tr && Array.isArray(tr.trades)) K.trades = tr.trades.filter(function (x) { return x && x.h && U.isNum(x.at) && now - x.at < K.RULE.keep; }); } catch (e) {}
    K.alerted = {}; K.trades.forEach(function (x) { if (x.alerted) K.alerted[x.chain + ':' + x.wallet + ':' + x.token] = x.at; });
  };
  var saveTimer = null;
  K.save = function (force) { if (force) { flush(); return; } if (saveTimer) return; saveTimer = setTimeout(flush, 2000); };
  function flush() {
    saveTimer = null; var now = U.now();
    K.trades = K.trades.filter(function (x) { return now - x.at < K.RULE.keep; }); if (K.trades.length > K.RULE.maxTrades) K.trades = K.trades.slice(-K.RULE.maxTrades);
    var ids = Object.keys(K.list); if (ids.length > K.RULE.maxWallets) ids.sort(function (a, b) { return (K.list[a].lastSeen || 0) - (K.list[b].lastSeen || 0); }).slice(0, ids.length - K.RULE.maxWallets).forEach(function (id) { delete K.list[id]; });
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, at: now, list: K.list })); } catch (e) {}
    try { localStorage.setItem(TKEY, JSON.stringify({ v: 1, at: now, trades: K.trades })); } catch (e) {}
  }
  K.load();

  // ---------- events ----------
  K.on = function (evt, fn) { (K.handlers[evt] = K.handlers[evt] || []).push(fn); return K; };
  K.emit = function (evt) { var args = Array.prototype.slice.call(arguments, 1); (K.handlers[evt] || []).forEach(function (fn) { try { fn.apply(null, args); } catch (e) { try { console.warn('[chameleon] known handler', evt, e); } catch (e2) {} } }); };

  // ---------- the registry ----------
  K.get = function (chain, addr) { return addr ? (K.list[chain + ':' + (chain === 'robinhood' ? String(addr).toLowerCase() : String(addr))] || null) : null; };
  K.note = function (chain, addr, info, now) {
    if (!addr) return null; now = now || U.now();
    var a = chain === 'robinhood' ? String(addr).toLowerCase() : String(addr), id = chain + ':' + a, e = K.list[id];
    if (!e) e = K.list[id] = { id: id, chain: chain, address: a, name: '', twitter: '', avatar: '', tags: [], src: {}, firstSeen: now, lastSeen: 0, trades: 0, buys: 0, usd: 0, tokens: {}, stats: null, stats7: null, statsAt: 0, followers: null, verified: false, consistent: null, score: null };
    info = info || {};
    if (info.name && !e.name) e.name = String(info.name).slice(0, 40); if (info.twitter && !e.twitter) e.twitter = String(info.twitter).replace(/^@/, '').slice(0, 30); if (info.avatar && /^https?:/.test(String(info.avatar))) e.avatar = String(info.avatar);
    (info.tags || []).forEach(function (t) { t = String(t || '').toLowerCase(); if (t && e.tags.indexOf(t) < 0) e.tags.push(t); });
    if (info.src) e.src[info.src] = 1;
    if (U.isNum(info.followers)) e.followers = info.followers; if (info.verified) e.verified = true;
    if (U.isNum(info.at) && info.at > e.lastSeen) e.lastSeen = info.at;
    e.tier = K.tierOf(e);
    return e;
  };
  K.tierOf = function (e) {
    if (!e) return '';
    var tags = e.tags || [], has = function (t) { return tags.indexOf(t) >= 0; };
    if (has('top_followed') || (U.isNum(e.followers) && e.followers >= K.RULE.topFollowers)) return 'top';
    if (e.consistent && e.consistent.ok) return 'proven';
    if (has('kol') || has('renowned')) return 'kol';
    if (has('smart_degen') || has('smart_money')) return 'smart';
    if (e.name || e.twitter) return 'named';
    return '';
  };
  K.label = function (e) { return e ? (e.name || (e.twitter ? '@' + e.twitter : U.short(e.address))) : ''; };
  K.alertTier = function (e) { return !!(e && K.RULE.tiers.indexOf(e.tier || K.tierOf(e)) >= 0); };
  // the registry as a list: the tiers first, then the freshest
  K.all = function (chain) {
    var rank = { top: 0, proven: 1, kol: 2, smart: 3, named: 4, '': 5 };
    return Object.keys(K.list).map(function (id) { return K.list[id]; }).filter(function (e) { return !chain || e.chain === chain; })
      .sort(function (a, b) { return (rank[a.tier || ''] - rank[b.tier || '']) || ((b.score || 0) - (a.score || 0)) || (b.lastSeen - a.lastSeen); });
  };
  // v1.48: a record read for a wallet (SM.readStats shape) folded into the registry, the way the data service does it and the page reads it back
  K.applyStats = function (e, st30, st7) {
    if (!e) return;
    var SM = TL.smart, pick = function (s) { return s ? Object.assign({}, s) : null; }; // the whole SM.readStats record: the board scores it the same way it scores its own reads
    e.stats = pick(st30); e.stats7 = pick(st7); e.statsAt = U.now();
    if (st30) { if (st30.name && !e.name) e.name = st30.name; if (st30.twitter && !e.twitter) e.twitter = st30.twitter; if (st30.avatar && !e.avatar) e.avatar = st30.avatar; if (U.isNum(st30.followers)) e.followers = st30.followers; if (st30.verified) e.verified = true; (st30.tags || []).forEach(function (t) { if (e.tags.indexOf(t) < 0) e.tags.push(t); }); }
    if (SM && SM.consistent) e.consistent = SM.consistent(st7 || null, st30 || null);
    var sc = SM && SM.score && st30 ? SM.score(st30, '30d') : null; e.score = sc ? sc.value : null;
    e.tier = K.tierOf(e);
  };

  // ---------- the feeds ----------
  function tradeOf(chain, tr, kind) {
    var mi = tr.maker_info || {}, bt = tr.base_token || {}, sym = String(bt.symbol || '');
    var token = tr.base_address || ''; if (!token || token === SOL || STABLE.test(sym)) return null;
    return { h: String(tr.transaction_hash || (tr.maker + ':' + tr.timestamp)), at: secs(tr.timestamp) || U.now(), chain: chain, wallet: tr.maker, side: String(tr.side || '').toLowerCase() === 'sell' ? 'sell' : 'buy', usd: num(tr.amount_usd) || 0, price: num(tr.price_usd),
      token: chain === 'robinhood' ? token.toLowerCase() : token, symbol: sym, logo: bt.logo || '', pad: String(bt.launchpad || ''), kind: kind, full: String(tr.is_open_or_close) === '1',
      info: { name: mi.name || mi.twitter_name || '', twitter: mi.twitter_username || '', avatar: mi.avatar || '', tags: (mi.tags || []).concat(kind === 'kol' ? ['kol'] : []) } };
  }
  K.readFeed = function (chain, kind) {
    var g = G(); if (!active()) return Promise.resolve(0);
    var key = kind + 'feed:' + chain;
    return g.request('GET', '/v1/user/' + kind, { chain: slug(chain), limit: 100 }, null, 1, { prio: 2, ttl: 20000, key: key }).then(function (d) {
      var list = Array.isArray(d) ? d : (d && d.list) || [], seen = {}, fresh = [], now = U.now();
      K.trades.forEach(function (x) { seen[x.h] = 1; });
      K.stats.feeds++;
      list.forEach(function (tr) {
        var x = tradeOf(chain, tr, kind); if (!x) return;
        var e = K.note(chain, x.wallet, { name: x.info.name, twitter: x.info.twitter, avatar: x.info.avatar, tags: x.info.tags, src: kind, at: x.at }, now);
        if (kind === 'smartmoney' && !(e.name || e.twitter) && e.tier !== 'proven') return; // the smart-money feed is mostly nameless bots: a nameless one is not a known trader (its record can still make it one)
        if (seen[x.h]) return; seen[x.h] = 1;
        delete x.info; x.name = e.name; x.tw = e.twitter;
        e.trades++; if (x.side === 'buy') { e.buys++; e.usd += x.usd; } e.tokens[x.token] = x.at;
        var tk = Object.keys(e.tokens); if (tk.length > 60) tk.sort(function (p, q) { return e.tokens[p] - e.tokens[q]; }).slice(0, tk.length - 60).forEach(function (k) { delete e.tokens[k]; });
        K.trades.push(x); fresh.push(x);
      });
      if (fresh.length) { K.stats.trades += fresh.length; fresh.sort(function (p, q) { return p.at - q.at; }); fresh.forEach(function (x) { K.consider(x); }); }
      K.at = now; K.lastFresh = fresh; K.save(); K.emit('change');
      return fresh.length;
    }).catch(function (e) { try { console.info('[chameleon] known feed', chain, kind, e && e.message); } catch (e2) {} return 0; });
  };
  // ---------- a buy worth telling: the rule ----------
  // '' = alert; a reason otherwise; {defer: true} = the token is not known yet and is being read (judged again on the next pass)
  K.judge = function (x, now) {
    now = now || U.now(); var R = K.RULE, watched = K.watching(x.chain, x.wallet);
    if (x.side !== 'buy') return 'a sell';
    if (!(x.usd >= (watched ? R.watchMinUsd : R.minUsd))) return 'only ' + U.fmtUsd(x.usd);
    var e = K.get(x.chain, x.wallet); if (!e && !watched) return 'unknown wallet';
    if (!watched && !K.alertTier(e)) return 'not a KOL, top or proven trader (' + (e.tier || 'untiered') + ')';
    if (now - x.at > 20 * TL.MIN) return 'an old trade';
    var pair = x.chain + ':' + x.wallet + ':' + x.token; if (K.alerted[pair] && now - K.alerted[pair] < R.perPair) return 'told ' + U.fmtAge(now - K.alerted[pair]) + ' ago';
    var hour = K.trades.filter(function (y) { return y.alerted && y.chain === x.chain && y.token === x.token && now - y.at < TL.HR; }).length; if (hour >= R.perTokenHour) return 'this token had ' + hour + ' alerts this hour';
    var day = K.trades.filter(function (y) { return y.alerted && now - y.at < TL.DAY; }).length; if (day >= R.perDay) return R.perDay + ' alerts today already';
    var t = store.get(x.chain + ':' + x.token);
    if (!t || !t.ready || !TL.checked(t)) {
      if (!active() || K.tried[x.chain + ':' + x.token]) return watched ? '' : 'a token the feed does not know'; // a watched wallet's buy is told whatever the token
      K.tried[x.chain + ':' + x.token] = now;
      var tk = store.upsert({ chain: x.chain, address: x.token, symbol: x.symbol || undefined, logo: x.logo || undefined });
      G().pollToken(tk, true).then(function () { var t2 = store.get(x.chain + ':' + x.token); if (t2 && TL.ui && TL.ui.markDirty) TL.ui.markDirty(t2); K.consider(x); }, function () { if (watched) K.consider(x); });
      return { defer: true };
    }
    if (watched) return '';
    if (t.top) return 'a big coin everyone can see';
    if (t.demo || t.partial) return 'not a live token';
    TL.ensureVet(t);
    if (t.verdict === 'RUGGED' || t.verdict === 'AVOID') return 'the token reads ' + t.verdict;
    if (t._hide) return 'the feed hides it: ' + t._hide;
    if (!(U.isNum(t.mc) && t.mc >= R.tokenMinMc)) return 'cap ' + U.fmtUsd(t.mc) + ', under ' + U.fmtUsd(R.tokenMinMc);
    var v1 = t.vol && (U.isNum(t.vol.h1) ? t.vol.h1 : (U.isNum(t.vol.m5) ? t.vol.m5 * 12 : null)); if (v1 !== null && v1 !== undefined && v1 < R.tokenMinVol1h) return 'only ' + U.fmtUsd(v1) + ' traded in the last hour';
    if (U.isNum(t.createdAt) && now - t.createdAt > R.tokenMaxAge) return 'older than ' + Math.round(R.tokenMaxAge / TL.DAY) + ' days';
    return '';
  };
  K.consider = function (x) {
    if (x.alerted || x.judged === 'done') return;
    var now = U.now(), why = K.judge(x, now);
    if (why && why.defer) { x.judged = 'defer'; return; }
    x.judged = 'done'; x.why = why || '';
    if (why) return;
    var e = K.get(x.chain, x.wallet) || K.note(x.chain, x.wallet, { name: x.name, twitter: x.tw, src: 'watch', at: x.at }), t = store.get(x.chain + ':' + x.token) || { chain: x.chain, address: x.token, symbol: x.symbol, name: '', logo: x.logo, unknown: true };
    x.alerted = now; x.tier = K.watching(x.chain, x.wallet) ? 'watch' : (e.tier || ''); K.alerted[x.chain + ':' + x.wallet + ':' + x.token] = now; K.stats.alerts++;
    var rec = K.event(x, e, t);
    try { console.info('[chameleon] KNOWN BUY', e && K.label(e), U.fmtUsd(x.usd), t.symbol, 'at', U.fmtUsd(t.mc)); } catch (e2) {}
    K.save();
    K.emit('buy', rec);
  };
  K.event = function (x, e, t) {
    var others = K.inside(t).filter(function (o) { return o.wallet !== x.wallet; });
    var earlier = K.trades.some(function (y) { return y !== x && y.chain === x.chain && y.wallet === x.wallet && y.token === x.token && y.side === 'buy' && y.at < x.at; });
    var watched = K.watching(x.chain, x.wallet);
    return { id: x.h, at: x.at, chain: x.chain, wallet: x.wallet, name: watched && K.watch[x.chain + ':' + x.wallet].name ? K.watch[x.chain + ':' + x.wallet].name : K.label(e), twitter: e.twitter || '', avatar: e.avatar || '', tier: e.tier || '', watched: watched, tags: e.tags.slice(0, 8), score: e.score, stats: e.stats, usd: x.usd, firstBuy: !earlier, unknownToken: !!t.unknown,
      token: t.address, symbol: t.symbol || x.symbol, tokenName: t.name || '', mc: t.mc, holders: t.holders, verdict: t.verdict, pot: U.isNum(t._pot) ? Math.round(t._pot) : null, chg1h: t.chg && t.chg.h1, vol1h: t.vol && t.vol.h1, logo: t.logoOk || t.logo || x.logo || '', createdAt: t.createdAt, graduated: !!t.complete,
      others: others.slice(0, 5).map(function (o) { return { name: o.name, tier: o.tier, usd: o.usd }; }), othersN: others.length };
  };
  // the known traders inside a token: their buys in the last 24 hours from the feed, plus GMGN's own list of the KOL wallets that
  // traded it (K.readInside, when the page asked for it), one row per wallet, the best-known first
  K.inside = function (t, sinceMs) {
    if (!t) return []; var now = U.now(), keep = sinceMs || K.RULE.keep, by = {};
    K.trades.forEach(function (x) {
      if (x.chain !== t.chain || x.token !== t.address || now - x.at > keep) return;
      var e = K.get(x.chain, x.wallet), w = K.watching(x.chain, x.wallet); if (!w && (!e || !(e.name || e.twitter || e.tier === 'proven' || e.tier === 'top'))) return;
      var r = by[x.wallet] || (by[x.wallet] = { wallet: x.wallet, name: w && K.watch[x.chain + ':' + x.wallet].name ? K.watch[x.chain + ':' + x.wallet].name : (e ? K.label(e) : U.short(x.wallet)), twitter: e ? e.twitter : '', avatar: e ? e.avatar : '', tier: w ? 'watch' : (e ? e.tier : ''), usd: 0, sold: 0, buys: 0, sells: 0, first: x.at, last: x.at, src: 'feed' });
      if (x.side === 'buy') { r.usd += x.usd; r.buys++; } else { r.sold += x.usd; r.sells++; }
      if (x.at < r.first) r.first = x.at; if (x.at > r.last) r.last = x.at;
    });
    ((t.knownIn && t.knownIn.list) || []).forEach(function (g) {
      var r = by[g.wallet];
      if (!r) { by[g.wallet] = Object.assign({}, g); return; }
      r.hold = g.hold; r.soldOut = g.soldOut; r.profit = g.profit; if (g.usd > r.usd) r.usd = g.usd; if (g.sold > r.sold) r.sold = g.sold; if (g.first && (!r.first || g.first < r.first)) r.first = g.first;
    });
    var rank = { watch: -1, top: 0, proven: 1, kol: 2, smart: 3, named: 4, '': 5 };
    return Object.keys(by).map(function (w) { return by[w]; }).sort(function (a, b) { return (rank[a.tier || ''] - rank[b.tier || '']) || (b.usd - a.usd); });
  };
  // GMGN's list of the KOL wallets that traded a token (token_top_traders with tag=renowned, weight 5): what the feed missed
  // before this page started reading it. Asked once per five minutes per token, only where a page or a report needs it.
  K.readInside = function (t, force) {
    if (!t || t.demo || t.partial || !active()) return Promise.resolve(null);
    var now = U.now();
    if (!force && t.knownIn && now - t.knownIn.at < 5 * TL.MIN) return Promise.resolve(t.knownIn);
    if (!force && t._knownAsk && now - t._knownAsk < 60 * TL.SEC) return Promise.resolve(t.knownIn || null);
    t._knownAsk = now;
    return G().request('GET', '/v1/market/token_top_traders', { chain: slug(t.chain), address: t.address, limit: 40, tag: 'renowned', order_by: 'buy_volume_cur', direction: 'desc' }, null, 5, { prio: 4, ttl: 120000, key: 'renowned:' + t.id }).then(function (d) {
      var list = Array.isArray(d) ? d : (d && d.list) || [];
      var rows = list.filter(function (h) { return h && h.address; }).map(function (h) {
        var e = K.note(t.chain, h.address, { name: h.name || h.twitter_name, twitter: h.twitter_username, avatar: h.avatar, tags: (h.tags || []).concat(['kol']), src: 'token', at: secs(h.last_active_timestamp) || now }, now);
        var sp = num(h.sell_amount_percentage);
        return { wallet: e.address, name: K.label(e), twitter: e.twitter, avatar: e.avatar, tier: e.tier, usd: num(h.buy_volume_cur) || 0, sold: num(h.sell_volume_cur) || 0, hold: num(h.usd_value) || 0, profit: num(h.profit), soldOut: sp !== null && sp >= 0.98, buys: num(h.buy_tx_count_cur) || 0, sells: num(h.sell_tx_count_cur) || 0, first: secs(h.start_holding_at), last: secs(h.last_active_timestamp), src: 'gmgn' };
      });
      t.knownIn = { at: now, list: rows }; K.save(); K.emit('change');
      return t.knownIn;
    }).catch(function () { if (!t.knownIn) t.knownIn = { at: now, list: [], failed: true }; return t.knownIn; });
  };
  // the latest buys of known traders, the qualified ones first
  K.recentBuys = function (chain, n, sinceMs) {
    var now = U.now();
    return K.trades.filter(function (x) { return x.side === 'buy' && (!chain || x.chain === chain) && (!sinceMs || now - x.at < sinceMs) && (x.name || x.tw || K.watching(x.chain, x.wallet)); })
      .sort(function (a, b) { return (b.alerted ? 1 : 0) - (a.alerted ? 1 : 0) || b.at - a.at; }).slice(0, n || 30);
  };
  // v1.49: the trade list as the page filters it: buys or everything, a minimum size, only my traders, only tokens the feed shows, newest or biggest first
  K.tradeList = function (chain, opts, n) {
    opts = opts || {}; var now = U.now();
    var rows = K.trades.filter(function (x) {
      if (chain && x.chain !== chain) return false; if (now - x.at > (opts.sinceMs || K.RULE.keep)) return false;
      if (!(x.name || x.tw || K.watching(x.chain, x.wallet))) return false;
      if (opts.side === 'buy' && x.side !== 'buy') return false;
      if (opts.min && x.usd < opts.min) return false;
      if (opts.mine && !K.watching(x.chain, x.wallet)) return false;
      if (opts.inFeed) { var t = store.get(x.chain + ':' + x.token); if (!t || !t.ready || t.top) return false; }
      return true;
    });
    rows.sort(opts.sort === 'usd' ? function (a, b) { return b.usd - a.usd || b.at - a.at; } : function (a, b) { return b.at - a.at; });
    return rows.slice(0, n || 40);
  };
  // what happened to the token since a trade: the cap now against the price at the trade, or the verdict when it is over
  K.since = function (x) {
    var t = store.get(x.chain + ':' + x.token); if (!t) return null;
    var out = { t: t, verdict: t.verdict, x: null };
    if (U.isNum(x.price) && x.price > 0 && U.isNum(t.price) && t.price > 0) out.x = t.price / x.price;
    return out;
  };
  // ---------- v1.49: my traders: wallets the person chose to watch ----------
  K.watching = function (chain, addr) { return !!(addr && K.watch[chain + ':' + (chain === 'robinhood' ? String(addr).toLowerCase() : String(addr))]); };
  K.addWatch = function (chain, addr, name) {
    addr = chain === 'robinhood' ? String(addr || '').toLowerCase() : String(addr || ''); if (!addr) return null;
    if (Object.keys(K.watch).length >= K.RULE.watchMax && !K.watch[chain + ':' + addr]) return null;
    var e = K.get(chain, addr);
    K.watch[chain + ':' + addr] = { chain: chain, address: addr, name: String(name || (e ? K.label(e) : '') || '').slice(0, 40), at: U.now() };
    K.saveWatch(); K.watchAt[chain + ':' + addr] = 0; K.emit('change');
    return K.watch[chain + ':' + addr];
  };
  K.removeWatch = function (chain, addr) { addr = chain === 'robinhood' ? String(addr || '').toLowerCase() : String(addr || ''); delete K.watch[chain + ':' + addr]; K.saveWatch(); K.emit('change'); };
  K.watched = function (chain) { return Object.keys(K.watch).map(function (k) { return K.watch[k]; }).filter(function (w) { return !chain || w.chain === chain; }).sort(function (a, b) { return b.at - a.at; }); };
  // a watched wallet the feeds do not carry is read from its own GMGN activity (weight 3), every two minutes while the page is open
  K.pollWatch = function () {
    if (!active()) return Promise.resolve(0);
    var g = G(), now = U.now(), jobs = [];
    K.watched().forEach(function (w) {
      var e = K.get(w.chain, w.address);
      if (e && (e.src.kol || e.src.smartmoney) && now - e.lastSeen < TL.DAY) return; // the feeds carry it: nothing to poll
      if (now - (K.watchAt[w.chain + ':' + w.address] || 0) < K.RULE.watchEvery) return;
      K.watchAt[w.chain + ':' + w.address] = now;
      jobs.push(g.walletActivity(w.chain, w.address, 20).then(function (list) {
        var seen = {}; K.trades.forEach(function (x) { seen[x.h] = 1; }); var fresh = [];
        // v1.50: a swap routed through a middle token is two records with one hash; the middle token is the other's quote and is not a trade of its own
        var byHash = {}; (list || []).forEach(function (a) { var hh = String(a.tx_hash || a.transaction_hash || ''); (byHash[hh] = byHash[hh] || []).push(a); });
        (list || []).forEach(function (a) {
          var type = String(a.event_type || a.type || '').toLowerCase(); if (type !== 'buy' && type !== 'sell') return;
          var tk = a.token || {}; var token = tk.address || ''; if (!token || token === SOL || STABLE.test(String(tk.symbol || ''))) return;
          var hh = String(a.tx_hash || a.transaction_hash || ''); if ((byHash[hh] || []).some(function (o) { return o !== a && String(o.quote_address || '') === token; })) return;
          var h = hh + (byHash[hh] && byHash[hh].length > 1 ? ':' + token : '') || (w.address + ':' + a.timestamp); if (seen[h]) return; seen[h] = 1;
          var x = { h: h, at: secs(a.timestamp) || now, chain: w.chain, wallet: w.address, side: type, usd: num(a.cost_usd) || 0, price: num(a.price_usd), token: w.chain === 'robinhood' ? token.toLowerCase() : token, symbol: String(tk.symbol || ''), logo: tk.logo || '', pad: String(a.launchpad_platform || ''), kind: 'watch', name: w.name, tw: '' };
          var ee = K.note(w.chain, w.address, { name: w.name, src: 'watch', at: x.at }, now); ee.trades++; if (x.side === 'buy') { ee.buys++; ee.usd += x.usd; }
          K.trades.push(x); fresh.push(x);
        });
        if (!K.watchSeen[w.chain + ':' + w.address]) { K.watchSeen[w.chain + ':' + w.address] = 1; fresh.forEach(function (x) { x.judged = 'done'; x.why = 'before the watch began'; }); } // the first read is history, not news
        else fresh.sort(function (p, q) { return p.at - q.at; }).forEach(function (x) { K.consider(x); });
        if (fresh.length) { K.lastFresh = (K.lastFresh || []).concat(fresh); K.save(); K.emit('change'); }
        return fresh.length;
      }).catch(function () { return 0; }));
    });
    return Promise.all(jobs).then(function (r) { return r.reduce(function (a, b) { return a + b; }, 0); });
  };
  K.watchSeen = {};
  K.alerts = function (chain, n) { return K.trades.filter(function (x) { return x.alerted && (!chain || x.chain === chain); }).sort(function (a, b) { return b.at - a.at; }).slice(0, n || 30); };

  // ---------- the records: the data service reads them (K.canRefresh), a page reads its copy ----------
  K.refresh = function (n) {
    var g = G(), SM = TL.smart; if (!K.canRefresh || !active() || !SM || !SM.readStats) return Promise.resolve(0);
    var now = U.now(), R = K.RULE;
    var due = K.all().filter(function (e) { return (e.name || e.twitter || e.tags.indexOf('kol') >= 0 || e.tags.indexOf('top_followed') >= 0) && now - (e.statsAt || 0) > R.statsTtl && now - e.lastSeen < 3 * TL.DAY; }).slice(0, n || 3);
    if (!due.length) return Promise.resolve(0);
    return Promise.all(due.map(function (e) {
      return g.walletStat(e.chain, e.address, '30d').then(function (x) { var st30 = SM.readStats(x); return g.walletStat(e.chain, e.address, '7d').then(function (y) { return [st30, SM.readStats(y)]; }, function () { return [st30, null]; }); })
        .then(function (r) { K.applyStats(e, r[0], r[1]); }, function () { e.statsAt = now - R.statsTtl + TL.HR; }); // a failed read is asked again in an hour, not at once
    })).then(function () { K.save(); K.emit('change'); return due.length; });
  };

  // ---------- the data service's copy for every visitor ----------
  K.export = function () {
    var now = U.now();
    var slim = function (e) { // what a visitor's page needs: identity, tier, the record; not the token map or the source flags
      var st = function (s) { return s ? { realized: s.realized, roi: s.roi, winrate: s.winrate, tokens: s.tokens, trades: s.trades, cost: s.cost, buys: s.buys, avgHold: s.avgHold, lastActive: s.lastActive, dist: s.dist, followers: s.followers, verified: s.verified, createdTokens: s.createdTokens, created: s.created, tags: s.tags } : null; };
      return { id: e.id, chain: e.chain, address: e.address, name: e.name, twitter: e.twitter, avatar: e.avatar, tags: e.tags.slice(0, 12), tier: e.tier, firstSeen: e.firstSeen, lastSeen: e.lastSeen, trades: e.trades, buys: e.buys, usd: Math.round(e.usd || 0), stats: st(e.stats), stats7: st(e.stats7), statsAt: e.statsAt, consistent: e.consistent, score: e.score, followers: e.followers, verified: e.verified };
    };
    var wallets = K.all().filter(function (e) { return (e.name || e.twitter || e.tier === 'proven') && (now - e.lastSeen < 7 * TL.DAY || e.stats); }).slice(0, 400).map(slim);
    var trades = K.trades.filter(function (x) { return (x.name || x.tw) && now - x.at < K.RULE.keep; }).slice(-600).map(function (x) { return { h: x.h, at: x.at, chain: x.chain, wallet: x.wallet, side: x.side, usd: Math.round(x.usd), price: x.price, token: x.token, symbol: x.symbol, logo: x.logo, pad: x.pad, name: x.name, tw: x.tw, alerted: x.alerted || 0, tier: x.tier || '', why: x.why || '' }; });
    return { v: 1, at: now, wallets: wallets, trades: trades };
  };
  // v1.59: a remote record (the data service's known.json, or any URL a test points at) is taken field by field: addresses of the right shape,
  // numbers as numbers, text as bounded text; anything else is dropped. No key may be __proto__ or the like
  var ADDR_RE = /^(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{6,64})$/, SAFE_KEY = /^[A-Za-z0-9:_.-]{1,80}$/;
  function txt(v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, n || 80) : ''; }
  function numOr(v, d) { return U.isNum(v) ? v : d; }
  function cleanWallet(r) {
    if (!r || typeof r !== 'object') return null;
    var chain = r.chain === 'robinhood' ? 'robinhood' : r.chain === 'solana' ? 'solana' : null, address = txt(r.address, 64);
    if (!chain || !ADDR_RE.test(address) || r.id !== chain + ':' + address || !SAFE_KEY.test(r.id)) return null;
    var out = { id: r.id, chain: chain, address: address, name: txt(r.name, 60), twitter: txt(r.twitter, 30).replace(/[^A-Za-z0-9_]/g, ''), avatar: /^https:\/\/[^\s"'<>]{1,300}$/.test(r.avatar || '') ? r.avatar : '', tags: (Array.isArray(r.tags) ? r.tags : []).map(function (t) { return txt(t, 24); }).filter(Boolean).slice(0, 12), tier: txt(r.tier, 16), firstSeen: numOr(r.firstSeen, 0), lastSeen: numOr(r.lastSeen, 0), trades: numOr(r.trades, 0), buys: numOr(r.buys, 0), usd: numOr(r.usd, 0), statsAt: numOr(r.statsAt, 0), consistent: !!r.consistent, score: numOr(r.score, 0), followers: numOr(r.followers, 0), verified: !!r.verified };
    if (r.stats && typeof r.stats === 'object') out.stats = r.stats; if (r.stats7 && typeof r.stats7 === 'object') out.stats7 = r.stats7;
    return out;
  }
  function cleanTrade(x) {
    if (!x || typeof x !== 'object') return null;
    var chain = x.chain === 'robinhood' ? 'robinhood' : x.chain === 'solana' ? 'solana' : null, wallet = txt(x.wallet, 64), token = txt(x.token, 64), h = txt(x.h, 120);
    if (!chain || !ADDR_RE.test(wallet) || !ADDR_RE.test(token) || !h || !U.isNum(x.at) || !SAFE_KEY.test(h)) return null;
    return { h: h, at: x.at, chain: chain, wallet: wallet, side: x.side === 'sell' ? 'sell' : 'buy', usd: numOr(x.usd, 0), price: numOr(x.price, null), token: token, symbol: txt(x.symbol, 24), logo: /^https:\/\/[^\s"'<>]{1,300}$/.test(x.logo || '') ? x.logo : '', pad: txt(x.pad, 24), name: txt(x.name, 60), tw: txt(x.tw, 30).replace(/[^A-Za-z0-9_]/g, ''), tier: txt(x.tier, 16), why: txt(x.why, 160), mc: numOr(x.mc, null), judged: 'done', kind: 'remote', alerted: numOr(x.alerted, 0), first: !!x.first, ago: numOr(x.ago, null), pnl: numOr(x.pnl, null) };
  }
  K.merge = function (data) {
    if (!data || !Array.isArray(data.wallets)) return 0;
    var n = 0, now = U.now();
    data.wallets.forEach(function (raw) {
      var r = cleanWallet(raw); if (!r) return;
      var e = K.list[r.id];
      if (!e) { e = K.list[r.id] = Object.assign({ tokens: {}, src: {}, tags: [] }, r); n++; }
      else {
        if (r.name && !e.name) e.name = r.name; if (r.twitter && !e.twitter) e.twitter = r.twitter; if (r.avatar && !e.avatar) e.avatar = r.avatar;
        (r.tags || []).forEach(function (t) { if (e.tags.indexOf(t) < 0) e.tags.push(t); });
        if ((r.statsAt || 0) > (e.statsAt || 0)) { e.stats = r.stats; e.stats7 = r.stats7; e.statsAt = r.statsAt; e.consistent = r.consistent; e.score = r.score; e.followers = r.followers; e.verified = r.verified; }
        if ((r.lastSeen || 0) > (e.lastSeen || 0)) e.lastSeen = r.lastSeen; if ((r.trades || 0) > (e.trades || 0)) { e.trades = r.trades; e.buys = r.buys; e.usd = r.usd; }
      }
      e.tier = K.tierOf(e);
    });
    var seen = {}; K.trades.forEach(function (x) { seen[x.h] = 1; });
    (Array.isArray(data.trades) ? data.trades : []).forEach(function (raw) { var x = cleanTrade(raw); if (!x || seen[x.h] || now - x.at > K.RULE.keep) return; seen[x.h] = 1; K.trades.push(x); if (x.alerted) K.alerted[x.chain + ':' + x.wallet + ':' + x.token] = x.alerted; });
    K.trades.sort(function (a, b) { return a.at - b.at; });
    K.remoteAt = data.at || now; K.save(); K.emit('change');
    return n;
  };
  K.pullRemote = function (url) {
    if (!url) return Promise.resolve(0);
    return U.timeoutFetch(url, 8000).then(function (d) { return K.merge(d); }).catch(function () { return 0; });
  };

  // ---------- the clock ----------
  K.tick = function () {
    var now = U.now(); if (!store._booted || !active()) return;
    if (typeof document !== 'undefined' && document.hidden && now - K.at < 5 * TL.MIN) return; // a background tab reads the feed at a fifth of the pace
    ['solana', 'robinhood'].forEach(function (chain) {
      var every = K.RULE.feedEvery[chain] || 60 * TL.SEC, last = K.feedAt[chain] || 0;
      if (now - last < every) return; K.feedAt[chain] = now;
      K.readFeed(chain, 'kol');
      if (chain === 'solana' && now - (K.feedAt.smart || 0) >= K.RULE.smartEvery) { K.feedAt.smart = now; K.readFeed(chain, 'smartmoney'); }
    });
    K.trades.forEach(function (x) { if (x.judged === 'defer' && !x.alerted && now - x.at < 20 * TL.MIN) K.consider(x); });
    if (Object.keys(K.watch).length) K.pollWatch();
    if (K.canRefresh && now - K.refreshAt > 60 * TL.SEC) { K.refreshAt = now; K.refresh(3); }
  };
  K.start = function (ms) {
    if (K.started) return; K.started = true;
    setInterval(function () { try { K.tick(); } catch (e) { try { console.warn('[chameleon] known tick', e); } catch (e2) {} } }, ms || 10 * TL.SEC);
    setTimeout(function () { try { K.tick(); } catch (e) {} }, 2500);
  };
  // v1.49: does this page want to show a qualified buy as a card? The person's own traders always; the rest by their preferences
  K.wanted = function (rec) {
    var P = K.prefs; if (rec.watched) return true;
    if (!P.alerts) return false;
    if (!(rec.usd >= (P.minUsd || 0))) return false;
    if (P.tiers !== 'kol' && rec.tier !== 'top' && rec.tier !== 'proven') return false;
    return true;
  };
  // the badge text for a token row: the best-known trader inside and how many more
  K.rowBadge = function (t) {
    var ins = K.inside(t); if (!ins.length) return null;
    return { label: (ins[0].tier === 'watch' ? '★ ' : '') + ins[0].name + (ins.length > 1 ? ' +' + (ins.length - 1) : ''), tier: ins[0].tier, title: ins.slice(0, 6).map(function (o) { return o.name + ' (' + (K.TIER[o.tier] ? K.TIER[o.tier][0] : 'wallet') + '): bought ' + U.fmtUsd(o.usd) + (o.sold ? ', sold ' + U.fmtUsd(o.sold) : '') + ' · ' + U.fmtAge(U.now() - o.last) + ' ago'; }).join('\n'), n: ins.length };
  };
})(window.TL);
