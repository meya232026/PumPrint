#!/usr/bin/env node
// Builds public/assets/js/fomo/archive-data.js from vendor/fomo: the archived FOMO Robinhood
// Radar's alerts with what became of each, its totals, the tape by day, the judged roster (handles
// and scores only) and four published burst timelines.
//
// Every alert's verdict and paper result is computed here exactly as the project's own
// pipeline/record.py did, and the build fails if the totals differ from its summary.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { judge, totals } from '../server/fomo/record.js';

const V = (p) => fileURLToPath(new URL(`../vendor/fomo/${p}`, import.meta.url));
const OUT = fileURLToPath(new URL('../public/assets/js/fomo/archive-data.js', import.meta.url));

// The address an early wallet resolution mistook for a trader; the project quarantined it.
const NOISE = new Set(['0x8f10b468b06c6fd214b65f87778827f7d113f996']);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const num = (s) => (s === '' || s == null ? null : Number(s));
const utc = (s) => Math.floor(Date.parse(`${s.replace(' ', 'T')}Z`) / 1000);
const round2 = (x) => Math.round(x * 100) / 100;

function check(name, mine, theirs) {
  const pairs = [
    ['pushes', mine.pushes, theirs.pushes],
    ['bursts', mine.bursts, theirs.bursts],
    ['launches', mine.launches, theirs.launches],
    ['measured', mine.measured, theirs.measured],
    ['clean', mine.clean, theirs.clean],
    ['above_entry', mine.aboveEntry, theirs.above_entry],
    ['reached_2x', mine.reached2x, theirs.reached_2x],
    ['median_best', mine.medianBest, theirs.median_best],
    ['seeded', mine.seeded, theirs.seeded],
    ['dead', mine.dead, theirs.dead],
    ['honeypot', mine.honeypot, theirs.honeypot],
    ['paper.trades', mine.paper.trades, theirs.paper.trades],
    ['paper.pnl', mine.paper.pnl, theirs.paper.pnl],
    ['paper.wins', mine.paper.wins, theirs.paper.wins],
    ['trail.trades', mine.trail.trades, theirs.paper_trail.trades],
    ['trail.pnl', mine.trail.pnl, theirs.paper_trail.pnl],
  ];
  const bad = pairs.filter(([, a, b]) => Math.abs((a ?? 0) - (b ?? 0)) > 0.005);
  if (bad.length) throw new Error(`${name} does not match summary.json: ${bad.map(([k, a, b]) => `${k} ${a} vs ${b}`).join(', ')}`);
}

export function buildArchive() {
  const summary = JSON.parse(readFileSync(V('archive/summary.json'), 'utf8'));
  const now = utc(summary.generated_at_utc);
  const alerts = parseCsv(readFileSync(V('archive/alerts.csv'), 'utf8')).map((a) =>
    judge(
      {
        id: Number(a.id),
        ts: utc(a.ts_utc),
        kind: a.kind,
        mint: a.mint.toLowerCase(),
        sym: a.symbol || a.mint.slice(0, 8),
        chats: num(a.chats) || 0,
        px: num(a.entry_px),
        heat: num(a.heat),
        conviction: num(a.conviction),
        wallets: num(a.wallets),
        liq: num(a.liquidity_usd),
        share: num(a.cohort_share),
        followupAt: num(a.followup_at),
        best: num(a.peak_x),
        peakMin: num(a.peak_min),
        hour: num(a.hour_x),
        trail: num(a.trail_x),
        vol: num(a.volume_after_usd),
        unsellable: a.sellable === '0',
        seeded: a.seeded === '1',
      },
      now,
    ),
  );
  alerts.sort((a, b) => a.ts - b.ts || a.id - b.id);

  const sent = alerts.filter((a) => a.chats > 0);
  const t = {
    all: totals(sent),
    bursts: totals(sent.filter((a) => a.kind === 'burst')),
    launches: totals(sent.filter((a) => a.kind === 'launch')),
    withUnsent: totals(alerts),
  };
  check('all sent', t.all, summary.record_all_time);
  check('bursts', t.bursts, summary.record_bursts);
  check('launches', t.launches, summary.record_launches);
  check('including unsent', t.withUnsent, summary.record_including_unsent);

  // What the finding rests on, measured the same way (shown under the headline).
  const bursts = sent.filter((a) => a.kind === 'burst' && a.paper != null);
  const top3 = [...bursts].sort((a, b) => b.paper - a.paper).slice(0, 3);
  const cleanBursts = bursts.filter((a) => !['seeded', 'dead', 'honeypot'].includes(a.verdict));
  const unsentLaunches = alerts.filter((a) => a.kind === 'launch' && a.chats === 0 && a.paper != null);
  const caveats = {
    top3: top3.map((a) => ({ sym: a.sym, paper: a.paper })),
    restPnl: round2(bursts.reduce((s, a) => s + a.paper, 0) - top3.reduce((s, a) => s + a.paper, 0)),
    cleanTrades: cleanBursts.length,
    cleanPnl: round2(cleanBursts.reduce((s, a) => s + a.paper, 0)),
    unsentLaunchTrades: unsentLaunches.length,
    unsentLaunchPnl: round2(unsentLaunches.reduce((s, a) => s + a.paper, 0)),
  };

  const tape = parseCsv(readFileSync(V('archive/tape_by_day.csv'), 'utf8')).map((d) => [d.date, Number(d.fills), Number(d.wallets_active), Number(d.tokens_touched), Number(d.seeded_fills)]);

  // The roster as the page shows it: handle, score, status and style. No wallet addresses, no
  // PnL figures and none of the written verdicts: the page is about the signal, not the people.
  const roster = parseCsv(readFileSync(V('archive/traders.csv'), 'utf8'))
    .filter((r) => !NOISE.has(r.address.toLowerCase()) && r.chain === 'robinhood')
    .map((r) => {
      let style = [];
      try {
        style = JSON.parse(r.tags || '{}').style || [];
      } catch {
        style = [];
      }
      return [r.fomo_handle || '', Number(r.score) || 0, r.status, style.join(' ')];
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const cases = ['catgpt', 'frontier', 'swarm', 'stonkinu'].map((slug) => {
    const c = JSON.parse(readFileSync(V(`cases/${slug}.json`), 'utf8'));
    return {
      slug,
      symbol: c.symbol,
      date: c.date,
      mint: c.mint,
      peak: c.peak_multiple,
      peakAfter: c.peak_after,
      now: c.now_multiple,
      nowAfter: c.now_after,
      entryPx: c.entry_px,
      bar: c.burst_bar,
      timeline: c.timeline,
      candleLabel: c.candle_label || '',
      entries: c.entries.map((e) => [e.ts, e.handle, e.score, e.usd]),
      events: (c.events || []).map((e) => [e.ts, e.label, e.sub || '']),
      candles: (c.candles || []).map((k) => k.slice(0, 5).map((v, i) => (i === 0 ? v : Math.round(v * 1000) / 1000))),
    };
  });

  const slim = (a) => [a.ts, a.kind === 'burst' ? 1 : 0, a.sym, a.mint, a.chats, a.px, a.kind === 'burst' ? a.conviction : a.heat, a.wallets, a.liq, a.best, a.peakMin, a.hour, a.trail, a.vol, a.verdict, a.paper, a.paperTrail];
  return {
    generatedAt: now,
    tape: summary.tape,
    bot: { subscribers: summary.bot.subscribers_active, messages: summary.bot.messages_sent },
    totals: t,
    caveats,
    // one row per alert: [ts, isBurst, sym, mint, chats, entryPx, conviction|heat, wallets, liq,
    //   peakX, peakMin, hourX, trailX, volumeAfter, verdict, paper, paperTrail]
    alerts: alerts.map(slim),
    days: tape,
    roster,
    cases,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = buildArchive();
  const js =
    '// The archived FOMO Robinhood Radar (cvxv666/fomo-robinhood-radar, MIT): what it alerted on and what\n' +
    '// came of it. Generated by scripts/build-fomo-archive.mjs from vendor/fomo; do not edit.\n' +
    `export default ${JSON.stringify(data)};\n`;
  writeFileSync(OUT, js);
  const t = data.totals;
  console.log(`bursts ${t.bursts.pushes} alerts, ${t.bursts.paper.trades} trades, ${t.bursts.paper.pnl >= 0 ? '+' : ''}$${t.bursts.paper.pnl}`);
  console.log(`launches ${t.launches.pushes} alerts, ${t.launches.paper.trades} trades, $${t.launches.paper.pnl}`);
  console.log('caveats', JSON.stringify(data.caveats));
  console.log(`roster ${data.roster.length}, days ${data.days.length}, cases ${data.cases.length}`);
  console.log('wrote', OUT, `${(js.length / 1024).toFixed(1)} KB`);
}
