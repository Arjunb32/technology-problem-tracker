import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalStore } from '../src/local-store.js';
import fixture from '../src/demo-state.json' with { type: 'json' };
import { SupabaseStore } from '../src/store.js';

function command(
  op: string,
  actor: string,
  id: string,
  data: unknown,
  demo = false,
  seed = '972d7a24-4c27-40ef-accf-4cfcfaccb997',
) {
  return JSON.stringify({
    op,
    actor,
    id,
    data,
    demo,
    now: '2026-11-23T01:01:00.000Z',
    seed,
    publicUrl: 'https://fixture.example',
  });
}

function fakeStorage(outcomes: (boolean | { code: string; message: string })[]) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let attempts = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const method = new URL(request.url).pathname.split('/').at(-1)!;
    const body = (await request.json()) as Record<string, unknown>;
    calls.push({ method, body });
    if (method === 'tracker_snapshot') return Response.json({ ...fixture, version: 10 + attempts });
    assert.equal(method, 'tracker_commit');
    const result = outcomes[attempts++];
    if (typeof result === 'boolean') return Response.json(result);
    return Response.json(result, { status: result?.code === '23505' ? 409 : 500 });
  };
  return { store: new SupabaseStore('https://fixture.supabase.co', 'fixture', fetcher), calls };
}

test('Supabase retries against a fresh snapshot and commits only changed rows', async () => {
  const { store, calls } = fakeStorage([false, true]);
  const result = await store.command<{ body: string }>(
    command('comment', 'demo-alex', fixture.problems[0]!.id, { body: 'New evidence.' }),
  );
  assert.equal(result.body, 'New evidence.');
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['tracker_snapshot', 'tracker_commit', 'tracker_snapshot', 'tracker_commit'],
  );
  assert.equal(calls[1]!.body.p_expected, 10);
  assert.equal(calls[3]!.body.p_expected, 11);
  assert.deepEqual(Object.keys(calls[3]!.body.p_changes as object).sort(), ['comments', 'limits']);
});

test('ambiguous PostgREST failures cannot trigger a second write', async () => {
  const { store, calls } = fakeStorage([{ code: 'other', message: 'unavailable' }, true]);
  const request = command('comment', 'demo-alex', fixture.problems[0]!.id, {
    body: 'New evidence.',
  });
  await assert.rejects(store.command(request), { status: 503, code: 'database_unavailable' });
  assert.equal(calls.length, 2);
});

test('legacy demo state is read with an interrupted temporary file and changes serialize across store instances', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tracker-local-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'demo.json');
  await writeFile(path, JSON.stringify(fixture), 'utf8');
  await writeFile(path + '.interrupted.tmp', '{"version":', 'utf8');
  const first = new LocalStore(path);
  const second = new LocalStore(join(dir, '.', 'demo.json'));
  const problem = fixture.problems[0]!.id;
  const firstComment = first.command(
    command('comment', 'demo-alex', problem, { body: 'First comment.' }, true),
  );
  const secondComment = second.command(
    command(
      'comment',
      'demo-sam',
      problem,
      { body: 'Second comment.' },
      true,
      '372d7a24-4c27-40ef-accf-4cfcfaccb997',
    ),
  );
  await Promise.all([firstComment, secondComment]);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.version, fixture.version + 2);
  assert.deepEqual(
    saved.comments.slice(-2).map(({ body }: { body: string }) => body),
    ['First comment.', 'Second comment.'],
  );
});
