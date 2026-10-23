/* |CHAMELEON⟩ core: config, utils, the token model, scoring, the store (the prototype of 15 Sep 2026 was called Trenchlight) */
window.TL = (function () {
  'use strict';
  var TL = {};
  var SEC = 1000, MIN = 60 * SEC, HR = 60 * MIN, DAY = 24 * HR;

  // ---------- config ----------
  var params = new URLSearchParams(location.search);
  // v1.59: on the site itself a URL parameter can no longer name a data server (?api=, ?calls=, ?known=, ?terminal=, ?nft=, ?rpc=, ?gmgn=...):
  // a crafted link could otherwise feed the page an attacker's data. `src(k)` is the parameter off the site, nothing on it
  var SITE = { domain: 'chameleonscope.com' };
  var onSite = !!SITE.domain && /^https?:$/.test(location.protocol) && new RegExp('(^|\\.)' + SITE.domain.replace(/\./g, '\\.') + '$', 'i').test(location.hostname);
  function src(k) { return onSite ? null : params.get(k); }
  function lsRead(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  // v1.38: the live site's own services, all behind one domain (server/install.sh puts them there):
  // btc.<domain> = the BTC Prediction Machine, bot.<domain> = the data service (calls, ranking, known traders), api.<domain> = the GMGN proxy.
  // Fill `domain` once the server exists; empty = public sources only, and the BTC tabs explain how to start the terminal.
  function svc(sub, path) { return SITE.domain && !apiOverride ? 'https://' + sub + '.' + SITE.domain + (path || '') : ''; }
  var apiOverride = src('api'); // e.g. ?api=http://localhost:8787 (mock server for tests); never on the site
  // v1.40: a page served from the site itself belongs to visitors: the setup cards (GMGN source, own nodes) stay hidden there
  // unless the owner opens it with ?setup=1. The local file, localhost and previews show them as before.
  TL.CONFIG = {
    apiOverride: apiOverride,
    forcedMode: params.get('mode'), // 'demo' | 'live' | null
    callsFeed: src('calls') || svc('bot', '/calls.json'),  // v1.32: the data service's shared call journal (GET /calls.json), shown to every visitor; ?calls=https://bot.example.com/calls.json
    boardFeed: src('board') || svc('bot', '/board.json'),  // v1.41: the Smart Tracking ranking the data service builds for everyone (GET /board.json); empty = the page builds its own
    knownFeed: src('known') || svc('bot', '/known.json'),  // v1.48: the registry of known traders (KOLs, top wallets) the data service keeps and their buys of the day (GET /known.json)
    // v1.94: the gate: on the site's own domain the terminal opens for anyone who signs in with Phantom (src/app_gate.js); ?gate=phantom
    // turns it on elsewhere (the tests). No account server: the wallet's public address is the identity
    // (src/app_account.js), and nothing about a person leaves the browser
    phantomGate: onSite || params.get('gate') === 'phantom',
    // v2.00: Chameleon Valley, the online farm game. Its page is the site's own folder /valley/ (same origin: in the Valley tab the game
    // borrows this page's Phantom, which does not inject itself into frames); its server answers at valley.<domain> (who is online,
    // the farms, the WebSocket of positions). ?valley= and ?valleyapi= point elsewhere off the site (tests)
    valleyPage: src('valley') || (onSite ? location.origin + '/valley/' : (SITE.domain ? 'https://' + SITE.domain + '/valley/' : '')),
    valleyApi: src('valleyapi') || svc('valley'),
    btcServer: src('terminal') || svc('btc'),               // v1.34: where the BTC Prediction Machine runs (its own Node server); empty = same origin under /btc, or localhost:8787 when opened as a file
    gmgnProxyDefault: svc('api', '/gmgn'),      // v1.40: the site's own GMGN proxy (server/gmgn_proxy.py behind api.<domain>). The page asks it once at start and uses it when it answers with a key on the server; a key or ?gmgn= in the browser wins
    siteDomain: SITE.domain,
    onSite: onSite,
    setupCards: !onSite || params.get('setup') === '1',
    // v1.37: the project's public links, one place to change them (the header, the footer and the Calls strip read these)
    links: { x: 'https://x.com/ChameleonScopee' }, // the project's X account
    // v1.43: the Trading bot tab's kit downloads live in the site's /downloads/ folder when published (v1.94: the Mint NFT tab is gone:
    // the collection was on Robinhood Chain and the project moves to Solana)
    downloads: apiOverride ? [apiOverride + '/downloads/'] : (onSite ? [location.origin + '/downloads/'] : SITE.domain ? ['https://' + SITE.domain + '/downloads/'] : []),
    pump: apiOverride ? apiOverride + '/pump' : 'https://frontend-api-v3.pump.fun',
    blockscout: apiOverride ? apiOverride + '/blockscout' : 'https://robinhoodchain.blockscout.com/api/v2',
    oembed: apiOverride ? apiOverride + '/oembed' : 'https://publish.twitter.com/oembed', // X's oEmbed answers browsers directly (checked 17 Sep 2026)
    pumpportal: apiOverride ? null : 'wss://pumpportal.fun/api/data',
    hoodRpc: 'https://rpc.mainnet.chain.robinhood.com',
    // v1.35: your own node first. A Helius / QuickNode / Triton URL (free tiers are plenty) reads curves and trades without the
    // public node's rate limits; ?rpc=... or the Data sources panel saves it in this browser. Robinhood Chain: ?hoodrpc=...
    solRpc: apiOverride ? apiOverride + '/solrpc' : (src('rpc') || lsRead('tl.solRpc') || 'https://solana-rpc.publicnode.com'),
    hoodRpcOwn: apiOverride ? '' : (src('hoodrpc') || lsRead('tl.hoodRpc') || ''),
    dexscreener: apiOverride ? apiOverride + '/dexscreener' : 'https://api.dexscreener.com', // the pools of a token, any DEX, no key
    gmgnKline: 'https://www.gmgn.cc/kline/',   // GMGN chart embed: /kline/{sol|robinhood}/{address}
    gmgnSite: 'https://gmgn.ai/',              // GMGN token page: /{sol|robinhood}/token/{address}
    refs: { gmgn: 'D095yRgq', axiom: 'chamscope', photon: 'mmet' }, // v2.10: no pump.fun invite code any more. v1.66: the team's referral codes in every terminal link (GMGN: CODE_ADDRESS in the path, the documented form; Axiom: /t/MINT/@handle; Photon: /en/r/@handle/MINT)
    bootTimeout: 7 * SEC,
    fetchTimeout: 10 * SEC,
    PUMP_INITIAL_REAL_RESERVES: 793100000000000, // pump.fun real_token_reserves at launch (1e6 decimals)
    PONS_TARGET_ETH: 4.2
  };
  TL.SEC = SEC; TL.MIN = MIN; TL.HR = HR; TL.DAY = DAY;
  // v1.66: terminal links with the team's referral codes. GMGN puts the code in the path (gmgn.ai/sol/token/CODE_MINT), Axiom takes the
  // handle after the mint (axiom.trade/t/MINT/@handle), Photon its referral path (photon-sol.tinyastro.io/en/r/@handle/MINT). Only GMGN lists Robinhood Chain.
  TL.gmgnSlug = function (chain) { return chain === 'solana' ? 'sol' : 'robinhood'; };
  TL.gmgnToken = function (chain, address) { var r = (TL.CONFIG.refs || {}).gmgn; return TL.CONFIG.gmgnSite + TL.gmgnSlug(chain) + '/token/' + (r ? r + '_' : '') + address; };
  TL.gmgnWallet = function (chain, address) { var r = (TL.CONFIG.refs || {}).gmgn; return TL.CONFIG.gmgnSite + TL.gmgnSlug(chain) + '/address/' + (r ? r + '_' : '') + address; };
  TL.axiomToken = function (chain, address) { if (chain !== 'solana') return null; var r = (TL.CONFIG.refs || {}).axiom; return 'https://axiom.trade/t/' + address + (r ? '/@' + r : ''); };
  // v1.67: the invite links of the terminals themselves (the footer, the About page). pump.fun's referral works only as a code typed at sign-up in
  // its app (pump.fun/join/CODE shows the code and the app stores), so coin links there carry no code: the invite is the only place it counts
  TL.inviteLinks = function () { var R = TL.CONFIG.refs || {}; return { gmgn: R.gmgn ? 'https://gmgn.ai/?ref=' + R.gmgn : 'https://gmgn.ai/', axiom: R.axiom ? 'https://axiom.trade/@' + R.axiom : 'https://axiom.trade/', photon: R.photon ? 'https://photon-sol.tinyastro.io/@' + R.photon : 'https://photon-sol.tinyastro.io/', pumpfun: R.pumpfun ? 'https://pump.fun/join/' + R.pumpfun : 'https://pump.fun/', pumpCode: R.pumpfun || '' }; };
  TL.photonToken = function (chain, address) { if (chain !== 'solana') return null; var r = (TL.CONFIG.refs || {}).photon; return r ? 'https://photon-sol.tinyastro.io/en/r/@' + r + '/' + address : 'https://photon-sol.tinyastro.io/en/lp/' + address; };
  TL.TOP_MAX_AGE = 180 * DAY; // Top: coins up to six months old; the long-settled names from past years are not what people trade today
  TL.TOP_MIN_AGE = DAY;       // v1.14: from a day old (a week before), so the young coins that survived their first day are in Top too
  TL.TOP_MIN_MC = { solana: 1e6, robinhood: 3e5 }; // Robinhood Chain is young and its memecoins are smaller

  // ---------- utils ----------
  var U = TL.util = {};
  U.now = function () { return Date.now(); };
  U.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  U.isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  U.num = function (v) { var n = typeof v === 'string' ? parseFloat(v) : v; return U.isNum(n) ? n : null; };
  U.fmtUsd = function (v, opts) {
    if (!U.isNum(v)) return '–';
    var abs = Math.abs(v), s;
    if (abs >= 1e9) s = (v / 1e9).toFixed(2) + 'B';
    else if (abs >= 1e6) s = (v / 1e6).toFixed(2) + 'M';
    else if (abs >= 1e4) s = (v / 1e3).toFixed(1) + 'K';
    else if (abs >= 1e3) s = (v / 1e3).toFixed(2) + 'K';
    else if (abs >= 1) s = v.toFixed(opts && opts.dec != null ? opts.dec : 0);
    else if (abs >= 0.01) s = v.toFixed(3);
    else if (abs === 0) s = '0';
    else s = v.toPrecision(3);
    return v < 0 ? '-$' + s.replace('-', '') : '$' + s;
  };
  U.fmtPrice = function (v) {
    if (!U.isNum(v)) return '–';
    if (v >= 1) return '$' + v.toFixed(v >= 100 ? 2 : 4);
    if (v >= 0.0001) return '$' + v.toFixed(6);
    // subscript zeros notation like 0.0₅123
    var s = v.toExponential(3); var m = s.split('e'); var exp = -parseInt(m[1], 10);
    var digits = m[0].replace('.', '').replace('-', '').slice(0, 4);
    return '$0.0' + U.sub(exp - 1) + digits;
  };
  var SUBS = '₀₁₂₃₄₅₆₇₈₉';
  U.sub = function (n) { return String(n).split('').map(function (c) { return SUBS[+c]; }).join(''); };
  U.fmtNum = function (v, dec) {
    if (!U.isNum(v)) return '–';
    var abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e4) return (v / 1e3).toFixed(1) + 'K';
    return dec != null ? v.toFixed(dec) : String(Math.round(v));
  };
  U.fmtPct = function (v, dec) { if (!U.isNum(v)) return '–'; return (v > 0 ? '+' : '') + v.toFixed(dec == null ? 1 : dec) + '%'; };
  U.pct0 = function (v) { if (!U.isNum(v)) return '–'; return Math.round(v * 100) + '%'; };
  U.fmtAge = function (ms) {
    if (!U.isNum(ms) || ms < 0) return '–';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 48) return h + 'h' + (h < 6 ? ' ' + (m % 60) + 'm' : '');
    return Math.floor(h / 24) + 'd';
  };
  // live age: seconds while a token is young (the feed ticks every second), then the usual short form
  U.fmtAgeLive = function (ms) {
    if (!U.isNum(ms) || ms < 0) return '–';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return U.fmtAge(ms);
  };
  // any element with data-born="<ms timestamp>" shows a live age; the ticker updates them once a second
  U.ageSpan = function (ts, cls, suffix) { return U.isNum(ts) ? '<span class="' + (cls || 'num age') + '" data-born="' + ts + '">' + U.fmtAgeLive(U.now() - ts) + (suffix || '') + '</span>' : '<span class="' + (cls || 'num age') + '">–</span>'; };
  U.tickAges = function () {
    var els = document.querySelectorAll('[data-born]'); var now = U.now();
    for (var i = 0; i < els.length; i++) { var el = els[i]; var born = +el.getAttribute('data-born'); if (!born) continue; var txt = U.fmtAgeLive(now - born) + (el.getAttribute('data-suffix') || ''); if (el.textContent !== txt) el.textContent = txt; }
  };
  U.fmtTime = function (ts) { var d = new Date(ts); return d.toISOString().slice(11, 16) + ' UTC'; };
  U.short = function (a) { if (!a) return '–'; if (a.indexOf('…') >= 0) return a; return a.length > 12 ? a.slice(0, 5) + '…' + a.slice(-4) : a; };
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  U.hash = function (s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  U.rng = function (seed) { var x = U.hash(seed) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return (x % 100000) / 100000; }; };
  U.median = function (arr) { var a = arr.filter(U.isNum).slice().sort(function (x, y) { return x - y; }); if (!a.length) return null; var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  U.hue = function (s) { return U.hash(s) % 360; };
  U.norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/g, ''); };
  // image URL helpers: fastest gateway first, original as fallback
  var IPFS_RE = /^(?:ipfs:\/\/|https?:\/\/(?:ipfs\.io|cf-ipfs\.com|gateway\.pinata\.cloud|cloudflare-ipfs\.com|pump\.mypinata\.cloud|dweb\.link|nftstorage\.link)\/ipfs\/)([A-Za-z0-9]+)(\/[^?]*)?/;
  var CID_RE = /(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{30,})/;
  TL.cidOf = function (u) { var m = String(u || '').match(CID_RE); return m ? m[1] : null; }; // works for any gateway shape, not just the ones IPFS_RE knows
  TL.imgFast = function (url) {
    if (!url || typeof url !== 'string') return null;
    var m = url.match(IPFS_RE);
    if (m) return 'https://pump.mypinata.cloud/ipfs/' + m[1] + (m[2] || '') + '?img-width=128&img-dpr=2&img-onerror=redirect';
    if (/^data:|^https?:\/\//.test(url)) return url;
    return null;
  };
  TL.imgAlt = function (url) {
    if (!url || typeof url !== 'string') return null;
    var m = url.match(IPFS_RE);
    if (m) return 'https://ipfs.io/ipfs/' + m[1] + (m[2] || '');
    return url;
  };
  U.timeoutFetch = function (url, ms, opts) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || TL.CONFIG.fetchTimeout);
    var o = opts || {}; if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  };

  // ---------- metric explainers (the "why" layer GMGN lacks) ----------
  TL.HELP = {
    mc: { t: 'Market cap', w: 'Price multiplied by circulating supply (FDV on bonding curves).', y: 'Under $10K one wallet can move it.', s: 'pump.fun curve on-chain / Jupiter / Pons pools on-chain' },
    liq: { t: 'Liquidity', w: 'USD value locked in the pool (or on the curve).', y: 'Under 5% of market cap is fragile.', s: 'Jupiter / on-chain pools' },
    vol: { t: 'Volume', w: 'Trading volume over 5 minutes, 1 hour and 24 hours.', y: 'Volume without holder growth is usually wash or bots.', s: 'Jupiter / on-chain pools' },
    holders: { t: 'Holders', w: 'Number of wallets holding the token and how many joined in the last hour.', y: 'Flat holders with rising volume is a red flag.', s: 'Jupiter / Blockscout / indexer' },
    tx: { t: 'Buys vs sells', w: 'Count of buy and sell transactions in the last hour.', y: 'Sells dominating right after launch: snipers unloading.', s: 'Jupiter / on-chain pools' },
    chg: { t: 'Price change', w: 'Percentage move over 5 minutes, 1 hour, 6 hours and 24 hours.', y: 'A green 5m on a red 24h is a bounce, not a reversal.', s: 'Jupiter / on-chain pools' },
    stage: { t: 'Life stage', w: 'Where the token is in its lifecycle: on the bonding curve (Launched, Bonding, Graduating), migrated to a pool (Graduated, Trending) or dying (Fading, Dead).', y: 'Most memecoins die on the curve; the first day after graduation decides the rest.', s: 'pump.fun curve reserves / Pons target / pool age' },
    curve: { t: 'Curve progress', w: 'How much of the bonding curve is filled. pump.fun graduates when the real reserves are bought out; Pons graduates at 4.2 ETH.', y: 'Fast fills in the first minute usually mean bundles, not organic demand.', s: 'pump.fun / Pons' },
    mint: { t: 'Mint authority', w: 'Whether the creator can still mint new tokens (Solana).', y: 'Active: the dev can inflate supply. pump.fun revokes it.', s: 'Jupiter audit / Solana RPC' },
    freeze: { t: 'Freeze authority', w: 'Whether the creator can freeze wallets (Solana).', y: 'Active: wallets can be frozen.', s: 'Jupiter audit / Solana RPC' },
    lp: { t: 'Liquidity lock', w: 'Whether pool liquidity is burned or locked.', y: 'Unlocked liquidity can be pulled at any moment.', s: 'launchpad rules / indexer' },
    top10: { t: 'Top 10 holders', w: 'Share of supply held by the ten largest wallets (excluding the pool).', y: 'Above 30% a few wallets set the price; above 50% it is a private token.', s: 'Jupiter / Blockscout / indexer' },
    dev: { t: 'Dev holdings', w: 'Share of supply the deployer wallet still holds.', y: '5-10% is normal; 20%+ is an overhang.', s: 'indexer' },
    post: { t: 'Launch post', w: 'The X post the token links to from its metadata.', y: 'A deleted launch post is a soft red flag.', s: 'X oEmbed' },
    devsold: { t: 'Dev sold', w: 'The deployer sold tokens after launch.', y: 'The single strongest early exit signal on bonding curves.', s: 'indexer' },
    sniper: { t: 'Snipers', w: 'Share of supply still held by the wallets that bought in the first blocks after launch.', y: 'Inventory waiting to be dumped. 30%+ never shows.', s: 'GMGN (top 70 snipers) / Pons curve trades' },
    bundle: { t: 'Bundles', w: 'Share of trading done by bundle wallets: several wallets funded from one source buying together.', y: 'Fake demand that can dump in one transaction. 30%+ never shows.', s: 'GMGN / launch-block buyers on Robinhood Chain' },
    insider: { t: 'Insiders', w: 'Share held by wallets GMGN links to the deployer (suspected insiders).', y: '30%+ never shows.', s: 'GMGN' },
    socials: { t: 'Socials', w: 'Links published with the token: X, Telegram, website, and how old the X account is.', y: 'A one-day-old X account is a template launch.', s: 'launchpad metadata (pump.fun, Pons)' },
    clone: { t: 'Copycats', w: 'Other tokens with the same name or ticker launched in the last 24 hours, and which one came first.', y: 'Clones catch people who search by name.', s: 'computed from the feed' },
    devhist: { t: 'Dev history', w: 'How many tokens this deployer launched, how many graduated, how many died within an hour.', y: 'Serial deployers with zero graduations are running a script, not a project.', s: 'pump.fun creator history / indexer' },
    smart: { t: 'Smart money', w: 'Known profitable wallets and KOL wallets holding the token, and their net flow in the last hour.', y: 'Smart wallets entering early is the best organic signal; leaving is the best exit signal.', s: 'GMGN (smart_degen and renowned wallets) - Smart Tracking tab' },
    safety: { t: 'Safety score', w: 'Contract rights, liquidity, concentration, snipers, bundles, dev behaviour and dev history, weighted into 0-100.', y: 'Can this be pulled from under you. Says nothing about upside.', s: 'computed, formula in the panel' },
    momentum: { t: 'Momentum score', w: 'Buys per minute vs the previous window, holder growth, buyer/seller ratio, curve acceleration, volume to market cap.', y: 'Is attention arriving right now.', s: 'computed' },
    community: { t: 'Community score', w: 'Socials and their age, launchpad replies, unique buyers, smart money present.', y: 'Is anyone here besides bots.', s: 'computed' },
    verdict: { t: 'Verdict', w: 'STRONG, WATCH, CAUTION, AVOID or RUGGED from the three scores, safety first.', y: 'One word for scanning; the panel has the reasons.', s: 'computed' },
    replies: { t: 'Launchpad replies', w: 'Comments on the token page at the launchpad.', y: 'Cheap proxy for attention on the curve.', s: 'pump.fun' },
    tax: { t: 'Tax', w: 'Fee taken on every trade by the token or launchpad.', y: 'Robinhood Chain launchpads take 0.25-3% while on the curve.', s: 'launchpad' },
    rug: { t: 'Rug risk (GMGN)', w: 'GMGN\'s rug pull score from 0 to 100%, built from the creator\'s history and how the supply moved.', y: 'GMGN\'s own safe screen cuts at 30%: above it the token never shows here.', s: 'GMGN OpenAPI' },
    wash: { t: 'Wash trading', w: 'GMGN detected coordinated fake volume: the same money trading back and forth.', y: 'Staged volume. Never shown.', s: 'GMGN OpenAPI' },
    honeypot: { t: 'Honeypot', w: 'The contract lets you buy but blocks or taxes selling.', y: 'Never shown.', s: 'GMGN OpenAPI' },
    rat: { t: 'Insider trading', w: 'Share of volume from wallets GMGN tags as rat traders: insiders trading ahead of everyone.', y: 'Above 30% the chart mostly shows insiders moving the price.', s: 'GMGN OpenAPI' },
    quote: { t: 'Quote asset', w: 'What the token is traded against: SOL, ETH, USDG or a tokenized stock like NVDA.', y: 'Robinhood Chain curves can be denominated in tokenized stocks, which changes the graduation threshold.', s: 'launchpad' }
  };

  // ---------- token model ----------
  TL.STAGES = ['launched', 'bonding', 'graduating', 'graduated', 'trending', 'fading', 'dead'];
  TL.STAGE_LABEL = { launched: 'Launched', bonding: 'Bonding', graduating: 'Graduating', graduated: 'Graduated', trending: 'Trending', fading: 'Fading', dead: 'Dead' };

  TL.blank = function (chain, address) {
    return {
      id: chain + ':' + address, chain: chain, address: address, pair: null, name: '', symbol: '', logo: null,
      launchpad: 'unknown', quote: chain === 'solana' ? 'SOL' : 'ETH', tax: null,
      createdAt: null, graduatedAt: null, complete: false, curve: null, lastTradeAt: null,
      price: null, mc: null, fdv: null, liq: null, supply: null, athMc: null, liqPeak: null,
      vol: { m5: null, h1: null, h6: null, h24: null },
      tx: { m5: null, h1: null, h6: null, h24: null },
      chg: { m5: null, h1: null, h6: null, h24: null },
      holders: null, holdersDelta1h: null, top10: null, dist: null,
      mintAuth: null, freezeAuth: null, lpLocked: null,
      dev: { address: null, pct: null, sold: null, launches: null, graduated: null, rugs: null },
      sniperPct: null, bundlePct: null, insiderPct: null,
      socials: { x: null, tg: null, web: null }, xAge: null, replies: null,
      smart: null, clones: [], firstOfName: true,
      demo: false, partial: false, simulated: {}, source: {}, events: [], series: null,
      stage: 'launched', scores: null, verdict: null, reasons: null, _fresh: false
    };
  };

  TL.stageOf = function (t, now) {
    now = now || U.now();
    var age = U.isNum(t.createdAt) ? now - t.createdAt : null;
    var h1tx = t.tx.h1, h6vol = t.vol.h6, h1vol = t.vol.h1;
    var post = t.complete || U.isNum(t.graduatedAt) || (t.curve == null && t.pair);
    if (post) {
      var since = U.isNum(t.graduatedAt) ? now - t.graduatedAt : (age != null ? age : 0);
      var dead = (U.isNum(h6vol) && h6vol < 50 && (age == null || age > 6 * HR)) || t._dead;
      if (dead) return 'dead';
      var fade = t._fading || (U.isNum(t.chg.h24) && t.chg.h24 <= -80) || (U.isNum(h1vol) && U.isNum(t.vol.h24) && t.vol.h24 > 20000 && h1vol < t.vol.h24 / 200);
      if (fade && since > 2 * HR) return 'fading';
      var trend = t._trend || (U.isNum(h1vol) && h1vol > 25000 && (!U.isNum(t.chg.h1) || t.chg.h1 > -10)) || (U.isNum(t.holdersDelta1h) && t.holdersDelta1h > 100);
      if (trend && since > 20 * MIN) return 'trending';
      if (since > 24 * HR) return trend ? 'trending' : (fade ? 'fading' : 'trending');
      return 'graduated';
    }
    var c = U.isNum(t.curve) ? t.curve : 0;
    if (age != null && age > 12 * HR && c < 0.5 && (!U.isNum(h1tx && h1tx.b) || (h1tx.b + h1tx.s) === 0)) return 'dead';
    if (c >= 0.7) return 'graduating';
    if (c >= 0.1 || (age != null && age > 10 * MIN)) return 'bonding';
    return 'launched';
  };

  // ---------- scoring (transparent rules; every rule reports its points) ----------
  function rule(list, key, label, pts, note) { list.push({ key: key, label: label, pts: pts, note: note || '' }); return pts; }

  TL.score = function (t) {
    var R = { safety: [], momentum: [], community: [] };
    var m = 50, c = 50;
    var unknown = [];
    // established tokens (Top: $1M+ cap, a week or more of trading): the coin itself is the proof, so launch-time forensics
    // (dev history, dev bags, snipers, bundles) no longer apply, and a concentrated top 10 is exchanges, treasury and locked allocations.
    // Their safety starts higher: surviving that long is evidence, so only real negatives (not missing data) can pull them under 60.
    var mature = !!t.top;
    var s = mature ? 60 : 50;
    // --- safety ---
    if (t.sus === true) s += rule(R.safety, 'sus', 'Flagged as suspicious by Jupiter', -30);
    if (t.honeypot === true) s += rule(R.safety, 'honeypot', 'Honeypot: selling is blocked', -60);
    if (t.wash === true) s += rule(R.safety, 'wash', 'Wash trading detected by GMGN', -30, 'the volume is fake');
    if (!mature && U.isNum(t.rugRatio)) {
      if (t.rugRatio >= TL.RISK.rug) s += rule(R.safety, 'rug', 'GMGN rug risk ' + U.pct0(t.rugRatio), -25);
      else if (t.rugRatio >= 0.15) s += rule(R.safety, 'rug', 'GMGN rug risk ' + U.pct0(t.rugRatio), -8);
      else if (t.gmgnAt) s += rule(R.safety, 'rug', 'GMGN rug risk ' + U.pct0(t.rugRatio), 4, 'low');
    }
    if (t.upgradeable === true) s += rule(R.safety, 'upgrade', 'Upgradeable contract', -25, 'code can be swapped');
    if (t.mintAuth === false) s += rule(R.safety, 'mint', 'Mint authority revoked', 8);
    else if (t.mintAuth === true) s += rule(R.safety, 'mint', 'Mint authority still active', -25, 'dev can inflate supply');
    else unknown.push('mint');
    if (t.freezeAuth === false) s += rule(R.safety, 'freeze', 'Freeze authority revoked', 5);
    else if (t.freezeAuth === true) s += rule(R.safety, 'freeze', 'Freeze authority active', -20, 'wallets can be frozen');
    if (t.lpLocked === true) s += rule(R.safety, 'lp', 'Liquidity locked or burned', 8);
    else if (t.lpLocked === false) s += rule(R.safety, 'lp', 'Liquidity not locked', -18);
    else unknown.push('lp');
    var t10 = TL.top10eff(t), lockedNote = t10 !== t.top10 ? 'locked supply not counted' : '';
    if (t10 === 0 && (!U.isNum(t.holders) || t.holders > 0)) t10 = null; // nobody holding nothing: this is a missing reading, not a distribution
    if (U.isNum(t10)) {
      if (t10 <= 0.2) s += rule(R.safety, 'top10', 'Top 10 hold ' + U.pct0(t10), 10, lockedNote || 'well distributed');
      else if (t10 <= 0.35) s += rule(R.safety, 'top10', 'Top 10 hold ' + U.pct0(t10), 2, lockedNote);
      else if (mature) s += rule(R.safety, 'top10', 'Top 10 hold ' + U.pct0(t10), t10 > 0.5 ? -12 : -6, 'exchange, treasury and locked wallets included');
      else if (t10 < TL.RISK.top10) s += rule(R.safety, 'top10', 'Top 10 hold ' + U.pct0(t10), -10, 'concentrated');
      else s += rule(R.safety, 'top10', 'Top 10 hold ' + U.pct0(t10), -22, 'a few wallets control the price');
    } else unknown.push('top10');
    var t10c = TL.top10circ(t);
    if (!mature && U.isNum(t10c) && TL.spread(t) && U.isNum(t10) && t10c > t10 + 0.05) { // the curve hides most of the supply: say what the top ten own of the rest
      if (t10c >= TL.TOP10C.h40) s += rule(R.safety, 'top10c', 'Top 10 own ' + U.pct0(t10c) + ' of circulation', -18, 'ten wallets can empty the curve');
      else if (t10c >= TL.TOP10C.warn) s += rule(R.safety, 'top10c', 'Top 10 own ' + U.pct0(t10c) + ' of circulation', -8, 'concentrated among the buyers');
    }
    if (mature) {
      var days = U.isNum(t.createdAt) ? Math.floor((U.now() - t.createdAt) / DAY) : 0;
      if (U.isNum(t.holders) && t.holders >= 5000 && days >= 30) s += rule(R.safety, 'track', days + ' days on the market, ' + U.fmtNum(t.holders) + ' holders', 12, 'survived its launch');
      else if (days >= 7) s += rule(R.safety, 'track', days + ' days on the market', 6);
    } else {
      if (U.isNum(t.dev.pct)) {
        if (t.dev.pct > 0.2) s += rule(R.safety, 'dev', 'Dev holds ' + U.pct0(t.dev.pct), -18, 'overhang');
        else if (t.dev.pct > 0.1) s += rule(R.safety, 'dev', 'Dev holds ' + U.pct0(t.dev.pct), -6);
        else s += rule(R.safety, 'dev', 'Dev holds ' + U.pct0(t.dev.pct), 3);
      } else unknown.push('dev');
      var provenNow = TL.proven(t);
      if (t.dev.sold === true && !t.complete && !provenNow) s += rule(R.safety, 'devsold', 'Dev sold most of the bag', -22);
      else if (t.dev.sold === true) s += rule(R.safety, 'devsold', 'Dev exited', -4, 'common once a token has real buyers');
      else if (t.dev.soldSome === true) s += rule(R.safety, 'devsold', 'Dev sold part of the bag', -8);
      if (U.isNum(t.sniperPct)) {
        if (t.sniperPct > 0.3) s += rule(R.safety, 'sniper', 'Snipers hold ' + U.pct0(t.sniperPct), -16, 'inventory waiting to dump');
        else if (t.sniperPct > 0.15) s += rule(R.safety, 'sniper', 'Snipers hold ' + U.pct0(t.sniperPct), -7);
        else s += rule(R.safety, 'sniper', 'Snipers hold ' + U.pct0(t.sniperPct), 4);
      } else unknown.push('sniper');
      if (U.isNum(t.bundlePct)) {
        if (t.bundlePct > 0.25) s += rule(R.safety, 'bundle', 'Bundled ' + U.pct0(t.bundlePct), -20, 'one source funded the first buyers');
        else if (t.bundlePct > 0.1) s += rule(R.safety, 'bundle', 'Bundled ' + U.pct0(t.bundlePct), -8);
        else s += rule(R.safety, 'bundle', 'Bundle ' + U.pct0(t.bundlePct), 4);
      } else unknown.push('bundle');
      if (U.isNum(t.insiderPct) && t.insiderPct > 0.15) s += rule(R.safety, 'insider', 'Insiders hold ' + U.pct0(t.insiderPct), -10);
      if (U.isNum(t.ratPct) && t.ratPct >= 0.3) s += rule(R.safety, 'rat', 'Insider trading is ' + U.pct0(t.ratPct) + ' of volume', -8, 'GMGN rat traders');
      if (U.isNum(t.dev.launches)) {
        var grads = t.dev.graduated || 0;
        if (t.dev.launches >= 5 && grads === 0) s += rule(R.safety, 'devhist', 'Serial deployer: ' + U.fmtNum(t.dev.launches) + ' launches, 0 graduated', provenNow ? -8 : -30, provenNow ? 'this one found buyers anyway' : 'script, not a project');
        else if (U.isNum(t.dev.rugs) && t.dev.rugs >= 2) s += rule(R.safety, 'devhist', t.dev.rugs + ' previous tokens died within an hour', -20);
        else if (t.dev.launches >= 20 && grads / t.dev.launches < 0.05) s += rule(R.safety, 'devhist', 'Launch farm: ' + U.fmtNum(t.dev.launches) + ' launches, ' + grads + ' graduated', -6, 'most tokens from this wallet never graduate');
        else if (grads >= 1) s += rule(R.safety, 'devhist', 'Dev has ' + grads + ' graduated token' + (grads > 1 ? 's' : '') + ' out of ' + U.fmtNum(t.dev.launches), 6);
        else s += rule(R.safety, 'devhist', t.dev.launches <= 1 ? 'First launch for this dev' : t.dev.launches + ' launches, none graduated yet', 0);
      } else unknown.push('devhist');
      var spamN = TL.devSpam(t);
      if (spamN >= TL.RISK.devSpam) s += rule(R.safety, 'devspam', 'Dev launched ' + spamN + ' tokens within an hour', TL.proven(t) ? 0 : -20, TL.proven(t) ? 'this one found real buyers' : 'spam launches');
    }
    if (t.clones.length && !t.firstOfName && !mature) s += rule(R.safety, 'clone', 'Clone: ' + t.clones.length + ' other token' + (t.clones.length > 1 ? 's' : '') + ' with this name, an earlier one exists', TL.proven(t) ? -5 : -15);
    else if (t.clones.length) s += rule(R.safety, 'clone', 'Original of ' + t.clones.length + ' copycat' + (t.clones.length > 1 ? 's' : ''), 0);
    // a liquidity number only counts when it was actually measured: a zero next to real volume is a reading we failed to take,
    // not an empty pool, and it must never cost the token points or hide it
    var liqReal = U.isNum(t.liq) && (t.liq > 0 || !(U.isNum(t.vol.h1) && t.vol.h1 > 1000));
    if (liqReal && U.isNum(t.mc) && t.mc > 0 && t.curve == null) {
      var lr = t.liq / t.mc;
      if (mature) { // big caps trade on deep books everywhere: only a pool that could not take a real exit counts against them
        if (t.liq < 50000 || lr < 0.005) s += rule(R.safety, 'liq', 'Liquidity ' + U.fmtUsd(t.liq) + ' (' + (lr * 100).toFixed(1) + '% of MC)', -10, 'thin for a coin this size');
        else if (lr > 0.1) s += rule(R.safety, 'liq', 'Liquidity is ' + (lr * 100).toFixed(0) + '% of MC', 6);
      } else if (lr < 0.05) s += rule(R.safety, 'liq', 'Liquidity is ' + (lr * 100).toFixed(1) + '% of MC', -10, 'fragile');
      else if (lr > 0.2) s += rule(R.safety, 'liq', 'Liquidity is ' + (lr * 100).toFixed(0) + '% of MC', 6);
    }
    // --- momentum ---
    var b5 = t.tx.m5 && U.isNum(t.tx.m5.b) ? t.tx.m5.b : null, s5 = t.tx.m5 && U.isNum(t.tx.m5.s) ? t.tx.m5.s : null;
    var b1 = t.tx.h1 && U.isNum(t.tx.h1.b) ? t.tx.h1.b : null, s1 = t.tx.h1 && U.isNum(t.tx.h1.s) ? t.tx.h1.s : null;
    if (b5 != null && b1 != null && mature) { if (b1 === 0) m += rule(R.momentum, 'tx', 'No buys in the last hour', -20); } // five-minute swings say nothing about a coin this size
    else if (b5 != null && b1 != null) {
      var rate5 = b5 / 5, prevBuys = b1 - b5, rate60 = Math.max(0.01, prevBuys / 55);
      var acc = rate5 / rate60;
      if (b5 >= 3 && prevBuys >= 5 && acc > 2) m += rule(R.momentum, 'tx', 'Buys per minute ' + Math.min(acc, 99).toFixed(1) + 'x the previous hour', 18);
      else if (b5 >= 1 && prevBuys >= 5 && acc > 1.2) m += rule(R.momentum, 'tx', 'Buy rate rising', 8);
      else if (b5 >= 10 && prevBuys < 5) m += rule(R.momentum, 'tx', b5 + ' buys in the first minutes', 6);
      else if (b5 === 0 && b1 > 0) m += rule(R.momentum, 'tx', 'No buys in the last 5 minutes', -12);
      else if (b5 === 0 && b1 === 0) m += rule(R.momentum, 'tx', 'No buys in the last hour', -20);
    }
    if (b1 != null && s1 != null && (b1 + s1) > 0) {
      var ratio = b1 / (b1 + s1);
      if (ratio > 0.62) m += rule(R.momentum, 'ratio', Math.round(ratio * 100) + '% of trades are buys', 12);
      else if (ratio < 0.4) m += rule(R.momentum, 'ratio', 'Sellers dominate (' + Math.round((1 - ratio) * 100) + '% sells)', -14);
    }
    if (U.isNum(t.holdersDelta1h) && U.isNum(t.holders) && t.holders > 0 && t.holdersDelta1h <= t.holders) { // a growth bigger than the count itself is two sources disagreeing, not growth
      var g = t.holdersDelta1h / Math.max(1, t.holders - t.holdersDelta1h);
      if (t.holdersDelta1h >= 20 && g > 0.15) m += rule(R.momentum, 'holders', '+' + t.holdersDelta1h + ' holders in 1h (' + Math.round(g * 100) + '%)', 14);
      else if (t.holdersDelta1h > 0) m += rule(R.momentum, 'holders', '+' + t.holdersDelta1h + ' holders in 1h', 5);
      else if (t.holdersDelta1h < 0) m += rule(R.momentum, 'holders', t.holdersDelta1h + ' holders in 1h', -10);
    }
    if (U.isNum(t.chg.m5)) {
      if (t.chg.m5 > 15) m += rule(R.momentum, 'chg', U.fmtPct(t.chg.m5) + ' in 5m', 8);
      else if (t.chg.m5 < -15) m += rule(R.momentum, 'chg', U.fmtPct(t.chg.m5) + ' in 5m', -8);
    }
    if (mature && U.isNum(t.vol.h24) && U.isNum(t.mc) && t.mc > 0) {
      var vr24 = t.vol.h24 / t.mc; // for an established coin the day's turnover against its cap is the activity measure, not the last hour
      if (vr24 >= 0.02) m += rule(R.momentum, 'vol', '24h volume is ' + (vr24 * 100).toFixed(1) + '% of market cap', 10, 'actively traded');
      else if (vr24 >= 0.005) m += rule(R.momentum, 'vol', '24h volume is ' + (vr24 * 100).toFixed(1) + '% of market cap', 4);
      else if (vr24 < 0.001) m += rule(R.momentum, 'vol', '24h volume under 0.1% of market cap', -10, 'thin trading');
    } else if (!mature && U.isNum(t.vol.h1) && U.isNum(t.mc) && t.mc > 0) {
      var vr = t.vol.h1 / t.mc;
      if (vr > 1) m += rule(R.momentum, 'vol', '1h volume is ' + vr.toFixed(1) + 'x market cap', 10, 'check holder growth');
      else if (vr < 0.02) m += rule(R.momentum, 'vol', '1h volume under 2% of MC', -8);
    }
    if (U.isNum(t.curve) && t.curve >= 0.7 && t.curve < 1) m += rule(R.momentum, 'curve', 'Curve ' + U.pct0(t.curve) + ' filled, graduation close', 6);
    // --- community ---
    var soc = (t.socials.x ? 1 : 0) + (t.socials.tg ? 1 : 0) + (t.socials.web ? 1 : 0);
    if (soc === 0) c += rule(R.community, 'socials', 'No socials', -12);
    else c += rule(R.community, 'socials', soc + ' social link' + (soc > 1 ? 's' : ''), 4 * soc);
    if (U.isNum(t.xAge)) {
      if (t.xAge < 3) c += rule(R.community, 'xage', 'X account is ' + t.xAge + ' day' + (t.xAge === 1 ? '' : 's') + ' old', -10, 'template launch');
      else if (t.xAge > 90) c += rule(R.community, 'xage', 'X account older than 90 days', 8);
    }
    if (U.isNum(t.replies)) {
      if (t.replies >= 50) c += rule(R.community, 'replies', t.replies + ' launchpad replies', 10);
      else if (t.replies >= 10) c += rule(R.community, 'replies', t.replies + ' launchpad replies', 4);
    }
    if (U.isNum(t.holders)) {
      if (t.holders >= 500) c += rule(R.community, 'holders', U.fmtNum(t.holders) + ' holders', 12);
      else if (t.holders >= 100) c += rule(R.community, 'holders', t.holders + ' holders', 6);
      else if (t.holders < 10 && U.isNum(t.createdAt) && (U.now() - t.createdAt) > 30 * MIN) c += rule(R.community, 'holders', 'Under 10 holders after 30 minutes', -10);
    }
    if (U.isNum(t.xFollowers) && t.socials.x) {
      if (t.xFollowers >= 10000) c += rule(R.community, 'xfol', 'X account has ' + U.fmtNum(t.xFollowers) + ' followers', 8);
      else if (t.xFollowers >= 1000) c += rule(R.community, 'xfol', 'X account has ' + U.fmtNum(t.xFollowers) + ' followers', 4);
    }
    if (t.cto === true) c += rule(R.community, 'cto', 'Community took over', 4, 'holders run it');
    if (t.dexPaid === true) c += rule(R.community, 'dex', 'Paid DEX Screener profile', 3);
    if (t.smart) {
      if (t.smart.wallets >= 3) c += rule(R.community, 'smart', t.smart.wallets + ' smart wallets inside', 14);
      else if (t.smart.wallets >= 1) c += rule(R.community, 'smart', t.smart.wallets + ' smart wallet inside', 6);
      if (t.smart.kols >= 1) c += rule(R.community, 'kol', t.smart.kols + ' KOL wallet' + (t.smart.kols > 1 ? 's' : '') + ' inside', 6);
      if (U.isNum(t.smart.flow1h) && t.smart.flow1h < 0) c += rule(R.community, 'flow', 'Smart money net selling last hour', -12);
    }
    s = Math.round(U.clamp(s, 0, 100)); m = Math.round(U.clamp(m, 0, 100)); c = Math.round(U.clamp(c, 0, 100));
    var v;
    var serial = !mature && t.dev.launches >= 5 && (t.dev.graduated || 0) === 0 && !TL.proven(t);
    var ageMs = U.isNum(t.createdAt) ? U.now() - t.createdAt : 0; var trades1 = (b1 || 0) + (s1 || 0);
    var proven = ageMs >= 5 * MIN && U.isNum(t.holders) && t.holders >= 20 && trades1 >= 20; // STRONG is earned, never given to a seconds-old token
    if (s < 35 || serial || t.sus === true || t.honeypot === true || (!mature && t.dev.sold === true && !t.complete && !TL.proven(t) && s < 55)) v = 'AVOID';
    else if (s < 60) v = 'CAUTION';
    else if (s >= 70 && m >= 65 && proven) v = 'STRONG';
    else v = 'WATCH';
    if (t.stage === 'dead') v = 'AVOID';
    if (v !== 'AVOID' && TL.rugSign(t)) v = 'AVOID'; // one rug sign outweighs any sum of points: the verdict and the gate always agree
    var rugged = TL.rugged(t);
    if (rugged) { v = 'RUGGED'; rule(R.safety, 'rugged', 'Already gone: ' + rugged, 0, 'no way back'); }
    return { safety: s, momentum: m, community: c, verdict: v, reasons: R, unknown: unknown, rugged: rugged || null };
  };

  // ---------- red flags & quality gate (one definition for rows, panel and the feed filter) ----------
  // v1.14: one set of risk thresholds for flags, the gate and the filters. Launch-time numbers calibrated on live data, 17 Sep 2026 (fresh
  // pump.fun launches have the dev at 1% median / 10% p90 of supply; active Pons curves: top 10 at 27% / 55%, snipers 4% / 26%). Bundles,
  // insiders and the rug score follow GMGN's own "safe" screen (30%), which is what GMGN users filter the trenches with.
  TL.RISK = { devCurve: 0.10, devPool: 0.05, bundle: 0.30, sniper: 0.30, insider: 0.30, top10: 0.50, rug: 0.30, devSpam: 3 };
  TL.flags = function (t) {
    var w = [];
    var push = function (label, key, hard) { w.push({ label: label, key: key, hard: hard }); };
    if (t.sus === true) push('Flagged by Jupiter', 'sus', true);
    if (t.honeypot === true) push('Honeypot', 'honeypot', true);
    if (t.mintAuth === true) push('Can mint more', 'mint', true);
    if (t.freezeAuth === true) push('Can freeze wallets', 'freeze', true);
    if (t.upgradeable === true) push('Upgradeable contract', 'upgrade', true);
    if (t.wash === true) push('Wash trading', 'wash', true);
    var t10 = TL.top10eff(t);
    if (t.top) { // established tokens: launch forensics are history, a concentrated top 10 is exchanges and locked allocations, so it is a note, not a red flag
      if (U.isNum(t10) && t10 > 0.35) push('Top 10 hold ' + U.pct0(t10), 'top10', false);
      return w;
    }
    if (t.lpLocked === false) push('Liquidity not locked', 'lp', true);
    var proven = TL.proven(t), devCap = t.complete ? TL.RISK.devPool : TL.RISK.devCurve;
    if (U.isNum(t.rugRatio) && t.rugRatio >= TL.RISK.rug) push('Rug risk ' + U.pct0(t.rugRatio), 'rug', true);
    else if (U.isNum(t.rugRatio) && t.rugRatio >= 0.15) push('Rug risk ' + U.pct0(t.rugRatio), 'rug', false);
    if (t.dev.sold === true) push('Dev sold', 'devsold', !t.complete && !proven);
    if (U.isNum(t.dev.launches) && t.dev.launches >= 5 && !(t.dev.graduated > 0)) push('Serial deployer', 'devhist', !proven);
    else if (U.isNum(t.dev.launches) && t.dev.launches >= 50 && (t.dev.graduated || 0) / t.dev.launches < 0.05) push('Launch farm dev: ' + U.fmtNum(t.dev.launches) + ' launches', 'devhist', !TL.crowd(t)); // v1.74: hard until the coin draws a crowd, then a warning
    var spam = TL.devSpam(t); if (spam >= TL.RISK.devSpam) push('Dev launched ' + spam + ' in 1h', 'devspam', !proven);
    if (U.isNum(t.dev.pct) && t.dev.pct >= devCap) push('Dev holds ' + U.pct0(t.dev.pct), 'dev', true);
    if (U.isNum(t.bundlePct) && t.bundlePct >= TL.RISK.bundle) push('Bundles ' + U.pct0(t.bundlePct), 'bundle', true);
    if (U.isNum(t.sniperPct) && t.sniperPct >= TL.RISK.sniper) push('Snipers hold ' + U.pct0(t.sniperPct), 'sniper', true);
    if (U.isNum(t.insiderPct) && t.insiderPct >= TL.RISK.insider) push('Insiders hold ' + U.pct0(t.insiderPct), 'insider', true);
    var spread = TL.spread(t); // with a handful of holders the top 10 is everyone: no flag until the token has 20 holders
    if (spread && U.isNum(t10) && t10 >= TL.RISK.top10) push('Top 10 hold ' + U.pct0(t10), 'top10', true);
    else if (TL.concentrated(t)) push('Top 10 hold ' + U.pct0(TL.top10circ(t)) + ' of circulation', 'top10c', true);
    else if (spread && U.isNum(TL.top10circ(t)) && TL.top10circ(t) >= TL.TOP10C.warn) push('Top 10 hold ' + U.pct0(TL.top10circ(t)) + ' of circulation', 'top10c', false);
    if (t.clones.length && !t.firstOfName) {
      var nmc = U.norm(t.name), sameName = nmc && nmc.length > 2 && t.clones.some(function (o) { return U.isNum(o.createdAt) && U.isNum(t.createdAt) && o.createdAt < t.createdAt && U.norm(o.name) === nmc; });
      push(sameName ? 'Copy of an earlier token' : 'Ticker used before', 'clone', sameName && !proven);
    }
    if (t.dev.sold !== true && t.dev.soldSome === true) push('Dev sold some', 'devsold', false);
    if (U.isNum(t.dev.pct) && t.dev.pct < devCap && t.dev.pct >= devCap / 2) push('Dev holds ' + U.pct0(t.dev.pct), 'dev', false);
    if (t.postGone) push('Launch post deleted', 'post', false);
    if (U.isNum(t.sniperPct) && t.sniperPct < TL.RISK.sniper && t.sniperPct > 0.15) push('Snipers hold ' + U.pct0(t.sniperPct), 'sniper', false);
    if (spread && U.isNum(t10) && t10 < TL.RISK.top10 && t10 > 0.35) push('Top 10 hold ' + U.pct0(t10), 'top10', false);
    if (U.isNum(t.bundlePct) && t.bundlePct < TL.RISK.bundle && t.bundlePct > 0.15) push('Bundles ' + U.pct0(t.bundlePct), 'bundle', false);
    if (U.isNum(t.ratPct) && t.ratPct >= 0.3) push('Insider trading ' + U.pct0(t.ratPct), 'rat', false);
    if (U.isNum(t.tax) && t.tax >= 0.05) push('Tax ' + U.pct0(t.tax), 'tax', false);
    return w;
  };
  // top 10 share without the supply the index itself counts as locked (Jupiter's circulating supply): some launches park half the
  // supply in a lock, which is an overhang for later, not ten wallets that can sell today
  TL.top10eff = function (t) {
    if (!U.isNum(t.top10)) return null;
    if (U.isNum(t.circPct) && t.circPct < 0.95 && t.top10 >= 1 - t.circPct - 0.02) return Math.max(0, t.top10 - (1 - t.circPct));
    return t.top10;
  };
  // a launch that has shown real demand: spam-launch and similar "who made it" signals stop mattering once buyers came anyway
  TL.proven = function (t) { return !!(t.complete || (U.isNum(t.holders) && t.holdersSrc !== 'stream' && t.holders >= 50)); };
  // v1.74: a launch that drew a real crowd: graduated, a thousand holders and an organic score Jupiter rates as mostly real trading.
  // Who launched it stops hiding it then (a launch-farm dev with a coin at 2,000 holders and $1M an hour was hidden on that alone);
  // the flag stays on the card so the dev's record is still a warning
  TL.CROWD = { holders: 1000, organic: 50 };
  TL.crowd = function (t) { return !!(t.complete && U.isNum(t.holders) && t.holdersSrc !== 'stream' && t.holders >= TL.CROWD.holders && U.isNum(t.organic) && t.organic >= TL.CROWD.organic); };
  // enough holders for a top-10 share to mean something: with 8 holders the top 10 is everyone, which says nothing about a rug
  TL.spread = function (t) { return !!(t.complete || (U.isNum(t.holders) && t.holdersSrc !== 'stream' && t.holders >= 20)); };
  // v1.34: the share of the supply that is actually in wallets. On a bonding curve most of the supply sits inside the curve,
  // so "top 10 hold 3% of the supply" can mean ten wallets own everything anybody bought (the TAX case: GMGN shows 100%).
  // Concentration is judged against what circulates, the way GMGN shows it, and a token that ten wallets own is not shown.
  TL.circShare = function (t) {
    if (U.isNum(t.circulating) && t.circulating > 0) return U.clamp(t.circulating, 0, 1);          // Pons: positions read from the curve trades
    if (U.isNum(t.circPct) && t.circPct > 0) return U.clamp(t.circPct, 0, 1);                      // Jupiter: circulating / total supply
    if (TL.graduatedLike(t)) return 1;
    if (U.isNum(t.curve) && t.curve >= 0) return U.clamp(t.curve * 0.7931, 0.0005, 1);              // pump.fun sells 793.1M of the 1B along the curve
    return null;
  };
  TL.top10circ = function (t) {
    var t10 = TL.top10eff(t); if (!U.isNum(t10)) return null;
    if (t.top10Src === 'GMGN') return U.clamp(t10, 0, 1); // GMGN already measures against what circulates
    var c = TL.circShare(t); if (!U.isNum(c) || c <= 0) return null;
    return U.clamp(t10 / c, 0, 1);
  };
  // the bar, by how many holders there are: with twenty holders the top ten are half the room, with a hundred they are a clique
  TL.TOP10C = { h20: 0.9, h40: 0.7, h100: 0.55, call: 0.6, warn: 0.5 };
  TL.top10circBar = function (t) {
    var h = U.isNum(t.holders) && t.holdersSrc !== 'stream' ? t.holders : (t.complete ? 100 : null);
    if (h === null || h < 20) return null;
    return h >= 100 ? TL.TOP10C.h100 : h >= 40 ? TL.TOP10C.h40 : TL.TOP10C.h20;
  };
  TL.concentrated = function (t) { // the reason, or null
    if (t.top || t.partial) return null;
    var c = TL.top10circ(t), bar = TL.top10circBar(t);
    if (c === null || bar === null || c < bar) return null;
    return 'top 10 wallets hold ' + U.pct0(c) + ' of what is in circulation';
  };
  // how many tokens the same wallet launched within an hour of this one, from what the terminal has seen (itself included)
  TL.devSpam = function (t) {
    if (!t._idxDev || !U.isNum(t.createdAt)) return 0;
    var n = 0; (store.idx.devs[t._idxDev] || []).forEach(function (id) { var o = store.tokens[id]; if (o && U.isNum(o.createdAt) && Math.abs(o.createdAt - t.createdAt) <= HR) n++; });
    return n;
  };
  // "junk" = no signs of life for its age; separate from red flags because it is about attention, not fraud
  // ---------- trading windows: 24h contains 6h contains 1h contains 5m ----------
  // A token that traded must never read as a zero or an empty window when a shorter window proves the trades happened.
  // Two different cases, kept apart on purpose: the token is younger than the window (then the longer window IS the
  // shorter one and the number is exact), or the source simply did not report that window (then the shorter one is a
  // floor, marked in t._volMin / t._txMin so the liveness rules never hide a coin over a number we guessed).
  var WIN_ORDER = [['m5', 5 * MIN], ['h1', HR], ['h6', 6 * HR], ['h24', DAY]];
  TL.fillWindows = function (t, now) {
    now = now || U.now();
    var age = U.isNum(t.createdAt) ? now - t.createdAt : null;
    var vol = t.vol || (t.vol = {}), tx = t.tx || (t.tx = {});
    // start from the source numbers again: values this function derived last time must never harden into facts
    Object.keys(t._volFill || {}).forEach(function (k) { if (vol[k] !== undefined) delete vol[k]; });
    Object.keys(t._txFill || {}).forEach(function (k) { if (tx[k] !== undefined) delete tx[k]; });
    var volMin = {}, txMin = {}, volFill = {}, txFill = {}, bestV = null, bestT = null;
    WIN_ORDER.forEach(function (w) {
      var k = w[0], span = w[1], exact = age !== null && age <= span;
      var v = U.isNum(vol[k]) ? vol[k] : null;
      if (v === null) { if (bestV !== null) { vol[k] = bestV; volFill[k] = 1; if (!exact) volMin[k] = 1; } }
      else if (bestV !== null && v < bestV - 0.5) { vol[k] = bestV; volFill[k] = 1; if (!exact) volMin[k] = 1; }
      if (U.isNum(vol[k])) bestV = Math.max(bestV === null ? 0 : bestV, vol[k]);
      var x = tx[k] && U.isNum(tx[k].b) && U.isNum(tx[k].s) ? tx[k] : null;
      if (!x) { if (bestT) { tx[k] = { b: bestT.b, s: bestT.s, est: !exact }; txFill[k] = 1; if (!exact) txMin[k] = 1; } }
      else if (bestT && x.b + x.s < bestT.b + bestT.s) { tx[k] = { b: bestT.b, s: bestT.s, est: !exact }; txFill[k] = 1; if (!exact) txMin[k] = 1; }
      var cur = tx[k];
      if (cur && U.isNum(cur.b) && (!bestT || cur.b + (cur.s || 0) > bestT.b + bestT.s)) bestT = { b: cur.b, s: cur.s || 0 };
    });
    t._volMin = volMin; t._txMin = txMin; t._volFill = volFill; t._txFill = txFill;
    return t;
  };
  TL.rawWindows = function (t) { // the source numbers only, for the cache and for anything that must not read a derived value
    var vol = {}, tx = {};
    Object.keys(t.vol || {}).forEach(function (k) { if (!(t._volFill && t._volFill[k])) vol[k] = t.vol[k]; });
    Object.keys(t.tx || {}).forEach(function (k) { if (!(t._txFill && t._txFill[k])) tx[k] = t.tx[k]; });
    return { vol: vol, tx: tx };
  };
  TL.volExact = function (t, k) { return U.isNum(t.vol[k]) && !(t._volMin && t._volMin[k]); };
  // proof that the token actually traded, whatever a lagging holder count says
  TL.traded = function (t) {
    var tx = t.tx || {}, vol = t.vol || {}, buys = 0, v = 0;
    ['m5', 'h1', 'h6', 'h24'].forEach(function (k) {
      if (tx[k] && U.isNum(tx[k].b)) buys = Math.max(buys, tx[k].b);
      if (U.isNum(vol[k])) v = Math.max(v, vol[k]);
    });
    return buys >= 3 || v >= 150;
  };
  TL.junk = function (t, now) {
    now = now || U.now();
    var age = U.isNum(t.createdAt) ? now - t.createdAt : 0;
    var j = [];
    if (t.stage === 'dead') j.push('dead');
    var tx1 = t.tx.h1 && U.isNum(t.tx.h1.b) ? t.tx.h1.b + t.tx.h1.s : null;
    if (age > 15 * MIN && tx1 === 0) j.push('no trades in the last hour');
    if (age > 10 * MIN && U.isNum(t.holders) && t.holders < 3) j.push('under 3 holders');
    if (age > 20 * MIN && !t.complete && t.chain === 'solana' && U.isNum(t.mc) && t.mc < 2500) j.push('below launch cap for 20+ minutes');
    if (age > 2 * HR && !t.complete && U.isNum(t.curve) && t.curve < 0.05 && (tx1 === null || tx1 < 3)) j.push('curve stalled at start');
    if (U.isNum(t.chg.h1) && t.chg.h1 <= -70 && U.isNum(t.vol.h1) && t.vol.h1 > 0) j.push('down ' + Math.round(-t.chg.h1) + '% in an hour');
    // long past its moment: not a rug on its own, but one more reason not to put it in front of somebody looking for what is live
    if (age > 30 * MIN && U.isNum(t.athMc) && U.isNum(t.mc) && t.athMc >= 30000 && t.mc <= t.athMc * 0.35) j.push('down ' + Math.round((1 - t.mc / t.athMc) * 100) + '% from its peak');
    return j;
  };
  // liveness: a token that has visibly died leaves the feeds. Only known numbers count, missing data never hides.
  TL.stale = function (t, now) {
    now = now || U.now();
    if (t.stage === 'dead') return 'dead';
    var age = U.isNum(t.createdAt) ? now - t.createdAt : null;
    var h1 = t.tx.h1; var tx1 = h1 && U.isNum(h1.b) && U.isNum(h1.s) ? h1.b + h1.s : null;
    var vol1 = U.isNum(t.vol.h1) ? t.vol.h1 : null;
    var idle = U.isNum(t.lastTradeAt) ? now - t.lastTradeAt : (U.isNum(t.watchedAt) ? now - t.watchedAt : null);
    if (t.complete) {
      var since = U.isNum(t.graduatedAt) ? now - t.graduatedAt : age;
      var botted = U.isNum(t.organic) && t.organic < 10 && since != null && since > 45 * MIN; // Jupiter's organic score: a pool traded almost only by bots
      if (t.top) { // a Top coin stays only while it is big and traded: over the cap now, $20K+ changing hands a day, a pool that can take an exit
        var cap = (TL.TOP_MIN_MC && TL.TOP_MIN_MC[t.chain]) || 1e6;
        if (U.isNum(t.mc) && t.mc < cap) return 'market cap fell under ' + U.fmtUsd(cap);
        if (TL.volExact(t, 'h24') && t.vol.h24 < 20000) return 'under $20K traded in 24 hours';
        if (t.chain === 'solana' && U.isNum(t.liq) && t.liq > 0 && t.liq < 20000) return 'liquidity under $20K';
        if (vol1 !== null && tx1 === 0) return 'no trades in the last hour';
        if (U.isNum(t.chg.h24) && t.chg.h24 <= -60) return 'down ' + Math.round(-t.chg.h24) + '% in a day';
        if (botted) return 'mostly bot trading';
        return null;
      }
      if (botted) return 'mostly bot trading (organic score ' + Math.round(t.organic) + ')';
      if (U.isNum(t.liq) && t.liq < 2000 && !(U.isNum(t.vol.h1) && t.vol.h1 > 5000)) return 'liquidity under $2K'; // real hourly volume proves the pool is not empty, whatever we read
      if (since != null && since > 30 * MIN) {
        if (tx1 === 0) return 'no trades in the last hour';
        if (vol1 !== null && vol1 < 300 && (tx1 === null || tx1 <= 3)) return 'under $300 of volume in the last hour';
        if (since > HR && U.isNum(t.holders) && t.holders < 25) return 'under 25 holders';
      }
      return TL.silent(t, now);
    }
    if (age == null) return null;
    if (age > 30 * MIN && tx1 === 0) return 'no trades in the last hour';
    if (age > 30 * MIN && idle !== null && idle > 30 * MIN) return 'no trades for 30 minutes';
    if (age > 20 * MIN && U.isNum(t.holders) && t.holdersSrc !== 'stream' && t.holders < 3) return 'under 3 holders';
    if (age > 45 * MIN && U.isNum(t.curve) && t.curve < 0.03 && (tx1 === null || tx1 < 3)) return 'curve never started';
    return TL.silent(t, now);
  };
  // GMGN mode: a token that dropped out of every GMGN list and got no other update for 15 minutes is not among the traded ones any more
  // (GMGN's lists are the newest 80 launches, the 80 closest to bonding, the 80 latest migrations and the most traded of the day)
  TL.silent = function (t, now) {
    if (!t.gmgnSeenAt || t.top || t.demo) return null;
    var fresh = Math.max(t.gmgnSeenAt || 0, t._touched || 0, t.curveAt || 0, t.lastTradeAt || 0);
    return (now || U.now()) - fresh > 15 * MIN ? 'out of the live lists for 15 minutes' : null;
  };
  // weak: a launch that never found buyers. Thresholds grow with age, so a young token is never judged, and only known numbers count.
  // v1.14 is looser on purpose: New shows the whole flow of launches like GMGN; only launches nobody touched leave.
  // Robinhood Chain is a smaller market than Solana: a launch there lives on single-digit holder counts, so the same
  // absolute thresholds would empty the feed. Each chain gets the bar its own flow supports.
  TL.WEAK = {
    solana: { h3: 2, h10: 8, h30: 20, vol1h: 200 },
    robinhood: { h3: 1, h10: 4, h30: 9, vol1h: 40 }
  };
  TL.weak = function (t, now) {
    now = now || U.now();
    if (t.complete || t.top) return null;
    var W = TL.WEAK[t.chain] || TL.WEAK.solana;
    var age = U.isNum(t.createdAt) ? now - t.createdAt : null; if (age == null) return null;
    var h = U.isNum(t.holders) && t.holdersSrc !== 'stream' ? t.holders : null; // the stream's initial 1 is not a count
    var h1 = t.tx.h1; var tx1 = h1 && U.isNum(h1.b) && U.isNum(h1.s) && t.holdersSrc !== 'stream' ? h1.b + h1.s : null;
    var curve = U.isNum(t.curve) ? t.curve : null;
    if (age > 2 * MIN && !(t.name || t.symbol)) return 'no name';
    var traded = TL.traded(t); // real buys or real volume outrank a holder count that has not caught up yet
    if (age > 3 * MIN && h !== null && h <= W.h3 && !traded) return 'nobody bought it in 3 minutes';
    if (age > 10 * MIN && h !== null && h < W.h10 && !traded) return 'under ' + W.h10 + ' holders after 10 minutes';
    if (age > 15 * MIN && curve !== null && curve < 0.02 && (tx1 === null || tx1 < 5)) return 'curve never moved';
    if (age > 30 * MIN && h !== null && h < W.h30 && !traded) return 'under ' + W.h30 + ' holders after 30 minutes';
    if (age > 30 * MIN && U.isNum(t.vol.h1) && t.vol.h1 < W.vol1h) return 'under ' + U.fmtUsd(W.vol1h) + ' of volume in an hour';
    return null;
  };
  // the quality gate: one loud rug sign is enough on its own. Everything here is a fact about the token, never missing data.
  TL.rugSign = function (t) {
    if (t.sus === true) return 'flagged as suspicious by Jupiter';
    if (t.honeypot === true) return 'honeypot: selling is blocked';
    if (t.mintAuth === true) return 'mint authority still active';
    if (t.freezeAuth === true) return 'freeze authority still active';
    if (t.upgradeable === true) return 'upgradeable contract: the owner can change the code';
    if (t.wash === true) return 'wash trading detected by GMGN';
    if (t.top) return null; // established tokens: exchange and pool wallets make their top-10 look concentrated, only live powers over the token count
    if (t.lpLocked === false) return 'liquidity not locked';
    var proven = TL.proven(t);
    if (U.isNum(t.rugRatio) && t.rugRatio >= TL.RISK.rug) return 'GMGN rug risk ' + U.pct0(t.rugRatio);
    // a copy wave: the same full name launched again within a day of the original (a reused ticker alone is not a copy); a copy that found buyers stays
    var nm = U.norm(t.name);
    if (!proven && nm && nm.length > 2 && t.clones.some(function (o) { return U.isNum(o.createdAt) && U.isNum(t.createdAt) && o.createdAt < t.createdAt && t.createdAt - o.createdAt < DAY && U.norm(o.name) === nm; })) return 'copy of a token launched earlier today';
    var devCap = t.complete ? TL.RISK.devPool : TL.RISK.devCurve;
    if (U.isNum(t.dev.pct) && t.dev.pct >= devCap) return 'dev holds ' + U.pct0(t.dev.pct);
    if (t.dev.sold === true && !t.complete && !proven) return 'dev sold before the token found buyers';
    if (U.isNum(t.bundlePct) && t.bundlePct >= TL.RISK.bundle) return 'bundles ' + U.pct0(t.bundlePct);
    if (U.isNum(t.sniperPct) && t.sniperPct >= TL.RISK.sniper) return 'snipers hold ' + U.pct0(t.sniperPct);
    if (U.isNum(t.insiderPct) && t.insiderPct >= TL.RISK.insider) return 'insiders hold ' + U.pct0(t.insiderPct);
    var t10 = TL.top10eff(t); if (U.isNum(t10) && t10 >= TL.RISK.top10 && TL.spread(t)) return 'top 10 wallets hold ' + U.pct0(t10);
    var conc = TL.concentrated(t); if (conc) return conc; // v1.34: measured against what circulates
    if (!proven && U.isNum(t.dev.launches) && t.dev.launches >= 5 && !(t.dev.graduated > 0)) return 'serial deployer: ' + t.dev.launches + ' launches, none graduated';
    if (U.isNum(t.dev.launches) && t.dev.launches >= 50 && (t.dev.graduated || 0) / t.dev.launches < 0.05 && !TL.crowd(t)) return 'launch farm: ' + U.fmtNum(t.dev.launches) + ' launches, ' + U.fmtNum(t.dev.graduated || 0) + ' graduated'; // v1.74: a farm's coin that drew a real crowd is shown, with the flag
    var spam = TL.devSpam(t); if (spam >= TL.RISK.devSpam && !proven) return 'dev launched ' + spam + ' tokens within an hour';
    return null;
  };
  // ---------- trusted launchpads: the feeds show pump.fun launches on Solana and Pons launches on Robinhood Chain, nothing else ----------
  // letsbonk, bonk, met-dbc, stonkfun, boop, jup-studio, metadao, raydium launchpad, "unknown" pools and the rest are dropped at the source
  // (stream, Jupiter lists, GMGN lists, cache). Top is about the coin, not where it launched, so established memecoins keep their place there.
  TL.TRUSTED = { solana: { 'pump.fun': 1, pumpswap: 1 }, robinhood: { pons: 1, 'uniswap v4': 1, 'robinhood chain': 1 } };
  // v1.78: TL.LAUNCHPADS = 'all' takes every Solana launch the lists carry (letsbonk, boop, jup studio, bags, raydium
  // launchpad, any pool Jupiter tracks), the way GMGN's trending tab mixes them; the site keeps pump.fun and Pons ('pump')
  TL.LAUNCHPADS = 'pump';
  TL.trusted = function (t) {
    if (!t) return false;
    if (t.top || t.demo || t.partial) return true;
    var lp = String(t.launchpad || '').toLowerCase();
    if (TL.TRUSTED[t.chain] && TL.TRUSTED[t.chain][lp]) return true;
    if (TL.LAUNCHPADS === 'all' && t.chain === 'solana' && (lp || t.pair || t.complete)) return true;
    return t.chain === 'solana' && /pump$/.test(String(t.address || '')); // pump.fun mints end in "pump" whatever an index says
  };
  // the gate: '' = show. Every feed, count, suggestion and live insert asks this one function (through TL.vet), so a token cannot be hidden
  // on one path and shown on another. v1.14: AVOID verdicts, any single rug sign, dead or out of the live lists, launches nobody bought.
  // CAUTION tokens show (with their yellow badge): they are the bulk of every live flow; Strict quality hides them too.
  TL.hideReason = function (t, strict, now) {
    var rs = TL.rugSign(t); if (rs) return rs;
    var rug = TL.rugged(t); if (rug) return 'rugged: ' + rug;
    if (t.verdict === 'AVOID' || t.verdict === 'RUGGED') return 'verdict ' + t.verdict;
    var st = TL.stale(t, now); if (st) return st;
    var wk = TL.weak(t, now); if (wk) return wk;
    var junk = TL.junk(t, now); if (junk.length >= 2 || junk[0] === 'dead') return junk.join(', ');
    return strict ? TL.strictReason(t) : '';
  };
  TL.strictReason = function (t, hard) { // the Strict quality filter on top of the gate
    if (t.verdict === 'CAUTION') return 'verdict CAUTION';
    if (!(t.socials.x || t.socials.tg || t.socials.web)) return 'no socials';
    if (!U.isNum(t.holders) || t.holders < 10) return 'under 10 holders';
    hard = hard || TL.flags(t).filter(function (f) { return f.hard; });
    if (hard.length >= 1) return hard[0].label;
    return '';
  };
  TL.passesQuality = function (t, strict) { return !TL.hideReason(t, strict); };
  TL.hiddenReason = function (t) { return TL.hideReason(t, false); };
  // checked: the numbers that can hide a token have arrived (Jupiter's record on Solana: dev history, dev balance, holders, top holders,
  // authorities; wallet positions or Blockscout's holder list on Robinhood Chain). Until then a launch stays out of every feed.
  TL.checked = function (t) { return !!(t && (t.top || t.demo || t.partial || t.checkedAt)); };
  // ---------- one cap, one liquidity: the numbers a chart shows ----------
  // A launchpad memecoin has a fixed supply and no vesting, so its market cap is price x total supply. Index APIs report a
  // *circulating* cap instead, and while a token sits on the bonding curve almost the whole supply is inside the curve, so that
  // number comes out ~100x too small (a $4.8K launch reading as $62). The cap shown here is always rebuilt from the price.
  TL.SUPPLY = { solana: 1e9, robinhood: 1e9 }; // pump.fun mints 1B with 6 decimals, Pons launches a fixed 1B
  TL.supplyOf = function (t) {
    if (t.top || t.demo) return null;               // an established coin can have vesting and a real float: its own reported cap is the honest one
    if (U.isNum(t.supply) && t.supply > 0) return t.supply;
    return TL.trusted(t) ? (TL.SUPPLY[t.chain] || null) : null;
  };
  TL.supplyTxt = function (n) { return n >= 1e9 ? (Math.round(n / 1e8) / 10) + 'B' : n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'M' : U.fmtNum(n); };
  TL.capFix = function (t) {
    var sup = TL.supplyOf(t);
    if (!sup) { if (U.isNum(t.mc) && !U.isNum(t.fdv)) t.fdv = t.mc; return; }
    if (U.isNum(t.price) && t.price > 0) {
      var cap = t.price * sup;
      if (!U.isNum(t.mc) || t.mc <= 0 || t.mc < cap / 1.5 || t.mc > cap * 1.5) { t.mc = cap; t.capSrc = 'price × ' + TL.supplyTxt(sup) + ' supply'; }
      else t.capSrc = t.capSrc || null;
    } else if (U.isNum(t.mc) && t.mc > 0) t.price = t.mc / sup;
    if (U.isNum(t.mc)) t.fdv = t.mc;
  };

  // ---------- rugged: a token that already went to zero must never read STRONG ----------
  // Two shapes of a finished token: the cap fell off its own peak, or the pool it trades in was emptied. Both are facts
  // about numbers this browser watched itself, so neither can fire on a token we only just met.
  TL.RUG = { drop: 0.80, minPeak: 15000, peakMult: 1.8, liqPeak: 4000, liqLeft: 0.15, gradFloor: 0.3 };
  // The other shape of "already over", and the one that fills a trenches feed: the pump finished while the token was still on
  // the curve. The cap never gets big enough for the 80% rule above, so the tell is the holders. A token where sixty trades
  // happened and two wallets are left, or where the holder count fell from eighty-five to two, is a completed dump, not a dip.
  // Everything here is read from a holder source that counted (never the stream's initial 1) and from trades we actually saw.
  // Robinhood Chain is a much smaller market: a live token there runs on single-digit holders, so it gets its own, stricter bar
  // before "nobody is left" is said about it, exactly as the weak-launch thresholds are set per chain.
  TL.DUMP = { holdersLeft: 12, lost: 20, lostMult: 3, roundMult: 1.4,
    solana: { tradesNoHolders: 20, holdersNone: 5 },
    robinhood: { tradesNoHolders: 30, holdersNone: 2 } };
  TL.dumped = function (t, now) {
    if (t.top || t.partial) return null; // the preview flow simulates holders and trades together, so it is judged by the same rule
    var D = TL.DUMP;
    var h = U.isNum(t.holders) && t.holdersSrc !== 'stream' ? t.holders : null;
    var d = U.isNum(t.holdersDelta1h) ? t.holdersDelta1h : null;
    if (h !== null && d !== null && d <= -D.lost && h <= D.holdersLeft && d <= -h * D.lostMult)
      return 'holders walked out: ' + U.fmtNum(h - d) + ' down to ' + U.fmtNum(h) + ' within the hour';
    var age = U.isNum(t.createdAt) ? (now || U.now()) - t.createdAt : null;
    var tx = 0; ['m5', 'h1', 'h6', 'h24'].forEach(function (k) { var x = t.tx[k]; if (x && U.isNum(x.b)) tx = Math.max(tx, x.b + (x.s || 0)); });
    var N = D[t.chain] || D.solana;
    if (h !== null && h <= N.holdersNone && tx >= N.tradesNoHolders && age !== null && age > 90 * SEC)
      return 'everyone sold: ' + U.fmtNum(tx) + ' trades and ' + U.fmtNum(h) + ' holder' + (h === 1 ? '' : 's') + ' left';
    // a finished round trip: it went up and gave the whole move back to the cap it started from
    if (U.isNum(t.athMc) && U.isNum(t.mc) && U.isNum(t.mcFirst) && t.mcFirst > 0 && t.athMc >= t.mcFirst * D.roundMult && t.mc <= t.mcFirst && t.athMc >= 8000)
      return 'round trip: peaked at ' + U.fmtUsd(t.athMc) + ', back to the cap it started from';
    return null;
  };
  // A token this browser met after its pump has no peak on record, so its collapse has to be read from what the sources
  // report about the past: the price change over the window, and how much of the curve was sold back down.
  TL.collapsed = function (t) {
    if (t.top || t.partial) return null;
    var C = t.chg || {}, floor = (TL.LAUNCH_MC[t.chain] || 4000) * 3;
    var small = U.isNum(t.mc) && t.mc <= floor;
    if (U.isNum(t.curvePeak) && U.isNum(t.curve) && !t.complete && t.curvePeak >= 0.25 && t.curve <= t.curvePeak * 0.35)
      return 'the curve was sold back down: ' + U.pct0(t.curvePeak) + ' filled at its peak, ' + U.pct0(t.curve) + ' now';
    // graduated, and now worth less than 30% of the cap every graduation happens at: it peaked and was sold down, seen or not
    var grad = TL.gradCapUsd(t);
    if (grad && TL.graduatedLike(t) && U.isNum(t.mc) && t.mc > 0 && t.mc < grad * TL.RUG.gradFloor)
      return 'sold down to ' + Math.round(t.mc / grad * 100) + '% of the ' + U.fmtUsd(grad) + ' it graduated at';
    if (U.isNum(C.h1) && C.h1 <= -80 && (small || !t.complete)) return 'down ' + Math.round(-C.h1) + '% in the last hour';
    if (U.isNum(C.h6) && C.h6 <= -88 && (!U.isNum(C.h1) || C.h1 <= 10)) return 'down ' + Math.round(-C.h6) + '% in six hours';
    if (U.isNum(C.h24) && C.h24 <= -92 && (!U.isNum(C.h1) || C.h1 <= 10)) return 'down ' + Math.round(-C.h24) + '% in a day';
    return null;
  };
  TL.rugged = function (t) {
    if (t.top || t.partial) return null;
    var dump = TL.dumped(t); if (dump) return dump;
    var fell = TL.collapsed(t); if (fell) return fell;
    var ath = U.isNum(t.athMc) ? t.athMc : null, mc = U.isNum(t.mc) ? t.mc : null;
    if (ath !== null && mc !== null && ath >= TL.RUG.minPeak && mc <= ath * (1 - TL.RUG.drop)) {
      var from = U.isNum(t.mcFirst) ? t.mcFirst : (TL.LAUNCH_MC[t.chain] || 0);
      if (!from || ath >= from * TL.RUG.peakMult) return 'down ' + Math.round((1 - mc / ath) * 100) + '% from its peak of ' + U.fmtUsd(ath);
    }
    if (t.complete && U.isNum(t.liqPeak) && t.liqPeak >= TL.RUG.liqPeak && U.isNum(t.liq) && t.liq <= t.liqPeak * TL.RUG.liqLeft)
      return 'liquidity pulled: ' + U.fmtUsd(t.liq) + ' left of ' + U.fmtUsd(t.liqPeak);
    return null;
  };

  // ---------- the time window is a filter, not a label ----------
  // 5M / 1H / 6H / 24H pick which window every number in the feed is read from. A token older than that window with no trades
  // inside it is not part of "what is moving now", so it leaves the feed. A window we have no number for never hides anything.
  var WIN_SPAN = { m5: 5 * MIN, h1: HR, h6: 6 * HR, h24: DAY };
  TL.WIN_SPAN = WIN_SPAN;
  TL.activeIn = function (t, win, now) {
    if (!win || win === 'h24' || t.top || t.demo || t.partial) return null;
    now = now || U.now();
    var span = WIN_SPAN[win] || HR;
    var age = U.isNum(t.createdAt) ? now - t.createdAt : null;
    if (age === null || age <= span + 60 * SEC) return null;      // younger than the window: everything it ever did is inside it
    var known = false, live = false;
    var x = t.tx && t.tx[win];
    if (x && U.isNum(x.b) && U.isNum(x.s) && !(t._txFill && t._txFill[win])) { known = true; if (x.b + x.s > 0) live = true; }
    var v = t.vol && t.vol[win];
    if (U.isNum(v) && !(t._volFill && t._volFill[win])) { known = true; if (v > 0) live = true; }
    if (!known && U.isNum(t.lastTradeAt)) { known = true; if (now - t.lastTradeAt <= span) live = true; }
    return known ? live : null;
  };

  // ---------- runners: which launches actually went somewhere, and how many there were today ----------
  // A runner is a launch that reached a cap where a buyer could have walked away with real money: above the
  // bonding threshold on Solana, above $30K on the much smaller Robinhood Chain, and at least 5x the cap we
  // first saw it at. Everything here is counted from what this browser watched, and the panel says so.
  TL.RUNNER = {
    solana: { mc: 100000, mult: 5, tiers: [100000, 500000, 1000000] },
    robinhood: { mc: 30000, mult: 5, tiers: [30000, 100000, 300000] }
  };
  TL.LAUNCH_MC = { solana: 4300, robinhood: 3600 }; // pump.fun and Pons both open a curve around this cap
  // v1.33: the cap a pump.fun curve completes at is fixed by the curve itself: 30 SOL virtual, 1.073B virtual tokens, 793.1M real
  // tokens to sell, constant product; at the last token sold the price is 115 SOL / 279.9M tokens, so the full 1B supply is
  // worth 410.9 SOL. Every graduated token was worth at least that once. A graduated token far below it has already dumped,
  // whether or not this browser was there to see the peak (the SUPER case: met at $18.5K, "STRONG", called; it had done $140K).
  TL.PUMP_GRAD_SOL = 410.9;
  TL.gradCapUsd = function (t) {
    if (!t || t.chain !== 'solana') return null;
    var solUsd = store.solUsd || (TL.sources && TL.sources.solUsd) || null;
    return U.isNum(solUsd) && solUsd > 0 ? TL.PUMP_GRAD_SOL * solUsd : null;
  };
  TL.graduatedLike = function (t) { return !!(t.complete || U.isNum(t.graduatedAt) || (t.curve == null && t.pair)); };
  var DAY_KEY = 'tl.day2'; // v1.29: same reason as the cache key
  function dayStamp(ts) { var d = new Date(ts || U.now()); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function blankChainDay() { return { launches: 0, graduated: 0, runners: 0, tiers: [0, 0, 0], best: null, list: [], seen: [] }; }
  function blankDay() { return { date: dayStamp(), watchedMs: 0, chains: { solana: blankChainDay(), robinhood: blankChainDay() } }; }
  TL.day = (function () {
    try { var d = JSON.parse(localStorage.getItem(DAY_KEY) || 'null'); if (d && d.date === dayStamp() && d.chains && d.chains.solana) return d; } catch (e) { }
    return blankDay();
  })();
  var daySavedAt = 0;
  TL.saveDay = function (force) {
    var now = U.now(); if (!force && now - daySavedAt < 4 * SEC) return;
    daySavedAt = now;
    try { localStorage.setItem(DAY_KEY, JSON.stringify(TL.day)); } catch (e) { }
  };
  TL.dayRoll = function () { if (TL.day.date !== dayStamp()) { TL.day = blankDay(); seenSets = { solana: null, robinhood: null }; TL.saveDay(true); } };
  TL.dayWatched = function (ms) { TL.dayRoll(); TL.day.watchedMs += ms; TL.saveDay(); };
  TL.dayOf = function (chain) { TL.dayRoll(); return TL.day.chains[chain] || blankChainDay(); };
  function countable(t) { return !!(t && !t.demo && !t.partial && !t.top && U.isNum(t.createdAt) && dayStamp(t.createdAt) === TL.day.date); }
  // Counting has to survive a reload without counting the same launch twice, so each chain keeps a short ring of
  // the launches it has already counted today (the last 4000 addresses, tail only, ~30 KB).
  var seenSets = { solana: null, robinhood: null };
  function seenSet(chain) {
    if (seenSets[chain]) return seenSets[chain];
    var c = TL.day.chains[chain]; if (!c) return null;
    c.seen = Array.isArray(c.seen) ? c.seen : [];
    var set = {}; c.seen.forEach(function (k) { set[k] = 1; });
    seenSets[chain] = set; return set;
  }
  TL.dayLaunch = function (t) { // a launch we actually watched arrive: born today, first seen within its first hour
    TL.dayRoll();
    if (!countable(t) || t._dayCounted || U.now() - t.createdAt > HR) return;
    var c = TL.day.chains[t.chain]; if (!c) return;
    var a = String(t.address || ''); var key = a.length > 12 ? a.slice(0, 6) + a.slice(-6) : a; var set = seenSet(t.chain);
    if (!key || !set || set[key]) { t._dayCounted = true; return; }
    set[key] = 1; c.seen.push(key);
    if (c.seen.length > 4000) { var gone = c.seen.splice(0, c.seen.length - 4000); gone.forEach(function (k) { delete set[k]; }); }
    t._dayCounted = true; c.launches++; TL.saveDay();
  };
  TL.dayGraduated = function (t) {
    TL.dayRoll();
    if (!countable(t) || !t._dayCounted || t._dayGrad) return;
    t._dayGrad = true;
    var c = TL.day.chains[t.chain]; if (!c) return;
    c.graduated++; TL.saveDay();
  };
  function dayRunner(t) {
    TL.dayRoll();
    if (!countable(t) || !t._dayCounted) return;
    var c = TL.day.chains[t.chain], R = TL.RUNNER[t.chain] || TL.RUNNER.solana; if (!c) return;
    if (t._dayRunner) return;
    t._dayRunner = true;
    c.runners++;
    var row = { id: t.id, address: t.address, symbol: t.symbol || '', name: t.name || '', x: t.peakXSeen !== false && U.isNum(t.peakX) ? Math.round(t.peakX * 10) / 10 : null, mc: t.athMc, at: t.runnerAt || U.now() };
    c.list.push(row);
    c.list.sort(function (a, b) { return (b.mc || 0) - (a.mc || 0); });
    c.list = c.list.slice(0, 20);
    if (!c.best || (t.athMc || 0) > (c.best.mc || 0)) c.best = row;
    TL.saveDay();
  }
  TL.dayDrop = function (t) { // a runner that turned out to be a scam or rugged leaves today's list and today's count, reload or not
    TL.dayRoll();
    var c = TL.day.chains[t.chain]; if (!c) return;
    var listed = (c.list || []).some(function (r) { return r.id === t.id; });
    if (!listed && !t._dayRunner) return;
    t._dayRunner = false;
    if (listed) c.runners = Math.max(0, c.runners - 1);
    c.list = (c.list || []).filter(function (r) { return r.id !== t.id; });
    if (c.best && c.best.id === t.id) c.best = c.list.length ? c.list[0] : null;
    TL.saveDay();
  };
  // what the panel may show of today's list: nothing the gate would refuse now, whatever it looked like when it ran
  TL.dayClean = function (rows) {
    return (rows || []).filter(function (r) {
      var t = store.tokens[r.id]; if (!t) return true;
      TL.ensureVet(t);
      if (t.verdict === 'AVOID' || t.verdict === 'RUGGED' || TL.rugSign(t) || TL.rugged(t) || TL.botPumped(t)) { TL.dayDrop(t); return false; }
      return true;
    });
  };
  TL.dayTier = function (t) { // the cap ladder: how far today's launches got
    TL.dayRoll();
    if (!countable(t) || !t._dayCounted || !U.isNum(t.athMc)) return;
    var c = TL.day.chains[t.chain], R = TL.RUNNER[t.chain] || TL.RUNNER.solana; if (!c) return;
    t._tierHit = t._tierHit || [0, 0, 0];
    R.tiers.forEach(function (lvl, i) { if (!t._tierHit[i] && t.athMc >= lvl) { t._tierHit[i] = 1; c.tiers[i] = (c.tiers[i] || 0) + 1; TL.saveDay(); } });
  };
  // peak tracking: every token carries the highest cap we have seen and how many times that is its starting cap
  TL.trackPeak = function (t, now) {
    now = now || U.now();
    if (U.isNum(t.liq) && t.liq > 0 && (!U.isNum(t.liqPeak) || t.liq > t.liqPeak)) t.liqPeak = t.liq;
    if (U.isNum(t.curve) && !t.complete && (!U.isNum(t.curvePeak) || t.curve > t.curvePeak)) t.curvePeak = t.curve;
    if (t.partial || !U.isNum(t.mc) || t.mc <= 0) return;
    if (!U.isNum(t.mcFirst)) { // the cap it started from: what we saw if we were early, otherwise the launchpad's own starting cap
      if (U.isNum(t.createdAt) && now - t.createdAt < 30 * MIN) { t.mcFirst = t.mc; t.mcFirstSeen = true; }
      else if (!t.top && TL.LAUNCH_MC[t.chain]) { t.mcFirst = TL.LAUNCH_MC[t.chain]; t.mcFirstSeen = false; }
    }
    if (!U.isNum(t.athMc) || t.mc > t.athMc) { t.athMc = t.mc; t.athAt = now; }
    // the multiple is only claimed when we watched the token from its first minutes. Arriving late and dividing by the
    // launchpad's opening cap would let the terminal boast a 2000x it never saw: the peak cap alone is the honest number then.
    if (U.isNum(t.mcFirst) && t.mcFirst > 0) { t.peakX = t.athMc / t.mcFirst; t.peakXSeen = t.mcFirstSeen !== false; }
    TL.dayTier(t);
  };
  // The runner flag is handed out after the verdict, never before: a token can only be one of today's winners while it is one
  // the terminal would show. A token that later turns out to be a scam, or that rugs, is taken back out of today's list.
  // v1.68: a pool traded almost only by bots (Jupiter's organic score near zero), or a seven-figure cap standing on a pool worth under 2% of
  // it, is a ramp, not a run: the chart climbs in a straight line because one script buys from itself, and a buyer cannot leave with
  // the money the cap promises. Such a token is never one of today's runners, and leaves the list the moment the numbers show it.
  TL.botPumped = function (t) {
    if (!t) return '';
    if (U.isNum(t.organic) && t.organic < 10) return 'mostly bot trading (organic score ' + Math.round(t.organic) + ')';
    if (U.isNum(t.liq) && U.isNum(t.mc) && t.mc >= 500000 && t.liq > 0 && t.liq < t.mc * 0.02) return 'liquidity is ' + (Math.round(t.liq / t.mc * 1000) / 10) + '% of the cap';
    return '';
  };
  TL.trackRunner = function (t, now) {
    if (t.top || t.partial || !U.isNum(t.athMc)) return;
    now = now || U.now();
    var bad = t.verdict === 'AVOID' || t.verdict === 'RUGGED' || t.sus === true || t.honeypot === true || !!TL.rugSign(t) || !!TL.rugged(t) || !!TL.botPumped(t);
    if (t.runner && bad) { t.runner = false; t.runnerLost = true; TL.dayDrop(t); return; }
    if (t.runner || bad || t.runnerLost) return;
    var R = TL.RUNNER[t.chain] || TL.RUNNER.solana;
    // a six-figure cap on a handful of holders is a misread, not a run: the flag waits for the holders that a real run brings
    var h = U.isNum(t.holders) && t.holdersSrc !== 'stream' ? t.holders : null;
    if (h !== null && h < TL.RUNNER_MIN_HOLDERS) return;
    if (t.athMc >= R.mc && (!U.isNum(t.peakX) || t.peakX >= R.mult)) { t.runner = true; t.runnerAt = now; dayRunner(t); }
  };
  TL.RUNNER_MIN_HOLDERS = 25;
  TL.dayStats = function (chain) {
    var R = TL.RUNNER[chain] || TL.RUNNER.solana;
    if (store.mode !== 'live') { // preview / offline: count what the simulated flow itself shows
      var c = blankChainDay(), since = U.now() - DAY; // preview data is synthetic: count the last 24 hours, so the panel does not empty itself at midnight
      store.all().forEach(function (t) {
        if (t.chain !== chain || t.top || !U.isNum(t.createdAt) || t.createdAt < since) return;
        c.launches++;
        if (t.complete) c.graduated++;
        var ath = U.isNum(t.athMc) ? t.athMc : (U.isNum(t.mc) ? t.mc : 0);
        R.tiers.forEach(function (lvl, i) { if (ath >= lvl) c.tiers[i]++; });
        if (t.verdict === 'AVOID' || t.verdict === 'RUGGED' || t.sus === true || TL.botPumped(t)) return;
        if (t.runner || (ath >= R.mc && (!U.isNum(t.peakX) || t.peakX >= R.mult))) {
          c.runners++;
          var row = { id: t.id, address: t.address, symbol: t.symbol || '', name: t.name || '', x: t.peakXSeen !== false && U.isNum(t.peakX) ? Math.round(t.peakX * 10) / 10 : null, mc: ath, at: t.athAt || t.createdAt };
          c.list.push(row);
          if (!c.best || ath > (c.best.mc || 0)) c.best = row;
        }
      });
      c.list.sort(function (a, b) { return (b.mc || 0) - (a.mc || 0); }); c.list = c.list.slice(0, 20);
      return { day: c, watchedMs: null, tiers: R.tiers, live: false };
    }
    return { day: TL.dayOf(chain), watchedMs: TL.day.watchedMs, tiers: R.tiers, live: true };
  };
  // ---------- potential: which launch looks most likely to be the next runner ----------
  // Same inputs the verdict uses, weighted for "is this going somewhere in the next hour" rather than "is this safe":
  // how fast holders arrive, how much money moves against the cap, who is buying, how clean it is, and who is inside.
  TL.potential = function (t, now) {
    var sc = t.scores; if (!sc) return 0;
    now = now || U.now();
    var mins = U.isNum(t.createdAt) ? Math.max(1, (now - t.createdAt) / MIN) : 10;
    var holdRate = U.isNum(t.holders) && t.holdersSrc !== 'stream' ? t.holders / mins : null;
    var vol = U.isNum(t.vol.h1) ? t.vol.h1 : (U.isNum(t.vol.m5) ? t.vol.m5 * 12 : null);
    var volToMc = vol !== null && U.isNum(t.mc) && t.mc > 0 ? vol / t.mc : null;
    var tx = (t.tx.h1 && U.isNum(t.tx.h1.b) ? t.tx.h1 : null) || (t.tx.m5 && U.isNum(t.tx.m5.b) ? t.tx.m5 : null);
    var buyShare = tx && (tx.b + tx.s) > 0 ? tx.b / (tx.b + tx.s) : null;
    var cl = function (x) { return U.clamp(x, 0, 1); };
    var parts = {
      momentum: 0.26 * cl(sc.momentum / 100),
      traction: 0.22 * (holdRate === null ? 0.3 : cl(Math.log(1 + holdRate) / Math.log(11))),   // ~10 new holders a minute is a full mark
      flow: 0.16 * (volToMc === null ? 0.3 : cl(Math.log(1 + volToMc * 2) / Math.log(5))),      // hourly volume at twice the cap is a full mark
      safety: 0.16 * cl(sc.safety / 100),
      buyers: 0.10 * (buyShare === null ? 0.45 : cl((buyShare - 0.4) / 0.3)),
      community: 0.10 * cl(sc.community / 100)
    };
    var base = parts.momentum + parts.traction + parts.flow + parts.safety + parts.buyers + parts.community;
    var mult = 1;
    if (t.smart && (t.smart.wallets || t.smart.kols)) mult += Math.min(0.18, 0.04 * (t.smart.wallets || 0) + 0.06 * (t.smart.kols || 0)); // smart money and KOLs inside
    if (U.isNum(t.curve) && !t.complete && mins > 0) mult += Math.min(0.12, (t.curve / mins) * 30);   // a curve filling fast
    if (U.isNum(t.peakX) && t.peakX >= 2) mult += Math.min(0.10, 0.02 * t.peakX);                     // it has already moved once
    t._potParts = parts;
    // the ceiling is deliberately out of easy reach: 100 needs every part maxed AND smart money inside, so the order stays readable
    return Math.round(U.clamp(base * mult / 1.35, 0, 1) * 100);
  };
  // vet: stage, clones, score, flags and the gate, stamped with the data revision they were computed from
  TL.vet = function (t, now) {
    now = now || U.now();
    TL.capFix(t);
    TL.fillWindows(t, now);
    TL.trackPeak(t, now);
    t.clones = TL.clonesOf(t);
    t.firstOfName = !t.clones.some(function (o) { return U.isNum(o.createdAt) && U.isNum(t.createdAt) && o.createdAt < t.createdAt; });
    t.stage = TL.stageOf(t, now);
    var sc = TL.score(t); t.scores = sc; t.verdict = sc.verdict; t.reasons = sc.reasons;
    t.momentumKey = sc.momentum + (U.isNum(t.tx.m5 && t.tx.m5.b) ? Math.min(20, t.tx.m5.b) : 0) / 10;
    t._flags = TL.flags(t); t._junk = TL.junk(t, now);
    t._hide = TL.hideReason(t, false, now); t._ok = !t._hide;
    t._okStrict = t._ok && !TL.strictReason(t, t._flags.filter(function (f) { return f.hard; }));
    t._pot = TL.potential(t, now);
    TL.trackRunner(t, now); // after the verdict: only a token the terminal would show can be one of today's runners
    if (store.mode === 'live' && !t._dayCounted) TL.dayLaunch(t); // the creation time often lands after the first upsert
    if (t.complete && !t._dayGrad) TL.dayGraduated(t);
    t._vetRev = t._rev; t._vetAt = now;
    return t;
  };
  TL.ensureVet = function (t) { var now = U.now(); if (t._vetRev !== t._rev || now - (t._vetAt || 0) > 5 * SEC) TL.vet(t, now); return t; };
  TL.nameKeys = function (t) { var keys = [], n = U.norm(t.name), sy = U.norm(t.symbol); if (n && n.length > 2) keys.push('n:' + n); if (sy && sy.length > 1) keys.push('s:' + sy); return keys.join('|'); };
  TL.clonesOf = function (t) {
    var seen = {}, out = [];
    (t._idxNames ? t._idxNames.split('|') : []).forEach(function (k) {
      (store.idx.names[t.chain + k] || []).forEach(function (id) {
        if (id === t.id || seen[id]) return; var o = store.tokens[id]; if (!o) return;
        if (U.isNum(o.createdAt) && U.isNum(t.createdAt) && Math.abs(o.createdAt - t.createdAt) > 3 * DAY) return;
        seen[id] = 1; out.push(o);
      });
    });
    return out;
  };
  // logo candidates, most reliable first. The picture must come from the token's own metadata (pump.fun keeps it on its
  // pinata IPFS gateway) or from an index that resolved this exact token; never from a generic per-address URL:
  // images.pump.fun/<mint> returns the same Pepe placeholder for every address, real or not (checked 15 Sep 2026).
  TL.BAD_LOGO = /images\.pump\.fun/;
  // every candidate URL for a token's picture, most reliable first: the token's own metadata through several IPFS gateways and an image
  // proxy, then the picture indexes that key by mint. A row falls back to initials only when every one of these fails.
  TL.imgProxy = function (u) { return u && /^https?:\/\//i.test(u) && u.indexOf('wsrv.nl') < 0 ? 'https://wsrv.nl/?url=' + encodeURIComponent(u) + '&w=128&h=128&fit=cover&output=webp&default=1' : null; };
  TL.imgProxy2 = function (u) { // a second, independent image CDN for the same file: when one proxy is slow or blocked where the viewer sits, the other is not
    var m = u && String(u).match(/^https?:\/\/([^/]+)(\/.*)?$/i); if (!m) return null;
    return 'https://cdn.statically.io/img/' + m[1] + '/w=128,h=128,f=auto' + (m[2] || '/');
  };
  // v2.10: the order comes from a measurement in a real browser (8 Oct 2026, 16 Solana and 16 Robinhood Chain tokens, one gateway at a
  // time): pump.fun's pinata copy answered 16 of 16 in ~0.2 s, ipfs.filebase.io 16 of 16 in ~0.9 s (and 15 of 16 for Robinhood Chain,
  // where the launchpad's own /api/ipfs path answered none), the wsrv.nl proxy 16 of 16 in ~3 s; ipfs.io, dweb.link and w3s.link
  // answered none where the test ran and stay at the back for the places where they work. images.pump.fun/coin-image/<mint> is never
  // used: it returns a placeholder for any address, even one that does not exist (checked again on 8 Oct 2026).
  // Candidates are raced two at a time (TL.pics below): whichever answers first wins, and a gateway that hangs never blocks the picture.
  var GW = {
    pinata: function (c) { return 'https://pump.mypinata.cloud/ipfs/' + c + '?img-width=128&img-dpr=2&img-onerror=redirect'; },
    filebase: function (c) { return 'https://ipfs.filebase.io/ipfs/' + c; },
    fourever: function (c) { return 'https://4everland.io/ipfs/' + c; },
    ipfsio: function (c) { return 'https://ipfs.io/ipfs/' + c; },
    dweb: function (c) { return 'https://dweb.link/ipfs/' + c; }
  };
  TL.logoCandidates = function (t) {
    var c = [];
    var add = function (u) { if (u && !TL.BAD_LOGO.test(u) && c.indexOf(u) < 0) c.push(u); };
    var sol = t.chain === 'solana';
    var dex = sol && !t.demo && !t.partial && /^[A-Za-z0-9]{32,44}$/.test(t.address || '') ? 'https://dd.dexscreener.com/ds-data/tokens/solana/' + t.address + '.png?size=lg' : null;
    var logo = t.logo ? String(t.logo) : '';
    if (logo.indexOf('data:') === 0) { add(logo); return c; }
    var m = logo.match(IPFS_RE), cid = m ? m[1] + (m[2] || '') : (logo ? TL.cidOf(logo) : null);
    var plain = logo && !m ? logo.split('?')[0] : '';
    if (cid) {
      if (sol) { add(GW.pinata(cid)); add(GW.filebase(cid)); add(TL.imgProxy(GW.filebase(cid).split('?')[0])); add(TL.imgProxy('https://pump.mypinata.cloud/ipfs/' + cid)); }
      else { add(GW.filebase(cid)); add(TL.imgProxy(GW.filebase(cid))); add(GW.pinata(cid)); }
      add(GW.fourever(cid));
      if (logo && !m && !/ponsfamily\.com/.test(logo)) add(logo);   // the launchpad's own address for the same file (Pons' path answers nothing, so it is left out)
      add(GW.ipfsio(cid)); add(GW.dweb(cid));
      if (logo && !m && /ponsfamily\.com/.test(logo)) add(logo);
    } else if (logo) {
      add(logo); add(TL.imgProxy(plain || logo)); add(TL.imgProxy2(plain || logo));
    }
    if (t.logoAlt) { var ac = TL.cidOf(t.logoAlt); if (ac) { add(GW.pinata(ac)); add(GW.filebase(ac)); } add(t.logoAlt); }
    if (dex) { add(dex); add(TL.imgProxy(dex.split('?')[0])); }
    return c;
  };

  // the preview's stand-in picture for a sample token that has none of its own: a soft orb in the token's colour, inline
  TL.demoLogo = function (seed, sym) {
    var h = U.hash(String(seed || sym || '?')) % 360, h2 = (h + 70) % 360, t = String(sym || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="hsl(' + h + ',85%,72%)"/><stop offset=".6" stop-color="hsl(' + h2 + ',70%,42%)"/><stop offset="1" stop-color="hsl(' + h2 + ',60%,20%)"/></radialGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="40" font-family="Arial,sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,.88)">' + t + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  // ---------- v2.10: pictures first ----------
  // A list (the feed, the calls, the runners, Top) shows a token only once its picture has loaded: TL.pics loads the pictures of the
  // tokens a list wants in the background, six tokens at a time, each one racing its candidates two by two. The browser keeps every
  // loaded file, so the row that appears shows its picture at once. A token whose every candidate failed waits and tries again
  // (8 s, 20 s, 45 s, 1.5 min, 3 min, then every 5 min): its metadata, a second address for the picture, can still arrive.
  var P = TL.pics = { loaded: {}, racing: {}, queue: [], active: 0, PAR: 10, STEP: 1600, MAX: 20000, hooks: [], ghosts: {}, waits: [8, 20, 45, 90, 180, 300] };
  P.can = typeof Image === 'function' && typeof document !== 'undefined';
  P.has = function (t) { if (t && !t.logoOk && typeof t.logo === 'string' && t.logo.indexOf('data:image/') === 0) { t.logoOk = t.logo; P.loaded[t.logo] = 1; } return !!(t && (t.demo || t.partial || t.logoOk)); }; // a picture carried inline is in already
  P.on = function (fn) { P.hooks.push(fn); return P; };
  function picEmit(t) { for (var i = 0; i < P.hooks.length; i++) { try { P.hooks[i](t); } catch (e) {} } }
  // the token a record (a call from the server, a trader's buy) stands for: the one in the store, or a small stand-in that keeps its picture
  P.of = function (r) {
    if (!r) return null;
    var id = r.id || (r.chain + ':' + r.address), t = store.tokens && store.tokens[id];
    if (t) { if (r.logo && !t.logoOk && !t.logo) t.logo = r.logo; else if (r.logo && !t.logoOk && t.logo !== r.logo && t.logoAlt !== r.logo) { t.logoAlt = r.logo; P.reset(t); } return t; }
    var g = P.ghosts[id];
    if (!g) g = P.ghosts[id] = { id: id, chain: r.chain, address: r.address, symbol: r.symbol || '', name: r.name || '', logo: r.logo || null, ghost: true };
    else if (r.logo && !g.logoOk && g.logo !== r.logo) { g.logo = r.logo; P.reset(g); }
    return g;
  };
  P.reset = function (t) { if (t && !t.logoOk) { t.logoFailed = false; t._picNext = 0; } };
  P.want = function (t, prio) {
    if (!P.can || !t || P.has(t) || P.racing[t.id]) return;
    if (t._picNext && U.now() < t._picNext) return;
    var at = P.queue.indexOf(t);
    if (at >= 0) { if (prio && at > 0) { P.queue.splice(at, 1); P.queue.unshift(t); } return; }
    if (prio) P.queue.unshift(t); else P.queue.push(t);
    if (P.queue.length > 400) P.queue.length = 400;
    picPump();
  };
  function picPump() { while (P.active < P.PAR && P.queue.length) { var t = P.queue.shift(); if (!P.has(t) && !P.racing[t.id]) picRace(t); } }
  function picFail(t) {
    t.logoFailed = true; t.logoRacedAt = U.now(); t._picTries = (t._picTries || 0) + 1;
    t._picNext = U.now() + P.waits[Math.min(t._picTries - 1, P.waits.length - 1)] * 1000;
    if (!t.ghost && TL.sources && TL.sources.retryLogoSoon) TL.sources.retryLogoSoon(t); // the metadata again: a new address for the picture restarts the race
  }
  function picRace(t) {
    var cands = TL.logoCandidates(t);
    if (!cands.length) { picFail(t); return; }
    P.racing[t.id] = true; P.active++;
    var settled = false, idx = 0, inflight = 0, timers = [];
    var done = function (src) {
      if (settled) return; settled = true; delete P.racing[t.id]; P.active--; timers.forEach(clearTimeout);
      if (src) {
        P.loaded[src] = 1; t.logoOk = src; t.logoFailed = false; t._picTries = 0; t._picNext = 0;
        if (!t.ghost && TL.sources && TL.sources.markLogoOk) TL.sources.markLogoOk(t, src);
        picEmit(t);
      } else picFail(t);
      picPump();
    };
    var launch = function () {
      if (settled) return;
      var batch = cands.slice(idx, idx + 2); idx += batch.length;
      if (!batch.length) { if (!inflight) done(null); return; }
      batch.forEach(function (u) {
        inflight++; var im = new Image(); im.referrerPolicy = 'no-referrer'; im.decoding = 'async';
        im.onload = function () { inflight--; if (im.naturalWidth > 1) done(u); else if (idx >= cands.length && !inflight) done(null); else launch(); };
        im.onerror = function () { inflight--; if (idx < cands.length) launch(); else if (!inflight) done(null); };
        im.src = u;
      });
      if (idx < cands.length) timers.push(setTimeout(launch, P.STEP));
    };
    launch();
    timers.push(setTimeout(function () { done(null); }, P.MAX));
  }
  // a picture that stopped loading (the file went away, a cache was cleared): back to the queue, out of the lists until it loads again
  P.lost = function (t, src) { if (!t || (src && t.logoOk !== src)) return; delete P.loaded[t.logoOk]; t.logoOk = null; P.reset(t); P.want(t, true); };
  // ---------- wallet avatars ----------
  // GMGN gives every address a small pixel creature. When the GMGN source is not connected we cannot fetch theirs,
  // so we draw our own from the address: same address, same face, everywhere in the app.
  var AV_BG = [[338, 70, 82], [190, 65, 78], [40, 80, 80], [150, 45, 76], [265, 55, 82], [20, 75, 80], [95, 45, 76], [215, 60, 80]];
  var AV_BODY = [[0, 0, 18], [215, 35, 28], [150, 30, 24], [275, 30, 26], [20, 40, 26], [195, 45, 30]];
  TL.pixelAvatar = function (seed, size) {
    size = size || 32;
    var h = U.hash(String(seed || '?')), r = U.rng('av' + seed);
    var G = 12, cell = 100 / G;
    var pick = function (arr, n) { return arr[((n % arr.length) + arr.length) % arr.length]; }; // the hash can be negative after a shift
    var bg = pick(AV_BG, h), body = pick(AV_BODY, h >> 3);
    var accent = pick(AV_BG, (h >> 6) + 3);
    var px = function (x, y, c, w, hh) { return '<rect x="' + (x * cell).toFixed(2) + '" y="' + (y * cell).toFixed(2) + '" width="' + ((w || 1) * cell + 0.05).toFixed(2) + '" height="' + ((hh || 1) * cell + 0.05).toFixed(2) + '" fill="' + c + '"/>'; };
    var col = function (a, l) { return 'hsl(' + a[0] + ' ' + a[1] + '% ' + (l == null ? a[2] : l) + '%)'; };
    var bodyC = col(body), accC = col(accent, 62);
    var out = '';
    // the creature: a symmetric silhouette, wider at the bottom, with a head band of ears
    var top = 2 + Math.abs(h % 2);              // where the head starts
    var wide = 3 + Math.abs((h >> 2) % 2);      // half-width of the body
    for (var y = top; y < G - 1; y++) {
      var shrink = y < top + 1 ? 1 : 0;                       // ears row is narrower
      var half = Math.max(1, wide - shrink + (y > G - 4 ? 1 : 0));
      var x0 = Math.max(0, 6 - half), w = Math.min(G, 6 + half) - x0;
      out += px(x0, y, bodyC, w, 1);
    }
    // ears
    if (Math.abs(h % 3) !== 0) { out += px(6 - wide, top - 1, bodyC); out += px(5 + wide, top - 1, bodyC); }
    // eyes: white with a dark pupil, always on the same row
    var ey = top + 2;
    var ex = [6 - wide + 1, 5 + wide - 1];
    ex.forEach(function (x, i) {
      out += px(x, ey, '#ffffff', 1.6, 1.6);
      out += px(x + (i === 0 ? 0.5 : 0.2), ey + 0.5, '#101418', 0.9, 0.9);
    });
    // a coloured band near the bottom: scarf, belly or collar
    var band = G - 3 - Math.abs(h % 2);
    out += px(Math.max(0, 6 - wide), band, accC, Math.min(G, 2 * wide), 1);
    if (Math.abs((h >> 4) % 2)) out += px(6 - 1, band + 1, accC, 2, 1);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="crispEdges">' +
      '<rect width="100" height="100" fill="' + col(bg) + '"/>' + out + '</svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  };
  // a deterministic picture for tokens that have none (preview launches): two soft blobs and a ring, coloured from the address
  TL.genAvatar = function (seed) {
    var h = U.hash(seed || '?'), hue = h % 360, hue2 = (hue + 40 + (h >> 8) % 120) % 360;
    var x1 = 20 + (h >> 3) % 25, y1 = 20 + (h >> 7) % 25, r1 = 16 + (h >> 11) % 12;
    var x2 = 45 + (h >> 13) % 30, y2 = 45 + (h >> 17) % 30, r2 = 10 + (h >> 19) % 14;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"><rect width="90" height="90" rx="20" fill="hsl(' + hue + ' 45% 18%)"/>' +
      '<circle cx="' + x1 + '" cy="' + y1 + '" r="' + r1 + '" fill="hsl(' + hue + ' 70% 55%)" opacity="0.85"/>' +
      '<circle cx="' + x2 + '" cy="' + y2 + '" r="' + r2 + '" fill="hsl(' + hue2 + ' 75% 60%)" opacity="0.8"/>' +
      '<circle cx="45" cy="45" r="30" fill="none" stroke="hsl(' + hue2 + ' 60% 70%)" stroke-width="3" opacity="0.35"/></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  };

  // ---------- store ----------
  var store = TL.store = { tokens: {}, order: [], listeners: [], mode: 'boot', chainMode: { solana: 'boot', robinhood: 'boot' }, solUsd: null, ethUsd: null, CAP: 1500, _list: null, idx: { names: {}, devs: {} } };
  function unbucket(map, key, id) { var b = map[key]; if (!b) return; var i = b.indexOf(id); if (i >= 0) b.splice(i, 1); if (!b.length) delete map[key]; }
  function indexToken(t) { // name / ticker and dev-wallet buckets, so copies and spam launches are found without scanning the store
    var keys = TL.nameKeys(t);
    if (t._idxNames !== keys) {
      (t._idxNames ? t._idxNames.split('|') : []).forEach(function (k) { unbucket(store.idx.names, t.chain + k, t.id); });
      (keys ? keys.split('|') : []).forEach(function (k) { var b = store.idx.names[t.chain + k] = store.idx.names[t.chain + k] || []; touch(b, t); b.push(t.id); });
      t._idxNames = keys;
    }
    var d = t.dev && t.dev.address ? t.chain + ':' + String(t.dev.address).toLowerCase() : '';
    if (d && t._idxDev !== d) { if (t._idxDev) unbucket(store.idx.devs, t._idxDev, t.id); var db = store.idx.devs[d] = store.idx.devs[d] || []; touch(db, t); db.push(t.id); t._idxDev = d; }
  }
  function touch(bucket, t) { bucket.forEach(function (id) { var o = store.tokens[id]; if (o && o !== t) o._rev = (o._rev || 0) + 1; }); } // siblings get re-vetted: a copy or a spam wave shows on every member
  store.index = indexToken; // for tokens placed in the store directly (the preview snapshot)
  store.get = function (id) { return store.tokens[id]; };
  store.all = function () { if (!store._list) store._list = Object.keys(store.tokens).map(function (k) { return store.tokens[k]; }); return store._list; };
  store.remove = function (id) {
    var t = store.tokens[id]; if (!t) return;
    (t._idxNames ? t._idxNames.split('|') : []).forEach(function (k) { unbucket(store.idx.names, t.chain + k, id); });
    if (t._idxDev) unbucket(store.idx.devs, t._idxDev, id);
    delete store.tokens[id]; store._list = null;
  };
  // v1.59: a token's name and symbol are text from a chain or an API: bounded, without control characters, whatever the source
  function cleanText(v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : (v == null ? v : String(v).slice(0, n)); }
  store.upsert = function (partial) {
    if (partial.symbol != null) partial.symbol = cleanText(partial.symbol, 24);
    if (partial.name != null) partial.name = cleanText(partial.name, 80);
    if (!/^(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{6,64})$/.test(String(partial.address || ''))) return TL.blank(partial.chain || 'solana', String(partial.address || '')); // an address with anything but letters and digits never enters the store (it would end up in links and ids)
    var id = partial.chain + ':' + partial.address;
    var t = store.tokens[id];
    var fresh = false;
    if (!t) { t = TL.blank(partial.chain, partial.address); store.tokens[id] = t; store._list = null; store._rev = (store._rev || 0) + 1; fresh = true; }
    if (!fresh && partial.logo && partial.logo !== t.logo && !t.logoOk) { t.logoFailed = false; t.logoRacedAt = 0; t._picNext = 0; } // v1.42: a new picture address (GMGN's copy after the launchpad's) races at once; v2.10: so does the first one
    TL.merge(t, partial);
    indexToken(t);
    t._touched = U.now();
    if (fresh) { t._firstAt = U.now(); t._fresh = store.mode === 'live' && !!store._booted; if (store.mode === 'live') TL.dayLaunch(t); } // _firstAt: when this browser first saw it, whatever its age
    if (!fresh && TL.ui && TL.ui.markDirty) TL.ui.markDirty(t); // any new number redraws the row on the next tick
    return t;
  };
  // keep the store bounded: the stream alone adds thousands of tokens an hour. Oldest untouched go first; watchlist, selection and pending stay.
  store.evict = function (keepIds) {
    var byChain = { solana: [], robinhood: [] };
    store.all().forEach(function (t) { if (byChain[t.chain]) byChain[t.chain].push(t); });
    var removed = 0;
    Object.keys(byChain).forEach(function (chain) {
      var list = byChain[chain]; if (list.length <= store.CAP) return;
      list.sort(function (a, b) { return (a._touched || 0) - (b._touched || 0) || (a.createdAt || 0) - (b.createdAt || 0); });
      for (var i = 0; i < list.length && list.length - removed > store.CAP; i++) {
        var t = list[i];
        if (keepIds && keepIds[t.id]) continue;
        if (t._fresh || (U.now() - (t._touched || 0)) < 30 * SEC) continue;
        store.remove(t.id); removed++;
      }
    });
    return removed;
  };
  TL.safeLink = function (kind, v) {
    var s = String(v == null ? '' : v).trim(); if (!s || /[\s"'<>]/.test(s)) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(x\.com|twitter\.com|t\.me|www\.)\//i.test(s) || /^(x\.com|twitter\.com|t\.me)\b/i.test(s) || /^www\./i.test(s)) return 'https://' + s;
    if (kind === 'x' && /^@?[A-Za-z0-9_]{1,15}$/.test(s)) return 'https://x.com/' + s.replace(/^@/, '');
    return null;
  };
  TL.merge = function (t, p) {
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (v === undefined) return;
      if (k === 'vol' || k === 'tx' || k === 'chg' || k === 'socials' || k === 'dev' || k === 'source' || k === 'simulated') {
        t[k] = t[k] || {};
        Object.keys(v).forEach(function (kk) {
          if (v[kk] === undefined || v[kk] === null) return;
          var val = k === 'socials' ? TL.safeLink(kk, v[kk]) : v[kk]; // links from token metadata open in the browser: http(s) only, never javascript: or data:
          if (val === null) return;
          t[k][kk] = val;
        });
      } else if (v !== null || t[k] === undefined) t[k] = v;
    });
    if (t.complete) t.curve = null; // a migrated token has left the curve whatever an older source says
    t.ready = (U.isNum(t.createdAt) || !!t.top) && (U.isNum(t.mc) || U.isNum(t.curve));
    t._rev = (t._rev || 0) + 1; // any new data makes the last verdict stale
  };
  store.recompute = function () {
    var now = U.now();
    var all = store.all().filter(function (t) { t.ready = (U.isNum(t.createdAt) || !!t.top) && (U.isNum(t.mc) || U.isNum(t.curve)); return t.ready; });
    all.forEach(function (t) { TL.vet(t, now); }); // copycat radar, stage, score and the gate in one pass
    store.pulse = TL.computePulse(all, now);
    store._rev = (store._rev || 0) + 1;
    store.listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  };
  store.onChange = function (f) { store.listeners.push(f); };
  // ---------- local cache: the feed is full the moment the page opens, then live sources refresh it ----------
  var CACHE_KEY = 'tl.cache2', /* v1.29: a new key, so peaks recorded from the misread curves of earlier builds do not survive the update */ CACHE_FIELDS = ['chain', 'address', 'name', 'symbol', 'logo', 'launchpad', 'quote', 'createdAt', 'graduatedAt', 'complete', 'curve', 'mc', 'price', 'liq', 'holders', 'holdersDelta1h', 'vol', 'tx', 'chg', 'dev', 'socials', 'pair', 'mintAuth', 'freezeAuth', 'lpLocked', 'top10', 'uri', 'curveInfo', 'poolInfo', 'launchTx', 'lastTradeAt', 'priceSol', 'top', 'tags', 'holdersSrc', 'description', 'postGone', 'checkedAt', 'circPct', 'organic', 'sus', 'devInit', 'upgradeable',
    'rugRatio', 'wash', 'honeypot', 'ratPct', 'sniperPct', 'bundlePct', 'insiderPct', 'sniperCount', 'botRate', 'freshRate', 'smart', 'cto', 'dexPaid', 'xFollowers', 'tax', 'gmgnAt', 'gmgnSeenAt', 'gmgnList', 'gmgnPad', 'topAt', 'topSrc', 'exchange', 'walletTags', 'devAth', 'athMc', 'athAt', 'mcFirst', 'runner', 'runnerAt', 'top10Src', 'liqSrc', 'supply', 'liqPeak', 'capSrc', 'peakX', 'curvePeak'];
  var WATCH_KEY = 'tl.watchcache2';
  function pack(t) {
    var o = {}; CACHE_FIELDS.forEach(function (k) { if (t[k] !== undefined && t[k] !== null) o[k] = t[k]; });
    var raw = TL.rawWindows(t); // never cache a window we derived: after a reload it would look like a measured number
    if (Object.keys(raw.vol).length) o.vol = raw.vol; else delete o.vol;
    if (Object.keys(raw.tx).length) o.tx = raw.tx; else delete o.tx;
    return o;
  }
  store.save = function () {
    try {
      var watch = (TL.ui && TL.ui.state && TL.ui.state.watch) || {};
      var list = store.all().filter(function (t) { return !t.demo && !t.partial && t.ready; }).sort(function (a, b) { return (watch[b.id] ? 1 : 0) - (watch[a.id] ? 1 : 0) || (b._touched || 0) - (a._touched || 0); }).slice(0, 900);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: U.now(), tokens: list.map(pack) }));
      // starred tokens are kept apart, with no expiry, so the watchlist is still there days later
      var starred = store.all().filter(function (t) { return watch[t.id] && !t.demo; }).map(pack);
      if (starred.length || localStorage.getItem(WATCH_KEY)) localStorage.setItem(WATCH_KEY, JSON.stringify({ at: U.now(), tokens: starred }));
    } catch (e) {}
  };
  store.load = function () {
    var n = 0;
    function adopt(p, at) { if (!p.chain || !p.address) return; p.cached = true; p.source = { core: 'cached' }; if (!p.checkedAt && at) p.checkedAt = at; store.upsert(p); n++; } // cached numbers were complete when saved
    try { var w = JSON.parse(localStorage.getItem(WATCH_KEY) || 'null'); if (w && Array.isArray(w.tokens)) w.tokens.forEach(function (p) { adopt(p, w.at); }); } catch (e) {}
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (!c || !Array.isArray(c.tokens) || U.now() - c.at > 12 * HR) return n;
      c.tokens.forEach(function (p) { if (TL.trusted(p)) adopt(p, c.at); }); // a cache written before the launchpad rule may still hold letsbonk & co
    } catch (e) {}
    return n;
  };

  // ---------- market pulse ----------
  TL.META = [
    { key: 'ai', label: 'AI', re: /\b(ai|agent|gpt|neural|compute|llm|robot|bot)\b/i },
    { key: 'cat', label: 'Cats', re: /\b(cat|kitty|kitten|meow)\b/i },
    { key: 'dog', label: 'Dogs', re: /\b(dog|doge|pup|puppy|shib|inu|wif)\b/i },
    { key: 'frog', label: 'Frogs', re: /\b(frog|pepe|toad)\b/i },
    { key: 'politics', label: 'Politics', re: /\b(trump|maga|biden|putin|elon|musk|president|vance)\b/i },
    { key: 'stocks', label: 'Stocks', re: /\b(nvda|tsla|aapl|iren|stock|ipo|nasdaq|spy|wallstreet|wall street)\b/i },
    { key: 'anime', label: 'Anime', re: /\b(waifu|anime|senpai|chan|neko)\b/i },
    { key: 'space', label: 'Space', re: /\b(moon|mars|rocket|space|orbit|gravity|star)\b/i },
    { key: 'money', label: 'Money', re: /\b(money|cash|rich|bank|budget|benjamin|gold|pay)\b/i },
    { key: 'fly', label: 'Flies', re: /\b(fly|flies|swarm|bug)\b/i },
    { key: 'perps', label: 'DeFi', re: /\b(perp|perps|dex|swap|lend|borrow|yield|pad|launch)\b/i }
  ];
  TL.metaOf = function (t) {
    var text = (t.name || '') + ' ' + (t.symbol || '');
    return TL.META.filter(function (m) { return m.re.test(text); }).map(function (m) { return m.key; });
  };
  TL.computePulse = function (all, now) {
    var out = {};
    ['solana', 'robinhood'].forEach(function (chain) {
      var list = all.filter(function (t) { return t.chain === chain; });
      var last1h = list.filter(function (t) { return U.isNum(t.createdAt) && now - t.createdAt <= HR; });
      var last24 = list.filter(function (t) { return U.isNum(t.createdAt) && now - t.createdAt <= DAY; });
      var grad24 = last24.filter(function (t) { return t.complete || U.isNum(t.graduatedAt) || t.stage === 'graduated' || t.stage === 'trending' || t.stage === 'fading'; });
      var ttg = list.map(function (t) { return U.isNum(t.graduatedAt) && U.isNum(t.createdAt) ? t.graduatedAt - t.createdAt : null; });
      var deadish = list.filter(function (t) { return t.stage === 'dead' || t.stage === 'fading'; });
      var life = deadish.map(function (t) { return U.isNum(t.createdAt) ? (U.isNum(t.lastTradeAt) ? t.lastTradeAt : now) - t.createdAt : null; });
      var rug = list.filter(function (t) { return t.dev.sold === true || (U.isNum(t.bundlePct) && t.bundlePct > 0.25) || (t.dev.launches >= 5 && !(t.dev.graduated > 0)); });
      var meta = {};
      list.forEach(function (t) { if (!U.isNum(t.createdAt) || now - t.createdAt > 6 * HR) return; TL.metaOf(t).forEach(function (k) { meta[k] = (meta[k] || 0) + 1; }); });
      var metaList = Object.keys(meta).map(function (k) { return { key: k, label: TL.META.filter(function (m) { return m.key === k; })[0].label, n: meta[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
      out[chain] = {
        n: list.length, launches1h: last1h.length,
        gradRate: last24.length ? grad24.length / last24.length : null,
        medianTtg: U.median(ttg), medianLife: U.median(life),
        rugShare: list.length ? rug.length / list.length : null,
        rugKnown: list.filter(function (t) { return t.dev.sold !== null || U.isNum(t.bundlePct) || U.isNum(t.dev.launches); }).length,
        meta: metaList,
        vol1h: list.reduce(function (a, t) { return a + (U.isNum(t.vol.h1) ? t.vol.h1 : 0); }, 0)
      };
    });
    return out;
  };

  // ---------- demo / snapshot expansion ----------
  TL.loadDemo = function (chain) {
    var D = window.TL_DEMO; if (!D) return [];
    var now = U.now();
    var list = chain === 'solana' ? D.SOL : D.HOOD;
    var out = [];
    list.forEach(function (s) {
      var r = U.rng(chain + s.address);
      var t = TL.blank(chain, s.address);
      t.name = s.name; t.symbol = s.symbol; t.demo = !!s.demo; t.partial = !!s.partial; t.checkedAt = now; // a snapshot carries its full record
      t.launchpad = s.launchpad || (chain === 'solana' ? 'pump.fun' : 'pons');
      t.quote = s.quote || (chain === 'solana' ? 'SOL' : 'ETH'); t.tax = s.tax != null ? s.tax : null;
      t.createdAt = now - s.ago * 1000;
      t.graduatedAt = s.graduated != null ? now - s.graduated * 1000 : null;
      t.top = !!s.top; if (t.top) t.topAt = now; // preview Top list: fictional coins a week to a few months old (live: Jupiter lists / Blockscout token list)
      t.complete = s.graduated != null;
      t.curve = s.graduated != null ? null : (s.curve != null ? s.curve : 0);
      t.mc = s.mc; t.fdv = s.mc;
      t.liq = s.liq != null ? s.liq : (s.graduated != null ? s.mc * (0.12 + r() * 0.25) : s.mc * (0.5 + r() * 0.3));
      t.price = s.mc / 1e9;
      var vol24 = s.vol24 != null ? s.vol24 : s.mc * (0.2 + r() * 2.5);
      var ageH = Math.max(0.02, s.ago / 3600);
      var v1 = s.vol1 != null ? s.vol1 : (s.dead ? 0 : Math.min(vol24, vol24 / Math.max(1, Math.min(24, ageH)) * (0.6 + r() * 1.2)));
      t.vol = { m5: s.vol5 != null ? s.vol5 : (s.dead || s.stalled ? 0 : v1 * (0.05 + r() * 0.2)), h1: v1, h6: s.vol6 != null ? s.vol6 : Math.min(vol24, v1 * (2 + r() * 3)), h24: vol24 };
      var tx24 = s.tx24 != null ? s.tx24 : Math.round(vol24 / Math.max(20, 15 + r() * 120));
      var b24 = s.buys24 != null ? s.buys24 : Math.round(tx24 * (s.fading || s.dead ? 0.35 + r() * 0.1 : 0.5 + r() * 0.2));
      var s24 = s.sells24 != null ? s.sells24 : tx24 - b24;
      var tx1 = s.dead ? 0 : Math.max(0, Math.round(tx24 / Math.max(1, Math.min(24, ageH)) * (0.7 + r() * 0.6)));
      var b1 = Math.round(tx1 * (s.fading || s.dead ? 0.3 : (s.trend ? 0.66 : 0.5 + r() * 0.2)));
      var tx5 = s.dead || s.stalled ? 0 : Math.round(tx1 * (0.04 + r() * 0.16));
      t.tx = { m5: { b: Math.round(tx5 * 0.6), s: tx5 - Math.round(tx5 * 0.6) }, h1: { b: b1, s: tx1 - b1 }, h6: { b: Math.round(b24 * 0.5), s: Math.round(s24 * 0.5) }, h24: { b: b24, s: s24 } };
      var c24 = s.chg24 != null ? s.chg24 : (s.graduated != null ? (s.trend ? 40 + r() * 400 : (s.dead ? -70 - r() * 25 : -30 + r() * 120)) : (s.ago < 120 ? 20 + r() * 250 : -40 + r() * 200));
      t.chg = { m5: s.dead || s.stalled ? 0 : (r() - 0.45) * 30, h1: s.dead ? 0 : (s.trend ? 10 + r() * 60 : (r() - 0.5) * 60), h6: s.chg6 != null ? s.chg6 : c24 * (0.4 + r() * 0.5), h24: c24 };
      t.holders = s.holders != null ? s.holders : Math.round(3 + r() * 40);
      t.holdersDelta1h = s.dead ? -Math.round(r() * 10) : Math.round(t.holders * (s.trend ? 0.3 : 0.05 + r() * 0.2));
      var top10 = s.simTop10 != null ? s.simTop10 : (s.graduated != null ? 0.12 + r() * 0.22 : 0.1 + r() * 0.3);
      t.top10 = top10; t.simulated.top10 = s.simTop10 != null || !s.holders;
      var rest = 1 - top10; var m1130 = rest * (0.25 + r() * 0.15), m3150 = rest * (0.12 + r() * 0.1);
      t.dist = { top10: top10, t11_30: m1130, t31_50: m3150, rest: rest - m1130 - m3150 };
      t.mintAuth = chain === 'solana' ? false : null; t.freezeAuth = chain === 'solana' ? false : null;
      t.lpLocked = s.graduated != null ? true : (t.launchpad === 'pump.fun' || t.launchpad === 'pons' ? true : null);
      t.dev = { address: s.creator || ('0xdev' + U.hash(s.address).toString(16)), pct: s.simDevPct != null ? s.simDevPct : (s.graduated != null ? r() * 0.03 : 0.005 + r() * 0.07), sold: s.simDevSold != null ? s.simDevSold : (s.fading || s.dead ? r() > 0.4 : r() > 0.94),
        launches: s.simDevLaunches != null ? s.simDevLaunches : Math.round(1 + r() * 3), graduated: s.simDevGrad != null ? s.simDevGrad : (r() > 0.6 ? 1 : 0), rugs: s.simDevRugs != null ? s.simDevRugs : (r() > 0.7 ? 1 : 0) };
      t.simulated.dev = true;
      t.sniperPct = s.simSniper != null ? s.simSniper : (s.trend ? 0.05 + r() * 0.1 : r() * 0.24); t.simulated.sniper = true;
      t.bundlePct = s.simBundle != null ? s.simBundle : (s.trend ? r() * 0.06 : r() * 0.16); t.simulated.bundle = true;
      t.insiderPct = r() * 0.15; t.simulated.insider = true;
      t.socials = { x: s.x || null, tg: s.tg || null, web: s.web || null };
      t.xAge = s.x ? (s.trend ? 120 + Math.round(r() * 600) : Math.round(r() * 40)) : null; t.simulated.xAge = true;
      t.replies = s.replies != null ? s.replies : (chain === 'solana' ? Math.round(r() * 30) : null);
      t.smart = { wallets: s.simSmart != null ? s.simSmart : Math.round(r() * 2), kols: s.simKols != null ? s.simKols : 0, flow1h: s.fading || s.dead ? -1 : (r() > 0.5 ? 1 : 0) }; t.simulated.smart = true;
      t.logo = s.logo || (window.TL_LOGOS && window.TL_LOGOS[s.symbol]) || TL.demoLogo(s.address, s.symbol); // v2.10: the preview has a picture for every token too
      t.pair = s.pair || (s.graduated != null ? 'pool-' + s.address : null);
      t._trend = !!s.trend; t._fading = !!s.fading; t._dead = !!s.dead; t._stalled = !!s.stalled;
      t.lastTradeAt = s.dead ? now - (6 + r() * 20) * HR : now - r() * 5 * MIN;
      t.source = { core: 'snapshot ' + D.snapshotAt };
      t.events = TL.demoEvents(t, s, r, now);
      t.series = TL.demoSeries(t, r);
      out.push(t);
    });
    return out;
  };
  TL.demoEvents = function (t, s, r, now) {
    var ev = [{ t: t.createdAt, type: 'launch', tone: '', text: 'Launched on ' + t.launchpad + (t.dev.address ? ' by ' + U.short(t.dev.address) : '') }];
    if (U.isNum(t.sniperPct) && t.sniperPct > 0.15) ev.push({ t: t.createdAt + 400, type: 'snipe', tone: 'warn', text: U.pct0(t.sniperPct) + ' of supply sniped in the first block' + (t.bundlePct > 0.1 ? ', ' + U.pct0(t.bundlePct) + ' from one funding source' : ''), sim: true });
    if (t.smart && t.smart.wallets) ev.push({ t: t.createdAt + (2 + r() * 20) * MIN, type: 'smart', tone: 'good', text: t.smart.wallets + ' smart wallet' + (t.smart.wallets > 1 ? 's' : '') + ' entered' + (t.smart.kols ? ', ' + t.smart.kols + ' KOL' : ''), sim: true });
    if (U.isNum(t.curve) && t.curve >= 0.7) ev.push({ t: now - r() * 30 * MIN, type: 'curve', tone: '', text: 'Curve crossed 70%, graduating' });
    if (U.isNum(t.graduatedAt)) ev.push({ t: t.graduatedAt, type: 'grad', tone: 'good', text: 'Graduated to ' + (t.chain === 'solana' ? 'PumpSwap' : 'Uniswap v4 (Pons hook)') + ', liquidity locked' });
    if (t.dev.sold) ev.push({ t: (t.graduatedAt || t.createdAt) + (5 + r() * 40) * MIN, type: 'devsold', tone: 'bad', text: 'Dev wallet sold', sim: true });
    if (t._fading || t._dead) ev.push({ t: now - (1 + r() * 3) * HR, type: 'fade', tone: 'bad', text: 'Volume collapsed, price ' + U.fmtPct(t.chg.h24) + ' in 24h' });
    return ev.sort(function (a, b) { return a.t - b.t; });
  };
  TL.demoSeries = function (t, r) {
    var n = 60, out = [], p = 1;
    var drift = t._trend ? 0.012 : (t._fading || t._dead ? -0.02 : 0.002);
    var vol = t.curve != null ? 0.06 : 0.035;
    for (var i = 0; i < n; i++) { p = Math.max(0.05, p * (1 + drift + (r() - 0.5) * vol)); out.push(p); }
    var last = out[n - 1] || 1; var scale = (t.price || 1) / last;
    var now = U.now();
    return out.map(function (v, i) { return { t: now - (n - i) * 5 * MIN, c: v * scale }; });
  };

  return TL;
})();
