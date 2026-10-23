# 🔒 Security

|CHAMELEON⟩ is analytics only. It never trades, never holds funds and never asks for a private key or a seed phrase. Nobody from the project will ever ask you for one, in a DM or anywhere else.

## Reporting a vulnerability

Please report it privately, not in a public issue:

- **GitHub:** the **Security** tab of this repository → **Report a vulnerability**, or
- **X:** a direct message to [@ChameleonScopee](https://x.com/ChameleonScopee).

Tell us what you found, how to reproduce it and what it lets an attacker do. Every report is read, and one that holds is fixed in the next version (see the [changelog](CHANGELOG.md)).

## What is in scope

| Part | Where |
| --- | --- |
| The page: anything that runs code, injects markup or leaks data in a visitor's browser | `src/`, `build.py` |
| The rules that keep a page on its own domain from being pointed at another data server | `src/app_core.js`, `src/app_gmgn.js` |
| The Phantom gate and the account in the browser | `src/app_gate.js`, `src/app_account.js` |
| The GMGN proxy: its key, its routes, its limits | `server/gmgn_proxy.py` |
| The data service and its installer | `server/feed/`, `server/install.sh` |
| The security headers | `cloudflare/_headers` |

Out of scope: the partner's BTC Machine terminal and the Chameleon Valley game (their code is not in this repository), the third-party APIs the page reads (PumpPortal, Jupiter, GMGN, the public nodes), and reports that need a compromised device or a malicious browser extension.

## How the project protects you

- **Sign-in shares a public address and nothing else.** No message to sign, no transaction, no fee, no account server.
- **No secret reaches the page.** On the live site the GMGN key lives on the server, behind a proxy that answers the site's own origin. A private key pasted where an API key goes is refused and never stored.
- **The page cannot be pointed elsewhere.** On its own domain, address parameters that name a data server are ignored.
- **Locked-down headers**: no framing by other sites, no plugins, no `<base>` tricks, no content sniffing, a short referrer.
- **Services on the loopback only.** The data service and the proxy listen on `127.0.0.1` and reach the internet through a Cloudflare Tunnel; the proxy limits each caller to 90 requests a minute.
- **Settings readable by their owner only.** `server/install.sh` writes `/etc/chameleon/site.env` with `umask 077`, and the services run with `NoNewPrivileges`, `PrivateTmp` and a protected kernel.
