# Setup and reviewed deployment

## Local development

Use the Node and pnpm versions described in the root README. Run `pnpm install`, then `pnpm dev`. The website listens on port 5173 and the local API on port 8787.

The unconfigured development setup uses local demo data and development identities. This is intentionally different from hosted authentication. Keep it bound to loopback. Do not publish the development server or use demo accounts as evidence that OAuth is working.

If a local port is already in use, stop the existing development process rather than silently changing the API port. The browser test configuration expects the documented ports. `DEMO_DATA_FILE` can isolate demo state for manual review or tests.

## Supabase foundation

1. Create a dedicated **Free** Supabase project in the owner's chosen region. Save recovery credentials in the owner's password manager. Do not commit them or paste them into chat.
2. Run `supabase/migrations/001_tracker.sql` using the Supabase SQL editor or an already configured migration workflow. Review the script before applying it. Keep a record of the migration filename, project reference, date, and result.
3. Check that application tables have restricted browser access and that anonymous and ordinary authenticated database clients cannot write application records directly.
4. Check that `tracker-images` exists, is private, and enforces the required supported image types and file size. The backend provides image access through its attachment routes.
5. Enable `pg_trgm` and the full-text search configuration required by the migration. Check both search and duplicate suggestions against actual database records.

The initial public instance has no demonstration problems or counts. Production profiles begin as ordinary members. Do not infer administrator privileges from a provider email or client metadata.

## Google, GitHub, and Microsoft sign-in

Create an OAuth application with each provider and enable the matching Supabase provider. Use the **Supabase Auth callback URL shown by your project**, normally `https://PROJECT_REF.supabase.co/auth/v1/callback`, as the provider callback. Client secrets belong in Supabase provider settings, never in `VITE_` variables.

- Google: [Supabase Google configuration](https://supabase.com/docs/guides/auth/social-login/auth-google).
- GitHub: [Supabase GitHub configuration](https://supabase.com/docs/guides/auth/social-login/auth-github).
- Microsoft: [Supabase Azure configuration](https://supabase.com/docs/guides/auth/social-login/auth-azure). Supabase uses the provider identifier `azure`; confirm the registration allows the account types intended for the beta.

Configure the Supabase Site URL to the production website URL and allow only the exact local/review/production callback URLs needed by the website. Avoid a broad production redirect wildcard.

For each provider, test successful sign-in, cancellation, rejected consent, an expired session, sign-out, and returning after sign-out. Test provider accounts that share an email and verify that identity linking follows Supabase's authenticated identity rules. Never build email-based account merging into this application. Use [Supabase identity-linking guidance](https://supabase.com/docs/guides/auth/auth-identity-linking) when reviewing that behavior.

## Environment boundaries

| Environment value               | Location                    | Meaning                                                          |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| `VITE_API_URL`                  | Website build environment   | Absolute API origin without `/api`; optional for the local proxy |
| `VITE_SUPABASE_URL`             | Website build environment   | Public Supabase project URL                                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Website build environment   | Public publishable/anon key; never the service-role key          |
| `SUPABASE_URL`                  | Worker environment          | Same production project URL                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Worker secret               | Privileged backend access; never browser-visible                 |
| `APP_ENV`                       | Worker environment          | Must be `production` for hosted operation                        |
| `ALLOWED_ORIGINS`               | Worker environment          | Comma-separated exact allowed website origins                    |
| `API_PUBLIC_URL`                | Worker environment          | Absolute public backend origin                                   |
| `API_MODE`                      | Local Node development only | `demo` for local review; not a public authentication mechanism   |
| `PORT`                          | Local Node development only | `8787` by default                                                |
| `DEMO_DATA_FILE`                | Local Node development only | Optional path for persistent local demo records                  |

Keep local Node backend values in ignored root `.env.local`, `apps/api/.env.local`, or the owner shell. Wrangler uses an ignored `apps/api/.dev.vars` file for its own local Worker runtime; the Node development launcher does not read that file. Website development values belong in ignored `apps/web/.env.local`. Use each application's example file for exact syntax. Vite embeds every `VITE_` value into downloadable browser code.

## First administrator

Sign in to the actual configured project as the owner. Let the API create the profile. Find that person's exact Supabase Auth UUID and match it to the correct profile, then run this reviewed SQL in that same project:

```sql
UPDATE public.profiles
SET payload = jsonb_set(payload, '{role}', '"admin"'::jsonb)
WHERE auth_user_id = 'REPLACE_WITH_OWNER_AUTH_UUID'::uuid;
```

Confirm exactly one intended row changed and that the moderator workspace becomes available after refreshing the session/profile. Create any additional moderators through a similarly reviewed owner operation. Never run a role change against an unverified UUID.

## Cloudflare preparation and final release

Run `pnpm check` and the browser journeys before packaging. The GitHub checks workflow performs validation only; it has no deployment secrets or deployment job.

For the backend, use `apps/api` as the Worker project with its Wrangler configuration. Add the server-only secret through Cloudflare secret settings, then configure the non-secret variables above. The API build is a deployment dry run. After the owner has reviewed the working result and authorized public deployment, run `pnpm --filter @tracker/api exec wrangler deploy` from the repository root.

For the website, configure Cloudflare Pages with repository root as the project root, `pnpm --filter @tracker/web build` as the build command, and `apps/web/dist` as the output folder. Configure only the public website environment values. Ensure deep links such as a problem URL route to the SPA. Use a provider subdomain and the Free plan; do not add a purchased domain or a paid feature.

After deployment, check HTTPS, `/health`, API access from the allowed origin, blocked unlisted origins, fresh sign-in, an empty production feed, a complete real contribution journey, and private attachment handling. Record live verification results in the release checklist.

Recheck provider limits before opening the beta. No paid upgrade should be automatic. If usage approaches free capacity, restrict new contributions or show maintenance messaging while the owner reviews options.
