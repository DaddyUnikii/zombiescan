import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode, classify, findProxy, inspectSpenders, SLOTS } from '../src/ghost.js';
import { resolveChain } from '../src/chains.js';
import { pad32 } from '../src/hex.js';

const NOW = 1_790_000_000;
const IMPL = '0x' + 'ab'.repeat(20);
const S = '0x' + '22'.repeat(20);

test('parseCode tells empty, EIP-7702, EIP-1167 and real code apart', () => {
  assert.equal(parseCode('0x').type, 'none');
  assert.equal(parseCode('').type, 'none');
  assert.deepEqual(parseCode('0xef0100' + 'ab'.repeat(20)), { type: 'delegated', target: IMPL });
  assert.deepEqual(parseCode('0x363d3d373d3d3d363d73' + 'ab'.repeat(20) + '5af43d82803e903d91602b57fd5bf3'), { type: 'minimal', target: IMPL });
  assert.equal(parseCode('0x6080604052').type, 'code');
});

test('a spender that had code at approval time and has none now is a ZOMBIE', () => {
  const r = classify({ code: { type: 'none' }, codeAtApproval: true, nonce: 1 }, { now: NOW });
  assert.equal(r.level, 'ZOMBIE');
  assert.match(r.reasons[0], /self-destructed/);
});

test('an explorer-recorded creator also proves a dead contract', () => {
  assert.equal(classify({ code: { type: 'none' }, explorer: { createdBy: '0x1', everActive: true } }, { now: NOW }).level, 'ZOMBIE');
});

test('no code at all is a GHOST: EOA, never-used address, EIP-7702 wallet', () => {
  assert.match(classify({ code: { type: 'none' }, nonce: 12 }).reasons[0], /plain wallet/);
  assert.equal(classify({ code: { type: 'none' }, nonce: 0 }).level, 'GHOST');
  assert.equal(classify({ code: { type: 'delegated', target: IMPL } }).level, 'GHOST');
});

test('a proxy whose implementation has no code is a ZOMBIE', () => {
  const r = classify({ code: { type: 'code' }, proxy: { type: 'EIP-1967 proxy', implementation: IMPL, implHasCode: false } });
  assert.equal(r.level, 'ZOMBIE');
  assert.match(r.reasons[0], /no code/);
});

test('flagged exploited spenders are ZOMBIE regardless of activity', () => {
  assert.equal(classify({ code: { type: 'code' }, flagged: { why: 'exploited' } }).level, 'ZOMBIE');
});

test('STALE after --stale-days of silence, ALIVE before', () => {
  const idle = { code: { type: 'code' }, explorer: { everActive: true, lastActivity: NOW - 200 * 86400 } };
  assert.equal(classify(idle, { now: NOW, staleDays: 180 }).level, 'STALE');
  assert.equal(classify(idle, { now: NOW, staleDays: 365 }).level, 'ALIVE');
  assert.equal(classify({ code: { type: 'code' }, explorer: { everActive: false } }, { now: NOW }).level, 'STALE');
});

test('paused or deprecated-named contracts are STALE', () => {
  assert.equal(classify({ code: { type: 'code' }, paused: true, explorer: { everActive: true, lastActivity: NOW } }, { now: NOW }).level, 'STALE');
  assert.equal(classify({ code: { type: 'code' }, explorer: { contractName: 'DeprecatedRouter', everActive: true, lastActivity: NOW } }, { now: NOW }).level, 'STALE');
});

test('known protocols are ALIVE, RPC-only unknowns are ALIVE but marked unsure', () => {
  assert.equal(classify({ code: { type: 'code' }, name: 'Uniswap Permit2' }).level, 'ALIVE');
  const r = classify({ code: { type: 'code' }, probe: { hours: 24, lastBlock: null } });
  assert.equal(r.level, 'ALIVE');
  assert.equal(r.unsure, true);
  assert.ok(!classify({ code: { type: 'code' }, probe: { hours: 24, lastBlock: 5 } }).unsure);
});

const rpcWith = (state) => ({
  call: async (m, p) => {
    if (m === 'eth_getCode') { const v = state.code[p[0]]; if (v === undefined) return '0x'; return typeof v === 'object' ? v[p[1]] ?? v.latest : v; }
    if (m === 'eth_getStorageAt') return state.storage?.[p[1]] ?? '0x' + '0'.repeat(64);
    if (m === 'eth_getTransactionCount') return state.nonce?.[p[0]] ?? '0x0';
    if (m === 'eth_call') return '0x';
    if (m === 'eth_blockNumber') return '0x100';
    if (m === 'eth_getLogs') return [];
    throw new Error(m);
  },
});

test('findProxy reads the EIP-1967 implementation slot', async () => {
  const rpc = rpcWith({ code: {}, storage: { [SLOTS.eip1967]: '0x' + pad32(IMPL) } });
  assert.deepEqual(await findProxy(rpc, S, { type: 'code' }), { type: 'EIP-1967 proxy', implementation: IMPL });
});

test('inspectSpenders + classify end to end: dead contract, empty proxy, EOA', async () => {
  const DEAD = '0x' + 'de'.repeat(20), PROXY = '0x' + 'cc'.repeat(20), EOA = '0x' + 'ee'.repeat(20);
  const state = { code: { [DEAD]: '0x', [PROXY]: '0x6080', [IMPL]: '0x' }, storage: { [SLOTS.eip1967]: '0x' + pad32(IMPL) }, nonce: { [EOA]: '0x5' } };
  const archive = rpcWith({ code: { [DEAD]: { '0x64': '0x6080' } } });
  const chain = { ...resolveChain('bsc') };
  const info = await inspectSpenders(new Map([[DEAD, 100], [PROXY, 100], [EOA, 100]]), { rpc: rpcWith(state), archive, chain, probeBlocks: 0, now: NOW });
  assert.equal(classify(info.get(DEAD)).level, 'ZOMBIE');
  assert.equal(classify(info.get(PROXY)).level, 'ZOMBIE');
  assert.equal(classify(info.get(EOA)).level, 'GHOST');
});
