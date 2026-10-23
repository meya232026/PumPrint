/* Chameleon - GMGN OpenAPI (openapi.gmgn.ai): the main source once the user adds their own GMGN API key (gmgn.ai/ai).
   With a key: the three Trenches feeds (POST /v1/trenches, newest launches, almost bonded and migrated, 80 each, every few seconds, each
   token with its risk record), Top (GET /v1/market/rank), token pages (token info, security, top holders) and Smart Tracking (smart money
   and KOL trade feeds, top traders of a token, wallet stats and activity). Without a key, or while GMGN refuses, everything keeps running
   on the public sources in app_sources.js.
   Auth, checked against gmgn-cli 1.6.1 and docs.gmgn.ai on 17 Sep 2026: header X-APIKEY, query timestamp (unix seconds, within 5 s of GMGN's
   clock) and client_id (a new UUID per request). Read routes only: no signed routes, no private key, no trading.
   Limits: a leaky bucket per plan, Free 5/5, Plus 20/20, Pro 50/50 (weight per second / capacity), weights per route in W. A 429 carries
   reset_at and every request sent during a ban extends it (5 s each, up to 5 minutes), so the client goes fully quiet until the reset.
   The key stays in this browser (localStorage) and is sent to openapi.gmgn.ai only; a proxy (?gmgn=https://your.server) never gets it. */
(function (TL) {
  'use strict';
  var U = TL.util, C = TL.CONFIG, store = TL.store, S = TL.sources;
  var OFFICIAL = 'https://openapi.gmgn.ai';
  var qp = new URLSearchParams(location.search);
  var PLANS = { free: { rate: 5, cap: 5, label: 'Free' }, plus: { rate: 20, cap: 20, label: 'Plus' }, pro: { rate: 50, cap: 50, label: 'Pro' } };
  var W = { trenches: 2, rank: 3, info: 1, security: 1, holders: 5, traders: 5, smartmoney: 1, kol: 1, stats: 3, activity: 3, profits: 3 };
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  var sandboxed = !!window.claude || /claude|usercontent/.test(location.hostname);
  var G = TL.gmgn = {
    key: lsGet('tl.gmgnKey'), plan: PLANS[lsGet('tl.gmgnPlan')] ? lsGet('tl.gmgnPlan') : 'free', proxy: (C.onSite ? '' : qp.get('gmgn')) || lsGet('tl.gmgnProxy') || '', // v1.59: ?gmgn= never on the site
    state: 'off', note: '', banUntil: 0, level: 0, levelAt: U.now(), queue: [], busy: 0, calls: 0, fails: 0, okAt: 0, skew: 0,
    stat: { solana: null, robinhood: null }, pads: { solana: {}, robinhood: {} }, topAt: {}, sent: [], W: W, PLANS: PLANS, OFFICIAL: OFFICIAL,
    epoch: 1, probe: false, emptyPads: 0, // epoch: answers to requests sent with an earlier key are ignored; probe: one request at a time right after a ban
    auto: false // v1.40: true while the page runs on the site's own proxy, found by G.autoProxy (nothing saved in this browser)
  };
  G.state = G.key || G.proxy ? 'connecting' : 'off';
  G.slug = function (chain) { return chain === 'robinhood' ? 'robinhood' : 'sol'; };
  G.base = function () { return G.proxy ? G.proxy.replace(/\/+$/, '') : C.apiOverride ? C.apiOverride + '/gmgn' : OFFICIAL; }; // a server address wins over everything: that is how a live site runs
  function keyGoesOut() { if (!G.key || G.proxy) return false; try { var o = new URL(G.base()).origin; return o === new URL(OFFICIAL).origin || (!!C.apiOverride && o === new URL(C.apiOverride).origin); } catch (e) { return false; } } // only openapi.gmgn.ai (or the local test mock) gets the key, a server proxy never does; v1.59: checked by origin, whatever the base is
  G.configured = function () { return !!(G.key || G.proxy); };
  G.available = function () { return !sandboxed && C.forcedMode !== 'demo' && store.mode !== 'demo'; };
  G.active = function () { return G.configured() && G.available() && G.state !== 'auth'; };
  G.primary = function (chain) { var s = G.stat[chain]; return G.active() && G.state === 'ok' && !!s && s.n > 0 && U.now() - s.at < 90 * TL.SEC; };
  G.maskedKey = function () { return G.key ? G.key.slice(0, 4) + '…' + G.key.slice(-4) : ''; };
  var listeners = [];
  G.onChange = function (f) { listeners.push(f); };
  function emit() {
    listeners.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    if (S && S.setStatus) S.setStatus('gmgnapi', G.state === 'ok' ? 'ok' : G.state === 'off' ? 'idle' : G.state === 'connecting' ? 'idle' : 'err', G.statusNote());
  }
  G.statusNote = function () {
    if (!G.available()) return 'not available in this preview: open the HTML file on your computer';
    if (G.state === 'off') return C.setupCards === false ? 'not connected: the site\'s own server did not answer at start (a page reload asks it again)' : 'not connected: a server source or an API key turns it on';
    if (G.state === 'connecting') return 'connecting';
    if (G.state === 'auth') return 'key rejected: ' + G.note;
    if (G.state === 'limited') return G.note;
    if (G.state === 'error') return G.note;
    var s = G.stat.solana, h = G.stat.robinhood;
    return (G.proxy ? (G.auto ? 'the site\'s own server' : 'server source') : (PLANS[G.plan] || PLANS.free).label + ' plan') + (s ? ' · Solana ' + s.n : '') + (h ? ' · Robinhood ' + h.n : '');
  };
  // a private key pasted by mistake is refused on the spot: Chameleon only reads data and never needs it
  G.looksPrivate = function (k) { return /BEGIN [A-Z ]*PRIVATE KEY|PRIVATE KEY-----/.test(k) || /^[A-Za-z0-9+\/=]{80,}$/.test(k.replace(/\s+/g, '')); };
  G.setKey = function (key, plan) {
    key = String(key || '').trim();
    if (key && G.looksPrivate(key)) return 'private';
    if (/\s/.test(key)) return 'format';
    G.key = key; lsSet('tl.gmgnKey', key);
    if (plan && PLANS[plan]) { G.plan = plan; lsSet('tl.gmgnPlan', plan); }
    G.queue.splice(0).forEach(function (j) { j.reject(gerr(0, 'RESET', 'key changed')); });
    G.epoch++; G.busy = 0; G.probe = false; G.padFilter = true; G.emptyPads = 0;
    G.state = G.configured() ? 'connecting' : 'off'; G.note = ''; G.banUntil = 0; G.fails = 0; drain(U.now()); // v2.10: the bucket keeps what was just sent (a switch never adds a second burst on top of the last one)
    G.stat = { solana: null, robinhood: null }; last = {};
    if (TL.smart && TL.smart.reset) TL.smart.reset(); // results read with the previous key (or its errors) go too
    emit();
    if (G.active()) { G.start(); G.tick(); }
    return 'ok';
  };
  G.setPlan = function (plan) { if (!PLANS[plan]) return; G.plan = plan; lsSet('tl.gmgnPlan', plan); emit(); };
  // the way a live site runs: one key on the owner's server, visitors need nothing. The proxy forwards the read routes and adds the key.
  // persist === false (v1.40): the address found by G.autoProxy is used for this page only and never written to this browser
  G.setProxy = function (url, persist) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return 'format';
    G.proxy = url; G.auto = persist === false && !!url;
    if (persist !== false) lsSet('tl.gmgnProxy', url);
    G.queue.splice(0).forEach(function (j) { j.reject(gerr(0, 'RESET', 'source changed')); });
    G.epoch++; G.busy = 0; G.probe = false; G.padFilter = true; G.emptyPads = 0;
    G.state = G.configured() ? 'connecting' : 'off'; G.note = ''; G.banUntil = 0; G.fails = 0; drain(U.now()); // v2.10: the bucket keeps what was just sent (a switch never adds a second burst on top of the last one)
    G.stat = { solana: null, robinhood: null }; last = {};
    if (TL.smart && TL.smart.reset) TL.smart.reset();
    emit();
    if (G.active()) { G.start(); G.tick(); }
    return 'ok';
  };
  G.mode = function () { return G.proxy ? 'proxy' : G.key ? 'key' : 'off'; };
  // v1.40: the site's own proxy (CONFIG.gmgnProxyDefault, api.<domain>/gmgn). Asked once at start: when it answers ok (a key lives on the
  // server), the page uses it without saving anything here, so a server switched off later is simply not used next time. A key or a
  // server address set by hand (?gmgn=, the Data sources panel) wins and skips the probe. The answer is a promise; S.cycle waits for it
  // briefly so the first paint already comes from GMGN.
  var autoAsked = null;
  G.autoProxy = function () {
    if (autoAsked) return autoAsked;
    var url = String(C.gmgnProxyDefault || '').replace(/\/+$/, '');
    if (!url || G.configured() || !G.available()) return (autoAsked = Promise.resolve(false));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, 5000);
    autoAsked = fetch(url + '/health', { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || j.ok !== true || G.configured()) return false;
        G.setProxy(url, false);
        return true;
      })
      .catch(function () { clearTimeout(timer); return false; });
    return autoAsked;
  };

  // ---------- request queue: priority first, then age; a leaky bucket per plan with a 20% margin ----------
  function gerr(status, code, msg) { var e = new Error(msg || ('GMGN ' + status)); e.status = status; e.code = String(code || ''); e.gmgn = true; return e; }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (x, i) { b[i] = Math.floor(Math.random() * 256); });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function qstr(q) {
    var p = new URLSearchParams();
    Object.keys(q).forEach(function (k) { var v = q[k]; if (v === undefined || v === null || v === '') return; if (Array.isArray(v)) v.forEach(function (x) { p.append(k, x); }); else p.set(k, String(v)); });
    return p.toString();
  }
  function planOf() { return PLANS[G.plan] || PLANS.free; }
  function drain(now) { var p = planOf(); G.level = Math.max(0, G.level - (now - G.levelAt) / 1000 * p.rate * 0.8); G.levelAt = now; return p; }
  var pumpTimer = null, pending = {};
  function later(ms) { if (pumpTimer) return; pumpTimer = setTimeout(function () { pumpTimer = null; pump(); }, Math.max(20, ms)); }
  function pump() {
    var now = U.now();
    G.queue = G.queue.filter(function (j) { if (j.ttl && now - j.at > j.ttl) { j.reject(gerr(0, 'STALE', 'dropped: a newer poll replaces it')); return false; } return true; });
    if (!G.queue.length) return;
    if (G.banUntil > now) { later(G.banUntil - now + 300); return; }
    var p = drain(now);
    G.queue.sort(function (a, b) { return a.prio - b.prio || a.at - b.at; });
    while (G.queue.length && G.busy < (G.probe ? 1 : 4)) { // right after a ban: a single request first, full speed once it is answered
      var job = G.queue[0], w = Math.min(job.weight, p.cap);
      if (G.level + w > p.cap) { later((G.level + w - p.cap) / (p.rate * 0.8) * 1000 + 40); return; }
      G.queue.shift(); G.level += w; send(job);
    }
    if (G.queue.length) later(150);
  }
  G.request = function (method, path, query, body, weight, opts) {
    opts = opts || {};
    if (!G.active()) return Promise.reject(gerr(0, 'OFF', 'GMGN is not connected'));
    if (opts.key && pending[opts.key]) return pending[opts.key];
    var pr = new Promise(function (resolve, reject) {
      G.queue.push({ method: method, path: path, query: query || {}, body: body || null, weight: weight || 1, prio: opts.prio == null ? 5 : opts.prio, ttl: opts.ttl || 0, at: U.now(), resolve: resolve, reject: reject, epoch: G.epoch });
    });
    if (opts.key) { pending[opts.key] = pr; var clear = function () { delete pending[opts.key]; }; pr.then(clear, clear); }
    pump();
    return pr;
  };
  function send(job) {
    G.busy++; G.calls++;
    var q = {}; Object.keys(job.query).forEach(function (k) { q[k] = job.query[k]; });
    q.timestamp = Math.floor((U.now() + G.skew) / 1000); q.client_id = uuid();
    var url = G.base() + job.path + '?' + qstr(q);
    var headers = {}; if (keyGoesOut()) headers['X-APIKEY'] = G.key; if (job.body) headers['Content-Type'] = 'application/json';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    var settled = false;
    var finish = function (ok, val) { // one ending per request, whichever comes first: the answer, an error, or the watchdog
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(watchdog);
      var cur = job.epoch === G.epoch;
      if (cur) { G.busy = Math.max(0, G.busy - 1); if (ok) onOk(); else onFail(val); }
      if (ok) job.resolve(val); else job.reject(val);
      if (cur) pump();
    };
    var watchdog = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } finish(false, gerr(0, 'TIMEOUT', 'GMGN does not answer')); }, 20000); // a body that never completes must not hold a slot forever
    G.sent.push({ at: U.now(), w: job.weight, path: job.path }); if (G.sent.length > 300) G.sent.splice(0, 150);
    fetch(url, { method: job.method, headers: headers, body: job.body ? JSON.stringify(job.body) : undefined, signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(function (res) {
        var dh = res.headers.get('date'); if (dh) { var d = Date.parse(dh); if (U.isNum(d) && Math.abs(d - U.now()) > 3000) G.skew = d - U.now(); }
        var resetHdr = parseInt(res.headers.get('x-ratelimit-reset') || '', 10);
        return res.text().then(function (text) {
          var json = null; try { json = JSON.parse(text); } catch (e) {}
          if (!json || typeof json !== 'object') throw gerr(res.status, 'BAD_REPLY', 'GMGN answered HTTP ' + res.status + ' without JSON');
          var code = json.code;
          if (!res.ok || (code !== undefined && code !== 0 && code !== '0')) {
            var st = res.ok ? statusFrom(code, res.status) : res.status; // some gateways answer 200 with the error code in the body
            var e = gerr(st, json.error || code, json.message || json.msg || ('HTTP ' + st));
            var ra = U.num(json.reset_at) || (resetHdr > 0 ? resetHdr : null); if (ra) e.resetAt = ra < 1e12 ? ra * 1000 : ra;
            throw e;
          }
          return json.data !== undefined ? json.data : json;
        });
      })
      .then(function (data) { finish(true, data); }, function (e) { finish(false, e); });
  }
  // an error code in the body: 401 / 429 as they are, long codes like 40003701 by their HTTP-like head
  function statusFrom(code, fallback) {
    var n = U.num(code); if (n === null) return fallback || 500;
    if (n >= 400 && n < 600) return n;
    var head = parseInt(String(Math.abs(Math.floor(n))).slice(0, 3), 10);
    return head >= 400 && head < 600 ? head : (fallback >= 400 ? fallback : 400);
  }
  function onOk() {
    G.fails = 0; G.okAt = U.now(); if (G.probe) G.probe = false;
    if (G.state !== 'ok' && G.banUntil <= U.now()) { G.state = 'ok'; G.note = ''; emit(); }
  }
  function hhmmss(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  function onFail(e) {
    var now = U.now(), before = G.state + '|' + G.note, msg = (e && e.message) || 'error';
    if (e && e.gmgn && (e.code === 'STALE' || e.code === 'RESET' || e.code === 'OFF')) return;
    if (e && e.gmgn && (e.status === 401 || /^AUTH/.test(e.code)) && /timestamp|clock|expired|time window/i.test(msg)) {
      // the key may be fine: this computer's clock is more than 5 s off GMGN's. Pause, then try again (the clock may get synced)
      G.state = 'error'; G.note = 'GMGN refused the request time: the computer clock is off by more than 5 seconds. Sync the clock; retrying every 30 s';
      G.banUntil = Math.max(G.banUntil, now + 30000); G.probe = true;
    } else if (e && e.gmgn && (e.status === 401 || /^AUTH/.test(e.code))) {
      G.state = 'auth'; G.note = msg;
      G.queue.splice(0).forEach(function (j) { j.reject(gerr(401, 'AUTH', G.note)); });
    } else if (e && e.gmgn && e.status === 429) {
      var banned = /BANNED|BLOCKED/.test(e.code);
      // reset_at is GMGN's clock and ours can be a few seconds ahead: keep 5 s of margin, then send one probe before full speed,
      // because every request that lands inside the ban extends it
      var until = e.resetAt ? e.resetAt - G.skew + 5000 : now + (banned ? 60000 : 8000);
      G.banUntil = Math.max(G.banUntil, until, now + 3000); G.level = planOf().cap; G.probe = true;
      G.state = 'limited'; G.note = (banned ? 'paused by GMGN' : 'plan limit reached') + ', resuming at ' + hhmmss(G.banUntil);
      setTimeout(function () { if (G.state === 'limited' && G.banUntil <= U.now()) { G.state = 'connecting'; emit(); pump(); } }, G.banUntil - now + 400);
    } else if (e && e.gmgn && e.status && e.status < 500 && e.status !== 403) {
      return; // a 400 / 404 belongs to that one call (an unknown token, a route this chain does not have)
    } else {
      G.fails++;
      if (G.fails >= 3) {
        G.state = 'error'; G.note = e && e.status === 403 ? 'GMGN refused the connection (it answers over IPv4 only)' : e && e.name === 'AbortError' ? 'GMGN does not answer' : 'cannot reach GMGN: ' + msg;
        if (location.protocol === 'file:' && !(e && e.gmgn)) G.note += '. If it keeps failing, open the page through a local server (python3 -m http.server in its folder, then http://localhost:8000/)'; // a file page has a "null" origin some APIs refuse
      }
    }
    if (before !== G.state + '|' + G.note) emit();
  }

  // ---------- normalizers: GMGN rows into the token model (numbers may arrive as strings; a share above 1 is a data fault, not a risk) ----------
  function n0(v) { var x = U.num(v); return x === null ? undefined : x; }
  function share(v) { var x = U.num(v); if (x === null || x < 0 || x > 1.0001) return undefined; return Math.min(1, x); }
  function secs(v) { var x = U.num(v); if (!x || x <= 0) return undefined; return x < 1e12 ? x * 1000 : x; }
  function yes(v) { if (v === true || v === 1) return true; if (v === false || v === 0) return false; var s = String(v == null ? '' : v).toLowerCase(); if (s === '1' || s === 'yes' || s === 'true') return true; if (s === '0' || s === 'no' || s === 'false') return false; return null; }
  function xUrl(v) { if (!v) return undefined; var s = String(v).trim(); if (!s) return undefined; if (/^https?:\/\//i.test(s)) return s; return /^@?[A-Za-z0-9_]{1,15}$/.test(s) ? 'https://x.com/' + s.replace(/^@/, '') : undefined; }
  function webUrl(v) { if (!v) return undefined; var s = String(v).trim(); if (/^https?:\/\//i.test(s)) return s; if (/^(t\.me|www\.)[^\s]+$/i.test(s)) return 'https://' + s; return undefined; }
  G.n0 = n0; G.share = share; G.secs = secs; G.yes = yes;
  var PUMP_PAD = /^(pump\.?fun|pump|pump_mayhem|pump_mayhem_agent|pump_agent)$/i;
  G.PUMP_PADS = ['Pump.fun', 'pump_mayhem', 'pump_mayhem_agent', 'pump_agent'];
  function padOf(chain, pad, addr) {
    if (chain === 'solana') return PUMP_PAD.test(pad) || /pump$/.test(addr) ? 'pump.fun' : (pad ? pad.toLowerCase() : undefined);
    return /pons/i.test(pad) ? 'pons' : (pad ? pad.toLowerCase() : undefined);
  }
  function rights(t, chain, it) { // launchpad programs revoke mint and freeze rights and lock the pool by design; other tokens take GMGN's reading
    if (t.launchpad === 'pump.fun' || t.launchpad === 'pons') { t.mintAuth = false; t.freezeAuth = false; t.lpLocked = true; return; }
    if (chain === 'solana') { var rm = yes(it.renounced_mint), rf = yes(it.renounced_freeze_account); if (rm !== null) t.mintAuth = !rm; if (rf !== null) t.freezeAuth = !rf; }
    if (String(it.burn_status || '').toLowerCase() === 'burn') t.lpLocked = true;
  }
  G.norm = function (chain, it, kind, interval) {
    if (!it || !it.address) return null;
    var addr = chain === 'robinhood' ? String(it.address).toLowerCase() : String(it.address);
    var now = U.now(), pad = String(it.launchpad_platform || it.launchpad || '');
    var t = { chain: chain, address: addr };
    if (it.name) t.name = String(it.name); if (it.symbol) t.symbol = String(it.symbol);
    var logo = it.logo || it.image || it.icon; if (logo && typeof logo === 'string') t.logo = logo;
    var created = secs(it.created_timestamp || it.creation_timestamp), opened = secs(it.open_timestamp), completedAt = secs(it.complete_timestamp);
    if (created) t.createdAt = created; else if (opened && kind !== 'rank') t.createdAt = opened;
    var complete = kind === 'completed' || (kind === 'rank' && !!(opened || completedAt));
    if (complete) { t.complete = true; t.curve = null; if (completedAt || opened) t.graduatedAt = completedAt || opened; }
    else {
      t.complete = false;
      var pr = U.num(it.progress != null ? it.progress : it.launchpad_progress != null ? it.launchpad_progress : it.bonding_curve_progress);
      if (pr !== null) t.curve = U.clamp(pr > 1.0001 ? pr / 100 : pr, 0, 0.999);
    }
    var mc = n0(it.usd_market_cap != null ? it.usd_market_cap : it.market_cap); if (mc !== undefined) { t.mc = mc; t.capSrc = 'GMGN'; }
    var tsup = n0(it.total_supply); if (tsup) t.supply = tsup;
    var liq = n0(it.liquidity); if (liq !== undefined) t.liq = liq;
    var price = n0(it.price); if (price !== undefined) t.price = price;
    var hold = n0(it.holder_count); if (hold !== undefined) { t.holders = hold; t.holdersSrc = 'gmgn'; }
    if (chain === 'solana' && !complete && t.curve === undefined && U.isNum(t.mc) && TL.pumpCurveFromMc) { var c = TL.pumpCurveFromMc(t.mc); if (c != null) t.curve = U.clamp(c, 0, 0.999); }
    var vol = {}, tx = {}, chg = {};
    if (kind === 'rank') {
      var wk = { '5m': 'm5', '1h': 'h1', '6h': 'h6', '24h': 'h24' }[interval];
      if (wk) {
        var v = n0(it.volume); if (v !== undefined) vol[wk] = v;
        var b = U.num(it.buys), s = U.num(it.sells); if (b !== null || s !== null) tx[wk] = { b: b || 0, s: s || 0 };
        var pc = n0(it.price_change_percent); if (pc !== undefined) chg[wk] = pc;
      }
    } else {
      var v1 = n0(it.volume_1h), v24 = n0(it.volume_24h); if (v1 !== undefined) vol.h1 = v1; if (v24 !== undefined) vol.h24 = v24;
      var b24 = U.num(it.buys_24h), s24 = U.num(it.sells_24h);
      if (b24 !== null || s24 !== null) tx.h24 = { b: b24 || 0, s: s24 || 0 };
      var sw1 = U.num(it.swaps_1h);
      if (sw1 !== null) { var tot = (b24 || 0) + (s24 || 0); var bb = Math.round(sw1 * (tot > 0 ? (b24 || 0) / tot : 0.5)); tx.h1 = { b: bb, s: Math.max(0, sw1 - bb), est: true }; }
      if (U.num(it.swaps_1m) > 0) t.lastTradeAt = now;
    }
    var p5 = n0(it.price_change_percent5m), p1 = n0(it.price_change_percent1h); if (p5 !== undefined) chg.m5 = p5; if (p1 !== undefined && chg.h1 === undefined) chg.h1 = p1;
    if (Object.keys(vol).length) t.vol = vol; if (Object.keys(tx).length) t.tx = tx; if (Object.keys(chg).length) t.chg = chg;
    t.checkedAt = now; t.gmgnAt = now;
    var t10 = share(it.top_10_holder_rate); if (t10 !== undefined) { t.top10 = t10; t.top10Src = 'GMGN'; }
    var rr = share(it.rug_ratio); if (rr !== undefined) t.rugRatio = rr;
    var bun = share(it.bundler_trader_amount_rate != null ? it.bundler_trader_amount_rate : it.bundler_rate); if (bun !== undefined) t.bundlePct = bun;
    var ins = share(it.suspected_insider_hold_rate != null ? it.suspected_insider_hold_rate : it.insider_rate); if (ins !== undefined) t.insiderPct = ins;
    var rat = share(it.rat_trader_amount_rate); if (rat !== undefined) t.ratPct = rat;
    var sn = share(it.top70_sniper_hold_rate); if (sn !== undefined) t.sniperPct = sn;
    var snc = n0(it.sniper_count); if (snc !== undefined) t.sniperCount = snc;
    var bot = share(it.bot_degen_rate); if (bot !== undefined) t.botRate = bot;
    var fr = share(it.fresh_wallet_rate); if (fr !== undefined) t.freshRate = fr;
    var wash = yes(it.is_wash_trading); if (wash !== null) t.wash = wash;
    if (chain !== 'solana') { var hp = yes(it.is_honeypot); if (hp !== null) t.honeypot = hp; }
    var tax = Math.max(n0(it.buy_tax) || 0, n0(it.sell_tax) || 0); if (tax > 0 && tax < 1) t.tax = tax;
    var dev = {};
    var cr = it.creator || it.creator_address || it.dev_address; if (cr) dev.address = chain === 'robinhood' ? String(cr).toLowerCase() : String(cr);
    var dp = share(it.creator_balance_rate); if (dp === undefined) dp = share(it.dev_team_hold_rate); if (dp !== undefined) dev.pct = dp;
    var cst = String(it.creator_token_status || (yes(it.creator_close) ? 'creator_close' : '')).toLowerCase();
    if (/close|sell/.test(cst)) dev.sold = true; else if (/hold/.test(cst)) dev.sold = false;
    var dl = n0(it.creator_created_count); if (dl !== undefined) dev.launches = dl;
    var dg = n0(it.creator_created_open_count); if (dg !== undefined) dev.graduated = dg;
    if (Object.keys(dev).length) t.dev = dev;
    var soc = {}, xu = xUrl(it.twitter || it.twitter_username); if (xu) soc.x = xu; var tg = webUrl(it.telegram); if (tg) soc.tg = tg; var web = webUrl(it.website); if (web) soc.web = web;
    var ig = webUrl(it.instagram); if (ig) soc.ig = ig; var tt = webUrl(it.tiktok); if (tt) soc.tt = tt;
    if (Object.keys(soc).length) t.socials = soc;
    var xf = n0(it.x_user_follower); if (xf !== undefined) t.xFollowers = xf;
    var sm = n0(it.smart_degen_count), kl = n0(it.renowned_count); if (sm !== undefined || kl !== undefined) t.smart = { wallets: sm || 0, kols: kl || 0, src: 'gmgn' };
    var cto = yes(it.cto_flag); if (cto !== null) t.cto = cto;
    if (yes(it.dexscr_ad) || yes(it.dexscr_update_link) || yes(it.dexscr_trending_bar) || U.num(it.dexscr_boost_fee) > 0) t.dexPaid = true;
    var hl = n0(it.hot_level); if (hl !== undefined) t.hot = hl;
    t.gmgnPad = pad; var lp = padOf(chain, pad, addr); if (lp) t.launchpad = lp;
    if (it.exchange) t.exchange = String(it.exchange);
    rights(t, chain, it);
    t.source = { meta: 'GMGN' };
    return t;
  };
  function trustedPad(chain, t) {
    if (chain === 'solana') return t.launchpad === 'pump.fun';
    return t.launchpad === 'pons' || !!(S.hood && S.hood.launches && S.hood.launches[t.address]);
  }
  G.trustedPad = trustedPad;
  function put(t) {
    var id = t.chain + ':' + t.address, ex = store.get(id), now = U.now();
    var had = !!(ex && ex.ready && TL.checked(ex));
    if (ex && ex.curveAt && now - ex.curveAt < 60 * TL.SEC && !ex.complete && !t.complete) { delete t.mc; delete t.curve; delete t.price; } // the on-chain curve read is exact
    if (t.dev && t.dev.sold === true && ex && U.isNum(ex.devInit) && ex.devInit < 0.005) delete t.dev.sold; // the stream saw no dev buy: a closed position is "never held", not a dump
    if (ex && ex.jupAt && now - ex.jupAt < 90 * TL.SEC && t.tx && t.tx.h1 && t.tx.h1.est) delete t.tx.h1; // Jupiter's exact hourly buys and sells beat an estimate from 24h shares
    var tok = store.upsert(t);
    if (!had && tok.ready && store._booted && TL.ui && TL.ui.offer) TL.ui.offer(tok);
    return tok;
  }
  G.put = put;

  // ---------- feeds ----------
  var QUOTE_TYPES = { sol: [4, 5, 3, 1, 13, 0], robinhood: [11, 20, 24, 12, 0] };
  G.pollTrenches = function (chain, prio) {
    var slug = G.slug(chain);
    var sec = { filters: ['offchain', 'onchain'], launchpad_platform_v2: true, limit: 80, quote_address_type: QUOTE_TYPES[slug] };
    if (chain === 'solana' && G.padFilter !== false) sec.launchpad_platform = G.PUMP_PADS.slice(); // pump.fun and its modes only; Robinhood keeps GMGN's default list and Pons is picked here
    var body = { version: 'v2', new_creation: sec, near_completion: sec, completed: sec };
    return G.request('POST', '/v1/trenches', { chain: slug }, body, W.trenches, { prio: prio == null ? 2 : prio, ttl: 15000, key: 'trenches:' + chain }).then(function (d) {
      d = d || {}; var now = U.now(), n = 0, dropped = 0, counts = { new_creation: 0, near_completion: 0, completed: 0 }, pads = {};
      [['new_creation', d.new_creation], ['near_completion', d.pump || d.near_completion], ['completed', d.completed]].forEach(function (pair) {
        (Array.isArray(pair[1]) ? pair[1] : []).forEach(function (it) {
          var t = G.norm(chain, it, pair[0]); if (!t) return;
          var pk = t.gmgnPad || '(none)'; pads[pk] = (pads[pk] || 0) + 1;
          if (!trustedPad(chain, t)) { dropped++; return; }
          t.gmgnSeenAt = now; t.gmgnList = pair[0]; put(t); n++; counts[pair[0]]++;
        });
      });
      G.pads[chain] = pads;
      var total = n + dropped;
      if (chain === 'solana' && sec.launchpad_platform) {
        G.emptyPads = total ? 0 : G.emptyPads + 1;
        if (G.emptyPads >= 3) { G.padFilter = false; G.padFilterOffAt = now; last['trenches:solana'] = 0; } // three empty answers to the pump.fun filter: ask with GMGN's default list and pick pump.fun here
      } else if (chain === 'solana' && G.padFilter === false && now - (G.padFilterOffAt || 0) > 10 * TL.MIN) { G.padFilter = true; G.emptyPads = 0; } // try the filter again later
      G.stat[chain] = { n: n, dropped: dropped, at: now, counts: counts };
      if (n) { store.chainMode[chain] = 'live'; if (store.mode === 'offline') store.mode = 'live'; }
      emit();
      return n;
    });
  };
  TL.TOP_MIN_MC = TL.TOP_MIN_MC || { solana: 1e6, robinhood: 3e5 };
  var NOT_MEME = /xstock|stocks?\b|tokeni[sz]ed|wrapped|bridged|\busd|vault|treasury|\betf\b|\bfund\b/i;
  G.pollTop = function (chain, days, prio) {
    var slug = G.slug(chain); days = days || 30; var reqAt = U.now();
    var q = { chain: slug, interval: '24h', limit: 100, order_by: 'volume', direction: 'desc', min_created: '1d', max_created: days + 'd', min_marketcap: TL.TOP_MIN_MC[chain] };
    return G.request('GET', '/v1/market/rank', q, null, W.rank, { prio: prio == null ? 4 : prio, ttl: 30000, key: 'top:' + chain + ':' + days }).then(function (d) {
      var list = Array.isArray(d) ? d : (d && (d.rank || d.list || d.tokens)) || [];
      var now = U.now(), seen = {}, n = 0;
      list.forEach(function (it) {
        if (!it || NOT_MEME.test(String(it.launchpad_platform || '')) || (NOT_MEME.test(String(it.name || '') + ' ' + String(it.symbol || '')) && !/pump$/.test(String(it.address || '')))) return;
        var t = G.norm(chain, it, 'rank', '24h'); if (!t || !U.isNum(t.mc) || t.mc < TL.TOP_MIN_MC[chain]) return;
        var born = t.createdAt; if (!U.isNum(born) || now - born < TL.TOP_MIN_AGE || now - born > days * TL.DAY + TL.HR) return;
        t.top = true; t.topAt = now; t.topSrc = 'gmgn'; t.gmgnSeenAt = now; t.complete = true; t.curve = null;
        seen[t.address] = 1; put(t); n++;
      });
      if (list.length) store.all().forEach(function (o) { // fell out of the top 100 or under the cap: no longer Top for this window
        if (o.chain !== chain || !o.top || o.demo || seen[o.address] || (o.topAt || 0) >= reqAt) return;
        if (!U.isNum(o.createdAt) || now - o.createdAt <= days * TL.DAY) o.top = false;
      });
      store._rev = (store._rev || 0) + 1; G.topAt[chain] = now; emit();
      return n;
    });
  };
  // the most traded tokens of the last day: keeps Migrated rows fresh after they leave the 80 latest migrations
  G.pollHot = function (chain) {
    var q = { chain: G.slug(chain), interval: '1h', limit: 100, order_by: 'volume', direction: 'desc', max_created: '1d' };
    return G.request('GET', '/v1/market/rank', q, null, W.rank, { prio: 6, ttl: 30000, key: 'hot:' + chain }).then(function (d) {
      var list = Array.isArray(d) ? d : (d && (d.rank || d.list)) || []; var now = U.now(), n = 0;
      list.forEach(function (it) { var t = G.norm(chain, it, 'rank', '1h'); if (!t || !trustedPad(chain, t)) return; t.gmgnSeenAt = now; put(t); n++; });
      return n;
    });
  };

  // ---------- token page ----------
  var TAG_LABEL = { smart_degen: 'Smart money', smart_money: 'Smart money', renowned: 'KOL', kol: 'KOL', sniper: 'Sniper', bundler: 'Bundler', rat_trader: 'Insider', insider: 'Insider', fresh_wallet: 'Fresh wallet', dev: 'Dev', dev_team: 'Dev team', creator: 'Dev', whale: 'Whale', transfer_in: 'Got a transfer', dex_bot: 'Bot', bot: 'Bot', bluechip_owner: 'Bluechip holder', top_holder: 'Top holder', paper_hands: 'Paper hands', diamond_hands: 'Diamond hands' };
  G.TAG_LABEL = TAG_LABEL;
  G.tagsOf = function (h) {
    var raw = [].concat(h.maker_token_tags || [], h.tags || [], h.wallet_tag_v2 ? [h.wallet_tag_v2] : []);
    var out = []; raw.forEach(function (x) { var k = String(x || '').toLowerCase(); var l = TAG_LABEL[k]; if (l && out.indexOf(l) < 0) out.push(l); });
    return out;
  };
  function applyInfo(chain, address, d) {
    if (!d || !d.address) return null;
    var now = U.now(), p = { chain: chain, address: address }, pr = d.price || {};
    if (d.name) p.name = String(d.name); if (d.symbol) p.symbol = String(d.symbol); if (d.logo) p.logo = d.logo;
    var price = n0(typeof pr === 'object' ? pr.price : pr); if (price !== undefined) p.price = price;
    var supply = n0(d.total_supply) || n0(d.circulating_supply); // the full supply: a memecoin has no vesting, and while it is on the curve the circulating figure is a fraction of it
    if (supply) p.supply = supply;
    if (price !== undefined && supply) { p.mc = price * supply; p.fdv = p.mc; p.capSrc = 'GMGN price \u00d7 ' + TL.supplyTxt(supply) + ' supply'; }
    var liq = n0(d.liquidity); if (liq !== undefined) p.liq = liq;
    var h = n0(d.holder_count); if (h !== undefined) { p.holders = h; p.holdersSrc = 'gmgn'; }
    var created = secs(d.creation_timestamp); if (created) p.createdAt = created;
    var ls = U.num(d.launchpad_status), opened = secs(d.open_timestamp);
    if (ls === 2 || (ls === null && d.migrated_pool && opened)) { p.complete = true; p.curve = null; if (opened) p.graduatedAt = opened; }
    else if (ls === 0 || ls === 1) { p.complete = false; var lpg = U.num(d.launchpad_progress); if (lpg !== null) p.curve = U.clamp(lpg > 1.0001 ? lpg / 100 : lpg, 0, 0.999); }
    var vol = {}, tx = {}, chg = {};
    [['5m', 'm5'], ['1h', 'h1'], ['6h', 'h6'], ['24h', 'h24']].forEach(function (w) {
      var v = n0(pr['volume_' + w[0]]); if (v !== undefined) vol[w[1]] = v;
      var b = U.num(pr['buys_' + w[0]]), s = U.num(pr['sells_' + w[0]]); if (b !== null || s !== null) tx[w[1]] = { b: b || 0, s: s || 0 };
      var p0 = n0(pr['price_' + w[0]]); if (p0 && price !== undefined) chg[w[1]] = (price / p0 - 1) * 100;
    });
    if (Object.keys(vol).length) p.vol = vol; if (Object.keys(tx).length) p.tx = tx; if (Object.keys(chg).length) p.chg = chg;
    var dev = d.dev || {}, stat = d.stat || {}, link = d.link || {}, tags = d.wallet_tags_stat || {};
    var dv = {};
    if (dev.creator_address) dv.address = chain === 'robinhood' ? String(dev.creator_address).toLowerCase() : String(dev.creator_address);
    var chr = share(stat.creator_hold_rate); if (chr !== undefined) dv.pct = chr;
    var cts = String(dev.creator_token_status || '').toLowerCase(); if (/sell|close/.test(cts)) dv.sold = true; else if (/hold/.test(cts)) dv.sold = false;
    var col = n0(dev.creator_open_count); if (col !== undefined) dv.launches = col;
    if (Object.keys(dv).length) p.dev = dv;
    if (dev.fund_from) p.devFundFrom = String(dev.fund_from);
    var ath = dev.ath_token_info; if (ath && (ath.ath_mc || ath.symbol)) p.devAth = { symbol: ath.symbol || '', name: ath.name || '', mc: n0(ath.ath_mc), address: ath.ath_token || '' };
    var cto = yes(dev.cto_flag); if (cto !== null) p.cto = cto;
    if (yes(dev.dexscr_ad) || yes(dev.dexscr_update_link) || yes(dev.dexscr_boost_fee) || yes(dev.dexscr_trending_bar)) p.dexPaid = true;
    var soc = {}, xu = xUrl(link.twitter_username); if (xu) soc.x = xu; var web = webUrl(link.website); if (web) soc.web = web; var tg = webUrl(link.telegram); if (tg) soc.tg = tg;
    var ig2 = webUrl(link.instagram); if (ig2) soc.ig = ig2; var tt2 = webUrl(link.tiktok); if (tt2) soc.tt = tt2; var dc = webUrl(link.discord); if (dc) soc.dc = dc; var yt = webUrl(link.youtube); if (yt) soc.yt = yt;
    if (Object.keys(soc).length) p.socials = soc; if (link.description) p.description = String(link.description).slice(0, 400);
    var t10 = share(stat.top_10_holder_rate != null ? stat.top_10_holder_rate : dev.top_10_holder_rate); if (t10 !== undefined) { p.top10 = t10; p.top10Src = 'GMGN'; }
    var bun = share(stat.top_bundler_trader_percentage); if (bun !== undefined) p.bundlePct = bun;
    var rat = share(stat.top_rat_trader_percentage); if (rat !== undefined) p.ratPct = rat;
    var bot = share(stat.bot_degen_rate); if (bot !== undefined) p.botRate = bot;
    var fr = share(stat.fresh_wallet_rate); if (fr !== undefined) p.freshRate = fr;
    var vault = share(stat.private_vault_hold_rate); if (vault !== undefined) p.vaultPct = vault;
    var wt = {}; [['smart_wallets', 'smart'], ['renowned_wallets', 'kol'], ['sniper_wallets', 'sniper'], ['rat_trader_wallets', 'insider'], ['bundler_wallets', 'bundler'], ['whale_wallets', 'whale'], ['fresh_wallets', 'fresh'], ['top_wallets', 'top']].forEach(function (k) { var v = n0(tags[k[0]]); if (v !== undefined) wt[k[1]] = v; });
    if (Object.keys(wt).length) { p.walletTags = wt; if (wt.smart !== undefined || wt.kol !== undefined) p.smart = { wallets: wt.smart || 0, kols: wt.kol || 0, src: 'gmgn' }; }
    var athP = n0(d.ath_price); if (athP !== undefined) p.athPrice = athP;
    var lockd = share(d.locked_ratio); if (lockd !== undefined) p.lockedRatio = lockd;
    var pad = String(d.launchpad_platform || d.launchpad || ''); p.gmgnPad = pad; var lp = padOf(chain, pad, address); if (lp) p.launchpad = lp;
    rights(p, chain, d);
    p.checkedAt = now; p.gmgnAt = now; p.gmgnInfoAt = now; p.source = { meta: 'GMGN' };
    return put(p);
  }
  function applySecurity(chain, address, d) {
    if (!d) return;
    var p = { chain: chain, address: address, gmgnSecAt: U.now() };
    if (chain !== 'solana') { var hp = yes(d.is_honeypot); if (hp !== null) p.honeypot = hp; }
    var tax = Math.max(n0(d.buy_tax) || 0, n0(d.sell_tax) || 0); if (tax > 0 && tax < 1) p.tax = tax;
    var rr = share(d.rug_ratio); if (rr !== undefined) p.rugRatio = rr;
    var wash = yes(d.is_wash_trading); if (wash !== null) p.wash = wash;
    var snc = n0(d.sniper_count); if (snc !== undefined) p.sniperCount = snc;
    var ins = share(d.suspected_insider_hold_rate); if (ins !== undefined) p.insiderPct = ins;
    var rat = share(d.rat_trader_amount_rate); if (rat !== undefined) p.ratPct = rat;
    var bun = share(d.bundler_trader_amount_rate); if (bun !== undefined) p.bundlePct = bun;
    var t10 = share(d.top_10_holder_rate); if (t10 !== undefined) { p.top10 = t10; p.top10Src = 'GMGN'; }
    var dv = {}, cb = share(d.creator_balance_rate); if (cb !== undefined) dv.pct = cb;
    var cts = String(d.creator_token_status || '').toLowerCase(); if (/close|sell/.test(cts)) dv.sold = true; else if (/hold/.test(cts)) dv.sold = false;
    if (Object.keys(dv).length) p.dev = dv;
    var ex = store.get(chain + ':' + address) || {};
    if (ex.launchpad !== 'pump.fun' && ex.launchpad !== 'pons') rights(p, chain, d);
    if (chain !== 'solana') { var os = String(d.open_source || '').toLowerCase(), or = String(d.owner_renounced || '').toLowerCase(); if (os === 'yes' || os === 'no') p.openSource = os === 'yes'; if (or === 'yes' || or === 'no') p.ownerRenounced = or === 'yes'; }
    put(p);
  }
  function applyHolders(chain, address, d) {
    var list = Array.isArray(d) ? d : (d && (d.list || d.holders)) || []; if (!list.length) return;
    var ex = store.get(chain + ':' + address) || {}; var dev = String(ex.dev && ex.dev.address || '').toLowerCase();
    var rows = list.slice(0, 20).map(function (h) {
      var a = String(h.address || ''); var tags = G.tagsOf(h);
      if (dev && a.toLowerCase() === dev && tags.indexOf('Dev') < 0) tags.unshift('Dev');
      var pool = U.num(h.addr_type) === 2 || !!h.exchange; if (pool) tags.unshift(h.exchange ? String(h.exchange).replace(/_/g, ' ') : 'Pool');
      return { address: a, pct: share(h.amount_percentage), tag: tags[0] || '', tags: tags, name: h.name || h.twitter_name || '', avatar: h.avatar || '', twitter: h.twitter_username || '', usd: n0(h.usd_value), profit: n0(h.profit), pool: pool };
    });
    store.upsert({ chain: chain, address: address, topHolders: rows, gmgnHoldersAt: U.now(), source: { holders: 'GMGN' } });
  }
  // v1.42: the risk record alone (info + security, 2 weight): what a call needs to know before it is made
  G.pollRisk = function (t) {
    if (!t || t.demo || t.partial) return Promise.resolve(t);
    var chain = t.chain, address = t.address, q = { chain: G.slug(chain), address: address };
    return Promise.all([
      G.request('GET', '/v1/token/info', q, null, W.info, { prio: 1, ttl: 20000, key: 'info:' + t.id }).then(function (d) { applyInfo(chain, address, d); }).catch(function () { return null; }),
      G.request('GET', '/v1/token/security', q, null, W.security, { prio: 1, ttl: 30000, key: 'sec:' + t.id }).then(function (d) { applySecurity(chain, address, d); }).catch(function () { return null; })
    ]).then(function () { var tk = store.get(t.id); if (tk) { if (!tk.gmgnSecAt) tk.gmgnSecAt = U.now(); TL.vet(tk); } return tk; }); // asked once even when GMGN has no record for it yet
  };
  G.pollToken = function (t, full) {
    if (!t || t.demo || t.partial) return Promise.resolve(t);
    var chain = t.chain, address = t.address, slug = G.slug(chain), q = { chain: slug, address: address }, jobs = [];
    jobs.push(G.request('GET', '/v1/token/info', q, null, W.info, { prio: 1, ttl: 20000, key: 'info:' + t.id }).then(function (d) { applyInfo(chain, address, d); }));
    if (full) {
      jobs.push(G.request('GET', '/v1/token/security', q, null, W.security, { prio: 1, ttl: 30000, key: 'sec:' + t.id }).then(function (d) { applySecurity(chain, address, d); }));
      jobs.push(G.request('GET', '/v1/market/token_top_holders', { chain: slug, address: address, limit: 20, order_by: 'amount_percentage', direction: 'desc' }, null, W.holders, { prio: 3, ttl: 60000, key: 'holders:' + t.id }).then(function (d) { applyHolders(chain, address, d); }));
    }
    return Promise.all(jobs.map(function (j) { return j.catch(function () { return null; }); })).then(function () { var tk = store.get(t.id); if (tk) TL.vet(tk); return tk; });
  };

  // ---------- wallets (Smart Tracking) ----------
  function listOf(d, key) { return Array.isArray(d) ? d : (d && (d[key] || d.list)) || []; }
  G.trades = function (chain, kind) { // kind: smartmoney | kol
    return G.request('GET', '/v1/user/' + kind, { chain: G.slug(chain), limit: 200 }, null, W[kind] || 1, { prio: 3, ttl: 60000, key: kind + ':' + chain }).then(function (d) { return listOf(d, 'list'); });
  };
  G.topTraders = function (chain, address, limit) {
    return G.request('GET', '/v1/market/token_top_traders', { chain: G.slug(chain), address: address, limit: limit || 100, order_by: 'profit', direction: 'desc' }, null, W.traders, { prio: 3, ttl: 60000, key: 'traders:' + chain + ':' + address }).then(function (d) { return listOf(d, 'list'); });
  };
  // v1.41: checked against the live API on 22 Sep 2026: wallet_stats answers ONE wallet per request (a repeated parameter is read once,
  // a comma list is refused), so a record costs 3 weight each and is asked for the wallets worth it only. wallet_profits is the cheap
  // screen: one POST reads the 30-day (or 7-day) money of up to 100 wallets for the same 3 weight.
  var normAddr = function (chain, a) { return chain === 'robinhood' ? String(a).toLowerCase() : String(a); };
  G.walletStat = function (chain, addr, period) {
    period = period || '7d';
    return G.request('GET', '/v1/user/wallet_stats', { chain: G.slug(chain), wallet_address: addr, period: period }, null, W.stats, { prio: 4, ttl: 120000, key: 'stat:' + chain + ':' + addr + ':' + period }).then(function (d) {
      var x = Array.isArray(d) ? d[0] : d && Array.isArray(d.list) ? d.list[0] : d;
      return x && typeof x === 'object' ? x : null;
    });
  };
  G.walletStats = function (chain, addrs, period) { // several wallets: one request each, answered as a map; a failed one is simply absent
    var out = {};
    return Promise.all((addrs || []).map(function (a) {
      return G.walletStat(chain, a, period).then(function (x) { if (x) out[normAddr(chain, a)] = x; }, function () {});
    })).then(function () { return out; });
  };
  G.walletProfits = function (chain, addrs, period) {
    var out = {}, list = (addrs || []).slice(), chunks = [];
    while (list.length) chunks.push(list.splice(0, 100));
    return Promise.all(chunks.map(function (ch) {
      return G.request('POST', '/v1/user/wallet_profits', {}, { chain: G.slug(chain), period: period || '30d', wallet_addresses: ch }, W.profits, { prio: 4, ttl: 60000 }).then(function (d) {
        var arr = Array.isArray(d) ? d : d && Array.isArray(d.list) ? d.list : [];
        arr.forEach(function (x) { var a = x && (x.wallet_address || x.address); if (a) out[normAddr(chain, a)] = x; });
      }, function () {});
    })).then(function () { return out; });
  };
  // the money line of a wallet_profits row, in the shape readStats uses for the same numbers
  G.readProfit = function (x) {
    if (!x || typeof x !== 'object') return null;
    var f = function (v) { var n = U.num(v); return n === null ? 0 : n; };
    var realized = f(x.realized_profit != null ? x.realized_profit : x.total_realized_profit), cost = f(x.total_cost);
    var rcost = f(x.realized_profit_cost != null ? x.realized_profit_cost : x.total_realized_profit_cost);
    return { realized: realized, unrealized: f(x.unrealized_profit), total: f(x.total_profit), cost: cost, roi: rcost > 0 ? realized / rcost : (cost > 0 ? realized / cost : null), buys: f(x.buy), sells: f(x.sell), trades: f(x.buy) + f(x.sell) };
  };
  // v1.41: the picture GMGN draws for every address that has no profile picture of its own (its site: sum of the lowercase character
  // codes, modulo 500, plus one; checked 22 Sep 2026). The same face on GMGN and here, for every wallet.
  G.avatarUrl = function (addr) {
    var s = String(addr || '').toLowerCase(); if (!s) return '';
    var sum = 0; for (var i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    return 'https://gmgn.ai/static/avator/' + (sum % 500 + 1) + '.png';
  };
  G.walletActivity = function (chain, addr, limit) {
    return G.request('GET', '/v1/user/wallet_activity', { chain: G.slug(chain), wallet_address: addr, limit: limit || 40 }, null, W.activity, { prio: 2, ttl: 60000, key: 'act:' + chain + ':' + addr }).then(function (d) { return listOf(d, 'activities'); });
  };

  // ---------- scheduler: the feed on screen every few seconds, the other network slowly, nothing while the tab is in the background ----------
  var last = {}, running = {};
  function every(key, ms, fn) {
    var now = U.now(); if (running[key] || now - (last[key] || 0) < ms) return;
    last[key] = now; running[key] = true;
    var done = function () { running[key] = false; };
    try { fn().then(done, done); } catch (e) { done(); }
  }
  G.forget = function (key) { Object.keys(last).forEach(function (k) { if (k.indexOf(key) === 0) last[k] = 0; }); };
  G.tick = function () {
    if (!G.active() || document.hidden) return;
    var st = TL.ui ? TL.ui.state : { net: 'solana', tab: 'trenches', group: 'new', topAge: 30 };
    var page = st.page ? store.get(st.page) : null;
    if (page) every('page:' + page.id, 3000, function () { return G.pollToken(page, !page.gmgnHoldersAt || U.now() - page.gmgnHoldersAt > 60000).then(function () { if (TL.ui && TL.ui.state.page === page.id) TL.ui.renderToken(); }); });
    if (S.lite) return; // a tab opened on one token polls that token only
    var onFeed = st.tab === 'trenches' && !page;
    ['solana', 'robinhood'].forEach(function (chain) {
      var here = onFeed && chain === st.net;
      var k = G.slow || 1; // v1.42: the data service runs at a third of a page's pace, and an off-screen network waits half a minute: one free-plan key feeds everyone
      every('trenches:' + chain, (here ? (chain === 'solana' ? 4000 : 5000) : 30000) * k, function () { return G.pollTrenches(chain, here ? 2 : 6); });
      if (here) every('hot:' + chain, 45000 * k, function () { return G.pollHot(chain); });
      var topHere = here && st.group === 'top';
      every('top:' + chain + ':' + st.topAge, (topHere ? 30000 : 300000) * k, function () { return G.pollTop(chain, st.topAge, topHere ? 3 : 7); });
    });
  };
  G.start = function () { if (G._timer || !G.available()) return; G._timer = setInterval(G.tick, 1000); G.autoProxy(); };
  // boot: the network on screen first, so the feed fills from GMGN in the first second. v1.40: the site's own proxy is asked first,
  // for at most 2.5 s; a slower answer still switches the feeds to GMGN the moment it arrives (setProxy starts the scheduler).
  G.bootCycle = function () {
    var wait = new Promise(function (res) { setTimeout(res, 2500); });
    return Promise.race([G.autoProxy(), wait]).then(function () {
      if (!G.active()) return {};
      var net = TL.ui ? TL.ui.state.net : 'solana';
      last['trenches:' + net] = U.now();
      return G.pollTrenches(net, 1).then(function (n) { var f = {}; f[net] = n > 0; return f; }, function () { return {}; });
    });
  };
  G.emit = emit;
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!document.hidden && G.active()) G.tick(); });
})(window.TL);
