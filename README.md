# Technology Problem Tracker

A community website and separate API for reporting technology problems, confirming affected setups, investigating causes, proposing fixes, and preserving evidence-backed solutions.

The first release covers **Computers, Software, and Networking**. Affected confirmations and upvotes are separate. Each solution revision has its own test results; moderators review evidence and supported setups before verification.

## Run locally

Install stable Rust with a native linker, Node.js 24, and pnpm 11.25.0. Install the WebAssembly target and matching binding generator once.

```sh
rustup target add wasm32-unknown-unknown
rustup component add rustfmt clippy
cargo install wasm-bindgen-cli --version 0.2.130 --locked
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The API runs on `http://127.0.0.1:8787`. Without production credentials, the application runs a clearly labelled local demonstration with sample issues and local demo identities. Its file-backed data lives in ignored `.data/` storage; see the API configuration for `DEMO_DATA_FILE`. This mode is for development and review and must never be exposed to the internet.

```sh
pnpm check         # Rust formatting, Clippy, tests and release builds
pnpm build         # Native backup tool, Pages website and Worker dry-run package
pnpm test:e2e      # Browser journeys (Microsoft Edge by default)
```

Browser tests can use a Playwright Chromium installation by setting `PLAYWRIGHT_CHANNEL=chromium`. CI uses that option on Linux. The VS Code folder configuration recommends useful extensions and includes tasks to start both applications and run checks. Installing extensions is optional.

## Project structure

| Location              | Responsibility                                                        |
| --------------------- | --------------------------------------------------------------------- |
| `apps/web`            | Browser rendering and platform integration with Vite and React        |
| `apps/api`            | HTTP, Supabase, Cloudflare Worker and loopback adapters               |
| `crates`              | Rust tracker, validation, and native backup commands                  |
| `packages/contracts`  | JSON schemas, TypeScript types and WebAssembly bindings               |
| `supabase/migrations` | PostgreSQL tables, constraints, restricted access, functions          |
| `scripts`             | Owner-run backup, integrity, restore preflight tools                  |
| `docs`                | Product workflow, provider setup, launch checks, operations, policies |

## Production setup and release

Use Cloudflare Pages for the website, Cloudflare Workers for the API, and Supabase Free for PostgreSQL, Auth, and private image storage. Google, GitHub, and Microsoft sign-in require the owner's OAuth applications and Supabase configuration.

Start with [setup](docs/setup.md), then use the [release checklist](docs/release-checklist.md). Public deployment is an owner-reviewed final step. This repository does not automatically deploy, create accounts, purchase services, or enable paid upgrades.

Credentials, live OAuth verification, hosted database migrations, hosted restore drills, quota/CPU checks, and real account-linking checks remain release prerequisites until performed against the owner's projects. Successful local tests do not establish that those hosted checks passed.

## Product and operating references

- [Contributor guide](CONTRIBUTING.md)
- [Architecture and contribution workflow](docs/architecture.md)
- [Backups, recovery, monitoring, and rollback](docs/operations.md)
- [Community rules](docs/community-rules.md)
- [Beta privacy information](docs/privacy.md)
- [Implementation and validation record](docs/validation.md)
- [Rust migration and benchmark results](docs/rust-migration.md)

No AI features, payments, manufacturer dashboards, advanced reputation, or mobile applications are included in this beta. User-supplied screenshots and setup information should never contain passwords, access tokens, personal addresses, or confidential logs.
