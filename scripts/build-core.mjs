import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
const cwd = fileURLToPath(new URL('..', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
}
const crates = process.argv.includes('--contracts')
  ? [['tracker-contracts', 'packages/contracts/generated']]
  : [
      ['tracker-contracts', 'packages/contracts/generated'],
      ['tracker-core', 'apps/api/generated'],
    ];
run('cargo', [
  'build',
  '--locked',
  '--release',
  '--target',
  'wasm32-unknown-unknown',
  ...crates.flatMap(([name]) => ['-p', name]),
]);
for (const [name, out] of crates) {
  const target = resolve(cwd, process.env.CARGO_TARGET_DIR || 'target');
  const wasm = join(target, 'wasm32-unknown-unknown/release', name.replaceAll('-', '_') + '.wasm');
  const dest = join(cwd, out);
  mkdirSync(dest, { recursive: true });
  const temp = mkdtempSync(join(dest, '.bindings-'));
  try {
    run('wasm-bindgen', [wasm, '--target', 'web', '--out-dir', temp]);
    for (const file of readdirSync(temp)) {
      const src = join(temp, file),
        to = join(dest, file);
      let previous;
      try {
        previous = readFileSync(to);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (!previous?.equals(readFileSync(src))) renameSync(src, to);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
