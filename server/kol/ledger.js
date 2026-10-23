// Turns token mentions into calls and keeps their measurements across updates.
// Same rules as Kolibri's ledger: the first mention of a token opens a call; mentions
// of the same token within 7 days belong to that call.

const DAY = 86400000;
const REPEAT_WINDOW_MS = 7 * DAY;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 3 * 3600_000, 12 * 3600_000];

export const RESULT_FIELDS = [
  'market', 'supply', 'status', 'entry', 'entryAt', 'entryMc', 'frame',
  'p1m', 'p5m', 'p1h', 'p24h', 'r1m', 'r5m', 'r1h', 'r24h',
  'peak', 'peakAt', 'rPeak', 'low', 'rLow', 'nextCheckAt', 'checkedAt', 'attempts', 'error',
];

const mentionId = (m) => `${m.postId}~${m.tokenKey}`;

export function groupCalls(mentions, previous) {
  const prevById = new Map((previous || []).map((c) => [c.id, c]));
  const marketByToken = new Map();
  for (const c of previous || []) if (c.market && !marketByToken.has(c.tokenKey)) marketByToken.set(c.tokenKey, { market: c.market, supply: c.supply });
  const byToken = new Map();
  for (const m of mentions) {
    if (!byToken.has(m.tokenKey)) byToken.set(m.tokenKey, []);
    byToken.get(m.tokenKey).push(m);
  }
  const calls = [];
  for (const [tokenKey, list] of byToken) {
    list.sort((a, b) => a.postedAt - b.postedAt || String(a.postId).localeCompare(String(b.postId)));
    let cur = null;
    for (const m of list) {
      if (cur && m.postedAt - cur.postedAt <= REPEAT_WINDOW_MS) {
        cur.mentions += 1;
        cur.lastMentionAt = m.postedAt;
        if (!cur.token.chain && m.token.chain) cur.token.chain = m.token.chain;
        if (!cur.token.symbolHint && m.token.symbolHint) cur.token.symbolHint = m.token.symbolHint;
        continue;
      }
      const id = mentionId(m);
      const prev = prevById.get(id);
      const known = marketByToken.get(tokenKey);
      cur = {
        id,
        postId: m.postId,
        postedAt: m.postedAt,
        url: m.url,
        snippet: m.snippet || '',
        tokenKey,
        token: { ...m.token },
        symbol: (prev && prev.symbol) || m.token.symbol || m.token.symbolHint || null,
        mentions: 1,
        lastMentionAt: m.postedAt,
        market: (prev && prev.market) || (known && known.market) || null,
        supply: (prev && prev.supply) || (known && known.supply) || null,
        status: 'new',
        attempts: 0,
      };
      if (prev) for (const f of RESULT_FIELDS) if (prev[f] !== undefined) cur[f] = prev[f];
      calls.push(cur);
    }
  }
  calls.sort((a, b) => b.postedAt - a.postedAt);
  return calls;
}

export function applyResult(call, market, result, now) {
  if (market !== undefined) {
    call.market = market;
    call.supply = market ? market.supply || null : null;
  }
  if (call.market && call.market.symbol) call.symbol = call.market.symbol;
  for (const [k, v] of Object.entries(result || {})) if (RESULT_FIELDS.includes(k) && k !== 'market' && k !== 'supply') call[k] = v;
  call.status = (result && result.status) || 'unresolved';
  call.checkedAt = now;
  call.error = null;
  call.attempts = 0;
  if (call.status !== 'partial') call.nextCheckAt = null;
}

export function applyError(call, err, now) {
  call.attempts = (call.attempts || 0) + 1;
  call.error = String((err && (err.code || err.message)) || err).slice(0, 120);
  call.checkedAt = now;
  if (call.attempts > RETRY_MS.length) {
    call.status = 'unresolved';
    call.nextCheckAt = null;
    return;
  }
  call.status = 'error';
  call.nextCheckAt = now + RETRY_MS[call.attempts - 1];
}
