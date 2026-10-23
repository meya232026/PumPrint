// Moth Radar page: the Moth side panel, rebuilt for the website.
// Talks the Moth server protocol to /moth (server mode) or to a LocalFeed in the browser.

import { $, esc, toast, local, reduceMotion } from '../ui.js';
import { SocketConnection, PollingConnection } from './connection.js';
import { LocalFeed } from './engine.js';
import {
  durationText,
  formatChange,
  formatCount,
  formatMc,
  formatMove,
  formatRate,
  TOKEN_STATUS,
  heatClass,
  randomHex,
  splitWords,
  timeAgo,
  TOKEN_SITES,
  tokenSite,
  tokenUrl,
  windowLabel,
  windowPhrase,
  xSearchUrl,
  cleanWord,
} from './lib/format.js';

const FEED_MAX = 40;
const ROWS_MAX = 50;
const SETTINGS_KEY = 'pumprint.moth';
const DEFAULTS = { window: 60, sort: 'top', watchlist: [], hidden: [], tokenSite: 'gmgn', accessKey: '' };

export function initMoth(env) {
  const els = {
    status: $('#m-status'),
    statusText: $('#m-status-text'),
    windows: $('#m-windows'),
    sorts: $('#m-sorts'),
    filter: $('#m-filter'),
    site: $('#m-site'),
    summary: $('#m-summary'),
    notice: $('#m-notice'),
    words: $('#m-words'),
    empty: $('#m-empty'),
    feed: $('#m-feed'),
    rate: $('#m-rate'),
    watch: $('#m-watch'),
    watchNote: $('#m-watch-note'),
    watchForm: $('#m-watch-form'),
    watchInput: $('#m-watch-input'),
    hidden: $('#m-hidden'),
    hiddenWrap: $('#m-hidden-wrap'),
    help: $('#m-help'),
  };

  const state = {
    settings: { ...DEFAULTS, ...local.get(SETTINGS_KEY, {}) },
    conn: null,
    transport: null,
    connState: 'connecting',
    source: null,
    holderMode: false,
    holder: null,
    windows: [5, 15, 60],
    freeWindows: [5, 15, 60],
    allowed: [5, 15, 60],
    tier: 'pro',
    window: 60,
    pendingWindow: null,
    snapshot: null,
    query: '',
    expanded: null,
    details: new Map(),
    detailsAt: new Map(),
    rows: new Map(),
    lastCounts: new Map(),
    feedItems: [],
    noticeKind: null,
    active: true,
    alerted: new Map(),
    verify: null,
    verifyTimer: null,
    fellBack: false,
  };
  state.window = state.settings.window;
  els.site.value = TOKEN_SITES[state.settings.tokenSite] ? state.settings.tokenSite : 'gmgn';

  const save = () => local.set(SETTINGS_KEY, state.settings);

  // ---------------------------------------------------------------- transport

  const common = {
    hello: () => ({ key: state.settings.accessKey || undefined, window: state.window, feed: true }),
    onMessage,
    onState,
  };

  function startTransport(kind) {
    state.conn?.stop();
    state.transport = kind;
    if (kind === 'ws') {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      state.conn = new SocketConnection({ url: `${proto}//${location.host}/moth/ws`, ...common });
    } else if (kind === 'http') {
      state.conn = new PollingConnection({ base: `${location.origin}/moth`, ...common });
    } else {
      state.conn = new LocalFeed({ kind, ...common });
    }
    state.conn.start();
  }


  // When the WebSocket fails but plain HTTP works, poll instead.
  let probeAt = 0;
  async function probeHttp() {
    if (Date.now() - probeAt < 10_000) return;
    probeAt = Date.now();
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('/moth/health', { cache: 'no-store', signal: ctrl.signal });
      if (res.ok && state.transport === 'ws' && state.connState !== 'open') startTransport('http');
    } catch {
      /* server down: the socket keeps retrying */
    }
  }

  // ---------------------------------------------------------------- messages

  function onState(s) {
    state.connState = s;
    renderStatus();
    if (s === 'open') {
      if (state.noticeKind === 'offline') hideNotice();
    } else if (!state.snapshot) {
      showEmpty(s === 'offline' ? 'offline' : 'connecting');
    } else if (s === 'offline') {
      els.words.classList.add('loading');
      showNotice('offline', '<p>Lost the connection to the radar. It keeps retrying; the list shows the last numbers it got.<br><button class="btn btn-line btn-sm" type="button" data-act="retry">Retry now</button></p>');
    }
    if (s === 'offline' && state.transport === 'ws') probeHttp();
  }

  function onMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        return handleWelcome(msg);
      case 'tier':
        applyTier(msg);
        state.window = msg.window;
        renderControls();
        return toast(msg.tier === 'pro' ? 'Holder access unlocked.' : 'Holder access ended: the wallet no longer holds enough.');
      case 'snapshot':
        return handleSnapshot(msg);
      case 'launch':
        return addLaunch(msg, true);
      case 'word':
        state.details.set(msg.word, msg);
        if (msg.word === state.expanded) renderDetail(msg);
        return undefined;
      case 'error':
        return handleError(msg);
      default:
        return undefined;
    }
  }

  function applyTier(msg) {
    state.tier = msg.tier;
    state.allowed = msg.allowed || state.allowed;
  }

  function handleWelcome(msg) {
    state.source = msg.server?.source || null;
    renderStatus();
    state.holderMode = Boolean(msg.holderMode);
    state.holder = msg.holder;
    state.windows = msg.windows || state.windows;
    state.freeWindows = msg.freeWindows || state.freeWindows;
    applyTier(msg);
    if (msg.window !== state.window) state.lastCounts.clear();
    state.window = msg.window;
    state.pendingWindow = null;
    state.feedItems = (msg.recent || []).slice(0, FEED_MAX);
    renderFeed();
    renderControls();
    if (state.source === 'demo') {
      const why = state.fellBack
        ? 'This browser could not reach the live pump.fun stream, so the radar shows made-up launches.'
        : env.mode === 'server'
          ? 'The server runs in demo mode, so these launches are made up.'
          : 'This preview has no live data, so these launches are made up.';
      showNotice('demo', `<p><b class="mode-badge">Demo</b> ${esc(why)} Tokens here don’t exist and have no page.</p>${dismissButton()}`);
    } else if (state.source === 'browser') {
      showNotice('browser', `<p>Live launches straight from pump.fun, counted in your browser since you opened this page. Rows fill in as launches arrive; change versus the previous window shows once it has been watched in full. The site’s server keeps two hours of history for everyone.</p>${dismissButton()}`);
    } else if (state.noticeKind === 'demo' || state.noticeKind === 'browser') {
      hideNotice();
    }
    if (state.holderMode && state.settings.accessKey && state.tier !== 'pro') {
      showNotice('key', `<p>Your holder access isn’t active (${esc(msg.keyStatus || 'not verified')}). Verify your wallet again to unlock every window.<br><button class="btn btn-accent btn-sm" type="button" data-act="verify">Verify wallet</button></p>${dismissButton()}`);
    }
  }

  function handleSnapshot(msg) {
    if (msg.window !== state.window) return;
    state.snapshot = msg;
    state.pendingWindow = null;
    if (state.connState === 'open') els.words.classList.remove('loading');
    if (state.active) {
      renderList();
      renderSummary();
    }
    els.rate.textContent = `${formatRate(msg.rate)} a minute`;
    if (state.expanded && Date.now() - (state.detailsAt.get(state.expanded) || 0) > 10_000) requestWord(state.expanded);
    checkWatchlist(msg);
  }

  function handleError(msg) {
    if (msg.code !== 'holder_required') return;
    if (state.pendingWindow === msg.window) {
      state.pendingWindow = null;
      state.window = Math.max(...state.allowed);
      els.words.classList.remove('loading');
      renderControls();
    }
    showHolderNotice(msg.window);
  }

  // ---------------------------------------------------------------- status, notices, summary

  function renderStatus() {
    const s = state.connState;
    let label = s === 'open' ? 'Live' : s === 'connecting' ? 'Connecting' : 'Offline';
    let key = s;
    if (s === 'open' && state.source === 'demo') {
      label = 'Demo data';
      key = 'demo';
    } else if (s === 'open' && state.source === 'browser') {
      label = 'Live in your browser';
    }
    els.status.dataset.state = key;
    els.statusText.textContent = label;
  }

  function showNotice(kind, html) {
    state.noticeKind = kind;
    els.notice.innerHTML = html;
    els.notice.hidden = false;
  }

  function hideNotice() {
    state.noticeKind = null;
    els.notice.hidden = true;
    els.notice.replaceChildren();
  }

  function dismissButton() {
    return '<button class="icon-btn" type="button" data-act="dismiss" aria-label="Dismiss"><svg aria-hidden="true"><use href="#i-close"/></svg></button>';
  }

  function showHolderNotice(minutes) {
    const h = state.holder;
    const who = h ? `wallets holding at least ${formatCount(h.minBalance)} $${esc(h.symbol)}` : 'holders';
    const label = minutes ? `The ${windowLabel(minutes)} window is` : 'Shorter windows are';
    showNotice(
      'holder',
      `<p>${label} for ${who}. Verify with Phantom, Solflare or Backpack: you sign a message, no transaction and no fee.<br><button class="btn btn-accent btn-sm" type="button" data-act="verify">Verify wallet</button>${h && h.buyUrl ? ` <a class="btn btn-line btn-sm" href="${esc(h.buyUrl)}" target="_blank" rel="noopener noreferrer">Get $${esc(h.symbol)}</a>` : ''}</p>${dismissButton()}`,
    );
  }

  function renderSummary() {
    const snap = state.snapshot;
    if (!snap) {
      els.summary.textContent = '';
      return;
    }
    let text = `${formatCount(snap.total)} launches in ${windowPhrase(snap.window)}, about ${formatRate(snap.rate)} a minute.`;
    if (!snap.warm && snap.warmAt) {
      const prev = snap.window === 60 ? 'previous hour' : `previous ${windowLabel(snap.window)}`;
      text += ` Change versus the ${prev} shows in ${durationText(snap.warmAt - Date.now())}.`;
    }
    els.summary.textContent = text;
  }

  function showEmpty(kind) {
    const html = {
      connecting: '<h2>Connecting</h2><p>Opening the launch stream.</p>',
      offline: '<h2>Can’t reach the radar</h2><p>The launch stream isn’t answering. It keeps retrying.</p><p style="margin-top:14px"><button class="btn btn-line btn-sm" type="button" data-act="retry">Try again</button></p>',
      nowords: `<h2>No words yet</h2><p>A word shows up here once two new tokens in ${windowPhrase(state.window)} share it.</p>`,
      nomatch: `<h2>No match</h2><p>No word in ${windowPhrase(state.window)} contains “${esc(state.query)}”.</p>`,
    }[kind];
    els.empty.innerHTML = html;
    els.empty.hidden = false;
    if (kind === 'connecting' || kind === 'offline') {
      els.words.replaceChildren();
      state.rows.clear();
      state.expanded = null;
    }
  }

  // ---------------------------------------------------------------- word list

  function visibleItems() {
    const snap = state.snapshot;
    if (!snap) return [];
    const hidden = new Set(state.settings.hidden);
    const q = state.query;
    const items = snap.words.filter((w) => !hidden.has(w.w) && (!q || w.w.includes(q)));
    if (state.settings.sort === 'rising') items.sort((a, b) => b.z - a.z || b.c - a.c);
    else items.sort((a, b) => b.c - a.c || b.z - a.z);
    return items.slice(0, ROWS_MAX);
  }

  function renderList() {
    const snap = state.snapshot;
    if (!snap) return;
    const items = visibleItems();
    if (!items.length) showEmpty(state.query ? 'nomatch' : 'nowords');
    else els.empty.hidden = true;
    const watch = new Set(state.settings.watchlist);
    const max = Math.max(1, ...items.map((i) => i.c));
    const before = new Map();
    if (!reduceMotion) for (const [w, el] of state.rows) before.set(w, el.getBoundingClientRect().top);
    const keep = new Set();
    let prev = null;
    for (const it of items) {
      let el = state.rows.get(it.w);
      if (!el) {
        el = createRow(it.w);
        state.rows.set(it.w, el);
      }
      updateRow(el, it, max, snap.warm, watch.has(it.w));
      keep.add(it.w);
      const slot = prev ? prev.nextSibling : els.words.firstChild;
      if (slot !== el) els.words.insertBefore(el, slot);
      prev = el;
    }
    for (const [w, el] of state.rows) {
      if (keep.has(w)) continue;
      el.remove();
      state.rows.delete(w);
      if (state.expanded === w) state.expanded = null;
    }
    if (!reduceMotion) {
      for (const [w, el] of state.rows) {
        const top = before.get(w);
        if (top === undefined) continue;
        const dy = top - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
  }

  function createRow(word) {
    const li = document.createElement('li');
    li.className = 'm-row';
    li.dataset.word = word;
    li.innerHTML = `
      <div class="m-row-main" role="button" tabindex="0" aria-expanded="false">
        <span class="m-word"></span>
        <svg class="m-spark" viewBox="0 0 92 20" preserveAspectRatio="none" aria-hidden="true"></svg>
        <span class="m-count"></span>
        <span class="m-chg"></span>
        <button class="m-star" type="button" aria-pressed="false"><svg aria-hidden="true"><use href="#i-star"/></svg></button>
      </div>
      <a class="m-lead" target="_blank" rel="noopener noreferrer" hidden></a>`;
    li.querySelector('.m-word').textContent = word;
    return li;
  }

  function updateRow(el, it, max, warm, watched) {
    const expanded = state.expanded === it.w;
    el.className = `m-row ${heatClass(it.z)}${watched ? ' watched' : ''}`;
    el.style.setProperty('--pool', `${Math.max(14, Math.round((it.c / max) * 100))}%`);
    const main = el.querySelector('.m-row-main');
    main.setAttribute('aria-expanded', String(expanded));
    const countEl = el.querySelector('.m-count');
    const text = formatCount(it.c);
    const last = state.lastCounts.get(it.w);
    if (countEl.textContent !== text) {
      countEl.textContent = text;
      if (last !== undefined && it.c > last && !reduceMotion) {
        countEl.classList.remove('bump');
        void countEl.offsetWidth;
        countEl.classList.add('bump');
      }
    }
    state.lastCounts.set(it.w, it.c);
    const change = formatChange(it.c, it.p, warm);
    const chg = el.querySelector('.m-chg');
    chg.textContent = change.text;
    chg.className = `m-chg ${change.tone}`;
    chg.title = change.title;
    const spark = el.querySelector('.m-spark');
    const key = (it.s || []).join(',');
    if (spark.dataset.key !== key) {
      spark.dataset.key = key;
      spark.innerHTML = sparkBars(it.s);
    }
    const star = el.querySelector('.m-star');
    star.setAttribute('aria-pressed', String(watched));
    star.setAttribute('aria-label', watched ? `Stop watching ${it.w}` : `Watch ${it.w}`);
    star.title = watched ? 'Watching: click to stop' : 'Watch this word';
    star.querySelector('use').setAttribute('href', watched ? '#i-star-fill' : '#i-star');
    main.setAttribute('aria-label', `${it.w}, ${text} launches, ${change.text}. ${expanded ? 'Collapse' : 'Show details'}.`);
    updateLead(el, it);
  }

  function updateLead(el, it) {
    const a = el.querySelector('.m-lead');
    const lead = it.lead;
    if (!lead) {
      a.hidden = true;
      a.dataset.key = '';
      return;
    }
    a.hidden = false;
    const solUsd = state.snapshot?.solUsd;
    const key = [lead.m, lead.mc, lead.ch, lead.st, solUsd, state.settings.tokenSite].join('|');
    if (a.dataset.key === key) return;
    a.dataset.key = key;
    const launch = { mint: lead.m, pool: lead.p };
    const url = tokenUrl(launch, state.settings.tokenSite);
    if (url) a.href = url;
    else a.removeAttribute('href');
    const mc = formatMc(lead.mc, solUsd);
    const move = formatMove(lead.ch);
    const site = url ? ` Opens on ${TOKEN_SITES[tokenSite(launch, state.settings.tokenSite)].label}.` : '';
    a.title = `Most traded token with “${it.w}” right now: ${lead.n}, ${mc} market cap${move.text ? `, ${move.text} in 5 minutes` : ''}. ${TOKEN_STATUS[lead.st] || ''}.${site}`;
    a.innerHTML = `<span class="who"><i class="dot st-${esc(lead.st)}"></i><span class="ln">${esc(lead.n)}</span>${lead.s ? `<span class="ls">$${esc(lead.s)}</span>` : ''}</span><span class="lm">${esc(mc)}</span><span class="lc ${move.tone}">${esc(move.text)}</span>`;
  }

  function sparkBars(series) {
    if (!series || !series.length) return '';
    const n = series.length;
    const gap = 1.2;
    const w = (92 - gap * (n - 1)) / n;
    const max = Math.max(1, ...series);
    let out = '';
    series.forEach((v, i) => {
      const h = v ? Math.max(2, (v / max) * 20) : 1;
      const opacity = v ? 0.35 + 0.65 * (i / (n - 1)) : 0.2;
      out += `<rect x="${(i * (w + gap)).toFixed(2)}" y="${(20 - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="0.8" fill="currentColor" opacity="${opacity.toFixed(2)}"/>`;
    });
    return out;
  }

  function toggleExpand(word) {
    if (state.expanded === word) return collapse();
    collapse();
    const el = state.rows.get(word);
    if (!el) return;
    state.expanded = word;
    el.querySelector('.m-row-main').setAttribute('aria-expanded', 'true');
    const box = document.createElement('div');
    box.className = 'm-detail';
    el.append(box);
    const cached = state.details.get(word);
    if (cached && cached.window === state.window) renderDetail(cached);
    else box.innerHTML = '<p class="muted" style="margin:12px 0 0">Loading launches…</p>';
    requestWord(word);
  }

  function collapse() {
    if (!state.expanded) return;
    const el = state.rows.get(state.expanded);
    if (el) {
      el.querySelector('.m-row-main').setAttribute('aria-expanded', 'false');
      el.querySelector('.m-detail')?.remove();
    }
    state.expanded = null;
  }

  function requestWord(word) {
    state.detailsAt.set(word, Date.now());
    state.conn.send({ type: 'word', word, window: state.window });
  }

  function tradeLine(tk, solUsd) {
    const move = formatMove(tk.ch);
    const inner = `<i class="dot st-${esc(tk.st)}"></i><span class="nm">${esc(tk.name)}</span><span class="sym">${tk.symbol ? `$${esc(tk.symbol)}` : ''}</span><span class="mc">${esc(formatMc(tk.mc, solUsd))}</span><span class="chg ${move.tone}">${esc(move.text)}</span>`;
    const title = `${TOKEN_STATUS[tk.st] || ''}. Bonding curve ${tk.pg}% full.`;
    const url = tokenUrl(tk, state.settings.tokenSite);
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${inner}</a>` : `<span class="tok" title="${esc(title)}">${inner}</span>`;
  }

  function launchLine(launch, nameHtml) {
    const inner = `<span class="nm">${nameHtml}</span><span class="sym">${launch.symbol ? `$${esc(launch.symbol)}` : ''}</span><span class="age" data-t="${launch.t}">${timeAgo(launch.t)}</span>`;
    const url = tokenUrl(launch, state.settings.tokenSite);
    if (!url) return `<span class="tok" title="Demo token: made up, so it has no page anywhere">${inner}</span>`;
    const site = TOKEN_SITES[tokenSite(launch, state.settings.tokenSite)].label;
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open ${esc(launch.name)} on ${site}">${inner}</a>`;
  }

  function renderDetail(d) {
    const el = state.rows.get(d.word);
    if (!el) return;
    let box = el.querySelector('.m-detail');
    if (!box) {
      box = document.createElement('div');
      box.className = 'm-detail';
      el.append(box);
    }
    const watched = state.settings.watchlist.includes(d.word);
    const trading = Array.isArray(d.trading)
      ? `<h4>Trading now</h4>${d.trading.length ? `<ol class="trading">${d.trading.map((tk) => `<li>${tradeLine(tk, d.solUsd)}</li>`).join('')}</ol>` : '<p class="muted">No token with this word is trading right now.</p>'}`
      : '';
    const pairs = d.related.length
      ? `<h4>Launched together with</h4><div class="pairs">${d.related.map(([w, n]) => `<button class="pair" type="button" data-word="${esc(w)}" title="${n} launches use both">${esc(w)}<b>${n}</b></button>`).join('')}</div>`
      : '';
    const latest = d.examples.length
      ? `<h4>Latest launches</h4><ol class="latest">${d.examples
          .slice(0, 6)
          .map((ex) => {
            const dot = ex.st ? `<i class="dot st-${esc(ex.st)}" title="${esc(TOKEN_STATUS[ex.st] || '')}" style="margin-right:8px"></i>` : '';
            return `<li>${launchLine(ex, dot + esc(ex.name))}</li>`;
          })
          .join('')}</ol>`
      : `<p class="muted">No launches used this word in ${windowPhrase(d.window)}.</p>`;
    const actions = `<div class="m-actions">
        <a class="btn btn-light" href="${esc(xSearchUrl(d.word))}" target="_blank" rel="noopener noreferrer">Search on X <svg aria-hidden="true"><use href="#i-out"/></svg></a>
        <button class="btn btn-line" type="button" data-act="watch" aria-pressed="${watched}">${watched ? 'Watching' : 'Watch'}</button>
        <button class="btn btn-line" type="button" data-act="hide">Hide word</button>
      </div>`;
    box.innerHTML = trading + pairs + latest + actions;
  }

  function openWord(word) {
    if (!state.rows.has(word) && state.query) {
      els.filter.value = '';
      state.query = '';
      renderList();
    }
    if (!state.rows.has(word)) return toast(`“${word}” isn’t in the list right now.`);
    if (state.expanded !== word) toggleExpand(word);
    state.rows.get(word).scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // ---------------------------------------------------------------- feed

  function hotWords() {
    const set = new Set(state.settings.watchlist);
    const snap = state.snapshot;
    if (snap) for (const w of [...snap.words].sort((a, b) => b.c - a.c).slice(0, 10)) set.add(w.w);
    return set;
  }

  function highlightName(name, words, hot) {
    const lower = name.toLowerCase();
    if (lower.length !== name.length) return esc(name);
    const ranges = [];
    for (const w of words || []) {
      if (!hot.has(w)) continue;
      const i = lower.indexOf(w);
      if (i >= 0) ranges.push([i, i + w.length]);
    }
    if (!ranges.length) return esc(name);
    ranges.sort((a, b) => a[0] - b[0]);
    let out = '';
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a < pos) continue;
      out += esc(name.slice(pos, a)) + `<mark>${esc(name.slice(a, b))}</mark>`;
      pos = b;
    }
    return out + esc(name.slice(pos));
  }

  function feedItem(launch, fresh, hot) {
    const li = document.createElement('li');
    if (fresh && !reduceMotion) li.className = 'fresh';
    li.innerHTML = launchLine(launch, highlightName(launch.name, launch.words, hot));
    return li;
  }

  function renderFeed() {
    const hot = hotWords();
    els.feed.replaceChildren(...state.feedItems.map((l) => feedItem(l, false, hot)));
  }

  function addLaunch(launch, fresh) {
    state.feedItems.unshift(launch);
    if (state.feedItems.length > FEED_MAX) state.feedItems.length = FEED_MAX;
    if (!state.active) return;
    els.feed.prepend(feedItem(launch, fresh, hotWords()));
    while (els.feed.children.length > FEED_MAX) els.feed.lastChild.remove();
  }

  // ---------------------------------------------------------------- controls

  function renderControls() {
    const current = state.pendingWindow ?? state.window;
    els.windows.innerHTML = state.windows
      .map((m) => {
        const locked = !state.allowed.includes(m);
        return `<button type="button" role="radio" aria-checked="${m === current}" data-window="${m}" title="${locked ? 'For holders' : `Words in ${windowPhrase(m)}`}" aria-label="${windowLabel(m)}${locked ? ', for holders' : ''}">${windowLabel(m)}${locked ? '<svg aria-hidden="true"><use href="#i-lock"/></svg>' : ''}</button>`;
      })
      .join('');
    for (const b of els.sorts.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.sort === state.settings.sort));
  }

  function chooseWindow(minutes) {
    if (!state.allowed.includes(minutes)) return showHolderNotice(minutes);
    if (state.noticeKind === 'holder') hideNotice();
    if (minutes === state.window && !state.pendingWindow) return;
    state.window = minutes;
    state.pendingWindow = minutes;
    state.lastCounts.clear();
    state.settings.window = minutes;
    save();
    els.words.classList.add('loading');
    state.conn.send({ type: 'window', window: minutes });
    renderControls();
    if (state.expanded) requestWord(state.expanded);
  }

  function chooseSort(sort) {
    if (sort === state.settings.sort) return;
    state.settings.sort = sort;
    save();
    renderControls();
    renderList();
  }

  function toggleWatch(word, force) {
    const list = new Set(state.settings.watchlist);
    const on = force ?? !list.has(word);
    if (on) list.add(word);
    else list.delete(word);
    state.settings.watchlist = [...list];
    save();
    renderList();
    renderChips();
    renderFeed();
    const detail = state.details.get(word);
    if (detail && state.expanded === word) renderDetail(detail);
    if (on) toast(`Watching “${word}”. You’ll see a notice when it heats up.`);
  }

  function hideWord(word, hide = true) {
    const set = new Set(state.settings.hidden);
    if (hide) set.add(word);
    else set.delete(word);
    state.settings.hidden = [...set];
    save();
    if (hide && state.expanded === word) collapse();
    renderList();
    renderChips();
    if (hide) toast(`“${word}” is hidden. The Watchlist panel lists hidden words.`);
  }

  function chip(word, act) {
    return `<li class="chip" data-word="${esc(word)}"><span>${esc(word)}</span><button type="button" data-act="${act}" aria-label="${act === 'unwatch' ? 'Stop watching' : 'Show again'} ${esc(word)}"><svg aria-hidden="true"><use href="#i-close"/></svg></button></li>`;
  }

  function renderChips() {
    els.watch.innerHTML = state.settings.watchlist.map((w) => chip(w, 'unwatch')).join('');
    els.watchNote.hidden = state.settings.watchlist.length > 0;
    els.hidden.innerHTML = state.settings.hidden.map((w) => chip(w, 'unhide')).join('');
    els.hiddenWrap.hidden = state.settings.hidden.length === 0;
  }

  // A watched word that is climbing gets a notice, at most every 15 minutes per word.
  function checkWatchlist(snap) {
    if (!state.settings.watchlist.length || !snap.warm) return;
    const now = Date.now();
    for (const w of snap.words) {
      if (!state.settings.watchlist.includes(w.w)) continue;
      if (w.c < 5 || w.z < 2) continue;
      if (now - (state.alerted.get(w.w) || 0) < 15 * 60_000) continue;
      state.alerted.set(w.w, now);
      const change = formatChange(w.c, w.p, snap.warm);
      toast(`“${w.w}” is heating up: ${w.c} launches in ${windowPhrase(snap.window)} (${change.text}).`, 5000);
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try {
          new Notification(`Moth: “${w.w}” is heating up`, { body: `${w.c} launches in ${windowPhrase(snap.window)} (${change.text}).` });
        } catch {
          /* notifications unavailable */
        }
      }
    }
  }

  // ---------------------------------------------------------------- holder verification (server with HOLDER_MINT)

  function startVerify() {
    const session = randomHex(16);
    state.verify = { session, until: Date.now() + 10 * 60_000 };
    window.open(`/moth/verify?session=${session}`, '_blank', 'noopener');
    showNotice('verifying', '<p>Finish the wallet check in the new tab. This page picks up your access on its own.</p>');
    pollClaim();
  }

  async function pollClaim() {
    clearTimeout(state.verifyTimer);
    const v = state.verify;
    if (!v) return;
    if (Date.now() > v.until) {
      state.verify = null;
      return hideNotice();
    }
    try {
      const res = await fetch(`/moth/api/claim?session=${v.session}`, { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        if (body.key) {
          state.verify = null;
          state.settings.accessKey = body.key;
          save();
          hideNotice();
          state.conn.restart();
          return toast('Holder access unlocked.');
        }
      }
    } catch {
      /* keep polling */
    }
    if (state.verify === v) state.verifyTimer = setTimeout(pollClaim, 2000);
  }

  // ---------------------------------------------------------------- events

  els.windows.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-window]');
    if (b) chooseWindow(Number(b.dataset.window));
  });
  els.sorts.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sort]');
    if (b) chooseSort(b.dataset.sort);
  });
  for (const group of [els.windows, els.sorts]) {
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const buttons = [...group.querySelectorAll('button')];
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      next.focus();
      next.click();
      e.preventDefault();
    });
  }
  els.filter.addEventListener('input', () => {
    state.query = els.filter.value.trim().toLowerCase().replace(/^[$#]+/, '');
    renderList();
  });
  els.site.addEventListener('change', () => {
    state.settings.tokenSite = els.site.value;
    save();
    for (const el of state.rows.values()) el.querySelector('.m-lead').dataset.key = '';
    renderList();
    renderFeed();
    const d = state.expanded && state.details.get(state.expanded);
    if (d) renderDetail(d);
  });
  els.words.addEventListener('click', (e) => {
    const row = e.target.closest('.m-row');
    if (!row) return;
    const word = row.dataset.word;
    if (e.target.closest('.m-star')) {
      e.stopPropagation();
      return toggleWatch(word);
    }
    const pair = e.target.closest('.pair');
    if (pair) return openWord(pair.dataset.word);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'watch') return toggleWatch(word);
    if (act === 'hide') return hideWord(word);
    if (e.target.closest('.m-row-main')) toggleExpand(word);
    return undefined;
  });
  els.words.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('m-row-main')) {
      e.preventDefault();
      toggleExpand(e.target.closest('.m-row').dataset.word);
    }
  });
  const view = document.getElementById('view-moth');
  view.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || e.target.closest('#m-words')) return;
    const word = e.target.closest('[data-word]')?.dataset.word;
    if (act === 'retry') state.conn.retryNow();
    else if (act === 'dismiss') hideNotice();
    else if (act === 'verify') startVerify();
    else if (act === 'unwatch') toggleWatch(word, false);
    else if (act === 'unhide') hideWord(word, false);
  });
  els.watchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = splitWords(els.watchInput.value);
    if (!words.length) return toast('Type a word, like otter.');
    for (const w of words) toggleWatch(cleanWord(w), true);
    els.watchInput.value = '';
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    return undefined;
  });
  $('#m-help-open').addEventListener('click', () => {
    els.help.hidden = false;
    els.help.querySelector('[data-close-help]').focus();
  });
  els.help.addEventListener('click', (e) => {
    if (e.target === els.help || e.target.closest('[data-close-help]')) els.help.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.help.hidden) els.help.hidden = true;
  });
  setInterval(() => {
    if (!state.active) return;
    const now = Date.now();
    for (const el of view.querySelectorAll('.age[data-t]')) el.textContent = timeAgo(Number(el.dataset.t), now);
    if (state.snapshot && !state.snapshot.warm) renderSummary();
  }, 5000);

  renderControls();
  renderChips();
  renderStatus();
  showEmpty('connecting');

  // Start reading launches last, so every handler above is in place.
  if (env.mode === 'server') {
    startTransport('ws');
  } else if (env.mode === 'demo') {
    startTransport('demo');
  } else {
    // No server: read pump.fun from the browser; fall back to demo data if that is blocked.
    startTransport('live');
    setTimeout(() => {
      if (state.transport === 'live' && !state.conn.connected) {
        state.fellBack = true;
        startTransport('demo');
      }
    }, 7000);
  }

  return {
    setActive(on) {
      const was = state.active;
      state.active = on;
      if (on && !was) {
        renderList();
        renderSummary();
        renderFeed();
      }
    },
  };
}
