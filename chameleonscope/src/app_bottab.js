/* Chameleon v1.43 - Trading bot: the instruction page of the BTC-Machine kit's bot, ported from the Trenchlight hub.
   A reading tab. It explains how the terminal's calls are made and how the bot copies them, walks through the setup for
   Mac and Windows, and offers the kit downloads. Nothing here runs the bot, holds a key or talks to an exchange: the bot
   is a separate program the reader downloads and runs on their own computer.
   The download buttons check whether the kit files are really there (a HEAD request to the site's /downloads/ folder,
   then to the terminal's) and switch themselves off with a note when they are not, so the page never offers a dead link. */
(function (TL) {
  'use strict';
  var C = TL.CONFIG;
  var B = TL.bottab = { bound: false, warned: false, checked: false, downloads: {} };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('tl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('tl.' + k, JSON.stringify(v)); } catch (e) {} }
  };
  function detectOs() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
    return /win/i.test(p) ? 'win' : 'mac';
  }
  B.setOs = function (os) {
    var panel = $('#tabBot'); if (!panel) return;
    panel.classList.toggle('os-mac', os !== 'win'); panel.classList.toggle('os-win', os === 'win');
    $$('#botOs button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.pick === os ? 'true' : 'false'); });
    var note = $('#botOsNote'); if (note) note.textContent = (os === 'win' ? 'Steps for Windows 10 / 11.' : 'Steps for macOS.') + (os === detectOs() ? '' : ' Your computer looks like a ' + (detectOs() === 'win' ? 'Windows PC' : 'Mac') + '.');
    B.os = os;
  };
  B.openWarn = function () {
    var m = $('#botWarn'); if (!m) return;
    $('#botWarnNever').checked = !!LS.get('botWarnNever', false);
    m.classList.add('open');
    var box = $('.box', m); if (box) box.scrollTop = 0;
    setTimeout(function () { var ok = $('#botWarnOk'); if (ok) { try { ok.focus({ preventScroll: true }); } catch (e) {} } if (box) box.scrollTop = 0; }, 30);
  };
  B.closeWarn = function () { var m = $('#botWarn'); if (m) m.classList.remove('open'); };
  function light(box, n, on) { $$('[data-pin="' + n + '"]', box).forEach(function (el) { el.classList.toggle('is-on', on); }); }
  function bindPins() {
    // a legend item and its numbered pin on the screenshot light up together (hover, keyboard focus or a click on the pin)
    $$('#tabBot .tbot-anno').forEach(function (box) {
      var over = function (ev) { var t = ev.target.closest('[data-pin]'); if (t && box.contains(t)) light(box, t.dataset.pin, true); };
      var out = function (ev) { var t = ev.target.closest('[data-pin]'); if (t && box.contains(t)) light(box, t.dataset.pin, false); };
      box.addEventListener('mouseover', over); box.addEventListener('mouseout', out);
      box.addEventListener('focusin', over); box.addEventListener('focusout', out);
      box.addEventListener('click', function (ev) {
        var p = ev.target.closest('.tbot-pin'); if (!p) return;
        $$('.is-on', box).forEach(function (el) { el.classList.remove('is-on'); });
        light(box, p.dataset.pin, true);
        var li = $('.tbot-legend [data-pin="' + p.dataset.pin + '"]', box);
        if (li && li.scrollIntoView) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function head(url) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
    return fetch(url, { method: 'HEAD', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status);
      var ct = String(r.headers.get('content-type') || '');
      if (/text\/html/i.test(ct)) throw new Error('not a file'); // a hosting that answers every path with the page, not a kit
      return { url: url, size: +r.headers.get('content-length') || 0 };
    }, function (e) { clearTimeout(t); throw e; });
  }
  // the first place that really has the file wins: the site's own /downloads/ folder, then the terminal's
  function bases() {
    var out = (C.downloads || []).filter(Boolean);
    if (!C.apiOverride && TL.ui && TL.ui.btcServer) { var t = String(TL.ui.btcServer() || '').replace(/\/+$/, ''); if (t && /^https?:/.test(t)) out.push(t + '/downloads/'); }
    return out;
  }
  function locate(name) {
    var bases_ = bases(), i = 0;
    return new Promise(function (resolve) {
      (function next() {
        if (i >= bases_.length) return resolve(null);
        head(bases_[i++] + name).then(resolve, next);
      })();
    });
  }
  B.checkDownloads = function () {
    var note = $('#botDlNote'), mine = detectOs(), missing = 0, links = $$('#tabBot [data-dl]');
    $$('#tabBot [data-dlcard]').forEach(function (c) { var is = c.dataset.dlcard === mine; c.classList.toggle('is-mine', is); var s = $('h4 small', c); if (s) s.hidden = !is; });
    if (note) note.hidden = true;
    return Promise.all(links.map(function (a) {
      var name = a.dataset.dl, size = $('[data-dlsize]', a.parentNode);
      a.setAttribute('aria-disabled', 'true'); a.removeAttribute('href'); if (size) size.textContent = 'checking…';
      return locate(name).then(function (found) {
        B.downloads[name] = found;
        if (found) { a.href = found.url; a.setAttribute('download', name); a.removeAttribute('aria-disabled'); if (size) size.textContent = found.size ? fmtSize(found.size) : 'zip'; return; }
        missing++; if (size) size.textContent = 'not available yet';
      });
    })).then(function () {
      if (!note || !missing) return;
      note.hidden = false;
      note.innerHTML = 'The kit files are not published yet, so the buttons above are switched off: nothing here links to a file that does not exist. ' +
        'When the kits are uploaded to the site’s <code>downloads/</code> folder the buttons go live by themselves. ' +
        (C.links && C.links.x ? 'Follow <a href="' + TL.util.esc(C.links.x) + '" target="_blank" rel="noopener">@ChameleonScopee on X</a> for the release.' : '');
    });
  };
  function copyText(text, btn) {
    var done = function () { if (!btn) return; var was = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = was; }, 1400); };
    var fallback = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function jumpTo(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function bind() {
    B.bound = true;
    B.setOs(LS.get('botOs', detectOs()));
    bindPins();
    $('#botOs').addEventListener('click', function (ev) { var x = ev.target.closest('button[data-pick]'); if (!x) return; LS.set('botOs', x.dataset.pick); B.setOs(x.dataset.pick); });
    $('#botRisks').addEventListener('click', B.openWarn);
    $('#botWarnOk').addEventListener('click', B.closeWarn);
    $('#botWarnNever').addEventListener('change', function (ev) { LS.set('botWarnNever', !!ev.target.checked); });
    $('#botWarn').addEventListener('click', function (ev) { // "How →" in the popup: close it and scroll to the section
      var j = ev.target.closest('a[data-jump-close]'); if (!j) return;
      ev.preventDefault(); B.closeWarn(); var id = j.getAttribute('data-jump-close'); setTimeout(function () { jumpTo(id); }, 60);
    });
    $('#tabBot').addEventListener('click', function (ev) {
      var w = ev.target.closest('[data-warn]'); if (w) { ev.preventDefault(); B.openWarn(); return; }
      var j = ev.target.closest('a[data-jump]'); if (j) { ev.preventDefault(); jumpTo(j.getAttribute('data-jump')); return; }
      var c = ev.target.closest('[data-copy]'); if (c) { copyText(c.dataset.copy, c); return; }
      var dl = ev.target.closest('a[data-dl][aria-disabled="true"]'); if (dl) ev.preventDefault(); // a switched-off download button goes nowhere
    });
  }
  B.show = function () {
    if (!$('#tabBot')) return;
    if (!B.bound) bind();
    if (!B.warned) { B.warned = true; if (!LS.get('botWarnNever', false)) B.openWarn(); } // the warning comes first, once per page load, until "Don't show this again"
    if (!B.checked) { B.checked = true; B.checkDownloads(); }
  };
  B.hide = function () { B.closeWarn(); };
})(window.TL);
