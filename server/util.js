// Small HTTP helpers shared by the site server.

export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'bad_json', 'Send a JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window limiter: at most `limit` hits per key per window.
export function windowLimiter(limit, windowMs = 60_000) {
  const hits = new Map();
  return (key) => {
    const slot = Math.floor(Date.now() / windowMs);
    const k = `${key}:${slot}`;
    const n = (hits.get(k) || 0) + 1;
    hits.set(k, n);
    if (hits.size > 5000) for (const old of hits.keys()) if (!old.endsWith(`:${slot}`)) hits.delete(old);
    return n <= limit;
  };
}

// Calls `handler` with req.url rewritten so the mounted app sees its own paths.
export function stripPrefix(req, prefix) {
  const original = req.url || '/';
  const rest = original.slice(prefix.length);
  req.url = rest.startsWith('/') ? rest : `/${rest}`;
  return original;
}
