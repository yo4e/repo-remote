import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommandPacket } from '../scripts/command.mjs';

const OWNER = 'yo4e';

test('accepts wiki.upsert with safe params', () => {
  const parsed = parseCommandPacket(JSON.stringify({
    version: 1,
    repository: 'templex-soul',
    operation: 'wiki.upsert',
    params: { page: 'Architecture', content: '# Architecture\n' },
    dry_run: true,
  }), OWNER);
  assert.deepEqual(parsed.changed, ['wiki.upsert']);
  assert.equal(parsed.wikiOperation.filename, 'Architecture.md');
  assert.equal(parsed.dryRun, true);
});

test('accepts wiki.read and wiki.list', () => {
  const read = parseCommandPacket(JSON.stringify({
    version: 1, repository: 'templex-soul', operation: 'wiki.read', params: { page: 'Home' },
  }), OWNER);
  assert.equal(read.wikiOperation.operation, 'wiki.read');

  const list = parseCommandPacket(JSON.stringify({
    version: 1, repository: 'templex-soul', operation: 'wiki.list', params: {},
  }), OWNER);
  assert.equal(list.wikiOperation.operation, 'wiki.list');
});

test('rejects traversal, mixed commands, and malformed wiki params', () => {
  assert.throws(() => parseCommandPacket(JSON.stringify({
    version: 1, repository: 'templex-soul', operation: 'wiki.read', params: { page: '../x' },
  }), OWNER), /wiki page/);
  assert.throws(() => parseCommandPacket(JSON.stringify({
    version: 1, repository: 'templex-soul', operation: 'wiki.list', params: { page: 'Home' },
  }), OWNER), /empty object/);
  assert.throws(() => parseCommandPacket(JSON.stringify({
    version: 1,
    repository: 'templex-soul',
    operation: 'wiki.upsert',
    params: { page: 'Home', content: 'x' },
    description: 'mixed',
  }), OWNER), /standalone/);
});

test('read/list do not accept dry_run', () => {
  assert.throws(() => parseCommandPacket(JSON.stringify({
    version: 1,
    repository: 'templex-soul',
    operation: 'wiki.read',
    params: { page: 'Home' },
    dry_run: true,
  }), OWNER), /dry_run is only supported/);
});
