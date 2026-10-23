// Entry point: header, tabs, contract address, social buttons, and lazy pages.

import { $, $$, toast, copyText, local } from './ui.js';
import { renderAllRansom } from './ransom.js';
import { getEnv } from './env.js';
import { initAbout } from './about.js';

const CFG = window.PUMPRINT_CONFIG || {};
const TOOLS = ['kolibri', 'moth', 'chameleon', 'loxley', 'canary', 'fomo'];
// What can sit in one side of the split view: any tool, and the guide.
const PANES = [...TOOLS, 'learn'];
const VIEWS = ['about', 'learn', 'roadmap', ...TOOLS, 'telegram'];
const TITLES = {
  about: '',
  learn: 'Learn',
  roadmap: 'Roadmap',
  kolibri: 'Kolibri Search',
  moth: 'Moth Radar',
  chameleon: 'Chameleonscope',
  loxley: 'Loxley',
  canary: 'Canary',
  fomo: 'Fomo Radar',
  telegram: 'Telegram',
};
// Each tool page is its own module, loaded the first time the tab opens.
const PAGES = {
  kolibri: () => import('./kolibri/page.js').then((m) => m.initKolibri),
  moth: () => import('./moth/page.js').then((m) => m.initMoth),
  chameleon: () => import('./chameleon/page.js').then((m) => m.initChameleon),
  loxley: () => import('./loxley/page.js').then((m) => m.initLoxley),
  canary: () => import('./canary/page.js').then((m) => m.initCanary),
  fomo: () => import('./fomo/page.js').then((m) => m.initFomo),
  learn: () => import('./learn/page.js').then((m) => m.initLearn),
};
// Two sides need room: below this width the split view shows its left side alone.
const SPLIT_MIN = 1100;
const PANE_MIN = 420;
const RATIO_KEY = 'pumprint.split.ratio';
const wide = typeof matchMedia === 'function' ? matchMedia(`(min-width: ${SPLIT_MIN}px)`) : { matches: true, addEventListener() {} };
// Pages that let their background run under a see-through header.
const OPEN_TOP = ['about', 'telegram'];
const pages = {};
let current = null; // 'view', or 'left+right' in the split view
let layout = { a: 'about', b: null };
let ratio = 0.5; // the left side's share of the split view

boot();

function boot() {
  const name = String(CFG.name || 'PUMPRINT');
  renderAllRansom(name);
  document.title = brandTitle(name);
  setupContract();
  setupSocials();
  setupHeader();
  setupToolsMenu();
  renderToolTabs();
  setupPaneControls();
  setupSplitBar();
  setupDownloads();
  const env = getEnv();
  env.then(showServerAddresses);
  window.addEventListener('hashchange', () => route(false));
  wide.addEventListener('change', () => {
    current = null;
    route(false);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-nav]');
    if (!a) return;
    const view = a.dataset.nav;
    if (`#${view}` === location.hash || (!location.hash && view === 'about')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    closeMenu();
    closeToolsMenu();
  });
  route(true);
}

function brandTitle(name) {
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ------------------------------------------------------------------ routing

// #moth is one view; #moth+kolibri is the split view, Moth on the left and Kolibri on the right.
function parseHash() {
  const raw = decodeURIComponent((location.hash || '').replace('#', ''));
  let [a, b] = raw.split('+');
  // The Telegram page stands in for the channel until config.js has its link.
  if (!VIEWS.includes(a) || (a === 'telegram' && socialUrl('telegram'))) a = 'about';
  if (!(b && b !== a && PANES.includes(a) && PANES.includes(b) && wide.matches)) b = null;
  return { a, b };
}

// Where a link to `tool` goes from the side showing `from`: the other side stays as it is.
function hashFor(from, tool) {
  const { a, b } = layout;
  if (!b) return tool;
  if (from === a) return tool === b ? `${b}+${a}` : `${tool}+${b}`;
  return tool === a ? `${b}+${a}` : `${a}+${tool}`;
}

function route(first) {
  const { a, b } = parseHash();
  const key = b ? `${a}+${b}` : a;
  if (key === current) return;
  const before = layout;
  current = key;
  layout = { a, b };
  const split = Boolean(b);
  const main = document.getElementById('main');
  if (split) buildPaneQueries();
  document.documentElement.classList.toggle('split-on', split);
  main.classList.toggle('split', split);
  for (const sec of $$('[data-view]')) {
    const v = sec.dataset.view;
    const on = v === a || v === b;
    sec.hidden = !on;
    sec.classList.toggle('pane', split && on);
    sec.style.order = split && on ? (v === a ? '1' : '3') : '';
    // a side that now shows another page starts at its top
    if (split && on && v !== before.a && v !== before.b) {
      const page = sec.querySelector(':scope > .page');
      if (page) page.scrollTop = 0;
    }
  }
  document.getElementById('split-bar').hidden = !split;
  if (split) applyRatio();
  else main.style.gridTemplateColumns = '';
  const mark = (el, on) => (on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'));
  for (const el of $$('.tabs > a[data-nav], .tools-panel a[data-nav]')) mark(el, el.dataset.nav === a || el.dataset.nav === b);
  for (const nav of $$('.tool-tabs')) {
    const from = nav.closest('[data-view]').dataset.view;
    for (const el of nav.querySelectorAll('a[data-nav]')) {
      mark(el, el.dataset.nav === from);
      el.setAttribute('href', `#${hashFor(from, el.dataset.nav)}`);
    }
  }
  closeSplitMenu();
  document.getElementById('tools-btn').classList.toggle('current', TOOLS.includes(a) || TOOLS.includes(b));
  const name = brandTitle(String(CFG.name || 'PUMPRINT'));
  const title = [a, b].filter(Boolean).map((v) => TITLES[v]).filter(Boolean).join(' + ');
  document.title = title ? `${title} · ${name}` : name;
  document.getElementById('site-head').classList.toggle('solid', split || !OPEN_TOP.includes(a));
  if (!first && !split) window.scrollTo({ top: 0 });
  startPage(a);
  if (b) startPage(b);
  for (const [k, p] of Object.entries(pages)) if (p && p.setActive) p.setActive(k === a || k === b);
  focusGuide();
}

// The guide beside a tool opens at that tool's section.
function focusGuide() {
  const { a, b } = layout;
  if (a !== 'learn' && b !== 'learn') return;
  if (pages.learn && pages.learn.focus) pages.learn.focus(b ? (a === 'learn' ? b : a) : null);
}

async function startPage(view) {
  if (pages[view] !== undefined) return;
  pages[view] = null;
  const env = await getEnv();
  try {
    if (view === 'about') pages.about = initAbout(env);
    if (PAGES[view]) pages[view] = (await PAGES[view]())(env);
    if (view === 'telegram') pages.telegram = (await import('./soon.js')).initSoon();
  } catch (err) {
    console.error(err);
    toast('Something went wrong loading this page. Reload to try again.');
  }
  if (pages[view] && pages[view].setActive) pages[view].setActive(layout.a === view || layout.b === view);
  if (view === 'learn') focusGuide();
}

// ------------------------------------------------------------------ split view

// The split button sits at the right end of each page's label row, beside the data badge. In the split
// view the same place holds swap and close.
function setupPaneControls() {
  for (const view of $$('[data-view][data-pane]')) {
    const row = view.querySelector('.label-row');
    if (!row) continue;
    const end = document.createElement('div');
    end.className = 'label-end';
    const badge = row.lastElementChild && row.lastElementChild.tagName === 'SPAN' && row.children.length > 1 ? row.lastElementChild : null;
    row.append(end);
    if (badge) end.append(badge);
    const ctl = document.createElement('div');
    ctl.className = 'pane-ctl';
    ctl.innerHTML = `
      <button type="button" class="pane-btn" data-pane-act="split" aria-haspopup="menu" aria-expanded="false" title="Open another tool beside this one"><svg aria-hidden="true"><use href="#i-split"/></svg><span>Split</span></button>
      <button type="button" class="pane-btn pane-icon" data-pane-act="swap" title="Swap the two sides" aria-label="Swap the two sides"><svg aria-hidden="true"><use href="#i-swap"/></svg></button>
      <button type="button" class="pane-btn pane-icon" data-pane-act="close" title="Close this side" aria-label="Close this side"><svg aria-hidden="true"><use href="#i-close"/></svg></button>`;
    end.append(ctl);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pane-act]');
    const menu = document.getElementById('split-menu');
    if (!btn) {
      if (menu && !menu.hidden && !menu.contains(e.target)) closeSplitMenu();
      return;
    }
    const from = btn.closest('[data-view]').dataset.view;
    const act = btn.dataset.paneAct;
    if (act === 'split') {
      if (menu && !menu.hidden && menu.dataset.from === from) closeSplitMenu();
      else openSplitMenu(btn, from);
    } else if (act === 'swap' && layout.b) location.hash = `${layout.b}+${layout.a}`;
    else if (act === 'close' && layout.b) location.hash = from === layout.a ? layout.b : layout.a;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSplitMenu(true);
  });
  window.addEventListener('resize', () => closeSplitMenu());
  document.addEventListener('scroll', () => closeSplitMenu(), true);
}

function openSplitMenu(btn, from) {
  let menu = document.getElementById('split-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'split-menu';
    menu.className = 'split-menu';
    menu.setAttribute('role', 'menu');
    document.body.append(menu);
  }
  const chainOf = (t) => {
    const a = document.querySelector(`.tools-panel a[data-nav="${t}"] i`);
    return a ? a.textContent : '';
  };
  menu.dataset.from = from;
  menu.innerHTML = `<p class="split-menu-h">Open beside ${TITLES[from]}</p>
    ${TOOLS.filter((t) => t !== from).map((t) => `<a role="menuitem" href="#${from}+${t}"><b>${TITLES[t]}</b><i>${chainOf(t)}</i></a>`).join('')}
    ${from !== 'learn' ? `<a role="menuitem" class="split-menu-learn" href="#${from}+learn"><b>Learn</b><i>how to use ${TITLES[from]}</i></a>` : ''}`;
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  menu.hidden = false;
  for (const b of $$('[data-pane-act="split"]')) b.setAttribute('aria-expanded', String(b === btn));
  const first = menu.querySelector('a');
  if (first) first.focus({ preventScroll: true });
}

function closeSplitMenu(refocus = false) {
  const menu = document.getElementById('split-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const btn = document.querySelector('[data-pane-act="split"][aria-expanded="true"]');
  for (const b of $$('[data-pane-act="split"]')) b.setAttribute('aria-expanded', 'false');
  if (refocus && btn) btn.focus();
}

function clampRatio(r) {
  const w = document.getElementById('main').clientWidth || window.innerWidth;
  const min = Math.min(0.45, (PANE_MIN + 6) / Math.max(1, w));
  return Math.min(1 - min, Math.max(min, Number.isFinite(r) ? r : 0.5));
}
function applyRatio() {
  ratio = clampRatio(ratio);
  const main = document.getElementById('main');
  main.style.gridTemplateColumns = `minmax(${PANE_MIN}px, ${ratio.toFixed(4)}fr) 12px minmax(${PANE_MIN}px, ${(1 - ratio).toFixed(4)}fr)`;
  document.getElementById('split-bar').setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

// The bar between the sides: drag it, use the arrow keys, double-click it for half and half.
function setupSplitBar() {
  const bar = document.getElementById('split-bar');
  const main = document.getElementById('main');
  ratio = Number(local.get(RATIO_KEY, 0.5)) || 0.5;
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  let dragging = false;
  const save = () => local.set(RATIO_KEY, Number(ratio.toFixed(4)));
  bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('split-drag');
    e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = main.getBoundingClientRect();
    ratio = clampRatio((e.clientX - r.left) / r.width);
    applyRatio();
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.documentElement.classList.remove('split-drag');
    save();
  };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
  bar.addEventListener('dblclick', () => {
    ratio = 0.5;
    applyRatio();
    save();
  });
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    if (e.key === 'ArrowLeft') ratio -= step;
    else if (e.key === 'ArrowRight') ratio += step;
    else if (e.key === 'Home') ratio = 0;
    else if (e.key === 'End') ratio = 1;
    else return;
    e.preventDefault();
    applyRatio();
    save();
  });
  window.addEventListener('resize', () => {
    if (layout.b) applyRatio();
  });
}

// The pages size themselves with @media rules, which see the window, not one side of it. For the split
// view every max-width block of the site's styles is repeated once as a container query on the side,
// so a 700px side lays out the way a 700px window would. Built the first time the split view opens.
function buildPaneQueries() {
  if (document.getElementById('pane-queries')) return;
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // a stylesheet from another origin (fonts)
    }
    for (const r of rules || []) {
      if (!(typeof CSSMediaRule !== 'undefined' && r instanceof CSSMediaRule)) continue;
      const m = /^\(max-width:\s*(\d+)px\)$/.exec(String(r.conditionText || (r.media && r.media.mediaText) || '').trim());
      if (!m) continue;
      out.push(`@container pane (max-width: ${m[1]}px) {\n${[...r.cssRules].map((x) => x.cssText).join('\n')}\n}`);
    }
  }
  const style = document.createElement('style');
  style.id = 'pane-queries';
  style.textContent = out.join('\n');
  // last in the document, so these win over the base rules wherever the site's styles were put
  document.body.append(style);
}

// ------------------------------------------------------------------ header

function setupHeader() {
  const head = document.getElementById('site-head');
  const onScroll = () => head.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const btn = document.getElementById('menu-btn');
  const tabs = document.getElementById('tabs');
  btn.addEventListener('click', () => {
    const open = !tabs.classList.contains('open');
    tabs.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    head.classList.toggle('solid', open || !OPEN_TOP.includes(current));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

function closeMenu() {
  const tabs = document.getElementById('tabs');
  const btn = document.getElementById('menu-btn');
  if (!tabs.classList.contains('open')) return;
  tabs.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');
  document.getElementById('site-head').classList.toggle('solid', !OPEN_TOP.includes(current));
}

// ------------------------------------------------------------------ tools menu

function setupToolsMenu() {
  const menu = document.getElementById('tools-menu');
  const btn = document.getElementById('tools-btn');
  btn.addEventListener('click', () => {
    const open = !menu.classList.contains('open');
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) closeToolsMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open')) {
      closeToolsMenu();
      btn.focus();
    }
  });
}

function closeToolsMenu() {
  const menu = document.getElementById('tools-menu');
  if (!menu.classList.contains('open')) return;
  menu.classList.remove('open');
  document.getElementById('tools-btn').setAttribute('aria-expanded', 'false');
}

// The six tools as a row of tabs in the label row of every tool page.
function renderToolTabs() {
  const links = $$('.tools-panel a[data-nav]').map((a) => `<a href="#${a.dataset.nav}" data-nav="${a.dataset.nav}">${a.querySelector('b').textContent}</a>`).join('');
  for (const view of $$('[data-view][data-tool]')) {
    const first = view.querySelector('.label-row > span:first-child');
    if (!first) continue;
    const nav = document.createElement('nav');
    nav.className = 'tool-tabs';
    nav.setAttribute('aria-label', 'Tools');
    nav.innerHTML = links;
    first.replaceWith(nav);
  }
}

// ------------------------------------------------------------------ contract address

function shortCa(ca) {
  return ca.length > 12 ? `${ca.slice(0, 4)}…${ca.slice(-5)}` : ca;
}

function setupContract() {
  const ca = String(CFG.contractAddress || '').trim();
  for (const el of $$('[data-ca-value]')) el.textContent = ca ? shortCa(ca) : 'Soon…pump';
  for (const btn of $$('[data-copy-ca]')) {
    btn.title = ca ? `Copy ${ca}` : 'The contract address is not live yet';
    btn.addEventListener('click', async () => {
      if (!ca) return toast('The contract address is not live yet.');
      const ok = await copyText(ca);
      if (ok) {
        const use = btn.querySelector('use');
        use.setAttribute('href', '#i-check');
        setTimeout(() => use.setAttribute('href', '#i-copy'), 1400);
        toast('Contract address copied.');
      } else {
        toast(ca, 6000);
      }
    });
  }
}

// ------------------------------------------------------------------ socials

function socialUrl(name) {
  const url = String((CFG.links || {})[name] || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function setupSocials() {
  for (const btn of $$('[data-social]')) {
    const name = btn.dataset.social;
    const url = socialUrl(name);
    if (url || name === 'telegram') {
      const a = document.createElement('a');
      a.className = btn.className;
      a.dataset.social = name;
      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else {
        // No channel yet: the button opens the site's own "Coming soon" page.
        a.href = '#telegram';
        a.dataset.nav = 'telegram';
      }
      a.setAttribute('aria-label', btn.getAttribute('aria-label'));
      a.title = btn.title;
      a.innerHTML = btn.innerHTML;
      btn.replaceWith(a);
    } else {
      btn.addEventListener('click', () => toast(`${btn.getAttribute('aria-label')}: link coming soon.`));
    }
  }
}

// ------------------------------------------------------------------ downloads and server addresses

function setupDownloads() {
  if (!CFG.preview) return;
  for (const a of $$('[data-download]')) {
    a.setAttribute('aria-disabled', 'true');
    a.removeAttribute('href');
    a.title = 'Downloads work on the live site';
  }
}

function showServerAddresses(env) {
  if (env.mode !== 'server') return;
  for (const p of $$('[data-ext-server]')) {
    // Kolibri's extension talks to the optional network server (KOLIBRI_NETWORK=1).
    if (p.dataset.extServer === 'kolibri' && !(env.site && env.site.kolibri && env.site.kolibri.network)) continue;
    const url = `${location.origin}/${p.dataset.extServer}`;
    const btn = p.querySelector('[data-copy]');
    btn.textContent = url;
    btn.title = 'Copy';
    btn.addEventListener('click', async () => {
      if (await copyText(url)) toast('Address copied.');
    });
    p.hidden = false;
  }
}
