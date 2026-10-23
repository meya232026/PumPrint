import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSignInMessage, decodeSolanaAddress, verifyEd25519, randomId } from './auth.js';
import { shortAddress } from './access.js';
import { normalizeWord } from './tokenize.js';

const STATIC = {
  '/verify': ['verify.html', 'text/html; charset=utf-8'],
  '/static/moth.svg': ['moth.svg', 'image/svg+xml'],
  '/static/fraunces-600.woff2': ['fraunces-600.woff2', 'font/woff2'],
  '/favicon.ico': ['moth.svg', 'image/svg+xml'],
};

const HEX32 = /^[a-f0-9]{32}$/;

export function createHttpHandler(ctx) {
  const { config, store, access, keys, nonces, sessions, limiter, log, publicDir, status, market = null } = ctx;
  const staticCache = new Map();

  async function serveStatic(res, path) {
    const [file, type] = STATIC[path];
    let body = staticCache.get(file);
    if (!body) {
      body = await readFile(join(publicDir, file));
      staticCache.set(file, body);
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=86400' });
    res.end(body);
  }

  async function tierFor(req) {
    const auth = String(req.headers.authorization || '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return access.resolve(key);
  }

  function windowParam(url, tierRes) {
    const allowed = access.allowedWindows(tierRes.tier);
    const raw = url.searchParams.get('window');
    if (raw === null || raw === '') return { ok: true, minutes: Math.max(...allowed) };
    const minutes = Number(raw);
    if (!config.windows.includes(minutes)) return { ok: false, status: 400, error: 'bad_window', message: `window must be one of ${config.windows.join(', ')}` };
    if (!allowed.includes(minutes)) return { ok: false, status: 402, error: 'holder_required', message: `The ${minutes}m window is for holders.` };
    return { ok: true, minutes };
  }

  function domainFor(req) {
    if (config.publicUrl) {
      try {
        return new URL(config.publicUrl).host;
      } catch {
        /* fall through */
      }
    }
    return String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  }

  function clientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.socket.remoteAddress || 'unknown';
  }

  const routes = {
    'GET /': async (req, res) => html(res, landingPage({ config, store, access, status: status() })),
    'GET /health': async (req, res) => json(res, 200, { ok: true }),
    'GET /api/status': async (req, res) => json(res, 200, status()),
    'GET /api/config': async (req, res) => json(res, 200, { name: 'Moth', ...access.publicInfo() }),

    // The HTTP version of the WebSocket welcome, for panels whose browser blocks WebSockets.
    'GET /api/welcome': async (req, res, url) => {
      const tierRes = await tierFor(req);
      return json(res, 200, ctx.hub.welcome(tierRes, Number(url.searchParams.get('window'))));
    },

    // Launches newer than ?after=<ms>, newest first. The polling panel's live feed.
    'GET /api/recent': async (req, res, url) => {
      const after = Number(url.searchParams.get('after')) || 0;
      return json(res, 200, { launches: store.recent(40).filter((l) => l.t > after) });
    },

    'GET /api/snapshot': async (req, res, url) => {
      const tierRes = await tierFor(req);
      const w = windowParam(url, tierRes);
      if (!w.ok) return json(res, w.status, { error: w.error, message: w.message });
      return json(res, 200, store.snapshot(w.minutes, { top: config.topN, minCount: config.minCount, market }));
    },

    'GET /api/word': async (req, res, url) => {
      const tierRes = await tierFor(req);
      const w = windowParam(url, tierRes);
      if (!w.ok) return json(res, w.status, { error: w.error, message: w.message });
      const word = String(url.searchParams.get('w') || '').toLowerCase().trim().slice(0, 48);
      if (!word) return json(res, 400, { error: 'missing_word', message: 'Pass ?w=<word>.' });
      return json(res, 200, store.details(word, w.minutes, { market }));
    },

    // Used by the extension's background worker for desktop alerts.
    'GET /api/watch': async (req, res, url) => {
      const tierRes = await tierFor(req);
      if (!access.canAlert(tierRes.tier)) {
        return json(res, 402, { error: 'holder_required', message: 'Alerts are for holders.', keyStatus: tierRes.keyStatus });
      }
      const w = windowParam(url, tierRes);
      if (!w.ok) return json(res, w.status, { error: w.error, message: w.message });
      const words = [...new Set(String(url.searchParams.get('words') || '').split(',').map(normalizeWord).filter(Boolean))].slice(0, 50);
      return json(res, 200, store.watch(words, w.minutes));
    },

    'GET /api/nonce': async (req, res, url) => {
      if (!access.holderMode) return json(res, 409, { error: 'open_mode', message: 'Holder mode is off; everything is already unlocked.' });
      if (!limiter.allow(`nonce:${clientIp(req)}`)) return json(res, 429, { error: 'rate_limited', message: 'Too many attempts. Wait a minute.' });
      const wallet = String(url.searchParams.get('wallet') || '');
      if (!decodeSolanaAddress(wallet)) return json(res, 400, { error: 'bad_wallet', message: 'That is not a Solana address.' });
      const nonce = randomId();
      const message = buildSignInMessage({
        domain: domainFor(req),
        wallet,
        nonce,
        issuedAt: new Date().toISOString(),
        symbol: config.holder.symbol,
      });
      nonces.set(nonce, { wallet, message });
      return json(res, 200, { nonce, message });
    },

    'POST /api/verify': async (req, res) => {
      if (!access.holderMode) return json(res, 409, { ok: false, error: 'open_mode', message: 'Holder mode is off; everything is already unlocked.' });
      if (!limiter.allow(`verify:${clientIp(req)}`)) return json(res, 429, { ok: false, error: 'rate_limited', message: 'Too many attempts. Wait a minute.' });
      let body;
      try {
        body = JSON.parse(await readBody(req, 8 * 1024));
      } catch {
        return json(res, 400, { ok: false, error: 'bad_request', message: 'Send JSON: wallet, nonce, signature.' });
      }
      const { wallet, nonce, signature, session } = body || {};
      const pending = typeof nonce === 'string' ? nonces.take(nonce) : null;
      if (!pending || pending.wallet !== wallet) {
        return json(res, 400, { ok: false, error: 'nonce_expired', message: 'This sign-in request expired. Start again.' });
      }
      const publicKey = decodeSolanaAddress(wallet);
      const sig = typeof signature === 'string' ? Buffer.from(signature, 'base64') : null;
      if (!publicKey || !sig || !verifyEd25519(publicKey, pending.message, sig)) {
        return json(res, 400, { ok: false, error: 'bad_signature', message: 'The signature does not match this wallet.' });
      }
      let balance;
      try {
        balance = await ctx.balances.get(wallet, { fresh: true });
      } catch (err) {
        log.warn('balance lookup failed during verify', { error: err.message });
        return json(res, 503, { ok: false, error: 'rpc_unavailable', message: 'Could not read your balance from Solana. Try again in a minute.' });
      }
      const { holder } = config;
      if (balance < holder.minBalance) {
        return json(res, 403, {
          ok: false,
          error: 'insufficient_balance',
          message: `This wallet holds ${fmt(balance)} $${holder.symbol}; holder features need ${fmt(holder.minBalance)}.`,
          balance,
          required: holder.minBalance,
          buyUrl: access.publicInfo().holder.buyUrl,
        });
      }
      const key = keys.issue(wallet);
      if (typeof session === 'string' && HEX32.test(session)) sessions.set(session, key);
      log.info('holder verified', { wallet: shortAddress(wallet), balance });
      return json(res, 200, { ok: true, tier: 'pro', key, balance, wallet: shortAddress(wallet), symbol: holder.symbol });
    },

    // The side panel polls this after opening /verify?session=… so the key arrives without copy-paste.
    'GET /api/claim': async (req, res, url) => {
      const session = String(url.searchParams.get('session') || '');
      if (!HEX32.test(session)) return json(res, 400, { error: 'bad_session' });
      const key = sessions.take(session);
      return json(res, 200, key ? { key } : { pending: true });
    },
  };

  return async function handle(req, res) {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-max-age': '86400' });
      return res.end();
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return json(res, 400, { error: 'bad_url' });
    }
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) return await serveStatic(res, url.pathname);
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return json(res, 404, { error: 'not_found' });
      return await route(req, res, url);
    } catch (err) {
      log.error('request failed', { path: url.pathname, error: err.message });
      if (!res.headersSent) json(res, 500, { error: 'internal', message: 'Something broke on the server. Check its logs.' });
      else res.end();
    }
  };
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function landingPage({ config, store, access, status }) {
  const snap = store.snapshot(Math.max(...config.windows), { top: 8, minCount: 1 });
  const src = status.source || {};
  const live = src.connected || src.kind === 'demo';
  const words = snap.words.slice(0, 8).map((w) => `<li><span>${esc(w.w)}</span><b>${w.c}</b></li>`).join('');
  const mode = access.holderMode
    ? `Holder mode: windows under ${Math.max(...config.freeWindows)} minutes and alerts need $${esc(config.holder.symbol)}.`
    : 'Open mode: every window and alerts are unlocked for everyone.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moth server</title><link rel="icon" href="/static/moth.svg">
<style>
@font-face{font-family:Fraunces;src:url(/static/fraunces-600.woff2) format("woff2");font-weight:600}
:root{--night:#100f1d;--dusk:#1a182c;--line:#2b2843;--moon:#ece8f7;--wing:#a39ad0;--lamp:#ffb648}
@media (prefers-color-scheme:light){:root{--night:#f4f3f9;--dusk:#fff;--line:#e2dfee;--moon:#1a1830;--wing:#615a86;--lamp:#a35c00}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--night);color:var(--moon);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:24px 16px}
main{width:min(460px,100%)}header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
h1{font:600 32px/1 Fraunces,Georgia,serif;margin:0;letter-spacing:-.01em}img{width:44px;height:44px}
p{color:var(--wing);margin:6px 0}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:${live ? 'var(--lamp)' : '#e0566b'}}
ul{list-style:none;padding:0;margin:20px 0;border-top:1px solid var(--line)}li{display:flex;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--line)}
li span{font:600 17px Fraunces,Georgia,serif}li b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--wing)}
code{background:var(--dusk);border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-size:13px}
</style></head><body><main>
<header><img src="/static/moth.svg" alt=""><h1>Moth</h1></header>
<p><span class="dot"></span>${live ? `Reading new launches from ${esc(src.kind === 'demo' ? 'the demo generator' : 'PumpPortal')}` : 'Waiting for the launch stream to connect'}.</p>
<p>${fmt(snap.total)} launches in the last ${snap.window === 60 ? 'hour' : `${snap.window} minutes`}, about ${snap.rate >= 10 ? Math.round(snap.rate) : fmt(snap.rate)} a minute.</p>
<ul>${words || '<li><span>No words yet</span><b>0</b></li>'}</ul>
<p>${mode}</p>
<p>Point the Moth extension at this address. The panel connects to <code>/ws</code>.</p>
</main></body></html>`;
}
