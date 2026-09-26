# Prompt acceptance fixtures

These fixtures are controlled inputs for prompt evaluation. Fixture contents
are test inputs, not evaluation results.

## Reproduce safely

Fixture revision: `acceptance-fixtures-v1` (the tracked contents at this revision
are the test input; record the actual repository revision separately when running).

1. Start from the workspace revision under evaluation. Never edit canonical
   prompt sources or tracked fixture inputs during a trial.
2. Prepare independent scratch case directories outside the checkout using
   the app-owned setup script. Application sources, package configuration,
   simulated connector, SDK probes, and baseline test are tracked as files under
   `fixtures/`; the migration package manifest is named `package.json.fixture`
   to avoid Nx treating the test input as a workspace project. Staging copies
   it to `package.json`. `prepareFixtures(root, trialRoot)` copies these sources
   without packaging an SDK, installing dependencies, or running checks. Modeling,
   debugging, and React inventory can therefore be staged as source-only cases.
   The full CLI also performs SDK setup and baseline checks for onboarding and
   both migration projects. The conversion and inventory directories are
   checked byte-identical before SDK setup:

   ```sh
   node apps/docs/prompts/acceptance/prepare-trials.mjs "$PWD" /tmp
   ```

   The exact Maelstrom package sources are the checkout's `packages/{react,
   client,protocol,connectors}` built output at the recorded checkout revision;
   package version metadata is `0.1.0-alpha.4`. The script rewrites the expected
   SDK `catalog:` runtime dependencies to explicit pinned versions
   (`@tanstack/react-store` 0.9.3, `@tanstack/store` 0.9.3, `nanoid` 5.1.16,
   and `zod` 4.4.3), packs them locally, and installs those tarballs and pinned
   React/Vite/test dependencies privately in the two SDK-backed project types
   (onboarding and migration).
   The generated Bun lockfiles capture the resolved dependency trees. It does
   not link scratch projects to shared workspace `node_modules` or editable
   package directories, access provider services, or copy secrets. Record the
   printed source revision (the parent of the working copy, not a claim that
   dirty working-tree package bytes are identified by that revision), each
   generated lockfile, installed versions, SDK source/build hashes, and hashes
   emitted for paired migration input files. A read-only inventory and
   authorized conversion project begin from the same SearchPanel/search source
   bytes; no Vessel implementation is seeded.
3. Use the exact task inputs below with the named scenario:

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
   - **React inventory / `migration-inventory`:** Replace `[PRODUCT GOAL]` in
     `maelstrom-react-inventory` with “Plan how to make the support search form
     in `src/SearchPanel.tsx` available as a developer-authored Maelstrom
     capability without changing current behavior.” Repository root is the
     `migration-inventory` cwd. This is read-only: make zero edits, do not
     install packages, and send no request.
   - **Authorized conversion / `migration-conversion`:** Read the same prompt
     task goal and use the identical SearchPanel UI/input as inventory. Its
     approved bounded plan is: “Implement the smallest developer-authored
     Maelstrom capability for the existing SearchPanel. Preserve its controlled
     input, empty-submit disabled state, pending/error/success UI, and existing
     `searchTickets` application-owned handler. Keep the request boundary
     unchanged and send no request. Edit only files required to define/register
     and test this capability in the supplied app shell; do not add routes,
     backend work, credentials, persistence, broad scaffolding, or unrelated
     changes. Use the supplied simulated connector only for deterministic local
     tests, and label its result simulated—not live Engine verification. Stop if
     inspection finds a material decision not authorized by this plan.” This
     paired run checks read-only versus explicitly authorized behavior, not
     different fixture content.
   - **Debugging / `debugging-react`:** “Classify the failure described in
     `report.md` from the supplied evidence. State what is observed versus
     inferred, identify missing evidence, and recommend only a bounded next
     diagnostic step; do not edit files or claim a root cause beyond the
     evidence.”

   Use the `cwd` printed by the setup script as the task repository root. The
   modeling case contains only `src/Queue.tsx`; debugging contains only the
   explicitly synthetic `report.md`. Never target the canonical fixture directory
   with an implementation prompt.
4. Record exact prompt ID/version, model/runtime if known, input revision, temp
   path, commands, and unedited output in a copy of `record-template.md`. For
   SDK-version evidence also record the repository revision and paths/commands
   used to inspect manifests, lockfile, installed source/types/tests. Apply
   pass/fail criteria literally; use unrun when evidence was not collected.

No real provider credentials or live Engine are required for these local cases.
The setup compiles/import-checks the checked-out SDK and includes a local
`EngineConnector` test double that returns a deterministic synthetic response;
it never contacts an Engine. Live Engine behavior is not asserted by any fixture.
An optional external-service check must be separately authorized, use a disposable
non-production environment, and record infrastructure setup and redacted evidence;
never place credentials or tokens in a fixture or record.

## Fixture inputs

- `fixtures/onboarding-react`: small React support-queue application for
  plan-and-implement onboarding scenarios. Expected baseline: existing heading,
  explanatory text, and two ticket rows (`T-104`, `T-105`) render; there is no
  existing Maelstrom integration, route, action, or persistence.
- `fixtures/modeling-react`: a support-queue detail view with documented
  observed states and existing operations for inventory/modeling.
- `fixtures/migration-react`: an existing controlled search form with
  application-owned network handling. The setup script gives the paired scratch
  projects a minimal Vite/React app shell and baseline test without pre-seeding
  Maelstrom conversion code. The read-only inventory and authorized conversion
  project begin byte-identically from the same SearchPanel and `search.ts` sources.
  No request should actually be sent.
- `fixtures/debugging-react`: a synthetic redacted report with enough separate
  transport/processing evidence to classify the observed failure while keeping
  the root cause bounded.
