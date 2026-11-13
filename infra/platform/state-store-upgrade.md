# Upgrade the Cloudflare state store to protocol 8

Isolate OSS preview state before upgrading production from patched Alchemy beta.83
to patched beta.85. The Cloud project's default preview-account store stays on
protocol 7.

## Before you start

- Merge the isolation control PR into `main` after its review and merge approval.
  GitHub requires the workflow on the default branch before manual dispatch.
- Keep upgrade PR #413 open and unmerged, with passing CI and no `deploy-preview` label.
  Pin its revision before reviewing code for execution with account credentials.
- Use a repository administrator or maintainer account with the GitHub CLI.
- Verify that the `preview` and `production` environments contain their existing
  Cloudflare account ID and API token secrets. Tokens need Worker and Secrets
  Store access. Keep token values out of commands and logs.
- Verify `PREVIEW_ACCOUNT_ID`, `PRODUCTION_ACCOUNT_ID`, and
  `CLOUDFLARE_PREVIEW_WORKERS_DEV_SUFFIX`. The accounts must differ.
- Reserve a maintenance window covering all callers of OSS preview stacks and
  the production account's default store. Cloud may keep using its own stacks
  in the preview account's default store.

The workflow executes reviewed candidate code with Cloudflare credentials.
`--dry-run` prevents Alchemy's apply phase; it does not sandbox module side effects.
The source acknowledgement covers the entire candidate program.

## Pin and review the candidate

Capture the candidate revision before reviewing it:

```sh
upgrade_sha=$(gh pr view 413 --repo maelstrom-co/maelstrom --json headRefOid --jq .headRefOid)
```

Review that exact commit, including its infrastructure program, dependencies,
and build hooks. Use the captured `upgrade_sha` for every dispatch and merge
check. If the PR head changes, capture and review the new revision before
repeating verification. A current-head check cannot prove which revision an
operator reviewed.

## Pause callers

Disable the five repository workflows from a terminal with repository access:

```sh
gh workflow disable deploy-production.yml --repo maelstrom-co/maelstrom
gh workflow disable deploy-playground.yml --repo maelstrom-co/maelstrom
gh workflow disable deploy-preview.yml --repo maelstrom-co/maelstrom
gh workflow disable teardown-preview.yml --repo maelstrom-co/maelstrom
gh workflow disable reconcile-previews.yml --repo maelstrom-co/maelstrom
```

Let active deployments finish. Cancel queued runs and runs waiting for approval.
Stop outside callers that use OSS preview stacks or the production store. Keep the five
workflows disabled until both stores pass verification and `main` uses beta.85.
The maintenance workflow checks repository workflow states and active run counts
before every Alchemy command. It cannot discover outside callers or prevent an
administrator from enabling a workflow between checks.

Set the persistent caller requirement after callers stop:

```sh
gh variable set ALCHEMY_REQUIRED_VERSION --repo maelstrom-co/maelstrom --body 2.0.0-beta.85
```

Keep this variable after maintenance. Trusted preview deployment and teardown
code refuses source checkouts whose installed core or Cloudflare provider differs.
Production and playground workflows check the installed version before deployment.
An older PR must update its dependencies and preview routing before it can deploy again.

## Inventory and copy OSS preview state

Run inventory before the maintenance window if needed. It reads selected state
and uses a temporary edge preview to obtain the existing auth token. It never
changes the default deployed Worker, its secrets, or its state.

```sh
gh workflow run preview-state-isolation.yml --repo maelstrom-co/maelstrom --ref main \
  -f mode=inventory -f source_pr=413 -f source_sha="$upgrade_sha" -f source_reviewed=true
```

Inspect the redacted inventory artifact. The manifest covers every repository
PR, selected resource-bearing stages, and live preview Workers. Supply known
manual `pr-N` stages through `additional_stages`, separated by commas.
The API cannot enumerate unknown outputs-only manual stages. Their data stays
in the source store; this procedure does not create a complete SQLite backup.
Legacy Wrangler preview Workers have no Alchemy ownership state to copy.

After all OSS callers stop, dispatch the fresh copy:

```sh
gh workflow run preview-state-isolation.yml --repo maelstrom-co/maelstrom --ref main \
  -f mode=copy -f source_pr=413 -f source_sha="$upgrade_sha" \
  -f source_reviewed=true -f callers_paused=true -f confirm_isolation=true
```

Approve the preview environment gate. Copy requires the destination Worker
`alchemy-state-store-maelstrom-oss-preview` to be absent. It bootstraps only that
named backend on protocol 8. It preserves full encoded resource records,
replacement history, action replay fields, and separate stack outputs.

Wait for success. Inspect `copy.json` in `oss-preview-state-isolation`.
Confirm the source SHA, control SHA, account, run attempt, named destination,
protocols 7 and 8, preservation flags, and selected scope counts.
The client compares selected inventories and outputs, then rereads the source.
Its transport permits destination writes only to captured scopes.
The receipt contains no state, tokens, encryption keys, or state-derived hashes.

Copy the successful run's numeric ID from Actions:

```sh
read -r isolation_run_id
gh variable set ALCHEMY_PREVIEW_STATE_STORE_WORKER --repo maelstrom-co/maelstrom \
  --body alchemy-state-store-maelstrom-oss-preview
```

Keep callers paused. The pointer activates admission checks; old beta.85 source
revisions without the routing capability also fail. Keep this pointer after
cutover. Do not route callers back to the old source once the new store receives
writes. The source remains a historical copy, not a current rollback target.

## Verify preview

Dispatch the canary using the successful copy receipt:

```sh
gh workflow run alchemy-state-maintenance.yml --repo maelstrom-co/maelstrom --ref main \
  -f target=preview -f source_pr=413 -f source_sha="$upgrade_sha" \
  -f isolation_run_id="$isolation_run_id" -f callers_paused=true -f source_reviewed=true
```

The workflow requires the same candidate, control revision, account, and copy
attempt. It connects only to the named backend, which must already serve
protocol 8. It never bootstraps the shared preview store.
It creates a uniquely named canary with beta.85, compares its encrypted record
before updating it, checks its expected HTTP response, and destroys it.

Wait for the complete run to pass. Inspect the
`alchemy-state-maintenance-preview` artifact and confirm `preview.json` names
the isolated Worker, reviewed source, protocol 8, state preservation,
canary success, and cleanup success.
Copy the successful run's numeric ID from Actions:

```sh
read -r preview_run_id
```

## Verify production

Keep every normal caller paused. Dispatch production using the same source SHA:

```sh
gh workflow run alchemy-state-maintenance.yml --repo maelstrom-co/maelstrom --ref main \
  -f target=production -f source_pr=413 -f source_sha="$upgrade_sha" \
  -f callers_paused=true -f source_reviewed=true -f confirm_production=true \
  -f preview_run_id="$preview_run_id"
```

Production requires a successful preview run from the same maintenance workflow
revision, candidate revision, and recorded run attempt. If `main` or the candidate
changes between runs, repeat preview verification. Receipts expire after seven days.

The workflow reads the existing `MaelstromPlatform/prod/ProductionZone` record,
bootstraps production with beta.85, verifies protocol 8, and compares the decrypted
record. It then runs the candidate platform's production deployment with
`--dry-run --yes`. Inspect the plan in the job log. The workflow does not invoke
Alchemy's production apply command.

Wait for the complete production run to pass. Check its
`alchemy-state-maintenance-production` receipt and review the platform plan.
If an earlier run stopped during or after bootstrap, complete the independent
reconciliation in [Recover a failed run](#recover-a-failed-run) before accepting
this receipt. Its state comparison covers only the current invocation.
Application deployment plans still run through the normal production workflow
before their respective applies.

## Resume callers

Freeze unrelated `main` merges during the maintenance window. After both
verification runs pass and any required independent reconciliation is complete,
confirm that the current PR head still equals
`upgrade_sha` and that `main` still matches the production receipt's `controlSha`.
If either changed, rebase and review the candidate, then repeat preview and
production verification before requesting merge approval.

Request separate merge approval for that exact #413 head. Use a head-matched
merge after approval. Before enabling any caller, compare the merged commit's
Git tree with the verified candidate's tree; commit SHAs may differ after a
squash merge. If the trees differ, keep callers disabled and prepare a reviewed
follow-up candidate for another verification cycle. Do not treat verification
of the old tree as permission to deploy the changed tree.

Wait for successful CI on the verified merged revision. Keep
`ALCHEMY_REQUIRED_VERSION=2.0.0-beta.85` and update every outside OSS caller with the same named-store pointer and expected account.
Do not rerun jobs pinned to older revisions.

Re-enable the five paused workflows:

```sh
gh workflow enable deploy-production.yml --repo maelstrom-co/maelstrom
gh workflow enable deploy-playground.yml --repo maelstrom-co/maelstrom
gh workflow enable deploy-preview.yml --repo maelstrom-co/maelstrom
gh workflow enable teardown-preview.yml --repo maelstrom-co/maelstrom
gh workflow enable reconcile-previews.yml --repo maelstrom-co/maelstrom
```

Trigger a fresh CI completion for the upgraded `main` revision so the normal
production workflow can deploy and run its domain smoke tests. Events received
while a workflow was disabled do not provide a deployment to resume.

## Recover a failed run

Leave OSS callers paused after any failure. A failed or cancelled copy can leave
a partial named store. Do not activate routing, delete that store, or retry
against it. The copy refuses an existing target. Reconcile the partial result
with the unchanged source through a separately reviewed recovery plan.

Never restore beta.83 against a store
that may have begun its protocol-8 upgrade. Do not delete the state store or
replace its encryption key.

Production bootstrap uses the existing default store in the production account.
Before production bootstrap starts, a reader can use beta.83 only while the serving protocol
is still 7. Preview canary cleanup always uses beta.85 and the named store. After production
bootstrap starts, use beta.85 only when protocol 8 is
confirmed. If the protocol is uncertain, the workflow stops cleanup and reports
the exact canary stack, stage, and Worker name for operator repair.

Cancellation or a job timeout can prevent that final diagnostic. In the preview
account, locate the canary using the interrupted run's `GITHUB_RUN_ID` and
`GITHUB_RUN_ATTEMPT`:

- Stack: `MaelstromStateStoreCanary`.
- Stage: `maintenance-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`.
- Worker: `maelstrom-state-canary-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`.

Use the original attempt's identity when cleaning up after a rerun. Follow the
protocol checks above before choosing a cleanup CLI.

Resolve the reported phase before dispatching another run. A failed run produces
no successful verification receipt. A retry can read its baseline from a store
that the failed run already upgraded. Its `existingStatePreserved` result proves
only that the record matched within the retry; it does not prove preservation
across the original bootstrap.

After an interruption during or after bootstrap, independently reconcile the
affected records against authoritative evidence from before the original
bootstrap. A new baseline, a passing canary, or a successful retry receipt cannot
replace that evidence. Keep callers paused if the evidence is unavailable or
preservation cannot be established. Do not put state contents or encryption
material in receipts or public logs.

Complete this reconciliation before accepting a retry receipt or resuming any
caller. The workflow does not retain durable evidence of the original baseline
or enforce this operator check. Normal workflows stay disabled; the
maintenance workflow never enables them or merges the upgrade PR.

See [Alchemy's v7 upgrade instructions](https://alchemy.run/blog/2026-11-01-beta-85/#upgrade-from-v7)
for the encryption-key warning and coordinated-version requirement.
