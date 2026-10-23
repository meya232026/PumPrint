<div align="center">

# 📜 Changelog

**From a prototype feed to |CHAMELEON⟩, the quantum memecoin radar.**<br>
<sub>The milestones of the site, newest first. Each version is the number the page shows in <b>Data sources</b>.</sub>

</div>

<br>

## 2.x · the relaunch &nbsp;<sub>October 2026</sub>

### 2.24 · Lighter, frame by frame

The terminal went through a frame-by-frame profile and lost what made it heavy, while looking the same. In headless Chromium at a Retina pixel ratio: the portal from 3 to **19** frames a second, the moment of entry from 3 to **25**, the Trenches feed from 12 to **58**, scrolling it from 14 to **56**.

- Glass without the blur: rows and panels keep their translucent fill but no longer blur a background that kept drifting under them, and the colour fields under the page hold still.
- The portal soft by gradient instead of by filter: no 70 px fog layers, no blurred or blended ghosts, the glows of the eyes and the name are soft lights behind the shapes, the stars drawn at 30 frames a second.
- The terminal is neither painted nor animated while the portal covers it.
- The logo's electron orbits as two nested rotations, the live dots ping with scale and opacity, the chameleon's eye jumps every couple of seconds from a timer: everything the compositor can run alone.
- A test of its own (`v2.24 lighter` in `mock/test.py`) keeps it that way.

### 2.23 · Fresh for everyone at once

- Chameleon Valley: the entangled pairs over the world no longer draw a line across the whole screen; they still flare together.
- The BTC Machine tab asks for its styles and scripts with a content tag (`?v=…`), so a new look reaches every visitor at once instead of after the browser's four-hour cache.

### 2.22 · One violet night

- The partner's BTC Machine, Course and Poly Smart tabs recoloured into the site's violet night, in both themes: only colours changed, never a number or a word.
- Chameleon Valley under a quantum dusk: a night-glass interface, a cooler world, a violet and cyan haze, entangled particles and a |VALLEY⟩ title. The game itself, its art and its rules, is unchanged.

<table>
<tr>
<td width="50%"><img src="docs/assets/course.jpg" alt="The Course tab in the violet night: fifteen lessons beside the terminal"></td>
<td width="50%"><img src="docs/assets/valley-start.jpg" alt="Chameleon Valley's start screen: the |VALLEY⟩ title, a name field and a hundred chameleons to choose from"></td>
</tr>
<tr>
<td align="center"><sub>The partner's course, recoloured</sub></td>
<td align="center"><sub>|VALLEY⟩, the quantum farm</sub></td>
</tr>
</table>

### 2.21 · The narrative at the door

- The portal shows the Quantum radar before anyone signs in: the coins of the narrative moving on Solana right now, in superposition (pictures doubled and blurred, numbers hidden as `$??.?K`). Three Jupiter searches from the visitor's own browser, once per visit, nothing stored.
- The terminal opens on the radar: the narrative's last hour in four numbers, then its coins, hottest first.
- New words: **quant** as a word of its own (QUANT, Quant Cat, QuantAI; never Quantico or quantity), **Shor** and **Willow**. Jupiter is searched for ten words, six of them in the first seconds.

### 2.20 · |CHAMELEON⟩

The quantum theme became one of the hottest narratives in Solana's memecoin trenches, and the site became a quantum terminal.

<p align="center"><img src="docs/assets/portal.jpg" width="100%" alt="The portal: two qubit eyes in a ring of runes over the name"></p>

- The name written as a quantum state, a ket: **|CHAMELEON⟩**.
- The portal as an observation: the terminal waits in two ghost states, one per chain; the chameleon's eyes are qubits, Bloch spheres inside a turret of scales, with the state vector as the pupil. Connect Phantom and the state collapses into the terminal.
- **The Quantum radar**: every quantum, qubit, Q-Day and post-quantum coin on Solana, behind the same rug gate as the feed, hottest first by `volume(1 h) + 4 × volume(5 min)`.
- An orbiting electron around the logo, a wave function under the header, kets in the block titles (|CALLS⟩, |RUNNERS⟩). The numbers never move for the decoration, and every animation stops under *reduce motion*.
- About and Roadmap rewritten for the relaunch. The Roadmap has steps, not dates, and promises no token.

### 2.11 · A data service of its own

- `chameleon-feed` (`server/feed/`): the site's own service for what every visitor shares: the call journal, the Smart Tracking ranking and the registry of known traders (`/calls.json`, `/board.json`, `/known.json`). It runs the page's own engine, headless, so a call on the server is exactly a call on the page.
- Each answer is built at most once every few seconds and gzipped once, however many visitors ask.
- The engine's storage goes to disk at most every 15 seconds instead of on every change.

### 2.10 · The relaunch

- **The portal**: the site opens in the dark, on two chameleon eyes, and Phantom opens the way. A returning visitor goes straight in, but only while Phantom itself still vouches for the address.
- **Pictures first**: a token enters the feed, the calls, the runners or Top only with its picture already loaded. IPFS gateways are raced in waves, so one slow or blocked gateway never costs a picture.
- **Calls more often, and earlier**: the *bond* call 4 to 30 minutes after graduation and the *breakout* half an hour to six hours after it. Rules measured on a day of pump.fun graduations: a curve bought out within three minutes of birth is never called.
- A new design: dark glass and a violet fog. The site changes colour with the network, Solana violet and green, Robinhood Chain lime on black.
- Fixed: the GMGN proxy answered browsers with a list of origins, which every browser refuses; it now names the one origin that asked.

### 2.00 · Chameleon Valley

A multiplayer farm on the site: one wallet, one chameleon, a hundred homes. Past a hundred players online, newcomers walk the valley as guests. The game is a separate build and lives with its makers.

<br>

## 1.x · the terminal &nbsp;<sub>September to October 2026</sub>

### 1.94 · Sign in with Phantom

- On its own domain the site opens for anyone who connects Phantom: a public address, no message to sign, no transaction, no fee, no account server.
- Until the way is open, the engine does not start: nothing is polled and nothing is shown.
- The shipped page carries no code comments; the notes stay in `src/`.

### 1.59 · A security audit

- On its own domain, address parameters can no longer point the page at another data server (`?api=`, `?calls=`, `?board=`, `?known=`, `?gmgn=`, `?rpc=` and the rest).
- Names, symbols and addresses from any source are cleaned before they reach the page; the registry of known traders is checked field by field.
- The GMGN proxy listens on the loopback only, limits each caller to 90 requests a minute and accepts one method per route.
- Security headers for every page (`cloudflare/_headers`): no framing by other sites, no plugins, no `<base>` tricks, no content sniffing.

### 1.57 to 1.58 · The tree of light

A tall tree of light beside the four steps of the Roadmap, generated by `tools/roadmap_tree.py` from a fixed seed: the same picture on every run.

### 1.48 · Known traders

The KOLs and proven wallets GMGN knows by name, kept as one registry with their 30-day and 7-day records, and their buys as they happen. Cards only if you turn them on (1.49), with your own threshold.

### 1.47 · Calls after graduation

One rule for the page and the server, in `src/app_calls.js`: a call only after graduation, above the graduation cap, holding most of its peak, with real money going through it, read from 1-minute candles.

### 1.43 · The partner's tabs

BTC Machine, Course and Poly Smart: a partner's Polymarket BTC signal terminal, its course and its smart-trader scanner, embedded as tabs.

### 1.40 · A live site

The page served from its own domain, with its GMGN proxy (`server/gmgn_proxy.py`): the key stays on the server, every answer is cached, one rate budget for the whole site.

### 1.32 · The call journal

The terminal's own picks, written down at the cap they were made at and followed in public: the peak since, the multiples reached, how it ended.

### 1.14 · One gate

One set of risk thresholds for the flags, the gate and the filters, calibrated on live launches: dev share, bundles, snipers, insiders, the top ten, the rug score. A token cannot be hidden on one path and shown on another.

<br>

## 0.x · Trenchlight &nbsp;<sub>15 September 2026</sub>

The prototype: a memecoin feed that runs from a browser alone. Every pump.fun launch from the PumpPortal stream, bonding curves read on-chain, Jupiter for the snapshot and the holders, Robinhood Chain from its public nodes. Its name survives in the build's file name, `dist/trenchlight_feed.html`.

<br>

<div align="center"><sub>|ψ⟩ = α|SOLANA⟩ + β|ROBINHOOD CHAIN⟩</sub></div>
