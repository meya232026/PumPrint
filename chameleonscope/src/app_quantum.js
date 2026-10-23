/* |CHAMELEON⟩ v2.20 - the quantum narrative. On 8 Oct 2026 an Ethereum Foundation researcher said Bitcoin's cryptography could fall to
   quantum machines "in months, not years", Solana's foundation answered the same day about its own quantum readiness, and the
   quantum theme became one of the hottest narratives in Solana's memecoin trenches. This module finds the coins riding it.

   A coin is on the narrative when its name or ticker speaks of it: quantum, quant, qubit, Q-Day, post-quantum, superposition,
   entanglement, Schrödinger, Shor (the algorithm a quantum machine would break a wallet's key with), Willow (Google's quantum chip:
   these coins borrow their names from Google Quantum AI's world, QUBIT is its campus dog), Bloch, Planck, decoherence, the quantum
   machines and their makers (Majorana, IonQ, D-Wave, Rigetti). v2.21: "quant" counts too (QUANT, QuantAI, Quant Cat), as a word of its own: Quantico and
   quantity stay out. Words that only look close are left out on purpose: Heisenberg (the TV chemist), Photon (a trading terminal).

   Two ways in: every coin the terminal already watches (launches, the lists, GMGN's trenches), and Jupiter's search for the narrative's
   words every few minutes on Solana, which finds the ones the feeds have not met yet. Every coin then passes the same gate as the feed
   (no rug signs, no AVOID), shows with its picture or not at all, and the hottest go first: the money through it in the last hour, the
   last five minutes counted four times. TL.quantum.list(chain) is what the Quantum radar at the top of the terminal shows,
   TL.quantum.index(chain) the narrative's last hour above it, TL.quantum.teaser() what the portal shows before anyone signs in. */
(function (TL) {
  'use strict';
  var U = TL.util, store = TL.store;
  var Q = TL.quantum = { at: 0, busy: false, everyMs: 3 * TL.MIN, n: 0, asked: 0, found: 0, err: '', started: false };
  // "quant" as a word of its own: QUANT, $QUANT, Quant Cat, QuantTrade, BigQuant, QuantAI; never Quantico, quantity or Quantel
  function quantWord(s) {
    var words = String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/);
    for (var i = 0; i < words.length; i++) if (/^quants?$|^quant(?:ai|x|gpt|bot|coin|fi|labs?|agents?|cat|dog|pepe|doge|inu)$/.test(words[i].toLowerCase())) return true;
    return false;
  }
  // the words, each with the label a card shows; first match wins
  var WORDS = [
    [/post[\s_-]?quantum|\bpqc\b/i, 'post-quantum'],
    [/quantum/i, 'quantum'],
    [quantWord, 'quant'],
    [/qu?bits?\b|\bq[\s_-]?bit/i, 'qubit'],
    [/\bq[\s_-]?day\b/i, 'Q-Day'],
    [/superposi/i, 'superposition'],
    [/entangl/i, 'entanglement'],
    [/schr(?:o|ö|oe)dinger/i, 'Schrödinger'],
    [/\bshor(?:'?s)?\b/i, 'Shor\'s algorithm'],
    [/\bwillow\b/i, 'Willow chip'],
    [/\bbloch\b/i, 'Bloch sphere'],
    [/\bplanck\b/i, 'Planck'],
    [/decoheren/i, 'decoherence'],
    [/wave[\s_-]?function/i, 'wavefunction'],
    [/majorana/i, 'Majorana'],
    [/\bionq\b|\bd[\s_-]?wave\b|rigetti/i, 'quantum maker'],
    [/\bqcat\b/i, 'quantum cat']
  ];
  function hit(test, s) { return typeof test === 'function' ? test(s) : test.test(s); }
  // the words Jupiter is asked for, in this order: the first three are the portal's, the rest come round two or three at a time
  Q.SEARCH = ['quantum', 'qubit', 'quant', 'qday', 'superposition', 'entangled', 'schrodinger', 'post-quantum', 'willow', 'quantum ai'];
  // the word a coin is on the narrative by, or null
  Q.match = function (t) {
    if (!t) return null;
    if (t._qText !== (t.name || '') + '|' + (t.symbol || '')) { // the name can arrive late: matched again when it changes
      t._qText = (t.name || '') + '|' + (t.symbol || ''); t._qWord = null;
      for (var i = 0; i < WORDS.length; i++) if (hit(WORDS[i][0], t.name || '') || hit(WORDS[i][0], t.symbol || '')) { t._qWord = WORDS[i][1]; break; }
    }
    return t._qWord;
  };
  // the money through it: the last hour, the last five minutes counted four times (a coin heating up right now goes first)
  Q.heat = function (t) {
    var v = (t && t.vol) || {}, h1 = U.isNum(v.h1) ? v.h1 : 0, m5 = U.isNum(v.m5) ? v.m5 : 0;
    return h1 + 4 * m5;
  };
  // where a narrative coin may come from: the feed's launchpads (pump.fun, Pons), and on Solana any launchpad or pool Jupiter knows,
  // because a narrative does not launch in one place. The rug gate is the same for all of them. The Quantum filter in the feed asks this too
  Q.trusted = function (t) { return !!t && (TL.trusted(t) || (t.chain === 'solana' && !!(t.launchpad || t.pair))); };
  function eligible(t, chain) {
    if (!t || t.chain !== chain || t.demo || t.partial || !t.ready) return false;
    if (!Q.match(t)) return false;
    if (!TL.checked(t)) return false;                                        // its risks are read first, as in the feed
    if (!Q.trusted(t)) return false;
    TL.ensureVet(t); if (!t._ok) return false;                               // the feed's gate: no rug signs, no AVOID
    return Q.heat(t) > 0 || (U.isNum(t.mc) && t.mc >= 20000);               // something is happening in it
  }
  // the coins on the narrative on a chain, hottest first (kept for a second: the radar, its index and the filter's count ask together)
  var allCache = {};
  Q.all = function (chain) {
    var c = allCache[chain], now = U.now();
    if (c && c.rev === store._rev && now - c.at < 1000) return c.list;
    var list = store.all().filter(function (t) { return eligible(t, chain); }).sort(function (a, b) { return Q.heat(b) - Q.heat(a) || (b.mc || 0) - (a.mc || 0); });
    allCache[chain] = { rev: store._rev, at: now, list: list };
    return list;
  };
  Q.list = function (chain, max) {
    var all = Q.all(chain), out = [], P = TL.pics;
    for (var i = 0; i < all.length && out.length < (max || 12); i++) {
      if (!P || P.has(all[i])) out.push(all[i]); else P.want(all[i], i < 12); // a card comes with its picture or waits for it
    }
    return out;
  };
  Q.count = function (chain) { return Q.all(chain).length; };
  // v2.21: the narrative's last hour, for the top of the terminal: the money through every coin on it, how the narrative moved (the
  // coins' 1h change, each weighed by the money through it), how many are up, how many were born in the last hour, the hottest and the
  // best of the hour
  Q.index = function (chain) {
    var all = Q.all(chain), now = U.now(), w = 0, ws = 0;
    var r = { n: all.length, vol1h: 0, vol5m: 0, chg1h: null, up: 0, withChg: 0, fresh: 0, leader: all[0] || null, best: null };
    all.forEach(function (t) {
      var v = t.vol || {}, v1 = U.isNum(v.h1) ? v.h1 : 0, c = t.chg && t.chg.h1;
      r.vol1h += v1; r.vol5m += U.isNum(v.m5) ? v.m5 : 0;
      if (U.isNum(c)) { r.withChg++; if (c > 0) r.up++; ws += c * Math.max(v1, 1); w += Math.max(v1, 1); if (!r.best || c > r.best.chg.h1) r.best = t; }
      if (U.isNum(t.createdAt) && now - t.createdAt < 3600000) r.fresh++;
    });
    if (w) r.chg1h = ws / w;
    return r;
  };

  // ---------- v2.21: the narrative on the portal, before anyone signs in ----------
  // The engine does not run yet (the gate keeps it off), so the portal asks Jupiter itself: three words, once per visit, from the
  // visitor's own browser; nothing is stored and no server of ours is asked. A coin shows (in superposition: its picture blurred, its
  // numbers hidden) when its name is on the narrative, money went through it in the last hour, it has a picture, and Jupiter's own record
  // shows none of the loud rug signs: flagged as suspicious, mint or freeze authority live, the top 10 holding over 35%, the dev over 12%,
  // a pool under $5K, under 50 holders. The full gate runs on every coin once the terminal opens: the records are handed to it then.
  Q.teaserRaw = [];
  Q.teaser = function () {
    if (Q._teaser) return Q._teaser;
    var C = TL.CONFIG;
    if (!C || !C.jup || typeof fetch !== 'function') return (Q._teaser = Promise.resolve([]));
    Q._teaser = Promise.all(Q.SEARCH.slice(0, 3).map(function (w) { return U.timeoutFetch(C.jup + '/tokens/v2/search?query=' + encodeURIComponent(w), 8000).catch(function () { return []; }); })).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (l) {
        (Array.isArray(l) ? l : []).slice(0, 40).forEach(function (x) {
          if (!x || !x.id || seen[x.id]) return; seen[x.id] = 1; Q.teaserRaw.push(x);
          var c = teaserCoin(x); if (c) out.push(c);
        });
      });
      return out.sort(function (a, b) { return b.heat - a.heat; });
    }, function () { return []; });
    return Q._teaser;
  };
  function teaserCoin(x) {
    var w = Q.match({ name: x.name || '', symbol: x.symbol || '' }); if (!w) return null;
    var a = x.audit || {};
    if (a.isSus === true || a.mintAuthorityDisabled === false || a.freezeAuthorityDisabled === false) return null;
    if (U.isNum(a.topHoldersPercentage) && a.topHoldersPercentage > 35) return null;
    if (U.isNum(a.devBalancePercentage) && a.devBalancePercentage > 12) return null;
    if (U.isNum(x.liquidity) && x.liquidity < 5000) return null;
    if (U.isNum(x.holderCount) && x.holderCount < 50) return null;
    var s1 = x.stats1h || {}, s5 = x.stats5m || {};
    var v1 = (s1.buyVolume || 0) + (s1.sellVolume || 0), v5 = (s5.buyVolume || 0) + (s5.sellVolume || 0);
    if (!(v1 > 0) || !x.icon) return null;
    return { id: 'solana:' + x.id, chain: 'solana', address: x.id, symbol: x.symbol || '', name: x.name || '', word: w, logo: x.icon, heat: v1 + 4 * v5 };
  }
  // the portal's records join the terminal's store the moment it opens: the radar is full at once, and its first search goes on to the
  // next words instead of asking the same three again
  var handed = false;
  function handOff() {
    if (handed || !Q.teaserRaw.length || !TL.sources || !TL.sources.ingestJup) return;
    handed = true; var raw = Q.teaserRaw; Q.teaserRaw = [];
    TL.sources.ingestJup(raw); if (turn === 0) turn = 3;
    if (TL.ui && TL.ui.scheduleStrips) TL.ui.scheduleStrips();
  }

  // Jupiter's search, a few words at a time, every few minutes (Solana only: the narrative lives there). The same round refreshes the
  // numbers of the coins already on the radar (one batched call), so the order stays the order of the last few minutes
  var turn = 0;
  Q.scan = function (n) {
    var S = TL.sources;
    if (Q.busy || !S || !S.searchJup || store.mode === 'demo') return Promise.resolve(0);
    Q.busy = true; n = n || 2;
    var words = []; for (var i = 0; i < n; i++) words.push(Q.SEARCH[(turn + i) % Q.SEARCH.length]); turn += n;
    var known = Q.all('solana').slice(0, 24).map(function (t) { return t.address; });
    var jobs = words.map(function (w) { Q.asked++; return S.searchJup(w).catch(function (e) { Q.err = String(e && e.message || e); return []; }); });
    if (known.length && S.enrichJup) jobs.push(S.enrichJup(known).then(function (k) { if (k) store.recompute(); return []; }, function () { return []; }));
    return Promise.all(jobs).then(function (lists) {
      var n2 = 0; lists.forEach(function (l) { (l || []).forEach(function (t) { if (t && Q.match(t)) n2++; }); });
      Q.found += n2; Q.at = U.now(); Q.busy = false; Q.n++;
      if ((n2 || known.length) && TL.ui) { if (TL.ui.scheduleStrips) TL.ui.scheduleStrips(); if (TL.ui.scheduleRender) TL.ui.scheduleRender(); }
      return n2;
    }, function () { Q.busy = false; return 0; });
  };
  Q.start = function () {
    if (Q.started) return; Q.started = true;
    if (Q._teaser) Q._teaser.then(handOff);
    // at the start two rounds of three words, a few seconds apart: six of the ten words in the first seconds; then two every three minutes
    var first = function () { handOff(); Q.scan(3).then(function () { setTimeout(function () { Q.scan(3); }, 4000); }); };
    setTimeout(first, 1200);
    setInterval(function () { if (typeof document === 'undefined' || !document.hidden) Q.scan(2); }, Q.everyMs);
  };
})(window.TL);
