import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const FORBIDDEN_TITLE = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const MAX_PAGE_NAME_LENGTH = 120;
export const MAX_WIKI_CONTENT_BYTES = 48_000;
const MAX_WIKI_REPORT_BYTES = 60_000;
const DEFAULT_COMMITTER_NAME = 'repo-remote';
const DEFAULT_COMMITTER_EMAIL = 'repo-remote@users.noreply.github.com';

export function normalizeWikiPage(page) {
  if (typeof page !== 'string') throw new Error('wiki page must be a string');
  const trimmed = page.trim().normalize('NFC');
  if (!trimmed) throw new Error('wiki page must not be empty');
  if (trimmed.length > MAX_PAGE_NAME_LENGTH) {
    throw new Error(`wiki page must be ${MAX_PAGE_NAME_LENGTH} characters or fewer`);
  }
  if (FORBIDDEN_TITLE.test(trimmed)) {
    throw new Error('wiki page contains a forbidden filename character');
  }

  const withoutExtension = trimmed.toLowerCase().endsWith('.md') ? trimmed.slice(0, -3) : trimmed;
  if (!withoutExtension || withoutExtension === '.' || withoutExtension === '..' || withoutExtension.startsWith('.')) {
    throw new Error('wiki page has an unsafe filename');
  }
  if (withoutExtension.includes('..') || withoutExtension.endsWith('.') || withoutExtension.endsWith(' ')) {
    throw new Error('wiki page has an unsafe filename');
  }

  const filenameStem = withoutExtension.replace(/\s+/g, '-');
  if (!filenameStem || filenameStem === '.' || filenameStem === '..') {
    throw new Error('wiki page has an unsafe filename');
  }

  return {
    page: withoutExtension,
    filename: `${filenameStem}.md`,
  };
}

export function assertWikiContent(content) {
  if (typeof content !== 'string') throw new Error('wiki content must be a string');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WIKI_CONTENT_BYTES) {
    throw new Error(`wiki content exceeds the safe limit of ${MAX_WIKI_CONTENT_BYTES} bytes`);
  }
  return bytes;
}

export function assertWikiCommitMessage(message) {
  if (message === undefined) return;
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('wiki commit message must be a non-empty string when provided');
  }
  if (message.length > 200 || /[\r\n\u0000]/.test(message)) {
    throw new Error('wiki commit message must be one line and 200 characters or fewer');
  }
}

export function buildWikiRemote(owner, repo) {
  const component = /^[A-Za-z0-9._-]+$/;
  if (!component.test(owner) || !component.test(repo) || owner.includes('..') || repo.includes('..')) {
    throw new Error('wiki remote target is invalid');
  }
  return `https://github.com/${owner}/${repo}.wiki.git`;
}

function gitEnvironment(token) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
  if (!token) return env;

  const credential = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credential}`,
  };
}

export async function runGit(args, { cwd, token = '' } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('git arguments must be a string array');
  }
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: gitEnvironment(token),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = new Error(`git command failed (${code}): ${stderr.trim() || 'unknown git error'}`);
        error.code = code;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function friendlyCloneError(error) {
  const detail = `${error?.stderr || ''} ${error?.message || ''}`;
  if (/repository .* not found|not found|does not appear to be a git repository/i.test(detail)) {
    return new Error(
      'Wiki is not initialized or is unavailable. GitHub requires an initial Wiki page before the .wiki.git repository can be cloned; create the first page in the target repository Wiki, then retry. For private repositories, also verify token access.',
    );
  }
  return error;
}

async function cloneWiki({ owner, repo, token, directory, git = runGit }) {
  const remote = buildWikiRemote(owner, repo);
  try {
    await git(['clone', '--quiet', '--depth', '1', remote, directory], { token });
  } catch (error) {
    throw friendlyCloneError(error);
  }
  return remote;
}

async function withWikiCheckout(options, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-remote-wiki-'));
  const checkout = path.join(root, 'wiki');
  try {
    await cloneWiki({ ...options, directory: checkout });
    return await fn(checkout);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function assertCheckoutPath(checkout, filename) {
  const resolvedCheckout = path.resolve(checkout);
  const filePath = path.resolve(checkout, filename);
  if (path.dirname(filePath) !== resolvedCheckout) {
    throw new Error('wiki page escaped the ephemeral checkout');
  }
  return filePath;
}

async function listMarkdownPages(checkout) {
  const entries = await fs.readdir(checkout, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => ({
      filename: entry.name,
      page: entry.name.slice(0, -3),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
}

async function pullRebaseAndRetryPush({ checkout, token, git }) {
  const branch = (await git(['symbolic-ref', '--short', 'HEAD'], { cwd: checkout, token })).stdout.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('-')) {
    throw new Error('Wiki default branch name was unsafe');
  }
  await git(['pull', '--rebase', 'origin', branch], { cwd: checkout, token });
  await git(['push', 'origin', 'HEAD'], { cwd: checkout, token });
}

export async function executeWikiOperation({
  owner,
  repo,
  wikiOperation,
  token,
  git = runGit,
}) {
  if (!token) throw new Error('REPO_REMOTE_TOKEN is not configured');
  if (!wikiOperation || typeof wikiOperation.operation !== 'string') {
    throw new Error('wiki operation is not configured');
  }

  return await withWikiCheckout({ owner, repo, token, git }, async (checkout) => {
    if (wikiOperation.operation === 'wiki.list') {
      const pages = await listMarkdownPages(checkout);
      return { operation: 'wiki.list', pages };
    }

    const normalized = normalizeWikiPage(wikiOperation.page);
    const filePath = assertCheckoutPath(checkout, normalized.filename);

    if (wikiOperation.operation === 'wiki.read') {
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new Error(`Wiki page does not exist: ${normalized.page}`);
        }
        throw error;
      }
      assertWikiContent(content);
      return {
        operation: 'wiki.read',
        page: normalized.page,
        filename: normalized.filename,
        content,
      };
    }

    if (wikiOperation.operation !== 'wiki.upsert') {
      throw new Error(`unsupported wiki operation: ${wikiOperation.operation}`);
    }

    assertWikiContent(wikiOperation.content);
    assertWikiCommitMessage(wikiOperation.message);
    await fs.writeFile(filePath, wikiOperation.content, { encoding: 'utf8', flag: 'w' });

    const status = await git(['status', '--porcelain', '--', normalized.filename], { cwd: checkout, token });
    if (!status.stdout.trim()) {
      return {
        operation: 'wiki.upsert',
        page: normalized.page,
        filename: normalized.filename,
        changed: false,
      };
    }

    await git(['config', 'user.name', DEFAULT_COMMITTER_NAME], { cwd: checkout, token });
    await git(['config', 'user.email', DEFAULT_COMMITTER_EMAIL], { cwd: checkout, token });
    await git(['add', '--', normalized.filename], { cwd: checkout, token });
    const message = wikiOperation.message || `Update ${normalized.page} via repo-remote`;
    await git(['commit', '--quiet', '-m', message, '--', normalized.filename], { cwd: checkout, token });

    try {
      await git(['push', 'origin', 'HEAD'], { cwd: checkout, token });
    } catch (error) {
      const detail = `${error?.stderr || ''} ${error?.message || ''}`;
      if (!/non-fast-forward|fetch first|rejected/i.test(detail)) throw error;
      await pullRebaseAndRetryPush({ checkout, token, git });
    }

    return {
      operation: 'wiki.upsert',
      page: normalized.page,
      filename: normalized.filename,
      changed: true,
    };
  });
}

export function formatWikiReport({ target, result }) {
  let report;
  if (result.operation === 'wiki.list') {
    const lines = [
      `Target: ${target}`,
      'Operation: wiki.list',
      `Pages (${result.pages.length})`,
      ...(result.pages.length ? result.pages.map((item) => `    ${JSON.stringify(item.filename)}`) : ['    (none)']),
    ];
    report = lines.join('\n');
  } else if (result.operation === 'wiki.read') {
    report = [
      `Target: ${target}`,
      'Operation: wiki.read',
      `Page: ${JSON.stringify(result.page)}`,
      `Filename: ${JSON.stringify(result.filename)}`,
      '',
      result.content,
    ].join('\n');
  } else {
    report = [
      `Target: ${target}`,
      'Operation: wiki.upsert',
      `Page: ${JSON.stringify(result.page)}`,
      `Filename: ${JSON.stringify(result.filename)}`,
      `Changed: ${result.changed ? 'yes' : 'no (already identical)'}`,
    ].join('\n');
  }

  if (Buffer.byteLength(report, 'utf8') > MAX_WIKI_REPORT_BYTES) {
    throw new Error(`wiki audit report exceeds ${MAX_WIKI_REPORT_BYTES} bytes`);
  }
  return report;
}
