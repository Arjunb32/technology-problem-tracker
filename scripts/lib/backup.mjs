import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function parseArgs(argv, allowed = []) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.includes(key))
      throw new Error('Unknown command option. Use --help.');
    if (['help', 'apply', 'overwrite'].includes(key)) result[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      result[key] = value;
    }
  }
  return result;
}

export function requireEnv(name, env = process.env) {
  if (!env[name]) throw new Error(`Set ${name} in the owner shell environment.`);
  return env[name];
}

export function supabaseConfig(env = process.env) {
  let url;
  try {
    url = new URL(requireEnv('SUPABASE_URL', env));
  } catch {
    throw new Error('SUPABASE_URL must be a hosted HTTPS Supabase project URL.');
  }
  const projectRef = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (
    url.protocol !== 'https:' ||
    !projectRef ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new Error('SUPABASE_URL must be a hosted HTTPS Supabase project URL.');
  }
  return {
    url: url.origin,
    projectRef,
    key: requireEnv('SUPABASE_SERVICE_ROLE_KEY', env),
    bucket: 'tracker-images',
  };
}

export function postgresEnv(env = process.env) {
  let database;
  try {
    database = new URL(requireEnv('DATABASE_URL', env));
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL direct or session-pooler connection URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname ||
    !database.username ||
    !database.password
  ) {
    throw new Error('DATABASE_URL must include a PostgreSQL host, user, and password.');
  }
  if (database.port === '6543')
    throw new Error(
      'Use a direct connection or session pooler on port 5432, not the transaction pooler.',
    );
  const sslMode = database.searchParams.get('sslmode') ?? 'require';
  if (!['require', 'verify-ca', 'verify-full'].includes(sslMode))
    throw new Error('DATABASE_URL must require TLS.');
  return {
    ...env,
    DATABASE_URL: undefined,
    PGHOST: database.hostname,
    PGPORT: database.port || '5432',
    PGDATABASE: decodeURIComponent(database.pathname.slice(1) || 'postgres'),
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGSSLMODE: sslMode,
    PGCONNECT_TIMEOUT: '20',
    PGOPTIONS: '',
  };
}

export function validateObjectPath(objectPath) {
  if (
    typeof objectPath !== 'string' ||
    !objectPath ||
    objectPath.includes('\\') ||
    objectPath.includes('\0')
  )
    throw new Error('Unsafe object path in backup.');
  const parts = objectPath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part)))
    throw new Error('Unsafe object path in backup.');
  return parts.map(encodeURIComponent).join('/');
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function newBackupDir(out, kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.resolve(out ?? 'backups', `${kind}-${stamp}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export async function writeManifest(directory, manifest) {
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

export async function runPostgres(binary, args, env) {
  return new Promise((resolve, reject) => {
    // Never place the connection string or password in process arguments or log database stderr.
    const child = spawn(binary, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    child.stderr.resume();
    child.on('error', () =>
      reject(
        new Error(
          'PostgreSQL utility could not start. Install a matching PostgreSQL client or set PG_DUMP_BIN.',
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              'PostgreSQL export failed. Check connection, permissions, and client/server versions. Partial output is not a valid backup.',
            ),
          ),
    );
  });
}

async function request(config, suffix, init, fetcher) {
  let response;
  try {
    response = await fetcher(`${config.url}/storage/v1/${suffix}`, {
      ...init,
      headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, ...init?.headers },
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
  } catch {
    throw new Error('Storage request failed or timed out. Partial output is not a valid backup.');
  }
  if (!response.ok)
    throw new Error(
      `Storage request failed (HTTP ${response.status}). Check access and project availability.`,
    );
  return response;
}

export async function listObjects(config, fetcher = fetch, pageSize = 100) {
  const files = [];
  const seen = new Set();
  async function walk(prefix) {
    for (let offset = 0; ; offset += pageSize) {
      const response = await request(
        config,
        `object/list/${encodeURIComponent(config.bucket)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prefix,
            limit: pageSize,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          }),
        },
        fetcher,
      );
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Storage returned an invalid list.');
      for (const item of items) {
        if (typeof item.name !== 'string' || item.name.includes('/'))
          throw new Error('Storage returned an unsafe name.');
        const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
        validateObjectPath(objectPath);
        if (seen.has(objectPath))
          throw new Error(
            'Storage listing changed during backup. Run again during a quiet period.',
          );
        seen.add(objectPath);
        if (item.id === null) await walk(objectPath);
        else {
          if (typeof item.id !== 'string')
            throw new Error('Storage returned invalid object metadata.');
          files.push({
            objectPath,
            metadata: item.metadata ?? {},
            updatedAt: item.updated_at ?? null,
          });
        }
      }
      if (items.length < pageSize) break;
    }
  }
  await walk('');
  return files;
}

export async function backupMedia(config, directory, fetcher = fetch) {
  const objects = await listObjects(config, fetcher);
  await mkdir(path.join(directory, 'files'), { mode: 0o700 });
  const files = [];
  for (const [index, item] of objects.entries()) {
    const response = await request(
      config,
      `object/${encodeURIComponent(config.bucket)}/${validateObjectPath(item.objectPath)}`,
      { method: 'GET' },
      fetcher,
    );
    const data = Buffer.from(await response.arrayBuffer());
    if (Number.isFinite(item.metadata.size) && item.metadata.size !== data.length)
      throw new Error('Storage object changed during backup. Run again during a quiet period.');
    const file = `files/${index.toString().padStart(6, '0')}.bin`;
    await writeFile(path.join(directory, file), data, { flag: 'wx', mode: 0o600 });
    files.push({
      file,
      objectPath: item.objectPath,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      contentType:
        response.headers.get('content-type') ??
        item.metadata.mimetype ??
        'application/octet-stream',
      updatedAt: item.updatedAt,
    });
  }
  const manifest = {
    version: 1,
    kind: 'media',
    complete: true,
    createdAt: new Date().toISOString(),
    projectRef: config.projectRef,
    bucket: config.bucket,
    files,
  };
  await writeManifest(directory, manifest);
  return manifest;
}

export async function safeLocalFile(directory, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Unsafe local file in manifest.');
  const root = await realpath(directory);
  const resolved = await realpath(path.resolve(root, relative));
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error('Backup file resolves outside its directory.');
  return resolved;
}

export async function verifyBackup(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== 1 ||
    manifest.complete !== true ||
    !['database', 'media'].includes(manifest.kind) ||
    !Array.isArray(manifest.files)
  )
    throw new Error('Manifest is invalid or backup is incomplete.');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (
      !entry ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error('Manifest file metadata is invalid.');
    if (seen.has(entry.file)) throw new Error('Manifest contains a repeated local file.');
    seen.add(entry.file);
    if (manifest.kind === 'media') validateObjectPath(entry.objectPath);
    const file = await safeLocalFile(directory, entry.file);
    const details = await stat(file);
    if (
      !details.isFile() ||
      details.size !== entry.bytes ||
      (await sha256File(file)) !== entry.sha256
    )
      throw new Error('Backup integrity check failed: a file is missing, damaged, or changed.');
  }
  if (
    manifest.kind === 'database' &&
    (manifest.files.length !== 2 || !seen.has('schema.dump') || !seen.has('data.dump'))
  )
    throw new Error('Database backup is missing required dumps.');
  return manifest;
}

export async function restoreMedia(
  config,
  directory,
  { apply = false, confirmRef, overwrite = false } = {},
  fetcher = fetch,
) {
  const manifest = await verifyBackup(directory);
  if (manifest.kind !== 'media' || manifest.bucket !== config.bucket)
    throw new Error('This is not a tracker-images media backup.');
  if (!apply)
    return { applied: false, count: manifest.files.length, target: config.projectRef, overwrite };
  if (confirmRef !== config.projectRef)
    throw new Error(
      'Restore requires --confirm-ref equal to the target SUPABASE_URL project reference.',
    );
  for (const entry of manifest.files) {
    const data = await readFile(await safeLocalFile(directory, entry.file));
    // Verify again immediately before the write to detect an altered local file after preflight.
    if (
      data.length !== entry.bytes ||
      createHash('sha256').update(data).digest('hex') !== entry.sha256
    )
      throw new Error('Backup changed during restore.');
    await request(
      config,
      `object/${encodeURIComponent(config.bucket)}/${validateObjectPath(entry.objectPath)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': entry.contentType || 'application/octet-stream',
          'x-upsert': overwrite ? 'true' : 'false',
        },
        body: data,
      },
      fetcher,
    );
  }
  return { applied: true, count: manifest.files.length, target: config.projectRef, overwrite };
}

export async function cli(main) {
  try {
    await main();
  } catch (error) {
    // Only our curated errors are emitted by CLI entry points; provider bodies/secrets are never printed.
    const safe =
      error instanceof SyntaxError
        ? 'Invalid backup manifest JSON.'
        : (error?.message ?? 'Operation failed.');
    console.error(safe);
    process.exitCode = 1;
  }
}
