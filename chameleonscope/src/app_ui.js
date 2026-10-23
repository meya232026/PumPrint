/* Trenchlight feed prototype v0.2 - simplified UI: one network at a time, plain-language rows, light detail panel */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store, S = TL.sources, H = TL.HELP;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var ui = TL.ui = {};

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('tl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tl.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  var state = ui.state = {
    net: LS.get('net', 'solana'), tab: 'trenches', group: 'new', q: '', watchOnly: false, qOnly: false, /* v2.20: the quantum narrative's coins, any stage */
    win: LS.get('win', 'h1'), // time window for the change and volume columns and the Volume / Gainers sorts: m5, h1, h6, h24
    // one sort per feed tab, remembered: New by time, Almost bonded and Migrated by market cap (biggest first)
    sortBy: Object.assign({ new: 'feed', almost: 'feed', graduated: 'feed', top: 'feed' }, LS.get('sortBy', {})), // 'feed' is the tab's own order: potential first
    f: defaultFilters(),
    page: null, dayOpen: false, watch: LS.get('watch', {}), theme: LS.get('theme', 'auto'), limit: 100, pending: 0, hovering: false, lastTouch: 0, hiddenByQuality: 0,
    alerts: LS.get('alerts', 'on') === 'off' ? 'off' : 'on', // v1.41: call cards on the site, one switch turns them off
    topAge: [7, 30, 90, 180].indexOf(LS.get('topAge2', 30)) >= 0 ? LS.get('topAge2', 30) : 30, feedScrollY: 0, navFromFeed: false, pageFromFeed: false // Top: max age in days (30 / 90 / 180); where the feed was when a token page opened
  };
  function defaultFilters() { return { mcMin: 0, mcMax: 0, ageMin: 0, ageMax: 0, holdersMin: 0, volMin: 0, buysMin: 0, liqMin: 0, txMin: 0, curveMin: 0, curveMax: 0, devMax: 0, top10Max: 0, kwIn: '', kwOut: '', strict: false, socials: false, originals: false }; }
  // Three feeds, named as on GMGN: New by launch time, Almost bonded by curve progress (from 15%, or GMGN's near-completion list), Migrated
  // (bonded within the last day) by market cap. Dead tokens drop out of every feed; the watchlist is a toggle on top of them, not a fourth feed.
  var AGE_TXT = { 7: 'a week', 30: 'a month', 90: 'three months', 180: 'six months' };
  var onCurve = function (t) { return !t.complete && t.stage !== 'dead' && (U.isNum(t.curve) || t.gmgnList === 'new_creation' || t.gmgnList === 'near_completion'); };
  var GROUPS = [
    { key: 'new', label: 'New', hint: 'every fresh launch on the curve', test: onCurve, sort: byNewest },
    { key: 'almost', label: 'Almost bonded', hint: 'curve at least 15% filled', test: function (t) { return onCurve(t) && ((U.isNum(t.curve) && t.curve >= 0.15) || (!U.isNum(t.curve) && t.gmgnList === 'near_completion')); }, sort: byBonding },
    { key: 'graduated', label: 'Migrated', hint: 'bonded within the last 24 hours, trading in a pool', test: function (t) { if (!t.complete || t.stage === 'dead') return false; var since = U.isNum(t.graduatedAt) ? t.graduatedAt : t.createdAt; return U.isNum(since) ? U.now() - since <= TL.DAY : true; }, sort: function (a, b) { var sa = U.isNum(a.graduatedAt) ? a.graduatedAt : (a.createdAt || 0), sb = U.isNum(b.graduatedAt) ? b.graduatedAt : (b.createdAt || 0); return sb - sa; } },
    // Top: the most traded young memecoins over the cap, a day old up to the chosen age (GMGN rank with a key; Jupiter lists / Blockscout without)
    { key: 'top', label: 'Top', hint: function () { var cap = TL.TOP_MIN_MC[state.net] || 1e6; return 'most traded memecoins over $' + (cap >= 1e6 ? cap / 1e6 + 'M' : cap / 1e3 + 'K') + ', a day to ' + (AGE_TXT[state.topAge] || state.topAge + ' days') + ' old'; }, test: function (t) { return !!t.top && topAgeOk(t); }, sort: byNewest }
  ];
  function byNewest(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }
  // Almost bonded answers one question: what is about to bond. Its own order is the curve, fullest first.
  function byBonding(a, b) { return (U.isNum(b.curve) ? b.curve : -1) - (U.isNum(a.curve) ? a.curve : -1) || (b.mc || 0) - (a.mc || 0); }
  // the feed's own order used to be the potential score; it is still one click away in the sort menu
  function byPotential(tie) { return function (a, b) { return (b._pot || 0) - (a._pot || 0) || tie(a, b); }; }
  function hintOf(g) { return typeof g.hint === 'function' ? g.hint() : g.hint; }
  function sortFor(group) { return state.sortBy[group || state.group] || 'feed'; }
  // Top age: at least a day (the first day lives in Migrated), at most the chosen week / 1 / 3 / 6 months. A Robinhood token whose creation
  // time is still loading counts as young only for 6M: the chain itself launched less than six months ago (block 1 is from late April 2026).
  function topAgeOk(t) {
    if (!U.isNum(t.createdAt)) return t.chain === 'robinhood' && state.topAge >= 180;
    var d = (U.now() - t.createdAt) / TL.DAY; return d >= TL.TOP_MIN_AGE / TL.DAY && d <= state.topAge;
  }
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.85 6.05 6.65.85-4.9 4.6 1.3 6.6L12 17.6l-5.9 3.3 1.3-6.6-4.9-4.6 6.65-.85z"/></svg>';
  var CHART_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5l3.5-4 3 2.5L14 4"/><path d="M10.5 4H14v3.5"/></svg>';
  function groupDef(key) { return GROUPS.filter(function (g) { return g.key === key; })[0] || GROUPS[0]; }

  // ---------- logos (v2.10: pictures first) ----------
  // A list shows a token only once its picture has loaded (TL.pics in app_core loads them in the background, before the row exists),
  // so a row is drawn with its picture already in the browser's cache. A single token opened on purpose (its page, the chart, a search
  // result) is drawn at once, with a soft shimmer where the picture lands a moment later.
  var PICS = TL.pics, loadedSrc = PICS.loaded;
  function logoHtml(t, eager) {
    var hue = U.hue(t.address);
    var src = t.logoOk || (t.demo || t.partial ? TL.logoCandidates(t)[0] : null);
    var img = '<img alt="" data-id="' + U.esc(t.id) + '"' + (src ? ' src="' + U.esc(src) + '"' + (loadedSrc[src] || t.demo || t.partial ? ' class="ready"' : '') : '') + ' decoding="async" referrerpolicy="no-referrer"' + (eager ? ' fetchpriority="high"' : '') + '>';
    return '<span class="logo' + (src ? '' : ' wait') + '" style="--h:' + hue + '"><span class="fallback" aria-hidden="true"></span>' + img + '</span>';
  }
  function raceLogo(t) { if (t) PICS.want(t, true); }
  function bindLogo(imgEl) {
    if (!imgEl) return;
    var id = imgEl.getAttribute('data-id'), t = store.get(id) || PICS.ghosts[id];
    var ok = function () { imgEl.classList.add('ready'); imgEl.parentNode && imgEl.parentNode.classList.remove('wait'); var s = imgEl.getAttribute('src'); loadedSrc[s] = 1; if (t && !t.logoOk && S.markLogoOk) { t.logoOk = s; S.markLogoOk(t, s); } };
    if (imgEl.getAttribute('src')) {
      if (imgEl.complete && imgEl.naturalWidth > 0) ok();
      imgEl.onload = ok;
      imgEl.onerror = function () { var was = imgEl.getAttribute('src'); imgEl.removeAttribute('src'); imgEl.classList.remove('ready'); if (imgEl.parentNode) imgEl.parentNode.classList.add('wait'); if (t) PICS.lost(t, was); };
      return;
    }
    if (t && !t.demo && !t.partial) raceLogo(t);
  }
  // a picture arrived: the lists that were waiting for it take the token in, and an open page shows it
  PICS.on(function (t) {
    if (t.ghost) { $$('.logo img[data-id="' + CSS.escape(t.id) + '"]').forEach(function (im) { im.setAttribute('src', t.logoOk); bindLogo(im); }); ui.scheduleStrips && ui.scheduleStrips(); return; }
    ui.invalidate();
    $$('.logo img[data-id="' + CSS.escape(t.id) + '"]').forEach(function (im) { if (!im.getAttribute('src')) { im.setAttribute('src', t.logoOk); bindLogo(im); } });
    if (t.chain === state.net) {
      if (ui.offer) ui.offer(t);
      if (state.waitPic && state.tab === 'trenches' && !state.page) ui.scheduleRender(); // any list still waiting for pictures (Top, Almost bonded, Migrated) takes the token in at the next redraw (at most one per 1.5 s)
      if (ui.scheduleStrips) ui.scheduleStrips();
    }
  });
  ui.preloadLogos = function () {};
  // v1.41: the same picture pipeline for every other screen (the Smart Tracking token card, the wallet page): render, then bind
  ui.logoHtml = logoHtml;
  // v2.10: the small picture of a token named in a list of events (a known trader's buy, a wallet's trade): the token's own picture once
  // loaded, a shimmer until then; the events themselves are never held back for it
  ui.miniLogo = function (r) { var t = r && r.address ? PICS.of({ id: r.chain + ':' + r.address, chain: r.chain, address: r.address, symbol: r.symbol, logo: r.logo || null }) : null; if (t && !PICS.has(t)) PICS.want(t); return t ? logoHtml(t, false).replace('class="logo', 'class="logo mini') : ''; };
  ui.bindLogos = function (node) { $$('.logo img[data-id]', node || document).forEach(function (im) { if (!im.classList.contains('ready')) bindLogo(im); }); };

  // ---------- rows ----------
  function stageBar(t) {
    var label, right, fill, cls = 'bar', tick = '';
    if (U.isNum(t.curve) && !t.complete) {
      fill = t.curve; label = t.curve >= 0.7 ? 'Bonding soon' : t.curve >= 0.15 ? 'Almost bonded' : 'New'; right = U.pct0(t.curve);
      tick = '<span class="tick" style="left:70%"></span>';
    } else if (!t.complete) {
      fill = t.gmgnList === 'near_completion' ? 0.75 : 0.05; label = t.gmgnList === 'near_completion' ? 'Almost bonded' : 'New'; right = 'on the curve';
      tick = '<span class="tick" style="left:70%"></span>';
    } else {
      var since = U.isNum(t.graduatedAt) ? U.now() - t.graduatedAt : null;
      fill = since != null ? U.clamp(since / TL.DAY, 0.04, 1) : 1; cls += ' post';
      label = t.stage === 'trending' ? 'Trending' : t.stage === 'fading' ? 'Fading' : t.stage === 'dead' ? 'Dead' : 'Migrated';
      right = since != null ? U.fmtAge(since) + ' ago' : 'in pool';
    }
    return '<span class="stage" data-help="stage"><span class="stage-name"><b>' + label + '</b><span>' + right + '</span></span><span class="' + cls + '"><i style="width:' + (fill * 100).toFixed(1) + '%"></i>' + tick + '</span></span>';
  }
  function warningsHtml(t) {
    var w = TL.flags(t);
    var shown = w.slice(0, 2).map(function (x) { return '<span class="warn ' + (x.hard ? '' : 'soft') + '" data-help="' + x.key + '">' + x.label + '</span>'; });
    if (w.length > 2) shown.push('<span class="muted" title="' + U.esc(w.slice(2).map(function (x) { return x.label; }).join(', ')) + '">+' + (w.length - 2) + '</span>');
    if (!w.length) {
      var checked = [t.mintAuth !== null, t.lpLocked !== null, U.isNum(t.top10), U.isNum(t.bundlePct), U.isNum(t.dev.pct), U.isNum(t.dev.launches)].filter(Boolean).length;
      shown.push(checked >= 3 ? '<span class="ok" data-help="safety">No red flags</span>' : '<span class="muted" data-help="safety">' + (checked ? 'Nothing bad so far' : 'Not checked yet') + '</span>');
    }
    return shown.join('');
  }
  // GMGN-style quick facts under the name: dev / snipers / bundle / top-10 shares with traffic-light colours, socials, X search, copy CA
  var ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.2 8.3L23.2 22h-6.6l-5.2-6.8L5.5 22H2.3l7.7-8.8L1.9 2h6.8l4.7 6.2L18.9 2zm-1.2 18.1h1.8L7.1 3.8H5.2l12.5 16.3z"/></svg>',
    tg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.1 18.7 19.6c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.5-.6-.2L6.2 13.3 1.4 11.8c-1-.3-1-1 .2-1.5L20.4 3c.9-.3 1.6.2 1.5 1.1z"/></svg>',
    web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'
  };
  var QF_ICONS = {
    dev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    sniper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
    bundle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="8" height="8" rx="1.5"/><rect x="13" y="12" width="8" height="8" rx="1.5"/><rect x="8" y="3" width="8" height="8" rx="1.5"/></svg>',
    top10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>'
  };
  var QF_NAMES = { dev: 'Dev holds', sniper: 'Snipers hold', bundle: 'Bundled wallets hold', top10: 'Top 10 wallets hold' };
  function quickFacts(t) {
    function m(key, val, warnAt, badAt) {
      var cls = !U.isNum(val) ? 'na' : warnAt == null ? 'neutral' : val >= badAt ? 'bad' : val >= warnAt ? 'warn' : 'ok';
      var sim = U.isNum(val) && t.simulated && t.simulated[key];
      return '<span class="qf ' + cls + '" data-help="' + key + '" title="' + QF_NAMES[key] + (U.isNum(val) ? ' ' + U.pct0(val) : ': unknown') + '">' + QF_ICONS[key] + (U.isNum(val) ? U.pct0(val) : '–') + (sim ? '<em>~</em>' : '') + '</span>';
    }
    var R = TL.RISK, devCap = t.complete ? R.devPool : R.devCurve;
    var out = m('dev', t.dev.pct, devCap / 2, devCap) + m('sniper', t.sniperPct, 0.15, R.sniper) + m('bundle', t.bundlePct, 0.15, R.bundle) + (TL.spread(t) || t.top ? m('top10', TL.top10eff(t), 0.35, R.top10) : m('top10', TL.top10eff(t), null, null));
    if (t.dev.sold === true) out += '<span class="qf bad" data-help="devsold">Dev sold</span>';
    return '<span class="facts-line">' + out + '</span>';
  }
  function quickLinks(t) {
    if (t.demo || t.partial) return '';
    var links = '';
    if (t.socials.x) links += '<span class="ql" role="link" data-href="' + U.esc(t.socials.x) + '" title="X account">' + ICONS.x + '</span>';
    if (t.socials.tg) links += '<span class="ql" role="link" data-href="' + U.esc(t.socials.tg) + '" title="Telegram">' + ICONS.tg + '</span>';
    if (t.socials.web) links += '<span class="ql" role="link" data-href="' + U.esc(t.socials.web) + '" title="Website">' + ICONS.web + '</span>';
    links += '<span class="ql" role="link" data-href="https://x.com/search?q=' + encodeURIComponent(t.address) + '&f=live" title="Search this contract on X">' + ICONS.search + '</span>';
    links += '<button class="ql" data-act="copy" title="Copy contract address">' + ICONS.copy + '</button>';
    return '<span class="qlinks">' + links + '</span>';
  }
  // the creator's or community's X handle, taken from the token's X link (x.com/<handle> or a tweet link)
  function xHandle(t) {
    var u = t.socials && t.socials.x; if (!u) return null;
    var m = String(u).match(/(?:x\.com|twitter\.com)\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i); if (!m) return null;
    var h = m[1]; if (/^(i|home|search|intent|share|hashtag|explore|login|signup|status)$/i.test(h)) return null;
    return h;
  }
  // GMGN-style mini price path: the last 40 points of the token's series, coloured by direction
  function sparkHtml(t) {
    var src = (t.series && t.series.length ? t.series : t.live) || []; if (src.length < 3) return '';
    var pts = src.slice(-40).map(function (x) { return x.c; }).filter(U.isNum); if (pts.length < 3) return '';
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts); var span = hi - lo || 1;
    var W = 62, H = 20; var d = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i * W / (pts.length - 1)).toFixed(1) + ' ' + (H - 2 - (v - lo) / span * (H - 4)).toFixed(1); }).join('');
    var up = pts[pts.length - 1] >= pts[0];
    return '<svg class="spark ' + (up ? 'up' : 'down') + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  // the token's X link in the row: @handle, plus "post" when it points at a post (hover shows the text) or "community"
  function xLinkHtml(t, handle) {
    var u = t.socials && t.socials.x; if (!u) return '';
    var isPost = S.tweetRef && !!S.tweetRef(u); var isCommunity = /\/i\/communities\//i.test(u);
    if (isPost) { var c = S.tweetCached(u); return '<span class="handle post' + (c && c.gone ? ' gone' : '') + '" role="link" data-href="' + U.esc(u) + '" data-post="' + U.esc(u) + '">' + (handle ? '@' + U.esc(handle) : 'post') + '<i>' + (c && c.gone ? 'deleted' : 'post') + '</i></span>'; }
    if (isCommunity) return '<span class="handle" role="link" data-href="' + U.esc(u) + '" title="X community">community</span>';
    return handle ? '<span class="handle" role="link" data-href="https://x.com/' + U.esc(handle) + '" title="X account from the token page">@' + U.esc(handle) + '</span>' : '';
  }
  function rowHtml(t, eager) {
    var age = U.isNum(t.createdAt) ? U.fmtAgeLive(U.now() - t.createdAt) : '–';
    var handle = xHandle(t);
    var chg = t.chg[state.win], chgCls = U.isNum(chg) ? (chg > 0 ? 'up' : chg < 0 ? 'down' : '') : ''; var wl = WIN_LABEL[state.win] || '1H';
    var tx = t.tx[state.win];
    var big = t.runner && U.isNum(t.peakX) && t.peakX >= 2;
    return '<a class="row' + (t._fresh ? ' fresh' : '') + (big ? ' isrun' : '') + '" href="' + ui.tokenHref(t) + '" data-id="' + U.esc(t.id) + '">' +
      '<span class="cell logo-col">' + logoHtml(t, eager) + (t.demo || t.partial ? '<span class="addr-mini muted">' + U.esc(U.short(t.address)) + '</span>' : '<button class="addr-mini" data-act="copy" title="' + U.esc(t.address) + ' · click to copy">' + U.esc(U.short(t.address)) + '</button>') + '</span>' +
      '<span class="cell ident"><span class="name-line"><span class="sym">' + U.esc(t.symbol || '?') + '</span><span class="nm">' + U.esc(t.name) + '</span>' + (t.demo ? '<span class="tag demo" title="fictional example">demo</span>' : '') + quickLinks(t) + '</span>' +
      '<span class="meta-line">' + U.ageSpan(t.createdAt) + runHtml(t) + callFlagHtml(t) + knownFlagHtml(t) + quantumFlagHtml(t) + '<span class="qbadge" title="paired with ' + U.esc(t.quote || '') + '">' + U.esc(t.quote || '') + '</span>' + xLinkHtml(t, handle) + warningsHtml(t) + '</span>' + quickFacts(t) + '</span>' +
      '<span class="cell stage-cell">' + stageBar(t) + '</span>' +
      (t.curveInfo && !U.isNum(t.mc) ? '<span class="cell mc" data-help="curve"><span class="k">Raised</span><span class="v num">' + (t.curveInfo.ethPair && U.isNum(t.curveInfo.raised) ? (t.curveInfo.raised / 1e18).toFixed(3) + ' ETH' : U.pct0(t.curve)) + '</span></span>' :
      '<span class="cell mc" data-help="mc"><span class="k">Market cap</span><span class="v num">' + U.fmtUsd(t.mc) + '</span></span>') +
      '<span class="cell liq" data-help="liq"><span class="k">Liquidity</span><span class="v num">' + U.fmtUsd(t.liq) + '</span></span>' +
      '<span class="cell hold" data-help="holders"><span class="k">Holders</span><span class="v num">' + U.fmtNum(t.holders) + (holderDelta(t) > 0 ? ' <small>+' + holderDelta(t) + '</small>' : '') + '</span></span>' +
      '<span class="cell chg" data-help="chg"><span class="k">' + wl + '</span><span class="v num ' + chgCls + '">' + U.fmtPct(chg, 0) + '</span>' + sparkHtml(t) + '</span>' +
      '<span class="cell vol" data-help="vol"><span class="k">Volume ' + wl + '</span><span class="v num">' + volTxt(t, state.win) + '</span></span>' +
      '<span class="cell txns" data-help="tx"><span class="k">Txns ' + wl + '</span><span class="v num">' + txTxt(t, state.win) + '</span></span>' +
      '<span class="cell"><span class="verdict ' + t.verdict + '" data-help="verdict">' + t.verdict + '</span></span>' +
      '<span class="cell acts"><button class="btn chart-open" data-act="chart" title="Open the chart">' + CHART_SVG + '<span>Chart</span></button>' +
      '<button class="star" data-act="watch" aria-pressed="' + (!!state.watch[t.id]) + '" title="' + (state.watch[t.id] ? 'In your watchlist. Click to remove' : 'Add to watchlist') + '">' + STAR_SVG + '</button></span>' +
      '</a>';
  }

  // ---------- filtering & sorting ----------
  function baseMatch(t) {
    if (t.chain !== state.net || !t.ready) return false;
    if (state.watchOnly) return !!state.watch[t.id]; // the watchlist toggle shows what you starred, whatever the stage
    if (state.qOnly) return !!(TL.quantum && TL.quantum.match(t) && TL.quantum.trusted(t) && TL.checked(t)); // v2.20: the quantum view looks through every stage, with the radar's rule for where a coin may come from
    if (!TL.trusted(t)) return false; // pump.fun launches only on Solana (Pons on Robinhood Chain); Top keeps established coins whatever their launchpad
    if (!TL.checked(t)) return false; // not checked yet (no Jupiter record / wallet positions): a launch never shows before its risks are known
    if (!state.q && !groupDef(state.group).test(t)) return false; // a search looks through every stage
    return true;
  }
  function passes(t) { TL.ensureVet(t); return state.f.strict ? t._okStrict : t._ok; } // a verdict older than the token's data or 5 s is recomputed first
  function matches(t) { return baseMatch(t) && (state.watchOnly || passes(t)) && extra(t) && PICS.has(t); } /* v2.10: and its picture has loaded */ // the watchlist view shows what you starred; every feed applies the gate to everyone
  function kwList(s) { return String(s || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); }
  function searchMatch(t) {
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return (t.name || '').toLowerCase().indexOf(q) >= 0 || (t.symbol || '').toLowerCase().indexOf(q) >= 0 || (t.address || '').toLowerCase().indexOf(q) >= 0;
  }
  function extra(t) {
    if (state.watchOnly && !state.q) return true; // the watchlist shows everything you starred, filters do not apply to it
    var f = state.f;
    if (f.mcMin > 0 && (!U.isNum(t.mc) || t.mc < f.mcMin)) return false;
    if (f.mcMax > 0 && U.isNum(t.mc) && t.mc > f.mcMax) return false;
    var age = U.isNum(t.createdAt) ? (U.now() - t.createdAt) / 1000 : null;
    if (f.ageMin > 0 && (age == null || age < f.ageMin)) return false;
    if (f.ageMax > 0 && age != null && age > f.ageMax) return false;
    if (f.holdersMin > 0 && (!U.isNum(t.holders) || t.holders < f.holdersMin)) return false;
    if (f.volMin > 0 && (!U.isNum(t.vol.h1) || t.vol.h1 < f.volMin)) return false;
    if (f.buysMin > 0 && (!t.tx.h1 || (t.tx.h1.b || 0) < f.buysMin)) return false;
    if (f.liqMin > 0 && (!U.isNum(t.liq) || t.liq < f.liqMin)) return false;
    if (f.txMin > 0 && (!t.tx.h1 || !U.isNum(t.tx.h1.b) || (t.tx.h1.b + (t.tx.h1.s || 0)) < f.txMin)) return false;
    if (f.curveMin > 0 && !(U.isNum(t.curve) && t.curve * 100 >= f.curveMin) && !(t.complete && f.curveMin <= 100)) return false;
    if (f.curveMax > 0 && (t.complete || (U.isNum(t.curve) && t.curve * 100 > f.curveMax))) return false;
    if (f.devMax > 0 && U.isNum(t.dev.pct) && t.dev.pct * 100 > f.devMax) return false;
    var t10 = TL.top10eff(t); if (f.top10Max > 0 && U.isNum(t10) && t10 * 100 > f.top10Max) return false;
    if (f.socials && !(t.socials.x || t.socials.tg || t.socials.web)) return false;
    if (f.originals && t.clones.length && !t.firstOfName) return false;
    var text = ((t.name || '') + ' ' + (t.symbol || '')).toLowerCase();
    var kin = kwList(f.kwIn); if (kin.length && !kin.some(function (k) { return text.indexOf(k) >= 0; })) return false;
    var kout = kwList(f.kwOut); if (kout.length && kout.some(function (k) { return text.indexOf(k) >= 0; })) return false;
    return searchMatch(t);
  }
  function watchSort(a, b) { return (state.watch[b.id] || 0) - (state.watch[a.id] || 0) || (b.createdAt || 0) - (a.createdAt || 0); }
  var WIN_LABEL = { m5: '5M', h1: '1H', h6: '6H', h24: '24H' };
  // a window carried up from a shorter one is a floor, not a measurement: say so with a >= instead of pretending it is exact
  function fmtX(x) { return !U.isNum(x) ? '' : x >= 1000 ? Math.round(x / 100) / 10 + 'k' : x >= 10 ? Math.round(x) + '' : x.toFixed(1); }
  // a token that already multiplied: the peak it reached against the cap we first saw
  function runHtml(t) {
    if (!U.isNum(t.athMc)) return '';
    var seen = t.peakXSeen !== false && U.isNum(t.peakX) && t.peakX >= 2; // the multiple is claimed only when this browser watched the launch
    if (!seen && !t.runner) return '';
    var x = seen ? fmtX(t.peakX) : null;
    var now = U.isNum(t.mc) && t.athMc > 0 ? t.mc / t.athMc : null;
    var ttl = 'Peak ' + U.fmtUsd(t.athMc) + (seen ? ' \u00b7 ' + x + 'x from first sight' : ' \u00b7 reached before tracking began') + (now !== null ? ' \u00b7 now ' + Math.round(now * 100) + '% of peak' : '');
    if (t.runner) return '<span class="runflag" title="' + U.esc(ttl) + '">' + (seen ? '<b>' + x + 'x</b>' : '<b>ran</b>') + '<small>' + U.fmtUsd(t.athMc) + '</small></span>';
    return '<span class="tag run" title="' + U.esc(ttl) + '">' + x + 'x</span>';
  }
  // ---------- calls: the terminal's own picks, at the cap they were made at ----------
  var CALL_STATUS = { open: ['open', ''], hit: ['hit', 'ok'], runner: ['runner', 'good'], rugged: ['rugged', 'bad'], faded: ['faded', 'warn'], flat: ['flat', ''] };
  function callFlagHtml(t) {
    var CL = TL.calls, rec = CL ? CL.forToken(t) : null; if (!rec) return '';
    var st = CALL_STATUS[rec.status] || CALL_STATUS.open;
    var x = U.isNum(rec.nowX) ? CL.fmtX(rec.nowX) : '';
    return '<span class="callflag ' + st[1] + '" title="' + U.esc('Called ' + U.fmtAge(U.now() - rec.at) + ' ago · ' + CL.words(rec)) + '"><b>CALL</b>' + (x ? '<small>' + x + '</small>' : '') + '</span>';
  }
  // v1.48: the known traders inside a token (their buys in the last 24 hours from GMGN's KOL feed): the best-known name, and how many more
  function knownFlagHtml(t) {
    var K = TL.known, b = K ? K.rowBadge(t) : null; if (!b) return '';
    return '<span class="knownflag ' + (b.tier || '') + '" title="' + U.esc(b.title) + '">🐋 ' + U.esc(b.label) + '</span>';
  }
  ui.knownFlagHtml = knownFlagHtml;
  // v2.20: a coin on the quantum narrative (src/app_quantum.js) says so in its row, with the word it is on it by
  function quantumFlagHtml(t) { var w = TL.quantum ? TL.quantum.match(t) : null; return w ? '<span class="qflag" title="' + U.esc('On the quantum narrative: \u00ab' + w + '\u00bb in its name') + '">\u269b\ufe0e ' + U.esc(w) + '</span>' : ''; }
  ui.quantumFlagHtml = quantumFlagHtml;
  // the record on the token's page: the moment of the call, the peak since, where it is now
  function pageCallHtml(t) {
    var CL = TL.calls, rec = CL ? CL.forToken(t) : null; if (!rec) return '';
    var st = CALL_STATUS[rec.status] || CALL_STATUS.open;
    var head = rec.status === 'rugged' ? 'Called, then it rugged' : rec.status === 'runner' ? 'Called before it ran' : rec.status === 'hit' ? 'Called before it doubled' : rec.status === 'faded' ? 'Called, it faded' : 'Called';
    // v1.42: the record is history; what the token reads now is a separate fact, said in the same card so the page never contradicts itself
    var nowBad = t.verdict === 'AVOID' || t.verdict === 'RUGGED';
    var after = nowBad && rec.status !== 'rugged' ? '<div class="tc-after">' + (rec.status === 'runner' || rec.status === 'hit' ? 'The run is done: it reads <b>' + U.esc(t.verdict) + '</b> now' : 'It reads <b>' + U.esc(t.verdict) + '</b> now') + (t._hide ? ' (' + U.esc(t._hide) + ')' : '') + '. Not an entry.</div>' : '';
    return '<div class="tp-call ' + st[1] + '" title="' + U.esc(rec.history ? 'History at the call: ' + rec.history : '') + '"><span class="tc-ico" aria-hidden="true">🦎</span><div class="tc-body"><b>' + head + (rec.kind === 'breakout' ? ' on a breakout' : rec.kind === 'bond' ? ' after it bonded' : '') + '</b> at <b class="num">' + U.fmtUsd(rec.mc) + '</b> <span data-born="' + rec.at + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - rec.at) + ' ago</span>' + (U.isNum(rec.gradAt) && rec.at > rec.gradAt ? ', ' + Math.round((rec.at - rec.gradAt) / TL.MIN) + ' min after graduation' : '') + (U.isNum(rec.pot) ? ' · potential ' + rec.pot + ' · ' + U.esc(rec.verdict || '') : '') +
      '<div class="tc-line">' + (U.isNum(rec.peakX) && rec.peakX >= 1.05 ? 'peak since <b class="num">' + U.fmtUsd(rec.peakMc) + '</b> (<b class="' + (rec.peakX >= 2 ? 'up' : '') + '">' + CL.fmtX(rec.peakX) + '</b>) · ' : '') + 'now <b class="num">' + U.fmtUsd(rec.nowMc) + '</b>' + (U.isNum(rec.nowX) ? ' (<b class="' + (rec.nowX >= 1 ? 'up' : 'down') + '">' + CL.fmtX(rec.nowX) + '</b>)' : '') + (rec.demo ? ' <span class="tag demo">demo</span>' : rec.src === 'server' ? ' <small class="muted">from the call journal</small>' : '') + '</div>' + after + '</div>' +
      '<span class="status-pill ' + st[1] + '">' + st[0] + '</span></div>';
  }
  // v2.10: the calls showcase. What Chameleon called on this network in the last 24 hours and how far each one went, the freshest open
  // calls first, then the best by their peak. A rugged call is counted in the line above the cards (never hidden from the numbers) but is
  // not a card. A day without calls shows the best of the week instead of an empty strip. A card appears with its picture or not at all.
  var KIND_LABEL = { bond: 'bond', breakout: 'breakout' };
  function callCardHtml(r, i) {
    var CL = TL.calls, s = CALL_STATUS[r.status] || CALL_STATUS.open, t = PICS.of(r);
    if (!PICS.has(t)) { PICS.want(t, true); return ''; }
    var peak = U.isNum(r.peakX) && r.peakX >= 1.05 ? r.peakX : null, nowX = U.isNum(r.nowX) ? r.nowX : null;
    var big = peak || nowX || 1, fresh = U.now() - r.at < 15 * TL.MIN;
    var fill = peak && nowX ? U.clamp(nowX / peak, 0.03, 1) : 1;
    return '<a class="cc ' + s[1] + (fresh ? ' fresh' : '') + (big >= 2 ? ' won' : '') + '" href="' + ui.tokenHref({ chain: r.chain, address: r.address }) + '" title="' + U.esc(CL.words(r)) + '">' +
      '<span class="rc-logo">' + logoHtml(t, i < 4) + '</span>' +
      '<span class="cc-b"><b>' + U.esc(r.symbol || U.short(r.address)) + (fresh ? '<i class="cc-new">new</i>' : '') + '</b>' +
        '<small>at ' + U.fmtUsd(r.mc) + ' · <span data-born="' + r.at + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - r.at) + ' ago</span></small>' +
        '<small class="cc-kind">' + U.esc(KIND_LABEL[r.kind] || 'call') + (r.status !== 'open' ? ' · ' + s[0] : '') + '</small></span>' +
      '<span class="cc-x ' + (big >= 1 ? 'up' : 'down') + '">' + CL.fmtX(big) + '<small>' + (peak ? 'peak' : 'now') + '</small></span>' +
      '<span class="cc-bar" title="now ' + (nowX ? CL.fmtX(nowX) : '–') + ' of the peak"><i style="width:' + Math.round(fill * 100) + '%"></i></span></a>';
  }
  function callStripHtml() {
    var CL = TL.calls; if (!CL) return '';
    var st = CL.stats(state.net, TL.DAY), wk = CL.stats(state.net, 7 * TL.DAY);
    var notif = ('Notification' in window) ? (Notification.permission === 'granted' ? '<span class="chip on" title="Browser notifications are on for calls">🔔 on</span>' : Notification.permission === 'denied' ? '' : '<button class="chip" id="notifyBtn" title="Get a browser notification for every call, even when this tab is in the background">🔔 Notify me</button>') : '';
    if (state.alerts === 'off') notif = '<button class="chip" id="alertsChip" title="Call cards are off on this site; click to turn them on">🔕 cards off</button>'; // v1.41
    var NAMES = { solana: 'Solana', robinhood: 'Robinhood Chain' };
    var show = function (r) { return r.status !== 'rugged' && r.status !== 'faded'; };
    var day = CL.recent(state.net, 200, TL.DAY).filter(show);
    var freshOpen = day.filter(function (r) { return U.now() - r.at < 2 * TL.HR && r.status === 'open'; });
    var rest = CL.best(state.net, 60, TL.DAY).filter(function (r) { return show(r) && freshOpen.indexOf(r) < 0; });
    var rows = freshOpen.concat(rest), week = false;
    if (!rows.length) { rows = CL.best(state.net, 60, 7 * TL.DAY).filter(function (r) { return show(r) && U.isNum(r.peakX) && r.peakX >= 1.3; }); week = true; }
    var cards = '', shown = 0;
    for (var i = 0; i < rows.length && shown < 14; i++) { var c = callCardHtml(rows[i], shown); if (c) { cards += c; shown++; } }
    var line;
    if (st.calls) line = st.calls + ' call' + (st.calls === 1 ? '' : 's') + ' in 24h · ' + st.hits + ' did 2x+' + (st.best && U.isNum(st.best.peakX) && st.best.peakX >= 1.5 ? ' · best ' + CL.fmtX(st.best.peakX) : '') + (st.rugged ? ' · ' + st.rugged + ' rugged' : '');
    else line = 'none in 24h on ' + NAMES[state.net] + (wk.calls ? ' · ' + wk.calls + ' this week, best ' + CL.fmtX(wk.best && wk.best.peakX || 1) : '');
    var empty = '<span class="cs-empty muted">Chameleon calls a token when it bonds and keeps its strength, or breaks out again with money behind it. ' + (CL.list.length ? 'Waiting for the next one on ' + NAMES[state.net] + '.' : 'The journal is loading.') + '</span>';
    return '<div class="callstrip' + (week ? ' week' : '') + '"><span class="cs-lead"><b>Calls</b><small>' + U.esc(line) + '</small>' + (week && shown ? '<small class="cs-week">best of the week</small>' : '') + notif + '</span><div class="cs-track">' + (shown ? cards : empty) + '</div></div>';
  }
  // v1.42: the picture of a call this browser never saw as a token (a record from the data service): the same candidates, tried one after another
  function recLogoHtml(r) { var g = PICS.of(r); if (g) return logoHtml(g, false);
    var initials = U.esc((r.symbol || r.name || '?').replace(/[^A-Za-z0-9$]/g, '').slice(0, 3).toUpperCase() || '?');
    var cands = r.logo ? TL.logoCandidates({ chain: r.chain, address: r.address, logo: r.logo, symbol: r.symbol }) : TL.logoCandidates({ chain: r.chain, address: r.address, symbol: r.symbol });
    var first = cands[0] || '';
    return '<span class="logo" style="--h:' + U.hue(r.address) + '"><span class="fallback">' + initials + '</span>' + (first ? '<img alt="" class="rec' + (loadedSrc[first] ? ' ready' : '') + '" src="' + U.esc(first) + '" data-cands="' + U.esc(JSON.stringify(cands.slice(0, 6))) + '" data-i="0" decoding="async" referrerpolicy="no-referrer">' : '') + '</span>';
  }
  document.addEventListener('load', function (ev) { var im = ev.target; if (im && im.tagName === 'IMG' && im.classList.contains('rec')) { im.classList.add('ready'); loadedSrc[im.getAttribute('src')] = 1; } }, true);
  document.addEventListener('error', function (ev) {
    var im = ev.target; if (!im || im.tagName !== 'IMG' || !im.classList.contains('rec')) return;
    var cands = []; try { cands = JSON.parse(im.getAttribute('data-cands') || '[]'); } catch (e) {}
    var i = (+im.getAttribute('data-i') || 0) + 1;
    if (i < cands.length) { im.setAttribute('data-i', String(i)); im.setAttribute('src', cands[i]); } else im.remove();
  }, true);
  // a call lands as a card in the corner: symbol, the cap it is called at, the score, one click to the token
  var burst = { at: 0, n: 0, shown: false };
  ui.alert = function (rec, kind, x) {
    var box = $('#alerts'); if (!box || !rec) return;
    var CL = TL.calls;
    // v1.41: no cards when the person switched them off, and none over the BTC Machine, Course and Poly Smart tabs: a call belongs to the
    // Trenches and Smart Tracking screens, the record is in the Calls strip whenever they come back
    if (state.alerts === 'off' || (state.tab !== 'trenches' && state.tab !== 'xray')) return;
    // the first pass after boot can call several launches at once: two cards, then one line for the rest, never a wall
    if (kind === 'call') {
      var now = U.now(); if (now - burst.at > 4000) { burst.at = now; burst.n = 0; burst.shown = false; }
      burst.n++;
      if (burst.n > 2) {
        var more = box.querySelector('.al.more');
        if (!more) { more = document.createElement('a'); more.className = 'al more'; more.href = '#/'; box.appendChild(more); setTimeout(function () { more.classList.add('out'); setTimeout(function () { more.remove(); }, 400); }, 12000); }
        more.innerHTML = '<span class="al-t">\uD83E\uDD8E ' + (burst.n - 2) + ' more call' + (burst.n - 2 === 1 ? '' : 's') + '</span><span class="al-b">all of them in the Calls strip above the feed</span>';
        return;
      }
    }
    var K = TL.known, addr = kind === 'whale' ? rec.token : rec.address; // v1.48: a known trader's buy points at the token
    var title = kind === 'whale' ? (rec.watched ? '★ ' : '🐋 ') + rec.name + ' bought ' + U.fmtUsd(rec.usd) + ' of ' + (rec.symbol || U.short(addr)) : kind === 'rug' ? '💀 RUGGED · ' + (rec.symbol || U.short(rec.address)) : kind === 'milestone' ? '🏃 ' + CL.fmtX(x) + ' · ' + (rec.symbol || U.short(rec.address)) : '🦎 ' + (rec.kind === 'breakout' ? 'BREAKOUT CALL' : 'CALL') + ' · ' + (rec.symbol || U.short(rec.address));
    var body = kind === 'whale' ? (rec.unknownToken ? 'a token the feed does not show' : 'at ' + U.fmtUsd(rec.mc) + ' cap') + ' · ' + (rec.watched ? 'your trader' : (K && K.TIER[rec.tier] ? K.TIER[rec.tier][0] : 'known trader')) + (rec.firstBuy ? ' · new position' : ' · adding') + (rec.verdict ? ' · ' + rec.verdict : '') + (rec.others && rec.others.length ? ' · also inside: ' + rec.others.map(function (o) { return o.name; }).join(', ') : '') :
      kind === 'call' ? 'at ' + U.fmtUsd(rec.mc) + ' cap' + (U.isNum(rec.gradAt) && rec.at > rec.gradAt ? ', ' + U.fmtAge(rec.at - rec.gradAt) + ' after it bonded' : '') + ' · potential ' + (U.isNum(rec.pot) ? rec.pot : '–') + ' · ' + (rec.verdict || '') + (U.isNum(rec.holders) ? ' · ' + rec.holders + ' holders' : '') : CL.words(rec); // v1.47: a call comes after graduation, and the card says how long after
    var el = document.createElement('a');
    el.className = 'al ' + kind + (rec.demo ? ' demo' : ''); el.href = ui.tokenHref({ chain: rec.chain, address: addr });
    el.innerHTML = '<span class="al-t">' + U.esc(title) + (rec.demo ? ' <span class="tag demo">demo</span>' : '') + '</span><span class="al-b">' + U.esc(body) + '</span><button class="al-x" type="button" aria-label="Dismiss">✕</button>';
    el.querySelector('.al-x').addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); el.remove(); });
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild.remove();
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, kind === 'call' ? 16000 : 12000);
    if (kind !== 'whale' || rec.watched || (K && K.prefs.notify)) ui.notify(title, body, el.href); // v1.49: a known trader's buy rings the browser only when asked
  };
  // the browser's own notification when the tab is in the background and the person asked for it
  ui.notify = function (title, body, href) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try { var n = new Notification(title, { body: body, tag: href, silent: false }); n.onclick = function () { try { window.focus(); location.hash = href.replace(/^[^#]*/, ''); n.close(); } catch (e) {} }; } catch (e) {}
  };
  function volTxt(t, k) { return (t._volMin && t._volMin[k] && U.isNum(t.vol[k]) ? '\u2265' : '') + U.fmtUsd(t.vol[k]); }
  function txTxt(t, k) { var x = t.tx[k]; if (!x || !U.isNum(x.b)) return '\u2013'; return (t._txMin && t._txMin[k] ? '\u2265' : '') + '<b class="up">' + U.fmtNum(x.b) + '</b> / <b class="down">' + U.fmtNum(x.s || 0) + '</b>'; }
  function winVol(t) { var v = t.vol[state.win]; return U.isNum(v) ? v : -1; }
  function winChg(t) { var v = t.chg[state.win]; return U.isNum(v) ? v : -Infinity; }
  var SORTS = {
    feed: null,
    best: function (a, b) { return (b._pot || 0) - (a._pot || 0) || (b.mc || 0) - (a.mc || 0); },
    new: function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); },
    hot: function (a, b) { return b.momentumKey - a.momentumKey; },
    safe: function (a, b) { return b.scores.safety - a.scores.safety || (b.createdAt || 0) - (a.createdAt || 0); },
    big: function (a, b) { return (b.mc || 0) - (a.mc || 0); },
    vol: function (a, b) { return winVol(b) - winVol(a) || (b.mc || 0) - (a.mc || 0); },
    gain: function (a, b) { return winChg(b) - winChg(a) || (b.mc || 0) - (a.mc || 0); },
    liq: function (a, b) { return (b.liq || 0) - (a.liq || 0); },
    holders: function (a, b) { return (b.holders || 0) - (a.holders || 0); }
  };
  var HIDDEN_TIP = 'Hidden: AVOID and RUGGED verdicts; rug signs (GMGN rug risk 30%+, honeypots, wash trading, dev 10%+ or 5% after migration, dev sold early, bundles, snipers or insiders 30%+, top 10 at 50%+, serial deployers, copy waves, mint or freeze authority); dead pools; launches nobody bought; tokens out of the live lists. 5M, 1H and 6H also hide tokens with no trades in the window. Strict quality hides CAUTION too.';
  function hiddenNoteText() {
    if (state.watchOnly) return '';
    var parts = [];
    if (state.hiddenByQuality) parts.push(state.hiddenByQuality + ' hidden');
    if (state.checking) parts.push(state.checking + ' being read');
    if (state.waitPic) parts.push(state.waitPic + ' loading pictures');
    return parts.join(' · ');
  }
  function hiddenNoteTitle() { // say exactly what the gate took out, so an empty feed is never a mystery
    var why = state.hiddenWhy || {};
    var top = Object.keys(why).sort(function (a, b) { return why[b] - why[a]; }).slice(0, 6)
      .map(function (r) { return why[r] + ' \u00b7 ' + r; });
    var head = state.checking ? state.checking + ' launches still being checked.\n\n' : '';
    return head + (top.length ? 'Hidden right now:\n' + top.join('\n') + '\n\n' : '') + HIDDEN_TIP;
  }
  var visCache = { at: 0, key: '', list: null };
  ui.visible = function () {
    var key = [state.net, state.group, sortFor(), state.win, state.watchOnly, state.qOnly, state.q, state.topAge, JSON.stringify(state.f), store._rev || 0, Object.keys(state.watch).length].join('|');
    if (visCache.list && visCache.key === key && U.now() - visCache.at < 800) return visCache.list;
    var all = store.all(), hidden = 0, checking = 0, why = {}, out = [], nowT = U.now(), waitPic = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (t.chain === state.net && t.ready && !t.demo && TL.trusted(t) && !TL.checked(t)) checking++; // the risk record has not landed yet: not hidden, just not read
      if (!baseMatch(t)) continue;
      if (!state.watchOnly && state.win !== 'h24' && TL.activeIn(t, state.win, nowT) === false) { // the window is a filter: what is not moving inside it is not part of this view
        hidden++; var wr = 'no trades in the last ' + (WIN_LABEL[state.win] || state.win); why[wr] = (why[wr] || 0) + 1; continue;
      }
      if (!state.watchOnly && !passes(t)) { // the gate is always on: AVOID and CAUTION, rug signs, dead and weak tokens never reach a feed, starred or not (the watchlist view still lists them)
        hidden++;
        var r = t._hide || (state.f.strict ? TL.strictReason(t) : '') || 'filtered';
        why[r] = (why[r] || 0) + 1;
        continue;
      }
      if (extra(t)) { if (PICS.has(t)) out.push(t); else waitPic.push(t); } /* v2.10: a token without its picture waits off the list while the picture loads */
    }
    state.hiddenByQuality = hidden; state.hiddenWhy = why; state.checking = checking; state.waitPic = waitPic.length;
    var order = (state.watchOnly ? watchSort : null) || (state.qOnly && sortFor() === 'feed' ? qSort : null) || SORTS[sortFor()] || groupDef(state.group).sort;
    out.sort(order);
    if (waitPic.length) { waitPic.sort(order); waitPic.slice(0, 120).forEach(function (t, i) { PICS.want(t, i < 30); }); }
    visCache = { at: U.now(), key: key, list: out };
    return out;
  };
  function qSort(a, b) { var Q = TL.quantum; return Q ? Q.heat(b) - Q.heat(a) || (b.mc || 0) - (a.mc || 0) : 0; } // v2.20: the quantum view, hottest first
  ui.invalidate = function () { visCache.list = null; };
  ui.visibleIds = function () { if (state.page) return [state.page]; return ui.visible().slice(0, 60).map(function (t) { return t.id; }); }; // an open token page gets the polling to itself
  // ---------- live inserts: a new launch lands at the top of the feed the moment it arrives, no button, no waiting ----------
  var insertQueue = [], insertTimer = null;
  // a token is offered when it becomes checked (Jupiter record, wallet positions, Blockscout holders), not when it is born
  ui.offer = function (t) {
    if (!t || !TL.checked(t)) return;
    t._pending = false; TL.vet(t);
    if (!PICS.has(t)) { if (t.chain === state.net && baseMatch(t) && passes(t)) PICS.want(t, true); return; } /* v2.10: it lands in the feed with its picture, never before */
    if (t.chain === state.net && state.tab === 'trenches' && state.group === 'new' && sortFor('new') === 'feed' && !state.watchOnly && !state.q && matches(t)) { if (insertQueue.indexOf(t) < 0) insertQueue.push(t); if (!insertTimer) insertTimer = setTimeout(flushInserts, 120); }
    else ui.scheduleRender();
  };
  ui.onStreamToken = ui.offer;
  function flushInserts() {
    insertTimer = null; var q = insertQueue; insertQueue = []; if (!q.length) return;
    var feed = $('#feed'); var tpl = document.createElement('div'); var added = 0;
    q.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }).forEach(function (t) {
      if (!matches(t) || feed.querySelector('.row[data-id="' + CSS.escape(t.id) + '"]')) return; // data may have changed in the last 120 ms
      var rows = feed.querySelectorAll('.row'), before = null;
      for (var i = 0; i < rows.length; i++) { var o = store.get(rows[i].dataset.id); if (!o || (o.createdAt || 0) <= (t.createdAt || 0)) { before = rows[i]; break; } }
      if (!before && rows.length >= state.limit) return; // older than everything on screen
      tpl.innerHTML = rowHtml(t, true); var el = tpl.firstElementChild; el.dataset.sig = rowSig(tpl.innerHTML); el.classList.add('arrive');
      var empty = feed.querySelector('.empty'); if (empty) empty.remove();
      if (before) feed.insertBefore(el, before); else feed.appendChild(el);
      bindLogo(el.querySelector('.logo img')); added++;
    });
    if (!added) return;
    var rows2 = $$('.row', feed); for (var j = rows2.length - 1; j >= state.limit; j--) rows2[j].remove();
    ui.invalidate(); ui.renderControls(); updateCounts();
  }
  function updateCounts() {
    var total = ui.visible().length; $('#feedCount').textContent = total + (total === 1 ? ' token' : ' tokens');
    var hn = $('#hiddenNote'); hn.textContent = hiddenNoteText(); hn.title = hiddenNoteTitle();
  }
  ui.logoArrived = function (t) {
    var row = $('.row[data-id="' + CSS.escape(t.id) + '"] .logo'); if (row) { var tpl = document.createElement('div'); tpl.innerHTML = logoHtml(t, true); row.replaceWith(tpl.firstElementChild); bindLogo($('.row[data-id="' + CSS.escape(t.id) + '"] .logo img')); }
    if (state.page === t.id) { var hl = $('#tpHead'); if (hl) { hl._sig = null; ui.renderToken(); } }
  };

  // ---------- context line ----------
  ui.renderContext = function () {
    var p = (store.pulse || {})[state.net] || {}; var el = $('#context');
    var name = state.net === 'solana' ? 'Solana' : 'Robinhood Chain';
    var mode = store.chainMode[state.net];
    var parts = ['<span class="lead">' + name + '</span>'];
    parts.push('<span><b>' + (p.launches1h != null ? p.launches1h : '\u2013') + '</b> launches / hour</span>');
    if (p.gradRate != null) parts.push('<span><b>' + Math.round(p.gradRate * 100) + '%</b> bonded today</span>');
    if (p.medianTtg != null) parts.push('<span>median <b>' + U.fmtAge(p.medianTtg) + '</b> to bond</span>');
    if (p.medianLife != null) parts.push('<span>dead token lifetime <b>' + U.fmtAge(p.medianLife) + '</b></span>');
    if (state.net === 'robinhood' && TL.sources && TL.sources.hood && TL.sources.hood.backlog) parts.push('<span class="catchup">catching up on the last hour\u2026</span>');
    el.innerHTML = parts.join('<span class="sep">·</span>') + '<span class="pills">' + (TL.gmgn && TL.gmgn.configured() && TL.gmgn.available() ? '<button class="status gm-pill" id="gmPill" title="GMGN source"><span class="dot"></span><span class="lbl"></span></button>' : '') + '<button class="status" id="modePill" title="Data sources and their state"><span class="dot"></span><span class="lbl"></span></button></span>';
    ui.renderStatus(); ui.renderGmgn(); ui.renderDay();
  };

  // ---------- today's runners ----------
  // The question the terminal exists to answer: out of everything that launched today, how many actually went anywhere.
  var stripTimer = null;
  ui.scheduleStrips = function () { if (stripTimer) return; stripTimer = setTimeout(function () { stripTimer = null; if (state.tab === 'trenches' && !state.page) ui.renderDay(); }, 1200); };
  ui.renderDay = function () {
    var el = $('#dayBar'); if (!el) return;
    var st = TL.dayStats(state.net), d = st.day, tiers = st.tiers;
    var live = st.live;
    var calls = callStripHtml();
    ui.renderQHero(); // v2.21: the quantum narrative has its own block at the top of the terminal
    if (!d.launches && !d.runners) { var any = !!(TL.calls && TL.calls.stats(state.net, TL.DAY).calls); el.hidden = !any; el.innerHTML = any ? calls : ''; return; } // nothing counted yet, but the journal may still have calls
    el.hidden = false;
    var pct = function (n, of) { return of > 0 ? (n / of * 100).toFixed(n / of >= 0.1 ? 0 : 1) + '%' : '–'; };
    var cap = function (v) { return v >= 1e6 ? '$' + (v / 1e6) + 'M' : '$' + Math.round(v / 1e3) + 'K'; };
    var oneIn = d.runners > 0 && d.launches > 0 ? Math.round(d.launches / d.runners) : null;
    var item = function (v, label, cls, title) { return '<span class="d-item' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + U.esc(title) + '"' : '') + '><b>' + v + '</b><span>' + label + '</span></span>'; };
    var parts = ['<span class="d-lead">Today</span>'];
    parts.push(item(U.fmtNum(d.launches), live ? 'launches watched' : 'launches', '', live ? 'Launches seen today on ' + (state.net === 'solana' ? 'Solana' : 'Robinhood Chain') : 'Launches in the preview flow'));
    parts.push(item(U.fmtNum(d.graduated) + ' <small>' + pct(d.graduated, d.launches) + '</small>', 'bonded', '', 'Bonded today'));
    parts.push(item(U.fmtNum(d.runners) + (oneIn ? ' <small>1 in ' + U.fmtNum(oneIn) + '</small>' : ''), 'runners', 'hot', 'Reached ' + cap(tiers[0]) + ' and 5x its starting cap'));
    parts.push(item(U.fmtNum(d.tiers[1] || 0), 'over ' + cap(tiers[1]), '', 'Peaked over ' + cap(tiers[1])));
    if (d.tiers[2]) parts.push(item(U.fmtNum(d.tiers[2]), 'over ' + cap(tiers[2])));
    var cleanList = TL.dayClean(d.list); if (d.best && !cleanList.some(function (r) { return r.id === d.best.id; })) d.best = cleanList[0] || null;
    if (d.best) {
      var b = d.best;
      parts.push('<span class="d-item best"><span>best</span><a href="' + ui.tokenHref({ chain: state.net, address: b.address }) + '"><b>' + U.esc(b.symbol || U.short(b.address)) + '</b></a>' +
        (U.isNum(b.x) ? '<b class="up">' + fmtX(b.x) + 'x</b>' : '') + '<small>' + U.fmtUsd(b.mc) + ' peak</small></span>');
    }
    var tail = '<span class="d-tail">' + (d.list && d.list.length ? '<button class="chip" id="dayToggle" aria-pressed="' + (!!state.dayOpen) + '">' + (state.dayOpen ? 'Hide runners ▴' : 'All runners ▾') + '</button>' : '') +
      (live && st.watchedMs ? '<small class="muted" title="Time the terminal was open today">open ' + U.fmtAge(st.watchedMs) + '</small>' : (live ? '' : '<small class="muted">preview flow</small>')) + '</span>';
    var list = state.dayOpen && cleanList.length ? '<div class="d-list">' + cleanList.map(function (r) {
      return '<a class="d-run" href="' + ui.tokenHref({ chain: state.net, address: r.address }) + '"><b>' + U.esc(r.symbol || U.short(r.address)) + '</b>' +
        (U.isNum(r.x) ? '<span class="up">' + fmtX(r.x) + 'x</span>' : '') + '<small>' + U.fmtUsd(r.mc) + '</small></a>';
    }).join('') + '</div>' : '';
    el.innerHTML = '<div class="d-row">' + parts.join('<span class="sep">·</span>') + tail + '</div>' + calls + runStripHtml(d) + list;
  };
  // v2.20, v2.21: the Quantum radar, the block at the very top of the terminal: the first thing anyone sees once in. The narrative's last
  // hour in four numbers (TL.quantum.index), then its coins, hottest first, each with its picture: the cap, the move in the last hour, the
  // money through it, how hot it runs next to the hottest one (the bar), the word it is on the narrative by. Its button turns the feed into
  // the narrative's coins (any stage, the same gate). On Robinhood Chain, while no coin there is on the narrative, one line points to Solana's
  var heroSig = '';
  ui.renderQHero = function () {
    var el = $('#qHero'); if (!el) return;
    var html = qHeroHtml(); if (html === heroSig) return;
    heroSig = html; el.hidden = !html; el.innerHTML = html;
    if (html && ui.bindLogos) ui.bindLogos(el);
  };
  function qHeroHtml() {
    var Q = TL.quantum; if (!Q || store.mode === 'demo' || store.mode === 'boot') return ''; // the preview flow has no narrative to scan
    var net = state.net, ix = Q.index(net), list = Q.list(net, 12), ico = '<span class="q-ico" aria-hidden="true">⚛︎</span>';
    if (net !== 'solana' && !ix.n) {
      var ns = Q.count('solana');
      return '<div class="qh-mini">' + ico + '<span><b>Quantum radar</b> The quantum narrative lives on Solana' + (ns ? ': <b>' + ns + ' coin' + (ns === 1 ? '' : 's') + '</b> moving there right now' : '') + '.</span><button class="chip" data-act="qSol">Open the Solana radar</button></div>';
    }
    var lead = ix.leader, top = list.length ? Q.heat(list[0]) : 0, dash = '–';
    var tile = function (cls, label, value, sub) { return '<div class="qh-k' + (cls ? ' ' + cls : '') + '"><span class="qh-l">' + label + '</span><b class="qh-v">' + value + '</b><span class="qh-s">' + sub + '</span></div>'; };
    var chg = ix.chg1h, chgCls = U.isNum(chg) ? (chg > 0 ? ' up' : chg < 0 ? ' down' : '') : '';
    var tiles = tile('hero', 'Traded in the last hour', ix.n ? U.fmtUsd(ix.vol1h) : dash, ix.n ? U.fmtUsd(ix.vol5m) + ' in the last 5 minutes' : 'across every coin on the narrative') +
      tile('move' + chgCls, 'Narrative move, 1h', U.isNum(chg) ? U.fmtPct(chg, 1) : dash, ix.withChg ? 'by volume · ' + ix.up + ' of ' + ix.withChg + ' up' : 'weighted by the money in each coin') +
      tile('', 'Coins moving', ix.n ? String(ix.n) : (Q.n ? '0' : dash), ix.fresh ? ix.fresh + ' born in the last hour' : 'on Solana, any launchpad, rugs out') +
      tile('lead', 'Leading', lead ? '<a href="' + ui.tokenHref(lead) + '">' + logoHtml(lead, true).replace('class="logo', 'class="logo mini') + U.esc(lead.symbol || U.short(lead.address)) + '</a>' : dash,
        lead ? (U.isNum(lead.chg && lead.chg.h1) ? U.fmtPct(lead.chg.h1, 0) + ' · ' : '') + U.fmtUsd(lead.vol && lead.vol.h1) + ' in 1h' : 'the hottest coin of the hour');
    var card = function (t, i) {
      var c1 = t.chg && t.chg.h1, cls = U.isNum(c1) ? (c1 > 0 ? 'up' : c1 < 0 ? 'down' : '') : '', w = Q.match(t), v1 = t.vol && U.isNum(t.vol.h1) ? t.vol.h1 : null;
      var heat = top > 0 ? Math.max(4, Math.round(Q.heat(t) / top * 100)) : 0;
      return '<a class="qc' + (i === 0 ? ' lead' : '') + '" href="' + ui.tokenHref(t) + '" title="' + U.esc((t.name || t.symbol || '') + ' · on the quantum narrative by «' + w + '» · cap ' + U.fmtUsd(t.mc) + ' · heat ' + heat + '% of the hottest') + '">' +
        '<span class="rc-logo">' + logoHtml(t, i < 6) + '</span>' +
        '<span class="qc-b"><b>' + U.esc(t.symbol || U.short(t.address)) + '</b><small class="qc-nm">' + U.esc(t.name || '') + '</small><small class="qc-word">' + U.esc(w) + '</small></span>' +
        '<span class="qc-n"><b class="num">' + U.fmtUsd(t.mc) + '</b><small class="num ' + cls + '">' + (U.isNum(c1) ? U.fmtPct(c1, 0) + ' 1h' : '&nbsp;') + '</small><small class="num">' + (v1 != null ? U.fmtUsd(v1) + ' 1h vol' : '&nbsp;') + '</small></span>' +
        '<span class="qc-heat" aria-hidden="true"><i style="width:' + heat + '%"></i></span></a>';
    };
    var empty = '<span class="qh-empty">' + (Q.n ? 'No quantum coin is moving on Solana right now. The radar keeps scanning the new launches and Jupiter every few minutes for quantum, quant, qubit, Q-Day and post-quantum.' : 'Scanning Solana for quantum, quant, qubit, Q-Day and post-quantum… the first coins land in a few seconds.') + '</span>';
    return '<div class="qh-head"><span class="qh-atom" aria-hidden="true"><i></i><i></i><i></i></span><div class="qh-title"><span class="qh-kicker"><i class="qh-live"></i>Live · the hottest narrative in the trenches</span><h2><span>Quantum radar</span></h2></div>' +
      (ix.n ? '<button class="chip q-all" data-act="qOnly" aria-pressed="' + !!state.qOnly + '">' + ico + (state.qOnly ? 'Back to the feed' : 'All ' + ix.n + ' in the feed') + '</button>' : '') + '</div>' +
      '<div class="qh-index">' + tiles + '</div>' +
      '<div class="qh-track">' + (list.length ? list.map(card).join('') : empty) + '</div>';
  }
  // Runners get the front row: every token the terminal called before it flew, with how far it went, live.
  // The strip is the proof of work, so it sits above the feed and not behind a toggle.
  function runStripHtml(d) {
    var rows = TL.dayClean(d.list).slice(0, 12);
    if (!rows.length) return '';
    var card = function (r, i) {
      var t = PICS.of({ id: r.id || state.net + ':' + r.address, chain: state.net, address: r.address, symbol: r.symbol, logo: r.logo });
      if (!PICS.has(t)) { PICS.want(t, true); return ''; } /* v2.10: a runner shows with its picture or waits */
      if (t.ghost) t = null;
      var live = t && U.isNum(t.mc) && U.isNum(r.mc) && r.mc > 0 ? t.mc / r.mc : null;
      var at = U.isNum(r.at) ? '<span class="rc-at" data-born="' + r.at + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - r.at) + ' ago</span>' : '';
      var pic = '<span class="rc-logo">' + logoHtml(t || PICS.of({ id: r.id || state.net + ':' + r.address, chain: state.net, address: r.address }), false) + '</span>';
      return '<a class="rc' + (i === 0 ? ' lead' : '') + '" href="' + ui.tokenHref({ chain: state.net, address: r.address }) + '" title="Peak ' + U.fmtUsd(r.mc) + (live !== null ? ' \u00b7 now ' + Math.round(live * 100) + '% of peak' : '') + '">' + pic +
        '<span class="rc-x">' + (U.isNum(r.x) ? fmtX(r.x) + '<i>x</i>' : U.fmtUsd(r.mc)) + '</span>' +
        '<span class="rc-b"><b>' + U.esc(r.symbol || U.short(r.address)) + '</b><small>' + U.fmtUsd(r.mc) + ' peak</small>' + at + '</span>' +
        (live !== null ? '<span class="rc-bar"><i style="width:' + Math.round(U.clamp(live, 0, 1) * 100) + '%"></i></span>' : '') + '</a>';
    };
    return '<div class="runstrip"><span class="rs-lead"><b>Runners</b><small>seen from launch today</small></span><div class="rs-track">' + rows.map(card).join('') + '</div></div>';
  }
  // ---------- controls ----------
  ui.renderControls = function () {
    var counts = {}; store.all().forEach(function (t) { if (t.chain !== state.net || !t.ready || !TL.trusted(t) || !TL.checked(t) || !passes(t)) return; GROUPS.forEach(function (g) { if (g.test(t)) counts[g.key] = (counts[g.key] || 0) + 1; }); });
    $('#stageChips').innerHTML = GROUPS.map(function (g) { return '<button class="chip" data-group="' + g.key + '" aria-pressed="' + (state.group === g.key && !state.watchOnly && !state.qOnly) + '" title="' + U.esc(hintOf(g)) + '">' + g.label + ' <span class="cnt">' + (counts[g.key] || 0) + '</span></button>'; }).join('');
    var nw = 0; store.all().forEach(function (t) { if (t.chain === state.net && state.watch[t.id]) nw++; });
    var qb = $('#qBtn'); if (qb) { var nq = TL.quantum ? TL.quantum.count(state.net) : 0; qb.setAttribute('aria-pressed', !!state.qOnly); qb.innerHTML = '<span class="q-ico" aria-hidden="true">\u269b\ufe0e</span>Quantum <span class="cnt">' + nq + '</span>' + (nq ? '<i class="q-hot">hot</i>' : ''); qb.title = state.qOnly ? 'Showing the quantum narrative\'s coins, any stage. Click to go back to the feeds' : 'Only the coins on the quantum narrative (' + nq + ' on this network now), any stage, hottest first'; } // v2.20
    var wb = $('#watchBtn'); wb.setAttribute('aria-pressed', !!state.watchOnly); wb.innerHTML = STAR_SVG + '<span class="cnt">' + nw + '</span>'; wb.title = state.watchOnly ? 'Showing your watchlist. Click to go back to the feeds' : 'Show only the tokens you starred (' + nw + ')';
    var SORT_TXT = { feed: 'newest first', best: 'most promising first', new: 'newest first', big: 'biggest market cap first', hot: 'trending first', vol: 'most volume (' + WIN_LABEL[state.win] + ') first', gain: 'top gainers (' + WIN_LABEL[state.win] + ') first', liq: 'deepest liquidity first', holders: 'most holders first', safe: 'safest first' };
    var FEED_TXT = { almost: 'closest to bonding first', graduated: 'latest to bond first', top: 'newest first', new: 'newest first' };
    var order = sortFor() === 'feed' ? (FEED_TXT[state.group] || 'newest first') : SORT_TXT[sortFor()];
    var winTxt = state.win === 'h24' ? '' : ', moving in the last ' + (WIN_LABEL[state.win] || state.win);
    $('#feedRule').textContent = state.watchOnly ? 'your watchlist, any stage' : state.qOnly ? 'the quantum narrative: quantum, qubit, Q-Day and the like in the name, any stage' + winTxt + (sortFor() === 'feed' ? ', hottest first' : (order ? ', ' + order : '')) : state.q ? 'search across all stages' : hintOf(groupDef(state.group)) + winTxt + (order ? ', ' + order : '');
    $$('#netSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.net === state.net); });
    document.documentElement.setAttribute('data-net', state.net); // the skin takes the colour of the chain on screen
    $('#sort').value = sortFor();
    var f = state.f, n = activeFilterCount();
    $('#filtersBtn').innerHTML = 'Filters' + (n ? ' <span class="badge">' + n + '</span>' : '');
    $$('#winSeg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.win === state.win ? 'true' : 'false'); });
    var ta = $('#topAge'); ta.hidden = state.group !== 'top' || state.watchOnly;
    $$('button', ta).forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.age === state.topAge ? 'true' : 'false'); });
  };

  // ---------- feed (keeps already loaded logos across re-renders) ----------
  function rowSig(html) { return html.replace(/(<span class="num age" data-born="\d+">)[^<]*(<\/span>)/, '$1$2').replace(' fresh"', '"'); }
  // Rendering budget: the feed is redrawn at most once per 1.5 s, rows are diffed by content, trade ticks patch single rows.
  var renderTimer = null, renderDeferred = false, lastRenderAt = 0, RENDER_GAP = 1500;
  ui.scheduleRender = function () {
    if (renderTimer) return;
    var wait = Math.max(150, RENDER_GAP - (U.now() - lastRenderAt));
    renderTimer = setTimeout(function () {
      renderTimer = null;
      if (state.hovering && U.now() - state.lastTouch < 1500) { renderDeferred = true; return; } // never reshuffle rows under a moving cursor
      ui.renderAll();
    }, wait);
  };
  setInterval(U.tickAges, 1000); // every age on the page moves once a second
  var LIVE_CELLS = ['.mc .v', '.liq .v', '.hold .v', '.chg .v', '.vol .v', '.txns .v', '.stage-cell .bar-wrap b'];
  function flashChanges(oldRow, newRow) {
    LIVE_CELLS.forEach(function (sel) {
      var a = oldRow.querySelector(sel), b = newRow.querySelector(sel);
      if (!a || !b) return;
      if (a.textContent.trim() !== b.textContent.trim()) b.classList.add('bump');
    });
  }
  var dirty = {};
  ui.markDirty = function (t) { dirty[t.id] = 1; };
  ui.sweep = function () {
    var feed = $('#feed'); if (!feed) return 0; var gone = 0;
    $$('.row', feed).forEach(function (el) { var t = store.get(el.dataset.id); if (t && matches(t)) return; el.remove(); gone++; });
    if (gone) { ui.invalidate(); ui.renderControls(); updateCounts(); if (!feed.querySelector('.row')) ui.renderFeed(); }
    return gone;
  };
  setInterval(function () {
    if (state.tab === 'trenches') ui.sweep(); // the gate never waits for a full render
    var ids = Object.keys(dirty); if (!ids.length) return; dirty = {};
    if (state.hovering && ids.length > 40) return;
    var feed = $('#feed'), tpl = document.createElement('div'); var n = 0;
    ids.forEach(function (id) {
      var el = feed.querySelector('.row[data-id="' + CSS.escape(id) + '"]'); var t = store.get(id); if (!el || !t) return;
      TL.vet(t);
      if (!matches(t)) { el.remove(); ui.invalidate(); ui.renderControls(); updateCounts(); return; }
      var html = rowHtml(t, true); var sig = rowSig(html); if (el.dataset.sig === sig) return;
      tpl.innerHTML = html; var nu = tpl.firstElementChild;
      var oldImg = el.querySelector('.logo img'), newImg = nu.querySelector('.logo img');
      if (oldImg && newImg && oldImg.getAttribute('src') === newImg.getAttribute('src') && oldImg.classList.contains('ready')) newImg.replaceWith(oldImg);
      flashChanges(el, nu); // the numbers that moved light up for a moment, so a still screen still looks alive
      nu.dataset.sig = sig; el.replaceWith(nu); bindLogo(nu.querySelector('.logo img')); n++;
    });
    var mid = $('#chartModal').dataset.tokenId; if (mid && ids.indexOf(mid) >= 0) { var mt = store.get(mid); if (mt) ui.refreshChartModal(mt); }
  }, 1000);
  // the open token page redraws every second whatever changed: price, cap, liquidity, windows, trades, verdict
  setInterval(function () { if (state.page && !document.hidden) ui.renderToken(); }, 1000);
  ui.renderFeed = function () {
    var list = ui.visible(); var feed = $('#feed');
    var total = list.length; var shown = list.slice(0, state.limit);
    $('#feedCount').textContent = total + (total === 1 ? ' token' : ' tokens');
    var hn = $('#hiddenNote'); hn.textContent = hiddenNoteText(); hn.title = hiddenNoteTitle();
    if (!shown.length) {
      var emptyWatch = state.watchOnly && !state.q;
      var checking = store.all().filter(function (t) { return t.chain === state.net && t.ready && !TL.checked(t) && TL.trusted(t); }).length;
      var msg = store.mode === 'boot' ? 'Connecting to data sources…' : emptyWatch ? 'Nothing starred on this network yet. Press the star on any token and it shows up here, whatever its stage.' : (state.group === 'top' && !state.q ? 'Loading the top list…' : (state.waitPic && !state.q ? 'Loading the pictures of ' + state.waitPic + ' token' + (state.waitPic === 1 ? '' : 's') + '. Each one shows up the moment its picture is in.' : checking && !state.q && activeFilterCount() === 0 ? 'Checking ' + checking + ' new launches. Only the ones without rug signs will show up here.' : 'Nothing here with these filters.'));
      feed.innerHTML = '<div class="empty">' + msg + (store.mode !== 'boot' && !emptyWatch ? ' <button class="btn" data-act="resetFilters" style="margin-left:8px">Reset filters</button>' : '') + '</div>';
      return;
    }
    var old = {}; $$('.row', feed).forEach(function (r) { old[r.dataset.id] = r; });
    var frag = document.createDocumentFragment(); var tpl = document.createElement('div'); var reused = 0;
    shown.forEach(function (t, i) {
      var html = rowHtml(t, i < 24); var sig = rowSig(html);
      var prev = old[t.id];
      if (prev && prev.dataset.sig === sig && !t._fresh) { frag.appendChild(prev); reused++; return; } // unchanged row: move the node, no re-parse, no image reload (the age ticks on its own)
      tpl.innerHTML = html;
      var el = tpl.firstElementChild; el.dataset.sig = sig;
      if (prev) {
        var oldImg = prev.querySelector('.logo img'), newImg = el.querySelector('.logo img');
        if (oldImg && newImg && oldImg.getAttribute('src') === newImg.getAttribute('src') && oldImg.classList.contains('ready')) newImg.replaceWith(oldImg);
      }
      bindLogo(el.querySelector('.logo img'));
      frag.appendChild(el);
    });
    if (total > shown.length) { var more = document.createElement('button'); more.className = 'btn load-more'; more.dataset.act = 'more'; more.textContent = 'Show ' + Math.min(100, total - shown.length) + ' more'; frag.appendChild(more); }
    feed.replaceChildren(frag);
    shown.forEach(function (t) { t._fresh = false; });
    lastRenderAt = U.now();
  };

  // ---------- detail ----------
  var detailFetches = {};
  var VERDICT_TEXT = { STRONG: 'Clean, and attention is arriving.', WATCH: 'Clean. Nothing exceptional yet.', CAUTION: 'Real risks. See the reasons.', AVOID: 'Structural red flags.', RUGGED: 'Over: the cap collapsed or the pool was emptied.' };
  function check(cls, key, label, val, sim) { return '<div class="c ' + cls + '" data-help="' + U.esc(key) + '"><span class="ico"></span><span class="lbl">' + U.esc(label) + '</span><span class="val">' + U.esc(val || '') + (sim ? ' <span class="sim">~</span>' : '') + '</span></div>'; } // v1.59: values escaped: a copycat's symbol is on-chain text
  function checksHtml(t) {
    var c = [];
    if (t.chain === 'solana') {
      c.push(t.mintAuth === false ? check('good', 'mint', 'Nobody can mint more tokens') : t.mintAuth === true ? check('bad', 'mint', 'Dev can still mint tokens') : check('na', 'mint', 'Mint rights', 'unknown'));
      c.push(t.freezeAuth === false ? check('good', 'freeze', 'Nobody can freeze wallets') : t.freezeAuth === true ? check('bad', 'freeze', 'Dev can freeze wallets') : check('na', 'freeze', 'Freeze rights', 'unknown'));
    }
    c.push(t.lpLocked === true ? check('good', 'lp', 'Liquidity is locked') : t.lpLocked === false ? check('bad', 'lp', 'Liquidity can be pulled') : check('na', 'lp', 'Liquidity lock', 'unknown'));
    c.push(U.isNum(t.top10) ? check(t.top10 > 0.5 ? 'bad' : t.top10 > 0.35 ? 'warn' : 'good', 'top10', 'Top 10 wallets hold', U.pct0(t.top10), t.simulated.top10) : check('na', 'top10', 'Top 10 wallets hold', 'unknown'));
    c.push(U.isNum(t.dev.pct) ? check(t.dev.pct > 0.2 ? 'bad' : t.dev.pct > 0.1 ? 'warn' : 'good', 'dev', 'Dev holds', U.pct0(t.dev.pct), t.simulated.dev) : check('na', 'dev', 'Dev holds', 'unknown'));
    c.push(t.dev.sold === true ? check('bad', 'devsold', 'Dev sold after launch', '', t.simulated.dev) : t.dev.sold === false ? check('good', 'devsold', 'Dev has not sold', '', t.simulated.dev) : check('na', 'devsold', 'Dev selling', 'unknown'));
    c.push(U.isNum(t.sniperPct) ? check(t.sniperPct > 0.3 ? 'bad' : t.sniperPct > 0.15 ? 'warn' : 'good', 'sniper', 'Bought in the first block', U.pct0(t.sniperPct), t.simulated.sniper) : check('na', 'sniper', 'Snipers', 'unknown'));
    c.push(U.isNum(t.bundlePct) ? check(t.bundlePct > 0.25 ? 'bad' : t.bundlePct > 0.1 ? 'warn' : 'good', 'bundle', 'Bundled wallets hold', U.pct0(t.bundlePct), t.simulated.bundle) : check('na', 'bundle', 'Bundles', 'unknown'));
    if (U.isNum(t.dev.launches)) { var serial = t.dev.launches >= 5 && !(t.dev.graduated > 0); c.push(check(serial ? 'bad' : (t.dev.graduated > 0 ? 'good' : ''), 'devhist', serial ? 'Serial deployer' : 'Dev history', t.dev.launches + ' launch' + (t.dev.launches === 1 ? '' : 'es') + ', ' + (t.dev.graduated || 0) + ' graduated', t.simulated.dev)); }
    else c.push(check('na', 'devhist', 'Dev history', 'unknown'));
    if (t.clones.length) c.push(check(t.firstOfName ? '' : 'bad', 'clone', t.firstOfName ? 'Original, ' + t.clones.length + ' cop' + (t.clones.length > 1 ? 'ies' : 'y') + ' exist' : 'Copy of an earlier token', t.clones.map(function (x) { return x.symbol; }).slice(0, 2).join(', ')));
    else c.push(check('good', 'clone', 'No other token with this name'));
    var soc = [t.socials.x ? 'X' : null, t.socials.tg ? 'Telegram' : null, t.socials.web ? 'website' : null].filter(Boolean);
    c.push(soc.length ? check('', 'socials', 'Socials', soc.join(', ')) : check('warn', 'socials', 'No socials'));
    return '<div class="checks">' + c.join('') + '</div>';
  }
  // ---------- the launch post on X: a compact card from X's oEmbed; "Show with media" loads X's own embed ----------
  function safePostBody(html) {
    var doc; try { doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html'); } catch (e) { return U.esc(html || ''); }
    var out = '';
    var walk = function (node) {
      for (var n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) out += U.esc(n.nodeValue);
        else if (n.nodeType === 1) {
          var tag = n.tagName.toLowerCase();
          if (tag === 'br') out += '<br>';
          else if (tag === 'a') { var href = n.getAttribute('href') || ''; if (/^https?:\/\//i.test(href)) out += '<a href="' + U.esc(href) + '" target="_blank" rel="noopener">' + U.esc(n.textContent) + '</a>'; else out += U.esc(n.textContent); }
          else walk(n);
        }
      }
    };
    walk(doc.body.firstChild || doc.body);
    return out;
  }
  function postCard(c, t) {
    var url = c.url || (t && t.socials && t.socials.x) || '#';
    if (c.gone) return '<div class="tw gone"><span class="warn">Launch post is gone</span> deleted, or the account is suspended. <a href="' + U.esc(url) + '" target="_blank" rel="noopener">Check on X</a></div>';
    var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
    return '<div class="tw"><div class="tw-head"><span class="tw-name">' + U.esc(c.author || c.user) + '</span><a class="tw-handle" href="https://x.com/' + U.esc(c.user) + '" target="_blank" rel="noopener">@' + U.esc(c.user) + '</a><span class="tw-date">' + U.esc(c.date || '') + '</span></div>' +
      '<div class="tw-text">' + safePostBody(c.body) + '</div>' +
      '<div class="tw-foot">' + (c.hasMedia ? '<span class="muted">has a photo or video</span>' : '') + '<a class="btn small" href="' + U.esc(url) + '" target="_blank" rel="noopener">Open on X</a>' + (c.hasMedia && !sandboxed ? '<button class="btn small" data-act="embedPost">Show with media</button>' : '') + '</div><div class="tw-embed" id="xEmbed"></div></div>';
  }
  var widgetsLoading = null;
  function embedPost(t) {
    var c = S.tweetCached(t.socials.x); var box = $('#xEmbed'); if (!c || !box) return;
    // v1.59: the blockquote is built here from the post's own address, never from the oEmbed html (which would go into innerHTML): X's widget script fills it from the link alone
    var link = TL.safeLink ? TL.safeLink('x', t.socials.x) : ''; if (!/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,20}\/status\/\d{5,25}(\?.*)?$/.test(link || '')) return;
    var bq = document.createElement('blockquote'); bq.className = 'twitter-tweet'; var al = document.createElement('a'); al.href = link.replace(/^https:\/\/x\.com\//, 'https://twitter.com/').split('?')[0]; al.textContent = 'Loading the post…'; bq.appendChild(al);
    bq.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'); bq.setAttribute('data-dnt', 'true'); bq.setAttribute('data-conversation', 'none');
    box.innerHTML = ''; box.appendChild(bq); var btn = $('#tpPost [data-act="embedPost"]'); if (btn) btn.remove();
    var go = function () { if (window.twttr && window.twttr.widgets) window.twttr.widgets.load(box); };
    if (window.twttr && window.twttr.widgets) return go();
    if (!widgetsLoading) { widgetsLoading = new Promise(function (res, rej) { var sc = document.createElement('script'); sc.src = 'https://platform.twitter.com/widgets.js'; sc.async = true; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
    widgetsLoading.then(go, function () { box.innerHTML = '<span class="muted" style="font-size:12px">X did not answer; open the post on X.</span>'; });
  }
  function stageExplain(t) {
    return { launched: 'Minutes old, still on the bonding curve. Everything here is noise until buyers other than the dev show up.',
      bonding: 'On the curve, filling up. Watch buyers per minute and holder growth, not price.',
      graduating: 'Curve above 70%. Graduation locks liquidity and opens the token to bots and real traders alike; the first hour after is the test.',
      graduated: 'Migrated to a pool less than a day ago. Snipers and bundles usually unload here; survivors start building holders.',
      trending: 'Past graduation with volume and holders still growing.',
      fading: 'Volume collapsed and price is far below the top. Some come back; most do not.',
      dead: 'No meaningful trading for hours.' }[t.stage] || '';
  }

  // ---------- token page: one token on its own screen. The feed row is a link to it, so it opens in a new tab like any link ----------
  var CHAIN_SLUG = { solana: 'sol', robinhood: 'robinhood' }, SLUG_CHAIN = { sol: 'solana', solana: 'solana', robinhood: 'robinhood', hood: 'robinhood' };
  var baseTitle = document.title || 'Chameleon';
  ui.tokenHref = function (t) { return '#/' + CHAIN_SLUG[t.chain] + '/token/' + encodeURIComponent(t.address); };
  function safeDecode(x) { try { return decodeURIComponent(x); } catch (e) { return x; } }
  function parseRoute() {
    var h = String(location.hash || '').replace(/^#\/?/, '');
    var m = h.match(/^(sol|solana|robinhood|hood)\/token\/([^\/?#]+)$/i);
    if (m) return { view: 'token', chain: SLUG_CHAIN[m[1].toLowerCase()], address: safeDecode(m[2]) };
    var wlt = h.match(/^smart\/wallet\/(sol|solana|robinhood|hood)\/([^\/?#]+)$/i);
    if (wlt) return { view: 'wallet', chain: SLUG_CHAIN[wlt[1].toLowerCase()], address: safeDecode(wlt[2]) };
    var x = h.match(/^smart(?:\/(sol|solana|robinhood|hood)\/([^\/?#]+))?$/i);
    if (x) return { view: 'xray', chain: x[1] ? SLUG_CHAIN[x[1].toLowerCase()] : null, address: x[2] ? safeDecode(x[2]) : null };
    if (/^(btc|course|poly|bot|about|roadmap|valley)$/i.test(h)) return { view: h.toLowerCase() }; // v1.34: the second part of the site, embedded; v1.43: the Trading bot and Mint NFT tabs; v1.52: About and Roadmap
    return { view: 'trenches' };
  }
  ui.parseRoute = parseRoute;
  function findToken(chain, address) {
    var t = store.get(chain + ':' + address); if (t) return t;
    var low = String(address).toLowerCase();
    return store.all().filter(function (o) { return o.chain === chain && String(o.address).toLowerCase() === low; })[0] || null;
  }
  ui.route = function () {
    var r = parseRoute();
    if (TL.gate && TL.gate.locked && !TL.gate.publicView(r.view)) { closePage(); TL.gate.show(); return; } // v1.52: no access yet: the gate, whatever the route
    if (TL.gate && TL.gate.locked && TL.portal && TL.portal.shown) TL.portal.hide(); // v2.10: About, Roadmap and the Valley are open to all: the portal steps aside
    if (r.view === 'token') { openPage(r.chain, r.address); return; }
    var wasPage = !!state.page; closePage();
    if (S.lite && ui.bootFeed) ui.bootFeed(); // this tab was opened on a token: the feed needs the full data loop now
    if (r.view === 'wallet') { if (r.chain && r.chain !== state.net) { state.net = r.chain; } ui.setTab('xray'); if (TL.smart) TL.smart.openWallet(r.chain, r.address); return; }
    if (EXTRA_TABS.indexOf(r.view) >= 0) { ui.setTab(r.view); return; }
    if (r.view === 'xray') {
      ui.setTab('xray');
      if (!r.address) { if (TL.smart) TL.smart.home(); return; }
      var addr = r.chain === 'robinhood' ? String(r.address).toLowerCase() : r.address;
      if (TL.xray && !(TL.xray.report && !TL.xray.report.wallet && TL.xray.report.address === addr)) TL.xray.run(addr, r.chain);
      else if (TL.smart) TL.smart.hideBoard();
      return;
    }
    ui.setTab('trenches', wasPage);
    if (wasPage) { var y = state.feedScrollY || 0; requestAnimationFrame(function () { window.scrollTo(0, y); }); } // back where you left the feed
  };
  function goBack() { if (state.pageFromFeed && history.length > 1) history.back(); else location.hash = '#/'; }
  function openPage(chain, address) {
    if (!chain || !address) { location.hash = '#/'; return; }
    var t = findToken(chain, address) || store.upsert({ chain: chain, address: chain === 'robinhood' ? String(address).toLowerCase() : address });
    var fresh = state.page !== t.id;
    state.page = t.id; state.tab = 'token';
    state.pageFromFeed = state.navFromFeed; state.navFromFeed = false;
    if (t.chain !== state.net) state.net = t.chain; // the network switch follows the token (the saved choice stays as it was)
    $$('#siteTabs button').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    $$('#netSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.net === state.net ? 'true' : 'false'); });
    ui.showNetSwitch(false);
    $('#tabTrenches').hidden = true; $('#tabXray').hidden = true; $('#tabToken').hidden = false;
    EXTRA_TABS.forEach(function (k) { var el = $('#tab' + k.charAt(0).toUpperCase() + k.slice(1)); if (el) el.hidden = true; }); if (TL.bottab) TL.bottab.hide();
    hideZoom(); if (ui.tip) ui.tip.hide();
    if (!fresh) { ui.renderToken(); return; }
    window.scrollTo(0, 0);
    t._pageLoaded = !!t.ready; ui.renderToken(true); pageTrades(t);
    var done = function () { if (state.page !== t.id) return; t._pageLoaded = true; TL.vet(t); ui.renderToken(); };
    if (S.focusToken) S.focusToken(t).then(done, done); else done();
  }
  function closePage() {
    if (!state.page) return;
    state.page = null; var el = $('#tabToken'); el.hidden = true; el.innerHTML = ''; el.dataset.tokenId = '';
    if (TL.xray && TL.xray.stopTrades && !$('#chartModal').classList.contains('open')) TL.xray.stopTrades();
    document.title = baseTitle;
  }
  function pageTrades(t) {
    if (!TL.xray || !TL.xray.startTrades || !$('#tpTrades')) return;
    TL.xray.startTrades(t, function (LT) {
      if (state.page !== t.id) return; var box = $('#tpTrades'); if (!box) return;
      box.innerHTML = TL.xray.tradesHtml(t);
      var n = $('#tpTradesNote'); if (n) n.textContent = LT.sim ? 'simulated in this preview' : (LT.list.length ? LT.list.length + ' latest, refreshed every few seconds' : '');
      LT.list.forEach(function (tr) { tr.fresh = false; });
    });
    $('#tpTrades').innerHTML = TL.xray.tradesHtml(t);
  }
  // a section is rewritten only when its content changed (ages tick by themselves), and a loaded logo is kept, so nothing flickers
  function sigOf(html) { return html.replace(/(data-born="\d+"[^>]*>)[^<]*/g, '$1'); }
  function swapHtml(node, html) {
    if (!node) return; var sig = sigOf(html); if (node._sig === sig) return;
    var keep = {}; $$('.logo img.ready', node).forEach(function (im) { keep[im.getAttribute('src')] = im; });
    node.innerHTML = html; node._sig = sig;
    $$('.logo img', node).forEach(function (im) { var o = keep[im.getAttribute('src')]; if (o) im.replaceWith(o); else bindLogo(im); });
  }
  function pct(v) { return U.isNum(v) ? U.pct0(v) : '–'; }
  function kvItem(label, value, help, cls) { return '<div class="item"' + (help ? ' data-help="' + help + '"' : '') + '><span>' + label + '</span><b class="' + (cls || '') + '">' + value + '</b></div>'; }
  function line(label, value) { return '<div class="tp-line"><span>' + label + '</span><span>' + value + '</span></div>'; }
  function level(v, warn, bad) { return !U.isNum(v) ? '' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'good'; }
  function explorerUrl(t) { return t.chain === 'solana' ? 'https://solscan.io/token/' + t.address : 'https://robinhoodchain.blockscout.com/token/' + t.address; }
  function walletUrl(t, addr) { return TL.gmgnWallet(t.chain, addr); } // v1.66: with the referral code
  function tokenChip(o) { return '<a class="tp-chip" href="' + ui.tokenHref(o) + '">' + U.esc(o.symbol || U.short(o.address)) + '<small>' + (U.isNum(o.createdAt) ? U.fmtAge(U.now() - o.createdAt) : '') + '</small></a>'; }

  function xHandle(url) { var m = String(url || '').match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i); return m && m[1].toLowerCase() !== 'search' && m[1].toLowerCase() !== 'i' ? m[1] : null; }
  function hostOf(url) { var m = String(url || '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].replace(/^www\./i, '') : null; }
  // every link the token published, right under its name: X with the handle, the site, Telegram and the rest
  function pageSocialsHtml(t) {
    var s = t.socials || {}, off = t.demo || t.partial, out = [];
    var sym = String(t.symbol || 'token').toLowerCase().replace(/[^a-z0-9]/g, '') || 'token';
    var chip = function (href, icon, label, extra, cls) {
      var inner = icon + '<span>' + U.esc(label) + '</span>' + (extra ? '<small>' + U.esc(extra) + '</small>' : '');
      return off || !href ? '<span class="soc ' + (cls || '') + '">' + inner + '</span>' : '<a class="soc ' + (cls || '') + '" href="' + U.esc(href) + '" target="_blank" rel="noopener" title="' + U.esc(label) + '">' + inner + '</a>';
    };
    if (s.x) { var h = xHandle(s.x) || (t.demo ? sym + '_demo' : null); out.push(chip(s.x, ICONS.x, h ? '@' + h : 'X', U.isNum(t.xFollowers) && t.xFollowers > 0 ? U.fmtNum(t.xFollowers) + ' followers' : '', 'x')); }
    if (s.web) out.push(chip(s.web, ICONS.web, hostOf(s.web) || (t.demo ? sym + '-demo.example' : 'Website')));
    if (s.tg) out.push(chip(s.tg, ICONS.tg, 'Telegram'));
    [['ig', 'Instagram'], ['tt', 'TikTok'], ['dc', 'Discord'], ['yt', 'YouTube']].forEach(function (k) { if (s[k[0]]) out.push(chip(s[k[0]], ICONS.web, k[1])); });
    if (!out.length) out.push('<span class="soc none">No socials published</span>');
    if (!off) out.push(chip('https://x.com/search?q=' + encodeURIComponent(t.address) + '&f=live', ICONS.search, 'Search on X'));
    return '<div class="tp-socials">' + out.join('') + '</div>';
  }
  function pageHeadHtml(t) {
    var u = chartUrls(t); var off = t.demo || t.partial;
    var age = U.isNum(t.createdAt) ? '<span data-born="' + t.createdAt + '" data-suffix=" old">' + U.fmtAgeLive(U.now() - t.createdAt) + ' old</span>' : '';
    var status = !t.ready ? '<div class="tp-note">' + (t._pageLoaded ? 'No market data for this address yet.' : 'Loading\u2026') + '</div>'
      : (t._ok ? '' : '<div class="tp-note bad">Hidden from the feeds: ' + U.esc(t._hide) + '</div>');
    return logoHtml(t, true) +
      '<div class="tp-id"><div class="tp-name"><span class="sym">' + U.esc(t.symbol || U.short(t.address)) + '</span><span class="nm">' + U.esc(t.name || '') + '</span>' + (t.ready ? '<span class="verdict ' + t.verdict + '" data-help="verdict">' + t.verdict + '</span>' : '') + quantumFlagHtml(t) + '</div>' +
      '<div class="tp-meta"><span class="qbadge">' + (t.chain === 'solana' ? 'SOL' : 'HOOD') + '</span>' + (t.launchpad && t.launchpad !== 'unknown' ? '<span>' + U.esc(t.launchpad) + '</span>' : '') + age + (t.ready ? '<span>' + stageName(t) + '</span>' : '') + '</div>' +
      pageSocialsHtml(t) +
      '<div class="tp-addr"><span class="num" title="' + U.esc(t.address) + '">' + U.esc(t.address) + '</span>' + (off ? '' : '<button class="btn small" data-act="copy">Copy</button>') + '</div>' + status + pageCallHtml(t) + '</div>' +
      '<div class="tp-actions"><button class="star" data-act="watch" aria-pressed="' + (!!state.watch[t.id]) + '" title="' + (state.watch[t.id] ? 'In your watchlist. Click to remove' : 'Add to watchlist') + '">' + STAR_SVG + '</button>' +
      (off ? '' : '<a class="btn" href="#/smart/' + CHAIN_SLUG[t.chain] + '/' + encodeURIComponent(t.address) + '">Smart Tracking</a><a class="btn primary" href="' + U.esc(u.gmgn) + '" target="_blank" rel="noopener">Open on GMGN</a>' + (u.axiom ? '<a class="btn" href="' + U.esc(u.axiom) + '" target="_blank" rel="noopener">Axiom</a>' : '') + (u.photon ? '<a class="btn" href="' + U.esc(u.photon) + '" target="_blank" rel="noopener">Photon</a>' : '')) + '</div>';
  }
  function stageName(t) { var m = stageBar(t).match(/<b>([^<]*)<\/b>/); return m ? m[1] : ''; }
  // a reading of exactly zero where zero is impossible (top-10 share with holders present) is missing data
  function realTop10(t) { var v = TL.top10eff(t); return v === 0 && (!U.isNum(t.holders) || t.holders > 0) ? null : v; }
  function holderDelta(t) { return U.isNum(t.holdersDelta1h) && U.isNum(t.holders) && t.holdersDelta1h <= t.holders ? t.holdersDelta1h : null; }
  function pageStatsHtml(t) {
    var R = TL.RISK, devCap = t.complete ? R.devPool : R.devCurve, t10 = realTop10(t);
    var st = function (k, v, help, cls) { return '<div class="st"' + (help ? ' data-help="' + help + '"' : '') + '><span>' + k + '</span><b class="num ' + (cls || '') + '">' + v + '</b></div>'; };
    var capTip = t.capSrc ? ' title="' + U.esc(t.capSrc) + (U.isNum(t.mcCirc) && U.isNum(t.mc) && t.mcCirc < t.mc * 0.9 ? ' \u00b7 circulating cap ' + U.fmtUsd(t.mcCirc) : '') + '"' : '';
    var liqTip = t.liqSrc ? ' title="' + U.esc(t.liqSrc) + '"' : '';
    var athHtml = U.isNum(t.athMc) && U.isNum(t.mc) && t.athMc > t.mc * 1.15 ? '<small class="ath' + (t.mc < t.athMc * 0.35 ? ' bad' : '') + '">peak ' + U.fmtUsd(t.athMc) + ' · ' + Math.round(t.mc / t.athMc * 100) + '% of it now</small>' : '';
    var cells = st('Price', U.fmtPrice(t.price)) + '<div class="st" data-help="mc"' + capTip + '><span>Market cap</span><b class="num">' + U.fmtUsd(t.mc) + '</b>' + athHtml + '</div>' + '<div class="st" data-help="liq"' + liqTip + '><span>Liquidity</span><b class="num">' + U.fmtUsd(t.liq) + '</b>' + (U.isNum(t.raisedUsd) && !t.complete ? '<small class="ath">' + U.fmtUsd(t.raisedUsd) + ' raised so far</small>' : '') + '</div>' +
      st('Holders', U.fmtNum(t.holders) + (holderDelta(t) ? ' <small>' + (holderDelta(t) > 0 ? '+' : '') + holderDelta(t) + ' 1h</small>' : ''), 'holders') +
      (function () { // v1.34: the top ten against what circulates, next to the share of the whole supply
        var t10c = TL.top10circ(t), cs = TL.circShare(t), circTxt = U.isNum(t10c) && U.isNum(cs) && cs < 0.9 && U.isNum(t10) && t10c > t10 + 0.02 ? '<small class="ath' + (t10c >= TL.TOP10C.h40 ? ' bad' : '') + '">' + U.pct0(t10c) + ' of what circulates</small>' : '';
        var lvl = U.isNum(t10c) && t10c >= TL.TOP10C.h40 ? 'bad' : level(t10, 0.35, R.top10);
        var tip = 'Share of the whole supply held by the ten largest wallets, the pool and the curve not counted' + (U.isNum(t10c) && U.isNum(cs) && cs < 0.9 ? '. In circulation (outside the curve): ' + U.pct0(t10c) + ' held by the top ten. Over ' + U.pct0(TL.top10circBar(t) || TL.TOP10C.h40) + ' at this holder count the token is hidden: ten wallets can empty it' : '');
        return '<div class="st" data-help="top10" title="' + U.esc(tip) + '"><span>Top 10</span><b class="num ' + (lvl || '') + '">' + pct(t10) + '</b>' + circTxt + '</div>';
      })() + st('Dev holds', pct(t.dev.pct), 'dev', level(t.dev.pct, devCap / 2, devCap)) +
      (U.isNum(t.curve) && !t.complete ? st('Curve', pct(t.curve), 'curve') : st('Volume 24h', volTxt(t, 'h24'), 'vol'));
    var tAge = U.isNum(t.createdAt) ? U.now() - t.createdAt : null;
    var wins = ['m5', 'h1', 'h6', 'h24'].map(function (w) {
      var c = t.chg[w], tx = t.tx[w];
      // a window longer than the token's life is not a longer window: it is the same numbers under a different label, and saying
      // so is the difference between an honest panel and one that looks like it invented six hours of history for a minute-old coin
      var young = tAge !== null && TL.WIN_SPAN && tAge < TL.WIN_SPAN[w];
      var yTtl = young ? ' title="Token is ' + U.fmtAge(tAge) + ' old: this window covers its whole life."' : '';
    return '<div class="tp-win' + (young ? ' young' : '') + '" data-help="chg"' + yTtl + '><span>' + WIN_LABEL[w] + (young ? ' <i>whole life</i>' : '') + '</span><b class="num ' + (c > 0 ? 'up' : c < 0 ? 'down' : '') + '">' + U.fmtPct(c, 1) + '</b><small class="num">vol ' + volTxt(t, w) + (tx && U.isNum(tx.b) ? ' · ' + (t._txMin && t._txMin[w] ? '\u2265' : '') + '<span class="up">' + U.fmtNum(tx.b) + '</span> / <span class="down">' + U.fmtNum(tx.s || 0) + '</span>' : '') + '</small></div>';
    }).join('');
    // where these numbers came from and how old they are: the answer to "why does GMGN show something else"
    var src = (t.source && (t.source.market || t.source.core)) || t.posSrc || '';
    var seen = U.isNum(t._touched) ? t._touched : U.now();
    var freshness = '<div class="tp-fresh">updated <span data-born="' + seen + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - seen) + ' ago</span>' + (src ? '<span class="muted"> \u00b7 ' + U.esc(src) + '</span>' : '') + '</div>';
    return '<div class="st-row">' + cells + '</div><div class="win-row">' + wins + '</div>' + freshness;
  }
  function pageVerdictHtml(t) {
    var head = '<div class="tp-card-h"><h3>Verdict</h3></div>';
    if (!t.ready || !t.scores) return head + '<span class="muted">Waiting for data…</span>';
    var R = t.reasons, sc = t.scores;
    var reasons = R.safety.concat(R.momentum, R.community).filter(function (r) { return r.pts !== 0; }).sort(function (a, b) { return Math.abs(b.pts) - Math.abs(a.pts); });
    var rr = function (r) { return '<div class="r ' + (r.pts > 0 ? 'plus' : 'minus') + '"><span class="ico"></span><span class="txt">' + U.esc(r.label) + (r.note ? '<small>' + U.esc(r.note) + '</small>' : '') + '</span><span class="pts">' + (r.pts > 0 ? '+' : '') + r.pts + '</span></div>'; };
    var UNK_LABEL = { top10: 'top 10 share', dev: 'dev holding', mint: 'mint authority', freeze: 'freeze authority', lp: 'liquidity lock', holders: 'holder count', snipers: 'snipers', bundle: 'bundles' };
    var unknown = (sc.unknown || []).map(function (k) { return UNK_LABEL[k] || k; });
    var ageMs = U.isNum(t.createdAt) ? U.now() - t.createdAt : null;
    var early = unknown.length >= 2 && (ageMs === null || ageMs < 10 * TL.MIN)
      ? '<div class="tp-early">Too early to judge: ' + unknown.length + ' checks pending (' + U.esc(unknown.slice(0, 4).join(', ')) + ').</div>'
      : '';
    var simNote = Object.keys(t.simulated || {}).length ? '<div class="note-sim">Values marked ~ are simulated in this preview.</div>' : '';
    var smart = t.smart ? '<div class="tp-line"><span>Smart money</span><span>' + t.smart.wallets + ' wallet' + (t.smart.wallets === 1 ? '' : 's') + (t.smart.kols ? ', ' + t.smart.kols + ' KOL' : '') + ', ' + (t.smart.flow1h > 0 ? 'buying' : t.smart.flow1h < 0 ? 'selling' : 'flat') + (t.simulated.smart ? ' ~' : '') + '</span></div>' : '';
    return head + '<div class="verdict-box"><span class="verdict ' + t.verdict + '" data-help="verdict">' + t.verdict + '</span><p>' + VERDICT_TEXT[t.verdict] + (t._ok ? '' : '<br><span class="hidden-why">Hidden from the feeds: ' + U.esc(t._hide) + '</span>') + '</p></div>' +
      early + '<div class="kv">' + kvItem('Safety', sc.safety, 'safety') + kvItem('Momentum', sc.momentum, 'momentum') + kvItem('Community', sc.community, 'community') + '</div>' +
      '<div class="why">' + (reasons.length ? reasons.map(rr).join('') : '<span class="muted">No rule fired yet.</span>') + '</div>' + simNote + smart;
  }
  // GMGN's reading of the token: rug risk, smart money and KOLs, snipers, bundles, insider trading, dev record, wallet mix
  // v1.48: the known traders inside this token: the feed's buys of the last 24 hours plus GMGN's KOL list for the token, asked when the page opens
  function pageKnownHtml(t) {
    var K = TL.known, SM = TL.smart; if (!K || t.demo || t.partial) return '';
    if (TL.gmgn && TL.gmgn.active && TL.gmgn.active()) K.readInside(t);
    var rows = K.inside(t);
    var head = '<div class="tp-card-h"><h3>Known traders inside</h3><span class="src">' + (rows.length ? rows.length + ' · GMGN KOL feed' + (t.knownIn && !t.knownIn.failed ? ' + token KOLs' : '') : (t.knownIn ? 'GMGN' : 'GMGN KOL feed')) + '</span></div>';
    if (!rows.length) { if (!t.knownIn && !(t.smart && t.smart.kols)) return ''; return head + '<p class="tp-gm-empty">' + (t.knownIn ? 'No known trader has bought this token.' : 'Reading the token\'s KOL wallets from GMGN…') + '</p>'; }
    var body = rows.slice(0, 8).map(function (r) {
      var tier = K.TIER[r.tier] ? K.TIER[r.tier][0] : '', href = '#/smart/wallet/' + (t.chain === 'robinhood' ? 'hood' : 'sol') + '/' + encodeURIComponent(r.wallet);
      var state = r.soldOut ? '<span class="down">sold out</span>' : r.hold > 0.5 ? 'holds ' + U.fmtUsd(r.hold) : r.sold > 0 && r.sold >= r.usd * 0.9 ? '<span class="down">sold</span>' : r.sold > 0 ? 'sold part' : 'holding';
      return '<a class="kn-row" href="' + href + '">' + (SM ? SM.avatar(r.wallet, r.avatar, 28) : '') + '<span class="kn-id"><b>' + U.esc(r.name) + '</b>' + (tier ? '<span class="tag ' + (r.tier === 'proven' ? 'good' : r.tier === 'top' ? 'smart' : r.tier === 'watch' ? 'mine' : '') + '">' + tier + '</span>' : '') + '</span>' +
        '<span class="num kn-num"><b>' + U.fmtUsd(r.usd) + '</b><small>bought' + (r.buys ? ', ' + r.buys + (r.buys === 1 ? ' buy' : ' buys') : '') + '</small></span><span class="kn-state">' + state + '<small>' + (r.last ? '<span data-born="' + r.last + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - r.last) + ' ago</span>' : '') + '</small></span></a>';
    }).join('');
    return head + '<div class="kn-list">' + body + '</div>' + (rows.length > 8 ? '<div class="x-note">… and ' + (rows.length - 8) + ' more in Smart Tracking.</div>' : '') + '<div class="x-note">Buys of the last 24 hours as GMGN\'s KOL feed shows them, plus the KOL wallets GMGN lists for the token. A name inside is context, not a reason on its own.</div>';
  }
  function pageGmgnHtml(t) {
    var G = TL.gmgn, sim = t.demo || t.partial;
    if (sim && store.mode !== 'demo') return '';
    var head = '<div class="tp-card-h"><h3>GMGN signals</h3><span class="src">' + (sim ? 'preview, simulated ~' : t.gmgnAt ? '<span data-born="' + t.gmgnAt + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - t.gmgnAt) + ' ago</span>' : 'GMGN OpenAPI') + '</span></div>';
    if (!t.gmgnAt && !sim) {
      if (!G || !G.available() || !G.configured()) return '';
      return head + '<p class="tp-gm-empty">' + (G.state === 'ok' || G.state === 'connecting' ? 'Loading from GMGN…' : U.esc(G.statusNote())) + '</p>';
    }
    var sm = t.smart && (t.smart.src === 'gmgn' || sim) ? t.smart : null, wt = t.walletTags || {};
    var yesNo = function (v, bad) { return v === true ? '<span class="' + (bad ? 'down' : 'up') + '">yes</span>' : v === false ? 'no' : '–'; };
    var cells = kvItem('Rug risk', pct(t.rugRatio), 'rug', level(t.rugRatio, 0.15, TL.RISK.rug)) + kvItem('Smart money', sm ? U.fmtNum(sm.wallets) : '–', 'smart', sm && sm.wallets >= 3 ? 'up' : '') + kvItem('KOLs', sm ? U.fmtNum(sm.kols) : '–', 'smart') +
      kvItem('Snipers', (U.isNum(t.sniperCount) ? U.fmtNum(t.sniperCount) : '–') + (U.isNum(t.sniperPct) ? ' · ' + pct(t.sniperPct) : ''), 'sniper', level(t.sniperPct, 0.15, TL.RISK.sniper)) + kvItem('Bundles', pct(t.bundlePct), 'bundle', level(t.bundlePct, 0.15, TL.RISK.bundle)) + kvItem('Insider trading', pct(t.ratPct), 'rat', level(t.ratPct, 0.15, 0.3));
    var dev = t.dev || {};
    var lines = line('Wash trading', yesNo(t.wash, true)) + (t.chain !== 'solana' ? line('Honeypot', yesNo(t.honeypot, true)) : '') +
      line('Dev', U.isNum(dev.pct) ? 'holds ' + U.pct0(dev.pct) + (dev.sold === true ? ', position closed' : '') : dev.sold === true ? 'position closed' : dev.sold === false ? 'still holds' : '–') +
      (U.isNum(dev.launches) ? line('Dev launches', U.fmtNum(dev.launches) + (U.isNum(dev.graduated) ? ', ' + U.fmtNum(dev.graduated) + ' graduated' : '')) : '') +
      (t.devAth && U.isNum(t.devAth.mc) ? line('Dev best token', U.esc(t.devAth.symbol || U.short(t.devAth.address)) + ' · ATH ' + U.fmtUsd(t.devAth.mc)) : '') +
      (U.isNum(t.freshRate) ? line('Fresh wallets', U.pct0(t.freshRate)) : '') + (U.isNum(t.botRate) ? line('Bot wallets', U.pct0(t.botRate)) : '') +
      (U.isNum(t.xFollowers) ? line('X followers', U.fmtNum(t.xFollowers)) : '') + (t.cto ? line('Community takeover', 'yes') : '') + (t.dexPaid ? line('DEX Screener', 'paid profile') : '') +
      (U.isNum(t.tax) ? line('Tax', U.pct0(t.tax)) : '') + (U.isNum(t.athPrice) && U.isNum(t.price) && t.athPrice > 0 ? line('From the top', U.fmtPct((t.price / t.athPrice - 1) * 100, 0)) : '');
    var mix = [['whale', 'whales'], ['fresh', 'fresh'], ['sniper', 'snipers'], ['bundler', 'bundlers'], ['insider', 'insiders']].filter(function (k) { return U.isNum(wt[k[0]]) && wt[k[0]] > 0; }).map(function (k) { return '<span>' + U.fmtNum(wt[k[0]]) + ' ' + k[1] + '</span>'; }).join('');
    return head + '<div class="kv gm3">' + cells + '</div><div class="tp-lines">' + lines + '</div>' + (mix ? '<div class="tp-mix">' + mix + '</div>' : '');
  }
  function pageHoldersHtml(t) {
    var d = t.dist, off = t.demo || t.partial;
    var src = (t.source && t.source.holders) || { jupiter: 'Jupiter', 'curve positions': 'Pons curve trades', blockscout: 'Blockscout', gmgn: 'GMGN' }[t.holdersSrc] || '';
    var html = '<div class="tp-card-h"><h3>Holders</h3><span class="src">' + U.esc(src) + '</span></div>' +
      '<div class="kv six">' + kvItem('Holders', U.fmtNum(t.holders), 'holders') + kvItem('Top 10', pct(TL.top10eff(t)), 'top10') + kvItem('Dev', pct(t.dev.pct), 'dev') +
      kvItem('Snipers', pct(t.sniperPct), 'sniper') + kvItem('Bundles', pct(t.bundlePct), 'bundle') + kvItem('Insiders', pct(t.insiderPct), 'insider') + '</div>';
    if (d) html += '<div class="holders"><div class="stack"><i style="width:' + (d.top10 * 100).toFixed(1) + '%;background:var(--ink)"></i><i style="width:' + (d.t11_30 * 100).toFixed(1) + '%;background:var(--ink-2)"></i><i style="width:' + (d.t31_50 * 100).toFixed(1) + '%;background:var(--ink-3)"></i><i style="width:' + (Math.max(0, d.rest) * 100).toFixed(1) + '%;background:var(--surface-3)"></i></div>' +
      '<div class="legend"><span><i style="background:var(--ink)"></i>top 10 · ' + U.pct0(d.top10) + '</span><span><i style="background:var(--ink-2)"></i>11-30 · ' + U.pct0(d.t11_30) + '</span><span><i style="background:var(--ink-3)"></i>31-50 · ' + U.pct0(d.t31_50) + '</span><span><i style="background:var(--surface-3);border:1px solid var(--line-2)"></i>everyone else · ' + U.pct0(Math.max(0, d.rest)) + '</span></div></div>';
    var list = t.topHolders || [];
    if (list.length) {
      var dev = String(t.dev.address || '').toLowerCase();
      html += '<div class="th-list">' + list.map(function (h, i) {
        var a = String(h.address || ''); var tag = a.toLowerCase() === dev ? 'dev' : (h.tags && h.tags.length ? h.tags.slice(0, 2).join(' · ') : (h.tag || ''));
        var av = TL.smart && TL.smart.avatar ? TL.smart.avatar(a, h.avatar, 18) : (TL.xray && TL.xray.identicon && a ? TL.xray.identicon(a, 18) : '<span></span>');
        var who = h.pool ? U.esc(U.short(a)) : '<a class="num" href="#/smart/wallet/' + CHAIN_SLUG[t.chain] + '/' + encodeURIComponent(a) + '" title="' + U.esc(a) + ' · wallet profile">' + U.esc(h.name ? h.name : U.short(a)) + '</a>';
        return '<div class="th-row"><span class="muted num">' + (i + 1) + '</span>' + av + who + '<span class="muted">' + U.esc(tag) + '</span><b class="num">' + pct(h.pct) + '</b></div>';
      }).join('') + '</div>';
    }
    if (!off) html += '<div class="tp-more"><a href="' + U.esc(chartUrls(t).gmgn) + '" target="_blank" rel="noopener">All holders on GMGN</a><a href="' + U.esc(explorerUrl(t) + (t.chain === 'solana' ? '#holders' : '?tab=holders')) + '" target="_blank" rel="noopener">' + (t.chain === 'solana' ? 'Solscan' : 'Blockscout') + '</a></div>';
    return html;
  }
  function pageDevHtml(t) {
    var dev = t.dev || {};
    var others = t._idxDev ? (store.idx.devs[t._idxDev] || []).filter(function (id) { return id !== t.id; }).map(function (id) { return store.get(id); }).filter(function (o) { return o && o.ready; }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 10) : [];
    var lines = line('Wallet', dev.address ? (t.demo || t.partial ? '<span class="num">' + U.esc(U.short(dev.address)) + '</span>' : '<a class="num" href="' + U.esc(walletUrl(t, dev.address)) + '" target="_blank" rel="noopener" title="' + U.esc(dev.address) + '">' + U.esc(U.short(dev.address)) + '</a>') : 'unknown') +
      line('Launches', U.isNum(dev.launches) ? U.fmtNum(dev.launches) + ', ' + U.fmtNum(dev.graduated || 0) + ' graduated' + (t.simulated.dev ? ' ~' : '') : 'unknown') +
      line('Holds now', U.isNum(dev.pct) ? U.pct0(dev.pct) : 'unknown') +
      line('Selling', dev.sold === true ? '<span class="down">' + (t.gmgnAt ? 'position closed (sold)' : 'sold most of the bag') + '</span>' : dev.soldSome ? '<span class="warn-t">sold part of the bag</span>' : dev.sold === false ? 'has not sold' : 'unknown') +
      (t.devFundFrom ? line('Funded by', '<span class="num" title="' + U.esc(t.devFundFrom) + '">' + U.esc(U.short(t.devFundFrom)) + '</span>') : '');
    var html = '<div class="tp-card-h"><h3>Dev and copies</h3></div><div class="tp-lines">' + lines + '</div>';
    if (others.length) html += '<div class="tp-others"><span class="muted">Other tokens from this wallet seen here</span>' + others.map(tokenChip).join('') + '</div>';
    if (t.clones && t.clones.length) html += '<div class="tp-others"><span class="muted">' + (t.firstOfName ? 'Later tokens with the same name or ticker' : 'Same name or ticker, launched earlier') + '</span>' + t.clones.filter(function (o) { return o.ready; }).slice(0, 10).map(tokenChip).join('') + '</div>';
    return html;
  }
  function pageTimelineHtml(t) {
    var evs = (t.events && t.events.length ? t.events : [{ t: t.createdAt, tone: '', text: 'Launched on ' + t.launchpad }].concat(U.isNum(t.graduatedAt) ? [{ t: t.graduatedAt, tone: 'good', text: 'Graduated' }] : []))
      .filter(function (e) { return U.isNum(e.t); });
    return '<div class="tp-card-h"><h3>Timeline</h3></div>' + (evs.length ? '<div class="timeline">' + evs.map(function (e) { return '<div class="ev ' + (e.tone || '') + '"><span class="t">' + U.fmtTime(e.t) + ' · ' + U.fmtAge(U.now() - e.t) + ' ago' + (e.sim ? ' · ~' : '') + '</span><span>' + U.esc(e.text) + '</span></div>'; }).join('') + '</div>' : '<span class="muted">No events yet.</span>');
  }
  function pageChecksHtml(t) {
    return '<div class="tp-card-h"><h3>Safety checks</h3></div>' + checksHtml(t) + '<div class="tp-stage"><h4>Stage</h4>' + stageBar(t) + '<span class="muted">' + stageExplain(t) + '</span></div>';
  }
  function pageLinksHtml(t) {
    var head = '<div class="tp-card-h"><h3>Links</h3></div>';
    if (t.demo || t.partial) return head + '<span class="muted" style="font-size:12px">Links are off for snapshot and demo tokens.</span>';
    var u = chartUrls(t); var a = function (href, label) { return '<a href="' + U.esc(href) + '" target="_blank" rel="noopener">' + label + '</a>'; };
    return head + '<div class="links">' + a(u.gmgn, 'GMGN') + (u.axiom ? a(u.axiom, 'Axiom') : '') + (u.photon ? a(u.photon, 'Photon') : '') + (u.launchpad ? a(u.launchpad, t.chain === 'solana' ? 'pump.fun' : 'Pons') : '') + a(explorerUrl(t), t.chain === 'solana' ? 'Solscan' : 'Blockscout') +
      (t.socials.x ? a(t.socials.x, 'X') : '') + (t.socials.tg ? a(t.socials.tg, 'Telegram') : '') + (t.socials.web ? a(t.socials.web, 'Website') : '') + a('https://x.com/search?q=' + encodeURIComponent(t.address) + '&f=live', 'Search on X') + '</div>' +
      '<div class="tp-lines">' + line('Token', '<span class="num" title="' + U.esc(t.address) + '">' + U.esc(U.short(t.address)) + '</span> <button class="linkbtn" data-act="copy">copy</button>') +
      (t.pair ? line('Pool', '<span class="num" title="' + U.esc(t.pair) + '">' + U.esc(U.short(t.pair)) + '</span>') : '') +
      (t.dev.address ? line('Dev', '<span class="num" title="' + U.esc(t.dev.address) + '">' + U.esc(U.short(t.dev.address)) + '</span> <button class="linkbtn" data-act="copyDev">copy</button>') : '') + '</div>';
  }
  function buildPageChart(t) {
    var wrap = $('#tpChart'); if (!wrap) return; var u = chartUrls(t);
    var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
    var canEmbed = !t.demo && !t.partial && !sandboxed;
    wrap.innerHTML = ''; wrap.dataset.embed = canEmbed ? '1' : '';
    if (canEmbed) {
      var f = document.createElement('iframe'); f.src = u.embed; f.title = 'GMGN chart'; f.setAttribute('allow', 'clipboard-write'); f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
      var note = document.createElement('span'); note.className = 'frame-note'; note.textContent = 'Loading the GMGN chart…';
      var timer = setTimeout(function () { note.textContent = 'GMGN embed did not answer: open the token on GMGN.'; if (S.setStatus) S.setStatus('gmgn', 'err', 'embed did not answer'); }, 12000);
      f.onload = function () { clearTimeout(timer); note.remove(); if (S.setStatus) S.setStatus('gmgn', 'ok', 'chart embed loaded'); };
      wrap.appendChild(f); wrap.appendChild(note);
      $('#tpChartNote').textContent = 'GMGN';
    } else {
      wrap.innerHTML = '<div class="chart-box tp-canvas"><canvas id="tpCanvas" width="10" height="10"></canvas><span class="note"></span></div>';
      $('#tpChartNote').textContent = t.demo || t.partial ? 'preview token: the stored price path' : 'this preview cannot embed GMGN; the HTML file on your computer shows it';
      drawChart($('#tpCanvas'), t.series, 420);
    }
  }
  function renderPagePost(t) {
    var sec = $('#tpPost'); if (!sec) return;
    var url = t.socials && t.socials.x; var ref = !t.demo && url && S.tweetRef && S.tweetRef(url);
    if (!ref) { sec.hidden = true; sec.dataset.url = ''; return; }
    if (sec.dataset.url === url) return; sec.dataset.url = url; sec.hidden = false;
    var head = '<div class="tp-card-h"><h3>Launch post on X</h3></div>';
    var c = S.tweetCached(url);
    sec.innerHTML = head + (c ? postCard(c, t) : '<span class="muted" style="font-size:12px">Loading the post…</span>');
    if (c) return;
    S.fetchTweet(url, t).then(function (c2) { if (state.page !== t.id || sec.dataset.url !== url) return; sec.innerHTML = head + postCard(c2, t); if (c2.gone) { TL.vet(t); ui.renderToken(); } })
      .catch(function () { if (state.page !== t.id) return; sec.innerHTML = head + '<span class="muted" style="font-size:12px">Could not load the post right now. <a href="' + U.esc(url) + '" target="_blank" rel="noopener">Open on X</a></span>'; });
  }
  ui.renderToken = function (rebuild) {
    var el = $('#tabToken'); var t = state.page ? store.get(state.page) : null; if (!t || el.hidden) return;
    TL.ensureVet(t);
    if (rebuild || el.dataset.tokenId !== t.id) {
      el.dataset.tokenId = t.id;
      el.innerHTML = '<div class="tp-nav"><a class="tp-back" href="#/" data-act="back"><span aria-hidden="true">&larr;</span> Trenches</a></div>' +
        '<header class="tp-head" id="tpHead"></header><div class="tp-stats" id="tpStats"></div>' +
        '<div class="tp-grid"><div class="tp-main">' +
        '<section class="tp-card"><div class="tp-card-h"><h3>Chart</h3><span class="muted" id="tpChartNote"></span></div><div class="chart-frame tp-chart" id="tpChart"></div></section>' +
        '<section class="tp-card"><div class="tp-card-h"><h3>Live trades</h3><span class="muted" id="tpTradesNote"></span></div><div class="trades tp-trades" id="tpTrades"></div></section>' +
        '<section class="tp-card" id="tpHolders"></section><section class="tp-card" id="tpDev"></section><section class="tp-card" id="tpTimeline"></section>' +
        '</div><aside class="tp-side">' +
        '<section class="tp-card" id="tpVerdict"></section><section class="tp-card" id="tpKnown" hidden></section><section class="tp-card" id="tpGmgn"></section><section class="tp-card x-post" id="tpPost" hidden></section><section class="tp-card" id="tpChecks"></section><section class="tp-card" id="tpLinks"></section>' +
        '</aside></div>';
      buildPageChart(t);
    }
    document.title = (t.symbol ? t.symbol + ' · ' : '') + baseTitle;
    swapHtml($('#tpHead'), pageHeadHtml(t));
    swapHtml($('#tpStats'), pageStatsHtml(t));
    swapHtml($('#tpVerdict'), pageVerdictHtml(t));
    var knHtml = pageKnownHtml(t); var knEl = $('#tpKnown'); if (knEl) { knEl.hidden = !knHtml; if (knHtml) swapHtml(knEl, knHtml); } // v1.48
    var gmHtml = pageGmgnHtml(t); var gmEl = $('#tpGmgn'); if (gmEl) { gmEl.hidden = !gmHtml; if (gmHtml) swapHtml(gmEl, gmHtml); }
    swapHtml($('#tpChecks'), pageChecksHtml(t));
    swapHtml($('#tpHolders'), pageHoldersHtml(t));
    swapHtml($('#tpDev'), pageDevHtml(t));
    swapHtml($('#tpTimeline'), pageTimelineHtml(t));
    swapHtml($('#tpLinks'), pageLinksHtml(t));
    renderPagePost(t);
    if (!$('#tpChart').dataset.embed) { var cv = $('#tpCanvas'); if (cv) drawChart(cv, t.series, 420); }
  };

  // ---------- chart ----------
  function drawChart(canvas, series, height) {
    if (!canvas) return;
    var note = canvas.parentElement ? canvas.parentElement.querySelector('.note') : null;
    var rect = canvas.getBoundingClientRect(); var dpr = window.devicePixelRatio || 1;
    var W = Math.max(200, rect.width), Hh = height || 140;
    canvas.width = W * dpr; canvas.height = Hh * dpr; canvas.style.height = Hh + 'px';
    var ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    var cs = getComputedStyle(document.documentElement);
    var ink3 = cs.getPropertyValue('--ink-3').trim(), grid = cs.getPropertyValue('--grid').trim();
    ctx.clearRect(0, 0, W, Hh);
    if (!series || series.length < 2) { ctx.fillStyle = ink3; ctx.font = '12px ' + cs.getPropertyValue('--font-ui'); ctx.fillText('No price history from public APIs for this token yet.', 10, 24); if (note) note.textContent = ''; return; }
    var pad = { l: 8, r: 58, t: 12, b: 18 };
    var xs = series.map(function (p) { return p.t; }), ys = series.map(function (p) { return p.c; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 === y0) { y1 = y0 * 1.01 + 1e-9; y0 = y0 * 0.99; }
    var X = function (v) { return pad.l + (v - x0) / (x1 - x0 || 1) * (W - pad.l - pad.r); };
    var Y = function (v) { return pad.t + (1 - (v - y0) / (y1 - y0)) * (Hh - pad.t - pad.b); };
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (var i = 0; i <= 3; i++) { var gy = pad.t + i * (Hh - pad.t - pad.b) / 3; ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke(); }
    ctx.fillStyle = ink3; ctx.font = '10px ' + cs.getPropertyValue('--font-mono'); ctx.textAlign = 'left';
    ctx.fillText(U.fmtPrice(y1), W - pad.r + 4, pad.t + 4); ctx.fillText(U.fmtPrice(y0), W - pad.r + 4, Hh - pad.b);
    ctx.fillText(U.fmtTime(x0), pad.l, Hh - 4); ctx.textAlign = 'right'; ctx.fillText(U.fmtTime(x1), W - pad.r, Hh - 4);
    var up = ys[ys.length - 1] >= ys[0];
    var col = cs.getPropertyValue(up ? '--up' : '--down').trim();
    ctx.beginPath(); series.forEach(function (p, i) { var x = X(p.t), y = Y(p.c); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(X(x1), Hh - pad.b); ctx.lineTo(X(x0), Hh - pad.b); ctx.closePath();
    ctx.globalAlpha = 0.12; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    var lx = X(x1), ly = Y(ys[ys.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = cs.getPropertyValue('--surface-2').trim(); ctx.lineWidth = 2; ctx.stroke();
    if (note) note.textContent = U.fmtPct((ys[ys.length - 1] / ys[0] - 1) * 100) + ' over window';
    canvas.onmousemove = function (ev) {
      var r = canvas.getBoundingClientRect(); var mx = ev.clientX - r.left;
      var idx = U.clamp(Math.round((mx - pad.l) / (W - pad.l - pad.r) * (series.length - 1)), 0, series.length - 1);
      var p = series[idx];
      ui.tip.show(ev, '<b>' + U.fmtPrice(p.c) + '</b>' + U.fmtTime(p.t) + (idx > 0 ? '<span class="why">' + U.fmtPct((p.c / series[0].c - 1) * 100) + ' from window start</span>' : ''));
    };
    canvas.onmouseleave = function () { ui.tip.hide(); };
  }

  // ---------- status ----------
  ui.renderStatus = function () {
    var pill = $('#modePill'); if (!pill) return;
    var m = store.mode, cm = store.chainMode[state.net]; var p = (store.pulse || {})[state.net] || {};
    var label = m === 'boot' ? 'connecting…' : (cm === 'live' ? 'live · ' + (p.n || 0) + ' tokens' : m === 'demo' ? 'preview data, 15 Sep 2026' : 'offline, reconnecting…');
    pill.className = 'status mode-' + (cm === 'live' ? 'live' : m === 'demo' ? 'demo' : m === 'boot' ? 'boot' : 'offline');
    pill.innerHTML = '<span class="dot"></span><span class="lbl">' + label + '</span>';
    var bt = $('#buildTag'); if (bt && window.TL_BUILD) bt.textContent = 'v' + window.TL_BUILD.version + ' \u00b7 ' + window.TL_BUILD.built; // v1.36
    var list = $('#srcList'); if (!list) return;
    list.innerHTML = Object.keys(S.SOURCE_META).map(function (k) {
      var st = S.status[k] || { state: 'idle' }; var meta = S.SOURCE_META[k];
      return '<div class="s ' + st.state + '"><span class="dot"></span><span>' + meta.label + '<small>' + meta.desc + '</small></span><span class="st">' + (st.state === 'ok' ? 'ok · ' + U.esc(st.note) : st.state === 'err' ? 'unavailable · ' + U.esc(st.note) : 'idle') + '</span></div>';
    }).join('');
  };

  // ---------- the GMGN source: set up once (a server proxy for a live site, or a key in this browser for the local file) ----------
  // Visitors of a site never see any of this: the header shows a state pill only when the source is already connected.
  var GM_LABEL = { na: 'GMGN: local file only', off: 'not connected', connecting: 'GMGN connecting…', ok: 'GMGN live', auth: 'GMGN key rejected', limited: 'GMGN paused', error: 'GMGN unreachable' };
  function gmState() { var G = TL.gmgn; return !G ? 'na' : !G.available() ? 'na' : G.configured() ? G.state : 'off'; }
  ui.renderGmgn = function () {
    var G = TL.gmgn; if (!G) return;
    var st = gmState();
    var pill = $('#gmPill');
    if (pill) { pill.className = 'status gm-pill gm-' + st; pill.innerHTML = '<span class="dot"></span><span class="lbl">' + GM_LABEL[st] + '</span>'; pill.title = 'GMGN source: ' + G.statusNote(); }
    var card = $('#gmCard'); if (!card || card.hidden || !$('#srcModal').classList.contains('open')) return; // v1.40: hidden for visitors of the live site
    var focusedId = document.activeElement && (document.activeElement.id === 'gmKey' || document.activeElement.id === 'gmProxy') ? document.activeElement.id : '';
    var typed = focusedId ? $('#' + focusedId).value : '';
    var plans = Object.keys(G.PLANS).map(function (k) { return '<option value="' + k + '"' + (G.plan === k ? ' selected' : '') + '>' + G.PLANS[k].label + ' plan</option>'; }).join('');
    var stats = '';
    if (G.configured() && G.available()) {
      var line = function (chain, name) {
        var x = G.stat[chain]; if (!x) return '';
        var seen = !x.n && x.dropped ? ' (launchpads GMGN sent: ' + Object.keys(G.pads[chain] || {}).map(function (k) { return U.esc(k) + ' ' + G.pads[chain][k]; }).join(', ') + ')' : ''; // nothing trusted arrived: show the names, so a renamed launchpad is easy to spot
        return '<span><b>' + name + '</b> ' + x.n + ' tokens (' + x.counts.new_creation + ' new, ' + x.counts.near_completion + ' almost bonded, ' + x.counts.completed + ' migrated)' + (x.dropped ? ', ' + x.dropped + ' from other launchpads skipped' + seen : '') + ' · ' + U.fmtAge(U.now() - x.at) + ' ago</span>';
      };
      var minute = G.sent.filter(function (r) { return U.now() - r.at < 60000; }); var wsum = minute.reduce(function (a, r) { return a + r.w; }, 0);
      stats = '<div class="gm-stats">' + line('solana', 'Solana') + line('robinhood', 'Robinhood Chain') + '<span>' + minute.length + ' requests in the last minute, weight ' + wsum + (G.proxy ? '' : ' of ' + (G.PLANS[G.plan].rate * 60) + ' allowed') + '</span></div>';
    }
    if ((st === 'auth' || st === 'error' || st === 'limited' || st === 'ok') && card.dataset.keep !== '1') card.dataset.msg = ''; // the live state speaks louder than "connecting"
    var msg = card.dataset.msg || '';
    var det = card.querySelector('details');
    var openIt = (det && det.open) || card.dataset.open === '1' || G.configured() || st === 'auth' || st === 'error'; // a re-render must not fold the block while someone is setting it up
    card.innerHTML = '<details class="gm-det"' + (openIt ? ' open' : '') + '><summary><b>GMGN source</b><span class="muted">set up once, visitors see nothing</span><span class="gm-state gm-' + st + '"><span class="dot"></span>' + GM_LABEL[st] + '</span></summary>' +
      '<p class="gm-sub">The feeds, Top, token pages and Smart Tracking wallets can run on GMGN\'s data (rug risk, bundles, insiders, snipers, dev holdings, smart money and KOL wallets with their win rates). Two ways to turn it on, both invisible to the people using the site. Without either one Chameleon keeps running on the public sources.</p>' +
      (st === 'na' ? '<p class="gm-note">This preview has no outside network, so it cannot reach GMGN. Open the HTML file on your computer, or set the server address below on your site.</p>' : '') +
      '<div class="gm-row"><h5>1. On a live site: your server</h5><p class="gm-sub">One key lives on your server, the page asks your server instead of GMGN. Ready proxy: <code>server/gmgn_proxy.py</code> in the source archive (one file, caches answers and shares one rate limit across all visitors).' +
      (TL.CONFIG.gmgnProxyDefault ? ' The site\'s own address <code>' + U.esc(TL.CONFIG.gmgnProxyDefault) + '</code> is tried on every page load and used when the key is on the server' + (G.auto ? ': that is what runs now.' : '.') : '') +
      ' Another address can be pasted here, or given as <code>?gmgn=https://your-server/gmgn</code>.</p>' +
      '<div class="gm-form"><input class="inp" id="gmProxy" type="url" autocomplete="off" spellcheck="false" placeholder="https://your-server/gmgn" value="' + U.esc(G.proxy || '') + '"><button class="btn primary" id="gmProxySave">Use this server</button>' + (G.proxy && !G.auto ? '<button class="btn" id="gmProxyClear">Clear</button>' : '') + '</div></div>' +
      '<div class="gm-row"><h5>2. On this computer: your own key</h5><p class="gm-sub">For the local file, when there is no server yet. Create a key at <a href="https://gmgn.ai/ai" target="_blank" rel="noopener">gmgn.ai/ai</a> (sign in, create a key pair, upload the public key, then copy the API key). The key stays in this browser and is sent to openapi.gmgn.ai only. Never paste the private key: Chameleon only reads data and never trades, so it never needs it.</p>' +
      '<div class="gm-form"><input class="inp" id="gmKey" type="password" autocomplete="off" spellcheck="false" placeholder="' + (G.key ? 'Saved key ' + U.esc(G.maskedKey()) + ' · paste a new one to replace it' : 'Paste your GMGN API key') + '"' + (st === 'na' ? ' disabled' : '') + '>' +
      '<select class="sel" id="gmPlan" aria-label="GMGN plan">' + plans + '</select>' +
      '<button class="btn" id="gmSave"' + (st === 'na' ? ' disabled' : '') + '>' + (G.key ? 'Replace key' : 'Save key') + '</button>' + (G.key ? '<button class="btn" id="gmRemove">Remove key</button>' : '') + '</div></div>' +
      '<div class="gm-msg' + (st === 'auth' || st === 'error' ? ' bad' : '') + '">' + U.esc(msg || (G.configured() ? G.statusNote() : '')) + '</div>' + stats + '</details>';
    if (focusedId) { var el = $('#' + focusedId); if (el) { el.value = typed; el.focus(); } }
  };
  ui.openGmgn = function () { var c = $('#gmCard'); if (c && !c.hidden) c.dataset.open = '1'; $('#srcModal').classList.add('open'); ui.renderStatus(); ui.renderGmgn(); var d = $('#gmCard details'); if (d) d.open = true; };
  function gmSave() {
    var G = TL.gmgn, card = $('#gmCard'); if (!G) return;
    var val = $('#gmKey').value.trim(), plan = $('#gmPlan').value;
    if (!val) { if (G.key) { G.setPlan(plan); card.dataset.msg = 'Plan saved.'; } else card.dataset.msg = 'Paste the API key first.'; card.dataset.keep = '1'; ui.renderGmgn(); return; }
    var r = G.setKey(val, plan);
    card.dataset.msg = r === 'private' ? 'That looks like a private key. Chameleon never needs it: paste the API key instead. Nothing was saved.' : r === 'format' ? 'An API key has no spaces or line breaks. Nothing was saved.' : 'Key stored in this browser. Connecting to GMGN…';
    card.dataset.keep = r === 'ok' ? '' : '1';
    $('#gmKey').value = ''; ui.renderGmgn();
    setTimeout(function () { if (card.dataset.msg && /Connecting/.test(card.dataset.msg)) { card.dataset.msg = ''; ui.renderGmgn(); } }, 6000);
  }
  function gmProxySave(clear) {
    var G = TL.gmgn, card = $('#gmCard'); if (!G) return;
    var val = clear ? '' : $('#gmProxy').value.trim();
    var r = G.setProxy(val);
    card.dataset.msg = r === 'format' ? 'A server address looks like https://your-server/gmgn. Nothing was saved.' : clear || !val ? 'Server address removed.' : 'Server stored. Asking it for the feeds…';
    card.dataset.keep = r === 'format' || clear || !val ? '1' : '';
    ui.renderGmgn();
  }

  // ---------- tooltip ----------
  var tipEl;
  ui.tip = {
    show: function (ev, html) {
      tipEl.innerHTML = html; tipEl.classList.add('show'); ui.tip.move(ev);
    },
    move: function (ev) { var x = ev.clientX + 14, y = ev.clientY + 14; var w = tipEl.offsetWidth, h = tipEl.offsetHeight; if (x + w > innerWidth - 8) x = ev.clientX - w - 10; if (y + h > innerHeight - 8) y = ev.clientY - h - 10; tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; },
    hide: function () { tipEl.classList.remove('show'); }
  };
  function helpHtml(key) { var h = H[key]; if (!h) return ''; return '<b>' + h.t + '</b>' + h.w + '<span class="why">' + h.y + '</span>'; }


  // ---------- events ----------
  function toggleWatch(id) {
    var t = store.get(id); var on = !state.watch[id];
    if (on) state.watch[id] = U.now(); else delete state.watch[id];
    LS.set('watch', state.watch); if (store.save) store.save(); if (TL.account) TL.account.push(); // a star follows the wallet when an account API is configured
    ui.invalidate(); if (state.page) ui.renderToken(); else { ui.renderControls(); ui.renderFeed(); }
    var n = Object.keys(state.watch).length;
    toast(on ? (t ? t.symbol : 'Token') + ' added to your watchlist (' + n + ' token' + (n === 1 ? '' : 's') + '). The star button above the feed shows it.' : (t ? t.symbol : 'Token') + ' removed from your watchlist' + (n ? ' (' + n + ' left)' : ''));
  }
  function copyText(text) {
    var done = function () { toast('Contract copied: ' + text.slice(0, 6) + '…' + text.slice(-4)); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Copy blocked by the browser, select the address in the panel instead'); });
    else { try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (e) { toast('Copy failed'); } }
  }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  ui.toast = toast; // v1.49: other modules say a short thing the same way
  function applyTheme() { var root = document.documentElement; if (state.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', state.theme); }
  function openDrawer(open) { $('#drawer').classList.toggle('open', open); $('#scrim').classList.toggle('open', open); if (open) renderDrawer(); }
  function activeFilterCount() {
    var f = state.f, d = defaultFilters(), n = 0;
    Object.keys(d).forEach(function (k) { var a = f[k], b = d[k]; if (Array.isArray(a) ? a.length : (a !== b && a !== '' && a !== 0 && a !== false)) n++; });
    return n;
  }
  function renderDrawer() {
    var f = state.f;
    $$('#drawer [data-f]').forEach(function (el) {
      var k = el.dataset.f;
      if (el.type === 'checkbox') el.checked = !!f[k];
      else if (el.tagName === 'SELECT') el.value = String(f[k] || 0);
      else el.value = f[k] ? f[k] : '';
    });
    var skipped = S.droppedLaunchpads || 0;
    $('#lpNote').textContent = state.net === 'solana' ? 'Solana: pump.fun launches only.' + (skipped ? ' ' + skipped + ' launches from other launchpads skipped this session.' : '') : 'Robinhood Chain: Pons launches only.';
  }
  function resetFilters() { state.f = defaultFilters(); state.q = ''; $('#search').value = ''; ui.renderAll(); }
  function setNet(net) {
    state.net = net; LS.set('net', net); state.limit = 100;
    if (state.tab === 'xray' && !state.page) { if (location.hash === '#/smart') { $$('#netSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.net === state.net ? 'true' : 'false'); }); if (TL.smart) TL.smart.home(); } else location.hash = '#/smart'; return; } // Smart Tracking: the wallets of that network
    if (state.page || state.tab !== 'trenches') { location.hash = '#/'; if (!state.page) ui.route(); return; } // the switch leads to that network's feed
    ui.renderAll(); ui.preloadLogos(ui.visible()); if (S.resolveLogos) S.resolveLogos(ui.visibleIds());
    if (TL.gmgn && TL.gmgn.active()) { TL.gmgn.forget('trenches:' + net); TL.gmgn.tick(); }
  }
  // ---------- v1.34: the second part of the site. The BTC Prediction Machine (Polymarket Bitcoin Up or Down, 15 / 5 minutes),
  // its course and its Polymarket smart-trader scanner run as their own Node server (BTC-Machine-kit/1-PULSE-terminal). Here
  // they are tabs: each one is that server's page inside this page, behind the same header, in this skin. The server address
  // comes from ?terminal=, else the same origin under /btc, else localhost:8787 when this file is opened from disk.
  var EMBED = { btc: { path: '/', title: 'BTC Prediction Machine', sub: 'Polymarket Bitcoin Up or Down \u00b7 15 / 5 min' }, course: { path: '/course', title: 'Course', sub: 'fifteen lessons on the 15 / 5 minute rounds' }, poly: { path: '/smart', title: 'Smart traders on Polymarket', sub: 'who to copy, who not' } };
  var embedState = {};
  var EMBED_TABS = ['btc', 'course', 'poly'], EXTRA_TABS = EMBED_TABS.concat(['bot', 'about', 'roadmap', 'gate', 'valley']); // v1.43: every tab that is not the feed, Smart Tracking or a token page; v1.52: the public pages and the gate
  ui.btcServer = function () {
    // v1.38: opened through the kit on this computer (localhost/trenchlight): the local terminal wins over the live one, so a local check stays local
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /^\/trenchlight\b/.test(location.pathname)) return location.origin;
    if (TL.CONFIG.btcServer) return TL.CONFIG.btcServer.replace(/\/+$/, '');
    if (!/^https?:/.test(location.protocol)) return 'http://localhost:8787';           // opened from disk: the kit's default port
    if (/^\/trenchlight\b/.test(location.pathname)) return location.origin;              // served by the kit itself (its /trenchlight page)
    return location.origin + '/btc';                                                      // deployed: the same domain proxies /btc to the kit
  };
  function renderEmbed(tab) {
    var el = $('#tab' + tab.charAt(0).toUpperCase() + tab.slice(1)); if (!el) return;
    var E = EMBED[tab], base = ui.btcServer();
    var st = embedState[tab] = embedState[tab] || { probed: 0, ok: null };
    var frameHtml = function () { return '<div class="embed-head"><b>' + E.title + '</b><span class="muted">' + E.sub + '</span><a class="btn small" href="' + U.esc(base + E.path) + '" target="_blank" rel="noopener">Open in its own tab</a></div><iframe class="embed-frame" src="' + U.esc(base + E.path + (E.path.indexOf('?') < 0 ? '?' : '&') + 'embed=chameleon&theme=' + (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark')) + '" title="' + U.esc(E.title) + '" loading="eager" allow="clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>'; }; // v1.59: sandboxed: the partner's page cannot steer this window
    var helpHtml = function (why) {
      var local = !/^https?:/.test(location.protocol);
      if (!local && TL.CONFIG.btcServer) { // v1.39: a live site with a known server: a short note, no setup advice for visitors
        return '<div class="embed-note"><h3>' + E.title + '</h3><p>' + (why ? U.esc(why) + '. ' : '') + 'This part of Chameleon runs on its own server and it is not reachable right now. It usually comes back within a minute.</p><p><button class="btn" id="embedRetry">Try again</button></p></div>';
      }
      return '<div class="embed-note"><h3>' + E.title + '</h3><p>' + (why ? U.esc(why) + '. ' : '') + 'This part runs as its own server (the BTC-Machine kit, folder <code>1-PULSE-terminal</code>) and this tab is a window into it.</p>' +
        (local ? '<p>Start it, then reload this page:</p><pre>cd 1-PULSE-terminal\nnpm start        # or double-click start.command (macOS) / start.bat (Windows)</pre><p class="muted">Looking for it at <code>' + U.esc(base) + '</code>. Another address: open this file with <code>?terminal=http://host:port</code>.</p>'
          : '<p class="muted">Looking for it at <code>' + U.esc(base) + '</code>. On a deployed site the server usually lives at its own subdomain (btc.your-domain.com) and this page is opened with <code>?terminal=https://btc.your-domain.com</code>, or the same domain proxies <code>/btc/</code> to it.</p>') +
        '<p><button class="btn" id="embedRetry">Try again</button></p></div>';
    };
    if (st.ok === true && el.querySelector('iframe')) return;
    el.innerHTML = '<div class="embed-note"><h3>' + E.title + '</h3><p class="muted">Looking for the terminal at <code>' + U.esc(base) + '</code>\u2026</p></div>';
    U.timeoutFetch(base + '/api/health', 5000).then(function (h) {
      if (!h || !h.ok) throw new Error('no answer');
      st.ok = true; el.innerHTML = frameHtml();
    }, function () {
      st.ok = false; el.innerHTML = helpHtml('The terminal did not answer');
      var rb = $('#embedRetry'); if (rb) rb.addEventListener('click', function () { st.ok = null; renderEmbed(tab); });
    });
  }
  ui.renderTabs = function () { EMBED_TABS.forEach(function (k) { if (state.tab === k) { embedState[k] = {}; renderEmbed(k); } }); };
  // ---------- v2.00: Chameleon Valley. The game's page is the site's folder /valley/ (TL.CONFIG.valleyPage), shown here in a frame of
  // the same site: Phantom does not inject itself into frames, and a frame of the same site may borrow this page's Phantom. The frame is
  // made when the tab opens and dropped when the tab is left, so the player's place in the valley is free again at once. The line above
  // it says how many play right now (valley.<domain>/api/status); "Open full screen" opens the game as a page of its own.
  var valleyTimer = null;
  function valleyStatus() {
    var el = $('#valleyOnline'), api = TL.CONFIG.valleyApi; if (!el) return;
    if (!api) { el.textContent = 'an online farm of 100 chameleons'; return; }
    U.timeoutFetch(api + '/api/status', 6000).then(function (s) {
      if (!s || !s.ok) throw new Error('no answer');
      el.textContent = s.online + ' / ' + s.slots + ' chameleons online' + (s.walkers ? ' \u00b7 ' + s.walkers + ' walking' : '') + ' \u00b7 connect Phantom and play, no tokens';
      el.classList.remove('bad');
    }, function () { el.textContent = 'the valley server is not answering right now'; el.classList.add('bad'); });
  }
  function renderValley() {
    var el = $('#tabValley'), page = TL.CONFIG.valleyPage; if (!el) return;
    if (!page) { el.innerHTML = '<div class="embed-note"><h3>Chameleon Valley</h3><p>The game opens on the site itself: chameleonscope.com, tab Valley.</p></div>'; return; }
    if (!el.querySelector('iframe')) {
      el.innerHTML = '<div class="embed-head"><b>Chameleon Valley</b><span class="muted" id="valleyOnline">\u2026</span><a class="btn small" href="' + U.esc(page) + '" target="_blank" rel="noopener">Open full screen</a></div>' +
        '<iframe class="embed-frame valley-frame" src="' + U.esc(page) + '" title="Chameleon Valley" allow="clipboard-write; fullscreen; autoplay"></iframe>';
      var f = el.querySelector('iframe'); if (f) f.addEventListener('load', function () { try { f.focus(); } catch (e) {} });
    }
    valleyStatus(); clearInterval(valleyTimer); valleyTimer = setInterval(valleyStatus, 15000);
  }
  function dropValley() { clearInterval(valleyTimer); valleyTimer = null; var el = $('#tabValley'); if (el && el.querySelector('iframe')) el.innerHTML = ''; }
  // v1.43: seven tabs no longer fit a phone screen; the strip scrolls sideways, and the open tab is brought into view (sideways only)
  ui.revealTab = function () {
    var strip = $('#siteTabs'), b = strip && strip.querySelector('button[aria-pressed="true"]'); if (!strip || !b || strip.scrollWidth <= strip.clientWidth + 2) { ui.tabEdges(); return; }
    var want = b.offsetLeft - (strip.clientWidth - b.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, Math.min(want, strip.scrollWidth - strip.clientWidth));
    ui.tabEdges();
  };
  // v1.50: on a narrow desktop the strip is the part of the one-line header that gives way; a fade on the side that hides more tabs says so
  ui.tabEdges = function () {
    var strip = $('#siteTabs'); if (!strip) return;
    var more = strip.scrollWidth > strip.clientWidth + 2;
    strip.classList.toggle('fade-r', more && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
    strip.classList.toggle('fade-l', more && strip.scrollLeft > 2);
  };
  // v1.44: the network switch belongs to the memecoin part only (Trenches and Smart Tracking have a feed per network). On every
  // other tab, and on a token page, it is hidden: there it only led away from the page the person was reading
  ui.showNetSwitch = function (on) { var el = $('#netSwitch'); if (el) el.hidden = !on; };
  ui.setTab = function (tab, keepScroll) {
    state.tab = tab;
    $$('#siteTabs button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tab === tab ? 'true' : 'false'); });
    ui.revealTab();
    $$('#netSwitch button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.net === state.net ? 'true' : 'false'); });
    ui.showNetSwitch(tab === 'trenches' || tab === 'xray');
    $('#tabTrenches').hidden = tab !== 'trenches'; $('#tabXray').hidden = tab !== 'xray'; $('#tabToken').hidden = true;
    EXTRA_TABS.forEach(function (k) { var el = $('#tab' + k.charAt(0).toUpperCase() + k.slice(1)); if (el) el.hidden = tab !== k; });
    // v1.43: the Trading bot tab is a page of its own (src/app_bottab.js), told when it is shown and when it is left (v1.94: the Mint NFT tab is gone)
    if (tab !== 'bot' && TL.bottab) TL.bottab.hide();
    if (tab !== 'valley') dropValley(); else renderValley(); // v2.00: the game runs only while its tab is open
    if (tab === 'trenches') ui.renderAll(); else if (tab === 'xray') { if (TL.xray && TL.xray.onShow) TL.xray.onShow(); } else if (tab === 'bot') { if (TL.bottab) TL.bottab.show(); } else if (EMBED_TABS.indexOf(tab) >= 0) renderEmbed(tab); // v1.52: About, Roadmap and the gate are plain sections
    if (!keepScroll) window.scrollTo({ top: 0 });
  };

  // GMGN-style logo preview: hover a token picture anywhere and a big copy opens beside it (mouse only, 150 ms delay)
  var zoomTimer = null;
  function showZoom(logo) {
    var img = logo.querySelector('img'); if (!img || !(img.classList.contains('ready') || (img.complete && img.naturalWidth > 0))) return;
    var z = $('#logoZoom'); var zi = z.querySelector('img'); var src = img.getAttribute('src').replace('img-width=128&img-dpr=2', 'img-width=520&img-dpr=1'); // pinata serves a sharper copy for the big preview
    if (zi.getAttribute('src') !== src) { zi.setAttribute('src', src); zi.onerror = function () { zi.onerror = null; zi.setAttribute('src', img.getAttribute('src')); }; }
    var box = logo.closest('.row, .tp-head, .chart-title, .x-token, .tp-chip'); var symEl = box && box.querySelector('.sym');
    z.querySelector('.cap').textContent = symEl ? symEl.textContent : '';
    var r = logo.getBoundingClientRect(); var size = 260; var pad = 12;
    var left = r.right + pad; if (left + size > window.innerWidth - 8) left = r.left - size - pad; if (left < 8) left = 8;
    var top = Math.min(Math.max(8, r.top - (size - r.height) / 2), window.innerHeight - size - 40);
    z.style.left = left + 'px'; z.style.top = top + 'px'; z.classList.add('show');
  }
  function hideZoom() { clearTimeout(zoomTimer); zoomTimer = null; var z = $('#logoZoom'); if (z) z.classList.remove('show'); }
  // ---------- v1.34: search across everything the terminal knows, both networks, every stage, hidden tokens included ----------
  // The feed filter stays (typing narrows the list on screen); the dropdown answers the other question: "I saw this ticker or
  // contract somewhere, where is it?" A contract the store has never met opens as a token page anyway (the page polls it).
  function looksLikeAddress(q) { return /^0x[0-9a-fA-F]{40}$/.test(q) ? 'robinhood' : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? 'solana' : null; }
  function searchIndex(q) {
    var ql = q.toLowerCase(), out = [];
    store.all().forEach(function (t) {
      if (!t.symbol && !t.name && !t.address) return;
      var sym = (t.symbol || '').toLowerCase(), nm = (t.name || '').toLowerCase(), ad = (t.address || '').toLowerCase();
      var rank = sym === ql ? 0 : sym.indexOf(ql) === 0 ? 1 : ad.indexOf(ql) === 0 ? 2 : nm.indexOf(ql) === 0 ? 3 : sym.indexOf(ql) >= 0 ? 4 : nm.indexOf(ql) >= 0 ? 5 : (ql.length >= 6 && ad.indexOf(ql) >= 0) ? 6 : -1;
      if (rank < 0) return;
      out.push({ t: t, rank: rank });
    });
    out.sort(function (a, b) { return a.rank - b.rank || (b.t.mc || 0) - (a.t.mc || 0) || (b.t.createdAt || 0) - (a.t.createdAt || 0); });
    return out.slice(0, 12).map(function (x) { return x.t; });
  }
  function searchRowHtml(t, i) {
    TL.ensureVet(t);
    var CL = TL.calls, rec = CL ? CL.forToken(t) : null;
    var st = t.top ? 'Top' : (TL.STAGE_LABEL[t.stage] || '');
    var status = t.verdict ? '<span class="verdict ' + t.verdict + '">' + t.verdict + '</span>' : '';
    var why = t.ready && !t._ok && t._hide ? '<small class="sr-why">hidden: ' + U.esc(t._hide) + '</small>' : (rec ? '<small class="sr-why ok">called at ' + U.fmtUsd(rec.mc) + (U.isNum(rec.nowX) ? ' \u00b7 ' + CL.fmtX(rec.nowX) + ' now' : '') + '</small>' : '');
    return '<a class="sr" role="option" aria-selected="' + (i === 0) + '" href="' + ui.tokenHref(t) + '" data-href="' + ui.tokenHref(t) + '">' +
      '<span class="sr-logo">' + logoHtml(t, false) + '</span>' +
      '<span class="sr-id"><b>' + U.esc(t.symbol || U.short(t.address)) + '</b><span class="nm">' + U.esc(t.name || '') + '</span>' + why + '</span>' +
      '<span class="sr-meta"><span class="qbadge">' + (t.chain === 'solana' ? 'SOL' : 'HOOD') + '</span>' + (st ? '<span class="muted">' + U.esc(st) + '</span>' : '') + (U.isNum(t.mc) ? '<span class="num">' + U.fmtUsd(t.mc) + '</span>' : '') + (U.isNum(t.createdAt) ? '<span class="muted num">' + U.fmtAge(U.now() - t.createdAt) + '</span>' : '') + (state.watch[t.id] ? '<span class="sr-star">' + STAR_SVG + '</span>' : '') + status + '</span></a>';
  }
  function renderSearchDrop(q) {
    var drop = $('#searchDrop'); if (!drop) return;
    q = String(q || '').trim();
    if (q.length < 2) { drop.hidden = true; drop.innerHTML = ''; return; }
    var rows = searchIndex(q), html = rows.map(searchRowHtml).join('');
    var chain = looksLikeAddress(q);
    if (chain && !rows.some(function (t) { return t.address.toLowerCase() === q.toLowerCase(); })) {
      var addr = chain === 'robinhood' ? q.toLowerCase() : q;
      html += '<a class="sr sr-open" role="option" aria-selected="' + (!rows.length) + '" href="' + ui.tokenHref({ chain: chain, address: addr }) + '" data-href="' + ui.tokenHref({ chain: chain, address: addr }) + '"><span class="sr-logo"><span class="logo" style="--h:' + U.hue(addr) + '"><b>' + U.esc(addr.slice(0, 2)) + '</b></span></span><span class="sr-id"><b>Open ' + U.esc(U.short(addr)) + '</b><span class="nm">not in the feed yet: the token page reads it from ' + (chain === 'solana' ? 'Solana' : 'Robinhood Chain') + '</span></span><span class="sr-meta"><span class="qbadge">' + (chain === 'solana' ? 'SOL' : 'HOOD') + '</span></span></a>' +
        '<a class="sr sr-open" role="option" aria-selected="false" href="#/smart/' + (chain === 'solana' ? 'sol' : 'hood') + '/' + encodeURIComponent(addr) + '" data-href="#/smart/' + (chain === 'solana' ? 'sol' : 'hood') + '/' + encodeURIComponent(addr) + '"><span class="sr-logo"><span class="logo"><b>ST</b></span></span><span class="sr-id"><b>Smart Tracking</b><span class="nm">the wallets inside it</span></span><span class="sr-meta"></span></a>';
    }
    if (!html) html = '<div class="sr-empty">Nothing named like that among the ' + U.fmtNum(store.all().length) + ' tokens the terminal knows. Paste a contract to open any token.</div>';
    drop.innerHTML = html; drop.hidden = false;
    $$('.sr-logo .logo img', drop).forEach(bindLogo);
  }
  ui.renderSearchDrop = renderSearchDrop;
  ui.bind = function () {
    tipEl = $('#tip');
    if (window.matchMedia && !window.matchMedia('(hover: none)').matches) {
      document.addEventListener('mouseover', function (ev) { var logo = ev.target.closest('.logo'); if (!logo || logo.closest('#logoZoom')) return; clearTimeout(zoomTimer); zoomTimer = setTimeout(function () { showZoom(logo); }, 150); });
      document.addEventListener('mouseout', function (ev) { if (ev.target.closest('.logo')) hideZoom(); });
      document.addEventListener('scroll', hideZoom, true);
    }
    document.addEventListener('mouseover', function (ev) {
      var pl = ev.target.closest('[data-post]');
      if (pl) {
        var c = S.tweetCached(pl.dataset.post);
        if (c) ui.tip.show(ev, c.gone ? '<b>Launch post is gone</b>deleted or suspended' : '<b>' + U.esc(c.author || c.user) + ' · ' + U.esc(c.date || '') + '</b>' + U.esc(c.text).replace(/\n/g, '<br>') + (c.hasMedia ? '<span class="why">has a photo or video</span>' : ''));
        else { ui.tip.show(ev, '<b>Launch post</b>loading…'); var row = pl.closest('.row'); var t = row ? store.get(row.dataset.id) : null; S.fetchTweet(pl.dataset.post, t).then(function () { if (pl.matches(':hover')) { var ev2 = { clientX: ev.clientX, clientY: ev.clientY }; var c2 = S.tweetCached(pl.dataset.post); ui.tip.show(ev2, c2.gone ? '<b>Launch post is gone</b>deleted or suspended' : '<b>' + U.esc(c2.author || c2.user) + ' · ' + U.esc(c2.date || '') + '</b>' + U.esc(c2.text).replace(/\n/g, '<br>')); } if (t) ui.markDirty(t); }).catch(function () { ui.tip.hide(); }); }
        return;
      }
      var h = ev.target.closest('[data-help]'); if (!h || h.closest('.tip')) return; ui.tip.show(ev, helpHtml(h.dataset.help));
    });
    document.addEventListener('mouseout', function (ev) { if (ev.target.closest('[data-post]')) ui.tip.hide(); });
    document.addEventListener('mouseout', function (ev) { if (ev.target.closest('[data-help]')) ui.tip.hide(); });
    document.addEventListener('mousemove', function (ev) { if (tipEl.classList.contains('show') && ev.target.closest('[data-help]')) ui.tip.move(ev); });
    $('#feed').addEventListener('click', function (ev) {
      var act = ev.target.closest('[data-act]'); var row = ev.target.closest('.row'); var ext = ev.target.closest('[data-href]');
      if (row && act) { // buttons inside the row link: star, chart preview, copy
        ev.preventDefault(); ev.stopPropagation();
        if (act.dataset.act === 'watch') toggleWatch(row.dataset.id);
        else if (act.dataset.act === 'chart') openChart(store.get(row.dataset.id));
        else if (act.dataset.act === 'copy') { var ct = store.get(row.dataset.id); if (ct) copyText(ct.address); }
        return;
      }
      if (row && ext) { ev.preventDefault(); ev.stopPropagation(); window.open(ext.dataset.href, '_blank', 'noopener'); return; } // socials, X search, the launch post
      if (act && act.dataset.act === 'more') { state.limit += 100; ui.renderFeed(); return; }
      if (act && act.dataset.act === 'resetFilters') { resetFilters(); return; }
      if (row && ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey) { state.feedScrollY = window.scrollY; state.navFromFeed = true; } // the link itself opens the token page
    });
    $('#feed').addEventListener('auxclick', function (ev) { var ext = ev.target.closest('[data-href]'); if (ext && ev.button === 1) { ev.preventDefault(); window.open(ext.dataset.href, '_blank', 'noopener'); } });
    $('#tabToken').addEventListener('click', function (ev) {
      var act = ev.target.closest('[data-act]'); if (!act) return;
      if (act.dataset.act === 'back') { if (ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) { ev.preventDefault(); goBack(); } return; }
      var t = store.get(state.page); if (!t) return;
      if (act.dataset.act === 'watch') toggleWatch(t.id);
      else if (act.dataset.act === 'copy') copyText(t.address);
      else if (act.dataset.act === 'copyDev' && t.dev.address) copyText(t.dev.address);
      else if (act.dataset.act === 'embedPost') embedPost(t);
      else if (act.dataset.act === 'gmgnConnect') ui.openGmgn();
    });
    window.addEventListener('hashchange', ui.route);
    $('#netSwitch').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; setNet(b.dataset.net); });
    $('#siteTabs').addEventListener('scroll', function () { ui.tabEdges(); }, { passive: true });
    window.addEventListener('resize', function () { ui.tabEdges(); });
    $('#siteTabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var h = b.dataset.tab === 'xray' ? '#/smart' : EXTRA_TABS.indexOf(b.dataset.tab) >= 0 ? '#/' + b.dataset.tab : '#/';
      if (location.hash === h || (h === '#/' && !location.hash)) ui.route(); else location.hash = h;
    });
    $('#topAge').addEventListener('click', function (ev) { var b = ev.target.closest('[data-age]'); if (!b) return; state.topAge = +b.dataset.age; LS.set('topAge2', state.topAge); state.limit = 100; ui.renderAll(); if (TL.gmgn && TL.gmgn.active()) TL.gmgn.tick(); });
    $('#stageChips').addEventListener('click', function (ev) { var b = ev.target.closest('[data-group]'); if (!b) return; state.group = b.dataset.group; state.watchOnly = false; state.qOnly = false; state.limit = 100; ui.renderAll(); if (state.group === 'top' && S.ensureTop && store.mode !== 'demo') S.ensureTop(state.net).then(function (n) { if (n) { store.recompute(); ui.renderAll(); } }); });
    $('#watchBtn').addEventListener('click', function () { state.watchOnly = !state.watchOnly; if (state.watchOnly) state.qOnly = false; state.limit = 100; ui.renderAll(); });
    ui.setQuantum = function (on) { state.qOnly = !!on; if (state.qOnly) state.watchOnly = false; state.limit = 100; ui.invalidate(); ui.renderAll(); }; // v2.20
    var qbtn = $('#qBtn'); if (qbtn) qbtn.addEventListener('click', function () { ui.setQuantum(!state.qOnly); });
    var feedEl = $('#feed');
    feedEl.addEventListener('mouseenter', function () { state.hovering = true; });
    feedEl.addEventListener('mouseleave', function () { state.hovering = false; if (renderDeferred) { renderDeferred = false; ui.renderAll(); } });
    feedEl.addEventListener('mousemove', function () { state.lastTouch = U.now(); });
    document.addEventListener('pointerdown', function () { state.lastTouch = U.now(); });
    document.addEventListener('wheel', function () { state.lastTouch = U.now(); }, { passive: true });
    $('#sort').addEventListener('change', function (ev) { state.sortBy[state.group] = ev.target.value; LS.set('sortBy', state.sortBy); ui.renderControls(); ui.renderFeed(); });
    $('#search').addEventListener('input', function (ev) { state.q = ev.target.value.trim(); ui.renderControls(); ui.renderFeed(); renderSearchDrop(state.q); });
    $('#search').addEventListener('focus', function () { if (state.q) renderSearchDrop(state.q); });
    $('#search').addEventListener('keydown', function (ev) {
      var drop = $('#searchDrop'); if (drop.hidden) { if (ev.key === 'Enter') renderSearchDrop(state.q); return; }
      var rows = $$('.sr', drop); var i = rows.findIndex(function (r) { return r.getAttribute('aria-selected') === 'true'; });
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); var n = rows.length; if (!n) return; i = ev.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n; rows.forEach(function (r, k) { r.setAttribute('aria-selected', k === i ? 'true' : 'false'); }); return; }
      if (ev.key === 'Enter') { ev.preventDefault(); var pick = rows[i >= 0 ? i : 0]; if (pick) pick.click(); return; }
      if (ev.key === 'Escape') { drop.hidden = true; }
    });
    document.addEventListener('click', function (ev) { if (!ev.target.closest('#searchWrap')) { var d = $('#searchDrop'); if (d) d.hidden = true; } });
    $('#searchDrop').addEventListener('click', function (ev) {
      var r = ev.target.closest('.sr'); if (!r) return; ev.preventDefault();
      $('#searchDrop').hidden = true;
      if (r.dataset.href) { location.hash = r.dataset.href; }
    });
    $('#filtersBtn').addEventListener('click', function () { openDrawer(true); });
    var qh = $('#qHero'); if (qh) qh.addEventListener('click', function (ev) { // v2.21: the Quantum radar's own buttons
      if (ev.target.closest('[data-act="qOnly"]')) { ev.preventDefault(); ui.setQuantum(!state.qOnly); if (state.qOnly) { var fh = $('.feed-head'); if (fh && fh.scrollIntoView) fh.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
      if (ev.target.closest('[data-act="qSol"]')) { ev.preventDefault(); setNet('solana'); }
    });
    $('#dayBar').addEventListener('click', function (ev) {
      var nb = ev.target.closest('#notifyBtn'); // browser notifications for calls: asked for on a click, never on load
      if (nb) { ev.preventDefault(); try { Notification.requestPermission().then(function () { ui.renderDay(); toast(Notification.permission === 'granted' ? 'Calls will notify you in the background' : 'Notifications stay off'); }); } catch (e) {} return; }
      if (ev.target.closest('#alertsChip')) { ev.preventDefault(); ui.setAlerts('on'); return; }
      if (ev.target.closest('[data-act="qOnly"]')) { ev.preventDefault(); ui.setQuantum(!state.qOnly); if (state.qOnly) { var fh = $('.feed-head'); if (fh && fh.scrollIntoView) fh.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; } // v2.20
      var b = ev.target.closest('#dayToggle'); if (!b) return; ev.preventDefault(); state.dayOpen = !state.dayOpen; ui.renderDay(); });
    // v1.41: the bell in the header: call cards on this site on or off (the Calls strip keeps the record either way)
    ui.setAlerts = function (v) {
      state.alerts = v === 'off' ? 'off' : 'on'; LS.set('alerts', state.alerts);
      var bb = $('#bellBtn'); if (bb) { bb.setAttribute('aria-pressed', state.alerts === 'on' ? 'true' : 'false'); bb.title = state.alerts === 'on' ? 'Call cards are on: click to switch them off on this site' : 'Call cards are off on this site: click to switch them on'; }
      if (state.alerts === 'off') $$('#alerts .al').forEach(function (el) { el.remove(); });
      ui.renderDay();
      toast(state.alerts === 'on' ? 'Call cards on' : 'Call cards off. The Calls strip keeps every call.');
    };
    var bell = $('#bellBtn'); if (bell) { bell.addEventListener('click', function () { ui.setAlerts(state.alerts === 'on' ? 'off' : 'on'); }); bell.setAttribute('aria-pressed', state.alerts === 'on' ? 'true' : 'false'); bell.title = state.alerts === 'on' ? 'Call cards are on: click to switch them off on this site' : 'Call cards are off on this site: click to switch them on'; }
    $('#winSeg').addEventListener('click', function (ev) { var b = ev.target.closest('[data-win]'); if (!b) return; state.win = b.dataset.win; LS.set('win', state.win); ui.renderAll(); });
    $('#drawerClose').addEventListener('click', function () { openDrawer(false); });
    $('#scrim').addEventListener('click', function () { openDrawer(false); });
    $('#drawer').addEventListener('input', function (ev) {
      var el = ev.target; var f = state.f; var k = el.dataset.f; if (!k) return;
      if (el.type === 'checkbox') f[k] = el.checked;
      else if (el.type === 'number' || el.tagName === 'SELECT') f[k] = +el.value || 0;
      else f[k] = el.value;
      ui.renderControls(); ui.renderFeed();
    });
    $('#resetBtn').addEventListener('click', function () { resetFilters(); renderDrawer(); });
    // v1.34: the account menu; v1.94: Phantom only, the data stays in this browser
    var AC = TL.account;
    if (AC) {
      var acctBtn = $('#acctBtn'), acctMenu = $('#acctMenu');
      var paintAcct = function () { acctBtn.textContent = AC.statusText(); acctBtn.classList.toggle('on', AC.signedIn()); acctBtn.classList.toggle('premium', AC.premium()); if (!acctMenu.hidden) acctMenu.innerHTML = AC.menuHtml(); };
      AC.on('change', function (why) { paintAcct(); if (why) toast(String(why)); ui.renderTabs && ui.renderTabs(); });
      AC.on('sync', paintAcct);
      acctBtn.addEventListener('click', function (ev) { ev.stopPropagation(); acctMenu.hidden = !acctMenu.hidden; if (!acctMenu.hidden) acctMenu.innerHTML = AC.menuHtml(); });
      acctMenu.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-ac]'); if (!b) return; ev.preventDefault();
        if (b.dataset.ac === 'in') { b.disabled = true; b.textContent = 'Check your wallet\u2026'; AC.signIn(b.dataset.id).then(function () { acctMenu.hidden = true; toast('Signed in as ' + AC.short()); }, function (e) { toast('Sign-in did not go through: ' + (e && e.message || 'cancelled')); acctMenu.innerHTML = AC.menuHtml(); }); }
        else if (b.dataset.ac === 'out') { AC.signOut(); acctMenu.hidden = true; }
      });
      document.addEventListener('click', function (ev) { if (!ev.target.closest('#acct')) acctMenu.hidden = true; });
      paintAcct();
    }
    // v1.35: the person's own RPC nodes, saved in this browser, applied at once (every call reads the config at call time)
    var rpcMsg = function (t) { var m = $('#rpcMsg'); if (m) m.textContent = t; };
    var rpcInit = function () { var a = $('#rpcSol'), b = $('#rpcHood'); if (a && !/publicnode/.test(TL.CONFIG.solRpc) && !TL.CONFIG.apiOverride) a.value = TL.CONFIG.solRpc; if (b && TL.CONFIG.hoodRpcOwn) b.value = TL.CONFIG.hoodRpcOwn; };
    rpcInit();
    var saveRpc = function (which) {
      var inp = $(which === 'sol' ? '#rpcSol' : '#rpcHood'); var v = String(inp.value || '').trim();
      if (v && !/^https:\/\//.test(v)) { rpcMsg('The node address must start with https://'); return; }
      try { if (v) localStorage.setItem(which === 'sol' ? 'tl.solRpc' : 'tl.hoodRpc', v); else localStorage.removeItem(which === 'sol' ? 'tl.solRpc' : 'tl.hoodRpc'); } catch (e) {}
      if (which === 'sol') { TL.CONFIG.solRpc = v || 'https://solana-rpc.publicnode.com'; rpcMsg(v ? 'Solana reads go to your node from now on. Curves refresh within seconds.' : 'Back to the public Solana node.'); }
      else { var R = TL.CONFIG.hoodRpcs; ['logs', 'tail', 'state'].forEach(function (role) { R[role] = R[role].filter(function (u) { return u !== TL.CONFIG.hoodRpcOwn; }); if (v) R[role].unshift(v); }); TL.CONFIG.hoodRpcOwn = v; TL.CONFIG.hoodRpc = R.logs[0]; rpcMsg(v ? 'Robinhood Chain reads go to your node first from now on.' : 'Back to the public Robinhood Chain nodes.'); }
      toast(v ? 'Node saved' : 'Node removed');
    };
    var rs = $('#rpcSolSave'), rh = $('#rpcHoodSave'); if (rs) rs.addEventListener('click', function () { saveRpc('sol'); }); if (rh) rh.addEventListener('click', function () { saveRpc('hood'); });
    $('#themeBtn').addEventListener('click', function () { state.theme = state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'; LS.set('theme', state.theme); applyTheme(); toast('Theme: ' + state.theme); if (state.page) ui.renderToken(true); });
    $('#context').addEventListener('click', function (ev) { if (ev.target.closest('#gmPill')) { ui.openGmgn(); return; } if (!ev.target.closest('#modePill')) return; $('#srcModal').classList.add('open'); ui.renderStatus(); ui.renderGmgn(); });
    $('#srcModal').addEventListener('click', function (ev) {
      if (ev.target.closest('#gmSave')) { gmSave(); return; }
      if (ev.target.closest('#gmProxySave')) { gmProxySave(false); return; }
      if (ev.target.closest('#gmProxyClear')) { gmProxySave(true); return; }
      if (ev.target.closest('#gmRemove')) { TL.gmgn.setKey(''); $('#gmCard').dataset.msg = 'Key removed from this browser.'; $('#gmCard').dataset.keep = '1'; ui.renderGmgn(); }
    });
    $('#srcModal').addEventListener('change', function (ev) { if (ev.target.id === 'gmPlan' && TL.gmgn && TL.gmgn.key && !$('#gmKey').value) { TL.gmgn.setPlan(ev.target.value); $('#gmCard').dataset.msg = 'Plan saved.'; $('#gmCard').dataset.keep = '1'; ui.renderGmgn(); } });
    $('#srcModal').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      if (ev.target.id === 'gmKey') { ev.preventDefault(); gmSave(); }
      else if (ev.target.id === 'gmProxy') { ev.preventDefault(); gmProxySave(false); }
    });
    if (TL.gmgn) {
      var gmWas = TL.gmgn.state;
      TL.gmgn.onChange(function () {
        var now = TL.gmgn.state;
        if (!!$('#gmPill') !== (TL.gmgn.configured() && TL.gmgn.available())) ui.renderContext(); // v1.40: the pill appears the moment the site's own proxy is found
        ui.renderGmgn();
        if (now !== gmWas) { if (now === 'ok') { if (!TL.gmgn.auto) toast('GMGN connected: the feeds run on GMGN data'); } else if (now === 'auth') toast('GMGN rejected the key'); else if (now === 'limited' && !TL.gmgn.auto) toast('GMGN plan limit: pausing until ' + TL.gmgn.note.replace(/.*resuming at /, '')); }
        gmWas = now;
      });
    }
    $$('[data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('.modal').classList.remove('open'); }); });
    $$('.modal').forEach(function (m) { m.addEventListener('click', function (ev) { if (ev.target === m) m.classList.remove('open'); }); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (ev.target.matches('input, select, textarea')) { ev.target.blur(); return; }
      var openModal = $$('.modal.open');
      if (openModal.length) openModal.forEach(function (m) { m.classList.remove('open'); });
      else if ($('#drawer').classList.contains('open')) openDrawer(false);
      else if (state.page) goBack();
    });
    window.addEventListener('resize', function () { var cv = $('#tpCanvas'); var t = state.page && store.get(state.page); if (cv && t) drawChart(cv, t.series, 420); });
    // live trades poll only while this tab is on screen: many token tabs open at once must not hammer the RPCs
    var pausedTrades = null;
    document.addEventListener('visibilitychange', function () {
      if (!TL.xray || !TL.xray.trades) return;
      if (document.hidden) { if (TL.xray.trades.timer) { pausedTrades = TL.xray.trades.token; TL.xray.stopTrades(); } return; }
      var tp = pausedTrades; pausedTrades = null; if (!tp) return;
      if (state.page === tp.id) pageTrades(tp); else if ($('#chartModal').classList.contains('open') && $('#chartModal').dataset.tokenId === tp.id) modalTrades(tp);
    });
    new MutationObserver(function () { if (!$('#chartModal').classList.contains('open') && TL.xray && TL.xray.stopTrades) TL.xray.stopTrades(); }).observe($('#chartModal'), { attributes: true, attributeFilter: ['class'] }); // closing the window stops the trade polling
    applyTheme();
  };
  // ---------- chart viewer: analysis only, no trading ----------
  function chartUrls(t) {
    var g = t.chain === 'solana' ? 'sol' : 'robinhood';
    var gmgn = TL.gmgnToken(t.chain, t.address); // v1.66: with the referral code
    var embed = TL.CONFIG.gmgnKline + g + '/' + t.address + (document.documentElement.getAttribute('data-theme') === 'light' ? '?theme=light' : '');
    var launchpad = t.chain === 'solana' ? (/pump/.test(t.launchpad || '') || /pump$/.test(t.address) ? 'https://pump.fun/coin/' + t.address : null) : (t.launchTx || t.curveInfo || t.launchpad === 'pons' ? 'https://www.ponsfamily.com/token/' + t.address : null);
    return { gmgn: gmgn, embed: embed, launchpad: launchpad, axiom: TL.axiomToken(t.chain, t.address), photon: TL.photonToken(t.chain, t.address) };
  }
  var chartTimer = null;
  function openChart(t) {
    if (!t) return;
    var m = $('#chartModal'); m.classList.add('open'); m.dataset.tokenId = t.id;
    var u = chartUrls(t);
    $('#chartTitle').innerHTML = logoHtml(t, true) + '<span class="d-title"><span class="sym">' + U.esc(t.symbol) + '</span><span class="nm">' + U.esc(t.name) + ' · ' + U.esc(t.launchpad) + (U.isNum(t.createdAt) ? ' · <span data-born="' + t.createdAt + '" data-suffix=" old">' + U.fmtAgeLive(U.now() - t.createdAt) + ' old</span>' : '') + '</span></span>';
    bindLogo($('#chartTitle .logo img'));
    $('#chartLinks').innerHTML = (t.demo || t.partial ? '' : '<a href="' + U.esc(u.gmgn) + '" target="_blank" rel="noopener">Open on GMGN</a>' + (u.launchpad ? '<a href="' + U.esc(u.launchpad) + '" target="_blank" rel="noopener">Open on ' + (t.chain === 'solana' ? 'pump.fun' : 'Pons') + '</a>' : '')) +
      '<span class="muted" style="font-size:12px">Analysis only. Nothing here buys or sells.</span>';
    var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
    var canEmbed = !t.demo && !t.partial && !sandboxed;
    var frameWrap = $('#chartFrame'), fallback = $('#chartFallback');
    frameWrap.innerHTML = ''; fallback.hidden = true; clearTimeout(chartTimer);
    if (canEmbed) {
      var f = document.createElement('iframe'); f.src = u.embed; f.title = 'GMGN chart'; f.setAttribute('allow', 'clipboard-write'); f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
      f.onload = function () { clearTimeout(chartTimer); if (S.setStatus) S.setStatus('gmgn', 'ok', 'chart embed loaded'); var n = frameWrap.querySelector('.frame-note'); if (n) n.remove(); };
      frameWrap.appendChild(f);
      var note = document.createElement('span'); note.className = 'frame-note'; note.textContent = 'Loading the GMGN chart…'; frameWrap.appendChild(note);
      chartTimer = setTimeout(function () { note.textContent = 'GMGN embed did not answer: open it in a new tab.'; if (S.setStatus) S.setStatus('gmgn', 'err', 'embed did not answer'); }, 12000);
    } else {
      frameWrap.style.display = 'none'; fallback.hidden = false;
      $('#chartFallbackNote').textContent = t.demo || t.partial ? 'Preview token: the stored price path. The real file shows the GMGN chart here.' : 'This preview cannot embed outside pages; the HTML file on your computer shows the GMGN chart here.';
      drawChart($('#chartCanvas'), t.series, 260);
    }
    if (canEmbed) frameWrap.style.display = '';
    modalTrades(t);
  }
  function modalTrades(t) { // live trades under the chart, polled while the window is open
    var m = $('#chartModal'); $('#chartTradesNote').textContent = '';
    if (TL.xray && TL.xray.startTrades) TL.xray.startTrades(t, function (LT) {
      if (!m.classList.contains('open') || m.dataset.tokenId !== t.id) return;
      $('#chartTrades').innerHTML = TL.xray.tradesHtml(t);
      $('#chartTradesNote').textContent = LT.sim ? 'simulated in this preview' : (LT.list.length ? LT.list.length + ' latest, refreshed every few seconds' : '');
      LT.list.forEach(function (tr) { tr.fresh = false; });
    });
    $('#chartTrades').innerHTML = TL.xray ? TL.xray.tradesHtml(t) : '';
  }
  ui.refreshChartModal = function (t) { // keep the preview path moving while the window is open
    var m = $('#chartModal'); if (!m.classList.contains('open') || m.dataset.tokenId !== t.id) return;
    if (!$('#chartFallback').hidden) drawChart($('#chartCanvas'), t.series, 260);
  };

  ui.renderAll = function () {
    if (state.page) { ui.renderToken(); return; } // a token page is open: the hidden feed waits until you go back
    ui.renderContext(); ui.renderControls(); ui.renderFeed(); ui.renderStatus();
  };

  // ---------- boot ----------
  ui.boot = function () {
    if (TL.xray && TL.xray.bind) TL.xray.bind();
    if (TL.smart && TL.smart.bind) TL.smart.bind();
    ui.bind();
    if (TL.gate && TL.gate.bind) TL.gate.bind();
    // v1.37: the project's links come from one place (CONFIG.links); an empty link hides its button
    var L = TL.CONFIG.links || {};
    document.querySelectorAll('a[data-link]').forEach(function (a) { var u = L[a.dataset.link]; if (u) a.href = u; else a.hidden = true; });
    // v1.67: the terminals' invite links with the team's codes, one line in the footer (pump.fun's code is typed at sign-up in its app)
    var ft = $('#footTrade'); if (ft) { var I = TL.inviteLinks(); var al = function (h, l) { return '<a href="' + U.esc(h) + '" target="_blank" rel="noopener">' + l + '</a>'; }; ft.innerHTML = 'Trade on: ' + al(I.gmgn, 'GMGN') + ' · ' + al(I.axiom, 'Axiom') + ' · ' + al(I.photon, 'Photon') + (I.pumpCode ? ' · ' + al(I.pumpfun, 'pump.fun (invite code ' + U.esc(I.pumpCode) + ')') : ''); } // v2.10: pump.fun only with a code, and the site has none
    // v1.40: on the live site the setup cards (GMGN source, own nodes) are the owner's: hidden unless the page is opened with ?setup=1
    if (!TL.CONFIG.setupCards) ['#gmCard', '#rpcCard'].forEach(function (sel) { var el = $(sel); if (el) el.hidden = true; });
    // v1.52: on the closed site the engine waits for access; the gate calls ui.bootEngine once the wallet is in
    if (TL.gate && TL.gate.active()) { TL.gate.start(function () { ui.bootEngine(); }); return; }
    ui.bootEngine();
  };
  ui.bootEngine = function () {
    if (ui._engineBooted) return; ui._engineBooted = true;
    store.onChange(function () { ui.scheduleRender(); });
    var forced = TL.CONFIG.forcedMode;
    var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
    function finish(liveFlags) {
      var anyLive = !!(liveFlags && (liveFlags.solana || liveFlags.robinhood));
      var preview = forced === 'demo' || (sandboxed && !anyLive);
      ['solana', 'robinhood'].forEach(function (chain) {
        if (liveFlags && liveFlags[chain]) { store.chainMode[chain] = 'live'; return; }
        if (preview) { store.chainMode[chain] = 'demo'; TL.loadDemo(chain).forEach(function (t) { store.tokens[t.id] = t; store.index(t); }); store._list = null; store._rev = (store._rev || 0) + 1; }
        else store.chainMode[chain] = 'offline';
      });
      store.mode = anyLive ? 'live' : (preview ? 'demo' : 'offline');
      if (store.mode === 'demo' && TL.demoFlow) TL.demoFlow.start(); // the preview's moving flow of fictional launches
      store._booted = true;
      store.recompute(); if (state.page) ui.route(); ui.renderAll(); ui.preloadLogos(ui.visible());
      if (store.mode === 'live' && S.resolveLogos) S.resolveLogos(ui.visibleIds());
      $('#bootNote').textContent = store.mode === 'live' ? (TL.gmgn && TL.gmgn.active() ? 'Live on GMGN \u00b7 curves on-chain every 5 s' : 'Live \u00b7 curves on-chain every 5 s') :
        (store.mode === 'demo' ? 'Preview: no chain access here. Real tokens from 15 Sep 2026 plus a fictional flow marked demo. Open the file locally for live data.' : 'Offline. Reconnecting.');
      if (store.mode === 'demo') startDemoPulse(); else S.start();
      bindCalls();
      if (TL.account && store.mode === 'live') TL.account.pull().catch(function () {});
    }
    // v1.32: the call journal. Live: the terminal calls launches itself, every 10 s; preview: fictional records and one sample card
    function bindCalls() {
      var CL = TL.calls; if (!CL) return;
      if (!CL._uiBound) {
        CL._uiBound = true;
        CL.on('call', function (rec) { ui.alert(rec, 'call'); ui.renderDay(); ui.markDirty({ id: rec.id }); });
        CL.on('milestone', function (rec, m) { ui.alert(rec, 'milestone', m); ui.renderDay(); ui.markDirty({ id: rec.id }); });
        CL.on('rug', function (rec) { ui.alert(rec, 'rug'); ui.renderDay(); ui.markDirty({ id: rec.id }); });
        CL.on('change', function () { if (!state.page && state.tab === 'trenches') ui.renderDay(); });
        if (TL.known) { // v1.48: a top trader's buy: a card, the row's badge, the token page's card
          TL.known.on('buy', function (rec) { if (TL.known.wanted(rec)) ui.alert(rec, 'whale'); ui.markDirty({ id: rec.chain + ':' + rec.token }); if (state.page === rec.chain + ':' + rec.token) { var hl = $('#tpHead'); if (hl) hl._sig = null; ui.renderToken(); } });
          TL.known.on('change', function () { (TL.known.lastFresh || []).forEach(function (x) { ui.markDirty({ id: x.chain + ':' + x.token }); }); TL.known.lastFresh = []; if (TL.smart && TL.smart.renderKnownSoon && TL.smart.view === 'board' && state.tab === 'xray') TL.smart.renderKnownSoon(); });
        }
      }
      if (store.mode === 'live') {
        CL.start({ followOnly: !!TL.CONFIG.callsFeed }); // v2.10: with the server's journal, the calls are the server's (the same for every visitor)
        if (TL.CONFIG.callsFeed) { CL.pullRemote(TL.CONFIG.callsFeed); setInterval(function () { if (!document.hidden) CL.pullRemote(TL.CONFIG.callsFeed); }, 20 * TL.SEC); }
        if (TL.quantum) TL.quantum.start(); // v2.20: the quantum radar scans Jupiter for the narrative's words
        var K = TL.known; // v1.48: the known traders' buys, read from GMGN's KOL feed here and from the data service's registry
        if (K) { K.start(); if (TL.CONFIG.knownFeed) { K.pullRemote(TL.CONFIG.knownFeed); setInterval(function () { if (!document.hidden) K.pullRemote(TL.CONFIG.knownFeed); }, 5 * TL.MIN); } }
      } else if (store.mode === 'demo') {
        CL.seedDemo(); ui.renderDay();
        setTimeout(function () { var r = CL.list.filter(function (x) { return x.demo && x.chain === state.net; })[0] || CL.list.filter(function (x) { return x.demo; })[0]; if (r) ui.alert(r, 'call'); }, 4000);
      }
    }
    function bootFeed() {
      store.mode = 'boot'; ui.renderAll();
      var timeout = new Promise(function (res) { setTimeout(function () { res('timeout'); }, TL.CONFIG.bootTimeout); });
      Promise.race([S.cycle(), timeout]).then(function (r) {
        if (r === 'timeout') finish({ solana: store.chainMode.solana === 'live', robinhood: store.chainMode.robinhood === 'live' });
        else finish(r);
      }).catch(function () { finish(null); });
    }
    ui.bootFeed = function () { if (!S.lite) return; S.stopLite(); bootFeed(); };
    if (forced === 'demo') { finish(null); ui.route(); return; }
    if (!sandboxed && store.load()) { store.recompute(); } // last session's feed, instantly; live sources refresh it within seconds
    if (!sandboxed && parseRoute().view === 'token') { // opened on a token (a new tab from the feed, a shared link): poll that token only
      S.lite = true; store.mode = 'live'; store._booted = true; store.chainMode.solana = 'live'; store.chainMode.robinhood = 'live';
      ui.route(); S.pollPrices().then(function () { S.startLite(); }, function () { S.startLite(); });
      return;
    }
    ui.route();
    bootFeed();
  };
  function startDemoPulse() {
    setInterval(function () {
      var all = store.all(); if (!all.length) return;
      for (var i = 0; i < 6; i++) {
        var t = all[Math.floor(Math.random() * all.length)]; if (t.stage === 'dead') continue;
        if (U.isNum(t.chg.m5)) t.chg.m5 = U.clamp(t.chg.m5 + (Math.random() - 0.5) * 6, -60, 120);
        if (t.tx.m5) { if (Math.random() > 0.5) t.tx.m5.b += 1; else if (Math.random() > 0.6) t.tx.m5.s += 1; }
        if (U.isNum(t.vol.m5)) t.vol.m5 = Math.max(0, t.vol.m5 * (0.95 + Math.random() * 0.12));
      }
      store.recompute();
    }, 9000);
  }
  document.addEventListener('DOMContentLoaded', ui.boot);

  // v2.24: the chameleon's eye in the header and footer marks looks round and blinks a few times a minute: a short CSS transition each
  // time, still in between (until 2.23 two endless animations on the drawing made the page lay itself out again on every frame)
  (function () {
    var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) return;
    var LOOK = ['translate(0px, 0px)', 'translate(-1.4px, .7px)', 'translate(.9px, -1.1px)', 'translate(-.6px, -1.2px)', 'translate(1.2px, .5px)'], at = 0;
    setInterval(function () {
      if (document.hidden) return;
      at = (at + 1 + Math.floor(Math.random() * 3)) % LOOK.length;
      [].forEach.call(document.querySelectorAll('.cham .cham-pupil'), function (p) { p.style.transform = LOOK[at]; });
    }, 2300);
    setInterval(function () {
      if (document.hidden) return;
      [].forEach.call(document.querySelectorAll('svg.cham'), function (s) { s.classList.remove('blink'); void s.getBoundingClientRect(); s.classList.add('blink'); });
    }, 7000);
  })();
})(window.TL);
