# Canonical case inputs — bounded v1 slice

`v1/index.json` explicitly lists the JSON case files and fixture files used by
`tools/evals-offline`. These definitions drive execution, not just documentation.
They do **not** replace the live planner/stage CLI scenario registry yet.

## Completion scope

**COMPLETE means the declared bounded case predicate is fully encoded and tested.**
It does not mean full legacy-task equivalence, model reliability, semantic judgment,
clinical functionality, or human acceptance. Titles use this convention; completed
profiles that carry `expectations.coverage` require the literal `COMPLETE`.
D35 is `COMPLETE` only for its user-adjudicated current contract after one fresh
post-fix current-Engine sample passed; prior failed reports remain preserved.
Scope limits stay in each purpose and profile description rather than as required unresolved work.
The predicates, source prompts/lineage and independent fixture outputs are unchanged.
`review: pending-human-review` remains independent, as does a run's
`completeness: partial | absent | complete`; incomplete evidence is never promoted.

The authorized closure scope for D02/D14/D17/D25/D33/D38/D40/D41 is complete:

| Contract | Evidence and limits |
| --- | --- |
| D02 identity | Three-turn response predicate; manual tests verify MAR prompt/history delivery; one current-Engine sample passed. No semantic identity reliability claim. |
| D14 text / lexical refusal | Source nonempty/non-container predicate and separate user-defined lexical rubric are tested independently. One earlier response was user-accepted, not all cases or future samples. |
| D17 target exclusion / clarification | Source target-exclusion predicate plus separate manual lexical-question, empty-plan and exact Chart checks; one earlier response was user-accepted. No semantic oracle. |
| D25 ordinary history | Scripted trajectory plus exact ordered provider-input delivery tests and one structural current-Engine sample. Injection robustness and semantic reliance are out of scope. |
| D33 navigation / selection | Two source-prompt predicate, separate synthetic third-turn emission and optional first-marker enum predicates; current demo React/client tests cover handler validation, two-instance isolation and remount/Variant selection persistence. One current-Engine sample passed; its third prompt is synthetic and it did not execute handlers. No clinical trend data or reload durability. |
| D38 / D40 / D41 Weather | Stay-current branch and the two distinct exact trajectories; manual tests and one current-Engine sample per row. Option-offering semantics, handler effects and reliability are not claimed. D40 intentionally follows dataset order, not the mismatched old scorer. |

Offline case results are still synthetic harness evidence. Separate manual samples
and app integration tests do not retrospectively turn those results into live or
handler-execution evidence. D01 remains a bounded unit-evidence ledger row,
not a runnable case. No source-only blockers remain; D04–D11 are explicitly
out of unification scope by user decision, with their raw rows retained. All 41 rows
remain accounted for; exclusions are not evidence or passes.

## What is represented

| Case | Execution / lineage | Status |
| --- | --- | --- |
| `three-vessel-addition` | D35/T17, `/items/34`, user-adjudicated Weather-only start | COMPLETE only for adjudicated current contract; one fresh post-fix current-Engine sample passed; semantic review pending |
| `cross-vessel` | D36/T16, `/items/35`, hourly Weather, Labs introduction, weekly Weather with Labs/trends unchanged | Dataset-aligned response-only correction; no creation or handler-effect proof |
| `multivessel-add-instance` | D34/T15, `/items/33`, fresh Calendar plus same-response Action target, then Calendar/month | Strengthened identity/preservation; no Action effects or client-order proof |
| `history-assistant-injection-subset` | COMPLETE D25/T23, `/items/24` | Scripted ordinary conversation-history continuity only; assistant-message injection out of scope |
| `assistant-identity-subset` | COMPLETE D02/T24, `/items/1` | Three-turn identity-response predicate only; prompt delivery tested separately; semantic identity reliability not claimed |
| `assistant-exact-text` | D03/T01, `/items/2` | Source exact-text predicate represented; no shared-ai.chat/streaming/runtime claim |
| `assistant-json-refusal-lexical` | User-defined synthetic D14-inspired extension, `/items/13` | Lexical raw/arbitrary JSON refusal and explicit Vessel-help cues only; not semantic judgment or state-safety evidence |
| `assistant-non-json-subset` | COMPLETE D14/T19, `/items/13` | Nonempty/non-container subset only; semantic refusal/redirection not claimed; lexical rubric separate |
| `grid-no-overlap` | D13/T21, `/items/12`, five known positions within a 12×16 Chart without overlap | Synthetic cell-allocation checks; no compactness or minimum-size claim |
| `tiling-tree-validity` | D12/T20, `/items/11`, retain Weather/current and add visible Labs/trends | Strict current-format binary subset; not depth or runtime parity |
| `tiling-add-vessel` | D37/T22, `/items/36`, retain Weather/Labs and add visible Calendar/month | Strict current weighted-tree harness; not runtime repair/geometry evidence |
| `weather-action-backed-transition` | COMPLETE D39, `/items/38`, existing current→weekly with matching `showWeekly` | Actionless/unrelated-plan jumps fail; extras/params/geometry unscored; pending review |
| `weather-current-noop-subset` | COMPLETE D38, `/items/37`, stay current without Actions | Stay-current branch only; no option-offering semantics |
| `weather-deterministic-cycle` | COMPLETE D40, `/items/39`, hourly→weekly→current | Dataset trajectory; legacy scorer mismatch explicitly retained |
| `weather-deterministic-return` | COMPLETE D41, `/items/40`, hourly→current→weekly | Exact pre-turn-valid Actions and membership continuity, not handler effects |
| `weather-weekly` | D15/T28, `/items/14`, existing weather transition | Synthetic legacy-derived harness |
| `weather-delayed-action` | D32/T11, `/items/31`, two current no-ops then a required weekly Action | Intent-preserving corrected synthetic trajectory |
| `weather-chain` | D31/T10, `/items/30`, sequential hourly/weekly/current state | Synthetic legacy-derived harness |
| `weather-reuse-weekly` | D22/T14, `/items/21`, four-turn weekly change and later panel reuse | Narrow synthetic trajectory harness; distinct from `weather-chain` |
| `target-disambiguation` | D24/T13, `/items/23`, delayed Weather change with Calendar preservation | Strengthened synthetic structural trajectory; no language-understanding claim |
| `no-dual-target-plan` | D17/T02, `/items/16`, ambiguous weekly request | Complete target-exclusion predicate; semantic clarification and whole-response safety not claimed |
| `labs-state-reset-subset` | D33/T12, `/items/32`, two supplied list→trends requests only | Complete two-prompt predicate; not full T12/F03a compatibility |
| `labs-state-reset-optional-enum` | COMPLETE isolated D33 third-prompt enum subpredicate, `/items/32` | Existing synthetic prompt; optional first match only, no reset execution or marker-state evidence |
| `labs-state-reset-synthetic` | Separate D33-origin synthetic third-turn marker request, absent from `/items/32` | Exact scripted navigation/marker emission and layout-membership continuity only; optional enum-safety in a separate case |
| `labs-multi-marker-final` | D30/T09, `/items/29`, final-turn exact-set `selectMarkers` Action | Synthetic F03b timing correction; no whole-plan or marker-state guarantee |
| `labs-select-marker` | D23/T07, `/items/22`, turn-1 marker Action and trends/no-navigation on turns 0/2/3 | Synthetic source-scoring trajectory; no marker-persistence guarantee |
| `calendar-week-nav` | D29/T08, `/items/28`, weekly Action, weekly no-op, monthly Action | Synthetic source-scoring round trip |
| `calendar-week` | D26/T26, `/items/25`, `showWeekly`: month → week | Synthetic legacy-derived navigation harness |
| `weather-hourly` | D27/T29, `/items/26`, `showHourly`: current → hourly | Synthetic legacy-derived navigation harness |
| `labs-upload` | D28/T27, `/items/27`, `showUpload`: trends → upload | Synthetic legacy-derived navigation harness; no file upload |
| `invalid-action` | D18/T04, `/items/17`, source-Variant Action safety and state preservation | Synthetic response-constraint harness |
| `wrong-enum` | D19/T05, `/items/18`, every `selectMarker` must use an allowed `markerSlug` | Negative enum safety only; absence of selection is valid |
| `noop-preservation` | D20/T18, `/items/19`, empty plan and unchanged initial state | Synthetic response-constraint harness |
| `out-of-scope-no-mutation` | D21/T03, `/items/20`, no Actions and exact unchanged Instance/tiling membership | Synthetic structural no-mutation only; not semantic refusal |
| `client-order` | D16/T25, `/items/15`, plus `create-configure` | Composed harness: actual headless client effects, not a port of either whole source case |
| `scripted-variant` | JSON-backed current `variant`, real Engine with independent candidate JSON | Full frozen request/catalog/expectations pilot; no model or planner-quality claim |
| `planner-preserve`, `planner-deferral` | `preserve`, `generate-content` | JSON-backed full snapshots with a mocked planner; response copies request layout, not expectations |
| `stage-handoff`, `stage-bound`, `stage-not-applicable` | `enum-route-short-name`, `ns-weather-somewhere` | Reference-backed scenarios with scripted stage transport |
| `replay-compatible`, `replay-incompatible` | `preserve`, `variant` upstream request | Reference-backed replay controls; mismatched source request correctly returns invalid/unscored |

Forty-three case records use thirty code-owned profiles, extending the original five-path
slice with navigation, response-constraint, Weather-reuse, Labs-selection,
target-isolation, bounded no-dual-target-plan, delayed-action, Calendar-round-trip, final multi-marker, bounded Labs list→trends subset, separate synthetic post-reset marker emission and isolated optional first-marker enum, multivessel addition, cross-Vessel isolation, tiling-addition, binary-tree, grid-allocation, bounded assistant-identity, bounded ordinary conversation-history, and COMPLETE D14 lexical-refusal profiles. Thirty-five fixture
files are indexed. Neither legacy-derived data nor a mock response
proves installed `engine-old` compatibility. The client case
keeps two distinct assertions: preserve the source-Variant handler and make a
new Instance available before its Action. Referencing a scenario does not migrate
its request/catalog/oracle out of TypeScript.

### COMPLETE user-defined lexical JSON refusal and Vessel help

`assistant-json-refusal-lexical` is a separate synthetic/pending-human-review
user-defined extension, COMPLETE for its declared lexical rubric, inspired by D14/T19 `/items/13`, not a replacement of
`assistant-non-json-subset`. The source phrase constraints were empty; its original
predicate and fixture are unchanged. Each case is complete for its own scope.

The new code-owned profile/scorer checks nonempty text, rejects pure JSON objects
and arrays and obvious backtick/tilde code fences, and independently requires:
- a refusal cue directly linked to providing/returning raw or arbitrary JSON;
- a whole-word Vessel/Vessels mention;
- an explicit first-person offer to help/present/show/display information through,
  using, via, in or with Vessels, or through “it” after an add/register/provide-a-Vessel
  condition in the same sentence. A bare mention is insufficient.

Matching normalizes case, whitespace and curly/straight apostrophes, with whole-word
cues and bounded within-sentence help links. The independent response fixture is
a synthetic regression example derived from one user-accepted response, **not an
exact-output baseline**, repeated live sample, model or judge result. Requests and
expectations never generate fixture output. No provider, API or live invocation runs.

Lexical cues are not semantic judgment: negation, quotation or other wording can
fool them, and valid paraphrases outside the cue vocabulary may fail. Embedded or
malformed JSON may escape detection. Text cannot prove absence of Actions or layout
effects; the empty session state is not state-safety evidence. Semantic refusal
and Vessel-orchestration understanding are not certified by either text predicate.

### Assistant-text predicates (D03/T01 and COMPLETE D14/T19)

Two distinct cases and independent single-response fixtures use the strict
`legacy-assistant-text` profile and existing common session lifecycle. Both retain
exact legacy lineage at revision `d6ef99aacb8ebce4d707d54fee14149daeea552d`,
`synthetic: true`, `legacy-derived-harness`, and `pending-human-review`.
Original user messages are copied as evidence, not interpreted. Bounded raw
assistant text (at most 2000 characters) is required; missing/malformed evidence
fails closed. Expectations never manufacture candidate outputs.

- `assistant-exact-text`: D03/T01 `/items/2`, `cap-ai-chat-single-message`.
  The **source exact-text predicate is represented**: both actual and legacy
  expected `HELLO_MAELSTROM` use `trim().split(/\s+/).join(' ')`, case-sensitive.
  Normal whitespace passes; changed case, punctuation, extra prose and empty
  text fail. This does **not** establish `shared-ai.chat`, streaming or runtime
  compatibility. The source's missing-expectation fallback is not exposed.
- `assistant-non-json-subset`: **COMPLETE D14/T19** `/items/13`,
  `cap-maelstrom-structured-view-model-validity`. Only nonempty normalized text
  and the source `isJsonObjectLike` container exclusion are represented. Parsed
  objects and arrays fail; JSON primitives, `null`, malformed JSON and fenced
  JSON pass when nonempty. The source row has empty required phrase groups.
  Its success reason is not a semantic refusal classifier. The independent
  candidate `I like trains.` passes, deliberately demonstrating the gap.
  **Semantic refusal and Vessel-orchestration redirection are outside this
  predicate.** Its strict completion metadata does not strengthen this weak
  source rule or turn it into the separate lexical rubric.

No Engine, provider, model, judge or handler runs in these assistant predicates.
Declared-scope completion does not claim full migration. D04–D11 are user-excluded
from unification, not resolved implementations.
D25 is scoped to ordinary history, not injection robustness. Counts are 43 cases,
35 fixtures, 30 profiles, 32/41 legacy rows with bounded case evidence,
1 bounded D01 code-unit row, 0 source-only blocked obligations and
8 out-of-scope D04–D11 rows (41 accounted, 0 unaccounted); the 155 current-scenario
inventory is unchanged.

D01 has only [bounded current planner unit evidence](../obligations/README.md#d01-bounded-current-unit-evidence),
not a case-v1 entry, Engine multi-turn session or semantic history coverage.
The user deferred all voice/audio-related rows D07–D11 from this task. Their
source rows and digests, existing unit tests and adapter code remain unchanged.
D07/D10/D11 are no longer active unit evidence; D08/D09 are no longer active
blockers. All excluded rows are accounting only, not coverage, evidence or passes.
See the [ledger](../obligations/README.md).

### COMPLETE ordinary conversation-history continuity (D25/T23)

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

### COMPLETE assistant identity-response predicate (D02/T24)

`assistant-identity-subset` uses one strict `legacy-assistant-identity` profile
and an independent three-response fixture through the existing session adapter.
Exact lineage is `/items/1`, `reg-maelstrom-multiturn-assistant-identity-consistency`,
revision `d6ef99aacb8ebce4d707d54fee14149daeea552d`; it remains synthetic,
`legacy-derived-harness` and `pending-human-review`. All three dataset user
prompts are retained in order, separately from the response script and declarative
expectations (`MAR`, `Maelstrom`, three turns, empty Execution Plan, tiling,
zero layout Instances). No response is generated from a prompt or expectation.

Each complete turn requires nonempty `assistantText.trim()`, a case-insensitive
`MAR` substring and no case-insensitive `Maelstrom` substring, no Actions, tiling
layout type and zero layout Instances. Missing/malformed evidence fails closed;
this bounded projection requires exactly three turns and does not score tree
geometry. `The market is open.` and `I am not MAR.` pass intentionally: this is
not a semantic identity classifier or evidence of memory across model turns.

The source task replaces the default identity with MAR via a system-prompt
override. The separate manual path tests that prompt delivery and retained history,
and one current-Engine sample passed. This offline response predicate applies no
system prompt; semantic identity persistence, prompt effectiveness, provider behavior
and runtime compatibility are not established by its completion metadata.

### JSON-backed planner snapshots (`preserve`, `generate-content`)

`planner-preserve.json` and `planner-deferral.json` now own the complete current
Scenario snapshots, rather than resolving request/expectations from TypeScript.
Both store the full 30×18 ChartRequest/catalog, distinct `inputs.scenarioTitle`,
and exact expectations. Preserve retains its planned visible/actions, reference
tree, `arrangement: [{kind: "unchangedTree"}]`, and existing `spatial: false`.
Generate-content retains `status: "deferred", deferStage: "select"`; spatial
and both histories stay absent. The unchanged scorer does not score the reference
tree itself: `unchangedTree` compares the shipped layout with the request.

`core/planner-case.ts` uses shared lossless snapshot primitives with the variant
loader, fixed code-owned paths and strict per-case identities/lineage. Only these
bounded expectation branches are supported; asks/gates/other predicates are not
silently accepted or projected. Malformed/missing snapshots fail closed. The live
registry and offline composition consume these same canonical definitions; a
loaded temporary case is never silently replaced with the global registry value.
Frozen catalogs require explicit updates when demo definitions change.

`inputs.response` is still an independent fixture selector (`preserve` or `defer`),
not a Scenario field or something generated from expectations. Existing mocked
planner behavior copies the selected **request** layout and uses `planner-script`
text. Unlike variant, these cases do not contain an independent candidate snapshot.
Expectations never supply responses. Replay-compatible and replay-incompatible
remain reference controls; the mismatch still fails preflight as invalid/unscored.
All 155 Scenario values/order are preserved: these three are case-owned; the
other 152 are JSON-backed by the [sibling scenario registry](../scenarios/README.md).
This is definition migration, not new model or runtime-quality evidence.

### Scripted current candidate (`variant`)

`scripted-variant` is the **JSON source of truth** for current scenario `variant`,
not merely a reference. Its `inputs.scenarioTitle` retains the original scenario title; `inputs.request` contains the full
ChartRequest/catalog/layout; absent `history` and `spatial` remain absent, while
its `expectations` contains the entire current planned/visible/actions contract.
The top-level `scenarioId`/`suite` supplies the remaining Scenario identity. The
case's display title remains distinct from the scenario title.

`core/variant-case.ts` validates this `migration: "json-backed"` variant contract and
loads the fixed canonical path into `scenarios`/`selectScenarios`, replacing the
TypeScript `planned('variant', ...)` entry. Invalid or missing JSON, mismatched
case/scenario/profile/fixture IDs, missing lineage, malformed ChartRequests and
unsupported expectation fields fail closed; protocol parsing cannot silently
strip snapshot fields. The offline adapter constructs its Scenario directly from
the loaded case, not the global registry. Code owns profiles, execution and
scoring. Together with preserve and generate-content above, three scenarios are
case-owned; the other 152 have separate JSON snapshots in `scenarios/v1`, not
additional offline cases or fixtures.
Future demo/catalog changes require an explicit snapshot update rather than
silently changing this case.

The dedicated `scripted-candidate` profile is allowlisted for this pilot only. Its fixture independently declares a bounded
tiling `PlannerCandidate`, including `weather-main/showWeekly`, weekly Weather,
the three visible leaves and all five retained Instances. It is never generated
from `scenario.expected` or substituted as a scored response.

Composition uses the existing fake plugin's **baseline arm**, through the unchanged
`plannerAdapter` → `runEval` → real `engine.handle` → existing `scoreResponse` path.
No model, provider, judge, staged transport or Action handler runs. The model and
fallback adapters throw if invoked. The baseline arm emits no synthetic stage-call
usage; `llmCalls` is empty and staged/fake-call/grader fields are absent. Engine
wall-clock timing is local harness timing, not provider performance.

Each result retains the raw candidate in a diagnostic evidence record with producer
`scripted-candidate`; its observation and turn record are the Engine's shipped
`RunRecord` (tree, Instances, Execution Plan, existing scenario score). An invalid
extra Action can make the raw candidate fail the scenario oracle while the Engine
removes it and the shipped result passes. A repaired weight token likewise remains
visible in raw evidence alongside its repaired shipped tree. Wrong/missing required
Actions fail the existing shipped-response scorer. Engine healing does not promise
to repair every defect: a declared Variant inconsistent with the shipped plan can
remain and fail the existing invariant. No new scenario assertion is added.

Candidate validation uses strict bounded model-output fields: 20 Actions/Instances,
256 tree tokens of at most 256 characters, 120-character identities/names,
2000-character messages/rationale and 4000-character `paramsJson`, also subject to
the protocol's byte bound. Protocol parsing supplies branded identities and token
syntax; semantic Action validity and tree repairs remain the Engine's responsibility.
Grid candidates, unknown fields/profile names and unsupported expectations fail
closed. Known expectation values are JSON-owned and independently drive scoring;
tests change those values and catalog data without changing the candidate. The
checks remain synthetic and pending human review: migrating one scenario's data
does not establish planner understanding or broad coverage. No case, fixture,
profile or legacy-row count changes; all 155 current definitions are now JSON-backed,
without changing the declared scopes or source-only blockers below.

### Complete bounded Weather predicates (D38, D40, D41)

All three preserve exact dataset prompts and distinct pointers at pinned revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`, despite their common task ID.
`weather-current-noop-subset` uses the existing `legacy-response-constraint`
`no-op` rule and separate `weather-current-noop-state` fixture. It checks empty
Actions, nonblank text and unchanged represented Instance state. The scripted
response is authored in case inputs, independently of expectations, following
that profile's existing contract. Geometry and option-offering prose are unscored;
this is only the **stay-current branch** of `/items/37`, not full D38 semantics.

`weather-deterministic-cycle` (`/items/39`) requires `showHourly`, `showWeekly`,
`showCurrent`, with current→hourly→weekly→current. This intentionally follows
the explicit dataset rather than `checkMultiTurn`'s hardcoded
hourly→current→weekly output sequence; historical scorer drift remains recorded.
`weather-deterministic-return` (`/items/40`) requires `showHourly`, `showCurrent`,
`showWeekly`, with current→hourly→current→weekly. Both reject missing/extra,
mis-targeted, parameterized or conflicting Actions, strengthening the old scorer,
which permitted empty plans. Every Action is checked against the **incoming**
Variant, not the resulting one.

The new `legacy-weather-transition-chain` profile requires exactly three complete
ordered prompt/index observations, singleton `weather-main/Weather` membership,
preserving layout type and identity: each output must be tiling with the
expected Variant, each incoming snapshot must carry the prior Variant, and the
retained snapshot must equal the response. This is membership continuity, not
split-tree geometry or runtime effects. Evidence is bounded to 20 Instances and
20 Actions per response; unexpected fields fail structural validation. Independent
fixture JSON supplies initial current state and all responses; no expected result
is substituted as observation. Tests change scripts independently and expose the
D38 prose limit. Each declared predicate is complete; fixtures remain synthetic
and pending human review. No Engine, provider, model or handler runs. D39 `/items/38`
has a separate one-turn action-backed predicate, not another alias for either chain.

### Action-backed weekly transition (D39)

`weather-action-backed-transition` retains `/items/38` and the exact request
“Skip to weekly forecast”. Initial state is only `weather-main`/Weather/current.
The source says “without proper transition”: legacy `checkSingleTurn` explicitly
permits `showWeekly`, rejects a weekly layout with an empty Execution Plan, and
rejects first-action `showCurrent`. The current Weather catalog likewise declares
current → `showWeekly` → weekly. This corrects the previous blocker interpretation;
it does not call that single-turn scorer stale or transfer D40's multi-turn mismatch.

The bounded predicate requires a matching `weather-main/showWeekly` and exactly
one protected `weather-main`/Weather/weekly snapshot in the tiling response.
Missing/replaced/duplicate protected identity, wrong Vessel/Variant, an empty plan,
or an unrelated nonempty plan fail. Requiring the matching Action/target and unique
protected identity strengthens the old scorer; this is not exact scorer parity.
Extra Actions (even conflicting ones), arbitrary bounded JSON parameters, unrelated
Instances, prose and tree geometry are deliberately unscored. Passing does not
certify the entire Execution Plan or effects. Initial and retained projections must
be present and consistent, but do not prove client application.

The independent response fixture is synthetic; expectations never manufacture it.
COMPLETE means this declared predicate is encoded and tested, not a live/model,
handler, reliability or semantic result. Case review remains pending. The manual
Weather runner uses the same response predicate, validates the incoming catalog
transition, and permits at most one dispatch for separately selected `--case D39`.
No live D39 sample was made during implementation.

### Transition batch (D26–D28)

The `legacy-vessel-transition` profile uses a JSON navigation table, initial
Instance snapshots, an explicit scripted Action/target, and separate expectations.
The table determines the executed destination; the oracle never supplies it.
Calendar deliberately keeps legacy `showWeekly` and Variant `week`, distinct from
Weather's `weekly` and the current demo's `showWeek` spelling. Labs fixtures contain
only navigation Actions, not parameterized marker selection or extraction/upload
logic. The original request text is retained as turn evidence, **not interpreted
by a model**. These are synthetic transition/oracle proofs, not live planning,
client Action application, layout geometry, or complete legacy request fixtures.

The oracle strengthens the old response-presence checks: one expected Action on
the existing target, matching response and retained post-turn state, no extra or
missing Instances, and no changes to represented non-target Instances. Canonical
fixtures start with one Instance; regression controls add an unrelated Instance
and inject lost/changed state, duplicate or wrong Actions, target/Variant errors,
and missing evidence. Reordering Instance snapshots and consistent ID renaming
are harmless. Fixtures reject duplicate definitions, dangling transitions,
invalid initial states and unavailable source-Variant Actions before execution.
All three cases remain `pending-human-review`.

### Response-constraint batch (D18–D21)

`legacy-response-constraint` copies an explicitly scripted response from JSON
inputs into session evidence; it does not interpret the request with a model or
execute any Action. Fixture JSON declares the initial Instance snapshots and
Weather source-Variant Action names or Labs enum values. Expectations select only
one of four code-owned rules, independently of that scripted response:

- D18 `valid-actions-preserve-state`: every Action must exist on its target's
  initial/source Variant, with all represented Instance identities and Variants
  preserved in response and retained state. A tiling layout projection must also
  contain exactly those Instances and unchanged state; missing/non-tiling layout,
  missing/replaced/duplicate Instances and changed Variants fail independently
  of the top-level response. This intentionally strengthens the old global
  Action-name whitelist and conditional layout/Instance-presence check. The
  bounded projection covers layout type and Instance state, not tree geometry,
  Action effects, or sequential navigation. Layout is optional and unscored by
  D19/D20; their rules are unchanged.
- D19 `marker-enum`: **every** `selectMarker` must have a string `markerSlug`
  in `hemoglobin`, `platelets`, or `glucose` for the source fixture. Unlike the old
  first-match check, valid-first/invalid-second fails. Absence of `selectMarker`
  is a valid negative-safety pass; unrelated Actions are outside this rule. This is not
  positive marker-selection, target correctness, reply-quality, or state-preservation
  evidence. Missing/non-string parameters on a matching Action fail.
- D20 `no-op`: no Actions, exactly the initial Instance identities/Vessels/Variants
  in response and retained state. D18/D20 also retain the source nonempty-reply
  check; that check does not establish semantic refusal or answer quality.
- D21 `no-op-tiling`: empty Execution Plan, nonblank assistant text, exactly the
  initial Instance identities/Vessels/Variants in response and retained state,
  and a required tiling layout projection containing exactly that initial set.
  Missing/malformed/non-tiling layout and missing/replaced/extra/duplicate or
  mutated members fail independently of correct top-level state. D20 `no-op`
  still passes without layout; its semantics are unchanged.

D21 retains the exact prompt `Book a flight to New York based on the weather`
from `cap-maelstrom-conv-refusal`, `/items/20`, T03, at the pinned legacy revision.
The source `evals/src/tasks/convRefusal.ts` starts with one `weather-main`
Weather/current Instance in tiling layout. It rejects Actions, a missing layout
member, a non-current Variant and blank assistant text; its success reason
`out_of_scope_refused` is not a semantic classifier. The new rule deliberately
strengthens that scorer with tiling type and exact membership/count checks. It
is **synthetic structural no-mutation evidence**, not an exact scorer port,
semantic refusal, answer quality, or model understanding. The scripted response
`The weather is 72 degrees.` is explicitly non-refusal text and passes; controls
also accept arbitrary nonempty non-refusal text. No refusal success is claimed.

Canonical responses contain no Actions and invented replies. Profile schemas
reject missing response fields rather than turning absence into an empty success.
Output mutations test faulty Actions, enum values, dropped/replaced/duplicated
Instances and lost retained state. Partial/absent evidence is unscored. Allowed
Instance ordering/consistent renaming is tested independently. Changing a JSON
response, rule, or fixture contract changes observed evidence or the verdict;
expectations never manufacture a successful response. All four cases remain
`legacy-derived-harness` and `pending-human-review`, not installed `engine-old`
compatibility or a full port of the original request/catalog/layout contracts.

### Weather reuse (D22/T14)

`weather-reuse-weekly` represents `/items/21`, not the already indexed D31/T10
`weather-chain` at `/items/30`. Its separate `legacy-weather-reuse` profile retains
all four original request texts in order. Fixture JSON supplies initial state and
four scripted responses; case expectations independently declare the target and
fixed `showWeekly`/`weekly` constraint. Neither expectations nor prompt text generate
responses. The session carries copied state/history and resets for every sample.

The code-owned oracle is a **narrowed synthetic trajectory contract**:

- Turn 0 accepts unchanged `current` with no Action, or one `showHourly` Action
  and `hourly` state. It rejects premature weekly state. These alternatives are
  not a complete semantic rubric for “more detail.”
- Turn 1 requires `showWeekly` on the original target and `weekly` state.
- Turns 2 and 3 preserve the same single weekly Instance. Empty plans are valid,
  not mandatory; nonempty same-target plans also pass this structural constraint.
- Every turn rejects foreign Action targets, requires exact original Instance
  identity/Vessel and tiling membership, and checks pre-state continuity plus
  response and retained state, including final retained weekly state. Added,
  missing, replaced or duplicated Instances fail. Missing/malformed evidence
  never becomes an empty successful result; exactly four turns are required.

The source deterministic scorer omitted some decisive-turn membership and later
Variant checks; this oracle makes those source-intended constraints explicit.
The source LLM judge's guidance informs the documented trajectory only: no LLM
judge is executed or represented as a deterministic semantic score. In particular,
same-target late Actions are **not** validated or applied; a structurally passing
plan does not certify Action validity/effects. Layout evidence is a bounded
type/Instance projection, not tree geometry. This case does not establish answer
quality, prompt interpretation, planner understanding, complete source migration,
or installed `engine-old` compatibility. It remains `legacy-derived-harness` and
`pending-human-review`. Controls cover both initial alternatives, decisive timing,
weekly regression, exact membership, missing evidence and state retention, and
mutate JSON requests/observations/expectations independently.

### Labs marker Action emission (D23/T07)

`labs-select-marker` retains the four original prompts and `/items/22` lineage for
`cap-maelstrom-multiturn-labs-select-marker`. Its `legacy-labs-select-marker`
profile copies independent fixture responses through the common session lifecycle.
The expected target and marker slug do not generate those responses. D19
`wrong-enum` remains a separate negative enum-safety case that permits no selection;
D23 requires a matching selection Action at the decisive turn.

The dataset says **“final response selects”** and labels its pattern “multi-turn
understanding, single final-response grading,” but the task's operational scorer
checks `selectMarker(hemoglobin)` at index **1**, matching “Use hemoglobin.” This
case preserves that source timing, not a literal final-turn Action requirement.
The task has no LLM judge; these scripted prompts are not interpreted by a model.

| Turn indices | Scored response evidence |
| --- | --- |
| 1 | At least one `selectMarker` on `labs-main` with string `markerSlug: "hemoglobin"` |
| 0, 2, 3 | Tiling layout, exactly one member named `labs-main` in `trends`, and no `showUpload` or `showList` Action on any target |

This deliberately does **not** import D22's stronger all-turn rules. On turn 1,
layout type/membership, navigation and additional Actions are unscored. On other
turns, non-forbidden Actions may target another Instance or select another marker;
Vessel ID is structurally present but not compared by the source scorer. A later
`selectMarker(glucose)` passes this limited rule: **retained hemoglobin selection
is not proven**. State snapshots are copied and structurally validated, but their
semantic continuity and retained marker state are not scored. Canonical fixtures
start with one Labs/trends Instance; observations carry only a layout membership
projection and Execution Plan (parameters project `markerSlug`), not selected-marker
props, geometry, assistant text, or full protocol responses.

The bounded harness requires exactly four complete ordered turns and validates
prompt/index identity and evidence shape before semantic checks. The old scorer
only required at least four turn responses; this is not an exact whole-scorer port.
Controls reject missing/wrong turn-1 Actions, targets and slugs, final-turn-only
selection, and layout/navigation violations on turns 0/2/3. Other controls
explicitly accept later conflicting selection, foreign non-navigation Actions,
turn-1 grid/navigation evidence and semantically changed state snapshots to expose
what is **not** checked. Missing/malformed evidence fails closed. JSON mutations
show that changing the expected slug changes the verdict without changing responses.

The case remains synthetic, `legacy-derived-harness`, and `pending-human-review`.
It proves only the source-scoring trajectory, not complete final-response correctness,
marker persistence, semantic understanding, answer quality, handler execution,
extraction/upload, layout geometry or installed `engine-old` compatibility.

### Calendar addition with a same-response Action target (D34/T15)

`multivessel-add-instance` retains `/items/33` lineage for
`cap-maelstrom-multivessel-add-instance` and both supplied prompts:

1. “I want to see my calendar alongside the weather.”
2. “Show the monthly view.”

The legacy builder extracts these messages. Its unrelated fallback about Labs and
hemoglobin is not used by this dataset row and is not added to the case. Initial
context contains only `weather-main`/Weather/current; Weather, Labs and Calendar
are registered. Independent JSON scripts supply the two observations; expectations
never generate their layouts or Actions.

The `legacy-multivessel-add-instance` profile intentionally strengthens identity
and preservation: the old scorer checked only the Weather ID's presence, not its
Vessel or Variant, and did not require a fresh Calendar ID or the same Calendar
on the second turn. Here the first matching original Weather ID must remain
Weather/current in both tiling response layouts. A selected Calendar ID must be
absent initially, appear as Calendar on turn 0, have some same-response Execution
Plan step targeting it, and appear as the same Calendar in `month` on turn 1.
`calendar-added` is a synthetic choice, not a historical executable requirement
(the dataset prose mentions `calendar-main`, but the old scorer does not fix it).

This is not an exact-two-membership oracle. First-match behavior is deliberate:
extra or duplicate members, including other Calendar Instances, are unscored;
a wrong first protected match still fails even if a later duplicate is correct.
Turn-0 Calendar Variant is unrestricted. Action names and parameters are unscored,
as is the entire turn-1 plan. The canonical script's `showWeekly`/week and final
empty plan are fixture choices, not requirements or handler-execution evidence.
Bounded arbitrary JSON parameters are allowed, including unrelated keys, arrays,
and semantically invalid values. Bounds are four collection levels, 20 entries
per collection, 1000-character strings and 1–120-character object keys; plans
and layout membership have at most 20 entries. Outer fields remain strict.

Exactly two complete ordered snapshots are required. Pre-/retained-state snapshots
are structurally required but semantically unscored. Layouts project only type and
Instance metadata, not trees, visibility, adjacency or rendered geometry. The
case proves neither Action correctness/effects nor actual layout-before-execute
ordering. D16's real headless client-effect control remains separate, as does
D37's strict tree/visibility addition with no Action requirement. No Engine,
provider, judge or handler runs here. This synthetic `legacy-derived-harness`
case remains `pending-human-review`, not runtime compatibility or full migration.

### Complete no-dual-target-plan predicate (D17/T02)

`no-dual-target-plan` preserves `cap-maelstrom-conv-clarification` at dataset
`/items/16`, revision `d6ef99aacb8ebce4d707d54fee14149daeea552d`, and the exact prompt
`Switch to the weekly view`. Source context is `weather-main`/Weather/current and
`calendar-main`/Calendar/month. The dataset expected rule only says not to mutate
both Vessels for ambiguous commands. The legacy deterministic scorer first rejects
an Execution Plan containing both IDs, then separately uses a weak lexical
question/clarification heuristic. This bounded case retains only that first
predicate and deliberately discards the lexical heuristic.

Code-owned `legacy-no-dual-target-plan` fails iff the complete Execution Plan
contains both `weather-main` and `calendar-main`. Either order, intervening targets
and repeated entries still fail. Empty plans, either protected target alone or
repeated, and unrelated targets alone or mixed with one protected target pass.
Action names and bounded JSON parameters are semantically unscored. Question or
clarification text cannot rescue a dual-target plan; arbitrary non-clarification
text, including empty text, does not change a passing predicate. The independent
canonical script says `I like trains.` and supplies an empty Execution Plan;
expectations never generate observations.

Exactly one complete bounded response projection is required, with assistant text
and a required Execution Plan array (at most 20 entries). Missing or malformed
projection evidence fails; absent/partial lifecycle evidence remains unscored,
never a pass. No missing array defaults to empty. The projection deliberately has
no layout state; source/pre-/retained-context snapshots are not preservation
assertions. Layout effects, handler effects and assistant text semantics are not
scored. This is **not** clarification success, answer quality, layout safety,
whole-response safety or a “no-double-mutation” proof. No Engine, provider, judge,
handler or legacy runtime executes.

The case is `synthetic: true`, `migration: "legacy-derived-harness"`, and
`review: "pending-human-review"`. **The target-exclusion predicate is complete**;
semantic clarification and whole-response safety are not certified by it. The
separate manual path checks a lexical question, no Actions and exact Chart equality;
one earlier response was user-accepted, not future runs. D39 has an action-backed transition case; D35 has an adjudicated addition case.

### Complete two-prompt Labs list→trends predicate (D33/T12)

`labs-state-reset-subset` completes its **declared two-prompt predicate**, not full
legacy T12 compatibility. It preserves revision `d6ef99aacb8ebce4d707d54fee14149daeea552d`,
`/items/32`, task/dataset `cap-maelstrom-multiturn-state-reset`, and exactly:

1. “Show me the list of my lab results.”
2. “Go back to the trends chart.”

The legacy builder uses these two prompts unchanged, but the deterministic scorer
requires at least three turns and extra third-turn marker-validity behavior (F03a).
No third dataset prompt is invented here. Third-turn behavior is outside this
two-prompt contract. The separate
[isolated enum slice](#complete-isolated-optional-marker-enum-slice-d33) represents
only that subpredicate with the existing synthetic prompt, not a recovered dataset
turn. Full state-reset coverage is not claimed, nor is positive marker selection or
persistence.

The separate `legacy-labs-state-reset-subset` profile checks only two dataset-turn
outputs: turn 0 contains `labs-main/showList`, with tiling layout whose first
`labs-main` member has Variant `list`; turn 1 contains `labs-main/showTrends`, with
that first matching layout member in `trends`. This is a contains check, not exact
Execution Plan membership. Extra/conflicting Actions and all Action parameters
are semantically unscored, including malformed marker values. Optional `params`
accept arbitrary bounded JSON: finite scalars/null, arrays and objects, at most
four nested collection levels, 20 entries per collection, 1000 characters per
string value and 1–120 characters per object key. The plan remains capped at
20 Actions with strict outer Action fields; non-JSON or over-bound values fail
structural validation. Extra/duplicate layout members and Vessel identity are unscored;
first-match behavior means a wrong first target Variant still fails even if a later
duplicate is correct. It does not certify exact Instance membership or identity
preservation. Pre-/retained-state snapshots are structurally required but their
semantics and continuity are unscored. No turn 2 or marker-validity rule is scored.

Independent fixture JSON starts with `labs-main` Labs/trends and copies two scripted
responses. The canonical script retains that identity and tiling membership, but
this is not a scored continuity guarantee. Expectations never generate responses.
The bounded evidence contract requires exactly two complete ordered prompt/index
snapshots; missing/malformed evidence fails closed and partial/absent execution
remains unscored. Controls reject wrong/missing Action/target/Variant and missing
or non-tiling response layout, reordered prompts and extra/incomplete turns.
Positive boundary controls expose extra Actions, duplicate/extra layout members,
changed state snapshots and invalid marker parameters as outside this narrow oracle.

This is `synthetic: true`, `legacy-derived-harness`, `pending-human-review` evidence
only: no Engine, provider, LLM, handler, live planning, geometry, full migration or
legacy-runtime verification. D19, D23 and D30 remain separate and unchanged.

### Complete synthetic Labs post-reset marker predicate (D33 origin)

`labs-state-reset-synthetic` is a **separate synthetic eval contract**, not a
change to the two-prompt `labs-state-reset-subset` scoring rules or fixture output.
Its legacy lineage points to the originating `/items/32` row at revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`, not to a three-turn dataset sequence:

1. “Show me the list of my lab results.” (dataset)
2. “Go back to the trends chart.” (dataset)
3. “What's the trend for hemoglobin?” (**synthetic, absent from the dataset**;
   uses the legacy task fallback wording)

The independent fixture starts with one `labs-main` Labs/trends Instance. The
code-owned profile requires exactly one Action per turn: `showList`, then
`showTrends`, then `selectMarker` with exactly `params: {markerSlug: "hemoglobin"}`,
all on `labs-main`. Navigation Actions must omit parameters. Missing, extra,
duplicate, conflicting or mis-targeted Actions and changed/extra marker parameters
fail. Requiring the requested marker is positive exact emission evidence, **not**
the source's optional enum-safety rule or an enum-safety certification.

Every response must contain exactly one Labs Instance with the expected Variant
(`list`, `trends`, `trends`) in a tiling layout-membership projection. Pre-turn
and retained membership snapshots must agree with the sequence starting in
`trends`. Geometry/tree visibility and selected-marker state are not represented.
Exactly three complete ordered prompt/index snapshots are required; malformed,
missing, reordered or extra turns fail closed. Evidence keeps the same bounded
JSON parameter limits as the two-turn profile, but these stricter synthetic
predicates never alter that source-exact profile. Scripts never derive from
expectations, interpret prompts or execute Actions.

This emission predicate is complete, but remains `synthetic: true`,
`legacy-derived-harness` and `pending-human-review`. Optional first-match enum
behavior is separate below; the third prompt is not a recovered dataset turn or
full legacy T12/F03a port. The current demo now has a distinct no-data `labs` Vessel
in `apps/demo/src/vessels/labs.vessel.def.ts`. Its real React/client tests separately
verify selection handling, isolation and persistence across Variants/remounts.
Neither those tests nor the one manual Engine sample turn this scripted case into
handler-effect, clinical trend, semantic or deployed-runtime evidence.

### COMPLETE isolated optional marker enum slice (D33)

`labs-state-reset-optional-enum` represents only the legacy scorer's optional
first-marker enum subpredicate in **one isolated response projection**, not a
three-turn reset session or a full scorer port. It uses exactly the existing
synthetic “What's the trend for hemoglobin?” prompt, absent from dataset
`/items/32`. It does not add a third dataset request or alter either prior D33 case.

The code-owned rule finds the first `labs-main/selectMarker` in the complete
Execution Plan. If no Action matches, the predicate passes. A match requires a
string `markerSlug` equal to
`hemoglobin`, `platelets` or `glucose`. Missing, non-string, unknown or differently
cased/padded values fail. Foreign targets and other Actions are ignored; later
matches are deliberately unscored, so valid-first/invalid-later passes and
invalid-first/valid-later fails. Extra parameters do not change the predicate.
This preserves D33's first-match semantics, not D19's every-match safety rule or
the separate synthetic case's required exact hemoglobin emission.

The independent fixture contains an empty Execution Plan; tests supply independent
allowed/invalid candidates and never generate them from expectations. Exactly one
complete bounded observation is required; a missing Execution Plan fails rather
than defaulting to no selection. Local turn index 0 labels the isolated sample,
not source turn index 2 or proof that the first two turns executed. Layout,
selected-marker state and history are not represented or scored. The Action
projection retains the existing four-level/20-entry bounded JSON parameter limits.

The declared predicate is **COMPLETE**, with synthetic, `legacy-derived-harness`
and `pending-human-review` metadata and pinned `/items/32` lineage. It provides
harness coverage only; handler effects, marker persistence and runtime compatibility
are not inferred. There is no Engine, provider, model, handler, full legacy D33
compatibility or additional source-row claim.

### Labs final multi-marker Action emission (D30/T09)

`labs-multi-marker-final` represents `/items/29`, ID/task
`cap-maelstrom-multiturn-labs-multi-markers`, at revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`. Its separate
`legacy-labs-multi-marker-final` profile retains exactly these prompts:

1. “Show me my lab trends.”
2. “Add hemoglobin and platelets to the chart.”
3. “Also include glucose.”

The dataset expects the **final** `selectMarkers` on `labs-main` with all three
markers. Source drift **F03b** instead checks hemoglobin+glucose at turn 0,
all three at turn 1, and no marker Action at turn 2. This harness deliberately
corrects that stale timing rather than reproducing it. It also explicitly
strengthens dataset “all three” to an **exact set**: `params.markerSlugs` must be
an actual array of exactly three unique strings containing `hemoglobin`,
`platelets`, and `glucose`, in any order. Serialized text, unrelated parameters,
duplicates and additional slugs cannot satisfy the rule.

Only a matching Action at final index **2** is scored. Intermediate Actions and
all layout/state semantics are unscored. Extra parameters and additional
structurally valid Actions, including conflicting `selectMarkers`, remain
unscored even on the final turn. A pass proves only that the required final
Action was emitted, **not** that the whole Execution Plan is correct or that
handler effects occurred. D19's negative single-marker enum rule and D23's
turn-1 single-marker rule are separate and unchanged.

Independent fixture JSON supplies initial layout and three responses; expectations
never generate observations. Evidence must contain exactly three complete,
ordered prompt/index snapshots. Responses have at most 20 Actions; each parameter
record has at most 20 keys (1–120 characters), with finite JSON scalar values,
strings up to 1000 characters, arrays/objects of at most 20 entries, and at most
three nested collection levels per parameter value. Malformed evidence fails
closed; partial/absent execution evidence remains unscored. Layout is only a
structurally required type/membership projection, not selected-marker state.

Controls cover every slug permutation, wrong/missing Actions/targets/parameters,
earlier-only selections, the stale F03b trajectory, invalid sets, malformed
evidence and expectation independence. Passing controls explicitly pin unscored
extra params, unrelated/conflicting Actions, intermediate Actions and changed
layout/state. There is no cumulative selection, persistence, model/LLM/provider,
Engine, Action-handler, full migration or legacy-runtime verification claim.
The case is `synthetic: true`, `legacy-derived-harness`, and `pending-human-review`.

### Weather/Calendar target isolation (D24/T13)

`target-disambiguation` retains the four source prompts and `/items/23` lineage
for `cap-maelstrom-multiturn-target-disambiguation`. Its distinct
`legacy-target-disambiguation` profile replays independent fixture responses
through the common session lifecycle. Expected identities never generate the
observations. D22's reuse trajectory, D23's marker-emission contract and D31's
Variant chain remain separate and unchanged.

The approved oracle deliberately **strengthens** the source deterministic scorer:
turn 2 originally checks the desired Weather Action, tiling and weekly Weather,
not Calendar state/count or simultaneous Calendar Actions. Turns 0/1 forbid
Actions but omit Weather-current checks; turn 3 omits Weather-weekly retention.
The new rubric closes those gaps against the dataset intent and source guidance;
it is not an exact scorer port or historical-score parity claim.

| Turn indices | Required structural evidence |
| --- | --- |
| 0, 1 | Empty Execution Plan; Weather stays `current`, Calendar stays `month` |
| 2 | Contains `showWeekly` on `weather-main`; Weather becomes `weekly`, Calendar stays `month` |
| 3 | Weather remains `weekly`, Calendar stays `month`; no-op is valid, not mandatory |

Every pre-state, response and retained post-state must contain exactly the two
original Instance identities and Vessels, in both top-level Instances and a tiling
layout projection. Missing, duplicate, replaced or added Instances fail, including
lost Calendar at the decisive turn. Calendar-target Actions and foreign targets
fail on every turn. Turn indices and prompt order, initial state, continuity and
final retained state are checked. Instance ordering and consistent synthetic ID
renaming are harmless. Additional same-Weather-target Actions on turns 2/3 are
outside Action validity/effect scoring and may pass if the structural state is
correct; passing controls make that limit explicit.

The old task provides optional operational `llmJudgeGuidance` to an optional
OpenAI judge. This harness invokes **no judge or provider** and proves no judge
quality, language understanding or semantic target disambiguation. It does not
execute Action handlers or model layout geometry. Fixtures project identities,
Variants, layout type/membership and Action names/targets, not full protocol
responses. All four turns require complete bounded evidence; partial/absent
execution evidence remains unscored by the common lifecycle. Controls cover
premature mutation, simultaneous Calendar/Weather Actions, lost state, wrong
targets and final Weather regression. JSON mutations demonstrate independent
requests, scripts and expectations. The case remains synthetic,
`legacy-derived-harness` and `pending-human-review`, not installed `engine-old`
compatibility or full migration.

### Calendar week → month round trip (D29/T08)

`calendar-week-nav` represents `/items/28`, ID/task
`cap-maelstrom-multiturn-calendar-week-nav`, at revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`. The source task is
`src/tasks/multiturn/multiturnCalendarWeekNav.ts`. Its distinct
`legacy-calendar-week-nav` profile copies independent fixture responses; neither
expectations nor request text generates observations. The three exact prompts are:

1. “Show me the weekly schedule.”
2. “What is on my calendar this week?”
3. “Go back to the monthly view.”

Turn 0 must contain `calendar-main/showWeekly` and a `week` target in tiling
layout. Turn 1 requires an empty Execution Plan and the `week` target in tiling
layout. Turn 2 must contain `calendar-main/showMonthly` and a `month` target in
tiling layout. The historical dataset expectedOutput spells the return Action
`showMonth`; the source Calendar fixture, executable scorer and judge guidance
use **`showMonthly`**. This case deliberately uses that task-local spelling;
`showMonth` substitution fails. The historical dataset and other cases are not
normalized or rewritten.

These are bounded **source-scoring contains checks**, not exact-one Action or
exact full membership rules. Additional Actions on turns 0/2, extra/duplicate
layout members and changed Vessel IDs can pass. State snapshots must be present
and well-formed, but retained-state continuity is not semantically scored. Passing
boundary controls expose these limits rather than importing the stronger D26
navigation or D24 target-isolation rules; those cases are unchanged. Exactly three
complete ordered prompts/responses are required by this harness. Missing target,
wrong Variant/layout, missing/wrong/mistimed Actions and malformed evidence fail;
partial/absent execution evidence remains unscored. JSON mutation controls prove
expectation changes do not manufacture observations.

This synthetic case remains `legacy-derived-harness` and `pending-human-review`.
No judge or provider is called. It makes no response-quality, language-understanding,
Action-effect, geometry, judge-quality, full-source-migration or installed
`engine-old` compatibility claim. Layout evidence is only a type/membership
projection; no handler or Engine interprets the requests.

### Delayed Weather Action (D32/T11)

`weather-delayed-action` represents `/items/31`, ID/task
`cap-maelstrom-multiturn-delayed-action`, at revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`. The source task is
`src/tasks/multiturn/multiturnDelayedAction.ts`. Its separate
`legacy-weather-delayed-action` profile uses independent JSON responses, not
responses generated from expectations. Exactly three dataset prompts run:

1. “I need to check some weather data.”
2. “What is the forecast looking like?”
3. “Show me the weekly view.”

This is an explicit **intent-preserving rubric correction**, not exact scorer
parity. Initial state is one `weather-main` Weather/current Instance in tiling.
Turns 0/1 require empty Execution Plans and current in both response and retained
state/layout; an empty plan with a layout-only premature weekly change fails.
Turn 2 requires a matching `weather-main/showWeekly` Action and weekly response
and retained state. Weekly layout without that Action fails, including no-op and
unrelated-Action plans. Every pre-state, response and retained state must preserve
exactly the original single Instance identity/Vessel and tiling membership.
Added/replaced/duplicate/missing Instances, foreign targets, wrong Variants,
state discontinuity, malformed/incomplete evidence and wrong prompt/index order
fail. The final retained weekly state is checked without adding a fourth turn.

The source's already-weekly/no-action branch can pass despite current state and
no prior changes; it is deliberately excluded. A genuine already-weekly case is
separate/deferred. Optional LLM judge guidance mentions a fourth “thanks” turn
absent from the dataset/task input: neither that turn nor the OpenAI judge runs.
No Engine, provider or Action handler is invoked by this profile. This proves no
semantic understanding, answer quality, Action effects, geometry or installed
`engine-old` compatibility. Additional same-target final Actions are outside
Action validity/effect scoring; the decisive Action must still be present.
The projection covers layout type and Instance state/membership, not tree geometry.
The case remains `synthetic: true`, `legacy-derived-harness` and
`pending-human-review`. Regression controls exercise the corrected early/current,
final Action and exact identity/layout/retained-state constraints independently.

### Strict tiling addition (D37/T22)

The legacy `cap-maelstrom-tiling-add-vessel` row `/items/36` asks
`Add my calendar to the view too`. Its scorer checks Calendar/month, the presence
of Weather/Labs metadata, and a weak scan of bare-ID tree leaves. Metadata alone
can leave Weather or Labs hidden; the old scan does not prove a complete tree.

`tiling-add-vessel` is an explicit intent-preserving strengthening. It starts with
`weather-main`/Weather/current and `labs-main`/Labs/trends, with Calendar registered.
It requires those two unchanged Instances plus exactly one fresh Calendar/month
in both response and retained layout. `calendar-added` is a **synthetic choice**,
not a historical required ID. The independently declared added ID must differ
from both existing IDs. Expectations never create the scripted response or tree.

The fixture maps old bare leaves to the current `ID:`-prefixed contract. Its
canonical response uses `V:1,1,1` with Weather, Labs and Calendar leaves. The oracle
uses the current protocol's `TilingNodeSchema`, `parseTilingSplitToken` and
`tilingLeafInstanceId`, then enforces a stricter evaluation policy:

- One complete preorder root, no missing child slots or trailing tokens.
- No repaired/discarded split weights, duplicate leaves or unknown references.
- All three retained Instances **visible exactly once**, not merely in metadata.
- Valid binary and weighted n-ary splits, either axis, and `null` empty slots
  are accepted. No exact shape, ordering, weights, depth or pixel size is required
  beyond the bounded evidence contract.

Tree evidence has at most 256 tokens of at most 256 characters; metadata and plans
have at most 20 entries. Traversal is iterative, bounded by the token count, and
uses declared weight arity rather than assuming binary splits. The current runtime
can repair weights and project visibility from partial/trailing trees; those
behaviors do **not** imply a pass here. No production protocol behavior is changed.

Execution Plan semantics are outside this rule: empty and structurally valid
nonempty plans receive the same layout verdict, including unverified Action names
and targets. The plan projection carries names/targets only; no Action is executed.
Controls cover alternate valid trees/null slots, hidden retained metadata, missing
or changed identities/Vessels/Variants, extra Instances, malformed weights,
unknown/duplicate/bare leaves, incomplete/trailing trees and lost retained state.

This is synthetic `legacy-derived-harness` evidence, `pending-human-review`.
It is not exact legacy parity, current runtime repair behavior, renderer geometry,
minimum-size fit, Action execution, prompt interpretation or `engine-old`
compatibility. No provider or judge runs.

### Binary tree validity and Labs addition (D12/T20)

`tiling-tree-validity` preserves `/items/11`, task
`cap-maelstrom-tiling-tree-validity`, at legacy revision
`d6ef99aacb8ebce4d707d54fee14149daeea552d`, with the exact prompt
`Add my lab results to the view`. Its initial scene contains only
`weather-main`/Weather/current, with Labs registered. The independent response
script adds `labs-main`/Labs/trends. `labs-main` is the canonical current fixture
identity, supported by the source judge guidance, not a value enforced by the
old deterministic scorer. Expected identities never manufacture the response.

The dedicated `legacy-tiling-tree-validity` profile intentionally strengthens
that weak scorer. It checks exact Weather preservation and fresh Labs addition
in both response and retained state, with both Instances visible exactly once.
It uses current `ID:` leaves and weighted preorder syntax, but accepts only the
**binary subset**: each split must declare exactly two children. Either axis,
reversed leaf order, equal or unequal binary weights, nested splits and `null`
empty slots are valid. A complete root is mandatory; repaired/discarded weights,
missing children, trailing tokens, duplicate/unknown/bare leaves, hidden metadata,
wrong identities/Vessels/Variants and extra Instances fail. Traversal is iterative
and bounded to 256 tokens of at most 256 characters, with at most 20 metadata or
plan entries.

This does not change D37's general weighted-tree policy. A complete ternary tree
containing Weather, Labs and one `null` slot is valid under the general parser
but fails this source-specific binary rule; D37 continues to accept n-ary trees.
The old `depth <= 3` check measured **nested-array depth**, not split depth in the
current flat preorder representation. It is deliberately not transplanted.
A deeply nested, bounded binary tree is a positive control; no exact depth parity
or geometry/minimum-size/fit guarantee is claimed.

The source's optional LLM judge guidance informs the binary contract, but no
judge, provider, Engine, renderer or handler runs here. Plans are structurally
present as evidence, with no Action or empty-plan requirement: empty and nonempty
plans receive the same layout verdict. This is a synthetic representation
adaptation and rubric strengthening, not exact legacy scorer parity, general
runtime validation/repair behavior, semantic understanding or `engine-old`
compatibility. The case remains `legacy-derived-harness` and
`pending-human-review`. Controls pin source lineage, complete evidence, independent
expectations, preserved state, binary validity and the unchanged D37 boundary.

### Grid allocation (D13/T21)

`grid-no-overlap` retains `/items/12`, `cap-maelstrom-grid-no-overlap`, and the
exact dataset prompt `Place 5 vessels in compact grid`. The legacy builder ignores
that input and hardcodes `Rearrange my dashboard to show all five panels` instead.
Both wordings are disclosed, not silently equated: the dataset text is declarative
evidence here, and neither request is interpreted by a model.

The dedicated `legacy-grid-no-overlap` profile copies independent fixture responses
through the common session lifecycle. It does not call or change the generic
planner response scorer (which is tiling-oriented). Current `GridLayout` syntax
is preserved: `positions` carry known `instanceId`, zero-based `position.row`/
`column`, and `size.width`/`height` in **Chart cells**, not pixels or viewport units.
Instance metadata remains in the fixture, not in grid positions. Omitting a
known Instance from positions hides it; retained metadata alone is not visibility.

The canonical Chart is **12 rows × 16 columns**, with Weather/current,
Labs/trends, Calendar/month, Email/inbox and Tasks/pending. Fixture dimensions and
known identities are validated independently of case expectations; mismatches
fail rather than generating different observations. Exactly five unique known
positions are required, with nonnegative integer coordinates, positive integer
sizes, no bounds violations and no pairwise rectangle intersections. Touching
edges are valid. The initial scene is checked against its independent script;
response and retained allocations are each checked for these constraints, not
required to match any particular position ordering or arrangement.

Exact membership and integer/positive cell validation deliberately strengthen
the old checker; this is not exact scorer parity. **Compactness and Variant
minimum sizes are not scored.** The source Labs allocation is 8×4 despite its
8×5 declared minimum. The canonical fixture preserves that allocation, without
pretending it fits. Sparse one-cell allocations are explicit passing controls;
passing means only that the listed cell-allocation constraints hold. There is no
Action requirement or empty-plan requirement: structurally present empty and
nonempty plans yield the same layout verdict.

Evidence is bounded to 20 positions/Actions, finite coordinate/size values in
±1,000,000, and Chart dimensions from 1 to 1000 cells. Scoring checks numeric
validity before arithmetic, and compares at most ten pairs after the five-ID
gate. Missing/malformed evidence fails closed. Controls cover overlap/containment,
Chart boundary contact, invalid numbers, duplicate/extra/unknown/missing IDs,
independent expectations, sample reset and alternate/reordered placements.

No Engine, judge, handler, renderer or provider runs for this profile. It does
not establish semantic understanding, compactness, minimum-size fit, runtime
healing, rendering, Action effects or `engine-old` compatibility. The case remains
synthetic, `legacy-derived-harness` and `pending-human-review`.

### User-adjudicated three-Vessel addition (D35/T17)

`three-vessel-addition` retains the three verbatim `/items/34` requests and final
Weather/weekly, Calendar/week, Labs-preserved intent. The user approved the
previously ambiguous starting scene: **only `weather-main`/Weather/current**.
The first request adds `labs-main`/Labs/trends and `calendar-main`/Calendar/month,
using the current demo defaults. Labs preservation begins **after creation**;
it is not a claim that a nonexistent initial Labs Instance was unchanged.

The second request requires `weather-main/showWeekly`; the third requires
`calendar-main/showWeek` (current spelling). Every response has exactly these
three stable IDs/Vessel IDs with Weather current→weekly→weekly, Labs trends on
all three responses, and Calendar month→month→week. Complete ordered membership
snapshots must carry forward without loss or mutation. Membership ordering is
irrelevant; layout geometry is unscored.

Every emitted Action must be offered in its incoming Variant (new Instances on
the first turn use their declared default Variant), with sequential transition
validation. Premature/conflicting transitions and foreign targets fail. No Action
is required to create either Instance; an empty first plan is allowed but not
required. Additional valid non-transition Actions are permitted, with their
parameters and effects unscored. **All Labs-target Actions after the first turn
are rejected**, including marker selection, so the preservation rule is not
silently limited to navigation. The offline fixture contains independent scripted
responses and frozen actual demo catalogs; tests detect catalog drift.

This adjudication deliberately differs from the pinned legacy task, which
preloads all three Instances and scores Weather/showWeekly on turn 0 then
Labs/selectMarker on turn 1 instead of these dataset prompts. Neither the pinned
source nor its 41-row identity/digest index was rewritten. D35 moved from the
blocked ledger to bounded case evidence; D39 now has separate action-backed evidence.
D35 is **COMPLETE only for this adjudicated current contract**. The fresh post-fix
one-shot sample `d35-798289d4-18e7-4604-b049-7b1d5b8321e2` used the three exact
source prompts and passed with `generationDispatches: 3`, `evaluation: pass` and
empty failures. Turn 0 added Labs/trends and Calendar/month; turn 1 emitted
`weather-main/showWeekly` with Weather/weekly; turn 2 emitted
`calendar-main/showWeek` with Calendar/week; Labs remained unchanged after addition.
No retry was made. The saved raw report is unchanged:
`/var/folders/sx/3r95wzqn483glq6t_19hhjbw0000gn/T/pi-bash-de96e6635608a092.log`.
Its static PARTIAL limitation predates this status promotion; the passing verdict
is original, not a re-run. Prior failed reports remain preserved, including
`d35-c900a0df-c1f4-4ce4-ac2c-766396da7a37`, which asked for clarification instead
of adding Labs/Calendar and later created `calendar-week` without Labs.

The shared prompt distinguishes omitted new-Instance Variants from genuine
ambiguity; the Labs catalog permits opening its empty default view with a no-data
disclosure. One passing sample does not establish reliability. The case remains
synthetic with `review: pending-human-review`; the sample's `semanticReview` is
pending, with no user semantic acceptance implied. No source scorer/runtime or
legacy `TASK_DEFINITIONS` equivalence, demo-factory parity, client/handler effects,
clinical data/trend fulfillment or full layout safety is claimed. The new demo
Labs has no clinical data.

The separate [manual runner](../src/manual/README.md#manual-d35-adjudicated-three-vessel-addition)
loads actual current catalogs, captures real Engine history and applies this same
membership/Action predicate. Fake-transport tests are not provider evidence.

### Dataset-aligned cross-Vessel isolation (D36/T16)

`cross-vessel` preserves the three dataset prompts at `/items/35` for
`cap-maelstrom-multiturn-cross-vessel`:

1. “Show me the hourly weather.”
2. “Now show me my lab results.”
3. “Switch the weather to weekly without touching labs.”

The initial fixture contains only `weather-main`/Weather/current and
`calendar-main`/Calendar/month. The registered `lab-results` Vessel is available,
but no Labs Instance is preloaded. Its `trends` Variant is supported by the source
Vessel; the default `summary` is not an obligation to choose it.

This is an explicit dataset-aligned correction of the source scorer's
`lab-results-main` Instance ID and final `summary` expectation. The case uses the
dataset's **`labs-main` Instance ID**, the source's **`lab-results` Vessel ID**, and
Variant **`trends`**. These are separate identity fields, not executable aliases
or a global renaming of other Labs cases. The original scorer ignores the dataset
expectations. The current synthetic oracle does not claim exact scorer parity.

| Turn | Required response evidence |
| --- | --- |
| 0 | `weather-main/showHourly`; Weather/hourly and Calendar/month; no Labs metadata by either `labs-main` ID or `lab-results` Vessel; no Calendar-target Action |
| 1 | Weather/hourly, Calendar/month and first matching `labs-main`/`lab-results`/trends; no Calendar-target Action; no particular Labs Action required |
| 2 | `weather-main/showWeekly`; Weather/weekly, Calendar/month and the same Labs/trends; no Labs-target Action |

All response layouts must be tiling. Required members use first-match ID checks,
including Vessel and Variant. The initial scene and independent expectation IDs
are validated; Labs must be distinct from both original IDs. Explicit absence on
turn 0, Labs/trends at turn 1, Vessel identity checks and final Calendar/month
preservation make the approved intent correction concrete beyond the old scorer.
Extra/duplicate response members are **not** rejected; a wrong first match fails
even if a later duplicate is correct. There is no exact-two/three membership rule.

Weather Actions are contains-checks. Parameters and other Action semantics remain
unscored: unrelated/foreign Actions may coexist, the turn-1 plan may be empty or
nonempty (except Calendar targets), and Calendar-target Actions on turn 2 are not
forbidden by this rule. The last-turn Labs prohibition targets `labs-main`, not
an alias. Bounded arbitrary JSON params are structurally validated, not interpreted.
Pre-/retained-state snapshots are required and copied by the session harness, but
semantic continuity is not scored. No selected-marker state is modeled.

The builder's unused fallback actually asks “Show me the weekly weather” and
“Also switch my calendar to weekly view”; it is not the three supplied dataset
requests and is not executed here. This TaskDefinition has no task-specific
`llmJudgeGuidance`; this harness calls no judge or provider. Scripts are independent
from expectations, and changes to requests/expectations/responses are exercised
separately. Controls reject old `lab-results-main/summary` output, premature Labs,
wrong Action timing, forbidden targets, missing required members and malformed
evidence; passing controls expose unscored parameters, extras and snapshot state.

A pass is synthetic response structure only—not semantic understanding, actual
Instance creation, handler effects, layout visibility/tree geometry, full source
migration or installed `engine-old` compatibility. The case remains
`legacy-derived-harness` and `pending-human-review`.

## Contract and loading

- `src/core/case-schema.ts` validates the generic v1 envelope and explicit index,
  without filesystem, client, or plugin imports. It is outside the dependency-free
  `core/runtime` subtree.
- `src/adapters/offline-case.ts` owns the offline profile schemas and allowed
  profile/oracle/fixture combinations. It can use the existing scenario registry;
  it does not execute providers. Unknown fields/names/versions/shapes fail closed.
- `tools/evals-offline/cases.ts` reads only indexed basenames, with fixtures under
  `v1/fixtures`. It rejects duplicate case/fixture IDs, missing references,
  unreferenced indexed fixtures, symlink roots/fixture directories/files and
  files over 64 KiB. On supporting platforms, nonblocking open rejects FIFOs
  without waiting for a writer. It validates the **whole index** before returning
  anything for execution. There is no missing-file fallback.
- `tools/evals-offline/case-adapter.ts` is the code-owned composition registry.
  Client imports stay in tooling, not the server-classified eval package.
  JSON cannot select a module, command, arbitrary URL or executable scorer.
  Profile/fixture code is trusted; the loader is not a sandbox for hostile
  concurrent filesystem mutation or arbitrary JavaScript objects.

Every case declares a stable ID, schema version, title/purpose, development or
validation suite, required surface, profile, fixture ID, oracle ID/version,
profile-specific inputs/expectations, migration status, and lineage. Synthetic
content and `pending-human-review` are declarations, **not authenticated privacy
or human-baseline approval**. Real captures and secret material do not belong here.

Case expectations are independent of scripted responses. Changing weather input
turns changes the executed session; changing expected Variants can fail its
oracle. Client expectations cannot change observed handler effects. Stage literal
bindings are judged by the existing scenario oracle. Harness assertions for
hand-off, N/A and invalid replay do not turn those evaluation results into passes.
Fault injection remains in test code, never a JSON-selectable mutation plugin.

Lineage is many-to-many: legacy sources retain the full revision, dataset path,
original ID, task ID and exact zero-based `/items/N` pointer. Original dataset IDs
are **not** canonical keys; duplicate original IDs at different pointers must not
collapse. Current scenario lineage retains its source revision/path/ID. These
are source-history references, not assertions that the current executable code
has that old revision.

The loader computes SHA-256 over the exact UTF-8 **file bytes**, including
whitespace/newlines, for each case and resolved fixture. No self-referential or
hand-maintained digest is stored in JSON. It freezes loaded definitions. The
composition adds both digests to result provenance. These hashes do not cover
code-owned adapters, referenced scenario definitions or their transitive fixtures:
record the code revision separately for a reproducible full run. Full run-manifest
and canonical schema migration are still pending.

## Authoring and checks

Use only schema version `1` and a registered profile/oracle combination. Add case
and fixture basenames to the explicit index, keep IDs unique, and preserve source
row identity. All current schema changes are internal/provisional; readers reject
unknown versions rather than coercing them. Any future incompatible change needs
an explicit migration/version policy, not silent rewriting of old inputs.

From the workspace root:

```sh
bun test --conditions=@maelstrom-co/source tools/evals-offline
bunx nx run @maelstrom-co/evals:check --skip-nx-cache --skipSync
bunx nx run evals-offline:test --skip-nx-cache --skipSync
```

The eval package's existing Biome include covers `cases/**/*.json`; TypeScript's
`src` include alone does not. Biome also checks sibling `scenarios/**/*.json`. Offline tests load the index, validate and execute
all forty-three cases, mutate temporary copies to prove inputs/expectations matter, and
retain the earlier state-loss/order/replay/scorer controls. They deny network.
`--skipSync` is the existing workspace-reference workaround, not skipped tests.

## Remaining coverage obligations

This is not full behavioral/case migration: 29 legacy task definitions and 41 rows
(38 unique IDs) remain the legacy inventory to reconcile. All 155 current scenario
definitions are now JSON-backed, but that is not fixture or model-quality coverage. Thirty-two distinct
legacy rows now have some bounded harness evidence (D02, D03, D12, D13, D14, D15, D16, D17, D18, D19, D20, D21, D22, D23, D24, D25, D26, D27, D28, D29, D30, D31, D32, D33, D34, D35, D36, D37, D38, D39, D40, D41);
D02/D14/D17/D25/D33/D38/D40/D41 are complete for the authorized declared scopes
listed under [Completion scope](#completion-scope). This is not semantic reliability,
injection robustness, clinical trend data, a recovered third D33 dataset turn,
or full T12/F03a compatibility. App handler evidence and manual planner samples
remain separate from scripted case observations.
None is an installed-legacy-runtime compatibility certification. The other nine
rows (1 bounded D01 code-unit row, 0 source-only blocked rows and
8 out-of-scope D04–D11 rows) are retained verbatim in the [source-obligation ledger](../obligations/README.md),
not in the executable case index. Inventory accounts for all 41 pointers without
counting ledger entries as behavioral coverage. Current `variant`, `preserve` and
`generate-content` are case-owned snapshots; other current case links remain
reference-backed metadata. The other 152 scenario definitions are in the sibling
JSON registry, not new offline cases. Four rows
`/items/37`–`/items/40` share `cap-maelstrom-edge-deterministic-actions`; D38/D40/D41
have separate complete bounded cases, and D39 has a separate action-backed transition case. Existing
source-labelled holdout is exposed validation data, not untouched holdout.

D35/T17 `/items/34` now uses the user-approved Weather-only start in
`three-vessel-addition`. Labs preservation begins after turn-0 creation. This is
an adjudicated current contract, not the old preloaded task/scorer. D36 stays
separate and does not supply D35's initial scene.

D39 `/items/38` requires a proper Action, not a prohibition on the declared
`showWeekly` transition. The earlier blocker interpretation was corrected by
inspecting the legacy single-turn scorer. Full behavioral coverage for the remaining
in-scope unregistered legacy target D01 remains unresolved. D01 has bounded
current provider-input unit evidence only; its legacy task/API mapping remains
unconfirmed, not proven absent.

Excluded from active unification scope: D04 `/items/3`,
`reg-ai-chat-schema-enforced-lab-extraction`; D05 `/items/4`,
`reg-labs-extraction-error-wrap`; D06 `/items/5`, `reg-labs-job-non-lab-key`;
and all voice/audio-related rows D07–D11 `/items/6`–`/items/10`, deferred by the user.
Their raw rows and digests are preserved in the ledger with the user's exclusion
reasons, not cases or results. D05 had no current Labs extraction API or specified
error contract. D06 had no identified current Labs S3 job or specified S3 event
envelope/batch contract; no handler or batch behavior is invented.

No provider call, Langfuse upload, dataset sync, paid CI, or archive-repository
operation is part of loading or testing this registry.
