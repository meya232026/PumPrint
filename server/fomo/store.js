// The radar's tape in SQLite (node:sqlite). The queries are ported nearly verbatim from
// cvxv666/fomo-robinhood-radar (MIT): pipeline/provenance.py, noise.py, crews.py, hot.py,
// analyze.py and pushes.py.

import { DatabaseSync } from 'node:sqlite';
import { QUOTE_TOKENS } from './scan.js';

export const TRUSTED = 60;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS traders(
  address TEXT PRIMARY KEY, handle TEXT, score INTEGER, status TEXT, median_buy_usd REAL);
CREATE TABLE IF NOT EXISTS tokens(
  mint TEXT PRIMARY KEY, symbol TEXT, price_usd REAL, liquidity_usd REAL, mcap_usd REAL,
  pool_address TEXT, created_at INTEGER, first_seen_at INTEGER, checked_at INTEGER,
  sellable INTEGER, sell_checked_at INTEGER, sell_note TEXT);
CREATE TABLE IF NOT EXISTS trades(
  id INTEGER PRIMARY KEY, sig TEXT, tx TEXT, fill_key TEXT UNIQUE, address TEXT, mint TEXT, side TEXT,
  usd_value REAL, token_amount REAL, eth_amount REAL, ts INTEGER, block INTEGER, kind TEXT);
CREATE INDEX IF NOT EXISTS trades_mint_ts ON trades(mint, ts);
CREATE INDEX IF NOT EXISTS trades_addr_ts ON trades(address, ts);
CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts);
CREATE INDEX IF NOT EXISTS trades_tx ON trades(tx);
CREATE TABLE IF NOT EXISTS bursts(
  id INTEGER PRIMARY KEY, mint TEXT, ts INTEGER, conviction REAL, wallets INTEGER, usd REAL, px REAL,
  window_s INTEGER, age_s INTEGER, who TEXT);
CREATE INDEX IF NOT EXISTS bursts_mint_ts ON bursts(mint, ts);
CREATE TABLE IF NOT EXISTS pushes(
  id INTEGER PRIMARY KEY, kind TEXT, mint TEXT, ts INTEGER, px REAL, conviction REAL, wallets INTEGER,
  usd REAL, liq REAL, cohort_share REAL, who TEXT, held TEXT, followup_due INTEGER, followup_at INTEGER,
  best REAL, peak_min INTEGER, now_x REAL, vol_usd REAL, trail_x REAL, told INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS pushes_mint_ts ON pushes(mint, ts);
CREATE TABLE IF NOT EXISTS crews(address TEXT PRIMARY KEY, crew INTEGER, size INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS noise(address TEXT PRIMARY KEY, reason TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`;

const QUOTES = Object.keys(QUOTE_TOKENS).map((t) => `'${t}'`).join(',');
const NOT_QUOTE = (col) => ` AND ${col} NOT IN (${QUOTES})`;
// Anything that counts toward a signal: a real trade, on a token that is neither seeded nor unsellable.
const REAL = (t) => ` AND COALESCE(${t}.kind, 'trade') = 'trade'`;
const NOT_UNSELLABLE = (t) => ` AND ${t}.mint NOT IN (SELECT mint FROM tokens WHERE sellable = 0)`;
const NOT_SEEDED = (t) =>
  ` AND ${t}.mint NOT IN (` +
  '  SELECT s.mint FROM trades s JOIN traders st ON st.address = s.address' +
  '  WHERE s.side = \'buy\' AND st.score >= ? AND s.ts >= ?' +
  '  GROUP BY s.mint' +
  "  HAVING COUNT(DISTINCT CASE WHEN s.kind IN ('dust', 'direct', 'seed') THEN s.address END) >= ?" +
  "     AND COUNT(DISTINCT CASE WHEN s.kind IN ('dust', 'direct', 'seed') THEN s.address END)" +
  "       > COUNT(DISTINCT CASE WHEN COALESCE(s.kind, 'trade') = 'trade' THEN s.address END))";

export function createFomoStore(path, cfg) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  const seededParams = (now) => [TRUSTED, now - cfg.seedWindowH * 3600, cfg.seedMinWallets];
  const conviction = (scores) => scores.reduce((s, x) => s + (x ? (x / 100) ** 2 : 0), 0);

  // ---------------------------------------------------------------- meta, roster, tokens

  const getMeta = (k) => q('SELECT v FROM meta WHERE k = ?').get(k)?.v ?? null;
  const setMeta = (k, v) => q('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));

  function loadRoster(rows) {
    tx(() => {
      const up = q(
        'INSERT INTO traders(address, handle, score, status) VALUES(?, ?, ?, ?) ' +
          'ON CONFLICT(address) DO UPDATE SET handle = excluded.handle, score = excluded.score, status = excluded.status',
      );
      for (const r of rows) up.run(r.address, r.handle, r.score, r.status);
    });
  }
  /** Who the watcher reads: active and watch wallets that have not been found to be noise. */
  const tracked = () =>
    q("SELECT address FROM traders WHERE status IN ('active', 'watch') AND address NOT IN (SELECT address FROM noise) ORDER BY address").all().map((r) => r.address);
  const rosterCounts = () =>
    q("SELECT COUNT(*) tracked, SUM(score >= ?) trusted FROM traders WHERE status IN ('active', 'watch') AND address NOT IN (SELECT address FROM noise)").get(TRUSTED);

  function upsertToken(t, now) {
    q(
      'INSERT INTO tokens(mint, symbol, price_usd, liquidity_usd, mcap_usd, pool_address, created_at, first_seen_at, checked_at) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET ' +
        'symbol = COALESCE(excluded.symbol, symbol), price_usd = COALESCE(excluded.price_usd, price_usd), ' +
        'liquidity_usd = COALESCE(excluded.liquidity_usd, liquidity_usd), mcap_usd = COALESCE(excluded.mcap_usd, mcap_usd), ' +
        'pool_address = COALESCE(excluded.pool_address, pool_address), created_at = COALESCE(excluded.created_at, created_at), ' +
        'checked_at = excluded.checked_at',
    ).run(t.mint, t.symbol ?? null, t.price ?? null, t.liquidity ?? null, t.mcap ?? null, t.pool ?? null, t.createdAt ?? null, now, now);
  }
  const token = (mint) => q('SELECT * FROM tokens WHERE mint = ?').get(mint) || null;
  const touch = (mint, now) => q('INSERT OR IGNORE INTO tokens(mint, first_seen_at) VALUES(?, ?)').run(mint, now);

  // ---------------------------------------------------------------- fills

  const insertTradeStmt = () =>
    q(
      'INSERT OR IGNORE INTO trades(sig, tx, fill_key, address, mint, side, usd_value, token_amount, eth_amount, ts, block, kind) ' +
        'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
  /** Store new fills; returns how many were new. */
  function insertFills(fills, now) {
    if (!fills.length) return 0;
    return tx(() => {
      const ins = insertTradeStmt();
      let n = 0;
      for (const f of fills) {
        const key = `${f.tx.slice(0, 66)}:${f.address}:${f.mint}:${f.side}`;
        const r = ins.run(f.sig, f.tx, key, f.address, f.mint, f.side, f.usd ?? null, f.amount ?? null, f.eth ?? null, f.ts, f.block ?? null, f.kind ?? null);
        if (r.changes) {
          n++;
          touch(f.mint, now);
        }
      }
      return n;
    });
  }
  const knownTx = (txHash) => Boolean(q('SELECT 1 FROM trades WHERE tx = ? LIMIT 1').get(txHash));

  // provenance.refresh_medians
  function refreshMedians(now, days = 30) {
    const rows = q("SELECT address, usd_value FROM trades WHERE side = 'buy' AND usd_value > 0 AND ts >= ? AND COALESCE(kind, 'trade') != 'direct' ORDER BY address, usd_value").all(now - days * 86400);
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.address)) by.set(r.address, []);
      by.get(r.address).push(r.usd_value);
    }
    tx(() => {
      const up = q('UPDATE traders SET median_buy_usd = ? WHERE address = ?');
      for (const [a, sizes] of by) up.run(sizes[Math.floor(sizes.length / 2)], a);
    });
    return by.size;
  }

  // provenance.classify: settle `flow` into `trade` or `dust`, then look for seeding waves.
  function classify(since, now) {
    const res = tx(() => {
      const dust = q(
        "UPDATE trades SET kind = 'dust' WHERE kind = 'flow' AND side = 'buy' AND ts >= ? " +
          'AND COALESCE(usd_value, 0) < MAX(?, ? * COALESCE((SELECT median_buy_usd FROM traders WHERE traders.address = trades.address), 0))',
      ).run(since, cfg.dustAbsUsd, cfg.dustRatio).changes;
      const trade = q("UPDATE trades SET kind = 'trade' WHERE kind = 'flow' AND ts >= ?").run(since).changes;
      return { dust, trade };
    });
    res.waves = waves(since, now).length;
    return res;
  }

  // provenance.waves: one buy apiece into a queue of trusted wallets, seconds apart.
  function waves(since, now, dry = false) {
    const rows = q(
      'SELECT tr.mint mint, tr.address address, MIN(tr.ts) ts, COUNT(*) n, MAX(COALESCE(tr.usd_value, 0)) usd ' +
        'FROM trades tr JOIN traders t ON t.address = tr.address ' +
        "WHERE tr.side = 'buy' AND t.score >= ? AND COALESCE(tr.kind, 'trade') NOT IN ('direct', 'seed') " +
        "AND tr.mint IN (SELECT mint FROM trades WHERE side = 'buy' AND ts >= ? AND ts <= ?) " +
        'GROUP BY tr.mint, tr.address HAVING ts >= ? AND ts <= ?',
    ).all(TRUSTED, since, now, since, now);
    const byMint = new Map();
    for (const r of rows) {
      if (r.n === 1 && r.usd <= cfg.seedWaveMaxUsd) {
        if (!byMint.has(r.mint)) byMint.set(r.mint, []);
        byMint.get(r.mint).push([r.ts, r.address, r.usd]);
      }
    }
    const out = [];
    for (const [mint, cands] of byMint) {
      cands.sort((a, b) => a[0] - b[0]);
      let run = [];
      for (const c of [...cands, [null, '', 0]]) {
        if (run.length && (c[0] === null || c[0] - run[run.length - 1][0] > cfg.seedWaveMaxGapS)) {
          if (run.length >= cfg.seedWaveMinWallets) {
            const sizes = run.map((x) => x[2]).sort((a, b) => a - b);
            out.push({ mint, wallets: run.length, firstTs: run[0][0], lastTs: run[run.length - 1][0], medianUsd: sizes[Math.floor(sizes.length / 2)] });
          }
          run = [];
        }
        if (c[0] !== null) run.push(c);
      }
    }
    if (!dry && out.length) {
      tx(() => {
        const mark = q(
          "UPDATE trades SET kind = 'seed' WHERE mint = ? AND side = 'buy' AND ts BETWEEN ? AND ? " +
            "AND COALESCE(usd_value, 0) <= ? AND COALESCE(kind, 'trade') != 'direct' " +
            'AND address IN (SELECT address FROM traders WHERE score >= ?)',
        );
        for (const w of out) w.marked = mark.run(w.mint, w.firstTs - 300, w.lastTs + 60, cfg.seedWaveMaxUsd, TRUSTED).changes;
      });
    }
    return out;
  }

  function seededInfo(mint, now) {
    const r = q(
      "SELECT COUNT(DISTINCT CASE WHEN s.kind IN ('dust','direct','seed') THEN s.address END) wallets, " +
        "COUNT(DISTINCT CASE WHEN COALESCE(s.kind,'trade') = 'trade' THEN s.address END) real " +
        "FROM trades s JOIN traders st ON st.address = s.address WHERE s.mint = ? AND s.side = 'buy' AND st.score >= ? AND s.ts >= ?",
    ).get(mint, TRUSTED, now - cfg.seedWindowH * 3600);
    const wallets = r.wallets || 0;
    const real = r.real || 0;
    return { wallets, real, seeded: wallets >= cfg.seedMinWallets && wallets > real };
  }

  // noise.sweep: an address with more fills in an hour than a person can place is not a trader.
  function sweepNoise(now) {
    const ceiling = cfg.noiseFillsPerHour;
    const rows = q('SELECT address, COUNT(*) n, COUNT(DISTINCT mint) tokens FROM trades WHERE ts >= ? GROUP BY address HAVING n > ?').all(now - 3600, ceiling);
    for (const h of rows) {
      tx(() => {
        q('INSERT INTO noise(address, reason, ts) VALUES(?, ?, ?) ON CONFLICT(address) DO UPDATE SET reason = excluded.reason, ts = excluded.ts').run(h.address, `${h.n} fills across ${h.tokens} tokens in an hour`, now);
        q("UPDATE traders SET status = 'dropped' WHERE address = ?").run(h.address);
        q('DELETE FROM trades WHERE address = ?').run(h.address);
      });
    }
    return rows;
  }

  // ---------------------------------------------------------------- crews

  function computeCrews(now) {
    const rows = q(
      'SELECT tr.mint mint, tr.address address, MIN(tr.ts) ts FROM trades tr JOIN traders t ON t.address = tr.address ' +
        "WHERE tr.side = 'buy' AND tr.ts >= ? AND t.score >= ? AND COALESCE(tr.kind, 'trade') = 'trade' GROUP BY tr.mint, tr.address",
    ).all(now - cfg.crewDays * 86400, TRUSTED);
    const byMint = new Map();
    const perWallet = new Map();
    for (const r of rows) {
      if (!byMint.has(r.mint)) byMint.set(r.mint, []);
      byMint.get(r.mint).push([r.ts, r.address]);
      perWallet.set(r.address, (perWallet.get(r.address) || 0) + 1);
    }
    const shared = new Map();
    for (const entries of byMint.values()) {
      entries.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j][0] - entries[i][0] > cfg.crewGapS) break;
          const [a, b] = [entries[i][1], entries[j][1]].sort();
          const k = `${a}|${b}`;
          shared.set(k, (shared.get(k) || 0) + 1);
        }
      }
    }
    const parent = new Map();
    const root = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    let pairs = 0;
    for (const [k, n] of shared) {
      const [a, b] = k.split('|');
      if (n >= cfg.crewMinShared && n >= cfg.crewMinShare * Math.min(perWallet.get(a), perWallet.get(b))) {
        pairs++;
        const ra = root(a);
        const rb = root(b);
        if (ra !== rb) parent.set(rb, ra);
      }
    }
    const groups = new Map();
    for (const w of parent.keys()) {
      const r = root(w);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(w);
    }
    tx(() => {
      q('DELETE FROM crews').run();
      const ins = q('INSERT INTO crews(address, crew, size, updated_at) VALUES(?, ?, ?, ?)');
      [...groups.values()].sort((a, b) => b.length - a.length).forEach((members, i) => {
        for (const w of members) ins.run(w, i + 1, members.length, now);
      });
    });
    return { pairs, crews: groups.size };
  }
  function distinctCrews(addresses) {
    if (!addresses.length) return 0;
    const crew = new Map(q(`SELECT address, crew FROM crews WHERE address IN (${addresses.map(() => '?').join(',')})`).all(...addresses).map((r) => [r.address, r.crew]));
    return new Set(addresses.map((a) => (crew.has(a) ? `c${crew.get(a)}` : `solo:${a}`))).size;
  }

  // ---------------------------------------------------------------- bursts (hot.hot_now)

  function hotNow(now) {
    const windowS = cfg.hotWindowMin * 60;
    const since = now - windowS;
    const rows = q(
      'SELECT tr.mint mint, tr.address addr, t.score score, t.handle handle, MIN(tr.ts) first_ts, SUM(tr.usd_value) usd, ' +
        'COALESCE(tk.symbol, substr(tr.mint, 1, 8)) sym, tk.liquidity_usd liq ' +
        'FROM trades tr JOIN traders t ON t.address = tr.address LEFT JOIN tokens tk ON tk.mint = tr.mint ' +
        `WHERE tr.side = 'buy' AND t.score >= ? AND tr.ts <= ?${NOT_QUOTE('tr.mint')}${REAL('tr')}${NOT_SEEDED('tr')}${NOT_UNSELLABLE('tr')} ` +
        'GROUP BY tr.mint, tr.address HAVING first_ts >= ?',
    ).all(TRUSTED, now, ...seededParams(now), since);
    const byMint = new Map();
    const meta = new Map();
    for (const r of rows) {
      if (!byMint.has(r.mint)) byMint.set(r.mint, []);
      byMint.get(r.mint).push({ ts: r.first_ts, addr: r.addr, score: r.score, usd: r.usd || 0, handle: r.handle });
      meta.set(r.mint, { sym: r.sym, liq: r.liq });
    }
    const out = [];
    for (const [mint, entries] of byMint) {
      entries.sort((a, b) => a.ts - b.ts);
      const conv = conviction(entries.map((e) => e.score));
      if (conv < cfg.hotDelta || entries.length < cfg.hotMinWallets) continue;
      // a cohort takes time to arrive; five wallets inside two minutes is a script
      if (entries[entries.length - 1].ts - entries[0].ts < cfg.hotMinSpanS) continue;
      // six keys following one call are one opinion
      if (distinctCrews(entries.map((e) => e.addr)) < cfg.hotMinCrews) continue;
      // and it is an entry only if the tape is not busy leaving
      const bought = entries.reduce((s, e) => s + e.usd, 0);
      const sold = q("SELECT COALESCE(SUM(usd_value), 0) s FROM trades WHERE mint = ? AND side = 'sell' AND ts >= ? AND ts <= ? AND COALESCE(kind, 'trade') = 'trade'").get(mint, since, now).s;
      if (bought && sold >= cfg.hotMaxSellRatio * bought) continue;
      const firstAny = q('SELECT MIN(ts) t FROM trades WHERE mint = ?').get(mint).t;
      const age = firstAny ? now - firstAny : null;
      // the price the last entrant paid
      const px = q(
        `SELECT usd_value / token_amount p FROM trades WHERE mint = ? AND side = 'buy' AND ts >= ? AND ts <= ? AND address IN (${entries.map(() => '?').join(',')}) ` +
          'AND usd_value > 0 AND token_amount > 0 ORDER BY ts DESC LIMIT 1',
      ).get(mint, since, now, ...entries.map((e) => e.addr));
      out.push({
        mint,
        sym: meta.get(mint).sym,
        liq: meta.get(mint).liq,
        conviction: Math.round(conv * 100) / 100,
        wallets: entries.length,
        usd: bought,
        firstTs: entries[0].ts,
        lastTs: entries[entries.length - 1].ts,
        ageS: age,
        windowS,
        px: px ? px.p : null,
        who: entries.map((e) => e.handle || e.addr.slice(0, 8)),
        scores: entries.map((e) => e.score),
        entries: entries.map((e) => [e.ts, e.handle || e.addr.slice(0, 8), e.score, Math.round(e.usd)]),
      });
    }
    out.sort((a, b) => b.conviction - a.conviction || b.usd - a.usd);
    return out;
  }

  function recordBurst(h) {
    if (q('SELECT 1 FROM bursts WHERE mint = ? AND ts >= ?').get(h.mint, h.lastTs - cfg.realertHours * 3600)) return false;
    q('INSERT INTO bursts(mint, ts, conviction, wallets, usd, px, window_s, age_s, who) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      h.mint, h.lastTs, h.conviction, h.wallets, h.usd, h.px ?? null, h.windowS, h.ageS ?? null, JSON.stringify(h.entries),
    );
    return true;
  }

  // ---------------------------------------------------------------- the feeds (analyze.py)

  function signals(now, hours = 24, minBuyers = 2, limit = 30) {
    return q(
      'SELECT mint, sym, liq, price, COUNT(*) buyers, SUM(usd) usd, MIN(first_ts) first_ts, AVG(score) avg_score, ' +
        'SUM((score / 100.0) * (score / 100.0)) conviction, GROUP_CONCAT(handle, \'|\') who, GROUP_CONCAT(score) scores FROM (' +
        '  SELECT tr.mint mint, COALESCE(tk.symbol, substr(tr.mint, 1, 8)) sym, tk.liquidity_usd liq, tk.price_usd price, t.score score, t.handle handle, ' +
        '    SUM(tr.usd_value) usd, MIN(tr.ts) first_ts FROM trades tr JOIN traders t ON t.address = tr.address LEFT JOIN tokens tk ON tk.mint = tr.mint ' +
        `  WHERE tr.side = 'buy' AND tr.ts >= ? AND tr.ts <= ? AND t.score >= ?${NOT_QUOTE('tr.mint')}${REAL('tr')}${NOT_SEEDED('tr')}${NOT_UNSELLABLE('tr')}` +
        '  GROUP BY tr.mint, tr.address' +
        ') GROUP BY mint HAVING buyers >= ? ORDER BY conviction DESC, usd DESC LIMIT ?',
    )
      .all(now - hours * 3600, now, TRUSTED, ...seededParams(now), minBuyers, limit)
      .map((r) => ({ ...r, who: (r.who || '').split('|'), scores: String(r.scores || '').split(',').map(Number) }));
  }

  function fresh(now, hours = 6, maxAgeH = 72, minLiquidity = 5000, minBuyers = 2, limit = 20) {
    const since = now - hours * 3600;
    const rows = q(
      'SELECT tr.mint mint, tr.address address, t.handle handle, t.score score, MIN(tr.ts) ts, SUM(tr.usd_value) usd ' +
        'FROM trades tr JOIN traders t ON t.address = tr.address ' +
        `WHERE tr.side = 'buy' AND tr.ts >= ? AND tr.ts <= ? AND t.score >= ?${NOT_QUOTE('tr.mint')}${REAL('tr')}${NOT_SEEDED('tr')}${NOT_UNSELLABLE('tr')} ` +
        'GROUP BY tr.mint, tr.address',
    ).all(since, now, TRUSTED, ...seededParams(now));
    const byMint = new Map();
    for (const r of rows) {
      if (!byMint.has(r.mint)) byMint.set(r.mint, []);
      byMint.get(r.mint).push(r);
    }
    if (!byMint.size) return { tokens: [], drained: 0 };
    const mints = [...byMint.keys()];
    const marks = mints.map(() => '?').join(',');
    const meta = new Map(q(`SELECT mint, symbol, created_at, liquidity_usd, mcap_usd, price_usd FROM tokens WHERE mint IN (${marks})`).all(...mints).map((r) => [r.mint, r]));
    const prior = new Set(
      q(`SELECT DISTINCT tr.mint mint FROM trades tr JOIN traders t ON t.address = tr.address WHERE tr.side = 'buy' AND tr.ts < ? AND t.score >= ? AND tr.mint IN (${marks})`)
        .all(since, TRUSTED, ...mints)
        .map((r) => r.mint),
    );
    const out = [];
    let drained = 0;
    for (const [mint, buyers] of byMint) {
      if (prior.has(mint) || buyers.length < minBuyers) continue;
      const m = meta.get(mint) || {};
      const launched = m.created_at || null;
      const ageH = launched ? (now - launched) / 3600 : null;
      if (ageH != null && ageH > maxAgeH) continue;
      const liq = m.liquidity_usd;
      if (liq != null && liq < minLiquidity) {
        drained++;
        continue;
      }
      buyers.sort((a, b) => a.ts - b.ts);
      const early = (ts) => (launched ? 1 / (1 + Math.max(ts - launched, 0) / 3600) : 0.5);
      const heat = buyers.reduce((s, b) => s + (b.score / 100) ** 2 * early(b.ts), 0);
      out.push({
        mint,
        sym: m.symbol || mint.slice(0, 10),
        createdAt: launched,
        liq,
        mcap: m.mcap_usd ?? null,
        price: m.price_usd ?? null,
        buyers: buyers.length,
        conviction: conviction(buyers.map((b) => b.score)),
        heat,
        usd: buyers.reduce((s, b) => s + (b.usd || 0), 0) || null,
        firstTs: buyers[0].ts,
        lastTs: buyers[buyers.length - 1].ts,
        leadMin: launched ? (buyers[0].ts - launched) / 60 : null,
        who: buyers.map((b) => b.handle || b.address.slice(0, 10)),
        scores: buyers.map((b) => b.score),
      });
    }
    out.sort((a, b) => b.heat - a.heat || (b.usd || 0) - (a.usd || 0));
    return { tokens: out.slice(0, limit), drained };
  }

  function exits(now, hours = 6, minSellers = 2, minExit = 0.5, limit = 20) {
    const cutoff = now - hours * 3600;
    const rows = q(
      'SELECT tr.mint mint, COALESCE(tk.symbol, substr(tr.mint, 1, 8)) sym, tk.liquidity_usd liq, tr.address addr, t.score score, t.handle handle, ' +
        "SUM(CASE WHEN tr.side = 'sell' AND tr.ts >= ? THEN COALESCE(tr.usd_value, 0) END) out_usd, " +
        "MAX(CASE WHEN tr.side = 'sell' THEN tr.ts END) last_sell, " +
        "SUM(CASE WHEN tr.side = 'buy' THEN tr.token_amount ELSE 0 END) bought_amt, " +
        "SUM(CASE WHEN tr.side = 'sell' THEN tr.token_amount ELSE 0 END) sold_amt, SUM(tr.token_amount IS NULL) sizeless " +
        'FROM trades tr JOIN traders t ON t.address = tr.address LEFT JOIN tokens tk ON tk.mint = tr.mint ' +
        "WHERE t.score >= ? AND tr.ts <= ? AND tr.mint IN (SELECT DISTINCT mint FROM trades WHERE side = 'sell' AND ts >= ?)" +
        `${NOT_QUOTE('tr.mint')}${REAL('tr')} GROUP BY tr.mint, tr.address HAVING out_usd > 0`,
    ).all(cutoff, TRUSTED, now, cutoff);
    const byMint = new Map();
    for (const r of rows) {
      if (r.sizeless || !r.bought_amt) continue;
      const share = r.sold_amt / r.bought_amt;
      // more sold than the tape saw bought: in before we started watching, so unknowable
      if (share > 1.02 || share < minExit) continue;
      const t = byMint.get(r.mint) || { mint: r.mint, sym: r.sym, liq: r.liq, sellers: 0, usd: 0, conviction: 0, lastSell: 0, gone: 0, who: [], scores: [] };
      t.sellers++;
      t.usd += r.out_usd || 0;
      t.conviction += (r.score / 100) ** 2;
      t.lastSell = Math.max(t.lastSell, r.last_sell || 0);
      t.gone += share >= 0.98 ? 1 : 0;
      t.who.push(r.handle || r.addr.slice(0, 10));
      t.scores.push(r.score);
      byMint.set(r.mint, t);
    }
    return [...byMint.values()].filter((t) => t.sellers >= minSellers).sort((a, b) => b.conviction - a.conviction || b.usd - a.usd).slice(0, limit);
  }

  function tape(now, limit = 40) {
    return q(
      'SELECT tr.ts ts, tr.side side, tr.usd_value usd, tr.mint mint, COALESCE(tk.symbol, substr(tr.mint, 1, 8)) sym, t.handle handle, t.score score ' +
        `FROM trades tr JOIN traders t ON t.address = tr.address LEFT JOIN tokens tk ON tk.mint = tr.mint WHERE t.score >= ? AND tr.ts <= ?${NOT_QUOTE('tr.mint')}${REAL('tr')} ` +
        'AND tr.usd_value >= 1 ORDER BY tr.ts DESC LIMIT ?',
    ).all(TRUSTED, now, limit);
  }

  // ---------------------------------------------------------------- the alert ledger (pushes.py)

  function lastTrustedPx(mint, ts) {
    const r = q(
      'SELECT tr.usd_value / tr.token_amount p FROM trades tr JOIN traders t ON t.address = tr.address ' +
        "WHERE tr.mint = ? AND tr.ts <= ? AND tr.usd_value >= 1 AND tr.token_amount > 0 AND COALESCE(tr.kind, 'trade') = 'trade' AND t.score >= ? ORDER BY tr.ts DESC LIMIT 1",
    ).get(mint, ts, TRUSTED);
    return r ? r.p : null;
  }

  function recordPush(kind, h, now, { held = null } = {}) {
    if (q('SELECT 1 FROM pushes WHERE kind = ? AND mint = ? AND ts >= ?').get(kind, h.mint, now - cfg.realertHours * 3600)) return null;
    const px = h.px || lastTrustedPx(h.mint, now);
    const due = held ? null : now + cfg.followupMin * 60;
    const r = q(
      'INSERT INTO pushes(kind, mint, ts, px, conviction, wallets, usd, liq, cohort_share, who, held, followup_due) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(kind, h.mint, now, px ?? null, h.conviction ?? null, h.wallets ?? null, h.usd ?? null, h.liq ?? null, h.cohortShare ?? null, JSON.stringify(h.entries || []), held, due);
    return Number(r.lastInsertRowid);
  }
  const markTold = (id) => q('UPDATE pushes SET told = 1 WHERE id = ?').run(id);
  const duePushes = (now, graceS = 1800) =>
    q(
      'SELECT p.*, COALESCE(tk.symbol, substr(p.mint, 1, 8)) sym, tk.pool_address pool FROM pushes p LEFT JOIN tokens tk ON tk.mint = p.mint ' +
        'WHERE p.followup_due IS NOT NULL AND p.followup_at IS NULL AND p.followup_due <= ? AND p.followup_due > ? ORDER BY p.followup_due',
    ).all(now, now - graceS);
  function closePush(id, m, now) {
    q('UPDATE pushes SET followup_at = ?, best = ?, peak_min = ?, now_x = ?, vol_usd = ?, trail_x = ? WHERE id = ?').run(now, m.best ?? null, m.peakMin ?? null, m.now ?? null, m.vol ?? null, m.trail ?? null, id);
  }
  /** Trusted fills on a token after `ts`, real ones with a dollar leg: the tape's witness. */
  const fillPrices = (mint, from, to) =>
    q("SELECT usd_value / token_amount p FROM trades WHERE mint = ? AND ts > ? AND ts <= ? AND usd_value >= 1 AND token_amount > 0 AND COALESCE(kind, 'trade') = 'trade' ORDER BY ts").all(mint, from, to).map((r) => r.p);

  function pushes(now, days = 30) {
    return q(
      'SELECT p.*, COALESCE(tk.symbol, substr(p.mint, 1, 8)) sym, tk.price_usd price, tk.sellable sellable FROM pushes p LEFT JOIN tokens tk ON tk.mint = p.mint WHERE p.ts >= ? ORDER BY p.ts DESC',
    ).all(now - days * 86400);
  }
  const burstsSince = (since) => q('SELECT b.*, COALESCE(tk.symbol, substr(b.mint, 1, 8)) sym FROM bursts b LEFT JOIN tokens tk ON tk.mint = b.mint WHERE b.ts >= ? ORDER BY b.ts DESC').all(since);

  // ---------------------------------------------------------------- odds and ends for the gates

  const firstBuy = (mint) => q("SELECT MIN(ts) t FROM trades WHERE mint = ? AND side = 'buy'").get(mint).t;
  const cohortSold = (mint) => Boolean(q("SELECT 1 FROM trades tr JOIN traders t ON t.address = tr.address WHERE tr.mint = ? AND tr.side = 'sell' AND COALESCE(tr.kind, 'trade') = 'trade' AND tr.usd_value > 0 LIMIT 1").get(mint));
  const holdersToTry = (mint, limit = 3) =>
    q("SELECT address, MAX(usd_value) usd FROM trades WHERE mint = ? AND side = 'buy' AND COALESCE(kind, 'trade') = 'trade' GROUP BY address ORDER BY usd DESC LIMIT ?").all(mint, limit).map((r) => r.address);
  const setSellable = (mint, verdict, note, now) => q('UPDATE tokens SET sellable = ?, sell_checked_at = ?, sell_note = ? WHERE mint = ?').run(verdict, now, note, mint);
  const namesakes = (sym, mint, since) =>
    sym ? q('SELECT mint FROM tokens WHERE symbol = ? COLLATE NOCASE AND mint != ? AND COALESCE(created_at, first_seen_at) >= ?').all(sym, mint, since).map((r) => r.mint) : [];
  const pushedAny = (mints, since) => (mints.length ? Boolean(q(`SELECT 1 FROM pushes WHERE mint IN (${mints.map(() => '?').join(',')}) AND ts >= ? AND held IS NULL LIMIT 1`).get(...mints, since)) : false);
  /** Tokens trusted wallets touched lately that have no name, price or fresh depth yet. */
  const tokensToName = (now, limit = 60) =>
    q(
      'SELECT tk.mint FROM tokens tk WHERE tk.mint IN (SELECT DISTINCT tr.mint FROM trades tr JOIN traders t ON t.address = tr.address WHERE tr.ts >= ? AND t.score >= ?) ' +
        `AND tk.mint NOT IN (${QUOTES}) AND (tk.symbol IS NULL OR COALESCE(tk.checked_at, 0) < ?) ORDER BY COALESCE(tk.checked_at, 0) LIMIT ?`,
    ).all(now - 86400, TRUSTED, now - 900, limit).map((r) => r.mint);
  const counts = (now) => ({
    fills24h: q('SELECT COUNT(*) n FROM trades WHERE ts >= ? AND ts <= ?').get(now - 86400, now).n,
    fills: q('SELECT COUNT(*) n FROM trades').get().n,
    tokens: q('SELECT COUNT(*) n FROM tokens').get().n,
    lastFill: q('SELECT MAX(ts) t FROM trades WHERE ts <= ?').get(now).t,
  });

  return {
    db,
    getMeta,
    setMeta,
    loadRoster,
    tracked,
    rosterCounts,
    upsertToken,
    token,
    insertFills,
    knownTx,
    refreshMedians,
    classify,
    waves,
    seededInfo,
    sweepNoise,
    computeCrews,
    hotNow,
    recordBurst,
    signals,
    fresh,
    exits,
    tape,
    lastTrustedPx,
    recordPush,
    markTold,
    duePushes,
    closePush,
    fillPrices,
    pushes,
    burstsSince,
    firstBuy,
    cohortSold,
    holdersToTry,
    setSellable,
    namesakes,
    pushedAny,
    tokensToName,
    counts,
    close: () => db.close(),
  };
}
