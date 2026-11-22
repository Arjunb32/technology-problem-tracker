# Rust migration validation

Starting commit: `1f98abff040f74e6eeeebf06e338b1dfdb00282e`. The migration uses an independent worktree. The original checkout was on `fix/backend-technician-workflow` with uncommitted changes.

## Original workflows

The Vite website uses the versioned REST API for discovery, accounts, reporting, participation, revisions, tests, uploads, notifications and moderation. The Worker authenticates through Supabase, reads private Storage objects and uses PostgreSQL RPCs for snapshots, feed search and optimistic commits. The loopback demo uses the same service against a persisted JSON snapshot. Owner commands export PostgreSQL and media, verify v1 manifests and restore private images. SQL, CSS, OpenAPI, Wrangler and Pages are part of the deployment contract.

## Baseline on Windows x64

Node 24.22.3, pnpm 11.25.0. `pnpm check` passed type checks, 14 API tests (including nested cases), 6 backup tests, 5 database tests and both production builds. `pnpm test:e2e` passed all 8 Edge journeys including axe. `pnpm format:check` flagged 60 files in the CRLF checkout.

Both harnesses discard one warm-up and report 11 samples. The CLI harness times a fresh process per invocation against identical generated version-1 manifests and deterministic bytes. The Worker harness invokes the Wrangler dry-run package 100 times per sample in a single Node process with a fixed local Supabase RPC response. This isolates application processing and excludes cloud/network latency.

| Command | Workload | Original median |
| --- | --- | ---: |
| `node scripts/bench-backup.mjs node scripts/verify-backup.mjs` | 1 × 256 B | 71.78 ms |
| same | 128 × 32 KiB | 196.37 ms |
| same | 2 × 16 MiB | 137.16 ms |
| `node scripts/bench-worker.mjs` after `pnpm build` | 100 problem details | 118.37 ms |

