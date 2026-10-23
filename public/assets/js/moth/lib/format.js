// Copied from Moth (MIT, github.com/Ridarketh/Moth-radar) for running in the browser.
// Pure helpers shared by the panel and the background worker.

export function httpBase(input) {
  let url = String(input || '').trim();
  if (!url) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/^ws(s?):\/\//i, 'http$1://');
  return url.replace(/\/+$/, '');
}

export function socketUrl(input) {
  return `${httpBase(input).replace(/^http/i, 'ws')}/ws`;
}

export function isValidServerUrl(input) {
  try {
    const u = new URL(httpBase(input));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Loopback and private-network addresses. Chrome only lets an extension reach
// these when the extension holds a host permission for them.
export function isLocalAddress(input) {
  let host;
  try {
    host = new URL(httpBase(input)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') return true;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

// Host permission patterns that cover a server's HTTP and WebSocket traffic.
export function permissionOrigins(input) {
  const u = new URL(httpBase(input));
  const secure = u.protocol === 'https:';
  return [`${secure ? 'https' : 'http'}://${u.hostname}/*`, `${secure ? 'wss' : 'ws'}://${u.hostname}/*`];
}

export function hostOf(input) {
  try {
    return new URL(httpBase(input)).host;
  } catch {
    return String(input || '');
  }
}

const nf = new Intl.NumberFormat('en-US');
export function formatCount(n) {
  return nf.format(Math.round(n || 0));
}

export function formatRate(perMinute) {
  if (!perMinute) return '0';
  return perMinute >= 10 ? String(Math.round(perMinute)) : perMinute.toFixed(1).replace(/\.0$/, '');
}

// Change versus the previous window: "New", "×3.4", "+45%", "−12%", or "—" while warming up.
export function formatChange(c, p, warm) {
  if (!warm) return { text: '—', tone: 'flat', title: 'Growth appears once the previous window has been fully observed.' };
  if (!p) return { text: 'New', tone: 'new', title: 'Not seen in the previous window.' };
  const ratio = c / p;
  if (ratio >= 3) return { text: `×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`, tone: 'up', title: `${c} now versus ${p} in the previous window.` };
  const pct = Math.round((ratio - 1) * 100);
  if (pct === 0) return { text: '0%', tone: 'flat', title: `${c} now versus ${p} in the previous window.` };
  return { text: pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`, tone: pct > 0 ? 'up' : 'down', title: `${c} now versus ${p} in the previous window.` };
}

// Momentum score -> heat bucket used for color: h0…h5 warm, c1…c2 cooling.
export function heatClass(z) {
  if (z >= 6) return 'h5';
  if (z >= 4) return 'h4';
  if (z >= 2.5) return 'h3';
  if (z >= 1.5) return 'h2';
  if (z >= 0.75) return 'h1';
  if (z > -1.25) return 'h0';
  if (z > -2.5) return 'c1';
  return 'c2';
}

// Market cap in dollars when the SOL price is known, otherwise in SOL.
export function formatMc(mcSol, solUsd) {
  if (!Number.isFinite(mcSol)) return '—';
  return solUsd > 0 ? `$${compactNumber(mcSol * solUsd)}` : `${compactNumber(mcSol)} SOL`;
}

export function compactNumber(n) {
  const short = (v, unit) => `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}${unit}`;
  const abs = Math.abs(n);
  if (abs >= 1e9) return short(n / 1e9, 'B');
  if (abs >= 1e6) return short(n / 1e6, 'M');
  if (abs >= 1e3) return short(n / 1e3, 'K');
  return String(Math.round(n));
}

// A token's market cap move as a ratio (0.25 = up 25%).
export function formatMove(ratio) {
  if (!Number.isFinite(ratio)) return { text: '', tone: 'flat' };
  const mult = ratio + 1;
  if (mult >= 3) return { text: `×${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}`, tone: 'up' };
  const pct = Math.round(ratio * 100);
  if (pct === 0) return { text: '0%', tone: 'flat' };
  return pct > 0 ? { text: `+${pct}%`, tone: 'up' } : { text: `−${Math.abs(pct)}%`, tone: 'down' };
}

export const TOKEN_STATUS = {
  active: 'Traded in the last 90 seconds',
  graduated: 'Graduated to PumpSwap',
  quiet: 'No trades in the last 90 seconds',
  dumped: 'Dumped: most of its money has left the curve',
};

export function timeAgo(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function durationText(ms) {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function windowLabel(min) {
  return min % 60 === 0 ? `${min / 60}h` : `${min}m`;
}

export function windowPhrase(min) {
  if (min === 60) return 'the last hour';
  if (min % 60 === 0) return `the last ${min / 60} hours`;
  return `the last ${min} minutes`;
}

// Where a click on a token goes. GMGN is the default; Settings can switch it.
export const TOKEN_SITES = {
  gmgn: { label: 'GMGN', url: (mint) => `https://gmgn.ai/sol/token/${mint}` },
  pump: { label: 'pump.fun', url: (mint) => `https://pump.fun/coin/${mint}` },
  dexscreener: { label: 'DexScreener', url: (mint) => `https://dexscreener.com/solana/${mint}` },
};

export function tokenSite(launch, site = 'gmgn') {
  const key = TOKEN_SITES[site] ? site : 'gmgn';
  // pump.fun only lists its own launches; other launchpads go to GMGN.
  if (key === 'pump' && launch?.pool && launch.pool !== 'pump') return 'gmgn';
  return key;
}

// Demo launches are made up, so they have no page anywhere.
export function tokenUrl(launch, site = 'gmgn') {
  if (!launch?.mint || launch.pool === 'demo') return '';
  return TOKEN_SITES[tokenSite(launch, site)].url(launch.mint);
}

export function xSearchUrl(word) {
  return `https://x.com/search?q=${encodeURIComponent(word)}&f=live`;
}

// Same rules as the server tokenizer for one typed word: lowercase, no $ or #.
export function cleanWord(input) {
  const s = String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^[\s$#@]+|[\s.,;:!?]+$/g, '');
  const m = s.match(/[\p{L}\p{M}\p{N}]+/u);
  if (!m) return '';
  let w = m[0];
  if (/^[\p{Script=Latin}\p{M}\p{N}]+$/u.test(w)) w = w.normalize('NFD').replace(/\p{M}+/gu, '');
  return w.slice(0, 24);
}

export function splitWords(input) {
  return [...new Set(String(input || '').split(/[\s,]+/).map(cleanWord).filter(Boolean))];
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
