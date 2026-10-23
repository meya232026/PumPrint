// Canary demo world: Canary's own FixtureReader driven by a 12-tick tape, so that every rule fires at
// least once a cycle (plus one graduation). Made-up tokens and addresses, no network.
//   tick % 12: 2 NIGHTS deployer drop (LEAVE) · 3 ORBIT price +49% (WATCH) · 4 NIGHTS reserve -26% (LEAVE)
//              5 ORBIT +26 swaps (WATCH) · 6 NIGHTS curve fees moved (WATCH), RAVEN graduates (INFO, once)
//              7 ORBIT token fees moved (WATCH) · 8-9 LANTERN 34 min without a trade (WATCH)
//              9 ORBIT liquidity -31% (LEAVE) · 11 ORBIT price back -33% (WATCH) · 0 everything recovers
//   NIGHTS' deployer has 27 launches, so it is WATCH (serial-deployer) on every sweep.

const E18 = 10n ** 18n;
const addr = (prefix, n) => '0x' + prefix + n.toString(16).padStart(40 - prefix.length, '0');
export const DEMO_WALLET = addr('5a11e7', 1);
const ETH = '0x0000000000000000000000000000000000000000';
const WETH = addr('eeee', 1);

const priceAt = (tick) => Math.pow(1.0001, tick); // token is currency0, equal decimals: same maths as rpc.ts

export function createCanaryDemo(C, clock = Date.now) {
  const now = clock();
  const base = (i, over) => ({
    token: addr('de', i), symbol: 'TOKEN', devHoldPct: 3, liquidityWei: 4_200_000_000_000_000_000n, trades: 40, lastTradeAt: now - 20_000,
    feesPendingWei: 300_000_000_000_000_000n, deployerLaunches: 2, phase: 0, curve: addr('dc', i), deployer: addr('dd', i),
    pairToken: ETH, pairSymbol: 'ETH', pairDecimals: 18, tokenDecimals: 18, creatorTaxBps: 100, at: now, ...over,
  });
  const pool = (i, over) => base(i, {
    phase: 2, liquidityWei: 0n, pairToken: WETH, pairSymbol: 'WETH', feesPendingWei: 50_000_000_000_000_000n,
    poolId: '0x' + i.toString(16).padStart(64, 'a'), poolLiquidity: 48_219_330_118_220_441_009n, poolTick: -180_000,
    poolPriceQuotePerToken: priceAt(-180_000), poolPendingTokenFeesWei: 1_500_000n * E18, creatorTaxBps: 200, ...over,
  });
  const T = {
    steady: base(1, { symbol: 'STEADY', devHoldPct: 3, trades: 61 }),
    nights: base(2, { symbol: 'NIGHTS', devHoldPct: 18, deployerLaunches: 27, deployerGraduated: 2 }),
    lantern: base(3, { symbol: 'LANTERN', devHoldPct: 7.5, liquidityWei: 2_840_000_000_000_000_000n, trades: 31, feesPendingWei: 28_000_000_000_000_000n }),
    orbit: pool(4, { symbol: 'ORBIT', devHoldPct: 1.12, trades: 57 }),
    raven: base(5, { symbol: 'RAVEN', devHoldPct: 13.4, liquidityWei: 3_950_000_000_000_000_000n, trades: 74 }),
    wire: base(6, { symbol: 'WIRE', devHoldPct: 4.6, trades: 23, liquidityWei: 1_100_000_000_000_000_000n }),
  };
  const fixtures = Object.fromEntries(Object.values(T).map((s) => [s.token.toLowerCase(), s]));
  const held = { [DEMO_WALLET.toLowerCase()]: Object.values(T).map((s) => ({ token: s.token, symbol: s.symbol, balance: 1_000n * E18 })) };
  const reader = new C.FixtureReader(fixtures, held);
  const fixtureSnapshot = reader.snapshot.bind(reader);
  reader.snapshot = async (token) => ({ ...(await fixtureSnapshot(token)), at: clock() }); // FixtureReader stamps Date.now()
  let block = 53_400_000n;
  reader.health = async () => ({ ok: true, chainId: 4663, block }); // the fixture block never moves; make it tick
  let graduated = false;

  function advance(tick) {
    const t = clock();
    block += 180n; // ~45 s of 250 ms blocks (made up)
    const k = tick % 12;
    reader.advance(T.steady.token, { trades: 61 + tick, lastTradeAt: t - 9_000 });
    reader.advance(T.wire.token, { devHoldPct: Math.max(2.2, 4.6 - (tick % 12) * 0.15), trades: 23 + (tick >> 1), lastTradeAt: t - 40_000 });

    // NIGHTS: canary's own advanceDemo pattern, on a 12-tick cycle
    if (k === 0) reader.advance(T.nights.token, { devHoldPct: 18, liquidityWei: 4_200_000_000_000_000_000n, feesPendingWei: 300_000_000_000_000_000n, trades: 40 + tick, lastTradeAt: t });
    else if (k === 2) reader.advance(T.nights.token, { devHoldPct: 14.8, trades: 42 + tick, lastTradeAt: t });
    else if (k === 4) reader.advance(T.nights.token, { liquidityWei: 3_100_000_000_000_000_000n, trades: 44 + tick, lastTradeAt: t });
    else if (k === 6) reader.advance(T.nights.token, { feesPendingWei: 90_000_000_000_000_000n, trades: 46 + tick, lastTradeAt: t });
    else reader.advance(T.nights.token, { trades: 40 + tick, lastTradeAt: t });

    // LANTERN: goes quiet for 34 minutes at k 8-9 (volume-dead), trades again afterwards
    reader.advance(T.lantern.token, k === 8 || k === 9 ? { lastTradeAt: t - 34 * 60_000 } : { trades: 31 + tick, lastTradeAt: t - 30_000 });

    // ORBIT: graduated pool
    const o = { lastTradeAt: t - 15_000 };
    if (k === 0) Object.assign(o, { poolLiquidity: 48_219_330_118_220_441_009n, poolPendingTokenFeesWei: 1_500_000n * E18 });
    if (k === 3) Object.assign(o, { poolTick: -176_000, poolPriceQuotePerToken: priceAt(-176_000) });
    if (k === 5) Object.assign(o, { trades: 57 + 26 });
    if (k === 6) Object.assign(o, { trades: 57 }); // window slides back: a fall is not a signal
    if (k === 7) Object.assign(o, { poolPendingTokenFeesWei: 200_000n * E18 });
    if (k === 9) Object.assign(o, { poolLiquidity: 33_271_337_781_572_104_296n });
    if (k === 11) Object.assign(o, { poolTick: -180_000, poolPriceQuotePerToken: priceAt(-180_000) });
    reader.advance(T.orbit.token, o);

    // RAVEN: graduates once
    if (k === 6 && !graduated) {
      graduated = true;
      reader.advance(T.raven.token, { phase: 2, liquidityWei: 0n, pairToken: WETH, pairSymbol: 'WETH', poolId: '0x' + 'b'.repeat(64), poolLiquidity: 9_000_000_000_000_000_000n, poolTick: -170_000, poolPriceQuotePerToken: priceAt(-170_000), poolPendingTokenFeesWei: 0n, trades: 3, lastTradeAt: t, feesPendingWei: 0n });
    } else if (!graduated) reader.advance(T.raven.token, { trades: 74 + tick, lastTradeAt: t - 5_000, liquidityWei: 3_950_000_000_000_000_000n + BigInt(tick) * 10_000_000_000_000_000n });
    else reader.advance(T.raven.token, { trades: 3 + (tick % 12), lastTradeAt: t - 7_000 });
  }

  return { reader, wallet: DEMO_WALLET, tokens: Object.values(T).map((s) => s.token), advance };
}
