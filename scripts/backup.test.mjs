import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  backupMedia,
  listObjects,
  postgresEnv,
  restoreMedia,
  supabaseConfig,
  validateObjectPath,
  verifyBackup,
  writeManifest,
} from './lib/backup.mjs';

const config = {
  url: 'https://sourceproject.supabase.co',
  projectRef: 'sourceproject',
  key: 'private-fixture-key',
  bucket: 'tracker-images',
};
const image = Buffer.from('fixture-image-bytes');
const object = (name) => ({
  id: name,
  name,
  metadata: { size: image.length, mimetype: 'image/png' },
  updated_at: '2026-10-04T00:00:00Z',
});

async function temporary(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-backup-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('storage listing visits nested directories and follows offsets without dropping a page', async () => {
  const pages = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    pages.push([body.prefix, body.offset]);
    if (body.prefix === '' && body.offset === 0)
      return Response.json([{ id: null, name: 'owner', metadata: null }, object('root.png')]);
    if (body.prefix === '' && body.offset === 2) return Response.json([object('last.png')]);
    if (body.prefix === 'owner' && body.offset === 0)
      return Response.json([object('one.png'), object('two.png')]);
    return Response.json([]);
  };
  const files = await listObjects(config, fetcher, 2);
  assert.deepEqual(
    files.map((file) => file.objectPath),
    ['owner/one.png', 'owner/two.png', 'root.png', 'last.png'],
  );
  assert.ok(pages.some(([prefix, offset]) => prefix === 'owner' && offset === 2));
  assert.ok(pages.some(([prefix, offset]) => prefix === '' && offset === 2));
});

test('media backup is locally verifiable and never writes the service key into a manifest', async () =>
  temporary(async (directory) => {
    const fetcher = async (url, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${config.key}`);
      if (url.includes('/object/list/')) return Response.json([object('one.png')]);
      return new Response(image, { headers: { 'Content-Type': 'image/png' } });
    };
    const manifest = await backupMedia(config, directory, fetcher);
    assert.equal(manifest.files.length, 1);
    assert.equal((await verifyBackup(directory)).kind, 'media');
    assert.equal(
      (await readFile(path.join(directory, 'manifest.json'), 'utf8')).includes(config.key),
      false,
    );
    await writeFile(path.join(directory, manifest.files[0].file), 'damaged');
    await assert.rejects(verifyBackup(directory), /integrity check failed/);
  }));

test('a failed download leaves no complete manifest', async () =>
  temporary(async (directory) => {
    const fetcher = async (url) =>
      url.includes('/object/list/')
        ? Response.json([object('one.png')])
        : new Response('access denied', { status: 403 });
    await assert.rejects(backupMedia(config, directory, fetcher), /HTTP 403/);
    await assert.rejects(readFile(path.join(directory, 'manifest.json')), { code: 'ENOENT' });
  }));

test('restore preflight is read-only, and apply requires the exact target reference', async () =>
  temporary(async (directory) => {
    await writeFile(path.join(directory, 'one.bin'), image);
    await writeManifest(directory, {
      version: 1,
      kind: 'media',
      complete: true,
      bucket: 'tracker-images',
      files: [
        {
          file: 'one.bin',
          objectPath: 'owner/image.png',
          bytes: image.length,
          sha256: createHash('sha256').update(image).digest('hex'),
          contentType: 'image/png',
        },
      ],
    });
    let calls = 0;
    const fetcher = async (_url, init) => {
      calls++;
      assert.equal(init.headers['x-upsert'], 'false');
      return new Response('{}');
    };
    assert.equal((await restoreMedia(config, directory, {}, fetcher)).applied, false);
    assert.equal(calls, 0);
    await assert.rejects(
      restoreMedia(config, directory, { apply: true, confirmRef: 'otherproject' }, fetcher),
      /target SUPABASE_URL/,
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await restoreMedia(
          config,
          directory,
          { apply: true, confirmRef: config.projectRef },
          fetcher,
        )
      ).applied,
      true,
    );
    assert.equal(calls, 1);
  }));

test('manifest paths cannot escape their backup directory', async () =>
  temporary(async (directory) => {
    await writeManifest(directory, {
      version: 1,
      kind: 'media',
      complete: true,
      files: [
        { file: '../outside.bin', objectPath: 'owner/image.png', bytes: 1, sha256: 'a'.repeat(64) },
      ],
    });
    await assert.rejects(verifyBackup(directory), /Unsafe local file/);
    for (const objectPath of [
      '../secret',
      'owner/../secret',
      '/root.png',
      'owner\\secret',
      'owner//image',
    ])
      assert.throws(() => validateObjectPath(objectPath), /Unsafe object path/);
  }));

test('PostgreSQL connection is passed by environment and rejects plaintext or transaction poolers', () => {
  const connection =
    'postgresql://postgres.projectref:s%40fe%3Asecret@aws-0-region.pooler.supabase.com:5432/postgres';
  const env = postgresEnv({ DATABASE_URL: connection });
  assert.equal(env.PGPASSWORD, 's@fe:secret');
  assert.equal(env.PGUSER, 'postgres.projectref');
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PGSSLMODE, 'require');
  assert.throws(
    () => postgresEnv({ DATABASE_URL: `${connection}?sslmode=disable` }),
    /require TLS/,
  );
  assert.throws(
    () => postgresEnv({ DATABASE_URL: connection.replace(':5432/', ':6543/') }),
    /transaction pooler/,
  );
  assert.throws(
    () =>
      supabaseConfig({
        SUPABASE_URL: 'https://example.com',
        SUPABASE_SERVICE_ROLE_KEY: config.key,
      }),
    /hosted HTTPS/,
  );
});
