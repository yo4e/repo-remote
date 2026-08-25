import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  applyMergedBranchCleanup,
  assertBoundedAuditReport,
  formatBranchCleanupReport,
  loadMergedBranchCleanupPlan,
} from './branch-cleanup.mjs';
import { parseCommandPacket } from './command.mjs';
import { redactSecrets } from './security.mjs';

const DEFAULT_API_BASE = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(status, path, detail) {
    super(`GitHub API ${status} for ${path}: ${detail}`);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

export function createGitHubClient({ token = '', fetchImpl = globalThis.fetch, apiBase = DEFAULT_API_BASE } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available');
  const base = new URL(apiBase);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('GitHub API base must use http or https');

  return async function github(path, options = {}) {
    if (typeof path !== 'string' || !path.startsWith('/repos/')) {
      throw new Error('GitHub API path must be a repository endpoint derived by repo-remote');
    }

    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'repo-remote/0.x',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/repos/')) {
      throw new Error('GitHub API path escaped the repository endpoint boundary');
    }

    const response = await fetchImpl(url, {
      ...options,
      headers,
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = 'request failed';
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {}
      throw new GitHubApiError(response.status, path, detail);
    }
    return text ? JSON.parse(text) : null;
  };
}

function setOutput(output, name, value) {
  if (!output) return;
  const safe = String(value).replace(/\r/g, '');
  if (!safe.includes('\n')) {
    fs.appendFileSync(output, `${name}=${safe}\n`);
    return;
  }

  const delimiter = `repo_remote_${randomUUID().replaceAll('-', '')}`;
  fs.appendFileSync(output, `${name}<<${delimiter}\n${safe}\n${delimiter}\n`);
}

function recordOutputs(output, result) {
  setOutput(output, 'summary', result.summary);
  setOutput(output, 'target', result.target);
  setOutput(output, 'dry_run', String(result.dryRun));
  if (result.report) setOutput(output, 'report', result.report);
}

export async function executeCommand({
  owner,
  body,
  remoteToken = '',
  output = '',
  fetchImpl = globalThis.fetch,
  apiBase = DEFAULT_API_BASE,
}) {
  if (!owner) throw new Error('OWNER is not configured');
  const packet = parseCommandPacket(body, owner);
  const { command, repo, target, changed, topics, branchCleanup, dryRun } = packet;

  if (dryRun && !branchCleanup) {
    const result = {
      summary: `Dry run validated ${target}: ${changed.join(', ')}`,
      target,
      dryRun: true,
    };
    recordOutputs(output, result);
    return result;
  }

  if (!dryRun && !remoteToken) throw new Error('REPO_REMOTE_TOKEN is not configured');

  // Ignore REMOTE_TOKEN defensively for every dry run, even if a caller accidentally provides one.
  const github = createGitHubClient({ token: dryRun ? '' : remoteToken, fetchImpl, apiBase });

  if (branchCleanup) {
    const plan = await loadMergedBranchCleanupPlan({
      github,
      owner,
      repo,
      keep: branchCleanup.keep,
    });

    if (dryRun) {
      const report = formatBranchCleanupReport({
        target,
        dryRun: true,
        candidates: plan.candidates,
        skipped: plan.skipped,
      });
      assertBoundedAuditReport(report);
      const result = {
        summary: `Dry run ${target}: branch_cleanup: merged (would delete ${plan.candidates.length}, skipped ${plan.skipped.length})`,
        report,
        target,
        dryRun: true,
      };
      recordOutputs(output, result);
      return result;
    }

    const projectedReport = formatBranchCleanupReport({
      target,
      dryRun: false,
      skipped: [
        ...plan.skipped,
        ...plan.candidates.map((candidate) => ({
          name: candidate.name,
          reason: 'preflight audit size bound '.padEnd(128, 'x'),
        })),
      ],
    });
    assertBoundedAuditReport(projectedReport);

    const applied = await applyMergedBranchCleanup({
      github,
      owner,
      repo,
      keep: branchCleanup.keep,
      plan,
    });
    const report = formatBranchCleanupReport({
      target,
      dryRun: false,
      deleted: applied.deleted,
      skipped: applied.skipped,
    });
    assertBoundedAuditReport(report);
    const result = {
      summary: `Updated ${target}: branch_cleanup: merged (deleted ${applied.deleted.length}, skipped ${applied.skipped.length})`,
      report,
      target,
      dryRun: false,
    };
    recordOutputs(output, result);
    return result;
  }

  const hasDescription = Object.prototype.hasOwnProperty.call(command, 'description');
  const hasHomepage = Object.prototype.hasOwnProperty.call(command, 'homepage');
  const hasTopics = Object.prototype.hasOwnProperty.call(command, 'topics');
  const hasIsTemplate = Object.prototype.hasOwnProperty.call(command, 'is_template');
  const hasDeleteBranchOnMerge = Object.prototype.hasOwnProperty.call(command, 'delete_branch_on_merge');

  if (hasDescription || hasHomepage || hasIsTemplate || hasDeleteBranchOnMerge) {
    const payload = {};
    if (hasDescription) payload.description = command.description;
    if (hasHomepage) payload.homepage = command.homepage;
    if (hasIsTemplate) payload.is_template = command.is_template;
    if (hasDeleteBranchOnMerge) payload.delete_branch_on_merge = command.delete_branch_on_merge;
    await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  if (hasTopics) {
    await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`, {
      method: 'PUT',
      body: JSON.stringify({ names: topics }),
    });
  }

  const result = {
    summary: `Updated ${target}: ${changed.join(', ')}`,
    target,
    dryRun: false,
  };
  recordOutputs(output, result);
  return result;
}

async function main() {
  const owner = process.env.OWNER || '';
  const remoteToken = process.env.REMOTE_TOKEN || '';
  const body = process.env.COMMAND_BODY || '';
  const output = process.env.GITHUB_OUTPUT || '';
  const result = await executeCommand({ owner, body, remoteToken, output });
  console.log(result.summary);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    const token = process.env.REMOTE_TOKEN || '';
    console.error(`repo-remote: ${redactSecrets(error instanceof Error ? error.message : 'unexpected failure', [token])}`);
    process.exit(1);
  });
}
