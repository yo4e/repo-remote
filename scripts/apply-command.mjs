import fs from 'node:fs';
import { parseCommandPacket } from './command.mjs';
import { redactSecrets } from './security.mjs';

const OWNER = process.env.OWNER || '';
const TOKEN = process.env.REMOTE_TOKEN || '';
const BODY = process.env.COMMAND_BODY || '';
const OUTPUT = process.env.GITHUB_OUTPUT || '';

function fail(message) {
  console.error(`repo-remote: ${redactSecrets(message, [TOKEN])}`);
  process.exit(1);
}

function setOutput(name, value) {
  if (!OUTPUT) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(OUTPUT, `${name}=${safe}\n`);
}

async function main() {
  if (!OWNER) throw new Error('OWNER is not configured');
  const packet = parseCommandPacket(BODY, OWNER);
  const { command, repo, target, changed, topics, dryRun } = packet;

  if (dryRun) {
    const summary = `Dry run validated ${target}: ${changed.join(', ')}`;
    console.log(summary);
    setOutput('summary', summary);
    setOutput('target', target);
    setOutput('dry_run', 'true');
    return;
  }

  if (!TOKEN) throw new Error('REPO_REMOTE_TOKEN is not configured');

  async function github(path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'User-Agent': 'repo-remote/0.x',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    if (!response.ok) {
      let detail = 'request failed';
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {}
      throw new Error(`GitHub API ${response.status} for ${path}: ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }

  const hasDescription = Object.prototype.hasOwnProperty.call(command, 'description');
  const hasHomepage = Object.prototype.hasOwnProperty.call(command, 'homepage');
  const hasTopics = Object.prototype.hasOwnProperty.call(command, 'topics');

  if (hasDescription || hasHomepage) {
    const payload = {};
    if (hasDescription) payload.description = command.description;
    if (hasHomepage) payload.homepage = command.homepage;
    await github(`/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  if (hasTopics) {
    await github(`/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo)}/topics`, {
      method: 'PUT',
      body: JSON.stringify({ names: topics }),
    });
  }

  const summary = `Updated ${target}: ${changed.join(', ')}`;
  console.log(summary);
  setOutput('summary', summary);
  setOutput('target', target);
  setOutput('dry_run', 'false');
}

main().catch((error) => fail(error instanceof Error ? error.message : 'unexpected failure'));
