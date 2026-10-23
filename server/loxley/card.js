// A launch read by cli/feed.js (enrich / followUp) as plain JSON for the page: every field the terminal card prints,
// the door priced at the sizes the page shows, the score with its reasons, and the links the card ends with.

export function cardOf(L, links, { doors = [0.01, 0.05, 0.1, 0.5] } = {}) {
  const m = L.maths || {};
  const s = L.socials;
  return {
    token: L.token, curve: L.curve, deployer: L.deployer, tx: L.tx, bn: L.bn, at: L.at || null, readAt: L.readAt || null, readMs: L.readMs ?? null,
    symbol: L.symbol ?? null, name: L.name ?? null, description: L.description ?? null, supply: L.supply ?? null,
    pair: { eth: !!L.pairIsEth, symbol: L.pairSym ?? null, address: L.pair },
    socials: s === undefined ? 'unread' : !s || !s.count ? null : { ...s.socials, count: s.count },
    feeRecipient: L.feeRecipient ?? null, feeThird: !!L.feeThird,
    exempt: L.exempt ?? null, // null = calldata unread, [] = none declared
    devBuy: { sharePct: L.devShare ?? null, eth: L.devQuote ?? null, wei: L.devQuoteWei ?? null },
    deployerRecord: L.record ?? null, // { launches, grads, twins, rate }
    farm: L.farm || 0, // siblings with the same fingerprint inside 30 min
    fees: { curveFeeBps: L.feeBps ?? null, creatorTaxBps: L.creatorTaxBps ?? null, openingTaxBps: L.taxBps ?? null },
    bonding: {
      fill: L.fill ?? null, realEth: L.real ?? null, thresholdEth: L.thr ?? null, graduated: !!L.graduated,
      priceEth: m.price ?? null, fdvEth: m.fdv ?? null, exact: !!m.exact, phantomEth: m.phantom ?? null, quoteEth: m.quote ?? null, safeEth: m.safe ?? null,
    },
    door: m.door ? doors.map((x) => ({ eth: x, ...m.door(x) })) : null, // { eth, impact (%), out (ETH) }
    flow: L.buyers == null ? null : {
      buys: L.buys, sells: L.sells, buyers: L.buyers, taxed: L.taxed, quoteIn: L.quoteIn ?? null, quoteOut: L.quoteOut ?? null,
      bundlePct: L.bundlePct ?? null, bundleWallets: L.bundleWallets ?? null, top5Pct: L.top5Pct ?? null, holders: L.holders ?? null,
      devSells: L.devSells ?? 0, devSoldPct: L.devSoldPct ?? null,
    },
    score: L.score ? { total: L.score.total, verdict: L.score.verdict, parts: L.score.parts } : null,
    links: links ? { pons: links.pons(L.token), axiom: links.axiom(L.curve), fomo: links.fomo(L.token), explorer: links.explorer(L.token), dexscreener: links.dexscreener(L.token), tx: L.tx ? links.tx(L.tx) : null } : null,
    sim: !!L.sim,
  };
}
