# Prompt acceptance fixtures

These fixtures are controlled inputs for future manual prompt evaluation. They
are not evaluations, and no prompt has been run against them as part of authoring
this directory. Every result starts as **unrun** in `record-template.md`.

## Reproduce safely

Fixture revision: `acceptance-fixtures-v1` (the tracked contents at this revision
are the test input; record the actual repository revision separately when running).

1. Start from a clean checkout of the repository revision under evaluation. Do
   not edit the canonical fixture files.
2. Copy the selected fixture into a new temporary directory outside the checkout:
   `cp -R apps/docs/prompts/acceptance/fixtures/<name> /tmp/maelstrom-fixture-<name>`.
3. For `onboarding-react`, use the workspace's installed dependencies from the
   repository root: run `node_modules/.bin/tsc --noEmit --skipLibCheck -p
   "$TEMP/tsconfig.json"` from the repository root, where `$TEMP` is the
   temporary fixture path. This is a source-only typecheck; it does not install
   or exercise the SDK. `modeling-react`, `migration-react`, and `debugging-react` are source contexts
   to inspect, not standalone applications, and require no package install.
4. Give the prompt under evaluation the matching input file, this README, and
   only the matching checklist. Point the prompt's repository root at the
   temporary copy. For onboarding, copy the full fixture directory. For the
   source-context fixtures, create a temporary project and place the context
   files under their displayed relative paths. Never run an implementation
   prompt with the canonical directory as its target.
5. Record exact prompt ID/version, model/runtime if known, input revision, temp
   path, commands, and unedited output in a copy of `record-template.md`. Apply
   pass/fail criteria literally; use unrun when evidence was not collected.

No real provider credentials or live Engine are required for these basic source
inspection cases. Live Engine behavior is not asserted by any fixture. An
optional external-service check must be separately authorized, use a disposable
non-production environment, and record infrastructure setup and redacted evidence;
never place credentials or tokens in a fixture or record.

## Fixture inputs

- `fixtures/onboarding-react`: small React support-queue application for
  plan-and-implement onboarding scenarios. Expected baseline: existing heading,
  explanatory text, and two ticket rows (`T-104`, `T-105`) render; there is no
  existing Maelstrom integration, route, action, or persistence.
- `fixtures/modeling-react`: a support-queue detail view with documented
  observed states and existing operations for inventory/modeling. Expected
  assertions are in `checklists/modeling.md`.
- `fixtures/migration-react`: an existing controlled search form with
  application-owned network handling, intended to test authorized conversion
  boundaries. No request should actually be sent; assertions in
  `checklists/migration.md`.
- `fixtures/debugging-react`: a synthetic redacted report with enough separate
  transport/processing evidence to classify the observed failure while keeping
  the root cause bounded. Assertions in `checklists/debugging.md`.

## Acceptance checklist use

Checklists define observable prompt outcomes, not implementation tests. A pass
requires cited source evidence or an exact output artifact for every required
criterion. A checklist failure does not authorize an out-of-scope fix. Keep
prompt evaluation distinct from the source-only fixture typecheck and workspace
CI checks. Use the pending record and replace each criterion status only after
review; do not report authored expectations as completed acceptance.
