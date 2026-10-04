import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

let pg;
before(async () => {
  pg = await PGlite.create({ extensions: { pg_trgm } });
  await pg.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]
    );
  `);
  await pg.exec(
    await readFile(new URL('../../supabase/migrations/001_tracker.sql', import.meta.url), 'utf8'),
  );
});
after(async () => {
  if (pg) await pg.close();
});

test('the production migration installs and every application table denies browser access', async () => {
  const { rows } = await pg.query(
    `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`,
  );
  assert.ok(rows.length >= 10, 'Core relational tables must exist.');
  for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} must enable RLS`);
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(pg.query('SELECT * FROM public.profiles'), /permission denied/);
    } finally {
      await pg.exec('RESET ROLE');
    }
    const permissions = await pg.query(
      `SELECT has_function_privilege($1, 'public.tracker_commit(bigint,jsonb)', 'execute') AS allowed`,
      [role],
    );
    assert.equal(
      permissions.rows[0].allowed,
      false,
      `${role} cannot invoke privileged transactions`,
    );
  }
});

test('optimistic transaction versions reject stale commits', async () => {
  const snapshot = await pg.query('SELECT public.tracker_snapshot() AS state');
  const version = snapshot.rows[0].state.version;
  const first = await pg.query('SELECT public.tracker_commit($1::bigint, $2::jsonb) AS saved', [
    version,
    '{}',
  ]);
  assert.equal(first.rows[0].saved, true);
  const stale = await pg.query('SELECT public.tracker_commit($1::bigint, $2::jsonb) AS saved', [
    version,
    '{}',
  ]);
  assert.equal(stale.rows[0].saved, false);
  const next = await pg.query('SELECT public.tracker_snapshot() AS state');
  assert.equal(next.rows[0].state.version, version + 1);
});

test('production feed and search are executable on an empty database', async () => {
  const feed = await pg.query("SELECT public.tracker_feed('trending', NULL, NULL, NULL) AS feed");
  assert.deepEqual(feed.rows[0].feed.items, []);
  assert.equal(feed.rows[0].feed.total, 0);
  const search = await pg.query("SELECT * FROM public.tracker_search('Wi-Fi')");
  assert.deepEqual(search.rows, []);
});

const stamp = new Date().toISOString();
const userIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
];
async function state() {
  return (await pg.query('SELECT public.tracker_snapshot() AS state')).rows[0].state;
}
async function commit(changes) {
  const snapshot = await state();
  return pg.query('SELECT public.tracker_commit($1::bigint,$2::jsonb) AS saved', [
    snapshot.version,
    JSON.stringify(changes),
  ]);
}
function changes(rows) {
  return { upsert: rows, remove: [] };
}
function report(id) {
  return {
    id,
    authorId: userIds[0],
    title: 'Network adapter fails after sleep',
    description: 'The adapter stops responding after waking the laptop.',
    category: 'Networking',
    product: 'Network adapter',
    classification: 'Software',
    setup: 'Windows 11, driver 1.2',
    symptoms: '',
    steps: '',
    attemptedFixes: '',
    tags: ['Wi-Fi'],
    status: 'Reported',
    canonicalId: null,
    hidden: false,
    demo: false,
    createdAt: stamp,
    updatedAt: stamp,
    resolvedAt: null,
    version: 1,
  };
}
test('duplicate affected confirmations roll back the entire transaction', async () => {
  for (const id of userIds) await pg.query('INSERT INTO auth.users(id) VALUES ($1::uuid)', [id]);
  await commit({
    profiles: changes(
      userIds.map((id, i) => ({
        id,
        username: `postgres_user_${i}`,
        displayName: `Test User ${i}`,
        bio: '',
        expertise: [],
        role: i === 2 ? 'admin' : 'member',
        restricted: false,
        createdAt: stamp,
      })),
    ),
  });
  const before = await state();
  const affected = (id) => ({
    id,
    problemId: 'postgres-rollback',
    userId: userIds[0],
    kind: 'affected',
    setup: 'Windows 11, driver 1.2',
    createdAt: stamp,
  });
  await assert.rejects(
    commit({
      problems: changes([report('postgres-rollback')]),
      participation: changes([affected('duplicate-one'), affected('duplicate-two')]),
    }),
    /duplicate key/,
  );
  const after = await state();
  assert.equal(after.version, before.version);
  assert.equal(
    after.problems.some((p) => p.id === 'postgres-rollback'),
    false,
  );
});

test('verified fixes require independent evidence and stay attached to their tested revision', async () => {
  const pid = 'postgres-lifecycle',
    sid = 'postgres-solution',
    rid = 'postgres-revision-1';
  const problem = report(pid);
  await commit({
    problems: changes([problem]),
    participation: changes(
      userIds.slice(0, 2).map((userId, i) => ({
        id: `postgres-affected-${i}`,
        problemId: pid,
        userId,
        kind: 'affected',
        setup: problem.setup,
        createdAt: stamp,
      })),
    ),
    solutions: changes([
      {
        id: sid,
        problemId: pid,
        authorId: userIds[1],
        hidden: false,
        demo: false,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]),
    revisions: changes([
      {
        id: rid,
        solutionId: sid,
        number: 1,
        title: 'Reconfigure adapter power saving',
        instructions:
          'Record the original settings and disable power saving before testing sleep cycles.',
        reasoning: 'Reproduces the adapter power state issue.',
        supportedSetup: problem.setup,
        limitations: 'Only this driver version.',
        warnings: 'Save work first.',
        createdAt: stamp,
      },
    ]),
  });
  const verification = {
    id: 'postgres-verification',
    revisionId: rid,
    reviewerId: userIds[2],
    decision: 'verified',
    evidence: 'Independently reproduced three successful wake cycles.',
    supportedScope: problem.setup,
    reason: 'Current evidence covers this device and driver.',
    createdAt: stamp,
  };
  await assert.rejects(
    commit({ verifications: changes([verification]) }),
    /Independent test evidence required/,
  );
  await commit({
    tests: changes([
      {
        id: 'postgres-test',
        userId: userIds[0],
        revisionId: rid,
        outcome: 'Worked',
        setup: problem.setup,
        evidence: 'Three successful wake cycles.',
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]),
  });
  await assert.rejects(
    commit({ verifications: changes([{ ...verification, reviewerId: userIds[0] }]) }),
    /Moderator permission required/,
  );
  await commit({
    verifications: changes([verification]),
    problems: changes([{ ...problem, status: 'Resolved', resolvedAt: stamp }]),
  });
  let feed = (
    await pg.query("SELECT public.tracker_feed('affected', NULL, NULL, $1) AS feed", [userIds[0]])
  ).rows[0].feed;
  assert.equal(feed.items[0].affectedCount, 2);
  assert.equal(feed.items[0].verifiedCount, 1);
  assert.equal(feed.items[0].viewer.affected, true);
  assert.equal('restricted' in feed.items[0].author, false);
  const revised = {
    ...(await state()).revisions.find((r) => r.id === rid),
    id: 'postgres-revision-2',
    number: 2,
  };
  await assert.rejects(commit({ revisions: changes([revised]) }), /Current verification required/);
  await assert.rejects(
    commit({
      solutions: changes([
        { ...(await state()).solutions.find((s) => s.id === sid), hidden: true },
      ]),
    }),
    /Current verification required/,
  );
  await assert.rejects(
    commit({
      verifications: changes([{ ...verification, id: 'postgres-revoked', decision: 'revoked' }]),
    }),
    /Current verification required/,
  );
  assert.equal(
    (await state()).revisions.some((r) => r.id === revised.id),
    false,
    'Failed revision writes roll back',
  );
  await commit({ problems: changes([{ ...problem, status: 'Partially solved' }]) });
  await assert.rejects(commit({ revisions: changes([revised]) }), /Current verification required/);
  await commit({
    revisions: changes([revised]),
    problems: changes([{ ...problem, status: 'Reopened' }]),
  });
  await assert.rejects(
    commit({ verifications: changes([{ ...verification, id: 'postgres-stale-verification' }]) }),
    /Only current revision/,
  );
  const preserved = await state();
  assert.equal(preserved.tests.filter((t) => t.revisionId === rid).length, 1);
  assert.equal(preserved.verifications.filter((v) => v.revisionId === rid).length, 1);
  feed = (await pg.query("SELECT public.tracker_feed('affected', NULL, NULL, NULL) AS feed"))
    .rows[0].feed;
  assert.equal(feed.items[0].verifiedCount, 0);
  await assert.rejects(
    commit({ problems: changes([{ ...problem, status: 'Resolved', resolvedAt: stamp }]) }),
    /Current verification required/,
  );
  const found = await pg.query("SELECT * FROM public.tracker_search('Network adapter')");
  assert.ok(found.rows.some((row) => row.id === pid));
});
