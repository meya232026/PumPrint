// The read commands as data: scan, market, fees, dev, exit, xray. Each one assembles exactly what the command
// prints (cli/commands/*.js), from the same modules, and returns it instead of printing it. No wallet block:
// scan.js and doctor.js call attachWallet(); these never do.

export function createReads({ L, ctx }) {
  const E = L.require('cli/engine.js');
  const pons = L.require('cli/pons.js');
  const { isAddr, readToken, findLaunch } = L.require('cli/token.js');
  const { chain, sources, env } = ctx;
  const links = pons.makeLinks(env);
  const lower = (a) => String(a || '').toLowerCase();
  const need = (a) => { if (!isAddr(a)) { const e = new Error('pass a 0x address (40 hex characters)'); e.status = 400; throw e; } return lower(a); };
  const AGENTS = ['SCOUT', 'AUDIT', 'WHALE', 'LP', 'FLOW', 'VOL', 'SNIPER', 'EXIT'];
  const READS = { SCOUT: 'pools, pair age', AUDIT: 'source, holders', WHALE: 'top-10 ex-pool', LP: 'depth', FLOW: 'buys vs sells 5m', VOL: 'volume honesty', SNIPER: 'impact of 1 ETH', EXIT: 'safe size, pool trend' };
  const metricsJson = (m) => { const o = {}; for (const [k, v] of Object.entries(m)) if (typeof v !== 'function') o[k] = v; o.impact1 = m.impact ? m.impact(1) : null; return o; };

  async function scan(token) {
    token = need(token);
    const T = await readToken(ctx, token);
    // never the rpc url in a message a visitor sees: a provider url can carry its key
    if (T.head == null && !T.pair) { const e = new Error('the chain did not answer, and DexScreener has no pool for it (' + sources.why(env.DEX_URL) + ')'); e.status = 503; throw e; }
    const out = { token, at: T.at, head: T.head, symbol: T.symbol, name: T.name, supply: T.supply,
      phase: T.pair ? 'pool' : T.launch ? (T.grad || (T.curve && T.curve.graduated) ? 'graduated, pool not indexed yet' : 'on the curve') : 'no launch, no pool',
      launch: null, curve: null, pool: null, council: null, exit: null, xray: null, links: { explorer: links.explorer(token), dexscreener: links.dexscreener(token), pons: links.pons(token), fomo: links.fomo(token) } };
    if (T.launch) {
      const c = T.curve || {}, mth = E.curveMaths({ thr: T.launch.thr, supply: T.supply, ...c }, env.num('PHANTOM_ETH'));
      const [info, rec, declared] = await Promise.all([pons.tokenInfo(chain, token).catch(() => null), chain.factoryRecord(token).catch(() => null), pons.launchDeclared(chain, T.launch).catch(() => null)]);
      const soc = info || (declared && declared.socials ? { socials: declared.socials, count: Object.values(declared.socials).filter(Boolean).length } : null);
      const feeRecipient = rec ? rec.feeRecipient : (declared && declared.creatorFeeRecipient) || null;
      const feeThird = feeRecipient != null && feeRecipient !== T.launch.deployer && feeRecipient !== chain.ZERO;
      const exempt = declared && declared.exempt ? declared.exempt : null;
      const d = T.devBuy, b = T.buyers;
      out.curve = { address: T.launch.curve, fill: mth.fill, realEth: c.real ?? null, thresholdEth: T.launch.thr, pair: T.pairIsEth ? 'ETH' : T.pairSym || T.launch.pair,
        feeBps: c.feeBps ?? null, creatorTaxBps: c.creatorTaxBps ?? null, openingTaxBps: c.taxBps ?? null, graduated: c.graduated ?? null, ready: c.ready ?? null, gradBlock: T.grad ? T.grad.bn : null,
        priceEth: mth.price, fdvEth: mth.fdv, exact: mth.exact, phantomEth: mth.phantom, phase: c.phase ?? null, sellable: c.sellable ?? null,
        door: T.pair ? null : [0.01, 0.05, 0.1, 0.5].map((x) => ({ eth: x, ...mth.door(x) })), safeEth: mth.safe };
      const Ls = { devShare: d ? d.share : null, creatorTaxBps: c.creatorTaxBps, pairIsEth: T.pairIsEth, record: null, buyers: b ? b.buyers : null, buys: b ? b.buys : null, taxed: b ? b.taxed : null, fill: mth.fill,
        socials: soc == null ? undefined : soc, exempt, feeThird, bundlePct: b ? b.bundlePct : null, bundleWallets: b ? b.bundleWallets : null, top5Pct: b ? b.top5Pct : null };
      out.launch = { block: T.launch.bn, tx: T.launch.tx, launchedAt: T.launchAt, deployer: T.launch.deployer,
        socials: soc == null ? 'unread' : { ...soc.socials, count: soc.count }, description: (info && info.description) || (declared && declared.description) || null, logo: (info && info.logo) || (declared && declared.logo) || null,
        feeRecipient, feeThird, creatorTaxBps: rec ? rec.creatorTaxBps : null, exempt, devBuy: d, trades: b, factoryRecord: rec,
        score: E.launchScore(Ls), // deployer record not in a one-token read: `hunt` keeps the index
        links: { tx: links.tx(T.launch.tx), axiom: links.axiom(T.launch.curve) } };
    }
    if (T.pair) {
      const m = E.computeMetrics({ pair: T.pair, pairs: T.pairs, chain: T.view }), score = E.scoreOf(m, []), verd = E.verdictsOf(m, []), kind = E.verdictKind(score);
      out.pool = { dex: T.pair.dexId, quote: T.pair.quoteToken ? T.pair.quoteToken.symbol : null, pools: T.pairs.length, pairAddress: T.pair.pairAddress, url: T.pair.url || null, metrics: metricsJson(m), view: T.view };
      out.council = { votes: AGENTS.map((a) => ({ agent: a, reads: READS[a], ...(verd[a] || { state: 'na', text: 'n/a' }) })), survival: score.total, stamp: kind === 'enter' ? 'ENTER' : kind === 'avoid' ? 'AVOID' : 'CAREFUL', parts: score.parts, hard: score.hard };
      out.exit = { fromReserveEth: m.reserveSol, safeEth: m.safeSol, rows: [0.25, 1, 3].map((x) => ({ eth: x, ...E.exitMaths(m.reserveSol, x) })) };
    }
    if (T.xray) out.xray = { ...T.xray, tag: sources.xrayTag(T.xray), explorer: links.address(T.xray.dep) };
    out.calls = { rpc: chain.rpc.stats.calls, http: sources.stats.calls };
    return out;
  }

  const MAX_SCORE = 85;
  async function market({ top = 15, by = 'liq', extra = [] } = {}) {
    const [boosts, profiles] = await Promise.all([sources.dex.boosts(), sources.dex.profiles()]);
    const addrs = [];
    const push = (a) => { a = lower(a); if (/^0x[0-9a-f]{40}$/.test(a) && !addrs.includes(a)) addrs.push(a); };
    (Array.isArray(boosts) ? boosts : []).forEach((b) => { if (b && b.chainId === env.CHAIN_SLUG) push(b.tokenAddress); });
    (Array.isArray(profiles) ? profiles : []).forEach((b) => { if (b && b.chainId === env.CHAIN_SLUG) push(b.tokenAddress); });
    extra.forEach(push);
    if (!addrs.length) return { at: Date.now(), rows: [], listed: 0, ethUsd: null, maxScore: MAX_SCORE, why: sources.why(env.DEX_URL) };
    const best = await sources.dex.pairsMany(addrs.slice(0, 90));
    const rows = Object.keys(best).map((k) => {
      const p = best[k], m = E.computeMetrics({ pair: p, pairs: [p], chain: null }), score = E.scoreOf(m, []), kind = E.verdictKind(score);
      return { token: k, pair: p.pairAddress, symbol: m.symbol, name: m.name, price: m.price, quoteUsd: m.solPrice, quoteIsEth: /^(ETH|WETH)$/i.test(m.quote || ''), chg1: m.chg1, chg24: m.chg24, liq: m.liq, vol24: m.vol24,
        buys24: p.txns && p.txns.h24 ? p.txns.h24.buys || 0 : 0, sells24: p.txns && p.txns.h24 ? p.txns.h24.sells || 0 : 0, ageMs: m.ageMs, turnover: m.turnover, score: score.total,
        stamp: kind === 'enter' ? 'ENTER' : kind === 'avoid' ? 'AVOID' : 'CAREFUL', hard: score.hard, quote: m.quote, dex: m.dex, url: links.dexscreener(k) };
    });
    const eths = rows.filter((r) => r.quoteIsEth && r.quoteUsd > 100 && r.quoteUsd < 100000).map((r) => r.quoteUsd).sort((a, b) => a - b);
    const ethUsd = eths.length ? eths[Math.floor(eths.length / 2)] : null;
    const exitUsd = ethUsd || 2500;
    rows.forEach((r) => { r.exitPct = r.liq > 0 ? (exitUsd / (exitUsd + r.liq / 2)) * 100 : null; });
    const key = { liq: (r) => r.liq || 0, vol: (r) => r.vol24 || 0, age: (r) => -(r.ageMs || 0), change: (r) => r.chg24 || 0, score: (r) => r.score }[by] || ((r) => r.liq || 0);
    rows.sort((a, b) => key(b) - key(a));
    return { at: Date.now(), chain: env.CHAIN_SLUG, listed: rows.length, ethUsd, exitEthUsd: exitUsd, maxScore: MAX_SCORE, by, rows: rows.slice(0, top) };
  }

  async function fees(token) {
    token = need(token);
    const head = await chain.blockNumber();
    const [launch, rec] = await Promise.all([findLaunch(chain, token, head), chain.factoryRecord(token)]);
    if (!launch && !rec) { const e = new Error('the factory has no launch for ' + token); e.status = 404; throw e; }
    const deployer = (rec && rec.deployer) || (launch && launch.deployer), recipient = (rec && rec.feeRecipient) || deployer, curve = (rec && rec.curve) || (launch && launch.curve);
    const escrow = pons.makeEscrow(chain, env), from = launch ? launch.bn : Math.max(0, head - 400000);
    const [bal, credited, claimed, tk] = await Promise.all([escrow.balanceOf(recipient), escrow.credited(recipient, from, head), escrow.claimed(recipient, from, head), chain.tokenRead(token)]);
    const sum = (l) => l.reduce((s, c) => s + c.amount, 0n);
    const fromCurve = sum(credited.filter((c) => c.depositor === curve)), fromPool = sum(credited.filter((c) => c.depositor !== curve)), paid = sum(claimed);
    const diff = bal == null ? null : fromCurve + fromPool - paid - bal;
    const eth = (w) => (w == null ? null : Number(w) / 1e18);
    const claims = [];
    for (const c of claimed.slice(-10)) { const b = await chain.getBlock(c.bn).catch(() => null); claims.push({ block: c.bn, at: b ? b.timestamp : null, eth: eth(c.amount), tx: c.tx, url: links.tx(c.tx) }); }
    return { token, symbol: tk.symbol, phase: rec ? rec.phase : null, recipient, deployer, thirdParty: !!(recipient && deployer && recipient !== deployer), creatorTaxBps: rec ? rec.creatorTaxBps : null,
      creditedEth: eth(fromCurve + fromPool), fromCurveEth: eth(fromCurve), fromPoolEth: eth(fromPool), credits: credited.length, claimedEth: eth(paid), claims, unclaimedEth: eth(bal),
      checksOut: diff == null ? null : diff > -10000000000000n && diff < 10000000000000n, diffEth: eth(diff), windowFrom: from, escrow: escrow.address };
  }

  async function dev(wallet, { window = 400000 } = {}) {
    wallet = need(wallet);
    const head = await chain.blockNumber(), from = Math.max(0, head - window);
    const logs = await chain.getLogs(chain.factory, [chain.T.LAUNCH, null, null, '0x' + chain.dec.pad32(wallet)], from, head, { wide: true });
    const launches = logs.map((lg) => chain.parseFactoryLog(lg)).filter((e) => e && e.kind === 'launch').sort((a, b) => b.bn - a.bn);
    const bt = await chain.measureBlockTime(head).catch(() => ({ blockTime: 0.25, headAt: Date.now() }));
    const PH = ['on the curve', 'swept', 'pool created', 'rescued'];
    const rows = [];
    for (const e of launches.slice(0, 40)) {
      const [tk, rec] = await Promise.all([chain.tokenRead(e.token).catch(() => ({})), chain.factoryRecord(e.token).catch(() => null)]);
      rows.push({ token: e.token, symbol: tk.symbol || null, block: e.bn, at: bt.headAt - (head - e.bn) * bt.blockTime * 1000, phase: rec ? rec.phase : null, phaseText: rec ? PH[rec.phase] || 'phase ' + rec.phase : null, creatorTaxBps: rec ? rec.creatorTaxBps : null, url: links.explorer(e.token) });
    }
    const grads = rows.filter((r) => r.phase === 2).length, swept = rows.filter((r) => r.phase === 1).length;
    return { wallet, window, launches: launches.length, graduated: grads, swept, tag: launches.length >= 5 && grads === 0 ? 'SERIAL' : launches.length >= 2 ? 'REPEAT' : 'FRESH', rows, url: links.address(wallet) };
  }

  async function exit(token, eth) {
    token = need(token);
    const T = await readToken(ctx, token, { xray: false, buyers: false });
    const sizes = eth > 0 ? [eth] : [0.1, 0.25, 0.5, 1, 3];
    if (T.pair) {
      const m = E.computeMetrics({ pair: T.pair, pairs: T.pairs, chain: T.view });
      return { token, symbol: T.symbol, venue: 'pool', poolUsd: m.liq, reserveEth: m.reserveSol, priceUsd: m.price, safeEth: m.safeSol, rows: m.reserveSol == null ? [] : sizes.map((x) => ({ eth: x, ...E.exitMaths(m.reserveSol, x) })), maths: 'impact = x / (x + R) · out = x × (1 − impact) × 0.997' };
    }
    if (T.launch && T.curve) {
      const mth = E.curveMaths({ thr: T.launch.thr, supply: T.supply, ...T.curve }, env.num('PHANTOM_ETH'));
      return { token, symbol: T.symbol, venue: 'curve', fill: mth.fill, realEth: T.curve.real, feeBps: mth.fee, creatorTaxBps: mth.tax, exact: mth.exact, safeEth: mth.safe, rows: sizes.map((x) => ({ eth: x, ...mth.door(x) })) };
    }
    const e = new Error('no pool and no curve found for this address'); e.status = 404; throw e;
  }

  async function xray(addr) {
    addr = need(addr);
    const code = await chain.getCode(addr).catch(() => null), isContract = !!(code && code !== '0x');
    let launch = null, x;
    if (isContract) { launch = await findLaunch(chain, addr).catch(() => null); x = await sources.xray(addr, launch ? { deployer: launch.deployer } : null); }
    else x = await sources.xray(null, { deployer: addr });
    if (!x) return { address: addr, isContract, found: false, why: sources.why(sources.api) };
    return { address: addr, isContract, found: true, from: launch ? 'TokenLaunched' : isContract ? 'creation tx' : 'wallet', ...x, tag: sources.xrayTag(x), empty: x.balance != null && x.balance < 0.005, url: links.address(x.dep) };
  }

  return { scan, market, fees, dev, exit, xray };
}
