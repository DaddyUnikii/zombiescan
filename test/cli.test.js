import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BIN = new URL('../bin/zombiescan.js', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--version prints the package version', () => {
  assert.equal(execFileSync(process.execPath, [BIN, '--version']).toString().trim(), pkg.version);
});

test('--help explains the levels', () => {
  const out = execFileSync(process.execPath, [BIN, '--help']).toString();
  for (const w of ['ZOMBIE', 'GHOST', 'STALE', 'ALIVE', '--calldata', '--stale-days']) assert.ok(out.includes(w), w);
});

test('bad input exits 1 without touching the network', () => {
  assert.equal(spawnSync(process.execPath, [BIN, 'not-an-address']).status, 1);
  assert.equal(spawnSync(process.execPath, [BIN, '0x' + '1'.repeat(40), '--fail-on', 'alive']).status, 1);
  assert.equal(spawnSync(process.execPath, [BIN, '0x' + '1'.repeat(40), '--stale-days', '0']).status, 1);
});
