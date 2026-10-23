// Decides what a client may see. Without HOLDER_MINT the server is in open mode
// and everyone gets every window plus alerts. With it, windows shorter than the
// free ones and watchlist alerts need a key whose wallet holds enough tokens.

const DAY = 24 * 60 * 60_000;

export class Access {
  constructor({ config, keys, balances, log }) {
    this.config = config;
    this.keys = keys;
    this.balances = balances;
    this.log = log;
    this.holderMode = Boolean(config.holder.mint);
  }

  get minBalance() {
    return this.config.holder.minBalance;
  }

  allowedWindows(tier) {
    return tier === 'pro' ? this.config.windows : this.config.freeWindows;
  }

  canAlert(tier) {
    return tier === 'pro';
  }

  publicInfo() {
    const { holder } = this.config;
    return {
      holderMode: this.holderMode,
      holder: this.holderMode
        ? { symbol: holder.symbol, mint: holder.mint, minBalance: holder.minBalance, buyUrl: holder.buyUrl || `https://pump.fun/coin/${holder.mint}` }
        : null,
      windows: this.config.windows,
      freeWindows: this.holderMode ? this.config.freeWindows : this.config.windows,
    };
  }

  // key -> { tier, keyStatus, wallet?, balance? }
  // keyStatus: none | ok | invalid | expired | insufficient | unverified | not-needed
  async resolve(key, { fresh = false } = {}) {
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (!this.holderMode) return { tier: 'pro', keyStatus: trimmed ? 'not-needed' : 'none' };
    if (!trimmed) return { tier: 'free', keyStatus: 'none' };
    const read = this.keys.read(trimmed);
    if (!read.ok) return { tier: 'free', keyStatus: read.reason };
    try {
      const balance = await this.balances.get(read.wallet, { fresh });
      if (balance >= this.minBalance) return { tier: 'pro', keyStatus: 'ok', wallet: read.wallet, balance };
      return { tier: 'free', keyStatus: 'insufficient', wallet: read.wallet, balance };
    } catch (err) {
      this.log.warn('balance check failed', { wallet: read.wallet, error: err.message });
      // The balance was checked when this key was issued; give fresh keys the benefit of the doubt.
      if (Date.now() - (read.iat || 0) < DAY) return { tier: 'pro', keyStatus: 'ok', wallet: read.wallet };
      return { tier: 'free', keyStatus: 'unverified', wallet: read.wallet };
    }
  }
}

export function shortAddress(address) {
  return address && address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address || null;
}
