# Unified evals: offline contract slice

Case completion follows the [declared-scope convention](../../packages/evals/cases/README.md#completion-scope); it is separate from sample outcome and human review.

This non-published composition root extends the five-path runtime slice through
`packages/evals/src/core/runtime/evaluate.ts`. Inputs now come from
[forty-three indexed JSON v1 cases](../../packages/evals/cases/README.md) in the monorepo.
It is not the paid eval CLI or a completed migration. `variant`, `preserve` and
`generate-content` are JSON-backed; other current scenario links remain references.
Legacy-derived fixtures do not certify the old runtime.

`cases.ts` validates the full bounded file index before execution; `case-adapter.ts`
resolves only code-owned profile/oracle/fixture combinations. JSON drives weather
turns/state/expectations, client identities/intent/effect expectations, planner
request/catalog/expectations and fixture selection, stage bindings and replay source.
The additional `legacy-vessel-transition` profile uses JSON navigation tables,
initial Instances, scripted Actions and independent transition expectations.
`legacy-response-constraint` copies JSON scripted responses and independently
checks Action/state, negative marker enum, or no-op constraints. Absence of marker
Actions is a valid D19 safety pass, not positive selection evidence.
D21/T03 `out-of-scope-no-mutation` retains the exact flight-booking prompt and
`cap-maelstrom-conv-refusal` lineage at `/items/20`. Its new `no-op-tiling` rule
requires no Actions, nonblank text, exact initial Instance identity/Vessel/Variant
in response and retained state, and required exact tiling membership. This
strengthens the old scorer with tiling type and exact-count checks: synthetic
structural no-mutation evidence, not an exact scorer port, semantic refusal,
answer quality, or model understanding. The non-refusal script
`The weather is 72 degrees.` passes; arbitrary nonempty non-refusal text is also
a positive control. The old `out_of_scope_refused` reason is not a semantic
classifier. D20 `no-op` remains valid without layout, and D18/D19 are unchanged.
`legacy-no-dual-target-plan` adds **complete D17/T02 target-exclusion** evidence at
`/items/16`, preserving `Switch to the weekly view` with Weather/current and
Calendar/month source context. The complete Execution Plan fails iff both
`weather-main` and `calendar-main` occur. Empty, single/repeated-target and
unrelated-target plans (alone or mixed with one protected target) pass. Assistant
text and Action names/params are semantically unscored; clarification text cannot
rescue both targets. Required bounded response evidence never defaults a missing
Execution Plan to empty. The independent script says `I like trains.` with an
empty Execution Plan. No layout state or handler effects are represented. This
is not clarification success, answer quality, layout safety, whole-response safety
or a no-double-mutation claim. The separate legacy lexical heuristic is discarded;
semantic clarification and whole-response safety are outside this predicate.
See the [bounded contract](../../packages/evals/cases/README.md#complete-no-dual-target-plan-predicate-d17t02).

`legacy-weather-reuse` preserves four D22 requests and replays independent fixture
responses, checking the decisive weekly change and later single-panel retention.
Later same-target plans need not be empty; Action validity/effects are not scored.
It is separate from the D31 hourly/weekly/current `weather-session` chain.

`legacy-labs-select-marker` keeps D23/T07 `/items/22` separate from D19 negative
coverage: turn 1 must emit `selectMarker(hemoglobin)`; turns 0/2/3 require the
single expected trends layout member and forbid `showUpload`/`showList`. The
source scorer's turn-1 timing differs from the dataset's “final response” wording.
It does not check turn-1 layout/navigation or additional Actions, non-forbidden
foreign targets, Vessel identity, semantic state continuity, or marker persistence.
Later `selectMarker(glucose)` and turn-1 navigation/grid evidence are explicit
passing boundary controls, not supported user outcomes. Exactly four complete
snapshots and ordered prompts are required by this bounded harness. It is not
an exact scorer port, complete final-response correctness, or handler execution.

`legacy-cross-vessel` adds D36/T16 `/items/35` using its three dataset prompts:
hourly Weather, introduce Labs, then weekly Weather without Labs-target Actions.
Initial Weather/current and Calendar/month do not preload Labs. The case maps
dataset `labs-main` to registered Vessel `lab-results` in `trends`, deliberately
correcting the scorer's `lab-results-main/summary` expectations without aliases.
Calendar/month is required throughout; Calendar Actions are banned only on 0/1.
Labs metadata is absent on 0 by ID or Vessel, then required in trends on 1/2;
turn 2 requires Weather `showWeekly` and bans Labs-target Actions. Response checks
use first matches; extras/duplicates, unrelated plan semantics, JSON parameters
and pre-/retained-state continuity remain unscored. Turn-1 plans need no specific
Action; turn-2 Calendar Actions are outside the ban. Tiling response projections
and complete ordered evidence are required, not tree geometry or exact counts.
The unused source fallback is the two Weather/Calendar weekly prompts, not the
supplied three requests. This invokes no Engine, provider, judge or handler and
proves no real creation, visibility, effects, language understanding or runtime
compatibility. Scripts and expectations are independent; D35 now has its own user-adjudicated addition case.

`legacy-multivessel-add-instance` adds D34/T15 `/items/33`: the two supplied
Calendar prompts are used, not the legacy builder's unrelated Labs fallback.
Initial Weather/current is retained in both tiling response layouts, and a fresh
synthetic `calendar-added` ID appears with a same-response Action target on turn 0,
then remains Calendar/month on turn 1. This strengthens the source's Weather
ID-presence-only check and missing Calendar freshness/identity retention checks.
First-match semantics leave duplicate/extra layout members unscored; no exact-two
count or turn-0 Calendar Variant is required. Action names/params and turn-1 plans
are semantically unscored, with bounded arbitrary JSON params. Pre-/retained-state
snapshots are structural evidence only. Scripts never derive from expectations.
This does not execute layout-before-Actions or verify handlers, tree visibility,
geometry, language understanding or engine-old compatibility. The selected Calendar
ID is synthetic, not historical. D16 client effects and D37 tree addition remain
separate; neither changes D33's declared predicates or proves full F03a compatibility.

`legacy-labs-state-reset-subset` has a **complete two-prompt D33/T12 predicate**
at `/items/32`, not full legacy state-reset compatibility. It preserves only the
two supplied prompts, “Show me the list of my lab results.” and “Go back to the trends chart.”
Turn 0 must contain `labs-main/showList` and a tiling response layout whose first
`labs-main` member is `list`; turn 1 requires `showTrends` and `trends` the same way.
Extra/conflicting Actions, extra/duplicate layout membership, Vessel identity and
pre-/retained-state semantics are unscored. Canonical initial state is Labs/trends;
independent scripts retain identity, but the oracle does not certify continuity.
Exactly two complete ordered snapshots are required; no third prompt is invented.
F03a's third-turn post-reset/optional enum-safety rule is outside this two-prompt
contract: the legacy scorer requires at least three turns while its builder
supplies only these two. Separate synthetic cases cover emission and enum rules.
No third-turn marker behavior, positive selection or persistence is scored here. Positive controls permit changed
snapshots and invalid marker parameters. No Engine/provider/LLM/handler/runtime
verification is claimed; see the [two-prompt contract](../../packages/evals/cases/README.md).

`labs-state-reset-synthetic` is a **separate COMPLETE synthetic eval contract**
from the same D33 `/items/32` origin, not a changed dataset case. The first two
prompts are unchanged; “What's the trend for hemoglobin?” is a synthetic third
prompt absent from the dataset, using the legacy task fallback wording. Independent
scripted responses must emit exactly one `labs-main` Action per turn: `showList`,
`showTrends`, then `selectMarker` with exactly `{markerSlug: "hemoglobin"}`.
Navigation parameters, extra/conflicting Actions, wrong targets and wrong/extra
marker parameters fail. The oracle also requires exact single-Labs membership,
Variants list→trends→trends, and pre-/retained-membership continuity from initial
trends. No geometry or selected-marker state is represented. This proves only
scripted response emission and snapshot continuity, not LLM semantics, handler
effects, persistence or optional enum-safety. The current demo Labs integration
separately tests no-data navigation and per-instance selection; no app/runtime
compatibility is inferred from this fixture. Full T12/F03a compatibility is not
claimed; the optional first-match enum rule has its own case. The two-turn scoring
rules and fixture output are unchanged; lineage marks the originating row, not a
dataset-authored third prompt. No provider runs.

`labs-state-reset-optional-enum` adds a **separate COMPLETE isolated enum slice**
using the same existing synthetic third prompt. It copies one independent response
projection, not the reset session: absence of `labs-main/selectMarker` passes;
otherwise only the first matching Action must have a string `markerSlug` in
`hemoglobin | platelets | glucose`. Foreign targets, other Actions and later
matches are deliberately unscored. Valid-first/invalid-later passes, unlike D19's
every-match safety rule; invalid-first/valid-later fails. No selection is required,
unlike the separate exact positive-emission case. A missing Execution Plan fails,
not defaults to empty. The fixture contains an independent empty Execution Plan;
negative controls mutate observed Actions, not expectations. Handler effects,
marker persistence and current-app/runtime compatibility are outside this predicate.
Original D33 and D19 scoring rules are unchanged; no provider, model or handler runs.
See the [isolated enum contract](../../packages/evals/cases/README.md#complete-isolated-optional-marker-enum-slice-d33).

`legacy-labs-multi-marker-final` adds D30/T09 `/items/29`: only final index 2
must contain `labs-main/selectMarkers` with an actual `markerSlugs` array of
exactly three unique strings: hemoglobin, platelets, glucose (any order). This
corrects F03b stale turn-0/1 selection and turn-2 no-Action timing; exact-set
uniqueness explicitly strengthens dataset “all three.” Extra params and other
structurally valid Actions, even conflicting selections, are unscored. Intermediate
Actions and layout/state semantics are unscored. A pass is emission-only, not
whole-plan correctness, selected-state persistence or handler effects. Independent
scripts never derive from expectations. D19 and D23 remain unchanged; no model,
provider, Engine or legacy-runtime verification is claimed.

`legacy-target-disambiguation` keeps D24/T13 `/items/23` separate from the other
multi-turn profiles. It requires empty early plans, Weather current on turns 0/1,
`showWeekly` and weekly Weather on turn 2, then weekly retention. Both original
Weather/Calendar Instances and tiling membership must survive every pre-state,
response and retained state. Calendar stays month and receives no Actions;
foreign Action targets fail throughout. Late same-Weather-target plans may be
nonempty; Action validity/effects are not scored. This intentionally strengthens
the source's missing decisive-turn Calendar/count/Action checks and early/final
Weather checks. The source supplies optional operational `llmJudgeGuidance` to an
optional OpenAI judge; this synthetic harness invokes neither and proves no judge
quality or semantic disambiguation. Geometry, handlers and legacy-runtime
compatibility are not tested.

`legacy-weather-delayed-action` adds D32/T11 `/items/31`: exactly three source
prompts, two empty plans retaining current, then mandatory `weather-main/showWeekly`
and final weekly retention. Exact single-Instance identity and tiling membership
are checked in every pre-state, response and retained state. Layout-only premature
weekly mutation, weekly no-op, unrelated final Actions without the decisive Action,
and foreign targets fail. This explicit intent-preserving correction excludes the
source's unsound already-weekly/no-action branch; genuine already-weekly coverage
is deferred. Optional judge guidance's fourth “thanks” turn is absent from input
and is not run. No Engine, provider, judge or handler executes for this profile;
no semantic understanding, Action-effect or old-runtime compatibility is claimed.

`legacy-calendar-week-nav` adds D29/T08 `/items/28` with three exact source
prompts and independent scripted responses: `showWeekly`/week, empty plan/week,
then `showMonthly`/month on `calendar-main`, all in tiling layout. The dataset's
`showMonth` differs from the task fixture/scorer/judge-guidance `showMonthly`;
only this task-local spelling is used, without rewriting historical data.
This bounded source-scoring profile uses contains checks: extra Actions on turns
0/2 and extra layout members may pass. It does not impose exact-one plans,
exact membership, Vessel matching or retained-state continuity. Exactly three
complete ordered responses are required; missing/wrong/mistimed Actions,
`showMonth` substitution, any middle Action, wrong Variant/layout, missing target
and malformed evidence fail. Controls demonstrate independent expectations and
scripts and the intentionally permissive boundaries. D26 and D24 are unchanged.
The case is synthetic, `legacy-derived-harness`, `pending-human-review`, with no
response-quality, Action-effect, geometry, judge or `engine-old` compatibility
claim. No judge/provider is called; see the case README for exact prompts/source.

`legacy-tiling-add-vessel` adds D37/T22 `/items/36` with the exact add-calendar
prompt, independent response fixture and a fresh synthetic `calendar-added` ID.
It preserves Weather/current and Labs/trends, adds Calendar/month, and requires
all three visible once in a complete current `ID:`/weighted preorder tree.
Valid binary/n-ary forms and null empty slots pass; hidden metadata, duplicate or
unknown leaves, repaired/discarded splits, incomplete roots and trailing tokens
fail. The iterative validator bounds evidence to 256 tokens × 256 characters and
20 metadata/plan entries. It uses protocol token helpers, not runtime healing or
visibility projection as a validity oracle. This intentionally strengthens the old
bare-leaf scan and is stricter than current runtime repair/partial-tree tolerance.
Execution Plans may be empty or nonempty; their semantics are unscored. No geometry,
Action effects, model behavior or legacy-runtime compatibility is established.

`legacy-tiling-tree-validity` adds D12/T20 `/items/11`: retain Weather/current,
add `labs-main`/Labs/trends, and show both once in a complete unrepaired binary
subset of current `ID:`/weighted preorder syntax. The canonical Labs identity
matches source judge guidance. Unequal weights, reversed order, nesting and null
slots pass; n-ary splits fail without changing D37's general n-ary rule. The old
nested-array `depth <= 3` limit is not mapped to flat-tree split depth. Evidence
and traversal are bounded; plans have no semantic scoring requirement. This is
an explicit synthetic strengthening/representation adaptation, not geometry,
minimum-size fit, legacy depth parity, runtime repair/validation, Action effects
or engine compatibility. No judge/provider is invoked.

`legacy-grid-no-overlap` adds D13/T21 `/items/12` through a dedicated structural
oracle, not the generic planner scorer. It preserves the dataset request
`Place 5 vessels in compact grid`; the legacy builder's alternate prompt is
`Rearrange my dashboard to show all five panels`. Neither is model-interpreted.
Exactly five known unique grid positions must have nonnegative integer coordinates,
positive integer sizes, fit the explicit 12-row × 16-column Chart and not overlap;
touching edges are valid. This strengthens source membership/numeric checks.
Initial, response and retained grid evidence use current `GridLayout` cell fields,
not browser viewport dimensions. Compactness/minimum sizes are unscored: source
Labs remains 8×4 despite its 8×5 minimum, and sparse one-cell layouts may pass.
Empty/nonempty plans have identical layout verdicts. Bounded evidence and copied
scripts prove no healing, rendering, judge, semantic or runtime behavior.

`runtime-fixtures.ts` holds the shared offline planner/stage mechanics used by
both the registry and fault controls. No case can select a module or command.
Mutation tests edit temporary copies, not the canonical files, and verify that
changed inputs/expectations produce changed observations/verdicts.

| Path | What executes | Evidence boundary |
| --- | --- | --- |
| Legacy-derived D15 | Scripted weather transition | Harness/oracle only; **not engine-old compatibility** |
| Legacy-derived D31 | Sequential session adapter with copied state/history and fresh initialization per sample | Completed-turn checkpoints survive later failure |
| Legacy-derived D26–D28 | Calendar/Weather/Labs navigation tables interpreted by a shared session harness | Response and retained-state oracle only; no model planning, client execution, or actual file upload |
| Legacy-derived D17 (bounded) | Independent response script; complete Execution Plan target exclusion only | No clarification or whole-response safety proof from this target-exclusion predicate |
| Legacy-derived D18–D21 | Scripted response/state evidence and independent code-owned constraint rules | Harness/oracle only; no intent planning; D19 checks all matching enum Actions and permits their absence |
| Legacy-derived D22 | Four-turn script with exact Instance/tiling membership and copied state | Narrow structural trajectory only; no prompt interpretation, late Action validation/effects, or geometry |
| Legacy-derived D36 | Three independent dataset-aligned cross-Vessel responses | Corrected Labs identity/Variant and response isolation; no continuity, creation, geometry or Action-effect proof |
| Legacy-derived D34 | Two scripted Calendar-add responses with Weather/current preservation | Same-response Action target only; extra membership/Action semantics/continuity unscored, not client-order proof |
| D33 isolated optional enum | One response projection for the existing synthetic third prompt | Optional first-match enum predicate only, not reset execution, every-match safety or marker-state evidence |
| Legacy-derived D30 | Three independent scripted responses; final-turn exact-set Action presence | F03b timing correction and exact-set strengthening only; extra/conflicting Actions unscored, no marker-state guarantee |
| Legacy-derived D23 | Four scripted responses with turn-1 selection Action and trends/no-navigation checks at 0/2/3 | Source-scoring trajectory only; later conflicting selection can pass, no marker persistence or semantic final-response claim |
| Legacy-derived D24 | Four scripted turns with exact Weather/Calendar membership and retained state | Strengthened structural isolation only; no language interpretation, judge quality, Action effects or geometry |
| Legacy-derived D29 | Three scripted Calendar responses with week/week/month target and Action timing checks | Source-scoring contains checks only; no exact membership, retained continuity, response-quality, Action-effect or judge claim |
| Legacy-derived D13 | One scripted five-Instance grid, exact membership, bounds and pairwise overlap checks | Chart cell allocation only; no compactness, minimum-size, healing, rendering or Action-effect evidence |
| Legacy-derived D12 | Independent add-Labs response with strict current-format binary tree | Both Instances visible once; no old depth parity, geometry, runtime or Action claim |
| Legacy-derived D37 | One scripted add-and-retain layout, strict current weighted-tree validator | All three visible once; not legacy parity, runtime repair, geometry or Action execution |
| D16 + new Instance | Real public client Orchestrator, mocked Connector, actual registered handlers | Effects after layout application, asynchronous readiness, source-Variant handler retained |
| Current `variant` | Real Engine, fake baseline arm, independent candidate JSON and unchanged shipped-response scorer | Reference-backed integration only; raw diagnostic versus shipped observation retained, no model or synthetic stage usage |
| Current `preserve` | Existing `runEval` and real Engine with fake planner plugin | Shipped-response scoring, existing usage/replay records |
| Stage/replay | Existing stage runner, real Action stage with scripted transport, synthetic upstream replay | Hand-off, N/A, expected deferral and incompatible replay stay distinct |

Tests block global `fetch`; the stage transport is explicitly scripted. All data
is synthetic. No API keys, external service, Langfuse, Docker, browser UI,
canonical data repo, or paid model is required. The client is headless: handler
effects are observed, not React mounting or rendered geometry. Injected faults
reverse the real response batch or replace its source-Variant runner. A valid
asynchronous registration/handler remains a positive control.

## Run

From the workspace root after dependency setup:

```sh
bun test --conditions=@maelstrom-co/source tools/evals-offline
bunx nx run evals-offline:typecheck --skip-nx-cache --skipSync
bunx nx run evals-offline:test --skip-nx-cache --skipSync
bunx nx run evals-offline:check --skip-nx-cache --skipSync
```

`--skipSync` avoids Nx's workspace-wide TypeScript solution-reference rewrites;
these commands still run the actual uncached typecheck/tests/checks. This
composition root's non-composite TypeScript config checks eval source directly
and references the client/Engine/protocol declaration builds. It does not add a
server-library → browser-library dependency. The existing workspace sync report
also requests unrelated docs/www references; this slice does not repair those.

## Read-only inventory

From the workspace root:

```sh
bun --no-env-file --conditions=@maelstrom-co/source tools/evals-offline/inventory-cli.ts
```

The command prints JSON to stdout using the exported current `scenarios` and
`loadOfflineCases()` registry, without executing cases, calling providers or
publishing results. It does not load `.env` files. `inventory.ts` exposes the pure
`buildInventoryReport(scenarios, cases, jsonBackedScenarioIds)` builder separately
from this command. The third input is exported by `core/scenarios.ts` from the
same validated `scenarios/v1/index.json` manifest that supplies the runtime
registry, not inferred from case metadata or a separately maintained ID tuple.
The report lists registered current scenario IDs/count, case/fixture/unique-profile
counts, case-level `definition.scenarioId` rows, distinct linked current IDs,
current IDs without a case-level link, and unknown case-level references.
Fixture counts are distinct referenced fixture IDs; the loader validates that
every indexed fixture is referenced.

Source format is a separate partition of the current scenario IDs:

- `counts.jsonBackedScenarios` is **155**, with sorted `jsonBackedScenarioIds`.
  This includes 152 sibling snapshots and three case-owned snapshots.
- `counts.typescriptBackedNotYetJsonSnapshottedScenarios` is **0**, with empty
  `typescriptBackedNotYetJsonSnapshottedScenarioIds`.
- These disjoint arrays together contain all **155** current IDs. Source-format
  classification means neither “covered” nor “uncovered.” The 155 is an inventory,
  not a coverage total.
- `staleJsonBackedScenarioIds` reports sorted, distinct registry IDs absent from
  the current scenarios (currently empty). They are excluded from both partitions
  and their counts; the builder reports them without throwing.

The runtime manifest supplies source IDs directly; the builder does not parse
source text or auto-migrate scenarios. Source format does not imply a case
link or coverage. Case metadata totals remain separate: **40** cases, **32**
fixtures, **27** profiles, **8** case-level references and **5** linked current
IDs. `currentScenarioIdsWithoutCaseLink` still contains **150** IDs, not a count of
TypeScript-backed or uncovered scenarios.

A `definition.scenarioId` is **metadata only**, not proof that a scenario's
request, catalog or oracle moved, nor proof of coverage or migration completion.
`lineage[].scenarioId` is separate provenance and is excluded from these links.
Multiple cases may reference one scenario; unmapped current scenarios are
informational, not failures. `unknownCaseScenarioReferences` identifies integrity
warnings, not additional current scenarios. The builder reports unknown links
without throwing; the command still uses the existing loader's validation and
may reject invalid case documents before reporting. No legacy row inventory or
historical counts are inferred from these links.

## Contract and ownership

- `evaluateSample` is the shared internal sample lifecycle: preflight, execution,
  immutable evidence checkpoints, scoring, error classification, cleanup.
- Planner and stage adapters wrap exactly one existing turn. Their nested records
  retain local repeat `1`; the outer sample identity is authoritative for repeats
  across invocations. Replay inputs are explicitly the pinned source turn, not a
  claim that each repeat recorded a different upstream result.
- Sessions initialize state on every execution and pass copied history/state
  deliberately. A later failure retains completed turns, not a fabricated
  successful transcript. Construct resource-owning adapters per sample.
- Complete evidence is required to score. Missing/partial evidence and hand-offs
  are unscored; N/A remains N/A. Scorer errors are not task failures. Cleanup
  failure is separate from completed behavioral evidence.
- Evidence correlation uses the outer sample identity plus producer/request
  identity. It does not add IDs to operational telemetry or sum diagnostics as
  provider usage. Missing usage stays absent; explicit zero remains zero.
- Existing planner plugins, CLI record formats and stage/replay checks are
  unchanged. The new schema is internal and provisional, not a public SDK API.

## Scripted candidate through the real Engine

`scripted-variant` uses `scripted-candidate-fixture.ts` and an independent JSON
candidate for the JSON-backed `variant` scenario. Its code-owned profile is restricted
to this pilot. The loaded case supplies the complete request/catalog, `inputs.scenarioTitle`,
optional history and expectations directly; no registry lookup supplies those fields. The unchanged `plannerAdapter`/`runEval` invokes the real Engine,
and the unchanged scenario scorer judges the **shipped** response. Raw candidate
data is retained in a diagnostic record; the observation/turn record contains the
shipped tree, Instances, Execution Plan and score. Tests distinguish an invalid
extra Action removed by the Engine and a repaired tree token from the raw script.

The fake plugin's baseline arm avoids its synthetic staged calls/usage. Model and
fallback calls throw; no provider, staged transport, judge or handler is invoked.
The canonical `scripted-variant.json` now also drives the live scenario registry
through the fail-closed `core/variant-case.ts` loader (`migration: "json-backed"`).
Its full snapshot is intentionally frozen: demo catalog changes require an explicit
case edit. Together with the two planner snapshots below, three current scenarios are
case-owned; the other 152 load from the sibling JSON scenario registry. This is declarative migration,
not planner-quality evidence. Stage and replay contracts are unchanged. Counts of legacy rows and the 155-scenario inventory
remain unchanged; D17/D33/D38/D40/D41 are complete for their declared scopes,
while D39 has an action-backed transition case; D35 has an adjudicated addition case.

## JSON-backed preserve and deferral

`planner-preserve` owns the full `preserve` snapshot; `planner-deferral` owns
`generate-content`. Their canonical JSON drives both the current live registry
and offline execution through `core/planner-case.ts`. Both use shared lossless
request/snapshot primitives with variant and fixed code-owned paths, not dynamic
case-selected files. Missing/malformed identity, request or expectation data fails
closed. Scenario display metadata is explicit (`inputs.scenarioTitle`), separate
from case metadata. Histories remain absent; preserve's existing `spatial: false`
is retained, and generate-content's spatial field stays absent.

Only preserve's planned visible/actions/tree/unchangedTree and the deferred/select
contract are added; no unused expectation language is implemented. `inputs.response`
remains a fixture selector, never an expectation-derived response. The mocked
planner copies the loaded **request** layout and scripted text; it is not an
independent candidate snapshot like variant. Negative controls change expectations
without changing responses, and suppress fixture deferral to fail the expected
select-stage check. The reference tree remains unscored, as before. Replay cases
remain reference controls, with mismatch-invalid/unscored behavior unchanged.
Snapshots deliberately stop automatically tracking demo catalog changes; update
JSON explicitly. No model, provider, judge or handler call is added.

## SDK-neutral publication proof

All forty-three finalized case results also pass through the internal
[`EvaluationResultSink` publication boundary](../../packages/evals/README.md#pluggable-publication-groundwork-offline-only)
to a synthetic in-memory sink. Only reviewed, bounded summaries are selected;
raw observations and recordings are omitted. Identical re-export reuses the
local acknowledgment without running a case again. Publication states are
separate from correctness. This is not a Langfuse adapter, upload, backend
idempotency proof, or durable storage. Concrete SDK/runtime/backend compatibility
and recording/retention policy remain gated. No environment variables initialize
a sink automatically; the caller owns any future SDK lifecycle.

`legacy-history-assistant-injection` adds **COMPLETE D25/T23** `/items/24`
(`cap-history-assistant-message-injection`) at legacy revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`. The dataset has no injected assistant
payload, user-message sequence or turn-specific expected responses. The case
retains the three ordinary Weather user-turn fallback prompts from
`src/tasks/historyAssistantInjection.ts`. Its scope is **scripted ordinary
conversation-history continuity**, not assistant-message injection. Independent
scripted responses preserve the source predicate: turn 0 nonblank text, no
Actions and `weather-main/current`; turn 1 a matching `showHourly`, nonblank
text containing any case-insensitive substring `rain`, `mentioned` or `said`,
and `weather-main/hourly`; turn 2 no Actions and `weather-main/hourly`.
Every response must use tiling. Empty/absent turn-2 text and additional turn-1
Actions pass. The scorer only finds the first matching Instance; it does not
check Vessel identity, exact membership counts, geometry, or snapshot continuity.
The strict harness requires exactly three complete ordered turns; snapshots
record scripted retention, not an additional source-scoring requirement.

A control with turn-0 text `The sky is clear.` and turn-1 text `I like trains.`
passes. This lexical predicate does **not** verify that a model semantically
depended on previous assistant content and does not test prompt injection or
security. **Assistant-message injection and semantic reliance are out of scope**
for the completed ordinary-history contract. The existing session adapter supplies
prior turns; the script uses only their count. Exact provider-input delivery is
verified separately in `packages/evals/src/manual/d25.test.ts`. Legacy profile/file
IDs and exact lineage are retained, not relabeled as injection coverage.
No AI/model/provider/runtime compatibility claim is made. No Engine, model,
provider, judge or Action handler runs; artifacts remain synthetic, legacy-derived
and pending human review.

`legacy-assistant-identity` adds **COMPLETE D02/T24** `/items/1`: three original
dataset prompts, separate scripted responses and declarative identity expectations.
Every turn requires nonblank text, case-insensitive `MAR` inclusion / `Maelstrom`
exclusion, an empty Execution Plan, tiling layout and zero layout Instances.
Substring success is not semantic identity: even `The market is open.` passes.
The declared response predicate is complete. MAR system-prompt delivery is tested
separately in the manual path; this script does not establish semantic identity,
prompt effectiveness, provider behavior or runtime compatibility.

`legacy-assistant-text` adds D03/T01 `/items/2` source exact-text predicate
representation (case-sensitive `trim().split(/\s+/).join(' ')`) and **COMPLETE
D14/T19** `/items/13` nonempty/non-JSON-container evidence. Objects and arrays
fail; primitives, null, malformed JSON and fenced JSON are allowed. Unrelated
`I like trains.` prose passes: semantic refusal and Vessel-orchestration
redirection are outside this complete source text predicate. The separate
user-defined lexical case tests refusal/redirection cues, not semantic judgment.
Two distinct independent synthetic fixtures run through the common session
lifecycle; no provider/model/judge, shared-ai.chat, streaming or runtime
compatibility claim.

`assistant-json-refusal-lexical` adds a separate synthetic/pending-human-review
**user-defined extension** inspired by `/items/13`, with an independent response
fixture and code-owned lexical scorer. It requires raw/arbitrary-JSON refusal cues
and an explicit offer of Vessel-based help, not a bare mention. The accepted
response is a regression example, not an exact-output baseline. Case, whitespace
and apostrophes normalize; whole words match; pure object/array JSON and obvious
code fences fail. Lexical cues are not semantic judgment; embedded/malformed JSON
may escape detection. Text cannot prove no Actions/layout effects: no state-safety
claim. The original D14 source predicate and its empty source phrase constraints
are unchanged. Both predicates are complete for their separately declared scopes;
case review remains pending. No provider/model/judge/API/live invocation.
See the [case contract](../../packages/evals/cases/README.md#complete-user-defined-lexical-json-refusal-and-vessel-help).
Total: 43 cases, 35 fixtures, 30 profiles.
D02/D14/D17/D25/D33/D38/D40/D41 are complete for their declared bounded contracts,
not full legacy equivalence or model-quality coverage. D04–D11 are excluded from
active unification scope; no source-only blocked obligations remain.
See the case contract for scope and evidence.

## Legacy source-obligation accounting

The inventory CLI composes `buildLegacyAccounting` with the existing metadata
report. It loads the strict local [ledger](../../packages/evals/obligations/README.md)
and validates **41** distinct pinned pointers: **32** with bounded case evidence,
**1** with bounded unit-test evidence (D01), **0** source-only blocked,
**8** out-of-scope (D04–D11), **41** accounted, **0** unaccounted. It rejects duplicates, mismatched
lineage, overlap and missing rows. Shared task IDs do not merge pointers, and
multiple cases may legitimately refer to one row. The ledger never creates an
EvaluationResult, profile, fixture or score; this is traceability, not completion.

D04 `/items/3` is `out-of-scope` by user decision: lab-extraction schema and
clean-failure details were missing, and the row is not needed for unification.
Its raw source row, pointer, revision and digest remain unchanged. The CLI lists
it in `legacy.outOfScopeObligations` with its reason and counts it separately in
`legacy.counts.outOfScopeObligations`. It is not active blocked work, case/unit
evidence, a passing result or model-quality coverage.

D05 `/items/4` is also `out-of-scope` by user decision, like D04: no current
Labs extraction API, schema or failure contract was authorized. Its raw source
row, pointer, revision, digest and the 41-row source index are unchanged. The
exclusion adds no schema, error type, provider seam, case or fixture; it is not
unit evidence, a pass or current behavioral coverage.

D06 `/items/5` is `out-of-scope` by user decision, like D04/D05. Review identified
no current Labs S3 job, and the source row specifies no S3 event envelope, batch
result or key parsing/skip contract. Its raw row, pointer, revision and digest
remain unchanged. No S3 handler, batch semantics, case, fixture or score is
invented. All excluded pointers and reasons appear only in the separate
scope-exclusion accounting, not behavioral evidence or passes.

D01 `/items/0` links the existing planner unit test
`packages/planner-llm/src/lib/llm-planner.test.ts` →
`D01 bounded provider-input evidence: sends the system prompt, history, then the user prompt`.
Its unchanged fake-chat assertion proves exact prior user/assistant history
propagation before the current prompt only. No Engine multi-turn session, model
semantic reliance, or unspecified source Turn-2 setup is covered. D01 remains
absent from pinned legacy `TASK_DEFINITIONS`; no runnable case/profile/fixture or
case-v1 registry entry is added. Full semantic/history coverage remains unresolved.

D07–D11 `/items/6`–`/items/10` are `out-of-scope`: the user deferred all
voice/audio-related rows from this task. Their source rows, pointers, revision and
digests remain unchanged, as do existing server-minter and adapter unit tests and
all voice/audio code. D07/D10/D11 are no longer active unit evidence; D08/D09 are
no longer active blockers. These rows appear only in scope-exclusion accounting,
not coverage, evidence or passes. No cases or model/provider evidence are added.

D38's `weather-current-noop-subset` covers only staying current. D40's
`weather-deterministic-cycle` follows dataset hourly→weekly→current instead of
the mismatched historical scorer. D41's `weather-deterministic-return` follows
hourly→current→weekly. The two chains require exact pre-turn-valid Actions and
singleton membership continuity from independent response fixtures, not model,
Engine or handler execution. No source-only blocked obligations remain;
D04–D11 are excluded from active unification scope.

## D39 action-backed transition

`weather-action-backed-transition` requires existing `weather-main`/Weather/current,
the exact source request “Skip to weekly forecast”, matching `showWeekly` on that
Instance and shipped weekly state. Actionless/unrelated-plan jumps and missing or
replaced identity fail. Extra Actions (including conflicts), params, other Instances
and geometry are unscored; this is not whole-response or handler safety. Its shared
response predicate powers the separate one-turn manual Weather selection.

The former D39 blocker misread “without proper transition”: legacy `checkSingleTurn`
permits `showWeekly`, rejecting an empty-plan weekly jump and first-action
`showCurrent`. Matching Action/target is a deliberate strengthening, not exact
scorer equivalence. D40's multi-turn mismatch is separate. See the
[D39 contract](../../packages/evals/cases/README.md#action-backed-weekly-transition-d39).
No provider runs in this offline profile; pending human review is unchanged.

## D35 adjudicated addition

`three-vessel-addition` uses the user-approved Weather-only start and exact three
source prompts. Its independent response fixture adds Labs/trends and
Calendar/month, then navigates Weather/weekly and Calendar/week while preserving
Labs after addition. The same code-owned predicate powers the manual runner.
No creation Action or empty-plan requirement is invented; valid extra
non-transition Actions have unscored parameters/effects, but later Labs-target
Actions are rejected. Catalog snapshots are checked against current demo exports.
See the [D35 contract](../../packages/evals/cases/README.md#user-adjudicated-three-vessel-addition-d35t17).
This replaces only D35's blocked classification, not the pinned dataset row or
historical task. D35 is **COMPLETE only for this adjudicated current contract**
after one fresh post-fix one-shot current-Engine sample passed the unchanged
predicate in three dispatches with empty failures and no retry. Prior failed
reports remain preserved. Case and sample semantic review remain pending, not
user semantic acceptance. One sample establishes no reliability, clinical
data/trend fulfillment or client/handler effects; no source scorer/runtime or
legacy `TASK_DEFINITIONS` equivalence is claimed. Scripted responses remain
synthetic; no provider or client handler runs in this offline profile.

## Still gated / not implemented

This slice does not install or repair the old runtime's manifest/lock mismatch,
port all 29 legacy tasks/41 rows, establish model-quality coverage of the 155
JSON-backed current definitions, or implement the remaining in-scope dataset-only
target D01 beyond its bounded provider-input unit evidence. D04–D11 are explicitly
excluded from unification by the user, with all voice/audio-related rows deferred.
Thirty-two distinct legacy rows have bounded case evidence, D01 has bounded
unit-test evidence, zero remain source-only blocked, and eight are out of scope:
41 accounted, 0 unaccounted. D17 and D33 are complete for declared bounded predicates, not
semantic certification, full T12 compatibility or clinical functionality.
D35's Weather-only start was explicitly approved by the user; its new addition
case preserves Labs from creation onward, not before it exists. The old preloaded
task/scorer remains a distinct historical artifact, not a compatibility target. The four `/items/37`–`/items/40` deterministic-action
rows remain separate despite sharing an ID: D38/D40/D41 have complete bounded cases,
and D39 has a separate action-backed transition case. No ledger entry is executed.
Canonical cases/fixtures belong in the monorepo; the separate archive repo
is deferred and untouched. Beyond the bounded JSON batch, this slice does not implement full canonical case migration,
DevTools draft UI, Langfuse sync, persistence/retention, a whole-run scheduler,
retry/budget enforcement, or label-triggered paid CI. No historical score parity
or human baseline acceptance is claimed.

The five-path acceptance here is an executable contract proof. Broader data and
runtime migration should reuse this lifecycle, not create a competing runner.
