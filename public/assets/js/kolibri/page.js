// Kolibri Search page: paste an X account (or a post link, or a Telegram channel) and see
// every token they called: the market cap when they posted and what it was 1 minute,
// 5 minutes, 1 hour and 24 hours later.
// Server mode asks this site's server; without a server it shows made-up sample callers.

import './lib/config.js';
import './lib/score.js';
import './lib/format.js';
import { $, esc, toast, local, avatarColor } from '../ui.js';

const K = globalThis.Kolibri;
const F = K.format;
const CFG = K.config;
const isNum = F.isNum;
const LAST_KEY = 'pumprint.kolibri.last';
const POLL_MS = 3000;
const HORIZONS = [
  { key: '1m', label: '1m', long: '1 minute', sec: 60 },
  { key: '5m', label: '5m', long: '5 minutes', sec: 300 },
  { key: '1h', label: '1h', long: '1 hour', sec: 3600 },
  { key: '24h', label: '24h', long: '24 hours', sec: 86400 },
];
const OUT = new Set(['unresolved', 'no-entry', 'too-old']);
const counted = (c) => !OUT.has(c.status);

// "$40K", "$1.2M"
export function mcap(v) {
  if (!isNum(v) || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(v)}`;
}

export function initKolibri(env) {
  const els = {
    form: $('#k-search'),
    query: $('#k-query'),
    notice: $('#k-notice'),
    hint: $('#k-hint'),
    main: $('#k-main'),
    board: $('#k-board'),
    boardTabs: $('#k-board-tabs'),
    mode: document.querySelector('[data-k-mode]'),
  };
  const live = env.mode === 'server';
  const demoServer = live && env.site && env.site.demo;
  const sample = !live || demoServer;
  const xSource = live ? env.site && env.site.kolibri && env.site.kolibri.x : 'sample';
  const state = {
    platform: 'x',
    current: null, // { platform, handle }
    focus: null, // post id to highlight
    data: null,
    filter: 'all',
    horizon: '1h',
    sort: { field: 'postedAt', dir: -1 },
    pollTimer: null,
    pollUntil: 0,
    boardPlatform: '',
    demo: null,
  };

  if (sample) els.mode.innerHTML = '<span class="mode-badge">Sample data</span>';

  // ---------------------------------------------------------------- data access

  async function demoData() {
    if (!state.demo) {
      const raw = (await import('./demo-data.js')).default;
      state.demo = shiftTimes(raw, Date.now() - raw.builtAt);
    }
    return state.demo;
  }

  async function api(path, opts) {
    const res = await fetch(path, { cache: 'no-store', ...opts });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = new Error((body && body.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = body && body.error;
      throw err;
    }
    return body;
  }

  // ---------------------------------------------------------------- search

  function setPlatform(p) {
    state.platform = p;
    for (const b of els.form.querySelectorAll('[data-platform]')) b.setAttribute('aria-checked', String(b.dataset.platform === p));
    els.query.placeholder = p === 'x' ? 'x.com/handle or a link to their post' : 't.me/channel or channel name';
    const noX = live && !demoServer && !xSource;
    els.hint.hidden = !(p === 'x' && noX);
  }

  function parseQuery(raw) {
    let s = String(raw || '').trim();
    const status = /(?:^|\/\/|\.)(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i.exec(s) || /^(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/i.exec(s);
    if (status) return { platform: 'x', handle: status[1], postId: status[2] };
    let platform = state.platform;
    if (/(^|\/\/|\.)(x|twitter)\.com\//i.test(s)) platform = 'x';
    else if (/(^|\/\/)(t|telegram)\.me\//i.test(s)) platform = 'tg';
    s = s.replace(/^https?:\/\//i, '').replace(/^(www\.|mobile\.)/i, '');
    s = s.replace(/^(t\.me|telegram\.me)\/(s\/)?/i, '').replace(/^(x\.com|twitter\.com)\//i, '').replace(/^@/, '');
    s = s.split(/[/?#\s]/)[0];
    return { platform, handle: s, postId: null };
  }

  async function search(raw) {
    const q = parseQuery(raw);
    if (!q.handle) return toast('Paste an X account or a link to their post.');
    if (q.platform !== state.platform) setPlatform(q.platform);
    hideNotice();
    stopPolling();
    if (sample) return openSample(q, true);
    renderLoading(q.platform, q.handle, Boolean(q.postId));
    try {
      const body = await api('/api/kolibri/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: String(raw).trim(), platform: q.platform }),
      });
      state.current = { platform: body.platform, handle: body.handle };
      state.focus = body.postId || null;
      local.set(LAST_KEY, state.current);
      if (body.noCall) showNotice('<b>No call in this post.</b> It has no $ticker or contract address, so there is nothing to measure. The caller’s other checked posts are below.');
      else if (body.limited) showNotice('<b>Only the posts pasted here.</b> This server can’t read whole X accounts yet (that needs an X data key), so the card shows the posts people linked.');
      accept(body);
    } catch (err) {
      renderError(q.platform, q.handle, err.message);
    }
    return undefined;
  }

  // Server answer: { key, collecting, error, queued, card }
  function accept(body) {
    if (body.error && !body.card) return renderError(state.current.platform, state.current.handle, body.error);
    if (!body.card) {
      renderLoading(state.current.platform, state.current.handle);
    } else {
      state.data = { ...body.card, collecting: body.collecting, queued: body.queued || 0, error: body.error };
      renderCard();
    }
    const busy = body.collecting || (body.queued || 0) > 0;
    if (busy) schedulePoll();
    else stopPolling();
    return undefined;
  }

  function schedulePoll() {
    if (!state.pollUntil) state.pollUntil = Date.now() + 20 * 60_000;
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(poll, POLL_MS);
  }

  function stopPolling() {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
    state.pollUntil = 0;
  }

  async function poll() {
    const cur = state.current;
    if (!cur || Date.now() > state.pollUntil) return stopPolling();
    try {
      const body = await api(`/api/kolibri/card?platform=${cur.platform}&handle=${encodeURIComponent(cur.handle)}`);
      if (state.current !== cur) return undefined;
      accept(body);
      if (!body.collecting && !body.queued) loadBoard();
    } catch {
      schedulePoll();
    }
    return undefined;
  }

  async function openCard(platform, handle) {
    hideNotice();
    stopPolling();
    state.focus = null;
    if (sample) return openSample({ platform, handle }, false);
    state.current = { platform, handle };
    local.set(LAST_KEY, state.current);
    renderLoading(platform, handle);
    try {
      accept(await api(`/api/kolibri/card?platform=${platform}&handle=${encodeURIComponent(handle)}`));
    } catch (err) {
      if (err.status === 404) return search(`${platform === 'x' ? 'x.com/' : 't.me/'}${handle}`);
      renderError(platform, handle, err.message);
    }
    return undefined;
  }

  async function openSample(q, fromSearch) {
    const demo = await demoData();
    const key = `${q.platform}:${String(q.handle).toLowerCase()}`;
    const card = demo.cards[key];
    if (card) {
      state.current = { platform: q.platform, handle: card.author.handle };
      state.data = { ...card, collecting: false, queued: 0 };
      state.focus = q.postId || null;
      state.filter = 'all';
      renderCard();
      return;
    }
    if (fromSearch) {
      const why = demoServer || env.mode === 'demo'
        ? 'This site runs on sample data right now.'
        : 'Real lookups run on the site’s server, and this copy of the site has none.';
      const chips = Object.values(demo.cards)
        .map((c) => `<button type="button" data-open="${c.author.platform}:${esc(c.author.handle)}">${c.author.platform === 'x' ? '@' : 't.me/'}${esc(c.author.handle)}</button>`)
        .join('');
      showNotice(`<b>Sample data.</b> ${esc(why)} On the deployed site, links to X posts and Telegram channels work right away, and whole X accounts once the server has an X data key. These made-up callers show what you get:<div class="k-try">${chips}</div>`);
    }
  }

  // ---------------------------------------------------------------- leaderboard

  async function loadBoard() {
    let items = [];
    if (!sample) {
      try {
        const q = state.boardPlatform ? `&platform=${state.boardPlatform}` : '';
        items = (await api(`/api/kolibri/leaderboard?limit=30${q}`)).items || [];
      } catch {
        items = [];
      }
    } else {
      const demo = await demoData();
      items = demo.leaderboard.filter((it) => !state.boardPlatform || it.author.platform === state.boardPlatform);
    }
    renderBoard(items);
    return items;
  }

  function renderBoard(items) {
    if (!items.length) {
      els.board.innerHTML = '<li class="board-empty">No callers yet. Search an X account and it joins the board once its calls are measured.</li>';
      return;
    }
    let rank = 0;
    els.board.innerHTML = items
      .map((it) => {
        const s = it.summary || {};
        const a = it.author || {};
        const label = a.platform === 'tg' ? `t.me/${a.handle}` : `@${a.handle}`;
        const n = s.grade ? ++rank : '';
        return `<li><button type="button" data-open="${esc(a.platform)}:${esc(a.handle)}">
          <span class="n">${n}</span>
          <span class="who"><b>${esc(a.name || a.handle)}</b><small>${esc(label)} · ${s.calls || 0} calls</small></span>
          <span class="w7" title="Share of calls up an hour after the post">${F.share(s.up1h)}</span>
          <span class="grade t-${esc(s.grade ? s.tone : 'none')}">${esc(s.grade || '?')}</span>
        </button></li>`;
      })
      .join('');
    markBoardCurrent();
  }

  function markBoardCurrent() {
    for (const b of els.board.querySelectorAll('button[data-open]')) {
      const [p, h] = b.dataset.open.split(':');
      const cur = state.current && state.current.platform === p && state.current.handle.toLowerCase() === h.toLowerCase();
      if (cur) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  // ---------------------------------------------------------------- rendering

  function hideNotice() {
    els.notice.hidden = true;
    els.notice.innerHTML = '';
  }

  function showNotice(html) {
    els.notice.innerHTML = html;
    els.notice.hidden = false;
  }

  function avatarHtml(platform, handle, name, avatar) {
    const letter = esc(String(name || handle || '?').slice(0, 1).toUpperCase());
    const img = avatar && /^https:\/\//.test(avatar) ? `<img src="${esc(avatar)}" alt="" onerror="this.remove()">` : '';
    return `<span class="kc-av" style="--av:${avatarColor(`${platform}:${handle}`)}">${img}${letter}</span>`;
  }

  function renderLoading(platform, handle, onePost) {
    const label = platform === 'tg' ? `t.me/${handle}` : `@${handle}`;
    const what = onePost ? 'Reading the post and measuring the call…' : platform === 'tg' ? 'Reading the channel’s public posts…' : 'Reading their posts on X…';
    els.main.innerHTML = `<div class="kc"><div class="kc-head">${avatarHtml(platform, handle, handle, null)}
        <div class="kc-id"><h2>${esc(handle)}</h2><span class="h">${esc(label)}</span></div></div>
      <div class="kc-progress"><span class="spin" aria-hidden="true"></span><span>${what}</span></div></div>`;
  }

  function renderError(platform, handle, message) {
    els.main.innerHTML = `<div class="k-empty"><h2>No report card for ${esc(platform === 'tg' ? `t.me/${handle}` : `@${handle}`)}</h2><p>${esc(message)}</p></div>`;
  }

  function renderEmptyStart() {
    els.main.innerHTML = `<div class="k-empty">
      <h2>Paste an X account</h2>
      <p>Kolibri reads their posts, finds every $ticker and contract address, and measures each call: the market cap when they posted, and 1 minute, 5 minutes, 1 hour and 24 hours later. A long history takes a few minutes to measure.</p>
    </div>`;
  }

  function cell(c, h) {
    const r = c[`r${h.key}`];
    if (isNum(r)) {
      const mc = isNum(c.entryMc) ? mcap(c.entryMc * (1 + r)) : '';
      return `<td class="hz"><b class="${F.tone(r)}">${esc(F.ret(r))}</b>${mc ? `<small>${esc(mc)}</small>` : ''}</td>`;
    }
    if (c.status === 'new' || c.status === 'error') return '<td class="hz"><span class="muted" title="Measuring">…</span></td>';
    const due = c.postedAt + h.sec * 1000;
    if (due > Date.now() && counted(c)) return `<td class="hz"><span class="muted" title="Not due yet">${esc(F.until(due))}</span></td>`;
    if (c.frame === '15m' && h.sec < 3600) return '<td class="hz"><span class="muted" title="Only 15-minute prices exist for this call">—</span></td>';
    return `<td class="hz"><span class="muted" title="${esc(reason(c))}">n/a</span></td>`;
  }

  function reason(call) {
    switch (call.status) {
      case 'too-old':
        return 'older than the free price history';
      case 'no-entry':
        return 'not trading at the time of the post';
      case 'unresolved':
        return 'no market found';
      default:
        return 'no price';
    }
  }

  const FILTERS = [
    ['all', 'All', () => true],
    ['up', 'Up after 1h', (c) => counted(c) && isNum(c.r1h) && c.r1h > 0],
    ['down', 'Down after 1h', (c) => counted(c) && isNum(c.r1h) && c.r1h <= 0],
    ['wait', 'Waiting', (c) => counted(c) && !isNum(c.r24h)],
    ['na', 'No price', (c) => !counted(c)],
  ];

  function filterButtons(calls) {
    return FILTERS.map(([key, label, fn]) => {
      const n = calls.filter(fn).length;
      if (key !== 'all' && !n) return '';
      return `<button type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}<span>${n}</span></button>`;
    }).join('');
  }

  function sortHead(field, label) {
    const on = state.sort.field === field;
    return `<th${on ? ` aria-sort="${state.sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${field}">${label}</button></th>`;
  }

  function rows(calls) {
    const fn = (FILTERS.find((f) => f[0] === state.filter) || FILTERS[0])[2];
    const { field, dir } = state.sort;
    const list = calls.filter(fn).sort((a, b) => {
      const va = a[field];
      const vb = b[field];
      if (!isNum(va) && !isNum(vb)) return b.postedAt - a.postedAt;
      if (!isNum(va)) return 1;
      if (!isNum(vb)) return -1;
      return (va - vb) * dir;
    });
    if (!list.length) return '<tr><td colspan="9"><span class="muted">No calls in this view.</span></td></tr>';
    return list
      .map((c) => {
        const m = c.market;
        const chain = (m && m.chain) || (c.token && c.token.chain) || '';
        const addr = c.token && c.token.address ? `<small title="${esc(c.token.address)}">${esc(F.shortAddr(c.token.address))}${chain ? ` · ${esc(chain)}` : ''}</small>` : '';
        const tok = m && !sample
          ? `<a href="${esc(F.safeUrl(m.url))}" target="_blank" rel="noopener noreferrer"><b>${esc(F.tokenLabel(c))}</b></a>`
          : `<b>${esc(F.tokenLabel(c))}</b>`;
        const post = sample ? '<span class="muted">sample</span>' : `<a href="${esc(F.safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">Post</a>`;
        const peak = isNum(c.rPeak) && counted(c)
          ? `<td class="hz"><b class="${F.tone(c.rPeak)}">${esc(F.ret(c.rPeak))}</b>${isNum(c.entryMc) ? `<small>${esc(mcap(c.entryMc * (1 + c.rPeak)))}</small>` : ''}</td>`
          : '<td class="hz"><span class="muted">—</span></td>';
        const focus = state.focus && c.postId === state.focus ? ' class="focus"' : '';
        return `<tr${focus}>
          <td title="${esc(c.snippet || '')}">${esc(F.dateTime(c.postedAt))}</td>
          <td class="tok">${tok}${c.mentions > 1 ? ` <span class="muted" title="Posted ${c.mentions} times within 7 days">×${c.mentions}</span>` : ''}${addr}</td>
          <td class="hz cap"><b>${esc(mcap(c.entryMc))}</b>${isNum(c.entry) && !isNum(c.entryMc) ? `<small>${esc(F.price(c.entry))}</small>` : ''}</td>
          ${HORIZONS.map((h) => cell(c, h)).join('')}
          ${peak}
          <td>${post}</td>
        </tr>`;
      })
      .join('');
  }

  // Symmetric log scale capped at ±300%, as in Kolibri's report.
  function scaled(r) {
    const v = Math.min(1, Math.log(1 + 4 * Math.abs(r)) / Math.log(13));
    return r >= 0 ? v : -v;
  }

  function chart(calls) {
    const h = HORIZONS.find((x) => x.key === state.horizon) || HORIZONS[2];
    const pts = calls.filter(counted).sort((a, b) => a.postedAt - b.postedAt);
    if (pts.filter((c) => isNum(c[`r${h.key}`])).length < 2) return '';
    const narrow = (document.getElementById('view-kolibri').clientWidth || window.innerWidth) < 640; // its side in the split view, else the window
    const W = narrow ? 560 : 1000;
    const H = narrow ? 210 : 230;
    const left = 52;
    const right = 8;
    const top = 10;
    const bottom = 26;
    const half = (H - top - bottom) / 2;
    const mid = top + half;
    const y = (r) => mid - scaled(r) * half;
    const grid = [[3, '4x'], [1, '2x'], [0.25, '+25%'], [0, '0%'], [-0.25, '−25%'], [-0.75, '−75%']]
      .map(([r, lab]) => `<line class="${r === 0 ? 'zero' : 'gl'}" x1="${left}" x2="${W - right}" y1="${y(r).toFixed(1)}" y2="${y(r).toFixed(1)}"/><text class="ax" x="${left - 8}" y="${(y(r) + 3.5).toFixed(1)}" text-anchor="end">${lab}</text>`)
      .join('');
    const n = pts.length;
    const slot = (W - left - right - 8) / n;
    const bw = Math.max(2, Math.min(34, slot * 0.6));
    const bars = pts
      .map((c, i) => {
        const x = left + 8 + i * slot + (slot - bw) / 2;
        const r = c[`r${h.key}`];
        if (!isNum(r)) {
          return `<rect class="bar-wait" x="${x.toFixed(1)}" y="${(mid - 1.5).toFixed(1)}" width="${bw.toFixed(1)}" height="3" rx="1.5"><title>${esc(F.tokenLabel(c))}: result after ${h.long} not in yet</title></rect>`;
        }
        const yy = y(r);
        const hh = Math.max(1.5, Math.abs(yy - mid));
        const mc = isNum(c.entryMc) ? `, ${mcap(c.entryMc)} → ${mcap(c.entryMc * (1 + r))}` : '';
        return `<rect class="${r >= 0 ? 'bar-up' : 'bar-down'}" x="${x.toFixed(1)}" y="${(r >= 0 ? mid - hh : mid).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="2"><title>${esc(F.tokenLabel(c))}: ${esc(F.ret(r))} after ${h.long}${esc(mc)}, called ${esc(F.date(c.postedAt))}</title></rect>`;
      })
      .join('');
    const dates = `<text class="ax" x="${left + 8}" y="${H - 6}">${esc(F.date(pts[0].postedAt))}</text><text class="ax" x="${W - right}" y="${H - 6}" text-anchor="end">${esc(F.date(pts[n - 1].postedAt))}</text>`;
    const tabs = HORIZONS.map((x) => `<button type="button" role="radio" aria-checked="${x.key === h.key}" data-horizon="${x.key}">${x.label}</button>`).join('');
    return `<div class="kc-chart"><div class="kc-chart-head"><h3>Result of every call after ${h.long}</h3><div class="seg seg-sm" role="radiogroup" aria-label="Horizon">${tabs}</div></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Result of each call after ${h.long}, oldest to newest">${grid}${bars}${dates}</svg></div>`;
  }

  function renderCard() {
    const d = state.data;
    const a = d.author || {};
    const s = d.summary || {};
    const calls = d.calls || [];
    const label = a.platform === 'tg' ? `t.me/${a.handle}` : `@${a.handle}`;
    if (!calls.length && !d.collecting) {
      els.main.innerHTML = `<div class="k-empty"><h2>No calls found for ${esc(label)}</h2><p>${
        d.error
          ? esc(d.error)
          : `Kolibri read ${a.platform === 'tg' ? 'the channel’s public posts' : 'their recent posts'} and found no $tickers or contract addresses. Stablecoins and majors like BTC or SOL are not counted.`
      }</p></div>`;
      markBoardCurrent();
      return;
    }
    const platformName = a.platform === 'tg' ? 'Telegram' : 'X';
    const profile = a.platform === 'tg' ? `https://t.me/${encodeURIComponent(a.handle)}` : `https://x.com/${encodeURIComponent(a.handle)}`;
    const total = calls.length;
    const waiting = calls.filter((c) => c.status === 'new' || c.status === 'error').length;
    const progress = d.collecting || waiting
      ? `<div class="kc-progress"><span class="spin" aria-hidden="true"></span><span>${d.collecting ? 'Reading posts…' : `Measuring calls: ${total - waiting} of ${total} done.`}</span><span class="bar"><i style="width:${total ? Math.round(((total - waiting) / total) * 100) : 5}%"></i></span></div>`
      : '';
    const grade = s.grade
      ? `<div><b>Score ${s.score}</b><span>from ${F.plural(s.priced1h, 'call')} with a 1-hour result</span></div><span class="grade t-${esc(s.tone)}">${esc(s.grade)}</span>`
      : `<div><b>No grade yet</b><span>needs 3 calls with a 1-hour result</span></div><span class="grade t-none">?</span>`;
    const hundred = isNum(s.avg1h) ? 100 * (1 + s.avg1h) : null;
    const stats = [
      [String(s.calls ?? 0), 'calls', ''],
      [mcap(s.medCallMc), 'typical market cap at the call', ''],
      [F.share(s.up1h), 'up an hour later', ''],
      [F.share(s.hit2x), 'did 2x or more within 24h', ''],
      [F.ret(s.medPeak), 'median peak within 24h', F.tone(s.medPeak)],
      [isNum(hundred) ? `$${Math.round(hundred).toLocaleString('en-US')}` : '—', '$100 in every call, sold after 1h', isNum(s.avg1h) ? F.tone(s.avg1h) : ''],
    ];
    const strip = HORIZONS.map((h) => {
      const med = s[`med${h.key === '24h' ? '24' : h.key}`];
      const up = s[`up${h.key === '24h' ? '24' : h.key}`];
      return `<div><span class="hz-k">After ${h.long}</span><b class="${F.tone(med)}">${esc(F.ret(med))}</b><span>median · ${esc(F.share(up))} up</span></div>`;
    }).join('');
    els.main.innerHTML = `<article class="kc">
      <div class="kc-head">
        ${avatarHtml(a.platform, a.handle, a.name, a.avatar)}
        <div class="kc-id"><h2>${esc(a.name || a.handle)}</h2>${sample ? `<span class="h">${esc(label)} on ${platformName} · made-up caller</span>` : `<a href="${esc(profile)}" target="_blank" rel="noopener noreferrer">${esc(label)} on ${platformName}</a>`}</div>
        <div class="kc-score">${grade}</div>
      </div>
      ${progress}
      <div class="kc-stats">${stats.map(([v, l, t]) => `<div><b class="${t}">${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="kc-strip" aria-label="Median result after each horizon">${strip}</div>
      ${chart(calls)}
      <div class="kc-calls">
        <div class="kc-tools"><h3>Every call</h3><div class="kc-filters" role="group" aria-label="Filter calls">${filterButtons(calls)}</div></div>
        <div class="table-wrap"><table class="kc-table">
          <thead><tr>
            ${sortHead('postedAt', 'Called')}<th>Token</th>${sortHead('entryMc', 'Call mcap')}
            ${HORIZONS.map((h) => sortHead(`r${h.key}`, h.label)).join('')}
            ${sortHead('rPeak', 'Peak 24h')}<th>Post</th>
          </tr></thead>
          <tbody>${rows(calls)}</tbody>
        </table></div>
      </div>
      <div class="kc-foot"><span>${sample ? 'Sample data: made-up posts measured on a simulated market.' : `Market cap at the minute of the post, then 1 minute, 5 minutes, 1 hour and 24 hours later. Read from ${a.platform === 'tg' ? 'the channel’s public posts' : 'their posts on X'}.`}</span>${d.total > calls.length ? `<span>Showing ${calls.length} of ${d.total} calls.</span>` : ''}</div>
    </article>`;
    markBoardCurrent();
    if (state.focus) {
      const row = els.main.querySelector('tr.focus');
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------------- events

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    search(els.query.value);
  });
  els.form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-platform]');
    if (!b) return;
    setPlatform(b.dataset.platform);
    els.query.focus();
  });
  els.boardTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-board]');
    if (!b) return;
    state.boardPlatform = b.dataset.board;
    for (const x of els.boardTabs.querySelectorAll('[data-board]')) x.setAttribute('aria-checked', String(x === b));
    loadBoard();
  });
  document.getElementById('view-kolibri').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const [p, ...rest] = open.dataset.open.split(':');
      openCard(p, rest.join(':'));
      if ((document.getElementById('view-kolibri').clientWidth || window.innerWidth) < 1180) els.main.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!state.data) return;
    const f = e.target.closest('[data-filter]');
    if (f) {
      state.filter = f.dataset.filter;
      renderCard();
      return;
    }
    const hz = e.target.closest('[data-horizon]');
    if (hz) {
      state.horizon = hz.dataset.horizon;
      renderCard();
      return;
    }
    const sortBtn = e.target.closest('th button[data-sort]');
    if (sortBtn) {
      const field = sortBtn.dataset.sort;
      state.sort = state.sort.field === field ? { field, dir: -state.sort.dir } : { field, dir: -1 };
      renderCard();
    }
  });

  // ---------------------------------------------------------------- first view

  setPlatform('x');
  (async () => {
    const items = await loadBoard();
    const last = !sample ? local.get(LAST_KEY, null) : null;
    if (last && last.platform && last.handle) return openCard(last.platform, last.handle);
    const top = items.find((it) => it.summary && it.summary.grade) || items[0];
    if (top) return openCard(top.author.platform, top.author.handle);
    return renderEmptyStart();
  })();

  return {
    setActive(on) {
      if (!on) return;
      if (state.pollTimer === null && state.data && (state.data.collecting || state.data.queued)) schedulePoll();
    },
  };
}

// Sample data was built at a fixed moment; move every timestamp so it reads as recent.
function shiftTimes(data, delta) {
  const TIME_KEYS = new Set(['postedAt', 'entryAt', 'peakAt', 'nextCheckAt', 'checkedAt', 'firstAt', 'lastAt', 'computedAt', 'updatedAt', 'lastMentionAt']);
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = TIME_KEYS.has(k) && typeof x === 'number' ? x + delta : walk(x);
      return o;
    }
    return v;
  };
  return walk(data);
}
