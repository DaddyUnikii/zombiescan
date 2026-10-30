import { fetchApprovalLogs } from './sources.js';
import { collapse, verify, fillTimestamps } from './approvals.js';
import { inspectSpenders, classify, RANK } from './ghost.js';
import { makeRpc } from './rpc.js';

/** Finds live approvals for `owner` on one chain and says which spenders are ghosts. */
export async function scan({ chain, owner, rpc, archive, days = 3, staleDays = 180, probeHours = 6, apiKey, fetchImpl, onProgress, now = Date.now() / 1000 }) {
  const { logs, source, full, errors } = await fetchApprovalLogs({ chain, owner, rpc, days, apiKey, fetchImpl, onProgress });
  const live = await verify(collapse(logs), { rpc, owner });
  await fillTimestamps(live, rpc);
  const lastBlock = new Map();
  for (const a of live) lastBlock.set(a.spender, Math.max(lastBlock.get(a.spender) || 0, a.block));
  const archiveRpc = archive ?? (chain.archive?.length ? makeRpc(chain.archive, { retries: 0, fetchImpl }) : null);
  const probeBlocks = Math.ceil((probeHours * 3600) / chain.blockTime);
  const facts = await inspectSpenders(lastBlock, { rpc, archive: archiveRpc, chain, apiKey, fetchImpl, probeBlocks, now });
  const approvals = live.map((a) => {
    const f = facts.get(a.spender);
    const c = classify(f, { staleDays, now });
    return { ...a, spenderName: f.name || f.explorer?.contractName || f.flagged?.name || null, level: c.level, reasons: c.reasons, unsure: Boolean(c.unsure), spenderInfo: f };
  }).sort((a, b) => RANK[a.level] - RANK[b.level] || (b.timestamp || 0) - (a.timestamp || 0));
  const counts = { ZOMBIE: 0, GHOST: 0, STALE: 0, ALIVE: 0 };
  for (const a of approvals) counts[a.level]++;
  return { chain: chain.key, chainId: chain.id, owner, source, fullHistory: full, sourceErrors: errors, events: logs.length, staleDays, counts, approvals };
}
