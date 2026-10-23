// Copied from Moth (MIT, github.com/Ridarketh/Moth-radar) for running in the browser.
// Fake launches for development and screenshots: `npm run demo`.
// Names are built from a small vocabulary; a few words get "narratives" that
// ramp up and fade, so Top, Rising and the sparklines all have something to show.

const MINUTE = 60_000;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const ANIMALS = ['cat', 'dog', 'frog', 'hippo', 'penguin', 'monkey', 'duck', 'bear', 'shark', 'whale', 'dragon', 'tiger', 'panda', 'fox', 'owl', 'goat', 'capybara', 'raccoon', 'otter', 'hamster', 'snail', 'crab', 'bull', 'moth', 'pig'];
const VIBES = ['baby', 'giga', 'based', 'chill', 'tiny', 'golden', 'dark', 'cyber', 'pixel', 'retro', 'king', 'queen', 'lord', 'captain', 'doctor', 'super', 'mega', 'little', 'wild', 'lucky', 'sad', 'happy', 'sleepy', 'fat', 'smol'];
const THEMES = ['ai', 'agent', 'moon', 'mars', 'rocket', 'diamond', 'laser', 'turbo', 'pizza', 'coffee', 'taco', 'sushi', 'sigma', 'vibe', 'cult', 'gang', 'club', 'army', 'world', 'island', 'inu', 'wif', 'hat', 'chad', 'degen', 'fren', 'gm', 'lfg', 'hodl', 'bags', 'meme', 'dao', 'labs', 'network', 'chain', 'season', 'runner'];
const CJK = ['猫猫', '小狗', '金龙', '月亮', '火箭'];

const TEMPLATES = [
  (p) => `${cap(p.v())} ${cap(p.a())}`,
  (p) => `${cap(p.a())} ${cap(p.t())}`,
  (p) => `${cap(p.v())} ${cap(p.a())} ${cap(p.t())}`,
  (p) => `${cap(p.a())} on ${cap(p.t())}`,
  (p) => `The ${cap(p.v())} ${cap(p.a())}`,
  (p) => `${cap(p.a())}${cap(p.t())}`,
  (p) => `${p.a().toUpperCase()}`,
  (p) => `${cap(p.a())} ${cap(p.a())}`,
  (p) => `${cap(p.t())} ${cap(p.a())}`,
  (p) => `${cap(p.a())} wif ${cap(p.t())}`,
  (p) => `${p.cjk()}`,
  (p) => `${cap(p.v())} ${cap(p.t())}`,
];
const TEMPLATE_WEIGHTS = [14, 14, 8, 5, 4, 5, 6, 4, 6, 3, 2, 5];

// Minutes relative to server start. rise = minutes to peak, half = decay half-life.
const SCRIPTED = [
  { word: 'capybara', start: -105, rise: 14, half: 12, amp: 18 },
  { word: 'pizza', start: -52, rise: 16, half: 14, amp: 14 },
  { word: 'agent', start: -400, rise: 1, half: 100000, amp: 4 },
  { word: 'ai', start: -400, rise: 1, half: 100000, amp: 3 },
  { word: 'otter', start: -20, rise: 32, half: 18, amp: 22 },
  { word: 'laser', start: -7, rise: 20, half: 16, amp: 16 },
  { word: '猫猫', start: -30, rise: 25, half: 30, amp: 10 },
];

export function startDemo({ onLaunch, rate = 40, backfillMin = 125, seed = 7, log, now = () => Date.now() }) {
  const rnd = mulberry32(seed);
  const t0 = now();
  const narratives = SCRIPTED.map((n) => ({ ...n, startAt: t0 + n.start * MINUTE }));
  const status = { kind: 'demo', connected: true, events: 0, lastEventAt: 0, backfilledFrom: t0 - backfillMin * MINUTE };

  const weight = (word, t) => {
    let w = 1;
    for (const n of narratives) {
      if (n.word !== word || t < n.startAt) continue;
      const m = (t - n.startAt) / MINUTE;
      w += m <= n.rise ? (n.amp * m) / n.rise : n.amp * 0.5 ** ((m - n.rise) / n.half);
    }
    return w;
  };

  const pick = (list, t) => {
    let total = 0;
    const ws = list.map((x) => {
      const w = weight(x, t);
      total += w;
      return w;
    });
    let r = rnd() * total;
    for (let i = 0; i < list.length; i++) {
      r -= ws[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  };

  const rateAt = (t) => {
    const wave = 1 + 0.18 * Math.sin((t / (37 * MINUTE)) * Math.PI * 2);
    return Math.max(4, rate * wave);
  };

  const makeLaunch = (t) => {
    const parts = { a: () => pick(ANIMALS, t), v: () => pick(VIBES, t), t: () => pick(THEMES, t), cjk: () => pick(CJK, t) };
    const name = weightedChoice(TEMPLATES, TEMPLATE_WEIGHTS, rnd)(parts);
    const mint = randomB58(40, rnd) + 'demo';
    return { t, name, symbol: symbolFor(name, rnd), mint, pool: 'demo', creator: randomB58(44, rnd), curve: `demo-curve-${mint}`, mc0: 28 };
  };

  // Spawn a fresh narrative every so often so a long demo keeps moving.
  const spawn = (t) => {
    const pool = [...ANIMALS, ...THEMES].filter((w) => !narratives.some((n) => n.word === w && t - n.startAt < 90 * MINUTE));
    const word = pool[Math.floor(rnd() * pool.length)];
    narratives.push({ word, startAt: t, rise: 10 + rnd() * 15, half: 10 + rnd() * 15, amp: 10 + rnd() * 14 });
    log?.debug(`demo: new narrative "${word}"`);
  };

  // Backfill so every window has history the moment the server starts.
  let t = t0 - backfillMin * MINUTE;
  let n = 0;
  while (true) {
    t += expInterval(rateAt(t), rnd);
    if (t >= t0) break;
    onLaunch(makeLaunch(t));
    n++;
  }
  status.events = n;
  log?.info(`demo: backfilled ${n} launches over the last ${backfillMin} minutes`);

  let timer = null;
  let nextSpawn = t0 + 9 * MINUTE;
  const loop = () => {
    const at = now();
    if (at >= nextSpawn) {
      spawn(at);
      nextSpawn = at + (12 + rnd() * 8) * MINUTE;
    }
    onLaunch(makeLaunch(at));
    status.events++;
    status.lastEventAt = at;
    timer = setTimeout(loop, Math.min(30_000, expInterval(rateAt(at), rnd)));
  };
  timer = setTimeout(loop, 500);

  return {
    status,
    stop() {
      clearTimeout(timer);
    },
  };
}

function expInterval(perMinute, rnd) {
  return (-Math.log(1 - rnd()) / perMinute) * MINUTE;
}

function weightedChoice(items, weights, rnd) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function symbolFor(name, rnd) {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  if (/[^\x00-\x7f]/.test(name)) return name;
  if (words.length === 1 || rnd() < 0.4) return words[words.length - 1].toUpperCase().slice(0, 6);
  return words.map((w) => w[0].toUpperCase()).join('').slice(0, 5);
}

function randomB58(len, rnd) {
  let s = '';
  for (let i = 0; i < len; i++) s += B58[Math.floor(rnd() * 58)];
  return s;
}

function cap(w) {
  return /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w;
}

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
