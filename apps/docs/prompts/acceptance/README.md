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
3. For `onboarding-react`, prepare dependencies in the disposable copy so
   TypeScript resolves imports relative to the copied TSX files. From the
   repository root, after setting `TEMP` as above, run:

   ```sh
   ln -s "$PWD/node_modules" "$TEMP/node_modules"
   (cd "$TEMP" && ./node_modules/.bin/tsc --noEmit --skipLibCheck -p tsconfig.json)
   ```

   This typechecks the copied source with workspace-installed dependencies; it
   does not install or exercise the SDK and is not a prompt-evaluation result.
   Record the workspace root/revision used for the dependency link. The fixture
   has no Maelstrom SDK dependency: each prompt run must inspect the named
   repository root's manifests, lockfile, installed package source/types/tests,
   and report declared and resolved SDK versions or that the SDK evidence is
   unavailable. Do not install or upgrade packages to fill an evidence gap.
   `modeling-react`, `migration-react`, and `debugging-react` are source contexts,
   not standalone applications, and require no package install or typecheck.
4. Use these exact task inputs with the listed fixture and only its checklist:

   - **Onboarding / `onboarding-react`:** “Integrate Maelstrom into this small
     support workspace so the support queue can be selected and presented as a
     developer-authored Vessel. Inspect the app and SDK first, implement the
     smallest bounded integration, preserve the existing heading, explanatory
     text, and ticket rows, and report required setup, versions, checks, and
     rollback. Do not add credentials or claim live Engine verification.”
   - **Modeling / `modeling-react`:** “Inventory the support-queue capability
     in `src/Queue.tsx`; identify observed user-visible states and operations,
     choose whether it should be one Vessel, and give an evidence-backed Vessel
     proposal. Do not edit files.”
   - **Migration plan-only / `migration-react`:** “Plan a bounded conversion of
     the existing search form in `src/SearchPanel.tsx` to a Maelstrom capability.
     Inspect its source and `src/search.ts`, preserve application-owned request
     handling, and report a plan, tests, versions, and rollback. This is
     read-only: make zero edits and send no request.”
   - **Migration implementation / same `migration-react` fixture:** Use the
     same goal and inputs as the plan-only case, adding: “You are authorized to
     implement that bounded conversion now. Do not request another approval;
     stop only if inspection finds a material scope, product, or architecture
     decision not authorized here. Do not send a request.” This paired run tests
     that authority changes behavior, not fixture content.
   - **Debugging / `debugging-react`:** “Classify the failure described in
     `report.md` from the supplied evidence. State what is observed versus
     inferred, identify missing evidence, and recommend only a bounded next
     diagnostic step; do not edit files or claim a root cause beyond the
     evidence.”

   Point the prompt's repository root at the temporary copy. For onboarding,
   copy the full fixture directory. For source-context fixtures, create a
   temporary project and place the context files under their displayed relative
   paths. Never target the canonical directory with an implementation prompt.
5. Record exact prompt ID/version, model/runtime if known, input revision, temp
   path, commands, and unedited output in a copy of `record-template.md`. For
   SDK-version evidence also record the repository revision and paths/commands
   used to inspect manifests, lockfile, installed source/types/tests. Apply
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
