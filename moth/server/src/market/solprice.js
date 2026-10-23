// SOL/USD so the panel can show market caps in dollars. Tries a few public
// sources in turn; if none answer, the panel shows market caps in SOL.

const SOURCES = [
  async (f, signal) => (await (await f('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal })).json())?.solana?.usd,
  async (f, signal) => {
    const sol = 'So11111111111111111111111111111111111111112';
    const body = await (await f(`https://lite-api.jup.ag/price/v3?ids=${sol}`, { signal })).json();
    return body?.[sol]?.usdPrice;
  },
  async (f, signal) => Number((await (await f('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { signal })).json())?.price),
];

export class SolPrice {
  constructor({ fetchImpl = fetch, intervalMs = 120_000, log } = {}) {
    this.fetchImpl = fetchImpl;
    this.intervalMs = intervalMs;
    this.log = log;
    this.value = null;
    this.updatedAt = 0;
    this.timer = null;
  }

  start() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  async refresh() {
    for (const source of SOURCES) {
      try {
        const price = Number(await source(this.fetchImpl, AbortSignal.timeout(8000)));
        if (price > 0) {
          this.value = Math.round(price * 100) / 100;
          this.updatedAt = Date.now();
          return this.value;
        }
      } catch {
        /* try the next source */
      }
    }
    if (!this.value) this.log?.debug('sol price: no source answered, market caps stay in SOL');
    return this.value;
  }

  stop() {
    clearInterval(this.timer);
  }
}
