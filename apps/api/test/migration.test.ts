import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../src/local-store.js';

test('simultaneous first reads and a write share the same seed snapshot', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tracker-cold-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  const store = new LocalStore(file);
  const work = [
    ...Array.from({ length: 32 }, () => store.read()),
    store.transaction((s) => {
      s.profiles[0]!.bio = 'persisted';
    }),
  ];
  await Promise.all(work);
  const reopened = await new LocalStore(file).read();
  assert.equal(reopened.version, 1);
  assert.equal(reopened.profiles[0]?.bio, 'persisted');
});
test('a damaged snapshot is preserved and can be retried after repair', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tracker-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  const store = new LocalStore(file);
  const seed = await new LocalStore(join(dir, 'clean.json')).read();
  for (const invalid of ['{', '{"version":0}']) {
    await writeFile(file, invalid);
    await assert.rejects(store.read(), /Preserve the data file/);
    assert.equal(await readFile(file, 'utf8'), invalid);
  }
  await writeFile(file, JSON.stringify(seed));
  assert.deepEqual(await store.read(), seed);
});
