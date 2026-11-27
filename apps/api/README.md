# Backend

The Cloudflare Worker and loopback demo run the same Rust domain engine as WebAssembly. Hono handles the HTTP request interface. The host passes platform inputs such as timestamps, entropy, auth sessions, database snapshots, and Storage data to the engine. After installing the toolchain from the [root README](../../README.md), `pnpm dev` from the repository starts the website and the API together. The API listens at `http://localhost:8787`; its Node server always binds to the loopback interface. Local demo data persists in the repository's `.data/demo.json`. `DEMO_DATA_FILE` overrides that path (relative paths resolve from the repository). Demo identities are Alex, Sam, and moderator Morgan; every demo problem and solution is explicitly marked `demo: true`.

The deployed Cloudflare Worker has no demonstration sign-in endpoint, never seeds example content, and always validates Supabase access tokens with `auth.getUser`. OAuth metadata can supply a display name and image, but never a role. See the repository deployment guide for Google/GitHub/Microsoft configuration and owner bootstrap.

## Contract

`GET /api/v1/openapi.json` is the OpenAPI 3.1 specification, including shared validation schemas. A signed-in request uses `Authorization: Bearer <access_token>`. Public feed and problem pages do not require sign-in. Writes require an unrestricted account. Moderation reads and writes require an unrestricted moderator/admin role stored in the database.

`GET /health` checks database availability in production. Responses include a request id; unexpected failures log only this id and the error class. No tokens, request bodies, OAuth email addresses, or keys are logged. Unknown website origins are denied. JSON requests have a 64 KB limit; multipart requests have a 600 KB limit. Image signature/type/size and content ownership are checked before storing files.

Feed queries accept `sort`, `category`, `q`, and `offset`, with pages of 50. Production search uses indexed PostgreSQL English full-text search and trigram title similarity. Public profile projections include only the profile fields intended for community display. Private moderation reports, restrictions, notifications, and audit data never appear in public responses.

## Persistence and concurrency

Apply `supabase/migrations/001_tracker.sql` to a fresh Supabase project. It creates relational application tables, category/tag relations, foreign keys, unique participation and test constraints, versioned solution evidence, indexes, and a private `tracker-images` bucket. Browser roles have no application table access or privileged RPC execution rights. Every RPC uses an explicit search path and service-only grants.

The backend reads a state version, applies domain changes, and calls `tracker_commit`. The SQL function takes a row lock, compares the version, and commits only changed rows in one transaction. Concurrent conflicts retry up to six times. SQL independently enforces self-verification prohibition, current revisions, independent testing, and solved/confirmed status requirements. Domain logic moves and deduplicates merged participation while retaining solution revisions, tests, comments, attachments, and history. Confirmation falls back to Needs information if an affected user withdraws and fewer than two confirmations remain.

The local adapter serializes writes and atomically replaces its data file. It is for a single local development process. Use PostgreSQL for production or multiple processes.

## Deliberately bounded beta

Production feeds are database-filtered and paginated; problem details load only the requested problem and three related problems. Auth/profile checks read one profile. Mutation and moderator operations still use a complete server-only snapshot to share tested domain behavior between local and production persistence. This is appropriate only for a small pilot and requires a deployed CPU/load check before public launch.

Production writes stop with a clear `beta_capacity` response above 500 reports, 2,500 domain records, or 750,000 serialized characters. Contributions, tests, notifications, and history count toward these limits. Limits protect the pilot; they do not prove Cloudflare's 10 ms free CPU budget. Benchmark deployed writes and snapshots at the intended pilot scale. If that gate fails, move mutation handlers to narrowly scoped SQL RPCs before admitting users; do not silently enable paid services. A full snapshot redesign is also required before increasing the caps. Account write limits are durable (40 committed writes per minute); deployment protection against distributed unauthenticated traffic belongs in the Cloudflare account.

Files live at `tracker-images/<owner-id>/<attachment-id>.<extension>` in a private bucket and are served through the API after checking visibility. Storage and PostgreSQL cannot share one transaction: failed metadata uploads trigger best-effort object cleanup. Deletions check permission, remove the object first, and then remove metadata. A failed storage deletion preserves metadata for retry; interruption between object and metadata deletion can leave a temporary broken reference that an idempotent retry clears. Periodically compare object paths with attachment metadata during the weekly backup and remove confirmed orphaned objects only after review.

## Checks

`pnpm --filter @tracker/api typecheck`, `pnpm --filter @tracker/api test`, and `pnpm --filter @tracker/api build` validate types, core HTTP/domain journeys, and a Cloudflare dry-run bundle. The repository database tests execute the migration, role denials, constraints, and transaction RPCs against PostgreSQL via PGlite. These are local checks; live OAuth, Supabase Storage, Cloudflare CPU/quota behavior, and a full live restore require configured accounts and are release gates.
