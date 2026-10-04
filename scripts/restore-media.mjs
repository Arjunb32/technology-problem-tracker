import path from 'node:path';
import { cli, parseArgs, restoreMedia, supabaseConfig } from './lib/backup.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), [
    'dir',
    'apply',
    'confirm-ref',
    'overwrite',
    'help',
  ]);
  if (args.help) {
    console.log(
      'Usage: node scripts/restore-media.mjs --dir BACKUP_DIRECTORY [--apply --confirm-ref TARGET_PROJECT_REF] [--overwrite]\nDry run by default. Target credentials: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Existing objects are preserved unless --overwrite is explicitly supplied.',
    );
    return;
  }
  if (!args.dir) throw new Error('Supply --dir BACKUP_DIRECTORY.');
  const result = await restoreMedia(supabaseConfig(), path.resolve(args.dir), {
    apply: args.apply,
    confirmRef: args['confirm-ref'],
    overwrite: args.overwrite,
  });
  console.log(
    `${result.applied ? 'Restored' : 'Dry run verified'} ${result.count} objects. Target project: ${result.target}. Overwrite: ${result.overwrite ? 'enabled' : 'disabled'}.${result.applied ? '' : '\nNo remote writes occurred. Review the target and use --apply --confirm-ref TARGET_PROJECT_REF only when ready.'}`,
  );
});
