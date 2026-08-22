# Alchemy infrastructure

This monorepo uses independent Alchemy stacks because the retained platform and
the three applications have different deploy and destroy lifecycles.

| Package | Stack | Current role |
| --- | --- | --- |
| `infra/platform` | `MaelstromPlatform` | Owns the Zone identity, rate-limit phase, D1, Email Sending, and Turnstile |
| `apps/www` | `MaelstromWww` | Owns the prebuilt Astro Worker |
| `apps/docs` | `MaelstromDocs` | Owns the prebuilt static Astro Worker |
| `apps/demo` | `MaelstromDemo` | Models the prebuilt hosted Worker and `SessionDO` |

Every package has a conventional `alchemy.run.ts` composition root. Resource
configuration lives beside the resource under `src/` or `infra/`. Shared names
and cross-stack references are exported by `@maelstrom-co/platform-infra`.

Alchemy is authoritative for the platform, all three production applications,
and all PR previews. A direct Cloudflare API deletion remains as a safety net
for exact known Worker names.

Four event-specific workflows call `scripts/preview-lifecycle.ts` for preview
policy and mutations:

- `deploy-preview.yml` records a human label approval, builds the approved
  same-repository source without credentials, and deploys the three apps.
- `invalidate-preview-approval.yml` removes an approval after a source push
  only when the recorded approval still belongs to the previous SHA.
- `teardown-preview.yml` handles label removal, closure, and default-branch
  manual reconciliation.
- `reconcile-previews.yml` discovers at most 200 exact Worker-name candidates
  and reconciles them through independent scheduled matrix jobs.

The bot-owned preview comment stores separate hidden `approvedSha` and
`deployedSha` values. A new approval changes only `approvedSha`; the previous
deployed body remains until all replacement deployments and legacy cleanup
succeed. The lifecycle also reads the historical visible deployed-SHA sentence
when a comment predates hidden state. A push invalidator checks the event's
before/after edge before every label-removal retry, so a completed later marker
write normally makes a delayed run harmless. GitHub does not offer a conditional
label deletion, so a small race remains between the final marker read and the
REST deletion. Automation does not restore the label because that could override
an intentional unlabel. Re-add the label to recover approval, or use manual
reconciliation to finish cleanup after that provider race.
Approval comment writes also make a final live pull and bot-comment read, but
GitHub offers no conditional comment PATCH. A smaller final-read/write race
therefore remains; retry the label approval for the current head if it occurs.

Cloudflare mutations use one non-cancelling per-PR queue and recheck live pull
request state, label, comment marker, repository, and approved SHA. Queue order
and capacity are not durable correctness mechanisms; the marker and live checks
provide authority. Before each credentialed deployment, fixed workflow shell
commands verify the trusted lifecycle files against the workflow SHA. The
lifecycle also rejects an approved source checkout with tracked or staged
changes and invokes Alchemy through the absolute Bun path captured before source
installation. Credentialed steps recheck that executable's hash and select a
hashed lifecycle Bun config with environment-file loading and auto-install
disabled. These checks preserve reviewed identities; they do not sandbox
approved PR code. Failed replacement deployments leave the last per-application
state intact. Fixed-name stacks have no safe explicit rollback. Remove and
re-add the label to retry, or remove it once to request complete serialized
teardown. A successful replacement retires only the three legacy Worker names.

Fallback Worker deletion runs six ordered passes with at most six concurrent
requests per pass. Provider `Retry-After` delays are honored when the next full
pass still fits the hard nine-minute client budget. Otherwise cleanup stops and
defers to the next reconciliation instead of retrying before the provider's
deadline. Only the final completed pass determines success.

## Validate

Run credential-free checks from the workspace root:

```sh
bunx nx run @maelstrom-co/platform-infra:validate
bunx nx run @maelstrom-co/www:infra-typecheck
bunx nx run @maelstrom-co/docs:infra-typecheck
bunx nx run @maelstrom-co/demo:infra-typecheck
```

Application type-check targets depend on their infrastructure type-checks, so
normal workspace validation also detects drift in app-local stacks.

## Platform

Deploy retained shared resources from `infra/platform`:

```sh
bun alchemy deploy --stage prod --profile maelstrom-production-env
```

`MaelstromPlatform/prod` keeps its existing stack name and logical IDs:

- `ProductionZone`: Retained `maelstrom-ai.co` Zone identity.
- `ProductionRateLimit`: Retained owner of the zone `http_ratelimit` phase.
- `Waitlist`: D1 database `maelstrom-waitlist` and ordered SQL migrations.
- `NotificationsEmail`: transactional sending subdomain.
- `WaitlistTurnstile`: Managed Turnstile widget.

Do not rename these resources or edit applied migration files. Append new D1
migrations only. All five resources use retention policies.
`test/migrations.test.ts` pins the SHA-256 of every migration that has reached
production, so editing an applied file fails CI instead of silently drifting
from the live schema (D1 skips a re-applied file by name).

Production CI deploys this platform stack at the checked green revision before
any application job. The platform job exposes only the managed widget's public
`turnstileSiteKey`. The credential-free `www` build validates and embeds that
output; Cloudflare account credentials remain confined to deployment steps.

Every credentialed CI step also sets the non-secret repository variable
`EXPECTED_CLOUDFLARE_ACCOUNT_ID` (from `PRODUCTION_ACCOUNT_ID` or
`PREVIEW_ACCOUNT_ID`). Each stack guard compares it with the active
`CLOUDFLARE_ACCOUNT_ID` before declaring resources, so a swapped or misscoped
secret fails fast instead of mutating the wrong account. Keep the two variables
pointing at different accounts.

### Waitlist confirmation rollout

Migration `0004` adds an independent confirmation-attempt ledger without
clearing the legacy subscriber columns. This keeps the old Worker compatible
during the platform-first deployment window. The new Worker accepts only `v1`
tokens, so application activation invalidates every earlier query-string token
without an irreversible migration update. Rolling back after issuing `v1`
links makes those new links unusable until the fixed Worker returns; recover by
rolling forward, not by editing an applied migration.

Confirmation links carry `v1` tokens in URL fragments, which browsers do not
send in HTTP requests. Some mailbox security gateways rewrite complete links
and may copy a fragment into their own request URL. Monitor confirmation rates
and gateway behavior. If that exposure becomes unacceptable, replace clickable
links with a separate code-entry flow; never move the token back to a query.

After deploying the fixed Worker:

1. Query PostHog for historical `$current_url` values containing
   `/waitlist/confirm/?token=`. Use PostHog's person deletion API with event
   deletion for affected identifiers, then verify its asynchronous deletion
   status. Never export or paste the captured URLs.
2. Record the last matching Cloudflare invocation timestamp. Workers Logs age
   out after three days on Free plans and seven days on Paid plans. Inspect any
   OpenTelemetry or Logpush destination separately because it has independent
   retention.
3. Record the deployment cutoff and completion of both checks in the release
   log. Repository automation cannot perform either account-level deletion.

An email result that cannot be persisted remains `attempting` and conservatively
holds the ten-minute resend cooldown. During a D1 outage, immediate retry and
duplicate-send prevention cannot both be guaranteed; the cooldown favors
preventing a second accepted email while the provider result is unreconciled.
Valid, Turnstile-approved signup requests return the same generic `202` whether
the address is new, terminal, cooling down, or has an ambiguous provider result.
After the durable claim, Email Sending and its state transition run through the
Worker execution context so provider latency does not disclose address state.
Permanent rejections permit a fresh claim; provider quota failures use the
non-confirmable `retryable` state and create a provider-wide backoff without
starting address cooldown; ambiguous results remain confirmable in case Email
Service accepted before losing acknowledgement.

### Rate-limit ownership migration

The two-revision migration is complete. The bootstrap deployment persisted and
verified the existing `ProductionZone` identity before Ruleset ownership was
introduced. Routine deployments no longer use adoption. `ProductionZone` owns
only type, paused state, and vanity nameservers; it does not own DNS records or
DNSSEC.

`ProductionRateLimit` owns the entire zone `http_ratelimit` phase. Alchemy
beta.73 reconciles that resource with one full-list replacement request, so an
omitted, reordered, or unknown rule field could otherwise be erased. The
privileged platform step therefore fetches the live phase immediately before
`bun alchemy deploy` and fails closed unless it exactly matches one of two
states: the captured legacy two-rule baseline, or the exact owned two-rule state
from a previous successful deployment. This transition guard makes the first
ownership deployment safe and later deployments idempotent. It rejects provider
errors, malformed envelopes, changed ruleset or rule semantics, unknown
semantic fields, and rule or characteristic reordering. It ignores only known
provider-managed `version` and `last_updated` fields on the ruleset result and
top level of each rule; the same names elsewhere are semantic drift. One
dependency-free contract supplies the exact desired values to the Alchemy
resource, API preflight adapter, and persisted-state validator. After deploy,
the workflow verifies every ruleset and ordered rule semantic in both persisted
Alchemy state and a fresh live phase response against that contract.

The owned waitlist rule still matches `/api/waitlist` by exact equality and adds
`/api/waitlist/confirm` with a second explicit equality. It does not use prefix
matching. The preflight minimizes but cannot remove TOCTOU risk: Cloudflare does
not provide a conditional phase replacement, so the live phase can still change
between the guarded GET and Alchemy's PUT.

The production token needs Zone Read and zone-scoped `Zone WAF Write` for
`maelstrom-ai.co`; older Cloudflare dashboard wording may call the latter
`Zone WAF Edit`. Existing account identity guards remain mandatory. Both the
Zone and Ruleset use `retain(true)`, so removing the stack does not delete the
production zone or rate-limit phase.

## Application Ownership

Build credential-free artifacts before deploying an Alchemy-owned application:

```sh
bunx nx run @maelstrom-co/www:build --skip-nx-cache
bunx nx run @maelstrom-co/docs:build --skip-nx-cache
```

Deploy the prebuilt artifact from its application directory:

```sh
bun alchemy deploy \
  --stage prod \
  --profile maelstrom-production-env
```

Routine deployment must not pass `--adopt` or encode `adopt(true)` on a resource
declaration. The temporary `ProductionZone` bootstrap is complete and its
adoption policy has been removed. Missing or mismatched ownership stops the
deployment for manual review.

Production Workers set `workersDev: false` in their Alchemy declarations.
Production serves only its custom domains; a default-enabled `workers.dev`
route would bypass the zone-scoped WAF and rate limiting. PR previews
intentionally keep `workersDev: true`.

Completed:

1. Adopted `docs` without changing its prebuilt static asset shape.
2. Adopted `www` without changing its prebuilt Worker shape.
3. Adopted `demo` without changing `SESSION_DO` or `SessionDO`.
4. Switched all production application jobs to Alchemy.
5. Migrated docs PR previews and teardown to Alchemy.
6. Migrated `www` PR previews and teardown to Alchemy without production
   waitlist bindings.
7. Migrated demo PR previews and their isolated `SessionDO` namespaces to
   Alchemy.

`alchemy@2.0.0-beta.73` is patched with
[alchemy-run/alchemy#1300](https://github.com/alchemy-run/alchemy/pull/1300)
so unresolved Worker bindings do not bypass adoption ownership checks. Remove
`patches/alchemy@2.0.0-beta.73.patch` when upgrading to a release that includes
that fix.

`Cloudflare.Website.Astro` is deferred. In beta.73 it runs the Astro build in
the credentialed deployment process and cannot scrub Cloudflare credentials or
hash `DOCS_SOURCE_REF`. Docs therefore keeps its credential-free Nx build and
lets Alchemy upload only the resulting `dist` artifact.

Worker runtime packages compile against `@cloudflare/workers-types@5.20260722.1`,
matching their `2026-07-22` compatibility date.
Binding contracts come from `Cloudflare.InferEnv` on the Alchemy Worker
declarations rather than a compatibility-date-generated snapshot. This
combines date-aligned runtime APIs with the deployed binding source of truth.

The root manifest has no direct Wrangler dependency and no repository command
or configuration uses it. `@astrojs/cloudflare` still requires Wrangler as a
peer, so it remains transitive in `bun.lock`; full package removal waits for the
separate `Cloudflare.Website.Astro` conversion.

The unchanged `@astrojs/cloudflare` adapter still generates
`apps/www/.wrangler/deploy`, so Nx tracks that ignored adapter output. It is not
a direct CLI or configuration surface.

Next:

1. Convert `www` to `Cloudflare.Website.Astro` in a separate deployment.
2. Convert `demo` to `Cloudflare.Website.Vite` in a separate deployment.
3. Convert `SessionDO` to the Effect-native implementation separately.

Do not combine stack ownership transfer with a framework or Durable Object
runtime migration.

## Credentials

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in CI. Scope the token to
the production account and `maelstrom-ai.co` zone. Remote-state bootstrap also
requires Secrets Store access. Alchemy profiles and state credentials stay
outside the repository.

### State-store bootstrap rules

Both accounts' remote state stores are pre-bootstrapped with the pinned
Alchemy version via `alchemy cloudflare bootstrap`. PR preview jobs must never
perform implicit state-store bootstrap or upgrades: concurrent first-use or
version transitions race the same account-wide Worker and Secrets Store
resources.

- After any Alchemy pin bump, run a serialized manual bootstrap of both
  accounts before preview traffic resumes. Treat every beta upgrade as a
  control-plane migration: canary the preview account first.
- Outside CI, exactly one Alchemy execution is permitted against either
  account: the pinned-version state-store bootstrap, run serialized from the
  controlled operator environment (`state-store-bootstrap.sh` wrapping
  `alchemy cloudflare bootstrap`). Every other local invocation is prohibited;
  a client with a different version can upgrade the shared store mid-deploy.
  All callers sharing an account stay on one exact pinned version.
- If a state-store Worker is found missing, re-bootstrap manually before
  deploying; do not let a queued PR job discover the absence implicitly.

The preview account token also needs Secrets Store access so ephemeral CI
runners can derive the Alchemy state-store credentials used by preview stacks.
Set the repository variable `CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX` to the exact
preview account suffix, such as `maelstrom-preview.workers.dev`. Deployment
rejects every state-derived URL that is not the expected per-PR Worker at that
suffix, including URLs with credentials, ports, paths, queries, or fragments.

The adopted `www` Worker binding reads `TURNSTILE_SECRET_KEY` directly from the
referenced `WaitlistTurnstile` resource.

`@maelstrom-co/platform-infra/waitlist-contract` is dependency-free and owns the
production origin, hostnames, sender identity, Turnstile action, and Cloudflare
public test site key. The production widget permits only the two production
hostnames. Local and preview website builds use Cloudflare's public test widget,
while a production build fails unless CI supplies a managed `0x` site key.
The public `PUBLIC_TURNSTILE_ENVIRONMENT` build input selects that fail-closed
production path and is tracked by Nx together with the site key.

The waitlist API and confirmation-email builder import this shared contract.
Siteverify failures log only a sanitized category and allowlisted provider
codes, never tokens, IP addresses, email addresses, hostnames, or response
bodies.

## Preview Reconciliation

The teardown workflow accepts a trusted `workflow_dispatch` pull request number.
The separate scheduled workflow lists preview-account Workers and accepts only
exact current or legacy names before extracting positive PR numbers. Every
candidate then enters the same per-PR queue and rechecks the live PR state,
label, and approval marker. A current open, labeled approval receives legacy
cleanup only. A stale approval, closed PR, or unlabeled PR receives full known
cleanup. A delayed event or manual request skips a current active approval.

Cloudflare's Worker list cannot reveal PR-only resources, detached Alchemy state
without a remaining Worker script, or resources whose names do not match the
strict allowlist. Scheduled reconciliation is only a bounded backstop for
discoverable exact Workers. A targeted manual dispatch can reconcile a known PR
number. Full teardown attempts the three trusted default-branch Alchemy stacks
before direct exact-name Worker cleanup, and continues independent cleanup after
an individual failure.

Trusted teardown intentionally runs only fixed default-branch Alchemy entrypoints
and exact Worker-name cleanup. It cannot enumerate or claim deletion of an
additional resource declared only by approved PR code. Approved internal PR
Alchemy configuration executes with the isolated preview token; it is not a
sandbox. The reviewed token scope and maintainer label gate remain the
preventive controls.

## Safety

Production application resources activate before their domain smoke tests.
A failed smoke test therefore stops CI but does not restore the previous Worker
version. Versioned deployment plus explicit promotion is a separate
architecture change; until then, recover a failed smoke test by rolling forward
the previous known-good revision.

All deployable stacks reject every stage other than `prod`. Use the dedicated
resource-free entrypoint for state inspection because beta.73 evaluates a stack
under its internal `placeholder` stage:

```sh
bun alchemy state stacks state.run.ts --profile maelstrom-production-env
```

Preview Workers remain isolated in the preview account. Do not point preview
stages at production state or resources.

DNSSEC activation still requires the registrar DS record. `ProductionZone` does
not manage DNSSEC or DNS records; keep those out of application adoption until
the out-of-band step is complete.
