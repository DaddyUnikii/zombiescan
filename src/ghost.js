// Ghost hunting: for every spender that still holds an approval, find out whether anything is really there.
//
//   ZOMBIE  the spender WAS a contract and its code is gone (self-destructed), it is a proxy whose
//           implementation has no code, or it is a contract with a documented approval-draining exploit
//   GHOST   the spender has no contract code at all: a plain wallet (EOA), an EIP-7702 delegated wallet,
//           or an address nothing was ever deployed to. A private key, not a protocol, holds your allowance.
//   STALE   a live contract that has done nothing for --stale-days (default 180), is paused,
//           or whose verified name says it is deprecated
//   ALIVE   a contract with recent activity (or no evidence against it)
import { strip, topicToAddress, toBig } from './hex.js';
import { pool, ethCall } from './approvals.js';
import { explorerGet, withQuery, rpcLogs, TOPIC_TRANSFER } from './sources.js';
import { knownSpender, flaggedSpender } from './known.js';

export const LEVELS = ['ZOMBIE', 'GHOST', 'STALE', 'ALIVE'];
export const RANK = { ZOMBIE: 0, GHOST: 1, STALE: 2, ALIVE: 3 };

export const SLOTS = {
  eip1967: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  ozLegacy: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
};
const SEL_IMPLEMENTATION = '0x5c60da1b';
const SEL_PAUSED = '0x5c975abb';
const ZERO = '0x0000000000000000000000000000000000000000';
const DEPRECATED_NAME = /deprecat|legacy|exploit|hacked|do.?not.?use|old_?router/i;

/** What a piece of bytecode is: nothing, an EIP-7702 delegation, an EIP-1167 minimal proxy, or real code. */
export function parseCode(code) {
  const c = strip(code || '').toLowerCase();
  if (!c) return { type: 'none' };
  let m = c.match(/^ef0100([0-9a-f]{40})$/);
  if (m) return { type: 'delegated', target: '0x' + m[1] };
  m = c.match(/^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/); // EIP-1167
  if (m) return { type: 'minimal', target: '0x' + m[1] };
  m = c.match(/^3d3d3d3d363d3d37363d73([0-9a-f]{40})5af43d3d93803e602a57fd5bf3$/); // 0age's optimized clone
  if (m) return { type: 'minimal', target: '0x' + m[1] };
  return { type: 'code', size: c.length / 2 };
}

const slotAddress = (v) => {
  const s = strip(v || '');
  if (!s || /^0*$/.test(s)) return null;
  const a = topicToAddress(s.padStart(64, '0'));
  return a === ZERO ? null : a;
};
const hasCode = async (rpc, a, block = 'latest') => {
  const c = await rpc.call('eth_getCode', [a, block]).catch(() => null);
  return c === null ? null : strip(c) !== '';
};

/** Finds the implementation behind a proxy spender (EIP-1167, EIP-1967 impl/beacon, OpenZeppelin legacy). */
export async function findProxy(rpc, address, parsed) {
  if (parsed.type === 'minimal') return { type: 'EIP-1167 clone', implementation: parsed.target };
  if (parsed.type !== 'code') return null;
  const read = (slot) => rpc.call('eth_getStorageAt', [address, slot, 'latest']).catch(() => null);
  const [impl, beacon, legacy] = await Promise.all([read(SLOTS.eip1967), read(SLOTS.beacon), read(SLOTS.ozLegacy)]);
  if (slotAddress(impl)) return { type: 'EIP-1967 proxy', implementation: slotAddress(impl) };
  if (slotAddress(beacon)) {
    const b = slotAddress(beacon);
    const r = await ethCall(rpc, b, SEL_IMPLEMENTATION);
    return { type: 'EIP-1967 beacon proxy', beacon: b, implementation: r && strip(r).length >= 64 ? slotAddress(r) : null };
  }
  if (slotAddress(legacy)) return { type: 'OpenZeppelin proxy', implementation: slotAddress(legacy) };
  return null;
}

/** Last activity + identity from an explorer. Returns null when the explorer can't be reached. */
export async function explorerFacts(address, { chain, apiKey, fetchImpl = globalThis.fetch }) {
  const bases = [];
  if (apiKey) bases.push(['etherscan', `https://api.etherscan.io/v2/api?chainid=${chain.id}&apikey=${apiKey}`]);
  if (chain.blockscout) bases.push(['blockscout', chain.blockscout]);
  for (const [label, base] of bases) {
    try {
      const q = (action) => withQuery(base, { module: 'account', action, address, page: '1', offset: '1', sort: 'desc' });
      const txs = await explorerGet(q('txlist'), { fetchImpl, label });
      const toks = await explorerGet(q('tokentx'), { fetchImpl, label });
      const times = [...txs, ...toks].map((r) => Number(r.timeStamp)).filter((t) => t > 0);
      const facts = { source: label, lastActivity: times.length ? Math.max(...times) : null, everActive: times.length > 0 };
      if (label === 'etherscan') {
        const created = await explorerGet(withQuery(base, { module: 'contract', action: 'getcontractcreation', contractaddresses: address }), { fetchImpl, label }).catch(() => []);
        facts.createdBy = created[0]?.contractCreator ? created[0].contractCreator.toLowerCase() : null;
        const src = await explorerGet(withQuery(base, { module: 'contract', action: 'getsourcecode', address }), { fetchImpl, label }).catch(() => []);
        facts.contractName = src[0]?.ContractName || null;
      } else {
        try {
          const res = await fetchImpl(base.replace(/\/api$/, '/api/v2') + '/addresses/' + address);
          if (res.ok) {
            const j = await res.json();
            facts.createdBy = j.creator_address_hash ? j.creator_address_hash.toLowerCase() : null;
            facts.contractName = j.name || null;
            facts.tags = [...(j.public_tags || []).map((t) => t.display_name || t.label), ...((j.metadata?.tags) || []).map((t) => t.name)].filter(Boolean);
            facts.scam = Boolean(j.is_scam);
          }
        } catch { /* identity is a bonus; activity is what matters */ }
      }
      return facts;
    } catch { /* try the next explorer */ }
  }
  return null;
}

/** Looks for token movement through, or events from, the given contracts in the last `blocks` blocks. */
export async function probeRecent(addresses, { rpc, chain, blocks }) {
  const seen = new Map();
  if (!addresses.length) return seen;
  const topic = addresses.map((a) => '0x' + a.slice(2).padStart(64, '0'));
  const note = (logs, pick) => { for (const l of logs) { const a = pick(l); if (a && addresses.includes(a)) seen.set(a, Math.max(seen.get(a) || 0, parseInt(l.blockNumber, 16))); } };
  const tasks = [
    () => rpcLogs({ rpc, chain, blocks, topics: [TOPIC_TRANSFER, topic] }).then((l) => note(l, (x) => x.topics[1] && topicToAddress(x.topics[1]))),
    () => rpcLogs({ rpc, chain, blocks, topics: [TOPIC_TRANSFER, null, topic] }).then((l) => note(l, (x) => x.topics[2] && topicToAddress(x.topics[2]))),
    () => rpcLogs({ rpc, chain, blocks, topics: [], address: addresses }).then((l) => note(l, (x) => x.address.toLowerCase())),
  ];
  for (const t of tasks) await t().catch(() => {}); // a probe that fails just leaves activity unknown
  return seen;
}

/**
 * Collects the facts about each spender.
 * approvalsBySpender: Map(spender -> latest approval block), used to ask an archive node what lived there back then.
 */
export async function inspectSpenders(approvalsBySpender, { rpc, archive, chain, apiKey, fetchImpl, probeBlocks, now = Date.now() / 1000, concurrency = 3 }) {
  const spenders = [...approvalsBySpender.keys()];
  const info = new Map();
  await pool(spenders, concurrency, async (s) => {
    const i = { address: s, name: knownSpender(s, chain.id), flagged: flaggedSpender(s, chain.id) };
    const code = await rpc.call('eth_getCode', [s, 'latest']).catch(() => null);
    i.code = code === null ? null : parseCode(code);
    if (i.code?.type === 'none' || i.code?.type === 'delegated') {
      i.nonce = await rpc.call('eth_getTransactionCount', [s, 'latest']).then((n) => parseInt(n, 16)).catch(() => null);
      if (i.code.type === 'none' && archive) {
        i.codeAtApproval = await hasCode(archive, s, '0x' + approvalsBySpender.get(s).toString(16));
      }
    }
    if (i.code && (i.code.type === 'code' || i.code.type === 'minimal')) {
      i.proxy = await findProxy(rpc, s, i.code);
      if (i.proxy?.implementation) i.proxy.implHasCode = await hasCode(rpc, i.proxy.implementation);
      const p = await ethCall(rpc, s, SEL_PAUSED);
      i.paused = p !== null && strip(p).length === 64 ? toBig(p) === 1n : null;
    }
    if (!i.name && !i.flagged) i.explorer = await explorerFacts(s, { chain, apiKey, fetchImpl });
    info.set(s, i);
  });
  // RPC fallback for contracts no explorer could speak for: did anything move through them lately?
  const unknown = [...info.values()].filter((i) => !i.name && !i.explorer && i.code && i.code.type !== 'none' && i.code.type !== 'delegated').map((i) => i.address);
  if (unknown.length && probeBlocks > 0) {
    const seen = await probeRecent(unknown, { rpc, chain, blocks: probeBlocks });
    for (const a of unknown) info.get(a).probe = { blocks: probeBlocks, hours: Math.round((probeBlocks * chain.blockTime) / 3600), lastBlock: seen.get(a) || null };
  }
  for (const i of info.values()) i.checkedAt = now;
  return info;
}

const days = (secs) => Math.floor(secs / 86400);

/** Turns the facts about one spender into a level and the reasons for it. */
export function classify(i, { staleDays = 180, now = Date.now() / 1000 } = {}) {
  const reasons = [];
  const x = i.explorer || {};
  if (i.flagged) return { level: 'ZOMBIE', reasons: [i.flagged.why] };
  if (i.code === null) return { level: 'ALIVE', reasons: ['could not read spender code (RPC error)'], unsure: true };
  if (i.code.type === 'none') {
    if (i.codeAtApproval === true || x.createdBy) {
      reasons.push('spender was a contract and its code is gone (self-destructed)');
      reasons.push('if it was deployed with CREATE2, anyone who redeploys it at this address inherits your allowance');
      return { level: 'ZOMBIE', reasons };
    }
    if (i.nonce > 0) reasons.push(`spender is a plain wallet (EOA, ${i.nonce} txs sent): whoever holds that key can pull your tokens`);
    else reasons.push('spender has no code and has never sent a transaction (undeployed contract, destroyed contract or unused key)');
    return { level: 'GHOST', reasons };
  }
  if (i.code.type === 'delegated') {
    reasons.push(`spender is a wallet with an EIP-7702 delegation to ${i.code.target}: a private key holds this allowance`);
    return { level: 'GHOST', reasons };
  }
  if (i.proxy && i.proxy.implementation === null) return { level: 'ZOMBIE', reasons: [`${i.proxy.type} with no implementation set`] };
  if (i.proxy && i.proxy.implHasCode === false) {
    return { level: 'ZOMBIE', reasons: [`${i.proxy.type} points at ${i.proxy.implementation}, which has no code`, 'calls to it do nothing today, but whoever controls the proxy can bring it back'] };
  }
  if (x.scam) return { level: 'ZOMBIE', reasons: [`explorer marks this spender as a scam${x.tags?.length ? ' (' + x.tags.join(', ') + ')' : ''}`] };
  const label = [x.contractName, ...(x.tags || [])].find((t) => t && DEPRECATED_NAME.test(t));
  if (label) reasons.push(`explorer name/tag says "${label}"`);
  if (i.paused) reasons.push('contract is paused');
  let stale = Boolean(label || i.paused);
  if (i.name) return { level: stale ? 'STALE' : 'ALIVE', reasons: stale ? reasons : [`known protocol: ${i.name}`] };
  if (i.explorer) {
    if (!x.everActive) { reasons.push('no transactions or token transfers ever recorded'); stale = true; }
    else {
      const idle = days(now - x.lastActivity);
      if (idle >= staleDays) { reasons.push(`no activity for ${idle} days (last ${new Date(x.lastActivity * 1000).toISOString().slice(0, 10)})`); stale = true; }
      else if (!stale) reasons.push(idle < 1 ? 'active today' : `last active ${idle}d ago`);
    }
    return { level: stale ? 'STALE' : 'ALIVE', reasons };
  }
  if (i.probe) {
    if (i.probe.lastBlock) { if (!stale) reasons.push(`moved tokens or emitted events in the last ${i.probe.hours}h`); }
    else reasons.push(`nothing seen in the last ${i.probe.hours}h (RPC probe only; set ETHERSCAN_API_KEY to check ${staleDays}d)`);
    return { level: stale ? 'STALE' : 'ALIVE', reasons, unsure: !i.probe.lastBlock && !stale };
  }
  reasons.push('activity unknown (no explorer for this chain; set ETHERSCAN_API_KEY)');
  return { level: stale ? 'STALE' : 'ALIVE', reasons, unsure: !stale };
}
