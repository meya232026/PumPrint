// Demo mode: loxley's own mock chain (vendor/loxley/test/mock-chain.js, unchanged) in this process, driven by a
// director that keeps a market going: a launch every few seconds with a mix of profiles (clean, farm clusters,
// declared bundles, heavy dev buys, high tax, no socials), buyers on the curves, some curves pumped to graduation,
// some rugged (the dev sells, the curve is dumped, or the pool is drained after graduation).
// The mock's DexScreener knows one pool; a small shim in front of it answers for every pool the director graduates,
// so pool marks and the pool sirens (LIQUIDITY LEAVING, CRASH, DISTRIBUTION) run in demo too.
// Everything listens on 127.0.0.1 with a random port. Nothing reaches the network.

import http from 'node:http';

const ETH = 10n ** 18n;
const wei = (x) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;
const toEth = (w) => Number(w) / 1e18;

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const WORDS = ['HOODCAT', 'SHERIFF', 'MARIAN', 'TUCK', 'NOTTS', 'ARROW', 'FEATHER', 'BOWSTRING', 'GREENWOOD', 'OUTLAW', 'QUIVER', 'LONGBOW', 'WARDEN', 'YEOMAN', 'MERRY', 'GISBORNE', 'ALANDALE', 'TITHE', 'MAJOROAK', 'FLETCH', 'STAG', 'ACORN', 'THICKET', 'BRAMBLE', 'FALCON', 'MOSS', 'TORCH', 'BARREL', 'GOBLET', 'LANTERN'];

export async function startDemoWorld({ L, seed = 7, every = [4000, 9000], log = console } = {}) {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const M = await L.require('test/mock-chain.js').start({ balance: '1000000000000000000000' });
  const DEX = L.require('test/dex-fixture.js');
  const ETHUSD = DEX.ethUsd();

  // ---------- the dex shim: graduated demo pools, the rest forwarded to the mock ----------
  const pools = new Map(); // token -> { sym, name, createdAt, hist: [{t, price}], buys: [], sells: [] }
  function pairOf(tok) {
    const p = M.state.pools[tok], meta = pools.get(tok); if (!p || !meta) return null;
    const now = Date.now(), priceNative = toEth(p.eth) / toEth(p.tok), priceUsd = priceNative * ETHUSD, liqUsd = 2 * toEth(p.eth) * ETHUSD;
    meta.hist.push({ t: now, price: priceUsd }); while (meta.hist.length && now - meta.hist[0].t > 6 * 60000) meta.hist.shift();
    const ago = (ms) => { let h = meta.hist[0]; for (const x of meta.hist) if (now - x.t >= ms) h = x; return h; };
    const chg = (ms) => { const h = ago(ms); return h && h.price ? +(((priceUsd / h.price) - 1) * 100).toFixed(2) : 0; };
    const win = (ms) => ({ buys: meta.buys.filter((t) => now - t <= ms).length, sells: meta.sells.filter((t) => now - t <= ms).length });
    const m5 = win(300000), h1 = win(3600000);
    return { chainId: 'robinhood', dexId: 'uniswap', pairAddress: '0x' + tok.slice(2, 38) + 'beef', url: 'https://dexscreener.com/robinhood/' + tok,
      baseToken: { address: tok, name: meta.name, symbol: meta.sym }, quoteToken: { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH' },
      priceUsd: String(priceUsd), priceNative: String(priceNative), liquidity: { usd: liqUsd, quote: toEth(p.eth), base: toEth(p.tok) },
      marketCap: priceUsd * 1e9, fdv: priceUsd * 1e9, volume: { m5: (m5.buys + m5.sells) * 60, h1: (h1.buys + h1.sells) * 60, h6: (h1.buys + h1.sells) * 60, h24: (h1.buys + h1.sells) * 60 },
      priceChange: { m5: chg(300000), h1: chg(3600000), h6: chg(3600000), h24: chg(3600000) }, txns: { m5, h1, h6: h1, h24: h1 }, pairCreatedAt: meta.createdAt,
      info: { socials: [{ type: 'twitter', url: 'https://x.com/' + meta.sym.toLowerCase() }] } };
  }
  const shim = http.createServer((req, res) => {
    const u = req.url || '/', send = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
    const m = u.match(/^\/latest\/dex\/tokens\/(0x[0-9a-fA-F]{40})/);
    if (m && pools.has(m[1].toLowerCase())) return send({ pairs: [pairOf(m[1].toLowerCase())] });
    const b = u.match(/^\/tokens\/v1\/robinhood\/(.+)$/);
    const fwd = http.request(M.url + u, { method: req.method, headers: req.headers }, (r) => {
      if (!b) { res.writeHead(r.statusCode, r.headers); return r.pipe(res); }
      let s = ''; r.on('data', (c) => (s += c)); r.on('end', () => { let list = []; try { list = JSON.parse(s); } catch {} for (const a of b[1].toLowerCase().split(',')) if (pools.has(a)) list.push(pairOf(a)); send(list); });
    });
    req.pipe(fwd);
  });
  await new Promise((r) => shim.listen(0, '127.0.0.1', r));
  const DEX_URL = 'http://127.0.0.1:' + shim.address().port;

  // ---------- the director ----------
  const live = []; // demo launches still on their curve: { tok, sym, plan, born }
  const tokenRec = (tok) => M.state.tokens[tok];
  const curveOf = (tok) => M.curve(tokenRec(tok).curve);
  const buyer = () => '0x' + Math.floor(rnd() * 2 ** 32).toString(16).padStart(8, '0').repeat(5);
  const dump = (tok, ethOut) => { const cv = curveOf(tok); if (!cv || cv.phase !== 0) return; const out = wei(Math.min(ethOut, toEth(cv.realWei) * 0.95)); if (out <= 0n) return; const tin = (out * cv.tokenReserveWei) / (cv.quoteWei - out); cv.quoteWei -= out; cv.realWei -= out; cv.tokenReserveWei += tin; cv.sellableWei += tin; };
  const soc = (s, kind) => kind === 'none' ? { twitter: '', telegram: '', discord: '', website: '', farcaster: '' } : { twitter: 'https://x.com/' + s, telegram: kind === 'full' ? 'https://t.me/' + s : '', discord: '', website: kind !== 'x' ? 'https://' + s + '.xyz' : '', farcaster: '' };
  let farm = null, n = 0;
  const PLANS = [['moon', 0.18], ['grind', 0.22], ['fade', 0.2], ['rug', 0.16], ['devdump', 0.12], ['flat', 0.12]];
  const plan = () => { let x = rnd(); for (const [k, w] of PLANS) { if ((x -= w) <= 0) return k; } return 'flat'; };

  function launch() {
    const i = n++, sym = WORDS[i % WORDS.length] + (i >= WORDS.length ? String(Math.floor(i / WORDS.length) + 1) : ''), lower = sym.toLowerCase();
    const o = { name: sym.charAt(0) + sym.slice(1).toLowerCase(), deployer: '0x' + (0xd000 + (i % 997)).toString(16).padStart(6, '0').repeat(7).slice(0, 40), decayMs: Math.round(between(0, 3500)), description: 'a demo launch on the mock chain' };
    const x = rnd();
    if (farm && farm.left > 0) { Object.assign(o, { socials: farm.socials, description: farm.description }); farm.left--; }            // the next sibling of a farm
    else if (x < 0.08) { farm = { left: 2, socials: soc('farm' + i, 'x'), description: 'season ' + i }; Object.assign(o, { socials: farm.socials }); }
    else if (x < 0.16) Object.assign(o, { socials: soc(lower, 'web'), exempt: [buyer(), buyer()] });                                     // a declared bundle
    else if (x < 0.22) Object.assign(o, { socials: soc(lower, 'full'), devTokens: between(1.1e8, 1.8e8) });                               // a heavy dev buy
    else if (x < 0.28) Object.assign(o, { socials: soc(lower, 'web'), tax: 700 });                                                         // 7% creator tax
    else if (x < 0.34) Object.assign(o, { socials: soc(lower, 'none') });                                                                  // no socials
    else if (x < 0.38) Object.assign(o, { socials: soc(lower, 'web'), feeRecipient: buyer() });                                            // fees to a third party
    else Object.assign(o, { socials: soc(lower, pick(['x', 'web', 'full'])) });                                                             // clean
    const e = M.launchNow(sym, o);
    live.push({ tok: e.token, sym, plan: plan(), born: Date.now() });
    if (live.length > 40) live.shift();
    return e;
  }
  function step() {
    const now = Date.now();
    for (const c of live.slice()) try {
      const cv = curveOf(c.tok), age = (now - c.born) / 1000;
      if (!cv || cv.phase !== 0) continue;
      if (cv.ready) { graduate(c); continue; }
      if (c.plan === 'moon' && rnd() < 0.5) M.walletBuy(buyer(), c.tok, between(0.05, 0.25));
      if (c.plan === 'grind' && rnd() < 0.25) M.walletBuy(buyer(), c.tok, between(0.02, 0.08));
      if (c.plan === 'fade') { if (age < 25 && rnd() < 0.3) M.walletBuy(buyer(), c.tok, between(0.03, 0.1)); else if (age > 25 && rnd() < 0.25) dump(c.tok, between(0.02, 0.08)); }
      if (c.plan === 'rug' && age > 18 && !c.done) { c.done = true; M.devSell(c.tok, between(2, 6)); dump(c.tok, 0.6); }
      if (c.plan === 'devdump' && age > 30 && !c.done) { c.done = true; M.devSell(c.tok, between(1, 3)); }
      if (c.plan !== 'rug' && rnd() < 0.08) M.walletBuy(buyer(), c.tok, between(0.01, 0.04));
    } catch (e) { /* a curve that closed under a lever: next step */ }
    for (const [tok, meta] of pools) { // pool life after graduation: flow, and the rug for some
      const p = M.state.pools[tok]; if (!p) continue;
      const age = (now - meta.createdAt) / 1000;
      if (meta.rug && age > meta.rugAt) { p.eth = (p.eth * 90n) / 100n; p.tok = (p.tok * 108n) / 100n; meta.sells.push(now, now, now); }
      else if (rnd() < 0.4) { const b = rnd() < 0.55; const amt = wei(between(0.01, 0.12)); if (b) { p.tok -= (amt * p.tok) / (p.eth + amt); p.eth += amt; meta.buys.push(now); } else if (amt < p.eth / 2n) { p.tok += (amt * p.tok) / (p.eth - amt); p.eth -= amt; meta.sells.push(now); } }
      for (const k of ['buys', 'sells']) while (meta[k].length && now - meta[k][0] > 3600000) meta[k].shift();
      if (age > 3600) pools.delete(tok);
    }
  }
  function graduate(c) {
    M.graduate(c.tok);
    pools.set(c.tok, { sym: c.sym, name: c.sym, createdAt: Date.now(), hist: [], buys: [], sells: [], rug: rnd() < 0.35, rugAt: between(40, 120) });
  }
  // the chain's clock: ~4 blocks a second like Robinhood Chain, timestamps kept on the wall clock
  const ticker = setInterval(() => { M.state.t0 = Date.now(); M.tick(); }, 500);
  const stepper = setInterval(step, 1500);
  let launcher = null;
  const next = () => { launcher = setTimeout(() => { try { launch(); } catch (e) { log.warn?.('demo launch: ' + e.message); } next(); }, between(every[0], every[1])); };
  next();
  // keep the mock's mined log list bounded: logs past the read window are dropped
  const pruner = setInterval(() => { const floor = M.state.head - 20000; M.state.mined = M.state.mined.filter((l) => parseInt(l.blockNumber, 16) > floor); }, 60000);

  return {
    M, env: { RPC_URL: M.url, EXPLORER_URL: M.url, DEX_URL, RPC_SPACING_MS: '5', RPC_LOGS_SPACING_MS: '20', EXPLORER_SPACING_MS: '0', POLL_MS: '500' },
    launch, graduate: (tok) => graduate(live.find((x) => x.tok === tok) || { tok, sym: tokenRec(tok).symbol }),
    pools, stats: () => ({ launches: n, onCurve: live.filter((c) => curveOf(c.tok)?.phase === 0).length, pools: pools.size, head: M.state.head, mined: M.state.mined.length }),
    async close() { clearInterval(ticker); clearInterval(stepper); clearInterval(pruner); clearTimeout(launcher); await new Promise((r) => shim.close(r)); await M.close(); },
  };
}
