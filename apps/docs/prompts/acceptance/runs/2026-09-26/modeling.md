# Manual acceptance trial: Vessel modeling

## Task boundary and execution

- Canonical prompt: `maelstrom-vessel-modeling` v1.0.1, read from the specified canonical source. Its compatibility metadata names `@maelstrom-co/react` v`0.1.0-alpha.4`.
- Checklist: `apps/docs/prompts/acceptance/checklists/modeling.md`.
- Fixture/repository root: `/tmp/maelstrom-prompt-acceptance.0ncOs4/modeling-react`; component: `src/Queue.tsx`.
- Goal: “Inventory the support-queue capability; identify observed user-visible states and operations, decide whether it should be one Vessel, and give an evidence-backed proposal.”
- This is proposal-only, strictly read-only. No fixture source was edited. No live Engine check was attempted.
- The fixture contains only `src/Queue.tsx` outside `node_modules`; no callers, app wiring, hooks/stores, API handlers, types, or tests were available to inspect. No `@maelstrom-co/*` package or package manifest was found in fixture `node_modules`, so an installed Maelstrom SDK version cannot be recorded. Do not infer implementation API compatibility from the prompt's compatibility metadata.

## Capability inventory and decision

**Propose the support queue as one Engine-selectable Vessel.** It presents a coherent user capability: inspect the support tickets and narrow the displayed list by subject. The search input and Reset button are controls of that capability, not useful independent Engine-selectable Vessels. The only data shown is the component's local static `tickets` array (two entries; `Queue.tsx:3-6`). Search filters that array in memory by case-insensitive subject substring (`10-12`); there is no evidence of remote search, persistence, or ticket mutation.

Plausible user intent: find a support ticket by its subject and inspect its displayed status. Selection of the whole queue gives the Engine a user-meaningful unit to present; exposing the input/button separately would split incidental controls from the capability. A single Variant with no Actions is sufficient: search and Reset are ordinary UI behavior, and no distinct legal capability state or application operation suitable for an Engine Action is established.

## Observed behavior table

| UI state or operation | Source evidence | Props/data | Side effects |
| --- | --- | --- | --- |
| Initial queue; query is `""`, both tickets visible | `src/Queue.tsx:3-12` initializes local query to empty string and filters static subjects using `includes("")`; `:26-35` renders the non-empty result list. | No component props. Local `tickets` data at `:3-6`; local query state at `:9`. | No external effect observed; render derives results locally. |
| Search with matching text; matching visible ticket(s) | `src/Queue.tsx:17-21` binds input to query and stores typed text; `:10-12` filters subjects case-insensitively; `:30-35` renders matches. | Input text and local static ticket array. | Local React state update and derived filtering only. No network/API operation observed. |
| Search with no matching text; empty-results message | `src/Queue.tsx:26-28` renders `No matching tickets` in `role="status"` when the filtered list has length zero. | Query and local static ticket array. | None beyond local state/rendering. |
| Reset; query is restored to `""` and all static tickets become visible | `src/Queue.tsx:23-25` sets query to empty; `:10-12`, `:26-35` derive and render results from the cleared query. | No parameters; current local query and static ticket array. | Local input-state reset only. No server/API effect observed. |

## Proposed Vessel contract

- **Description:** “Review support tickets and find tickets by subject.” This explains user value without naming implementation details.
- **Variant:** one default/available queue view. Keep the search query, filtered results, no-results feedback, and Reset control within the same Variant. Do not invent loading, error, remote, or mutation states.
- **Actions:** none. Do not expose search typing or Reset as Engine Actions on the observed evidence. Reset remains local UI behavior.
- **Data/props:** component takes no props; displayed data is the two-item local static array. No business/API effects or idempotence claims apply.
- **Implementation status:** not implemented: task explicitly requires zero edits. If separately authorized later, first inspect/confirm installed SDK APIs and actual app integration; the current fixture does not supply them.

## Checklist and verification

1. Queue identified as capability; controls not separate Vessels: **Pass** (`Queue.tsx:15-25`).
2. Empty initial query, filtered results, empty-results message, Reset behavior represented: **Pass** (`:9-12`, `:20-28`, `:30-35`).
3. Reset described as local-only; no server/API effect or unobserved action/state proposed: **Pass** (`:23-25`).
4. Search is derived from local static data; no remote search/persistence/mutation claimed: **Pass** (`:3-12`).
5. Single Variant/no Actions is allowed and user-language description supplied: **Pass**.
6. No implementation authorization; no edits or tests were required: **Pass**. No Vessel rendering/Action tests were added because implementation was not authorized.
7. Exact checks/rollback and live Engine limits reported: **Pass**. No rollback needed since fixture was left unchanged; live Engine was not checked.

Commands actually run in the fixture:

- `nl -ba src/Queue.tsx` — passed; recorded source lines above.
- `find . -path './node_modules' -prune -o -type f -print | sort` — passed; only `./src/Queue.tsx` found outside dependencies.
- `find node_modules -path '*/@maelstrom-co/*/package.json' -print` — passed with no matches; no installed SDK manifests found.
- `npm ls --depth=0 @maelstrom-co/react @maelstrom-co/core` — not passed (exit 1; `(empty)`); SDK packages unavailable in this fixture.
- `git status --short` — not available (exit 128; fixture cwd is not a Git repository). No repository diff/staged-state verification is possible; no source files were changed.

No typecheck, test, lint/format, SDK type/API, or live Engine checks could be run: the fixture provides no source/config/test manifest beyond `Queue.tsx`, and the Maelstrom SDK is not installed. Do not treat these as passing. For the read-only proposal, rollback is not applicable; if there were an authorized future implementation, revert only its explicitly permitted fixture changes.

## Acceptance report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only proposal only, as instructed; no fixture source edits. Inventory and contract stay within the observed Queue.tsx behavior."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "This report cites Queue.tsx line-level evidence, records checklist outcomes, commands and results, absent SDK/check coverage, and the no-edit boundary."
    }
  ],
  "changedFiles": [
    "/Users/javcab/.pi/agent/sessions/--Users-javcab-Documents-maelstrom-maelstrom-prompting--/subagent-artifacts/outputs/0b7d355a-b9aa-4d54-b394-8c03d49649de/remainder/trials/modeling.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "nl -ba src/Queue.tsx",
      "result": "passed",
      "summary": "Inspected component source and line references."
    },
    {
      "command": "find . -path './node_modules' -prune -o -type f -print | sort",
      "result": "passed",
      "summary": "Only src/Queue.tsx exists outside dependencies in the fixture."
    },
    {
      "command": "find node_modules -path '*/@maelstrom-co/*/package.json' -print",
      "result": "passed",
      "summary": "No Maelstrom SDK package manifests found."
    },
    {
      "command": "npm ls --depth=0 @maelstrom-co/react @maelstrom-co/core",
      "result": "failed",
      "summary": "Exit 1; dependency tree reports empty."
    },
    {
      "command": "git status --short",
      "result": "failed",
      "summary": "Exit 128; fixture is not a Git repository."
    }
  ],
  "validationOutput": [
    "Checklist items 1-7 pass for the read-only modeling proposal; no implementation checks apply because implementation was not authorized.",
    "No fixture source files changed. SDK-required type/test/lint and live Engine checks were not run and are not claimed to pass."
  ],
  "residualRisks": [
    "Fixture does not include callers, app integration, tests, package manifest, or @maelstrom-co SDK; implementation details and installed SDK version cannot be validated.",
    "No Git metadata is present, so staged state cannot be independently queried."
  ],
  "noStagedFiles": true,
  "diffSummary": "Read-only analysis artifact only; no fixture source modifications. Git staged state unavailable because this fixture is not a repository.",
  "reviewFindings": [
    "no blockers found in the evidence-backed, proposal-only scope"
  ],
  "manualNotes": "Canonical prompt maelstrom-vessel-modeling v1.0.1 declares compatibility with @maelstrom-co/react 0.1.0-alpha.4; that package is not installed in the fixture."
}
```
