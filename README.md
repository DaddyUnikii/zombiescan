<div align="center">

# 🧟 zombiescan

**Find the token approvals your wallet still gives to ghosts.**

[![CI](https://github.com/DaddyUnikii/zombiescan/actions/workflows/ci.yml/badge.svg)](https://github.com/DaddyUnikii/zombiescan/actions/workflows/ci.yml)
[![Scan wallet](https://img.shields.io/badge/run%20from%20your%20phone-Scan%20wallet-8A2BE2?logo=githubactions&logoColor=white)](../../actions/workflows/scan.yml)
![node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![chains](https://img.shields.io/badge/chains-ETH%20·%20BSC%20·%20Base%20·%20Arb%20·%20OP%20·%20Polygon-blue)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

Every `approve()` you ever signed is still out there. The dApp you used in 2021 may be gone, its router
self-destructed, its proxy pointing at nothing, its team vanished, but the **allowance is still live** and
whoever brings that address back to life, or holds that key, can move your tokens.

`zombiescan` finds every live ERC-20 / ERC-721 / ERC-1155 approval on a wallet and asks one question about each
spender: **is anything really alive in there?** 👻

```text
DEMO_PLACEHOLDER
```

## Levels

| Level | What haunts you | How zombiescan knows |
|---|---|---|
| 🧟 **ZOMBIE** | The spender **was** a contract and is dead, or is a known exploited one. | No code now, but code at the block you approved it (archive RPC) or a creator on record at the explorer · a proxy (EIP-1167 clone, EIP-1967 implementation or beacon, OpenZeppelin legacy slot) whose implementation has **no code** · a short, sourced list of spenders with public approval-draining exploits · an explorer scam flag |
| 👻 **GHOST** | There is **no contract** at all. A private key, not a protocol, holds your allowance. | `eth_getCode` is empty (an EOA; its nonce is shown) or an EIP-7702 delegation (`0xef0100…`) |
| 🕸️ **STALE** | The contract is alive but forgotten. | No transaction or token transfer for `--stale-days` (default **180**), `paused()` returns true, or the explorer name/tag says *deprecated* |
| 🟢 **ALIVE** | Recent activity, or no evidence against it. | Known protocol list (Permit2, Seaport, 1inch, Uniswap, PancakeSwap…), explorer activity, or an RPC probe of the last few hours |

Revoke the zombies and ghosts first. Stale ones are a judgement call: if you will never use that dApp again,
revoke it too. Alive ones are listed with `--all`.

## Install

```bash
# no install needed, Node 18+
npx github:DaddyUnikii/zombiescan 0xYourWallet -c eth

# or clone it
git clone https://github.com/DaddyUnikii/zombiescan && cd zombiescan
node bin/zombiescan.js 0xYourWallet -c bsc
```

Zero dependencies. Read-only: zombiescan never asks for a private key and never signs or sends anything.

## Usage

```text
zombiescan <address> [options]

  -c, --chain <list>     chains to scan, comma separated (default: bsc)
                         eth, bsc, base, arb, op, polygon, or "all"
  -d, --days <n>         history to read when only RPC is available (default: 3)
  -s, --stale-days <n>   a contract idle this long is STALE (default: 180)
      --probe-hours <n>  RPC-only chains: look this far back for signs of life (default: 6, 0 = off)
      --rpc <url>        use your own RPC (single chain only)
  -a, --all              also list approvals to spenders that are ALIVE
      --calldata         print the revoke calldata for each approval (never sent)
      --fail-on <level>  exit 2 if anything is at/above zombie|ghost|stale (for CI)
      --json             machine-readable output
      --markdown         markdown table (great for GitHub job summaries)
  -v, --version          print the version
```

```bash
zombiescan 0xYourWallet -c all                    # every chain
zombiescan 0xYourWallet -c eth --stale-days 365   # only call it stale after a year
zombiescan 0xYourWallet -c bsc --calldata         # revoke data to paste into your wallet
zombiescan 0xYourWallet -c base --json | jq '.approvals[] | select(.level=="ZOMBIE")'
zombiescan 0xYourWallet --fail-on ghost           # exit 2 in CI if a zombie or ghost shows up
```

`--calldata` prints exactly what your wallet would send, so you can revoke from any wallet that accepts raw data:

| Approval | Revoke call |
|---|---|
| ERC-20 allowance | `approve(spender, 0)` on the token |
| ERC-721 / ERC-1155 operator | `setApprovalForAll(operator, false)` on the collection |
| single ERC-721 token | `approve(0x0000…0000, tokenId)` on the collection |

Set `ETHERSCAN_API_KEY` (free at etherscan.io) for full approval history and activity checks on every chain.

## Run it from your phone 📱

The **Scan wallet** workflow runs zombiescan on GitHub Actions and writes the report into the run summary.

1. Fork this repo (optional: add an `ETHERSCAN_API_KEY` secret under *Settings → Secrets and variables → Actions*).
2. Open **Actions → Scan wallet → Run workflow** in the GitHub app.
3. Paste your address, pick chains (`bsc`, `eth`, `all`…), stale days, and whether you want revoke calldata.
4. Open the run: the 🧟 / 👻 / 🕸️ table is in the summary, with one annotation per chain.

## How it works

1. **Find approvals.** `Approval` and `ApprovalForAll` events where your wallet is the owner, from Etherscan v2 (with a key),
   keyless Blockscout, or parallel chunked `eth_getLogs` on public RPCs that accept topic-only queries
   (48 Club on BNB Chain, Tenderly gateways elsewhere). Ranges an RPC refuses are split; busy chunks are retried.
2. **Keep only what is live.** The latest event per token × spender (× tokenId) is re-checked on-chain with
   `allowance`, `isApprovedForAll` or `getApproved`. Revoked or spent approvals drop out.
3. **Knock on every spender's door.** `eth_getCode`, the nonce, EIP-1167 / EIP-1967 / beacon / legacy proxy slots,
   the implementation's code, `paused()`, `eth_getCode` at the approval block on an archive RPC, and the spender's
   last transaction and token transfer on the explorer.
4. **Classify** each approval as ZOMBIE / GHOST / STALE / ALIVE with the reasons, newest first.

## Limitations

- Without `ETHERSCAN_API_KEY`, history depends on keyless sources. Blockscout answers for Ethereum and Optimism
  (Base, Arbitrum and Polygon are often behind a Cloudflare check for scripts); otherwise only the last `--days` of
  RPC logs are read. The public BNB Chain log RPC keeps about 6 days, so longer `--days` there is clamped.
- Proving a contract self-destructed needs an archive RPC (Tenderly gateways for Ethereum, Base, Optimism and Polygon)
  or an explorer creator record. Where neither exists, an empty spender is reported as a GHOST, not a ZOMBIE.
- Since the Cancun upgrade (EIP-6780), `SELFDESTRUCT` only removes code in the transaction that created the contract,
  so new zombies of that kind are rare; empty proxies, EOAs and abandoned contracts are not.
- Activity is the spender's own transactions and token transfers. A contract only ever called internally by
  another contract can look STALE while still in use; check before you revoke something you rely on.
- On RPC-only chains, an unknown contract with nothing in the probe window stays ALIVE but is marked unsure.
- The exploited-spender list is deliberately short and sourced. It is not a substitute for a security feed.

## Development

```bash
npm test          # node:test, no dependencies, no network
```

CI runs the tests on Node 18, 20 and 22.

## Related

- [approvalscan](https://github.com/DaddyUnikii/approvalscan): every live approval, ranked HIGH / MEDIUM / LOW
- [poisonwatch](https://github.com/DaddyUnikii/poisonwatch): catch address-poisoning lookalikes
- [revoke.cash](https://revoke.cash): revoke in a browser

---

Built for the DEV Community *Ghost in the Machine* challenge 🎃: forgotten tech that still holds the keys to your wallet.
Written with AI assistance (Hark); every line was reviewed and the demo output above is from a real scan.

MIT © Unikii
