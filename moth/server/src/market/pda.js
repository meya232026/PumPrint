// Solana program-derived addresses, so a token's bonding curve can be found
// from its mint alone (PumpPortal usually sends it, saved history may not have it).

import { createHash } from 'node:crypto';
import { base58decode, base58encode } from '../auth.js';
import { PUMP_PROGRAM } from './curve.js';

const P = 2n ** 255n - 19n;

function mod(a) {
  const r = a % P;
  return r >= 0n ? r : r + P;
}

function modPow(base, exp) {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

const D = mod(-121665n * modPow(121666n, P - 2n));

// True when 32 bytes decode to a point on ed25519, the same test Solana uses:
// x² = (y² − 1) / (d·y² + 1) must have a square root.
export function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  y = mod(y);
  const y2 = (y * y) % P;
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  if (u === 0n) return true;
  const ratio = (u * modPow(v, P - 2n)) % P;
  return modPow(ratio, (P - 1n) / 2n) === 1n;
}

export function findProgramAddress(seeds, programId) {
  const program = base58decode(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256');
    for (const seed of seeds) hash.update(seed);
    hash.update(Buffer.from([bump]));
    hash.update(program);
    hash.update('ProgramDerivedAddress');
    const address = hash.digest();
    if (!isOnCurve(address)) return { address: base58encode(address), bump };
  }
  throw new Error('no program address found');
}

export function bondingCurveAddress(mint) {
  const mintBytes = base58decode(mint);
  if (!mintBytes || mintBytes.length !== 32) return '';
  return findProgramAddress([Buffer.from('bonding-curve'), mintBytes], PUMP_PROGRAM).address;
}
