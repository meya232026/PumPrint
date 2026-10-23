/* Chameleon - account (v1.94): who is looking. Sign-in is Phantom and nothing else: the site asks Phantom to connect (one tap in the
   wallet) and learns the wallet's public address. No message to sign, no transaction, no fee, no approval, and no private key ever
   leaves the wallet. There is no account server behind the site: the address is the
   identity in this browser, and the watchlist, the filters and the call journal stay in this browser (localStorage), where they
   survive a reload and a restart. A returning visitor whose Phantom already trusts the site is signed in again without a tap. */
(function (TL) {
  'use strict';
  var U = TL.util;
  var AC = TL.account = { session: null, providers: [], handlers: {} };
  var KEY = 'tl.session1';
  AC.on = function (evt, fn) { (AC.handlers[evt] = AC.handlers[evt] || []).push(fn); return AC; };
  AC.emit = function (evt) { var a = Array.prototype.slice.call(arguments, 1); (AC.handlers[evt] || []).forEach(function (fn) { try { fn.apply(null, a); } catch (e) {} }); };
  AC.configured = function () { return false; }; // no account server: everything stays in this browser
  var ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  // ---------- session: a Phantom address, kept in this browser ----------
  AC.load = function () {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); AC.session = s && s.chain === 'solana' && s.wallet === 'Phantom' && ADDR.test(String(s.address || '')) ? { chain: 'solana', address: String(s.address), wallet: 'Phantom', at: s.at || U.now() } : null; } catch (e) { AC.session = null; }
    return AC.session; // a session of another wallet (MetaMask, Solflare, an older server session of those) is not a Phantom sign-in: gone
  };
  AC.save = function () { try { if (AC.session) localStorage.setItem(KEY, JSON.stringify(AC.session)); else localStorage.removeItem(KEY); } catch (e) {} };
  AC.load();
  AC.signedIn = function () { return !!(AC.session && AC.session.address); };
  AC.premium = function () { return false; }; // nothing on the site is paid for
  AC.access = function () { return AC.signedIn(); };
  AC.short = function () { var a = AC.session && AC.session.address; return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; };

  // ---------- Phantom: never a key, only a public address ----------
  AC.provider = function () {
    try { var w = window, p = w.phantom && w.phantom.solana; if (p && p.isPhantom) return p; if (w.solana && w.solana.isPhantom) return w.solana; } catch (e) {}
    return null;
  };
  AC.detect = function () { var p = AC.provider(); AC.providers = p ? [{ id: 'phantom', chain: 'solana', name: 'Phantom', p: p }] : []; return AC.providers; };
  AC.installUrl = 'https://phantom.com/download';
  AC.mobile = function () { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); };
  // on a phone without the extension: this page opened inside the Phantom app's own browser, where Phantom is there
  AC.openInPhantom = function () { return 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin); };
  function addressOf(r, p) { var pk = (r && r.publicKey) || (p && p.publicKey); var a = pk && pk.toString ? pk.toString() : String(pk || ''); return ADDR.test(a) ? a : ''; }
  AC.signIn = function () {
    var p = AC.provider(); if (!p) return Promise.reject(new Error('Phantom is not in this browser'));
    return Promise.resolve(p.connect()).then(function (r) {
      var a = addressOf(r, p); if (!a) throw new Error('Phantom gave no address');
      AC.session = { chain: 'solana', address: a, wallet: 'Phantom', at: U.now() }; AC.save(); watch(p); AC.emit('change');
      return AC.session;
    });
  };
  // a returning visitor: Phantom answers without a tap when it already trusts the site; the address it gives is the one that counts
  AC.resume = function () {
    var p = AC.provider(); if (!p || !AC.signedIn()) return Promise.resolve(AC.session);
    return Promise.resolve(p.connect({ onlyIfTrusted: true })).then(function (r) {
      var a = addressOf(r, p); watch(p);
      if (a && AC.session && a !== AC.session.address) { AC.session.address = a; AC.save(); AC.emit('change', 'Phantom switched to ' + AC.short()); }
      return AC.session;
    }, function () { return AC.session; });
  };
  var watched = null;
  function watch(p) { // Phantom switched accounts inside the wallet: the new address is the identity from now on
    if (watched === p || !p || typeof p.on !== 'function') return; watched = p;
    try { p.on('accountChanged', function (pk) { var a = pk && pk.toString ? pk.toString() : ''; if (a && ADDR.test(a) && AC.session && a !== AC.session.address) { AC.session.address = a; AC.save(); AC.emit('change', 'Phantom switched to ' + AC.short()); } }); } catch (e) {}
  }
  AC.signOut = function (why) {
    var p = AC.provider(); try { if (p && p.disconnect) p.disconnect(); } catch (e) {}
    AC.session = null; AC.save(); AC.emit('change', why || 'Signed out');
  };
  // the watchlist and the settings stay in this browser: nothing to send anywhere, nothing to fetch
  AC.push = function () {};
  AC.pull = function () { return Promise.resolve(null); };

  // ---------- what the header shows ----------
  AC.statusText = function () { return AC.signedIn() ? AC.short() : 'Connect Phantom'; };
  AC.menuHtml = function () {
    if (AC.signedIn()) {
      return '<div class="ac-head"><b>' + U.esc(AC.short()) + '</b><small>Phantom · Solana</small></div>' +
        '<div class="ac-line muted">Your watchlist and settings stay in this browser.</div>' +
        '<button class="btn small" data-ac="out">Sign out</button>';
    }
    var has = !!AC.provider();
    return '<div class="ac-head"><b>Sign in with Phantom</b><small>One tap in the wallet. It shares only your public address: no transaction, no fee, no approval; the key never leaves Phantom.</small></div>' +
      '<div class="ac-list">' + (has ? '<button class="btn" data-ac="in" data-id="phantom">Phantom <small>Solana</small></button>'
        : '<a class="btn" href="' + U.esc(AC.installUrl) + '" target="_blank" rel="noopener">Get Phantom</a>' + (AC.mobile() ? '<a class="btn" href="' + U.esc(AC.openInPhantom()) + '">Open in the Phantom app</a>' : '')) + '</div>';
  };
})(window.TL);
