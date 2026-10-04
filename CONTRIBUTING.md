# Contributing

Help improve the product through concrete ideas, reproducible reports, and reviewed changes. Start with the [product workflow](docs/architecture.md), [setup guide](docs/setup.md), and [validation record](docs/validation.md).

## Discuss an idea

Open an issue describing the user, the problem they face, the proposed behavior, and how we could tell whether it helped. Include relevant devices and versions. For a bug, add reproduction steps, expected and actual results, and a screenshot when useful. Remove personal information and credentials from examples.

The beta covers Computers, Software, and Networking. Keep these product rules intact:

- Affected confirmations and priority votes measure different things.
- Tests belong to the solution revision actually tested; material edits need fresh verification.
- Verification records evidence and supported setups, and authors cannot verify their own fixes.
- Duplicate merges preserve contributions and history while counting each participant once.
- Demonstration records are labelled; production counts represent real participation.

Discuss larger changes before implementation so the owner and contributors can agree on scope.

## Run the project

Install Node.js 24 and the pnpm version pinned in `package.json`, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The local demo includes member and moderator identities and saves its data in ignored `.data/` files. No cloud credentials are needed to work on the demo. Keep this development server local.

## Make a change

Create a branch from the repository's default branch, using a descriptive name such as `feature/problem-filters` or `fix/solution-revisions`. Keep each pull request focused. Include what changed, the reason, how it was checked, and screenshots for visible changes. Request review before merging.

Use the shared schemas and types in `packages/contracts` for API changes. Update the website, backend validation, and OpenAPI description together. Preserve ownership checks, account restrictions, moderation permissions, and the database's denial of direct browser access.

Add a new migration for changes to a database migration already applied to a hosted project. Explain its compatibility and data impact. Exercise constraints and transaction behavior in the PostgreSQL tests; never use live community data as a test fixture.

## Check before a pull request

```sh
pnpm check
pnpm format:check
pnpm test:e2e
```

Stop any running local preview **before** browser tests. The test runner otherwise reuses the existing API, which prevents its separate test data file from taking effect. Browser tests change demonstration data.

Browser tests use installed Microsoft Edge by default. To use Playwright Chromium, install it with `pnpm exec playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium` in your shell. CI uses Chromium on Linux.

The browser suite includes accessibility checks. Also inspect keyboard navigation, visible focus, form errors, and a narrow phone layout when changing the interface. Add meaningful regression coverage for changed behavior. State any checks you could not complete in the pull request.

## Credentials and release boundaries

Keep actual environment files, service-role keys, OAuth secrets, backup credentials, and database/media exports out of Git and issue attachments. Commit only placeholder examples. Every `VITE_` value is exposed to the browser; privileged credentials belong only on the backend or in the owner's backup environment.

Local checks do not verify live OAuth, hosted storage, backups, or free-hosting capacity. Those checks require the owner's configured provider projects. Public deployment requires the [release checklist](docs/release-checklist.md) and the owner's final review. CI validates contributions and does not deploy the website.
