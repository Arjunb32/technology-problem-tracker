import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const commands = [[]];
for (const arg of process.argv.slice(2)) {
  if (arg === '--against') commands.push([]);
  else commands.at(-1).push(arg);
}
assert.ok(
  commands.every((command) => command.length),
  'Supply a verifier command and its fixed arguments.',
);

const directory = mkdtempSync(join(tmpdir(), 'tracker-benchmark-'));
try {
  for (const [count, bytes] of [
    [1, 256],
    [128, 32768],
    [2, 16 * 1024 * 1024],
  ]) {
    const folder = join(directory, String(count));
    mkdirSync(folder);
    const data = Buffer.alloc(bytes, 0x5a);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const files = Array.from({ length: count }, (_, i) => {
      const file = i + '.bin';
      writeFileSync(join(folder, file), data);
      return { file, objectPath: 'owner/' + file, bytes, sha256 };
    });
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify({
        version: 1,
        complete: true,
        kind: 'media',
        bucket: 'tracker-images',
        files,
      }),
    );
    const samples = commands.map(() => []);
    for (let run = 0; run < 12; run++) {
      // Rotate the starting command so disk and process caches affect every variant.
      for (let j = 0; j < commands.length; j++) {
        const index = (j + run) % commands.length;
        const [binary, ...args] = commands[index];
        const start = performance.now();
        const result = spawnSync(binary, [...args, '--dir', folder], { encoding: 'utf8' });
        const elapsed = performance.now() - start;
        assert.equal(result.status, 0, result.stderr || String(result.error));
        assert.match(result.stdout, new RegExp('Verified media backup: ' + count + ' files'));
        if (run) samples[index].push(elapsed);
      }
    }
    for (let variant = 0; variant < commands.length; variant++) {
      const runs = samples[variant];
      console.log(
        JSON.stringify({
          ...(commands.length > 1 ? { variant, command: commands[variant] } : {}),
          count,
          bytes,
          unit: 'ms',
          runs: runs.length,
          median: runs.toSorted((a, b) => a - b)[5],
          samples: runs,
        }),
      );
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
