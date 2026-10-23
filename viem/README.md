# vendor/viem

`viem.cjs` is [viem](https://viem.sh) 2.56.3 and the packages it stands on, bundled into one CommonJS file.
It is loxley's `vendor/viem.js`, copied unchanged from
[shmidtqq65/loxley](https://github.com/shmidtqq65/loxley) at commit `6f86925`, so the site needs no
`npm install` (the registry is not always reachable from where this runs).

`entry.js` is the file loxley built it from. `LICENSES.md` carries the notices of every package inside the
bundle (all MIT); `LOXLEY-LICENSE` is loxley's own licence.

Who uses it on the site:

- **Canary** (`vendor/canary/dist/canary-engine.mjs`) imports it through `server/canary/viem-shim.mjs`, which
  re-exports only the read helpers Canary needs and wraps every transport in a read-only allowlist of six
  JSON-RPC methods (`eth_chainId`, `eth_blockNumber`, `eth_getCode`, `eth_call`, `eth_getLogs`,
  `eth_getBlockByNumber`). Anything else is refused before it leaves the process.

The bundle also contains viem's account helpers, because loxley's command line needs them for real trades.
Nothing on the site calls them: the site never asks for, reads or stores a private key or a seed phrase.
