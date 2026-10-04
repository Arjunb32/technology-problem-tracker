import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  cli,
  newBackupDir,
  parseArgs,
  postgresEnv,
  runPostgres,
  sha256File,
  writeManifest,
} from './lib/backup.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), ['out', 'help']);
  if (args.help) {
    console.log(
      'Usage: node scripts/backup-db.mjs [--out INDEPENDENT_STORAGE_FOLDER]\nRequires DATABASE_URL and a matching pg_dump client. Optional PG_DUMP_BIN specifies its executable.',
    );
    return;
  }
  const env = postgresEnv();
  const directory = await newBackupDir(args.out, 'database');
  const binary = process.env.PG_DUMP_BIN || 'pg_dump';
  const common = ['--format=custom', '--no-owner', '--lock-wait-timeout=30s'];
  await runPostgres(
    binary,
    [
      ...common,
      '--schema=public',
      '--schema-only',
      `--file=${path.join(directory, 'schema.dump')}`,
    ],
    env,
  );
  // Auth identities and app records share one data snapshot. Managed auth definitions are excluded.
  await runPostgres(
    binary,
    [
      ...common,
      '--no-acl',
      '--schema=public',
      '--schema=auth',
      '--data-only',
      `--file=${path.join(directory, 'data.dump')}`,
    ],
    env,
  );
  const files = [];
  for (const file of ['schema.dump', 'data.dump']) {
    const full = path.join(directory, file);
    files.push({ file, bytes: (await stat(full)).size, sha256: await sha256File(full) });
  }
  await writeManifest(directory, {
    version: 1,
    kind: 'database',
    complete: true,
    createdAt: new Date().toISOString(),
    schemas: ['public', 'auth data'],
    files,
  });
  console.log(
    `Database export complete: ${directory}\nNext: verify-backup, copy to independent protected storage, and perform a disposable-project restore drill.`,
  );
});
