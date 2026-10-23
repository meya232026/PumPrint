// What the page reads from a running Chameleonscope engine: feed rows, the radar, today's numbers,
// the calls, known traders' buys, and one token in full. Shared by the worker and the script that
// freezes a sample for running without a server.

export function makeReader(TL, V, { rows: ROWS = 30 } = {}) {
  const U = TL.util;
  const GROUPS = ['new', 'almost', 'graduated', 'top'];
  const num = (v) => (U.isNum(v) ? v : null);
  const pic = (t) => {
    const s = t.logoOk || t.logo;
    return typeof s === 'string' && /^https:\/\/[^\s"'<>]{1,400}$/.test(s) ? s : null;
  };
  
  /** One feed row, as the page draws it. */
  function row(t) {
    const r = V.row(t, 'h1');
    return {
      id: r.id,
      chain: r.chain,
      address: r.address,
      symbol: r.symbol,
      name: r.name,
      logo: pic(t),
      launchpad: r.launchpad,
      createdAt: r.createdAt,
      stage: r.stageLabel,
      curve: num(r.curve),
      complete: !!r.complete,
      mc: num(r.mc),
      liq: num(r.liq),
      holders: num(r.holders),
      hd: num(r.holdersDelta1h),
      chg: num(r.chg),
      vol: num(r.vol),
      tx: r.tx ? { b: r.tx.b || 0, s: r.tx.s || 0 } : null,
      verdict: r.verdict,
      scores: r.scores,
      pot: num(r.potential),
      facts: r.facts,
      flags: (r.flags || []).slice(0, 5),
      peakX: r.peakX,
      runner: r.runner,
      call: r.call,
      quantum: r.quantum || null,
      known: r.known || null,
      smart: t.smart ? { wallets: t.smart.wallets || 0, kols: t.smart.kols || 0 } : null,
      demo: r.demo,
    };
  }
  
  function callRow(c) {
    return {
      id: c.id,
      chain: c.chain,
      address: c.address,
      symbol: c.symbol,
      name: c.name,
      at: c.at,
      kind: c.kind || null,
      mc: c.mc,
      peakMc: c.peakMc,
      peakX: c.peakX,
      nowX: c.nowX,
      stage: c.stage,
      status: c.status,
      why: (c.why || []).slice(0, 4),
      gradWhy: c.gradWhy || null,
      estimated: !!c.estimated,
      demo: !!c.demo,
    };
  }
  
  function snapshot() {
    const out = {
      at: Date.now(),
      mode: TL.store.mode,
      chainMode: { ...TL.store.chainMode },
      solUsd: num(TL.store.solUsd),
      ethUsd: num(TL.store.ethUsd),
      sources: Object.fromEntries(Object.entries(TL.sources.status || {}).map(([k, v]) => [k, { state: v.state, note: v.note }])),
      gmgn: Boolean(TL.gmgn && TL.gmgn.active && TL.gmgn.active()),
      feeds: {},
      radar: {},
      day: {},
      calls: TL.calls.list
        .slice(-120)
        .reverse()
        .map(callRow),
      known: [],
    };
    for (const c of ['solana', 'robinhood']) {
      out.feeds[c] = {};
      for (const g of GROUPS) {
        const f = V.feed(c, g);
        out.feeds[c][g] = { total: f.total, hidden: Object.values(f.hidden || {}).reduce((s, n) => s + n, 0), checking: f.checking, rows: f.rows.slice(0, ROWS).map(row) };
      }
      out.radar[c] = V.radar(c, { allowDemo: TL.store.mode === 'demo' });
      try {
        const d = TL.dayStats(c);
        out.day[c] = { launches: d.day.launches, graduated: d.day.graduated, runners: d.day.runners, best: d.day.best || null, tiers: d.day.tiers, tierLevels: d.tiers, live: d.live };
      } catch {
        out.day[c] = null;
      }
      if (TL.known && TL.known.alerts) {
        out.known.push(
          ...TL.known
            .alerts(c, 12)
            .map((x) => ({ at: x.at, chain: x.chain, side: x.side, usd: Math.round(x.usd || 0), token: x.token, symbol: x.symbol, name: x.name, tw: x.tw, tier: x.tier, why: x.why })),
        );
      }
    }
    out.known.sort((a, b) => b.at - a.at);
    return out;
  }
  
  function detail(id) {
    const d = V.detail(id);
    if (!d) return null;
    const t = d.token;
    const reasons = (t.scores && t.scores.reasons) || t.reasons || {};
    const list = (xs) => (xs || []).map((r) => ({ label: r.label, pts: r.pts, note: r.note || '' }));
    return {
      id,
      chain: t.chain,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      logo: pic(t),
      description: typeof t.description === 'string' ? t.description.slice(0, 280) : '',
      launchpad: t.launchpad,
      quote: t.quote,
      createdAt: t.createdAt,
      graduatedAt: t.graduatedAt,
      stage: d.stageLabel,
      curve: num(t.curve),
      mc: num(t.mc),
      liq: num(t.liq),
      price: num(t.price),
      holders: num(t.holders),
      vol: t.vol,
      chg: t.chg,
      tx: t.tx,
      socials: t.socials || {},
      dev: t.dev ? { address: t.dev.address, pct: t.dev.pct, sold: t.dev.sold, launches: t.dev.launches, graduated: t.dev.graduated, rugs: t.dev.rugs } : null,
      facts: { top10: d.top10circ, sniperPct: t.sniperPct, bundlePct: t.bundlePct, insiderPct: t.insiderPct, mintAuth: t.mintAuth, freezeAuth: t.freezeAuth, lpLocked: t.lpLocked, honeypot: t.honeypot },
      verdict: d.verdict,
      scores: d.scores ? { safety: d.scores.safety, momentum: d.scores.momentum, community: d.scores.community, unknown: d.scores.unknown || [] } : null,
      reasons: { safety: list(reasons.safety), momentum: list(reasons.momentum), community: list(reasons.community) },
      flags: (d.flags || []).map((f) => ({ label: f.label, hard: !!f.hard })),
      hidden: d.hideReason || '',
      rugSign: d.rugSign || null,
      potential: d.potential,
      call: d.call ? callRow(d.call) : null,
      quantum: d.quantum,
      athMc: num(t.athMc),
      peakX: num(t.peakX),
    };
  }

  return { snapshot, detail, row, callRow };
}

/** The radar has no preview data of its own (it refuses demo tokens): six invented launches named on the narrative. */
export function seedQuantumPreview(TL) {
  const U = TL.util;
  const F = TL.demoFlow;
  const r = U.rng('chameleon-demo-quantum');
  const now0 = U.now();
  [
    ['Quantum Otter', 'QOTTER'],
    ['Qubit Cat', 'QUBIT'],
    ['Q-Day Frog', 'QDAY'],
    ['Schrodinger Pickle', 'SCHRO'],
    ['Entangled Llama', 'ENTGL'],
    ['QuantAI Comet', 'QUANT'],
  ].forEach(([name, sym], i) => {
    const born = now0 - (6 + i * 5) * TL.MIN;
    const t = F.make('solana', born, r, { q: 0.55 + 0.05 * i, rug: false });
    t.name = name;
    t.symbol = sym;
    for (let ts = born + 20 * TL.SEC; ts < now0; ts += 20 * TL.SEC) F.step(t, ts, 20 * TL.SEC, r);
    TL.store.tokens[t.id] = t;
    TL.store.index(t);
    TL.store._list = null;
    F.list.push(t);
    t.ready = true;
  });
  TL.store.recompute();
}
