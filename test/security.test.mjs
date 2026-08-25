import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { executeCommand } from '../scripts/apply-command.mjs';
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

function cleanupPacket(overrides = {}) {
  return JSON.stringify({
    version: 1,
    repository: 'example-repo',
    branch_cleanup: {
      mode: 'merged',
      keep: ['release/publish-v0.1.0'],
    },
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

test('accepts is_template as a supported mutation', () => {
  const parsed = parseCommandPacket(
    JSON.stringify({ version: 1, repository: 'example-repo', is_template: true, dry_run: true }),
    OWNER,
  );
  assert.deepEqual(parsed.changed, ['is_template']);
  assert.equal(parsed.command.is_template, true);
});

test('requires is_template to be boolean', () => {
  assert.throws(
    () => parseCommandPacket(JSON.stringify({ version: 1, repository: 'example-repo', is_template: 'yes' }), OWNER),
    /is_template must be boolean/,
  );
});

test('accepts delete_branch_on_merge true and false as supported mutations', () => {
  for (const value of [true, false]) {
    const parsed = parseCommandPacket(
      JSON.stringify({ version: 1, repository: 'example-repo', delete_branch_on_merge: value, dry_run: true }),
      OWNER,
    );
    assert.deepEqual(parsed.changed, ['delete_branch_on_merge']);
    assert.equal(parsed.command.delete_branch_on_merge, value);
  }
});

test('requires delete_branch_on_merge to be boolean', () => {
  assert.throws(
    () =>
      parseCommandPacket(
        JSON.stringify({ version: 1, repository: 'example-repo', delete_branch_on_merge: 'yes' }),
        OWNER,
      ),
    /delete_branch_on_merge must be boolean/,
  );
});

test('accepts a valid PAT-free branch cleanup dry run', () => {
  const parsed = parseCommandPacket(cleanupPacket(), OWNER);
  assert.deepEqual(parsed.changed, ['branch_cleanup']);
  assert.deepEqual(parsed.branchCleanup, {
    mode: 'merged',
    keep: ['release/publish-v0.1.0'],
  });
  assert.equal(parsed.dryRun, true);
});

test('requires explicit confirmation before a destructive branch cleanup', () => {
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ dry_run: false }), OWNER),
    /branch_cleanup\.confirm must be true/,
  );

  const parsed = parseCommandPacket(
    cleanupPacket({
      branch_cleanup: { mode: 'merged', keep: [], confirm: true },
      dry_run: false,
    }),
    OWNER,
  );
  assert.equal(parsed.dryRun, false);
});

test('rejects unknown cleanup keys and unsupported destructive shapes', () => {
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ branch_cleanup: { mode: 'merged', branch: 'feature/x' } }), OWNER),
    /branch_cleanup\.branch is not allowed/,
  );
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ branch_cleanup: { mode: 'all' } }), OWNER),
    /branch_cleanup\.mode must equal "merged"/,
  );
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ api_path: '/repos/yo4e/example-repo/git/refs/heads/main' }), OWNER),
    /api_path is not allowed/,
  );
});

test('rejects invalid keep entries and mixed mutation commands', () => {
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ branch_cleanup: { mode: 'merged', keep: ['../main'] } }), OWNER),
    /keep\[0\] has an invalid format/,
  );
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ branch_cleanup: { mode: 'merged', keep: ['feature//x'] } }), OWNER),
    /invalid branch name/,
  );
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ description: 'combined' }), OWNER),
    /standalone command/,
  );
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ delete_branch_on_merge: true }), OWNER),
    /standalone command/,
  );
});

test('branch cleanup preserves the cross-owner restriction', () => {
  assert.throws(
    () => parseCommandPacket(cleanupPacket({ repository: 'someone-else/example-repo' }), OWNER),
    /target owner must be yo4e/,
  );
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

test('apply command sends is_template through the repository PATCH', () => {
  const source = fs.readFileSync(new URL('../scripts/apply-command.mjs', import.meta.url), 'utf8');
  assert.match(source, /hasIsTemplate/);
  assert.match(source, /payload\.is_template = command\.is_template/);
});

test('apply command sends only delete_branch_on_merge in its repository PATCH', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await executeCommand({
    owner: OWNER,
    body: JSON.stringify({
      version: 1,
      repository: 'example-repo',
      delete_branch_on_merge: false,
    }),
    remoteToken: 'test-token',
    fetchImpl,
  });

  assert.equal(result.summary, 'Updated yo4e/example-repo: delete_branch_on_merge');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/yo4e/example-repo');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { delete_branch_on_merge: false });
});

test('redacts token values and Authorization headers', () => {
  const secret = 'super-secret-token';
  const output = redactSecrets(`Authorization: Bearer ${secret}\nfailed with Bearer ${secret}`, [secret]);
  assert.equal(output.includes(secret), false);
  assert.match(output, /Authorization: \[REDACTED\]/);
  assert.match(output, /Bearer \[REDACTED\]/);
});

test('documents the exact token permissions and selected-repository boundary', () => {
  for (const filename of ['README.md', 'SECURITY.md']) {
    const source = fs.readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8');
    assert.match(source, /Administration[^\n]*Read and write/i);
    assert.match(source, /Contents[^\n]*Read and write/i);
    assert.match(source, /Pull requests[^\n]*Read(?:-only)?/i);
    assert.match(source, /Selected repositories/i);
    assert.match(source, /no arbitrary Contents|No arbitrary Contents/i);
  }
});

test('pins third-party Actions to full commit SHAs', () => {
  const workflows = new URL('../.github/workflows/', import.meta.url);

  for (const filename of fs.readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = fs.readFileSync(new URL(filename, workflows), 'utf8');

    for (const [index, line] of workflow.split('\n').entries()) {
      const action = line.match(/^\s*uses:\s*([^\s#]+)/)?.[1];
      if (!action || action.startsWith('./')) continue;

      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${filename}:${index + 1} must pin uses: to a full commit SHA`);
    }
  }
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
  const dryRunStep = workflow.indexOf('Execute dry run without PAT');
  const tokenExposure = workflow.indexOf('REMOTE_TOKEN:');
  assert.ok(validationStep >= 0 && dryRunStep > validationStep && tokenExposure > dryRunStep);
  assert.doesNotMatch(workflow.slice(dryRunStep, tokenExposure), /REMOTE_TOKEN:/);
});
