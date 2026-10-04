import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '../src/local-store.js';
import { TrackerService } from '../src/service.js';
import { createApp } from '../src/app.js';
import { fail, ApiFailure, type Store } from '../src/state.js';
import { testStats, type Problem, type Solution } from '@tracker/contracts';

const problemInput = {
  title: 'Laptop stops charging after system wakes up',
  description:
    'The laptop does not resume charging after sleep, although the same charger works before sleep.',
  category: 'Computers',
  product: 'USB-C laptop',
  classification: 'Hardware',
  setup: 'Windows 11 · USB-C charger',
  symptoms: 'Charging icon disappears',
  steps: 'Sleep and wake',
  attemptedFixes: 'Reconnected charger',
  tags: ['Charging'],
  affected: true,
};
const solutionInput = {
  title: 'Reconnect the charger after waking',
  instructions:
    'Disconnect the USB-C charger, wait ten seconds, and reconnect it. Check the charge indicator.',
  reasoning: 'Reinitializes the device power negotiation.',
  supportedSetup: 'Windows 11 · USB-C laptop',
  limitations: 'A temporary workaround.',
  warnings: 'Save work before troubleshooting.',
};
async function fixture(t: test.TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'tracker-api-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'state.json');
  const store = new LocalStore(file);
  const service = new TrackerService(store, 'http://localhost:8787');
  const app = createApp(
    service,
    {
      authenticate: async (token) => {
        if (!/^demo:demo-(alex|sam|morgan)$/.test(token))
          fail(401, 'unauthorized', 'Invalid session.');
        return service.me(token.slice(5));
      },
    },
    { demo: true, configuredAuth: false, origins: ['http://localhost:5173'] },
  );
  async function request(method: string, path: string, body?: unknown, user?: string) {
    const response = await app.request(`http://localhost:8787/api/v1${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(user ? { Authorization: `Bearer demo:${user}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  return { store, service, app, request, file };
}
test('complete report, confirm, investigate, independently test, verify, and resolve journey', async (t) => {
  const { request } = await fixture(t);
  const created = await request('POST', '/problems', problemInput, 'demo-alex');
  assert.equal(created.status, 201);
  const p = created.body as Problem;
  assert.equal(p.affectedCount, 1);
  assert.equal(p.status, 'Reported');
  assert.equal((await request('POST', '/problems', problemInput)).status, 401);
  const confirmed = await request(
    'PUT',
    `/problems/${p.id}/participation`,
    { kind: 'affected', active: true, setup: 'Windows 11 · same charger' },
    'demo-sam',
  );
  assert.equal(confirmed.body.status, 'Confirmed');
  assert.equal(confirmed.body.affectedCount, 2);
  const again = await request(
    'PUT',
    `/problems/${p.id}/participation`,
    { kind: 'affected', active: true, setup: 'Windows 11 · same charger' },
    'demo-sam',
  );
  assert.equal(again.body.affectedCount, 2);
  const sol = (await request('POST', `/problems/${p.id}/solutions`, solutionInput, 'demo-sam'))
    .body as Solution;
  const verify = {
    revisionId: sol.currentRevision.id,
    evidence: 'The charger resumed charging after the independent test.',
    supportedScope: solutionInput.supportedSetup,
    reason: 'Test evidence supports the specified charging setup.',
    decision: 'verified',
  };
  assert.equal(
    (await request('POST', `/moderation/solutions/${sol.id}/verify`, verify, 'demo-morgan')).status,
    422,
  );
  assert.equal(
    (
      await request(
        'PUT',
        `/solutions/${sol.id}/tests`,
        {
          revisionId: sol.currentRevision.id,
          outcome: 'Worked',
          setup: problemInput.setup,
          evidence: 'The charge indicator returned after reconnecting.',
        },
        'demo-alex',
      )
    ).status,
    200,
  );
  assert.equal(
    (await request('POST', `/moderation/solutions/${sol.id}/verify`, verify, 'demo-morgan')).status,
    200,
  );
  const resolved = await request(
    'POST',
    `/moderation/problems/${p.id}/status`,
    { status: 'Resolved', reason: 'The verified fix covers the reported device and version.' },
    'demo-morgan',
  );
  assert.equal(resolved.body.status, 'Resolved');
  assert.ok(resolved.body.resolvedAt);
  const detail = (await request('GET', `/problems/${p.id}`)).body;
  assert.equal(detail.problem.verifiedCount, 1);
  assert.equal(detail.solutions[0].currentRevision.tests.length, 1);
  assert.ok(detail.timeline.some((x: any) => x.toStatus === 'Confirmed'));
  assert.ok(detail.timeline.some((x: any) => x.toStatus === 'Resolved'));
  const notifications = (await request('GET', '/me/notifications', undefined, 'demo-alex')).body;
  assert.ok(notifications.some((n: any) => n.problemId === p.id));
  assert.ok(!JSON.stringify(detail).includes('restricted'));
});
test('concurrent confirmations and votes remain unique; withdrawing confirmation keeps status consistent', async (t) => {
  const { service } = await fixture(t);
  const p = await service.createProblem('demo-alex', problemInput);
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      service.participate('demo-sam', p.id, {
        kind: 'affected',
        active: true,
        setup: 'Windows 11 laptop',
      }),
    ),
  );
  assert.ok(results.every((p) => p.affectedCount === 2));
  await Promise.all(
    Array.from({ length: 12 }, () =>
      service.participate('demo-sam', p.id, { kind: 'vote', active: true }),
    ),
  );
  assert.equal((await service.detail(p.id, null)).problem.voteCount, 1);
  const withdrawn = await service.participate('demo-sam', p.id, {
    kind: 'affected',
    active: false,
  });
  assert.equal(withdrawn.status, 'Needs information');
  assert.equal(withdrawn.affectedCount, 1);
});
test('author cannot self verify even as admin, members cannot moderate, and restrictions protect private reads', async (t) => {
  const { request, store, service } = await fixture(t);
  const p = await service.createProblem('demo-alex', problemInput);
  const sol = await service.addSolution('demo-morgan', p.id, solutionInput);
  await service.test('demo-alex', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Worked',
    setup: problemInput.setup,
  });
  const input = {
    revisionId: sol.currentRevision.id,
    evidence: 'Independent tester reported the workaround worked.',
    supportedScope: problemInput.setup,
    reason: 'Review based on independent test evidence.',
    decision: 'verified',
  };
  assert.equal(
    (await request('POST', `/moderation/solutions/${sol.id}/verify`, input, 'demo-morgan')).body
      .error,
    'self_verification',
  );
  assert.equal((await request('GET', '/moderation', undefined, 'demo-alex')).status, 403);
  assert.equal(
    (
      await request(
        'PATCH',
        '/me',
        { displayName: 'Alex Chen', username: 'alexchen', bio: '', expertise: [], role: 'admin' },
        'demo-alex',
      )
    ).status,
    422,
  );
  await store.transaction((s) => {
    s.profiles.find((x) => x.id === 'demo-morgan')!.restricted = true;
    s.problems.find((x) => x.id === p.id)!.hidden = true;
  });
  assert.equal((await request('GET', '/moderation', undefined, 'demo-morgan')).status, 403);
  assert.equal((await request('GET', `/problems/${p.id}`, undefined, 'demo-morgan')).status, 404);
  assert.equal((await request('POST', '/problems', problemInput, 'demo-morgan')).status, 403);
  const profile = await request('GET', '/profiles/demo-morgan');
  assert.equal(profile.status, 200);
  assert.equal('restricted' in profile.body.profile, false);
});
test('revision tests stay on their revision; revising verified fix reopens and needs fresh verification', async (t) => {
  const { service } = await fixture(t);
  const detail = await service.detail('demo-dns', null);
  const sol = detail.solutions[0]!;
  assert.equal(detail.problem.status, 'Resolved');
  assert.equal(sol.currentRevision.verification?.decision, 'verified');
  const revised = await service.editSolution('demo-sam', sol.id, {
    ...solutionInput,
    title: 'Reconnect the DNS resolver with an updated process',
  });
  assert.equal(revised.currentRevision.number, 2);
  assert.equal(revised.currentRevision.verification, null);
  assert.equal(revised.currentRevision.tests.length, 0);
  assert.equal(revised.revisions[1]!.tests.length, 1);
  assert.equal((await service.detail('demo-dns', null)).problem.status, 'Reopened');
  await assert.rejects(
    () =>
      service.verify('demo-morgan', sol.id, {
        revisionId: sol.currentRevision.id,
        evidence: 'Previous evidence remains available for old revision.',
        supportedScope: solutionInput.supportedSetup,
        reason: 'Old revision is obsolete and cannot be current.',
        decision: 'verified',
      }),
    { code: 'outdated_revision' },
  );
  await assert.rejects(
    () =>
      service.status('demo-morgan', 'demo-dns', {
        status: 'Resolved',
        reason: 'The previous verification is no longer current.',
      }),
    { code: 'verification_required' },
  );
});
test('partially solved records reopen when their last verified revision is revised, hidden, or revoked', async (t) => {
  for (const action of ['revise', 'hide', 'revoke'])
    await t.test(action, async (child) => {
      const { service } = await fixture(child);
      const detail = await service.detail('demo-dns', null);
      const sol = detail.solutions[0]!;
      await service.status('demo-morgan', detail.problem.id, {
        status: 'Partially solved',
        reason: 'The verified workaround covers only a subset of reported setups.',
      });
      if (action === 'revise')
        await service.editSolution('demo-sam', sol.id, {
          ...solutionInput,
          title: 'A revised DNS workaround needing independent testing',
        });
      else if (action === 'hide')
        await service.hide('demo-morgan', {
          targetType: 'solution',
          targetId: sol.id,
          hidden: true,
          reason: 'Remove these instructions while their safety is investigated.',
        });
      else
        await service.verify('demo-morgan', sol.id, {
          revisionId: sol.currentRevision.id,
          decision: 'revoked',
          evidence: 'Independent testing now contradicts the original evidence.',
          supportedScope: solutionInput.supportedSetup,
          reason: 'This workaround no longer has sufficient supporting evidence.',
        });
      const reopened = await service.detail(detail.problem.id, null);
      assert.equal(reopened.problem.status, 'Reopened');
      assert.equal(reopened.problem.verifiedCount, 0);
      assert.ok(
        reopened.timeline.some(
          (event) => event.fromStatus === 'Partially solved' && event.toStatus === 'Reopened',
        ),
      );
    });
});

test('scope changes and hiding last verified fix reopen a resolved problem', async (t) => {
  const { service } = await fixture(t);
  const p = (await service.detail('demo-dns', null)).problem;
  const edited = await service.editProblem(p.authorId, p.id, {
    ...problemInput,
    category: p.category,
    title: p.title,
    description: p.description,
    product: p.product,
    setup: 'A different operating system and resolver',
    version: p.version,
  });
  assert.equal(edited.status, 'Reopened');
  const another = await service.createProblem('demo-alex', problemInput);
  const sol = await service.addSolution('demo-sam', another.id, solutionInput);
  await service.test('demo-alex', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Worked',
    setup: problemInput.setup,
  });
  await service.verify('demo-morgan', sol.id, {
    revisionId: sol.currentRevision.id,
    decision: 'verified',
    evidence: 'An independent test succeeded on the stated setup.',
    supportedScope: problemInput.setup,
    reason: 'This independent successful test supports the workaround.',
  });
  await service.status('demo-morgan', another.id, {
    status: 'Resolved',
    reason: 'Verified solution covers the reported scope.',
  });
  await service.hide('demo-morgan', {
    targetType: 'solution',
    targetId: sol.id,
    hidden: true,
    reason: 'The instructions need a safety review before publication.',
  });
  assert.equal((await service.detail(another.id, null)).problem.status, 'Reopened');
});
test('duplicate merge deduplicates participation, preserves solutions/tests/discussion, redirects and rejects cycles', async (t) => {
  const { service } = await fixture(t);
  const source = await service.createProblem('demo-alex', problemInput);
  const target = await service.createProblem('demo-alex', {
    ...problemInput,
    title: 'Charging does not restart after waking my laptop',
  });
  await service.participate('demo-sam', source.id, {
    kind: 'affected',
    active: true,
    setup: 'A USB-C laptop on Windows 11',
  });
  await service.participate('demo-sam', target.id, {
    kind: 'affected',
    active: true,
    setup: 'Another Windows laptop',
  });
  await service.participate('demo-sam', source.id, { kind: 'vote', active: true });
  await service.participate('demo-sam', target.id, { kind: 'vote', active: true });
  const sol = await service.addSolution('demo-sam', source.id, solutionInput);
  await service.test('demo-alex', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Worked',
    setup: problemInput.setup,
  });
  await service.comment('demo-sam', source.id, {
    body: 'The affected charger has firmware version 2.1.',
  });
  const preview = await service.mergePreview('demo-morgan', source.id, target.id);
  assert.equal(preview.affectedBefore, 4);
  assert.equal(preview.affectedAfter, 2);
  assert.equal(preview.votesAfter, 1);
  await service.merge('demo-morgan', {
    sourceId: source.id,
    targetId: target.id,
    reason: 'Both reports describe the same sleep charging failure.',
  });
  const canonical = await service.detail(target.id, null);
  assert.equal(canonical.problem.affectedCount, 2);
  assert.equal(canonical.problem.voteCount, 1);
  assert.equal(canonical.solutions[0]!.currentRevision.tests.length, 1);
  assert.equal(canonical.comments.length, 1);
  assert.equal((await service.detail(source.id, null)).redirectId, target.id);
  assert.ok(
    canonical.timeline.some(
      (event) =>
        event.kind === 'merged_affected_setup' &&
        event.actorId === 'demo-sam' &&
        event.reason.includes('A USB-C laptop on Windows 11'),
    ),
  );
  assert.equal(
    (await service.detail(target.id, 'demo-sam')).problem.viewer.setup,
    'Another Windows laptop',
  );
  await assert.rejects(
    () =>
      service.merge('demo-morgan', {
        sourceId: source.id,
        targetId: target.id,
        reason: 'Attempting a repeated merge after completion.',
      }),
    { code: 'duplicate' },
  );
  await assert.rejects(
    () =>
      service.merge('demo-morgan', {
        sourceId: target.id,
        targetId: source.id,
        reason: 'Attempting a cycle through the duplicate problem.',
      }),
    { code: 'duplicate' },
  );
  await assert.rejects(() => service.mergePreview('demo-morgan', target.id, target.id), {
    code: 'invalid_merge',
  });
});
test('uploads enforce ownership, signatures, size, contribution cap, and visibility', async (t) => {
  const { service } = await fixture(t);
  const p = await service.createProblem('demo-alex', problemInput);
  const valid = new File(
    [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])],
    'test.png',
    { type: 'image/png' },
  );
  await assert.rejects(() => service.upload('demo-sam', 'problem', p.id, valid), {
    code: 'forbidden',
  });
  await assert.rejects(
    () =>
      service.upload(
        'demo-alex',
        'problem',
        p.id,
        new File(['<svg>bad</svg>'], 'x.png', { type: 'image/png' }),
      ),
    { code: 'invalid_upload' },
  );
  await assert.rejects(
    () =>
      service.upload(
        'demo-alex',
        'problem',
        p.id,
        new File([new Uint8Array(513000)], 'large.png', { type: 'image/png' }),
      ),
    { code: 'invalid_upload' },
  );
  const a = await service.upload('demo-alex', 'problem', p.id, valid);
  assert.ok(!('data' in a));
  assert.equal((await service.image(a.id, null)).mime, 'image/png');
  await service.upload('demo-alex', 'problem', p.id, valid);
  await service.upload('demo-alex', 'problem', p.id, valid);
  await assert.rejects(() => service.upload('demo-alex', 'problem', p.id, valid), {
    code: 'attachment_limit',
  });
  await service.hide('demo-morgan', {
    targetType: 'problem',
    targetId: p.id,
    hidden: true,
    reason: 'An image contains information that needs review.',
  });
  await assert.rejects(() => service.image(a.id, null), { code: 'not_found' });
  await assert.rejects(() => service.deleteImage('demo-sam', a.id), { code: 'forbidden' });
});
test('durable local data survives restart; incorrect CORS and large JSON fail before writes', async (t) => {
  const { store, service, app, file } = await fixture(t);
  const p = await service.createProblem('demo-alex', problemInput);
  const before = await store.read();
  assert.ok(before.problems.some((x) => x.id === p.id));
  assert.ok((await new LocalStore(file).read()).problems.some((x) => x.id === p.id));
  const evil = await app.request('http://localhost/api/v1/problems', {
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(evil.status, 403);
  const large = await app.request('http://localhost/api/v1/problems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo:demo-alex' },
    body: JSON.stringify({ ...problemInput, description: 'x'.repeat(70000) }),
  });
  assert.equal(large.status, 413);
  const staleConfig = await app.request('http://localhost/api/v1/config', {
    headers: { Authorization: 'Bearer stale' },
  });
  assert.equal(staleConfig.status, 200);
  const schema = await app.request('http://localhost/api/v1/openapi.json');
  assert.equal(schema.status, 200);
  assert.equal(((await schema.json()) as any).openapi, '3.1.0');
});
test('one editable test per revision and not applicable excluded from percentage', async (t) => {
  const { service } = await fixture(t);
  const p = await service.createProblem('demo-alex', problemInput);
  const sol = await service.addSolution('demo-sam', p.id, solutionInput);
  await service.test('demo-alex', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Did not work',
    setup: problemInput.setup,
  });
  const updated = await service.test('demo-alex', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Worked',
    setup: problemInput.setup,
  });
  assert.equal(updated.currentRevision.tests.length, 1);
  assert.equal(updated.currentRevision.tests[0]!.outcome, 'Worked');
  const all = await service.test('demo-morgan', sol.id, {
    revisionId: sol.currentRevision.id,
    outcome: 'Not applicable',
    setup: 'Different operating system',
  });
  assert.equal(testStats(all.currentRevision.tests).successRate, 100);
  assert.equal(testStats(all.currentRevision.tests).applicable, 1);
});
test('failed remote image deletion preserves metadata and a retry completes safely', async (t) => {
  const { store } = await fixture(t);
  let failDelete = true;
  let deletes = 0;
  const files = new Map<string, Uint8Array>();
  const remote: Store = {
    demo: false,
    read: () => store.read(),
    transaction: (fn) => store.transaction(fn),
    putImage: async (path, bytes) => {
      files.set(path, bytes);
    },
    getImage: async (path) => files.get(path)!,
    removeImage: async (path) => {
      deletes++;
      if (failDelete) throw new ApiFailure(503, 'storage_unavailable', 'Retry deletion.');
      files.delete(path);
    },
  };
  const service = new TrackerService(remote, 'https://api.example.test');
  const p = await service.createProblem('demo-alex', problemInput);
  const a = await service.upload(
    'demo-alex',
    'problem',
    p.id,
    new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'test.png', {
      type: 'image/png',
    }),
  );
  await assert.rejects(() => service.deleteImage('demo-sam', a.id), { code: 'forbidden' });
  assert.equal(deletes, 0);
  await assert.rejects(() => service.deleteImage('demo-alex', a.id), {
    code: 'storage_unavailable',
  });
  assert.ok((await store.read()).attachments.some((x) => x.id === a.id));
  assert.equal(files.size, 1);
  failDelete = false;
  assert.equal((await service.deleteImage('demo-alex', a.id)).ok, true);
  assert.equal(files.size, 0);
  assert.ok(!(await store.read()).attachments.some((x) => x.id === a.id));
});
