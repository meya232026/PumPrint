/* Chameleon preview: a moving flow of fictional launches, so the feeds behave like GMGN's trenches in the sandbox where no chain is
   reachable. Every token made here is invented (name, address, numbers) and marked demo. The gate treats them like real tokens: rug
   profiles never show, launches nobody buys leave after a few minutes, runners fill their curve and move to Migrated.
   Live mode never runs this file's code. */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store, SEC = TL.SEC, MIN = TL.MIN, HR = TL.HR, DAY = TL.DAY;
  var A = ['Tiny', 'Moon', 'Glass', 'Velvet', 'Rusty', 'Neon', 'Sleepy', 'Brave', 'Lucky', 'Cosmic', 'Paper', 'Quiet', 'Wild', 'Frosty', 'Golden', 'Salty', 'Turbo', 'Pixel', 'Soggy', 'Humble', 'Jolly', 'Mellow', 'Rapid', 'Sunny', 'Stormy', 'Lunar', 'Crispy', 'Fuzzy', 'Hyper', 'Chill', 'Wobbly', 'Grumpy', 'Shiny', 'Dizzy', 'Noble'];
  var N = ['Otter', 'Comet', 'Frog', 'Pickle', 'Badger', 'Lantern', 'Walrus', 'Cactus', 'Noodle', 'Pigeon', 'Rocket', 'Muffin', 'Koala', 'Waffle', 'Beetle', 'Llama', 'Turnip', 'Hamster', 'Pebble', 'Falcon', 'Mango', 'Yeti', 'Donut', 'Panda', 'Gecko', 'Squid', 'Toast', 'Moth', 'Cloud', 'Beaver', 'Goose', 'Snail', 'Parrot', 'Bagel', 'Cricket'];
  var TAIL = ['', '', '', ' Coin', ' Inu', ' AI', ' Club', ' World', ' 2.0', ' Cat', ' Hat', ' Army', ' Season', ' Money', ' King', ' Party'];
  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  var F = TL.demoFlow = { timer: null, list: [], n: 0 };
  function pick(a, r) { return a[Math.floor(r() * a.length)]; }
  function addr(chain, r) { var s = ''; if (chain === 'robinhood') { for (var i = 0; i < 40; i++) s += '0123456789abcdef'[Math.floor(r() * 16)]; return '0x' + s; } for (var j = 0; j < 40; j++) s += B58[Math.floor(r() * B58.length)]; return s + 'pump'; }
  function poisson(l, r) { if (l <= 0) return 0; var L = Math.exp(-Math.min(l, 30)), k = 0, p = 1; do { k++; p *= r(); } while (p > L && k < 60); return k - 1; }
  function curveMc(chain, c) { return chain === 'solana' ? Math.pow(30 + 85 * c, 2) / 32.19 * 100 : 3600 + Math.pow(c, 1.5) * 52000; } // pump.fun constant product at $100 SOL; Pons on a similar scale
  function windows(t, now) {
    var w = { m5: [0, 0, 0], h1: [0, 0, 0], h6: [0, 0, 0] };
    t._b = t._b.filter(function (e) { return now - e[0] <= 6 * HR; });
    t._b.forEach(function (e) { var age = now - e[0]; ['m5', 'h1', 'h6'].forEach(function (k) { if (age <= { m5: 5 * MIN, h1: HR, h6: 6 * HR }[k]) { w[k][0] += e[1]; w[k][1] += e[2]; w[k][2] += e[3]; } }); });
    t.tx = { m5: { b: w.m5[0], s: w.m5[1] }, h1: { b: w.h1[0], s: w.h1[1] }, h6: { b: w.h6[0], s: w.h6[1] }, h24: { b: t._tot[0], s: t._tot[1] } };
    t.vol = { m5: w.m5[2], h1: w.h1[2], h6: w.h6[2], h24: t._tot[2] };
    var past = function (ms) { var h = t._mc; for (var i = h.length - 1; i >= 0; i--) if (now - h[i][0] >= ms) return h[i][1]; return h.length ? h[0][1] : t.mc; };
    t.chg = { m5: (t.mc / past(5 * MIN) - 1) * 100, h1: (t.mc / past(HR) - 1) * 100, h6: (t.mc / past(6 * HR) - 1) * 100, h24: (t.mc / past(DAY) - 1) * 100 };
    if (t._mc.length > 1) t.series = t._mc.slice(-60).map(function (e) { return { t: e[0], c: e[1] / 1e9 }; }); // the sparkline and chart follow the simulated trades
  }
  // one token: its quality decides how long buyers keep coming; a rug profile carries one loud sign the gate catches
  F.make = function (chain, born, r, opts) {
    opts = opts || {};
    var t = TL.blank(chain, addr(chain, r));
    var a = pick(A, r), nn = pick(N, r);
    var tail = pick(TAIL, r); t.name = (r() < 0.7 ? a + ' ' + nn : 'The ' + nn) + tail; t.symbol = (r() < 0.5 ? a.slice(0, 2) + nn.slice(0, 3) : nn.slice(0, 4) + (tail ? tail.trim().charAt(0) : '')).toUpperCase();
    t.demo = true; t.checkedAt = born; t.createdAt = born; t.launchpad = chain === 'solana' ? 'pump.fun' : 'pons'; t.quote = chain === 'solana' ? 'SOL' : 'WETH'; t.tax = chain === 'robinhood' ? 1 : null;
    var q = opts.q != null ? opts.q : Math.pow(r(), 5.5); q = q < 0.55 ? q * 0.5 : q < 0.85 ? 0.3 + (q - 0.55) * 1.3 : 0.7 + (q - 0.85) * 2; // real flow is mostly dust: quality is heavily skewed low
    t._q = q; t._life = q < 0.3 ? (1.5 + r() * 3) * MIN : q < 0.7 ? (8 + r() * 20) * MIN : (40 + r() * 80) * MIN;
    t._rug = opts.rug != null ? opts.rug : r() < 0.12;
    t.curve = 0.004 + r() * 0.01; t.mc = curveMc(chain, t.curve); t.price = t.mc / 1e9; t.fdv = t.mc; t.liq = t.mc * 0.45;
    t.holders = 1; t.holdersSrc = 'gmgn'; t._b = []; t._tot = [0, 0, 0]; t._mc = [[born, t.mc]]; t.mcFirst = t.mc;
    t.mintAuth = false; t.freezeAuth = false; t.lpLocked = true;
    t.dev = { address: 'demo-dev-' + Math.floor(r() * 1e9).toString(36), pct: 0.004 + r() * 0.06, sold: false, launches: 1 + Math.floor(r() * 3), graduated: r() < 0.3 ? 1 : 0, rugs: 0 };
    t.sniperPct = r() * 0.18; t.bundlePct = r() * 0.14; t.insiderPct = r() * 0.12; t.rugRatio = r() * 0.14; t.ratPct = r() * 0.12;
    if (t._rug) { var k = Math.floor(r() * 4); if (k === 0) t.dev.pct = 0.13 + r() * 0.15; else if (k === 1) t.bundlePct = 0.34 + r() * 0.3; else if (k === 2) t.rugRatio = 0.35 + r() * 0.4; else { t.dev.launches = 7 + Math.floor(r() * 30); t.dev.graduated = 0; } }
    t.simulated = { dev: true, sniper: true, bundle: true, insider: true, top10: true, smart: true };
    t.smart = { wallets: q > 0.7 && r() < 0.6 ? 1 + Math.floor(r() * 4) : 0, kols: q > 0.8 && r() < 0.4 ? 1 : 0, flow1h: 0, src: 'demo' };
    t.socials = { x: r() < 0.5 ? 'demo' : null, tg: r() < 0.25 ? 'demo' : null, web: r() < 0.2 ? 'demo' : null };
    t.xFollowers = t.socials.x ? Math.round(Math.pow(r(), 3) * 20000) : null;
    t.replies = 0; t.events = [{ t: born, type: 'launch', tone: '', text: 'Launched on ' + t.launchpad }];
    t.logo = TL.genAvatar(t.address); t.logoOk = t.logo; // the preview has no real pictures, so every fictional launch gets a generated one
    t.source = { core: 'preview flow (fictional)' };
    t._flow = true;
    return t;
  };
  function top10(t) { var base = 0.18 + 5 / Math.max(1, t.holders); return U.clamp(base + (t._rug ? 0.08 : 0), 0.1, 0.96); }
  // one step of trading for a token
  F.step = function (t, now, dt, r) {
    var age = now - t.createdAt;
    var act = t.complete ? t._q * (0.35 + 0.65 * Math.exp(-(now - t.graduatedAt) / (t._life * 2))) : t._q * Math.exp(-age / t._life);
    if (t._rug && age > 4 * MIN) act *= 0.3;
    var scale = dt / (2 * SEC);
    var buys = poisson(act * 3.2 * scale, r), sells = poisson((act * 1.4 + (t._q < 0.3 && age > MIN ? 0.25 : 0.05)) * scale, r);
    if (!buys && !sells) { if (t.complete) { t.mc *= 1 + (r() - 0.52) * 0.004; t.price = t.mc / 1e9; } t._mc.push([now, t.mc]); if (t._mc.length > 400) t._mc.splice(0, 100); windows(t, now); return; }
    var avg = (t.complete ? 60 + r() * 400 : 12 + r() * 90) * (t.chain === 'robinhood' ? 0.7 : 1);
    var vol = (buys + sells) * avg;
    t._b.push([now, buys, sells, vol]); t._tot[0] += buys; t._tot[1] += sells; t._tot[2] += vol; t.lastTradeAt = now;
    t.holders = Math.max(1, t.holders + buys - (sells > buys ? 1 : 0) - (r() < 0.1 ? 1 : 0));
    if (!t.complete) {
      t.curve = U.clamp(t.curve + (buys * (0.002 + t._q * 0.004) - sells * (0.004 + (1 - t._q) * 0.004)) * (t.chain === 'robinhood' ? 1.3 : 1), 0, 0.9995);
      t.mc = curveMc(t.chain, t.curve); t.liq = t.mc * 0.45;
      if (t.curve >= 0.999) { t.complete = true; t.curve = null; t.graduatedAt = now; t.liq = t.mc * 0.24; t.pair = 'demo-pool-' + t.address.slice(0, 8); t.events.push({ t: now, type: 'grad', tone: 'good', text: 'Graduated to ' + (t.chain === 'solana' ? 'PumpSwap' : 'Uniswap v4 (Pons hook)') + ', liquidity locked' }); }
    } else {
      t.mc = U.clamp(t.mc * (1 + (buys - sells * 1.1) * 0.003 * (0.4 + t._q) + (r() - 0.5) * 0.01), 8000, 8e6); t.liq = t.mc * (0.16 + t._q * 0.08);
    }
    t.price = t.mc / 1e9; t.fdv = t.mc; t.top10 = top10(t);
    if (!t.dev.sold && t._q < 0.2 && age > 3 * MIN && r() < 0.01) { t.dev.sold = true; t.dev.pct = 0; }
    if (t.complete && !t.dev.sold && r() < 0.01) { t.dev.sold = true; t.dev.pct = 0; }
    t._mc.push([now, t.mc]); if (t._mc.length > 400) t._mc.splice(0, 100);
    windows(t, now);
    t.checkedAt = now; t._rev = (t._rev || 0) + 1;
  };
  function place(t) { store.tokens[t.id] = t; store.index(t); store._list = null; F.list.push(t); t.ready = true; if (!t.series || t.series.length < 2) t.series = t.top && TL.demoSeries ? TL.demoSeries(t, U.rng(t.address)) : null; }
  // a migrated coin from earlier today, simulated in coarse steps up to now
  function pastRunner(chain, r, now, gradAgo) {
    var born = now - gradAgo - (6 + r() * 40) * MIN;
    var t = F.make(chain, born, r, { q: 0.86 + r() * 0.14, rug: r() < 0.06 });
    t.curve = null; t.complete = true; t.graduatedAt = now - gradAgo; t.holders = Math.round(120 + Math.pow(r(), 2) * 2600);
    t.mc = (chain === 'solana' ? 45000 : 60000) * (0.6 + Math.pow(r(), 3) * 12); t.liq = t.mc * 0.2; t._mc = [[born, curveMc(chain, 0)], [t.graduatedAt, curveMc(chain, 1)]];
    t.pair = 'demo-pool-' + t.address.slice(0, 8); t.events.push({ t: t.graduatedAt, type: 'grad', tone: 'good', text: 'Graduated, liquidity locked' });
    for (var ts = t.graduatedAt; ts < now; ts += Math.max(60 * SEC, gradAgo / 60)) F.step(t, ts, Math.max(60 * SEC, gradAgo / 60) / 12, r);
    if (r() < 0.3) t.dev.sold = true;
    return t;
  }
  // fictional Top coins: a day to five months old, over the cap, still traded
  function topCoin(chain, r, now, i) {
    var ageD = [1.5, 2.5, 4, 6, 9, 13, 18, 24, 33, 45, 62, 80, 110, 150][i % 14] * (0.9 + r() * 0.2);
    var t = F.make(chain, now - ageD * DAY, r, { q: 0.9, rug: false });
    t.top = true; t.topAt = now; t.complete = true; t.curve = null; t.graduatedAt = t.createdAt + (10 + r() * 50) * MIN; t.launchpad = chain === 'solana' ? (r() < 0.8 ? 'pump.fun' : 'letsbonk') : 'pons';
    t.mc = (chain === 'solana' ? 1.1e6 : 3.2e5) * (1 + Math.pow(r(), 2) * 30); t.liq = t.mc * (0.06 + r() * 0.08); t.holders = Math.round(1500 + r() * 30000);
    var v24 = t.mc * (0.05 + r() * 0.5); t._tot = [Math.round(v24 / 180), Math.round(v24 / 210), v24];
    t._b = []; for (var k = 0; k < 12; k++) t._b.push([now - k * 30 * MIN, Math.round(20 + r() * 80), Math.round(15 + r() * 70), v24 / 48 * (0.5 + r())]);
    t._mc = [[now - DAY, t.mc * (0.7 + r() * 0.6)], [now - 6 * HR, t.mc * (0.85 + r() * 0.3)], [now - HR, t.mc * (0.95 + r() * 0.1)]];
    t.dev.pct = 0; t.dev.sold = true; t.smart = { wallets: 3 + Math.floor(r() * 25), kols: Math.floor(r() * 6), flow1h: 0, src: 'demo' }; t.socials = { x: 'demo', tg: r() < 0.6 ? 'demo' : null, web: r() < 0.5 ? 'demo' : null };
    t.xFollowers = Math.round(3000 + r() * 80000); t.rugRatio = r() * 0.05; t.top10 = 0.12 + r() * 0.2;
    windows(t, now); t.series = null; // a months-long price path for the chart, not the three stored points
    return t;
  }
  F.prefill = function () {
    var now = U.now(), r = U.rng('flow-prefill');
    [['solana', 240, 50, 14], ['robinhood', 70, 18, 9]].forEach(function (cfg) {
      var chain = cfg[0];
      for (var i = 0; i < cfg[1]; i++) { // launches from the last hour, each simulated from its birth
        var born = now - Math.pow(r(), 2.2) * 60 * MIN;
        var t = F.make(chain, born, r);
        for (var ts = born + 20 * SEC; ts < now; ts += 20 * SEC) F.step(t, ts, 20 * SEC, r);
        place(t);
      }
      for (var j = 0; j < cfg[2]; j++) place(pastRunner(chain, r, now, (0.1 + Math.pow(r(), 1.5) * 23) * HR));
      for (var k = 0; k < cfg[3]; k++) place(topCoin(chain, r, now, k));
    });
    store._rev = (store._rev || 0) + 1;
  };
  F.start = function () {
    if (F.timer) return;
    F.prefill();
    var last = U.now(), rnd = Math.random;
    F.timer = setInterval(function () {
      var now = U.now(), dt = now - last; last = now; if (document.hidden) return;
      var born = [];
      if (rnd() < 0.9) born.push(F.make('solana', now, rnd));   // about 30 launches a minute on Solana, 10 on Robinhood Chain
      if (rnd() < 0.1) born.push(F.make('solana', now, rnd));
      if (rnd() < 0.33) born.push(F.make('robinhood', now, rnd));
      born.forEach(function (t) { place(t); });
      F.list.forEach(function (t) { if (!t.top && now - (t.graduatedAt || t.createdAt) < 30 * HR) F.step(t, now, dt, rnd); });
      if (F.list.length > 1500) { // forget the oldest launches that nobody bought
        var drop = F.list.filter(function (t) { return !t.complete && now - t.createdAt > 50 * MIN; }).slice(0, F.list.length - 1400);
        drop.forEach(function (t) { store.remove(t.id); }); F.list = F.list.filter(function (t) { return store.tokens[t.id]; });
      }
      store._list = null; store.recompute();
      born.forEach(function (t) { if (TL.ui && TL.ui.offer) TL.ui.offer(t); });
    }, 2 * SEC);
  };
})(window.TL);
