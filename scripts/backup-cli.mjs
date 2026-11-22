import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function run(command, args) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const binary = join(
    resolve(root, process.env.CARGO_TARGET_DIR || 'target'),
    'release',
    process.platform === 'win32' ? 'tracker-backup.exe' : 'tracker-backup',
  );
  if (!existsSync(binary)) {
    const build = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'tracker-backup'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (build.status !== 0) {
      if (build.error) console.error(build.error.message);
      process.exit(build.status ?? 1);
    }
  }
  const result = spawnSync(binary, [command, ...args], { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
