// GeckoTerminal for Robinhood Chain (network id `robinhood`): token names, prices and pools,
// pool counts and candles. Port of sources/geckoterminal.py from cvxv666/fomo-robinhood-radar.
// The free API allows about 30 calls a minute per address and starts refusing earlier, and the
// site's Kolibri also uses it, so this one runs on a small budget of its own.

const BASE = 'https://api.geckoterminal.com/api/v2';
const JUNK_POOL_FEE = 10; // percent: a pool with a fee this high is a trap, not a market
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const f = (x) => {
  const v = Number(x);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** The fee tier GeckoTerminal writes into a pool's name: "SYNTH / USDG 89%" -> 89. */
export function poolFee(name) {
  const tail = String(name || '').trim().split(' ').pop();
  return tail.endsWith('%') ? Number(tail.slice(0, -1)) || null : null;
}

/** The pool to read a token by: the deepest one whose fee is not a trap. [address, attributes]. */
export function bestPool(ids, pools) {
  if (!ids.length) return [null, null];
  const rows = ids.map((i) => [i, (pools[i] && pools[i].attributes) || null]);
  const known = rows.filter(([, a]) => a);
  if (!known.length) return [ids[0].split('_').slice(1).join('_') || ids[0], null];
  const sane = known.filter(([, a]) => (poolFee(a.name) || 0) < JUNK_POOL_FEE);
  if (!sane.length) return [null, null];
  const [i, a] = sane.reduce((best, r) => ((f(r[1].reserve_in_usd) || 0) > (f(best[1].reserve_in_usd) || 0) ? r : best));
  return [i.split('_').slice(1).join('_'), a];
}

/** One entry of /tokens/multi with its pools -> {mint, symbol, price, liquidity, mcap, pool}. */
export function parseToken(item, pools = {}) {
  const a = (item && item.attributes) || {};
  if (!a.address) return null;
  const ids = (((item.relationships || {}).top_pools || {}).data || []).map((p) => p.id || '');
  let [pool, pa] = bestPool(ids, pools);
  let price = f(a.price_usd);
  let liquidity = f(a.total_reserve_in_usd);
  if (ids.length && pool === null && Object.keys(pools).length) {
    price = null;
    liquidity = 0; // only trap pools on offer: no depth anyone could sell into
  }
  if (pa) {
    if (pa.reserve_in_usd != null) liquidity = f(pa.reserve_in_usd);
    const full = ids.find((i) => i.endsWith(pool));
    const base = (((pools[full] || {}).relationships || {}).base_token || {}).data || {};
    const ours = String(base.id || '').toLowerCase().endsWith(String(a.address).toLowerCase());
    const pp = f(pa[ours ? 'base_token_price_usd' : 'quote_token_price_usd']);
    if (pp) price = pp;
  }
  return {
    mint: String(a.address).toLowerCase(),
    symbol: a.symbol || a.name || null,
    price,
    liquidity,
    mcap: f(a.market_cap_usd) || f(a.fdv_usd),
    pool: pool || null,
  };
}

export function parseOhlcv(body) {
  const rows = (((body || {}).data || {}).attributes || {}).ohlcv_list || [];
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const v = r.slice(0, 6).map(Number);
    if (v.every(Number.isFinite) && v[2] > 0 && v[3] > 0) out.push([Math.round(v[0]), v[1], v[2], v[3], v[4], v[5]]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

export function createGecko({ fetchImpl = fetch, rpm = 6, network = 'robinhood', log = null } = {}) {
  let chain = Promise.resolve();
  let lastAt = 0;
  const gap = Math.ceil(60_000 / Math.max(1, rpm));
  let calls = 0;

  async function get(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const turn = chain.then(async () => {
        const wait = lastAt + gap - Date.now();
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
      });
      chain = turn.catch(() => {});
      await turn;
      calls++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      let res;
      try {
        res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt === 2) throw err;
        continue;
      }
      clearTimeout(timer);
      if (res.status === 429) {
        await sleep(15_000 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`geckoterminal ${res.status} ${path}`);
      return res.json();
    }
    if (log) log.warn(`geckoterminal ${path}: still 429, skipping`);
    return null;
  }

  async function tokens(mints) {
    const out = [];
    const list = [...new Set(mints.filter(Boolean))];
    for (let i = 0; i < list.length; i += 30) {
      const body = await get(`/networks/${network}/tokens/multi/${list.slice(i, i + 30).join(',')}`, { include: 'top_pools' });
      if (!body) continue;
      const pools = Object.fromEntries(((body.included || [])).filter((p) => p.type === 'pool').map((p) => [p.id, p]));
      const items = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
      for (const it of items) {
        const t = parseToken(it, pools);
        if (t) out.push(t);
      }
    }
    return out;
  }

  async function pool(id) {
    if (!id) return null;
    const body = await get(`/networks/${network}/pools/${id}`);
    const a = ((body || {}).data || {}).attributes;
    if (!a) return null;
    const created = a.pool_created_at ? Math.floor(Date.parse(a.pool_created_at) / 1000) : null;
    return {
      transactions: a.transactions || {},
      createdAt: Number.isFinite(created) ? created : null,
      reserveUsd: f(a.reserve_in_usd),
      volH1: f((a.volume_usd || {}).h1),
    };
  }

  async function ohlcv(id, timeframe = 'minute', aggregate = 5, limit = 40) {
    if (!id) return [];
    const body = await get(`/networks/${network}/pools/${id}/ohlcv/${timeframe}`, { aggregate, limit: Math.min(limit, 1000) });
    return parseOhlcv(body);
  }

  return { tokens, pool, ohlcv, stats: () => ({ calls }) };
}
