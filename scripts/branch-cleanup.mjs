const PAGE_SIZE = 100;
const MAX_BRANCHES = 200;
const MAX_PULL_REQUESTS = 5000;
const MAX_OPEN_PULL_REQUESTS = 500;
const MAX_AUDIT_BYTES = 60_000;

const REASONS = Object.freeze({
  default: 'current default branch',
  keep: 'validated keep list',
  protected: 'protected branch',
  openPullRequest: 'open PR',
  noMergedEvidence: 'no same-repository merged PR into the current default at this head',
  defaultChanged: 'default branch changed during cleanup',
  headChanged: 'branch head changed during cleanup',
  evidenceChanged: 'merged PR evidence changed during cleanup',
  unavailable: 'branch or PR evidence no longer exists',
});

function repositoryPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function branchPath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

function paginationPath(path, page) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`;
}

async function listPaginated(github, path, maximum, label) {
  const values = [];

  for (let page = 1; ; page += 1) {
    const batch = await github(paginationPath(path, page));
    if (!Array.isArray(batch)) throw new Error(`GitHub returned an invalid ${label} response`);
    values.push(...batch);
    if (values.length > maximum) {
      throw new Error(`${label} exceeds the safe processing limit of ${maximum}`);
    }
    if (batch.length < PAGE_SIZE) return values;
  }
}

function pullHeadMatches(pull, target, branchName) {
  return pull?.head?.repo?.full_name === target && pull?.head?.ref === branchName;
}

function isOpenPull(pull, target, branchName) {
  return pull?.state === 'open' && pullHeadMatches(pull, target, branchName);
}

export function isMergedPullEvidence(pull, { target, branchName, branchSha, defaultBranch }) {
  return (
    Number.isInteger(pull?.number) &&
    Boolean(pull?.merged_at) &&
    pullHeadMatches(pull, target, branchName) &&
    pull?.head?.sha === branchSha &&
    pull?.base?.repo?.full_name === target &&
    pull?.base?.ref === defaultBranch
  );
}

function assertBranchRecord(branch) {
  const name = branch?.name;
  const components = typeof name === 'string' ? name.split('/') : [];
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 1024 ||
    name === '@' ||
    name.startsWith('-') ||
    name.endsWith('.') ||
    name.endsWith('/') ||
    name.includes('..') ||
    name.includes('//') ||
    name.includes('@{') ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(name) ||
    components.some((component) => component.startsWith('.') || component.endsWith('.lock')) ||
    typeof branch?.commit?.sha !== 'string' ||
    !/^[0-9a-f]{40,64}$/i.test(branch.commit.sha)
  ) {
    throw new Error('GitHub returned an invalid branch record');
  }
}

export function planMergedBranchCleanup({ target, defaultBranch, branches, pullRequests, keep = [] }) {
  if (typeof target !== 'string' || !target || typeof defaultBranch !== 'string' || !defaultBranch) {
    throw new Error('target and current default branch are required for branch cleanup');
  }
  if (!Array.isArray(branches) || !Array.isArray(pullRequests)) {
    throw new Error('branch cleanup requires GitHub branch and pull request arrays');
  }
  if (branches.length > MAX_BRANCHES) {
    throw new Error(`branches exceeds the safe processing limit of ${MAX_BRANCHES}`);
  }
  if (pullRequests.length > MAX_PULL_REQUESTS) {
    throw new Error(`pull requests exceeds the safe processing limit of ${MAX_PULL_REQUESTS}`);
  }

  const keepSet = new Set(keep);
  const seen = new Set();
  const candidates = [];
  const skipped = [];

  for (const branch of branches) {
    assertBranchRecord(branch);
    if (seen.has(branch.name)) throw new Error(`GitHub returned duplicate branch ${JSON.stringify(branch.name)}`);
    seen.add(branch.name);

    let reason;
    if (branch.name === defaultBranch) reason = REASONS.default;
    else if (keepSet.has(branch.name)) reason = REASONS.keep;
    else if (branch.protected === true) reason = REASONS.protected;
    else if (pullRequests.some((pull) => isOpenPull(pull, target, branch.name))) reason = REASONS.openPullRequest;

    const evidence = reason
      ? undefined
      : pullRequests.find((pull) =>
          isMergedPullEvidence(pull, {
            target,
            branchName: branch.name,
            branchSha: branch.commit.sha,
            defaultBranch,
          }),
        );

    if (!reason && !evidence) reason = REASONS.noMergedEvidence;

    if (reason) {
      skipped.push({ name: branch.name, reason });
    } else {
      candidates.push({
        name: branch.name,
        sha: branch.commit.sha,
        defaultBranch,
        evidencePullNumber: evidence.number,
      });
    }
  }

  return { target, defaultBranch, candidates, skipped };
}

export async function loadMergedBranchCleanupPlan({ github, owner, repo, keep = [] }) {
  const root = repositoryPath(owner, repo);
  const repository = await github(root);
  const target = `${owner}/${repo}`;

  if (repository?.full_name !== target || typeof repository?.default_branch !== 'string' || !repository.default_branch) {
    throw new Error('GitHub target identity or current default branch did not match the validated command');
  }

  const [branches, pullRequests] = await Promise.all([
    listPaginated(github, `${root}/branches`, MAX_BRANCHES, 'branches'),
    listPaginated(
      github,
      `${root}/pulls?state=all&sort=updated&direction=desc`,
      MAX_PULL_REQUESTS,
      'pull requests',
    ),
  ]);

  return planMergedBranchCleanup({
    target,
    defaultBranch: repository.default_branch,
    branches,
    pullRequests,
    keep,
  });
}

function recheckReason({ candidate, evidence, branch, repository, openPullRequests, target, keep }) {
  if (repository?.full_name !== target || repository?.default_branch !== candidate.defaultBranch) {
    return REASONS.defaultChanged;
  }
  if (candidate.name === repository.default_branch) return REASONS.default;
  if (keep.has(candidate.name)) return REASONS.keep;
  if (branch?.name !== candidate.name || branch?.commit?.sha !== candidate.sha) return REASONS.headChanged;
  if (branch?.protected === true) return REASONS.protected;
  if (openPullRequests.some((pull) => isOpenPull(pull, target, candidate.name))) return REASONS.openPullRequest;
  if (
    !isMergedPullEvidence(evidence, {
      target,
      branchName: candidate.name,
      branchSha: candidate.sha,
      defaultBranch: repository.default_branch,
    })
  ) {
    return REASONS.evidenceChanged;
  }
  return undefined;
}

export async function applyMergedBranchCleanup({ github, owner, repo, keep = [], plan }) {
  const root = repositoryPath(owner, repo);
  const target = `${owner}/${repo}`;
  if (plan?.target !== target) throw new Error('branch cleanup plan target did not match the validated command');

  const keepSet = new Set(keep);
  const deleted = [];
  const skipped = [...plan.skipped];

  for (const candidate of plan.candidates) {
    let evidence;
    let openPullRequests;
    let repository;
    let branch;

    try {
      evidence = await github(`${root}/pulls/${candidate.evidencePullNumber}`);
      openPullRequests = await listPaginated(
        github,
        `${root}/pulls?state=open&head=${encodeURIComponent(`${owner}:${candidate.name}`)}`,
        MAX_OPEN_PULL_REQUESTS,
        'open pull requests',
      );
      repository = await github(root);
      branch = await github(`${root}/branches/${branchPath(candidate.name)}`);
    } catch (error) {
      if (error?.status === 404) {
        skipped.push({ name: candidate.name, reason: REASONS.unavailable });
        continue;
      }
      throw error;
    }

    const reason = recheckReason({
      candidate,
      evidence,
      branch,
      repository,
      openPullRequests,
      target,
      keep: keepSet,
    });
    if (reason) {
      skipped.push({ name: candidate.name, reason });
      continue;
    }

    try {
      await github(`${root}/git/refs/heads/${branchPath(candidate.name)}`, { method: 'DELETE' });
      deleted.push(candidate.name);
    } catch (error) {
      if ([404, 409, 422].includes(error?.status)) {
        skipped.push({ name: candidate.name, reason: `GitHub rejected deletion (${error.status})` });
        continue;
      }
      throw error;
    }
  }

  return { deleted, skipped };
}

function addNames(lines, label, names) {
  if (lines.at(-1) !== '') lines.push('');
  lines.push(`${label} (${names.length})`);
  if (names.length === 0) {
    lines.push('    (none)');
    return;
  }
  for (const name of names) lines.push(`    ${JSON.stringify(name)}`);
}

function addSkipped(lines, skipped) {
  if (lines.at(-1) !== '') lines.push('');
  lines.push(`Skipped (${skipped.length})`);
  if (skipped.length === 0) {
    lines.push('    (none)');
    return;
  }
  for (const item of skipped) lines.push(`    ${JSON.stringify(item.name)} — ${item.reason}`);
}

export function formatBranchCleanupReport({ target, dryRun, deleted = [], candidates = [], skipped = [] }) {
  const lines = [
    `Target: ${target}`,
    'Operation: branch_cleanup: merged',
    `Mode: ${dryRun ? 'dry-run (PAT-free)' : 'applied'}`,
    '',
  ];

  if (dryRun) {
    addNames(lines, 'Deleted', []);
    addNames(lines, 'Would delete', candidates.map((candidate) => candidate.name));
  } else {
    addNames(lines, 'Deleted', deleted);
  }
  addSkipped(lines, skipped);

  return lines.join('\n');
}

export function assertBoundedAuditReport(report) {
  if (Buffer.byteLength(report, 'utf8') > MAX_AUDIT_BYTES) {
    throw new Error(`branch cleanup audit report exceeds ${MAX_AUDIT_BYTES} bytes`);
  }
}
