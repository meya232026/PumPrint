// Robinhood Chain (id 4663) JSON-RPC, shared by the site's Robinhood tools.
//
// The public node answers bursts with 429, meters eth_getLogs separately, refuses unknown user
// agents with 403 and caps one log answer at 10,000 entries. So every request goes through one
// queue: calls spaced apart, log queries spaced further, a 429 waited out and retried, spare
// endpoints asked only for a call the main one refused, and a log range the node will not answer
// whole asked again in halves (the largest size that worked is remembered).

export const HOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const HOOD_CHAIN_ID = 4663;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class RpcError extends Error {
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    if (data !== undefined) this.data = data; // a revert's return data, for callers that decode it
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const toHex = (n) => `0x${Math.max(0, Math.floor(Number(n))).toString(16)}`;
export const fromHex = (h) => (h == null ? null : parseInt(h, 16));

/** The node's own failure (a backend behind it), not ours: retried sooner, read through a spare. */
export function nodeFailed(err) {
  const s = String(err && err.message).toLowerCase();
  return s.includes('deadline exceeded') || s.includes('internal server') || s.includes('connection refused') || s.includes('bad gateway');
}

/** The node refusing a log range for its size: split it and ask again. */
export function tooBig(err) {
  const s = String(err && err.message).toLowerCase();
  return s.includes('exceeds limit') || s.includes('timed out') || s.includes('too many') || s.includes('response size') || s.includes('query returned more than');
}

export function createHoodRpc({
  url = HOOD_RPC,
  spares = [],
  fetchImpl = fetch,
  spacingMs = 120,
  logsSpacingMs = 600,
  timeoutMs = 30_000,
  userAgent = BROWSER_UA,
  log = null,
} = {}) {
  const urls = [url, ...spares.filter((u) => u && u !== url)];
  let chain = Promise.resolve();
  let lastAt = 0;
  let lastLogsAt = 0;
  let maxSpan = null;
  const stats = { requests: 0, errors: 0, limited: 0, spared: 0, since: Date.now() };

  // One request at a time, spaced; everything waits its turn here.
  function gate(isLogs) {
    const turn = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(lastAt + spacingMs - now, isLogs ? lastLogsAt + logsSpacingMs - now : 0, 0);
      if (wait) await sleep(wait);
      lastAt = Date.now();
      if (isLogs) lastLogsAt = lastAt;
    });
    chain = turn.catch(() => {});
    return turn;
  }

  async function postOnce(target, payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': userAgent },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async function post(payload, isLogs = false) {
    for (let attempt = 0; attempt < 4; attempt++) {
      await gate(isLogs);
      stats.requests++;
      let res;
      try {
        res = await postOnce(urls[0], payload);
      } catch (err) {
        stats.errors++;
        if (attempt === 3) throw new RpcError(`rpc unreachable: ${err.message}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (res.status !== 429) {
        if (!res.ok) {
          stats.errors++;
          const text = await res.text().catch(() => '');
          throw new RpcError(`rpc http ${res.status}: ${text.slice(0, 120)}`, { status: res.status });
        }
        return res.json();
      }
      stats.limited++;
      for (const alt of urls.slice(1)) {
        try {
          const r2 = await postOnce(alt, payload);
          if (r2.ok) {
            const body = await r2.json();
            const msg = String((body && body.error && body.error.message) || '').toLowerCase();
            if (!/not supported|free plan|upgrade/.test(msg)) {
              stats.spared++;
              return body;
            }
          }
        } catch {
          /* next spare */
        }
      }
      await sleep(2000 + 2000 * attempt);
    }
    throw new RpcError('rate limited after 4 attempts', { code: 'rate_limited' });
  }

  async function call(method, params = [], { logs = false } = {}) {
    const body = await post({ jsonrpc: '2.0', id: 1, method, params }, logs);
    if (body && body.error) throw new RpcError(`${method}: ${body.error.message}`, { code: body.error.code, data: body.error.data });
    return body ? body.result : null;
  }

  /** Many calls in one round trip per `size`; results come back aligned with `args`. */
  async function batch(method, args, size = 40) {
    const out = new Array(args.length).fill(null);
    for (let start = 0; start < args.length; start += size) {
      const chunk = args.slice(start, start + size);
      const body = await post(chunk.map((p, i) => ({ jsonrpc: '2.0', id: start + i, method, params: p })));
      if (!Array.isArray(body)) throw new RpcError(`${method}: batch rejected`);
      for (const item of body) if (Number.isInteger(item.id) && item.id >= 0 && item.id < args.length) out[item.id] = item.result ?? null;
    }
    return out;
  }

  /** eth_getLogs over a range, halving it as often as the node demands. */
  async function logs(fromBlock, toBlock, filter = {}) {
    const span = toBlock - fromBlock + 1;
    if (maxSpan && span > maxSpan) {
      const step = maxSpan;
      let out = [];
      for (let start = fromBlock; start <= toBlock; start += step) out = out.concat(await logs(start, Math.min(start + step - 1, toBlock), filter));
      return out;
    }
    try {
      return (await call('eth_getLogs', [{ fromBlock: toHex(fromBlock), toBlock: toHex(toBlock), ...filter }], { logs: true })) || [];
    } catch (err) {
      if (fromBlock >= toBlock || !tooBig(err)) throw err;
      maxSpan = Math.max(1, Math.min(maxSpan || span, Math.floor(span / 2)));
      if (log) log.debug(`hood rpc: ${fromBlock}..${toBlock} too big (${err.message.slice(0, 60)}); ${maxSpan} blocks a call from here`);
      return logs(fromBlock, toBlock, filter);
    }
  }

  // Block timestamps, remembered: every dated block is a probe for dating the others.
  const probes = new Map();
  function remember(n, ts) {
    probes.set(n, ts);
    if (probes.size > 64) {
      const keep = [...probes.keys()].sort((a, b) => a - b).slice(-48);
      for (const k of [...probes.keys()]) if (!keep.includes(k)) probes.delete(k);
    }
  }
  async function head() {
    const b = await call('eth_getBlockByNumber', ['latest', false]);
    const n = fromHex(b.number);
    const ts = fromHex(b.timestamp);
    remember(n, ts);
    return { number: n, timestamp: ts };
  }
  async function blockTimestamp(n) {
    if (!probes.has(n)) {
      const b = await call('eth_getBlockByNumber', [toHex(n), false]);
      if (!b) throw new RpcError(`no block ${n}`);
      remember(n, fromHex(b.timestamp));
    }
    return probes.get(n);
  }

  return {
    urls,
    call,
    batch,
    logs,
    head,
    blockTimestamp,
    probes,
    stats: () => ({ ...stats, maxSpan }),
  };
}
