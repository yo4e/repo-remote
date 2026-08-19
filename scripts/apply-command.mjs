import fs from 'node:fs';

const OWNER = process.env.OWNER || 'yo4e';
const TOKEN = process.env.REMOTE_TOKEN || '';
const BODY = process.env.COMMAND_BODY || '';
const OUTPUT = process.env.GITHUB_OUTPUT || '';

function fail(message) {
  console.error(`repo-remote: ${message}`);
  process.exit(1);
}

function setOutput(name, value) {
  if (!OUTPUT) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(OUTPUT, `${name}=${safe}\n`);
}

function normalizeTopic(value) {
  if (typeof value !== 'string') fail('every topic must be a string');
  const topic = value.trim().toLowerCase();
  if (!topic) fail('topics may not contain empty values');
  if (topic.length > 50) fail(`topic is longer than 50 characters: ${topic}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(topic)) {
    fail(`invalid topic "${topic}"; use lowercase letters, numbers, and hyphens`);
  }
  return topic;
}

let command;
try {
  command = JSON.parse(BODY);
} catch (error) {
  fail(`Issue body must be valid JSON (${error.message})`);
}

if (!command || Array.isArray(command) || typeof command !== 'object') {
  fail('Issue body must be a JSON object');
}

const allowed = new Set(['repository', 'description', 'homepage', 'topics', 'dry_run']);
for (const key of Object.keys(command)) {
  if (!allowed.has(key)) fail(`unknown command key: ${key}`);
}

if (typeof command.repository !== 'string' || !command.repository.trim()) {
  fail('repository is required');
}

let targetOwner = OWNER;
let repo = command.repository.trim();
if (repo.includes('/')) {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) fail('repository must be NAME or OWNER/NAME');
  [targetOwner, repo] = parts;
}

if (targetOwner.toLowerCase() !== OWNER.toLowerCase()) {
  fail(`target owner must be ${OWNER}`);
}
if (!/^[A-Za-z0-9._-]+$/.test(repo)) fail('repository name contains unsupported characters');

const hasDescription = Object.prototype.hasOwnProperty.call(command, 'description');
const hasHomepage = Object.prototype.hasOwnProperty.call(command, 'homepage');
const hasTopics = Object.prototype.hasOwnProperty.call(command, 'topics');
if (!hasDescription && !hasHomepage && !hasTopics) {
  fail('at least one of description, homepage, or topics is required');
}

if (hasDescription && command.description !== null && typeof command.description !== 'string') {
  fail('description must be a string or null');
}
if (hasDescription && typeof command.description === 'string' && command.description.length > 350) {
  fail('description must be 350 characters or fewer');
}

if (hasHomepage && command.homepage !== null && typeof command.homepage !== 'string') {
  fail('homepage must be a string or null');
}
if (hasHomepage && typeof command.homepage === 'string' && command.homepage.length > 0) {
  let parsed;
  try {
    parsed = new URL(command.homepage);
  } catch {
    fail('homepage must be an absolute http(s) URL, an empty string, or null');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail('homepage must use http or https');
  }
}

let topics;
if (hasTopics) {
  if (!Array.isArray(command.topics)) fail('topics must be an array');
  if (command.topics.length > 20) fail('GitHub allows at most 20 topics');
  topics = [...new Set(command.topics.map(normalizeTopic))];
}

const changed = [
  hasDescription && 'description',
  hasHomepage && 'homepage',
  hasTopics && 'topics',
].filter(Boolean);
const target = `${OWNER}/${repo}`;
const dryRun = command.dry_run === true;

if (dryRun) {
  const summary = `Dry run validated ${target}: ${changed.join(', ')}`;
  console.log(summary);
  setOutput('summary', summary);
  setOutput('target', target);
  setOutput('dry_run', 'true');
  process.exit(0);
}

if (!TOKEN) fail('REPO_REMOTE_TOKEN is not configured');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': '2026-03-10',
  'User-Agent': 'yo4e-repo-remote',
  'Content-Type': 'application/json',
};

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || text;
    } catch {}
    fail(`GitHub API ${response.status} for ${path}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

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
