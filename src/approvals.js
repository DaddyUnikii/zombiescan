// Turns approval logs into the approvals that are live right now.
import { TOPIC_APPROVAL, TOPIC_APPROVAL_FOR_ALL } from './sources.js';
import { encodeCall, topicToAddress, toBig, decodeString, UNLIMITED_FLOOR, word } from './hex.js';

export const SEL = {
  allowance: '0xdd62ed3e', isApprovedForAll: '0xe985e9c5', getApproved: '0x081812fc',
  symbol: '0x95d89b41', name: '0x06fdde03', decimals: '0x313ce567', balanceOf: '0x70a08231',
  approve: '0x095ea7b3', setApprovalForAll: '0xa22cb465',
};
const ZERO = '0x0000000000000000000000000000000000000000';

/** Latest approval per (token, spender[, tokenId]); drops ones the last event already revoked. */
export function collapse(logs) {
  const sorted = [...logs].sort((a, b) =>
    parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) || parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16));
  const latest = new Map();
  for (const l of sorted) {
    const t = l.topics.filter(Boolean);
    const token = l.address.toLowerCase();
    const base = { token, tx: l.transactionHash, block: parseInt(l.blockNumber, 16),
      timestamp: l.timeStamp ? parseInt(l.timeStamp, 16) : null };
    if (t[0] === TOPIC_APPROVAL_FOR_ALL && t.length >= 3) {
      const spender = topicToAddress(t[2]);
      latest.set(`all:${token}:${spender}`, { ...base, kind: 'all', spender, granted: toBig(l.data) !== 0n });
    } else if (t[0] === TOPIC_APPROVAL && t.length === 4) {
      const tokenId = BigInt(t[3]);
      latest.set(`nft:${token}:${tokenId}`, { ...base, kind: 'nft', spender: topicToAddress(t[2]), tokenId });
    } else if (t[0] === TOPIC_APPROVAL && t.length === 3) {
      const spender = topicToAddress(t[2]);
      latest.set(`erc20:${token}:${spender}`, { ...base, kind: 'erc20', spender, amount: toBig(word(l.data, 0)) });
    }
  }
  return [...latest.values()].filter((a) =>
    (a.kind === 'all' && a.granted) || (a.kind === 'erc20' && a.amount > 0n) || (a.kind === 'nft' && a.spender !== ZERO));
}

export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export const ethCall = (rpc, to, data, block = 'latest') => rpc.call('eth_call', [{ to, data }, block]).catch(() => null);

/** Re-reads every candidate on-chain, so the report shows what is live now, not what the logs once said. */
export async function verify(candidates, { rpc, owner, concurrency = 4 }) {
  const meta = new Map();
  const tokens = [...new Set(candidates.map((c) => c.token))];
  await pool(tokens, concurrency, async (t) => {
    const [sym, nm, dec] = await Promise.all([ethCall(rpc, t, SEL.symbol), ethCall(rpc, t, SEL.name), ethCall(rpc, t, SEL.decimals)]);
    meta.set(t, { symbol: decodeString(sym), name: decodeString(nm), decimals: dec && dec !== '0x' ? Number(toBig(dec)) : null });
  });
  const live = await pool(candidates, concurrency, async (c) => {
    const m = meta.get(c.token) || {};
    const r = { ...c, symbol: m.symbol, tokenName: m.name, decimals: m.decimals };
    if (c.kind === 'erc20') {
      const now = await ethCall(rpc, c.token, encodeCall(SEL.allowance, owner, c.spender));
      if (now === null) return null;
      r.amount = toBig(now);
      if (r.amount === 0n) return null;
      r.unlimited = r.amount >= UNLIMITED_FLOOR;
      const bal = await ethCall(rpc, c.token, encodeCall(SEL.balanceOf, owner));
      r.balance = bal === null ? null : toBig(bal);
    } else if (c.kind === 'all') {
      const now = await ethCall(rpc, c.token, encodeCall(SEL.isApprovedForAll, owner, c.spender));
      if (now === null || toBig(now) === 0n) return null;
    } else {
      const now = await ethCall(rpc, c.token, encodeCall(SEL.getApproved, c.tokenId));
      if (now === null || topicToAddress(now) !== c.spender) return null;
    }
    return r;
  });
  return live.filter(Boolean);
}

export async function fillTimestamps(list, rpc, max = 60) {
  const blocks = [...new Set(list.filter((a) => !a.timestamp).map((a) => a.block))].slice(0, max);
  const ts = new Map();
  await pool(blocks, 4, async (b) => {
    const blk = await rpc.call('eth_getBlockByNumber', ['0x' + b.toString(16), false]).catch(() => null);
    if (blk) ts.set(b, parseInt(blk.timestamp, 16));
  });
  for (const a of list) if (!a.timestamp && ts.has(a.block)) a.timestamp = ts.get(a.block);
}

/** Calldata the wallet would send to revoke. zombiescan itself never signs or sends anything. */
export function revokeCalldata(a) {
  if (a.kind === 'erc20') return { to: a.token, data: encodeCall(SEL.approve, a.spender, 0n), fn: `approve(${a.spender}, 0)` };
  if (a.kind === 'all') return { to: a.token, data: encodeCall(SEL.setApprovalForAll, a.spender, 0n), fn: `setApprovalForAll(${a.spender}, false)` };
  return { to: a.token, data: encodeCall(SEL.approve, ZERO, a.tokenId), fn: `approve(${ZERO}, ${a.tokenId})` };
}
