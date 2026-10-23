/* Chameleon - calls: the terminal's own picks, written down at the cap they were made at and followed to the end.
   v2.10: two kinds of call, more often and earlier than before (v1.47 called 20 to 60 minutes after graduation and made one or two a day).
   - bond: a token that bonded within six hours of launch and, 4 to 30 minutes after graduation, stands above its graduation cap,
     holds most of its peak since, and has real money going through it (read from 1-minute candles).
   - breakout: a graduate, half an hour to six hours after bonding, that makes a new high with heavy volume behind it.
   Both still clear the rug checks (dev bag, bundles, snipers, insiders, top ten, the rug risk score, copies, serial deployers); a
   social link and a dev who never sold are no longer required. One call per 6 minutes per network, four an hour, 48 a day, the
   strongest candidate first. Each call is a record: the cap at the call, what it was (bond or breakout), the peak since, where it is
   now and how it ended (hit, runner, rugged, faded). On its own domain the site shows the server's journal (the same calls for every
   visitor) and makes none of its own, and so does any copy while SITE.domain names that site; with SITE.domain empty a copy calls by
   itself. One module for the site and the server. */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store;
  var CL = TL.calls = { list: [], byId: {}, handlers: {}, started: false, remote: null };
  var KEY = 'tl.calls1';
  // the bar a launch has to clear to be called: the same gate the feed applies, plus "early enough to matter"
  CL.RULE = { minPot: 50, minHolders: 30, minMc: 9000, maxMc: { solana: 5000000, robinhood: 1500000 }, maxAge: 18 * TL.HR,
    minWatch: 60 * TL.SEC,   // a token gets a data cycle or two in this engine before it can be called: a first sight is not a read
    gradFloor: 0.7,          // a graduated token under 70% of its graduation cap already had its run
    peakRatio: 1.6,          // a token whose last trades show a cap 1.6x above where it is now is on the way down, not up
    recentTrades: 60, checkTtl: 10 * TL.MIN, refuseTtl: 20 * TL.MIN, unreadTtl: 3 * TL.MIN,
    // the rug and conviction checks (v1.41), looser in v2.10: what they keep out is a rug, not a token without a website
    minAge: 4 * TL.MIN, minVol1h: 8000, volToMc: 0.1, buyShare: 0.45,
    top10c: 0.35, devMax: 0.08, bundleMax: 0.25, sniperMax: 0.25, insiderMax: 0.2, rugMax: 0.3, devLaunchesMax: 8, minSafety: 50,
    requireGrad: true, gradTtl: 2 * TL.MIN,
    // v2.10: the bond call (4 to 30 minutes after graduation) and the breakout (30 minutes to 6 hours after it)
    bond: { wait: 4 * TL.MIN, window: 30 * TL.MIN, fast: 6 * TL.HR, minCurve: 3 * TL.MIN, above: 1.05, hold: 0.65, maxRun: 25, vol5: { solana: 10000, robinhood: 2000 }, volSince: { solana: 40000, robinhood: 6000 }, blowoff: 1.6 },
    // minCurve (v2.10, measured on 8 Oct 2026): a launch that graduates within three minutes of its birth had its curve bought out in one
    // go, usually by its own dev, and is dumped right after; maxRun: a cap 25x over the graduation cap minutes later is a broken print, not a run
    breakout: { from: 30 * TL.MIN, to: 6 * TL.HR, newHigh: 1.3, vol15: { solana: 80000, robinhood: 12000 }, above: 2 },
    // the measured base (8 Oct 2026, pump.fun graduations of the day before, 1-minute candles): two thirds of all graduations had their
    // curve bought out within three minutes of birth and a third of those were dumped within four hours; of the rest, a bond call 4-30
    // minutes after graduation at these bars came on about half of them and most of those doubled. A late breakout peaked much lower, so its bar is high
    gradWait: 4 * TL.MIN, gradWindow: 12 * TL.HR, // kept for the words on the site and the server
    cooldown: 6 * TL.MIN, maxPerHour: 4, maxPerDay: 48 };
  // why a token that clears the feed's gate is still not a call; '' = nothing against it
  CL.weak = function (t, now) {
    var R = CL.RULE; now = now || U.now();
    if (U.isNum(t.createdAt) && now - t.createdAt < R.minAge) return 'younger than ' + Math.round(R.minAge / TL.MIN) + ' minutes';
    var sc = t.scores || {};
    if (U.isNum(sc.safety) && sc.safety < R.minSafety) return 'safety ' + sc.safety;
    if (t.clones.length && !t.firstOfName && t.clones.length >= 3) return 'one of a wave of copies';
    var v1 = U.isNum(t.vol.h1) ? t.vol.h1 : (U.isNum(t.vol.m5) ? t.vol.m5 * 12 : null);
    if (v1 !== null && (v1 < R.minVol1h || (U.isNum(t.mc) && v1 < t.mc * R.volToMc))) return 'only ' + U.fmtUsd(v1) + ' traded in the last hour';
    var tx = (t.tx.m5 && U.isNum(t.tx.m5.b) && (t.tx.m5.b + (t.tx.m5.s || 0)) >= 8) ? t.tx.m5 : (t.tx.h1 && U.isNum(t.tx.h1.b) ? t.tx.h1 : null);
    if (tx && (tx.b + (tx.s || 0)) > 0 && tx.b / (tx.b + (tx.s || 0)) < R.buyShare) return 'sellers outnumber buyers';
    var t10c = TL.top10circ(t); if (U.isNum(t10c) && t10c > R.top10c) return 'top 10 own ' + U.pct0(t10c) + ' of what circulates';
    if (U.isNum(t.dev.pct) && t.dev.pct > R.devMax) return 'dev holds ' + U.pct0(t.dev.pct);
    if (U.isNum(t.dev.launches) && t.dev.launches >= R.devLaunchesMax && !(t.dev.graduated > 0)) return 'serial deployer, ' + t.dev.launches + ' launches and none graduated';
    if (U.isNum(t.bundlePct) && t.bundlePct > R.bundleMax) return 'bundled ' + U.pct0(t.bundlePct);
    if (U.isNum(t.sniperPct) && t.sniperPct > R.sniperMax) return 'snipers hold ' + U.pct0(t.sniperPct);
    if (U.isNum(t.insiderPct) && t.insiderPct > R.insiderMax) return 'insiders hold ' + U.pct0(t.insiderPct);
    if (U.isNum(t.rugRatio) && t.rugRatio > R.rugMax) return 'GMGN rug risk ' + U.pct0(t.rugRatio);
    return '';
  };
  // the case for a call, in a few words: the strongest positives the scoring found, plus the traction that made it a call
  CL.reasons = function (t, n) {
    var R = t.reasons, out = [];
    if (R) R.safety.concat(R.momentum, R.community).filter(function (r) { return r.pts > 0; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, n || 4).forEach(function (r) { out.push(r.label); });
    if (t.smart && t.smart.wallets && !out.some(function (x) { return /smart/i.test(x); })) out.unshift(t.smart.wallets + ' smart wallet' + (t.smart.wallets === 1 ? '' : 's') + ' inside');
    return out.slice(0, n || 4);
  };
  CL.V = 3; // the rule a record was made under: 2 = conviction (v1.41), 3 = after graduation (v1.47). Older records are dropped on load and never merged from a server
  CL.MILESTONES = [2, 3, 5, 10, 25, 50, 100];   // multiples of the call cap that get a follow-up
  CL.HIT = 2; CL.RUNNER = 5;                     // a call that doubled is a hit; one that did 5x is a runner
  CL.KEEP_MS = 7 * TL.DAY; CL.MAX = 400;

  // ---------- storage: the browser's localStorage on the site, the engine's file-backed shim on the server ----------
  CL.load = function () {
    var raw = null; try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var list = raw && Array.isArray(raw.list) ? raw.list : [];
    var now = U.now();
    CL.list = list.filter(function (r) { return r && r.id && U.isNum(r.at) && now - r.at < CL.KEEP_MS && (r.demo || r.v >= CL.V); }); // v1.42: records of the old, looser rule are not this journal's record
    CL.byId = {}; CL.list.forEach(function (r) { CL.byId[r.id] = r; });
    return CL.list;
  };
  var saveTimer = null;
  CL.save = function (force) {
    if (force) { flush(); return; }
    if (saveTimer) return;
    saveTimer = setTimeout(flush, 1500);
  };
  function flush() {
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list: CL.list.slice(-CL.MAX) })); } catch (e) {}
  }
  CL.load();

  // ---------- events: 'call' (a new record), 'milestone' (rec, x), 'rug' (rec), 'change' ----------
  CL.on = function (evt, fn) { (CL.handlers[evt] = CL.handlers[evt] || []).push(fn); return CL; };
  CL.emit = function (evt) {
    var args = Array.prototype.slice.call(arguments, 1);
    (CL.handlers[evt] || []).forEach(function (fn) { try { fn.apply(null, args); } catch (e) { try { console.warn('[chameleon] calls handler', evt, e); } catch (e2) {} } });
  };

  // ---------- the rule ----------
  // opts.minPot raises the bar for one listener (a bot subscriber with /min 80) without changing what the journal records
  CL.isCall = function (t, opts) {
    opts = opts || {};
    if (!t || t.top || t.demo || t.partial || !t.ready) return false;
    var now = U.now();
    if (!U.isNum(t.createdAt) || now - t.createdAt > CL.RULE.maxAge) return false; // the cheap checks first: most of the store is old
    if (!(U.isNum(t.holders) && t.holders >= CL.RULE.minHolders && t.holdersSrc !== 'stream')) return false;
    if (!(U.isNum(t.mc) && t.mc >= CL.RULE.minMc)) return false;
    var cap = CL.RULE.maxMc[t.chain]; if (cap && t.mc > cap) return false; // past this it is not a call, it is a chart everyone can see
    if (!TL.trusted(t) || !TL.checked(t)) return false;
    TL.ensureVet(t);
    if (!t._ok) return false;
    if (opts.strict && !t._okStrict) return false;
    var minPot = U.isNum(opts.minPot) ? Math.max(opts.minPot, CL.RULE.minPot) : CL.RULE.minPot;
    if (!(t.verdict === 'STRONG' || (U.isNum(t._pot) && t._pot >= minPot))) return false;
    // v1.33: the past of the token. Seen for the first time seconds ago: wait. Graduated and below where it graduated: the run
    // is behind it. Not watched from its first minutes: its last trades are read first (CL.verify), and a refusal holds.
    if (!opts.any) {
      if (U.isNum(t._firstAt) && now - t._firstAt < CL.RULE.minWatch) return false;
      var grad = TL.gradCapUsd(t); if (grad && TL.graduatedLike(t) && t.mc < grad * CL.RULE.gradFloor) return false;
      var t10c = TL.top10circ(t); if (!U.isNum(t10c) || t10c > TL.TOP10C.call) return false; // v1.34: ten wallets owning most of the float is not a call, and an unread distribution is not either
      var ck = t._callCheck; if (ck && ((ck.state === 'refused' && now - ck.at < CL.RULE.refuseTtl) || (ck.state === 'unread' && now - ck.at < CL.RULE.unreadTtl))) return false;
      if (!opts.preCheck) { var weak = CL.weak(t, now); t._callWeak = weak; if (weak) return false; } // v1.41: conviction, not just a clean gate (preCheck: the gate alone, so a late-met token still gets its trades read)
    }
    return true;
  };
  // does this token need its recent trades read before a call? Only when this browser did not watch it from its first minutes
  CL.needsCheck = function (t) {
    if (t.mcFirstSeen === true && U.isNum(t.createdAt) && U.now() - t.createdAt < 45 * TL.MIN) return false;
    var ck = t._callCheck; return !(ck && ck.state === 'ok' && U.now() - ck.at < CL.RULE.checkTtl);
  };
  // ---------- v2.10: the graduation rule, two windows ----------
  // where a token stands: 'bond' (4 to 30 minutes after a graduation that came within six hours of launch), 'breakout' (half an hour to
  // twelve hours after it), or the reason it is neither
  CL.gradState = function (t, now) {
    var R = CL.RULE; now = now || U.now();
    if (!TL.graduatedLike(t) || !U.isNum(t.graduatedAt)) return 'not graduated';
    var since = now - t.graduatedAt;
    if (since < R.bond.wait) return 'graduated ' + Math.round(since / TL.MIN) + ' min ago, waiting for ' + Math.round(R.bond.wait / TL.MIN);
    if (since <= R.bond.window) {
      if (U.isNum(t.createdAt) && t.graduatedAt - t.createdAt > R.bond.fast) return 'took ' + U.fmtAge(t.graduatedAt - t.createdAt) + ' to graduate';
      if (U.isNum(t.createdAt) && t.graduatedAt - t.createdAt < R.bond.minCurve) return 'its curve was bought out in one go';
      return 'bond';
    }
    if (since >= R.breakout.from && since <= R.breakout.to) return U.isNum(t.createdAt) && t.graduatedAt - t.createdAt < R.bond.minCurve ? 'its curve was bought out in one go' : 'breakout';
    return 'graduated ' + U.fmtAge(since) + ' ago, past the window';
  };
  // a breakout is read from the chart only when the feed already sees the token moving: no chart is asked for a quiet one
  CL.moving = function (t) {
    var B = CL.RULE.breakout, v5 = U.isNum(t.vol && t.vol.m5) ? t.vol.m5 : 0, c5 = t.chg && U.isNum(t.chg.m5) ? t.chg.m5 : 0;
    return v5 >= ((B.vol15 && B.vol15[t.chain]) || 0) / 5 && (c5 >= 0.06 || (U.isNum(t.athMc) && U.isNum(t.mc) && t.mc >= t.athMc * 0.9));
  };
  // the chart since graduation (GMGN candles: 1 minute for a bond, 5 minutes for a breakout), judged for the kind of call it is
  CL.gradCheck = function (t, kind) {
    var R = CL.RULE, G = TL.gmgn, now = U.now(), BO = R.bond, BK = R.breakout;
    var judge = function (m) { // m: gradMc, peakMc (since graduation, before the last 15 min for a breakout), nowMc, vol5, vol15, volSince, recentHigh, preGradPeak, estimated
      var out = Object.assign({ ok: false, kind: kind }, m);
      if (!U.isNum(m.gradMc) || !U.isNum(m.nowMc) || m.gradMc <= 0) { out.why = 'no graduation cap to measure against'; out.unread = true; return out; }
      out.above = m.nowMc / m.gradMc;
      if (kind === 'bond') {
        var peak = Math.max(m.gradMc, m.peakMc || 0); out.hold = peak > 0 ? m.nowMc / peak : null;
        if (U.isNum(m.preGradPeak) && m.preGradPeak > BO.blowoff * m.gradMc) { out.why = 'blew off on the curve: peaked at ' + U.fmtUsd(m.preGradPeak) + ' before graduating at ' + U.fmtUsd(m.gradMc); return out; }
        if (out.above < BO.above) { out.why = 'not above its graduation cap yet (' + U.fmtUsd(m.nowMc) + ' vs ' + U.fmtUsd(m.gradMc) + ')'; return out; }
        if (out.above > BO.maxRun) { out.why = 'a print ' + Math.round(out.above) + 'x its graduation cap minutes later: not a market'; return out; }
        if (out.hold < BO.hold) { out.why = 'gave back too much: ' + U.fmtUsd(m.nowMc) + ' after a peak of ' + U.fmtUsd(peak); return out; }
        if (m.vol5 < (BO.vol5[t.chain] || 0)) { out.why = 'only ' + U.fmtUsd(m.vol5) + ' traded in the last 5 minutes'; return out; }
        if (m.volSince < (BO.volSince[t.chain] || 0)) { out.why = 'only ' + U.fmtUsd(m.volSince) + ' traded since graduation'; return out; }
        out.ok = true; out.score = Math.min(40, Math.log2(Math.max(1, m.vol5 / (BO.vol5[t.chain] || 1))) * 8 + (out.hold - BO.hold) * 40 + (out.above - 1) * 20);
        out.why = 'bonded and holding: ' + CL.fmtX(out.above) + ' its graduation cap, ' + Math.round(out.hold * 100) + '% of its peak, ' + U.fmtUsd(m.vol5) + ' traded in 5 min' + (m.estimated ? ' (estimated from the feed)' : '');
        return out;
      }
      // breakout: a new high over everything since graduation, money behind it, not already falling back
      var before = Math.max(m.gradMc, m.peakMc || 0);
      if (!(U.isNum(m.recentHigh) && m.recentHigh >= BK.newHigh * before)) { out.why = 'no new high (' + U.fmtUsd(m.recentHigh) + ' vs ' + U.fmtUsd(before) + ' before)'; return out; }
      if (m.nowMc < 0.85 * m.recentHigh) { out.why = 'already back from its new high'; return out; }
      if (out.above < BK.above) { out.why = 'under ' + CL.fmtX(BK.above) + ' its graduation cap'; return out; }
      if (m.vol15 < (BK.vol15[t.chain] || 0)) { out.why = 'only ' + U.fmtUsd(m.vol15) + ' traded in the last 15 minutes'; return out; }
      out.ok = true; out.score = Math.min(40, Math.log2(Math.max(1, m.vol15 / (BK.vol15[t.chain] || 1))) * 8 + (m.recentHigh / before - 1) * 30);
      out.why = 'broke out: a new high at ' + U.fmtUsd(m.recentHigh) + ' over ' + U.fmtUsd(before) + ' since graduation, ' + U.fmtUsd(m.vol15) + ' traded in 15 min';
      return out;
    };
    if (!(G && G.active && G.active() && G.request)) { // no chart source: the feed's own numbers, marked as an estimate (a breakout needs the chart)
      if (kind !== 'bond') return Promise.resolve({ ok: false, kind: kind, unread: true, why: 'a breakout needs the chart' });
      var peakSince = U.isNum(t.athMc) && U.isNum(t.athAt) && t.athAt >= t.graduatedAt ? t.athMc : t.mc;
      return Promise.resolve(judge({ gradMc: TL.gradCapUsd(t) || t.mc, peakMc: peakSince, nowMc: t.mc, vol5: U.isNum(t.vol && t.vol.m5) ? t.vol.m5 : 0, volSince: U.isNum(t.vol && t.vol.h1) ? t.vol.h1 : 0, preGradPeak: null, estimated: true }));
    }
    var res = kind === 'bond' ? '1m' : '5m', step = kind === 'bond' ? TL.MIN : 5 * TL.MIN;
    var from = kind === 'bond' ? Math.max(U.isNum(t.createdAt) ? t.createdAt - TL.MIN : 0, t.graduatedAt - 90 * TL.MIN) : t.graduatedAt - 10 * TL.MIN;
    return G.request('GET', '/v1/market/token_kline', { chain: G.slug(t.chain), address: t.address, resolution: res, from: from, to: now, limit: 500 }, null, 2, { prio: 1, ttl: kind === 'bond' ? 50000 : 110000, key: 'grad:' + kind + ':' + t.id }).then(function (d) {
      var list = d && Array.isArray(d.list) ? d.list : [];
      if (!list.length) return judge({ gradMc: null, nowMc: null });
      var supply = U.isNum(t.supply) && t.supply > 0 ? t.supply : 1e9, g = t.graduatedAt, gradMc = null, peakMc = 0, preGradPeak = 0, vol5 = 0, vol15 = 0, volSince = 0, nowMc = null, recentHigh = 0;
      list.forEach(function (c) {
        var time = +c.time, close = +c.close * supply, high = +c.high * supply, v = +c.volume || 0;
        if (time >= g - step) {
          if (gradMc === null && time >= g - step / 2) gradMc = +c.open * supply;
          volSince += v;
          if (time >= now - 15 * TL.MIN) { if (high > recentHigh) recentHigh = high; } else if (high > peakMc) peakMc = high;
        } else if (high > preGradPeak) preGradPeak = high;
        if (time >= now - 5 * TL.MIN) vol5 += v;
        if (time >= now - 15 * TL.MIN) vol15 += v;
        nowMc = close;
      });
      if (gradMc === null) gradMc = TL.gradCapUsd(t) || nowMc; // no candle at graduation yet: the cap the curve completes at stands for it
      if (kind === 'bond') peakMc = Math.max(peakMc, recentHigh); // a bond reads the whole post-graduation run as its peak
      return judge({ gradMc: gradMc, peakMc: peakMc, nowMc: nowMc, vol5: vol5, vol15: vol15, volSince: volSince, recentHigh: recentHigh, preGradPeak: preGradPeak || null, estimated: false, candles: list.length });
    }, function (e) { return { ok: false, kind: kind, unread: true, why: 'chart read failed: ' + (e && e.message || 'error') }; });
  };
  // the pace: one call per 6 minutes per network, four an hour, 48 a day; the strongest candidate of a pass goes first
  CL.canCall = function (chain, now) {
    var R = CL.RULE; now = now || U.now(); var last = 0, today = 0, hour = 0;
    CL.list.forEach(function (r) { if (r.chain !== chain || r.demo) return; if (r.at > last) last = r.at; if (now - r.at < TL.DAY) today++; if (now - r.at < TL.HR) hour++; });
    if (now - last < R.cooldown) return 'the last call here was ' + Math.round((now - last) / TL.MIN) + ' min ago';
    if (hour >= R.maxPerHour) return R.maxPerHour + ' calls in the last hour already';
    if (today >= R.maxPerDay) return R.maxPerDay + ' calls today already';
    return '';
  };
  CL.verify = function (t) {
    var X = TL.xray; if (!X || !X.recentPeak) return Promise.resolve({ ok: false, why: 'no trade reader' });
    return X.recentPeak(t, CL.RULE.recentTrades).then(function (r) {
      if (!r) return { ok: false, unread: true, why: 'its recent trades could not be read' };
      if (U.isNum(r.peakMc) && (!U.isNum(t.athMc) || r.peakMc > t.athMc)) { t.athMc = r.peakMc; t.athAt = r.peakAt || U.now(); t.athSrc = 'recent trades'; t._rev = (t._rev || 0) + 1; }
      var ratio = U.isNum(t.mc) && t.mc > 0 ? r.peakMc / t.mc : null;
      if (ratio !== null && ratio >= CL.RULE.peakRatio) return { ok: false, why: 'its last ' + r.trades + ' trades peaked at ' + U.fmtUsd(r.peakMc) + ', ' + Math.round(ratio * 10) / 10 + 'x above where it is now', peakMc: r.peakMc, trades: r.trades };
      return { ok: true, why: 'last ' + r.trades + ' trades read, peak ' + U.fmtUsd(r.peakMc), peakMc: r.peakMc, trades: r.trades };
    }, function (e) { return { ok: false, unread: true, why: 'trade read failed: ' + (e && e.message || 'error') }; });
  };
  function record(t, now) {
    var ck = t._callCheck, gc = t._gradCheck && t._gradCheck.state === 'ok' ? t._gradCheck : null;
    return { v: CL.V, id: t.id, chain: t.chain, address: t.address, symbol: t.symbol || '', name: t.name || '', at: now, mc: t.mc, pot: U.isNum(t._pot) ? Math.round(t._pot) : null,
      verdict: t.verdict, strict: !!t._okStrict, holders: U.isNum(t.holders) ? t.holders : null, launchpad: t.launchpad || '',
      history: ck && ck.state === 'ok' ? 'checked: ' + ck.why : 'watched from its first minutes',
      why: CL.reasons(t, 4), logo: t.logoOk || t.logo || '', // v1.41: the case for the call and its picture travel with the record (the server's journal keeps both)
      gradAt: U.isNum(t.graduatedAt) ? t.graduatedAt : null, gradMc: gc && U.isNum(gc.gradMc) ? Math.round(gc.gradMc) : null, hold: gc && U.isNum(gc.hold) ? Math.round(gc.hold * 100) / 100 : null, vol15: gc && U.isNum(gc.vol15) ? Math.round(gc.vol15) : null, gradWhy: gc ? gc.why : '', // v1.47
      kind: gc && gc.kind ? gc.kind : 'bond', rule: 4, // v2.10: a bond call or a breakout
      peakMc: t.mc, peakAt: now, peakX: 1, nowMc: t.mc, nowX: 1, stage: 1, status: 'open', src: 'local' };
  }
  // ---------- following a call: the peak after the call, the milestones, the end ----------
  CL.follow = function (rec, t, now) {
    now = now || U.now();
    if (t && U.isNum(t.mc) && t.mc > 0) {
      rec.nowMc = t.mc;
      if (t.mc > (rec.peakMc || 0)) { rec.peakMc = t.mc; rec.peakAt = now; }
      if (U.isNum(t.athMc) && U.isNum(t.athAt) && t.athAt >= rec.at && t.athMc > (rec.peakMc || 0)) { rec.peakMc = t.athMc; rec.peakAt = t.athAt; }
      rec.peakX = rec.mc > 0 ? rec.peakMc / rec.mc : null; rec.nowX = rec.mc > 0 ? rec.nowMc / rec.mc : null;
      if (U.isNum(t.holders)) rec.holdersNow = t.holders;
    }
    var hit = [];
    CL.MILESTONES.forEach(function (m) { if (U.isNum(rec.peakX) && rec.peakX >= m && m > (rec.stage || 1)) { rec.stage = m; hit.push(m); } });
    var rugged = !!(t && (t.verdict === 'RUGGED' || TL.rugged(t)));
    var was = rec.status;
    if (rec.status === 'rugged' || rugged) { if (!rec.ruggedAt) rec.ruggedAt = now; rec.status = 'rugged'; }
    else if (U.isNum(rec.peakX) && rec.peakX >= CL.RUNNER) rec.status = 'runner';
    else if (U.isNum(rec.peakX) && rec.peakX >= CL.HIT) rec.status = 'hit';
    else if (now - rec.at > TL.DAY) rec.status = U.isNum(rec.nowX) && rec.nowX >= 1 ? 'flat' : 'faded';
    else rec.status = 'open';
    if (t && t.verdict) rec.verdictNow = t.verdict;
    rec.seenAt = now;
    return { milestones: hit, rugged: rec.status === 'rugged' && was !== 'rugged' };
  };
  // one pass over the store: new calls, follow-ups on the old ones. Runs every 10 s on the site and on the server.
  CL.tick = function (now) {
    now = now || U.now();
    if (!store._booted) return;
    if (store.mode !== 'live') return; // the preview seeds its own records (CL.seedDemo) and never calls a fictional token
    var changed = false, candidates = [];
    store.all().forEach(function (t) {
      if (t.top || t.demo || t.partial) return;
      var rec = CL.byId[t.id];
      if (rec) {
        if (rec.status === 'rugged' && rec.ruggedAt && now - rec.ruggedAt > TL.HR) return; // over: nothing left to follow
        TL.ensureVet(t);
        var r = CL.follow(rec, t, now); changed = true;
        r.milestones.forEach(function (m) { CL.emit('milestone', rec, m); });
        if (r.rugged) CL.emit('rug', rec);
        return;
      }
      if (CL.followOnly) return; // v2.10: the server makes the calls, this page follows them
      if (!CL.isCall(t, { preCheck: true })) return;
      if (CL.needsCheck(t)) { // met late: read its last trades first; the call is made on a later pass if they clear it (and a late-met dump turns RUGGED here, call or not)
        if (t._callCheck && t._callCheck.state === 'pending' && now - t._callCheck.at < 2 * TL.MIN) return;
        t._callCheck = { at: now, state: 'pending' };
        CL.verify(t).then(function (r) {
          t._callCheck = { at: U.now(), state: r.ok ? 'ok' : (r.unread ? 'unread' : 'refused'), why: r.why, peakMc: r.peakMc, trades: r.trades }; // unread: the node did not answer, tried again in a few minutes
          try { console.info('[chameleon] call check', t.symbol, t._callCheck.state, r.why); } catch (e) {}
          if (!r.ok) { TL.vet(t); if (TL.ui && TL.ui.markDirty) TL.ui.markDirty(t); } // a found peak can turn the verdict RUGGED
          else CL.tick();
        });
        return;
      }
      if (CL.RULE.requireGrad) { // v2.10: a bond call 4 to 30 minutes after graduation, or a breakout up to 6 hours after it; the chart decides
        var gs = CL.gradState(t, now); t._gradState = gs;
        if (gs !== 'bond' && gs !== 'breakout') return;
        if (gs === 'breakout' && !CL.moving(t)) return;
        var gc = t._gradCheck, stale = !gc || gc.kind !== gs || (gc.state === 'pending' ? now - gc.at > 2 * TL.MIN : now - gc.at > CL.RULE.gradTtl);
        if (stale) { // a fresh read of the chart every two minutes while the token is in a window: the answer can change either way
          t._gradCheck = { at: now, state: 'pending', kind: gs };
          CL.gradCheck(t, gs).then(function (r) {
            t._gradCheck = Object.assign({ at: U.now(), state: r.ok ? 'ok' : (r.unread ? 'unread' : 'refused') }, r, { kind: gs });
            try { console.info('[chameleon] ' + gs + ' check', t.symbol, t._gradCheck.state, r.why); } catch (e) {}
            if (r.ok) CL.tick();
          }, function () { t._gradCheck = { at: U.now(), state: 'unread', kind: gs, why: 'chart read failed' }; });
          return;
        }
        if (gc.state !== 'ok') return;
        if (!CL.isCall(t)) return; // the rug and conviction checks on top of the chart
        candidates.push(t); return;
      }
      if (!CL.isCall(t)) return; // v1.41: the conviction checks, once the trades are read
      var G = TL.gmgn; // v1.42: GMGN's risk record first (rug risk, bundles, snipers, insiders, the dev's bag): the numbers the checks are made of
      if (G && G.active() && G.pollRisk && !t.gmgnSecAt && !(t._riskAsk && now - t._riskAsk < 2 * TL.MIN)) {
        t._riskAsk = now;
        G.pollRisk(t).then(function () { var tk = store.get(t.id); if (tk) { tk._rev = (tk._rev || 0) + 1; TL.vet(tk); if (TL.ui && TL.ui.markDirty) TL.ui.markDirty(tk); } CL.tick(); }, function () {});
        return;
      }
      if (G && G.active() && t.gmgnSecAt && !CL.isCall(t)) return; // the risk record changed the answer
      rec = record(t, now); CL.list.push(rec); CL.byId[rec.id] = rec; changed = true;
      try { console.info('[chameleon] CALL', t.chain, t.symbol, 'at', U.fmtUsd(t.mc), 'potential', rec.pot, rec.verdict); } catch (e) {}
      CL.emit('call', rec);
    });
    // the candidates of this pass, strongest first (potential plus how strong the chart read), each under the pace and the risk record
    candidates.sort(function (a, b) { return ((b._pot || 0) + ((b._gradCheck && b._gradCheck.score) || 0)) - ((a._pot || 0) + ((a._gradCheck && a._gradCheck.score) || 0)); }).forEach(function (t) {
      if (CL.byId[t.id]) return;
      var block = CL.canCall(t.chain, now); if (block) { t._callWeak = block; return; }
      var G = TL.gmgn;
      if (G && G.active() && G.pollRisk && !t.gmgnSecAt && !(t._riskAsk && now - t._riskAsk < 2 * TL.MIN)) {
        t._riskAsk = now;
        G.pollRisk(t).then(function () { var tk = store.get(t.id); if (tk) { tk._rev = (tk._rev || 0) + 1; TL.vet(tk); if (TL.ui && TL.ui.markDirty) TL.ui.markDirty(tk); } CL.tick(); }, function () {});
        return;
      }
      if (G && G.active() && t.gmgnSecAt && !CL.isCall(t)) return;
      var rec = record(t, now); CL.list.push(rec); CL.byId[rec.id] = rec; changed = true;
      try { console.info('[chameleon] CALL', t.chain, t.symbol, 'at', U.fmtUsd(t.mc), rec.gradWhy, 'potential', rec.pot, rec.verdict); } catch (e) {}
      CL.emit('call', rec);
    });
    // records of tokens the store forgot keep their last state; very old ones leave
    var before = CL.list.length;
    CL.list = CL.list.filter(function (r) { return now - r.at < CL.KEEP_MS; });
    if (CL.list.length > CL.MAX) CL.list = CL.list.slice(-CL.MAX);
    if (CL.list.length !== before) { CL.byId = {}; CL.list.forEach(function (r) { CL.byId[r.id] = r; }); changed = true; }
    if (changed) { CL.save(); CL.emit('change'); }
  };
  // opts: a number (the pass in ms, the server) or { ms, followOnly } (v2.10: the site on its own domain follows the server's journal and
  // makes no calls of its own, so every visitor sees the same calls)
  CL.start = function (opts) {
    var ms = typeof opts === 'number' ? opts : (opts && opts.ms); if (opts && typeof opts === 'object' && opts.followOnly) CL.followOnly = true;
    if (CL.started) return; CL.started = true;
    setInterval(function () { try { CL.tick(); } catch (e) { try { console.warn('[chameleon] calls tick', e); } catch (e2) {} } }, ms || 10 * TL.SEC);
    setTimeout(function () { try { CL.tick(); } catch (e) {} }, 1500);
  };

  // ---------- reading the journal ----------
  CL.forToken = function (t) { return t ? (CL.byId[t.id] || CL.byId[t.chain + ':' + t.address] || null) : null; };
  CL.recent = function (chain, n, sinceMs) {
    var now = U.now();
    return CL.list.filter(function (r) { return (!chain || r.chain === chain) && (!sinceMs || now - r.at < sinceMs); })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, n || 50);
  };
  CL.stats = function (chain, sinceMs) {
    var rows = CL.recent(chain, 10000, sinceMs || TL.DAY);
    var st = { calls: rows.length, hits: 0, runners: 0, rugged: 0, open: 0, best: null, medianX: null };
    var xs = [];
    rows.forEach(function (r) {
      if (r.status === 'rugged') st.rugged++;
      else if (r.status === 'runner') { st.runners++; st.hits++; }
      else if (r.status === 'hit') st.hits++;
      else if (r.status === 'open') st.open++;
      if (U.isNum(r.peakX)) { xs.push(r.peakX); if (!st.best || r.peakX > st.best.peakX) st.best = r; }
    });
    if (xs.length) { xs.sort(function (a, b) { return a - b; }); st.medianX = xs[Math.floor(xs.length / 2)]; }
    return st;
  };
  // v1.41: the calls worth showing first: the ones that went somewhere (by their peak), then the open ones still above the call cap,
  // then the rest; a rugged call is never in the first rows. The strip and the server's journal read this order.
  CL.best = function (chain, n, sinceMs) {
    var rows = CL.recent(chain, 10000, sinceMs || TL.DAY);
    var tier = function (r) { return r.status === 'runner' ? 0 : r.status === 'hit' ? 1 : r.status === 'open' && U.isNum(r.nowX) && r.nowX >= 1.15 ? 2 : r.status === 'open' ? 3 : r.status === 'flat' ? 4 : r.status === 'faded' ? 5 : 6; };
    rows.sort(function (a, b) { return tier(a) - tier(b) || (b.peakX || 0) - (a.peakX || 0) || b.at - a.at; });
    return rows.slice(0, n || 12);
  };
  CL.fmtX = function (x) { return !U.isNum(x) ? '' : x >= 100 ? Math.round(x) + 'x' : x >= 10 ? (Math.round(x * 10) / 10) + 'x' : x.toFixed(2).replace(/0$/, '') + 'x'; };
  CL.STATUS = { open: 'open', hit: 'hit', runner: 'runner', rugged: 'rugged', faded: 'faded', flat: 'flat' };
  // one line that says what happened to a call: "called at $14.2K · peak $88.0K (6.2x) · now $61.0K (4.3x)"
  CL.words = function (rec) {
    var parts = ['called at ' + U.fmtUsd(rec.mc) + (U.isNum(rec.gradAt) && rec.at > rec.gradAt ? ', ' + Math.round((rec.at - rec.gradAt) / TL.MIN) + ' min after graduation' : '')];
    if (U.isNum(rec.peakX) && rec.peakX >= 1.05) parts.push('peak ' + U.fmtUsd(rec.peakMc) + ' (' + CL.fmtX(rec.peakX) + ')');
    if (U.isNum(rec.nowMc)) parts.push('now ' + U.fmtUsd(rec.nowMc) + (U.isNum(rec.nowX) ? ' (' + CL.fmtX(rec.nowX) + ')' : ''));
    if (rec.status === 'rugged') parts.push('rugged');
    return parts.join(' · ');
  };

  // ---------- a shared journal: the server can publish its records (GET /calls.json) and the site shows them to every visitor ----------
  CL.merge = function (rows, src) {
    var n = 0, now = U.now();
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.id || !U.isNum(r.at) || now - r.at > CL.KEEP_MS || !(r.demo || r.v >= CL.V)) return;
      var mine = CL.byId[r.id];
      if (!mine) { r = Object.assign({}, r, { src: src || 'server' }); CL.list.push(r); CL.byId[r.id] = r; n++; return; }
      if (mine.src !== 'local' && (r.seenAt || 0) > (mine.seenAt || 0)) Object.assign(mine, r, { src: src || 'server' }); // the server followed it further
    });
    if (n) { CL.save(); CL.emit('change'); }
    return n;
  };
  CL.pullRemote = function (url) {
    if (!url) return Promise.resolve(0);
    return U.timeoutFetch(url, 8000).then(function (r) { return CL.merge(r && r.list ? r.list : r, 'server'); }).catch(function () { return 0; });
  };
  CL.export = function () { return { v: 1, at: U.now(), list: CL.list.slice(-CL.MAX) }; };

  // ---------- the preview: fictional calls so the artifact shows what the journal looks like ----------
  CL.seedDemo = function () {
    if (CL.list.some(function (r) { return r.demo; })) return;
    var demo = store.all().filter(function (t) { return t.demo && !t.top && U.isNum(t.mc) && t.mc > 8000 && t.verdict !== 'RUGGED' && t.verdict !== 'AVOID'; }).slice(0, 5);
    var now = U.now(), r = U.rng('calls-demo');
    demo.forEach(function (t, i) {
      var x = [6.4, 2.3, 1.1, 0.7, 12.8][i] || 1.5; var at = now - (35 + i * 48) * TL.MIN;
      if (U.isNum(t.createdAt) && t.createdAt > at) at = Math.min(now - 4 * TL.MIN, t.createdAt + 3 * TL.MIN); // a call comes after the launch, not before
      var rec = { id: t.id, chain: t.chain, address: t.address, symbol: t.symbol || '', name: t.name || '', at: at, mc: t.mc / x, pot: 64 + Math.round(r() * 30), verdict: 'STRONG', strict: true, holders: Math.round((t.holders || 200) / 3),
        peakMc: t.mc * (x > 1 ? 1.1 : 1), peakAt: Math.min(now - TL.MIN, at + 20 * TL.MIN), peakX: x > 1 ? x * 1.1 : 1.15, nowMc: t.mc, nowX: x, stage: 1, status: 'open', src: 'local', demo: true, seenAt: now };
      CL.MILESTONES.forEach(function (m) { if (rec.peakX >= m) rec.stage = m; });
      rec.status = rec.peakX >= CL.RUNNER ? 'runner' : rec.peakX >= CL.HIT ? 'hit' : (x < 0.8 ? 'faded' : 'open');
      CL.list.push(rec); CL.byId[rec.id] = rec;
    });
    CL.emit('change');
    return demo.length;
  };
})(window.TL);
