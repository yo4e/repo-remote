import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { MAX_COMMAND_BYTES } from './limits.mjs';

const REPOSITORY_HINT = /^(?:[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;
const METADATA_FIELDS = ['description', 'homepage', 'topics', 'is_template', 'delete_branch_on_merge'];
const WIKI_OPERATIONS = new Set(['wiki.upsert', 'wiki.read', 'wiki.list']);

export function commandFingerprint(body) {
  return `sha256:${createHash('sha256').update(String(body), 'utf8').digest('hex')}`;
}

function targetHint(repository, owner) {
  if (typeof repository !== 'string' || repository.length > 200 || !REPOSITORY_HINT.test(repository)) return 'unavailable';
  if (repository.includes('/')) return repository;
  if (typeof owner === 'string' && /^[A-Za-z0-9._-]+$/.test(owner)) return `${owner}/${repository}`;
  return repository;
}

export function collectAuditEvidence(body, owner) {
  const text = typeof body === 'string' ? body : String(body ?? '');
  const bodyBytes = Buffer.byteLength(text, 'utf8');
  const evidence = {
    fingerprint: commandFingerprint(text),
    bodyBytes,
    targetHint: 'unavailable',
    operationHint: 'unavailable',
    changedHint: 'unavailable',
    dryRunHint: 'unknown',
  };

  if (bodyBytes > MAX_COMMAND_BYTES) return evidence;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return evidence;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return evidence;

  evidence.targetHint = targetHint(parsed.repository, owner);
  if (typeof parsed.dry_run === 'boolean') evidence.dryRunHint = String(parsed.dry_run);

  const changed = METADATA_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(parsed, field));
  if (Object.prototype.hasOwnProperty.call(parsed, 'branch_cleanup')) changed.push('branch_cleanup');
  if (WIKI_OPERATIONS.has(parsed.operation)) changed.push(parsed.operation);
  if (changed.length > 0) evidence.changedHint = changed.join(',');

  if (WIKI_OPERATIONS.has(parsed.operation)) {
    evidence.operationHint = parsed.operation;
  } else if (Object.prototype.hasOwnProperty.call(parsed, 'branch_cleanup')) {
    evidence.operationHint = 'branch_cleanup';
  } else if (changed.some((field) => METADATA_FIELDS.includes(field))) {
    evidence.operationHint = 'metadata.update';
  }

  return evidence;
}

function setOutput(output, name, value) {
  if (!output) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(output, `${name}=${safe}\n`);
}

function main() {
  const body = process.env.COMMAND_BODY || '';
  const owner = process.env.OWNER || '';
  const output = process.env.GITHUB_OUTPUT || '';
  const evidence = collectAuditEvidence(body, owner);

  setOutput(output, 'fingerprint', evidence.fingerprint);
  setOutput(output, 'body_bytes', evidence.bodyBytes);
  setOutput(output, 'target_hint', evidence.targetHint);
  setOutput(output, 'operation_hint', evidence.operationHint);
  setOutput(output, 'changed_hint', evidence.changedHint);
  setOutput(output, 'dry_run_hint', evidence.dryRunHint);

  console.log(`Captured audit evidence ${evidence.fingerprint} (${evidence.bodyBytes} bytes)`);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) main();
