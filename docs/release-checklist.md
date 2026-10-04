# Beta release checklist

This is an evidence checklist. Leave an item unchecked until its stated check has actually passed, and record the test version/date and evidence in a release note. Local validation does not complete hosted checks.

## Product journeys and permissions

- [ ] A real user reports a structured problem; another confirms an affected setup; a contributor proposes a revision; test outcomes lead to an independent moderator review and resolution.
- [ ] Duplicate suggestions allow a user to continue a distinct report and never merge automatically.
- [ ] Repeated and concurrent participation requests cannot inflate affected, upvote, follow, or test counts.
- [ ] Two distinct affected accounts establish confirmation; other lifecycle changes require a moderator reason.
- [ ] Not applicable is excluded from the success denominator, and sample counts/setups remain visible.
- [ ] Material solution edits preserve old tests and require fresh verification; authors cannot self-verify.
- [ ] Partial scope stays partially solved; reopening requests and decisions preserve evidence/history.
- [ ] Duplicate merge preserves contributions, deduplicates account participation, and redirects the old address.
- [ ] Restricted users and unauthorized users cannot edit another person's records or moderate.
- [ ] Moderation reports, private notes, notifications, account emails, and privileged credentials stay outside public responses.

## Usability and abuse handling

- [ ] Feed discovery tabs, category filters, search, problem pages, contributions, notifications, and moderator queues work.
- [ ] Mobile layouts, keyboard navigation, visible focus, contrast, labels, empty/loading/error states, and form errors are reviewed.
- [ ] A failed request does not appear saved, preserves unsent form content, and offers a clear retry.
- [ ] Invalid image types/signatures, images over 500 KB, and more than three images per contribution are rejected by the backend.
- [ ] Text renders safely; harmful uploads, spam, excessive requests, and oversized input are handled.
- [ ] Public Rules and Privacy pages match deployed behavior, and the owner publishes a real support/appeal contact, region, retention periods, and account-removal process.

## Hosted foundation: pending owner projects and credentials

- [ ] Supabase migration is applied successfully to the intended project; full-text/trigram search and transactional functions work.
- [ ] Public app tables are inaccessible to direct ordinary browser database writes, while backend permissions work.
- [ ] The image bucket is private; attachment reads and ownership checks work through the production API.
- [ ] Google, GitHub, and Microsoft each pass live success/cancellation/expired-session/sign-out/identity-linking checks.
- [ ] Provider callbacks and allowed website redirect origins are exact; local demo identities/routes cannot authenticate publicly.
- [ ] The intended owner alone receives administrator access through a reviewed UUID-based bootstrap.
- [ ] No secrets appear in source control, browser code, API errors, provider logs, or exported build configuration.
- [ ] HTTPS, allowed-origin API access, blocked unlisted origins, deep-link navigation, and health checks pass on the provider subdomains.

## Validation and recoverability

- [ ] `pnpm check` passes for the reviewed commit.
- [ ] `pnpm test:e2e` passes for the reviewed commit and a supported browser.
- [ ] Hosted concurrency/constraint behavior matches local integration checks.
- [ ] A database export and media copy are verified and saved to independent protected storage.
- [ ] A disposable Supabase restoration passes row-count, account, image, permission, and fresh-write checks.
- [ ] Daily database and weekly image routines have an owner; expected recovery/data-loss windows are documented.
- [ ] Previous approved deployments and code rollback instructions are available; migrations are compatible with rollback.

## Free capacity and public release

- [ ] Current Cloudflare and Supabase Free allowances are rechecked; paid add-ons and automatic paid upgrades are disabled.
- [ ] Hosted feed, write, moderator, and maximum-image requests are measured against the Worker CPU budget.
- [ ] Request/database/storage/egress usage and operational errors have an owner review routine.
- [ ] Contribution restriction/maintenance messaging is ready before capacity exhaustion.
- [ ] The production feed contains genuine records and counts; demonstration content is confined to local review.
- [ ] The owner reviews the finished website, API, live checks, policies, and limitations and gives final public-release approval.

## First-month review

Track genuine problem reports, distinct affected confirmations, returning contributors, tested fixes, time to first response, time to verification, duplicates, moderation workload, and provider usage. Expand categories or features only after reviewing that evidence. Do not imply that a public beta has service guarantees provided by paid plans.
