# Rust benchmark and compatibility checks

The baseline is the production Worker bundle and backup verifier from commit
`1f98abff040f74e6eeeebf06e338b1dfdb00282e`. Both versions were measured on the same Windows 11 x64
machine with an Intel Core i5-12450H, 16 GiB RAM and Node 24.22.3. The Rust executable and
WebAssembly use locked release builds. Measurements exclude packaging and dependency installation.

## Method

- Worker reads run 100 sequential problem-detail requests per sample against the committed demo
  snapshot. The fixture returns the same pre-serialized JSON to both production bundles. Each
  request verifies the affected count and attached revision test.
- Worker report creation runs 100 writes per sample against a snapshot that adds 200 profiles and 400
  notifications to the demo fixture. The mock accepts the commits without persisting them and forces
  one optimistic retry every tenth request. Every response must return a report with its initial
  affected confirmation and follow. The fixture includes local authentication and JSON handling.
- Backup verification launches a fresh process per sample against generated version-1 manifests
  and deterministic file contents. The harness rotates the order of variants and reuses the same
  files for every variant. The compatibility entry point launches Node and the prebuilt Rust binary.
- Each workload reports the median of 11 measured runs after one warm-up. Worker peak RSS is the
  maximum resident memory of the isolated Node process across all runs. These measurements cover
  application work with local fixtures and exclude Cloudflare runtime and Supabase network latency.

## Reproduce

Use a detached worktree for the original SHA so the two builds have independent output directories.

```sh
git worktree add --detach ../tracker-baseline 1f98abff040f74e6eeeebf06e338b1dfdb00282e
pnpm --dir ../tracker-baseline install --frozen-lockfile
pnpm --dir ../tracker-baseline build
pnpm install --frozen-lockfile
pnpm build

node scripts/bench-worker.mjs --compare ../tracker-baseline/apps/api/dist/worker.js apps/api/dist/entry.js
node scripts/bench-worker.mjs ../tracker-baseline/apps/api/dist/worker.js
node scripts/bench-worker.mjs apps/api/dist/entry.js
node scripts/bench-worker.mjs --writes ../tracker-baseline/apps/api/dist/worker.js
node scripts/bench-worker.mjs --writes apps/api/dist/entry.js
node scripts/bench-backup.mjs node ../tracker-baseline/scripts/verify-backup.mjs --against target/release/tracker-backup verify-backup --against node scripts/verify-backup.mjs
node --cpu-prof scripts/bench-worker.mjs apps/api/dist/entry.js
```

On Windows, use `target/release/tracker-backup.exe` in the backup command. When using a custom
`CARGO_TARGET_DIR`, point the native benchmark at that release directory. Profile separately from
timed runs because sampling adds overhead.

The differential harness compares status codes and bodies for successful reads, routing and
validation errors, access controls, and a write retried after a version conflict. It verifies that
the committed report, participation and timeline IDs agree before normalizing generated IDs and
timestamps. Hosted OAuth, actual Storage and PostgREST latency, and the loopback feed optimization
are outside these benchmarks.

## Profiling and optimization

The first Rust Worker package was profiled with Node’s CPU sampler. Of its 642 samples, 41 had the service adapter’s invoke function as their leaf frame, 49 were in UTF-8 encode or encodeInto, 21 were in response JSON parsing, and 29 were in the WebAssembly allocator’s malloc or free. Serde’s deserializer and value visitor accounted for another 22 leaf samples. The profile prompted a direct JSON response from the Rust domain, reuse of the production router within a Worker isolate, and forwarding PostgREST snapshot JSON to Rust without an intermediate JavaScript object. Optimistic writes also produce the row delta in Rust so the Worker can send only the version and changed rows to the database.

The native verifier hashes the files in buffered reads. The compatibility script preserves the previous command path and exit status, with Node startup and a second process included in its timings.

## Results

Lower is faster. Worker rows report milliseconds per 100 requests. Backup rows report milliseconds
per command invocation. All cells contain medians from 11 runs.

| Workload                                | Original (ms) | Rust release (ms) | Rust through the legacy CLI path (ms) |
| --------------------------------------- | ------------: | ----------------: | ------------------------------------: |
| Problem detail                          |        175.90 |             84.34 |                                       |
| Report creation with optimistic retries |        748.96 |            662.30 |                                       |
| Verify 1 × 256 B                        |         86.96 |             12.55 |                                 87.25 |
| Verify 128 × 32 KiB                     |        201.84 |             37.39 |                                109.17 |
| Verify 2 × 16 MiB                       |        124.99 |             40.74 |                                105.16 |

Peak Worker process RSS was 260 MiB before and 90 MiB after on problem details, and 330 MiB before
and 131 MiB after on report creation. The small-file compatibility command was effectively even.
Its 0.29 ms difference was smaller than run-to-run variation. The write timings also varied
substantially across runs, so the 12% lower median here is specific to this measurement.

The final CPU profile still shows serialization and allocation work. The benchmark consumes each
response, so it also samples JSON parsing in the test client. The final Worker dry run reported
1,815.99 KiB uploaded and 448.83 KiB gzip, up from 1,655.69 KiB and 297.62 KiB on the original.
The upload size is separate from the warm request measurements.

All 22 paired HTTP cases and the report creation retry matched. The retry sent expected versions 0
and 1 after the first commit was rejected. The mock deliberately leaves the original report
snapshot in place so repetitions do not introduce new rows or hit rate limits.
