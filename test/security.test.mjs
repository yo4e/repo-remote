import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseCommandPacket } from '../scripts/command.mjs';
import { redactSecrets } from '../scripts/security.mjs';

const OWNER = 'yo4e';

function packet(overrides = {}) {
  return JSON.stringify({
    version: 1,
    repository: 'example-repo',
    description: 'Example',
    dry_run: true,
    ...overrides,
  });
}

test('accepts a valid v1 command', () => {
  const parsed = parseCommandPacket(packet(), OWNER);
  assert.equal(parsed.target, 'yo4e/example-repo');
  assert.deepEqual(parsed.changed, ['description']);
  assert.equal(parsed.dryRun, true);
});

test('requires version 1', () => {
  assert.throws(
    () => parseCommandPacket(JSON.stringify({ repository: 'example-repo', description: 'x' }), OWNER),
    /version is required/,
  );
  assert.throws(() => parseCommandPacket(packet({ version: 2 }), OWNER), /must equal 1/);
});

test('rejects unknown keys', () => {
  assert.throws(() => parseCommandPacket(packet({ unexpected: true }), OWNER), /unexpected is not allowed/);
});

test('requires at least one supported mutation', () => {
  assert.throws(
    () => parseCommandPacket(JSON.stringify({ version: 1, repository: 'example-repo', dry_run: true }), OWNER),
    /required command shape/,
  );
});

test('rejects cross-owner targets', () => {
  assert.throws(() => parseCommandPacket(packet({ repository: 'someone-else/example-repo' }), OWNER), /target owner must be yo4e/);
});

test('validates dry_run type and homepage protocol', () => {
  assert.throws(() => parseCommandPacket(packet({ dry_run: 'yes' }), OWNER), /dry_run must be boolean/);
  assert.throws(() => parseCommandPacket(packet({ homepage: 'file:///tmp/x' }), OWNER), /homepage must use http or https/);
});

test('normalizes topics after schema validation', () => {
  const parsed = parseCommandPacket(
    JSON.stringify({ version: 1, repository: 'example-repo', topics: ['Creative-Coding', 'creative-coding'], dry_run: true }),
    OWNER,
  );
  assert.deepEqual(parsed.topics, ['creative-coding']);
});

test('redacts token values and Authorization headers', () => {
  const secret = 'super-secret-token';
  const output = redactSecrets(`Authorization: Bearer ${secret}\nfailed with Bearer ${secret}`, [secret]);
  assert.equal(output.includes(secret), false);
  assert.match(output, /Authorization: \[REDACTED\]/);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test('workflow gates command execution before PAT exposure', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repo-remote.yml', import.meta.url), 'utf8');
  assert.match(workflow, /github\.run_attempt == '1'/);
  assert.match(workflow, /github\.event\.issue\.state == 'open'/);
  assert.match(workflow, /repo-remote:command/);
  assert.match(workflow, /github\.event\.issue\.user\.login/);
  assert.match(workflow, /github\.actor/);
  assert.match(workflow, /persist-credentials: false/);

  const validationStep = workflow.indexOf('Validate command before exposing the PAT');
  const tokenExposure = workflow.indexOf('REMOTE_TOKEN:');
  assert.ok(validationStep >= 0 && tokenExposure > validationStep);
});
