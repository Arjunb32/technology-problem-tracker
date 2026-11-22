// Exercise the historical entry points as an owner would, including cwd-relative paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const fixture = fileURLToPath(new URL('../tests/fixtures/media-v1', import.meta.url));
const run = (name, args, env = {}) =>
  spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./' + name + '.mjs', import.meta.url)), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
test('all owner entry points accept help and reject unknown flags with exit code 1', () => {
  for (const name of ['backup-db', 'backup-media', 'restore-media', 'verify-backup']) {
    assert.match(run(name, ['--help']).stdout, /Usage:/);
    const failure = run(name, ['--unknown']);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /Unknown command option/);
  }
});
test('legacy media manifest verifies and restore preflight does not contact the provider', () => {
  const checked = run('verify-backup', ['--dir', fixture]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Verified media backup: 1 files/);
  const env = {
    SUPABASE_URL: 'https://testfixture.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-only',
  };
  const preflight = run('restore-media', ['--dir', fixture], env);
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stdout, /No remote writes occurred/);
  const refused = run(
    'restore-media',
    ['--dir', fixture, '--apply', '--confirm-ref', 'wrong'],
    env,
  );
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /target SUPABASE_URL/);
});
