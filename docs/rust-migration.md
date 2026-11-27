# Rust migration validation

Starting commit: `1f98abff040f74e6eeeebf06e338b1dfdb00282e`. The migration uses an independent worktree. The original checkout was on `fix/backend-technician-workflow` with uncommitted changes.

## Original workflows

The Vite website uses the versioned REST API for discovery, accounts, reporting, participation, revisions, tests, uploads, notifications and moderation. The Worker authenticates through Supabase, reads private Storage objects and uses PostgreSQL RPCs for snapshots, feed search and optimistic commits. The loopback demo uses the same service against a persisted JSON snapshot. Owner commands export PostgreSQL and media, verify v1 manifests and restore private images. SQL, CSS, OpenAPI, Wrangler and Pages are part of the deployment contract.

## Baseline on Windows x64

Node 24.22.3, pnpm 11.25.0. `pnpm check` passed type checks, 14 API tests (including nested cases), 6 backup tests, 5 database tests and both production builds. `pnpm test:e2e` passed all 8 Edge journeys including axe. `pnpm format:check` flagged 60 files in the CRLF checkout.

Both harnesses discard one warm-up and report 11 samples. The CLI harness times a fresh process per invocation against identical generated version-1 manifests and deterministic bytes. The Worker harness invokes the Wrangler dry-run package 100 times per sample in a single Node process with a fixed local Supabase RPC response. This isolates application processing and excludes cloud/network latency.

| Command                                                        | Workload            | Original median |
| -------------------------------------------------------------- | ------------------- | --------------: |
| `node scripts/bench-backup.mjs node scripts/verify-backup.mjs` | 1 × 256 B           |        71.78 ms |
| same                                                           | 128 × 32 KiB        |       196.37 ms |
| same                                                           | 2 × 16 MiB          |       137.16 ms |
| `node scripts/bench-worker.mjs` after `pnpm build`             | 100 problem details |       118.37 ms |

## Implementation

The tracker crate handles route selection, attachment signatures, reporting, participation,
revisions, verification, notifications, moderation, and duplicate merging. Rust prepares the
PostgREST optimistic commit and retries only a confirmed version mismatch. The contract crate
implements request validation, test statistics, and browser application rules. Native Rust owns the
backup, verification and restore commands. The existing command paths launch the native executable.

Cloudflare and Node use WebAssembly with HTTP, authentication, database, Storage and file-system
adapters. The browser keeps React for DOM rendering, event lifecycles and accessibility, with
platform hooks for OAuth, browser storage and canvas. PostgreSQL still executes the transactional
RPCs and indexed production search. The JSON demo snapshot and backup manifest version remain
compatible.

## Bug fixes

- Simultaneous first use of the local demo shares one seed initialization. Writes sync a temporary
  file before publication. The loader preserves malformed snapshots and can retry after repair.
- Production row comparisons ignore JSON object key ordering, preventing spurious upserts.
  Transport errors and indeterminate commit results leave the request failed for review.
- Verification rejects duplicate destinations in a media manifest before restore can write.
- Browser drafts stay with the problem they belong to. Malformed draft fields use defaults and
  denied browser storage leaves in-memory edits usable.
- Unknown feed filters recover to supported values, and the page offset stays within the API limit.
  Clearing a report title clears the outstanding duplicate search and its loading state.

The [benchmark report](rust-benchmarks.md) records matched release timings, fixture inputs,
compatibility comparisons and profiling.

## Operating limits

Run one Node demo server per demo file. Production concurrency is handled by the database
transaction version. Storage objects and database metadata have separate provider calls. The
Storage retry tests use a local provider fixture. Live OAuth, hosted restore and production Worker
quota and latency measurements require an owner's configured projects.
