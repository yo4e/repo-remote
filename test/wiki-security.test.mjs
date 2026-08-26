import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecrets } from '../scripts/security.mjs';

test('redacts Basic authorization credentials used by Wiki Git auth', () => {
  const output = redactSecrets('AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46c2VjcmV0\nBasic Zm9vOmJhcg==');
  assert.equal(output.includes('eC1hY2Nlc3MtdG9rZW46c2VjcmV0'), false);
  assert.equal(output.includes('Zm9vOmJhcg=='), false);
  assert.match(output, /Authorization: \[REDACTED\]/i);
  assert.match(output, /Basic \[REDACTED\]/);
});
