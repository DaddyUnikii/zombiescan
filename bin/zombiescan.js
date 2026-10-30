#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolveChain, CHAINS } from '../src/chains.js';
import { makeRpc } from '../src/rpc.js';
import { scan } from '../src/scan.js';
import { isAddress } from '../src/hex.js';
import { RANK } from '../src/ghost.js';
import { renderReport, toJSON, toMarkdown, summaryLine } from '../src/format.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `zombiescan ${VERSION} — find token approvals still held by ghosts: dead, empty or forgotten spenders.

Usage
  zombiescan <address> [options]

Options
  -c, --chain <list>     chains to scan, comma separated (default: bsc)
                         ${Object.keys(CHAINS).join(', ')}, or "all"
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
  -h, --help             show this help

Levels
  ZOMBIE  spender was a contract and its code is gone, is a proxy pointing at empty code,
          or has a documented exploit that drains approvals
  GHOST   spender has no contract code: a wallet key (EOA / EIP-7702) or nothing at all
  STALE   live contract with no activity for --stale-days, paused, or named deprecated
  ALIVE   contract with recent activity, or no evidence against it

Read-only: zombiescan never asks for a key and never signs or sends anything.
Set ETHERSCAN_API_KEY for full history and activity checks on every chain (free key, etherscan.io).`;

function parse(argv) {
  const o = { chain: 'bsc', days: 3, staleDays: 180, probeHours: 6 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-c' || a === '--chain') o.chain = next();
    else if (a === '-d' || a === '--days') o.days = Number(next());
    else if (a === '-s' || a === '--stale-days') o.staleDays = Number(next());
    else if (a === '--probe-hours') o.probeHours = Number(next());
    else if (a === '--rpc') o.rpc = next();
    else if (a === '-a' || a === '--all') o.all = true;
    else if (a === '--calldata') o.calldata = true;
    else if (a === '--fail-on') o.failOn = next().toUpperCase();
    else if (a === '--json') o.json = true;
    else if (a === '--markdown' || a === '--md') o.md = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else pos.push(a);
  }
  o.address = pos[0];
  return o;
}

async function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
  if (o.version) { console.log(VERSION); process.exit(0); }
  if (o.help || !o.address) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  if (!isAddress(o.address)) { console.error('not an EVM address: ' + o.address); process.exit(1); }
  if (!(o.days > 0)) { console.error('--days must be a positive number'); process.exit(1); }
  if (!(o.staleDays > 0)) { console.error('--stale-days must be a positive number'); process.exit(1); }
  if (!(o.probeHours >= 0)) { console.error('--probe-hours must be 0 or more'); process.exit(1); }
  if (o.failOn && !(o.failOn in RANK) || o.failOn === 'ALIVE') { console.error('--fail-on takes zombie, ghost or stale'); process.exit(1); }
  const keys = o.chain === 'all' ? Object.keys(CHAINS) : o.chain.split(',');
  if (o.rpc && keys.length > 1) { console.error('--rpc works with a single chain'); process.exit(1); }
  const owner = o.address.toLowerCase();
  const reports = [];
  let worst = 3;
  for (const k of keys) {
    let chain;
    try { chain = resolveChain(k.trim()); } catch (e) { console.error(e.message); process.exit(1); }
    const rpc = makeRpc(o.rpc ? [o.rpc] : chain.rpc);
    rpc.custom = Boolean(o.rpc);
    try {
      const r = await scan({ chain, owner, rpc, days: o.days, staleDays: o.staleDays, probeHours: o.probeHours, apiKey: process.env.ETHERSCAN_API_KEY,
        onProgress: o.json || o.md || !process.stderr.isTTY ? undefined : (p) => process.stderr.write(`\r  reading ${chain.key} approvals ${Math.round(p * 100)}%`) });
      if (!o.json && process.stderr.isTTY) process.stderr.write('\r\x1b[K');
      reports.push(r);
      for (const a of r.approvals) worst = Math.min(worst, RANK[a.level]);
      if (o.md) { console.log(toMarkdown(r, { showCalldata: o.calldata, showAll: o.all }) + '\n'); console.error(summaryLine(r)); }
      else if (!o.json) console.log(renderReport(r, { showCalldata: o.calldata, showAll: o.all }) + '\n');
    } catch (e) {
      reports.push({ chain: chain.key, error: e.message });
      if (!o.json) console.error(`${chain.key}: scan failed (${e.message}). Try --rpc <your url> or a smaller --days.\n`);
    }
  }
  if (o.json) console.log(toJSON(reports.length === 1 ? reports[0] : reports));
  if (reports.every((r) => r.error) || !reports.length) process.exit(1);
  if (o.failOn && worst <= RANK[o.failOn]) process.exit(2);
}

main();
