import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGitHubClient, executeCommand } from '../scripts/apply-command.mjs';
import {
  applyMergedBranchCleanup,
  formatBranchCleanupReport,
  planMergedBranchCleanup,
} from '../scripts/branch-cleanup.mjs';

const TARGET = 'yo4e/example-repo';
const MAIN_SHA = 'a'.repeat(40);
const FEATURE_SHA = 'b'.repeat(40);

function branch(name, sha = FEATURE_SHA, protectedBranch = false) {
  return { name, commit: { sha }, protected: protectedBranch };
}

function pull({
  number = 1,
  state = 'closed',
  mergedAt = '2026-08-23T00:00:00Z',
  headRepo = TARGET,
  headRef = 'feature/safe',
  headSha = FEATURE_SHA,
  baseRepo = TARGET,
  baseRef = 'main',
} = {}) {
  return {
    number,
    state,
    merged_at: mergedAt,
    head: { repo: headRepo === null ? null : { full_name: headRepo }, ref: headRef, sha: headSha },
    base: { repo: { full_name: baseRepo }, ref: baseRef },
  };
}

test('plans only a same-repository merged PR into the current default at the current head', () => {
  const branches = [
    branch('main', MAIN_SHA),
    branch('feature/safe'),
    branch('feature/open'),
    branch('feature/fork'),
    branch('feature/unmerged'),
    branch('feature/non-default'),
    branch('feature/advanced', 'c'.repeat(40)),
    branch('feature/keep'),
    branch('feature/protected', FEATURE_SHA, true),
  ];
  const pullRequests = [
    pull(),
    pull({ number: 2, state: 'open', mergedAt: null, headRef: 'feature/open' }),
    pull({ number: 3, headRepo: 'someone/fork', headRef: 'feature/fork' }),
    pull({ number: 4, mergedAt: null, headRef: 'feature/unmerged' }),
    pull({ number: 5, headRef: 'feature/non-default', baseRef: 'release' }),
    pull({ number: 6, headRef: 'feature/advanced', headSha: FEATURE_SHA }),
    pull({ number: 7, headRef: 'feature/keep' }),
    pull({ number: 8, headRef: 'feature/protected' }),
  ];

  const plan = planMergedBranchCleanup({
    target: TARGET,
    defaultBranch: 'main',
    branches,
    pullRequests,
    keep: ['feature/keep'],
  });

  assert.deepEqual(plan.candidates.map((candidate) => candidate.name), ['feature/safe']);
  assert.equal(plan.skipped.find((item) => item.name === 'main').reason, 'current default branch');
  assert.equal(plan.skipped.find((item) => item.name === 'feature/open').reason, 'open PR');
  assert.equal(plan.skipped.find((item) => item.name === 'feature/keep').reason, 'validated keep list');
  assert.equal(plan.skipped.find((item) => item.name === 'feature/protected').reason, 'protected branch');
  for (const name of ['feature/fork', 'feature/unmerged', 'feature/non-default', 'feature/advanced']) {
    assert.match(plan.skipped.find((item) => item.name === name).reason, /no same-repository merged PR/);
  }
});

test('rejects malformed GitHub branch records before constructing any API path', () => {
  assert.throws(
    () =>
      planMergedBranchCleanup({
        target: TARGET,
        defaultBranch: 'main',
        branches: [branch('../escape')],
        pullRequests: [],
      }),
    /invalid branch record/,
  );
});

function safePlan(name = 'feature/safe') {
  return planMergedBranchCleanup({
    target: TARGET,
    defaultBranch: 'main',
    branches: [branch('main', MAIN_SHA), branch(name)],
    pullRequests: [pull({ headRef: name })],
  });
}

function recheckGithub({ name = 'feature/safe', openPullRequests = [], defaultBranch = 'main' } = {}) {
  const calls = [];
  const github = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET' });
    if (path.endsWith('/pulls/1')) return pull({ headRef: name });
    if (path.includes('/pulls?state=open&head=')) return openPullRequests;
    if (path === '/repos/yo4e/example-repo') {
      return { full_name: TARGET, default_branch: defaultBranch };
    }
    if (path.includes('/branches/')) return branch(name);
    if (options.method === 'DELETE') return null;
    throw new Error(`unexpected test path: ${path}`);
  };
  return { github, calls };
}

test('rechecks open PRs immediately before deletion and skips when one exists', async () => {
  const plan = safePlan();
  const { github, calls } = recheckGithub({
    openPullRequests: [pull({ state: 'open', mergedAt: null })],
  });

  const result = await applyMergedBranchCleanup({ github, owner: 'yo4e', repo: 'example-repo', plan });

  assert.deepEqual(result.deleted, []);
  assert.equal(result.skipped.at(-1).reason, 'open PR');
  assert.equal(calls.some((call) => call.method === 'DELETE'), false);
});

test('rechecks the current default branch and skips if it changed', async () => {
  const plan = safePlan();
  const { github, calls } = recheckGithub({ defaultBranch: 'trunk' });

  const result = await applyMergedBranchCleanup({ github, owner: 'yo4e', repo: 'example-repo', plan });

  assert.deepEqual(result.deleted, []);
  assert.equal(result.skipped.at(-1).reason, 'default branch changed during cleanup');
  assert.equal(calls.some((call) => call.method === 'DELETE'), false);
});

test('rechecks the current branch head and skips commits added after planning', async () => {
  const plan = safePlan();
  const { github: baseGithub, calls } = recheckGithub();
  const github = async (path, options = {}) => {
    if (path.includes('/branches/')) {
      calls.push({ path, method: options.method || 'GET' });
      return branch('feature/safe', 'c'.repeat(40));
    }
    return baseGithub(path, options);
  };

  const result = await applyMergedBranchCleanup({ github, owner: 'yo4e', repo: 'example-repo', plan });

  assert.deepEqual(result.deleted, []);
  assert.equal(result.skipped.at(-1).reason, 'branch head changed during cleanup');
  assert.equal(calls.some((call) => call.method === 'DELETE'), false);
});

test('deletes only the derived heads ref after all destructive-boundary rechecks pass', async () => {
  const name = 'feature/safe';
  const plan = safePlan(name);
  const { github, calls } = recheckGithub({ name });

  const result = await applyMergedBranchCleanup({ github, owner: 'yo4e', repo: 'example-repo', plan });

  assert.deepEqual(result.deleted, [name]);
  assert.deepEqual(calls.slice(-4).map((call) => call.method), ['GET', 'GET', 'GET', 'DELETE']);
  assert.equal(calls.at(-1).path, '/repos/yo4e/example-repo/git/refs/heads/feature/safe');
});

test('branch cleanup dry run ignores an accidentally provided PAT and performs no deletion', async () => {
  const calls = [];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-remote-test-'));
  const output = path.join(directory, 'github-output');
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const parsed = new URL(url);
    let value;
    if (parsed.pathname === '/repos/yo4e/example-repo' && !parsed.pathname.includes('/branches')) {
      value = { full_name: TARGET, default_branch: 'main' };
    } else if (parsed.pathname.endsWith('/branches')) {
      value = [branch('main', MAIN_SHA), branch('feature/safe')];
    } else if (parsed.pathname.endsWith('/pulls')) {
      value = [pull()];
    } else {
      throw new Error(`unexpected fetch URL: ${url}`);
    }
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  let result;
  let outputText;
  try {
    result = await executeCommand({
      owner: 'yo4e',
      body: JSON.stringify({
        version: 1,
        repository: 'example-repo',
        branch_cleanup: { mode: 'merged' },
        dry_run: true,
      }),
      remoteToken: 'must-never-be-sent',
      output,
      fetchImpl,
    });
    outputText = fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  assert.match(result.report, /Would delete \(1\)/);
  assert.equal(calls.some((call) => call.options.headers.Authorization), false);
  assert.equal(calls.some((call) => call.options.method === 'DELETE'), false);
  assert.match(outputText, /report<<repo_remote_[0-9a-f]+/);
  assert.match(outputText, /"feature\/safe"/);
});

test('GitHub client rejects full URLs and non-repository API paths', async () => {
  const github = createGitHubClient({ fetchImpl: async () => new Response('{}') });
  await assert.rejects(() => github('https://example.test/steal'), /repository endpoint derived by repo-remote/);
  await assert.rejects(() => github('/user'), /repository endpoint derived by repo-remote/);
  await assert.rejects(() => github('/repos/../../user'), /escaped the repository endpoint boundary/);
});

test('audit report names candidates and skip reasons without raw API output', () => {
  const report = formatBranchCleanupReport({
    target: TARGET,
    dryRun: true,
    candidates: [{ name: 'feature/safe' }],
    skipped: [{ name: 'main', reason: 'current default branch' }],
  });

  assert.match(report, /Target: yo4e\/example-repo/);
  assert.match(report, /Operation: branch_cleanup: merged/);
  assert.match(report, /Mode: dry-run \(PAT-free\)/);
  assert.match(report, /"feature\/safe"/);
  assert.match(report, /"main" — current default branch/);
});
