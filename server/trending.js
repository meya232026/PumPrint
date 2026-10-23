// Trending Solana memecoins for the coins that fly out of the fingerprint.
// Source: GeckoTerminal trending pools (keyless), DexScreener boosts as a fallback.
// Logos are proxied through /api/icon so the page can draw them into WebGL.

const GECKO = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token&page=1';
const DEX_BOOSTS = 'https://api.dexscreener.com/token-boosts/top/v1';
const DEX_TOKENS = 'https://api.dexscreener.com/tokens/v1/solana/';
const TTL_MS = 5 * 60_000;
const ICON_HOSTS = new Set([
  'assets.geckoterminal.com',
  'coin-images.coingecko.com',
  'assets.coingecko.com',
  'dd.dexscreener.com',
  'cdn.dexscreener.com',
]);
const ICON_TYPES = /^image\/(png|jpeg|jpg|webp|gif)$/i;
const NOT_MEME = new Set([
  'SOL', 'WSOL', 'USDC', 'USDT', 'USD1', 'PYUSD', 'USDS', 'JUP', 'RAY', 'JTO', 'PYTH', 'BTC', 'WBTC', 'CBBTC', 'ETH', 'WETH',
  'JITOSOL', 'MSOL', 'BSOL', 'JUPSOL', 'INF', 'HSOL', 'ORCA', 'DRIFT', 'KMNO', 'W', 'TNSR', 'CLOUD', 'HNT', 'RENDER',
]);

// Shown when nothing live is available (demo mode, no network).
export const FALLBACK_COINS = [
  'BONK', 'WIF', 'PENGU', 'FARTCOIN', 'POPCAT', 'TRUMP', 'PNUT', 'MEW', 'GOAT', 'MOODENG', 'BOME', 'PUMP', 'USELESS', 'GIGA', 'MICHI', 'CHILLGUY',
].map((symbol) => ({ symbol, name: symbol, icon: null, change: null }));

export function iconUrl(src) {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:' || !ICON_HOSTS.has(u.hostname)) return null;
    return `/api/icon?u=${encodeURIComponent(u.href)}`;
  } catch {
    return null;
  }
}

export function parseGecko(json) {
  const tokens = new Map();
  for (const inc of json?.included ?? []) {
    if (inc?.type === 'token' && inc.attributes) tokens.set(inc.id, inc.attributes);
  }
  const out = [];
  for (const pool of json?.data ?? []) {
    const a = pool?.attributes;
    const baseId = pool?.relationships?.base_token?.data?.id;
    const t = baseId && tokens.get(baseId);
    if (!a || !t) continue;
    const symbol = String(t.symbol || '').trim().replace(/^\$/, '').slice(0, 12);
    if (!symbol || NOT_MEME.has(symbol.toUpperCase())) continue;
    const img = t.image_url && !/missing/i.test(t.image_url) ? iconUrl(t.image_url) : null;
    const ch = Number(a.price_change_percentage?.h24);
    out.push({
      symbol,
      name: String(t.name || symbol).slice(0, 40),
      icon: img,
      change: Number.isFinite(ch) ? ch / 100 : null,
      address: t.address || null,
      url: t.address ? `https://dexscreener.com/solana/${t.address}` : null,
    });
  }
  return out;
}

export function parseDexTokens(pairs) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const b = p?.baseToken;
    if (!b || seen.has(b.address)) continue;
    seen.add(b.address);
    const symbol = String(b.symbol || '').trim().slice(0, 12);
    if (!symbol || NOT_MEME.has(symbol.toUpperCase())) continue;
    const ch = Number(p.priceChange?.h24);
    out.push({
      symbol,
      name: String(b.name || symbol).slice(0, 40),
      icon: p.info?.imageUrl ? iconUrl(p.info.imageUrl) : null,
      change: Number.isFinite(ch) ? ch / 100 : null,
      address: b.address,
      url: p.url || `https://dexscreener.com/solana/${b.address}`,
    });
  }
  return out;
}

function dedupe(list, max) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const k = c.symbol.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export function createTrending({ fetchImpl = fetch, log, offline = false } = {}) {
  let cache = { at: 0, items: null, source: 'fallback' };
  let inflight = null;
  const icons = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'Pumprint/1.0' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    return res.json();
  }

  async function refresh() {
    try {
      const items = dedupe(parseGecko(await getJson(GECKO)), 16);
      if (items.length >= 4) return { items, source: 'geckoterminal' };
    } catch (err) {
      log?.debug?.(`trending: geckoterminal failed: ${err.message}`);
    }
    try {
      const boosts = (await getJson(DEX_BOOSTS)).filter((b) => b?.chainId === 'solana' && b.tokenAddress).slice(0, 28);
      if (boosts.length) {
        const pairs = await getJson(DEX_TOKENS + boosts.map((b) => b.tokenAddress).join(','));
        const items = dedupe(parseDexTokens(pairs), 16);
        if (items.length >= 4) return { items, source: 'dexscreener' };
      }
    } catch (err) {
      log?.debug?.(`trending: dexscreener failed: ${err.message}`);
    }
    return null;
  }

  async function get() {
    if (offline) return { items: FALLBACK_COINS, source: 'fallback', at: Date.now() };
    const fresh = cache.items && Date.now() - cache.at < TTL_MS;
    if (fresh) return { items: cache.items, source: cache.source, at: cache.at };
    if (!inflight) {
      inflight = refresh()
        .then((r) => {
          if (r) cache = { at: Date.now(), items: r.items, source: r.source };
          else if (!cache.items) cache = { at: Date.now() - TTL_MS + 60_000, items: FALLBACK_COINS, source: 'fallback' };
        })
        .finally(() => {
          inflight = null;
        });
    }
    await inflight;
    return { items: cache.items || FALLBACK_COINS, source: cache.source, at: cache.at };
  }

  // GET /api/icon?u=<https url on an allowed host>
  async function icon(req, res, url) {
    let target;
    try {
      target = new URL(String(url.searchParams.get('u') || ''));
    } catch {
      target = null;
    }
    if (!target || target.protocol !== 'https:' || !ICON_HOSTS.has(target.hostname)) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad icon url');
    }
    const key = target.href;
    let hit = icons.get(key);
    if (!hit) {
      try {
        const r = await fetchImpl(key, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Pumprint/1.0' } });
        const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
        if (!r.ok || !ICON_TYPES.test(type)) throw new Error(`icon ${r.status} ${type}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 600 * 1024) throw new Error('icon too large');
        hit = { type, buf };
        icons.set(key, hit);
        if (icons.size > 150) icons.delete(icons.keys().next().value);
      } catch (err) {
        log?.debug?.(`icon: ${err.message}`);
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('no icon');
      }
    }
    res.writeHead(200, {
      'content-type': hit.type,
      'content-length': hit.buf.length,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
    res.end(hit.buf);
  }

  return { get, icon };
}
