import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  MAX_WIKI_CONTENT_BYTES,
  assertWikiCommitMessage,
  assertWikiContent,
  buildWikiRemote,
  executeWikiOperation,
  formatWikiReport,
  normalizeWikiPage,
  runGit,
} from '../scripts/wiki.mjs';

async function execGit(args, { cwd } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`git failed: ${stderr}`));
    });
  });
}

async function makeLocalWiki() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-remote-wiki-test-'));
  const bare = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  await execGit(['init', '--bare', '--quiet', bare]);
  await execGit(['init', '--quiet', '-b', 'master', seed]);
  await execGit(['config', 'user.name', 'test'], { cwd: seed });
  await execGit(['config', 'user.email', 'test@example.com'], { cwd: seed });
  await fs.writeFile(path.join(seed, 'Home.md'), '# Home\n');
  await execGit(['add', 'Home.md'], { cwd: seed });
  await execGit(['commit', '--quiet', '-m', 'seed'], { cwd: seed });
  await execGit(['remote', 'add', 'origin', bare], { cwd: seed });
  await execGit(['push', '--quiet', '-u', 'origin', 'master'], { cwd: seed });

  const seen = [];
  const git = async (args, options = {}) => {
    seen.push([...args]);
    if (args[0] === 'clone') {
      assert.equal(args.at(-2), 'https://github.com/yo4e/example-repo.wiki.git');
      const rewritten = [...args];
      rewritten[rewritten.length - 2] = bare;
      return await runGit(rewritten, { ...options, token: '' });
    }
    return await runGit(args, { ...options, token: '' });
  };
  return { root, bare, git, seen };
}

test('normalizes safe markdown Wiki page names', () => {
  assert.deepEqual(normalizeWikiPage('Architecture Notes'), {
    page: 'Architecture Notes',
    filename: 'Architecture-Notes.md',
  });
  assert.deepEqual(normalizeWikiPage('_Sidebar.md'), {
    page: '_Sidebar',
    filename: '_Sidebar.md',
  });
});

test('rejects path traversal and GitHub-forbidden filename characters', () => {
  for (const page of ['../Secrets', 'a/b', 'a\\b', 'bad:name', '.hidden', 'trailing.']) {
    assert.throws(() => normalizeWikiPage(page), /wiki page/);
  }
});

test('derives only the exact GitHub Wiki remote', () => {
  assert.equal(buildWikiRemote('yo4e', 'templex-soul'), 'https://github.com/yo4e/templex-soul.wiki.git');
  assert.throws(() => buildWikiRemote('yo4e', '../evil'), /invalid/);
  assert.throws(() => buildWikiRemote('https://evil.example', 'repo'), /invalid/);
});

test('enforces content and commit-message bounds', () => {
  assert.equal(assertWikiContent('hello'), 5);
  assert.throws(() => assertWikiContent('x'.repeat(MAX_WIKI_CONTENT_BYTES + 1)), /safe limit/);
  assert.doesNotThrow(() => assertWikiCommitMessage('Update page'));
  assert.throws(() => assertWikiCommitMessage('bad\nmessage'), /one line/);
});

test('lists and reads Markdown pages without exposing arbitrary paths', async () => {
  const fixture = await makeLocalWiki();
  try {
    const listed = await executeWikiOperation({
      owner: 'yo4e',
      repo: 'example-repo',
      token: 'test-token',
      git: fixture.git,
      wikiOperation: { operation: 'wiki.list' },
    });
    assert.deepEqual(listed.pages, [{ filename: 'Home.md', page: 'Home' }]);

    const read = await executeWikiOperation({
      owner: 'yo4e',
      repo: 'example-repo',
      token: 'test-token',
      git: fixture.git,
      wikiOperation: { operation: 'wiki.read', page: 'Home' },
    });
    assert.equal(read.content, '# Home\n');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('upserts a page via file writes and fixed derived remote', async () => {
  const fixture = await makeLocalWiki();
  try {
    const result = await executeWikiOperation({
      owner: 'yo4e',
      repo: 'example-repo',
      token: 'test-token',
      git: fixture.git,
      wikiOperation: {
        operation: 'wiki.upsert',
        page: 'Architecture',
        content: '# Architecture\n\nSafe content.\n',
        message: 'Update Architecture wiki',
      },
    });
    assert.equal(result.changed, true);

    const verify = path.join(fixture.root, 'verify');
    await execGit(['clone', '--quiet', fixture.bare, verify]);
    assert.equal(await fs.readFile(path.join(verify, 'Architecture.md'), 'utf8'), '# Architecture\n\nSafe content.\n');

    const flattenedArgs = fixture.seen.flat().join('\n');
    assert.equal(flattenedArgs.includes('Safe content.'), false);
    assert.equal(flattenedArgs.includes('test-token'), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('upsert is idempotent when content is already identical', async () => {
  const fixture = await makeLocalWiki();
  try {
    const result = await executeWikiOperation({
      owner: 'yo4e',
      repo: 'example-repo',
      token: 'test-token',
      git: fixture.git,
      wikiOperation: {
        operation: 'wiki.upsert',
        page: 'Home',
        content: '# Home\n',
      },
    });
    assert.equal(result.changed, false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('formats bounded machine-readable-ish audit reports', () => {
  const list = formatWikiReport({
    target: 'yo4e/example-repo',
    result: { operation: 'wiki.list', pages: [{ filename: 'Home.md', page: 'Home' }] },
  });
  assert.match(list, /Operation: wiki\.list/);
  assert.match(list, /"Home\.md"/);

  const read = formatWikiReport({
    target: 'yo4e/example-repo',
    result: { operation: 'wiki.read', page: 'Home', filename: 'Home.md', content: '# Home\n' },
  });
  assert.match(read, /# Home/);
});
