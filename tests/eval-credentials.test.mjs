import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCredential } from '../scripts/eval-memories-provider.ts';

test('credential resolver reads absolute file references without exposing failures', async () => {
  assert.equal(await resolveCredential('{file:/private/key}', async path => {
    assert.equal(path, '/private/key');
    return 'fake-key\n';
  }), 'fake-key');
  assert.equal(await resolveCredential('direct-key'), 'direct-key');
  for (const value of ['{file:relative}', '{env:SECRET}', '{file:/missing}', 'bad\nkey', '']) {
    await assert.rejects(resolveCredential(value, async () => { throw new Error('private secret'); }),
      error => error.category === 'authorization' && !error.message.includes('secret'));
  }
});
