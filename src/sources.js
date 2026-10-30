// Where approval events come from. Best history first:
//   1. Etherscan v2 (any chain, full history) when ETHERSCAN_API_KEY is set
//   2. Blockscout's keyless etherscan-compatible API (full history) where the chain has one
//   3. Plain eth_getLogs over the last N days, chunked to fit public RPC limits
import { pad32 } from './hex.js';

export const TOPIC_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
export const TOPIC_APPROVAL_FOR_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';
export const TOPIC_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET an etherscan-style endpoint; retries rate limits, returns body.result (array) or throws. */
let nextSlot = 0;
async function gate(gapMs) { // one explorer request at a time, spaced out: free tiers allow a few per second
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gapMs;
  if (at > now) await sleep(at - now);
}

const exhausted = new Set(); // explorers that kept rate-limiting us this run: stop asking, fall back to RPC

export async function explorerGet(url, { fetchImpl = globalThis.fetch, label = 'explorer', gapMs = 350 } = {}) {
  const host = new URL(url).host;
  if (exhausted.has(host)) throw new Error(`${label}: rate-limited earlier in this run`);
  let res, text;
  for (let attempt = 0; ; attempt++) {
    if (fetchImpl === globalThis.fetch) await gate(gapMs);
    res = await fetchImpl(url);
    text = await res.text();
    const limited = res.status === 429 || /rate limit|too many|max calls|something went wrong/i.test(text);
    if (!limited) break;
    if (attempt >= 4) { exhausted.add(host); break; }
    await sleep(2500 * (attempt + 1)); // keyless explorers and free keys rate-limit per IP
  }
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${label} returned non-JSON (HTTP ${res.status})`); }
  if (Array.isArray(body.result)) return body.result;
  if (/no (records|transactions)/i.test(body.message || '') || /no (records|transactions)/i.test(String(body.result || ''))) return [];
  throw new Error(`${label}: ${typeof body.result === 'string' ? body.result : body.message || 'bad response'}`);
}

export const withQuery = (base, params) => `${base}${base.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`;

async function explorerLogs(base, params, fetchImpl, label) {
  const out = [];
  let from = 0;
  for (let page = 0; page < 20; page++) {
    const rows = await explorerGet(withQuery(base, { module: 'logs', action: 'getLogs', fromBlock: String(from), toBlock: 'latest', ...params }), { fetchImpl, label });
    out.push(...rows);
    if (rows.length < 1000) break;
    await sleep(1200); // be gentle with keyless explorers between pages
    from = parseInt(rows[rows.length - 1].blockNumber, 16); // continue from the last block; duplicates are removed later
  }
  return out;
}

/** Explorer bases to try for a chain, best first: [[label, base], ...]. */
export function explorerBases(chain, apiKey) {
  const out = [];
  if (apiKey) out.push(['etherscan', `https://api.etherscan.io/v2/api?chainid=${chain.id}&apikey=${apiKey}`]);
  if (chain.blockscout) out.push(['blockscout', chain.blockscout]);
  return out;
}

export async function fetchApprovalLogs({ chain, owner, rpc, days = 3, fetchImpl = globalThis.fetch, apiKey, onProgress = () => {} }) {
  const ownerTopic = '0x' + pad32(owner);
  const errors = [];
  for (const [label, base] of explorerBases(chain, apiKey)) {
    try {
      const logs = [];
      for (const t0 of [TOPIC_APPROVAL, TOPIC_APPROVAL_FOR_ALL]) {
        logs.push(...(await explorerLogs(base, { topic0: t0, topic1: ownerTopic, topic0_1_opr: 'and' }, fetchImpl, label)));
      }
      return { logs: dedupe(logs), source: label, full: true, errors };
    } catch (e) { errors.push(e.message); }
  }
  const logs = await rpcLogs({ rpc, chain, topics: [[TOPIC_APPROVAL, TOPIC_APPROVAL_FOR_ALL], ownerTopic], days, onProgress });
  return { logs: dedupe(logs), source: `rpc (last ${days}d)`, full: false, errors };
}

/**
 * eth_getLogs over the last `days` (or `blocks`), in parallel chunks.
 * A chunk an RPC refuses (range or result caps differ per provider) is split in half and retried.
 */
export async function rpcLogs({ rpc, chain, topics, days, blocks, address, onProgress = () => {}, step = 5000, concurrency = 3 }) {
  const latest = parseInt(await rpc.call('eth_blockNumber', []), 16);
  const span = blocks ?? Math.ceil((days * 86400) / chain.blockTime);
  const start = Math.max(0, latest - span);
  const queue = [];
  for (let from = start; from <= latest; from += step) queue.push([from, Math.min(latest, from + step - 1)]);
  const total = latest - start + 1;
  let done = 0;
  const logs = [];
  const worker = async () => {
    while (queue.length) {
      const [from, to, tries = 0] = queue.shift();
      try {
        const got = await rpc.call('eth_getLogs', [{
          fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics, ...(address ? { address } : {}),
        }]);
        logs.push(...got);
        done += to - from + 1;
        onProgress(done / total);
      } catch (e) {
        if (!e.range && tries < 3) { await sleep(2000 * (tries + 1)); queue.push([from, to, tries + 1]); continue; } // busy RPC: retry later
        if (to - from + 1 <= 250) { e.message = `no RPC could serve blocks ${from}-${to} (${e.message})`; throw e; }
        const mid = from + Math.floor((to - from) / 2);
        queue.unshift([from, mid], [mid + 1, to]);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return logs;
}

function dedupe(logs) {
  const seen = new Set();
  return logs.filter((l) => {
    const k = `${l.transactionHash}:${parseInt(l.logIndex, 16)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
