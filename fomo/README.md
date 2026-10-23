# fomo-robinhood-radar (vendored parts)

From https://github.com/cvxv666/fomo-robinhood-radar, commit 7fe87ec5417a (archived 6 October 2026), MIT (see LICENSE).

- `archive/`  the project's own archive: every alert and what became of it, the judged wallets, the tape by day, the totals.
- `fixtures/` chain and GeckoTerminal answers from the project's tests, used by this site's tests.
- `cases/`    four burst timelines the project published (`assets/cases/*/case.json`).

The radar itself (Python) is not vendored: `server/fomo/` is a port of its live path to Node
(sources/rpc.py, pipeline/provenance.py, noise.py, crews.py, hot.py, safety.py, pushes.py, record.py, analyze.py).
