// Learn: how each tool works and how they fit into one way of trading. Plain content, no data:
// it reads the same with or without a server. Opened beside a tool (split view), it scrolls to
// that tool's section.

import { esc } from '../ui.js';

const TOOLS = [
  {
    id: 'moth',
    name: 'Moth Radar',
    chain: 'SOL',
    q: 'What is being launched right now?',
    answers: 'Every new pump.fun launch, split into the words of its name. When a word starts turning up in many launches at once, a story is forming, usually before it reaches anyone’s timeline.',
    read: [
      ['Window', '5, 15 or 60 minutes: how far back the counts go.'],
      ['Count', 'Launches with that word in their name inside the window.'],
      ['×3 · New', 'How fast the word grows against its usual rate. New means it was not around before.'],
      ['The token behind it', 'Of all the launches with the word, the one people are actually trading, with its market.'],
    ],
    use: [
      'Start on 15 minutes. Look for words marked New or ×3 and up that keep climbing from one refresh to the next.',
      'Open the word: what it is launched together with, which token behind it trades, whether anyone on X talks about it yet.',
      'Dozens of launches and no trading is one person spamming a name, not a crowd. Skip it.',
      'A word with a token that really trades goes to Chameleonscope’s gate before anything else.',
    ],
    careful: ['A word is attention, not a buy signal.', 'Most story launches are dead within the hour, and the first token with the name is often a copy.'],
  },
  {
    id: 'kolibri',
    name: 'Kolibri Search',
    chain: 'SOL',
    q: 'Who called it, and do their calls hold?',
    answers: 'Paste an X account, one post or a Telegram channel. Kolibri finds every token they called and measures each call against the market cap at the moment of the post: a minute, five minutes, an hour and a day later, and the peak.',
    read: [
      ['Grade A to F', 'From the calls with a 1-hour result. More calls weigh more: five calls prove little.'],
      ['Up an hour later', 'The share of calls still above the cap at the post one hour on.'],
      ['Median 1m · 5m · 1h · 24h', 'The typical call, not the best one. A 20K call at 40K is 2x; at 10K it is −50%.'],
      ['$100 in every call', 'What following every call blindly, out after an hour, would have made.'],
    ],
    use: [
      'Before you act on a call, look the caller up.',
      'Weigh the median and the up-an-hour-later share over the best call. Check how many calls there are.',
      'Compare 1 minute with 1 hour. Calls that jump in the first minute and fade by the hour make the followers someone’s exit.',
      'Follow callers who keep an A over weeks. The leaderboard keeps the ones the site reads all day.',
    ],
    careful: ['A record is the past, and a caller can be paid to post.', 'Screenshots of gains prove nothing; the measured record does.'],
  },
  {
    id: 'chameleon',
    name: 'Chameleonscope',
    chain: 'SOL · HOOD',
    q: 'Is this launch clean?',
    answers: 'The trenches of pump.fun and Pons in one feed, checked the second each coin lands. A coin that fails the rug gate never shows. The rest get a verdict with its reasons.',
    read: [
      ['New · Almost bonded · Migrated', 'Where a coin is in its life: just launched, close to filling its curve, or moved to a pool.'],
      ['The gate', 'What gets a coin hidden: live mint or freeze rights, a honeypot, the dev holding 10% or more, bundles, snipers or insiders at 30%, a top 10 holding half, a copy of a fresh name, a deployer with five launches and none graduated.'],
      ['STRONG · WATCH · CAUTION', 'Three scores, safety, momentum and community, each built from named rules you can read on the coin.'],
      ['Calls', 'The terminal’s own picks, written at the cap of that moment and followed for a week: peak, multiples, rug.'],
    ],
    use: [
      'Pick the chain and start with Almost bonded or Migrated: coins that already survived their first minutes.',
      'Open a STRONG or WATCH coin and read the reasons. Safety first, momentum second.',
      'Look at the dev share, the top 10 and the bundles yourself. A good score with one red flag is still a red flag.',
      'Use the calls list as a benchmark of what the best picks did, not as an order.',
    ],
    careful: ['The gate removes the obvious traps, not all of them.', 'A clean launch can still go to zero.'],
  },
  {
    id: 'fomo',
    name: 'Fomo Radar',
    chain: 'HOOD',
    q: 'Are proven wallets buying?',
    answers: 'The fomo.family traders who proved themselves on Robinhood Chain, followed through the wallets that actually trade. A burst is several of them entering one token within minutes.',
    read: [
      ['Conviction', 'Σ(score/100)² over the trusted wallets: a burst needs +4 from at least three of them in 30 minutes, from two or more independent crews.'],
      ['Before an alert', 'The token must sell, the pool must hold $10K or more, others besides the cohort must be in a young pool, and a borrowed name needs more conviction.'],
      ['The hour read', 'Where the price was an hour after the alert, and its peak. $100 into each alert shows the record.'],
      ['Held', 'Bursts that were not sent, each with the reason.'],
    ],
    use: [
      'Treat a burst as a lead, not an order. Open the pool and see how far the price ran since the first wallet bought.',
      'Check the depth and who else is in. If the cohort is most of the pool, you are buying from them.',
      'Be fast or skip: the record shows the edge sits in the first minutes after an alert.',
      'Read the archive’s caveats: three trades carried most of its profit.',
    ],
    careful: ['The project was archived on 6 October 2026. The archive is history; the live radar is this site reading the same wallets.', 'Wallets that know they are followed change how they trade.'],
  },
  {
    id: 'loxley',
    name: 'Loxley',
    chain: 'HOOD · paper',
    q: 'When do I get in, and how do I get out?',
    answers: 'An exit-first sniper for Pons V2. It scores every launch with its reasons, enters only once the 99% opening tax has decayed under a ceiling, marks each position with the exact price of leaving, and leaves on its rules, on a siren, or the moment the deployer moves. Here it trades on paper only.',
    read: [
      ['Hunt', 'Launch cards. The score starts at 50: a 1–6% dev buy +15, a declared bundle −25, a launch farm −25. 75 and up is FIRE, 45 and up WATCH, the rest SKIP.'],
      ['Paper book', 'Open positions with their mark and peak; closed ones with why they closed: take profit, stop, trail, time, siren, dev sold.'],
      ['Tape', 'Everything the desk does: pass (with the rule), draw (waiting for the tax), fire, close, siren.'],
      ['Read one token', 'Curve fill, the impact of 0.05 ETH in, the most that leaves under 5% impact; on a pool the council’s eight votes and the survival score.'],
    ],
    use: [
      'Watch the hunt for a while to learn what a FIRE launch looks like, and why most launches are refused.',
      'Before buying any Pons token by hand, read it: the exit table says what leaving costs right now.',
      'Set your exits before the entry, the way the book does: a take profit, a stop, a time limit.',
      'Real trades are Loxley’s command line on your own machine. Run it on paper for a session first, and arm it only with a burner wallet.',
    ],
    careful: ['Paper fills have no gas, no rivals and no slippage beyond the curve maths: real fills come out worse.', 'This site never asks for a key or a seed phrase. Anything that does is not this site.'],
  },
  {
    id: 'canary',
    name: 'Canary',
    chain: 'HOOD · read-only',
    q: 'Is it time to leave?',
    answers: 'What happens after the buy. Canary compares each read of a Pons V2 token with the one before it; a change that crosses one of ten plain rules turns the token from QUIET to WATCH or LEAVE.',
    read: [
      ['QUIET · WATCH · LEAVE', 'Nothing crossed; something worth a look; the highest-severity change. INFO is a phase change, such as graduation.'],
      ['Scan', 'One read of any token: the deployer’s share, the curve reserve or the pool price and liquidity, fees, trades, the deployer’s other launches.'],
      ['Watching', 'The server’s list, and up to five tokens of your own in this tab, read every minute.'],
      ['Flight recorder', 'Every signal with the reading before and after, and the rule that caught it.'],
    ],
    use: [
      'Right after a buy, scan the token and keep it in this tab.',
      'LEAVE is a measured danger change: the deployer’s balance fell more than 2 points, the curve reserve more than 15%, or pool liquidity more than 20%. Decide now what you do when it comes.',
      'WATCH means look: fees swept, the price moving 25%, a burst of swaps, half an hour without a trade, a deployer with a dozen launches.',
      'Keep the page open: the watch in your tab runs only while it is.',
    ],
    careful: ['Evidence, not intent: a balance drop can be a transfer, and a fee move is not a claim.', 'LEAVE is not a promise, and QUIET is not safety.'],
  },
];

const WORDS = [
  ['Bonding curve', 'A new pump.fun or Pons token first trades against a curve: every buy raises the price a little. The curve fills as people buy.'],
  ['Graduation', 'A full curve moves its liquidity to a pool (PumpSwap or Raydium on Solana, Uniswap v4 on Robinhood Chain). “Almost bonded” means close to it.'],
  ['Market cap', 'Price times supply. Calls are measured in it: in at 20K, out at 40K is 2x.'],
  ['Dev share', 'How much of the supply the deployer holds. A big dev bag is a bag that can be sold into you.'],
  ['Bundles · snipers · insiders', 'Wallets that bought in the launch block or were funded by the deployer. Their supply can hit the price all at once.'],
  ['Mint and freeze', 'Rights on a Solana token: mint prints more of it, freeze locks your tokens. Live rights are a reason to stay out.'],
  ['Opening tax', 'Every Pons V2 launch opens behind a 99% tax that decays to zero within seconds. Buying in the first second pays it.'],
  ['Exit impact', 'How far the price moves when you sell. A thin pool means you cannot leave at the price you see.'],
  ['Rug', 'The deployer or insiders pull the liquidity or dump their supply: the price goes to almost nothing.'],
  ['Caller · smart money', 'A caller posts tokens for others to buy; smart money is a wallet with a record. Both are measured here, not trusted.'],
];

const ROUTINE = [
  ['Set the budget', 'Before the session: an amount you can lose, a burner wallet that holds only that, and a cap per trade.'],
  ['Find the story', 'Moth for words climbing on pump.fun; Chameleonscope’s feed on either chain.'],
  ['Pass the gate', 'Skip anything with live mint or freeze rights, a big dev share, bundles or a fresh copy of a name.'],
  ['Get a second opinion', 'A caller who delivers (Kolibri), or proven wallets buying (Fomo Radar). Two independent signs beat one loud one.'],
  ['Know the way out', 'Before buying, what selling costs right now (Loxley’s read). If the exit is thin, so is the trade.'],
  ['Enter small', 'On Pons, after the opening tax has decayed. Decide the take profit, the stop and the time limit now, not later.'],
  ['Hold with a watch', 'Canary on Pons tokens, the coin’s card on Chameleonscope. When the deployer moves or the reserve leaves, leave.'],
  ['Write it down', 'Why in, why out, the result. Patterns show after twenty trades, not two.'],
];

const RISK = [
  'Most new tokens go to zero. Never trade money you need.',
  'Use a burner wallet that holds only what one session may lose.',
  'Never paste a seed phrase or a private key into a website. This site never asks for one.',
  'Fees, slippage and the opening tax are real costs: a small win can be a loss after them.',
  'A candle you missed is gone. Chasing it is how the late buyers become the exit.',
];

const FAQ = [
  ['Why does a tool say Sample or Demo data?', 'The live data comes from this site’s server. Without one (a static copy, the preview) or in demo mode, the tools show recorded or made-up data, and say so.'],
  ['Do I need a wallet or an account?', 'No. Everything here reads public data. Nothing asks you to connect or sign anything to use it.'],
  ['Can the site trade for me?', 'No. Loxley runs on paper here; real trades are its command line on your own machine. Canary only reads.'],
  ['Is any of this advice?', 'No. The tools show what is being launched, who called it and what wallets did, not what to buy.'],
];

export function initLearn() {
  const root = document.getElementById('learn-root');
  const toolCard = (t, i) => `
    <article class="lr-tool" id="learn-${t.id}" data-learn="${t.id}">
      <header class="lr-tool-head">
        <span class="lr-n">${String(i + 1).padStart(2, '0')}</span>
        <div><p class="eyebrow">${esc(t.name)} <span class="tc-chain">${esc(t.chain)}</span></p><h2>${esc(t.q)}</h2></div>
      </header>
      <p class="lr-answer">${esc(t.answers)}</p>
      <div class="lr-cols">
        <div>
          <h3 class="lr-h">Read the screen</h3>
          <dl class="lr-read">${t.read.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        </div>
        <div>
          <h3 class="lr-h">How to use it</h3>
          <ol class="lr-use">${t.use.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <h3 class="lr-h">Careful</h3>
          <ul class="lr-careful">${t.careful.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="lr-actions">
        <a class="btn btn-light btn-sm" href="#${t.id}" data-nav="${t.id}">Open ${esc(t.name)} <svg aria-hidden="true"><use href="#i-arrow"/></svg></a>
        <a class="btn btn-line btn-sm lr-beside" href="#${t.id}+learn">Open it beside this guide <svg aria-hidden="true"><use href="#i-split"/></svg></a>
      </div>
    </article>`;

  root.innerHTML = `
    <div class="tool-intro">
      <h1 class="page-title">Learn to read the print.</h1>
      <p>Six tools, one question each. Here is what each one answers, how to read its screen, and how they fit into one way of trading: find the story early, check the launch, look for proof, know the way out, enter small, and leave on evidence.</p>
    </div>

    <div class="lr-layout">
      <nav class="lr-toc" aria-label="On this page">
        <p class="lr-toc-h">On this page</p>
        <button type="button" data-goto="learn-map">The six questions</button>
        <button type="button" data-goto="learn-words">The words</button>
        ${TOOLS.map((t) => `<button type="button" data-goto="learn-${t.id}">${esc(t.name)}</button>`).join('')}
        <button type="button" data-goto="learn-routine">A routine</button>
        <button type="button" data-goto="learn-risk">Risk</button>
        <button type="button" data-goto="learn-faq">Questions</button>
      </nav>

      <div class="lr-main">
        <section class="lr-sec" id="learn-map">
          <div class="tk-sec-head"><div><h2>The six questions</h2><p>A pump leaves prints before it reaches the chart: in launch names first, then in callers’ posts and proven wallets, and last on your timeline. Each tool reads one of them.</p></div></div>
          <ol class="lr-map">
            ${TOOLS.map((t, i) => `<li><button type="button" data-goto="learn-${t.id}"><span class="lr-n">${String(i + 1).padStart(2, '0')}</span><b>${esc(t.q)}</b><span class="lr-map-tool">${esc(t.name)} <i>${esc(t.chain)}</i></span></button></li>`).join('')}
          </ol>
        </section>

        <section class="lr-sec" id="learn-words">
          <div class="tk-sec-head"><div><h2>The words</h2><p>What the tools mean when they say them.</p></div></div>
          <dl class="lr-words">${WORDS.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        </section>

        ${TOOLS.map(toolCard).join('')}

        <section class="lr-sec" id="learn-routine">
          <div class="tk-sec-head"><div><h2>A routine</h2><p>One way to trade with the print. Not the only one, and not advice: an order that keeps the expensive mistakes out.</p></div></div>
          <ol class="lr-routine">${ROUTINE.map(([k, v], i) => `<li><span class="lr-n">${i + 1}</span><div><b>${esc(k)}</b><p>${esc(v)}</p></div></li>`).join('')}</ol>
        </section>

        <section class="lr-sec" id="learn-risk">
          <div class="tk-sec-head"><div><h2>Risk</h2><p>The part that decides whether you are still trading next month.</p></div></div>
          <ul class="lr-risk">${RISK.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </section>

        <section class="lr-sec" id="learn-faq">
          <div class="tk-sec-head"><div><h2>Questions</h2></div></div>
          <div class="lr-faq">${FAQ.map(([q, a]) => `<details class="panel how"><summary><h3>${esc(q)}</h3><svg aria-hidden="true"><use href="#i-chevron"/></svg></summary><p>${esc(a)}</p></details>`).join('')}</div>
          <p class="foot-fine lr-fine">Not financial advice. Most new tokens go to zero.</p>
        </section>
      </div>
    </div>`;

  const scrollTo = (id, smooth = true) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) scrollTo(b.dataset.goto);
  });

  return {
    setActive() {},
    /** Beside a tool in the split view: show that tool's section, and mark it as the one beside. */
    focus(tool) {
      for (const a of root.querySelectorAll('.lr-beside')) {
        const here = a.closest('[data-learn]').dataset.learn === tool;
        a.classList.toggle('is-beside', here);
        a.lastChild.previousSibling.textContent = here ? 'Open beside this guide now ' : 'Open it beside this guide ';
      }
      if (TOOLS.some((t) => t.id === tool)) requestAnimationFrame(() => scrollTo(`learn-${tool}`, false));
    },
  };
}
