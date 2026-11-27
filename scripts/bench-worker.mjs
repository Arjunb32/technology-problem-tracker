// Exercise the packaged Worker against a deterministic Supabase fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadWorker } from './lib/worker-package.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('../apps/api/src/demo-state.json', import.meta.url), 'utf8'),
);
const snapshot = JSON.stringify(fixture);
const report = {
  title: 'Router loses its local configuration',
  description: 'After reboot the router forgets its network configuration.',
  category: 'Networking',
  product: 'Router',
  classification: 'Software',
  setup: 'Test router',
};
const env = {
  APP_ENV: 'production',
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture',
  ALLOWED_ORIGINS: 'https://site.example',
  API_PUBLIC_URL: 'https://api.example',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function supabaseFixture(state = fixture, recordRequests = true) {
  const stateJson = JSON.stringify(state);
  const requests = [];
  const updatedJson = JSON.stringify({ ...state, version: state.version + 1 });
  let nextCommit = null;
  let stale = false;

  return {
    requests,
    retryCommitOnce() {
      nextCommit = false;
    },
    async fetch(url, init) {
      const request = new Request(url, init);
      const { pathname, origin } = new URL(request.url);
      assert.equal(origin, env.SUPABASE_URL);
      let body;
      if (request.method === 'POST') body = await request.json();
      if (recordRequests) requests.push([request.method, pathname, body]);
      switch (pathname) {
        case '/auth/v1/user': {
          const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
          const profile = state.profiles.find((p) => p.id === token);
          return profile
            ? json({ id: profile.id, user_metadata: { full_name: profile.displayName } })
            : json({ message: 'Invalid session', code: 'bad_jwt' }, 401);
        }
        case '/rest/v1/profiles': {
          const id = new URL(request.url).searchParams.get('id')?.replace(/^eq\./, '');
          const profile = state.profiles.find((p) => p.id === id);
          return json(profile ? [{ payload: profile }] : []);
        }
        case '/rest/v1/rpc/tracker_health':
          return json(true);
        case '/rest/v1/rpc/tracker_snapshot':
          return new Response(stale ? updatedJson : stateJson, {
            headers: { 'Content-Type': 'application/json' },
          });
        case '/rest/v1/rpc/tracker_feed':
          return json({ total: 0, items: [] });
        case '/rest/v1/rpc/tracker_commit': {
          const response = nextCommit ?? true;
          nextCommit = null;
          if (!response) stale = true;
          return json(response);
        }
        default:
          assert.fail('Unexpected fixture request: ' + pathname);
      }
    },
  };
}

function request(path, { method = 'GET', actor, data, origin = env.ALLOWED_ORIGINS } = {}) {
  return new Request(env.API_PUBLIC_URL + path, {
    method,
    headers: {
      Origin: origin,
      ...(actor ? { Authorization: 'Bearer ' + actor } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: typeof data === 'string' ? data : JSON.stringify(data),
  });
}

async function call(worker, path, options) {
  const res = await worker.fetch(request(path, options), env);
  const value = await res.json();
  assert.ok(res.headers.get('x-request-id'));
  if (Object.hasOwn(value, 'requestId')) {
    assert.equal(value.requestId, res.headers.get('x-request-id'));
    delete value.requestId;
  }
  return { status: res.status, value };
}

async function compare(leftPath, rightPath) {
  const cases = [
    ['/health', undefined, 200],
    ['/api/v1/config', undefined, 200],
    ['/api/v1/openapi.json', undefined, 200],
    ['/api/v1/problems/demo-wifi', undefined, 200],
    ['/api/v1/problems/missing', undefined, 404],
    ['/api/v1/problems/%64emo-wifi', undefined, 200],
    ['/api/v1/problems/%', undefined, 404],
    ['/api/v1/problems/demo-wifi/', undefined, 404],
    ['/api/v1/solutions/demo-solution-0', undefined, 200],
    ['/api/v1/problems?sort=solved&category=Computers&q=wi%20fi&offset=0', undefined, 200],
    ['/api/v1/problems?sort=garbage', undefined, 422],
    ['/api/v1/problems', { origin: 'https://untrusted.example' }, 403],
    ['/api/v1/me', { actor: 'demo-alex' }, 200],
    ['/api/v1/me', { actor: 'invalid-fixture-token' }, 401],
    ['/api/v1/me/notifications', { actor: 'demo-alex' }, 200],
    ['/api/v1/me/following', { actor: 'demo-alex' }, 200],
    ['/api/v1/profiles/demo-alex', undefined, 200],
    ['/api/v1/moderation', { actor: 'demo-morgan' }, 200],
    ['/api/v1/moderation', { actor: 'demo-alex' }, 403],
    ['/api/v1/problems', { method: 'POST', actor: 'demo-alex', data: '{invalid' }, 400],
    ['/api/v1/problems', { method: 'POST', actor: 'demo-alex', data: {} }, 422],
    ['/api/v1/problems', { method: 'POST', data: report }, 401],
  ];
  const results = [];
  for (const filename of [leftPath, rightPath]) {
    const stub = supabaseFixture();
    globalThis.fetch = stub.fetch;
    const worker = await loadWorker(filename);
    const transcript = [];
    for (const [path, options, status] of cases) {
      const response = await call(worker, path, options);
      assert.equal(response.status, status, filename + ': ' + path);
      transcript.push(response);
    }
    stub.requests.length = 0;
    stub.retryCommitOnce();
    const created = await call(worker, '/api/v1/problems', {
      method: 'POST',
      actor: 'demo-alex',
      data: report,
    });
    assert.equal(created.status, 201, filename + ': create with retry');
    assert.equal(created.value.affectedCount, 1);
    assert.equal(created.value.followerCount, 1);
    assert.ok(created.value.viewer.affected);
    assert.ok(created.value.viewer.following);
    const attempts = stub.requests.filter(([, path]) => path.endsWith('/tracker_commit'));
    assert.equal(attempts.length, 2);

    // Generated IDs and times vary. Check relationships before normalizing them for comparison.
    for (const [index, [, , body]] of attempts.entries()) {
      assert.equal(body.p_expected, fixture.version + index);
      const changes = body.p_changes;
      const [saved] = changes.problems.upsert;
      assert.equal(saved.title, report.title);
      assert.equal(changes.participation.upsert.length, 2);
      for (const row of changes.participation.upsert) assert.equal(row.problemId, saved.id);
      assert.equal(changes.timeline.upsert[0].problemId, saved.id);
    }
    assert.equal(created.value.id, attempts.at(-1)[2].p_changes.problems.upsert[0].id);
    const normalize = (k, v) => {
      if (['createdAt', 'updatedAt'].includes(k)) return '<time>';
      if (k === 'window' && typeof v === 'number') return '<window>';
      if (
        ['id', 'problemId'].includes(k) &&
        typeof v === 'string' &&
        (/^[0-9a-f-]{36}$/i.test(v) || /^demo-alex-\d+$/.test(v))
      )
        return '<generated>';
      return v;
    };
    results.push({
      transcript,
      created: JSON.parse(JSON.stringify(created, normalize)),
      attempts: JSON.parse(JSON.stringify(attempts, normalize)),
    });
  }
  for (let i = 0; i < cases.length; i++)
    assert.deepEqual(
      results[1].transcript[i],
      results[0].transcript[i],
      'Response parity: ' + cases[i][0],
    );
  assert.deepEqual(results[1].created, results[0].created);
  assert.deepEqual(results[1].attempts, results[0].attempts);
  console.log(
    'Matched ' + cases.length + ' HTTP responses and report creation with a forced commit retry.',
  );
}

async function bench(filename, write = false) {
  const state = write ? structuredClone(fixture) : fixture;
  if (write) {
    for (let i = 0; i < 200; i++) {
      const [sample] = fixture.profiles;
      state.profiles.push({ ...sample, id: 'fixture-member-' + i, username: 'fixture' + i });
      for (let note = 0; note < 2; note++) {
        state.notifications.push({
          id: 'fixture-member-' + i + '-notice-' + note,
          userId: 'fixture-member-' + i,
          problemId: 'demo-wifi',
          title: 'You follow this problem',
          body: 'New test results are available to review.',
          read: false,
          createdAt: sample.createdAt,
        });
      }
    }
  }
  const stub = supabaseFixture(state, false);
  globalThis.fetch = write
    ? stub.fetch
    : async (url) => {
        assert.equal(
          new URL(url instanceof Request ? url.url : url).pathname,
          '/rest/v1/rpc/tracker_snapshot',
        );
        return new Response(snapshot, { headers: { 'Content-Type': 'application/json' } });
      };
  const worker = await loadWorker(filename);
  const samples = [];
  for (let run = 0; run < 12; run++) {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      if (write) {
        if (i % 10 === 0) stub.retryCommitOnce();
        const res = await worker.fetch(
          request('/api/v1/problems', { method: 'POST', actor: 'demo-alex', data: report }),
          env,
        );
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.equal(body.affectedCount, 1);
        assert.equal(body.followerCount, 1);
      } else {
        const res = await worker.fetch(request('/api/v1/problems/demo-wifi'), env);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.problem.affectedCount, 2);
        assert.equal(body.solutions[0].currentRevision.tests.length, 1);
      }
    }
    if (run) samples.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      workload: write ? 'report creation' : 'problem detail',
      requests: 100,
      unit: 'ms',
      runs: samples.length,
      median: samples.toSorted((a, b) => a - b)[5],
      peakRssKiB: process.resourceUsage().maxRSS,
      samples,
    }),
  );
}

const [arg, left, right] = process.argv.slice(2);
if (arg === '--compare') {
  assert.ok(left && right, 'Supply original and migrated Worker bundle paths.');
  await compare(left, right);
} else if (arg === '--writes') {
  await bench(left || 'apps/api/dist/entry.js', true);
} else {
  await bench(arg || 'apps/api/dist/entry.js');
}
