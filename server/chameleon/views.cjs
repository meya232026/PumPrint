'use strict';
// Read-only views over a loaded Chameleonscope engine (the TL object of vendor/chameleonscope/src).
// The feed rules below are private functions inside src/app_ui.js (GROUPS, baseMatch, passes, ui.visible, stageBar)
// and src/app_quantum.js (eligible); app_ui.js itself cannot run headless, so they are replicated here 1:1.

function makeViews(TL, opts) {
  opts = opts || {};
  const U = TL.util, store = TL.store, DAY = TL.DAY;
  const requirePictures = !!opts.requirePictures; // app_ui only lists a token once TL.pics.has(t); headless no picture ever loads

  // ---- app_ui.js lines 24-47: the four feeds ----
  const onCurve = (t) => !t.complete && t.stage !== 'dead' && (U.isNum(t.curve) || t.gmgnList === 'new_creation' || t.gmgnList === 'near_completion');
  const byNewest = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  const byBonding = (a, b) => (U.isNum(b.curve) ? b.curve : -1) - (U.isNum(a.curve) ? a.curve : -1) || (b.mc || 0) - (a.mc || 0);
  const byGrad = (a, b) => {
    const sa = U.isNum(a.graduatedAt) ? a.graduatedAt : (a.createdAt || 0), sb = U.isNum(b.graduatedAt) ? b.graduatedAt : (b.createdAt || 0);
    return sb - sa;
  };
  const topAgeOk = (t, topAge) => {
    if (!U.isNum(t.createdAt)) return t.chain === 'robinhood' && topAge >= 180;
    const d = (U.now() - t.createdAt) / DAY; return d >= TL.TOP_MIN_AGE / DAY && d <= topAge;
  };
  const GROUPS = {
    new: { label: 'New', test: onCurve, sort: byNewest },
    almost: { label: 'Almost bonded', test: (t) => onCurve(t) && ((U.isNum(t.curve) && t.curve >= 0.15) || (!U.isNum(t.curve) && t.gmgnList === 'near_completion')), sort: byBonding },
    graduated: { label: 'Migrated', test: (t) => { if (!t.complete || t.stage === 'dead') return false; const since = U.isNum(t.graduatedAt) ? t.graduatedAt : t.createdAt; return U.isNum(since) ? U.now() - since <= DAY : true; }, sort: byGrad },
    top: { label: 'Top', test: (t, o) => !!t.top && topAgeOk(t, o.topAge), sort: byNewest },
  };

  // ---- app_ui.js ui.visible() (lines 414-439) without the person's filters ----
  function feed(chain, group, o) {
    o = Object.assign({ win: 'h1', strict: false, topAge: 30, limit: 100 }, o || {});
    const g = GROUPS[group]; if (!g) throw new Error('group: new | almost | graduated | top');
    const now = U.now(), out = [], hidden = {}; let checking = 0, waitPic = 0;
    for (const t of store.all()) {
      if (t.chain !== chain || !t.ready) continue;
      if (!TL.trusted(t)) continue;
      if (!TL.checked(t)) { if (!t.demo) checking++; continue; }
      if (!g.test(t, o)) continue;
      if (o.win !== 'h24' && TL.activeIn(t, o.win, now) === false) { const k = 'no trades in the last ' + o.win; hidden[k] = (hidden[k] || 0) + 1; continue; }
      TL.ensureVet(t);
      if (!(o.strict ? t._okStrict : t._ok)) { const k = t._hide || (o.strict ? TL.strictReason(t) : '') || 'filtered'; hidden[k] = (hidden[k] || 0) + 1; continue; }
      if (requirePictures && !TL.pics.has(t)) { waitPic++; continue; }
      out.push(t);
    }
    out.sort(g.sort);
    return { group, label: g.label, total: out.length, rows: out.slice(0, o.limit), hidden, checking, waitPic };
  }

  // ---- app_ui.js stageBar(): the label a row shows ----
  function stageLabel(t) {
    if (U.isNum(t.curve) && !t.complete) return t.curve >= 0.7 ? 'Bonding soon' : t.curve >= 0.15 ? 'Almost bonded' : 'New';
    if (!t.complete) return t.gmgnList === 'near_completion' ? 'Almost bonded' : 'New';
    return t.stage === 'trending' ? 'Trending' : t.stage === 'fading' ? 'Fading' : t.stage === 'dead' ? 'Dead' : 'Migrated';
  }
  const short = (s) => (typeof s === 'string' && s.length > 90 ? s.slice(0, 60) + '...[' + s.length + ' chars]' : s);

  // what one feed row shows (app_ui.js rowHtml)
  function row(t, win) {
    win = win || 'h1';
    const CL = TL.calls, K = TL.known, Q = TL.quantum, call = CL ? CL.forToken(t) : null;
    TL.ensureVet(t);
    return {
      id: t.id, chain: t.chain, address: t.address, symbol: t.symbol, name: t.name, logo: short(t.logoOk || t.logo),
      demo: !!t.demo, partial: !!t.partial, launchpad: t.launchpad, quote: t.quote,
      createdAt: t.createdAt, ageMin: U.isNum(t.createdAt) ? Math.round((U.now() - t.createdAt) / 6000) / 10 : null,
      stage: t.stage, stageLabel: stageLabel(t), curve: t.curve, complete: t.complete, graduatedAt: t.graduatedAt,
      price: t.price, mc: t.mc, liq: t.liq, holders: t.holders, holdersDelta1h: t.holdersDelta1h,
      win, chg: t.chg[win], vol: t.vol[win], volIsFloor: !!(t._volMin && t._volMin[win]), tx: t.tx[win],
      verdict: t.verdict, scores: t.scores && { safety: t.scores.safety, momentum: t.scores.momentum, community: t.scores.community }, potential: t._pot,
      facts: { devPct: t.dev.pct, devSold: t.dev.sold === true, sniperPct: t.sniperPct, bundlePct: t.bundlePct, top10: TL.top10eff(t) },
      flags: TL.flags(t).map((f) => (f.hard ? '!' : '~') + f.label),
      runner: !!t.runner, athMc: t.athMc, peakX: U.isNum(t.peakX) ? Math.round(t.peakX * 100) / 100 : null, peakXSeen: t.peakXSeen,
      socials: t.socials, smart: t.smart,
      call: call ? { kind: call.kind, status: call.status, mcAtCall: call.mc, nowX: call.nowX, peakX: call.peakX, at: call.at } : null,
      quantum: Q ? Q.match(t) : null, known: K ? K.rowBadge(t) : null, simulated: Object.keys(t.simulated || {}),
    };
  }

  // the whole token object, made JSON-safe (clones become ids, long arrays are cut)
  function plain(t) {
    const o = {};
    for (const k of Object.keys(t)) {
      const v = t[k];
      if (typeof v === 'function') continue;
      if (k === 'clones') o[k] = (v || []).map((c) => c.id);
      else if (k === 'series' || k === 'live' || k === '_mc' || k === '_b') o[k] = Array.isArray(v) ? { length: v.length, last: v.slice(-2) } : v;
      else if (k === 'logo' || k === 'logoOk' || k === 'logoGen') o[k] = short(v);
      else if (k === '_potParts' || k === 'reasons' || k === 'scores') o[k] = v;
      else o[k] = v;
    }
    return o;
  }

  // everything a token page shows (app_ui.js renderToken and its cards)
  function detail(id) {
    const t = store.get(id); if (!t) return null; TL.ensureVet(t);
    const CL = TL.calls, K = TL.known, Q = TL.quantum;
    return {
      token: plain(t),
      verdict: t.verdict, scores: t.scores, flags: TL.flags(t), hideReason: t._hide, ok: t._ok, okStrict: t._okStrict,
      rugSign: TL.rugSign(t), rugged: TL.rugged(t), stale: TL.stale(t), weak: TL.weak(t), junk: TL.junk(t), proven: TL.proven(t),
      top10circ: TL.top10circ(t), circShare: TL.circShare(t), concentrated: TL.concentrated(t), devSpam: TL.devSpam(t),
      potential: t._pot, potentialParts: t._potParts, stageLabel: stageLabel(t),
      call: CL ? CL.forToken(t) : null, callGate: CL ? { weak: CL.weak(t), gradState: CL.gradState(t), isCall: CL.isCall(t, { any: true }) } : null,
      knownInside: K ? K.inside(t) : [], quantum: Q ? Q.match(t) : null,
      sameDev: t._idxDev ? (store.idx.devs[t._idxDev] || []).filter((x) => x !== t.id) : [],
    };
  }

  // ---- app_quantum.js eligible() / Q.all() / Q.index(); allowDemo drops the "never a demo token" rule (preview only) ----
  function radar(chain, o) {
    o = o || {}; const Q = TL.quantum; if (!Q) return null;
    const ok = (t) => t && t.chain === chain && t.ready && (o.allowDemo || (!t.demo && !t.partial)) && Q.match(t) && TL.checked(t) && Q.trusted(t) &&
      TL.ensureVet(t)._ok && (Q.heat(t) > 0 || (U.isNum(t.mc) && t.mc >= 20000));
    const all = store.all().filter(ok).sort((a, b) => Q.heat(b) - Q.heat(a) || (b.mc || 0) - (a.mc || 0));
    const now = U.now(); let w = 0, ws = 0;
    const ix = { n: all.length, vol1h: 0, vol5m: 0, chg1h: null, up: 0, withChg: 0, fresh: 0, leader: all[0] ? all[0].symbol : null, best: null };
    for (const t of all) {
      const v = t.vol || {}, v1 = U.isNum(v.h1) ? v.h1 : 0, c = t.chg && t.chg.h1;
      ix.vol1h += v1; ix.vol5m += U.isNum(v.m5) ? v.m5 : 0;
      if (U.isNum(c)) { ix.withChg++; if (c > 0) ix.up++; ws += c * Math.max(v1, 1); w += Math.max(v1, 1); if (!ix.best || c > ix.best.c) ix.best = { symbol: t.symbol, c }; }
      if (U.isNum(t.createdAt) && now - t.createdAt < 3600000) ix.fresh++;
    }
    if (w) ix.chg1h = ws / w;
    const top = all.length ? Q.heat(all[0]) : 0;
    return {
      index: ix,
      cards: all.slice(0, o.max || 12).map((t) => ({ id: t.id, symbol: t.symbol, name: t.name, word: Q.match(t), mc: t.mc, chg1h: t.chg.h1, vol1h: t.vol.h1, vol5m: t.vol.m5,
        heat: Math.round(Q.heat(t)), heatPctOfLeader: top > 0 ? Math.max(4, Math.round(Q.heat(t) / top * 100)) : 0, verdict: t.verdict, stage: t.stage, demo: !!t.demo })),
    };
  }

  return { GROUPS, feed, row, plain, detail, radar, stageLabel };
}

module.exports = { makeViews };
