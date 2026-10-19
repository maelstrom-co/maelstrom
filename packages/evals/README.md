# @maelstrom-co/evals

Case completion follows the [declared-scope convention](cases/README.md#completion-scope); it is separate from sample outcome and human review.

Live evals for Maelstrom planners. Workspace-internal: the package is private, has no build and runs with `bun`. It depends on `@maelstrom-co/planner-jev` (through its `_internal` and `_testing` subpaths), `@maelstrom-co/planner-llm`, `@maelstrom-co/engine` and `@maelstrom-co/protocol`; no published package depends on it.

Two evals live here: the full-planner eval runs whole planners through `createEngine` and compares named arms, the stage eval runs one pipeline stage on gold inputs. The runners are generic and live in `src/core/`; everything that knows a planner family lives in a plugin under `src/plugins/` (see Plugins below). The Jev and Decisions plugins read planner-jev's stages and planners through `@maelstrom-co/planner-jev/_internal`, and their offline tests read the fixtures and scripted transports through `@maelstrom-co/planner-jev/_testing`. Both subpaths are unsupported outside this repository. There are four entry points: `src/eval/cli.ts` (the full-planner eval, the nx `eval` target), `src/eval-stages/cli.ts` (the stage eval, the nx `eval-stages` target), `src/eval/report-cli.ts` (rebuilds a run's report from its records) and `src/eval/grader-validate.ts` (validates the grader). Each only hands the registered plugins, `evalPlugins` from `src/plugins/index.ts`, to its runner in `src/core/`.

## Manual current-Engine samples

[`src/manual/d02.ts`](src/manual/README.md) prepares one current-Engine identity
conversation. It defaults to a no-network dry-run; live execution requires explicit
flags and an externally enforced capped key. No new CI/live Nx target is added.
The three prompts use current `llmPlanner` identity customization and retained
Engine history, not the canonical scripted replies. Preparation/offline tests do
not constitute a live result. D02's declared response and prompt-delivery checks
are complete; semantic identity reliability is not claimed.

[`src/manual/d14.ts`](src/manual/README.md#manual-d14-refusal-sample) prepares one
current-Engine arbitrary-JSON refusal request, using the default Maelstrom identity
and current refusal rule. Its syntax predicate and pending human review of refusal
and Vessel redirection are separate. The source text predicate and separate lexical
rubric are complete for their scopes; neither is semantic certification. Case and
new-sample review remain pending.

[`src/manual/d17.ts`](src/manual/README.md#manual-d17-ambiguous-weekly-view-sample)
prepares one ambiguous weekly-view request with the actual current Weather and
Calendar catalogs. It checks the shipped Chart and Execution Plan independently
of a lexical clarification signal; semantic review stays pending. The existing
planner prompt is unchanged. The declared target-exclusion and manual structural
checks are complete; a new sample is still pending human semantic review.

[`src/manual/d25.ts`](src/manual/README.md#manual-d25-ordinary-weather-conversation)
prepares one three-turn Weather conversation with the actual current catalog and
natural Engine history. Shipped navigation and delivery of earlier replies are
checked separately from human review of response semantics. The follow-up itself
names rain/hourly, so this cannot prove semantic reliance on history. No assistant
message is injected. The narrowed ordinary-history contract is complete; injection
robustness is out of scope.

[`src/manual/weather.ts`](src/manual/README.md#manual-d38--d39--d40--d41-current-weather-samples)
requires one explicit D38, D39, D40 or D41 selection: current-view no-op,
action-backed current→weekly, hourly→weekly→current, or hourly→current→weekly
respectively. It uses the actual Weather catalog, unchanged planner prompt and
natural Engine history. Shipped predicates are separate from prose review; D39
checks matching Action/identity but leaves extra Actions/params/geometry unscored. The declared branch/trajectory contracts are
complete, not reliability or handler-effect claims. Dry-run is the
default; no provider call is made by preparation or fake-transport tests.

## Offline unification slice

`src/core/runtime/` provides an internal, provisional runtime-neutral sample lifecycle and explicit session-state adapter. `src/adapters/` wraps the existing planner and stage runners without changing their CLI contracts. Missing evidence, runtime errors, scorer errors, hand-offs and not-applicable cases remain distinct; sample correlation stays outside operational telemetry.

The five-path [offline composition tests](../../tools/evals-offline/README.md) combine these adapters with legacy-derived synthetic fixtures and real headless client effects. Client imports remain in that tooling composition root, never in this server-side package. This is harness evidence, not installed legacy-runtime compatibility or completion of the dataset migration. Paid commands below are unchanged and are not run by that offline suite.

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
See the [case contract](cases/README.md#complete-user-defined-lexical-json-refusal-and-vessel-help).
Total: 43 cases, 35 fixtures, 30 profiles.
D02/D14/D17/D25/D33/D38/D40/D41 are complete for their declared bounded contracts,
not full legacy equivalence or model-quality coverage. D04–D11 are user-excluded;
no source-only blocked obligations remain. See the case contract for scope and evidence.

### Previously missing Weather rows and source obligations

D39 `/items/38` now has `weather-action-backed-transition`: existing Weather/current
must have matching `showWeekly` and shipped weekly state. The legacy single-turn
scorer permits that Action but rejects an actionless weekly jump; the former
blocked interpretation was incorrect. Matching Action/target strengthens its
nonempty-plan check. Extra Actions/params/geometry remain unscored. See the
[D39 contract](cases/README.md#action-backed-weekly-transition-d39).

D38 `/items/37` now has a **COMPLETE stay-current-only** no-op case.
D40 `/items/39` and D41 `/items/40` use `legacy-weather-transition-chain` with
independent scripted responses: exact source prompts, pre-turn-valid navigation,
required Actions and retained membership continuity. D40 follows the dataset's
hourly→weekly→current trajectory, explicitly correcting the old scorer's
hourly→current→weekly mismatch. D41 uses hourly→current→weekly and strengthens
the permissive old scorer by rejecting empty/extra/conflicting Actions.
These are plan/state harness checks, not Engine execution or model/handler evidence.

The separate [obligation ledger](obligations/README.md) preserves one bounded D01
code-unit row and eight out-of-scope D04–D11 rows verbatim. Inventory rejects holes, overlaps and mismatched lineage:
41 pointers accounted for: 32 with bounded case evidence, 1 with bounded code-unit
evidence (D01), 0 source-only blocked, 8 out-of-scope (D04–D11), 0 unaccounted.
The user excluded D04, D05 and D06 from unification. No current Labs extraction API,
schema or failure contract was authorized for D05; D06 has no identified current Labs
S3 job or specified S3 event envelope/batch contract. Their pinned rows remain
traceable, not cases, fixtures, unit evidence, passing results or current behavioral coverage.
This closes traceability, not the remaining behavioral gaps. D01 links only the
existing planner provider-input history test, not an Engine multi-turn session,
model semantic reliance or the unspecified source Turn-2 setup. No runnable case
is added. The user deferred all voice/audio-related rows D07–D11 from this task.
Their source rows and digests, existing server-minter/adapter unit tests and all
voice/audio code remain unchanged. D07/D10/D11 are no longer active unit evidence;
D08/D09 are no longer active blockers. All eight excluded rows are accounting
only, not coverage, evidence or passes.

D35 now has `three-vessel-addition`: the user-approved Weather-only start adds
Labs/trends and Calendar/month on the first source prompt, then requires
Weather/showWeekly and Calendar/showWeek. Labs preservation starts after addition.
The shared offline/manual predicate validates incoming Actions and stable state;
this is not equivalence to the old preloaded task's mismatched scorer. D35 is
**COMPLETE only for this adjudicated current contract**: one fresh post-fix
one-shot current-Engine sample passed in three dispatches with empty failures
and no retry. Prior failed reports remain preserved. Case and sample semantic
review remain pending, not user semantic acceptance. One sample establishes no
reliability, clinical data/trend fulfillment or client/handler effects; no source
scorer/runtime or legacy `TASK_DEFINITIONS` equivalence is claimed. See the
[D35 contract](cases/README.md#user-adjudicated-three-vessel-addition-d35t17).

### JSON v1 offline cases

[`cases/v1/index.json`](cases/v1/index.json) now drives the offline composition: forty-three strict JSON cases cover thirty profiles (the original five-path slice plus legacy Vessel navigation, response constraints, four-turn Weather reuse, Labs marker Action emission, final-turn multi-marker exact-set emission (F03b timing correction; extra/conflicting Actions unscored), Weather/Calendar target isolation, three-turn delayed Weather Action, Calendar round trips, strict tiling addition, binary-tree validity, grid non-overlap, Calendar addition with same-response Action targeting (D34; response-only identity/preservation), dataset-aligned cross-Vessel isolation (D36; explicit labs-main/lab-results/trends mapping), the bounded D33 Labs list→trends subset, its separate synthetic third-turn marker emission extension, and an isolated optional first-marker enum slice (not full T12; no handler effects or marker persistence from scripts)), with thirty-five indexed fixture files. Envelope validation is in `src/core/case-schema.ts`; profile-specific validation is in `src/adapters/offline-case.ts`; bounded registry loading and code-owned execution composition stay in `tools/evals-offline`, with fixed-path core loaders for the three case-owned scenarios. The sibling `scenarios/v1` manifest supplies all 155 current scenario definitions without adding offline cases. Case and fixture byte digests enter result provenance. See the [case contract and coverage obligations](cases/README.md). `variant`, `preserve` and `generate-content` load their full requests/catalogs and expectations from canonical JSON; other current case references remain reference-backed metadata, and legacy-derived fixtures remain harness proofs—not full case migration or old-runtime compatibility. Live CLI inputs are unchanged.

D17/T02 has a **complete target-exclusion predicate** in `legacy-no-dual-target-plan`:
only complete Execution Plans containing both `weather-main` and `calendar-main`
fail the predicate. Empty, single/repeated-target and unrelated/mixed plans pass;
text, Action validity and layout effects are semantically unscored. The separate
legacy lexical clarification heuristic is discarded. Semantic clarification and
whole-response safety are outside this predicate. This is synthetic harness
evidence, not clarification success or a no-double-mutation proof. There are now
32 legacy rows with bounded case evidence, 1 bounded D01 code-unit row,
0 source-only blocked obligations and 8 out-of-scope rows (D04–D11)
out of 41, with zero unaccounted. The 155 current scenario definitions are unchanged.
Full legacy T12/F03a compatibility is not claimed; exclusions are not evidence or passes.
The [source-obligation ledger](obligations/README.md) accounts for those nine non-case rows
without creating dummy cases or increasing pass counts.

`labs-state-reset-synthetic` adds a separate **COMPLETE synthetic eval contract**
from D33's `/items/32` lineage. The two-turn scoring rules and fixture output are
unchanged. Its third prompt, “What's the trend for hemoglobin?”, is explicitly
synthetic and absent from the dataset (legacy task fallback wording). Independent
responses must emit exactly `labs-main/showList`, `showTrends`, then `selectMarker`
with exactly `params: {markerSlug: "hemoglobin"}`, and preserve one Labs Instance
through trends→list→trends→trends membership snapshots. No extra Actions or
navigation parameters are accepted. This is scripted emission/continuity only,
not prompt understanding, selected-marker persistence, handler effects or optional
enum-safety. Optional first-match enum safety has its own case. The authorized
current demo Labs Vessel separately tests navigation and per-instance selection
persistence with no lab data. That does not make this scripted result a handler,
clinical-trend or full legacy T12/F03a compatibility result.
This adds a case, fixture and profile, not another represented legacy row or a
live/model result.

`labs-state-reset-optional-enum` separately represents D33's optional first-match
marker enum subpredicate with the same synthetic third prompt. An absent
`labs-main/selectMarker` passes; only its first occurrence, if any, must use
`hemoglobin`, `platelets` or `glucose`. Later matching Actions are deliberately
unscored, unlike D19's every-match rule. The fixture independently supplies an
empty Execution Plan. This is one isolated response projection, not a reset
session, positive selection, full legacy scorer or recovered third dataset turn.
The predicate is **COMPLETE for declared scope**, with case review still pending.
Handler effects, marker persistence and runtime compatibility are not inferred from
this script. D33's other predicates and D19's every-match rule are unchanged. See the [enum slice contract](cases/README.md#complete-isolated-optional-marker-enum-slice-d33).

All **155 current scenario definitions are JSON-backed**, preserving their full
values and order. The [sibling scenario registry](scenarios/README.md) contains
152 snapshots and three references to the existing case-owned sources:
`scripted-variant.json` owns `variant`, `planner-preserve.json` owns `preserve`,
and `planner-deferral.json` owns `generate-content`. Each case stores its full
ChartRequest (catalog, layout and context), `inputs.scenarioTitle` distinct from
its display title, and complete expectations. History remains absent for all
three; `preserve` retains its existing `spatial: false`, while the others omit it.
Fixed-path `core/variant-case.ts` and `core/planner-case.ts` loaders supply the
live scenario registry and validate the same snapshots used directly by offline
composition. Missing, invalid or mismatched data fails closed without TS fallback.

The three case-specific snapshot schemas intentionally support only variant's
planned visible/actions, preserve's additional reference tree and `unchangedTree`
rule, and generate-content's deferred/select contract. Unsupported expectation
fields reject rather than disappear. Profiles, execution and scoring stay
code-owned. Future demo/catalog edits require explicit snapshot updates and review.
The other **152 scenarios load from `scenarios/v1/snapshots`** through the strict
full Scenario/Expectation schema. The ordered manifest is the runtime source and
the source-format inventory authority; no TypeScript data fallback remains. All
97 development / 58 holdout labels, histories and spatial flags are preserved.
This is definition migration, not model-quality or fixture coverage. The inventory
still has eight case-level links to five IDs; a link alone is not coverage. Replay
cases remain reference controls. Historical holdout labels do not imply secrecy.

Variant's independent candidate JSON still passes through the real Engine and
shipped-response scorer with separate raw/shipped evidence. The two planner
cases instead retain the existing mocked planner: `inputs.response` independently
selects preserve or defer, and its response copies the **request** layout, never
expected layout. It is not an independent candidate snapshot. Changing the
loaded JSON request or expectations affects offline execution/scoring without
falling back to registry values. No model-quality improvement, handler behavior,
paid result, or full migration is claimed by these three data migrations.

### Pluggable publication and optional Langfuse sink

`src/core/publication.ts` defines the internal `EvaluationResultSink` boundary **after** `evaluateSample` has returned, including cleanup. It is separate from execution/scoring, the existing report writers, and operational telemetry. Canonical cases/fixtures remain in the monorepo. The private [`tools/evals-langfuse`](../../tools/evals-langfuse/README.md) package provides an opt-in sink using the public `@langfuse/client` 5.13.1 batch API for self-hosted Langfuse OSS 3.163.0 on Node ≥24. It is not automatically activated: there is no CLI, provisioning, dataset sync, durable archive, or request to the user's deployment yet. A live smoke test needs explicit destination credentials and version assertion, a reviewed synthetic publication, and verification of deployment access, retention and receipt behavior. The core eval package's Node ≥20 baseline is unchanged.

The explicit sequence is:

1. Finish `evaluateSample` once and retain its result locally.
2. Call `prepareEvaluationPublication(result, { destinationId, artifactId, policy })`. The policy must specify `maxBytes` and synchronously approve the exact serialized bytes and destination via `review`. The payload persists `preparedAt`, defaulting to current UTC; optional `preparedAt` injection accepts a valid UTC ISO date-time ending in `Z` and canonicalizes it to millisecond precision. This is publication preparation time, not evaluation latency. Reuse the persisted publication for retries; when preparing/reviewing it again, supply its original `preparedAt` to preserve content identity. There is no default approval or environment initialization.
3. Supply an `EvaluationResultSink` to `createEvaluationPublisher({ destinationId, sink, timeoutMs, maxEntries })`, then call `publish` with that reviewed publication. The sink owns SDK initialization, any buffering/flush necessary to establish its acknowledgment, and disposal. The publisher never disposes caller resources.

The default payload contains allowlisted identity, runtime provenance, statuses, counts and omission markers—not raw observations, records, failure messages, SDK errors, producer IDs or request IDs. Identity/provenance strings still need privacy review. An optional `recording` projection supplies only reviewed replacement observation/record values; source record sequences are validated, omitted records counted, and incomplete source evidence stays incomplete. This is a projected recording, not a complete replay bundle. Runtime values must be plain JSON: finite numbers, strings, booleans, null, dense arrays and plain objects. Accessors, hidden/symbol properties, prototype-related keys, custom `toJSON`, non-JSON types and cycles are rejected; nesting is capped at 32 and the full payload is capped in UTF-8 bytes. Validation does not detect all secrets/PII or certify data synthetic. Review callbacks and projection construction are trusted caller code, not a sandbox or human-approval authentication system. No real-data consent flow is enabled.

The immutable JSON is canonicalized and SHA-256 hashed. `publicationKey` binds destination, sample identity and artifact name; `publicationId` additionally binds payload digest. Different bytes under the same key fail closed. A publisher coalesces concurrent identical sends and reuses accepted results within its **bounded in-memory lifetime only**; it never evicts identity protection to make room. This is not durable, cross-process, or backend exactly-once delivery. Reconstructed/imported payloads require preparation/review again; a shallow copy of a reviewed object is not an approved publication.

`accepted`, `partial`, `failed` and `uncertain` are publication states, never eval verdicts. `accepted` means the sink's declared acknowledgment, not durable storage; a merely queued/flush-resolved SDK operation cannot honestly promise more than its delivery evidence. `failed` requires known rejection. Thrown/invalid sink responses and timeout return `uncertain` without copying raw exception messages. Deadline expiry requests abort but does not prove cancellation; a still-active timed-out send blocks another attempt. Late completion does not rewrite the returned receipt. Retrying a partial/failed/uncertain publication is an explicit caller action with the same ID/bytes, may require backend reconciliation, and **never reruns evaluation**. There is no automatic retry, storage, CLI activation, or sink registry.

`src/core/publication.test.ts` uses synthetic in-memory sinks and denies global fetch. It covers bounded JSON/review rejection, partial/failure/timeout behavior, concurrent deduplication, conflicting bytes, immutable evidence, and independent re-export. Existing CLI and live-eval paths are unchanged.

## Plugins

`src/core/` never imports a planner package: it takes every planner-specific piece from a `PlannerEvalPlugin` (`src/core/plugin.ts`). Three plugins are registered today: `src/plugins/llm/plugin.ts` (the `baseline` arm on `@maelstrom-co/planner-llm`, and the fallback planner the staged arms run on a deferral), `src/plugins/jev/plugin.ts` (the thirteen Jev arms on TypeSafe Jev, the Jev fields of the records and the report, the TypeSafe judge and the select, actions and layout stage evals) and `src/plugins/decisions/plugin.ts` (the five Decisions arms on OpenAI Decisions and the `decisions-select`, `decisions-actions`, `decisions-layout` and `decisions-select-prose` stage evals), eighteen staged arms in all.

The Jev and Decisions plugins share one body, `stagePluginWith` in `src/plugins/jev/plugin.ts`: replay by stage, the record and summary fields, the report rows and the three stage modules, all run on a `ClientBuilder` (`src/plugins/jev/client-builder.ts`: the provider label of the stage report, its required variables, its `meta()` and a client per call). `jevPluginWith` is its TypeSafe preset (the Jev arms, the `jev` alias, `jev-poc` as default, the TypeSafe judge); `decisionsPluginWith` passes the Decisions client and its own arms, with no default arms, aliases or judge. Both plugins print the same report rows, so the Decisions plugin adds none when a Jev arm is in the report (`rowsDeferTo`), and the stage eval CLI refuses to start when two plugins register a stage module under the same name.

A plugin declares:

| Field | Meaning |
| --- | --- |
| `name`, `arms` | Arms by unique name. An arm has a `build(deps)` that returns a `Planner`, naming every pipeline stage it wants recorded with the engine's `named(name, stage)` (the runner records and replays them through the Engine's `instrument`) and reporting its provider calls to `deps.onCall`. `baseline: true` marks a reference arm: no stages, no replay, paired against by the others. `requiredEnv` lists the variables the arm needs; `kind` labels its records (the plugin's name when absent). |
| `defaultArms`, `aliases` | What `--arm` runs when absent, and other names it accepts. |
| `stageOrder`, `phases`, `completionStage` | The pipeline's stage names in order, the stage each planner-neutral phase (`select`, `actions`, `layout`) maps to, and the stage whose candidate the Engine heals and ships, which grader validation reads for records that predate the shipped plan (without it those records are skipped). The scenarios' `deferStage` expectations and `--replay-through` name phases, never stages, so they hold for every plugin. The arm registry refuses a plugin that maps an unknown phase, or a phase or `completionStage` to a stage outside `stageOrder`, and the runner refuses, before any turn, a scenario whose `deferStage` the plugin of a selected staged arm does not map. |
| `fallback(adapter)` | The planner staged arms fall back to; the CLI takes the first plugin that offers one. |
| `verifyReplay(record, arm)` | What a replayed stage output lacks for the arm to read it, checked before any turn runs. |
| `recordTurn(scenario, stages, calls)` | Fields added to a staged turn's record in `records.json`. Naming a field the runner owns throws. |
| `summarizeArm(records)`, `reportRows(summaries)` | Fields added to an arm's summary in `summary.json` (`latency` and `tokens` merge into the runner's; naming a field the runner owns throws), and rows added to each suite's table in `report.md`, by section. |
| `judge` | Rates shipped responses for `--grader` (`Judge`: one `score(input, ctx)` call per grading, returning a level and level probabilities per dimension, with its own provider calls). The grader's questions, levels, state and resampling stay in `src/core/grader.ts`; the TypeSafe judge in `src/plugins/jev/typesafe-judge.ts` only maps them to a TypeSafe call. Only the Jev plugin offers a judge, so `--grader` grades every arm with TypeSafe, Decisions arms included, and the scores stay comparable. |
| `stageModules` | Single-stage evals for `--stage`, each a `StageEvalModule` (`src/core/stage-eval.ts`): its `name`, the `stage` it records, `variants` as factories over the module's own `Deps`, `makeDeps(onCall)` building those deps for one turn, optional CLI `flags` with a `configure(values, run)` that returns the module to run and the settings for `meta.json`, plus `prepare`, `judge` and `reportSections` as before. |
| `meta()` | Settings printed with the run's meta whenever one of the plugin's arms runs (the Jev plugin adds `jevModel`, the Decisions plugin `decisionsModel`). |

A new planner family, or a prompt experiment on `@maelstrom-co/planner-llm`, registers its arms in a plugin under `src/plugins/<name>/plugin.ts` and adds it to `evalPlugins` in `src/plugins/index.ts`, which every entry point reads; its `stageModules` then appear in the stage eval too. Every run needs `OPENAI_API_KEY`, since core builds the OpenAI adapter behind every LLM role and the fallback; beyond it, only the arms selected with `--arm` decide which environment variables a run needs, so `--arm baseline` runs with `OPENAI_API_KEY` alone. `src/core/boundary.test.ts` fails when a file under `src/core/` imports a planner package or anything outside `src/core/`. The scorers replay an Execution Plan with `finalVariants` from `@maelstrom-co/engine`. They keep a copy of planner-jev's layout geometry in `src/core/geometry.ts`, since core may not import planner-jev and no shared geometry package exists yet; `src/plugins/jev/geometry.test.ts` holds it equal to planner-jev's.

Bun resolves workspace packages to their built `dist/` unless told otherwise, so every entry point here runs with `--conditions=@maelstrom-co/source`: planner-jev, planner-llm, engine and protocol then load from `src/`, the way `tsc` reads them, and a stage edit is measured without a rebuild. The nx targets (`eval`, `eval-stages`, `test`) pass the flag; pass it yourself when running a file with `bun` directly, as the commands below do. Without it Bun loads the last build and quietly measures stale code.

## Evaluating

`src/core/run.ts` holds a live runner that compares named planners (arms, registered by the plugins; the Jev arms in `src/plugins/jev/arms.ts`) on the same scenarios: the tiling scenarios of the Jev prototype, keep-versus-replace cases, parameter cases that separate `stated_elsewhere` from `not_stated`, explicit arrangement requests scored by arrangement rules (swap, big instance on the right, mixed row-and-split, edge strip, reorder, a 2x2 grid and more, tagged `spatial: true`) and non-spatial controls that should leave the arrangement alone (content edits, view changes, an added widget, tagged `spatial: false`). Any arm may satisfy an arrangement rule, the Jev arms' fallback included; the fallback columns show who did. Every arm runs through `createEngine` with history off and `retry: false`; the baseline is the same once-retried `llmPlanner` (from `@maelstrom-co/planner-llm`) the Jev arms fall back to, so the arms differ only in their pipelines. Scores use the shipped (validated and healed) response.

```sh
OPENAI_API_KEY=... TYPESAFE_API_KEY=... JEV_MODEL=jev-1.13.0 \
  bunx nx run @maelstrom-co/evals:eval -- --suite all --arm baseline --arm jev-poc --repeats 3
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--suite` | `all` | `development`, `holdout` or `all`. |
| `--arm` | `baseline`, `jev-poc` | A named arm of any registered plugin; repeat the flag for several. Columns follow the order given, and a repeated name runs once. `jev` is an alias of `jev-poc`. The stage-library arms (`jev-ungated-stepwise-preset-inline` and the other planners listed in the planner-jev README under Stage library) compose the stages in planner-jev's `src/lib/stages/` and `src/lib/stages-experimental/`. `jev-poc` and `jev-gated-per-instance-composed-pairs-gate-and-defer-inline` keep the select stages they were first measured with (`jevSelect` and `selectGated`). `decisions-poc` and `decisions-composed-pairs` are their OpenAI Decisions twins: the same planner builders and select stages with the Decisions client as their `Ask`, and the same replay shapes, so `--replay-arm jev-poc` replays into `decisions-poc`. `decisions-poc-prose` is `decisions-poc` with the select state sent as prose instead of JSON. `jev-poc-screen-scope` is the shipped `jevPlanner` (`buildJevPlanner`), the POC with `selectGatedScreenScope` as the select stage, and `decisions-poc-screen-scope-prose` is its Decisions twin. That select also asks the gated select's four gate questions and adds its `scope_unsupported` and `screen_content_unavailable` deferrals, so these arms differ from `jev-poc` and `decisions-poc-prose` in more than the screen scope question. The Decisions one sends the select state as prose and asks the spelled-out `needsActions` gate, which has no effect on its plans, since the POC's actions and layout stages read no gate answers. `decisions-composed-pairs-screen-scope-prose` is the composed pairs planner with that select (`buildComposedPairsScreenScopePlanner`) and its layout's fraction questions told to answer half when no fraction is stated, which Decisions otherwise refuses. `jev-composed-pairs-screen-scope` is the shipped `jevComposedPairsPlanner` (`buildJevComposedPairsPlanner`) on TypeSafe: JSON select state, the shared `needsActions` gate and the standard composed pairs layout. |
| `--repeats` | `3` | Runs per scenario and arm. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--model` | the demo's default | OpenAI model for the baseline, `llmComplete` and the fallback. |
| `--out` | `tmp/evals/<timestamp>` | Output directory (`tmp` is gitignored). |
| `--verbose` | off | Logs the Engine and every Jev call to the console. |
| `--replay-from` | none | A previous run's output directory to replay upstream stages from. Needs `--replay-through`. |
| `--replay-through` | none | `select`, `actions` or `layout`: every staged arm replays its plugin's stages up to and including the one mapped to this phase from the recorded run, and runs the rest live. |
| `--replay-arm` | none | The arm of the recorded run whose stages are replayed. Required with `--replay-from`. |
| `--grader` | off | Grades every planned shipped response with the first plugin's judge, TypeSafe today (see Grader below). |
| `--grader-validation` | none | A `grader-validation.json` written by `src/eval/grader-validate.ts`. The grader's rows appear in `report.md` only when it passed the gate. Needs `--grader`. |

Without a variable the run needs (`OPENAI_API_KEY` always, and it is all the Decisions arms need; the Jev arms also need `TYPESAFE_API_KEY` and `JEV_MODEL`, and so does `--grader`, whatever the arms) the runner writes `status.json` naming the missing variables and exits with code 2. Live runs are not part of `nx test`; the offline tests use scripted TypeSafe and Decisions transports and a mocked `chat()`.

Each staged turn writes its stages' inputs and outputs to `<out>/stages/<arm>/<scenarioId>-<repeat>.json`. Replay reads them back: a replayed stage returns the recorded output (or the same deferral), so the stage after it runs on identical upstream results. Jev and LLM replies are not deterministic, so replay isolates one stage; it never stands in for an end-to-end result. A turn with no recorded stage fails with an error naming the stage and turn. Before any call, the runner also refuses a recording that lacks what an arm's plugin says it reads from a replayed stage: stage-library arms read `minConfidence` from a replayed action plan, gated arms read every gate from a replayed selection and action plan, so a run recorded before the select stage asked a gate (such as `dependsOnScreen`) no longer replays into a gated arm and is refused as having no complete gates, and ungated arms refuse a recording that carries gates, since their actions stage would act on them. Replay gated arms from a gated arm's run and ungated arms from an ungated one.

### Stage evals

`src/core/stage-eval.ts` tests one pipeline stage on its own, so a stage can be tuned in minutes before a full-planner run. It calls the stage function directly on the input a scenario's expectation implies: no planner, no Engine, no replay and no LLM. The select, actions and layout stages are covered so far. Use it while changing a stage's questions, options or code; use the full-planner eval above for the final comparison of whole planners, since a stage that scores well alone can still lose to the completion call or the fallback.

```sh
# from the workspace root, so Bun loads .env (TYPESAFE_API_KEY and JEV_MODEL for the Jev modules, OPENAI_API_KEY for the decisions-* modules)
bun --conditions=@maelstrom-co/source packages/evals/src/eval-stages/cli.ts --stage layout --variant preset-or-llm --variant composed-pairs --suite development --repeats 3 --out tmp/evals/<name>
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--stage` | required | The stage to test: `select`, `actions` or `layout` on TypeSafe Jev, or `decisions-select`, `decisions-actions` or `decisions-layout`, the same stages and variants on OpenAI Decisions. `decisions-select-prose` is `decisions-select` with the select state sent as prose (`renderSelectStateAsProse` in planner-jev) instead of JSON. |
| `--variant` | every variant of the stage | Repeat the flag for several; columns follow the order given. Layout variants: `preset` (the preset choice with placement descriptions), `preset-or-llm` and `composed-pairs` (the composed pairs planner's layout stage), listed in `LAYOUT_STAGES`, `src/plugins/jev/stages/layout.ts`. Each is built as the matching arm in `src/plugins/jev/arms.ts` builds its layout stage. |
| `--suite` | `development` | `development`, `holdout` or `all`. |
| `--repeats` | `3` | Runs per scenario and variant. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--concurrency` | `1` | Turns in flight at once. Latency is measured per call, so raising it can inflate the latency rows. |
| `--out` | `tmp/evals/stage-<stage>-<timestamp>` | Output directory. |
| `--verbose` | off | Logs every provider call to the console. |
| `--spatial-signal` | `gold` | Layout only. `gold` feeds the stage the scenario's spatial tag; `recorded-live` feeds it the `spatial` gate a live planner answered, read from `--spatial-records`, and keeps the gold gate for a turn that recorded none. |
| `--spatial-records` | none | Layout only. The `records.json` of a full planner eval to read the spatial gates from. Needs `--spatial-signal recorded-live`. |
| `--spatial-records-arm` | `jev-gated-per-instance-composed-pairs-gate-and-defer-inline` (`decisions-composed-pairs` for `decisions-layout`) | Layout only. The arm of `--spatial-records` whose gates are read; it must be an arm of the module's own plugin (a Jev arm for `layout`, a Decisions arm for `decisions-layout`). Needs `--spatial-signal recorded-live`. The run fails before any turn when that arm recorded no spatial gate in the file, or none for the selected scenarios and repeats, rather than running every turn on gold. |

The layout stage gets gold inputs from `src/plugins/jev/gold-inputs.ts`: the expected selection and action plan, with every gate (`spatial` yes only for scenarios tagged `spatial: true`). A scenario that cannot form them (it expects a deferral, or states no visible set or actions) is recorded once per variant as not applicable and does not run. A scenario that expects the layout stage itself to defer runs instead on the board as it is (`layoutDeferralGoldInputs`) and passes only on the expected reason: `jevLayout/spatial_not_stated` when its `deferCause` is `arrangement_not_stated` (the request asks for an arrangement the pair questions cannot express, so they leave the board unchanged), and `jevLayout/no_feasible_layout` otherwise. The preset variants never give the first reason, so they never pass those scenarios. Each turn ends in one outcome:

- **pass** or **fail**: the decision wrote a tree, scored with `scoreLayout` (the tree's leaves against the expected visible set, then the arrangement rules of `src/core/predicates.ts`, including `unchangedTree`) and a fit check (every visible Instance once, within the Chart, at its variant's minimum size).
- **handed off**: the decision has no tree, so the completion call would write the layout; neither pass nor fail.
- **deferred** or **error**: the stage deferred (a provider failure, an answer missing) or failed.

`records.json` keeps every turn with its outcome, failures, the decision (source, tree, answers), and under `calls` every Jev call with its raw answers, probabilities, usage, latency and the state the stage sent, for debugging prompts. `meta.json` holds the run's settings. `report.md` has one column per variant: turns run, the pass rate with hand-offs and deferrals counted as failures, the pass rate over the turns that wrote a tree, hand-off rate, deferrals and errors, not-applicable scenarios, Jev calls per turn, Jev call latency p50 and p95, stage latency, Jev tokens per turn, and one row per deferral reason. For the composed pairs variant a further table shows the gating routes (turns and calls), hand-off causes, the chosen candidate's rank, size fallbacks, the pair answers compared with the scenario's reference tree (wrong, not stated, wrong in the returned tree, the reference among the top candidates), direction answers, size rule failures and size answer confidence. The reference tree is the scenario's `tree`, or the current tree when the scenario expects it unchanged. A per-scenario table lists passes over turns run for every variant, with hand-offs (`h`), deferrals (`d`) and errors (`e`), so a regression on one scenario stands out.

The actions stage gets the expected selection alone from `goldSelection` in `src/plugins/jev/gold-inputs.ts`, with every gate (`needsActions` yes when the scenario expects an action, an ask or a parameter with no listed match). Its variants, in `ACTIONS_STAGES` in `src/plugins/jev/stages/actions.ts`, are `stepwise` (the POC's one call per step) and `batched-per-instance` (the composed pairs planner's one call over every instance). A scenario that states no actions, asks or `noListedMatch` parameters is not applicable. A plan passes when Jev bound every expected action and parameter itself; a plan that is right only because the completion call would fill a `stated_elsewhere` value is **handed off**, since the stage left the value to the LLM. For a scenario with `noListedMatch` parameters the plan passes unless it binds one of them or repeats its action. Every turn records the actions planned more often than the scenario expects them and the actions it does not expect, and the report adds a table of both per variant and per scenario.

```sh
bun --conditions=@maelstrom-co/source packages/evals/src/eval-stages/cli.ts --stage actions --suite development --repeats 5 --out tmp/evals/<name>
```

A new stage joins by implementing `StageEvalModule` (`src/core/stage-eval.ts`: its variants over the deps `makeDeps` builds, how a scenario forms its input, how an output is judged, any CLI flags, and any extra report sections) and listing it in its plugin's `stageModules`.

#### Select stage

The select stage eval judges the gates and the selection of the composed pairs planner's select stage (`selectGated`). A turn passes when every gate with an expected answer matches and, when the scenario expects a visible set, the selection leaves exactly that set visible; a turn that deferred has no selection, so it fails a scenario expecting one. It runs on each scenario's own planning input, since the gates are the stage's answer to the request itself; there is no gold input. Every variant reads the gate answers from the stage's reply with `readGateAnswers`, the function the stage decides with, so a turn where the stage answered the gates and then deferred (a `generatedContent` or `dependsOnScreen` yes, an ambiguous scope) is still judged and records the deferral reason. A deferral whose reply carries no gate answers is recorded as that deferral, unjudged. A provider failure, an over-cap question or a missing answer is recorded as an error, so a provider outage shows in the error count.

The variants, in `SELECT_VARIANTS` in `src/plugins/jev/stages/select.ts`, are `gated`, which runs `selectGated`, and two that run `selectGatedScreenScope` (planner-jev, experimental) instead. `gated-screen-scope` asks the same call plus a screen scope question (does the request add to or adjust the screen, or describe the whole screen) and a hide question per visible instance, with worked examples on the screen scope and keep questions; on an additive or adjusting request a visible instance stays visible unless its hide question answers yes. `gated-screen-scope-spelled-out-actions` also asks `needsActions` with item edits and settings spelled out; it helps Decisions, while TypeSafe answers it too high for its `NEEDS_ACTIONS_THRESHOLD`. The report's Selection section counts, per variant, the turns that selected the expected visible set, another set, or none, and lists every miss with both sets, so gate accuracy and visible-set accuracy can be read apart.

The expected answer per gate comes from `expectedGateAnswers` in `src/plugins/jev/gold-inputs.ts`: a scenario's explicit `expectedGates` entry wins; otherwise `needsActions` is yes when a planned scenario expects an action, an ask or a parameter with no listed match and no when it states its actions and all are empty, `spatial` follows the spatial tag, and `generatedContent` and `dependsOnScreen` are no for a planned scenario. Gates the planner does not ask are ignored, and a scenario with no expected answer for any asked gate is not applicable. A turn passes when every judged gate matches and the selection leaves the expected visible set, if any. It fails with one failure per wrong gate, naming the expected answer, the answer and its probability of yes, and one more when the scenario expects a visible set and the selection leaves another set visible or the stage deferred without one. `records.json` keeps every gate's answer, probability and confidence, the expected answers and the deferral reason. `report.md` adds a table of judged turns, false positives (yes where no was expected) and false negatives per variant and gate, then every miss with its scenario, suite, repeat and probability, sorted by gate, expected answer and probability, so the effect of another threshold can be read off.

The gate scenario definitions live in `scenarios/v1/snapshots`, on the demo board and on a second board of non-demo Vessels (`src/core/fixtures/workspace-vessels.ts`: a music player, a stock watchlist and CRM contacts), so gate wording is not tuned to the five demo widgets alone.

```sh
bun --conditions=@maelstrom-co/source packages/evals/src/eval-stages/cli.ts --stage select --variant gated --suite development --repeats 3 --out tmp/evals/<name>
```

### Comparing providers

The Decisions plugin exists to compare OpenAI Decisions with TypeSafe Jev answering the same stage questions. A stage comparison is two stage-eval runs on the same suite, variants and repeats, read side by side:

```sh
bunx nx run @maelstrom-co/evals:eval-stages -- --stage select --variant gated --suite all --repeats 3 --out "$EVAL_OUT/stage-select-jev"
bunx nx run @maelstrom-co/evals:eval-stages -- --stage decisions-select --variant gated --suite all --repeats 3 --out "$EVAL_OUT/stage-select-decisions"
bunx nx run @maelstrom-co/evals:eval-stages -- --stage actions --variant stepwise --variant batched-per-instance --suite all --repeats 3 --out "$EVAL_OUT/stage-actions-jev"
bunx nx run @maelstrom-co/evals:eval-stages -- --stage decisions-actions --variant stepwise --variant batched-per-instance --suite all --repeats 3 --out "$EVAL_OUT/stage-actions-decisions"
bunx nx run @maelstrom-co/evals:eval-stages -- --stage layout --variant preset --variant composed-pairs --suite all --repeats 3 --out "$EVAL_OUT/stage-layout-jev"
bunx nx run @maelstrom-co/evals:eval-stages -- --stage decisions-layout --variant preset --variant composed-pairs --suite all --repeats 3 --out "$EVAL_OUT/stage-layout-decisions"
```

A full comparison is one run with every arm side by side, plus `paired.md`:

```sh
bunx nx run @maelstrom-co/evals:eval -- --arm baseline --arm jev-poc --arm decisions-poc --arm jev-gated-per-instance-composed-pairs-gate-and-defer-inline --arm decisions-composed-pairs --suite all --repeats 3 --out "$EVAL_OUT/full-comparison"
```

The nx targets run in `packages/evals`, so pass an absolute `--out` (`EVAL_OUT` above). Keep the stage evals at `--concurrency 1` (the default; the full-planner eval has no such flag) and run each Jev and Decisions pair back to back, so latency is not inflated and load hits both alike. The completion call and the fallback use `--model` for every arm alike. In the full-planner report the rows labelled "Stage calls", "Stage call latency" and "Stage tokens" are shared by both plugins and count TypeSafe calls in a Jev column and Decisions calls in a Decisions column; the stage-eval report labels its call rows with the module's provider (`Decisions calls per turn`). A Decisions refusal of any question defers the stage as `<stage>/provider_refusal`, shown among the fallback reasons.

### Reading the report

`report.md` puts the arms side by side for each suite, one column per arm in the order given (`records.json` has every turn, `summary.json` the numbers and the run's settings, including `replay` when stages were replayed). `paired.md` lists every scenario and repeat where the arms disagree on pass, with each arm's failures.

- **Overall pass**: shipped responses with the expected visible and retained instances, the expected ordered actions and parameters, the scenario's arrangement rules, and every existing instance declared in the variant the shipped execution plan leaves it in. New instances match by Vessel and order, so the baseline's own ids score fairly. Scenarios where the POC is expected to defer are left out of every arm and reported as **Expected deferrals at the right stage** for the Jev arms.
- **Arrangement pass**: the shipped tree against the scenario's arrangement rules (`src/core/predicates.ts`: order, left of, above, dominant share, full width or height, side by side, stacked, unchanged tree, area ratio), whichever arm or fallback wrote the tree. The denominator is every planned turn whose scenario declares rules; a turn that errored, shipped no response or shipped a non-tiling layout counts as a failure.
- **Decisive turns** (Jev arms): planned turns no stage deferred, their pass rate, and wins and losses against the baseline on the same scenario and repeat.
- **Selection / Actions / Layout accuracy** (Jev arms): each stage's own output against the expectation. Selection compares the visible and retained sets, actions compare the ordered actions, bound parameters and asks (a `stated_elsewhere` slot counts when the expectation has a value for it), layout compares the tree's leaves with the visible set and checks the arrangement rules.
- **Fallbacks** (Jev arms): the fallback rate, then one row per `<stage>/<code>` deferral reason.
- **llmComplete fill rate**: filled `stated_elsewhere` slots over all such slots; a `param_unfilled` deferral counts all of its turn's slots as unfilled.
- **Gates**: for arms whose select stage asks gates, false positives and negatives over the turns whose live select call answered them, each gate answering yes from the select stage's own threshold: `needsActions` against whether the scenario expects any action, `spatial` against its spatial tag. Without gate answers the spatial row shows how many turns are tagged spatial and how many are non-spatial controls.
- **Arrangement turns reaching jevLayout**: planned turns with arrangement rules whose layout stage ran or was replayed, rather than an earlier stage deferring.
- **Stage calls per turn**: provider calls (TypeSafe or Decisions) over all turns of the arm.
- **Latency**: p50 and p95 of the whole turn, each live stage (replayed stages show `replayed`), each stage call and each LLM call by role.
- **Tokens**: stage call usage from the provider replies, in total and per turn, and OpenAI usage per role (`planner`, `fallback`, `complete`), recorded by wrapping the text adapter.
- **Cache and cost**: reported cache-read tokens, cache-write tokens, and monetary cost, in total and per LLM role. Each row shows calls reporting that counter over all calls. An unreported counter shows `n/a`; a reported zero shows `0`. Cache counters never increase the input-token total. Cost uses the provider's units, with no price estimate or currency conversion. Compare costs only within the same provider and currency. These rows exclude the grader.

### Measure a cache baseline

Use the existing full-planner runner before changing prompts or cache settings. Run from the workspace root with Bun dependencies installed and `OPENAI_API_KEY` configured. This command makes paid provider requests.

1. Record five repetitions of one fixed case, with only the baseline arm and an explicit model:

   ```sh
   bun --conditions=@maelstrom-co/source packages/evals/src/eval/cli.ts --arm baseline --suite development --case swap --model gpt-6-luna --repeats 5 --out tmp/evals/cache-baseline
   ```

2. Inspect `tmp/evals/cache-baseline/records.json` for per-call cache counters and latency. Compare the first repetition with later repetitions, but do not assume the first request was cold. The provider may already cache its prefix. This workload repeats a fixed request without growing history; it does not model a conversation.
3. Check `report.md` for planner-call latency p50/p95, cache counter coverage, errors, and arrangement pass. Five repetitions are a smoke baseline, not enough to establish a performance gain. TanStack's OpenAI and Gemini adapters at version 1.0.0 omit zero cache-read counts. A provider-reported zero can therefore appear as `n/a`; counter-reporting coverage is not a cache-hit rate. OpenAI may omit cache-write counts and monetary cost; missing values are not zero cost or zero cache writes.
4. Repeat into a new output directory with the same model, cases, repeat count, and concurrency. Change one setting at a time. Record cache-read coverage for both runs, and retain per-call results to check variance. Control the warm-up procedure so a warm cache does not look like a prompt improvement. Reject a latency improvement that reduces planner quality.

Use `summary.json` for machine comparisons: `tokens.llm.cacheRead`, `cacheWrite`, and `cost` each contain `total`, `reportedCalls`, and `missingCalls`. `tokens.llm.byRole` carries the same fields. Totals sum only reported values. Keep a short record of the baseline, result, and verdict for each experiment, including rejected experiments.

### Grader (secondary)

`src/core/grader.ts` rates each shipped response of a planned scenario with one judge call, a TypeSafe call asking two `score` questions of five descriptive levels each: `request_satisfied` (did everything the user asked happen, and nothing else) and `arrangement_match` (does the layout match the stated arrangement, or with none stated, keep the previous one or use a sensible default). The state it reads is the user's intent, the layout before and after in words (`src/core/verbalize-tree.ts`), the shipped execution plan and the user message. A score is the fractional level normalised to 0 to 1. A dimension whose two most probable levels are within 0.15 of each other is asked twice more on its own and scores the mean of the three samples. Grading runs after the turn's latency is measured, on its own TypeSafe client: its usage is reported in the grader rows and never in an arm's stage tokens. A failed grade (provider error, deferral, or `grader/exception: <message>` when the judge throws, with the judge calls made before it) is recorded in the turn's `grader` field and counted, and never changes the turn or any rule-based metric.

The rule-based pass stays the primary metric. The grader reads the LLM-written `userMessage` and the plan, so it may prefer fluent messages and plans shaped like Jev's own (self-preference). That is why it is secondary and must be validated before it appears in a report:

```sh
# from the workspace root, so Bun loads .env
bun --conditions=@maelstrom-co/source packages/evals/src/eval/grader-validate.ts --records tmp/evals/<run>/records.json
```

It grades the hand-labelled responses and every planned development turn whose scenario declares arrangement rules, then writes `grader-validation.json` next to the records (or under `--out`). Grades are cached in `grader-scores.json` (`--scores` to name another file) and reused while the grader and verbalizer versions match, so a re-validation calls TypeSafe only for responses not yet graded. `--arm` narrows the arrangement turns to some arms, `--limit` caps how many responses are graded live, `--offline` grades nothing and validates the cached grades, `--labels` reads another labels file, and `--verbose` logs every call and provider error. A record written before the grader existed carries no shipped plan: its completion stage's candidate, healed again by the Engine, stands in when the turn did not fall back and the healed message and tree are the ones the record shipped; for a turn recorded against a scenario that expected no actions, the rule-based score proves an empty plan; any other such turn is skipped and counted in the summary line.

The labels live in `src/core/fixtures/grader-labels.ts`, which exports `graderLabels`: hand scores from 0 to 1 per dimension for 15 to 20 recorded responses, each identified by the record's `scenarioId`, `arm` and `repeat` (type `GraderLabel` in `src/core/grader-validate.ts`), with an optional `note`. Without the file there are no labels. Validation reports, per dimension, the Spearman rank correlation and the mean absolute error against the labels, and the pass/fail agreement (a grade of at least 0.5 against the rule-based arrangement pass). The gate passes when at least 10 labels matched, the weaker dimension's rank correlation is at least 0.7 and agreement is at least 85%, with the current grader and verbalizer versions. Otherwise, or without `--grader-validation`, `report.md` prints `grader: unvalidated (rho=..., agreement=...)` in place of the grader rows, `n/a` for a value that could not be computed; `summary.json` keeps the grader numbers either way.

`records.json` also carries every answer of the turn's live Jev calls with its confidence (deferred stages included; replayed stages make no calls) and the lowest confidence among the answers the completed stages consumed, replayed stages included. It is recorded, not enforced.
