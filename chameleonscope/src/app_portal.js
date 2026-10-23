/* |CHAMELEON⟩ v2.20 - the portal, quantum (src/portal.html, src/portal.css). The terminal waits in superposition: two states of it,
   Solana's and Robinhood Chain's, drawn as ghosts over each other, flickering in and out of phase. Over them the chameleon's two eyes
   are qubits: each a Bloch sphere inside the turret of scales a chameleon's eye really is, its state vector the pupil. The vectors
   precess on their own and jump the way a chameleon's eyes jump; the cursor pulls the left one and both lock on the button. The dark
   is full of entangled pairs: two particles that flare at the same moment wherever they are.
   Connecting Phantom is the observation: both vectors snap to |0⟩, the two ghosts slide into one, light breaks out between the eyes
   and the terminal is there. The gate (src/app_gate.js) decides when the portal shows, what its buttons say and when the way opens:
   TL.portal.show(mode), .actions(html), .enter(done), .hide(). Nothing here talks to a server. */
(function (TL) {
  'use strict';
  var PT = TL.portal = { shown: false, mode: '', eyes: [], raf: 0, mouse: null, lock: null, entering: false };
  var doc = document, win = window;
  var $ = function (s, r) { return (r || doc).querySelector(s); };
  var reduce = false; try { reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var now = function () { return (win.performance && performance.now) ? performance.now() : Date.now(); };

  // ---------- the eye: a turret of scales around a Bloch sphere; the state vector is the pupil ----------
  var SKINS = {
    sol:  { scales: ['#181133', '#22174a', '#2e1f66', '#3c2884'], rim: '#9945ff', rim2: '#6ef6ff', glass: ['#2a1d5c', '#120b2c', '#05030d'], iris: ['#f0fffa', '#6ef6ff', '#14f195', '#0c3d4a'], line: 'rgba(190,160,255,.55)', label: 'rgba(200,180,255,.75)' },
    hood: { scales: ['#141909', '#1d250b', '#28330e', '#354412'], rim: '#ccff00', rim2: '#6ef6ff', glass: ['#2a3410', '#121707', '#040502'], iris: ['#fbffe6', '#ccff00', '#7fe85a', '#1d2a08'], line: 'rgba(214,255,120,.5)', label: 'rgba(220,255,140,.72)' }
  };
  var R = 56; // the sphere's radius in the eye's 200 x 200 box
  var seed = 7; function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function eyeSvg(kind) {
    var S = SKINS[kind], out = [], defs = []; seed = kind === 'sol' ? 7 : 13;
    for (var i = 0; i < 4; i++) { // four rings of round scales: still a chameleon's eye from across the room
      defs.push('<radialGradient id="qy' + kind + i + '" cx=".34" cy=".3" r=".75"><stop offset="0" stop-color="' + lighten(S.scales[i], 0.5) + '"/><stop offset=".55" stop-color="' + S.scales[i] + '"/><stop offset="1" stop-color="' + darken(S.scales[i], 0.5) + '"/></radialGradient>');
      var r = 93 - i * 7.6, gr = 3.5 - i * 0.22, n = Math.max(14, Math.round(2 * Math.PI * r / (gr * 2.15))), dots = '';
      for (var j = 0; j < n; j++) {
        var a = (j + (i % 2) * 0.5 + (rnd() - 0.5) * 0.35) / n * Math.PI * 2, rr = r + (rnd() - 0.5) * 1.8, g2 = gr * (0.84 + rnd() * 0.32);
        dots += '<circle cx="' + (100 + rr * Math.cos(a)).toFixed(1) + '" cy="' + (100 + rr * Math.sin(a)).toFixed(1) + '" r="' + g2.toFixed(2) + '"/>';
      }
      out.push('<g class="qy-ring" data-d="' + ((i + 1) / 6).toFixed(3) + '" fill="url(#qy' + kind + i + ')">' + dots + '</g>');
    }
    defs.push('<radialGradient id="qyGlass' + kind + '" cx=".38" cy=".32" r=".78"><stop offset="0" stop-color="' + S.glass[0] + '"/><stop offset=".62" stop-color="' + S.glass[1] + '"/><stop offset="1" stop-color="' + S.glass[2] + '"/></radialGradient>');
    defs.push('<radialGradient id="qyIris' + kind + '" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="' + S.iris[0] + '"/><stop offset=".34" stop-color="' + S.iris[1] + '"/><stop offset=".76" stop-color="' + S.iris[2] + '"/><stop offset="1" stop-color="' + S.iris[3] + '"/></radialGradient>');
    defs.push('<radialGradient id="qyGlow' + kind + '" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="' + S.rim + '" stop-opacity=".5"/><stop offset=".5" stop-color="' + S.rim + '" stop-opacity=".12"/><stop offset="1" stop-color="' + S.rim + '" stop-opacity="0"/></radialGradient>');
    defs.push('<linearGradient id="qyVec' + kind + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + S.rim2 + '" stop-opacity=".25"/><stop offset="1" stop-color="' + S.rim + '"/></linearGradient>');
    var sphere = '<g class="qy-sphere">' +
      '<circle cx="100" cy="100" r="' + (R + 4) + '" fill="#020104"/>' +
      '<circle cx="100" cy="100" r="' + R + '" fill="url(#qyGlass' + kind + ')"/>' +
      '<circle class="qy-glow" cx="100" cy="100" r="' + (R + 18) + '" fill="url(#qyGlow' + kind + ')" style="mix-blend-mode:screen"/>' +
      '<g fill="none" stroke="' + S.line + '" stroke-width=".7">' +
        '<ellipse class="qy-mer m1" cx="100" cy="100" rx="' + R + '" ry="' + R + '" stroke-dasharray="2 3"/><ellipse class="qy-mer m2" cx="100" cy="100" rx="0" ry="' + R + '" stroke-dasharray="2 3"/>' +
        '<ellipse cx="100" cy="100" rx="' + R + '" ry="' + (R * 0.28).toFixed(1) + '"/>' +
        '<line x1="100" y1="' + (100 - R - 6) + '" x2="100" y2="' + (100 + R + 6) + '" stroke-dasharray="1.5 2.5"/></g>' +
      '<text x="100" y="' + (100 - R - 10) + '" class="qy-ket" fill="' + S.label + '">|0⟩</text><text x="100" y="' + (100 + R + 17) + '" class="qy-ket" fill="' + S.label + '">|1⟩</text>' +
      '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + S.rim + '" stroke-opacity=".55" stroke-width="1.3"/>' +
      '<circle cx="86" cy="80" r="' + (R * 0.42).toFixed(1) + '" fill="#fff" fill-opacity=".045"/></g>';
    var vec = '<line class="qy-vec" x1="100" y1="100" x2="100" y2="50" stroke="url(#qyVec' + kind + ')" stroke-width="2.4" stroke-linecap="round"/>' +
      '<circle cx="100" cy="100" r="2.6" fill="' + S.rim + '"/>' +
      '<g class="qy-tip"><circle r="11.5" fill="#020104"/><circle r="10" fill="url(#qyIris' + kind + ')"/><circle class="qy-pupil" r="4.2" fill="#010103"/><circle cx="-3.4" cy="-3.6" r="1.9" fill="#fff" fill-opacity=".92"/><circle r="12.5" fill="none" stroke="' + S.rim + '" stroke-opacity=".7" stroke-width="1"/></g>';
    return '<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false"><defs>' + defs.join('') + '</defs>' + out.join('') + sphere + vec + '</svg>';
  }
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbHex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function lighten(h, k) { return rgbHex(hexRgb(h).map(function (v) { return v + (255 - v) * k * 0.6; })); }
  function darken(h, k) { return rgbHex(hexRgb(h).map(function (v) { return v * (1 - k); })); }

  function makeEye(el, kind, lead) {
    el.insertAdjacentHTML('afterbegin', eyeSvg(kind));
    var svg = el.querySelector('svg');
    return { el: el, kind: kind, lead: lead, rings: [].slice.call(svg.querySelectorAll('.qy-ring')).map(function (g) { return { g: g, d: +g.getAttribute('data-d') }; }),
      vec: svg.querySelector('.qy-vec'), tip: svg.querySelector('.qy-tip'), m1: svg.querySelector('.qy-mer.m1'), m2: svg.querySelector('.qy-mer.m2'), sphere: svg.querySelector('.qy-sphere'),
      x: 0.2, y: -0.5, tx: 0, ty: 0, next: 0, mode: 'precess', ph: kind === 'sol' ? 0 : Math.PI, mer: kind === 'sol' ? 0.3 : 1.4,
      blinkAt: now() + 1800 + Math.random() * 3000, blink: -1e9 };
  }

  // ---------- the ghost terminal: two states of the page, one per chain, over each other ----------
  function ghostInit() {
    var g = $('#ptGhost'); if (!g || g.childNodes.length) return;
    var layer = function (k) {
      var rows = ''; for (var i = 0; i < 7; i++) rows += '<div class="gt-row"><i class="lg"></i><i class="t1"></i><i class="t2"></i><i class="bar"></i><i class="n"></i><i class="n"></i><i class="n"></i><i class="v"></i></div>';
      var cards = ''; for (var c = 0; c < 4; c++) cards += '<div class="gt-card"><i class="lg"></i><i class="t1"></i><i class="x"></i></div>';
      return '<div class="gt ' + k + '"><div class="gt-top"><i class="lg"></i><i class="tab"></i><i class="tab"></i><i class="tab"></i><i class="tab"></i><i class="sp"></i><i class="pill"></i><i class="pill"></i></div>' +
        '<div class="gt-day"><i class="t1"></i><div class="gt-cards">' + cards + '</div></div><div class="gt-ctl"><i></i><i></i><i></i><i class="sp"></i><i></i></div>' + rows + '</div>';
    };
    g.innerHTML = layer('sol') + layer('hood') + '<div class="gt-scan"></div>';
  }

  // ---------- the dark: entangled pairs (they flare together), a few that tunnel ----------
  var sky = { c: null, ctx: null, p: [], sprites: [], w: 0, h: 0, dpr: 1 };
  function sprite(rgb) {
    var s = doc.createElement('canvas'); s.width = s.height = 64; var g = s.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.18, 'rgba(' + rgb + ',.85)'); gr.addColorStop(0.45, 'rgba(' + rgb + ',.2)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return s;
  }
  var RGB = ['153,69,255', '110,246,255', '204,255,0', '20,241,149', '240,235,255'];
  function skyInit() {
    sky.c = $('#ptSky'); if (!sky.c || !sky.c.getContext) return;
    sky.ctx = sky.c.getContext('2d');
    sky.sprites = RGB.map(sprite);
    skySize();
    var pairs = Math.round(Math.min(34, Math.max(16, sky.w * sky.h / 42000)));
    sky.p = [];
    for (var i = 0; i < pairs; i++) { var a = particle(i), b = particle(i); a.mate = b; b.mate = a; b.s = a.s === 2 ? 0 : a.s; sky.p.push(a, b); }
  }
  function particle(i) {
    return { x: Math.random() * sky.w, y: Math.random() * sky.h, r: 1 + Math.pow(Math.random(), 2) * 4.2, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
      ph: Math.random() * 6.28, sp: 0.5 + Math.random() * 1.2, s: Math.floor(Math.random() * 4), flare: 0, pair: i, hop: 0 };
  }
  // v2.24: drawn at one pixel per CSS pixel (soft glowing dots need no Retina detail): a quarter of the pixels on a Mac screen
  function skySize() { if (!sky.c) return; sky.dpr = 1; sky.w = win.innerWidth; sky.h = win.innerHeight; sky.c.width = Math.round(sky.w * sky.dpr); sky.c.height = Math.round(sky.h * sky.dpr); }
  function skyDraw(dt, t) {
    var g = sky.ctx; if (!g) return;
    g.setTransform(sky.dpr, 0, 0, sky.dpr, 0, 0); g.clearRect(0, 0, sky.w, sky.h);
    var i, p;
    // a measured pair: both flare at once, wherever they are
    if (Math.random() < dt * 0.9 && sky.p.length) { p = sky.p[Math.floor(Math.random() * sky.p.length)]; p.flare = 1; if (p.mate) p.mate.flare = 1; }
    g.globalCompositeOperation = 'lighter';
    for (i = 0; i < sky.p.length; i += 2) { // the threads between the pairs: faint and only between near ones, but any pair lights its thread while it flares
      var a = sky.p[i], b = sky.p[i + 1]; if (!b) break;
      var fl = Math.max(a.flare, b.flare), dist = Math.hypot(a.x - b.x, a.y - b.y), al = (0.045 + fl * 0.16) * Math.max(0, 1 - dist / 380); // v2.24: near pairs only, flaring or not
      if (al < 0.004) continue;
      g.strokeStyle = 'rgba(' + RGB[a.s === 2 ? 2 : 1] + ',' + al.toFixed(3) + ')'; g.lineWidth = 0.6 + fl * 0.8;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    for (i = 0; i < sky.p.length; i++) {
      p = sky.p[i];
      p.x += (p.vx + Math.sin(t / 1900 + p.ph) * 4) * dt; p.y += (p.vy + Math.cos(t / 2300 + p.ph) * 4) * dt;
      if (Math.random() < dt * 0.02) { p.x += (Math.random() - 0.5) * 140; p.y += (Math.random() - 0.5) * 140; p.hop = 1; } // a tunnel: gone here, there at once
      if (p.x < -40) p.x = sky.w + 30; if (p.x > sky.w + 40) p.x = -30; if (p.y < -40) p.y = sky.h + 30; if (p.y > sky.h + 40) p.y = -30;
      var a2 = 0.22 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(t / 1000 * p.sp + p.ph), 2) + p.flare * 0.9, size = p.r * (5 + p.flare * 6 + p.hop * 8);
      g.globalAlpha = Math.min(1, a2);
      g.drawImage(sky.sprites[p.s], p.x - size / 2, p.y - size / 2, size, size);
      p.flare = Math.max(0, p.flare - dt * 1.6); p.hop = Math.max(0, p.hop - dt * 3);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  // ---------- the ring round the eyes: one line of text running along the ellipse, seamless ----------
  var runes = null;
  function runesInit() {
    var path = $('#ptRingPath'), tps = [].slice.call(doc.querySelectorAll('.pt-ring textPath'));
    if (!path || tps.length < 2 || !path.getTotalLength) return;
    var L = path.getTotalLength(); tps.forEach(function (tp) { tp.setAttribute('textLength', L.toFixed(1)); tp.setAttribute('lengthAdjust', 'spacing'); });
    runes = tps;
  }
  function runesMove(t) { if (!runes) return; var o = (t / 160000) % 1; runes[0].setAttribute('startOffset', (o * 100).toFixed(3) + '%'); runes[1].setAttribute('startOffset', ((o - 1) * 100).toFixed(3) + '%'); }

  // ---------- where the vectors point ----------
  function centerOf(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }
  function aim(e, t) {
    if (PT.entering) { e.tx = 0; e.ty = -1; return; } // the measurement: both vectors to |0⟩
    var c = centerOf(e.el), tx = null, ty = null;
    if (PT.lock) { tx = PT.lock.x; ty = PT.lock.y; }
    else if (PT.mouse && e.lead && t - PT.mouse.at < 4000) { tx = PT.mouse.x; ty = PT.mouse.y; }
    if (tx != null) { var dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1, m = Math.min(1, d / (c.w * 2.2)); e.tx = dx / d * m; e.ty = dy / d * m; return; }
    if (t > e.next) { // left alone: a qubit precesses; now and then the chameleon in it jumps somewhere and holds
      e.mode = Math.random() < 0.62 ? 'precess' : 'jump';
      e.next = t + (e.mode === 'precess' ? 2600 + Math.random() * 3600 : 700 + Math.random() * 1800);
      if (e.mode === 'jump') { var ang = Math.random() * Math.PI * 2, mag = 0.35 + Math.random() * 0.6; e.jx = Math.cos(ang) * mag; e.jy = Math.sin(ang) * mag; }
    }
    if (e.mode === 'jump') { e.tx = e.jx; e.ty = e.jy; return; }
    e.ph += 0.016 * 1.1; var amp = 0.62 + 0.18 * Math.sin(t / 2700 + (e.kind === 'sol' ? 0 : 2));
    e.tx = Math.cos(e.ph) * amp; e.ty = Math.sin(e.ph) * amp * 0.55 - 0.25; // a tilted cone round the axis
  }
  function frame(t, dt) {
    for (var i = 0; i < PT.eyes.length; i++) {
      var e = PT.eyes[i];
      aim(e, t);
      var k = 1 - Math.pow(PT.entering ? 0.00005 : 0.002, dt);
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
      for (var j = 0; j < e.rings.length; j++) { var Rg = e.rings[j], s = 12 * Rg.d * Rg.d; Rg.g.setAttribute('transform', 'translate(' + (e.x * s).toFixed(2) + ' ' + (e.y * s).toFixed(2) + ')'); }
      var m = Math.min(1, Math.hypot(e.x, e.y)), px = 100 + e.x * (R - 4), py = 100 + e.y * (R - 4);
      e.vec.setAttribute('x2', px.toFixed(2)); e.vec.setAttribute('y2', py.toFixed(2));
      var bl = 1;
      if (!PT.entering) {
        if (t > e.blinkAt) { e.blink = t; e.blinkAt = t + 2800 + Math.random() * 4800; }
        var since = t - e.blink; if (since < 240) bl = 0.12 + 0.88 * Math.abs(Math.cos(since / 240 * Math.PI));
      }
      var sc = (1.14 - 0.32 * m) * (PT.entering ? 1.25 : 1);
      e.tip.setAttribute('transform', 'translate(' + px.toFixed(2) + ' ' + py.toFixed(2) + ') scale(' + sc.toFixed(3) + ' ' + (sc * bl).toFixed(3) + ')');
      e.mer += dt * (PT.entering ? 4 : 0.55); // the sphere turns: two meridians, a quarter turn apart
      e.m1.setAttribute('rx', Math.abs(R * Math.cos(e.mer)).toFixed(2)); e.m2.setAttribute('rx', Math.abs(R * Math.sin(e.mer)).toFixed(2));
    }
  }
  var last = 0;
  function loop(t) {
    if (!PT.shown) { PT.raf = 0; return; }
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    if (!reduce || PT.entering) frame(t, dt || 0.016); // reduced motion: the vectors hold still (they still snap on the way in)
    if (!reduce) { // v2.24: the dark about 30 times a second and the ring's text 20 times (both move slowly); the eyes stay smooth
      sky.acc = (sky.acc || 0) + (dt || 0.016);
      if (sky.acc >= 0.031) { skyDraw(Math.min(0.06, sky.acc), t); sky.acc = 0; }
      if (t - (PT.runeAt || 0) >= 50) { runesMove(t); PT.runeAt = t; }
    }
    PT.raf = win.requestAnimationFrame(loop);
  }

  // ---------- v2.21: the narrative before the door: the Quantum radar's hottest coins, in superposition ----------
  // TL.quantum.teaser() asks Jupiter for the narrative's first three words, once per visit, from this browser (the engine is still off).
  // A coin shows once its picture has loaded (the terminal's own picture pipeline): the picture doubled and blurred, the ticker
  // flickering, the numbers hidden. The count says how many coins on the narrative are moving right now. Connecting Phantom is the
  // observation: the cards sharpen as the portal goes, and the terminal opens on the same coins, in numbers. When Jupiter cannot be
  // reached from here, the block steps aside quietly.
  var U = TL.util;
  var teaser = { started: false, coins: [], n: 0, done: false };
  function teaserStart() {
    if (teaser.started) return; teaser.started = true;
    var Q = TL.quantum, box = $('#ptRadar');
    if (!box) return;
    if (!Q || !Q.teaser) { box.hidden = true; return; }
    var P = TL.pics;
    if (P) P.on(function (t) { if (t && t._q && PT.shown) teaserRender(); });
    Q.teaser().then(function (coins) {
      teaser.done = true; teaser.n = coins.length;
      teaser.coins = coins.slice(0, 10).map(function (c) { var g = P ? P.of(c) : c; g._q = c; return g; });
      teaser.coins.forEach(function (g, i) { if (P && !P.has(g)) P.want(g, i < 6); });
      teaserRender();
    });
  }
  function teaserRender() {
    var box = $('#ptRadar'), track = $('#ptRadarTrack'), count = $('#ptRadarCount'); if (!box || !track || !count) return;
    var Q = TL.quantum, P = TL.pics, n = teaser.n;
    if (teaser.done && !n && !(Q && Q.teaserRaw && Q.teaserRaw.length)) { box.hidden = true; return; } // Jupiter did not answer here: nothing to show, nothing to claim
    box.hidden = false; box.classList.toggle('empty', teaser.done && !n);
    count.textContent = !teaser.done ? 'scanning Solana for quantum coins…' : n ? n + ' quantum coin' + (n === 1 ? '' : 's') + ' moving on Solana right now' : 'no quantum coin is moving on Solana this minute';
    var shown = teaser.coins.filter(function (g) { return !P || P.has(g); }).slice(0, 6);
    var hid = '<span class="pr-hid">$??.?K · ??%</span>';
    if (!shown.length) { // the pictures are still on their way (or nothing moves): the superposition keeps its place
      var ph = ''; for (var k = 0; k < Math.max(1, Math.min(3, n || 3)); k++) ph += '<span class="pr-card ph"><span class="pr-pic"></span><span class="pr-b"><b>|?⟩</b><small>' + ['quantum', 'qubit', 'quant'][k] + '</small>' + hid + '</span></span>';
      track.innerHTML = ph; return;
    }
    track.innerHTML = shown.map(function (g, i) {
      var src = U.esc(g.logoOk || ''), sym = U.esc(g.symbol || '?'), w = U.esc(g._q ? g._q.word : 'quantum');
      return '<span class="pr-card" style="--i:' + i + '" title="' + sym + ': on the quantum narrative by «' + w + '». Connect Phantom to see its numbers">' +
        '<span class="pr-pic"><img src="' + src + '" alt="" referrerpolicy="no-referrer" decoding="async"><img class="pr-ghost" src="' + src + '" alt="" referrerpolicy="no-referrer" decoding="async"></span>' +
        '<span class="pr-b"><b data-sym="' + sym + '">' + sym + '</b><small>' + w + '</small>' + hid + '</span></span>';
    }).join('');
  }
  PT.teaser = teaser;

  // ---------- the gate's handle on the portal ----------
  var bound = false;
  function bind() {
    if (bound) return; bound = true;
    var root = $('#portal'); if (!root) return;
    PT.eyes = [makeEye($('#ptEyeSol'), 'sol', true), makeEye($('#ptEyeHood'), 'hood', false)];
    ghostInit(); skyInit();
    if (reduce) frame(now(), 0.016);
    win.addEventListener('resize', function () { if (PT.shown) skySize(); });
    root.addEventListener('pointermove', function (ev) { PT.mouse = { x: ev.clientX, y: ev.clientY, at: now() }; });
    // both vectors on the button: the moment before the measurement
    root.addEventListener('pointerover', function (ev) { var b = ev.target.closest && ev.target.closest('.pt-cta, .pt-ghost-btn'); if (b) PT.lock = centerOf(b); });
    root.addEventListener('pointerout', function (ev) { var b = ev.target.closest && ev.target.closest('.pt-cta, .pt-ghost-btn'); if (b && !(ev.relatedTarget && b.contains(ev.relatedTarget))) PT.lock = null; });
    root.addEventListener('focusin', function (ev) { var b = ev.target.closest && ev.target.closest('.pt-cta, .pt-ghost-btn'); if (b) PT.lock = centerOf(b); });
    root.addEventListener('focusout', function () { PT.lock = null; });
    root.addEventListener('click', function (ev) { var a = ev.target.closest('.pt-foot a[href^="#/"]'); if (a) PT.hide(); }); // About, Roadmap, Valley: open to all, the portal steps aside
  }
  PT.available = function () { return !!$('#portal'); };
  PT.show = function (mode) {
    var root = $('#portal'); if (!root) return;
    bind();
    PT.mode = mode || 'locked'; root.setAttribute('data-mode', PT.mode);
    if (!PT.shown) {
      PT.shown = true; root.hidden = false; root.classList.remove('entering', 'leaving'); doc.body.classList.add('portal-open', 'portal-cover');
      skySize(); last = 0; if (!runes) runesInit();
      if (!PT.raf) PT.raf = win.requestAnimationFrame(loop);
    }
    teaserStart(); // v2.21: the narrative's live radar under the name
  };
  PT.actions = function (html, note) {
    var box = $('#gateActions'); if (box) box.innerHTML = html;
    if (note != null) { var n = $('#gateNote'); if (n) n.innerHTML = note; }
  };
  PT.hide = function () {
    var root = $('#portal'); if (!root) return;
    PT.shown = false; PT.entering = false; PT.lock = null; root.hidden = true; root.classList.remove('entering', 'leaving'); doc.body.classList.remove('portal-open', 'portal-cover');
    if (PT.raf) { win.cancelAnimationFrame(PT.raf); PT.raf = 0; }
  };
  // the observation: the vectors snap to |0⟩, the two ghosts fall into one, light breaks out between the eyes, the terminal is there
  PT.enter = function (done) {
    var root = $('#portal');
    if (!root || !PT.shown) { arrive(); if (done) done(); return; }
    PT.entering = true; doc.body.classList.remove('portal-cover'); // the terminal is drawn again under the flash, ready for the reveal
    var g = $('.pt-eyes'), burst = $('.pt-burst');
    if (g && burst) { var c = centerOf(g); burst.style.setProperty('--bx', c.x + 'px'); burst.style.setProperty('--by', c.y + 'px'); }
    root.classList.add('entering');
    var quick = reduce ? 0.25 : 1, gone = false;
    var finish = function () { if (gone) return; gone = true; PT.hide(); };
    setTimeout(function () {
      if (done) done(); arrive(); root.classList.add('leaving');
      root.addEventListener('animationend', function end(ev) { if (ev.target === root) { root.removeEventListener('animationend', end); finish(); } });
      setTimeout(finish, 1600 * quick); // a safety net if the fade never reports its end
    }, 1150 * quick);
  };
  function arrive() { doc.body.classList.remove('world-in'); void doc.body.offsetWidth; doc.body.classList.add('world-in'); setTimeout(function () { doc.body.classList.remove('world-in'); }, 1300); }
  PT.arrive = arrive;
})(window.TL);
