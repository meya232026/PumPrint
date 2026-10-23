'use strict';
// A simulated internet for demo mode: X (twitterapi.io, the X API and oEmbed), Telegram
// channel previews (t.me/s), DexScreener and GeckoTerminal, with made-up callers and
// made-up tokens. Used by `npm run demo` and by scripts/build-demo-data.mjs (sample data
// for static hosting). Every name, ticker and price here is invented.

const DAY = 86400000;
const HOUR = 3600000;
const MIN = 60000;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function b58(rnd, len) {
  let s = '';
  while (s.length < len) s += B58[Math.floor(rnd() * 58)];
  // Real addresses mix digits, upper and lower case; make sure ours do too.
  return '7' + s.slice(1, -2) + 'Kq';
}

function snowflake(ms, seq) {
  return (((BigInt(Math.floor(ms)) - 1288834974657n) << 22n) | BigInt(seq || 0)).toString();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const smooth = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const TOKENS = [
  ['OTTR', 'Otter Wif Laser'], ['CAPY', 'Capy Club'], ['LAMP', 'Moth Lamp'], ['GPZA', 'Giga Pizza'], ['SLPY', 'Sleepy Frog'],
  ['HAMA', 'Hamster Agent'], ['GSNL', 'Golden Snail'], ['CGOAT', 'Cyber Goat'], ['TWHL', 'Tiny Whale'], ['PDUCK', 'Pixel Duck'],
  ['LRAC', 'Lucky Raccoon'], ['SCRAB', 'Sigma Crab'], ['BMPIG', 'Baby Moon Pig'], ['RSHRK', 'Retro Shark'], ['TFOX', 'Turbo Fox'],
  ['KOWL', 'King Owl'], ['SMOLP', 'Smol Panda'], ['WTGR', 'Wild Tiger'], ['BBEAR', 'Based Bear'], ['CHMK', 'Chill Monkey'],
  ['LHIPO', 'Laser Hippo'], ['DRDRG', 'Doctor Dragon'], ['CPENG', 'Captain Penguin'], ['MBULL', 'Mega Bull'], ['FCCF', 'Fat Cat Coffee'],
  ['SFROG', 'Sad Frog Season'], ['GOBLN', 'Goblin Mode'], ['NUGT', 'Chicken Nugget Inu'], ['ROCKT', 'Rocket Rat'], ['BLOB', 'Blob'],
  ['SPDR', 'Spider Chef'], ['MOODY', 'Moody Cow'], ['TACOS', 'Taco Tuesday'], ['VIBEZ', 'Vibe Check'], ['DEGNZ', 'Degen Zoo'],
  ['WAFFL', 'Waffle Dog'], ['GLRP', 'Glorp'], ['SNEK', 'Snek Agent'], ['BEANS', 'Magic Beans'], ['YETI', 'Yeti Cult'],
  ['MOGG', 'Mogger'], ['PIPS', 'Pip Squeak'], ['FUZZ', 'Fuzzball'], ['GRIM', 'Grim Reaper Cat'], ['BRRR', 'Money Printer'],
  ['NANA', 'Banana Gang'], ['ZOOM', 'Zoomer'], ['KEKW', 'Kek World'], ['HOPP', 'Hopper'], ['SQDL', 'Squidle'],
];

// X first: the callers people check most are on X.
const CALLERS = [
  { platform: 'x', handle: 'printdegen', title: 'print degen', skill: 0.92, calls: 18, styles: ['ca', 'ca', 'link'] },
  { platform: 'x', handle: 'trenchqueen', title: 'trench queen', skill: 0.72, calls: 14, styles: ['ca', 'link'] },
  { platform: 'x', handle: 'rugwatcher', title: 'rug watcher', skill: 0.5, calls: 13, styles: ['ca', 'ticker'] },
  { platform: 'x', handle: '100xsignals', title: '100x SIGNALS', skill: 0.1, calls: 18, styles: ['ca', 'ca', 'ticker'] },
  { platform: 'tg', handle: 'trenchdiary', title: 'Trench Diary', skill: 0.66, calls: 15, styles: ['ca', 'ca', 'link'] },
  { platform: 'tg', handle: 'bondingbros', title: 'Bonding Bros', skill: 0.4, calls: 16, styles: ['ca', 'ticker'] },
  { platform: 'tg', handle: 'apesignalsvip', title: 'Ape Signals VIP', skill: 0.12, calls: 17, styles: ['ca', 'ca', 'ticker'] },
];

const CHATTER = [
  'GM trenches.', 'Patience pays. Not every day needs a trade.', 'Market is choppy, sizing down today.',
  'Reminder: take something off the table on the way up.', 'Who is still here?', 'Quiet day. Watching, not buying.',
  'Volume is back on the launchpad.', 'If you missed it, do not chase.',
];

// The first hour after a call, m = minutes since the post. Returns a multiplier of the call price.
function makeFast(kind, rnd) {
  let A;
  let tp;
  let settle;
  switch (kind) {
    case 'moon':
      A = 1 + rnd() * 2.6; tp = 2 + rnd() * 9; settle = 1 + A * (0.7 + rnd() * 0.3); break;
    case 'runner':
      A = 0.3 + rnd() * 0.9; tp = 3 + rnd() * 14; settle = 1 + A * (0.45 + rnd() * 0.45); break;
    case 'flat':
      A = (rnd() - 0.35) * 0.18; tp = 4 + rnd() * 15; settle = 1 + A * 0.5; break;
    case 'pumpdump':
      A = 0.5 + rnd() * 1.6; tp = 0.6 + rnd() * 2.6; settle = 0.55 + rnd() * 0.4; break;
    case 'bleed':
      A = 0.03 + rnd() * 0.12; tp = 1.5 + rnd() * 5; settle = 0.62 + rnd() * 0.25; break;
    default: // rug
      A = 0.1 + rnd() * 0.45; tp = 1 + rnd() * 2.5; settle = 0.08 + rnd() * 0.22;
  }
  const tau = Math.max(4, (60 - tp) / 3);
  const peak = 1 + A;
  return (m) => {
    if (m <= 0) return 1;
    if (m < tp) return 1 + A * smooth(m / tp);
    return settle + (peak - settle) * Math.exp(-(m - tp) / tau);
  };
}

// The days after, relative to the price one hour after the call (d = days since the post).
function makeSlow(kind, rnd) {
  switch (kind) {
    case 'moon': {
      const top = 1.8 + rnd() * 4.5;
      const at = 0.6 + rnd() * 2;
      return (d) => (d < at ? 1 + (top - 1) * smooth(d / at) : top * (0.35 + 0.65 * Math.exp(-(d - at) * 0.7)));
    }
    case 'runner': {
      const top = 1.15 + rnd() * 0.9;
      const at = 0.3 + rnd() * 1.2;
      return (d) => (d < at ? 1 + (top - 1) * smooth(d / at) : top * (0.6 + 0.4 * Math.exp(-(d - at) * 0.6)));
    }
    case 'flat': {
      const drift = -0.25 + rnd() * 0.35;
      return (d) => 1 + drift * Math.min(1, d / 3);
    }
    case 'pumpdump': {
      const floor = 0.2 + rnd() * 0.4;
      return (d) => floor + (1 - floor) * Math.exp(-d * 2.5);
    }
    case 'bleed': {
      const end = 0.3 + rnd() * 0.4;
      return (d) => 1 - (1 - end) * Math.min(1, Math.pow(d / 4, 0.7));
    }
    default: {
      const left = 0.15 + rnd() * 0.4;
      return (d) => left + (1 - left) * Math.exp(-d * 4);
    }
  }
}

function pickKind(skill, rnd) {
  const r = rnd();
  if (r < skill) return rnd() < 0.25 ? 'moon' : 'runner';
  if (r < skill + (1 - skill) * 0.2) return 'flat';
  const b = rnd();
  return b < 0.5 ? 'pumpdump' : b < 0.8 ? 'bleed' : 'rug';
}

function build(now, seed) {
  const rnd = mulberry32(seed || 20261022);
  const tokens = [];
  const channels = [];
  const xAccounts = [];
  let tokenIdx = 0;
  const used = new Set();
  const ADJ = ['Baby', 'Giga', 'Based', 'Chill', 'Tiny', 'Golden', 'Dark', 'Cyber', 'Pixel', 'Retro', 'Lucky', 'Sleepy', 'Wild', 'Turbo', 'Mega', 'Fat'];
  const ANIMALS = ['Otter', 'Capy', 'Frog', 'Hippo', 'Penguin', 'Monkey', 'Duck', 'Bear', 'Shark', 'Whale', 'Dragon', 'Tiger', 'Panda', 'Goat', 'Crab', 'Moth'];
  const nextName = () => {
    while (tokenIdx < TOKENS.length) {
      const pair = TOKENS[tokenIdx++];
      if (!used.has(pair[0])) return pair;
    }
    for (;;) {
      const a = ADJ[Math.floor(rnd() * ADJ.length)];
      const b = ANIMALS[Math.floor(rnd() * ANIMALS.length)];
      const sym = (a[0] + b.slice(0, 4)).toUpperCase();
      if (!used.has(sym)) return [sym, `${a} ${b}`];
    }
  };

  const newToken = (callAt, kind) => {
    const [symbol, name] = nextName();
    used.add(symbol);
    const mint = b58(rnd, 40) + 'pump';
    // market cap at the call: 8k to 600k, mostly small
    const p0 = (8000 + Math.pow(rnd(), 2.2) * 600000) / 1e9;
    const launchAt = callAt - (0.02 + rnd() * 1.5) * DAY;
    const fast = makeFast(kind, rnd);
    const slow = makeSlow(kind, rnd);
    const graduates = kind === 'moon' || kind === 'runner' || (kind === 'flat' && rnd() < 0.4);
    const migrateAt = graduates ? callAt + (0.2 + rnd() * 20) * HOUR : null;
    const noise = rnd() * 6.28;
    const price = (ms) => {
      const m = (ms - callAt) / MIN;
      const wob = 1 + 0.025 * Math.sin(m / 3.1 + noise) + 0.012 * Math.sin(m / 0.7 + noise * 2);
      if (m < 0) return p0 * Math.max(0.3, 1 + m / (60 * 24 * 3)) * wob;
      const f = m <= 60 ? fast(m) : fast(60) * slow(m / 1440) / slow(1 / 24);
      return p0 * Math.max(0.0005, f) * wob;
    };
    const t = {
      symbol, name, mint, kind, callAt, launchAt, migrateAt, price,
      curve: b58(rnd, 41) + 'Cv',
      amm: graduates ? b58(rnd, 41) + 'Am' : null,
      liq: graduates ? 60000 + rnd() * 1.4e6 : 21000 + rnd() * 15000,
    };
    tokens.push(t);
    return t;
  };

  const textFor = (t, style, crnd, at) => {
    const pick = (arr) => arr[Math.floor(crnd() * arr.length)];
    if (style === 'ticker') return pick([`$${t.symbol} looks ready`, `Adding $${t.symbol} here`, `$${t.symbol} chart is clean`, `Loaded a bag of $${t.symbol}`]);
    if (style === 'link') return pick([`https://pump.fun/coin/${t.mint}`, `Early on this one https://gmgn.ai/sol/token/${t.mint}`, `$${t.symbol} https://dexscreener.com/solana/${t.amm && t.migrateAt < at ? t.amm : t.curve}`]);
    return pick([`New call: $${t.symbol}\nCA: ${t.mint}`, `${t.mint}\n\nape small, dev looks clean`, `$${t.symbol}\n${t.mint}`, `Gem alert $${t.symbol}\nCA ${t.mint}`]);
  };

  // Good callers find a token early; bad ones sometimes post the same token at its top.
  const shared = [];
  for (const c of CALLERS) {
    const crnd = mulberry32(seed + c.handle.length * 977 + c.calls);
    const posts = [];
    const times = [];
    for (let i = 0; i < c.calls; i++) times.push(now - (3 * HOUR + Math.pow(crnd(), 1.1) * 27 * DAY));
    times.sort((a, b) => a - b);
    // a few recent calls so pending results show
    times[times.length - 1] = now - (4 + crnd() * 40) * MIN;
    times[times.length - 2] = now - (2 + crnd() * 14) * HOUR;
    for (const at of times) {
      const late = c.skill < 0.35 && shared.length && crnd() < 0.25;
      let token;
      let callAt = at;
      if (late) {
        const s = shared.shift();
        token = s.token;
        callAt = Math.min(now - 2 * HOUR, s.topAt);
      } else {
        const kind = pickKind(c.skill, crnd);
        token = newToken(at, kind);
        if (c.skill > 0.6 && (kind === 'moon' || kind === 'runner') && at < now - 3 * DAY) {
          shared.push({ token, topAt: at + (8 + crnd() * 40) * MIN });
        }
      }
      const style = c.styles[Math.floor(crnd() * c.styles.length)];
      posts.push({ at: callAt, text: textFor(token, style, crnd, callAt) });
      if (crnd() < 0.45) posts.push({ at: callAt + (0.2 + crnd() * 0.6) * DAY, text: CHATTER[Math.floor(crnd() * CHATTER.length)] });
    }
    posts.sort((a, b) => a.at - b.at);
    const visible = posts.filter((p) => p.at < now);
    if (c.platform === 'tg') {
      channels.push({ username: c.handle, title: c.title, posts: visible.map((p, i) => ({ id: 40 + i * 3, ...p })) });
    } else {
      xAccounts.push({ id: String(1000 + xAccounts.length), username: c.handle, name: c.title, tweets: visible.map((p, i) => ({ id: snowflake(p.at, i + 1), ...p })) });
    }
  }
  return { tokens, channels, xAccounts };
}

function response({ status = 200, json, text, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    json: async () => json,
    text: async () => (text !== undefined ? text : JSON.stringify(json)),
  };
}

function tmePage(ch, before) {
  const list = ch.posts.filter((p) => !before || p.id < before).sort((a, b) => a.id - b.id).slice(-20);
  const post = (p) => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="${ch.username}/${p.id}">
    <div class="tgme_widget_message_bubble"><div class="tgme_widget_message_text js-message_text" dir="auto">${esc(p.text).replace(/\n/g, '<br/>')}</div>
    <div class="tgme_widget_message_footer"><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/${ch.username}/${p.id}"><time datetime="${new Date(p.at).toISOString().replace('.000Z', '+00:00')}" class="time">12:00</time></a></span></div></div></div></div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(ch.title)}</title></head><body><main class="tgme_main"><section class="tgme_channel_history">
    <div class="tgme_channel_info"><div class="tgme_channel_info_header"><div class="tgme_channel_info_header_title"><span dir="auto">${esc(ch.title)}</span></div>
    <div class="tgme_channel_info_header_username"><a href="https://t.me/${ch.username}">@${ch.username}</a></div></div></div>
    ${list.map(post).join('\n')}</section></main></body></html>`;
}

const classicDate = (ms) => {
  const d = new Date(ms);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000 ${d.getUTCFullYear()}`;
};

const linksIn = (text) => [...String(text).matchAll(/https?:\/\/\S+/g)].map((x) => x[0]);

/** World anchored at `now`: { fetchImpl, callers, hosts, now }. */
function createDemoWorld(now = Date.now(), seed = 20261022) {
  const world = build(now, seed);
  const byMint = new Map(world.tokens.map((t) => [t.mint, t]));
  const byPool = new Map();
  for (const t of world.tokens) {
    byPool.set(t.curve, { t, from: t.launchAt, to: t.migrateAt && t.migrateAt < now ? t.migrateAt : now });
    if (t.amm && t.migrateAt < now) byPool.set(t.amm, { t, from: t.migrateAt, to: now });
  }
  const pairOf = (t, pool) => {
    const amm = pool === t.amm;
    const price = t.price(Math.min(now, byPool.get(pool) ? byPool.get(pool).to : now));
    return {
      chainId: 'solana',
      dexId: amm ? 'pumpswap' : 'pumpfun',
      url: `https://dexscreener.com/solana/${pool.toLowerCase()}`,
      pairAddress: pool,
      baseToken: { address: t.mint, name: t.name, symbol: t.symbol },
      quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
      priceUsd: String(price),
      fdv: price * 1e9,
      marketCap: price * 1e9,
      liquidity: { usd: amm ? t.liq : t.amm ? 22000 : t.liq },
      pairCreatedAt: Math.floor(amm ? t.migrateAt : t.launchAt),
    };
  };
  const pairsOf = (t) => {
    const out = [];
    if (t.amm && t.migrateAt < now) out.push(pairOf(t, t.amm));
    out.push(pairOf(t, t.curve));
    return out;
  };
  const tweetById = new Map();
  for (const a of world.xAccounts) for (const t of a.tweets) tweetById.set(t.id, { a, t });

  const fetchImpl = async (url) => {
    const u = new URL(url);
    const p = u.pathname;
    let m;
    if (u.hostname === 'data-api.binance.vision') {
      if (p.endsWith('/ticker/price')) return response({ json: [{ symbol: 'BTCUSDT', price: '1' }] });
      return response({ status: 400, json: {} });
    }
    if (u.hostname === 'api.dexscreener.com') {
      if ((m = p.match(/^\/latest\/dex\/tokens\/(.+)$/))) {
        const t = byMint.get(m[1]);
        return response({ json: { schemaVersion: '1.0.0', pairs: t ? pairsOf(t) : null } });
      }
      if ((m = p.match(/^\/latest\/dex\/pairs\/([^/]+)\/(.+)$/))) {
        const hit = byPool.get(m[2]);
        const pair = hit ? pairOf(hit.t, m[2]) : null;
        return response({ json: { schemaVersion: '1.0.0', pairs: pair ? [pair] : null, pair } });
      }
      if (p === '/latest/dex/search') {
        const q = String(u.searchParams.get('q') || '');
        const list = world.tokens.filter((t) => t.symbol === q.toUpperCase() || t.mint === q || t.curve === q || t.amm === q);
        return response({ json: { schemaVersion: '1.0.0', pairs: list.flatMap(pairsOf) } });
      }
      return response({ status: 404, json: {} });
    }
    if (u.hostname === 'api.geckoterminal.com' || u.hostname === 'api.coingecko.com') {
      if ((m = p.match(/\/networks\/([^/]+)\/pools\/([^/]+)\/ohlcv\/(minute|hour|day)$/))) {
        const hit = byPool.get(m[2]);
        if (!hit) return response({ status: 404, json: {} });
        const step = m[3] === 'minute' ? 60 * Number(u.searchParams.get('aggregate') || 1) : m[3] === 'hour' ? 3600 : 86400;
        const before = Number(u.searchParams.get('before_timestamp')) || Math.floor(now / 1000);
        const limit = Math.min(1000, Number(u.searchParams.get('limit')) || 100);
        const fromS = Math.ceil(hit.from / 1000 / step) * step;
        const toS = Math.floor(Math.min(hit.to, now) / 1000);
        const list = [];
        for (let t = Math.floor((before - 1) / step) * step; t >= fromS && list.length < limit; t -= step) {
          if (t > toS || t >= before) continue;
          const o = hit.t.price(t * 1000);
          const c = hit.t.price(Math.min(toS, t + step - 1) * 1000);
          list.push([t, o, Math.max(o, c) * 1.012, Math.min(o, c) * 0.988, c, 1000 + (t % 977)]);
        }
        return response({ json: { data: { id: 'x', type: 'ohlcv_request_response', attributes: { ohlcv_list: list } }, meta: {} } });
      }
      if (p.endsWith('/search/pools')) return response({ json: { data: [] } });
      return response({ status: 404, json: {} });
    }
    if (u.hostname === 't.me') {
      const mm = /^\/s\/([A-Za-z0-9_]+)/.exec(p);
      const ch = mm && world.channels.find((c) => c.username.toLowerCase() === mm[1].toLowerCase());
      if (!ch) return response({ text: '<html><body><div class="tgme_page">nothing here</div></body></html>' });
      return response({ text: tmePage(ch, Number(u.searchParams.get('before')) || 0) });
    }
    if (u.hostname === 'api.twitterapi.io' && p === '/twitter/user/last_tweets') {
      const name = String(u.searchParams.get('userName') || '').toLowerCase();
      const a = world.xAccounts.find((x) => x.username.toLowerCase() === name);
      if (!a) return response({ json: { status: 'error', msg: 'user not found' } });
      const start = Number(u.searchParams.get('cursor') || 0) || 0;
      const newest = a.tweets.slice().reverse();
      const page = newest.slice(start, start + 20);
      const tweets = page.map((t) => ({
        type: 'tweet',
        id: t.id,
        url: `https://x.com/${a.username}/status/${t.id}`,
        text: t.text,
        createdAt: classicDate(t.at),
        entities: { urls: linksIn(t.text).map((x) => ({ url: 'https://t.co/demo', expanded_url: x, display_url: x.replace(/^https?:\/\//, '') })) },
        author: { userName: a.username, name: a.name, profilePicture: null },
        retweeted_tweet: null,
        quoted_tweet: null,
      }));
      const more = start + 20 < newest.length;
      return response({ json: { status: 'success', data: { pin_tweet: null, tweets }, has_next_page: more, next_cursor: more ? String(start + 20) : '' } });
    }
    if (u.hostname === 'api.x.com') {
      if ((m = p.match(/^\/2\/users\/by\/username\/([^/]+)$/))) {
        const a = world.xAccounts.find((x) => x.username.toLowerCase() === decodeURIComponent(m[1]).toLowerCase());
        if (!a) return response({ status: 404, json: {} });
        return response({ json: { data: { id: a.id, name: a.name, username: a.username } } });
      }
      if ((m = p.match(/^\/2\/users\/([^/]+)\/tweets$/))) {
        const a = world.xAccounts.find((x) => x.id === m[1]);
        if (!a) return response({ status: 404, json: {} });
        const data = a.tweets.slice().reverse().map((t) => {
          const urls = linksIn(t.text).map((x) => ({ url: 'https://t.co/demo', expanded_url: x }));
          return { id: t.id, text: t.text, created_at: new Date(t.at).toISOString(), entities: urls.length ? { urls } : undefined };
        });
        return response({ json: { data, meta: { result_count: data.length } } });
      }
    }
    if (u.hostname === 'publish.twitter.com' && p === '/oembed') {
      const target = String(u.searchParams.get('url') || '');
      const idm = /status\/(\d+)/.exec(target);
      const hit = idm && tweetById.get(idm[1]);
      if (!hit) return response({ status: 404, json: {} });
      const body = esc(hit.t.text).replace(/https?:\/\/\S+/g, (x) => `<a href="${x}">${x.replace(/^https?:\/\//, '').slice(0, 24)}…</a>`).replace(/\n/g, '<br>');
      return response({ json: {
        author_name: hit.a.name,
        author_url: `https://twitter.com/${hit.a.username}`,
        html: `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${body}</p>&mdash; ${esc(hit.a.name)} (@${hit.a.username}) <a href="https://twitter.com/${hit.a.username}/status/${hit.t.id}">date</a></blockquote>`,
      } });
    }
    return response({ status: 404, json: {} });
  };

  return {
    now,
    fetchImpl,
    hosts: ['data-api.binance.vision', 'api.dexscreener.com', 'api.geckoterminal.com', 'api.coingecko.com', 't.me', 'api.x.com', 'api.twitterapi.io', 'publish.twitter.com'],
    callers: CALLERS.map((c) => ({ platform: c.platform, handle: c.handle, title: c.title })),
    sampleTweet: (() => {
      const a = world.xAccounts[0];
      const t = a.tweets.find((x) => /CA/.test(x.text)) || a.tweets[0];
      return `https://x.com/${a.username}/status/${t.id}`;
    })(),
    tokens: world.tokens,
  };
}

module.exports = { createDemoWorld, CALLERS };
