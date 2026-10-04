# Operations, backups, and recovery

## Owner routine

During the small public beta, the owner reviews moderation requests, application errors, storage/database usage, and request counts daily. Record each incident, action, and recovery result without copying session tokens or unnecessary personal information into the incident notes.

Use Cloudflare Worker request/CPU/error metrics and Supabase database/storage dashboards. Check `/health` after releases and when a provider outage is suspected. Provider request logs and application logs must never include authorization headers, service keys, OAuth secrets, or full private contribution bodies.

Rechecked on **4 October 2026**: Workers Free documents 100,000 requests/day and 10 ms CPU per HTTP request; network waiting does not count as CPU. Confirm the deployed API stays within that budget for feed reads, authenticated writes, moderator operations, and maximum-size uploads. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/)

Supabase Free documents a 500 MB database, 1 GB file storage, and pausing after inactivity. Free projects need owner-maintained off-site exports; database backups do not include Storage file bytes. Recheck the complete current allowances, including egress, before launch. [Supabase pricing](https://supabase.com/pricing), [backup guidance](https://supabase.com/docs/guides/platform/backups)

At 75% of a finite quota, review growth and stop nonessential operations. At 90%, prepare contribution restrictions or maintenance messaging before exhaustion. Stay on Free plans; do not enable paid features or assume an overage is acceptable. Provider-wide request exhaustion may prevent the API from returning its own message, so keep a static website maintenance notice available for emergencies.

## Back up daily database data and weekly image bytes

The included tools use Node built-ins and do not install software. Database exports require an already installed `pg_dump` compatible with the project's PostgreSQL version. Set `PG_DUMP_BIN` to its executable path when it is not on PATH.

Set `DATABASE_URL` privately in the owner shell using a direct or **session-pooler** PostgreSQL connection with TLS. Use the project Connect panel; do not use the transaction pooler on port 6543. The script passes credentials through PostgreSQL environment values, not process command arguments, and suppresses database stderr to avoid leaking connection information. [Supabase connection guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

```sh
node scripts/backup-db.mjs --out /path/to/independent/protected/storage
node scripts/verify-backup.mjs --dir /path/to/database-backup-directory
```

For Windows, quote full paths, for example `--out "D:\Tracker Backups"`. Use independent protected storage that will survive loss of the hosting project or development computer. The ignored `backups/` default is a temporary convenience, not an off-site backup.

A successful database export contains:

- `schema.dump`: public schema definitions and access grants/revocations; no managed Auth schema definitions.
- `data.dump`: public application data and Auth data from a single PostgreSQL snapshot.
- `manifest.json`: byte sizes, SHA-256 checksums, scope, and completion marker.

Run during a period without schema changes. The schema and data exports use separate transactions. Auth data includes sensitive identities and sessions; limit access to the backup directory and use the owner's protected/encrypted storage. Provider registrations, client secrets, project settings, encryption root keys, Worker settings, and storage file bytes are outside this export. Preserve needed provider configuration through the owner's password manager and current Supabase recovery guidance.

For weekly images, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` privately in the owner shell for the source project:

```sh
node scripts/backup-media.mjs --out /path/to/independent/protected/storage
node scripts/verify-backup.mjs --dir /path/to/media-backup-directory
```

The tool walks nested folders and every list page in the private `tracker-images` bucket, downloads objects to safe local filenames, and records remote paths, content types, sizes, and checksums. It never prints or writes the service key into the manifest. An interrupted or failed run does not produce a completion manifest; do not use its partial output.

Image exports are not a transactional snapshot. Run during a quiet period or temporary contribution freeze, and coordinate database and media exports for a restore drill. A weekly media copy can lose newer images even when daily database records are available. For a consistent recovery point, take both exports together with writes paused; document the expected data-loss window.

Verify every finished export and independent copy. A checksum confirms local integrity, not hosted compatibility or recoverability. Backups must be restored in a disposable project before launch and after relevant schema/Auth changes. Owner-selected retention and secure disposal periods must appear in the final privacy notice. No schedule is created automatically by these tools.

## Database restore drill

Treat a restore as a deliberate owner operation. Do not experiment against the live project. No included script automatically overwrites a database.

1. Verify the export manifest with `verify-backup`. Inspect `pg_restore --list` for both custom-format dumps using a matching PostgreSQL client. Save the source migration/version record.
2. Create or use an empty, disposable Supabase target on the permitted Free plan. Check that its PostgreSQL and managed Auth schemas match the source. Create schema `extensions` if needed and enable `pg_trgm` there before restoring public indexes; this dependency is outside the scoped public schema export. Follow the current [Supabase restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), particularly any encryption-root-key requirements. The scoped exports here are not a provider-wide backup of every managed schema.
3. Configure the target connection through `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE=require` privately. Verify the target hostname/project reference independently. Avoid putting a credential URL in a command line or terminal transcript.
4. Restore `schema.dump` into that empty target with `pg_restore --exit-on-error --single-transaction --no-owner --dbname=postgres schema.dump`. Preserve its access grants/revocations: omitting ACLs can accidentally give ordinary users execution rights on privileged functions. Stop on any error rather than accepting a partial schema. Do not apply the app migration a second time to this already restored public schema.
5. For the data import only, set `PGOPTIONS` to `-c session_replication_role=replica` in the owner shell, following the narrowly scoped trigger-disabling approach in Supabase's guide. This prevents historical verification records from being rejected by the current-revision insert guard and avoids managed Auth trigger side effects. Restore `data.dump` into the empty target in one transaction with `pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=postgres data.dump`, then unset `PGOPTIONS` immediately. If the owner connection cannot set that option or any import error occurs, stop and resolve it using the provider's guide; do not bypass failures on production. The restore drill must verify references and retained historical evidence before the target is usable.
6. Independently compare restored public-table and function access grants/revocations with the reviewed migration. Confirm that authenticated and anonymous browser clients are denied direct app-table access and privileged RPC execution. Restore only necessary project-specific customizations in managed schemas; never replace the provider's managed schema definitions blindly.
7. Recreate the private `tracker-images` bucket with the configured content types and 500 KB limit. Restore bytes using the media tool below. Reconfigure all three OAuth providers, callback URLs, frontend public settings, and target backend secrets.
8. Connect a separate review API/website to the target. Compare row counts and distinct participation, read old revisions/tests/history, sign in through every provider, check a real problem and its images, test moderation permissions, and verify a fresh write.
9. Record the completed drill, measured time, supported recovery point, differences, and failures. Do not claim a successful restore until these checks pass. Clean up the disposable test resources according to the owner's retention choices.

If an existing destination already has rows or applications, do not use the above empty-target sequence. Review a migration/restore strategy first. Restoration can invalidate sessions, alter account state, or fail when managed Auth structures changed.

## Media restore preflight and guarded apply

Point `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at the **target** project. The target private bucket must already exist.

```sh
node scripts/restore-media.mjs --dir /path/to/media-backup-directory
```

This default verifies the manifest and all local file checksums without sending any network writes. It displays the intended target reference and object count. To apply after reviewing the exact target:

```sh
node scripts/restore-media.mjs --dir /path/to/media-backup-directory --apply --confirm-ref TARGET_PROJECT_REF
```

Existing files are preserved: the default is no overwrite, and a conflict fails the operation. A deliberate `--overwrite` allows replacing existing object paths and requires the same apply/target confirmation. Restores are sequential and not atomic; inspect any failure, preserve the report, and retry against the intended target. The tool never deletes remote objects or creates buckets. Read the restored files through the API and compare downloaded checksums during the drill.

## Incident response and rollback

For a suspected compromised key, restrict writes as necessary, rotate the key in the provider, update only the affected server secret, and review access/actions. Do not place replacement keys in browser variables. For a privacy report, hide the content promptly through moderation and record any required follow-up with the owner.

For an application regression, use Cloudflare's previously approved Worker/Pages deployment to roll back code. Keep database changes compatible with the previous code during a release. A code rollback does not undo stored contributions or migrations. Take and verify a recovery export before a schema change; avoid destructive migrations without a reviewed recovery path.

Record the deployed code version, migration set, redacted configuration inventory, backup IDs, health results, and public-release approval. After recovery, repeat the core journey and image/sign-in checks before reopening writes.
