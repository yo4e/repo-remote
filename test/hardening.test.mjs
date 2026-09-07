import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { collectAuditEvidence } from '../scripts/audit.mjs';
import { parseCommandPacket } from '../scripts/command.mjs';
import {
  assertCommandBodySize,
  assertJsonComplexity,
  MAX_COMMAND_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
} from '../scripts/limits.mjs';

const OWNER = 'yo4e';

function validPacket(overrides = {}) {
  return JSON.stringify({
    version: 1,
    repository: 'example-repo',
    description: 'Example',
    dry_run: true,
    ...overrides,
  });
}

test('command body size accepts the boundary and rejects one byte over', () => {
  const base = validPacket();
  const padding = MAX_COMMAND_BYTES - Buffer.byteLength(base, 'utf8');
  assert.ok(padding > 0);

  const atLimit = `${base}${' '.repeat(padding)}`;
  assert.equal(assertCommandBodySize(atLimit), MAX_COMMAND_BYTES);
  assert.equal(parseCommandPacket(atLimit, OWNER).target, 'yo4e/example-repo');

  assert.throws(
    () => parseCommandPacket(`${atLimit} `, OWNER),
    new RegExp(`safe limit of ${MAX_COMMAND_BYTES}`),
  );
});

test('JSON complexity enforces depth and node boundaries', () => {
  let atDepth = 0;
  for (let index = 1; index < MAX_JSON_DEPTH; index += 1) atDepth = { value: atDepth };
  assert.doesNotThrow(() => assertJsonComplexity(atDepth));
  assert.throws(() => assertJsonComplexity({ value: atDepth }), new RegExp(`depth limit of ${MAX_JSON_DEPTH}`));

  assert.equal(assertJsonComplexity(new Array(MAX_JSON_NODES - 1).fill(null)), MAX_JSON_NODES);
  assert.throws(
    () => assertJsonComplexity(new Array(MAX_JSON_NODES).fill(null)),
    new RegExp(`node limit of ${MAX_JSON_NODES}`),
  );
});

test('parser rejects excessive complexity before schema processing', () => {
  const tooManyNodes = JSON.stringify({
    version: 1,
    repository: 'example-repo',
    description: 'x',
    unexpected: new Array(MAX_JSON_NODES).fill(0),
  });
  assert.throws(() => parseCommandPacket(tooManyNodes, OWNER), /safe node limit/);

  let deep = 0;
  for (let index = 0; index < MAX_JSON_DEPTH + 2; index += 1) deep = { value: deep };
  const tooDeep = JSON.stringify({
    version: 1,
    repository: 'example-repo',
    description: 'x',
    unexpected: deep,
  });
  assert.throws(() => parseCommandPacket(tooDeep, OWNER), /safe depth limit/);
});

test('normal maximum branch-cleanup keep list stays within complexity limits', () => {
  const body = JSON.stringify({
    version: 1,
    repository: 'example-repo',
    branch_cleanup: {
      mode: 'merged',
      keep: Array.from({ length: 100 }, (_, index) => `keep-${index}`),
    },
    dry_run: true,
  });

  const parsed = parseCommandPacket(body, OWNER);
  assert.equal(parsed.operation, 'branch_cleanup');
  assert.equal(parsed.branchCleanup.keep.length, 100);
});

test('audit evidence records bounded metadata without echoing the payload', () => {
  const body = JSON.stringify({
    version: 1,
    repository: 'example-repo',
    description: 'Do not echo this value',
    topics: ['security'],
    dry_run: true,
  });
  const evidence = collectAuditEvidence(body, OWNER);

  assert.equal(evidence.targetHint, 'yo4e/example-repo');
  assert.equal(evidence.operationHint, 'metadata.update');
  assert.equal(evidence.changedHint, 'description,topics');
  assert.equal(evidence.dryRunHint, 'true');
  assert.match(evidence.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(evidence.fingerprint.includes('Do not echo this value'), false);
  assert.equal(evidence.bodyBytes, Buffer.byteLength(body, 'utf8'));
});

test('audit evidence uses only safe hints for failed or oversized requests', () => {
  const invalid = collectAuditEvidence('{not-json', OWNER);
  assert.equal(invalid.targetHint, 'unavailable');
  assert.equal(invalid.operationHint, 'unavailable');
  assert.match(invalid.fingerprint, /^sha256:[0-9a-f]{64}$/);

  const crossOwner = collectAuditEvidence(
    JSON.stringify({ version: 1, repository: 'other/example', operation: 'wiki.list', params: {} }),
    OWNER,
  );
  assert.equal(crossOwner.targetHint, 'other/example');
  assert.equal(crossOwner.operationHint, 'wiki.list');

  const oversized = collectAuditEvidence('x'.repeat(MAX_COMMAND_BYTES + 1), OWNER);
  assert.equal(oversized.bodyBytes, MAX_COMMAND_BYTES + 1);
  assert.equal(oversized.targetHint, 'unavailable');
  assert.equal(oversized.changedHint, 'unavailable');
});

test('workflow emits structured audit comments from PAT-free evidence', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repo-remote.yml', import.meta.url), 'utf8');
  const evidenceStep = workflow.indexOf('Capture bounded audit evidence');
  const validationStep = workflow.indexOf('Validate command before exposing the PAT');
  const tokenExposure = workflow.indexOf('REMOTE_TOKEN:');

  assert.ok(evidenceStep >= 0 && validationStep > evidenceStep && tokenExposure > validationStep);
  assert.match(workflow, /Payload fingerprint/);
  assert.match(workflow, /Payload bytes/);
  assert.match(workflow, /Changed resources/);
  assert.match(workflow, /Target hint \(unvalidated\)/);
  assert.match(workflow, /--body-file/);
});

test('checked-in policy controls cover the security boundary', () => {
  const codeowners = fs.readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
  for (const path of ['/.github/workflows/', '/scripts/', '/schemas/', '/SECURITY.md']) {
    assert.match(codeowners, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const dependabot = fs.readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
  assert.match(dependabot, /package-ecosystem:\s*github-actions/);
  assert.match(dependabot, /interval:\s*weekly/);

  const codeql = fs.readFileSync(new URL('../.github/workflows/codeql.yml', import.meta.url), 'utf8');
  assert.match(codeql, /security-events:\s*write/);
  assert.match(codeql, /languages:\s*javascript-typescript/);
  assert.doesNotMatch(codeql, /secrets\./);
});
