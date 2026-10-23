// Holder verification: base58, ed25519 signature checks, signed access keys,
// one-time nonces, claim sessions and a small rate limiter. Node's crypto only.

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base58decode(str) {
  if (typeof str !== 'string' || !str || str.length > 128) return null;
  const bytes = [];
  for (const ch of str) {
    let carry = ALPHABET_MAP.get(ch);
    if (carry === undefined) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

export function base58encode(input) {
  const buf = Buffer.from(input);
  const digits = [];
  for (const byte of buf) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let k = 0; k < buf.length && buf[k] === 0; k++) out += '1';
  for (let q = digits.length - 1; q >= 0; q--) out += ALPHABET[digits[q]];
  return out;
}

// A Solana address is a base58-encoded 32-byte ed25519 public key.
export function decodeSolanaAddress(address) {
  const bytes = base58decode(address);
  return bytes && bytes.length === 32 ? bytes : null;
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyEd25519(publicKey, message, signature) {
  try {
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: 'der', type: 'spki' });
    return cryptoVerify(null, Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}

export function buildSignInMessage({ domain, wallet, nonce, issuedAt, symbol }) {
  return [
    `${domain} wants you to verify your Solana wallet:`,
    wallet,
    '',
    `Sign to prove you hold $${symbol} and unlock Moth holder features. This is not a transaction and costs nothing.`,
    '',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

// Access keys are "moth_<payload>.<hmac>". The payload names the wallet; the
// server re-checks that wallet's balance whenever the key is used.
export class AccessKeys {
  constructor(secret, ttlMs) {
    if (!secret) throw new Error('AccessKeys needs a secret');
    this.secret = secret;
    this.ttlMs = ttlMs;
  }

  issue(wallet, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ w: wallet, iat: now, exp: now + this.ttlMs })).toString('base64url');
    return `moth_${payload}.${this.#sign(payload)}`;
  }

  read(key, now = Date.now()) {
    const m = /^moth_([A-Za-z0-9_-]{10,600})\.([A-Za-z0-9_-]{43})$/.exec(String(key || '').trim());
    if (!m) return { ok: false, reason: 'invalid' };
    const expected = Buffer.from(this.#sign(m[1]));
    const given = Buffer.from(m[2]);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
    let data;
    try {
      data = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    if (!data || typeof data.w !== 'string' || !Number.isFinite(data.exp)) return { ok: false, reason: 'invalid' };
    if (data.exp <= now) return { ok: false, reason: 'expired', wallet: data.w };
    return { ok: true, wallet: data.w, iat: data.iat, exp: data.exp };
  }

  #sign(payload) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

// Short-lived single-use values keyed by a random id (nonces, claim sessions).
export class ExpiringStore {
  constructor({ ttlMs, max = 20_000, now = () => Date.now() }) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  set(id, value) {
    if (this.map.size >= this.max) this.sweep();
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(id, { value, at: this.now() });
  }

  take(id) {
    const hit = this.map.get(id);
    if (!hit) return null;
    this.map.delete(id);
    return this.now() - hit.at <= this.ttlMs ? hit.value : null;
  }

  sweep() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, hit] of this.map) if (hit.at < cutoff) this.map.delete(id);
  }
}

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(id) {
    const now = Date.now();
    let entry = this.hits.get(id);
    if (!entry || now - entry.start >= this.windowMs) {
      entry = { start: now, n: 0 };
      this.hits.set(id, entry);
    }
    entry.n++;
    if (this.hits.size > 10_000) {
      for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
    }
    return entry.n <= this.limit;
  }
}
