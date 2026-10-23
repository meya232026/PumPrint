/* Trenchlight - Smart Tracking tab: paste a token contract, get the wallets inside it ranked by what they made.
   Solana:    the token's transaction history from a public Solana RPC (signatures + parsed transactions): every buy and sell with the
              wallet that paid, SOL in / out, tokens held after the last trade; then each top wallet's age, activity and balance.
   Robinhood: Pons curve trades (CurveBuy / CurveSell logs carry the wallet), Uniswap v4 swaps after graduation (wallet = tx sender),
              holders from Blockscout, wallet activity and balance from Blockscout.
   Wallet-wide win rate across many tokens needs the indexer (concept, section 6); here every number is real for THIS token. */
(function (TL) {
  'use strict';
  var U = TL.util, C = TL.CONFIG, store = TL.store, S = TL.sources;
  var X = TL.xray = { report: null, running: false, recent: [] };
  var $ = function (q, el) { return (el || document).querySelector(q); };
  var WSOL = 'So11111111111111111111111111111111111111112';
  var SOL_TX_CAP = 300, PAR = 6, REP_TOP = 16, SIG_PAGES = 12; // twelve pages of signatures reach the first buy of any curve that ever filled

  function isEvm(a) { return /^0x[0-9a-fA-F]{40}$/.test(a); }
  function isSol(a) { return /^[A-Za-z0-9]{32,44}$/.test(a) && !isEvm(a); }
  function short(a) { return a ? U.esc(String(a).slice(0, 4) + '…' + String(a).slice(-4)) : '–'; } // v1.59: escaped: an address is text from a node or an API
  function okAddr(a) { return isEvm(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(a || '')); }
  function solRpc(method, params) {
    return U.timeoutFetch(C.solRpc, 15000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }) })
      .then(function (r) { if (r && r.error) throw new Error(r.error.message || 'rpc error'); return r && r.result; });
  }
  // v1.93: one transaction, in the newest format the node gives. Solana's transaction format version 1 is on mainnet since 15 Sep 2026:
  // asked for version 0 at most (as every read here was until 1.92), the node refuses such a transaction ("Transaction version (1) is not
  // supported by the requesting client") and the pools below turned the refusal into a null, so every trade made in the new format was
  // left out of the reports without a word. Version 1 now; a node that names a newer one is asked for that from then on
  var TXV = X.txVer = { ver: 1 };
  function solTx(sig) {
    var ver = TXV.ver;
    return solRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: ver, commitment: 'confirmed' }]).catch(function (e) {
      var m = /version\s*\(?\s*(\d+)\s*\)?[^.]*not supported/i.exec(String((e && e.message) || e));
      if (!m || +m[1] <= ver) throw e;
      if (+m[1] > TXV.ver) TXV.ver = +m[1];
      return solRpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: TXV.ver, commitment: 'confirmed' }]);
    });
  }
  function hoodRpc(calls) { return S.rpc(calls); }
  function pool(items, par, fn, onEach) { // run fn over items with limited parallelism
    return new Promise(function (resolve) {
      var i = 0, running = 0, out = new Array(items.length);
      var next = function () {
        while (running < par && i < items.length) {
          (function (k) { running++; Promise.resolve().then(function () { return fn(items[k], k); }).then(function (v) { out[k] = v; }, function () { out[k] = null; }).then(function () { running--; if (onEach) onEach(k); if (i >= items.length && running === 0) resolve(out); else next(); }); })(i++);
        }
        if (!items.length) resolve(out);
      };
      next();
    });
  }
  function blank(addr) { return { addr: addr, buys: 0, sells: 0, inQuote: 0, outQuote: 0, tokIn: 0, tokOut: 0, holds: 0, firstBuy: null, lastAt: null, tags: [], rep: null }; }
  function wallet(map, addr) { return map[addr] || (map[addr] = blank(addr)); }

  // ---------- Solana ----------
  // quote assets a trade can be paid in: SOL (native or wrapped), USDC, USDT; everything is expressed in SOL
  var QUOTE = { 'So11111111111111111111111111111111111111112': { dec: 9, usd: null }, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { dec: 6, usd: 1 }, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCdmc1Amzu4': { dec: 6, usd: 1 } };
  function parseSolTx(tx, mint, out) {
    if (!tx || !tx.meta || tx.meta.err || !tx.transaction || !tx.transaction.message) return null;
    var keys = tx.transaction.message.accountKeys || []; var payer = keys[0] && (keys[0].pubkey || keys[0]); if (!payer) return null;
    var idxOf = {}, signers = {}; keys.forEach(function (k, i) { var pk = k.pubkey || k; idxOf[pk] = i; if (k.signer) signers[pk] = 1; });
    var solUsd = S.solUsd || store.solUsd || 100;
    var tb = {}, dec = 6;
    var take = function (b, isPost) { if (b.mint !== mint && !QUOTE[b.mint]) return; var e = tb[b.accountIndex] = tb[b.accountIndex] || { owner: b.owner, mint: b.mint, pre: 0, post: 0, dec: b.uiTokenAmount.decimals }; e[isPost ? 'post' : 'pre'] = Number(b.uiTokenAmount.amount); };
    (tx.meta.preTokenBalances || []).forEach(function (b) { take(b, false); }); (tx.meta.postTokenBalances || []).forEach(function (b) { take(b, true); });
    var acc = {};
    Object.keys(tb).forEach(function (k) {
      var e = tb[k]; var o = acc[e.owner] = acc[e.owner] || { tok: 0, sol: 0 };
      if (e.mint === mint) { o.tok += e.post - e.pre; dec = e.dec; out.bal[e.owner] = { amount: e.post, slot: tx.slot, dec: e.dec }; }
      else { var q = QUOTE[e.mint]; var units = (e.post - e.pre) / Math.pow(10, q.dec); o.sol += q.usd ? units * q.usd / solUsd : units; }
    });
    // the trader is the signer whose token balance moved (fee payers of bundles and pool vaults are not traders)
    var best = null; Object.keys(acc).forEach(function (o) { if (!signers[o] || !acc[o].tok) return; if (!best || Math.abs(acc[o].tok) > Math.abs(acc[best].tok)) best = o; });
    if (!best) return null;
    var a = acc[best]; var sol = a.sol;
    if (idxOf[best] != null) sol += (tx.meta.postBalances[idxOf[best]] - tx.meta.preBalances[idxOf[best]]) / 1e9;
    if (best === payer) sol += (tx.meta.fee || 0) / 1e9;
    var ts = (tx.blockTime || 0) * 1000;
    if (a.tok > 0 && sol < -0.0001) return { wallet: best, side: 'buy', quote: -sol, tokens: a.tok / Math.pow(10, dec), ts: ts, slot: tx.slot };
    if (a.tok < 0 && sol > 0.0001) return { wallet: best, side: 'sell', quote: sol, tokens: -a.tok / Math.pow(10, dec), ts: ts, slot: tx.slot };
    if (a.tok > 0) return { wallet: best, side: 'transferIn', quote: 0, tokens: a.tok / Math.pow(10, dec), ts: ts, slot: tx.slot };
    if (a.tok < 0) return { wallet: best, side: 'transferOut', quote: 0, tokens: -a.tok / Math.pow(10, dec), ts: ts, slot: tx.slot };
    return null;
  }
  // ---------- where a Solana token's trades actually are ----------
  // Signatures are listed per account, and a graduated token's swaps mostly do not reference the mint at all (a Raydium or
  // PumpSwap trade moves the pool's vault and the trader's own token account), so listing the mint returns account
  // creations and transfers: a $1.4M coin came back as "$3 traded". The trades live in two places: the bonding curve,
  // whose signature list is bounded and starts with the very first buyers, and the pool's token vault after graduation,
  // which every swap touches. The sample reads the curve from its first trade and the vault from its latest.
  function listSigs(account, pages, onPage) {
    var all = [], sawStart = false;
    var page = function (before, left) {
      var req = { limit: 1000 }; if (before) req.before = before;
      return solRpc('getSignaturesForAddress', [account, req]).then(function (r) {
        var got = r || []; all = all.concat(got);
        if (onPage) onPage(all.length);
        if (got.length < 1000) { sawStart = true; return; }
        if (left <= 1) return;
        return page(got[got.length - 1].signature, left - 1);
      }, function () {});
    };
    return page(null, pages).then(function () { return { sigs: all.filter(function (s) { return !s.err; }), sawStart: sawStart }; });
  }
  // Every swap on every Solana DEX passes the pool account itself (PumpSwap "pool", Raydium "amm" / "pool_state", Meteora "pool"),
  // so the pool's own signature list is the list of its trades, whatever the DEX. Pools come from the token record and from
  // DexScreener's pair list (any DEX, no key); the vault lookup below stays as the last resort when neither names a pool.
  function findPools(t, mint, curve) {
    var out = [], seen = {};
    var add = function (addr, src, dex) {
      addr = String(addr || ''); if (!addr || addr === String(curve || '') || addr === mint) return;
      if (seen[addr]) { if (dex && !seen[addr].dex) seen[addr].dex = dex; return; }
      seen[addr] = { address: addr, src: src, dex: dex || '' }; out.push(seen[addr]);
    };
    if (t && t.pair) add(t.pair, 'token record');
    return U.timeoutFetch(C.dexscreener + '/token-pairs/v1/solana/' + mint, 8000).then(function (pairs) {
      (Array.isArray(pairs) ? pairs : []).filter(function (p) { return p && p.chainId === 'solana' && p.pairAddress; })
        .sort(function (a, b) { return ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0); })
        .slice(0, 3).forEach(function (p) { add(p.pairAddress, 'DexScreener', p.dexId); });
    }, function () {}).then(function () { return out.slice(0, 3); });
  }
  var VAULT_MIN_SHARE = 0.005; // a pool vault holds a real slice of the supply; an emptied curve account or a stray wallet does not
  function findPoolVault(t, mint, curve) { // the pool's token account for this mint: owned by the pool itself (PumpSwap), else the biggest account of the mint
    var poolAddr = t && t.pair && String(t.pair) !== String(curve || '') ? String(t.pair) : null; // Jupiter's "first pool" of a pump token is the curve itself
    var amt = function (a) { try { return Number(a.account.data.parsed.info.tokenAmount.amount) / 1e6; } catch (e) { return 0; } };
    var byOwner = poolAddr ? solRpc('getTokenAccountsByOwner', [poolAddr, { mint: mint }, { encoding: 'jsonParsed' }]).then(function (r) {
      var v = (r && r.value) || []; if (!v.length) return null;
      v.sort(function (a, b) { return amt(b) - amt(a); });
      if (amt(v[0]) < 1e9 * VAULT_MIN_SHARE) return null;
      return { account: v[0].pubkey, owner: poolAddr, src: 'pool account' };
    }).catch(function () { return null; }) : Promise.resolve(null);
    return byOwner.then(function (vault) {
      if (vault) return vault;
      return solRpc('getTokenLargestAccounts', [mint]).then(function (r) {
        var v = ((r && r.value) || []).filter(function (a) { return Number(a.amount || 0) / 1e6 >= 1e9 * VAULT_MIN_SHARE; });
        if (!v.length) return null;
        var tryAt = function (i) {
          if (i >= Math.min(3, v.length)) return null;
          return solRpc('getAccountInfo', [v[i].address, { encoding: 'jsonParsed' }]).then(function (ai) {
            var owner = null; try { owner = ai.value.data.parsed.info.owner; } catch (e) {}
            if (owner && curve && owner === curve) return tryAt(i + 1); // the curve's own account: not a pool
            return { account: v[i].address, owner: owner, src: 'largest token account' };
          }, function () { return { account: v[i].address, owner: null, src: 'largest token account' }; });
        };
        return tryAt(0);
      }).catch(function () { return null; });
    });
  }
  function spreadOf(list, want) { // an even sample of a list, oldest-to-newest order kept
    if (want <= 0 || !list.length) return [];
    if (list.length <= want) return list.slice();
    var step = list.length / want, out = [];
    for (var i = 0; i < want; i++) out.push(list[Math.floor(i * step)]);
    return out;
  }
  X.solana = function (mint, progress) {
    var rep = { chain: 'solana', address: mint, wallets: {}, bal: {}, trades: [], total: null, sampled: 0, notes: [], venues: {} };
    var tok = store.get('solana:' + mint);
    progress('Reading the token…', 0.02);
    var meta = (tok && tok.name ? Promise.resolve(tok) : S.enrichJup([mint]).then(function () { return store.get('solana:' + mint); })).then(function (t) {
      if (t) return S.pollSolCurves([t.id]).catch(function () { return 0; }).then(function () { return store.get('solana:' + mint); });
      return null;
    }).catch(function () { return store.get('solana:' + mint); });
    var graduated = false;
    return meta.then(function (t) {
      rep.token = t;
      graduated = !!(t && (t.complete || (t.curve == null && t.pair)));
      progress('Finding where it trades…', 0.04);
      return S.curveAddr(mint).catch(function () { return null; }).then(function (curve) {
        rep.venues.curve = curve || null;
        return graduated ? findPools(t, mint, curve || null) : [];
      });
    }).then(function (pools) {
      rep.venues.pools = pools; rep.graduated = graduated;
      var jobs = [listSigs(rep.venues.curve || mint, SIG_PAGES, function (n) { progress('Listing curve trades (' + U.fmtNum(n) + ')…', 0.06); })];
      pools.forEach(function (pl) { jobs.push(listSigs(pl.address, 1, function (n) { progress('Listing pool trades (' + U.fmtNum(n) + ')…', 0.08); })); });
      return Promise.all(jobs).then(function (lists) {
        var poolSigs = [], seen = {}, poolMore = false;
        lists.slice(1).forEach(function (l, i) { l.sigs.forEach(function (sg) { if (!seen[sg.signature]) { seen[sg.signature] = 1; poolSigs.push(sg); } }); if (!l.sawStart) poolMore = true; pools[i].count = l.sigs.length; });
        poolSigs.sort(function (a, b) { return (b.blockTime || 0) - (a.blockTime || 0); });
        // no pool named by anyone, or pools that never traded: the biggest token account of the mint is the pool's vault, and every swap touches it
        if (graduated && !poolSigs.length) {
          return findPoolVault(t, mint, rep.venues.curve).then(function (vault) {
            if (!vault) return { curve: lists[0], pool: { sigs: [], sawStart: true } };
            rep.venues.vault = vault.account; rep.venues.vaultSrc = vault.src;
            return listSigs(vault.account, 1, function (n) { progress('Listing pool trades (' + U.fmtNum(n) + ')…', 0.08); }).then(function (l) { return { curve: lists[0], pool: l }; });
          });
        }
        return { curve: lists[0], pool: { sigs: poolSigs, sawStart: !poolMore } };
      });
    }).then(function (got) {
      var curveSigs = got.curve.sigs, poolSigs = got.pool.sigs;
      rep.sawStart = got.curve.sawStart;
      rep.curveCount = curveSigs.length; rep.poolCount = poolSigs.length; rep.poolMore = !got.pool.sawStart;
      try { console.info('[chameleon] smart tracking venues', { mint: mint, curve: rep.venues.curve, curveSigs: curveSigs.length, pools: (rep.venues.pools || []).map(function (pl) { return pl.address + ' (' + pl.src + (pl.dex ? ', ' + pl.dex : '') + ', ' + (pl.count || 0) + ' sigs)'; }), vault: rep.venues.vault || null, poolSigs: poolSigs.length }); } catch (e) {}
      rep.total = (rep.sawStart ? '' : '') + U.fmtNum(curveSigs.length + poolSigs.length) + (rep.sawStart && !rep.poolMore ? '' : '+');
      // the sample: the first trades of its life, an even slice of the rest of the curve, and the newest pool trades
      var pick;
      if (poolSigs.length) {
        var early = curveSigs.slice(-130), rest = curveSigs.slice(0, Math.max(0, curveSigs.length - 130));
        var mid = spreadOf(rest.slice().reverse(), 40).reverse();
        // the pool's newest page (up to 1000 swaps) is sampled evenly, so the trades read cover the last hours rather than the last minute
        var now = spreadOf(poolSigs, Math.max(60, SOL_TX_CAP - early.length - mid.length));
        pick = now.concat(mid, early);
      } else if (curveSigs.length <= SOL_TX_CAP) pick = curveSigs;
      else {
        var first = curveSigs.slice(-120), last = curveSigs.slice(0, 120);
        var between = spreadOf(curveSigs.slice(120, curveSigs.length - 120), SOL_TX_CAP - 240);
        pick = last.concat(between, first);
      }
      rep.sampled = pick.length;
      if (!pick.length) throw new Error('No transactions found for this address on Solana. Is it a token mint?');
      var done = 0;
      return pool(pick, PAR, function (s) {
        return solTx(s.signature); // v1.93: the newest format too
      }, function () { done++; progress('Parsing trades ' + done + ' / ' + pick.length, 0.1 + 0.55 * done / pick.length); }).then(function (txs) {
        txs = txs.filter(Boolean).sort(function (a, b) { return a.slot - b.slot; });
        txs.forEach(function (tx) { var tr = parseSolTx(tx, mint, rep); if (tr) rep.trades.push(tr); });
        if (txs.length) { rep.firstSeen = (txs[0].blockTime || 0) * 1000; rep.lastSeen = (txs[txs.length - 1].blockTime || 0) * 1000; rep.firstSlot = txs[0].slot; }
        return rep;
      });
    }).then(function () {
      var t = rep.token; var solUsd = S.solUsd || store.solUsd || null;
      rep.quote = 'SOL'; rep.quoteUsd = solUsd;
      rep.priceQuote = t && U.isNum(t.priceSol) ? t.priceSol : (t && U.isNum(t.price) && solUsd ? t.price / solUsd : null);
      rep.supply = 1e9; rep.tokDec = 6;
      var venue = {}; [rep.venues.curve, rep.venues.vault, rep.venues.vaultOwner, t && t.pair].concat((rep.venues.pools || []).map(function (pl) { return pl.address; })).forEach(function (a) { if (a) venue[String(a)] = 1; });
      aggregate(rep, function (w) { return !!venue[w]; });
      Object.keys(rep.bal).forEach(function (owner) { if (venue[owner]) return; var b = rep.bal[owner]; var amt = b.amount / Math.pow(10, b.dec || 6); var w = rep.wallets[owner]; if (w) w.holds = amt; else if (amt >= rep.supply * 0.001 && amt < rep.supply * 0.1) { w = wallet(rep.wallets, owner); w.holds = amt; w.passive = true; } });
      finish(rep);
      progress('Checking the top wallets…', 0.68);
      var top = rep.list.slice(0, REP_TOP);
      var done = 0;
      return pool(top, 4, function (w) {
        return Promise.all([
          solRpc('getBalance', [w.addr]).then(function (r) { return r && U.isNum(r.value) ? r.value / 1e9 : null; }).catch(function () { return null; }),
          solRpc('getSignaturesForAddress', [w.addr, { limit: 1000 }]).catch(function () { return null; }),
          // what the wallet holds of this token right now, straight from the chain: the sample may have missed its exit
          solRpc('getTokenAccountsByOwner', [w.addr, { mint: mint }, { encoding: 'jsonParsed' }]).then(function (r) {
            var v = (r && r.value) || [], sum = 0, seen = false;
            v.forEach(function (a) { try { var ui = a.account.data.parsed.info.tokenAmount.uiAmount; if (U.isNum(ui)) { sum += ui; seen = true; } } catch (e) {} });
            return r && Array.isArray(r.value) ? sum : null;
          }).catch(function () { return null; })
        ]).then(function (r) {
          var sigs = r[1] || []; var now = U.now();
          w.sigs = sigs.filter(function (s) { return !s.err; }); // kept: the record phase samples the wallet's other tokens from this list
          w.rep = { balance: r[0], balanceUnit: 'SOL', txCount: sigs.length >= 1000 ? 1000 : sigs.length, txPlus: sigs.length >= 1000, ageMs: sigs.length ? now - (sigs[sigs.length - 1].blockTime || 0) * 1000 : null, ageIsMin: sigs.length >= 1000, last24h: sigs.filter(function (s) { return (s.blockTime || 0) * 1000 > now - TL.DAY; }).length };
          if (U.isNum(r[2])) {
            var expected = Math.max(0, (w.tokIn || 0) - (w.tokOut || 0));
            w.holdsSrc = 'chain'; w.holdsSeen = w.holds; w.holds = r[2];
            // fewer tokens than the trades we read account for: it sold somewhere outside the sample
            if (!w.sells && w.buys > 0 && expected > 0 && r[2] < expected * 0.5) w.exitUnseen = true;
          }
        });
      }, function () { done++; progress('Checking the top wallets ' + done + ' / ' + top.length, 0.68 + 0.3 * done / top.length); }).then(function () {
        finish(rep); // the chain's own balances are in: positions, paper profit and the ranking are recomputed on them
        tagAll(rep); return rep;
      });
    });
  };

  // ---------- Robinhood Chain ----------
  function hoodLaunch(token) {
    var rec = S.hood.launches[token]; if (rec) return Promise.resolve(rec);
    var topic = '0x000000000000000000000000' + token.replace(/^0x/, '').toLowerCase();
    return hoodRpc([{ method: 'eth_blockNumber', params: [] }]).then(function (r) {
      var head = parseInt(r[0], 16);
      return hoodRpc({ method: 'eth_getLogs', params: [{ address: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', topics: ['0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607', topic], fromBlock: '0x' + Math.max(0, head - 5000000).toString(16), toBlock: 'latest' }] });
    }).then(function (r) {
      var logs = Array.isArray(r[0]) ? r[0] : [];
      if (!logs.length) return null;
      return S.processHoodLaunches(logs.slice(-1), []).then(function () { return S.hood.launches[token] || null; });
    });
  }
  X.robinhood = function (token, progress) {
    token = token.toLowerCase();
    var rep = { chain: 'robinhood', address: token, wallets: {}, bal: {}, trades: [], total: null, sampled: 0, notes: [] };
    progress('Reading the token…', 0.02);
    var PONS_BUY = '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455', PONS_SELL = '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df';
    var UNI_SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f', PM = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
    var words = function (d) { return (String(d || '').replace(/^0x/, '').match(/.{64}/g) || []); };
    var int128 = function (w) { var v = BigInt('0x' + w.slice(-32)); return v > 0x7fffffffffffffffffffffffffffffffn ? v - (1n << 128n) : v; };
    var rec, head, headTs;
    return hoodLaunch(token).then(function (r) {
      rec = r; rep.token = store.get('robinhood:' + token) || null;
      if (!rec && !rep.token) throw new Error('This address is not a Pons V2 launch on Robinhood Chain (only Pons tokens are supported for now).');
      return hoodRpc([{ method: 'eth_blockNumber', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }]);
    }).then(function (r) {
      head = parseInt(r[0], 16); headTs = r[1] && r[1].timestamp ? parseInt(r[1].timestamp, 16) * 1000 : U.now();
      progress('Reading curve trades…', 0.1);
      var calls = [];
      if (rec) calls.push({ method: 'eth_getLogs', params: [{ address: rec.curve, topics: [[PONS_BUY, PONS_SELL]], fromBlock: '0x' + rec.block.toString(16), toBlock: 'latest' }] });
      var pl = S.hood.pools[token];
      if (pl) calls.push({ method: 'eth_getLogs', params: [{ address: PM, topics: [UNI_SWAP, pl.id], fromBlock: '0x' + Math.max(0, head - 200000).toString(16), toBlock: 'latest' }] });
      return calls.length ? hoodRpc(calls) : [];
    }).then(function (res) {
      var tsOf = function (bh) { return headTs - (head - parseInt(bh, 16)) * 103; };
      var curveLogs = rec ? (res[0] || []) : [], swapLogs = rec ? (res[1] || []) : (res[0] || []);
      var curveQ = rec ? S.quoteInfo(rec.pairToken && !/^0x0{40}$/.test(rec.pairToken) ? rec.pairToken : null) : { decimals: 18 };
      var cLogs = (Array.isArray(curveLogs) ? curveLogs : []);
      var service = {}; [token, rec && rec.curve, (S.PONS && S.PONS.factory), PM, '0x' + '0'.repeat(40)].forEach(function (a) { if (a) service[String(a).toLowerCase()] = 1; });
      var pushCurve = function (l, maker) {
        var w = words(l.data); if (w.length < 2 || !l.topics || l.topics.length < 2) return;
        var buy = l.topics[0] === PONS_BUY;
        // CurveBuy(buyer, recipient) / CurveSell(seller, recipient). The transaction sender is the person; the topics are the
        // fallback, and anything that is the token, the curve, the factory or the pool manager is not a trader at all.
        var actor = '0x' + l.topics[1].slice(26), recipient = l.topics[2] ? '0x' + l.topics[2].slice(26) : null;
        var who = maker || (recipient && !service[recipient.toLowerCase()] ? recipient : null) || (actor && !service[actor.toLowerCase()] ? actor : null);
        if (!who || service[who.toLowerCase()]) return;
        var quote = parseInt(buy ? w[0] : w[1], 16), tokens = parseInt(buy ? w[1] : w[0], 16);
        rep.trades.push({ wallet: who, side: buy ? 'buy' : 'sell', quote: quote / Math.pow(10, curveQ.decimals), tokens: tokens / 1e18, ts: tsOf(l.blockNumber), slot: parseInt(l.blockNumber, 16), src: 'curve', tx: l.transactionHash });
      };
      var curveHashes = []; cLogs.slice(-400).forEach(function (l) { if (l.transactionHash && curveHashes.indexOf(l.transactionHash) < 0) curveHashes.push(l.transactionHash); });
      var makers = {};
      var curveDone = curveHashes.length ? (function () {
        progress('Reading who traded the curve (' + curveHashes.length + ' transactions)…', 0.22);
        var gs = []; for (var i = 0; i < curveHashes.length; i += 25) gs.push(curveHashes.slice(i, i + 25));
        return pool(gs, 3, function (g) {
          return hoodRpc(g.map(function (h) { return { method: 'eth_getTransactionByHash', params: [h] }; })).then(function (txs) {
            txs.forEach(function (tx, i) { if (tx && tx.from) makers[g[i]] = String(tx.from).toLowerCase(); });
          }).catch(function () { });
        });
      })() : Promise.resolve();
      return curveDone.then(function () {
        cLogs.forEach(function (l) { pushCurve(l, makers[l.transactionHash] || null); });
        return afterCurve();
      });
      function afterCurve() {
      rep.curveTrades = rep.trades.length; if (rec) { rep.firstSlot = rec.block; rep.sawStart = true; }
      var swaps = (Array.isArray(swapLogs) ? swapLogs : []).slice(-150);
      if (!swaps.length) return;
      progress('Reading pool swaps (' + swaps.length + ')…', 0.3);
      var pl = S.hood.pools[token]; var q = pl ? { decimals: pl.quoteDecimals || 18 } : { decimals: 18 };
      var hashes = []; swaps.forEach(function (l) { if (hashes.indexOf(l.transactionHash) < 0) hashes.push(l.transactionHash); });
      var groups = []; for (var i = 0; i < hashes.length; i += 25) groups.push(hashes.slice(i, i + 25));
      var from = {};
      return pool(groups, 3, function (g) { return hoodRpc(g.map(function (h) { return { method: 'eth_getTransactionByHash', params: [h] }; })).then(function (txs) { txs.forEach(function (tx, i) { if (tx && tx.from) from[g[i]] = tx.from.toLowerCase(); }); }); }).then(function () {
        swaps.forEach(function (l) {
          var w = words(l.data); if (w.length < 6) return; var who = from[l.transactionHash]; if (!who) return;
          var a0 = int128(w[0]), a1 = int128(w[1]); var tokD = pl && pl.tokenIs1 ? a1 : a0, qD = pl && pl.tokenIs1 ? a0 : a1;
          var buy = tokD > 0n; var quote = Number(qD < 0n ? -qD : qD) / Math.pow(10, q.decimals), tokens = Number(tokD < 0n ? -tokD : tokD) / 1e18;
          rep.trades.push({ wallet: who, side: buy ? 'buy' : 'sell', quote: quote, tokens: tokens, ts: tsOf(l.blockNumber), slot: parseInt(l.blockNumber, 16), src: 'pool' });
        });
      });
      }
    }).then(function () {
      rep.total = rep.trades.length; rep.sampled = rep.trades.length;
      if (!rep.trades.length) rep.notes.push('No trades found yet for this token.');
      progress('Reading holders…', 0.5);
      return U.timeoutFetch(C.blockscout + '/tokens/' + token + '/holders', 9000).catch(function () { return null; });
    }).then(function (h) {
      var t = rep.token; var pl = S.hood.pools[token];
      var qInfo = pl ? S.quoteInfo(pl.quote) : (rec ? S.quoteInfo(rec.pairToken && !/^0x0{40}$/.test(rec.pairToken) ? rec.pairToken : null) : { symbol: 'ETH', usd: S.ethUsd });
      rep.quote = qInfo.symbol || 'ETH'; rep.quoteUsd = qInfo.usd || null;
      rep.priceQuote = t && U.isNum(t.price) && rep.quoteUsd ? t.price / rep.quoteUsd : null;
      rep.supply = 1e9; rep.tokDec = 18;
      var items = h && Array.isArray(h.items) ? h.items : [];
      rep.holderSrc = items.length ? 'Blockscout holder list' : null;
      rep.holderPartial = !!(h && h.next_page_params);
      var skip = {}; if (rec) skip[rec.curve.toLowerCase()] = 1;
      aggregate(rep, function (w) { return !!skip[w]; });
      if (items.length && !rep.holderPartial) { // the list is the truth: zero out balances we only inferred from trades
        var listed = {}; items.forEach(function (it) { var a = it.address && it.address.hash ? it.address.hash.toLowerCase() : null; if (a) listed[a] = 1; });
        Object.keys(rep.wallets).forEach(function (a) { if (!listed[a.toLowerCase()]) rep.wallets[a].holds = 0; });
      }
      items.forEach(function (it) {
        var a = it.address && it.address.hash ? it.address.hash.toLowerCase() : null; if (!a || skip[a]) return;
        var amt = (U.num(it.value) || 0) / 1e18; if (it.address.is_contract && amt > rep.supply * 0.05) return; // pools, curves, lockers
        var w = rep.wallets[a]; if (w) w.holds = amt; else if (amt >= rep.supply * 0.001) { w = wallet(rep.wallets, a); w.holds = amt; w.passive = true; if (it.address.is_contract) w.contract = true; }
      });
      finish(rep);
      progress('Checking the top wallets…', 0.7);
      var top = rep.list.slice(0, REP_TOP); var done = 0;
      return pool(top, 3, function (w) {
        return Promise.all([U.timeoutFetch(C.blockscout + '/addresses/' + w.addr + '/counters', 8000).catch(function () { return null; }), U.timeoutFetch(C.blockscout + '/addresses/' + w.addr, 8000).catch(function () { return null; })]).then(function (r) {
          var c = r[0] || {}, a = r[1] || {};
          w.rep = { balance: U.num(a.coin_balance) != null ? U.num(a.coin_balance) / 1e18 : null, balanceUnit: 'ETH', txCount: U.num(c.transactions_count), txPlus: false, transfers: U.num(c.token_transfers_count), ageMs: null, contract: !!a.is_contract };
          w.name = a.ens_domain_name || a.name || (Array.isArray(a.public_tags) && a.public_tags[0] && (a.public_tags[0].display_name || a.public_tags[0].label)) || null;
        });
      }, function () { done++; progress('Checking the top wallets ' + done + ' / ' + top.length, 0.7 + 0.28 * done / top.length); }).then(function () { tagAll(rep); return rep; });
    });
  };

  // What the chain itself can say about one wallet: balance, how many transactions it has, how old it is.
  // Used for the wallet page when the GMGN source is not connected, so the page is never empty.
  X.walletFacts = function (chain, addr) {
    if (chain === 'solana') {
      return Promise.all([
        solRpc('getBalance', [addr]).then(function (r) { return r && U.isNum(r.value) ? r.value / 1e9 : null; }).catch(function () { return null; }),
        solRpc('getSignaturesForAddress', [addr, { limit: 1000 }]).catch(function () { return null; })
      ]).then(function (r) {
        var sigs = r[1] || [], now = U.now();
        var oldest = sigs.length ? sigs[sigs.length - 1].blockTime : null;
        var newest = sigs.length ? sigs[0].blockTime : null;
        return { balance: r[0], balanceUnit: 'SOL', txCount: sigs.length >= 1000 ? 1000 : sigs.length, txPlus: sigs.length >= 1000,
          ageMs: oldest ? now - oldest * 1000 : null, ageIsMin: sigs.length >= 1000, lastAt: newest ? newest * 1000 : null,
          last24h: sigs.filter(function (x) { return x.blockTime && now - x.blockTime * 1000 < TL.DAY; }).length };
      });
    }
    return Promise.all([
      U.timeoutFetch(C.blockscout + '/addresses/' + addr + '/counters', 9000).catch(function () { return null; }),
      U.timeoutFetch(C.blockscout + '/addresses/' + addr, 9000).catch(function () { return null; })
    ]).then(function (r) {
      var c = r[0] || {}, a = r[1] || {};
      return { balance: U.num(a.coin_balance) != null ? U.num(a.coin_balance) / 1e18 : null, balanceUnit: 'ETH',
        txCount: U.num(c.transactions_count), transfers: U.num(c.token_transfers_count), contract: !!a.is_contract,
        name: a.ens_domain_name || a.name || null, ageMs: null, lastAt: null };
    });
  };
  // ---------- the wallet's own record: its other recent tokens, read from the chain ----------
  // "Smart" means profitable in general, not lucky once. With the GMGN source connected a wallet's 30-day record answers that.
  // Without it this table used to rank wallets by this one token alone, and wallets up here and down everywhere else took
  // the top rows. So the chain is asked about the leading wallets' other tokens: an even sample of the wallet's last
  // transactions names the tokens it traded lately (and its token account for each), the history of each token account
  // gives every buy and sell of that position, an open position is priced through Jupiter. Out comes a small but complete
  // record: N recent tokens, won / lost, net result in SOL. It is a sample of the wallet's trading, and the table says so.
  var REC = { batch: 8, max: 16, enough: 5, sample: 16, tokens: 5, perToken: 12, sigLimit: 40, minTokens: 3, minQuote: 0.005 };
  X.REC = REC;
  // one transaction of a wallet on any token: what the wallet paid or received in SOL (native, wrapped, or stables at $1)
  // and which token moved in its own accounts. Fees and tips stay in the number: they are part of the result.
  function parseAnyTx(tx, who) {
    if (!tx || !tx.meta || tx.meta.err || !tx.transaction || !tx.transaction.message) return null;
    var keys = tx.transaction.message.accountKeys || [], idx = -1, signer = false;
    for (var i = 0; i < keys.length; i++) { var pk = keys[i].pubkey || keys[i]; if (pk === who) { idx = i; signer = !!keys[i].signer || i === 0; break; } } // v1.95: the fee payer (the first key) always signs, whatever a node's answer says about the flags
    var ts = (tx.blockTime || 0) * 1000;
    if (idx < 0 || !signer) return { kind: 'other', ts: ts };   // something it received (an airdrop, a transfer): not its trade
    var solUsd = S.solUsd || store.solUsd || 100;
    var tb = {};
    var take = function (b, post) {
      if (b.owner !== who || !b.uiTokenAmount) return;
      var e = tb[b.accountIndex] = tb[b.accountIndex] || { mint: b.mint, pre: 0, post: 0, dec: b.uiTokenAmount.decimals || 0, acct: keys[b.accountIndex] ? (keys[b.accountIndex].pubkey || keys[b.accountIndex]) : null };
      e[post ? 'post' : 'pre'] = Number(b.uiTokenAmount.amount) || 0;
    };
    (tx.meta.preTokenBalances || []).forEach(function (b) { take(b, false); }); (tx.meta.postTokenBalances || []).forEach(function (b) { take(b, true); });
    var pre = (tx.meta.preBalances || [])[idx], post = (tx.meta.postBalances || [])[idx];
    if (!U.isNum(pre) || !U.isNum(post)) return { kind: 'other', ts: ts };
    var sol = (post - pre) / 1e9, got = null, gave = null;
    Object.keys(tb).forEach(function (k) {
      var e = tb[k]; var d = (e.post - e.pre) / Math.pow(10, e.dec); var q = QUOTE[e.mint];
      if (q) { sol += q.usd ? d * q.usd / solUsd : d; return; }
      var held = e.post / Math.pow(10, e.dec);
      if (d > 0 && (!got || d > got.amount)) got = { mint: e.mint, amount: d, acct: e.acct, held: held };
      else if (d < 0 && (!gave || -d > gave.amount)) gave = { mint: e.mint, amount: -d, acct: e.acct, held: held };
    });
    if (got && sol <= -REC.minQuote) return { kind: 'buy', mint: got.mint, acct: got.acct, quote: -sol, tokens: got.amount, held: got.held, ts: ts };
    if (gave && sol >= REC.minQuote) return { kind: 'sell', mint: gave.mint, acct: gave.acct, quote: sol, tokens: gave.amount, held: gave.held, ts: ts };
    if (got || gave) { var m = got || gave; return { kind: 'transfer', mint: m.mint, acct: m.acct, held: m.held, ts: ts }; } // moved without money: rent, dust, a transfer
    return { kind: 'other', ts: ts };
  }
  // one position of the wallet: every transaction of its token account for that mint, so buys and sells are complete
  function readPosition(who, tk) {
    return solRpc('getSignaturesForAddress', [tk.acct, { limit: REC.sigLimit }]).then(function (r) {
      var sigs = (r || []).filter(function (s) { return !s.err; });
      if (!sigs.length) return null;
      var pos = { mint: tk.mint, acct: tk.acct, spent: 0, got: 0, buys: 0, sells: 0, held: 0, heldAt: 0, first: null, last: null, txs: sigs.length, partial: sigs.length > REC.perToken };
      if (pos.partial) return pos; // a position with more trades than this reads: judged by nobody rather than by half of it
      return pool(sigs, 4, function (s) { return solTx(s.signature); }).then(function (txs) {
        txs.filter(Boolean).forEach(function (tx) {
          var p = parseAnyTx(tx, who); if (!p || p.mint !== tk.mint) return;
          if (p.kind === 'buy') { pos.spent += p.quote; pos.buys++; } else if (p.kind === 'sell') { pos.got += p.quote; pos.sells++; }
          if (p.ts >= pos.heldAt) { pos.heldAt = p.ts; pos.held = p.held || 0; }
          if (pos.first == null || p.ts < pos.first) pos.first = p.ts; if (pos.last == null || p.ts > pos.last) pos.last = p.ts;
        });
        return pos;
      });
    }).catch(function () { return null; });
  }
  // the wallet's recent tokens: an even sample of its last transactions, then the full history of each position found
  function readRecord(who, skipMint, sigs) {
    var sigsP = sigs ? Promise.resolve(sigs) : solRpc('getSignaturesForAddress', [who, { limit: 1000 }]).then(function (r) { return (r || []).filter(function (s) { return !s.err; }); }).catch(function () { return []; });
    return sigsP.then(function (all) {
      var sample = spreadOf(all, REC.sample);
      return pool(sample, 4, function (s) { return solTx(s.signature); }).then(function (txs) {
        var seen = {}, tokens = [];
        txs.filter(Boolean).forEach(function (tx) {
          var p = parseAnyTx(tx, who); if (!p || !p.mint || !p.acct || p.mint === skipMint || seen[p.mint]) return;
          seen[p.mint] = 1; tokens.push({ mint: p.mint, acct: p.acct, ts: p.ts });
        });
        tokens.sort(function (a, b) { return b.ts - a.ts; }); tokens = tokens.slice(0, REC.tokens);
        return pool(tokens, 3, function (tk) { return readPosition(who, tk); }).then(function (positions) {
          return { positions: positions.filter(Boolean), sigs: all.length, sampled: txs.filter(Boolean).length, tokensSeen: Object.keys(seen).length };
        });
      });
    });
  }
  // open positions are priced in one Jupiter call for the whole batch; a token Jupiter does not price counts at zero and is said so
  function pricePositions(positions) {
    var open = positions.filter(function (p) { return p && !p.partial && p.held > 0; });
    var mints = []; open.forEach(function (p) { if (mints.indexOf(p.mint) < 0) mints.push(p.mint); });
    if (!mints.length) return Promise.resolve();
    var solUsd = S.solUsd || store.solUsd || null, chunks = [];
    for (var i = 0; i < mints.length; i += 50) chunks.push(mints.slice(i, i + 50));
    return Promise.all(chunks.map(function (c) { return U.timeoutFetch(C.jup + '/price/v3?ids=' + c.join(','), 8000).catch(function () { return null; }); })).then(function (res) {
      var price = {}; res.forEach(function (r) { if (r) Object.keys(r).forEach(function (m) { var p = r[m] && U.num(r[m].usdPrice); if (p && solUsd) price[m] = p / solUsd; }); });
      open.forEach(function (p) { if (U.isNum(price[p.mint])) { p.priceQuote = price[p.mint]; p.heldValue = p.held * p.priceQuote; } else { p.heldValue = 0; p.unpriced = true; } });
    });
  }
  function summarize(read) {
    var judged = read.positions.filter(function (p) { return !p.partial && p.spent >= REC.minQuote; }); // a position it paid for; airdrops it only sold teach nothing
    var r = { src: 'chain', judged: judged.length, wins: 0, losses: 0, net: 0, spent: 0, got: 0, open: 0, unpriced: 0, skipped: read.positions.filter(function (p) { return p.partial; }).length,
      tokensSeen: read.tokensSeen, sampled: read.sampled, sigs: read.sigs, sigsPlus: read.sigs >= 1000, from: null, to: null, positions: judged };
    judged.forEach(function (p) {
      var v = p.heldValue || 0; if (p.held > 0 && p.unpriced) r.unpriced++;
      p.pnl = p.got + v - p.spent; r.net += p.pnl; r.spent += p.spent; r.got += p.got; r.open += v;
      if (p.pnl > 0) r.wins++; else if (p.pnl < 0) r.losses++;
      if (p.first != null && (r.from == null || p.first < r.from)) r.from = p.first; if (p.last != null && (r.to == null || p.last > r.to)) r.to = p.last;
    });
    r.roi = r.spent > 0 ? r.net / r.spent : null;
    var bar = Math.max(0.05, r.spent * 0.03); // within 3% of what went in is a wash, not a verdict
    r.verdict = r.judged < REC.minTokens ? 'unclear' : r.net > bar ? 'up' : r.net < -bar ? 'down' : 'flat';
    return r;
  }
  X.recordWords = function (r) { // one line for a row, a bot message, a tooltip
    if (!r) return '';
    if (r.verdict === 'unclear') return r.judged ? 'only ' + r.judged + ' other token' + (r.judged === 1 ? '' : 's') + ' readable' : (r.skipped ? 'its other positions are too busy to read' : 'no other token bought in its recent transactions');
    var sol = (r.net >= 0 ? '+' : '−') + Math.abs(r.net).toFixed(Math.abs(r.net) >= 10 ? 1 : 2) + ' SOL';
    return sol + ' on its last ' + r.judged + ' other tokens (' + r.wins + ' won, ' + r.losses + ' lost' + (r.unpriced ? ', ' + r.unpriced + ' open and unpriced' : '') + ')';
  };
  // the leading wallets of a report get their record, best candidates first, in batches, until enough of them prove up overall
  X.records = function (rep, progress) {
    if (!rep || rep.chain !== 'solana' || rep.demo || rep._recBusy) return Promise.resolve(rep);
    rep._recBusy = true;
    var devOrInsider = function (w) { return (w.tags || []).some(function (t) { return t.k === 'Dev' || t.k.indexOf('Insider') === 0; }); };
    var real = rep.list.filter(function (w) { return !w.passive && !w.noBuy && !w.micro && !w.record; });
    var sc = function (w) { var x = X.traderScore(rep, w); return x ? x.value : -1; };
    var byScore = function (a, b) { return sc(b) - sc(a) || b.pnl - a.pnl; };
    var winners = real.filter(function (w) { return w.pnl > 0 && !w.bundle && !devOrInsider(w); }).sort(byScore);
    var queue = winners.concat(real.filter(function (w) { return winners.indexOf(w) < 0; }).sort(byScore)).slice(0, REC.max);
    if (!queue.length) { rep.recState = 'done'; rep._recBusy = false; rep.recRead = rep.recRead || 0; return Promise.resolve(rep); }
    rep.recState = 'reading'; rep.recRead = rep.recRead || 0; rep.recUp = rep.recUp || 0; rep.recDown = rep.recDown || 0;
    var done = 0, total = Math.min(queue.length, REC.batch);
    var say = function () { if (progress) progress('Reading the record of the top wallets on their other tokens: ' + done + ' / ' + total, done / Math.max(1, total)); };
    var batch = function (from) {
      if (from >= queue.length || (X.report && X.report !== rep)) return Promise.resolve(); // nothing left, or the page moved on to another token
      if (from > 0 && rep.recUp >= REC.enough) return Promise.resolve(); // enough proven wallets to fill the top of the table
      var slice = queue.slice(from, from + REC.batch); total = from + slice.length; say();
      var reads = [];
      return pool(slice, 2, function (w) {
        return readRecord(w.addr, rep.address, w.sigs || null).then(function (read) { reads.push({ w: w, read: read }); }, function () {});
      }, function () { done++; say(); }).then(function () {
        var all = []; reads.forEach(function (x) { all = all.concat(x.read.positions); });
        return pricePositions(all).then(function () {
          reads.forEach(function (x) { x.w.record = summarize(x.read); x.w._sc = undefined; rep.recRead++; if (x.w.record.verdict === 'up') rep.recUp++; else if (x.w.record.verdict === 'down') rep.recDown++; });
          try { console.info('[chameleon] wallet records', reads.map(function (x) { return short(x.w.addr) + ': ' + x.w.record.verdict + ' (' + X.recordWords(x.w.record) + ')'; })); } catch (e) {}
          return batch(from + slice.length);
        });
      });
    };
    var wrap = function () { rep.list.forEach(function (w) { w._sc = undefined; }); rep.recState = 'done'; rep._recBusy = false; tagAll(rep); return rep; };
    return batch(0).then(wrap, wrap);
  };
  X.parseAnyTx = parseAnyTx; X.solRpc = solRpc; X.solTx = solTx; // a wallet tracker on a server can read a wallet's new transactions with the same parser
  // ---------- the recent past of a token met late: its last trades, read where they are, and the highest cap among them ----------
  // v1.33: a call is a bet on what comes next, and a token this browser met at $18.5K may have done $140K an hour ago (SUPER).
  // The window changes cannot show a peak inside the window, so before a token we did not watch from its first minutes is
  // called, its last N trades are read from the curve or the pool and the highest price among them names the recent peak.
  X.recentPeak = function (t, n) {
    n = n || 60;
    if (!t || t.demo || t.partial) return Promise.resolve(null);
    var solUsd = S.solUsd || store.solUsd || null;
    if (t.chain === 'robinhood') { // the Pons source keeps the last hour of curve or pool trades on the token itself
      var pts = (t.series && !t.seriesLive ? t.series : []).filter(function (x) { return U.isNum(x.c) && x.c > 0; });
      if (!pts.length) return Promise.resolve(null);
      var top = pts.reduce(function (m, x) { return x.c > m.c ? x : m; }, pts[0]);
      return Promise.resolve({ peakMc: top.c * 1e9, peakAt: top.t, trades: pts.length, from: pts[0].t, to: pts[pts.length - 1].t, venue: t.seriesSrc || 'trades' });
    }
    if (t.chain !== 'solana' || !solUsd) return Promise.resolve(null);
    var mint = t.address, graduated = TL.graduatedLike(t);
    // on the curve every pump.fun buy and sell names the mint itself, so the mint's own list is the trade list; after
    // graduation the swaps live at the pool (DexScreener names it), and the mint's list would only show transfers
    return Promise.resolve(null).then(function (curve) {
      return (graduated ? findPools(t, mint, curve) : Promise.resolve([])).then(function (pools) {
        var venues = pools.length ? pools.map(function (p) { return p.address; }) : [mint];
        return Promise.all(venues.map(function (v) { return solRpc('getSignaturesForAddress', [v, { limit: n }]).catch(function () { return []; }); })).then(function (lists) {
          var sigs = [], seen = {};
          lists.forEach(function (l) { (l || []).forEach(function (sg) { if (!sg.err && !seen[sg.signature]) { seen[sg.signature] = 1; sigs.push(sg); } }); });
          sigs.sort(function (a, b) { return (b.blockTime || 0) - (a.blockTime || 0); }); sigs = sigs.slice(0, n);
          if (!sigs.length) return null;
          return pool(sigs, PAR, function (sg) { return solTx(sg.signature); }).then(function (txs) {
            var scratch = { bal: {} }, best = null, count = 0, from = null, to = null;
            txs.filter(Boolean).forEach(function (tx) {
              var tr = parseSolTx(tx, mint, scratch); if (!tr || (tr.side !== 'buy' && tr.side !== 'sell') || !(tr.tokens > 0) || !(tr.quote > 0)) return;
              var mc = tr.quote / tr.tokens * 1e9 * solUsd; count++;
              if (mc > 1e12) return; // dust trades with a rounding price are not a peak
              if (!best || mc > best.mc) best = { mc: mc, at: tr.ts };
              if (from === null || tr.ts < from) from = tr.ts; if (to === null || tr.ts > to) to = tr.ts;
            });
            return best ? { peakMc: best.mc, peakAt: best.at, trades: count, from: from, to: to, venue: pools.length ? 'pool' : 'curve' } : null;
          });
        });
      });
    });
  };
  // the record of one wallet on its own: the wallet page uses it where the GMGN source is not connected
  X.walletRecord = function (addr) {
    return readRecord(addr, null, null).then(function (read) { return pricePositions(read.positions).then(function () { return summarize(read); }); });
  };
  // ---------- shared: aggregate trades into wallets, rank, tag ----------
  function aggregate(rep, skipFn) {
    rep.trades.sort(function (a, b) { return a.slot - b.slot || a.ts - b.ts; });
    var buyRank = 0;
    rep.trades.forEach(function (tr) {
      if (skipFn(tr.wallet)) return;
      var w = wallet(rep.wallets, tr.wallet);
      if (tr.side === 'buy') { w.buys++; w.inQuote += tr.quote; w.tokIn += tr.tokens; if (w.firstBuy == null) { w.firstBuy = tr.ts; w.buyRank = ++buyRank; w.firstSlot = tr.slot; } }
      else if (tr.side === 'sell') { w.sells++; w.outQuote += tr.quote; w.tokOut += tr.tokens; w.lastSell = tr.ts; }
      else if (tr.side === 'transferIn') { w.transfersIn = (w.transfersIn || 0) + 1; w.tokIn += tr.tokens; w.tokReceived = (w.tokReceived || 0) + tr.tokens; }
      else if (tr.side === 'transferOut') { w.transfersOut = (w.transfersOut || 0) + 1; w.tokOut += tr.tokens; }
      w.lastAt = tr.ts; w.tradeCount = (w.tradeCount || 0) + (tr.side === 'buy' || tr.side === 'sell' ? 1 : 0);
    });
    rep.buyers = buyRank;
    Object.keys(rep.wallets).forEach(function (a) { var w = rep.wallets[a]; if (w.holds === 0 && (w.tokIn || w.tokOut)) w.holds = Math.max(0, w.tokIn - w.tokOut); });
  }
  function finish(rep) {
    var price = rep.priceQuote;
    var list = Object.keys(rep.wallets).map(function (a) {
      var w = rep.wallets[a];
      w.holdValue = U.isNum(price) ? w.holds * price : null;
      w.pnl = (w.outQuote + (w.holdValue || 0)) - w.inQuote;
      if (Math.abs(w.pnl) < 1e-9) w.pnl = 0;
      w.roi = w.inQuote > 0 ? w.pnl / w.inQuote : null;
      w.share = w.holds / rep.supply;
      var boughtTok = w.tokIn - (w.tokReceived || 0);
      w.avgIn = w.buys && boughtTok > 0 ? w.inQuote / boughtTok : null;
      w.avgOut = w.sells && w.tokOut > 0 ? w.outQuote / w.tokOut : null;
      w.xNow = w.avgIn && U.isNum(price) ? price / w.avgIn : null;
      w.unseenExit = !!(((rep.holderSrc && !rep.holderPartial) || w.holdsSrc === 'chain') && w.buys > 0 && !w.sells && (w.holds || 0) <= 0) || !!w.exitUnseen;
      w.partlyOut = !!(w.exitUnseen && w.holds > 0);                               // sold part of it outside the trades read, still holds the rest
      w.pnlFloor = w.partlyOut && U.isNum(w.holdValue) ? w.holdValue - w.inQuote : null; // what it is up by even if those unseen sales brought in nothing
      var soldShare = w.tokIn > 0 ? Math.min(1, w.tokOut / w.tokIn) : 0;
      w.costSold = w.inQuote * soldShare;                 // what the sold tokens cost
      w.realized = w.outQuote - w.costSold;               // money actually taken back out
      w.paper = (w.holdValue || 0) - (w.inQuote - w.costSold); // profit that only exists while the position is open
      var q = rep.quoteUsd || null;
      w.usdIn = q && U.isNum(w.inQuote) ? w.inQuote * q : null;
      w.usdOut = q && U.isNum(w.outQuote) ? w.outQuote * q : null;
      w.usdPnl = q && U.isNum(w.pnl) ? w.pnl * q : null;
      w.usdHold = q && U.isNum(w.holdValue) ? w.holdValue * q : null;
      w.turnover = Math.max(w.usdIn || 0, w.usdOut || 0, w.usdHold || 0);
      w.usdRealized = q && U.isNum(w.realized) ? w.realized * q : null;
      w.usdPaper = q && U.isNum(w.paper) ? w.paper * q : null;
      w.noBuy = !(w.buys > 0) || !(w.inQuote > 0);            // it never bought: the tokens arrived by airdrop, transfer or a bundle
      w.micro = !w.noBuy && q ? w.turnover < X.MIN_TRADE_USD : false;
      return w;
    });
    list.sort(function (a, b) { return b.pnl - a.pnl; });
    rep.list = list;
    var t = rep.token;
    rep.launchAt = t && U.isNum(t.createdAt) ? t.createdAt : (rep.firstSeen || null);
    // bundle: several wallets whose first buy landed in the launch block or the next one
    if (rep.firstSlot != null && rep.sawStart) {
      var early = list.filter(function (w) { return w.firstSlot != null && w.firstSlot - rep.firstSlot <= (rep.chain === 'solana' ? 1 : 3); });
      if (early.length >= 3) { early.forEach(function (w) { w.bundle = early.length; }); rep.bundleSize = early.length; rep.bundleShare = early.reduce(function (s2, w) { return s2 + w.share; }, 0); }
    }
    var traders = list.filter(function (w) { return !w.passive; });
    var holdersReal = t && U.isNum(t.holders) ? t.holders : null;
    var listTop10 = null;
    if (rep.holderSrc && !rep.holderPartial) {
      var byHold = list.slice().sort(function (a, b) { return b.holds - a.holds; }).slice(0, 10);
      listTop10 = byHold.reduce(function (s2, w) { return s2 + (w.share || 0); }, 0);
    }
    rep.stats = {
      wallets: traders.length,
      inProfit: traders.filter(function (w) { return w.pnl > 0; }).length,
      tookProfit: traders.filter(function (w) { return w.outQuote >= w.inQuote && w.inQuote > 0; }).length,
      top10Share: U.isNum(t && t.top10) ? t.top10 : listTop10,   // the token's audited share first, the holder list second, null when neither is read
      top10Src: U.isNum(t && t.top10) ? (t.top10Src || 'token record') : (listTop10 !== null ? 'holder list' : null),
      holdersReal: holdersReal,
      snipers: list.filter(function (w) { return w.firstBuy != null && rep.launchAt && w.firstBuy - rep.launchAt <= 3000; }).length,
      volumeQuote: rep.trades.reduce(function (s2, tr) { return s2 + tr.quote; }, 0),
      stillIn: rep.holderSrc && !rep.holderPartial ? traders.filter(function (w) { return w.holds > 0; }).length : null,
      pnlTotal: traders.reduce(function (s2, w) { return s2 + w.pnl; }, 0)
    };
  }
  // ---------- how good is this trader, from the chain alone ----------
  // Same question Smart Tracking asks of a wallet's 30-day record, answered from what a single token can show:
  // money made, return on what went in, the size of that size, how early the wallet was, and what the wallet itself
  // looks like (balance, age, activity). Patterns that make a record impossible to copy are counted down.
  X.MIN_TRADE_USD = 100;
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function logScale(v, lo, hi) { if (!(v > lo)) return 0; return clamp01(Math.log(v / lo) / Math.log(hi / lo)); }
  function standing(w) { // the wallet behind the trade: a funded, aged, active address beats an empty new one
    var r = w.rep; if (!r) return 0.45;
    var bal = U.isNum(r.balance) ? (r.balanceUnit === 'ETH' ? logScale(r.balance, 0.1, 20) : logScale(r.balance, 1, 200)) : 0.4;
    var age = U.isNum(r.ageMs) ? clamp01(r.ageMs / (180 * TL.DAY)) : 0.4;
    var acts = U.isNum(r.txCount) ? logScale(r.txCount, 20, 2000) : 0.4;
    return 0.45 * bal + 0.3 * age + 0.25 * acts;
  }
  // how much of this position could actually leave the pool: a bag worth a tenth of the liquidity moves the price against itself
  X.exitRisk = function (rep, w) {
    var t = rep.token || {}, liq = U.isNum(t.liq) && t.liq > 0 ? t.liq : null;
    var hold = U.isNum(w.usdHold) ? w.usdHold : null;
    if (liq === null || hold === null || hold <= 0) return null;
    var share = hold / liq;
    return { share: share, hard: share >= 0.1 };
  };
  X.traderScore = function (rep, w) {
    if (w.passive || w.noBuy || !U.isNum(w.usdIn)) return null;
    var er = X.exitRisk(rep, w);
    var paper = U.isNum(w.usdPaper) ? Math.max(0, w.usdPaper) : 0;
    var realizable = er ? paper * Math.max(0.15, 1 - Math.min(1, er.share * 3)) : paper; // a bag bigger than a third of the pool is mostly unsellable
    var counted = (U.isNum(w.usdRealized) ? w.usdRealized : 0) + realizable * 0.35;      // money out counts in full, open profit at a third
    // early is measured on the token's own clock, not on the sample's: a wallet that bought in the first minutes of a
    // three-day-old coin is early, the sixth buyer in a sample that skipped two days of trading is not
    var lifeMs = rep.launchAt ? Math.max(1, U.now() - rep.launchAt) : null;
    var earlyRaw = rep.launchAt && w.firstBuy != null ? 1 - clamp01((w.firstBuy - rep.launchAt) / Math.min(lifeMs, 6 * TL.HR)) : (w.buyRank ? clamp01(1 - (w.buyRank - 1) / 60) : 0.3);
    // v1.31: the wallet's record on its other recent tokens (read from the chain, see X.records) is the biggest single term:
    // a wallet up on this coin and down on the five before it is not the trader to follow. Unread stays neutral.
    var rec = w.record, recRaw = 0.45;
    if (rec && rec.verdict === 'up') recRaw = 0.6 + 0.4 * clamp01((rec.roi || 0) / 0.5);
    else if (rec && rec.verdict === 'down') recRaw = 0.2 * (1 - clamp01(-(rec.roi || 0) / 0.5));
    else if (rec && rec.verdict === 'flat') recRaw = 0.45;
    else if (rec) recRaw = 0.4;
    var raw = {
      profit: logScale(counted, 50, 50000),
      roi: logScale(1 + Math.max(0, w.roi === null || w.roi === undefined ? 0 : w.roi), 1.02, 30), // a 2x reads 0.2, a 10x 0.68, a 30x and beyond 1
      size: logScale(w.usdIn, 100, 20000),
      early: earlyRaw,
      standing: standing(w),
      record: recRaw
    };
    var W = { profit: 0.22, roi: 0.18, size: 0.12, early: 0.14, standing: 0.12, record: 0.22 };
    var total = 0; Object.keys(W).forEach(function (k) { total += W[k] * raw[k]; });
    var mult = 1, notes = [], has = function (k) { return w.tags && w.tags.some(function (t) { return t.k === k || t.k.indexOf(k) === 0; }); };
    if (rec && rec.verdict === 'down') { mult *= 0.45; notes.push('down on its other recent tokens: ' + X.recordWords(rec)); }
    else if (rec && rec.verdict === 'up') { mult *= 1.1; notes.push('up on its other recent tokens: ' + X.recordWords(rec)); }
    else if (rec) notes.push('record on other tokens ' + (rec.verdict === 'flat' ? 'flat' : 'unclear') + ': ' + X.recordWords(rec));
    if (has('Dev')) { mult *= 0.3; notes.push('the dev of this token'); }
    if (w.bundle) { mult *= 0.4; notes.push('part of a launch bundle'); }
    if (has('Sniper')) { mult *= 0.75; notes.push('sniped the launch: speed, not a read'); }
    if (has('Bot-like activity')) { mult *= 0.8; notes.push('bot-speed wallet'); }
    if (has('Fresh wallet')) { mult *= 0.8; notes.push('brand new wallet'); }
    if (w.tokReceived && w.tokReceived > 0) { mult *= 0.6; notes.push('part of its tokens arrived by transfer'); }
    if (has('Veteran wallet')) { mult *= 1.05; notes.push('wallet older than six months'); }
    if (er && er.hard) { mult *= 0.75; notes.push('its bag is ' + Math.round(er.share * 100) + '% of the pool: that profit cannot be sold at this price'); }
    var value = Math.max(0, Math.min(100, Math.round(total * mult * 100)));
    return { value: value, raw: raw, mult: mult, notes: notes, src: 'chain' };
  };
  // the score shown in the table: a wallet's own GMGN record when we could read it, otherwise this token's reading
  X.scoreOf = function (rep, w) {
    if (w.gmgnScore) return { value: w.gmgnScore.value, src: 'gmgn', gate: w.gmgnGate, notes: w.gmgnScore.notes, grade: w.gmgnScore.grade };
    if (w._sc === undefined) w._sc = X.traderScore(rep, w);
    return w._sc;
  };
  function tagAll(rep) {
    var dev = rep.token && rep.token.dev && rep.token.dev.address ? String(rep.token.dev.address).toLowerCase() : null;
    rep.list.forEach(function (w) {
      var tags = [];
      var la = w.addr.toLowerCase();
      var isDev = dev && la === dev;
      if (isDev) tags.push({ k: 'Dev', c: 'warn' });
      if (w.firstBuy != null && rep.launchAt && w.firstBuy - rep.launchAt <= 3000) tags.push({ k: 'Sniper', c: 'bad' });
      else if (w.firstBuy != null && rep.launchAt && (w.firstBuy - rep.launchAt <= 5 * TL.MIN || (w.buyRank && w.buyRank <= 10 && w.firstBuy - rep.launchAt <= 30 * TL.MIN))) tags.push({ k: 'Early', c: 'good' });
      else if (w.buyRank && w.buyRank <= 10 && !rep.launchAt) tags.push({ k: 'Early', c: 'good' });
      if (w.bundle) tags.push({ k: 'Bundle of ' + w.bundle, c: 'bad' });
      if (w.share >= 0.01) tags.push({ k: 'Top holder ' + (w.share * 100).toFixed(1) + '%', c: '' });
      if (w.tokReceived && w.tokReceived >= (w.tokIn || 1) * 0.5) tags.push({ k: w.sells ? 'Insider: got tokens, sold' : 'Received tokens', c: w.sells ? 'bad' : 'warn' });
      if (w.buys && !w.sells && w.holds >= w.tokIn * 0.9) tags.push({ k: 'Diamond hands', c: 'good' });
      if (w.inQuote > 0 && w.outQuote >= w.inQuote && w.holds > 0) tags.push({ k: 'Took profit, still in', c: 'good' });
      if (w.inQuote > 0 && w.holds <= w.tokIn * 0.02 && w.sells) tags.push({ k: w.pnl > 0 ? 'Cashed out' : 'Sold at a loss', c: w.pnl > 0 ? '' : 'bad' });
      if (w.passive) tags.push({ k: w.contract ? 'Contract' : 'Holder, no trades in sample', c: '' });
      var r = w.rep;
      if (r) {
        if (U.isNum(r.balance) && ((r.balanceUnit === 'SOL' && r.balance >= 100) || (r.balanceUnit === 'ETH' && r.balance >= 10))) tags.push({ k: 'Whale', c: 'smart' });
        if (U.isNum(r.ageMs) && r.ageMs >= 180 * TL.DAY) tags.push({ k: 'Veteran wallet', c: 'good' });
        if (U.isNum(r.ageMs) && r.ageMs < 3 * TL.DAY && !r.ageIsMin) tags.push({ k: 'Fresh wallet', c: 'warn' });
        if (U.isNum(r.last24h) && r.last24h >= 300) tags.push({ k: 'Bot-like activity', c: 'warn' });
        if (r.contract) tags.push({ k: 'Contract', c: '' });
      }
      var early = tags.some(function (x) { return x.k === 'Early' || x.k === 'Sniper'; });
      var seasoned = r && ((U.isNum(r.ageMs) && r.ageMs >= 90 * TL.DAY) || (U.isNum(r.txCount) && r.txCount >= 500));
      var rec = w.record, recDown = !!(rec && rec.verdict === 'down'), recUp = !!(rec && rec.verdict === 'up');
      var clean = !isDev && !w.bundle && !recDown && !tags.some(function (x) { return BAD_TAGS[x.k]; });
      if (recDown) tags.unshift({ k: 'Down overall', c: 'bad', t: X.recordWords(rec) });
      if (w.pnl > 0 && early && seasoned && clean) tags.unshift({ k: 'Smart-looking', c: 'smart' });
      else if (w.pnl > 0 && w.roi != null && w.roi >= 1 && clean) tags.unshift({ k: 'Strong on this token', c: 'smart' });
      if (recUp && !isDev && !w.bundle) tags.unshift({ k: 'Up overall', c: 'smart', t: X.recordWords(rec) }); // first: the one thing the table is for
      w.tags = tags;
    });
  }

  // ---------- UI ----------
  function usd(rep, v) { return U.isNum(v) && rep.quoteUsd ? U.fmtUsd(v * rep.quoteUsd) : '–'; }
  function qty(rep, v) { if (!U.isNum(v)) return '–'; return v.toFixed(v >= 100 ? 1 : v >= 1 ? 2 : 4) + ' ' + U.esc(rep.quote); }
  function tokens(v) { if (!U.isNum(v)) return '–'; if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return v.toFixed(v >= 1 ? 0 : 3); }
  function priceUsd(rep, pq) { return U.isNum(pq) && rep.quoteUsd ? U.fmtPrice(pq * rep.quoteUsd) : '–'; }
  function when(ts) { if (!U.isNum(ts) || !ts) return '–'; var d = new Date(ts); var today = new Date().toISOString().slice(0, 10) === d.toISOString().slice(0, 10); return (today ? '' : d.toISOString().slice(5, 10).replace('-', '/') + ' ') + d.toISOString().slice(11, 19) + ' UTC'; }
  // deterministic avatar for a wallet: a symmetric 5x5 identicon coloured from the address hash (GMGN shows avatars, we have no X data)
  function identicon(addr, size) {
    var h = U.hash(addr || '?'); var hue = h % 360; var cells = '';
    for (var y = 0; y < 5; y++) for (var x = 0; x < 3; x++) { if ((h >> (y * 3 + x)) & 1) { cells += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>' + (x < 2 ? '<rect x="' + (4 - x) + '" y="' + y + '" width="1" height="1"/>' : ''); } }
    return '<svg class="idc" width="' + (size || 30) + '" height="' + (size || 30) + '" viewBox="-0.6 -0.6 6.2 6.2" aria-hidden="true" style="--h:' + hue + '"><rect x="-0.6" y="-0.6" width="6.2" height="6.2" rx="1.4" fill="hsl(' + hue + ' 35% 22%)"/><g fill="hsl(' + hue + ' 75% 62%)">' + cells + '</g></svg>';
  }
  function statusOf(w) {
    if (w.passive) return { k: 'Holder', c: '' };
    if (w.partlyOut) return { k: 'Partly out', c: w.pnlFloor > 0 ? 'ok' : 'warn', t: 'holds less than it bought in the trades read: part of its exit is outside the sample' };
    if (w.unseenExit) return { k: 'Left', c: '', t: 'the chain shows nothing left in the wallet, and the sale is outside the trades this page read' };
    var soldOut = w.sells && w.holds <= (w.tokIn || 1) * 0.02;
    if (soldOut) return w.pnl > 0 ? { k: 'Sold out · profit', c: 'ok' } : { k: 'Sold out · loss', c: 'bad' };
    if (w.sells && w.holds > 0) return w.outQuote >= w.inQuote ? { k: 'Free ride', c: 'ok', t: 'took out more than put in, still holds' } : { k: 'Partial sell', c: 'warn' };
    if (w.buys && !w.sells) return { k: 'Holding', c: 'good' };
    return { k: '–', c: '' };
  }
  // "strong" wallet: in profit on this token, not a bundle / sniper / bot / fresh wallet, not the dev; unknown reputation never disqualifies
  var BAD_TAGS = { 'Dev': 1, 'Sniper': 1, 'Bot-like activity': 1, 'Fresh wallet': 1, 'Contract': 1, 'Sold at a loss': 1, 'Insider: got tokens, sold': 1, 'Down overall': 1 };
  X.recordDown = function (w) { return !!(w.record && w.record.verdict === 'down'); }; // proven a net loser on its other recent tokens
  function isStrong(w) {
    if (w.passive) return false;
    if (w.noBuy) return false;   // received the tokens and sold them: not a trade, nothing to learn
    if (w.micro) return false;   // under $100 through the token
    if (!(w.pnl > 0)) return false;
    if (w.bundle) return false;
    if (X.recordDown(w)) return false;
    if (w.tags.some(function (t) { return BAD_TAGS[t.k]; })) return false;
    if (w.rep && U.isNum(w.rep.ageMs) && !w.rep.ageIsMin && w.rep.ageMs < 7 * TL.DAY) return false;
    return true;
  }
  X.showJunk = false;
  // v1.24: the table opens on everyone who really bought, ranked. On a token that already ran, the wallets still in profit
  // are a handful, and "Strong only" used to leave two dull rows where the interesting traders were one click away.
  X.view = (function () { try { var v = localStorage.getItem('tl.xrayView'); return v === 'strong' || v === 'all' ? v : 'winners'; } catch (e) { return 'winners'; } })();
  X.strongOnly = false; // kept for older callers: the view chips replaced the toggle
  function profileUrl(rep, a) { if (!okAddr(a)) return '#'; return TL.gmgnWallet(rep.chain, a); } // v1.66: with the referral code
  function links(rep, w) {
    var a = w.addr;
    if (rep.chain === 'solana') return '<a href="https://pump.fun/profile/' + a + '" target="_blank" rel="noopener" title="pump.fun profile">pump.fun</a><a href="https://solscan.io/account/' + a + '" target="_blank" rel="noopener" title="Solscan">Solscan</a>';
    return '<a href="https://robinhoodchain.blockscout.com/address/' + a + '" target="_blank" rel="noopener" title="Blockscout">Explorer</a>';
  }
  function repHtml(w) {
    var r = w.rep; if (!r) return '<span class="muted">' + (w.passive ? '' : '–') + '</span>';
    var parts = [];
    if (U.isNum(r.balance)) parts.push('<b>' + r.balance.toFixed(r.balance >= 10 ? 1 : 2) + ' ' + r.balanceUnit + '</b>');
    if (U.isNum(r.txCount)) parts.push((r.txPlus ? '1000+' : r.txCount) + ' tx' + (U.isNum(r.last24h) && r.last24h >= 100 ? ', ' + r.last24h + ' today' : ''));
    if (U.isNum(r.ageMs)) parts.push((r.ageIsMin ? '> ' : '') + U.fmtAge(r.ageMs));
    return parts.join(' · ') || '<span class="muted">–</span>';
  }
  function tokenHead(rep) {
    var t = rep.token || {}; var g = rep.chain === 'solana' ? 'sol' : 'robinhood';
    if (rep.token && rep.token.id && !rep.demo) { try { TL.ensureVet(rep.token); } catch (e) {} }
    // v1.41: the feed's own picture pipeline (candidates raced, ticker underneath until one answers), so the card never shows an empty box
    var logo;
    if (t.id && !rep.demo && TL.ui && TL.ui.logoHtml) logo = TL.ui.logoHtml(t, true);
    else { var lsrc = t.logoOk || (t.logo ? TL.imgFast(t.logo) || t.logo : null); logo = lsrc ? '<span class="logo"><img class="ready" src="' + U.esc(lsrc) + '" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML=\'<b>' + U.esc((t.symbol || rep.address).slice(0, 2)) + '</b>\'"></span>' : '<span class="logo" style="--h:' + U.hue(rep.address) + '"><b>' + U.esc((t.symbol || rep.address).slice(0, 2)) + '</b></span>'; }
    var age = U.isNum(t.createdAt) ? '<span data-born="' + t.createdAt + '" data-suffix=" old">' + U.fmtAgeLive(U.now() - t.createdAt) + ' old</span>' : '';
    return '<div class="x-token">' + logo + '<div class="d-title"><span class="sym">' + U.esc(t.symbol || short(rep.address)) + '</span><span class="nm">' + U.esc(t.name || '') + (t.launchpad ? ' · ' + U.esc(t.launchpad) : '') + (age ? ' · ' + age : '') + ' · ' + (rep.chain === 'solana' ? 'Solana' : 'Robinhood Chain') + '</span></div>' +
      '<div class="kv"><div class="item"><span>Market cap</span><b>' + U.fmtUsd(t.mc) + '</b></div><div class="item"><span>Price</span><b>' + (U.isNum(rep.priceQuote) ? priceUsd(rep, rep.priceQuote) : U.fmtPrice(t.price)) + '</b></div><div class="item"><span>Holders</span><b>' + U.fmtNum(t.holders) + '</b></div><div class="item"><span>Stage</span><b>' + U.esc(TL.STAGE_LABEL[t.stage] || (t.complete ? 'Migrated' : 'On curve')) + '</b></div></div>' +
      '<div class="links"><a href="' + (TL.ui && TL.ui.tokenHref ? TL.ui.tokenHref({ chain: rep.chain, address: rep.address }) : '#') + '">Token page</a><a href="' + TL.gmgnToken(rep.chain, rep.address) + '" target="_blank" rel="noopener">GMGN</a>' + (rep.chain === 'solana' ? '<a href="' + TL.axiomToken(rep.chain, rep.address) + '" target="_blank" rel="noopener">Axiom</a>' : '') + (rep.chain === 'solana' ? '<a href="https://pump.fun/coin/' + rep.address + '" target="_blank" rel="noopener">pump.fun</a>' : '<a href="https://www.ponsfamily.com/token/' + rep.address + '" target="_blank" rel="noopener">Pons</a>') + '<a href="' + (rep.chain === 'solana' ? 'https://solscan.io/token/' : 'https://robinhoodchain.blockscout.com/token/') + rep.address + '" target="_blank" rel="noopener">Explorer</a></div></div>';
  }
  // Kept deliberately short: numbers first, one small line under them at most, the address itself opens the GMGN profile.
  X.render = function (rep) {
    var out = $('#xrayOut'); var sortKey = X.sort || 'strength';
    var everyone = rep.list.slice();
    var real = everyone.filter(function (w) { return !w.passive && !w.noBuy && !w.micro; });   // wallets that actually bought this token with real money
    var strong = real.filter(isStrong);
    var skippedNoBuy = everyone.filter(function (w) { return !w.passive && w.noBuy; }).length;
    var skippedMicro = everyone.filter(function (w) { return !w.passive && w.micro; }).length;
    var holdersOnly = everyone.filter(function (w) { return w.passive; }).length;
    // winners: wallets provably up on this token (sold for more than they put in, or holding more than they paid, floor included),
    // and not proven down on their other recent tokens: a lucky loser is not a winner
    var winners = real.filter(function (w) { return w.pnl > 0 && !w.bundle && !X.recordDown(w) && !(w.tags || []).some(function (t) { return t.k === 'Dev' || t.k.indexOf('Insider') === 0; }); });
    var proven = real.filter(function (w) { return w.record && w.record.verdict === 'up'; }).length;
    var relaxed = false, list, view = X.view || 'winners';
    if (X.showJunk) list = everyone.slice();
    else if (view === 'strong') { if (strong.length >= 5 || strong.length === real.length) list = strong; else { list = real.slice(); relaxed = 'strong'; } }
    else if (view === 'winners') { if (winners.length >= 5 || winners.length === real.length) list = winners; else { list = real.slice(); relaxed = 'winners'; } }
    else list = real;
    var strongSet = {}; strong.forEach(function (w) { strongSet[w.addr] = 1; });
    var sc = function (w) { var x = X.scoreOf(rep, w); return x ? x.value : -1; };
    if (sortKey === 'early') list = list.filter(function (w) { return w.firstBuy != null; }).sort(function (a, b) { return a.firstBuy - b.firstBuy; });
    else if (sortKey === 'holding') list.sort(function (a, b) { return b.holds - a.holds; });
    else if (sortKey === 'size') list.sort(function (a, b) { return b.inQuote - a.inQuote; });
    else if (sortKey === 'pnl') list.sort(function (a, b) { return b.pnl - a.pnl; });
    else list.sort(function (a, b) { return sc(b) - sc(a) || b.pnl - a.pnl; });
    list = list.slice(0, 50);
    var st = rep.stats;
    var gmgnRead = real.filter(function (w) { return !!w.gmgnScore; }).length;
    var tiles = '<div class="x-tiles">' +
      '<div class="x-tile" title="Wallets that bought this token with real money in the transactions read. Wallets that only received tokens, and anything under $' + X.MIN_TRADE_USD + ', are left out"><span>Real traders</span><b>' + real.length + '</b><small>' + strong.length + ' strong' + (U.isNum(st.stillIn) ? ' · ' + st.stillIn + ' still hold' : '') + '</small></div>' +
      '<div class="x-tile" title="Sold plus still held is worth more than what went in"><span>In profit</span><b class="' + (st.inProfit ? 'up' : '') + '">' + real.filter(function (w) { return w.pnl > 0; }).length + '<small style="display:inline"> / ' + real.length + '</small></b><small>' + (rep.holderSrc ? 'balances from the chain' : 'from the trades read') + '</small></div>' +
      '<div class="x-tile" title="Bought within 3 seconds of the launch' + (rep.bundleSize ? '; a bundle is several wallets buying in the launch block' : '') + '"><span>Snipers</span><b class="' + (st.snipers || rep.bundleSize ? 'down' : '') + '">' + st.snipers + '</b>' + (rep.bundleSize ? '<small>bundle of ' + rep.bundleSize + ' · ' + U.pct0(rep.bundleShare) + '</small>' : '') + '</div>' +
      '<div class="x-tile" title="' + (st.top10Src ? 'Share of supply held by the ten biggest wallets, from the ' + st.top10Src : 'Not read: this needs the holder list, which did not load') + '"><span>Top 10 hold</span><b class="' + (U.isNum(st.top10Share) && st.top10Share > 0.5 ? 'down' : '') + '">' + (U.isNum(st.top10Share) ? U.pct0(st.top10Share) : '–') + '</b>' + (st.top10Src ? '<small>' + U.esc(st.top10Src) + '</small>' : '<small>not read</small>') + '</div>' +
      (U.isNum(st.holdersReal) ? '<div class="x-tile" title="Addresses that hold the token right now, from the chain"><span>Holders</span><b>' + U.fmtNum(st.holdersReal) + '</b><small>on chain now</small></div>' : '') +
      '<div class="x-tile" title="Buys plus sells in the transactions read, not 24h volume"><span>Volume</span><b>' + usd(rep, st.volumeQuote) + '</b><small>in the trades read</small></div>' +
      (rep.chain === 'solana' && (rep.recState || rep.recRead) ? '<div class="x-tile" title="Leading wallets whose other recent tokens were read on the chain: bought and sold in profit overall, not only here"><span>Up overall</span><b class="' + (proven ? 'up' : '') + '">' + (rep.recRead ? proven : '…') + '</b><small>' + (rep.recState === 'reading' ? 'reading records…' : rep.recRead ? 'of ' + rep.recRead + ' records read' + (rep.recDown ? ' · ' + rep.recDown + ' down' : '') : 'no record read') + '</small></div>' : '') +
      '</div>';
    var tools = '<div class="x-tools"><div class="seg" id="xraySort">' + [['strength', 'Most interesting'], ['pnl', 'Top PnL'], ['size', 'Biggest buyers'], ['early', 'Earliest in'], ['holding', 'Biggest holders']].map(function (p) { return '<button data-sort="' + p[0] + '" aria-pressed="' + (sortKey === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="chips x-view">' + [['winners', 'Winners', winners.length, 'Wallets provably up on this token: sold for more than they put in, or holding more than they paid. Launch, bundle and insider wallets are left out, and so is anyone whose other recent tokens show a net loss'], ['strong', 'Strong', strong.length, 'Winners with a clean record: not a sniper, a bot or a brand-new wallet either'], ['all', 'Everyone', real.length, 'Every wallet that bought this token with real money']].map(function (c) {
        return '<button class="chip" data-xview="' + c[0] + '" aria-pressed="' + (view === c[0] && !X.showJunk) + '" title="' + U.esc(c[3]) + '">' + c[1] + ' <span class="cnt">' + c[2] + '</span></button>'; }).join('') + '</div>' +
      (gmgnRead ? '<span class="muted" style="font-size:12px">GMGN profiles read for ' + gmgnRead + ' wallets</span>' : '') + '</div>';
    var rows = '<div class="x-w head"><span class="c-rank">#</span><span class="c-who">Wallet</span><span class="c-in">Bought</span><span class="c-out">Sold</span><span class="c-hold">Holds</span><span class="c-pnl">PnL</span><span class="c-entry">Entry MC</span><span class="c-status">Status</span><span class="c-rep">Trader score</span><span class="c-links"></span></div>' +
      list.map(function (w, i) {
        var pnlCls = w.pnl > 0.0001 ? 'up' : w.pnl < -0.0001 ? 'down' : '';
        var weak = !strongSet[w.addr] && (w.pnl < 0 || w.unseenExit || w.bundle || (w.tags || []).some(function (t) { return BAD_TAGS[t.k]; }));
        var dimRow = X.showJunk ? false : (view === 'all' || relaxed) && weak;
        var nm = w.name || (w.gmgn && w.gmgn.name) || '';
        var tw = w.twitter || (w.gmgn && w.gmgn.twitter) || '';
        var name = nm ? '<span class="wname">' + U.esc(nm) + '</span>' : '';
        var handle = tw ? '<a class="tw" href="https://x.com/' + encodeURIComponent(tw) + '" target="_blank" rel="noopener">@' + U.esc(tw) + '</a>' : '';
        var entryMc = U.isNum(w.avgIn) && rep.quoteUsd && rep.supply ? w.avgIn * rep.supply * rep.quoteUsd : null;
        // one number only: the market cap this wallet bought at
        var entry = U.isNum(entryMc) ? '<b>' + U.fmtUsd(entryMc) + '</b>' : (U.isNum(w.avgIn) && rep.quoteUsd ? '<b>' + priceUsd(rep, w.avgIn) + '</b>' : '<b>–</b>');
        var stt = statusOf(w);
        var holds = w.holds > 0 ? '<b>' + usd(rep, w.holdValue) + '</b><small>' + (w.share * 100).toFixed(2) + '% of supply</small>' : '<b class="muted">–</b><small>sold out</small>';
        var er = X.exitRisk(rep, w);
        var pnlSub = (function () {
          if (w.passive && !w.inQuote) return '';
          if (w.partlyOut) return '<span class="paper">at least, on what it still holds \u00b7 part of the exit not in the trades read</span>';
          if (w.unseenExit) return '<span class="paper">exit not in the trades read</span>';
          var bits = [];
          var hasReal = Math.abs(w.realized || 0) > 0.0000001, hasPaper = (w.holdValue || 0) > 0;
          if (hasReal && hasPaper) { bits.push('<span class="' + (w.realized > 0 ? 'up' : 'down') + '">' + usd(rep, w.realized) + ' out</span>'); bits.push('<span class="paper">' + usd(rep, w.paper) + ' on paper</span>'); }
          else if (hasPaper) bits.push('<span class="paper">all on paper, still holding</span>');
          else if (hasReal) bits.push('<span class="paper">realized</span>');
          if (w.roi != null) bits.push(U.fmtPct(w.roi * 100, 0));
          return bits.join(' · ');
        })();
        return '<div class="x-w' + (dimRow ? ' dim' : '') + '"><span class="rank c-rank">' + (i + 1) + '</span>' +
          '<span class="who c-who">' + avatarHtml(w, 30) + '<span class="who-txt">' + name + '<a class="addr" href="' + profileUrl(rep, w.addr) + '" target="_blank" rel="noopener" title="' + U.esc(w.addr) + ' · open the GMGN profile">' + short(w.addr) + '</a>' + handle + '<span class="tags">' + w.tags.slice(0, 2).map(function (t) { return '<span class="tag ' + t.c + '"' + (t.t ? ' title="' + U.esc(t.t) + '"' : '') + '>' + U.esc(t.k) + '</span>'; }).join('') + (er && er.hard ? '<span class="tag warn" title="Its holding is ' + Math.round(er.share * 100) + '% of the pool: selling it would move the price against itself">hard to exit</span>' : '') + '</span></span></span>' +
          '<span class="num c-in" title="' + qty(rep, w.inQuote) + '"><b>' + usd(rep, w.inQuote) + '</b><small>' + (w.buys ? w.buys + ' buy' + (w.buys === 1 ? '' : 's') : '') + '</small></span>' +
          '<span class="num c-out" title="' + qty(rep, w.outQuote) + '"><b>' + (w.outQuote > 0 ? usd(rep, w.outQuote) : '–') + '</b><small>' + (w.sells ? w.sells + ' sell' + (w.sells === 1 ? '' : 's') : '') + '</small></span>' +
          '<span class="num c-hold">' + holds + '</span>' +
          '<span class="num c-pnl" title="' + qty(rep, w.pnl) + (er ? ' \u00b7 its bag is ' + Math.round(er.share * 100) + '% of the pool' : '') + '"><b class="pnl ' + (w.partlyOut ? (w.pnlFloor > 0 ? 'up' : '') : w.unseenExit ? '' : pnlCls) + '">' + (w.partlyOut ? (U.isNum(w.pnlFloor) ? '\u2265 ' + usd(rep, w.pnlFloor) : '\u2013') : (w.unseenExit || (w.passive && !w.inQuote) ? '\u2013' : usd(rep, w.pnl))) + '</b><small>' + pnlSub + '</small></span>' +
          '<span class="num c-entry">' + entry + '</span><span class="c-status"><b class="status-pill ' + stt.c + '"' + (stt.t ? ' title="' + stt.t + '"' : '') + '>' + stt.k + '</b></span>' +
          '<span class="rep c-rep">' + scoreHtml(rep, w) + '</span><span class="links c-links">' + links(rep, w) + '</span></div>';
      }).join('');
    var skipTxt = [];
    if (skippedNoBuy) skipTxt.push(skippedNoBuy + ' received tokens without buying');
    if (skippedMicro) skipTxt.push(skippedMicro + ' under $' + X.MIN_TRADE_USD);
    if (holdersOnly) skipTxt.push(holdersOnly + ' holders without a trade in the sample');
    var skipped = skipTxt.length ? '<p class="board-foot">' + (X.showJunk ? 'Showing everything, including ' : 'Left out: ') + skipTxt.join(', ') + '. <button class="btn small" id="xrayJunk">' + (X.showJunk ? 'Hide' : 'Show') + '</button></p>' : '';
    var foot = '<details class="x-how"><summary>How the score works</summary><p class="board-foot">Trader score 0-100: the wallet\'s record on its other recent tokens 22% (read from the chain for the leading wallets: the full buy and sell history of up to five positions it paid for, open ones priced through Jupiter; up overall lifts the score, a net loss elsewhere cuts it to 45% and drops the wallet out of Winners), money made on this token 22% (money actually taken out counts in full, profit still sitting in the position counts at a third and is capped by what the pool could absorb), return on what went in 18% (a 2x reads 0.2, a 10x 0.7, a 30x the full mark), how early in the token\'s life it bought 14%, size of the position 12% and wallet standing 12% (balance, age, activity); the dev counts at 30%, a bundle wallet at 40%, a sniper at 75%, a bot-speed or brand-new wallet at 80%, and a wallet whose tokens partly arrived by transfer at 60%. Where the GMGN source is connected the wallet\'s own 30-day and 7-day record replaces all of it and the avatar, name and X account come from GMGN.' + (gmgnRead ? '' : ' On this copy the GMGN source is not connected, so the pictures are generated from the address and the record is the chain sample.') + '</p></details>';
    var recent = rep.trades.slice(-10).reverse().filter(function (tr) { return tr.side === 'buy' || tr.side === 'sell'; });
    var recentHtml = recent.length ? '<div class="x-recent"><h4>Latest trades</h4>' + recent.map(function (tr) { var w = rep.wallets[tr.wallet]; return '<div class="x-tr"><span class="t">' + when(tr.ts) + '</span><span class="side ' + tr.side + '">' + tr.side.toUpperCase() + '</span><span class="num">' + usd(rep, tr.quote) + '</span><span class="num">' + tokens(tr.tokens) + ' tokens</span><span class="addr">' + (w ? avatarHtml(w, 18) : identicon(tr.wallet, 18)) + '<a href="' + profileUrl(rep, tr.wallet) + '" target="_blank" rel="noopener">' + short(tr.wallet) + '</a>' + (w && w.tags.length ? ' <span class="tag ' + w.tags[0].c + '">' + U.esc(w.tags[0].k) + '</span>' : '') + '</span></div>'; }).join('') + '</div>' : '';
    var notes = rep.notes.length ? '<div class="x-note" style="padding:10px 14px;border:1px dashed var(--line-2);border-radius:var(--radius)">' + rep.notes.map(U.esc).join(' ') + '</div>' : '';
    var sample = (function () {
      if (rep.demo) return '';
      var bits = [];
      if (rep.chain === 'solana') {
        if (U.isNum(rep.curveCount)) bits.push(U.fmtNum(rep.curveCount) + (rep.sawStart ? '' : '+') + ' curve trades' + (rep.sawStart ? ' from the first buy' : ''));
        if (U.isNum(rep.poolCount) && rep.poolCount) bits.push(U.fmtNum(rep.poolCount) + (rep.poolMore ? '+' : '') + ' latest pool swaps' + (function () { var ds = ((rep.venues && rep.venues.pools) || []).map(function (pl) { return U.esc(String(pl.dex || '').slice(0, 24)); }).filter(function (d, i, a) { return d && a.indexOf(d) === i; }); return ds.length ? ' (' + ds.join(', ') + ')' : ''; })());
        if (rep.graduated && !(rep.poolCount > 0)) bits.push('no pool trades reached');
      } else if (U.isNum(rep.curveTrades)) bits.push(U.fmtNum(rep.curveTrades) + ' curve trades');
      var trades = rep.trades.filter(function (tr) { return tr.side === 'buy' || tr.side === 'sell'; }).length;
      var recs = rep.recRead ? ' \u00b7 records of ' + rep.recRead + ' leading wallets read on their other tokens: ' + proven + ' up overall, ' + (rep.recDown || 0) + ' down' : '';
      return '<div class="x-sample">Read ' + U.fmtNum(rep.sampled || rep.trades.length) + ' transactions' + (bits.length ? ': ' + bits.join(', ') : '') + ' \u00b7 ' + U.fmtNum(trades) + ' trades, ' + U.fmtNum(real.length) + ' real buyers' + recs + '</div>';
    })();
    // while the records are being read the table is already there; this line under the tools says what is still coming
    var recLine = rep.recState === 'reading' ? '<div class="x-note x-rec" id="xrayRec">' + U.esc(rep.recMsg || 'Reading the record of the top wallets on their other tokens\u2026') + '</div>' : '';
    var relaxNote = relaxed ? '<div class="x-note">Only ' + (relaxed === 'strong' ? strong.length : winners.length) + ' wallet' + ((relaxed === 'strong' ? strong.length : winners.length) === 1 ? '' : 's') + ' ' + (relaxed === 'strong' ? 'clear the strong bar' : 'in profit') + ': showing every real buyer, best first.</div>' : '';
    var emptyNote = real.length ? '<div class="x-note">None of the ' + real.length + ' real buyers fits this view. <button class="btn small" id="xrayShowAll">Everyone (' + real.length + ')</button></div>'
      : '<div class="x-note">' + (rep.graduated && !(rep.poolCount > 0) ? 'The pool of this token could not be reached (' + U.fmtNum(rep.curveCount || 0) + ' curve transactions only). ' : 'No buyer over $' + X.MIN_TRADE_USD + ' in the transactions read. ') + 'Public nodes and DexScreener rate-limit bursts. <button class="btn small" id="xrayRetry">Try again</button></div>';
    out.innerHTML = tokenHead(rep) + notes + sample + tiles + tools + recLine + relaxNote + '<div class="x-wallets">' + (list.length ? rows : emptyNote) + '</div>' + skipped + recentHtml + foot;
    if (TL.ui && TL.ui.bindLogos) TL.ui.bindLogos(out); // v1.41: the token's picture loads through the feed's pipeline
  };
  function avatarHtml(w, size) { // GMGN's picture when the source is connected, our own pixel face otherwise
    var url = w.avatar || (w.gmgn && w.gmgn.avatar) || '';
    if (TL.smart && TL.smart.avatar) return TL.smart.avatar(w.addr, url, size);
    return identicon(w.addr, size);
  }
  function scoreHtml(rep, w) {
    var sc = X.scoreOf(rep, w), r = w.rep, sub = [];
    if (r) {
      if (U.isNum(r.balance)) sub.push(r.balance.toFixed(r.balance >= 10 ? 1 : 2) + ' ' + r.balanceUnit);
      if (U.isNum(r.txCount)) sub.push((r.txPlus ? '1000+' : r.txCount) + ' tx');
      if (U.isNum(r.ageMs)) sub.push((r.ageIsMin ? '> ' : '') + U.fmtAge(r.ageMs));
    }
    var rec = w.record, recTxt = '';
    if (rec && sc && sc.src !== 'gmgn') recTxt = '<small class="rec ' + (rec.verdict === 'up' ? 'up' : rec.verdict === 'down' ? 'down' : '') + '" title="' + U.esc('The wallet\'s other recent tokens, read from the chain: ' + X.recordWords(rec) + (rec.skipped ? '; ' + rec.skipped + ' busier position' + (rec.skipped === 1 ? '' : 's') + ' not read' : '') + '. A sample of its trading, not a 30-day statement.') + '">' + U.esc('other tokens: ' + X.recordWords(rec)) + '</small>';
    if (!sc) return '<span class="muted">–</span>' + (sub.length ? '<small>' + sub.join(' · ') + '</small>' : '') + recTxt;
    var cls = sc.value >= 78 ? 4 : sc.value >= 62 ? 3 : sc.value >= 45 ? 2 : 1;
    var why = (sc.src === 'gmgn' ? 'From this wallet\'s own GMGN record over 30 days' : 'From this token on-chain') + (sc.notes && sc.notes.length ? ': ' + sc.notes.join(', ') : '');
    return '<span class="bd-score s' + cls + '" title="' + U.esc(why) + '"><b>' + sc.value + '</b><i style="width:' + sc.value + '%"></i></span>' + (sub.length ? '<small>' + sub.join(' · ') + '</small>' : '') + (sc.src === 'gmgn' ? '<small>GMGN 30D record</small>' : recTxt);
  }
  // With the GMGN source connected, every wallet in the table gets its real profile: avatar, name, X account and its own record
  X.enrichGmgn = function (rep) {
    var g = TL.gmgn, SM = TL.smart;
    if (!g || !SM || rep.demo || !g.configured() || !g.available()) return Promise.resolve(rep);
    var cands = rep.list.filter(function (w) { return !w.passive && !w.noBuy && !w.micro; })
      .sort(function (a, b) { return (b.turnover || 0) - (a.turnover || 0); }).slice(0, 40);
    if (!cands.length) return Promise.resolve(rep);
    var batches = []; for (var i = 0; i < cands.length; i += 20) batches.push(cands.slice(i, i + 20));
    return Promise.all(batches.map(function (bt) {
      return g.walletStats(rep.chain, bt.map(function (w) { return w.addr; }), '30d').then(function (res) {
        bt.forEach(function (w) {
          var st = SM.readStats(res[w.addr]); if (!st) return;
          w.gmgn = st; w.gmgnScore = SM.score(st, '30d'); w.gmgnGate = SM.gate(st, '30d');
          if (st.avatar) w.avatar = st.avatar;
          if (st.name && !w.name) w.name = st.name;
          if (st.twitter && !w.twitter) w.twitter = st.twitter;
        });
      }).catch(function () { });
    })).then(function () { if (X.report === rep) X.render(rep); return rep; });
  };
  function progressHtml(msg, frac) { return '<div class="x-progress"><span>' + U.esc(msg) + '</span><div class="bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div></div>'; }
  var SLUGS = { solana: 'sol', robinhood: 'robinhood' };
  function smartHash(chain, addr, wallet) { return '#/smart/' + (wallet ? 'wallet/' : '') + SLUGS[chain] + '/' + encodeURIComponent(addr); }
  X.hashFor = smartHash;
  function rememberToken(addr, chain, symbol) {
    X.recent = [{ addr: addr, chain: chain, symbol: symbol || short(addr) }].concat(X.recent.filter(function (r) { return r.addr !== addr; })).slice(0, 6);
    try { localStorage.setItem('tl.xrayRecent', JSON.stringify(X.recent)); } catch (e) {}
    X.renderRecent();
  }
  // token or wallet? Known tokens, pump.fun mints and Pons launches are tokens; otherwise the chain says (a Solana mint account, a Blockscout
  // token contract), and GMGN's token record decides what the chain cannot
  X.kindOf = function (chain, addr) {
    if (store.get(chain + ':' + addr) || (chain === 'solana' && /pump$/.test(addr)) || (chain === 'robinhood' && S.hood && S.hood.launches[addr])) return Promise.resolve('token');
    var viaChain = chain === 'solana'
      ? solRpc('getAccountInfo', [addr, { encoding: 'jsonParsed' }]).then(function (r) { var v = r && r.value; if (!v) return 'wallet'; if (v.data && v.data.parsed && v.data.parsed.type === 'mint') return 'token'; return v.owner === '11111111111111111111111111111111' ? 'wallet' : 'unknown'; })
      : U.timeoutFetch(C.blockscout + '/addresses/' + addr, 8000).then(function (a) { if (!a) return 'unknown'; if (a.token) return 'token'; return a.is_contract ? 'unknown' : 'wallet'; });
    return viaChain.catch(function () { return 'unknown'; }).then(function (k) {
      var G = TL.gmgn; if (k !== 'unknown' || !G || !G.active()) return k === 'unknown' ? 'token' : k;
      return G.request('GET', '/v1/token/info', { chain: G.slug(chain), address: addr }, null, 1, { prio: 1 }).then(function (d) { return d && d.address ? 'token' : 'wallet'; }, function (e) { return e && e.status && e.status < 500 ? 'wallet' : 'token'; });
    });
  };
  X.run = function (addr, chainHint) {
    addr = String(addr || '').trim();
    var out = $('#xrayOut'); var inp = $('#xrayInput'); if (inp && inp.value !== addr) inp.value = addr;
    var SM = TL.smart;
    if (!addr) { if (SM) SM.home(); return; }
    var chain = isEvm(addr) ? 'robinhood' : isSol(addr) ? 'solana' : null;
    if (!chain) { if (SM) SM.hideBoard(); out.innerHTML = '<div class="x-error">That does not look like a Solana or a Robinhood Chain address.</div>'; return; }
    if (chain === 'robinhood') addr = addr.toLowerCase();
    if (SM) SM.hideBoard();
    var demo = store.mode === 'demo' || !!window.claude || /claude|usercontent/.test(location.hostname);
    if (demo && SM) {
      var wallet = Object.keys(SM.boards).some(function (k) { var b = SM.boards[k]; return b.demo && b.wallets[addr]; });
      if (wallet) { location.hash = smartHash(chain, addr, true); return; }
      var drep = SM.demoTokenReport(chain, addr); X.report = drep; SM.renderTokenReport(drep);
      rememberToken(addr, chain, drep.token && drep.token.symbol); return;
    }
    if (X.running) return;
    X.running = true; X.sort = 'strength';
    var progress = function (msg, frac) { out.innerHTML = progressHtml(msg, frac); };
    progress('Checking the address…', 0.02);
    X.kindOf(chain, addr).then(function (kind) {
      if (kind === 'wallet') { X.running = false; X.report = null; location.hash = smartHash(chain, addr, true); return null; }
      // the table is shown as soon as this token is read; the leading wallets' records on their other tokens are read after
      // that, with a progress line under the tools, and the table is re-ranked when they are in
      var onchain = function () { return (chain === 'solana' ? X.solana(addr, progress) : X.robinhood(addr, progress)).then(function (rep) {
        X.report = rep; X.running = false; rememberToken(addr, chain, rep.token && rep.token.symbol);
        if (chain === 'solana') rep.recState = 'reading';
        X.render(rep);
        var recProgress = function (msg) { rep.recMsg = msg; var el = $('#xrayRec'); if (el && X.report === rep) el.textContent = msg; };
        X.records(rep, recProgress).then(function () { if (X.report === rep) X.render(rep); }).then(function () { return X.enrichGmgn(rep); });
        return rep;
      }); };
      var G = TL.gmgn;
      var job = G && G.active() && SM ? SM.tokenReport(chain, addr, progress).then(function (rep) { X.report = rep; SM.renderTokenReport(rep); return rep; }, function (e) {
        return onchain().then(function (rep) { rep.notes.unshift('GMGN: ' + (e && e.message || 'no data') + ' Showing the on-chain reading instead.'); X.render(rep); return rep; });
      }) : onchain();
      return job.then(function (rep) { X.running = false; if (rep) rememberToken(addr, chain, rep.token && rep.token.symbol); return rep; });
    }).catch(function (e) { X.running = false; out.innerHTML = '<div class="x-error">' + U.esc(e && e.message || 'Could not analyze this address.') + '</div>'; });
  };
  // demo / snapshot: a plausible report built from the token's snapshot numbers, every simulated value marked with ~
  X.renderDemo = function (addr, chain) {
    var t = store.get(chain + ':' + addr) || store.all().filter(function (x) { return x.chain === chain; })[0];
    var rep = { chain: chain, address: addr, wallets: {}, bal: {}, trades: [], notes: ['Preview: simulated wallets and numbers. Open the file locally for the real analysis.'], token: t || null, quote: chain === 'solana' ? 'SOL' : 'ETH', quoteUsd: chain === 'solana' ? 100 : 2400, supply: 1e9 };
    var r = U.rng('xray' + addr); var price = t && U.isNum(t.mc) ? t.mc / 1e9 / rep.quoteUsd : 3e-7; rep.priceQuote = price;
    var now = U.now(); var launch = t && U.isNum(t.createdAt) ? t.createdAt : now - 3 * TL.HR; rep.launchAt = launch;
    var n = 28;
    for (var i = 0; i < n; i++) {
      var a = chain === 'solana' ? ('Sim' + i + 'x').padEnd(44, 'abcdefghijkmnopqrstuvwxyz'.charAt(i % 25)).slice(0, 44) : '0x' + ('sim' + i).padEnd(40, '0123456789abcdef'.charAt(i % 16)).slice(0, 40);
      var tks = 2e6 + r() * 3e7; var buyPx = price * (0.2 + r() * 1.2); var inQ = tks * buyPx; var sells = r() > 0.55 ? 1 + Math.round(r() * 3) : 0; var sold = sells ? tks * (0.3 + r() * 0.7) : 0; var outQ = sold * price * (0.6 + r() * 1.5);
      var ts = launch + (i < 3 ? i * 800 : r() * 2 * TL.HR);
      rep.trades.push({ wallet: a, side: 'buy', quote: inQ, tokens: tks, ts: ts, slot: i });
      if (sells) rep.trades.push({ wallet: a, side: 'sell', quote: outQ, tokens: sold, ts: ts + r() * TL.HR, slot: 100 + i });
    }
    aggregate(rep, function () { return false; }); finish(rep);
    rep.total = rep.trades.length; rep.sampled = rep.trades.length;
    rep.list.slice(0, REP_TOP).forEach(function (w, i) { w.rep = { balance: r() * 400, balanceUnit: rep.quote === 'SOL' ? 'SOL' : 'ETH', txCount: Math.round(r() * 1000), txPlus: r() > 0.7, ageMs: r() * 400 * TL.DAY, ageIsMin: false, last24h: Math.round(r() * 80) }; });
    if (t && t.dev && t.dev.address && rep.list[3]) rep.list[3].addr = t.dev.address;
    tagAll(rep); X.report = rep; X.render(rep);
  };
  // ---------- live trades for the chart window: who buys and sells right now, polled while the window is open ----------
  // Solana: the newest signatures of the mint + parsed transactions (public RPC); Robinhood: CurveBuy / CurveSell logs of the curve,
  // or Uniswap v4 Swap logs of the pool with the sender of each transaction. Demo / sandbox: simulated trades marked ~.
  var LT = { token: null, timer: null, seen: {}, list: [], lastBlock: null, busy: false, onUpdate: null, sim: null, polls: 0, error: null };
  X.trades = LT;
  X.startTrades = function (t, onUpdate) {
    X.stopTrades();
    LT.token = t; LT.seen = {}; LT.list = []; LT.lastBlock = null; LT.busy = false; LT.onUpdate = onUpdate; LT.polls = 0; LT.error = null;
    var demo = t.demo || t.partial || store.mode === 'demo' || !!window.claude || /claude|usercontent/.test(location.hostname);
    LT.sim = demo ? U.rng('trades' + t.id) : null;
    var tick = function () { if (LT.token !== t || LT.busy) return; LT.busy = true; (demo ? simTrades(t) : t.chain === 'solana' ? pollSolTrades(t) : pollHoodTrades(t)).catch(function (e) { LT.error = e && e.message || 'error'; }).then(function () { LT.busy = false; LT.polls++; if (LT.token === t && LT.onUpdate) LT.onUpdate(LT); }); };
    tick();
    LT.timer = setInterval(tick, demo ? 2500 : t.chain === 'solana' ? 4000 : 5000);
  };
  X.stopTrades = function () { if (LT.timer) clearInterval(LT.timer); LT.timer = null; LT.token = null; LT.onUpdate = null; };
  function pushTrade(tr) { // newest first, capped, de-duplicated by id
    if (LT.seen[tr.id]) return false; LT.seen[tr.id] = 1; tr.fresh = LT.polls > 0;
    LT.list.unshift(tr); if (LT.list.length > 60) LT.list.length = 60; return true;
  }
  function pollSolTrades(t) {
    var mint = t.address; var solUsd = S.solUsd || store.solUsd || null;
    return solRpc('getSignaturesForAddress', [mint, { limit: LT.polls ? 25 : 40 }]).then(function (sigs) {
      var fresh = (sigs || []).filter(function (sg) { return !sg.err && !LT.seen['sig:' + sg.signature]; }).slice(0, LT.polls ? 10 : 16);
      fresh.forEach(function (sg) { LT.seen['sig:' + sg.signature] = 1; });
      if (!fresh.length) return;
      return pool(fresh, 4, function (sg) { return solTx(sg.signature).then(function (tx) { return { tx: tx, sig: sg.signature }; }); }).then(function (res) {
        var scratch = { bal: {} };
        res.filter(Boolean).sort(function (a, b) { return (a.tx && a.tx.slot || 0) - (b.tx && b.tx.slot || 0); }).forEach(function (r) {
          var tr = parseSolTx(r.tx, mint, scratch); if (!tr || (tr.side !== 'buy' && tr.side !== 'sell')) return;
          var price = tr.tokens > 0 ? tr.quote / tr.tokens : null;
          pushTrade({ id: r.sig, ts: tr.ts || U.now(), side: tr.side, quote: tr.quote, quoteSym: 'SOL', usd: solUsd ? tr.quote * solUsd : null, tokens: tr.tokens, mc: price != null && solUsd ? price * 1e9 * solUsd : null, wallet: tr.wallet, tx: r.sig });
        });
      });
    });
  }
  function pollHoodTrades(t) {
    var PONS_BUY = '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455', PONS_SELL = '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df';
    var UNI_SWAP = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f', PM = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
    var words = function (d) { return (String(d || '').replace(/^0x/, '').match(/.{64}/g) || []); };
    var int128 = function (w) { var v = BigInt('0x' + w.slice(-32)); return v > 0x7fffffffffffffffffffffffffffffffn ? v - (1n << 128n) : v; };
    var token = t.address.toLowerCase(); var rec = S.hood.launches[token]; var pl = S.hood.pools[token];
    var onCurve = !t.complete && rec && rec.curve;
    if (!onCurve && !pl) { LT.error = 'No curve or pool known for this token yet'; return Promise.resolve(); }
    var head, headTs;
    return hoodRpc([{ method: 'eth_blockNumber', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }]).then(function (r) {
      head = parseInt(r[0], 16); headTs = r[1] && r[1].timestamp ? parseInt(r[1].timestamp, 16) * 1000 : U.now();
      var from = LT.lastBlock ? LT.lastBlock + 1 : Math.max(0, head - 6000); if (from > head) return null;
      var filter = onCurve ? { address: rec.curve, topics: [[PONS_BUY, PONS_SELL]] } : { address: PM, topics: [UNI_SWAP, pl.id] };
      filter.fromBlock = '0x' + from.toString(16); filter.toBlock = '0x' + head.toString(16);
      return hoodRpc({ method: 'eth_getLogs', params: [filter] });
    }).then(function (r) {
      if (!r) return; LT.lastBlock = head;
      var logs = Array.isArray(r[0]) ? r[0] : []; if (!logs.length) return;
      var tsOf = function (bh) { return headTs - (head - parseInt(bh, 16)) * 103; };
      if (onCurve) {
        var q = S.quoteInfo(rec.pairToken && !/^0x0{40}$/.test(rec.pairToken) ? rec.pairToken : null);
        logs.slice(-40).forEach(function (l) {
          var w = words(l.data); if (w.length < 2 || !l.topics || l.topics.length < 2) return;
          var buy = l.topics[0] === PONS_BUY; var actor = '0x' + l.topics[1].slice(26), recipient = l.topics[2] ? '0x' + l.topics[2].slice(26) : null;
          var who = recipient && !/^0x0{40}$/.test(recipient) ? recipient : actor;
          var quote = parseInt(buy ? w[0] : w[1], 16) / Math.pow(10, q.decimals), tokens = parseInt(buy ? w[1] : w[0], 16) / 1e18;
          var price = tokens > 0 ? quote / tokens : null;
          pushTrade({ id: l.transactionHash + ':' + l.logIndex, ts: tsOf(l.blockNumber), side: buy ? 'buy' : 'sell', quote: quote, quoteSym: q.symbol, usd: q.usd ? quote * q.usd : null, tokens: tokens, mc: price != null && q.usd ? price * 1e9 * q.usd : null, wallet: who, tx: l.transactionHash });
        });
        return;
      }
      var swaps = logs.slice(-40); var q2 = S.quoteInfo(pl.quote);
      var hashes = []; swaps.forEach(function (l) { if (hashes.indexOf(l.transactionHash) < 0) hashes.push(l.transactionHash); });
      return hoodRpc(hashes.slice(0, 40).map(function (h) { return { method: 'eth_getTransactionByHash', params: [h] }; })).then(function (txs) {
        var from = {}; txs.forEach(function (tx, i) { if (tx && tx.from) from[hashes[i]] = tx.from.toLowerCase(); });
        swaps.forEach(function (l) {
          var w = words(l.data); if (w.length < 6) return; var who = from[l.transactionHash] || null;
          var a0 = int128(w[0]), a1 = int128(w[1]); var tokD = pl.tokenIs1 ? a1 : a0, qD = pl.tokenIs1 ? a0 : a1;
          var buy = tokD > 0n; var quote = Number(qD < 0n ? -qD : qD) / Math.pow(10, q2.decimals), tokens = Number(tokD < 0n ? -tokD : tokD) / 1e18;
          var price = tokens > 0 ? quote / tokens : null;
          pushTrade({ id: l.transactionHash + ':' + l.logIndex, ts: tsOf(l.blockNumber), side: buy ? 'buy' : 'sell', quote: quote, quoteSym: q2.symbol, usd: q2.usd ? quote * q2.usd : null, tokens: tokens, mc: price != null && q2.usd ? price * 1e9 * q2.usd : null, wallet: who, tx: l.transactionHash });
        });
      });
    });
  }
  function simTrades(t) { // preview: a plausible stream so the window is not empty where the chain is out of reach
    var r = LT.sim; var n = LT.polls ? (r() < 0.7 ? 1 : 2) : 8; var quoteUsd = t.chain === 'solana' ? 100 : 2400;
    var mc = U.isNum(t.mc) ? t.mc : 8000;
    for (var i = 0; i < n; i++) {
      var buy = r() < 0.6; var usd = 5 + Math.pow(r(), 2) * 900; var tokens = usd / (mc / 1e9);
      var w = t.chain === 'solana' ? ('Sim' + Math.floor(r() * 9000)).padEnd(44, 'abcdefghijkmnopqrstuvwxyz') : '0x' + Math.floor(r() * 1e15).toString(16).padStart(40, '0');
      pushTrade({ id: 's' + LT.polls + ':' + i, ts: U.now() - (LT.polls ? r() * 2500 : (n - i) * 9000), side: buy ? 'buy' : 'sell', quote: usd / quoteUsd, quoteSym: t.chain === 'solana' ? 'SOL' : 'ETH', usd: usd, tokens: tokens, mc: mc * (0.9 + r() * 0.2), wallet: w, tx: null, sim: true });
    }
    return Promise.resolve();
  }
  X.tradesHtml = function (t) {
    var g = t.chain === 'solana' ? 'sol' : 'robinhood';
    var head = '<div class="tr head"><span>Time</span><span>Type</span><span>Total</span><span>Tokens</span><span>MCap</span><span>Wallet</span></div>';
    if (!LT.list.length) return head + '<div class="tr-note">' + (LT.error ? U.esc(LT.error) : LT.polls ? 'No trades yet. New ones appear here the moment they land.' : 'Reading the latest trades…') + '</div>';
    return head + LT.list.slice(0, 40).map(function (tr) {
      var wal = tr.wallet ? identicon(tr.wallet, 18) + '<a class="addr" href="' + (okAddr(tr.wallet) ? TL.gmgnWallet(t.chain, tr.wallet) : '#') + '" target="_blank" rel="noopener" title="' + U.esc(tr.wallet) + ' · GMGN profile">' + short(tr.wallet) + '</a>' : '<span class="muted">–</span>';
      return '<div class="tr ' + tr.side + (tr.fresh ? ' arrive' : '') + '"><span class="t num" data-born="' + Math.round(tr.ts) + '">' + U.fmtAgeLive(U.now() - tr.ts) + '</span>' +
        '<span><b class="side ' + tr.side + '">' + (tr.side === 'buy' ? 'BUY' : 'SELL') + '</b></span>' +
        '<span class="num"><b>' + (U.isNum(tr.usd) ? (tr.usd > 0 && tr.usd < 0.01 ? '<$0.01' : U.fmtUsd(tr.usd)) : '–') + '</b><small>' + qty({ quote: tr.quoteSym }, tr.quote) + (tr.sim ? ' ~' : '') + '</small></span>' +
        '<span class="num">' + tokens(tr.tokens) + '</span>' +
        '<span class="num">' + (U.isNum(tr.mc) ? U.fmtUsd(tr.mc) : '–') + '</span>' +
        '<span class="w">' + wal + '</span></div>';
    }).join('');
  };

  X.renderRecent = function () {
    var el = $('#xrayRecent'); if (!el) return;
    var chips = X.recent.map(function (rc) { return '<button class="chip' + (rc.wallet ? ' wallet-chip' : '') + '" data-addr="' + U.esc(rc.addr) + '"' + (rc.wallet ? ' data-wallet="' + U.esc(rc.chain || '') + '"' : '') + '>' + (rc.wallet ? '<span class="muted">wallet</span> ' : '') + U.esc(rc.symbol) + '</button>'; });
    var fromFeed = store.all().filter(function (t) { return t.chain === (TL.ui ? TL.ui.state.net : 'solana') && !t.demo && !t.partial && (t.complete || (U.isNum(t.holders) && t.holders > 30)) && TL.trusted(t) && TL.checked(t) && TL.ensureVet(t)._ok; }).sort(function (a, b) { return (b.holders || 0) - (a.holders || 0); }).slice(0, 6); // suggestions pass the same gate as the feeds
    el.innerHTML = (chips.length ? '<span>Recent</span>' + chips.join('') : '') + (fromFeed.length ? '<span style="margin-left:6px">From the feed</span>' + fromFeed.map(function (t) { return '<button class="chip" data-addr="' + U.esc(t.address) + '">' + U.esc(t.symbol) + '</button>'; }).join('') : '');
  };
  X.onShow = function () { X.renderRecent(); };
  X.identicon = identicon;
  X.tokenHeadHtml = tokenHead;
  X.bind = function () {
    if (X._bound) return; X._bound = true; // the router may call it before DOMContentLoaded reaches this module
    try { X.recent = JSON.parse(localStorage.getItem('tl.xrayRecent') || '[]'); } catch (e) { X.recent = []; }
    var go = function () { // the address goes into the link, so Back and a shared link lead to the same analysis
      var a = String($('#xrayInput').value || '').trim(); if (!a) { location.hash = '#/smart'; return; }
      var ch = isEvm(a) ? 'robinhood' : isSol(a) ? 'solana' : null; if (!ch) { X.run(a); return; }
      if (ch === 'robinhood') a = a.toLowerCase();
      var h = smartHash(ch, a, false); if (location.hash === h) X.run(a); else location.hash = h;
    };
    $('#xrayGo').addEventListener('click', go);
    $('#xrayInput').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
    $('#xrayRecent').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-addr]'); if (!b) return;
      var a = b.dataset.addr, ch = isEvm(a) ? 'robinhood' : 'solana';
      var h = smartHash(ch, a, !!b.dataset.wallet); if (location.hash === h) { if (b.dataset.wallet && TL.smart) TL.smart.openWallet(ch, a); else X.run(a); } else location.hash = h;
    });
    $('#xrayOut').addEventListener('click', function (ev) {
      if (ev.target.closest('#xrayJunk') && X.report) { X.showJunk = !X.showJunk; X.render(X.report); return; }
      var b = ev.target.closest('#xraySort button'); if (b && X.report) { X.sort = b.dataset.sort; X.render(X.report); return; }
      var vb = ev.target.closest('[data-xview]'); if (vb && X.report) { ev.preventDefault(); X.view = vb.dataset.xview; X.showJunk = false; try { localStorage.setItem('tl.xrayView', X.view); } catch (e) {} X.render(X.report); return; }
      var st = ev.target.closest('#xrayShowAll'); if (st && X.report) { X.view = 'all'; try { localStorage.setItem('tl.xrayView', 'all'); } catch (e) {} X.render(X.report); return; }
      var rt = ev.target.closest('#xrayRetry'); if (rt && X.report && X.report.address && X.run) { X.run(X.report.address, X.report.chain); }
    });
  };
  document.addEventListener('DOMContentLoaded', X.bind);
})(window.TL);
