import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('command workflow avoids duplicate opened+labeled execution', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repo-remote.yml', import.meta.url), 'utf8');

  assert.match(workflow, /types:\s*\[edited, labeled\]/);
  assert.doesNotMatch(workflow, /types:\s*\[[^\]]*opened/);
});
