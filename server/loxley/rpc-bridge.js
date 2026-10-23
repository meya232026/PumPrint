// Loxley's rpc gate (cli/chain.js makeRpc) posts JSON-RPC with fetch() to env.RPC_URL and sends no user agent of
// its own. On the site, point RPC_URL at this loopback bridge instead: every call is handed to the site's shared
// Robinhood Chain queue (server/hood/rpc.js createHoodRpc().call), so loxley shares one rate budget, one user agent
// and the spare endpoints with the other HOOD tools. Read methods only: anything else is refused here.

import http from 'node:http';

export const READ_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_call', 'eth_getCode',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance']);

export async function startRpcBridge({ call, host = '127.0.0.1' }) {
  const one = async (q) => {
    const id = q && q.id != null ? q.id : 1;
    if (!q || !READ_METHODS.has(q.method)) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not allowed on the site: ' + (q && q.method) } };
    try { return { jsonrpc: '2.0', id, result: await call(q.method, q.params || [], { logs: q.method === 'eth_getLogs' }) }; }
    catch (e) {
      if (e && e.code === 'rate_limited') throw e;
      return { jsonrpc: '2.0', id, error: { code: typeof e.code === 'number' ? e.code : -32000, message: String(e.message || e).replace(/^eth_\w+: /, '') } };
    }
  };
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body; try { body = JSON.parse(b); } catch { res.writeHead(400); return res.end(); }
      try {
        const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'rate limited' })); } // loxley's gate waits 2 s and retries
    });
  });
  await new Promise((r) => server.listen(0, host, r));
  return { url: `http://${host}:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
