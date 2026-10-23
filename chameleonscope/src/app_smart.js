/* Chameleon - Smart Tracking on GMGN data: the wallets worth watching, best first, a profile for every wallet, and the traders of a token.
   Candidates: GMGN's smart money and KOL trade feeds (the latest 200 trades each) and the top traders of the hottest tokens in the feed
   (profit on that token). Every candidate is then read from its GMGN record (wallet_stats for 7 or 30 days) and scored with the track-record
   formula GMGN publishes for its wallet skill: stop-loss discipline 34% (tokens that did not lose more than half), profit share 28% (tokens
   that ended in profit), capital ROI 16% (realized profit over cost, -5% to +30%), win rate 10% (0 to 50%), sample size 12% (5 to 150
   tokens; GMGN's own floor is 20 to 320, lowered so a sharp week counts). Wallets that mostly launch tokens count at 45%: their own
   launches make every entry look perfect. Patterns come from the same record. Without a key the tab explains how to connect; the preview
   shows fictional wallets marked demo. */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store;
  var $ = function (q, el) { return (el || document).querySelector(q); };
  var $$ = function (q, el) { return Array.prototype.slice.call((el || document).querySelectorAll(q)); };
  var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
  var MIN = TL.MIN, HR = TL.HR, DAY = TL.DAY;
  var saved = (function () { try { return JSON.parse(localStorage.getItem('tl.board') || '{}') || {}; } catch (e) { return {}; } })();
  var SM = TL.smart = { period: saved.period === '30d' ? '30d' : '30d', sort: saved.sort || 'score', source: saved.source || 'all', pattern: saved.pattern || '', strongOnly: saved.strongOnly !== false, boards: {}, profiles: {}, view: 'board' };
  SM.reset = function () { SM.boards = {}; SM.profiles = {}; if (SM.view === 'board') SM.renderBoardSoon(); }; // a new key: nothing read with the old one stays
  function remember() { try { localStorage.setItem('tl.board', JSON.stringify({ period: SM.period, sort: SM.sort, source: SM.source, pattern: SM.pattern, strongOnly: SM.strongOnly, knownFilter: SM.knownFilter })); } catch (e) {} }
  function G() { return TL.gmgn; }
  function demoMode() { return store.mode === 'demo' || sandboxed || TL.CONFIG.forcedMode === 'demo'; }
  function net() { return TL.ui ? TL.ui.state.net : 'solana'; }
  var SLUG = { solana: 'sol', robinhood: 'robinhood' };
  function short(a) { return a ? U.esc(String(a).slice(0, 4) + '…' + String(a).slice(-4)) : '–'; } // v1.59: escaped
  function num(v) { var x = U.num(v); return x === null ? null : x; }
  function secs(v) { var x = U.num(v); if (!x || x <= 0) return null; return x < 1e12 ? x * 1000 : x; }
  function share(v) { var x = U.num(v); if (x === null || x < 0 || x > 1.0001) return null; return Math.min(1, x); }
  function sgnUsd(v) { if (!U.isNum(v)) return '–'; return (v > 0 ? '+' : '') + U.fmtUsd(v); }
  function dur(sec) { if (!U.isNum(sec) || sec <= 0) return '–'; if (sec < 60) return Math.round(sec) + 's'; if (sec < 3600) return Math.round(sec / 60) + 'm'; if (sec < 86400) return (sec / 3600).toFixed(sec < 36000 ? 1 : 0) + 'h'; return (sec / 86400).toFixed(1) + 'd'; }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function periodTxt(p) { return p === '30d' ? '30 days' : '7 days'; }

  // ---------- avatars: the wallet's own GMGN picture, else the face GMGN draws for that address, else our own drawing ----------
  // v1.41: every wallet gets the same picture it has on GMGN. A profile picture comes with the record (common.avatar); every other
  // address gets GMGN's generated face (G.avatarUrl, the same formula GMGN's site uses). Our own drawing stays underneath as the fallback.
  SM.avatar = function (addr, url, size) {
    size = size || 30;
    var idc = TL.pixelAvatar ? '<img class="pa" alt="" src="' + TL.pixelAvatar(addr || '?', size) + '" width="' + size + '" height="' + size + '">' : (TL.xray && TL.xray.identicon ? TL.xray.identicon(addr || '?', size) : '');
    var src = url && /^https:\/\//i.test(String(url)) ? String(url) : (addr && G() && G().avatarUrl ? G().avatarUrl(addr) : '');
    if (!src || sandboxed) return '<span class="av" style="width:' + size + 'px;height:' + size + 'px">' + idc + '</span>';
    return '<span class="av" style="width:' + size + 'px;height:' + size + 'px">' + idc + '<img alt="" src="' + U.esc(src) + '" referrerpolicy="no-referrer" loading="lazy" decoding="async"></span>';
  };
  document.addEventListener('error', function (ev) { var el = ev.target; if (el && el.tagName === 'IMG' && el.parentNode && el.parentNode.classList && (el.parentNode.classList.contains('av') || el.parentNode.classList.contains('mini-logo'))) el.remove(); }, true);

  // ---------- reading a GMGN wallet record ----------
  SM.readStats = function (x) {
    if (!x || typeof x !== 'object') return null;
    var pnl = x.pnl_stat || {}, common = x.common || {};
    var f = function (v) { var n = U.num(v); return n === null ? 0 : n; };
    var buys = f(x.buy != null ? x.buy : x.buy_count), sells = f(x.sell != null ? x.sell : x.sell_count);
    var d = { gt5: f(pnl.pnl_gt_5x_num), x2_5: f(pnl.pnl_2x_5x_num), x0_2: f(pnl.pnl_0x_2x_num), n50_0: f(pnl.pnl_nd5_0x_num), lt50: f(pnl.pnl_lt_nd5_num) };
    var dsum = d.gt5 + d.x2_5 + d.x0_2 + d.n50_0 + d.lt50;
    var tokens = f(pnl.token_num != null ? pnl.token_num : x.token_num) || dsum;
    var winrate = num(pnl.winrate != null ? pnl.winrate : x.winrate); if (winrate !== null && winrate > 1.0001) winrate = winrate / 100;
    var wins = dsum ? d.gt5 + d.x2_5 + d.x0_2 : (winrate !== null && tokens ? Math.round(winrate * tokens) : null);
    var losses = dsum ? d.n50_0 + d.lt50 : (winrate !== null && tokens ? tokens - wins : null);
    if (winrate === null && dsum) winrate = wins / dsum;
    var cost = f(x.bought_cost != null ? x.bought_cost : x.total_cost);
    var realized = num(x.realized_profit);
    var roi = num(x.realized_profit_pnl != null ? x.realized_profit_pnl : x.pnl); if (roi === null && cost > 0 && realized !== null) roi = realized / cost;
    var tags = [].concat(common.tags || [], common.tag ? [common.tag] : [], x.tags || []).map(function (t) { return String(t).toLowerCase(); }).filter(function (t, i, a) { return t && a.indexOf(t) === i; });
    return {
      realized: realized, unrealized: num(x.unrealized_profit), winrate: winrate, wins: wins, losses: losses, tokens: tokens, dist: dsum ? d : null,
      buys: buys, sells: sells, trades: buys + sells, cost: cost, roi: roi, avgHold: num(pnl.avg_holding_period != null ? pnl.avg_holding_period : x.avg_holding_period),
      lastActive: secs(x.last_active_timestamp), name: common.name || common.twitter_name || common.ens || '', twitter: common.twitter_username || '', twitterName: common.twitter_name || '',
      followers: num(common.followers_count), verified: !!common.is_blue_verified, avatar: common.avatar || '', tags: tags, created: secs(common.created_at),
      fundFrom: common.fund_from || '', fundAddr: common.fund_from_address || '', fundAmount: num(common.fund_amount), createdTokens: num(common.created_token_count), gmgnFollowers: num(common.follow_count), remarks: num(common.remark_count)
    };
  };
  // ---------- strength: is this a wallet worth following? ----------
  // GMGN's own track-record formula only measures how a wallet's tokens ended, so a wallet that turned $40
  // into $70 four times scores like a desk running six figures. Strength keeps that shape (discipline, upside,
  // ROI, win rate, sample) and adds the two things that decide whether a record can actually be followed:
  // the money the wallet puts to work and how recent the record is. A gate in front of it drops everything
  // too small, too lucky, too stale or too self-dealing to be worth a slot in the ranking.
  SM.W = { profit: 0.22, edge: 0.18, consistency: 0.16, discipline: 0.14, size: 0.12, sample: 0.10, recency: 0.08 };
  SM.PART_LABEL = {
    profit: ['Realized profit', 'how much money it actually took out of the market'],
    edge: ['Return on capital', 'profit against what it put in'],
    consistency: ['Consistency', 'win rate plus how often a token doubled'],
    discipline: ['Loss discipline', 'how rarely it lets a token lose more than half'],
    size: ['Position size', 'average buy: a wallet trading $50 cannot be followed'],
    sample: ['Sample', 'how many tokens the record is built on'],
    recency: ['Still active', 'how recently it traded']
  };
  // the minimum record a wallet needs before it can be called followable, per period
  SM.MIN = {
    '7d': { tokens: 5, trades: 10, cost: 2000, realized: 750, avgBuy: 120, roi: 0.08, winrate: 0.28, idle: 4 * DAY, spread: 25 },
    '30d': { tokens: 8, trades: 20, cost: 5000, realized: 2500, avgBuy: 150, roi: 0.10, winrate: 0.30, idle: 7 * DAY, spread: 60 }
  };
  function logScale(v, lo, hi) { if (!(v > lo)) return 0; return clamp01(Math.log(v / lo) / Math.log(hi / lo)); }
  SM.avgBuy = function (s) { if (!s) return 0; if (s.buys > 0 && s.cost > 0) return s.cost / s.buys; if (s.cost > 0 && s.tokens > 0) return s.cost / s.tokens; return 0; };
  SM.isDev = function (s) { return !!(s && s.createdTokens > 0 && s.createdTokens > 0.5 * Math.max(1, s.tokens)); };
  SM.isBot = function (s) { return !!(s && (s.trades >= 1500 || (s.avgHold > 0 && s.avgHold < 45 && s.trades >= 300))); };
  function hasTag(s, list) { return !!(s && s.tags && s.tags.some(function (t) { return list.indexOf(t) >= 0; })); }
  SM.GRADES = [[78, 'elite', 'Elite'], [62, 'strong', 'Strong'], [45, 'decent', 'Decent'], [0, 'weak', 'Weak']];
  SM.grade = function (v) { for (var i = 0; i < SM.GRADES.length; i++) if (v >= SM.GRADES[i][0]) return { key: SM.GRADES[i][1], label: SM.GRADES[i][2] }; return { key: 'weak', label: 'Weak' }; };
  SM.score = function (s, period) {
    period = period === '30d' ? '30d' : '7d';
    if (!s || !(s.tokens > 0) || !(s.trades > 0)) return null;
    var m = SM.MIN[period], tn = Math.max(1, s.tokens), now = U.now();
    var dist = s.dist, multi = dist ? (dist.gt5 + dist.x2_5) / tn : null, lost = dist ? dist.lt50 / tn : null;
    var wr = s.winrate !== null ? s.winrate : (s.wins !== null ? s.wins / tn : 0);
    var avgBuy = SM.avgBuy(s);
    var idle = s.lastActive ? now - s.lastActive : null;
    var raw = {
      profit: logScale(s.realized, 500, 500000),
      edge: clamp01((((s.roi === null ? 0 : s.roi)) - 0.05) / 0.95),
      consistency: 0.6 * clamp01(wr / 0.65) + 0.4 * clamp01((multi === null ? wr * 0.5 : multi) / 0.35),
      discipline: lost === null ? clamp01(0.4 + wr / 2) : clamp01(1 - lost / 0.35),
      size: logScale(avgBuy, 100, 30000),
      sample: clamp01((tn - m.tokens) / m.spread),
      recency: idle === null ? 0.5 : clamp01(1 - (idle - DAY) / (m.idle - DAY))
    };
    var parts = {}, total = 0;
    Object.keys(SM.W).forEach(function (k) { parts[k] = SM.W[k] * raw[k]; total += parts[k]; });
    var dev = SM.isDev(s), bot = SM.isBot(s);
    var ageD = s.created ? (now - s.created) / DAY : null;
    var fresh = ageD !== null && ageD < 5;
    var mult = 1, notes = [];
    if (dev) { mult *= 0.45; notes.push('counted at 45%: it mostly trades tokens it launched itself'); }
    if (bot) { mult *= 0.85; notes.push('counted at 85%: bot-speed trading nobody can follow by hand'); }
    if (hasTag(s, ['sniper'])) { mult *= 0.95; notes.push('counted at 95%: sniper wallet, its entries come from speed'); }
    if (fresh && s.realized > 5000) { mult *= 0.9; notes.push('counted at 90%: funded ' + Math.round(ageD) + ' days ago, a record this short can be luck or inside knowledge'); }
    if (hasTag(s, ['smart_degen', 'smart_money'])) { mult *= 1.05; notes.push('+5%: GMGN tags it as smart money'); }
    if (hasTag(s, ['renowned', 'kol']) && s.verified) { mult *= 1.03; notes.push('+3%: known account, verified on X'); }
    var value = Math.max(0, Math.min(100, Math.round(total * mult * 100)));
    return { value: value, parts: parts, raw: raw, grade: SM.grade(value), mult: mult, notes: notes, dev: dev, bot: bot, fresh: fresh, avgBuy: avgBuy, period: period };
  };
  // the gate: why a wallet is not worth following. '' means it is.
  SM.gate = function (s, period) {
    period = period === '30d' ? '30d' : '7d';
    var m = SM.MIN[period];
    if (!s || !(s.tokens > 0) || !(s.trades > 0)) return 'no GMGN record for this period';
    if (SM.isDev(s)) return 'mostly trades its own launches (' + U.fmtNum(s.createdTokens) + ' tokens created)';
    if (hasTag(s, ['bundler', 'rat_trader'])) return 'tagged as a bundler or insider wallet by GMGN';
    if (s.tokens < m.tokens) return 'only ' + U.fmtNum(s.tokens) + (s.tokens === 1 ? ' token' : ' tokens') + ' traded in ' + periodTxt(period) + ', too few to judge';
    if (s.trades < m.trades) return 'only ' + U.fmtNum(s.trades) + (s.trades === 1 ? ' trade' : ' trades') + ' in ' + periodTxt(period);
    if (!(s.realized >= m.realized)) return 'took out ' + sgnUsd(s.realized) + ' in ' + periodTxt(period) + ', under ' + U.fmtUsd(m.realized);
    if (!(s.cost >= m.cost)) return 'put only ' + U.fmtUsd(s.cost) + ' to work, under ' + U.fmtUsd(m.cost);
    if (!(SM.avgBuy(s) >= m.avgBuy)) return 'average buy ' + U.fmtUsd(SM.avgBuy(s)) + ': too small a size to copy';
    if (s.roi !== null && s.roi < m.roi) return 'ROI ' + U.fmtPct(s.roi * 100, 0) + ' in ' + periodTxt(period);
    if (s.winrate !== null && s.winrate < m.winrate) return 'win rate ' + Math.round(s.winrate * 100) + '%, under ' + Math.round(m.winrate * 100) + '%';
    if (s.lastActive && U.now() - s.lastActive > m.idle) return 'last trade ' + U.fmtAge(U.now() - s.lastActive) + ' ago';
    return '';
  };
  SM.MIN_FOLLOW = 55; // a wallet has to pass the gate AND score this high to sit in the ranking
  SM.follows = function (w) { return !!(w && w.stats && !w.gateWhy && w.score && w.score.value >= SM.MIN_FOLLOW); };
  var TAGS = { smart_degen: ['Smart money', 'smart'], smart_money: ['Smart money', 'smart'], renowned: ['KOL', 'smart'], kol: ['KOL', 'smart'], sniper: ['Sniper', 'warn'], whale: ['Whale', ''], fresh_wallet: ['Fresh wallet', 'warn'], dev: ['Dev', 'warn'], bundler: ['Bundler', 'bad'], rat_trader: ['Insider', 'bad'], dex_bot: ['Bot', 'warn'], bluechip_owner: ['Bluechip holder', ''] };
  SM.tagBadges = function (tags) {
    var seen = {}, out = [];
    (tags || []).forEach(function (t) { var d = TAGS[String(t).toLowerCase()]; if (!d || seen[d[0]]) return; seen[d[0]] = 1; out.push({ label: d[0], tone: d[1] }); });
    return out;
  };
  SM.patterns = function (s, period) {
    var out = []; if (!s) return out;
    var tn = Math.max(1, s.tokens || 0), now = U.now();
    var add = function (k, label, tone, why) { out.push({ k: k, label: label, tone: tone, why: why }); };
    var dev = s.createdTokens > 0 && s.createdTokens > 0.5 * tn;
    var wr = s.winrate !== null ? Math.round(s.winrate * 100) : null;
    if (dev) add('dev', 'Token launcher', 'warn', U.fmtNum(s.createdTokens) + ' tokens created: most of its trades are its own launches, so its entries look better than they are');
    if (!dev && s.winrate >= 0.6 && s.tokens >= 15) add('consistent', 'Consistent winner', 'good', wr + '% of ' + U.fmtNum(s.tokens) + ' tokens ended in profit over ' + periodTxt(period));
    if (s.avgHold > 0 && s.avgHold < HR / 1000 && s.trades >= 30 && s.winrate >= 0.5) add('flipper', 'Fast flipper', 'good', 'holds ' + dur(s.avgHold) + ' on average and still wins ' + wr + '% of the time');
    if (s.dist && s.dist.gt5 >= 2) add('hitter', 'Big hitter', 'good', s.dist.gt5 + ' tokens went over 5x for this wallet');
    else if (s.dist && s.dist.gt5 + s.dist.x2_5 >= 4 && (s.dist.gt5 + s.dist.x2_5) / tn >= 0.2) add('multi', 'Multiplier hunter', 'good', (s.dist.gt5 + s.dist.x2_5) + ' of ' + U.fmtNum(tn) + ' tokens returned over 2x');
    if (s.dist && tn >= 10 && s.realized > 0 && s.dist.lt50 / tn <= 0.05) add('stops', 'Tight stops', 'good', 'almost never lets a token lose more than half');
    if (s.buys > 0 && s.cost / s.buys >= 5000) add('whale', 'Whale', '', 'average buy ' + U.fmtUsd(s.cost / s.buys));
    if (s.avgHold >= 5 * DAY / 1000 && s.trades < 200) add('diamond', 'Diamond hands', '', 'holds for ' + dur(s.avgHold) + ' on average');
    if (s.trades >= 2000) add('bot', 'Bot-speed trading', 'warn', U.fmtNum(s.trades) + ' trades in ' + periodTxt(period) + ': no human clicks that fast');
    var ageD = s.created ? (now - s.created) / DAY : null;
    if (ageD !== null && ageD < 7 && s.realized > 5000) add('fresh', 'Fresh wallet, big wins', 'warn', 'first funded ' + U.fmtAge(now - s.created) + ' ago and already up ' + U.fmtUsd(s.realized) + ': insiders often look like this');
    if (s.dist && s.dist.lt50 / tn >= 0.3 && s.realized < 0) add('bags', 'Bag holder', 'bad', Math.round(s.dist.lt50 / tn * 100) + '% of its tokens lost more than half');
    else if (s.dist && s.winrate !== null && s.winrate < 0.35 && s.dist.gt5 + s.dist.x2_5 >= 1 && s.realized > 0) add('lottery', 'Lottery style', '', 'wins ' + wr + '% of the time, a few big hits pay for the rest');
    var rank = { bad: 0, warn: 1, good: 2, '': 3 };
    return out.sort(function (x, y) { return rank[x.tone || ''] - rank[y.tone || '']; }); // warnings first: a bot or a launcher is the first thing to know
  };
  SM.PATTERN_FILTERS = [['consistent', 'Consistent winners'], ['flipper', 'Fast flippers'], ['hitter', 'Big hitters'], ['stops', 'Tight stops'], ['whale', 'Whales'], ['fresh', 'Fresh wallets']];

  // ---------- the board ----------
  function boardKey(chain, period) { return chain + ':' + period; }
  function blankWallet(a) { return { address: a, sources: {}, tags: [], name: '', twitter: '', avatar: '', last: null, hot: [], prior: 0, stats: null, score: null, gateWhy: '', patterns: [] }; }
  function hotTokens(chain) {
    return store.all().filter(function (t) { return t.chain === chain && t.ready && !t.demo && !t.partial && !t.top && TL.trusted(t) && TL.checked(t) && U.isNum(t.vol.h1) && TL.ensureVet(t)._ok; })
      .sort(function (a, b) { return (b.vol.h1 || 0) - (a.vol.h1 || 0); }).slice(0, 3);
  }
  // the coins that already ran: whoever sat in these and took profit is the record worth reading
  function runnerTokens(chain) {
    return store.all().filter(function (t) { return t.chain === chain && t.top && !t.demo && U.isNum(t.vol.h24) && TL.ensureVet(t)._ok; })
      .sort(function (a, b) { return (b.vol.h24 || 0) - (a.vol.h24 || 0); }).slice(0, 2);
  }
  // ---------- wallet records: one GMGN request per wallet, kept for half an hour so nothing is asked twice ----------
  var REC_TTL = 30 * MIN, REC_MAX = 400, recStore = null, recSaveTimer = null;
  function recLoad() { if (recStore) return recStore; try { recStore = JSON.parse(localStorage.getItem('tl.wrec1') || '{}') || {}; } catch (e) { recStore = {}; } return recStore; }
  function recSave() {
    if (recSaveTimer) return;
    recSaveTimer = setTimeout(function () {
      recSaveTimer = null; var st = recLoad(), now = U.now();
      Object.keys(st).forEach(function (k) { if (!st[k] || now - st[k].at > REC_TTL) delete st[k]; });
      var keys = Object.keys(st); if (keys.length > REC_MAX) keys.sort(function (a, b) { return st[a].at - st[b].at; }).slice(0, keys.length - REC_MAX).forEach(function (k) { delete st[k]; });
      try { localStorage.setItem('tl.wrec1', JSON.stringify(st)); } catch (e) {}
    }, 1000);
  }
  SM.recordCached = function (chain, addr, period) { var e = recLoad()[chain + ':' + addr + ':' + period]; return e && U.now() - e.at < REC_TTL ? e.s : null; };
  SM.readRecord = function (chain, addr, period) {
    var c = SM.recordCached(chain, addr, period); if (c) return Promise.resolve(c);
    var g = G(); if (!g || !g.active()) return Promise.resolve(null);
    return g.walletStat(chain, addr, period).then(function (x) { var s = SM.readStats(x); if (s) { recLoad()[chain + ':' + addr + ':' + period] = { at: U.now(), s: s }; recSave(); } return s; });
  };
  // the cheap screen: the money of many wallets in one request (wallet_profits, 100 a call), so only the wallets that
  // earned a full record get one. Returns a map address -> G.readProfit row.
  SM.screen = function (chain, addrs, period) {
    var g = G(); if (!g || !g.active() || !addrs.length) return Promise.resolve({});
    return g.walletProfits(chain, addrs, period).then(function (m) { var out = {}; Object.keys(m).forEach(function (a) { var p = g.readProfit(m[a]); if (p) out[a] = p; }); return out; }, function () { return {}; });
  };
  function applyStats(w, s, period) {
    w.stats = s; w.score = SM.score(s, period); w.gateWhy = SM.gate(s, period); w.patterns = SM.patterns(s, period);
    if (s.name && !w.name) w.name = s.name; if (s.twitter && !w.twitter) w.twitter = s.twitter; if (s.avatar && !w.avatar) w.avatar = s.avatar;
    s.tags.forEach(function (t) { if (w.tags.indexOf(t) < 0) w.tags.push(t); });
  }
  SM.BOARD_RECORDS = 30; // full records read per board: the wallets the screen ranks highest (a record costs as much as a screen of a hundred)
  SM.BOARD_TTL = 5 * MIN;
  // v1.41: the site's own data service builds the ranking every few minutes and publishes it (GET /board.json), so every visitor
  // opens it ready and spends none of the shared GMGN budget. Without a server (a local copy with its own key) the page builds it itself.
  SM.fetchBoard = function (chain, period) {
    var url = TL.CONFIG && TL.CONFIG.boardFeed; if (!url) return Promise.resolve(null);
    return U.timeoutFetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'chain=' + chain + '&period=' + period, 8000).then(function (r) {
      var bd = r && r.boards && r.boards[chain + ':' + period]; if (!bd || !Array.isArray(bd.wallets) || !U.isNum(bd.at)) return null;
      if (U.now() - bd.at > 45 * MIN) return null; // the server stopped building: the page builds its own
      return bd;
    }).catch(function () { return null; });
  };
  SM.exportBoard = function (b) { // what the server publishes: identity, sources, the record; scores are recomputed by the reader
    return { at: b.at, chain: b.chain, period: b.period, wallets: Object.keys(b.wallets).map(function (a) { var w = b.wallets[a]; return { address: w.address, sources: w.sources, tags: w.tags, name: w.name, twitter: w.twitter, avatar: w.avatar, last: w.last, hot: w.hot, prior: w.prior, stats: w.stats, screen: w.screen || null }; }) };
  };
  SM.build = function (chain, period, force) {
    var key = boardKey(chain, period), b = SM.boards[key];
    if (b && !force && (b.loading || U.now() - b.at < SM.BOARD_TTL)) return b;
    b = SM.boards[key] = { chain: chain, period: period, at: U.now(), loading: true, wallets: {}, stage: 'Reading smart money and KOL trades…', done: 0, total: 0, errors: [], demo: false, remote: false };
    var local = function () { return SM.buildLocal(b); };
    if (force || !TL.CONFIG.boardFeed) { b.promise = local(); return b; }
    b.stage = 'Loading the ranking from the site\'s server…';
    b.promise = SM.fetchBoard(chain, period).then(function (rb) {
      if (!rb) return local();
      rb.wallets.forEach(function (x) { var w = b.wallets[x.address] = blankWallet(x.address); ['sources', 'tags', 'name', 'twitter', 'avatar', 'last', 'hot', 'prior', 'screen'].forEach(function (k) { if (x[k] !== undefined && x[k] !== null) w[k] = x[k]; }); if (x.stats) applyStats(w, x.stats, period); });
      b.remote = true; b.builtAt = rb.at; b.loading = false; b.stage = ''; b.at = U.now(); b.total = b.done = rb.wallets.length;
      SM.renderBoard();
      return b;
    });
    return b;
  };
  SM.buildLocal = function (b) {
    var chain = b.chain, period = b.period;
    b.stage = 'Reading smart money and KOL trades…'; b.remote = false;
    var g = G();
    var add = function (addr, src, info) {
      if (!addr) return null; var a = chain === 'robinhood' ? String(addr).toLowerCase() : String(addr);
      var w = b.wallets[a] || (b.wallets[a] = blankWallet(a));
      w.sources[src] = 1; info = info || {};
      if (info.name && !w.name) w.name = String(info.name); if (info.twitter && !w.twitter) w.twitter = String(info.twitter); if (info.avatar && !w.avatar) w.avatar = String(info.avatar);
      (info.tags || []).forEach(function (t) { t = String(t).toLowerCase(); if (w.tags.indexOf(t) < 0) w.tags.push(t); });
      if (info.trade && (!w.last || info.trade.at > w.last.at)) w.last = info.trade;
      if (info.hot) w.hot.push(info.hot);
      w.prior += info.prior || 1;
      return w;
    };
    var fromTrades = function (kind) {
      return g.trades(chain, kind).then(function (list) {
        list.forEach(function (tr) {
          var mi = tr.maker_info || {}, bt = tr.base_token || {};
          add(tr.maker || mi.address, kind === 'kol' ? 'kol' : 'smart', { tags: (mi.tags || []).concat(kind === 'kol' ? ['kol'] : ['smart_degen']), twitter: mi.twitter_username, name: mi.name || mi.twitter_name, avatar: mi.avatar,
            trade: { side: String(tr.side || '').toLowerCase(), usd: num(tr.amount_usd), symbol: bt.symbol || '', token: tr.base_address || '', at: secs(tr.timestamp) || 0, full: String(tr.is_open_or_close) === '1' }, prior: 1 + Math.min(3, (num(tr.amount_usd) || 0) / 2000) });
        });
        return list.length;
      }).catch(function (e) { b.errors.push(kind + ': ' + (e && e.message || 'error')); return 0; });
    };
    var hot = hotTokens(chain), runners = runnerTokens(chain);
    // v1.48: the registry of known traders: the names the feeds showed over the last days, with the records the data service already read
    var K = TL.known, nowK = U.now();
    if (K) K.all(chain).filter(function (e) { return (e.tier === 'top' || e.tier === 'proven' || e.tier === 'kol' || (e.tier === 'smart' && e.stats)) && nowK - e.lastSeen < 7 * DAY; }).slice(0, 150).forEach(function (e) {
      var w = add(e.address, 'known', { name: e.name, twitter: e.twitter, avatar: e.avatar, tags: e.tags, prior: e.tier === 'top' ? 4 : e.tier === 'proven' ? 3 : 2 });
      if (w && e.stats && nowK - (e.statsAt || 0) < 12 * HR) { var st = period === '7d' ? e.stats7 : e.stats; if (st && !w.stats) { applyStats(w, st, period); w.fromRegistry = true; } }
    });
    var fromToken = function (t, src) {
      return g.topTraders(chain, t.address, 50).then(function (list) {
        list.forEach(function (h) {
          var profit = num(h.profit), bought = num(h.buy_volume_cur), buys = num(h.buy_tx_count_cur);
          if (!(profit > 200)) return;                       // pocket change on one token says nothing
          if (!(bought > 100) && !(buys > 0)) return;         // never bought it: an airdrop or a transfer in, not a trade
          add(h.address, src, { name: h.name || h.twitter_name, twitter: h.twitter_username, avatar: h.avatar, tags: [].concat(h.tags || [], h.maker_token_tags || []),
            hot: { symbol: t.symbol, address: t.address, profit: profit, roi: num(h.profit_change), top: !!t.top }, prior: 1 + Math.min(5, profit / 1000) });
        });
      }).catch(function (e) { b.errors.push('top traders of ' + t.symbol + ': ' + (e && e.message || 'error')); });
    };
    var fromHot = Promise.all(hot.map(function (t) { return fromToken(t, 'hot'); }).concat(runners.map(function (t) { return fromToken(t, 'run'); })));
    var M = SM.MIN[period] || SM.MIN['30d'];
    var p = Promise.all([fromTrades('smartmoney'), fromTrades('kol'), fromHot]).then(function () {
      var cands = Object.keys(b.wallets).map(function (a) { return b.wallets[a]; }).filter(function (w) { return !(w.tags.indexOf('bundler') >= 0 || w.tags.indexOf('rat_trader') >= 0); })
        .sort(function (x, y) { return Object.keys(y.sources).length - Object.keys(x.sources).length || y.prior - x.prior; }).slice(0, 200);
      b.stage = cands.length ? 'Screening ' + cands.length + ' wallets…' : 'GMGN returned no wallets for this network right now.';
      SM.renderBoard();
      if (!cands.length) return;
      // the screen: every candidate's money in one or two requests; the full record only for the ones that could clear the bar
      return SM.screen(chain, cands.map(function (w) { return w.address; }), period).then(function (scr) {
        cands.forEach(function (w) { w.screen = scr[w.address] || null; });
        var worth = function (w) { var s = w.screen; if (!s) return false; return s.realized >= M.realized * 0.6 && s.trades >= M.trades * 0.5 && (s.roi === null || s.roi >= M.roi * 0.5); };
        var rank = function (w) { var s = w.screen; return (s ? Math.log10(Math.max(100, s.realized)) * 2 + Math.min(2, (s.roi || 0)) : -5) + (w.tags.indexOf('smart_degen') >= 0 || w.tags.indexOf('kol') >= 0 || w.tags.indexOf('renowned') >= 0 ? 1.5 : 0) + Object.keys(w.sources).length * 0.5; };
        var top = cands.filter(function (w) { return worth(w) || SM.recordCached(chain, w.address, period); }).sort(function (x, y) { return rank(y) - rank(x); }).slice(0, SM.BOARD_RECORDS);
        var rest = cands.filter(function (w) { return top.indexOf(w) < 0; }).sort(function (x, y) { return rank(y) - rank(x); });
        while (top.length < Math.min(12, cands.length) && rest.length) top.push(rest.shift()); // a thin day still gets a dozen records read
        b.total = top.length; b.done = 0; b.stage = 'Reading the ' + periodTxt(period) + ' record of ' + top.length + ' wallets…';
        SM.renderBoard();
        var i = 0, lanes = [];
        var next = function () {
          if (i >= top.length) return Promise.resolve();
          var w = top[i++];
          if (w.fromRegistry && w.stats) { b.done++; return next(); }
          return SM.readRecord(chain, w.address, period).then(function (s) { if (s) applyStats(w, s, period); }, function (e) { if (b.errors.length < 3) b.errors.push('wallet record: ' + (e && e.message || 'error')); })
            .then(function () { b.done++; SM.renderBoardSoon(); return next(); });
        };
        for (var k = 0; k < 2; k++) lanes.push(next()); // two at a time: the request queue paces them to the plan anyway
        return Promise.all(lanes);
      });
    });
    return p.then(function () { b.loading = false; b.stage = ''; b.at = anyStats(b) ? U.now() : U.now() - 4 * MIN; SM.renderBoard(); return b; }, function (e) { b.loading = false; b.stage = ''; b.errors.push(e && e.message || 'error'); b.at = U.now() - 4 * MIN; SM.renderBoard(); return b; }); // an empty, failed board is asked again after a minute, not kept for five
  };
  function anyStats(b) { return Object.keys(b.wallets).some(function (a) { return !!b.wallets[a].stats; }); }
  function boardRows(b) {
    var list = Object.keys(b.wallets).map(function (a) { return b.wallets[a]; });
    if (SM.strongOnly) list = list.filter(function (w) { return SM.follows(w); }); // the point of the ranking: wallets that passed the gate
    if (SM.source !== 'all') list = list.filter(function (w) { return w.sources[SM.source]; });
    if (SM.pattern) list = list.filter(function (w) { return w.patterns.some(function (p) { return p.k === SM.pattern; }); });
    var sc = function (w) { return w.score ? w.score.value : -1; };
    var st = function (w) { return w.stats || null; };
    var S = {
      score: function (x, y) { return sc(y) - sc(x) || ((y.stats && y.stats.realized) || 0) - ((x.stats && x.stats.realized) || 0); },
      pnl: function (x, y) { return ((y.stats && y.stats.realized) || -1e12) - ((x.stats && x.stats.realized) || -1e12); },
      roi: function (x, y) { var q = function (w) { var v = st(w); return v && v.roi !== null && v.cost > 500 ? v.roi : -1e9; }; return q(y) - q(x) || sc(y) - sc(x); },
      size: function (x, y) { return SM.avgBuy(st(y)) - SM.avgBuy(st(x)) || sc(y) - sc(x); },
      winrate: function (x, y) { var q = function (w) { var v = st(w); return v && v.tokens >= 10 && v.winrate !== null ? v.winrate : -1; }; return q(y) - q(x) || sc(y) - sc(x); },
      disc: function (x, y) { var q = function (w) { var v = st(w); return v && v.dist && v.tokens >= 8 ? 1 - v.dist.lt50 / v.tokens : -1; }; return q(y) - q(x) || sc(y) - sc(x); },
      wl: function (x, y) { var q = function (w) { var v = st(w); return v && v.wins !== null ? (v.wins + 1) / ((v.losses || 0) + 1) : -1; }; return q(y) - q(x) || sc(y) - sc(x); },
      fast: function (x, y) { var q = function (w) { var v = st(w); return v && v.avgHold > 0 && v.winrate >= 0.5 && v.trades >= 20 ? v.avgHold : 1e12; }; return q(x) - q(y) || sc(y) - sc(x); },
      active: function (x, y) { return ((y.stats && y.stats.trades) || 0) - ((x.stats && x.stats.trades) || 0); }
    };
    return list.sort(S[SM.sort] || S.score);
  }
  var SORT_LABEL = { score: 'Strength score', pnl: 'Money taken out', roi: 'Return on capital', size: 'Position size', winrate: 'Win rate', disc: 'Loss discipline', wl: 'Wins vs losses', fast: 'Fastest flips', active: 'Most active' };
  function distBar(d, tn) {
    if (!d || !tn) return '<span class="dist empty"></span>';
    var seg = function (n, cls, label) { return n > 0 ? '<i class="' + cls + '" style="width:' + (n / tn * 100).toFixed(1) + '%" title="' + label + ': ' + n + '"></i>' : ''; };
    return '<span class="dist">' + seg(d.gt5, 'g3', 'over 5x') + seg(d.x2_5, 'g2', '2x to 5x') + seg(d.x0_2, 'g1', 'up to 2x') + seg(d.n50_0, 'r1', 'lost up to half') + seg(d.lt50, 'r2', 'lost more than half') + '</span>';
  }
  function badges(list, max) { return (list || []).slice(0, max || 3).map(function (p) { return '<span class="pat ' + (p.tone || '') + '"' + (p.why ? ' title="' + U.esc(p.why) + '"' : '') + '>' + U.esc(p.label) + '</span>'; }).join(''); }
  function whoHtml(w, chain, demo, size) {
    var s = w.stats || {};
    var name = w.name || s.name || ''; var tw = w.twitter || s.twitter || '';
    var fol = U.isNum(s.followers) ? ' · ' + U.fmtNum(s.followers) + ' followers' : '';
    var handle = tw ? (demo ? '<span class="tw">@' + U.esc(tw) + '</span>' : '<span class="tw" role="link" data-href="https://x.com/' + encodeURIComponent(tw) + '">@' + U.esc(tw) + '</span>') + (s.verified ? '<span class="vf" title="verified on X">✓</span>' : '') + '<span class="muted">' + fol + '</span>' : '';
    var gr = w.score && w.stats && !w.gateWhy ? w.score.grade : null;
    var tags = (gr ? '<span class="tag gr-' + gr.key + '" title="strength ' + w.score.value + ' / 100">' + gr.label + '</span>' : '') +
      SM.tagBadges(w.tags).map(function (t) { return '<span class="tag ' + t.tone + '">' + t.label + '</span>'; }).join('') + (demo ? '<span class="tag demo">demo</span>' : '');
    return '<span class="bd-who">' + SM.avatar(w.address, demo ? '' : (w.avatar || s.avatar), size || 34) + '<span class="bd-id"><b>' + U.esc(name || short(w.address)) + '</b><span class="bd-sub">' + handle + (name || tw ? '<span class="num muted">' + short(w.address) + '</span>' : '') + '</span>' + (tags ? '<span class="bd-tags">' + tags + '</span>' : '') + '</span></span>';
  }
  function lastMove(w) {
    if (w.last && w.last.at) return '<span class="side ' + (w.last.side === 'sell' ? 'sell' : 'buy') + '">' + (w.last.side === 'sell' ? 'SOLD' : 'BOUGHT') + '</span> ' + (U.isNum(w.last.usd) ? U.fmtUsd(w.last.usd) + ' ' : '') + U.esc(w.last.symbol || '') + '<small>' + U.fmtAge(U.now() - w.last.at) + ' ago</small>';
    if (w.hot.length) { var h = w.hot[0]; return 'made ' + sgnUsd(h.profit) + ' on ' + U.esc(h.symbol) + '<small>today\'s hot token</small>'; }
    return '<span class="muted">–</span>';
  }
  function rowHtml(w, i, b) {
    var s = w.stats, sc = w.score, href = '#/smart/wallet/' + SLUG[b.chain] + '/' + encodeURIComponent(w.address);
    var why = sc && sc.notes.length ? ' · ' + sc.notes.join(' · ') : '';
    var scoreCell = sc ? '<span class="bd-score s' + (sc.value >= 78 ? 4 : sc.value >= 62 ? 3 : sc.value >= 45 ? 2 : 1) + '" title="Strength ' + sc.value + ' / 100' + why + '"><b>' + sc.value + '</b><i style="width:' + sc.value + '%"></i></span>' : '<span class="bd-score"><b class="muted">' + (b.loading ? '…' : '–') + '</b></span>';
    if (!s) return '<a class="bd-row" href="' + href + '"><span class="bd-rank num">' + (i + 1) + '</span>' + whoHtml(w, b.chain, b.demo) + scoreCell + '<span class="bd-wait muted">' + (b.loading ? 'reading its GMGN record…' : 'no GMGN record for ' + periodTxt(b.period)) + '</span><span class="bd-last">' + lastMove(w) + '</span></a>';
    var wr = s.winrate !== null ? Math.round(s.winrate * 100) : null;
    var pats = w.gateWhy ? [{ k: 'gate', label: 'Not followable', tone: 'warn', why: w.gateWhy }].concat(w.patterns) : w.patterns;
    return '<a class="bd-row' + (w.gateWhy ? ' dim' : '') + '" href="' + href + '">' +
      '<span class="bd-rank num">' + (i + 1) + '</span>' + whoHtml(w, b.chain, b.demo) + scoreCell +
      '<span class="num bd-pnl"><b class="' + (s.realized > 0 ? 'up' : s.realized < 0 ? 'down' : '') + '">' + sgnUsd(s.realized) + '</b><small>' + (U.isNum(s.roi) ? 'ROI ' + U.fmtPct(s.roi * 100, 0) : '') + '</small></span>' +
      '<span class="num bd-win"><b>' + (wr !== null ? wr + '%' : '–') + '</b><span class="wbar"><i style="width:' + (wr || 0) + '%"></i></span></span>' +
      '<span class="num bd-wl"><b><span class="up">' + (s.wins !== null ? U.fmtNum(s.wins) : '–') + '</span> / <span class="down">' + (s.losses !== null ? U.fmtNum(s.losses) : '–') + '</span></b>' + distBar(s.dist, s.tokens) + '</span>' +
      '<span class="num bd-tr"><b>' + U.fmtNum(s.tokens) + ' tokens</b><small>' + U.fmtNum(s.trades) + ' trades</small></span>' +
      '<span class="num bd-hold"><b>' + U.fmtUsd(SM.avgBuy(s)) + '</b><small>avg buy · ' + dur(s.avgHold) + ' hold</small></span>' +
      '<span class="bd-pats">' + (badges(pats, 3) || '<span class="muted">–</span>') + '</span>' +
      '<span class="bd-last">' + lastMove(w) + '</span></a>';
  }
  var renderTimer = null;
  SM.renderBoardSoon = function () { if (renderTimer) return; renderTimer = setTimeout(function () { renderTimer = null; SM.renderBoard(); }, 400); };
  SM.renderBoard = function () {
    var el = $('#smartBoard'); if (!el || SM.view !== 'board') return;
    var chain = net(), g = G(), demo = demoMode();
    var head = '<div class="board-head"><div><h2>Wallets worth following</h2><p>Smart money, KOLs and the traders who made money on today\'s launches, each read from its GMGN record over ' + periodTxt(SM.period) + ' and ranked by strength.</p></div>';
    var visitor = TL.CONFIG && TL.CONFIG.setupCards === false; // v1.40: on the live site the source is the site's own server, nothing for a visitor to set up
    if (!demo && (!g || !g.configured())) {
      el.innerHTML = head + '</div><div class="board-empty">' + (visitor ?
        '<h3>Wallet ranking is not available right now</h3><p>It runs on GMGN data through the site\'s own server, which is not answering at the moment. It comes back on its own: reload the page in a minute. Until then, paste a token above to read its traders straight from the chain.</p>' :
        '<h3>Wallet ranking needs the GMGN source</h3><p>Connect it once in Data sources: a server proxy or a key. Until then, paste a token above to read its traders straight from the chain.</p><button class="btn" data-act="gmgnConnect">Data sources</button>') + '</div>';
      return;
    }
    if (!demo && g.state === 'auth') { el.innerHTML = head + '</div><div class="board-empty"><h3>' + (visitor ? 'Wallet ranking is not available right now' : 'GMGN rejected the key') + '</h3><p>' + U.esc(visitor ? 'GMGN refused the site\'s key, so the ranking is paused until that is fixed. Paste a token above to read its traders straight from the chain.' : g.note) + '</p>' + (visitor ? '' : '<button class="btn primary" data-act="gmgnConnect">Data sources</button>') + '</div>'; return; }
    var b = demo ? SM.demoBoard(chain, SM.period) : SM.build(chain, SM.period);
    var all = Object.keys(b.wallets).map(function (a) { return b.wallets[a]; });
    var cnt = function (src) { return all.filter(function (w) { return src === 'all' || w.sources[src]; }).length; };
    var pcnt = function (k) { return all.filter(function (w) { return w.patterns.some(function (p) { return p.k === k; }); }).length; };
    var followable = all.filter(function (w) { return SM.follows(w); }).length;
    var scored = all.filter(function (w) { return !!w.stats; }).length;
    var rows = boardRows(b).slice(0, 100);
    var tools = '<div class="board-tools"><div class="seg" id="bdPeriod" role="group" aria-label="Period">' + ['7d', '30d'].map(function (p) { return '<button data-period="' + p + '" aria-pressed="' + (SM.period === p) + '">' + p.toUpperCase() + '</button>'; }).join('') + '</div>' +
      '<select class="sel" id="bdSort" aria-label="Rank by">' + Object.keys(SORT_LABEL).map(function (k) { return '<option value="' + k + '"' + (SM.sort === k ? ' selected' : '') + '>' + SORT_LABEL[k] + '</option>'; }).join('') + '</select>' +
      (demo ? '' : '<button class="btn" data-act="bdRefresh"' + (b.loading ? ' disabled' : '') + '>Refresh</button>') + '</div></div>';
    var chips = '<div class="board-chips"><div class="chips">' +
      '<button class="chip" data-strong="1" aria-pressed="' + (SM.strongOnly ? 'true' : 'false') + '" title="Only wallets that pass the minimum record: size, profit, discipline and recent activity">Worth following <span class="cnt">' + followable + '</span></button>' +
      '<button class="chip" data-strong="0" aria-pressed="' + (SM.strongOnly ? 'false' : 'true') + '" title="Every wallet read, including the ones the gate dropped">Everyone <span class="cnt">' + scored + '</span></button>' +
      '</div><div class="chips">' + [['all', 'All sources'], ['known', 'Known traders'], ['smart', 'Smart money'], ['kol', 'KOLs'], ['hot', 'Hot launches'], ['run', 'Coins that ran']].map(function (c) { return '<button class="chip" data-source="' + c[0] + '" aria-pressed="' + (SM.source === c[0]) + '">' + c[1] + ' <span class="cnt">' + cnt(c[0]) + '</span></button>'; }).join('') + '</div>' +
      '<div class="chips pats">' + SM.PATTERN_FILTERS.map(function (p) { return '<button class="chip" data-pattern="' + p[0] + '" aria-pressed="' + (SM.pattern === p[0]) + '">' + p[1] + ' <span class="cnt">' + pcnt(p[0]) + '</span></button>'; }).join('') + '</div></div>';
    var progress = b.loading ? '<div class="x-progress"><span>' + U.esc(b.stage || 'Loading…') + (b.total ? ' ' + b.done + ' / ' + b.total : '') + '</span><div class="bar"><i style="width:' + Math.round(b.total ? 10 + 90 * b.done / b.total : 8) + '%"></i></div></div>' : '';
    var errs = !b.loading && b.errors.length && !rows.length ? '<div class="x-error">' + U.esc(b.errors.slice(0, 3).join(' · ')) + '</div>' : '';
    var list = rows.length ? '<div class="bd-list"><div class="bd-row head"><span>#</span><span>Wallet</span><span>Strength</span><span>Money out</span><span>Win rate</span><span>Wins / losses</span><span>Activity</span><span>Size</span><span>Patterns</span><span>Latest move</span></div>' + rows.map(function (w, i) { return rowHtml(w, i, b); }).join('') + '</div>' :
      (b.loading ? '' : '<div class="x-note">' + (SM.strongOnly && scored ? 'None of the ' + scored + ' wallets read clears the bar. Everyone shows them with the reason.' : 'No wallets match these filters.') + '</div>');
    var foot = '<details class="x-how"><summary>How strength is scored</summary><p class="board-foot">Strength 0-100 = realized profit 22% + return on capital 18% + consistency 16% (win rate and how often a token doubled) + loss discipline 14% + position size 12% + sample 10% + still active 8%. Then the multipliers: a wallet that mostly trades its own launches counts at 45%, bot-speed trading at 85%, a sniper at 95%, a wallet funded under 5 days ago with big wins at 90%; GMGN smart money adds 5%, a verified known account 3%. To be called worth following in ' + periodTxt(SM.period) + ' a wallet needs at least ' + SM.MIN[SM.period].tokens + ' tokens, ' + SM.MIN[SM.period].trades + ' trades, ' + U.fmtUsd(SM.MIN[SM.period].cost) + ' put to work, ' + U.fmtUsd(SM.MIN[SM.period].realized) + ' taken out, an average buy over ' + U.fmtUsd(SM.MIN[SM.period].avgBuy) + ', ROI over ' + Math.round(SM.MIN[SM.period].roi * 100) + '%, a win rate over ' + Math.round(SM.MIN[SM.period].winrate * 100) + '% and a trade in the last ' + Math.round(SM.MIN[SM.period].idle / DAY) + ' days, and it must score ' + SM.MIN_FOLLOW + '+. ' + (demo ? 'Preview: fictional wallets, simulated numbers.' : 'Data: GMGN OpenAPI, last ' + periodTxt(b.period) + (b.remote && U.isNum(b.builtAt) ? ', ranking built by the site\'s server ' + U.fmtAge(U.now() - b.builtAt) + ' ago' : (b.at && !b.loading ? ', read ' + U.fmtAge(U.now() - b.at) + ' ago' : '')) + '.') + '</p></details>';
    var keepY = window.scrollY;
    el.innerHTML = '<div id="knownPanel"></div>' + head + tools + chips + progress + errs + list + foot;
    SM.renderKnown();
    if (Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY);
  };
  // ---------- v1.48/v1.49: known traders: the registry (GMGN's KOL feed, the records the data service read), the person's own traders, and the trades ----------
  // The panel folds to one line (its state is kept), cards on this site are off until the person turns them on here, a wallet of
  // their own choice joins with ★, and the trade list is filtered and sorted the way they set it. Nothing here pushes on its own.
  SM.knownFilter = saved.knownFilter || 'top';
  SM.knownQuery = '';
  SM.knownSettings = false;
  var TIER_TONE = { top: 'smart', proven: 'good', kol: '', smart: '', named: '', watch: 'mine' };
  function knownPrefs() { return TL.known ? TL.known.prefs : {}; }
  function savePrefs() { if (TL.known) TL.known.savePrefs(); }
  function lastTradeOf(K, chain, addr) { for (var i = K.trades.length - 1; i >= 0; i--) { var x = K.trades[i]; if (x.chain === chain && x.wallet === addr) return x; } return null; }
  function knownCard(e, chain, K) {
    var st = e.stats, href = '#/smart/wallet/' + SLUG[chain] + '/' + encodeURIComponent(e.address);
    var last = lastTradeOf(K, chain, e.address), mine = K.watching(chain, e.address), w = mine ? K.watch[chain + ':' + e.address] : null;
    var tierKey = mine && (!e.tier || e.tier === 'named' || e.tier === '') ? 'watch' : e.tier;
    var tier = K.TIER[tierKey] ? '<span class="tag ' + (TIER_TONE[tierKey] || '') + '" title="' + U.esc(K.TIER[tierKey][1]) + '">' + K.TIER[tierKey][0] + '</span>' : '';
    var rec = st ? '<span class="num ' + (st.realized > 0 ? 'up' : st.realized < 0 ? 'down' : '') + '">' + sgnUsd(st.realized) + '</span> 30d' + (st.winrate !== null && U.isNum(st.winrate) ? ' · ' + Math.round(st.winrate * 100) + '% wins' : '') + (st.tokens ? ' · ' + U.fmtNum(st.tokens) + ' tokens' : '') : (U.isNum(e.followers) ? U.fmtNum(e.followers) + ' followers on X' : 'record not read yet');
    var move = last ? '<span class="side ' + (last.side === 'sell' ? 'sell' : 'buy') + '">' + (last.side === 'sell' ? 'SOLD' : 'BOUGHT') + '</span> ' + U.fmtUsd(last.usd) + ' <b>' + U.esc(last.symbol || '') + '</b> <small><span data-born="' + last.at + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - last.at) + ' ago</span></small>' : '<span class="muted">' + (mine && !(e.src && (e.src.kol || e.src.smartmoney)) ? 'reading its trades…' : 'seen ' + U.fmtAge(U.now() - e.lastSeen) + ' ago') + '</span>';
    var name = (w && w.name) || e.name || (e.twitter ? '@' + e.twitter : short(e.address));
    return '<div class="kn-card' + (mine ? ' mine' : '') + '"><a class="kn-link" href="' + href + '">' + SM.avatar(e.address, e.avatar, 36) + '<span class="kn-body"><span class="kn-name"><b>' + U.esc(name) + '</b>' + tier + '</span>' +
      (e.twitter ? '<span class="kn-sub"><span class="tw" role="link" data-href="https://x.com/' + encodeURIComponent(e.twitter) + '" title="Open the X profile">@' + U.esc(e.twitter) + '</span></span>' : '<span class="kn-sub num muted">' + short(e.address) + '</span>') + '<span class="kn-rec">' + rec + '</span><span class="kn-move">' + move + '</span></span></a>' +
      '<button class="kn-star" type="button" data-watch="' + U.esc(e.address) + '" aria-pressed="' + (mine ? 'true' : 'false') + '" title="' + (mine ? 'Stop watching this wallet' : 'Watch this wallet: its buys always reach you here') + '">' + (mine ? '★' : '☆') + '</button></div>';
  }
  function knownTradeRow(x, chain, K) {
    var e = K.get(chain, x.wallet), t = store.get(chain + ':' + x.token), mine = K.watching(chain, x.wallet);
    var name = mine && K.watch[chain + ':' + x.wallet].name ? K.watch[chain + ':' + x.wallet].name : (e ? K.label(e) : x.name || short(x.wallet));
    var tierKey = mine ? 'watch' : (e ? e.tier : '');
    var who = '<a class="kn-who" href="#/smart/wallet/' + SLUG[chain] + '/' + encodeURIComponent(x.wallet) + '" title="' + U.esc(name + (K.TIER[tierKey] ? ' · ' + K.TIER[tierKey][0] : '') + ': open the wallet') + '">' + SM.avatar(x.wallet, e ? e.avatar : '', 22) + '<b>' + U.esc(name) + '</b>' + (K.TIER[tierKey] && tierKey !== 'kol' ? '<span class="tag ' + (TIER_TONE[tierKey] || '') + '">' + K.TIER[tierKey][0] + '</span>' : '') + '</a>';
    var act = '<span class="kn-act"><span class="side ' + (x.side === 'sell' ? 'sell' : 'buy') + '">' + (x.side === 'sell' ? 'SOLD' : 'BOUGHT') + '</span> <b class="num">' + U.fmtUsd(x.usd) + '</b></span>';
    var pic = TL.ui && TL.ui.miniLogo ? TL.ui.miniLogo({ chain: chain, address: x.token, symbol: x.symbol, logo: (t && (t.logoOk || t.logo)) || x.logo }) : '';
    var tok = t ? '<a class="kn-tok" href="' + (TL.ui ? TL.ui.tokenHref(t) : '#') + '">' + pic + '<b>' + U.esc(t.symbol || x.symbol) + '</b> <small>' + U.fmtUsd(t.mc) + (t.verdict ? ' · ' + U.esc(t.verdict) : '') + '</small></a>' : '<a class="kn-tok" href="' + U.esc(TL.gmgnToken(chain, x.token)) + '" target="_blank" rel="noopener" title="Not in the feed: open on GMGN">' + pic + '<b>' + U.esc(x.symbol || short(x.token)) + '</b> <small>not in the feed ↗</small></a>';
    var s = K.since(x), since = '<span class="muted">–</span>';
    if (s && s.verdict === 'RUGGED') since = '<span class="down">rugged since</span>';
    else if (s && U.isNum(s.x)) since = '<span class="num ' + (s.x >= 1.05 ? 'up' : s.x <= 0.95 ? 'down' : '') + '" title="the token\'s price now against the price at this trade">' + (s.x >= 1 ? '+' : '') + Math.round((s.x - 1) * 100) + '%</span>';
    var mark = '<span class="kn-mark">' + (mine ? '<span class="tag mine">★ mine</span>' : (x.alerted ? '<span class="tag good" title="' + U.esc('Qualified: a ' + (K.TIER[x.tier] ? K.TIER[x.tier][0].toLowerCase() : 'known trader') + ', ' + U.fmtUsd(x.usd) + ', a token the feed shows') + '">🐋 ' + (K.TIER[x.tier] ? K.TIER[x.tier][0] : 'qualified') + '</span>' : (x.why ? '<span class="muted kn-why" title="' + U.esc('Not a signal: ' + x.why) + '">' + U.esc(x.why.length > 30 ? x.why.slice(0, 28) + '…' : x.why) + '</span>' : ''))) + '</span>';
    return '<div class="kn-buy' + (x.alerted ? ' hot' : '') + (mine ? ' mine' : '') + '"><span class="num muted"><span data-born="' + x.at + '" data-suffix=" ago">' + U.fmtAgeLive(U.now() - x.at) + ' ago</span></span>' + who + act + tok + '<span class="kn-since">' + since + '</span>' + mark + '</div>';
  }
  function knownGridHtml(chain, K) {
    var q = SM.knownQuery.toLowerCase(), f = SM.knownFilter, all = K.all(chain);
    var mineList = K.watched(chain).map(function (w) { return K.get(chain, w.address) || { id: chain + ':' + w.address, chain: chain, address: w.address, name: w.name, twitter: '', avatar: '', tags: [], src: {}, tier: 'watch', lastSeen: w.at, stats: null }; });
    var list = f === 'mine' ? mineList : all.filter(function (e) { return (f === 'all' ? !!(e.name || e.twitter || e.tier === 'proven') : f === 'kol' ? (e.tier === 'kol' || e.tier === 'top') : e.tier === f); });
    if (q) list = list.filter(function (e) { return ((e.name || '') + ' ' + (e.twitter || '') + ' ' + e.address).toLowerCase().indexOf(q) >= 0; });
    list = list.slice(0, 24);
    if (!list.length) return '<div class="x-note" id="knownGrid">' + (f === 'mine' ? 'No wallet of yours yet: press ☆ on a trader, or paste an address below.' : q ? 'No trader matches.' : (all.length ? 'No trader in this group yet.' : (K.at ? 'No KOL trade seen on this network yet.' : 'Reading GMGN\'s KOL feed…'))) + '</div>';
    return '<div class="kn-grid" id="knownGrid">' + list.map(function (e) { return knownCard(e, chain, K); }).join('') + '</div>';
  }
  function knownListHtml(chain, K) {
    var P = knownPrefs();
    var rows = K.tradeList(chain, { side: P.side, min: P.min, mine: P.mine, inFeed: P.inFeed, sort: P.sort, sinceMs: DAY }, 40);
    var chip = function (key, val, label, title) { return '<button class="chip small" data-kpref="' + key + '" data-val="' + val + '" aria-pressed="' + (String(P[key]) === String(val)) + '"' + (title ? ' title="' + U.esc(title) + '"' : '') + '>' + label + '</button>'; };
    var toggle = function (key, label, title) { return '<button class="chip small" data-kpref="' + key + '" data-val="toggle" aria-pressed="' + (P[key] ? 'true' : 'false') + '"' + (title ? ' title="' + U.esc(title) + '"' : '') + '>' + label + '</button>'; };
    var tools = '<div class="kn-tools"><div class="chips">' + chip('side', 'buy', 'Buys') + chip('side', 'all', 'Buys and sells') + '</div><div class="chips">' + chip('min', 0, 'Any size') + chip('min', 100, '$100+') + chip('min', 500, '$500+') + chip('min', 1000, '$1K+') + '</div>' +
      '<div class="chips">' + toggle('mine', '★ Only my traders', 'the wallets you watch') + toggle('inFeed', 'Only tokens in the feed', 'trades of tokens this terminal shows; the rest are older or bigger coins') + '</div><div class="chips">' + chip('sort', 'time', 'Newest first') + chip('sort', 'usd', 'Biggest first') + '</div></div>';
    return '<div class="kn-feed"><div class="kn-feed-h"><h3>Known traders\' trades</h3><span class="muted">' + (rows.length ? rows.length + ' shown · last 24 h' : 'none match') + '</span></div>' + tools +
      (rows.length ? '<div class="kn-buys"><div class="kn-buy head"><span>When</span><span>Who</span><span>What</span><span>Token · cap now</span><span>Since</span><span></span></div>' + rows.map(function (x) { return knownTradeRow(x, chain, K); }).join('') + '</div>' : '<div class="x-note">Nothing in the last 24 hours matches these filters.</div>') +
      '<div class="x-note">Since: the token\'s price now against the price at that trade, so a name inside can be judged by what followed. 🐋 marks a buy that qualified (a KOL, top or proven trader, ' + U.fmtUsd(K.RULE.minUsd) + '+, a token the feed shows); cards for those are off until you turn them on above.</div></div>';
  }
  function knownSettingsHtml(K) {
    var P = knownPrefs();
    var chip = function (key, val, label) { return '<button class="chip small" data-kpref="' + key + '" data-val="' + val + '" aria-pressed="' + (String(P[key]) === String(val)) + '">' + label + '</button>'; };
    var notif = ('Notification' in window) ? (Notification.permission === 'granted' ? '<button class="chip small" data-kpref="notify" data-val="toggle" aria-pressed="' + (P.notify ? 'true' : 'false') + '">🔔 Browser notification too</button>' : Notification.permission === 'denied' ? '<span class="muted">browser notifications are blocked for this site</span>' : '<button class="chip small" data-kpref="notifyAsk" data-val="1">🔔 Allow browser notifications</button>') : '';
    return '<div class="kn-settings" id="knownSettings"><div class="kn-set-row"><b>Cards on this site</b><div class="chips">' + chip('alerts', 'true', 'On') + chip('alerts', 'false', 'Off') + '</div><span class="muted">a card in the corner when a trader buys; your own traders (★) always get one</span></div>' +
      '<div class="kn-set-row"><b>Whose buys</b><div class="chips">' + chip('tiers', 'top', 'Top KOLs and proven wallets') + chip('tiers', 'kol', 'Every KOL') + '</div></div>' +
      '<div class="kn-set-row"><b>From</b><div class="chips">' + chip('minUsd', 200, '$200') + chip('minUsd', 500, '$500') + chip('minUsd', 1000, '$1K') + chip('minUsd', 2500, '$2.5K') + '</div><span class="muted">only tokens the feed shows and would show a person: past the gate, not rugged, not a big old coin</span></div>' +
      (notif ? '<div class="kn-set-row"><b>Away from the tab</b><div class="chips">' + notif + '</div></div>' : '') + '</div>';
  }
  SM.renderKnown = function () {
    var box = $('#knownPanel'), K = TL.known; if (!box || !K) return;
    var chain = net(), demo = demoMode(), g = G(), P = knownPrefs();
    if (demo || !g || !g.configured()) { box.innerHTML = demo ? '<section class="kn-panel"><div class="board-head kn-head"><div><h2>Known traders</h2><p>On the live site this panel shows the KOLs and top wallets GMGN knows by name (Cupsey and the like), their trades, and marks the tokens they bought; you can watch wallets of your own and turn cards on. The preview has no GMGN source, so it stays empty here.</p></div></div></section>' : ''; return; }
    var all = K.all(chain), counts = { top: 0, proven: 0, kol: 0, all: 0, mine: K.watched(chain).length };
    all.forEach(function (e) { if (e.name || e.twitter || e.tier === 'proven') counts.all++; if (e.tier === 'top') { counts.top++; counts.kol++; } else if (e.tier === 'proven') counts.proven++; else if (e.tier === 'kol') counts.kol++; });
    var recent = K.trades.filter(function (x) { return x.chain === chain && U.now() - x.at < HR && (x.name || x.tw || K.watching(chain, x.wallet)); }).length;
    var summary = (counts.top ? counts.top + ' top KOLs' : (K.at ? 'no top KOL seen yet' : 'reading the feed')) + (counts.kol > counts.top ? ' · ' + counts.kol + ' KOLs' : '') + (counts.mine ? ' · ★ ' + counts.mine + ' of yours' : '') + ' · ' + recent + ' trade' + (recent === 1 ? '' : 's') + ' in the last hour';
    var alertsBtn = '<button class="chip" data-kact="settings" aria-pressed="' + (SM.knownSettings ? 'true' : 'false') + '" title="Cards on this site, whose buys, from what size">' + (P.alerts ? '🐋 Cards on · ' + (P.tiers === 'kol' ? 'every KOL' : 'top + proven') + ' · ' + U.fmtUsd(P.minUsd) + '+' : '🔕 Cards off') + (counts.mine ? ' · ★ mine on' : '') + '</button>';
    var foldBtn = '<button class="chip" data-kact="fold" title="' + (P.collapsed ? 'Open the panel' : 'Fold the panel to one line; the ranking below stays') + '">' + (P.collapsed ? 'Show ▾' : 'Hide ▴') + '</button>';
    var head = '<div class="kn-bar"><div class="kn-title"><h2>Known traders</h2><span class="muted">' + U.esc(summary) + '</span></div><div class="kn-bar-tools">' + alertsBtn + foldBtn + '</div></div>';
    if (P.collapsed) { box.innerHTML = '<section class="kn-panel folded">' + head + '</section>'; return; }
    var chips = [['top', 'Top KOLs', counts.top], ['proven', 'Proven', counts.proven], ['kol', 'All KOLs', counts.kol], ['all', 'Everyone named', counts.all], ['mine', '★ My traders', counts.mine]].map(function (c) { return '<button class="chip" data-kfilter="' + c[0] + '" aria-pressed="' + (SM.knownFilter === c[0]) + '">' + c[1] + ' <span class="cnt">' + c[2] + '</span></button>'; }).join('');
    var add = '<form class="kn-add" id="knownAdd"><input class="inp" id="knownAddr" type="text" placeholder="Wallet address to watch (' + (chain === 'robinhood' ? '0x…' : 'Solana') + ')" aria-label="Wallet address to watch" autocomplete="off" spellcheck="false" maxlength="48"><input class="inp kn-add-name" id="knownName" type="text" placeholder="Name (optional)" aria-label="A name for it" maxlength="24"><button class="btn" type="submit">★ Watch</button></form>';
    var intro = '<p class="kn-intro">The KOLs and top wallets GMGN knows by name, as they trade (the feed is read every 30 seconds, the site\'s server keeps their records). ☆ on a card watches that wallet: its buys always reach you here, whatever the size. Up to ' + K.RULE.watchMax + ' wallets, kept in this browser.</p>';
    box.innerHTML = '<section class="kn-panel">' + head + (SM.knownSettings ? knownSettingsHtml(K) : '') + intro + '<div class="board-chips kn-chips"><div class="chips">' + chips + '</div><input class="inp kn-search" id="knownSearch" type="search" placeholder="Find a trader by name or address" value="' + U.esc(SM.knownQuery) + '" aria-label="Find a known trader" autocomplete="off"></div>' + knownGridHtml(chain, K) + add + knownListHtml(chain, K) + '</section>';
  };
  var knownTimer = null;
  SM.renderKnownSoon = function () { if (knownTimer) return; knownTimer = setTimeout(function () { knownTimer = null; if (SM.view === 'board' && document.activeElement && /^(knownSearch|knownAddr|knownName)$/.test(document.activeElement.id)) return; SM.renderKnown(); }, 500); };
  // a wallet of the person's own: the address checked, its name read from GMGN when there is one
  SM.watchWallet = function (chain, addr, name) {
    var K = TL.known; if (!K) return 'not available';
    addr = String(addr || '').trim(); if (chain === 'robinhood' ? !/^0x[0-9a-fA-F]{40}$/.test(addr) : !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return 'That does not look like a ' + (chain === 'robinhood' ? 'Robinhood Chain (0x…)' : 'Solana') + ' wallet address.';
    if (K.watching(chain, addr)) return 'Already watching it.';
    var w = K.addWatch(chain, addr, name); if (!w) return 'That is ' + K.RULE.watchMax + ' wallets already: unwatch one first.';
    var g = G(); if (g && g.active() && SM.readRecord) SM.readRecord(chain, addr, '30d').then(function (st) { var e = K.get(chain, addr); if (st) { if (!e) e = K.note(chain, addr, { name: st.name, twitter: st.twitter, avatar: st.avatar, tags: st.tags, src: 'watch', at: U.now() }); K.applyStats(e, st, null); if (!w.name && st.name) { w.name = st.name; K.saveWatch(); } K.emit('change'); } }, function () {});
    return '';
  };
  SM.home = function () { SM.view = 'board'; var out = $('#xrayOut'); if (out) out.innerHTML = ''; if (TL.xray) TL.xray.report = null; var bd = $('#smartBoard'); if (bd) bd.hidden = false; SM.renderBoard(); };
  SM.hideBoard = function () { SM.view = 'detail'; var bd = $('#smartBoard'); if (bd) { bd.hidden = true; bd.innerHTML = ''; } };

  // ---------- wallet profile ----------
  SM.openWallet = function (chain, addr) {
    if (!chain || !addr) { location.hash = '#/smart'; return; }
    if (chain === 'robinhood') addr = String(addr).toLowerCase();
    SM.hideBoard(); if (TL.xray) TL.xray.report = { address: addr, chain: chain, wallet: true };
    var key = chain + ':' + addr, out = $('#xrayOut'), inp = $('#xrayInput'); if (inp) inp.value = addr;
    var demo = demoMode(), g = G();
    var p = SM.profiles[key];
    if (!p || U.now() - p.at > 3 * MIN) {
      p = SM.profiles[key] = { chain: chain, address: addr, at: U.now(), stats: {}, activity: null, loading: true, error: '', demo: demo };
      if (demo) { SM.demoProfile(p); p.loading = false; }
      else if (g && g.active()) {
        var jobs = ['7d', '30d'].map(function (per) { return g.walletStats(chain, [addr], per).then(function (res) { p.stats[per] = SM.readStats(res[addr] || res[Object.keys(res)[0]]); }, function (e) { p.error = e && e.message || 'error'; }); });
        jobs.push(g.walletActivity(chain, addr, 40).then(function (list) { p.activity = list; }, function () { p.activity = []; }));
        Promise.all(jobs).then(function () { p.loading = false; if (!p.stats['7d'] && !p.stats['30d'] && p.error) p.at = U.now() - 150 * TL.SEC; if (SM.view === 'detail' && TL.xray && TL.xray.report && TL.xray.report.address === addr) SM.renderWallet(p); });
      } else if (TL.xray && TL.xray.walletFacts) { // no GMGN source: what the chain itself says, then its record on its last tokens
        p.loading = true;
        var same = function () { return SM.view === 'detail' && TL.xray && TL.xray.report && TL.xray.report.address === addr; };
        TL.xray.walletFacts(chain, addr).then(function (f) { p.facts = f; }, function (e) { p.error = (e && e.message) || 'could not read the address'; })
          .then(function () {
            p.loading = false; if (same()) SM.renderWallet(p);
            if (chain !== 'solana' || !TL.xray.walletRecord) return;
            p.recordLoading = true; if (same()) SM.renderWallet(p);
            return TL.xray.walletRecord(addr).then(function (r) { p.record = r; }, function () { p.record = null; }).then(function () { p.recordLoading = false; if (same()) SM.renderWallet(p); });
          });
      } else { p.loading = false; }
    }
    SM.remember(chain, addr, p);
    SM.renderWallet(p);
  };
  SM.remember = function (chain, addr, p) {
    var X = TL.xray; if (!X) return;
    var s = p && (p.stats['7d'] || p.stats['30d']);
    X.recent = [{ addr: addr, chain: chain, symbol: (s && (s.name || (s.twitter && '@' + s.twitter))) || short(addr), wallet: true }].concat(X.recent.filter(function (r) { return r.addr !== addr; })).slice(0, 6);
    try { localStorage.setItem('tl.xrayRecent', JSON.stringify(X.recent)); } catch (e) {}
    if (X.renderRecent) X.renderRecent();
  };
  SM.walletPeriod = SM.period === '7d' ? '7d' : '30d'; // the profile opens on the same period the ranking is judged on
  // What we can show about a wallet with no GMGN source: the chain's own facts, plus its position in the token we just analyzed.
  function onchainWallet(p) {
    var f = p.facts, tile = function (k, v, sub) { return '<div class="x-tile"><span>' + k + '</span><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    if (p.loading && !f) return '<div class="x-progress"><span>Reading the address on-chain…</span><div class="bar"><i style="width:40%"></i></div></div>';
    var tiles = f ? '<div class="x-tiles">' +
      tile('Balance', U.isNum(f.balance) ? f.balance.toFixed(f.balance >= 10 ? 2 : 4) + ' ' + f.balanceUnit : '–', 'on ' + (p.chain === 'solana' ? 'Solana' : 'Robinhood Chain')) +
      tile('Transactions', U.isNum(f.txCount) ? (f.txPlus ? '1000+' : U.fmtNum(f.txCount)) : '–', U.isNum(f.last24h) ? U.fmtNum(f.last24h) + ' in the last day' : '') +
      (U.isNum(f.ageMs) ? tile('Wallet age', (f.ageIsMin ? '> ' : '') + U.fmtAge(f.ageMs), f.ageIsMin ? 'older than its last 1000 transactions' : '') : '') +
      (U.isNum(f.lastAt) ? tile('Last seen', U.fmtAge(U.now() - f.lastAt) + ' ago', '') : '') +
      (U.isNum(f.transfers) ? tile('Token transfers', U.fmtNum(f.transfers), f.contract ? 'contract address' : '') : '') + '</div>' : '';
    // the position this wallet holds in the token that is open in the analyzer
    var rep = TL.xray && TL.xray.report && TL.xray.report.list ? TL.xray.report : null;
    var w = rep ? rep.list.filter(function (x) { return String(x.addr || x.address || '').toLowerCase() === String(p.address).toLowerCase(); })[0] : null;
    var pos = '';
    if (w && rep.token) {
      var money = function (v) { return U.isNum(v) && rep.quoteUsd ? U.fmtUsd(v * rep.quoteUsd) : '–'; };
      pos = '<section class="tp-card"><div class="tp-card-h"><h3>On ' + U.esc(rep.token.symbol || 'this token') + '</h3><span class="src">read from the chain</span></div>' +
        '<div class="x-tiles">' + tile('Bought', money(w.inQuote), (w.buys || 0) + ' buys') + tile('Sold', money(w.outQuote), (w.sells || 0) + ' sells') +
        tile('Holds', money(w.holdValue), U.isNum(w.share) ? (w.share * 100).toFixed(2) + '% of supply' : '') +
        tile('Taken out', money(w.realized), 'money actually realized') + tile('On paper', money(w.paper), 'only while the position is open') + '</div></section>';
    }
    // v1.31: the wallet's last tokens, read from the chain (an even sample of its recent transactions, the full history of
    // each position it paid for, open ones priced through Jupiter): a small record where the GMGN 30-day one is not connected
    var rec = '';
    if (p.recordLoading && !p.record) rec = '<section class="tp-card"><div class="tp-card-h"><h3>Its last tokens</h3><span class="src">reading the chain</span></div><div class="x-rec">Reading its recent positions on other tokens…</div></section>';
    else if (p.record) {
      var r = p.record, X = TL.xray;
      var sol = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(Math.abs(v) >= 10 ? 1 : 2) + ' SOL'; };
      var cls = r.verdict === 'up' ? 'up' : r.verdict === 'down' ? 'down' : '';
      var rows = (r.positions || []).slice().sort(function (a, b) { return (b.last || 0) - (a.last || 0); }).map(function (ps) {
        return '<div class="x-tr"><span class="t">' + (U.isNum(ps.last) && ps.last ? U.fmtAge(U.now() - ps.last) + ' ago' : '–') + '</span><span class="side ' + (ps.pnl > 0 ? 'buy' : 'sell') + '">' + (ps.pnl > 0 ? 'WON' : ps.pnl < 0 ? 'LOST' : 'FLAT') + '</span><span class="num">' + sol(ps.pnl || 0) + '</span><span class="num">in ' + ps.spent.toFixed(2) + ' · out ' + ps.got.toFixed(2) + (ps.held > 0 ? ' · holds ' + (ps.unpriced ? '? (unpriced)' : (ps.heldValue || 0).toFixed(2)) : '') + '</span><span class="addr"><a href="' + U.esc(TL.gmgnToken('solana', ps.mint)) + '" target="_blank" rel="noopener">' + U.esc(short(ps.mint)) + '</a></span></div>';
      }).join('');
      rec = '<section class="tp-card"><div class="tp-card-h"><h3>Its last tokens</h3><span class="src">read from the chain</span></div>' +
        '<div class="x-tiles">' + tile('Result', r.judged ? sol(r.net) : '–', r.judged ? (r.verdict === 'up' ? 'up overall' : r.verdict === 'down' ? 'down overall' : r.verdict === 'flat' ? 'about even' : 'too few to judge') : 'nothing readable').replace('<b>', '<b class="' + cls + '">') +
        tile('Tokens judged', r.judged, r.judged ? r.wins + ' won · ' + r.losses + ' lost' : '') +
        tile('Went in', r.judged ? r.spent.toFixed(2) + ' SOL' : '–', U.isNum(r.roi) ? 'ROI ' + U.fmtPct(r.roi * 100, 0) : '') +
        (r.open > 0 || r.unpriced ? tile('Still open', r.unpriced && !(r.open > 0) ? '?' : r.open.toFixed(2) + ' SOL', r.unpriced ? r.unpriced + ' position' + (r.unpriced === 1 ? '' : 's') + ' Jupiter does not price' : 'at today\'s prices') : '') + '</div>' +
        (rows ? '<div class="x-recent x-rec-list" style="margin-top:8px">' + rows + '</div>' : '') +
        '<div class="x-note" style="margin-top:8px">' + U.esc(X.recordWords(r)) + '. Read from a sample of its last ' + U.fmtNum(r.sigs) + (r.sigsPlus ? '+' : '') + ' transactions' + (r.skipped ? '; ' + r.skipped + ' busier position' + (r.skipped === 1 ? '' : 's') + ' not read' : '') + '. A sample of its trading, not a 30-day statement.</div></section>';
    }
    var note = '<div class="x-note">On-chain facts. The full 30-day record needs the GMGN source.</div>';
    return tiles + pos + rec + note;
  }
  SM.renderWallet = function (p) {
    var out = $('#xrayOut'); if (!out) return;
    var g = G(), s = p.stats[SM.walletPeriod] || p.stats['7d'] || p.stats['30d'] || null, other = p.stats[SM.walletPeriod === '7d' ? '30d' : '7d'];
    var gslug = SLUG[p.chain], addr = p.address;
    var nav = '<div class="tp-nav"><a class="tp-back" href="#/smart"><span aria-hidden="true">&larr;</span> All wallets</a></div>';
    var sc = SM.score(s, SM.walletPeriod), pats = SM.patterns(s, SM.walletPeriod), gateWhy = s ? SM.gate(s, SM.walletPeriod) : 'no record';
    var ident = s || {};
    var tags = SM.tagBadges(ident.tags).map(function (t) { return '<span class="tag ' + t.tone + '">' + t.label + '</span>'; }).join('') + (p.demo ? '<span class="tag demo">demo</span>' : '');
    var tw = ident.twitter ? (p.demo ? '<span class="tw">@' + U.esc(ident.twitter) + '</span>' : '<a class="tw" href="https://x.com/' + encodeURIComponent(ident.twitter) + '" target="_blank" rel="noopener">@' + U.esc(ident.twitter) + '</a>') + (ident.verified ? ' <span class="vf" title="verified on X">✓</span>' : '') + (U.isNum(ident.followers) ? ' <span class="muted">' + U.fmtNum(ident.followers) + ' followers</span>' : '') : '';
    var meta = [tw, ident.created ? 'wallet ' + U.fmtAge(U.now() - ident.created) + ' old' : '', ident.fundFrom || ident.fundAddr ? 'funded by ' + U.esc(ident.fundFrom || short(ident.fundAddr)) + (U.isNum(ident.fundAmount) ? ' (' + U.fmtNum(ident.fundAmount, 2) + ' ' + (p.chain === 'solana' ? 'SOL' : 'ETH') + ')' : '') : '', U.isNum(ident.gmgnFollowers) && ident.gmgnFollowers > 0 ? U.fmtNum(ident.gmgnFollowers) + ' follow it on GMGN' : '', U.isNum(ident.createdTokens) && ident.createdTokens > 0 ? U.fmtNum(ident.createdTokens) + ' tokens created' : ''].filter(Boolean).join('<span class="sep">·</span>');
    var ext = p.demo ? '' : '<a class="btn primary" href="' + U.esc(TL.gmgnWallet(p.chain, addr)) + '" target="_blank" rel="noopener">Open on GMGN</a><a class="btn" href="' + (p.chain === 'solana' ? 'https://solscan.io/account/' : 'https://robinhoodchain.blockscout.com/address/') + encodeURIComponent(addr) + '" target="_blank" rel="noopener">' + (p.chain === 'solana' ? 'Solscan' : 'Blockscout') + '</a>';
    var head = '<header class="wp-head">' + SM.avatar(addr, p.demo ? '' : ident.avatar, 64) + '<div class="wp-id"><h2>' + U.esc(ident.name || short(addr)) + '</h2><div class="wp-meta">' + (meta || '<span class="muted">' + (p.chain === 'solana' ? 'Solana' : 'Robinhood Chain') + ' wallet</span>') + '</div>' + (tags ? '<div class="bd-tags">' + tags + '</div>' : '') +
      '<div class="tp-addr"><span class="num" title="' + U.esc(addr) + '">' + U.esc(addr) + '</span>' + (p.demo ? '' : '<button class="btn small" data-act="copyWallet" data-addr="' + U.esc(addr) + '">Copy</button>') + '</div></div><div class="tp-actions">' + ext + '</div></header>';
    if (!p.demo && (!g || !g.configured())) { out.innerHTML = nav + head + onchainWallet(p); return; }
    if (p.loading && !s) { out.innerHTML = nav + head + '<div class="x-progress"><span>Reading the wallet from GMGN…</span><div class="bar"><i style="width:35%"></i></div></div>'; return; }
    if (!s) { out.innerHTML = nav + head + '<div class="x-note">' + (p.error ? U.esc(p.error) : 'GMGN has no trading record for this address in the last 30 days.') + '</div>'; return; }
    var seg = '<div class="seg" id="wpPeriod" role="group" aria-label="Period">' + ['7d', '30d'].map(function (per) { return '<button data-wperiod="' + per + '" aria-pressed="' + (SM.walletPeriod === per) + '"' + (p.stats[per] ? '' : ' disabled') + '>' + per.toUpperCase() + '</button>'; }).join('') + '</div>';
    var wr = s.winrate !== null ? Math.round(s.winrate * 100) : null;
    var tile = function (k, v, sub, cls) { return '<div class="x-tile"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var tiles = '<div class="x-tiles">' + tile('Strength', sc ? sc.value : '–', sc ? (gateWhy ? 'below the bar' : sc.grade.label + ', worth following') : 'no record', sc && !gateWhy && sc.value >= 62 ? 'up' : gateWhy ? 'down' : '') + tile('Realized PnL', sgnUsd(s.realized), U.isNum(s.roi) ? 'ROI ' + U.fmtPct(s.roi * 100, 0) : '', s.realized > 0 ? 'up' : s.realized < 0 ? 'down' : '') +
      tile('Unrealized', sgnUsd(s.unrealized), 'open positions', s.unrealized > 0 ? 'up' : s.unrealized < 0 ? 'down' : '') + tile('Win rate', wr !== null ? wr + '%' : '–', other && other.winrate !== null ? (SM.walletPeriod === '7d' ? '30D ' : '7D ') + Math.round(other.winrate * 100) + '%' : '') +
      tile('Wins / losses', '<span class="up">' + U.fmtNum(s.wins) + '</span> / <span class="down">' + U.fmtNum(s.losses) + '</span>', U.fmtNum(s.tokens) + (s.tokens === 1 ? ' token' : ' tokens')) + tile('Avg hold', dur(s.avgHold)) + tile('Buys / sells', U.fmtNum(s.buys) + ' / ' + U.fmtNum(s.sells), s.buys ? 'avg buy ' + U.fmtUsd(s.cost / s.buys) : '') + tile('Spent', U.fmtUsd(s.cost)) + '</div>';
    // v1.41: a wallet funded days ago with a handful of trades has no record yet: say that in one line instead of eight thin tiles
    var ageMs = ident.created ? U.now() - ident.created : null, thin = s.tokens <= 3 && s.trades <= 8;
    var freshNote = ageMs !== null && ageMs < 3 * DAY && thin ? '<div class="x-note wp-fresh">Fresh wallet: funded ' + U.fmtAge(ageMs) + ' ago, ' + U.fmtNum(s.tokens) + (s.tokens === 1 ? ' token' : ' tokens') + ' traded so far. Too young for a record: what it does in its first days says more than any score. Watch it, do not copy it yet.</div>' :
      thin ? '<div class="x-note wp-fresh">A thin record: ' + U.fmtNum(s.tokens) + (s.tokens === 1 ? ' token' : ' tokens') + ' and ' + U.fmtNum(s.trades) + (s.trades === 1 ? ' trade' : ' trades') + ' in ' + periodTxt(SM.walletPeriod) + '. The numbers below are real but too few to judge a trader by.</div>' : '';
    var tn = Math.max(1, s.tokens);
    var bucket = function (n, cls, label) { var pc = s.dist ? n / tn * 100 : 0; return '<div class="db-row"><span>' + label + '</span><span class="db-bar"><i class="' + cls + '" style="width:' + pc.toFixed(1) + '%"></i></span><b class="num">' + U.fmtNum(n) + '</b><small class="num">' + Math.round(pc) + '%</small></div>'; };
    var distCard = '<section class="tp-card"><div class="tp-card-h"><h3>How every token ended</h3><span class="src">' + periodTxt(SM.walletPeriod) + '</span></div>' + (s.dist ? bucket(s.dist.gt5, 'g3', 'Over 5x') + bucket(s.dist.x2_5, 'g2', '2x to 5x') + bucket(s.dist.x0_2, 'g1', 'Profit up to 2x') + bucket(s.dist.n50_0, 'r1', 'Lost up to half') + bucket(s.dist.lt50, 'r2', 'Lost more than half') : '<span class="muted">GMGN sent no breakdown for this period.</span>') + '</section>';
    var patCard = '<section class="tp-card"><div class="tp-card-h"><h3>Patterns</h3></div>' + (pats.length ? '<div class="wp-pats">' + pats.map(function (x) { return '<div class="wp-pat"><span class="pat ' + (x.tone || '') + '">' + U.esc(x.label) + '</span><span>' + U.esc(x.why) + '</span></div>'; }).join('') + '</div>' : '<span class="muted">No standout pattern in this period.</span>') + '</section>';
    var parts = sc ? Object.keys(SM.W).map(function (k) { var v = sc.raw[k], L = SM.PART_LABEL[k]; return '<div class="db-row"><span>' + L[0] + ' <small class="muted">' + Math.round(SM.W[k] * 100) + '% · ' + L[1] + '</small></span><span class="db-bar"><i class="acc" style="width:' + Math.round(clamp01(v) * 100) + '%"></i></span><b class="num">' + Math.round(clamp01(v) * 100) + '</b></div>'; }).join('') : '';
    var verdictLine = sc ? (gateWhy ? '<p class="wp-gate bad">Not one to follow right now: ' + U.esc(gateWhy) + '.</p>' : '<p class="wp-gate good">Clears every minimum for ' + periodTxt(SM.walletPeriod) + ': ' + sc.grade.label + ' wallet, strength ' + sc.value + ' / 100.</p>') : '';
    var multLine = sc && sc.notes.length ? '<p class="muted" style="font-size:12px;margin:8px 0 0">' + sc.notes.map(U.esc).join('. ') + '.</p>' : '';
    var scoreCard = '<section class="tp-card"><div class="tp-card-h"><h3>Strength breakdown</h3><span class="src">' + (sc ? sc.value + ' / 100' : '') + '</span></div>' + verdictLine + (parts || '<span class="muted">Not enough trades to score.</span>') + multLine + '</section>';
    var acts = (p.activity || []).filter(function (a) { var t = String(a.event_type || a.type || '').toLowerCase(); return t === 'buy' || t === 'sell'; }).slice(0, 30);
    var actCard = '<section class="tp-card wp-acts"><div class="tp-card-h"><h3>Latest trades</h3><span class="src">' + (p.demo ? 'simulated' : 'GMGN') + '</span></div>' + (acts.length ? '<div class="wa head"><span>Time</span><span>Type</span><span>Token</span><span>Total</span><span>Price</span><span>PnL</span></div>' + acts.map(function (a) {
      var type = String(a.event_type || a.type).toLowerCase(), tk = a.token || {}, usd = num(a.cost_usd), bc = num(a.buy_cost_usd), ts = secs(a.timestamp);
      var pnl = type === 'sell' && U.isNum(usd) && U.isNum(bc) && bc > 0 ? usd - bc : null;
      var known = tk.address && store.get(p.chain + ':' + (p.chain === 'robinhood' ? String(tk.address).toLowerCase() : tk.address));
      var sym = U.esc(tk.symbol || short(tk.address));
      var pic = !p.demo && tk.address && TL.ui && TL.ui.miniLogo ? TL.ui.miniLogo({ chain: p.chain, address: p.chain === 'robinhood' ? String(tk.address).toLowerCase() : tk.address, symbol: tk.symbol, logo: tk.logo && /^https:\/\//i.test(String(tk.logo)) ? tk.logo : null }) : '<span class="mini-logo" style="--h:' + U.hue(tk.address || sym) + '"><b>' + U.esc(String(tk.symbol || '?').slice(0, 2)) + '</b></span>'; // v1.41: the token's picture (GMGN sends it with every trade), its ticker underneath if the picture fails
      return '<div class="wa"><span class="num muted"' + (ts ? ' data-born="' + ts + '" data-suffix=" ago"' : '') + '>' + (ts ? U.fmtAgeLive(U.now() - ts) + ' ago' : '–') + '</span><span><b class="side ' + type + '">' + type.toUpperCase() + '</b></span>' +
        '<span class="wa-tok">' + pic + (known || (tk.address && !p.demo) ? '<a href="' + (TL.ui ? TL.ui.tokenHref({ chain: p.chain, address: tk.address }) : '#') + '">' + sym + '</a>' : sym) + '</span><span class="num">' + U.fmtUsd(usd) + '</span><span class="num">' + U.fmtPrice(num(a.price_usd)) + '</span>' +
        '<span class="num ' + (pnl > 0 ? 'up' : pnl < 0 ? 'down' : '') + '">' + (pnl !== null ? sgnUsd(pnl) : '') + '</span></div>';
    }).join('') : '<span class="muted">' + (p.loading ? 'Loading…' : 'No trades returned.') + '</span>') + '</section>';
    out.innerHTML = nav + head + '<div class="wp-bar">' + seg + '<span class="muted">' + (p.demo ? 'Preview: a fictional wallet with simulated numbers.' : 'GMGN record, ' + periodTxt(SM.walletPeriod)) + '</span></div>' + freshNote + tiles + '<div class="wp-grid">' + distCard + patCard + scoreCard + '</div>' + actCard;
  };

  // ---------- a token's traders from GMGN: profit on the token, then each trader's own record ----------
  // Who is in this token, sorted by how much their record is worth reading. GMGN returns up to 100 addresses by
  // profit, and most of them are noise: the pool itself, wallets that never bought (an airdrop or a transfer in),
  // and $40 punts. Those are counted and set aside, everyone left is classified (dev, sniper, insider, KOL,
  // smart money, whale, bot, retail) and the ones with a real record get their 30-day GMGN record read.
  SM.TOKEN_GROUPS = [['smart', 'Smart'], ['kol', 'KOLs'], ['sniper', 'Snipers'], ['whale', 'Whales'], ['strong', 'Worth following'], ['insider', 'Insiders & bundlers'], ['all', 'Everyone']];
  SM.MIN_TRADE_USD = 100;
  SM.tokenRoles = function (w, tok) {
    var r = [], tg = w.tags || [], has = function (t) { return tg.indexOf(t) >= 0; };
    var devAddr = tok && tok.dev && tok.dev.address ? String(tok.dev.address).toLowerCase() : '';
    if (has('dev') || (devAddr && devAddr === String(w.address).toLowerCase())) r.push('dev');
    if (has('bundler')) r.push('bundler');
    if (has('rat_trader') || has('insider')) r.push('insider');
    if (has('sniper') || (w.start && tok && U.isNum(tok.createdAt) && w.start - tok.createdAt <= 30 * 1000)) r.push('sniper');
    var fol = w.stats && U.isNum(w.stats.followers) ? w.stats.followers : null, tier = w.known ? w.known.tier : '';
    if (tier === 'top') r.push('top');
    if (has('kol') || has('renowned') || w.kolListed || tier === 'kol' || (w.twitter && fol !== null && fol >= 2000)) r.push('kol');
    if (has('smart_degen') || has('smart_money') || (w.consistent && w.consistent.ok) || tier === 'proven') r.push('smart');
    if (w.bought >= 5000 || w.holdUsd >= 10000) r.push('whale');
    if (has('fresh_wallet')) r.push('fresh');
    if (has('dex_bot') || (w.stats && SM.isBot(w.stats))) r.push('bot');
    if (!r.length) r.push('retail');
    return r;
  };
  SM.ROLE_BADGE = { top: ['Top KOL', 'smart'], dev: ['Dev', 'warn'], bundler: ['Bundler', 'bad'], insider: ['Insider', 'bad'], sniper: ['Sniper', 'warn'], kol: ['KOL', 'smart'], smart: ['Smart', 'smart'], whale: ['Whale', ''], fresh: ['Fresh wallet', 'warn'], bot: ['Bot', 'warn'], retail: [] };
  // Smart, as this terminal uses the word: a wallet that is in profit over the last 30 days AND over the last 7 days, on a real
  // sample, with a real win rate, and that is not a launcher farming its own tokens or a bot. One lucky token is not smart;
  // a good month that ended in a bad week is not smart either. GMGN's own smart-money tag counts on top of this.
  SM.SMART = { realized30: 1500, roi30: 0.08, winrate30: 0.45, tokens30: 10, realized7: 200, tokens7: 2, launcherShare: 0.3 };
  SM.consistent = function (st7, st30) {
    var M = SM.SMART;
    if (!st30) return { ok: false, why: 'no 30-day record' };
    if (SM.isBot(st30)) return { ok: false, why: 'bot-speed trading' };
    if (U.isNum(st30.createdTokens) && st30.tokens > 0 && st30.createdTokens / st30.tokens >= M.launcherShare) return { ok: false, why: 'mostly trades its own launches' };
    if (!(st30.tokens >= M.tokens30)) return { ok: false, why: 'under ' + M.tokens30 + ' tokens in 30 days' };
    if (!(st30.realized >= M.realized30)) return { ok: false, why: '30-day profit under ' + U.fmtUsd(M.realized30) };
    if (!(st30.roi >= M.roi30)) return { ok: false, why: '30-day return under ' + Math.round(M.roi30 * 100) + '%' };
    if (!(st30.winrate >= M.winrate30)) return { ok: false, why: '30-day win rate under ' + Math.round(M.winrate30 * 100) + '%' };
    if (!st7) return { ok: false, why: 'no 7-day record' };
    if (!(st7.tokens >= M.tokens7)) return { ok: false, why: 'quiet this week' };
    if (!(st7.realized >= M.realized7)) return { ok: false, why: 'not in profit this week' };
    return { ok: true, why: 'in profit over 30 days (' + U.fmtUsd(st30.realized) + ', ' + Math.round(st30.winrate * 100) + '% win rate on ' + st30.tokens + ' tokens) and this week (' + U.fmtUsd(st7.realized) + ')' };
  };
  SM.tokenReport = function (chain, addr, progress) {
    var g = G(), tok = store.get(chain + ':' + addr) || store.upsert({ chain: chain, address: addr });
    var rep = { chain: chain, address: addr, gmgn: true, token: tok, list: [], all: [], skipped: { pool: 0, noBuy: 0, micro: 0 }, period: '30d', at: U.now(), notes: [] };
    progress('Reading the token and its traders from GMGN…', 0.1);
    var K = TL.known;
    return Promise.all([g.pollToken(tok, true).catch(function () { return null; }), g.topTraders(chain, addr, 200), K ? K.readInside(tok, true).catch(function () { return null; }) : null]).then(function (res) {
      rep.token = store.get(tok.id) || tok;
      var raw = (res[1] || []).slice();
      // v1.48: the KOL wallets GMGN lists for the token (tag=renowned) are traders too, whatever their profit here: the top-100-by-profit
      // list drops a KOL who bought $150, and that is exactly the name a person wants to see
      var have = {}; raw.forEach(function (h) { if (h && h.address) have[chain === 'robinhood' ? String(h.address).toLowerCase() : String(h.address)] = 1; });
      var kn = res[2] && res[2].list ? res[2].list : [];
      kn.forEach(function (r) { if (have[r.wallet]) return; have[r.wallet] = 1; raw.push({ address: r.wallet, name: r.name, twitter_username: r.twitter, avatar: r.avatar, tags: ['kol'], maker_token_tags: [], profit: r.profit, buy_volume_cur: r.usd, sell_volume_cur: r.sold, buy_tx_count_cur: r.buys, sell_tx_count_cur: r.sells, usd_value: r.hold, start_holding_at: r.first ? r.first / 1000 : null, last_active_timestamp: r.last ? r.last / 1000 : null, _kol: true }); });
      rep.knownIn = kn.length;
      if (!raw.length) throw new Error('GMGN has no traders for this token yet.');
      var rows = raw.map(function (h) {
        var a = chain === 'robinhood' ? String(h.address || '').toLowerCase() : String(h.address || '');
        var tags = [].concat(h.tags || [], h.maker_token_tags || []).map(function (t) { return String(t).toLowerCase(); });
        return { address: a, name: h.name || h.twitter_name || '', twitter: h.twitter_username || '', avatar: h.avatar || '', tags: tags, profit: num(h.profit), realized: num(h.realized_profit), unrealized: num(h.unrealized_profit), roi: num(h.profit_change),
          bought: num(h.buy_volume_cur) || 0, sold: num(h.sell_volume_cur) || 0, buys: num(h.buy_tx_count_cur) || 0, sells: num(h.sell_tx_count_cur) || 0, holdUsd: num(h.usd_value) || 0, holdPct: share(h.amount_percentage), avgCost: num(h.avg_cost), avgSold: num(h.avg_sold),
          start: secs(h.start_holding_at), lastActive: secs(h.last_active_timestamp), pool: U.num(h.addr_type) === 2 || !!h.exchange, suspicious: !!h.is_suspicious, sources: {}, hot: [], roles: [], patterns: [], stats: null, score: null, gateWhy: '', kolListed: !!h._kol };
      }).filter(function (w) { return !!w.address; });
      rows.forEach(function (w) { // v1.48: the registry knows the names, the tiers and the records the data service read
        var e = K ? K.get(chain, w.address) : null; if (!e) return;
        w.known = e; if (!w.name) w.name = e.name; if (!w.twitter) w.twitter = e.twitter; if (!w.avatar) w.avatar = e.avatar;
        (e.tags || []).forEach(function (t) { if (w.tags.indexOf(t) < 0) w.tags.push(t); });
        if (e.stats && !w.stats) { w.stats = e.stats; w.stats7 = e.stats7; w.score = SM.score(e.stats, '30d'); w.gateWhy = SM.gate(e.stats, '30d'); w.patterns = SM.patterns(e.stats, '30d'); w.consistent = e.consistent; }
      });
      rep.all = rows;
      var keep = [];
      rows.forEach(function (w) {
        w.turnover = Math.max(w.bought, w.sold, w.holdUsd);
        w.noBuy = !(w.bought > 0) && !(w.buys > 0);
        w.micro = w.turnover < SM.MIN_TRADE_USD;
        var named = w.kolListed || (w.known && (w.known.tier === 'top' || w.known.tier === 'proven' || w.known.tier === 'kol'));
        if (w.pool) { rep.skipped.pool++; return; }          // the bonding curve or the AMM pool, not a trader
        if (w.noBuy && !named) { rep.skipped.noBuy++; return; }         // holds or sold tokens it never bought: airdrop, transfer or a bundle wallet
        if (w.micro && !named) { rep.skipped.micro++; return; }         // under $100 through the token: nothing to learn from (a known name stays whatever the size)
        keep.push(w);
      });
      rep.list = keep;
      keep.forEach(function (w) { w._born = rep.token && rep.token.createdAt; w.roles = SM.tokenRoles(w, rep.token); });
      // read the record of the wallets most likely to be worth following: tagged wallets and real size first
      var rank = function (w) {
        var r = w.roles, bonus = 0;
        if (r.indexOf('smart') >= 0) bonus += 4; if (r.indexOf('kol') >= 0) bonus += 3; if (r.indexOf('whale') >= 0) bonus += 2;
        if (r.indexOf('dev') >= 0 || r.indexOf('bundler') >= 0 || r.indexOf('insider') >= 0) bonus -= 3;
        return bonus + Math.min(6, Math.log10(Math.max(10, w.turnover))) + Math.min(4, Math.max(0, (w.profit || 0) / 5000));
      };
      // v1.41: the screen first (everyone's 30-day money in one request), then a full record for the traders it ranks highest,
      // one request each, and the 7-day record only where the 30-day one could make a wallet "smart"
      var pre = keep.slice().sort(function (x, y) { return rank(y) - rank(x); }).slice(0, 150);
      progress('Screening ' + pre.length + ' traders…', 0.35);
      var M = SM.SMART;
      return SM.screen(chain, pre.map(function (w) { return w.address; }), '30d').then(function (scr) {
        pre.forEach(function (w) { w.screen = scr[w.address] || null; });
        var rank2 = function (w) { var s = w.screen; return rank(w) + (s ? Math.min(6, Math.log10(Math.max(100, s.realized + 100))) + (s.roi > 0 ? Math.min(2, s.roi) : -1) : -2); };
        var top = pre.slice().sort(function (x, y) { return rank2(y) - rank2(x); }).slice(0, SM.TOKEN_RECORDS);
        rep.screened = Object.keys(scr).length;
        var done = 0, i = 0;
        var next = function () {
          if (i >= top.length) return Promise.resolve();
          var w = top[i++];
          return SM.readRecord(chain, w.address, '30d').then(function (st) {
            if (!st) return;
            w.stats = st; w.score = SM.score(st, '30d'); w.gateWhy = SM.gate(st, '30d'); w.patterns = SM.patterns(st, '30d');
            if (!w.name && st.name) w.name = st.name; if (!w.twitter && st.twitter) w.twitter = st.twitter; if (!w.avatar && st.avatar) w.avatar = st.avatar;
            st.tags.forEach(function (t) { if (w.tags.indexOf(t) < 0) w.tags.push(t); });
            var couldBeSmart = st.tokens >= M.tokens30 && st.realized >= M.realized30 && st.roi >= M.roi30 && st.winrate >= M.winrate30 && !SM.isBot(st);
            if (!couldBeSmart) { w.consistent = SM.consistent(null, st); return; }
            return SM.readRecord(chain, w.address, '7d').then(function (st7) { w.stats7 = st7; w.consistent = SM.consistent(st7, st); }, function () { w.consistent = SM.consistent(null, st); });
          }, function (e) { if (rep.notes.length < 2) rep.notes.push('Some wallet records did not load: ' + (e && e.message || 'error')); })
            .then(function () { w.roles = SM.tokenRoles(w, rep.token); done++; progress('Reading traders\' records ' + done + ' / ' + top.length, 0.45 + 0.5 * done / top.length); return next(); });
        };
        return Promise.all([next(), next()]);
      }).then(function () { return rep; });
    });
  };
  SM.TOKEN_RECORDS = 14; // full records per token report: enough for the leaders, cheap enough for a shared free-plan key
  SM.tokenSort = 'strength';
  SM.tokenGroup = 'smart';
  // "Interesting" is not the same as "clean": the wallets worth reading on a token that already ran are the ones that were early,
  // sized in, made money here, and have a record behind them. A wallet that misses the follow bar is ranked below, never dropped.
  function tokenAge(w) { // how far into the token's life this wallet entered, 0 = launch, 1 = now
    var born = w._born; if (!U.isNum(born) || !U.isNum(w.start)) return null;
    var span = U.now() - born; if (span <= 0) return null;
    return U.clamp((w.start - born) / span, 0, 1);
  }
  SM.interest = function (w) {
    var v = 0, sc = w.score, st = w.stats, r = w.roles || [];
    if (sc) v += sc.value * 0.55;                                            // the 30-day record, when it was read
    if (w.gateWhy) v -= 10;                                                  // below the follow bar: down the list, not out of it
    if (st && U.isNum(st.realized)) v += Math.min(18, Math.max(-8, Math.log10(Math.max(100, Math.abs(st.realized))) * (st.realized > 0 ? 3.2 : -2)));
    if (U.isNum(w.profit) && w.profit > 0) v += Math.min(22, Math.log10(Math.max(10, w.profit)) * 5);   // what it made on THIS token
    else if (U.isNum(w.profit) && w.profit < -200) v -= 4;
    v += Math.min(10, Math.log10(Math.max(10, w.turnover || 0)) * 2.2);      // size through the token
    if (w.consistent && w.consistent.ok) v += 24; else if (r.indexOf('smart') >= 0) v += 16;
    if (r.indexOf('kol') >= 0) v += 14; if (r.indexOf('top') >= 0) v += 10; if (r.indexOf('whale') >= 0) v += 7;
    if (U.isNum(w.start) && tokenAge(w) !== null && tokenAge(w) < 0.12 && r.indexOf('sniper') < 0) v += 8; // in before the crowd, without being a bot in the first block
    if (r.indexOf('sniper') >= 0) v -= 5;
    if (r.indexOf('dev') >= 0 || r.indexOf('bundler') >= 0 || r.indexOf('insider') >= 0) v -= 22;
    if (w.suspicious) v -= 25;
    if (!sc && !st) { // no full record: the screen's money (v1.41) says something, nothing at all says less
      var scr = w.screen;
      if (scr && U.isNum(scr.realized)) v += scr.realized > 0 ? Math.min(14, Math.log10(Math.max(100, scr.realized)) * 3) : -4;
      else v -= 6;
    }
    return v;
  };
  SM.tokenRows = function (rep) {
    var list = rep.list.slice();
    var gr = SM.tokenGroup;
    rep.relaxed = null;
    if (gr === 'strong') list = list.filter(function (w) { return SM.follows(w); });
    else if (gr !== 'all') list = list.filter(function (w) { return w.roles.indexOf(gr) >= 0; });
    if (gr === 'smart' && list.length < 3) { rep.relaxed = list.length; list = rep.list.slice(); } // no smart wallet inside: everyone, ranked, rather than an empty table
    var S = {
      strength: function (x, y) { return SM.interest(y) - SM.interest(x) || (y.profit || 0) - (x.profit || 0); },
      profit: function (x, y) { return (y.profit || -1e12) - (x.profit || -1e12); },
      size: function (x, y) { return (y.turnover || 0) - (x.turnover || 0); },
      early: function (x, y) { return (x.start || 9e15) - (y.start || 9e15); },
      holding: function (x, y) { return (y.holdPct || 0) - (x.holdPct || 0) || (y.holdUsd || 0) - (x.holdUsd || 0); }
    };
    return list.sort(S[SM.tokenSort] || S.strength);
  };
  SM.renderTokenReport = function (rep) {
    var out = $('#xrayOut'); if (!out) return;
    var t = rep.token || {}, demo = !!rep.demo, key = SM.tokenSort;
    var list = SM.tokenRows(rep);
    var roleCnt = function (r) { return rep.list.filter(function (w) { return w.roles.indexOf(r) >= 0; }).length; };
    var groupCnt = function (k) { return k === 'all' ? rep.list.length : k === 'strong' ? rep.list.filter(function (w) { return SM.follows(w); }).length : roleCnt(k); };
    var strong = groupCnt('strong'), read = rep.list.filter(function (w) { return !!w.stats; }).length;
    var inProfit = rep.list.filter(function (w) { return w.profit > 0; }).length;
    var tile = function (k, v, sub, cls) { return '<div class="x-tile"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var tiles = '<div class="x-tiles">' +
      tile('Worth following', U.fmtNum(strong), 'of ' + read + ' records read' + (rep.screened ? ', ' + rep.screened + ' screened' : ''), strong ? 'up' : '') +
      tile('Real traders', U.fmtNum(rep.list.length), 'bought over ' + U.fmtUsd(SM.MIN_TRADE_USD)) +
      tile('In profit', inProfit + ' <small style="display:inline">/ ' + rep.list.length + '</small>', '', inProfit ? 'up' : '') +
      tile('KOLs & influencers', U.fmtNum(roleCnt('kol')), (function () { var names = rep.list.filter(function (w) { return w.roles.indexOf('kol') >= 0; }).sort(function (a, b) { return (b.roles.indexOf('top') >= 0 ? 1 : 0) - (a.roles.indexOf('top') >= 0 ? 1 : 0) || (b.bought || 0) - (a.bought || 0); }).map(function (w) { return w.name || (w.twitter ? '@' + w.twitter : ''); }).filter(Boolean); return names.length ? U.esc(names.slice(0, 3).join(', ')) + (names.length > 3 ? ' +' + (names.length - 3) : '') : 'named X accounts'; })(), roleCnt('kol') ? 'up' : '') +
      tile('Smart', U.fmtNum(roleCnt('smart')), 'in profit 30d and 7d', roleCnt('smart') ? 'up' : '') +
      tile('Whales', U.fmtNum(roleCnt('whale')), 'over $5K in') +
      tile('Snipers', U.fmtNum(roleCnt('sniper')), 'first seconds', roleCnt('sniper') > 5 ? 'down' : '') +
      tile('Insiders / bundlers', roleCnt('insider') + ' / ' + roleCnt('bundler'), '', roleCnt('insider') + roleCnt('bundler') > 3 ? 'down' : '') + '</div>';
    var chips = '<div class="board-chips"><div class="chips">' + SM.TOKEN_GROUPS.map(function (c) { return '<button class="chip" data-tgroup="' + c[0] + '" aria-pressed="' + (SM.tokenGroup === c[0]) + '">' + c[1] + ' <span class="cnt">' + groupCnt(c[0]) + '</span></button>'; }).join('') + '</div></div>';
    var tools = '<div class="x-tools"><div class="seg" id="stSort">' + [['strength', 'Most interesting'], ['profit', 'Profit on this token'], ['size', 'Biggest size in'], ['early', 'Earliest in'], ['holding', 'Biggest holders']].map(function (p) { return '<button data-tsort="' + p[0] + '" aria-pressed="' + (key === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div><span>' + (demo ? 'Preview: fictional wallets, simulated numbers.' : 'Profit on this token from GMGN \u00b7 strength from the last 30 days.') + '</span></div>';
    var rows = '<div class="st-w head"><span>#</span><span>Wallet</span><span>Bought</span><span>Sold</span><span>Holds</span><span>PnL on token</span><span>Entry MC</span><span>Strength</span><span>Record 30D</span><span>Roles & patterns</span></div>' + list.slice(0, 60).map(function (w, i) {
      var s = w.stats, sc = w.score, href = '#/smart/wallet/' + SLUG[rep.chain] + '/' + encodeURIComponent(w.address);
      var entryMc = U.isNum(w.avgCost) && U.isNum(t.price) && U.isNum(t.mc) && t.price > 0 ? w.avgCost / t.price * t.mc : null;
      var roleBadges = w.roles.map(function (r) { var d = SM.ROLE_BADGE[r]; return d && d.length ? { label: d[0], tone: d[1], why: r === 'smart' && w.consistent && w.consistent.ok ? w.consistent.why : (r === 'smart' ? 'tagged smart money by GMGN' : '') } : null; }).filter(Boolean);
      var pats = (w.gateWhy && s ? [{ label: 'Not followable', tone: 'warn', why: w.gateWhy }] : []).concat(roleBadges, w.patterns);
      var scCls = sc ? (w.gateWhy ? 1 : sc.value >= 78 ? 4 : sc.value >= 62 ? 3 : sc.value >= 45 ? 2 : 1) : 0;
      return '<a class="st-w' + (w.gateWhy ? ' dim' : '') + '" href="' + href + '"><span class="rank num">' + (i + 1) + '</span>' + whoHtml(w, rep.chain, demo, 30) +
        '<span class="num"><b>' + U.fmtUsd(w.bought) + '</b><small>' + (w.buys ? U.fmtNum(w.buys) + ' buys' : '') + '</small></span>' +
        '<span class="num"><b>' + (w.sold > 0 ? U.fmtUsd(w.sold) : '–') + '</b><small>' + (w.sells ? U.fmtNum(w.sells) + ' sells' : '') + '</small></span>' +
        '<span class="num"><b>' + (w.holdUsd > 0.5 ? U.fmtUsd(w.holdUsd) : '–') + '</b><small>' + (U.isNum(w.holdPct) && w.holdPct > 0 ? (w.holdPct * 100).toFixed(2) + '% of supply' : 'sold out') + '</small></span>' +
        '<span class="num"><b class="pnl ' + (w.profit > 0 ? 'up' : w.profit < 0 ? 'down' : '') + '">' + sgnUsd(w.profit) + '</b><small>' + (U.isNum(w.roi) ? U.fmtPct(w.roi * 100, 0) : '') + '</small></span>' +
        '<span class="num"><b>' + (U.isNum(entryMc) ? U.fmtUsd(entryMc) : '–') + '</b></span>' +
        '<span class="bd-score s' + scCls + '"' + (sc ? ' title="strength ' + sc.value + ' / 100' + (w.gateWhy ? ': ' + U.esc(w.gateWhy) : '') + '"' : '') + '><b>' + (sc ? sc.value : '–') + '</b>' + (sc ? '<i style="width:' + sc.value + '%"></i>' : '') + '</span>' +
        '<span class="num"><b>' + (s ? sgnUsd(s.realized) : (w.screen && U.isNum(w.screen.realized) ? sgnUsd(w.screen.realized) : '–')) + '</b><small>' + (s ? (s.winrate !== null ? Math.round(s.winrate * 100) + '% of ' + U.fmtNum(s.tokens) + ' tokens' : U.fmtNum(s.tokens) + ' tokens') : (w.screen ? (w.screen.trades ? U.fmtNum(w.screen.trades) + ' trades, screened' : 'screened') : 'record not read')) + '</small></span>' +
        '<span class="bd-pats">' + (badges(pats, 3) || '<span class="muted">–</span>') + '</span></a>';
    }).join('');
    var sk = rep.skipped || {}, skTxt = [];
    if (sk.noBuy) skTxt.push(sk.noBuy + ' received tokens without buying');
    if (sk.micro) skTxt.push(sk.micro + ' under ' + U.fmtUsd(SM.MIN_TRADE_USD));
    if (sk.pool) skTxt.push(sk.pool + ' pool or exchange address' + (sk.pool > 1 ? 'es' : ''));
    var skipped = skTxt.length ? '<p class="board-foot">Left out: ' + skTxt.join(', ') + '.</p>' : '';
    var foot = '<details class="x-how"><summary>How strength is scored</summary><p class="board-foot">Strength 0-100 over the wallet\'s last 30 days: realized profit 22%, return on capital 18%, consistency 16%, loss discipline 14%, position size 12%, sample 10%, still active 8%; launchers, bots, snipers and brand-new wallets counted down. Worth following also needs ' + SM.MIN['30d'].tokens + '+ tokens, ' + U.fmtUsd(SM.MIN['30d'].realized) + ' taken out, an average buy over ' + U.fmtUsd(SM.MIN['30d'].avgBuy) + ' and a score of ' + SM.MIN_FOLLOW + '+. The default order is interest: record, profit here, how early and how big it was in, GMGN tags. Launch, bundle and insider wallets rank last.</p></details>';
    var empty = '<div class="x-note">' + (SM.tokenGroup === 'strong' ? (read ? 'None of the ' + read + ' records read clears the follow bar. Everyone shows them all, ranked.' : 'No wallet records came back for this token.') : 'No wallets in this group.') + '</div>';
    var head = TL.xray && TL.xray.tokenHeadHtml ? TL.xray.tokenHeadHtml(rep) : '';
    var notes = rep.notes.length ? '<div class="x-note">' + rep.notes.map(U.esc).join(' ') + '</div>' : '';
    var relaxNote = rep.relaxed !== null && rep.relaxed !== undefined && SM.tokenGroup === 'smart' ? '<div class="x-note">' + (rep.relaxed ? 'Only ' + rep.relaxed + ' smart wallet' + (rep.relaxed === 1 ? '' : 's') + ' inside' : 'No smart wallet inside yet') + ': every real buyer is shown, most interesting first.</div>' : '';
    out.innerHTML = '<div class="tp-nav"><a class="tp-back" href="#/smart"><span aria-hidden="true">&larr;</span> All wallets</a></div>' + head + notes + tiles + chips + tools + relaxNote + (list.length ? '<div class="st-list">' + rows + '</div>' : empty) + skipped + foot;
    if (TL.ui && TL.ui.bindLogos) TL.ui.bindLogos(out); // v1.41: the token's picture loads through the feed's pipeline
  };

  // ---------- preview: fictional wallets with simulated records, marked demo ----------
  var FIRST = ['Quiet', 'Salt', 'Night', 'Paper', 'Blue', 'Old', 'Copper', 'Tin', 'Moss', 'Glass', 'Late', 'North', 'Velvet', 'Iron', 'Soft', 'Amber', 'Cold', 'Wide', 'Low', 'Mint', 'Rust', 'Pale', 'Hollow', 'Bright'];
  var SECOND = ['Heron', 'Lamp', 'Ferry', 'Lantern', 'Tram', 'Maple', 'Kettle', 'Whistle', 'Garden', 'Harbor', 'Train', 'Dune', 'Moth', 'Tulip', 'Thunder', 'Owl', 'Brew', 'River', 'Orbit', 'Fox', 'Anchor', 'Comet', 'Meadow', 'Signal'];
  function demoAddr(chain, r) { var s = ''; if (chain === 'robinhood') { for (var i = 0; i < 40; i++) s += '0123456789abcdef'[Math.floor(r() * 16)]; return '0x' + s; } var b = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; for (var j = 0; j < 44; j++) s += b[Math.floor(r() * b.length)]; return s; }
  SM.demoRecord = function (r, style, period) {
    var mult = period === '30d' ? 3.6 : 1;
    var tokens = Math.round((style === 'bot' ? 380 : style === 'diamond' ? 9 : style === 'flipper' ? 90 : 12 + r() * 70) * mult);
    var winrate = style === 'consistent' ? 0.6 + r() * 0.2 : style === 'flipper' ? 0.52 + r() * 0.2 : style === 'bags' ? 0.15 + r() * 0.15 : style === 'lottery' ? 0.2 + r() * 0.12 : style === 'bot' ? 0.45 + r() * 0.1 : 0.32 + r() * 0.35;
    var wins = Math.round(tokens * winrate), losses = tokens - wins;
    var gt5 = Math.min(wins, style === 'hitter' || style === 'lottery' ? 2 + Math.floor(r() * 4) : Math.floor(r() * 2 * (wins > 10 ? 1 : 0.4)));
    var x2_5 = Math.min(wins - gt5, Math.round(wins * (0.15 + r() * 0.2))); if (x2_5 < 0) x2_5 = 0;
    var lt50 = style === 'stops' ? Math.round(losses * 0.03) : style === 'bags' ? Math.round(losses * 0.7) : Math.round(losses * (0.15 + r() * 0.35));
    var avgCost = style === 'whale' ? 6000 + r() * 12000 : 150 + r() * 1800;
    var buys = Math.round(tokens * (style === 'bot' ? 9 : 1.6 + r())), sells = Math.round(buys * (0.8 + r() * 0.4));
    var cost = buys * avgCost;
    var roi = style === 'bags' ? -0.25 - r() * 0.3 : style === 'consistent' || style === 'hitter' || style === 'stops' ? 0.18 + r() * 0.5 : -0.1 + r() * 0.45;
    return { last_active_timestamp: Math.floor((U.now() - (style === 'bags' ? 9 : r() * 2) * DAY) / 1000), pnl_stat: { token_num: tokens, winrate: winrate, pnl_gt_5x_num: Math.max(0, gt5), pnl_2x_5x_num: x2_5, pnl_0x_2x_num: Math.max(0, wins - gt5 - x2_5), pnl_nd5_0x_num: Math.max(0, losses - lt50), pnl_lt_nd5_num: lt50,
      avg_holding_period: style === 'flipper' ? 200 + r() * 1500 : style === 'diamond' ? 5.5 * 86400 + r() * 3 * 86400 : style === 'bot' ? 30 + r() * 60 : 1800 + r() * 30000 }, buy: buys, sell: sells, bought_cost: cost, realized_profit: cost * roi, realized_profit_pnl: roi, unrealized_profit: (r() - 0.4) * cost * 0.1 };
  };
  var STYLES = ['consistent', 'flipper', 'hitter', 'stops', 'whale', 'diamond', 'lottery', 'bags', 'bot', 'fresh', 'plain', 'plain', 'consistent', 'flipper', 'plain', 'hitter'];
  SM.demoBoard = function (chain, period) {
    var key = 'demo:' + boardKey(chain, period); if (SM.boards[key]) return SM.boards[key];
    var r = U.rng('board' + chain), rp = U.rng('board' + chain + period), now = U.now();
    var b = { chain: chain, period: period, at: now, loading: false, wallets: {}, errors: [], demo: true, done: 0, total: 0 };
    var hot = store.all().filter(function (t) { return t.chain === chain && t.ready && TL.ensureVet(t)._ok; }).sort(function (x, y) { return (y.vol.h1 || 0) - (x.vol.h1 || 0); }).slice(0, 12);
    for (var i = 0; i < 40; i++) {
      var style = STYLES[i % STYLES.length], a = demoAddr(chain, r);
      var w = blankWallet(a); var src = i % 4 === 0 ? 'kol' : i % 4 === 1 ? 'smart' : i % 4 === 2 ? 'hot' : 'run'; w.sources[src] = 1; if (r() < 0.25) w.sources.hot = 1;
      w.tags = src === 'kol' ? ['kol'] : src === 'smart' ? ['smart_degen'] : []; if (style === 'bot' || r() < 0.1) w.tags.push('sniper'); if (style === 'whale') w.tags.push('whale');
      var named = src === 'kol' || r() < 0.3;
      w.name = named ? FIRST[Math.floor(r() * FIRST.length)] + ' ' + SECOND[Math.floor(r() * SECOND.length)] : '';
      w.twitter = src === 'kol' ? (w.name.replace(/\s+/g, '').toLowerCase().slice(0, 10) + '_demo') : '';
      var rec = SM.demoRecord(rp, style, period);
      rec.common = { name: w.name, twitter_username: w.twitter, followers_count: src === 'kol' ? Math.round(2000 + r() * 90000) : null, is_blue_verified: src === 'kol' && r() < 0.5, tags: w.tags, created_at: style === 'fresh' ? Math.floor((now - (1 + r() * 4) * DAY) / 1000) : Math.floor((now - (20 + r() * 700) * DAY) / 1000), fund_from: r() < 0.5 ? 'Exchange hot wallet' : '', fund_amount: 2 + r() * 40, created_token_count: style === 'plain' && r() < 0.2 ? 60 : 0, follow_count: Math.round(r() * 3000) };
      if (style === 'fresh') { rec.realized_profit = 8000 + r() * 30000; rec.realized_profit_pnl = 1.2 + r(); }
      w.stats = SM.readStats(rec); w.score = SM.score(w.stats, period); w.gateWhy = SM.gate(w.stats, period); w.patterns = SM.patterns(w.stats, period); w._rec = rec;
      var tk = hot[i % Math.max(1, hot.length)];
      if (tk) w.last = { side: r() < 0.7 ? 'buy' : 'sell', usd: 50 + Math.pow(r(), 2) * 6000, symbol: tk.symbol, token: tk.address, at: now - r() * 40 * MIN };
      if ((src === 'hot' || src === 'run') && tk) w.hot.push({ symbol: tk.symbol, address: tk.address, profit: 200 + r() * 9000, roi: r() * 3, top: src === 'run' });
      b.wallets[a] = w;
    }
    SM.boards[key] = b; return b;
  };
  SM.demoProfile = function (p) {
    var chain = p.chain, found = null;
    Object.keys(SM.boards).forEach(function (k) { var b = SM.boards[k]; if (b.demo && b.chain === chain && b.wallets[p.address]) found = b.wallets[p.address]; });
    var r = U.rng('wallet' + p.address), now = U.now();
    ['7d', '30d'].forEach(function (per) {
      var rec = found && found._rec && per === (SM.period || '7d') ? found._rec : SM.demoRecord(U.rng('wallet' + p.address + per), found ? (found.patterns[0] && found.patterns[0].k) || 'plain' : 'plain', per);
      rec.common = (found && found._rec && found._rec.common) || { name: '', tags: [], created_at: Math.floor((now - (30 + r() * 300) * DAY) / 1000) };
      p.stats[per] = SM.readStats(rec);
    });
    var toks = store.all().filter(function (t) { return t.chain === chain && t.ready; }).slice(0, 30);
    p.activity = [];
    var at = now - r() * 3 * MIN;
    for (var i = 0; i < 24 && toks.length; i++) {
      var t = toks[Math.floor(r() * toks.length)], buy = r() < 0.55, usd = 40 + Math.pow(r(), 2) * 4000;
      p.activity.push({ event_type: buy ? 'buy' : 'sell', token: { address: t.address, symbol: t.symbol }, cost_usd: usd, buy_cost_usd: buy ? 0 : usd * (0.4 + r() * 1.2), price_usd: t.price || 0, timestamp: Math.floor(at / 1000) });
      at -= (2 + r() * 40) * MIN;
    }
  };
  SM.demoTokenReport = function (chain, addr) {
    var t = store.get(chain + ':' + addr) || store.all().filter(function (x) { return x.chain === chain; })[0];
    var r = U.rng('traders' + addr), rp = U.rng('traders' + addr + 'p'), now = U.now();
    var rep = { chain: chain, address: addr, gmgn: true, demo: true, period: '30d', token: t || { chain: chain, address: addr }, list: [], all: [], skipped: { pool: 0, noBuy: 0, micro: 0 },
      notes: ['Preview: this page cannot reach GMGN, so the traders here are fictional and their numbers simulated. On a live site the same table shows the real ones.'] };
    var mk = function (i, kind) {
      var style = STYLES[(i * 7) % STYLES.length];
      var bought = kind === 'micro' ? 5 + r() * 80 : kind === 'noBuy' ? 0 : 150 + Math.pow(r(), 2) * 12000;
      var x = style === 'bags' ? 0.2 + r() * 0.5 : 0.5 + r() * (style === 'hitter' ? 8 : 3);
      var sold = kind === 'noBuy' ? 20 + r() * 300 : (r() < 0.6 ? bought * x * (0.3 + r() * 0.7) : 0);
      var hold = kind === 'noBuy' ? (r() < 0.5 ? 40 + r() * 200 : 0) : (sold ? bought * x * 0.2 * r() : bought * x);
      var tags = kind === 'plain' && i < 4 ? ['sniper'] : kind === 'plain' && r() < 0.22 ? ['smart_degen'] : kind === 'plain' && r() < 0.12 ? ['kol'] : kind === 'noBuy' && r() < 0.3 ? ['bundler'] : [];
      var named = tags.indexOf('kol') >= 0 || r() < 0.25;
      var nm = named ? FIRST[Math.floor(r() * FIRST.length)] + ' ' + SECOND[Math.floor(r() * SECOND.length)] : '';
      var w = { address: demoAddr(chain, r), name: nm, twitter: tags.indexOf('kol') >= 0 ? nm.replace(/\s+/g, '').toLowerCase().slice(0, 10) + '_demo' : '', avatar: '', tags: tags,
        bought: bought, sold: sold, buys: kind === 'noBuy' ? 0 : 1 + Math.floor(r() * 6), sells: sold ? 1 + Math.floor(r() * 4) : 0, holdUsd: hold, holdPct: hold / Math.max(1, (t && t.mc) || 1e5),
        profit: sold + hold - bought, roi: bought > 0 ? (sold + hold - bought) / bought : null,
        start: t && U.isNum(t.createdAt) ? t.createdAt + (i < 4 ? i * 900 : r() * Math.max(60000, now - t.createdAt)) : null, avgCost: t && U.isNum(t.price) ? t.price / x : null,
        pool: false, sources: {}, hot: [], roles: [], patterns: [], stats: null, score: null, gateWhy: '' };
      w.turnover = Math.max(w.bought, w.sold, w.holdUsd);
      w.noBuy = !(w.bought > 0) && !(w.buys > 0);
      w.micro = w.turnover < SM.MIN_TRADE_USD;
      if (kind === 'plain') {
        var rec = SM.demoRecord(rp, style, '30d');
        rec.common = { name: w.name, twitter_username: w.twitter, followers_count: w.twitter ? Math.round(3000 + r() * 80000) : null, is_blue_verified: !!w.twitter && r() < 0.5, tags: w.tags, created_at: Math.floor((now - (style === 'fresh' ? 3 : 90 + r() * 400) * DAY) / 1000) };
        w.stats = SM.readStats(rec); w.score = SM.score(w.stats, '30d'); w.gateWhy = SM.gate(w.stats, '30d'); w.patterns = SM.patterns(w.stats, '30d');
      }
      w.roles = SM.tokenRoles(w, rep.token);
      return w;
    };
    for (var i = 0; i < 34; i++) rep.all.push(mk(i, 'plain'));
    for (var j = 0; j < 9; j++) rep.all.push(mk(100 + j, 'noBuy'));
    for (var k = 0; k < 6; k++) rep.all.push(mk(200 + k, 'micro'));
    rep.all.forEach(function (w) {
      if (w.noBuy) { rep.skipped.noBuy++; return; }
      if (w.micro) { rep.skipped.micro++; return; }
      rep.list.push(w);
    });
    rep.skipped.pool = 1;
    return rep;
  };

  // ---------- events ----------
  SM.bind = function () {
    if (SM._bound) return; SM._bound = true;
    var tab = $('#tabXray'); if (!tab) return;
    tab.addEventListener('click', function (ev) {
      var ext = ev.target.closest('[data-href]'); if (ext) { ev.preventDefault(); ev.stopPropagation(); window.open(ext.dataset.href, '_blank', 'noopener'); return; }
      var b = ev.target.closest('[data-period]'); if (b) { ev.preventDefault(); SM.period = b.dataset.period; remember(); SM.renderBoard(); return; }
      b = ev.target.closest('[data-strong]'); if (b) { ev.preventDefault(); SM.strongOnly = b.dataset.strong === '1'; remember(); SM.renderBoard(); return; }
      b = ev.target.closest('[data-source]'); if (b) { SM.source = SM.source === b.dataset.source && b.dataset.source !== 'all' ? 'all' : b.dataset.source; remember(); SM.renderBoard(); return; }
      b = ev.target.closest('[data-pattern]'); if (b) { SM.pattern = SM.pattern === b.dataset.pattern ? '' : b.dataset.pattern; remember(); SM.renderBoard(); return; }
      b = ev.target.closest('[data-kfilter]'); if (b) { ev.preventDefault(); SM.knownFilter = b.dataset.kfilter; remember(); SM.renderKnown(); return; }
      b = ev.target.closest('[data-kact]'); if (b) { ev.preventDefault(); var K0 = TL.known; if (!K0) return; if (b.dataset.kact === 'fold') { K0.prefs.collapsed = !K0.prefs.collapsed; K0.savePrefs(); } else if (b.dataset.kact === 'settings') { SM.knownSettings = !SM.knownSettings; if (SM.knownSettings && K0.prefs.collapsed) { K0.prefs.collapsed = false; K0.savePrefs(); } } SM.renderKnown(); return; }
      b = ev.target.closest('[data-kpref]'); if (b) {
        ev.preventDefault(); var K1 = TL.known; if (!K1) return; var key = b.dataset.kpref, val = b.dataset.val;
        if (key === 'notifyAsk') { try { Notification.requestPermission().then(function (p) { if (p === 'granted') { K1.prefs.notify = true; K1.savePrefs(); } SM.renderKnown(); }); } catch (e) {} return; }
        if (val === 'toggle') K1.prefs[key] = !K1.prefs[key]; else if (val === 'true' || val === 'false') K1.prefs[key] = val === 'true'; else if (/^-?\d+$/.test(val)) K1.prefs[key] = +val; else K1.prefs[key] = val;
        K1.savePrefs(); SM.renderKnown(); return;
      }
      b = ev.target.closest('[data-watch]'); if (b) { ev.preventDefault(); ev.stopPropagation(); var K2 = TL.known; if (!K2) return; var addr = b.dataset.watch, ch = net(); if (K2.watching(ch, addr)) K2.removeWatch(ch, addr); else { var e2 = K2.get(ch, addr); if (!K2.addWatch(ch, addr, e2 ? K2.label(e2) : '')) { if (TL.ui && TL.ui.toast) TL.ui.toast('That is ' + K2.RULE.watchMax + ' wallets already'); return; } } SM.renderKnown(); return; }
      b = ev.target.closest('[data-wperiod]'); if (b) { SM.walletPeriod = b.dataset.wperiod; var rp = TL.xray && TL.xray.report; var p = rp && SM.profiles[rp.chain + ':' + rp.address]; if (p) SM.renderWallet(p); return; }
      b = ev.target.closest('[data-tgroup]'); if (b) { ev.preventDefault(); SM.tokenGroup = b.dataset.tgroup; if (TL.xray && TL.xray.report && TL.xray.report.gmgn) SM.renderTokenReport(TL.xray.report); return; }
      b = ev.target.closest('[data-tsort]'); if (b) { SM.tokenSort = b.dataset.tsort; if (TL.xray && TL.xray.report && TL.xray.report.gmgn) SM.renderTokenReport(TL.xray.report); return; }
      var act = ev.target.closest('[data-act]'); if (!act) return;
      if (act.dataset.act === 'gmgnConnect') { ev.preventDefault(); if (TL.ui && TL.ui.openGmgn) TL.ui.openGmgn(); }
      else if (act.dataset.act === 'bdRefresh') { ev.preventDefault(); var cur = SM.boards[boardKey(net(), SM.period)]; if (cur) cur.at = 0; SM.build(net(), SM.period, !TL.CONFIG.boardFeed); SM.renderBoard(); } // with a server ranking, refresh re-reads it; without one, rebuilds
      else if (act.dataset.act === 'copyWallet') { ev.preventDefault(); try { navigator.clipboard.writeText(act.dataset.addr); } catch (e) {} act.textContent = 'Copied'; }
    });
    tab.addEventListener('change', function (ev) { if (ev.target.id === 'bdSort') { SM.sort = ev.target.value; remember(); SM.renderBoard(); } });
    tab.addEventListener('submit', function (ev) { var f = ev.target.closest('#knownAdd'); if (!f) return; ev.preventDefault(); var addr = $('#knownAddr', f), name = $('#knownName', f); var why = SM.watchWallet(net(), addr ? addr.value : '', name ? name.value.trim() : ''); if (why) { if (TL.ui && TL.ui.toast) TL.ui.toast(why); addr.focus(); return; } SM.knownFilter = 'mine'; remember(); SM.renderKnown(); });
    tab.addEventListener('input', function (ev) { if (ev.target.id === 'knownSearch') { SM.knownQuery = ev.target.value.trim(); var grid = $('#knownGrid'); if (!grid || !TL.known) return; var tmp = document.createElement('div'); tmp.innerHTML = knownGridHtml(net(), TL.known); grid.replaceWith(tmp.firstElementChild); } });
    if (TL.gmgn) TL.gmgn.onChange(function () { var st = TL.gmgn.state; if (SM._gmWas !== st) { SM._gmWas = st; if (st === 'ok' && SM.view === 'board' && TL.ui && TL.ui.state.tab === 'xray') SM.renderBoard(); } });
  };
  document.addEventListener('DOMContentLoaded', SM.bind);
})(window.TL);
