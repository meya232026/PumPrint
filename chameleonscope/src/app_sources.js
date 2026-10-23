/* Trenchlight feed prototype v0.8 - live data straight from a browser, no aggregator APIs (verified 15 Sep 2026)
   Solana:    PumpPortal stream (every pump.fun launch and migration the second it happens), pump.fun bonding curves read on-chain
              through a public Solana RPC (exact curve fill, market cap, creator, completion), Jupiter token API for the opening snapshot,
              holders, audit flags and post-graduation market data, token metadata from pump.fun's IPFS gateway for pictures.
   Robinhood: public RPC only: Pons V2 factory events (launch, graduation), curve balances and trades, Uniswap v4 pool init + swaps
              after graduation (price, volume, buys/sells), launch calldata for logos and socials; Blockscout for holders and ETH price.
   Charts:    GMGN chart embed (gmgn.cc) in the chart modal, plus our own live price path drawn from the sources above.
   pump.fun's own REST API and PumpPortal trade subscriptions need a server / paid key, so they are optional here.
   Time model: createdAt = launch time, graduatedAt = migration time. A token enters a feed only when "ready" (launch time + market cap or curve). */
(function (TL) {
  'use strict';
  var U = TL.util, C = TL.CONFIG, store = TL.store;
  var S = TL.sources = { status: {}, timers: [], ws: null, solUsd: null, ethUsd: null, hood: { lastBlock: null, curves: {}, launches: {}, pools: {}, gradSeen: {} }, sol: { curves: {} } };
  C.jup = C.apiOverride ? C.apiOverride + '/jup' : 'https://lite-api.jup.ag';
  // Robinhood Chain JSON-RPC, three public nodes with different strengths (checked from a browser on 16 Sep 2026):
  //  - the official node answers eth_getLogs over any range (an hour of factory logs in 1 s) but rate-limits by IP and drops big batches;
  //  - PublicNode is fast (45-call batches in 0.1 s) for calls, balances, blocks and transactions, but its eth_getLogs only reaches ~90 blocks back;
  //  - dRPC (free plan) takes eth_getLogs up to 10 000 blocks and batches of at most 3 calls.
  // Every call is routed by what it needs; a refusing node rests for a while and the next one takes over.
  var OFFICIAL = 'https://rpc.mainnet.chain.robinhood.com', PUBLICNODE = 'https://robinhood-rpc.publicnode.com', DRPC = 'https://robinhood.drpc.org';
  C.hoodRpcs = C.apiOverride ? { logs: [C.apiOverride + '/rpc', C.apiOverride + '/rpc2'], tail: [C.apiOverride + '/rpc', C.apiOverride + '/rpc2'], state: [C.apiOverride + '/rpc', C.apiOverride + '/rpc2'] } : {
    logs: [OFFICIAL, DRPC],               // eth_getLogs over history
    tail: [PUBLICNODE, OFFICIAL, DRPC],   // eth_getLogs over the last ~90 blocks (the 5-second poll for new launches)
    state: [PUBLICNODE, OFFICIAL, DRPC]   // eth_call, balances, blocks, transactions, receipts
  };
  C.hoodRpcLimits = {}; C.hoodRpcLimits[DRPC] = { batch: 3, logRange: 10000 }; C.hoodRpcLimits[PUBLICNODE] = { logRange: 90 };
  if (C.hoodRpcOwn) { ['logs', 'tail', 'state'].forEach(function (role) { C.hoodRpcs[role].unshift(C.hoodRpcOwn); }); } // v1.35: the person's own node goes first for every role
  C.hoodRpc = C.hoodRpcs.logs[0];
  C.ponsImg = 'https://www.ponsfamily.com/api/ipfs/content/';
  var SOL_MINT = 'So11111111111111111111111111111111111111112';
  var PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  var PONS = {
    factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
    TokenLaunched: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
    PoolGraduated: '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259',
    LaunchSwept: '0xcdb72f157fd3666758a6ce201387ffb52038c7562e4fff352828da1096c4b6b4',
    CurveBuy: '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455',
    CurveSell: '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df',
    chunk: 2000, bootChunks: 18, firstChunks: 5, gradChunks: 450 // launches: the last ~8 minutes first, the rest of the hour backfilled; graduations: the last ~26 hours
  };
  var UNI = { // Uniswap v4 on Robinhood Chain (the PoolManager address is confirmed from a Pons graduation receipt)
    poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
    Initialize: '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438',
    Swap: '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f'
  };
  var QUOTES = { '0x5fc5360d0400a0fd4f2af552add042d716f1d168': { symbol: 'USDG', decimals: 6 } }; // other quote tokens are learned from the chain (symbol + decimals)

  function setStatus(key, state, note) {
    S.status[key] = { state: state, note: note || '', at: U.now() };
    if (TL.ui && TL.ui.renderStatus) TL.ui.renderStatus();
  }
  S.setStatus = setStatus;
  S.SOURCE_META = {
    gmgnapi: { label: 'GMGN OpenAPI', desc: 'The Trenches feeds, Top, token pages and Smart Tracking wallets, every token with GMGN\'s risk record. On the site through its own server; the local file needs your own key' },
    pumpportal: { label: 'pump.fun stream (PumpPortal)', desc: 'Solana: every new pump.fun token and every migration, live' },
    solrpc: { label: 'Solana RPC', desc: 'pump.fun bonding curves read on-chain: exact curve fill, market cap, creator, completion' },
    jupiter: { label: 'Jupiter token API', desc: 'Solana: opening snapshot, holders, mint rights, dev history, market data after graduation' },
    hoodrpc: { label: 'Robinhood Chain RPC', desc: 'Pons V2 launches and graduations, curve trades, Uniswap v4 pools after graduation, logos from calldata. Four endpoints with automatic failover: the official node, Blockscout JSON-RPC, thirdweb, dRPC' },
    blockscout: { label: 'Blockscout', desc: 'Robinhood Chain: holders, ETH price, and the backup path for launches (factory logs and decoded launch calls) when every RPC refuses' },
    gmgn: { label: 'GMGN chart', desc: 'Chart embed from gmgn.cc on token pages and in the chart window (no key needed)' },
    pumpfun: { label: 'pump.fun API', desc: 'Optional: blocked by CORS in browsers, works from a server' }
  };
  Object.keys(S.SOURCE_META).forEach(function (k) { S.status[k] = { state: 'idle', note: '', at: 0 }; });

  // pump.fun curve position from market cap (fallback when the curve account has not been read yet):
  // constant product k = 30 SOL * 1.073B tokens, graduation after 85 SOL bought
  TL.pumpCurveFromMc = function (mcUsd) {
    if (!U.isNum(mcUsd) || !S.solUsd) return null;
    var mcSol = mcUsd / S.solUsd; var k = 30 * 1.073e9;
    var vSol = Math.sqrt(mcSol * k / 1e9);
    return U.clamp((vSol - 30) / 85, 0, 1.2);
  };

  // ---------- prices ----------
  S.pollPrices = function () {
    var sol = U.timeoutFetch(C.jup + '/price/v3?ids=' + SOL_MINT, 6000).then(function (r) {
      var p = r && r[SOL_MINT] && U.num(r[SOL_MINT].usdPrice); if (p) { S.solUsd = p; store.solUsd = p; } return p;
    }).catch(function () { return null; });
    var eth = U.timeoutFetch(C.blockscout + '/stats', 6000).then(function (r) {
      var p = r && U.num(r.coin_price); if (p) { S.ethUsd = p; store.ethUsd = p; } return p;
    }).catch(function () { return null; });
    return Promise.all([sol, eth]);
  };

  // ---------- Jupiter (Solana) ----------
  function jupStats(s, key) { return s && U.isNum(s[key]) ? s[key] : null; }
  function normJup(x) {
    if (!x || !x.id) return null;
    var t = { chain: 'solana', address: x.id, name: x.name || '', symbol: x.symbol || '' };
    if (x.icon) t.logo = x.icon;
    if (x.launchpad) t.launchpad = x.launchpad;
    if (x.createdAt) { var ts = Date.parse(x.createdAt); if (U.isNum(ts)) t.createdAt = ts; }
    // Jupiter's mcap is the *circulating* cap. While a token sits on its bonding curve nearly the whole supply is inside the
    // curve, so that number lands ~100x under the cap every chart shows. The full supply cap (fdv) is the one that matches.
    if (U.isNum(x.totalSupply) && x.totalSupply > 0) t.supply = U.num(x.totalSupply);
    if (U.isNum(x.mcap)) t.mcCirc = x.mcap;
    if (U.isNum(x.usdPrice)) t.price = x.usdPrice;
    var jFdv = U.isNum(x.fdv) ? x.fdv : (U.isNum(x.usdPrice) && U.isNum(x.totalSupply) ? x.usdPrice * x.totalSupply : null);
    if (U.isNum(jFdv)) { t.fdv = jFdv; t.mc = jFdv; t.capSrc = 'Jupiter price \u00d7 total supply'; }
    else if (U.isNum(x.mcap)) { t.mc = x.mcap; t.fdv = x.mcap; }
    if (U.isNum(x.liquidity)) t.liq = x.liquidity;
    if (U.isNum(x.holderCount)) { t.holders = x.holderCount; t.holdersSrc = 'jupiter'; }
    var s5 = x.stats5m, s1 = x.stats1h, s6 = x.stats6h, s24 = x.stats24h;
    t.vol = { m5: s5 ? (jupStats(s5, 'buyVolume') || 0) + (jupStats(s5, 'sellVolume') || 0) : null, h1: s1 ? (jupStats(s1, 'buyVolume') || 0) + (jupStats(s1, 'sellVolume') || 0) : null, h6: s6 ? (jupStats(s6, 'buyVolume') || 0) + (jupStats(s6, 'sellVolume') || 0) : null, h24: s24 ? (jupStats(s24, 'buyVolume') || 0) + (jupStats(s24, 'sellVolume') || 0) : null };
    function tv(s) { return s && (U.isNum(s.numBuys) || U.isNum(s.numSells)) ? { b: s.numBuys || 0, s: s.numSells || 0, buyers: s.numTraders } : null; }
    t.tx = { m5: tv(s5), h1: tv(s1), h6: tv(s6), h24: tv(s24) };
    // v1.79: Jupiter's split of the volume: what real wallets traded (organic volume), how many real buyers came, net buyers, and the
    // holder change in % (1 Oct 2026: among the 58 memecoins topping the 5-minute volume, the ones with no organic buyers were bots)
    function og(s) { return s ? { vol: (U.num(s.buyOrganicVolume) || 0) + (U.num(s.sellOrganicVolume) || 0), buyers: U.isNum(s.numOrganicBuyers) ? s.numOrganicBuyers : null, net: U.isNum(s.numNetBuyers) ? s.numNetBuyers : null, holdPct: U.isNum(s.holderChange) ? s.holderChange : null } : null; }
    t.org = { m5: og(s5), h1: og(s1) };
    t.chg = { m5: jupStats(s5, 'priceChange'), h1: jupStats(s1, 'priceChange'), h6: jupStats(s6, 'priceChange'), h24: jupStats(s24, 'priceChange') };
    if (s1 && U.isNum(s1.holderChange)) t.holdersDelta1h = Math.round(s1.holderChange);
    var a = x.audit || {};
    var ex = store.get('solana:' + x.id);
    t.checkedAt = U.now(); // Jupiter's record carries what the gate needs: dev history and balance, holders, top holders, authorities
    if (a.isSus === true) t.sus = true; else if (a.isSus === false) t.sus = false;
    if (U.num(x.circSupply) != null && U.num(x.totalSupply) > 0) t.circPct = U.clamp(U.num(x.circSupply) / U.num(x.totalSupply), 0, 1);
    if (typeof a.mintAuthorityDisabled === 'boolean') t.mintAuth = !a.mintAuthorityDisabled;
    if (typeof a.freezeAuthorityDisabled === 'boolean') t.freezeAuth = !a.freezeAuthorityDisabled;
    if (U.isNum(a.topHoldersPercentage)) { t.top10 = a.topHoldersPercentage / 100; t.top10Src = 'Jupiter audit'; }
    t.dev = { address: x.dev || null };
    if (U.isNum(a.devMints)) t.dev.launches = a.devMints;
    if (U.isNum(a.devMigrations)) t.dev.graduated = a.devMigrations;
    if (U.isNum(a.devBalancePercentage)) { // the dev wallet's balance now, % of supply; against the launch buy from the stream it shows a dump
      t.dev.pct = U.clamp(a.devBalancePercentage / 100, 0, 1);
      if (ex && U.isNum(ex.devInit) && ex.devInit >= 0.01 && t.dev.pct < ex.devInit * 0.98) { t.dev.sold = t.dev.pct < ex.devInit * 0.5; t.dev.soldSome = !t.dev.sold; }
    }
    if (x.twitter || x.website || x.telegram) t.socials = { x: x.twitter || undefined, web: x.website || undefined, tg: x.telegram || undefined };
    if (x.graduatedPool) t.pair = x.graduatedPool; else if (x.firstPool && x.firstPool.id) t.pair = x.firstPool.id;
    if (x.graduatedAt) { var g = Date.parse(x.graduatedAt); if (U.isNum(g)) { t.graduatedAt = g; t.complete = true; } }
    if (x.organicScore != null) t.organic = x.organicScore;
    if (Array.isArray(x.tags) && x.tags.length) t.tags = x.tags;
    var pumpish = /pump/.test(t.launchpad || '');
    if (!t.complete && U.isNum(x.bondingCurve)) { t.curve = U.clamp(x.bondingCurve / 100, 0, 0.999); t.complete = false; }
    else if (!t.complete && pumpish && U.isNum(t.mc)) {
      var c = TL.pumpCurveFromMc(t.mc);
      if (c != null) { if (c >= 1) { t.complete = true; t.curve = null; } else { t.curve = c; } }
    }
    if (pumpish && !t.complete) { t.mintAuth = false; t.freezeAuth = false; t.lpLocked = true; }
    if (pumpish && t.mintAuth === undefined) t.mintAuth = false; // the pump.fun program creates every mint with both authorities revoked
    if (pumpish && t.freezeAuth === undefined) t.freezeAuth = false;
    if (t.complete && pumpish) { t.lpLocked = true; if (!x.graduatedPool && t.launchpad === 'pump.fun') t.launchpad = 'pumpswap'; }
    // the on-chain curve read is the truth for tokens still on the curve; do not let a slower snapshot overwrite it
    if (ex && ex.curveAt && U.now() - ex.curveAt < 60 * TL.SEC && !ex.complete) { t.mc = undefined; t.curve = undefined; t.complete = undefined; t.price = undefined; t.liq = undefined; t.fdv = undefined; }
    t.jupAt = U.now();
    if (ex && ex.gmgnAt && U.isNum(ex.createdAt)) delete t.createdAt; // GMGN's creation time stays: Jupiter's can be its indexing time
    if (ex && ex.gmgnAt && U.now() - ex.gmgnAt < 3 * TL.MIN) { // GMGN's risk record is the reference while it is fresh: Jupiter only adds market numbers
      delete t.top10; delete t.holders; delete t.holdersSrc; delete t.circPct;
      if (t.dev) { delete t.dev.pct; delete t.dev.sold; delete t.dev.soldSome; }
    }
    t.source = { meta: ex && ex.gmgnAt ? 'GMGN + Jupiter' : 'Jupiter' };
    return t;
  }
  S.pollJupRecent = function () {
    var q = function (path) { return U.timeoutFetch(C.jup + path).catch(function () { return []; }); };
    return Promise.all([U.timeoutFetch(C.jup + '/tokens/v2/recent'), q('/tokens/v2/toptrending/1h'), q('/tokens/v2/toptrending/5m'), q('/tokens/v2/toptraded/5m'), q('/tokens/v2/toporganicscore/5m')]).then(function (res) {
      var n = 0, dropped = 0;
      var isMeme = function (x) { return x && x.id && !(x.tags && x.tags.indexOf('verified') >= 0 && (x.mcap || 0) > 5e7); }; // skip majors like ZEC / cbBTC that top the traded lists
      var take = function (t) { if (TL.trusted(t)) return true; dropped++; return false; }; // pump.fun launches only: letsbonk, met-dbc, stonkfun, unknown pools never enter the store
      var put = function (t) { var had = store.get(t.chain + ':' + t.address); had = !!(had && had.checkedAt); var tok = store.upsert(t); n++; if (!had && store._booted && TL.ui && TL.ui.offer) TL.ui.offer(tok); };
      (Array.isArray(res[0]) ? res[0] : []).forEach(function (x) { var t = normJup(x); if (t && take(t)) put(t); });
      res.slice(1).forEach(function (list, i) { (Array.isArray(list) ? list : []).filter(isMeme).forEach(function (x) { var t = normJup(x); if (t && take(t)) { if (i < 2) t._trend = true; put(t); } }); });
      S.droppedLaunchpads = (S.droppedLaunchpads || 0) + dropped;
      setStatus('jupiter', 'ok', n + ' tokens' + (dropped ? ', ' + dropped + ' off other launchpads skipped' : ''));
      if (n) store.chainMode.solana = 'live';
      return n;
    }).catch(function (e) { setStatus('jupiter', 'err', e.message || 'blocked'); throw e; });
  };
  // ---------- TOP: established memecoins, $1M+ market cap, trading for a week or more ----------
  // Solana: Jupiter's verified list (~3 400 tokens, 5 MB, refreshed every 15 min) filtered to tokens tagged meme or born on a launchpad.
  var NOT_MEME_TAGS = { stable: 1, lst: 1, 'original-lst': 1, stocks: 1, xstocks: 1, equities: 1, prestocks: 1, rwa: 1, commodities: 1, defi: 1, infra: 1, major: 1, yield: 1, ondo: 1 };
  S.solTop = function (force) {
    if (!force && S._solTopAt && U.now() - S._solTopAt < 15 * TL.MIN) return Promise.resolve(0);
    S._solTopAt = U.now(); var now = S._solTopAt;
    // Top is about coins people trade now: Jupiter's verified list (old names included, hence the age cap) plus the 24h most traded,
    // trending and organic lists, where fresh $1M+ coins show up before anyone verifies them. A week to six months old.
    var hot = function (path) { return U.timeoutFetch(C.jup + path, 20000).catch(function () { return []; }); };
    return Promise.all([U.timeoutFetch(C.jup + '/tokens/v2/tag?query=verified', 40000), hot('/tokens/v2/toptraded/24h?limit=100'), hot('/tokens/v2/toptrending/24h?limit=100'), hot('/tokens/v2/toporganicscore/24h?limit=100')]).then(function (lists) {
      var n = 0, seen = {};
      [].concat.apply([], lists.map(function (l) { return Array.isArray(l) ? l : []; })).forEach(function (x) {
        if (!x || !x.id || seen[x.id]) return;
        var tags = x.tags || []; var meme = tags.indexOf('meme') >= 0 || !!x.launchpad || !!x.graduatedPool || tags.indexOf('launchpad') >= 0;
        if (tags.some(function (g) { return NOT_MEME_TAGS[g]; })) meme = false; // stables, LSTs, tokenized stocks, RWA, DeFi and infra tokens are not memecoins whatever their launchpad
        var pool = x.firstPool && x.firstPool.createdAt ? Date.parse(x.firstPool.createdAt) : null, minted = x.createdAt ? Date.parse(x.createdAt) : null;
        var born = U.isNum(pool) && U.isNum(minted) ? Math.min(pool, minted) : (U.isNum(pool) ? pool : minted); // the older of mint and first pool: an old mint does not pass for new
        if (!meme || !(U.num(x.mcap) >= TL.TOP_MIN_MC.solana) || !U.isNum(born) || now - born < TL.TOP_MIN_AGE || now - born > TL.TOP_MAX_AGE) return;
        seen[x.id] = 1;
        var t = normJup(x); if (!t) return;
        t.top = true; t.topAt = now; t.complete = true; t.curve = null; t.createdAt = born; if (t.mc === undefined) t.mc = U.num(x.mcap);
        store.upsert(t); n++;
      });
      store.all().forEach(function (t) { if (t.top && t.chain === 'solana' && t.topAt !== now && !t.demo && t.topSrc !== 'gmgn') t.top = false; }); // GMGN's Top list is GMGN's to change
      store._rev++; setStatus('jupiter', 'ok', n + ' top memecoins'); return n;
    }).catch(function (e) { S._solTopAt = U.now() - 14 * TL.MIN; setStatus('jupiter', 'err', 'top list: ' + (e.message || 'blocked')); return 0; });
  };
  // Robinhood Chain: Blockscout's token list comes sorted by market cap; bridged majors and tokenized stocks are filtered out by name and holder count
  var HOOD_NOT_MEME = /• Robin|SPDR|ETF|\bInc\b|Corp|Trust|USD|syrup|Midas|Wrapped|Bridged|stETH|Vault|xStock|Treasury|Bond|Fund/i;
  var HOOD_MAJORS = { LINK: 1, TAO: 1, APE: 1, '1INCH': 1, SUSHI: 1, USDE: 1, USDG: 1, WETH: 1, ETH: 1, CBBTC: 1, WBTC: 1, MGLO: 1, AAVE: 1, UNI: 1, CRV: 1, LDO: 1, MKR: 1, COMP: 1, SNX: 1, GRT: 1, ENS: 1, ARB: 1, OP: 1, MATIC: 1, POL: 1, SOL: 1, BNB: 1, XRP: 1, DOGE: 1, SHIB: 1, PEPE: 1, TON: 1, AVAX: 1, DOT: 1, ATOM: 1, NEAR: 1, SUI: 1, APT: 1, TRX: 1, LTC: 1, BCH: 1, XLM: 1, ADA: 1, FIL: 1, RENDER: 1, INJ: 1, TIA: 1, SEI: 1, ONDO: 1, ENA: 1, PENDLE: 1, EIGEN: 1, ZRO: 1, W: 1, JUP: 1, RAY: 1, PYTH: 1, JTO: 1, NPC: 1 };
  function isHoodMeme(it) {
    var mc = U.num(it.circulating_market_cap), h = U.num(it.holders_count) || 0;
    if (!(mc >= TL.TOP_MIN_MC.robinhood) || h < 150) return false;
    if (HOOD_NOT_MEME.test(it.name || '') || HOOD_NOT_MEME.test(it.symbol || '')) return false;
    if (HOOD_MAJORS[String(it.symbol || '').toUpperCase()]) return false;
    if (mc / h > 300000) return false; // a huge cap with a handful of holders here is a bridged asset, not a chain-native meme
    return true;
  }
  S.hoodTop = function (force) {
    if (!force && S._hoodTopAt && U.now() - S._hoodTopAt < 15 * TL.MIN) return Promise.resolve(0);
    S._hoodTopAt = U.now(); var now = S._hoodTopAt;
    var params = null, pages = 0, found = [];
    var step = function () {
      var q = params ? '&' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&') : '';
      return U.timeoutFetch(C.blockscout + '/tokens?type=ERC-20' + q, 25000).then(function (r) {
        var items = r && Array.isArray(r.items) ? r.items : [];
        items.forEach(function (it) { if (isHoodMeme(it)) found.push(it); });
        params = r && r.next_page_params; pages++;
        var lastMc = params ? U.num(params.market_cap) : null;
        if (params && pages < 8 && (lastMc == null || lastMc >= TL.TOP_MIN_MC.robinhood)) return step();
      });
    };
    return step().then(function () {
      found.forEach(function (it) {
        var addr = String(it.address_hash || '').toLowerCase(); if (!addr) return;
        var ex = store.get('robinhood:' + addr); var born = ex && U.isNum(ex.createdAt) ? ex.createdAt : bornCache[addr];
        if (U.isNum(born) && now - born > TL.TOP_MAX_AGE) return;
        var t = { chain: 'robinhood', address: addr, name: it.name || '', symbol: it.symbol || '', logo: it.icon_url || undefined, mc: U.num(it.circulating_market_cap), price: U.num(it.exchange_rate), vol: { h24: U.num(it.volume_24h) },
          holders: U.num(it.holders_count), holdersSrc: 'blockscout', complete: true, curve: null, top: true, topAt: now, launchpad: (ex && ex.launchpad !== 'unknown' && ex.launchpad) || 'robinhood chain', lpLocked: true, source: { core: 'Blockscout token list' } };
        if (U.isNum(born)) t.createdAt = born; else if (S.hoodBornQueue.indexOf(addr) < 0) S.hoodBornQueue.push(addr);
        store.upsert(t);
      });
      store.all().forEach(function (t) { if (t.top && t.chain === 'robinhood' && t.topAt !== now && !t.demo && t.topSrc !== 'gmgn') t.top = false; });
      store._rev++; setStatus('blockscout', 'ok', found.length + ' top memecoins');
      return S.hoodCodeCheck(found.map(function (it) { return it.address_hash; }).filter(Boolean)).then(function () { return found.length; }, function () { return found.length; });
    }).catch(function (e) { S._hoodTopAt = U.now() - 14 * TL.MIN; setStatus('blockscout', 'err', 'top list: ' + (e.message || 'unreachable')); return 0; });
  };
  // Robinhood tokens from outside Pons (the Top list): the bytecode itself says whether someone can still mint, pause or blacklist.
  // Solidity dispatchers push every public selector with PUSH4 (0x63), so "63" + selector marks a function the contract exposes;
  // an owner() of zero means those functions are dead. A proxy hides its logic (the owner can swap it), which is a risk of its own.
  // Results are kept per address: a plain contract never changes.
  var CODE_KEY = 'tl.codecheck';
  var codeCache = (function () { try { return JSON.parse(localStorage.getItem(CODE_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  var CODE_SEL = { mint: ['40c10f19', 'a0712d68', '449a52f8'], stop: ['8456cb59', 'f9f92be4', '0ecb93c0', '44337ea1', '153b0d1e', '4838d165', '8d1fdf2f', '9c0db5f3'], upgrade: ['3659cfe6', '4f1ef286'], transfer: ['a9059cbb'] };
  var EIP1967_SLOT = '360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  function readCode(code) {
    code = String(code || '').toLowerCase().replace(/^0x/, ''); if (!code) return null;
    var has = function (list) { return list.some(function (x) { return code.indexOf('63' + x) >= 0; }); };
    var proxy = code.indexOf(EIP1967_SLOT) >= 0 || /^363d3d373d3d3d363d73/.test(code) || !has(CODE_SEL.transfer) || has(CODE_SEL.upgrade);
    return { m: has(CODE_SEL.mint) ? 1 : 0, s: has(CODE_SEL.stop) ? 1 : 0, u: proxy ? 1 : 0 };
  }
  function applyCode(addr, r) { var p = { chain: 'robinhood', address: addr, upgradeable: !!r.u }; if (!r.u) { p.mintAuth = !!r.m; p.freezeAuth = !!r.s; } store.upsert(p); }
  S.hoodCodeCheck = function (addrs) {
    var todo = [];
    addrs.forEach(function (a) { a = String(a).toLowerCase(); if (codeCache[a]) applyCode(a, codeCache[a]); else todo.push(a); });
    if (!todo.length) return Promise.resolve(0);
    return rpcBatched(todo.map(function (a) { return { method: 'eth_getCode', params: [a, 'latest'] }; })).then(function (res) {
      var got = {}; todo.forEach(function (a, i) { var r = readCode(res[i]); if (r) got[a] = r; });
      var owned = Object.keys(got).filter(function (a) { return !got[a].u && (got[a].m || got[a].s); });
      return rpcBatched(owned.map(function (a) { return { method: 'eth_call', params: [{ to: a, data: '0x8da5cb5b' }, 'latest'] }; })).then(function (own) {
        owned.forEach(function (a, i) { if (own[i] && /^0x0{64}$/.test(own[i])) { got[a].m = 0; got[a].s = 0; got[a].r = 1; } }); // ownership renounced
        Object.keys(got).forEach(function (a) { codeCache[a] = got[a]; applyCode(a, got[a]); });
        try { localStorage.setItem(CODE_KEY, JSON.stringify(codeCache)); } catch (e) {}
        return Object.keys(got).length;
      });
    }).catch(function () { return 0; });
  };
  // creation time of Robinhood tokens outside Pons: Blockscout's address page names the creation transaction, whose block has the time.
  // Two per run, cached per address for good (a contract is created once).
  var BORN_KEY = 'tl.born';
  var bornCache = (function () { try { return JSON.parse(localStorage.getItem(BORN_KEY) || '{}') || {}; } catch (e) { return {}; } })();
  S.hoodBornQueue = [];
  S.hoodBorn = function () {
    var batch = [];
    while (S.hoodBornQueue.length && batch.length < 2) { var a = S.hoodBornQueue.shift(); var t = store.get('robinhood:' + a); if (t && !U.isNum(t.createdAt)) batch.push(t); }
    return Promise.all(batch.map(function (t) {
      return U.timeoutFetch(C.blockscout + '/addresses/' + t.address, 15000).then(function (a) { var h = a && (a.creation_transaction_hash || a.creation_tx_hash); return h ? U.timeoutFetch(C.blockscout + '/transactions/' + h, 15000) : null; })
        .then(function (tx) { var ts = tx && tx.timestamp ? Date.parse(tx.timestamp) : null; if (!U.isNum(ts)) return; bornCache[t.address] = ts; try { localStorage.setItem(BORN_KEY, JSON.stringify(bornCache)); } catch (e) {} store.upsert({ chain: 'robinhood', address: t.address, createdAt: ts }); })
        .catch(function () {});
    })).then(function () { return batch.length; });
  };
  S.ensureTop = function (net) {
    var G = TL.gmgn; // GMGN in charge: its rank list is Top, so ask it now instead of the public lists
    if (G && G.primary(net)) return G.pollTop(net, TL.ui ? TL.ui.state.topAge : 30, 1).catch(function () { return 0; });
    return net === 'solana' ? S.solTop() : S.hoodTop();
  };
  S.enrichJup = function (mints) {
    mints = mints.filter(Boolean); if (!mints.length) return Promise.resolve(0);
    var batches = []; for (var i = 0; i < mints.length; i += 100) batches.push(mints.slice(i, i + 100));
    return Promise.all(batches.map(function (b) { return U.timeoutFetch(C.jup + '/tokens/v2/search?query=' + encodeURIComponent(b.join(','))).catch(function () { return []; }); })).then(function (res) {
      var n = 0;
      [].concat.apply([], res.filter(Array.isArray)).forEach(function (x) { var t = normJup(x); if (t) { store.upsert(t); n++; } });
      if (n && S.status.jupiter.state !== 'ok') setStatus('jupiter', 'ok', n + ' tokens');
      return n;
    });
  };

  // v2.20: coins by a word in their name or ticker (Jupiter's search, the same record the feed checks with); the quantum radar asks it
  // for the narrative's words every few minutes. The coins found join the store like any other, checked, and are returned
  S.searchJup = function (word) {
    word = String(word || '').trim(); if (!word) return Promise.resolve([]);
    return U.timeoutFetch(C.jup + '/tokens/v2/search?query=' + encodeURIComponent(word), 9000).then(function (res) {
      return S.ingestJup((Array.isArray(res) ? res : []).slice(0, 40));
    }).catch(function () { return []; });
  };
  // Jupiter records into the store (the search above, and v2.21 the portal's records when the terminal opens). A picture the portal
  // already loaded for the same coin comes along, so its card shows at once
  S.ingestJup = function (list) {
    var out = [], P = TL.pics;
    (Array.isArray(list) ? list : []).slice(0, 160).forEach(function (x) {
      var t = normJup(x); if (!t) return; store.upsert(t);
      var tk = store.get(t.chain + ':' + t.address); if (!tk) return;
      if (!tk.qFound) tk.qFound = U.now();
      var g = P && P.ghosts && P.ghosts[tk.id]; if (g && g.logoOk && !tk.logoOk && (!tk.logo || tk.logo === g.logo)) { tk.logoOk = g.logoOk; if (P.loaded) P.loaded[g.logoOk] = 1; }
      out.push(tk);
    });
    if (out.length) store.recompute();
    return out;
  };

  // every token stays out of the feeds until it is checked. New launches (and stream tokens without metadata) are asked from Jupiter
  // every 5 s in one call of up to 100 mints, newest first; Jupiter usually has a fresh pump.fun mint within 10-20 s. Each is retried
  // every 8 s for about two minutes, then left out for good.
  S.checkSol = function () {
    var now = U.now();
    var list = store.all().filter(function (t) {
      return t.chain === 'solana' && !t.demo && !t.partial && (!t.checkedAt || t.needsMeta) && TL.trusted(t) &&
        !(t._chkAt && now - t._chkAt < 8 * TL.SEC) && (t._chkN || 0) < 15;
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 100);
    if (!list.length) return Promise.resolve(0);
    var had = list.map(function (t) { t._chkAt = now; t._chkN = (t._chkN || 0) + 1; return !!t.checkedAt; });
    return S.enrichJup(list.map(function (t) { return t.address; })).then(function (n) {
      list.forEach(function (t, i) { if (t.name && t.checkedAt) t.needsMeta = false; if (!had[i] && t.checkedAt && TL.ui && TL.ui.offer) TL.ui.offer(t); });
      return n;
    }).catch(function () { return 0; });
  };

  // ---------- Solana RPC: pump.fun bonding curves straight from the chain ----------
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58dec(s) {
    var n = 0n; for (var i = 0; i < s.length; i++) { var k = B58.indexOf(s[i]); if (k < 0) return null; n = n * 58n + BigInt(k); }
    var out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
    for (var j = 0; j < s.length && s[j] === '1'; j++) out.unshift(0);
    return new Uint8Array(out);
  }
  function b58enc(bytes) {
    var n = 0n; for (var i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
    var s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (var j = 0; j < bytes.length && bytes[j] === 0; j++) s = '1' + s;
    return s;
  }
  var ED_P = (1n << 255n) - 19n;
  function modpow(b, e) { var r = 1n; b %= ED_P; while (e > 0n) { if (e & 1n) r = r * b % ED_P; b = b * b % ED_P; e >>= 1n; } return r; }
  var ED_D = (ED_P - 121665n) * modpow(121666n, ED_P - 2n) % ED_P;
  function isOnCurve(bytes) { // ed25519 point decompression check, needed to derive program addresses
    var y = 0n; for (var i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
    var sign = (y >> 255n) & 1n; y &= (1n << 255n) - 1n; if (y >= ED_P) return false;
    var y2 = y * y % ED_P, u = (y2 - 1n + ED_P) % ED_P, v = (ED_D * y2 + 1n) % ED_P;
    var v3 = v * v % ED_P * v % ED_P, v7 = v3 * v3 % ED_P * v % ED_P;
    var x = u * v3 % ED_P * modpow(u * v7 % ED_P, (ED_P - 5n) / 8n) % ED_P;
    var vx2 = v * x % ED_P * x % ED_P;
    if (vx2 === u) { } else if (vx2 === (ED_P - u) % ED_P) { x = x * modpow(2n, (ED_P - 1n) / 4n) % ED_P; } else return false;
    if (x === 0n && sign === 1n) return false;
    return true;
  }
  var PDA_TAG = new TextEncoder().encode('ProgramDerivedAddress');
  var CURVE_SEED = new TextEncoder().encode('bonding-curve');
  var PUMP_PID = b58dec(PUMP_PROGRAM);
  function findPda(seeds, pid) {
    var bump = 255;
    var step = function () {
      if (bump < 0) return Promise.resolve(null);
      var parts = seeds.concat([new Uint8Array([bump]), pid, PDA_TAG]); var len = 0; parts.forEach(function (p) { len += p.length; });
      var buf = new Uint8Array(len); var o = 0; parts.forEach(function (p) { buf.set(p, o); o += p.length; });
      return crypto.subtle.digest('SHA-256', buf).then(function (h) { var b = new Uint8Array(h); if (!isOnCurve(b)) return b58enc(b); bump--; return step(); });
    };
    return step();
  }
  S.b58dec = b58dec; S.b58enc = b58enc; S.findPda = findPda;
  S.curveAddr = function (mint) { // bonding curve PDA for a pump.fun mint, cached
    var cache = S.sol.curves;
    if (cache[mint]) return Promise.resolve(cache[mint]);
    var mb = b58dec(mint); if (!mb || mb.length !== 32) return Promise.resolve(null);
    return findPda([CURVE_SEED, mb], PUMP_PID).then(function (a) { if (a) cache[mint] = a; return a; });
  };
  function solRpc(method, params) {
    return U.timeoutFetch(C.solRpc, 9000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }) })
      .then(function (r) { if (r && r.error) throw new Error(r.error.message || 'rpc error'); return r && r.result; });
  }
  function parseCurve(b64) {
    var raw; try { raw = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); }); } catch (e) { return null; }
    if (raw.length < 49) return null;
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var u64 = function (o) { return Number(dv.getBigUint64(o, true)); };
    var out = { vToken: u64(8), vSol: u64(16), rToken: u64(24), rSol: u64(32), supply: u64(40), complete: raw[48] === 1 };
    if (raw.length >= 81) out.creator = b58enc(raw.subarray(49, 81));
    return out;
  }
  // read the curves of everything on screen: the public node allows 10 accounts per call, so calls run in parallel (5 at a time,
  // fewer for a minute after it pushes back). Every read gives the exact fill, market cap, creator and completion of a pump.fun token.
  var curvePar = 5, curveSlowUntil = 0;
  // A pump.fun curve is a constant-product market: virtual SOL x virtual tokens never leaves 30 SOL x 1.073B tokens, whatever
  // the trades did. A live account whose SOL side breaks that product is not laid out the way this reader expects (a 47-second-old
  // launch once read as a $1.19M cap and $2.55M of liquidity on one holder, 185x its real size). Then the SOL side is derived
  // from the token side, which the check proved sound, and the read says so; if the token side is off too, the read is dropped.
  var PUMP_K = 30e9 * 1.073e15, PUMP_V_TOKEN0 = 1.073e15, PUMP_R_TOKEN0 = 793100000000000;
  function soundCurve(cv) {
    if (cv.complete) return { ok: true };
    var tokOk = cv.vToken > 0 && cv.vToken <= PUMP_V_TOKEN0 * 1.001 && cv.vToken >= PUMP_V_TOKEN0 - PUMP_R_TOKEN0 - 1e9 && cv.rToken <= PUMP_R_TOKEN0 * 1.001 && cv.supply > 0 && Math.abs(cv.supply / 1e15 - 1) < 0.01;
    if (!tokOk) return { ok: false };
    var k = cv.vSol * cv.vToken;
    if (k > 0 && Math.abs(k / PUMP_K - 1) <= 0.02) return { ok: true };
    return { ok: true, derived: true, vSol: PUMP_K / cv.vToken };
  }
  S.soundCurve = soundCurve;
  function applyCurves(pairs, res) {
    var vals = res && res.value || []; var n = 0, now = U.now();
    pairs.forEach(function (p, i) {
      var acc = vals[i]; if (!acc || !acc.data) return;
      var cv = parseCurve(acc.data[0]); if (!cv || !cv.vToken) return;
      var sound = soundCurve(cv);
      if (!sound.ok) { p.t.curveOdd = 'unreadable'; p.t.curveAt = now; return; } // not a curve this reader understands: other sources keep the numbers
      if (sound.derived) cv.vSol = sound.vSol;
      var priceSol = (cv.vSol / 1e9) / (cv.vToken / 1e6);
      var mcSol = priceSol * (cv.supply / 1e6);
      var patch = { chain: 'solana', address: p.t.address, curveAt: now, curveOdd: sound.derived ? 'derived' : null, source: { core: sound.derived ? 'pump.fun curve (on-chain, derived)' : 'pump.fun curve (on-chain)' } };
      patch.curve = cv.complete ? null : U.clamp(1 - cv.rToken / C.PUMP_INITIAL_REAL_RESERVES, 0, 0.999);
      patch.supply = cv.supply / 1e6;
      if (S.solUsd) {
        patch.mc = mcSol * S.solUsd; patch.fdv = patch.mc; patch.price = priceSol * S.solUsd;
        patch.capSrc = 'pump.fun curve price \u00d7 ' + TL.supplyTxt(patch.supply) + ' supply';
        // A bonding curve is a constant-product pool: its depth, and the price impact of any trade, comes from the virtual SOL
        // side, exactly as an AMM pool's TVL is twice its quote reserve. The real SOL raised so far is kept separately below.
        if (!cv.complete) { patch.liq = (cv.vSol / 1e9) * S.solUsd * 2; patch.liqSrc = 'pump.fun curve depth (' + U.fmtNum(Math.round(cv.vSol / 1e9)) + ' SOL virtual)'; }
        patch.raisedUsd = (cv.rSol / 1e9) * S.solUsd;
      }
      patch.priceSol = priceSol;
      if (cv.complete) { patch.complete = true; if (!U.isNum(p.t.graduatedAt)) patch.graduatedAt = now; patch.launchpad = 'pumpswap'; }
      else { patch.complete = false; patch.mintAuth = false; patch.freezeAuth = false; patch.lpLocked = true; }
      if (cv.creator && !p.t.dev.address) patch.dev = { address: cv.creator };
      var prev = p.t.mc, prevCurve = p.t.curve, prevRaised = p.t.curveRaised;
      patch.curveRaised = cv.rSol; if (!U.isNum(p.t.watchedAt)) patch.watchedAt = now;
      if (U.isNum(prevRaised) && prevRaised !== cv.rSol) patch.lastTradeAt = now; // the curve moved: somebody traded
      var tok = store.upsert(patch); n++;
      if (U.isNum(tok.price)) S.pushPoint(tok, now, tok.price, 'pump.fun curve reads');
      if (((U.isNum(prev) && U.isNum(tok.mc) && prev !== tok.mc) || prevCurve !== tok.curve) && TL.ui && TL.ui.markDirty) TL.ui.markDirty(tok);
    });
    return n;
  }
  S.pollSolCurves = function (ids) {
    var toks = (ids || []).map(function (id) { return store.get(id); }).filter(function (t) { return t && t.chain === 'solana' && !t.demo && !t.partial && !t.complete && /pump/.test(t.launchpad || 'pump'); }).slice(0, 100);
    if (!toks.length) return Promise.resolve(0);
    return Promise.all(toks.map(function (t) { return S.curveAddr(t.address); })).then(function (addrs) {
      var pairs = toks.map(function (t, i) { return addrs[i] ? { t: t, a: addrs[i] } : null; }).filter(Boolean);
      var chunks = []; for (var i = 0; i < pairs.length; i += 10) chunks.push(pairs.slice(i, i + 10));
      if (!chunks.length) return 0;
      var par = U.now() < curveSlowUntil ? 2 : curvePar;
      return new Promise(function (resolve) {
        var running = 0, idx = 0, total = 0, errs = 0;
        var next = function () {
          while (running < par && idx < chunks.length) {
            (function (ch) {
              running++;
              solRpc('getMultipleAccounts', [ch.map(function (p) { return p.a; }), { encoding: 'base64', commitment: 'processed' }])
                .then(function (res) { total += applyCurves(ch, res); }, function (e) { errs++; if (/403|429|blocked|limit/i.test(e.message || '')) curveSlowUntil = U.now() + 60 * TL.SEC; })
                .then(function () { running--; if (idx >= chunks.length && running === 0) resolve({ n: total, errs: errs, calls: chunks.length }); else next(); });
            })(chunks[idx++]);
          }
        };
        next();
      }).then(function (r) {
        if (r.n) setStatus('solrpc', 'ok', r.n + ' curves read' + (r.errs ? ', ' + r.errs + ' of ' + r.calls + ' calls refused' : ''));
        else if (r.errs) setStatus('solrpc', 'err', 'node refused ' + r.errs + ' of ' + r.calls + ' calls');
        return r.n;
      });
    }).catch(function (e) { setStatus('solrpc', 'err', e.message || 'unreachable'); return 0; });
  };
  // live price path kept per token (for the panel chart and the Live tab of the chart window)
  S.pushPoint = function (t, ts, price, src) {
    if (!U.isNum(price) || price <= 0) return;
    if (!t.live) t.live = [];
    var last = t.live[t.live.length - 1];
    if (last && ts - last.t < 2000 && last.c === price) return;
    t.live.push({ t: ts, c: price }); if (t.live.length > 400) t.live.splice(0, t.live.length - 400);
    if (!t.series || t.seriesLive) { t.series = t.live; t.seriesLive = true; t.seriesSrc = src; }
  };

  // ---------- pump.fun (optional, CORS-blocked in browsers) ----------
  function normPump(c) {
    var real = U.num(c.real_token_reserves), mc = U.num(c.usd_market_cap);
    var curve = c.complete ? null : (real != null ? U.clamp(1 - real / C.PUMP_INITIAL_REAL_RESERVES, 0, 1) : null);
    if (!c.complete && U.isNum(mc) && mc > 5e6 && (curve == null || curve < 0.05)) return null;
    var t = { chain: 'solana', address: c.mint, name: c.name || '', symbol: (c.symbol || '').trim(), launchpad: c.complete ? 'pumpswap' : 'pump.fun', quote: 'SOL' };
    t.createdAt = U.num(c.created_timestamp); t.complete = !!c.complete; t.curve = curve; t.mc = mc; t.fdv = mc;
    if (U.isNum(c.market_cap) && U.isNum(mc) && c.market_cap > 0) { S.solUsd = mc / c.market_cap; store.solUsd = S.solUsd; }
    t.dev = { address: c.creator || null }; t.replies = U.num(c.reply_count);
    t.socials = { x: c.twitter || null, tg: c.telegram || null, web: c.website || null };
    if (c.image_uri) t.logo = c.image_uri;
    t.mintAuth = false; t.freezeAuth = false; t.lpLocked = true;
    if (c.pool_address) t.pair = c.pool_address;
    if (c.last_trade_timestamp) t.lastTradeAt = U.num(c.last_trade_timestamp);
    t.source = { core: 'pump.fun' };
    return t;
  }
  S.pollPump = function () {
    return U.timeoutFetch(C.pump + '/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false', 6000).then(function (res) {
      var n = 0; (Array.isArray(res) ? res : []).forEach(function (c) { var t = c && c.mint ? normPump(c) : null; if (t) { store.upsert(t); n++; } });
      setStatus('pumpfun', 'ok', n + ' coins'); return n;
    }).catch(function (e) { setStatus('pumpfun', 'err', 'CORS-blocked in browsers'); throw e; });
  };
  S.devHistory = function (creator) {
    S._devCache = S._devCache || {};
    if (S._devCache[creator]) return Promise.resolve(S._devCache[creator]);
    return U.timeoutFetch(C.pump + '/coins/user-created-coins/' + creator + '?offset=0&limit=50&includeNsfw=false', 6000).then(function (arr) {
      var list = Array.isArray(arr) ? arr : (arr && arr.coins) || []; var now = U.now();
      var res = { launches: list.length, graduated: list.filter(function (c) { return c.complete; }).length,
        rugs: list.filter(function (c) { return !c.complete && U.isNum(c.last_trade_timestamp) && U.isNum(c.created_timestamp) && (c.last_trade_timestamp - c.created_timestamp) < TL.HR && (now - c.created_timestamp) > 2 * TL.HR; }).length };
      S._devCache[creator] = res; return res;
    });
  };

  // ---------- Robinhood Chain via public RPC (Pons V2 + Uniswap v4) ----------
  var rpcId = 1;
  S.hoodPauseUntil = 0; // when every node refuses us, pause the polling for a while instead of hammering them
  S.hoodRpcState = {};  // url -> { pausedUntil, fails, ok, lastErr }
  function rpcState(u) { return S.hoodRpcState[u] || (S.hoodRpcState[u] = { pausedUntil: 0, fails: 0, ok: 0, lastErr: '' }); }
  function logRange(c) { // blocks covered by an eth_getLogs call, Infinity when the range is open-ended
    var f = c.params && c.params[0] || {}; var from = f.fromBlock, to = f.toBlock;
    if (typeof from !== 'string' || !/^0x/.test(from)) return Infinity;
    var hi = (typeof to === 'string' && /^0x/.test(to)) ? parseInt(to, 16) : (S.hood.head || null);
    if (hi == null) return Infinity;
    return hi - parseInt(from, 16) + 1;
  }
  function roleOf(list) {
    var logs = list.filter(function (c) { return c.method === 'eth_getLogs'; });
    if (!logs.length) return 'state';
    var span = Math.max.apply(null, logs.map(logRange));
    return span <= 80 ? 'tail' : 'logs';
  }
  function hoodEndpoints(role, list) {
    var now = U.now(); var span = role === 'state' ? 0 : Math.max.apply(null, list.filter(function (c) { return c.method === 'eth_getLogs'; }).map(logRange));
    return (C.hoodRpcs[role] || C.hoodRpcs.state).filter(function (u) {
      var lim = C.hoodRpcLimits[u] || {};
      if (lim.batch && list.length > lim.batch) return false;
      if (lim.logRange && role !== 'state' && span > lim.logRange) return false;
      return rpcState(u).pausedUntil <= now;
    });
  }
  S.hoodEndpoints = hoodEndpoints;
  function isRefusal(e) { var m = (e && e.message) || ''; return /fetch|abort|network|HTTP (429|403|401|5\d\d)|JSON|token|rate|too many|unauthorized|forbidden|bad reply/i.test(m); }
  function rpc(calls) {
    var single = !Array.isArray(calls);
    var list = single ? [calls] : calls;
    var body = list.map(function (c) { return { jsonrpc: '2.0', id: rpcId++, method: c.method, params: c.params }; });
    var payload = JSON.stringify(single ? body[0] : body);
    var role = roleOf(list);
    var urls = hoodEndpoints(role, list); if (!urls.length) urls = [(C.hoodRpcs[role] || C.hoodRpcs.state)[0]];
    var lastErr = null;
    var attempt = function (i) {
      if (i >= urls.length) { if (role !== 'state') S.hoodPauseUntil = U.now() + 60 * TL.SEC; return Promise.reject(lastErr || new Error('every Robinhood Chain RPC refused')); }
      var url = urls[i], st = rpcState(url);
      return U.timeoutFetch(url, 15000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload }).then(function (res) {
        var arr = Array.isArray(res) ? res : [res];
        if (!arr.length || !arr[0] || typeof arr[0] !== 'object') throw new Error('bad reply');
        var errs = arr.filter(function (r) { return r && r.error; });
        if (errs.length === arr.length && /limit|too many|not allowed|unauthorized|forbidden|batch|quota|api key|invalid|archive|not supported|personal token/i.test(String(errs[0].error && errs[0].error.message || ''))) throw new Error('rpc: ' + errs[0].error.message);
        st.ok++; st.fails = 0; C.hoodRpc = url; S.hoodRpcUsed = S.hoodRpcUsed || {}; S.hoodRpcUsed[role] = url;
        var byId = {}; arr.forEach(function (r) { byId[r.id] = r; });
        return body.map(function (b) { var r = byId[b.id]; return r && r.result !== undefined ? r.result : null; });
      }, function (e) {
        lastErr = e; st.lastErr = (e && e.message) || 'error';
        if (isRefusal(e)) { st.fails++; st.pausedUntil = U.now() + Math.min(5 * TL.MIN, 45 * TL.SEC * st.fails); } // rest a refusing node, longer each time
        else if (single) { throw e; } // a bad request on a single call is our fault, no point asking another node
        return attempt(i + 1);
      });
    };
    return attempt(0);
  }
  S.rpc = rpc;
  S.PONS = PONS; // the Pons factory and its event signatures, so the analyzer can recognise service addresses
  S.hoodRpcHost = function (role) { var u = (S.hoodRpcUsed && S.hoodRpcUsed[role || 'logs']) || C.hoodRpc; return String(u || '').replace(/^https?:\/\//, '').split('/')[0]; };
  // The public node's batch limit moves with its load (50 calls one minute, far fewer the next), so batches adapt: a refused
  // batch is split in half and retried, single calls are the floor; after a run of successes the size creeps back up.
  S.hoodBatchMax = 45; var batchOk = 0; S.RPC_PAR = 3;
  function rpcBatched(calls) {
    if (!calls.length) return Promise.resolve([]);
    var out = new Array(calls.length);
    var queue = [{ start: 0, end: calls.length }], active = 0, done = false;
    return new Promise(function (resolve, reject) {
      var pump = function () {
        if (done) return;
        if (!queue.length && active === 0) { done = true; resolve(out); return; }
        while (active < S.RPC_PAR && queue.length) {
          var r = queue[0];
          var size = Math.max(1, Math.min(S.hoodBatchMax, r.end - r.start));
          var start = r.start; r.start += size; if (r.start >= r.end) queue.shift();
          active++;
          (function (start, size) {
            var chunk = calls.slice(start, start + size);
            rpc(chunk.length === 1 ? chunk[0] : chunk).then(function (res) {
              active--;
              for (var i = 0; i < size; i++) out[start + i] = res[i];
              if (++batchOk >= 4) { batchOk = 0; S.hoodBatchMax = Math.min(45, S.hoodBatchMax + 5); }
              pump();
            }, function (e) {
              active--;
              if (size > 1) { S.hoodBatchMax = Math.max(1, Math.floor(size / 2)); batchOk = 0; S.hoodPauseUntil = 0; queue.unshift({ start: start, end: start + size }); pump(); }
              else if (!done) { done = true; reject(e); }
            });
          })(start, size);
        }
      };
      pump();
    });
  }
  S.rpcBatched = rpcBatched;
  function hex(n) { return '0x' + n.toString(16); }
  function addrFromTopic(t) { return '0x' + t.slice(26); }
  function words(data) { return (String(data || '').replace(/^0x/, '').match(/.{64}/g) || []); }
  function int24(w) { var v = parseInt(w.slice(-6), 16); return v > 0x7fffff ? v - 0x1000000 : v; }
  function int128(w) { var v = BigInt('0x' + w.slice(-32)); return v > 0x7fffffffffffffffffffffffffffffffn ? v - (1n << 128n) : v; }
  function decStr(hexs) { if (!hexs || hexs.length < 130) return null; try { var len = parseInt(hexs.slice(66, 130), 16); var h = hexs.slice(130, 130 + len * 2); var s = ''; (h.match(/.{2}/g) || []).forEach(function (x) { s += String.fromCharCode(parseInt(x, 16)); }); return decodeURIComponent(escape(s)); } catch (e) { return null; } }
  function bytesToText(hexs) { var s = ''; (String(hexs).replace(/^0x/, '').match(/.{2}/g) || []).forEach(function (h) { var c = parseInt(h, 16); s += (c >= 32 && c < 127) ? String.fromCharCode(c) : ' '; }); return s; }
  var ERC20_BALANCE_OF = '0x70a08231';
  function quoteInfo(addr) {
    var a = String(addr || '').toLowerCase();
    if (!a || /^0x0{40}$/.test(a)) return { symbol: 'ETH', decimals: 18, usd: S.ethUsd };
    if (QUOTES[a]) { var q = QUOTES[a]; return { symbol: q.symbol, decimals: q.decimals, usd: /^USD/.test(q.symbol) ? 1 : (q.symbol === 'WETH' ? S.ethUsd : null) }; }
    S.learnQuote(a);
    return { symbol: 'token', decimals: 18, usd: null };
  }
  S.quoteInfo = quoteInfo;
  S.learnQuote = function (a) { // symbol + decimals of a quote token we have not seen (tokenized stocks, new stables)
    S._quoteLearn = S._quoteLearn || {}; if (S._quoteLearn[a]) return; S._quoteLearn[a] = 1;
    rpc([{ method: 'eth_call', params: [{ to: a, data: '0x95d89b41' }, 'latest'] }, { method: 'eth_call', params: [{ to: a, data: '0x313ce567' }, 'latest'] }]).then(function (res) {
      var sym = decStr(res[0]); var dec = res[1] ? parseInt(res[1], 16) : 18;
      if (sym) QUOTES[a] = { symbol: sym, decimals: U.isNum(dec) ? dec : 18 };
    }).catch(function () { delete S._quoteLearn[a]; });
  };
  S.pollHoodLaunches = function () {
    if (S._hoodPolling) return Promise.resolve(0);
    S._hoodPolling = true;
    return rpc({ method: 'eth_blockNumber', params: [] }).then(function (r) {
      var head = parseInt(r[0], 16); if (!U.isNum(head)) throw new Error('no block number');
      S.hood.head = head;
      var first = !S.hood.lastBlock;
      var from = first ? head - PONS.chunk * PONS.firstChunks : S.hood.lastBlock + 1;
      if (first) S.hood.backlog = { from: head - PONS.chunk * PONS.bootChunks, to: from - 1 }; // the rest of the hour, read behind the first screen
      if (from > head) return { head: head, launches: [], grads: [] };
      var ranges = []; for (var b = from; b <= head; b += PONS.chunk) ranges.push([b, Math.min(head, b + PONS.chunk - 1)]);
      var calls = [];
      ranges.forEach(function (rg) {
        calls.push({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [PONS.TokenLaunched], fromBlock: hex(rg[0]), toBlock: hex(rg[1]) }] });
        calls.push({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [[PONS.PoolGraduated, PONS.LaunchSwept]], fromBlock: hex(rg[0]), toBlock: hex(rg[1]) }] });
      });
      return rpcBatched(calls).then(function (res) {
        var launches = [], grads = [];
        res.forEach(function (list, i) { if (!Array.isArray(list)) return; if (i % 2 === 0) launches = launches.concat(list); else grads = grads.concat(list); });
        S.hood.lastBlock = head;
        if (first) { S.bootHoodGraduations(from - 1); setTimeout(function () { S.hoodBackfill(); }, 800); }
        return { head: head, launches: launches, grads: grads };
      });
    }).then(function (r) { return S.processHoodLaunches(r.launches, r.grads).then(function (n) { setStatus('hoodrpc', 'ok', n + ' launches, block ' + r.head + ' via ' + S.hoodRpcHost(r.launches.length || n ? 'tail' : 'logs')); if (n) store.chainMode.robinhood = 'live'; return n; }); })
      .catch(function (e) {
        setStatus('hoodrpc', 'err', e.message || 'unreachable');
        return S.hoodLogsViaBlockscout().then(function (r) { return S.processHoodLaunches(r.launches, r.grads); }).then(function (n) { if (n) store.chainMode.robinhood = 'live'; return n; });
      }).then(function (n) { S._hoodPolling = false; return n; }, function (e) { S._hoodPolling = false; throw e; });
  };
  // The launches older than the first screen, read block by block behind it so the feed is never waiting on them.
  S.hoodBackfill = function () {
    var b = S.hood.backlog;
    if (!b || S._hoodBackfilling || U.now() < S.hoodPauseUntil) return Promise.resolve(0);
    S._hoodBackfilling = true;
    var to = b.to, from = Math.max(b.from, to - PONS.chunk * 6 + 1);
    var calls = [];
    for (var x = from; x <= to; x += PONS.chunk) {
      var hi = Math.min(to, x + PONS.chunk - 1);
      calls.push({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [PONS.TokenLaunched], fromBlock: hex(x), toBlock: hex(hi) }] });
      calls.push({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [[PONS.PoolGraduated, PONS.LaunchSwept]], fromBlock: hex(x), toBlock: hex(hi) }] });
    }
    return rpcBatched(calls).then(function (res) {
      var launches = [], grads = [];
      res.forEach(function (list, i) { if (!Array.isArray(list)) return; if (i % 2 === 0) launches = launches.concat(list); else grads = grads.concat(list); });
      if (from <= b.from) delete S.hood.backlog; else b.to = from - 1;
      return S.processHoodLaunches(launches, grads);
    }).then(function (n) { S._hoodBackfilling = false; return n; }, function () { S._hoodBackfilling = false; return 0; });
  };
  // Blockscout knows the same factory logs (with block timestamps) and decodes the launch call: the fallback when the node refuses us
  S.pollHoodViaBlockscout = function () {
    return S.hoodLogsViaBlockscout().then(function (r) { return S.processHoodLaunches(r.launches, r.grads); }).then(function (n) { if (n) store.chainMode.robinhood = 'live'; setStatus('blockscout', 'ok', n + ' launches via Blockscout (RPC resting)'); return n; });
  };
  S.hoodLogsViaBlockscout = function () {
    return U.timeoutFetch(C.blockscout + '/addresses/' + PONS.factory + '/logs', 15000).then(function (r) {
      var items = r && Array.isArray(r.items) ? r.items : [];
      var toLog = function (it) { return { topics: it.topics || [], data: it.data || '0x', blockNumber: hex(U.num(it.block_number) || 0), transactionHash: it.transaction_hash, ts: it.block_timestamp ? Date.parse(it.block_timestamp) : null }; };
      var launches = items.filter(function (it) { return it.topics && it.topics[0] === PONS.TokenLaunched; }).map(toLog);
      var grads = items.filter(function (it) { return it.topics && (it.topics[0] === PONS.PoolGraduated || it.topics[0] === PONS.LaunchSwept); }).map(toLog);
      return { launches: launches, grads: grads };
    });
  };
  S.hoodDetailsViaBlockscout = function (recs) { // name, symbol, logo, socials from the decoded launch call; curve balance from the address page
    var n = 0;
    return Promise.all(recs.slice(0, 12).map(function (rec) {
      return Promise.all([U.timeoutFetch(C.blockscout + '/transactions/' + rec.tx, 15000).catch(function () { return null; }), U.timeoutFetch(C.blockscout + '/addresses/' + rec.curve, 10000).catch(function () { return null; })]).then(function (r) {
        var tx = r[0] || {}, ca = r[1] || {};
        var params = tx.decoded_input && Array.isArray(tx.decoded_input.parameters) ? tx.decoded_input.parameters : [];
        var p0 = params[0] && Array.isArray(params[0].value) ? params[0].value : null; // launch params tuple: name, symbol, logo, description, socials tuple
        var name = p0 && typeof p0[0] === 'string' ? p0[0] : '', symbol = p0 && typeof p0[1] === 'string' ? p0[1] : '', logoUri = p0 && typeof p0[2] === 'string' ? p0[2] : '';
        var socList = p0 && Array.isArray(p0[4]) ? p0[4].filter(function (x) { return typeof x === 'string' && /^https?:/.test(x); }) : [];
        var input = tx.raw_input ? bytesToText(tx.raw_input) : '';
        if (!logoUri) { var m = input.match(/ipfs:\/\/[A-Za-z0-9]+/); if (m) logoUri = m[0]; }
        var t = { chain: 'robinhood', address: rec.token, name: name, symbol: symbol || (name ? name.slice(0, 8) : '') || rec.token.slice(2, 8), launchpad: 'pons', createdAt: rec.ts || (tx.timestamp ? Date.parse(tx.timestamp) : null) };
        var ex = store.get('robinhood:' + rec.token);
        if (!(ex && ex.complete)) t.complete = false;
        var ethPair = !rec.pairToken || /^0x0{40}$/.test(rec.pairToken); var q = quoteInfo(ethPair ? null : rec.pairToken);
        t.quote = q.symbol;
        var raised = ethPair && U.num(ca.coin_balance) != null ? U.num(ca.coin_balance) : null;
        t.curveInfo = { curve: rec.curve, pairToken: rec.pairToken, threshold: rec.threshold, raised: raised, ethPair: ethPair, quoteDecimals: q.decimals, launchBlock: rec.block || null };
        if (!(ex && ex.complete)) t.curve = (U.isNum(raised) && rec.threshold) ? U.clamp(raised / rec.threshold, 0, 0.999) : 0;
        if (!(ex && ex.complete) && U.isNum(raised) && raised > 0 && q.usd) t.liq = raised / Math.pow(10, q.decimals) * q.usd; // after graduation the curve is emptied into the pool: its zero balance is not the token's liquidity
        t.dev = { address: rec.deployer || (tx.from && tx.from.hash ? String(tx.from.hash).toLowerCase() : null) };
        t.lpLocked = true; t.mintAuth = false; t.freezeAuth = false;
        if (/^ipfs:\/\//.test(logoUri)) t.logo = C.ponsImg + logoUri.replace('ipfs://', '') + '?variant=card'; else if (/^https?:/.test(logoUri)) t.logo = logoUri;
        var soc = {}; socList.concat(input.match(/https?:\/\/[A-Za-z0-9._\-\/?=&%#]+/g) || []).forEach(function (u) { if (/x\.com|twitter\.com/.test(u) && !soc.x) soc.x = u; else if (/t\.me/.test(u) && !soc.tg) soc.tg = u; else if (!soc.web && !/ipfs|pinata/.test(u)) soc.web = u; });
        t.socials = soc; if (rec.tx) t.launchTx = rec.tx;
        t.source = { core: 'Blockscout (Pons V2 launch)' };
        var tok = store.upsert(t);
        if (store._booted && !ex) { TL.ui && TL.ui.onStreamToken && TL.ui.onStreamToken(tok); }
        n++;
      });
    })).then(function () { if (n) { store.chainMode.robinhood = 'live'; setStatus('blockscout', 'ok', n + ' launches via Blockscout'); } return n; });
  };
  // graduations of the last day, read in the background right after boot (the Completed feed needs history, launches do not);
  // the official node returns a day of factory graduation logs in one call (196 logs in about a second on 16 Sep 2026)
  S.bootHoodGraduations = function (toBlock) {
    var run = function (list) { var grads = []; list.forEach(function (l) { if (Array.isArray(l)) grads = grads.concat(l); }); return S.processHoodLaunches([], grads); };
    var lo = Math.max(0, toBlock - PONS.gradChunks * PONS.chunk);
    return rpc({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [[PONS.PoolGraduated, PONS.LaunchSwept]], fromBlock: hex(lo), toBlock: hex(toBlock) }] }).then(run)
      .catch(function () { // a node that caps the range: 9000-block pieces over the last ~2.5 hours, one at a time
        var ranges = []; for (var hi = toBlock; hi > toBlock - 90000 && hi > 0; hi -= 9000) ranges.push([Math.max(0, hi - 8999), hi]);
        var step = function (k) { if (k >= ranges.length) return Promise.resolve(); return rpc({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [[PONS.PoolGraduated, PONS.LaunchSwept]], fromBlock: hex(ranges[k][0]), toBlock: hex(ranges[k][1]) }] }).then(run).catch(function () {}).then(function () { return step(k + 1); }); };
        return step(0);
      });
  };
  // The public Robinhood node accepts JSON-RPC batches of up to ~50 calls and rate-limits by IP, so launches are processed in
  // small groups, newest first, one batch at a time; the feed fills as each group lands.
  S.processHoodLaunches = function (launches, grads) {
    var recs = [];
    launches.forEach(function (l) {
      if (!l.topics || l.topics.length < 4) return;
      var data = String(l.data || '').replace(/^0x/, '');
      var rec = { token: addrFromTopic(l.topics[1]), curve: addrFromTopic(l.topics[2]), deployer: addrFromTopic(l.topics[3]), block: parseInt(l.blockNumber, 16), tx: l.transactionHash, ts: l.ts || null,
        pairToken: data.length >= 64 ? '0x' + data.slice(24, 64) : null, threshold: data.length >= 192 ? parseInt(data.slice(128, 192), 16) : null };
      if (S.hood.launches[rec.token]) return;
      S.hood.launches[rec.token] = rec; S.hood.curves[rec.curve] = rec.token; recs.push(rec);
    });
    var gradRecs = [];
    grads.forEach(function (l) {
      if (!l.topics || l.topics.length < 2) return;
      var token = addrFromTopic(l.topics[1]); var swept = l.topics[0] === PONS.LaunchSwept;
      if (S.hood.gradSeen[token] && !(S.hood.gradSeen[token].swept && !swept)) return; // one record per graduation; a PoolGraduated log wins over a sweep
      S.hood.gradSeen[token] = { swept: swept };
      gradRecs.push({ token: token, block: parseInt(l.blockNumber, 16), swept: swept, tx: l.transactionHash, ts: l.ts || null });
    });
    recs.sort(function (a, b) { return b.block - a.block; });
    if (recs.length > 600) { recs.slice(600).forEach(function (d) { delete S.hood.launches[d.token]; delete S.hood.curves[d.curve]; }); recs = recs.slice(0, 600); }
    var groups = []; for (var i = 0; i < recs.length; i += 9) groups.push(recs.slice(i, i + 9));
    var n = 0;
    var gi = 0;
    var runLaunch = function () {
      if (gi >= groups.length) return Promise.resolve();
      var g = groups[gi++];
      return processLaunchGroup(g).catch(function () { return S.hoodDetailsViaBlockscout(g); }).then(function (m) { n += m || 0; if (m) { store.chainMode.robinhood = 'live'; recomputeSoon(); } return runLaunch(); }, function () { return runLaunch(); });
    };
    return Promise.all([runLaunch(), runLaunch(), runLaunch()]).then(function () { return processGrads(gradRecs); }).then(function () { return n; });
  };
  function processLaunchGroup(recs) {
    var blocks = {}; recs.forEach(function (r) { blocks[r.block] = 1; });
    var blockList = Object.keys(blocks).map(Number);
    var calls = blockList.map(function (b) { return { method: 'eth_getBlockByNumber', params: [hex(b), false] }; });
    recs.forEach(function (rec) {
      calls.push({ method: 'eth_call', params: [{ to: rec.token, data: '0x06fdde03' }, 'latest'] });
      calls.push({ method: 'eth_call', params: [{ to: rec.token, data: '0x95d89b41' }, 'latest'] });
      var ethPair = !rec.pairToken || /^0x0{40}$/.test(rec.pairToken);
      if (ethPair) calls.push({ method: 'eth_getBalance', params: [rec.curve, 'latest'] });
      else calls.push({ method: 'eth_call', params: [{ to: rec.pairToken, data: ERC20_BALANCE_OF + rec.curve.replace(/^0x/, '').padStart(64, '0') }, 'latest'] });
      calls.push({ method: 'eth_getTransactionByHash', params: [rec.tx] });
    });
    return rpcBatched(calls).then(function (res) {
      var blockTs = {}; blockList.forEach(function (b, i) { var blk = res[i]; if (blk && blk.timestamp) blockTs[b] = parseInt(blk.timestamp, 16) * 1000; });
      recs.forEach(function (rec) { if (rec.ts && !blockTs[rec.block]) blockTs[rec.block] = rec.ts; });
      var off = blockList.length; var n = 0;
      recs.forEach(function (rec) {
        var name = decStr(res[off]), symbol = decStr(res[off + 1]), bal = res[off + 2], tx = res[off + 3]; off += 4;
        var t = { chain: 'robinhood', address: rec.token, name: name || '', symbol: symbol || (name ? name.slice(0, 8) : '') || rec.token.slice(2, 8), launchpad: 'pons', createdAt: blockTs[rec.block] || null };
        var ex = store.get('robinhood:' + rec.token);
        if (!(ex && ex.complete)) t.complete = false;
        var ethPair = !rec.pairToken || /^0x0{40}$/.test(rec.pairToken);
        var q = quoteInfo(ethPair ? null : rec.pairToken);
        t.quote = q.symbol;
        var raised = bal ? parseInt(bal, 16) : null;
        t.curveInfo = { curve: rec.curve, pairToken: rec.pairToken, threshold: rec.threshold, raised: raised, ethPair: ethPair, quoteDecimals: q.decimals, launchBlock: rec.block || null };
        if (!(ex && ex.complete)) t.curve = (U.isNum(raised) && rec.threshold) ? U.clamp(raised / rec.threshold, 0, 0.999) : 0;
        if (!(ex && ex.complete) && U.isNum(raised) && raised > 0 && q.usd) t.liq = raised / Math.pow(10, q.decimals) * q.usd; // see above: an empty curve is not zero liquidity
        t.dev = { address: rec.deployer };
        t.lpLocked = true; // Pons curve funds are program-owned, graduation locks liquidity permanently
        t.mintAuth = false; t.freezeAuth = false; // Pons V2 factory tokens: fixed 1B supply, bytecode has transfer and burn only (no mint, pause, owner, blacklist; checked 17 Sep 2026)
        var input = tx && tx.input ? bytesToText(tx.input) : '';
        var ipfs = input.match(/ipfs:\/\/[A-Za-z0-9]+/); if (ipfs) t.logo = C.ponsImg + ipfs[0].replace('ipfs://', '') + '?variant=card';
        var urls = input.match(/https?:\/\/[A-Za-z0-9._\-\/?=&%#]+/g) || [];
        var soc = {}; urls.forEach(function (u) { if (/x\.com|twitter\.com/.test(u) && !soc.x) soc.x = u; else if (/t\.me/.test(u) && !soc.tg) soc.tg = u; else if (!soc.web && !/ipfs|pinata/.test(u)) soc.web = u; });
        t.socials = soc;
        if (rec.tx) t.launchTx = rec.tx;
        t.source = { core: 'Robinhood Chain RPC (Pons V2)' };
        var tok = store.upsert(t);
        if (store._booted && !ex) { TL.ui && TL.ui.onStreamToken && TL.ui.onStreamToken(tok); }
        n++;
      });
      return n;
    });
  }
  function processGrads(gradRecs) {
    if (!gradRecs.length) return Promise.resolve(0);
    var groups = []; for (var i = 0; i < gradRecs.length; i += 15) groups.push(gradRecs.slice(i, i + 15));
    var run = function (k) {
      if (k >= groups.length) return Promise.resolve();
      var g = groups[k]; var blocks = {}; g.forEach(function (r) { blocks[r.block] = 1; }); var blockList = Object.keys(blocks).map(Number);
      var calls = blockList.map(function (b) { return { method: 'eth_getBlockByNumber', params: [hex(b), false] }; });
      g.forEach(function (r) { if (!r.swept && r.tx) calls.push({ method: 'eth_getTransactionReceipt', params: [r.tx] }); });
      return rpcBatched(calls).then(function (res) {
        var blockTs = {}; blockList.forEach(function (b, i) { var blk = res[i]; if (blk && blk.timestamp) blockTs[b] = parseInt(blk.timestamp, 16) * 1000; });
        g.forEach(function (r) { if (r.ts && !blockTs[r.block]) blockTs[r.block] = r.ts; });
        var off = blockList.length;
        g.forEach(function (r) {
          var patch = { chain: 'robinhood', address: r.token, complete: true, curve: null, graduatedAt: blockTs[r.block] || U.now(), launchpad: 'uniswap v4', lpLocked: true, mintAuth: false, freezeAuth: false, source: { grad: 'Pons V2 ' + (r.swept ? 'LaunchSwept' : 'PoolGraduated') } };
          if (!r.swept && r.tx) {
            var rc = res[off]; off++;
            var init = rc && Array.isArray(rc.logs) ? rc.logs.filter(function (l) { return l.topics && l.topics[0] === UNI.Initialize; })[0] : null;
            if (init) {
              var w = words(init.data); var c0 = addrFromTopic(init.topics[2]), c1 = addrFromTopic(init.topics[3]);
              var tokenIs1 = c1.toLowerCase() === r.token.toLowerCase();
              var quoteAddr = tokenIs1 ? c0 : c1; var q = quoteInfo(quoteAddr);
              S.hood.pools[r.token] = { id: init.topics[1], tokenIs1: tokenIs1, quote: quoteAddr, quoteDecimals: q.decimals, quoteSymbol: q.symbol, tick: w.length >= 5 ? int24(w[4]) : null, since: patch.graduatedAt };
              patch.pair = init.topics[1]; patch.quote = q.symbol; patch.poolInfo = S.hood.pools[r.token];
              var price = S.hoodPoolPrice(S.hood.pools[r.token], S.hood.pools[r.token].tick);
              if (price != null) { patch.price = price; patch.mc = price * 1e9; }
            }
          }
          store.upsert(patch);
          var known = store.get('robinhood:' + r.token);
          if (!known.name || !S.hood.launches[r.token]) S.lookupHoodLaunch(r.token);
        });
        S.flushLookups();
        recomputeSoon();
      }).catch(function () {}).then(function () { return run(k + 1); });
    };
    return run(0);
  }
  // graduated tokens whose launch we never saw (they launched before this page opened): their TokenLaunched logs are fetched
  // in groups of 40 with the token addresses as a topic filter (one call per group over the last ~3.5 days of blocks)
  var lookupQueue = [], lookupBusy = false;
  S.lookupHoodLaunch = function (token) {
    S._lookedUp = S._lookedUp || {}; if (S._lookedUp[token]) return; S._lookedUp[token] = 1;
    lookupQueue.push(token);
  };
  S.flushLookups = function () {
    if (lookupBusy || !lookupQueue.length) return;
    lookupBusy = true;
    var batch = lookupQueue.splice(0, 40);
    var topics = batch.map(function (t) { return '0x000000000000000000000000' + t.replace(/^0x/, '').toLowerCase(); });
    rpc({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [PONS.TokenLaunched, topics], fromBlock: hex(Math.max(0, (S.hood.head || S.hood.lastBlock || 0) - 3000000)), toBlock: hex(S.hood.head || S.hood.lastBlock || 0) }] }).then(function (r) {
      var logs = Array.isArray(r[0]) ? r[0] : [];
      var seen = {}; logs.forEach(function (l) { seen[addrFromTopic(l.topics[1])] = 1; });
      var missing = batch.filter(function (t) { return !seen[t]; });
      var p = logs.length ? S.processHoodLaunches(logs, []) : Promise.resolve(0);
      return p.then(function () {
        if (!missing.length) return;
        var calls = []; missing.forEach(function (t) { calls.push({ method: 'eth_call', params: [{ to: t, data: '0x06fdde03' }, 'latest'] }); calls.push({ method: 'eth_call', params: [{ to: t, data: '0x95d89b41' }, 'latest'] }); });
        return rpcBatched(calls).then(function (res) { missing.forEach(function (t, i) { store.upsert({ chain: 'robinhood', address: t, name: decStr(res[i * 2]) || '', symbol: decStr(res[i * 2 + 1]) || t.slice(2, 8), createdApprox: true }); }); });
      });
    }).catch(function () { }).then(function () { lookupBusy = false; recomputeSoon(); if (lookupQueue.length) setTimeout(S.flushLookups, 1500); });
  };
  // price of one token in USD from a Uniswap v4 tick (Pons launches are 1B-supply, 18-decimal tokens)
  S.hoodPoolPrice = function (pool, tick) {
    if (!pool || !U.isNum(tick)) return null;
    var q = quoteInfo(pool.quote); if (!q.usd) return null;
    var raw = Math.pow(1.0001, tick); // currency1 per currency0, raw units
    var priceQuote = pool.tokenIs1 ? Math.pow(10, 18 - q.decimals) / raw : raw * Math.pow(10, 18 - q.decimals);
    return priceQuote * q.usd;
  };
  // swaps on the Uniswap v4 pools of graduated tokens: last price, buys/sells, volume, 1h change, price path
  S.pollHoodPools = function () {
    var ids = Object.keys(S.hood.pools).filter(function (tok) { var t = store.get('robinhood:' + tok); return t && !t.demo; }).sort(function (a, b) { var ta = store.get('robinhood:' + a), tb = store.get('robinhood:' + b); return (tb.graduatedAt || 0) - (ta.graduatedAt || 0); }).slice(0, 150);
    if (!ids.length) return Promise.resolve(0);
    var byPool = {}; ids.forEach(function (tok) { byPool[S.hood.pools[tok].id.toLowerCase()] = tok; });
    return rpc([{ method: 'eth_blockNumber', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }]).then(function (r) {
      var head = parseInt(r[0], 16);
      var headTs = r[1] && r[1].timestamp ? parseInt(r[1].timestamp, 16) * 1000 : U.now();
      var tsOf = function (blockHex) { return headTs - (head - parseInt(blockHex, 16)) * 103; };
      var topics = [UNI.Swap, ids.map(function (tok) { return S.hood.pools[tok].id; })];
      return rpc([
        { method: 'eth_getLogs', params: [{ address: UNI.poolManager, topics: topics, fromBlock: hex(head - 3000), toBlock: 'latest' }] },
        { method: 'eth_getLogs', params: [{ address: UNI.poolManager, topics: topics, fromBlock: hex(head - 36000), toBlock: hex(head - 3001) }] }
      ]).then(function (res) {
        var agg = {}, points = {};
        function add(list, w) {
          (list || []).forEach(function (l) {
            var tok = byPool[(l.topics[1] || '').toLowerCase()]; if (!tok) return;
            var pool = S.hood.pools[tok]; var ws = words(l.data); if (ws.length < 6) return; // amount0, amount1, sqrtPriceX96, liquidity, tick, fee
            var a0 = int128(ws[0]), a1 = int128(ws[1]); var tick = int24(ws[4]);
            var tokenDelta = pool.tokenIs1 ? a1 : a0, quoteDelta = pool.tokenIs1 ? a0 : a1;
            var buy = tokenDelta > 0n; // the trader receives tokens
            var q = quoteInfo(pool.quote);
            var quoteAmt = Number(quoteDelta < 0n ? -quoteDelta : quoteDelta) / Math.pow(10, q.decimals);
            var a = agg[tok] = agg[tok] || { m5: { b: 0, s: 0, q: 0 }, h1: { b: 0, s: 0, q: 0 } };
            a[w][buy ? 'b' : 's']++; a[w].q += quoteAmt; if (w === 'm5') { a.h1[buy ? 'b' : 's']++; a.h1.q += quoteAmt; }
            var price = S.hoodPoolPrice(pool, tick);
            (points[tok] = points[tok] || []).push({ t: tsOf(l.blockNumber), c: price, tick: tick, buy: buy, sq: u256(ws[2]), L: u256(ws[3]) });
          });
        }
        add(res[0], 'm5'); add(res[1], 'h1');
        var n = 0;
        ids.forEach(function (tok) {
          var t = store.get('robinhood:' + tok); if (!t) return;
          var pool = S.hood.pools[tok]; var q = quoteInfo(pool.quote);
          var a = agg[tok];
          var p = { chain: 'robinhood', address: tok, quote: q.symbol, source: { market: 'Uniswap v4 swaps (on-chain)' } };
          if (a) {
            p.tx = { m5: { b: a.m5.b, s: a.m5.s }, h1: { b: a.h1.b, s: a.h1.s } };
            p.vol = { m5: q.usd ? a.m5.q * q.usd : null, h1: q.usd ? a.h1.q * q.usd : null };
            p.lastTradeAt = U.now();
            var pts = (points[tok] || []).sort(function (x, y) { return x.t - y.t; });
            if (pts.length) {
              var last = pts[pts.length - 1]; pool.tick = last.tick;
              var tvl = poolTvlUsd(pool, last.sq, last.L, q); if (U.isNum(tvl)) { p.liq = tvl; p.liqSrc = 'uniswap v4 pool'; }
              if (U.isNum(last.c)) {
                p.price = last.c; p.mc = last.c * 1e9;
                var h1 = pts.filter(function (x) { return x.t >= U.now() - TL.HR && U.isNum(x.c); });
                if (h1.length >= 2) p.chg = { h1: (last.c / h1[0].c - 1) * 100 };
                var m5 = pts.filter(function (x) { return x.t >= U.now() - 5 * TL.MIN && U.isNum(x.c); });
                if (m5.length >= 2) { p.chg = p.chg || {}; p.chg.m5 = (last.c / m5[0].c - 1) * 100; }
                t.series = pts.filter(function (x) { return U.isNum(x.c); }).map(function (x) { return { t: x.t, c: x.c, buy: x.buy }; }); t.seriesLive = false; t.seriesSrc = 'Uniswap v4 swaps (on-chain)';
              }
            }
          } else { p.tx = { m5: { b: 0, s: 0 }, h1: { b: 0, s: 0 } }; p.vol = { m5: 0, h1: 0 }; }
          if (p.price == null && U.isNum(pool.tick)) { var pr = S.hoodPoolPrice(pool, pool.tick); if (pr != null) { p.price = pr; if (!U.isNum(t.mc)) p.mc = pr * 1e9; } }
          store.upsert(p); n++;
        });
        return n;
      });
    }).catch(function () { return 0; });
  };
  // Uniswap v4 swap events carry sqrtPriceX96 and the active liquidity L. In the active range the quote side holds
  // L * sqrtP (or L / sqrtP when the quote is token0), and a full-range pool is the same on both sides, so twice that
  // is the pool's TVL. It is an estimate, and it is the only liquidity number a browser can read from v4's singleton.
  function u256(w) { return BigInt('0x' + String(w || '0')); }
  function poolTvlUsd(pool, sqrtX96, L, q) {
    if (!sqrtX96 || !L || L <= 0n || sqrtX96 <= 0n) return null;
    var Q96 = 1n << 96n;
    var amtQuote = pool.tokenIs1 ? (L * Q96) / sqrtX96 : (L * sqrtX96) / Q96;
    var v = Number(amtQuote) / Math.pow(10, q.decimals);
    if (!isFinite(v) || v <= 0) return null;
    return q.usd ? v * 2 * q.usd : null;
  }
  // buys / sells on the curves we know over the last hour (official node: ~10 000 logs for 300 curves in under a second).
  // From the same logs, for tokens launched inside the window, the wallet positions give holders, top-10 share, dev share,
  // dev sells, snipers (bought in the launch block or the next) and bundles (several wallets buying in the launch block).
  var SUPPLY = 1e27; // Pons launches: fixed 1B supply, 18 decimals
  S.pollHoodCurveActivity = function () {
    var curves = Object.keys(S.hood.curves).filter(function (c) { var t = store.get('robinhood:' + S.hood.curves[c]); return t && !t.complete && !t.demo; })
      .sort(function (a, b) { var ta = store.get('robinhood:' + S.hood.curves[a]), tb = store.get('robinhood:' + S.hood.curves[b]); return (tb.createdAt || 0) - (ta.createdAt || 0); }).slice(0, 300);
    if (!curves.length) return Promise.resolve(0);
    return rpc([{ method: 'eth_blockNumber', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }]).then(function (r) {
      var head = parseInt(r[0], 16); S.hood.head = head;
      var headTs = r[1] && r[1].timestamp ? parseInt(r[1].timestamp, 16) * 1000 : U.now();
      var tsOf = function (blockHex) { return headTs - (head - parseInt(blockHex, 16)) * 103; }; // ~0.103 s per block on Robinhood Chain
      var windowBlocks = 36000, windowStart = headTs - windowBlocks * 103;
      return rpc([
        { method: 'eth_getLogs', params: [{ address: curves, topics: [[PONS.CurveBuy, PONS.CurveSell]], fromBlock: hex(head - 3000), toBlock: hex(head) }] },
        { method: 'eth_getLogs', params: [{ address: curves, topics: [[PONS.CurveBuy, PONS.CurveSell]], fromBlock: hex(head - windowBlocks), toBlock: hex(head - 3001) }] }
      ]).then(function (res) {
        var agg = {}, points = {}, pos = {}, firstBlocks = {}, evs = [];
        function add(list, w) {
          (list || []).forEach(function (l) {
            var tok = S.hood.curves[l.address.toLowerCase()] || S.hood.curves[l.address]; if (!tok) return;
            var a = agg[tok] = agg[tok] || { m5: { b: 0, s: 0, q: 0 }, h1: { b: 0, s: 0, q: 0 } };
            var buy = l.topics[0] === PONS.CurveBuy; var data = String(l.data || '').replace(/^0x/, '');
            var w0 = data.length >= 64 ? parseInt(data.slice(0, 64), 16) : 0, w1 = data.length >= 128 ? parseInt(data.slice(64, 128), 16) : 0;
            var quote = buy ? w0 : w1, tokens = buy ? w1 : w0;
            a[w][buy ? 'b' : 's']++; a[w].q += quote; if (w === 'm5') { a.h1[buy ? 'b' : 's']++; a.h1.q += quote; }
            if (quote > 0 && tokens > 0) (points[tok] = points[tok] || []).push({ t: tsOf(l.blockNumber), c: quote / tokens, buy: buy });
            var who = l.topics[2] ? addrFromTopic(l.topics[2]) : (l.topics[1] ? addrFromTopic(l.topics[1]) : null);
            if (who) evs.push({ tok: tok, who: who, blk: parseInt(l.blockNumber, 16), li: parseInt(l.logIndex || '0x0', 16) || 0, buy: buy, tokens: tokens });
          });
        }
        add(res[0], 'm5'); add(res[1], 'h1');
        // balances in chain order (the two windows arrive newest first), so a wallet's peak bag and what it sold from it are real
        evs.sort(function (x, y) { return x.blk - y.blk || x.li - y.li; }).forEach(function (ev) {
          var P = pos[ev.tok] = pos[ev.tok] || {}; var e = P[ev.who] = P[ev.who] || { bal: 0, peak: 0, firstBlock: ev.blk, sold: false };
          e.bal += ev.buy ? ev.tokens : -ev.tokens; if (e.bal > e.peak) e.peak = e.bal;
          if (ev.buy && ev.blk < e.firstBlock) e.firstBlock = ev.blk; if (!ev.buy) e.sold = true;
          if (ev.buy && (firstBlocks[ev.tok] == null || ev.blk < firstBlocks[ev.tok])) firstBlocks[ev.tok] = ev.blk;
        });
        curves.forEach(function (c) { var tok = S.hood.curves[c]; if (!tok || agg[tok]) return; var t = store.get('robinhood:' + tok); if (!t) return; store.upsert({ chain: 'robinhood', address: tok, tx: { m5: { b: 0, s: 0 }, h1: { b: 0, s: 0 } }, vol: { m5: 0, h1: 0 }, watchedAt: t.watchedAt || U.now() }); });
        Object.keys(agg).forEach(function (tok) {
          var t = store.get('robinhood:' + tok); if (!t) return;
          var a = agg[tok]; var ci = t.curveInfo || {}; var q = quoteInfo(ci.ethPair ? null : ci.pairToken);
          var toUsd = function (v) { return q.usd ? v / Math.pow(10, q.decimals) * q.usd : null; };
          var p = { chain: 'robinhood', address: tok, tx: { m5: { b: a.m5.b, s: a.m5.s }, h1: { b: a.h1.b, s: a.h1.s } }, vol: { m5: toUsd(a.m5.q), h1: toUsd(a.h1.q) }, lastTradeAt: U.now() };
          var pts = (points[tok] || []).sort(function (x, y) { return x.t - y.t; });
          if (pts.length >= 2) {
            var mul = q.usd ? q.usd * Math.pow(10, 18 - q.decimals) : 1; // quote-per-token in raw units -> USD per whole token
            t.series = pts.map(function (x) { return { t: x.t, c: x.c * mul, buy: x.buy }; }); t.seriesLive = false; t.seriesSrc = 'Pons curve trades' + (q.usd ? ' (USD)' : ' (quote per token)');
            var last = pts[pts.length - 1].c, h1 = pts.filter(function (x) { return x.t >= U.now() - TL.HR; });
            if (h1.length >= 2) p.chg = { h1: (last / h1[0].c - 1) * 100 };
            if (q.usd) { p.price = last * mul; p.mc = last * mul * 1e9; p.supply = 1e9; p.capSrc = 'curve price \u00d7 1B supply'; } // Pons launches are fixed 1B-supply tokens
          }
          // wallet positions: complete only for tokens launched inside the window
          var launchRec = S.hood.launches[tok];
          if (pos[tok] && U.isNum(t.createdAt) && t.createdAt >= windowStart + 60 * TL.SEC) {
            var P = pos[tok]; var addrs = Object.keys(P); var launchBlock = launchRec && launchRec.block ? launchRec.block : firstBlocks[tok];
            var holders = 0, top = [], snip = 0, bundleAddrs = 0, bundleHeld = 0, circ = 0;
            addrs.forEach(function (a2) { var e = P[a2]; if (e.bal > 0) { holders++; top.push(e.bal); circ += e.bal; }
              if (launchBlock != null && e.firstBlock <= launchBlock + 1) { snip += Math.max(0, e.bal); }
              if (launchBlock != null && e.firstBlock === launchBlock && a2 !== (launchRec && launchRec.deployer)) { bundleAddrs++; bundleHeld += Math.max(0, e.bal); } });
            top.sort(function (x, y) { return y - x; });
            var top10 = top.slice(0, 10).reduce(function (x, y) { return x + y; }, 0);
            p.holders = holders; p.holdersSrc = 'curve positions'; p.circulating = circ / SUPPLY;
            p.top10 = top10 / SUPPLY; p.top10Src = 'curve positions on-chain';                                        // share of the whole supply, the curve itself not counted (Jupiter's basis on Solana)
            p.sniperPct = snip / SUPPLY; p.bundlePct = bundleAddrs >= 2 ? bundleHeld / SUPPLY : 0;
            if (launchRec && launchRec.deployer) { var d = P[launchRec.deployer]; var dumped = !!(d && d.sold && d.bal < d.peak * 0.5); p.dev = { address: launchRec.deployer, pct: d ? Math.max(0, d.bal) / SUPPLY : 0, sold: dumped, soldSome: !!(d && d.sold && !dumped) }; }
            p.simulated = {}; p.posSrc = 'Pons curve trades (on-chain)'; p.checkedAt = U.now();
          }
          var wasChecked = !!t.checkedAt; var tk = store.upsert(p);
          if (!wasChecked && tk.checkedAt && TL.ui && TL.ui.offer) TL.ui.offer(tk);
        });
        return Object.keys(agg).length;
      });
    }).catch(function () { return 0; });
  };
  // refresh curve balances (progress) for curve tokens on screen
  S.refreshHoodCurves = function (ids) {
    var toks = (ids || []).map(function (id) { return store.get(id); }).filter(function (t) { return t && t.chain === 'robinhood' && t.curveInfo && !t.complete; }).slice(0, 40);
    if (!toks.length) return Promise.resolve(0);
    var calls = toks.map(function (t) { var ci = t.curveInfo; return ci.ethPair ? { method: 'eth_getBalance', params: [ci.curve, 'latest'] } : { method: 'eth_call', params: [{ to: ci.pairToken, data: ERC20_BALANCE_OF + ci.curve.replace(/^0x/, '').padStart(64, '0') }, 'latest'] }; });
    return rpc(calls).then(function (res) {
      toks.forEach(function (t, i) { var raised = res[i] ? parseInt(res[i], 16) : null; if (!U.isNum(raised)) return; t.curveInfo.raised = raised; var q = quoteInfo(t.curveInfo.ethPair ? null : t.curveInfo.pairToken); var p = { chain: 'robinhood', address: t.address, curve: t.curveInfo.threshold ? U.clamp(raised / t.curveInfo.threshold, 0, 0.999) : t.curve }; if (q.usd) p.liq = raised / Math.pow(10, q.decimals) * q.usd; store.upsert(p); });
      return toks.length;
    }).catch(function () { return 0; });
  };

  // holder counts for the Robinhood tokens on screen: Blockscout indexes a token a few minutes after launch (404 before that);
  // its count includes the curve or pool contract, so one is taken off. Fresh tokens keep the count from curve positions meanwhile.
  var bsSlots = 6;
  S.enrichHoodVisible = function (ids) {
    var now = U.now();
    var toks = (ids || []).map(function (id) { return store.get(id); }).filter(function (t) {
      if (!t || t.chain !== 'robinhood' || t.demo || t.partial) return false;
      var wait = t._bs404 ? 5 * TL.MIN : 60 * TL.SEC;
      return !(t._bsAt && now - t._bsAt < wait);
    }).slice(0, 30);
    if (!toks.length) return Promise.resolve(0);
    var i = 0, n = 0;
    var worker = function () {
      if (i >= toks.length) return Promise.resolve();
      var t = toks[i++]; t._bsAt = U.now();
      var born = Promise.resolve();
      return born.then(function () { return U.timeoutFetch(C.blockscout + '/tokens/' + t.address, 10000); }).then(function (info) {
        var count = U.num(info && (info.holders_count != null ? info.holders_count : info.holders));
        var p = { chain: 'robinhood', address: t.address };
        if (count != null) { p.holders = Math.max(0, count - 1); p.holdersSrc = 'blockscout'; t._bs404 = false; n++; }
        if (info && info.icon_url && !t.logo) p.logo = info.icon_url;
        store.upsert(p);
      }, function (e) { if (/404/.test(e && e.message || '')) t._bs404 = true; }).then(worker);
    };
    var workers = []; for (var k = 0; k < bsSlots; k++) workers.push(worker());
    return Promise.all(workers).then(function () { if (n) setStatus('blockscout', 'ok', n + ' holder counts'); return n; });
  };

  // Robinhood tokens the positions window does not cover (launched over an hour ago, or first seen at graduation) are checked from
  // Blockscout's holder list: a few per run, the busiest first, never a pool that is already dead.
  S.checkHood = function () {
    var now = U.now();
    var list = store.all().filter(function (t) {
      if (t.chain !== 'robinhood' || t.demo || t.partial || t.top || t.checkedAt || !t.ready || !TL.trusted(t)) return false;
      if (!t.complete && U.isNum(t.createdAt) && now - t.createdAt < 3 * TL.MIN) return false; // fresh curves get wallet positions within 30 s
      if (t._chkAt && now - t._chkAt < (t._chk404 ? 3 * TL.MIN : 25 * TL.SEC)) return false;
      if ((t._chkN || 0) >= 8) return false;
      TL.ensureVet(t); return !TL.stale(t);
    }).sort(function (a, b) { return ((b.tx.h1 && b.tx.h1.b) || 0) - ((a.tx.h1 && a.tx.h1.b) || 0) || (b.mc || 0) - (a.mc || 0); }).slice(0, 12);
    if (!list.length) return Promise.resolve(0);
    var i = 0, n = 0;
    var worker = function () {
      if (i >= list.length) return Promise.resolve();
      var t = list[i++]; t._chkAt = U.now(); t._chkN = (t._chkN || 0) + 1;
      return S.blockscoutHolders(t).then(function () { t._chk404 = false; if (t.checkedAt) { n++; if (TL.ui && TL.ui.offer) TL.ui.offer(t); } }, function (e) { if (/404/.test(e && e.message || '')) t._chk404 = true; }).then(worker);
    };
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () { return n; });
  };

  // ---------- Blockscout (Robinhood Chain holders) ----------
  S.blockscoutHolders = function (t) {
    if (t.chain !== 'robinhood' || t.partial || t.demo) return Promise.reject(new Error('n/a'));
    var base = C.blockscout + '/tokens/' + t.address;
    return Promise.all([U.timeoutFetch(base), U.timeoutFetch(base + '/holders')]).then(function (res) {
      var info = res[0] || {}, hold = res[1] || {};
      var p = { chain: t.chain, address: t.address };
      var count = U.num(info.holders_count != null ? info.holders_count : info.holders); if (count != null) { p.holders = Math.max(0, count - 1); p.holdersSrc = 'blockscout'; } // the curve or pool contract is one of them
      if (info.icon_url && !t.logo) p.logo = info.icon_url;
      if (!t.name && info.name) p.name = info.name; if (!t.symbol && info.symbol) p.symbol = info.symbol;
      if (!S.hood.launches[t.address] && !S.hood.pools[t.address]) { // not a Pons token: its market numbers come from Blockscout's price feed
        if (U.num(info.circulating_market_cap) != null) p.mc = U.num(info.circulating_market_cap);
        if (U.num(info.exchange_rate) != null) p.price = U.num(info.exchange_rate);
        if (U.num(info.volume_24h) != null) p.vol = { h24: U.num(info.volume_24h) };
        if (!t.launchpad || t.launchpad === 'unknown') p.launchpad = 'robinhood chain';
        if (!U.isNum(t.createdAt) && S.hoodBornQueue.indexOf(t.address) < 0) S.hoodBornQueue.push(t.address);
      }
      var total = U.num(info.total_supply);
      var items = Array.isArray(hold.items) ? hold.items : [];
      if (total && items.length) {
        var wallets = items.filter(function (h) { return !(h.address && h.address.is_contract); }); // pool manager, curve and lockers hold tokens nobody can dump
        var sorted = wallets.map(function (h) { return U.num(h.value) || 0; }).sort(function (a, b) { return b - a; });
        var sum = function (arr) { return arr.reduce(function (a, b) { return a + b; }, 0); };
        p.top10 = sum(sorted.slice(0, 10)) / total; p.top10Src = 'Blockscout holder list';
        p.dist = { top10: p.top10, t11_30: sum(sorted.slice(10, 30)) / total, t31_50: sum(sorted.slice(30, 50)) / total, rest: Math.max(0, 1 - sum(sorted.slice(0, 50)) / total) };
        p.topHolders = items.slice(0, 10).map(function (h) { return { address: h.address && h.address.hash, pct: (U.num(h.value) || 0) / total, tag: h.address && (h.address.name || (h.address.is_contract ? 'contract' : null)) }; });
        var dep = (S.hood.launches[t.address] && S.hood.launches[t.address].deployer) || (t.dev && t.dev.address);
        if (dep) {
          var dh = items.filter(function (h) { return h.address && String(h.address.hash).toLowerCase() === String(dep).toLowerCase(); })[0];
          if (dh) p.dev = { address: dep, pct: (U.num(dh.value) || 0) / total };
          else if (sorted.length >= 10) p.dev = { address: dep, pct: 0 }; // not among the listed holders: below the smallest of them
        }
        p.checkedAt = U.now();
      } else if (total && count != null && count <= 1) p.checkedAt = U.now();
      p.source = { holders: 'Blockscout' };
      setStatus('blockscout', 'ok', 'holders loaded');
      store.upsert(p); return p;
    }).catch(function (e) { setStatus('blockscout', 'err', e.message || 'blocked'); throw e; });
  };

  // ---------- logo pipeline: every token gets a picture ----------
  var LOGO_CACHE_KEY = 'tl.logos';
  var logoCache = (function () {
    try {
      var c = JSON.parse(localStorage.getItem(LOGO_CACHE_KEY) || '{}'); var dirtyCache = false;
      Object.keys(c).forEach(function (k) { if (typeof c[k] !== 'string' || TL.BAD_LOGO.test(c[k])) { delete c[k]; dirtyCache = true; } }); // purge the placeholder an earlier build cached
      if (dirtyCache) localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(c));
      return c;
    } catch (e) { return {}; }
  })();
  var logoSaveTimer = null;
  function rememberLogo(t) {
    if (!t.logo || t.logo.indexOf('data:') === 0 || TL.BAD_LOGO.test(t.logo)) return;
    logoCache[t.id] = t.logo;
    if (logoSaveTimer) return;
    logoSaveTimer = setTimeout(function () { logoSaveTimer = null; try { var keys = Object.keys(logoCache); if (keys.length > 2500) keys.slice(0, keys.length - 2000).forEach(function (k) { delete logoCache[k]; }); localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(logoCache)); } catch (e) {} }, 1500);
  }
  var logoInflight = 0, LOGO_PAR = 4;
  // a token "needs a logo" until one of its candidates actually rendered (logoOk); retries back off: 15s, 30s, 60s, 120s, 240s, then every 10 min
  var BACKOFF = [4, 8, 15, 30, 60, 120, 300, 600];
  function needsLogo(t, now) {
    if (t.logoOk || t.demo || t.partial) return false;
    var n = t.logoAttempts || 0; if (n >= 20) return false;
    var wait = BACKOFF[Math.min(n, BACKOFF.length - 1)] * TL.SEC;
    return !t.logoTriedAt || now - t.logoTriedAt > wait;
  }
  S.retryLogoSoon = function (t) {
    if (!t || t.logoOk || t.demo || t.partial) return;
    t._quickRetries = (t._quickRetries || 0) + 1; if (t._quickRetries > 6) return;
    setTimeout(function () {
      if (t.logoOk) return;
      if (t.chain === 'solana') { t.logo = null; t.logoFailed = false; (t.uri ? S.fetchMetaNow(t.address, t.uri) : S.enrichJup([t.address])).then(function () { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(t); }).catch(function () {}); }
      else { t.logoFailed = false; TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(t); }
    }, 3000 * t._quickRetries);
  };
  S.markLogoOk = function (t, src) {
    if (!src || TL.BAD_LOGO.test(src)) return;
    if (src.indexOf('data:') === 0) { t.logoGen = src; return; } // the generated stand-in: keep looking for the token's real picture
    t.logoOk = src; logoCache[t.id] = src; rememberLogo({ id: t.id, logo: src });
  };
  // Pons puts a CID in the launch call. Usually it is the picture itself; sometimes it is a metadata JSON.
  // When no gateway could render it as an image, read it once through a public gateway and take the image field.
  S.hoodMetaFromCid = function (t, cid) {
    var urls = ['https://ipfs.filebase.io/ipfs/' + cid, 'https://4everland.io/ipfs/' + cid, 'https://ipfs.io/ipfs/' + cid, 'https://dweb.link/ipfs/' + cid]; // v2.10: filebase first (it answers where ipfs.io does not)
    var tryOne = function (i) {
      if (i >= urls.length) return Promise.reject(new Error('no metadata'));
      return U.timeoutFetch(urls[i], 8000).then(function (meta) {
        var img = meta && (meta.image || meta.image_uri || meta.imageUrl || meta.icon);
        if (!img) throw new Error('no image in metadata');
        var ic = TL.cidOf(img);
        store.upsert({ chain: t.chain, address: t.address, logo: ic ? 'https://ipfs.filebase.io/ipfs/' + ic : String(img), logoFailed: false, source: { logo: 'Pons metadata' } });
        return true;
      }, function () { return tryOne(i + 1); });
    };
    return tryOne(0);
  };
  S.resolveLogos = function (priorityIds) {
    var now = U.now();
    store.all().forEach(function (t) { if (!t.logo && logoCache[t.id]) { t.logo = logoCache[t.id]; t.source.logo = 'cache'; } });
    var todo = store.all().filter(function (t) { return needsLogo(t, now) && (!t.logo || t.logoFailed); });
    var rank = {}; (priorityIds || []).forEach(function (id, i) { rank[id] = i; });
    todo.sort(function (a, b) { return (rank[a.id] != null ? rank[a.id] : 1e6) - (rank[b.id] != null ? rank[b.id] : 1e6) || (b.createdAt || 0) - (a.createdAt || 0); });
    var sol = todo.filter(function (t) { return t.chain === 'solana'; }).slice(0, 100);
    if (sol.length) {
      sol.forEach(function (t) { t.logoAttempts = (t.logoAttempts || 0) + 1; t.logoTriedAt = now; t.logoFailed = false; });
      S.enrichJup(sol.map(function (t) { return t.address; })).then(function () {
        sol.forEach(function (t) {
          if (t.logo) { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(t); return; }
          if (t.uri) { S.fetchMetaNow(t.address, t.uri).then(function () { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(t); }).catch(function () { }); return; }
          if (!t._metaRpcAt || U.now() - t._metaRpcAt > 60 * TL.SEC) { // seconds-old token: read its metadata account straight from the chain
            t._metaRpcAt = U.now();
            S.solMetaUri(t.address).then(function (uri) { return S.fetchMetaNow(t.address, uri); })
              .then(function () { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(store.get(t.id) || t); }).catch(function () { });
          }
        });
      });
    }
    S._logoQueue = todo.filter(function (t) { return t.chain !== 'solana'; }).slice(0, 60);
    pumpLogos();
  };
  function pumpLogos() {
    while (logoInflight < LOGO_PAR && S._logoQueue && S._logoQueue.length) {
      var t = S._logoQueue.shift();
      if (t.logoOk) continue;
      t.logoAttempts = (t.logoAttempts || 0) + 1; t.logoTriedAt = U.now(); t.logoFailed = false; logoInflight++;
      (function (t) {
        var cid = t.chain === 'robinhood' && t.logo && !t._cidTried ? TL.cidOf(t.logo) : null;
        var p = cid ? (t._cidTried = true, S.hoodMetaFromCid(t, cid)) :
          (t.chain === 'robinhood' && !S.hood.launches[t.address] ? Promise.resolve(S.lookupHoodLaunch(t.address)).then(function () { S.flushLookups(); }) : Promise.reject());
        p = p.catch(function () { return S.blockscoutHolders(t); });
        p.catch(function () {}).then(function () { logoInflight--; if (t.logo) { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(t); } pumpLogos(); });
      })(t);
    }
  }
  var metaSlots = 4, metaWaiting = [];
  function metaAcquire() { return new Promise(function (res) { if (metaSlots > 0) { metaSlots--; res(); } else metaWaiting.push(res); }); }
  function metaRelease() { var next = metaWaiting.shift(); if (next) next(); else metaSlots++; }
  var META_RETRY = [1500, 3000, 6000, 12000];
  // A token seconds old is not in Jupiter yet, and without the stream we never saw its URI. Its Metaplex metadata
  // account holds that URI (and the picture behind it), so ask the chain directly. Public nodes often refuse
  // getProgramAccounts, so every failure here is silent and the usual paths carry on.
  var META_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
  function b64bytes(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function readStr(bytes, off) {
    if (off + 4 > bytes.length) return null;
    var len = bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
    if (len < 0 || len > 400 || off + 4 + len > bytes.length) return null;
    var s2 = ''; for (var i = 0; i < len; i++) { var c = bytes[off + 4 + i]; if (c) s2 += String.fromCharCode(c); }
    return { value: s2.replace(/\u0000+$/, '').trim(), next: off + 4 + len };
  }
  // v2.10: the metadata account is found by its address (the Metaplex PDA of the mint) and read with getAccountInfo. Until 2.10 it was
  // searched with getProgramAccounts, which the public node refuses ("indexed requests require a personal token"): every such read failed
  var META_SEED = new TextEncoder().encode('metadata'), metaPdas = {};
  function metaPda(mint) {
    if (metaPdas[mint]) return Promise.resolve(metaPdas[mint]);
    var mb = b58dec(mint), pid = b58dec(META_PROGRAM); if (!mb || mb.length !== 32) return Promise.resolve(null);
    return findPda([META_SEED, pid, mb], pid).then(function (a) { if (a) metaPdas[mint] = a; return a; });
  }
  S.metaPda = metaPda;
  // v2.10: pump.fun mints are Token-2022 now, with their name, symbol and metadata address inside the mint account (the TokenMetadata
  // extension, type 19); there is no Metaplex account for them at all. One getAccountInfo of the mint reads it. An older SPL mint keeps
  // its metadata in the Metaplex account at its PDA, read the same way.
  function t22Meta(b) {
    if (!b || b.length <= 166) return null;
    var o = 166; // the extensions start after the mint (82 bytes), its padding and the account-type byte at 165
    while (o + 4 <= b.length) {
      var type = b[o] | (b[o + 1] << 8), len = b[o + 2] | (b[o + 3] << 8); o += 4;
      if (type === 19 && o + 64 <= b.length) {
        var p = o + 64, rd = function () { if (p + 4 > b.length) return null; var n = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; if (n > 400 || p + 4 + n > b.length) return null; var v = new TextDecoder().decode(b.subarray(p + 4, p + 4 + n)); p += 4 + n; return v; };
        var name = rd(), sym = rd(), uri = rd(); return uri != null ? { name: name || '', symbol: sym || '', uri: uri } : null;
      }
      if (!type && !len) break;
      o += len;
    }
    return null;
  }
  S.t22Meta = t22Meta;
  function saveMeta(mint, m) {
    var uri = String(m.uri || '').replace(/\0+$/, '').trim(); if (!/^https?:|^ipfs:/.test(uri)) throw new Error('no uri');
    var p2 = { chain: 'solana', address: mint, uri: uri };
    if (m.name) p2.name = m.name; if (m.symbol) p2.symbol = m.symbol;
    store.upsert(p2);
    return uri;
  }
  S.solMetaUri = function (mint) {
    return solRpc('getAccountInfo', [mint, { encoding: 'base64', commitment: 'processed' }]).then(function (info) {
      var v = info && info.value; if (!v || !v.data) throw new Error('no mint account');
      var m = t22Meta(b64bytes(v.data[0]));
      if (m) return saveMeta(mint, m);
      return metaPda(mint).then(function (pda) { // a classic SPL mint: the Metaplex account
        if (!pda) throw new Error('no metadata address');
        return solRpc('getAccountInfo', [pda, { encoding: 'base64', commitment: 'processed', dataSlice: { offset: 0, length: 400 } }]);
      }).then(function (pi) {
        var acc = pi && pi.value && pi.value.data ? pi.value.data[0] : null;
        if (!acc) throw new Error('no metadata account');
        var b = b64bytes(acc);
        var name = readStr(b, 65); if (!name) throw new Error('bad metadata');
        var sym = readStr(b, name.next); if (!sym) throw new Error('bad metadata');
        var uri = readStr(b, sym.next); if (!uri) throw new Error('no uri');
        return saveMeta(mint, { name: name.value, symbol: sym.value, uri: uri.value });
      });
    });
  };
  // the metadata JSON behind a token: every gateway that can serve the CID is asked at once and the first answer wins,
  // so one slow or blocked gateway (they differ by country) never costs the picture
  function metaUrls(uri) {
    var cid = TL.cidOf(uri);
    if (!cid) return [uri];
    // v2.10: pinata, filebase and 4everland answered where ipfs.io, dweb.link and w3s.link did not (8 Oct 2026); all of them are asked at once
    return ['https://pump.mypinata.cloud/ipfs/' + cid, 'https://ipfs.filebase.io/ipfs/' + cid, 'https://4everland.io/ipfs/' + cid, 'https://ipfs.io/ipfs/' + cid, 'https://dweb.link/ipfs/' + cid, 'https://w3s.link/ipfs/' + cid].concat(/^https?:/.test(uri) && !/mypinata|filebase|4everland|ipfs\.io|dweb\.link|w3s\.link/.test(uri) ? [uri] : []);
  }
  // v2.10: in waves: the two fastest gateways at once, the next two after 1.2 s (or as soon as both failed), the rest after 2.5 s. Until
  // 2.10 all six were asked at once for every token, and half of them never answer in some countries
  function raceJson(urls, ms) {
    return new Promise(function (resolve, reject) {
      var n = urls.length, done = false, failed = 0, started = 0, timers = []; if (!n) return reject(new Error('no url'));
      var fire = function (upto) {
        while (started < Math.min(upto, n)) {
          (function (u) { U.timeoutFetch(u, ms).then(function (j) { if (!done) { done = true; timers.forEach(clearTimeout); resolve(j); } }, function () { failed++; if (done) return; if (failed >= n) { done = true; reject(new Error('no gateway answered')); } else if (failed >= started) fire(started + 2); }); })(urls[started++]);
        }
      };
      fire(2); timers.push(setTimeout(function () { if (!done) fire(4); }, 1200)); timers.push(setTimeout(function () { if (!done) fire(n); }, 2500));
    });
  }
  S.metaUrls = metaUrls;
  S.fetchMetaNow = function (mint, uri, attempt) {
    attempt = attempt || 0;
    var t = store.get('solana:' + mint); if (t) t.logoTriedAt = U.now();
    return metaAcquire().then(function () { return raceJson(metaUrls(uri), 7000); }).then(function (meta) { metaRelease(); return meta; }, function (e) {
      metaRelease();
      if (attempt < META_RETRY.length) setTimeout(function () { var tk = store.get('solana:' + mint); if (tk && tk.logoOk) return; S.fetchMetaNow(mint, uri, attempt + 1).then(function () { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(store.get('solana:' + mint)); }).catch(function () {}); }, META_RETRY[attempt]);
      throw e;
    }).then(function (meta) {
      var img = meta && (meta.image || meta.image_uri || meta.imageUrl);
      var p = { chain: 'solana', address: mint };
      if (img) p.logo = img;
      var soc = {}; if (meta && meta.twitter) soc.x = meta.twitter; if (meta && meta.telegram) soc.tg = meta.telegram; if (meta && meta.website) soc.web = meta.website;
      p.socials = soc; if (meta && meta.description) p.description = meta.description;
      store.upsert(p);
      if (!img) throw new Error('no image in metadata');
      return p;
    });
  };

  // ---------- X posts: the launch post a token links to, through X's oEmbed (author, date, text; a 404 means the post is gone) ----------
  var tweetCache = {}, TWEET_KEY = 'tl.tweets';
  try { tweetCache = JSON.parse(localStorage.getItem(TWEET_KEY) || '{}') || {}; } catch (e) { tweetCache = {}; }
  S.tweetRef = function (url) { var m = String(url || '').match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/i); return m ? { user: m[1], id: m[2] } : null; };
  S.tweetCached = function (url) { var ref = S.tweetRef(url); var c = ref && tweetCache[ref.id]; return c && U.now() - c.at < 24 * TL.HR ? c : null; };
  var tweetInflight = {};
  S.fetchTweet = function (url, t) {
    var ref = S.tweetRef(url); if (!ref) return Promise.reject(new Error('not a post'));
    var c = S.tweetCached(url); if (c) { if (t && c.gone && !t.postGone) { t.postGone = true; } return Promise.resolve(c); }
    if (tweetInflight[ref.id]) return tweetInflight[ref.id];
    var api = C.oembed + '?url=' + encodeURIComponent('https://twitter.com/' + ref.user + '/status/' + ref.id) + '&omit_script=1&dnt=1&hide_thread=1';
    var p = fetch(api).then(function (r) { if (r.status === 404) return { gone: true }; if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      var out = { id: ref.id, user: ref.user, at: U.now(), url: url };
      if (j.gone) out.gone = true;
      else {
        var h = String(j.html || ''); var m = h.match(/<p[^>]*>([\s\S]*?)<\/p>/); var d = h.match(/<a href="[^"]+">([^<]+)<\/a>\s*<\/blockquote>/);
        out.author = j.author_name || ref.user; out.date = d ? d[1] : ''; out.hasMedia = /pic\.twitter\.com/.test(h);
        out.body = m ? m[1] : ''; // X's own escaped markup: text, <br>, <a href> links
        out.text = out.body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        out.embed = h;
      }
      tweetCache[ref.id] = out;
      try { var keys = Object.keys(tweetCache); if (keys.length > 400) keys.slice(0, keys.length - 300).forEach(function (k) { delete tweetCache[k]; }); localStorage.setItem(TWEET_KEY, JSON.stringify(tweetCache)); } catch (e) {}
      if (t) { if (out.gone && !t.postGone) { t.postGone = true; t._flags = TL.flags(t); } }
      return out;
    });
    tweetInflight[ref.id] = p; p.catch(function () {}).then(function () { delete tweetInflight[ref.id]; });
    return p;
  };

  // ---------- PumpPortal WebSocket: launches and migrations (trade subscriptions need a funded API key, so trades come from curve reads) ----------
  S.connectPumpPortal = function () {
    if (!C.pumpportal || typeof WebSocket === 'undefined') return;
    try {
      var ws = new WebSocket(C.pumpportal);
      S.ws = ws;
      ws.onopen = function () {
        ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
        ws.send(JSON.stringify({ method: 'subscribeMigration' }));
        setStatus('pumpportal', 'ok', 'streaming');
      };
      ws.onmessage = function (ev) {
        var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (!d || !d.mint) return;
        // the stream also carries letsbonk (pool "bonk") and other pools: not trusted launchpads, dropped before they cost a curve read.
        // pump.fun events say "pump" on create and "pump-amm" on migration; a missing pool field means pump.fun too
        var pumpPool = !d.pool || /^pump/i.test(String(d.pool));
        if (!pumpPool || (d.txType === 'migrate' && !store.get('solana:' + d.mint) && !/pump$/.test(d.mint))) { S.droppedLaunchpads = (S.droppedLaunchpads || 0) + 1; return; }
        if (d.txType === 'create') {
          var mcSol = U.num(d.marketCapSol);
          var t = { chain: 'solana', address: d.mint, name: d.name || '', symbol: d.symbol || '', launchpad: 'pump.fun', quote: 'SOL', createdAt: U.now(),
            curve: U.isNum(d.vSolInBondingCurve) ? U.clamp((d.vSolInBondingCurve - 30) / 85, 0, 0.999) : (mcSol != null && S.solUsd ? U.clamp(TL.pumpCurveFromMc(mcSol * S.solUsd) || 0, 0, 0.999) : null), complete: false,
            mc: mcSol != null && S.solUsd ? mcSol * S.solUsd : null, dev: { address: d.traderPublicKey || null }, mintAuth: false, freezeAuth: false, lpLocked: true,
            tx: { m5: { b: 1, s: 0 }, h1: { b: 1, s: 0 } }, source: { core: 'pump.fun stream' }, uri: d.uri || null, streamed: true, holders: 1, holdersSrc: 'stream' };
          if (U.isNum(d.solAmount) && S.solUsd) t.vol = { m5: d.solAmount * S.solUsd, h1: d.solAmount * S.solUsd };
          if (U.isNum(d.initialBuy)) { t.dev.pct = U.clamp(d.initialBuy / 1e9, 0, 1); t.devInit = t.dev.pct; }
          if (mcSol != null && S.solUsd) t.price = mcSol * S.solUsd / 1e9;
          var tok = store.upsert(t);
          // the token's own metadata (pump.fun keeps it on its pinata gateway) is the only trustworthy picture source this early
          if (d.uri) S.fetchMetaNow(d.mint, d.uri).then(function () { TL.ui && TL.ui.logoArrived && TL.ui.logoArrived(tok); }).catch(function () {});
          else tok.needsMeta = true;
          if (d.bondingCurveKey) S.sol.curves[d.mint] = d.bondingCurveKey; else S.curveAddr(d.mint); // the curve address, so the next on-chain read includes this token
          TL.ui && TL.ui.onStreamToken && TL.ui.onStreamToken(tok);
        } else if (d.txType === 'migrate') {
          store.upsert({ chain: 'solana', address: d.mint, complete: true, curve: null, graduatedAt: U.now(), launchpad: 'pumpswap', source: { grad: 'pump.fun stream' } });
          TL.ui && TL.ui.scheduleRender();
        }
      };
      ws.onerror = function () { setStatus('pumpportal', 'err', 'connection failed'); };
      ws.onclose = function () { if (S.status.pumpportal.state === 'ok') setStatus('pumpportal', 'err', 'closed'); };
    } catch (e) { setStatus('pumpportal', 'err', e.message); }
  };

  // ---------- token page: everything one token needs, fetched on its own (a token opened from a link may be in no feed) ----------
  S.focusToken = function (t) {
    if (!t || t.demo || t.partial || store.mode === 'demo') return Promise.resolve(t);
    var G = TL.gmgn;
    if (G && G.active()) { // GMGN's token record first; the public sources below still fill curves, pools and trades
      var gm = G.pollToken(t, true);
      return Promise.all([gm, S.focusPublic(t).catch(function () { return null; })]).then(function () { return store.get(t.id); });
    }
    return S.focusPublic(t);
  };
  S.focusPublic = function (t) {
    if (t.chain === 'solana') {
      return S.enrichJup([t.address]).catch(function () { return 0; }).then(function () {
        var tk = store.get(t.id);
        return tk && !tk.complete && /pump$/.test(tk.address) ? S.pollSolCurves([tk.id]).catch(function () { return 0; }) : 0;
      }).then(function () { return store.get(t.id); });
    }
    var addr = String(t.address).toLowerCase(), topic = '0x000000000000000000000000' + addr.replace(/^0x/, '');
    var headP = S.hood.head ? Promise.resolve(S.hood.head) : rpc({ method: 'eth_blockNumber', params: [] }).then(function (r) { S.hood.head = parseInt(r[0], 16); return S.hood.head; });
    return headP.then(function (head) {
      var from = hex(Math.max(0, head - 3000000)), to = hex(head), jobs = [];
      if (!S.hood.launches[addr]) jobs.push(rpc({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [PONS.TokenLaunched, topic], fromBlock: from, toBlock: to }] }).then(function (r) { var logs = r && Array.isArray(r[0]) ? r[0] : []; return logs.length ? S.processHoodLaunches(logs, []) : 0; }));
      if (!S.hood.pools[addr]) jobs.push(rpc({ method: 'eth_getLogs', params: [{ address: PONS.factory, topics: [[PONS.PoolGraduated, PONS.LaunchSwept], topic], fromBlock: from, toBlock: to }] }).then(function (r) { var logs = r && Array.isArray(r[0]) ? r[0] : []; return logs.length ? S.processHoodLaunches([], logs) : 0; }));
      return Promise.all(jobs.map(function (j) { return j.catch(function () { return 0; }); }));
    }).catch(function () { return 0; }).then(function () {
      var tk = store.get(t.id) || t; var more = [S.blockscoutHolders(tk).catch(function () { return null; })];
      if (!S.hood.launches[addr]) more.push(S.hoodCodeCheck([addr])); // not a Pons token: read what its contract can do
      if (tk.curveInfo && !tk.complete) more.push(S.refreshHoodCurves([tk.id]));
      return Promise.all(more);
    }).then(function () { return store.get(t.id); });
  };
  // a tab opened straight on a token polls that token only (many token tabs must not each run the whole feed); going back to the
  // feed starts the full loop. Nothing is polled while the tab is in the background.
  S.startLite = function () {
    S.lite = true; var tick = 0; var noop = function () {};
    if (TL.gmgn) TL.gmgn.start(); // with a key the page polls GMGN's token record every 10 s (its own timer)
    S.liteTimer = setInterval(function () {
      tick++;
      if (store.mode === 'live') TL.dayWatched(5 * TL.SEC); // today's counters only count time the terminal was actually open
      var id = TL.ui && TL.ui.state.page; var t = id && store.get(id); if (!t || document.hidden) return;
      if (!t.ready && tick % 2 === 0) { S.focusToken(t).then(recomputeSoon, noop); return; }
      if (t.chain === 'solana') {
        if (!t.complete && /pump$/.test(t.address)) S.pollSolCurves([t.id]).then(recomputeSoon, noop);   // 5 s: the curve on-chain
        if (tick % 3 === 0) S.enrichJup([t.address]).then(recomputeSoon, noop);                            // 15 s: Jupiter's numbers
      } else {
        if (tick % 2 === 0 && t.curveInfo && !t.complete) S.refreshHoodCurves([t.id]).then(recomputeSoon, noop);
        if (tick % 6 === 3 && S.hood.launches[t.address]) S.pollHoodCurveActivity().then(recomputeSoon, noop); // 30 s: curve trades and wallet positions
        if (tick % 6 === 5 && S.hood.pools[t.address]) S.pollHoodPools().then(recomputeSoon, noop);           // 30 s: pool swaps after graduation
        if (tick % 12 === 7) S.blockscoutHolders(t).then(recomputeSoon, noop);                               // 60 s: holders
        if (tick % 2 === 1 && S.hoodBornQueue.length) S.hoodBorn().then(recomputeSoon, noop);
      }
      if (tick % 12 === 1) S.pollPrices();
    }, 5 * TL.SEC);
  };
  S.stopLite = function () { if (S.liteTimer) clearInterval(S.liteTimer); S.liteTimer = null; S.lite = false; };

  // ---------- orchestration ----------
  function solIdsForCurves(vis) {
    // on-screen pump.fun tokens first, then the newest streamed ones, up to 100 per RPC call
    var ids = (vis || []).slice();
    var rest = store.all().filter(function (t) { return t.chain === 'solana' && !t.complete && !t.demo && !t.partial && ids.indexOf(t.id) < 0; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    rest.slice(0, Math.max(0, 100 - ids.length)).forEach(function (t) { ids.push(t.id); });
    return ids;
  }
  S.enrichVisible = function (vis) {
    var mints = (vis || []).map(function (id) { return store.get(id); }).filter(function (t) { return t && t.chain === 'solana' && !t.demo && !t.partial; }).slice(0, 100).map(function (t) { return t.address; });
    return S.enrichJup(mints);
  };
  S.cycle = function () {
    var early = function (n) { if (n && !store._booted) { store.recompute(); } return n; }; // paint rows as soon as the first source answers
    var prices = S.pollPrices();
    var jup = prices.then(function () { return S.pollJupRecent(); }).then(early).catch(function () { return 0; });
    var pump = S.pollPump().catch(function () { return 0; });
    var hood = prices.then(function () { return S.pollHoodLaunches(); }).then(early).catch(function () { return 0; });
    var gm = TL.gmgn ? TL.gmgn.bootCycle().then(function (f) { if (f && (f.solana || f.robinhood) && !store._booted) store.recompute(); return f || {}; }) : Promise.resolve({}); // v1.40: bootCycle itself finds the site's own proxy first
    return Promise.all([jup, pump, hood, gm]).then(function (res) {
      var vis = TL.ui ? TL.ui.visibleIds() : [];
      var curves = S.pollSolCurves(solIdsForCurves(vis)).catch(function () { return 0; });
      if (res[2] > 0) { S.pollHoodCurveActivity().catch(function () {}); S.pollHoodPools().catch(function () {}); }
      return curves.then(function () { S.resolveLogos(vis); return { solana: res[0] > 0 || res[1] > 0 || !!res[3].solana, robinhood: res[2] > 0 || !!res[3].robinhood }; });
    });
  };
  // one scheduler, staggered, each source on its own cadence; recompute at most every 10 s
  var lastRecompute = 0;
  function recomputeSoon() { var now = U.now(); if (now - lastRecompute < 10 * TL.SEC) return; lastRecompute = now; store.recompute(); }
  // tokens restored from the local cache: rebuild the Pons curve / pool registries so polling covers them too
  S.adoptCached = function () {
    store.all().forEach(function (t) {
      if (t.chain !== 'robinhood' || !t.cached) return;
      var ci = t.curveInfo;
      if (ci && ci.curve && !S.hood.launches[t.address]) { S.hood.launches[t.address] = { token: t.address, curve: ci.curve, deployer: t.dev && t.dev.address, pairToken: ci.pairToken, threshold: ci.threshold, tx: t.launchTx, block: ci.launchBlock || 0 }; S.hood.curves[ci.curve] = t.address; }
      if (t.poolInfo && t.poolInfo.id && !S.hood.pools[t.address]) S.hood.pools[t.address] = t.poolInfo;
      if (t.complete) S.hood.gradSeen[t.address] = { swept: false };
    });
  };
  S.start = function () {
    var tick = 0;
    S.adoptCached();
    // v1.35: a boot that timed out (slow network, a blocked source) is not a verdict. The moment a chain answers, the terminal
    // is live: the fast lane, the day journal and the calls all wait on this flag, and the pill says so.
    S.timers.push(setInterval(function () {
      if (store.mode !== 'offline') return;
      if (store.chainMode.solana === 'live' || store.chainMode.robinhood === 'live') {
        store.mode = 'live'; store._booted = true;
        try { var bn = document.getElementById('bootNote'); if (bn) bn.textContent = 'Live \u00b7 curves on-chain every 5 s'; } catch (e) {}
        if (TL.ui && TL.ui.renderAll) TL.ui.renderAll();
        if (TL.calls && TL.calls.start) TL.calls.start({ followOnly: !!TL.CONFIG.callsFeed });
      }
    }, 3000));
    if (TL.gmgn) TL.gmgn.start(); // GMGN runs on its own 1-second scheduler when a key is set
    S.timers.push(setInterval(function () {
      tick++;
      var vis = TL.ui ? TL.ui.visibleIds() : [];
      var net = TL.ui ? TL.ui.state.net : 'solana';
      if (net === 'solana') S.pollSolCurves(solIdsForCurves(vis)).then(recomputeSoon);                            // 5 s: exact curves of everything on screen
      var gmS = !!(TL.gmgn && TL.gmgn.primary('solana')), gmH = !!(TL.gmgn && TL.gmgn.primary('robinhood')); // GMGN in charge: the public lists become a slow backup
      if (tick % (gmS && !TL.LISTS_FAST ? 24 : 6) === 0) S.pollJupRecent().then(recomputeSoon).catch(function () {});              // 30 s (2 min with GMGN; v1.78: the data service asks for 30 s always, TL.LISTS_FAST): newest / trending snapshot
      if (tick % 9 === 4 && net === 'solana') S.enrichVisible(vis).then(recomputeSoon).catch(function () {});     // 45 s: holders, audit, post-graduation market data
      var hoodOk = U.now() > S.hoodPauseUntil;
      if (hoodOk) S.pollHoodLaunches().then(recomputeSoon).catch(function () {});                                // 5 s: new Pons launches and graduations (the last ~50 blocks from PublicNode)
      if (!hoodOk && tick % 6 === 1) S.pollHoodViaBlockscout().then(recomputeSoon).catch(function () {});        // while every RPC is resting: launches straight from Blockscout every 30 s
      if (hoodOk && S.hood.backlog) S.hoodBackfill().then(recomputeSoon);                                        // behind the first screen: the rest of the last hour of launches
      if (hoodOk && (net === 'robinhood' ? tick % 2 === 1 : tick % 6 === 3)) S.pollHoodCurveActivity().then(recomputeSoon); // 10 s on Robinhood (30 s off-screen): trades, positions, holders, snipers on the curves
      if (hoodOk && tick % 9 === 5) S.pollHoodPools().then(recomputeSoon);                                       // 45 s: Uniswap v4 swaps of graduated tokens
      if (hoodOk && tick % 6 === 2 && net === 'robinhood') S.refreshHoodCurves(vis).then(recomputeSoon);         // 30 s, only when looking at Robinhood: curve progress on screen
      if (tick % 9 === 4 && net === 'robinhood') S.enrichHoodVisible(vis).then(recomputeSoon).catch(function () {}); // 45 s: Blockscout holder counts on screen
      if (tick >= 4 && !gmS) S.solTop().then(recomputeSoon);   // from 20 s after boot, refreshed every 15 min (its own guard): Top from Jupiter when GMGN is not in charge
      if (tick >= 4 && !gmH) S.hoodTop().then(recomputeSoon);
      if (tick % 12 === 7) S.pollPrices();                                                                       // 60 s: SOL and ETH in USD
      if (tick % 2 === 1) S.resolveLogos(vis);                                                                   // 10 s sweep for missing pictures, rows on screen first
      if (tick % 6 === 0) { var keep = {}; if (TL.ui) { Object.keys(TL.ui.state.watch).forEach(function (k) { keep[k] = 1; }); if (TL.ui.state.selected) keep[TL.ui.state.selected] = 1; } var removed = store.evict(keep); if (removed) { store._rev++; } }
      if (tick % 4 === 0) { lastRecompute = 0; recomputeSoon(); }                                                 // 20 s: stages and ages move on
      if (net === 'solana' || tick % 3 === 0) S.checkSol();                                                         // 5 s (15 s off-screen): Jupiter records for new launches, the check before a token may show
      if (net === 'robinhood' ? tick % 2 === 1 : tick % 6 === 5) S.checkHood().then(recomputeSoon).catch(function () {}); // 10 s on Robinhood: the holder check that lets a launch into the feed
      if (tick % 2 === 1 && S.hoodBornQueue.length) S.hoodBorn().then(recomputeSoon);                                  // 10 s: creation time of Robinhood Top coins (the Top age switch)                                  // 30 s: Blockscout holder lists for Robinhood tokens outside the positions window
      if (tick % 6 === 3) store.save();                                                                             // 30 s: keep the feed for the next visit
    }, 5 * TL.SEC));
    // the fast lane: whatever is on screen, and the open token page, refreshed every 1.5 s so the numbers really move
    var quiet = function () {};
    S.timers.push(setInterval(function () {
      if (document.hidden || store.mode !== 'live') return;
      var ui = TL.ui; if (!ui) return;
      var net = ui.state.net;
      var page = ui.state.page ? store.get(ui.state.page) : null;
      if (page) { // the open page: only the cheap on-chain reads at this rate, the heavier records keep their own cycle
        if (page.chain === 'solana') S.pollSolCurves([page.id]).then(recomputeSoon, quiet);
        else if (U.now() > S.hoodPauseUntil) S.refreshHoodCurves([page.id]).then(recomputeSoon, quiet);
        return;
      }
      var vis = ui.visibleIds().slice(0, 14);
      if (!vis.length) return;
      if (net === 'solana') S.pollSolCurves(solIdsForCurves(vis)).then(recomputeSoon, quiet);
      else if (U.now() > S.hoodPauseUntil) S.refreshHoodCurves(vis).then(recomputeSoon, quiet);
    }, 1500));
    setTimeout(function () { S.checkSol(); S.checkHood().then(recomputeSoon).catch(function () {}); S.pollHoodCurveActivity().then(recomputeSoon).catch(function () {}); }, 1500); // the first checks right after boot, not on the first tick
    S.connectPumpPortal();
  };
})(window.TL);
