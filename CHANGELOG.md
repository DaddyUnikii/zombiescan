# Changelog

## Unreleased

- `--chains` lists the supported chains (key, chain id, native coin) and how far each one reads history without an `ETHERSCAN_API_KEY`; add `--json` for machine-readable output. Works offline.

## 0.1.0 — 2026-10-30

- First release: find live ERC-20 / ERC-721 / ERC-1155 approvals on Ethereum, BNB Chain, Base, Arbitrum, Optimism and Polygon, and say which spenders are ghosts.
- Approval history from Etherscan v2 (with key), keyless Blockscout, or parallel chunked `eth_getLogs`; every approval is re-checked on-chain so only live ones are reported.
- Levels: 🧟 ZOMBIE (self-destructed spender, proxy with an empty implementation, documented exploit, explorer scam flag), 👻 GHOST (EOA / EIP-7702 wallet / nothing deployed), 🕸️ STALE (idle for `--stale-days`, paused, deprecated name), 🟢 ALIVE.
- Proxy detection for EIP-1167 clones, EIP-1967 implementation and beacon slots and the OpenZeppelin legacy slot.
- Self-destruct proof via `eth_getCode` at the approval block on archive RPCs, or an explorer creator record.
- RPC-only chains probe the last `--probe-hours` for signs of life; unchecked ones are counted as "not fully checked".
- Terminal table, `--json`, `--markdown`, `--calldata` (revoke data, never sent), `--fail-on zombie|ghost|stale`, `--all`, `--version`.
- "Scan wallet" GitHub Actions workflow to run a scan from a phone, with the report in the run summary.
