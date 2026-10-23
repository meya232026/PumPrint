/* Chameleon - the gate (v1.94, v2.10 the portal). On its own domain the site opens in the portal (src/app_portal.js): the dark place with
   the two eyes. Phantom opens the way: connect shares the wallet's public address and nothing else (no message, no transaction, no fee).
   Until the way is open the data engine does not start: nothing is polled, nothing is shown. About, Roadmap and the Valley game stay
   open to everyone; the portal steps aside for them.
   v2.10: a returning visitor is let in only when Phantom itself still answers for the saved address (connect with onlyIfTrusted, no
   window): a session remembered in the browser is not enough on its own any more. Within one browser tab the portal greets once;
   a reload in the same tab goes straight in. ?gate=phantom turns the gate on anywhere else (the tests); a copy opened as a file, a
   preview or the artifact has no gate, as before. */
(function (TL) {
  'use strict';
  var U = TL.util, C = TL.CONFIG, AC = TL.account;
  var G = TL.gate = { locked: false, opened: false, onOpen: null, checking: false, why: '' };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var PT = function () { return TL.portal && TL.portal.available() ? TL.portal : null; };
  var SEEN = 'tl.portalSeen';
  G.active = function () { return !!C.phantomGate; };
  G.publicView = function (v) { return v === 'about' || v === 'roadmap' || v === 'valley'; }; // v2.00: the Valley tab too: the game connects Phantom by itself
  function toast(t) { if (TL.ui && TL.ui.toast) TL.ui.toast(t); }
  function seen() { try { return sessionStorage.getItem(SEEN) || ''; } catch (e) { return ''; } }
  function markSeen() { try { sessionStorage.setItem(SEEN, (AC.session && AC.session.address) || '1'); } catch (e) {} }
  function view() { return TL.ui && TL.ui.parseRoute ? TL.ui.parseRoute().view : ''; }
  // the roadmap's tree: plain glowing apples (until 1.93 they carried the NFT collection's portraits)
  G.dressTree = function () { var tree = document.getElementById('rmTree'); if (tree) tree.classList.add('plain'); };
  // Phantom injects itself a moment after the page sometimes: wait for it a little before deciding it is not there
  function whenPhantom(ms) {
    return new Promise(function (res) {
      var t0 = U.now(); (function look() { var p = AC.provider(); if (p || U.now() - t0 > ms) return res(p); setTimeout(look, 90); })();
    });
  }
  G.start = function (onOpen) {
    G.onOpen = onOpen; G.dressTree();
    if (!G.active()) { G.open(); return; }
    AC.on('change', function () { G.check(); });
    var pt = PT();
    // the same tab, the same wallet, already through the portal: straight in, Phantom asked quietly
    if (AC.signedIn() && seen() === AC.session.address) { G.open(); if (AC.resume) AC.resume(); return; }
    document.body.classList.add('gated'); G.locked = true;
    // a wallet extension can inject itself seconds after the page (a slow machine, a cold start): the portal looks again while it waits
    var hadWallet = !!AC.provider(), looks = 0, watcher = setInterval(function () { looks++; if (!G.locked || looks > 40) { clearInterval(watcher); return; } var has = !!AC.provider(); if (has !== hadWallet) { hadWallet = has; if (!G.checking) G.render(); } }, 500);
    if (!AC.signedIn()) { G.render(); if (TL.ui && TL.ui.route) TL.ui.route(); window.addEventListener('load', function () { if (G.locked) G.render(); }); return; }
    // a returning visitor: the eyes look for Phantom first; the saved address counts only if Phantom still answers for it
    G.checking = true; G.render();
    if (pt && !G.publicView(view())) pt.show('checking');
    if (TL.ui && TL.ui.route) TL.ui.route();
    whenPhantom(2500).then(function (p) {
      if (!p) return null;
      return Promise.resolve(p.connect({ onlyIfTrusted: true })).then(function (r) { var pk = (r && r.publicKey) || p.publicKey; return pk && pk.toString ? pk.toString() : null; }, function () { return null; });
    }).then(function (addr) {
      G.checking = false;
      if (!addr || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) { AC.session = null; AC.save(); G.why = ''; G.render(); return; } // Phantom does not answer for it any more: connect again
      if (addr !== AC.session.address) { AC.session.address = addr; AC.save(); }
      if (AC.resume) AC.resume();
      var p2 = PT();
      if (p2 && p2.shown) { G.welcome = true; G.render(); setTimeout(function () { if (G.locked && G.welcome) G.enter(); }, reduceMotion() ? 300 : 1500); }
      else G.open();
    });
  };
  function reduceMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  // a sign-in or a sign-out: open when there is an address, back to the gate when there is none
  G.check = function () {
    if (!G.active()) return;
    if (G.locked && AC.signedIn() && !G.checking) { G.enter(true); return; }
    if (!G.locked && !AC.signedIn()) { G.lock(''); return; }
    G.render();
  };
  // through the portal: the eyes dilate and the terminal comes up through them (or without the show when the portal is not on screen)
  G.enter = function (signedInNow) {
    if (G.entering) return; G.entering = true;
    G.welcome = false; markSeen();
    var pt = PT();
    G.open(signedInNow); // the engine starts under the portal first (its first pass is heavy); the light plays once it has drawn
    if (pt && pt.shown) { var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); }; raf(function () { raf(function () { pt.enter(); }); }); }
    else if (pt) pt.arrive();
  };
  G.open = function (signedInNow) {
    G.locked = false; document.body.classList.remove('gated');
    if (AC.signedIn()) markSeen();
    if (!G.opened) { G.opened = true; if (G.onOpen) G.onOpen(); }
    if (signedInNow) setTimeout(function () { toast('Signed in with Phantom as ' + AC.short()); }, 2000);
    var v = view();
    if (v === 'about' || v === 'roadmap' || v === 'gate') { if (signedInNow || v === 'gate') { location.hash = '#/'; return; } }
    if (TL.ui && TL.ui.route) TL.ui.route();
  };
  // the engine cannot be stopped cleanly once it runs: a sign-out shows the portal on a fresh page
  G.lock = function (why) { try { sessionStorage.removeItem(SEEN); if (why) sessionStorage.setItem('tl.gateWhy', why); } catch (e) {} location.reload(); };
  // any closed route while locked: the portal
  G.show = function () {
    if (TL.ui && TL.ui.setTab) TL.ui.setTab('gate');
    var pt = PT(); if (pt) pt.show(G.checking ? 'checking' : G.welcome ? 'welcome' : 'locked');
    G.render();
  };

  // ---------- what the portal says ----------
  function takeWhy() { if (G.why === '' || G.why == null) { try { G.why = sessionStorage.getItem('tl.gateWhy') || ''; sessionStorage.removeItem('tl.gateWhy'); } catch (e) { G.why = ''; } } return G.why; }
  var ARROW = '<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  G.render = function () {
    var html = '', note = null, why = takeWhy(), has = !!AC.provider();
    if (G.checking) html = '<p class="pt-msg">Looking for your Phantom…</p>';
    else if (G.welcome) html = '<p class="pt-welcome">Welcome back · ' + U.esc(AC.short()) + '</p><button class="pt-cta" data-gate="enter">Enter' + ARROW + '</button>';
    else {
      if (why) html += '<p class="pt-msg bad">' + U.esc(why) + '</p>';
      if (has) html += '<button class="pt-cta" data-gate="in">Connect Phantom' + ARROW + '</button>';
      else {
        html += '<p class="pt-msg">Phantom is not in this browser.</p><div class="pt-row"><a class="pt-cta" href="' + U.esc(AC.installUrl) + '" target="_blank" rel="noopener">Get Phantom' + ARROW + '</a>' +
          (AC.mobile() ? '<a class="pt-ghost-btn" href="' + U.esc(AC.openInPhantom()) + '">Open in the Phantom app</a>' : '') + '</div>'; // v2.20: pt-ghost is the ghost terminal now
        note = 'Installed it just now? Reload this page. Phantom shares only your wallet\'s public address: no transaction, no fee, nothing to approve.';
      }
    }
    var pt = PT();
    if (pt) pt.actions(html, note || 'Phantom shares only your wallet\'s public address. No transaction, no fee, nothing to approve.');
    var box = $('#tabGate .gate-actions'); if (box) box.innerHTML = html; // the old gate page (kept as the route's empty page under the portal)
  };
  G.bind = function () {
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-gate]'); if (!b) return;
      if (!b.closest('#portal') && !b.closest('#tabGate')) return;
      ev.preventDefault(); G.why = ''; // the person acts: the old reason goes
      if (b.dataset.gate === 'enter') { G.enter(false); return; }
      if (b.dataset.gate === 'in') {
        b.disabled = true; b.innerHTML = 'Check Phantom…';
        AC.signIn().then(function () { G.check(); }, function (e) { G.why = 'Phantom did not connect: ' + ((e && e.message) || 'cancelled') + '. Try again.'; G.render(); });
      }
    });
  };
})(window.TL);
