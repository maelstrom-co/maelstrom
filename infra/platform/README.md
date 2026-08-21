# Alchemy infrastructure

This monorepo uses independent Alchemy stacks because the retained platform and
the three applications have different deploy and destroy lifecycles.

| Package | Stack | Current role |
| --- | --- | --- |
| `infra/platform` | `MaelstromPlatform` | Owns D1, Email Sending, and Turnstile |
| `apps/www` | `MaelstromWww` | Owns the prebuilt Astro Worker |
| `apps/docs` | `MaelstromDocs` | Owns the prebuilt static Astro Worker |
| `apps/demo` | `MaelstromDemo` | Models the prebuilt hosted Worker and `SessionDO` |

Every package has a conventional `alchemy.run.ts` composition root. Resource
configuration lives beside the resource under `src/` or `infra/`. Shared names
and cross-stack references are exported by `@maelstrom-co/platform-infra`.

Alchemy is authoritative for the platform, all three production applications,
and all PR previews. A direct Cloudflare API deletion remains as a safety net
for legacy preview Workers and uploads that finish after deployment timeout or
interruption.
Preview teardown runs through `pull_request_target` and executes only trusted
default-branch code at the workflow revision; it never checks out the pull
request branch. Deployment and teardown serialize Cloudflare mutations per PR,
then recheck the current PR state and label before changing cloud resources.
Preview deployment runs only for a fresh `deploy-preview` label event at the
current head SHA. A push removes that approval through trusted, credential-free
workflow code, so maintainers must review and re-add the label for the new SHA.
Failed replacement deployments destroy all partial Alchemy stacks. A successful
replacement retires only the three legacy Worker names.

Fallback Worker deletion runs six ordered passes with at most six concurrent
requests per pass. Provider retry delays are capped at one minute, and the hard
nine-minute client budget remains below the 12-minute workflow step timeout.
Only the final completed pass determines success.

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

- `Waitlist`: D1 database `maelstrom-waitlist` and ordered SQL migrations.
- `NotificationsEmail`: transactional sending subdomain.
- `WaitlistTurnstile`: Managed Turnstile widget.

Do not rename these resources or edit applied migration files. Append new D1
migrations only. All three resources use retention policies.

Production CI deploys this platform stack at the checked green revision before
any application job. The platform job exposes only the managed widget's public
`turnstileSitekey`. The credential-free `www` build validates and embeds that
output; Cloudflare account credentials remain confined to deployment steps.

The Pro zone also has an API-managed `http_ratelimit` rule named **Rate limit
waitlist signup**. It applies a Managed Challenge after 10 requests per minute
per IP to `/api/waitlist`. It stays outside Alchemy because the current Ruleset
resource owns the entire phase and would also take ownership of the unrelated
leaked-credential rule.

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
declaration. Missing or mismatched ownership must stop the deployment for manual
review.

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

Residual integration: concurrent waitlist delivery work owns
`apps/www/src/pages/api/waitlist.ts` and
`apps/www/src/lib/waitlist-confirmation-email.ts`. Those files still need to
import the shared action, hostname, origin, and sender values. The API follow-up
must also classify Siteverify failures and log only the category and provider
error codes, never tokens, IP addresses, email addresses, or response bodies.

## Preview Reconciliation

The teardown workflow accepts a trusted `workflow_dispatch` pull request number
and also reconciles daily. Scheduled discovery lists preview-account Workers and
accepts only exact current or legacy names before extracting positive PR
numbers. Every candidate then enters the same per-PR serialization group and
rechecks the live PR state and `deploy-preview` label. An open, labeled preview
cannot be deleted by a stale, manual, or scheduled request.

Cloudflare's Worker list cannot reveal detached Alchemy state that has no
remaining Worker script. Scheduled reconciliation therefore cannot discover a
state-only orphan. A targeted manual dispatch can reconcile its known PR number,
and each normal teardown still runs all three Alchemy destroys before direct
Worker cleanup.

Trusted teardown intentionally runs only the fixed default-branch Alchemy
entrypoints and exact Worker-name cleanup. It cannot enumerate or destroy an
additional resource declared only by PR code without executing that untrusted
declaration. Such a resource is outside scheduled ownership discovery; the
reviewed preview token scope and maintainer label gate remain the preventive
controls.

## Safety

All deployable stacks reject every stage other than `prod`. Use the dedicated
resource-free entrypoint for state inspection because beta.72 evaluates a stack
under its internal `placeholder` stage:

```sh
bun alchemy state stacks state.run.ts --profile maelstrom-production-env
```

Preview Workers remain isolated in the preview account. Do not point preview
stages at production state or resources.

DNSSEC activation still requires the registrar DS record. Keep zone and DNSSEC
ownership out of application adoption until that out-of-band step is complete.
