import { backupMedia, cli, newBackupDir, parseArgs, supabaseConfig } from './lib/backup.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), ['out', 'help']);
  if (args.help) {
    console.log(
      'Usage: node scripts/backup-media.mjs [--out INDEPENDENT_STORAGE_FOLDER]\nRequires owner-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Copies tracker-images including nested folders and all pages.',
    );
    return;
  }
  const config = supabaseConfig();
  const directory = await newBackupDir(args.out, 'media');
  const result = await backupMedia(config, directory);
  console.log(
    `Media backup complete: ${result.files.length} objects in ${directory}\nVerify and copy to independent protected storage. No remote objects were changed.`,
  );
});
