import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapse, verify, revokeCalldata } from '../src/approvals.js';
import { TOPIC_APPROVAL, TOPIC_APPROVAL_FOR_ALL, fetchApprovalLogs } from '../src/sources.js';
import { pad32, MAX_UINT } from '../src/hex.js';
import { resolveChain } from '../src/chains.js';

const OWNER = '0x' + '11'.repeat(20);
const SPENDER = '0x' + '22'.repeat(20);
const TOKEN = '0x' + '33'.repeat(20);
const NFT = '0x' + '44'.repeat(20);
const t = (a) => '0x' + pad32(a);
const hex = (n) => '0x' + n.toString(16);
const log = (o) => ({ transactionHash: '0x' + String(o.i).padStart(64, '0'), logIndex: hex(o.i), blockNumber: hex(o.block), ...o });

test('collapse keeps only the latest approval and drops revoked ones', () => {
  const logs = [
    log({ i: 1, block: 10, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x5') }),
    log({ i: 2, block: 20, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x0') }),
    log({ i: 3, block: 30, address: NFT, topics: [TOPIC_APPROVAL_FOR_ALL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x1') }),
    log({ i: 4, block: 31, address: NFT, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER), '0x' + pad32('0x7')], data: '0x' }),
  ];
  const out = collapse(logs);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.kind).sort(), ['all', 'nft']);
  assert.equal(out.find((a) => a.kind === 'nft').tokenId, 7n);
});

test('collapse sorts by block before picking the latest', () => {
  const logs = [
    log({ i: 2, block: 20, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x9') }),
    log({ i: 1, block: 10, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x0') }),
  ];
  const [a] = collapse(logs);
  assert.equal(a.amount, 9n);
});

function fakeRpc(handlers) {
  return { call: async (m, p) => { const h = handlers[m]; if (!h) throw new Error('no ' + m); return h(p); } };
}

test('verify re-reads allowances on-chain and drops ones that are zero now', async () => {
  const other = '0x' + '55'.repeat(20);
  const cands = [
    { kind: 'erc20', token: TOKEN, spender: SPENDER, amount: 5n, block: 1 },
    { kind: 'erc20', token: TOKEN, spender: other, amount: 5n, block: 1 },
  ];
  const rpc = fakeRpc({
    eth_call: ([{ data }]) => {
      if (data.startsWith('0xdd62ed3e')) return data.includes(pad32(SPENDER)) ? '0x' + MAX_UINT.toString(16) : '0x' + pad32('0x0');
      if (data === '0x313ce567') return '0x' + pad32('0x12');
      if (data.startsWith('0x70a08231')) return '0x' + pad32('0x0');
      return '0x';
    },
  });
  const live = await verify(cands, { rpc, owner: OWNER });
  assert.equal(live.length, 1);
  assert.equal(live[0].spender, SPENDER);
  assert.equal(live[0].unlimited, true);
  assert.equal(live[0].decimals, 18);
});

test('revoke calldata: approve(spender,0), setApprovalForAll(op,false), approve(0x0,id)', () => {
  const e = revokeCalldata({ kind: 'erc20', token: TOKEN, spender: SPENDER });
  assert.equal(e.to, TOKEN);
  assert.equal(e.data, '0x095ea7b3' + pad32(SPENDER) + '0'.repeat(64));
  const all = revokeCalldata({ kind: 'all', token: NFT, spender: SPENDER });
  assert.equal(all.data, '0xa22cb465' + pad32(SPENDER) + '0'.repeat(64));
  assert.match(all.fn, /setApprovalForAll\(.*, false\)/);
  const one = revokeCalldata({ kind: 'nft', token: NFT, spender: SPENDER, tokenId: 7n });
  assert.equal(one.data, '0x095ea7b3' + '0'.repeat(64) + pad32('0x7'));
});

test('fetchApprovalLogs falls back to chunked RPC logs when no explorer answers', async () => {
  const chain = resolveChain('bsc');
  const calls = [];
  const rpc = fakeRpc({
    eth_blockNumber: () => hex(10000),
    eth_getLogs: ([q]) => {
      calls.push(q);
      if (parseInt(q.toBlock, 16) - parseInt(q.fromBlock, 16) >= 2500) throw new Error('block range too large');
      return parseInt(q.fromBlock, 16) === 9000 ? [log({ i: 1, block: 9001, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' })] : [];
    },
  });
  const r = await fetchApprovalLogs({ chain, owner: OWNER, rpc, days: 0.006 });
  assert.equal(r.full, false);
  assert.match(r.source, /^rpc/);
  assert.ok(calls.every((q) => q.topics[1] === t(OWNER)));
});

test('fetchApprovalLogs uses the explorer when it answers', async () => {
  const chain = resolveChain('eth');
  const row = log({ i: 1, block: 5, address: TOKEN, topics: [TOPIC_APPROVAL, t(OWNER), t(SPENDER)], data: '0x' + pad32('0x1') });
  const fetchImpl = async (url) => ({ status: 200, text: async () => JSON.stringify(url.includes(TOPIC_APPROVAL) ? { message: 'OK', result: [row] } : { message: 'No logs found', result: [] }) });
  const r = await fetchApprovalLogs({ chain, owner: OWNER, rpc: null, fetchImpl });
  assert.equal(r.source, 'blockscout');
  assert.equal(r.logs.length, 1);
});
