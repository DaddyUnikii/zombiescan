import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport, toMarkdown, toJSON, describeAmount } from '../src/format.js';

const report = {
  chain: 'eth', chainId: 1, owner: '0x' + '11'.repeat(20), source: 'blockscout', fullHistory: true, events: 3, staleDays: 180,
  counts: { ZOMBIE: 1, GHOST: 0, STALE: 0, ALIVE: 1, unsure: 1 },
  approvals: [
    { kind: 'erc20', token: '0x' + '33'.repeat(20), symbol: 'WETH', spender: '0x6b7a87899490ece95443e979ca9485cbe7e71522', spenderName: 'Multichain Router V4', amount: 1n, unlimited: true, level: 'ZOMBIE', reasons: ['exploited router'], timestamp: null },
    { kind: 'all', token: '0x' + '44'.repeat(20), symbol: 'PUNK', spender: '0x' + '22'.repeat(20), level: 'ALIVE', reasons: ['active today'], timestamp: null },
  ],
};

test('terminal report hides ALIVE by default and shows calldata on request', () => {
  const out = renderReport(report, { showCalldata: true });
  assert.match(out, /ZOMBIE/);
  assert.match(out, /Multichain Router V4/);
  assert.ok(!out.includes('PUNK'));
  assert.match(out, /revoke: approve\(0x6b7a/);
  assert.ok(renderReport(report, { showAll: true }).includes('PUNK'));
});

test('markdown and json render bigints and levels', () => {
  assert.match(toMarkdown(report), /🧟 ZOMBIE/);
  assert.match(toMarkdown(report), /1 not fully checked/);
  assert.equal(JSON.parse(toJSON(report)).approvals[0].amount, '1');
  assert.equal(describeAmount(report.approvals[1]), 'ALL (approvalForAll)');
});
