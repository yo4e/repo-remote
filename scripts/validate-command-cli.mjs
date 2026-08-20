import fs from 'node:fs';
import { parseCommandPacket } from './command.mjs';

const OWNER = process.env.OWNER || '';
const BODY = process.env.COMMAND_BODY || '';
const OUTPUT = process.env.GITHUB_OUTPUT || '';

function setOutput(name, value) {
  if (!OUTPUT) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(OUTPUT, `${name}=${safe}\n`);
}

try {
  if (!OWNER) throw new Error('OWNER is not configured');
  const packet = parseCommandPacket(BODY, OWNER);
  setOutput('target', packet.target);
  setOutput('changed', packet.changed.join(','));
  setOutput('dry_run', String(packet.dryRun));
  console.log(`Validated ${packet.target}: ${packet.changed.join(', ')}`);
} catch (error) {
  console.error(`repo-remote: ${error instanceof Error ? error.message : 'command validation failed'}`);
  process.exit(1);
}
