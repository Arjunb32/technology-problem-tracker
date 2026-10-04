import path from 'node:path';
import { cli, parseArgs, verifyBackup } from './lib/backup.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), ['dir', 'help']);
  if (args.help) {
    console.log('Usage: node scripts/verify-backup.mjs --dir BACKUP_DIRECTORY');
    return;
  }
  if (!args.dir) throw new Error('Supply --dir BACKUP_DIRECTORY.');
  const result = await verifyBackup(path.resolve(args.dir));
  console.log(
    `Verified ${result.kind} backup: ${result.files.length} files match their sizes and SHA-256 checksums. This does not replace a restore drill.`,
  );
});
