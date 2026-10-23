// The fingerprint on the About page: a fingertip made of triangle shards with the
// ridges engraved on them, a cloud of dots underneath, and trending coins that fly out
// when you touch it. Uses three.js (global THREE, loaded before this module).

import { hash32, mulberry32, reduceMotion } from './ui.js';

// ------------------------------------------------------------------ the print itself
// Fingertip outline: a superellipse, a little shorter below the middle.
const OA = 0.5;
const OB_TOP = 0.67;
const OB_BOT = 0.6;
const OSE = 2.35;
const DOME = 0.17;
const SPACING = 0.0255;

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function rho(x, y) {
  const b = y >= 0 ? OB_TOP : OB_BOT;
  return Math.pow(Math.pow(Math.abs(x) / OA, OSE) + Math.pow(Math.abs(y) / b, OSE), 1 / OSE);
}
export function domeZ(x, y) {
  const r = rho(x, y);
  return r >= 1 ? 0 : DOME * Math.pow(1 - Math.pow(r, 2.2), 0.55);
}
// Ridge phase: rings around a short vertical core that flatten into arches below it.
export function phase(x, y) {
  const qx = x - 0.012;
  const qy = y - 0.1;
  const wx = 0.8 + 0.5 * ss(-0.05, -0.62, qy);
  const vy = Math.max(Math.abs(qy) - 0.03, 0);
  let r = Math.hypot(qx / wx, vy);
  r += 0.009 * Math.sin(x * 23 + y * 7) + 0.006 * Math.sin(y * 31 - x * 11) + 0.0035 * Math.sin((x + y) * 57);
  return r;
}
// Ridge endings and breaks (the "minutiae" that make each print unique).
export function gap(x, y) {
  const g = Math.sin(x * 31 + 7 * Math.sin(y * 13)) * Math.sin(y * 29 + 5 * Math.sin(x * 11));
  return 1 - ss(0.72, 0.9, g);
}
export function ridge(x, y) {
  const s = Math.cos((2 * Math.PI * phase(x, y)) / SPACING);
  return ss(0.15, 0.6, s) * gap(x, y) * (1 - ss(0.9, 1.0, rho(x, y)));
}

const GLSL_PRINT = /* glsl */ `
#define SPACING ${SPACING.toFixed(4)}
float ssf(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float rhoF(vec2 p) {
  float b = p.y >= 0.0 ? ${OB_TOP.toFixed(2)} : ${OB_BOT.toFixed(2)};
  return pow(pow(abs(p.x) / ${OA.toFixed(2)}, ${OSE.toFixed(2)}) + pow(abs(p.y) / b, ${OSE.toFixed(2)}), ${(1 / OSE).toFixed(5)});
}
float phaseF(vec2 p) {
  vec2 q = p - vec2(0.012, 0.1);
  float wx = 0.8 + 0.5 * ssf(-0.05, -0.62, q.y);
  float vy = max(abs(q.y) - 0.03, 0.0);
  float r = length(vec2(q.x / wx, vy));
  r += 0.009 * sin(p.x * 23.0 + p.y * 7.0) + 0.006 * sin(p.y * 31.0 - p.x * 11.0) + 0.0035 * sin((p.x + p.y) * 57.0);
  return r;
}
float gapF(vec2 p) {
  float g = sin(p.x * 31.0 + 7.0 * sin(p.y * 13.0)) * sin(p.y * 29.0 + 5.0 * sin(p.x * 11.0));
  return 1.0 - ssf(0.72, 0.9, g);
}
vec3 rotAxis(vec3 v, vec3 ax, float a) {
  float c = cos(a); float s = sin(a);
  return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c);
}
`;

const SHARD_VERT = /* glsl */ `
${GLSL_PRINT}
attribute vec3 aCentroid;
attribute vec3 aNormal;
attribute vec4 aRand;
attribute vec3 aDir;
attribute float aEnergy;
attribute float aEdge;
attribute vec2 aUv;
uniform float uTime;
uniform float uScroll;
uniform float uCrumble;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vK;
void main() {
  float crumble = aEdge * uCrumble * (0.55 + 0.45 * sin(uTime * 0.6 + aRand.w * 31.0));
  float sc = uScroll * (0.35 + 0.65 * aRand.w);
  float k = aEnergy + crumble + sc;
  vec3 ax = normalize(aRand.xyz);
  float ang = aEnergy * (2.4 + 5.0 * aRand.w) + crumble * (1.5 + sin(uTime * 0.35 + aRand.w * 7.0)) + sc * 3.0;
  vec3 local = rotAxis(position - aCentroid, ax, ang);
  vec3 n = rotAxis(aNormal, ax, ang);
  vec3 drift = vec3(sin(uTime * 0.8 + aRand.w * 40.0), cos(uTime * 0.7 + aRand.x * 25.0), sin(uTime * 0.6 + aRand.y * 13.0)) * 0.03 * min(k, 1.5);
  vec3 out1 = normalize(vec3(aCentroid.xy * 1.6, 0.25 + 0.6 * aRand.w));
  vec3 c = aCentroid
    + aDir * (1.0 - exp(-2.2 * aEnergy)) * 0.95
    + out1 * ((1.0 - exp(-1.8 * crumble)) * 0.34 + sc * 1.3)
    + drift;
  vec3 p = c + local * (1.0 - 0.18 * min(k, 1.0));
  vUv = aUv;
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  vK = k;
  gl_Position = projectionMatrix * mv;
}
`;

const DEBRIS_VERT = /* glsl */ `
${GLSL_PRINT}
attribute vec3 aCentroid;
attribute vec3 aNormal;
attribute vec4 aRand;
attribute vec2 aUv;
uniform float uTime;
uniform float uScroll;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vK;
void main() {
  float a = uTime * (0.04 + 0.1 * aRand.w) * (aRand.x > 0.0 ? 1.0 : -1.0);
  float ca = cos(a); float sa = sin(a);
  vec3 c = aCentroid;
  c = vec3(c.x * ca - c.z * sa, c.y + 0.035 * sin(uTime * 0.5 + aRand.y * 9.0), c.x * sa + c.z * ca);
  c *= 1.0 + uScroll * (0.6 + aRand.w);
  vec3 ax = normalize(aRand.xyz);
  float ang = uTime * (0.15 + 0.5 * aRand.w) + aRand.x * 6.0;
  vec3 p = c + rotAxis(position - aCentroid, ax, ang);
  vec3 n = rotAxis(aNormal, ax, ang);
  vUv = aUv + (position.xy - aCentroid.xy);
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  vK = 1.0;
  gl_Position = projectionMatrix * mv;
}
`;

const SHARD_FRAG = /* glsl */ `
precision highp float;
${GLSL_PRINT}
uniform vec3 uLight;
uniform float uRidgeAmt;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vK;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float ph = phaseF(vUv) / SPACING;
  float s = cos(6.2831853 * ph);
  float w = clamp(5.5 * fwidth(ph), 0.05, 1.0);
  float rid = smoothstep(0.32 - w, 0.32 + w, s) * gapF(vUv) * (1.0 - ssf(0.88, 1.0, rhoF(vUv)));
  vec3 V = normalize(vView);
  float diff = max(dot(n, uLight), 0.0);
  float spec = pow(max(dot(n, normalize(uLight + V)), 0.0), 34.0);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  vec3 base = mix(vec3(0.052, 0.051, 0.05), vec3(0.42, 0.415, 0.4), rid * uRidgeAmt);
  vec3 col = base * (0.3 + 0.85 * diff) + vec3(spec * (0.22 + 0.5 * min(vK, 1.0))) + rim * 0.08;
  if (!gl_FrontFacing) col *= 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`;

const DOT_VERT = /* glsl */ `
attribute float aSize;
attribute float aHot;
attribute float aSeed;
attribute float aDust;
uniform float uTime;
uniform float uPx;
uniform float uScroll;
uniform vec3 uHit;
uniform float uHitAmt;
varying float vAlpha;
varying float vHot;
void main() {
  vec3 p = position;
  p += aDust * vec3(sin(uTime * 0.3 + aSeed * 10.0), cos(uTime * 0.25 + aSeed * 7.0), sin(uTime * 0.2 + aSeed * 3.0)) * 0.02;
  p.xy *= 1.0 + uScroll * (0.2 + 0.5 * aDust);
  p.z += uScroll * (0.1 + 0.5 * aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float near = uHitAmt * smoothstep(0.24, 0.0, distance(position.xy, uHit.xy));
  gl_PointSize = aSize * uPx * (3.2 / -mv.z) * (1.0 + near * 0.9);
  gl_Position = projectionMatrix * mv;
  float tw = 0.55 + 0.45 * sin(uTime * (1.2 + aSeed) + aSeed * 30.0);
  vAlpha = mix(0.75, tw, aDust) + near * 1.4;
  vHot = max(aHot, near * 0.6);
}
`;

const DOT_FRAG = /* glsl */ `
precision mediump float;
varying float vAlpha;
varying float vHot;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * clamp(vAlpha, 0.0, 1.6);
  vec3 col = mix(vec3(0.93, 0.91, 0.87), vec3(1.0, 0.45, 0.16), clamp(vHot, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}
`;

// ------------------------------------------------------------------ geometry helpers

function outlinePoint(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const x = OA * Math.sign(c) * Math.pow(Math.abs(c), 2 / OSE);
  const b = s >= 0 ? OB_TOP : OB_BOT;
  const y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / OSE);
  return [x, y];
}

// Bowyer-Watson Delaunay triangulation; returns index triples.
function delaunay(pts) {
  const n = pts.length;
  const P = pts.concat([[-20, -20], [20, -20], [0, 20]]);
  const tri = (a, b, c) => {
    const [ax, ay] = P[a];
    const [bx, by] = P[b];
    const [cx, cy] = P[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-12;
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { a, b, c, x, y, r2: (ax - x) ** 2 + (ay - y) ** 2 };
  };
  let tris = [tri(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const keep = [];
    const edges = new Map();
    for (const t of tris) {
      const dx = px - t.x;
      const dy = py - t.y;
      if (dx * dx + dy * dy < t.r2) {
        for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
          const k = u < v ? `${u},${v}` : `${v},${u}`;
          if (edges.has(k)) edges.set(k, null);
          else edges.set(k, [u, v]);
        }
      } else keep.push(t);
    }
    tris = keep;
    for (const e of edges.values()) if (e) tris.push(tri(e[0], e[1], i));
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

function shardPoints(rnd, scale) {
  const pts = [];
  const nb = Math.round(70 / scale);
  for (let i = 0; i < nb; i++) pts.push(outlinePoint((i / nb) * Math.PI * 2 + rnd() * 0.02));
  // Poisson-ish interior: smaller pieces near the core, bigger toward the edge.
  const cell = 0.03;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const radius = (x, y) => (0.033 + 0.042 * Math.pow(Math.min(1, rho(x, y)), 1.6)) * scale;
  for (const p of pts) {
    const k = key(p[0], p[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  for (let tries = 0; tries < 9000; tries++) {
    const x = (rnd() * 2 - 1) * OA;
    const y = (rnd() * 2 - 1) * OB_TOP;
    const r0 = rho(x, y);
    if (r0 > 0.965) continue;
    const r = radius(x, y);
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const span = Math.ceil(r / cell);
    let ok = true;
    for (let i = -span; i <= span && ok; i++) {
      for (let j = -span; j <= span && ok; j++) {
        for (const q of grid.get(`${gx + i},${gy + j}`) || []) {
          if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < r * r) {
            ok = false;
            break;
          }
        }
      }
    }
    if (!ok) continue;
    const p = [x + (rnd() - 0.5) * 1e-4, y];
    pts.push(p);
    const k = key(x, y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  return pts;
}

function buildShards(THREE, rnd, scale) {
  const pts = shardPoints(rnd, scale);
  const tris = delaunay(pts);
  const count = tris.length;
  const pos = new Float32Array(count * 9);
  const cen = new Float32Array(count * 9);
  const nor = new Float32Array(count * 9);
  const rand = new Float32Array(count * 12);
  const dir = new Float32Array(count * 9);
  const energy = new Float32Array(count * 3);
  const edge = new Float32Array(count * 3);
  const uv = new Float32Array(count * 6);
  const meta = { cx: new Float32Array(count), cy: new Float32Array(count), nx: new Float32Array(count), ny: new Float32Array(count), nz: new Float32Array(count) };
  const restPos = new Float32Array(count * 9);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let t = 0; t < count; t++) {
    let [a, b, c] = tris[t];
    for (let k = 0; k < 3; k++) {
      const p = pts[[a, b, c][k]];
      v[k].set(p[0], p[1], domeZ(p[0], p[1]));
    }
    e1.subVectors(v[1], v[0]);
    e2.subVectors(v[2], v[0]);
    nrm.crossVectors(e1, e2).normalize();
    if (nrm.z < 0) {
      // keep every shard facing the camera at rest
      [b, c] = [c, b];
      const tmp = v[1].clone();
      v[1].copy(v[2]);
      v[2].copy(tmp);
      nrm.negate();
    }
    const cx = (v[0].x + v[1].x + v[2].x) / 3;
    const cy = (v[0].y + v[1].y + v[2].y) / 3;
    const cz = (v[0].z + v[1].z + v[2].z) / 3;
    meta.cx[t] = cx;
    meta.cy[t] = cy;
    meta.nx[t] = nrm.x;
    meta.ny[t] = nrm.y;
    meta.nz[t] = nrm.z;
    const r = rho(cx, cy);
    // The rim crumbles a little all the time, mostly along the top and the sides.
    const edgeAmt = r > 0.78 && rnd() < 0.62 ? Math.pow((r - 0.78) / 0.22, 1.4) * (0.35 + rnd() * 0.65) * (cy > -0.25 ? 1 : 0.35) : 0;
    let ax = rnd() * 2 - 1;
    let ay = rnd() * 2 - 1;
    let az = rnd() * 2 - 1;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const rw = rnd();
    for (let k = 0; k < 3; k++) {
      const shrink = 0.935;
      const x = cx + (v[k].x - cx) * shrink;
      const y = cy + (v[k].y - cy) * shrink;
      const z = cz + (v[k].z - cz) * shrink;
      const o = t * 9 + k * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      restPos[o] = v[k].x;
      restPos[o + 1] = v[k].y;
      restPos[o + 2] = v[k].z;
      cen[o] = cx;
      cen[o + 1] = cy;
      cen[o + 2] = cz;
      nor[o] = nrm.x;
      nor[o + 1] = nrm.y;
      nor[o + 2] = nrm.z;
      dir[o] = cx;
      dir[o + 1] = cy;
      dir[o + 2] = 0.5;
      const ro = t * 12 + k * 4;
      rand[ro] = ax;
      rand[ro + 1] = ay;
      rand[ro + 2] = az;
      rand[ro + 3] = rw;
      edge[t * 3 + k] = edgeAmt;
      uv[t * 6 + k * 2] = x;
      uv[t * 6 + k * 2 + 1] = y;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCentroid', new THREE.BufferAttribute(cen, 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const dirAttr = new THREE.BufferAttribute(dir, 3);
  const energyAttr = new THREE.BufferAttribute(energy, 1);
  if (dirAttr.setUsage) {
    dirAttr.setUsage(THREE.DynamicDrawUsage);
    energyAttr.setUsage(THREE.DynamicDrawUsage);
  }
  geo.setAttribute('aDir', dirAttr);
  geo.setAttribute('aEnergy', energyAttr);
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
  // A plain copy of the intact surface for picking with the pointer.
  const proxyGeo = new THREE.BufferGeometry();
  proxyGeo.setAttribute('position', new THREE.BufferAttribute(restPos, 3));
  return { geo, count, meta, dirAttr, energyAttr, proxyGeo };
}

function buildDebris(THREE, rnd, n) {
  const pos = new Float32Array(n * 9);
  const cen = new Float32Array(n * 9);
  const nor = new Float32Array(n * 9);
  const rand = new Float32Array(n * 12);
  const uv = new Float32Array(n * 6);
  for (let t = 0; t < n; t++) {
    const ang = rnd() * Math.PI * 2;
    // more pieces above the print, like it is coming apart at the top
    const up = rnd() < 0.5;
    const R = 0.5 + Math.pow(rnd(), 1.2) * 0.46;
    const cx = Math.cos(ang) * R * 0.98;
    const cy = Math.min(0.8, up ? Math.abs(Math.sin(ang)) * R * 1.1 + 0.04 : Math.sin(ang) * R);
    const cz = (rnd() - 0.35) * 0.5;
    const size = 0.016 + Math.pow(rnd(), 2.2) * 0.06;
    let ux = 0;
    let uy = 0;
    do {
      ux = (rnd() * 2 - 1) * 0.42;
      uy = (rnd() * 2 - 1) * 0.55;
    } while (rho(ux, uy) > 0.85);
    let ax = rnd() * 2 - 1;
    let ay = rnd() * 2 - 1;
    let az = rnd() * 2 - 1;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const rw = rnd();
    const corners = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + (rnd() - 0.5) * 1.4;
      const s = size * (0.55 + rnd() * 0.9);
      corners.push([Math.cos(a) * s * (k === 0 ? 1.7 : 1), Math.sin(a) * s]);
    }
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      pos[o] = cx + corners[k][0];
      pos[o + 1] = cy + corners[k][1];
      pos[o + 2] = cz;
      cen[o] = cx;
      cen[o + 1] = cy;
      cen[o + 2] = cz;
      nor[o] = 0;
      nor[o + 1] = 0;
      nor[o + 2] = 1;
      const ro = t * 12 + k * 4;
      rand[ro] = ax;
      rand[ro + 1] = ay;
      rand[ro + 2] = az;
      rand[ro + 3] = rw;
      uv[t * 6 + k * 2] = ux;
      uv[t * 6 + k * 2 + 1] = uy;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCentroid', new THREE.BufferAttribute(cen, 3));
  geo.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  geo.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
  return geo;
}

function buildDots(THREE, rnd, ridgeCount, dustCount) {
  const n = ridgeCount + dustCount;
  const pos = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const hot = new Float32Array(n);
  const seed = new Float32Array(n);
  const dust = new Float32Array(n);
  let i = 0;
  let guard = 0;
  while (i < ridgeCount && guard++ < ridgeCount * 40) {
    const x = (rnd() * 2 - 1) * OA;
    const y = (rnd() * 2 - 1) * OB_TOP;
    if (rho(x, y) > 0.97) continue;
    if (ridge(x, y) < 0.72) continue;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = domeZ(x, y) - 0.008;
    size[i] = 1.1 + rnd() * 1.3;
    const core = Math.hypot((x - 0.012) / 0.8, y - 0.1);
    hot[i] = rnd() < 0.06 + 0.3 * Math.max(0, 1 - core / 0.22) ? 1 : 0;
    seed[i] = rnd();
    dust[i] = 0;
    i++;
  }
  const ridgeN = i;
  for (let j = 0; j < dustCount; j++, i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 1.25;
    const x = Math.cos(a) * r * 0.62;
    const y = Math.sin(a) * r * 0.78;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = (rho(x, y) < 1 ? domeZ(x, y) : 0) + 0.01 + rnd() * 0.26 - (rho(x, y) < 1 ? 0 : 0.15);
    size[i] = 0.8 + rnd() * 1.6;
    hot[i] = rnd() < 0.08 ? 1 : 0;
    seed[i] = rnd();
    dust[i] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, i * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, i), 1));
  geo.setAttribute('aHot', new THREE.BufferAttribute(hot.subarray(0, i), 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed.subarray(0, i), 1));
  geo.setAttribute('aDust', new THREE.BufferAttribute(dust.subarray(0, i), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3);
  return { geo, ridgeN };
}

// ------------------------------------------------------------------ coins

const COIN_COLORS = ['#f2b84b', '#5be39c', '#ff7ab6', '#7cc7ff', '#b18cff', '#ff8a5c', '#e7e2d6', '#ffd84d', '#4fd1c5', '#f87171'];

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (c) => Math.max(0, Math.min(255, Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f))));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function drawCoin(coin, img) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const color = COIN_COLORS[hash32(coin.symbol.toUpperCase()) % COIN_COLORS.length];
  const mid = S / 2;
  // rim
  const rim = g.createLinearGradient(0, 0, S, S);
  rim.addColorStop(0, shade(color, 0.45));
  rim.addColorStop(0.5, color);
  rim.addColorStop(1, shade(color, -0.45));
  g.beginPath();
  g.arc(mid, mid, mid - 6, 0, Math.PI * 2);
  g.fillStyle = rim;
  g.fill();
  // milled edge
  g.save();
  g.translate(mid, mid);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 3;
  for (let i = 0; i < 60; i++) {
    g.rotate((Math.PI * 2) / 60);
    g.beginPath();
    g.moveTo(mid - 20, 0);
    g.lineTo(mid - 9, 0);
    g.stroke();
  }
  g.restore();
  // face
  const face = g.createRadialGradient(mid - 30, mid - 40, 10, mid, mid, mid - 22);
  face.addColorStop(0, shade(color, 0.25));
  face.addColorStop(1, shade(color, -0.12));
  g.beginPath();
  g.arc(mid, mid, mid - 24, 0, Math.PI * 2);
  g.fillStyle = face;
  g.fill();
  const label = `$${coin.symbol.toUpperCase()}`;
  if (img) {
    g.save();
    g.beginPath();
    g.arc(mid, mid, mid - 28, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, 28, 28, S - 56, S - 56);
    g.restore();
    // ticker on a band across the bottom
    g.font = '800 34px Archivo, Arial, sans-serif';
    const w = Math.min(S - 70, g.measureText(label).width + 28);
    g.fillStyle = 'rgba(10,10,10,0.82)';
    roundRect(g, mid - w / 2, S - 92, w, 46, 23);
    g.fill();
    g.fillStyle = '#f4f2ec';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, mid, S - 68, S - 84);
  } else {
    const ink = luminance(color) > 0.55 ? '#141414' : '#f7f5ef';
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let fs = 64;
    g.font = `900 ${fs}px Archivo, Arial, sans-serif`;
    while (g.measureText(label).width > S - 76 && fs > 24) {
      fs -= 2;
      g.font = `900 ${fs}px Archivo, Arial, sans-serif`;
    }
    g.fillText(label, mid, mid + 4);
  }
  // shine
  const shine = g.createLinearGradient(0, 0, S, S * 0.8);
  shine.addColorStop(0, 'rgba(255,255,255,0.32)');
  shine.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.beginPath();
  g.arc(mid, mid, mid - 6, 0, Math.PI * 2);
  g.fillStyle = shine;
  g.fill();
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
    setTimeout(() => resolve(null), 6000);
  });
}

// ------------------------------------------------------------------ the scene

export function createPrint3D({ stage, canvas, onTouch } = {}) {
  const THREE = window.THREE;
  if (!THREE || !canvas) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.6 : 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 3.4);
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.add(group);
  scene.add(tilt);

  const rnd = mulberry32(20261022);
  const shards = buildShards(THREE, rnd, small ? 1.25 : 1);
  const lightDir = new THREE.Vector3(-0.45, 0.62, 0.65).normalize();
  const common = { uTime: { value: 0 }, uScroll: { value: 0 } };
  const shardMat = new THREE.ShaderMaterial({
    vertexShader: SHARD_VERT,
    fragmentShader: SHARD_FRAG,
    uniforms: { ...common, uCrumble: { value: reduceMotion ? 0 : 1 }, uLight: { value: lightDir }, uRidgeAmt: { value: 1 } },
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  const shardMesh = new THREE.Mesh(shards.geo, shardMat);
  shardMesh.frustumCulled = false;
  group.add(shardMesh);

  const debrisGeo = buildDebris(THREE, rnd, small ? 40 : 70);
  const debrisMat = new THREE.ShaderMaterial({
    vertexShader: DEBRIS_VERT,
    fragmentShader: SHARD_FRAG,
    uniforms: { ...common, uLight: { value: lightDir }, uRidgeAmt: { value: 0.55 } },
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  const debris = new THREE.Mesh(debrisGeo, debrisMat);
  debris.frustumCulled = false;
  group.add(debris);

  const dots = buildDots(THREE, rnd, small ? 5200 : 11000, small ? 320 : 640);
  const dotMat = new THREE.ShaderMaterial({
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: { ...common, uPx: { value: dpr }, uHit: { value: new THREE.Vector3(9, 9, 0) }, uHitAmt: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(dots.geo, dotMat);
  points.frustumCulled = false;
  group.add(points);

  const proxy = new THREE.Mesh(shards.proxyGeo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  proxy.material.visible = false;
  group.add(proxy);

  // ---------------------------------------------------------------- coins
  const coinTypes = [];
  const sprites = [];
  const MAX_COINS = small ? 18 : 30;
  for (let i = 0; i < MAX_COINS; i++) {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    s.userData = { alive: false };
    scene.add(s);
    sprites.push(s);
  }
  let coinCursor = 0;

  async function setCoins(list) {
    const items = (list || []).filter((c) => c && c.symbol).slice(0, 16);
    const made = await Promise.all(
      items.map(async (c) => {
        const img = await loadImage(c.icon);
        // Linear in, linear out: the canvas colors reach the screen unchanged.
        const tex = new THREE.CanvasTexture(drawCoin(c, img));
        tex.anisotropy = 4;
        return tex;
      }),
    );
    coinTypes.splice(0, coinTypes.length, ...made);
  }

  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  function spawnCoin(local, strength) {
    if (!coinTypes.length) return;
    const s = sprites.find((x) => !x.userData.alive);
    if (!s) return;
    const tex = coinTypes[coinCursor++ % coinTypes.length];
    s.material.map = tex;
    s.material.needsUpdate = true;
    tmpV.set(local.x, local.y, local.z).applyMatrix4(group.matrixWorld);
    s.position.copy(tmpV);
    tmpN.set(local.x * 1.4 + (Math.random() - 0.5) * 0.9, local.y * 1.4 + (Math.random() - 0.3) * 0.9, 1.1 + Math.random() * 0.6)
      .normalize()
      .transformDirection(group.matrixWorld);
    const speed = (0.75 + Math.random() * 0.9) * (0.8 + strength * 0.6);
    s.userData = {
      alive: true,
      vx: tmpN.x * speed,
      vy: tmpN.y * speed + 0.25,
      vz: tmpN.z * speed,
      age: 0,
      life: 2.4 + Math.random() * 1.6,
      size: (small ? 0.14 : 0.118) * (0.8 + Math.random() * 0.45),
      flip: Math.random() * Math.PI,
      flipV: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 5),
      spin: (Math.random() - 0.5) * 0.8,
    };
    s.material.rotation = (Math.random() - 0.5) * 0.6;
    s.visible = true;
  }

  function updateCoins(dt) {
    for (const s of sprites) {
      const u = s.userData;
      if (!u.alive) continue;
      u.age += dt;
      if (u.age >= u.life) {
        u.alive = false;
        s.visible = false;
        continue;
      }
      const drag = Math.exp(-0.9 * dt);
      u.vx *= drag;
      u.vy = u.vy * drag - 0.28 * dt;
      u.vz *= drag;
      s.position.x += u.vx * dt;
      s.position.y += u.vy * dt;
      s.position.z += u.vz * dt;
      u.flip += u.flipV * dt;
      s.material.rotation += u.spin * dt;
      const grow = Math.min(1, u.age / 0.25);
      const fade = Math.min(1, (u.life - u.age) / 0.6);
      s.material.opacity = Math.min(grow, fade);
      const sz = u.size * (0.55 + 0.45 * grow);
      s.scale.set(sz * (0.18 + 0.82 * Math.abs(Math.cos(u.flip))), sz, 1);
    }
  }

  // ---------------------------------------------------------------- pointer
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pointer = { x: 0.5, y: 0.5, inside: false, over: false, speed: 0, lastX: 0, lastY: 0, lastT: 0, moved: 0, down: false };
  let hitLocal = null;
  let hitAmt = 0;
  let spawnBudget = 0;
  let maxEnergy = 0;
  const energy = shards.energyAttr.array;
  const dirs = shards.dirAttr.array;
  const per = new Float32Array(shards.count);

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(proxy, false);
    if (!hits.length) return null;
    return group.worldToLocal(hits[0].point.clone());
  }

  function impulse(local, radius, amount) {
    const r2 = radius * radius;
    const { cx, cy, nx, ny, nz } = shards.meta;
    for (let t = 0; t < shards.count; t++) {
      const dx = cx[t] - local.x;
      const dy = cy[t] - local.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const f = 1 - Math.sqrt(d2) / radius;
      if (per[t] < 0.03) {
        const len = Math.sqrt(d2) || 1;
        const j = (Math.random() - 0.5) * 0.5;
        dirs[t * 9] = (dx / len) * 0.6 + nx[t] * 0.5 + j;
        dirs[t * 9 + 1] = (dy / len) * 0.6 + ny[t] * 0.5 + (Math.random() - 0.5) * 0.5;
        dirs[t * 9 + 2] = nz[t] * (0.9 + Math.random() * 0.7);
        for (let k = 1; k < 3; k++) {
          dirs[t * 9 + k * 3] = dirs[t * 9];
          dirs[t * 9 + k * 3 + 1] = dirs[t * 9 + 1];
          dirs[t * 9 + k * 3 + 2] = dirs[t * 9 + 2];
        }
        shards.dirAttr.needsUpdate = true;
      }
      per[t] = Math.min(1.7, per[t] + f * f * amount);
    }
    maxEnergy = 1;
  }

  function onMove(e) {
    const r = stage.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    pointer.inside = inside;
    if (!inside) {
      pointer.over = false;
      return;
    }
    pointer.x = (e.clientX - r.left) / r.width;
    pointer.y = (e.clientY - r.top) / r.height;
    const now = performance.now();
    const dt = Math.max(1, now - (pointer.lastT || now - 16));
    const dist = Math.hypot(e.clientX - pointer.lastX, e.clientY - pointer.lastY);
    pointer.speed = Math.min(3, pointer.speed * 0.6 + (dist / dt) * 0.4);
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
    pointer.lastT = now;
    pointer.moved = now;
    hitLocal = pick(e.clientX, e.clientY);
    pointer.over = Boolean(hitLocal);
  }
  function onDown(e) {
    onMove(e);
    if (!hitLocal) return;
    impulse(hitLocal, 0.42, 1.25);
    for (let i = 0; i < (small ? 6 : 9); i++) spawnCoin(hitLocal, 1.3);
    if (onTouch) onTouch();
  }
  function onLeave() {
    pointer.inside = false;
    pointer.over = false;
    hitLocal = null;
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);

  // ---------------------------------------------------------------- layout
  let width = 0;
  let height = 0;
  let wide = true;
  function resize() {
    const r = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const visH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    const visW = visH * camera.aspect;
    wide = width / height > 1.05 && width > 760;
    let scale;
    if (wide) {
      scale = Math.min((visH * 0.74) / 1.34, (visW * 0.4) / 1.0);
      tilt.position.set(visW * 0.25, -visH * 0.02, 0);
    } else {
      // Phones: the print sits under the header, in the space above the headline.
      scale = Math.min((visH * 0.72) / 1.34, (visW * 0.74) / 1.0);
      tilt.position.set(0, -visH * 0.055, 0);
    }
    tilt.scale.setScalar(scale);
  }
  const ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(stage);
  else window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- loop
  let running = false;
  let visible = true;
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let scroll = 0;
  const rot = { x: -0.1, y: -0.32 };

  function frame(now) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduceMotion) time += dt;

    // pointer energy into the shards
    const touching = pointer.over && hitLocal;
    if (touching) {
      const push = 2.2 + pointer.speed * 4.5;
      impulse(hitLocal, 0.17 + Math.min(0.1, pointer.speed * 0.05), push * dt);
      spawnBudget += dt * (0.6 + pointer.speed * 5);
      while (spawnBudget >= 1) {
        spawnBudget -= 1;
        spawnCoin(hitLocal, Math.min(1.5, pointer.speed));
      }
      hitAmt = Math.min(1, hitAmt + dt * 4);
      dotMat.uniforms.uHit.value.set(hitLocal.x, hitLocal.y, hitLocal.z);
    } else {
      hitAmt = Math.max(0, hitAmt - dt * 2);
      spawnBudget = 0;
    }
    pointer.speed *= Math.exp(-dt * 3);
    dotMat.uniforms.uHitAmt.value = hitAmt;
    if (maxEnergy > 0) {
      let m = 0;
      for (let t = 0; t < shards.count; t++) {
        let e = per[t];
        if (e <= 0) continue;
        e = Math.max(0, e - dt * (0.22 + e * 0.32));
        per[t] = e;
        energy[t * 3] = e;
        energy[t * 3 + 1] = e;
        energy[t * 3 + 2] = e;
        if (e > m) m = e;
      }
      maxEnergy = m;
      shards.energyAttr.needsUpdate = true;
    }

    // scroll: the print comes apart as the hero leaves the screen
    const r = stage.getBoundingClientRect();
    const target = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height * 0.9)));
    scroll += (target - scroll) * Math.min(1, dt * 6);
    common.uScroll.value = scroll * scroll * 1.4;
    common.uTime.value = time;

    // follow the pointer, sway when idle
    const idle = performance.now() - pointer.moved > 2500 || !pointer.inside;
    const sway = reduceMotion ? 0 : Math.sin(time * 0.33) * 0.16;
    const ty = idle ? -0.3 + sway : -0.3 + (pointer.x - (wide ? 0.72 : 0.5)) * 0.9;
    const tx = idle ? -0.08 + (reduceMotion ? 0 : Math.sin(time * 0.27) * 0.05) : -0.08 + (pointer.y - 0.5) * 0.5;
    rot.y += (ty - rot.y) * Math.min(1, dt * 2.2);
    rot.x += (tx - rot.x) * Math.min(1, dt * 2.2);
    group.rotation.set(rot.x, rot.y, 0.06);

    updateCoins(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function sync() {
    if (visible && !document.hidden) start();
    else stop();
  }
  document.addEventListener('visibilitychange', sync);
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        sync();
      }, { rootMargin: '80px' })
    : null;
  if (io) io.observe(stage);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    stage.classList.add('no-gl');
  });

  // A first frame right away so the print is there before any interaction.
  group.updateMatrixWorld(true);
  renderer.render(scene, camera);
  sync();

  return {
    setCoins,
    setVisible(v) {
      visible = v;
      sync();
    },
    burst() {
      const at = { x: 0.02, y: 0.08, z: domeZ(0.02, 0.08) };
      impulse(at, 0.5, 1.1);
      for (let i = 0; i < 10; i++) spawnCoin(at, 1.2);
    },
    destroy() {
      stop();
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
    },
  };
}
