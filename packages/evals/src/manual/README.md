# Manual D02 identity sample — current Engine

This opt-in tool runs one three-turn synthetic identity conversation through the
current `@maelstrom-co/engine`, `@maelstrom-co/planner-llm` and OpenAI adapter.
It is separate from the existing experiment CLIs and the scripted offline case
composition. It has no live Nx or CI target and never runs on import.

## Before a live run

The operator must have confirmed that **the dedicated key supplied to this
process has an active, enforced $0.05 spending ceiling**, enough allowance remains,
and no other process is consuming that key. An alert or delayed budget is not a
hard cap. Do not paste the key into chat or a command line. Provide it through
`OPENAI_API_KEY` in the process environment.

`--confirm-capped-key` records the operator acknowledgement; the tool cannot verify
provider billing policy. There is deliberately no local dollar guard or paid
input-token-count request. Do not launch until review and cap confirmation are done.

From the workspace root, inspect the non-network plan first:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d02.ts
```

Only after explicit authorization and the prerequisites above, the manual invocation is:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d02.ts --live --confirm-capped-key
```

The tool does not load dotenv. No key is read in dry-run mode. Unknown flags,
missing live acknowledgement/key, a different `ENGINE_MODEL`, endpoint override,
or custom headers fail before dispatch. The `gpt-6-luna` pin is checked against
the current app's `DEFAULT_ENGINE_MODEL` source on every invocation; a changed
source default stops this tool instead of silently testing the wrong model.

## What gets tested

- Three exact user intents and independent expectations from
  `cases/v1/assistant-identity-subset.json`; **no scripted response fixture is loaded**.
- MAR's supplied identity through the supported `prompt.system.identity` option;
  the remaining prompt sections come from the current LLM planner. The appended
  rules are the current eval baseline's imported `SYSTEM_RULES`, not a copy of
  an old full-system prompt.
- One new in-memory Engine history store and session, three unique request IDs,
  sequential `Engine.handle` calls, and prior **returned assistant replies** fed
  into subsequent planner requests. Initial state is an empty 16-column × 12-row
  tiling Chart with no registered Vessels or Instances.
- D02's deterministic substring, nonempty text, empty Execution Plan and empty
  tiling-layout predicates against the **shipped Engine responses**. The Engine
  may heal a candidate before scoring; this is not a raw-candidate safety oracle.

This is a current SDK Engine/planner configuration test, **not demo-factory parity**:
no demo server, browser, client handlers, Jev stages, or legacy Engine are involved.
The app model default is shared by a source drift check; prompt rules are the eval
baseline's (the demo has additional calendar-context rules). Engine/SDK retry
policies are deliberately disabled for this authorized sample.

## Dispatch and evidence boundaries

- At most one generation transmission per turn and three per invocation. Failed,
  uncertain, truncated, or malformed responses end the run without replacement.
  Success has three completed turns; interrupted runs may have fewer.
- Engine `retry: false`, OpenAI SDK `maxRetries: 0`, 30-second SDK timeout and
  35-second turn abort. Redirects are rejected. The final wire guard permits only
  `POST https://api.openai.com/v1/responses`, the pinned model, explicit standard
  service tier, text/history plus structured-output schema, `store: false`, and
  no tools, server-side conversation references, or encrypted reasoning replay.
- Output is limited to **2,048 tokens per turn, including reasoning**, a bounded
  setting for this short identity sample. Truncation is incomplete evidence, not
  a reason to retry. Reasoning effort is otherwise the model default.
- No judge by default; optional secondary judging is described below. No fallback, token-count API, Langfuse, telemetry attachment/upload,
  external history store, or automatic report publication. `store: false` is not
  a guarantee about the provider's separate abuse-monitoring retention policy.
- JSON output includes configuration, session/sample identity, generation count,
  completed responses and deterministic verdict. Errors are fixed safe messages:
  provider errors can echo credentials and are never logged or serialized.
  Exit code is nonzero for failed or incomplete live evidence.

The key cap applies at the provider; rerunning the command is another invocation,
not an automatic retry. Do not rerun after a failed/uncertain run without a new
explicit decision. No model call has been made during implementation or offline tests.

The declared D02 response predicate and prompt/history delivery checks are
**COMPLETE for their bounded scope**; one current-Engine sample passed. Case
review remains pending. This is not universal identity reliability, semantic
answer quality, human baseline acceptance or full legacy migration. The lexical
predicate is unchanged. Completion follows the
[case convention](../../cases/README.md#completion-scope), independent of each
new run's outcome and semantic review.

## Offline verification

The tests use the real Engine, planner, TanStack/OpenAI SDK and a fake fetch
transport; global network is denied. They check MAR propagation, actual retained
replies, request/schema contents, per-turn dispatch limits, failure/secret handling,
and that dry-run/import do not dispatch. They never use a real environment key.

```sh
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/manual/d02.test.ts
bunx nx run-many -t typecheck,test,check -p @maelstrom-co/evals --skip-nx-cache --skipSync
```

`--skipSync` is the workspace's existing TypeScript reference-drift workaround,
not a skipped test or a live-evaluation switch.

## Manual D14 refusal sample

`d14.ts` follows the same explicit opt-in and external capped-key prerequisites,
but runs **at most one generation transmission** for one fresh current Engine
session. It uses the exact arbitrary-JSON request from
`cases/v1/assistant-non-json-subset.json`. It does not load that case's canned
response (`I like trains.`), the legacy Engine, or a Gemini adapter.

The current `llmPlanner` supplies the default Maelstrom identity and its existing
shared refusal rule: decline arbitrary JSON and offer help through Vessels. As in
D02, only the current eval baseline's `SYSTEM_RULES` are appended; this is not
exact demo-factory parity. The request starts with an empty 16 × 12 tiling Chart,
no Vessels/Instances, and a fresh in-memory history store. The test must not invent
available Vessels just to demonstrate redirection.

Inspect the non-network configuration first:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d14.ts
```

Only after review and authorization for this **separate** sample, using the
confirmed capped key with allowance remaining:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d14.ts --live --confirm-capped-key
```

No retries, fallback, judge, tools, token-counting call, Langfuse, telemetry upload,
CI trigger, or local dollar guard is added. Engine and SDK retries are disabled;
`transport.ts` shares D02's final-wire restrictions with a one-turn limit for D14.
D02 retains its three-turn limit. The 2,048-token output bound includes reasoning;
HTTP errors, incomplete streams, malformed output and timeouts terminate the
sample without another transmission. Empty/whitespace-only `userMessage` is
rejected by the current Engine, so it produces error/unscored evidence rather
than a shipped response that the scorer could accept. Provider errors are never
printed; no credentials are read in dry-run mode.

### Reading the D14 result

- `result.observation` is the **actual shipped Engine response**, including its
  `userMessage`, Execution Plan and layout; it is not the unhealed model candidate.
- `result.evaluation` checks **only** nonempty text and rejection of parsed JSON
  objects/arrays. It does not certify refusal or redirection. Primitives, `null`,
  malformed/fenced JSON, unrelated prose, and even explicit willingness to comply
  can pass this weak historical syntax rule. Offline controls preserve this gap.
- `semanticReview.status` remains `pending-human-review` for any complete response
  (including a syntax failure), with the text and two review criteria. If no
  complete response exists, it is `unavailable` rather than a semantic pass.
- The human review must decide whether the answer **declines arbitrary JSON** and
  **explains/offers Vessel-based help**. No substring heuristic, model judge or
  automatic semantic verdict substitutes for that assessment.
- Exit code 0 in live mode means the syntax predicate passed and evidence is ready
  for review—not that the full D14 behavior passed. Syntax failure or incomplete
  execution exits nonzero. Record the semantic assessment separately against the
  sample's run ID; do not rerun to repair a failed answer without new approval.

D14's source text predicate and separate user-defined lexical refusal/redirection
rubric are **COMPLETE for their respective scopes**, not semantic or state-safety
certification. The user accepted one earlier response, not future runs or canonical
case content; case/new-sample review stays pending. One sample does not establish
reliability, human baseline acceptance or full legacy migration. Preparing this
runner and executing its offline tests makes **no live provider call**.

Offline checks for both manual paths:

```sh
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/manual/d02.test.ts packages/evals/src/manual/d14.test.ts
bunx nx run-many -t typecheck,test,check -p @maelstrom-co/evals --skip-nx-cache --skipSync
```

## Manual D17 ambiguous weekly-view sample

`d17.ts` prepares the user-approved **one-turn** experiment: with Weather/current
and Calendar/month visible, “Switch to the weekly view” should ask which one the
user means and leave the entire represented Chart unchanged. This is stricter
than the canonical `no-dual-target-plan` subset, which only forbids targeting both
protected IDs. The target-exclusion predicate is unchanged and COMPLETE for its
declared scope; case review remains pending.

The request uses the existing `request()` builder with a 30-column × 18-row tiling
Chart, `['V', 'ID:weather-main', 'ID:calendar-main']`, and exactly those two Instance
snapshots. Two fixed code-owned runtime import URLs load the **actual current**
`apps/demo/src/vessels/weather.vessel.def.ts` and `calendar.vessel.def.ts` exports;
`VesselSchema` validates them before construction. These paths are not chosen by
case data. This avoids importing the demo into the eval package's TypeScript build
graph while avoiding a stale copied catalog. The complete definitions retain both
choices: Weather/current `showWeekly` → weekly and Calendar/month `showWeek` → week,
plus their other Variants and Actions. No browser, handler or demo server is started.

The supported current `llmPlanner` prompt is used **as-is**, with the same eval
`SYSTEM_RULES` as D02/D14. No target-disambiguation instruction, desired answer or
expected unchanged layout is added to the prompt. The existing shared rule refers
to unclear resulting state; it does not explicitly guarantee ambiguous-target
clarification. This experiment measures that behavior instead of changing it to
make the test pass. It remains an SDK Engine/eval configuration test, not exact
demo-factory parity.

Inspect the configuration and full initial request without reading credentials or
making network requests:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d17.ts
```

Only after independent review, explicit authorization for this separate sample,
and confirmation of the dedicated capped key with allowance remaining:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d17.ts --live --confirm-capped-key
```

The runner pins the current app model `gpt-6-luna` and verifies source/override drift.
It uses one fresh in-memory Engine session, one `Engine.handle` and at most one
provider transmission through the unchanged `manualTransport` one-turn gate.
Engine/SDK retries are disabled; errors, incomplete streams and timeouts stop the
sample. No fallback, judge, tools, Langfuse, telemetry upload, token-count call,
CI target, or internal dollar guard is added. The same 2,048-token output bound,
30-second SDK timeout and 35-second turn abort as D14 apply. Failure is not permission
to rerun. The runner acknowledges but cannot verify the externally enforced cap.

### Reading the D17 result

- `configuration.initialRequest` and the turn record retain an independent initial
  request. The Engine receives a clone, so processing cannot change the expected
  state. `result.observation` is the actual **shipped** Engine response.
- The Execution Plan must be empty, even when an Action would not change a Variant.
  Full layout equality covers type, split tree/order/weights/visibility and the
  complete Instance snapshot array; snapshots also match the request's top-level
  Instances. Equality ignores object-key order but not array order. No subset,
  target-only, or geometric-equivalence comparison silently permits changes.
- The mutable Chart state in this wire contract is layout plus Instance snapshots
  (ID, Vessel ID, Variant). Catalog/context are input-only; there are no handlers
  or mounted UI here. Equal shipped state is not proof of client effects or raw
  candidate safety: Engine healing may drop an invalid Action before scoring.
- The lexical clarification signal requires one question ending in `?` containing
  the whole words `Weather`, `Calendar`, and a choice cue (`which`, `whether`, or
  `or`), case-insensitively. Missing question/choice signals and state/Action
  failures are reported separately. Neither a question mark nor these words prove
  intent understanding. A valid paraphrase can fail this deliberately narrow
  check; contradictory prose can pass it. Tests explicitly expose that limit.
- Every complete reply remains `semanticReview.status: pending-human-review`, even
  after a predicate failure. Review whether it **genuinely asks which option** and
  does not claim it already changed something. No complete response means semantic
  review is `unavailable`. Exit 0 is predicate success, not semantic approval.

The bounded D17 target-exclusion and manual structural checks are **COMPLETE**.
The user accepted one earlier sample; that approval applies only to that response,
not future runs or general reliability.
Each new complete run remains pending human review. Preparing the runner and
running its fake-transport tests makes no live call; one sample is not full
migration completion.

Offline verification (including the unchanged D02/D14 regression suites):

```sh
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/manual/
bunx nx run-many -t typecheck,test,check -p @maelstrom-co/evals,evals-offline --skip-nx-cache --skipSync
```

## Manual D25 ordinary Weather conversation

`d25.ts` prepares a single **three-turn** current-Engine Weather session. It reads
only the canonical case definition, not the scripted response fixture. It retains
these exact fallback prompts from the narrowed D25 case:

1. “What's the weather like?”
2. “You mentioned it might rain — show me the hourly forecast”
3. “Thanks for the details”

A fixed code-owned import URL loads the actual demo `weatherVessel`, validates it
with `VesselSchema`, and builds a 30-column × 18-row tiling Chart with only
`weather-main/current` visible. The default Maelstrom identity and current eval
`SYSTEM_RULES` are unchanged. No D25-specific instruction, fabricated weather
conditions, seeded transcript or injected assistant message is added. This uses
the current Engine/LLM planner; it is not exact demo-factory parity.

Inspect without credentials or network:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d25.ts
```

After independent review and explicit authorization for this one session, with
confirmation of the externally enforced **$0.05 key cap** and remaining allowance:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d25.ts --live --confirm-capped-key
```

The model is pinned to `gpt-6-luna` and checked against the app default; model,
endpoint and custom-header drift fail before dispatch. Dry-run returns before
credential access. A fresh in-memory store/session owns three sequential
`Engine.handle` requests, with one generation transmission per turn and **at most
three total** through the unchanged shared transport. Engine/SDK retries are off;
there is no fallback, judge, tool execution, telemetry upload, Langfuse, CI target,
provider preflight, local dollar guard or `.env` loader. The external cap is an
operator acknowledgement, not code-verified billing evidence. Each turn has the
same 2,048-token output bound, 30-second SDK timeout and 35-second abort as the
other manual runners. Timeout, truncation, malformed/incomplete response, or any
runtime/provider error stops the sequence without retry; failure is not permission
to run again.

### Reading the D25 result

- `configuration.initialRequest` is an independent initial snapshot. Each next
  request carries the **actual shipped** layout and Instance snapshots from the
  previous turn, never the expected Variant. No browser or Action handler runs.
- Each completed turn includes its request, shipped response and actual history
  handed by the Engine to `llmPlanner`. A read-only planner wrapper captures it
  without altering the input or prompt. `diagnostic` records with
  `value.type: planner-input` retain this input even on a failed turn; `turn`
  records exist only for complete responses. Partial response evidence is unscored.
- The deterministic verdict checks exactly three ordered requests and state
  carry-forward, exact prior user/assistant message delivery, an empty Execution
  Plan on turns 1 and 3, and a matching `weather-main/showHourly` on turn 2. Each
  response must be tiling with its first `weather-main` member belonging to
  Weather and in `current`, `hourly`, `hourly` respectively. Additional turn-2
  Actions, other Instances and tree geometry are **not scored**. Engine healing
  can remove invalid raw Actions before this check.
- This manual predicate does **not** reuse the weak legacy `rain|mentioned|said`
  substring as a semantic oracle. Complete replies remain
  `semanticReview.status: pending-human-review`, even if deterministic checks
  fail. Inspect the actual earlier reply before accepting a claim that it
  mentioned rain, and check for unsupported forecast/data claims: no actual
  weather data is supplied or fetched here.
- Delivered history is not proof the model used it. The second prompt already
  says rain and hourly; even unrelated prose can pass the structural checks.
  This is not a causal history-dependence experiment, assistant-message injection
  test, security claim, handler-effect test or reliability baseline. No exact
  spend is inferred from the response.

The narrowed ordinary-history delivery check is complete: its scripted transport
test compares the exact ordered `body.input` role/content sequence on each turn,
including prior actual user/assistant messages and the current prompt; independent
review passed. One current-Engine sample passed structural checks. This verifies delivery only, not semantic model reliance. The test builds its
expected current input with `buildUserPrompt`; production uses the snapshot-aware
sibling `buildUserPromptWithSnapshot`, so the assertion does not independently
verify prompt construction or snapshot-specific fields.

The narrowed D25 ordinary-history contract is **COMPLETE**; source scoring rules
and fixture outputs are unchanged, and case review remains pending.
Assistant-message injection robustness and semantic reliance are **out of scope**.
Preparation and fake-transport tests make no provider calls. One sample does not complete the
migration. Run all manual regressions and the affected uncached gates
using the offline verification commands above.

## Manual D38 / D39 / D40 / D41 current Weather samples

`weather.ts` requires exactly one explicit `--case D38`, `--case D39`, `--case D40` or `--case D41` selector.
It defaults to dry-run for that case; it never batches cases or runs on import.
Unknown IDs (including D42), positional IDs, repeated selectors and repeated flags
fail before dispatch. The pinned dataset contains D01–D41; no D42 is invented.

- **D38** (`weather-current-noop-subset`, `/items/37`): “Show current weather”.
  Starts with one visible `weather-main/current`. The deterministic check requires
  an empty Execution Plan and an exactly unchanged shipped Chart. It covers only
  the stay-current branch. Offering hourly/weekly choices is optional prose, not
  an automated semantic predicate.
- **D39** (`weather-action-backed-transition`, `/items/38`): “Skip to weekly forecast”.
  Starts at `weather-main/current`; requires matching `showWeekly` targeting that
  existing Instance and shipped Weather/weekly. An actionless jump or unrelated
  nonempty plan fails. Unlike D40/D41, extra Actions/params, other Instances and
  geometry are unscored; passing is not whole-plan safety or handler evidence.
  The source's “without proper transition” allows this declared Action. The
  legacy single-turn scorer permits it too, but uses a weaker nonempty-plan check.
- **D40** (`weather-deterministic-cycle`, `/items/39`): “Show me the hourly forecast”,
  “Now go straight to weekly”, then “Go back to current”. Actions are exactly
  `showHourly`, `showWeekly`, `showCurrent` on `weather-main`; shipped Variants are
  `hourly`, `weekly`, `current`, starting from `current`. This follows the dataset,
  deliberately not the legacy scorer's mismatched hourly/current/weekly sequence.
  The historical mismatch remains recorded, not resolved by a live sample.
- **D41** (`weather-deterministic-return`, `/items/40`): “Show hourly”,
  “Just show current right now - skip weekly”, then “Go to weekly”. The required
  Actions are exactly `showHourly`, `showCurrent`, `showWeekly` on `weather-main`;
  shipped Variants are `hourly`, `current`, `weekly`.

For D40 and D41, each Action must be available in the **incoming** Variant of the
actual current Weather catalog. Additional Actions or parameters,
new/changed/duplicate Instances, or tree changes fail. Canonical prompts,
trajectory and lineage are validated separately for each selected case; D40 and
D41 cannot silently use each other's sequence.

All four use the complete actual demo `weatherVessel` through a fixed runtime import,
a 30×18 tiling Chart with `['ID:weather-main']`, and the existing current
`llmPlanner` prompt plus eval `SYSTEM_RULES`. No case-specific prompt instruction,
seeded assistant message, weather data, location or handler is added. The script
reads the canonical case definitions for prompt/lineage validation; neither the
D38 canned response nor the D39/D40/D41 script fixtures supply model observations.
This is an SDK Engine/eval configuration experiment, not demo-factory parity.

Inspect a selected plan without credentials or network:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D38
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D39
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D40
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D41
```

Only after independent review, authorization for the selected sample, and the
external capped-key prerequisites above, invoke **one** selected sample:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D38 --live --confirm-capped-key
```

The separate one-turn D39 sample, only when authorized under the same prerequisites:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D39 --live --confirm-capped-key
```

No live D39 invocation was made during implementation. Its COMPLETE label means
the bounded predicate is encoded and tested, not model compliance or human acceptance.

The separate D40 session, only when authorized under the same prerequisites:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D40 --live --confirm-capped-key
```

The separate D41 session, only when authorized under the same prerequisites:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/weather.ts --case D41 --live --confirm-capped-key
```

Live execution requires both flags, the current `gpt-6-luna` pin/default check and
an explicit key. Endpoint/custom-header overrides fail before dispatch. No `.env`
is loaded. The **external $0.05/key cap and remaining allowance are not verified**
by the runner; no internal dollar guard or preflight/token-count call is added.
The unchanged shared transport permits at most one transmission for D38 or D39, or one
per turn / three total for D40 or D41. Engine/SDK retries are zero. Errors, aborts,
timeouts, malformed responses and incomplete streams stop the sequence; no rerun
is implied. There is no fallback, judge, tool execution, upload, Langfuse,
telemetry export or CI/live Nx target. The 2,048-token output bound and 30-second
SDK / 35-second turn deadlines match the other manual tools.

Every invocation owns a fresh Engine/session/history store. Requests carry the
actual preceding shipped layout and Instance snapshots, never expected values.
Turn records contain the request, shipped response and captured prior planner
history; diagnostic records retain planner inputs on failure. Exact user and
assistant history delivery is checked independently of the Chart/Action oracle.
The initial request is cloned before dispatch. No browser/client effect is run.

`result.evaluation` is the structural verdict. Complete replies always retain
`semanticReview.status: pending-human-review`; incomplete ones are unscored with
semantic review unavailable. Check whether prose accurately describes the view
and avoids unsupported weather claims. Unrelated or contradictory prose can pass
the structural predicate. Engine healing can remove invalid raw Actions before
scoring, so a shipped pass is not raw-candidate safety. One sample is not a
reliability baseline, semantic history-use proof or handler-effect test. No exact
spend is inferred. D38/D40/D41 are **COMPLETE for declared branch/trajectory
contracts**, each with one passing current-Engine sample. Case/new-sample review
remains pending; a sample does not establish reliability or handler effects.

Offline checks are the same manual and affected-project commands above; all
provider replies in `weather.test.ts` are synthetic, injected transports.

## Manual D33 no-data Labs navigation and selection

`d33.ts` loads the unchanged `labs-state-reset-subset` and
`labs-state-reset-synthetic` contracts, checks their `/items/32` lineage, and uses
these three requests:

1. “Show me the list of my lab results.” — dataset prompt.
2. “Go back to the trends chart.” — dataset prompt.
3. “What's the trend for hemoglobin?” — **existing synthetic extension**, not a
   recovered dataset prompt (`configuration.syntheticTurnIndices: [2]`).

The current demo now registers a **no-data** `labs` Vessel, without changing its
default Chart. Chart Variants own list/trends navigation. Its handler validates
`markerSlug` against hemoglobin, platelets and glucose before updating only that
Instance's selected label. Selection survives Variant changes/component remounts
in the same browser process, not reloads; the module retains selections by
Instance ID for that process lifetime. This is not clinical data persistence.
The UI and catalog explicitly disclose no lab results or trend data. There are
no measurements, patient records, uploads, inference, medical advice or data APIs.

Demo integration tests use the real React `m.useActions`, Provider and client
with a scripted Connector. They observe two isolated Instances, navigation,
selection across remounts, and handler errors without mutation on invalid input.
Those tests establish local demo handler/selection effects, **not model quality**.

The manual runner imports the actual demo `labsVessel` definition through a
fixed URL and validates its navigation/enum contract. It starts with only
`labs-main/trends` in a 30×18 tiling Chart. The default planner identity and eval
`SYSTEM_RULES` remain unchanged; no desired answer or clinical data is supplied.
Neither canonical response fixture is read. This is not demo-factory parity.

Inspect without credential access or network:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d33.ts
```

Only after review, explicit authorization for this **separate** sample, and
confirmation of the external $0.05/key ceiling and remaining allowance:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d33.ts --live --confirm-capped-key
```

The same shared transport restricts this to one transmission per turn, three
maximum, with zero Engine/SDK retries, official endpoint, pinned `gpt-6-luna`,
2,048 output tokens, 30-second SDK timeout and 35-second turn abort. Failure stops
without replacement. No billing preflight, local spend guard, `.env` loading,
judge, telemetry export, Langfuse or CI target is added. Errors remain redacted.

The deterministic predicate checks exact `showList` → `showTrends` →
`selectMarker({markerSlug: "hemoglobin"})` Actions on `labs-main`, incoming-Variant
availability, exact list → trends → trends shipped layouts/identity, sequential
requests and actual prior user/assistant history. Extra Actions, parameters or
Instances fail. This requires a positive exact selection and is **not** D33's
separate optional first-match enum predicate. Engine healing can alter raw output.

The manual run does **not** apply responses through the client. Its pass cannot
prove handler execution, selected-marker persistence or clinical trend fulfillment.
Every complete response remains `pending-human-review`; inspect for unsupported
measurements, trend interpretations or advice and require honest no-data wording.
Prose is not deterministically scored. One sample does not establish reliability
or semantic reliance. D33's declared source/synthetic predicates and no-data demo
handler/selection tests are **COMPLETE**. One current-Engine sample passed emitted
Action/Variant checks, not handler execution. Original scoring rules and source
lineage are unchanged; the missing dataset third prompt is not invented, clinical
trend fulfillment is out of scope, and canonical case review remains pending.

Offline verification (synthetic transport only; no live call):

```sh
bunx --no-install vitest run apps/demo/src/vessels/labs --config vitest.config.ts
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/manual/d33.test.ts
bunx nx run-many -t test,typecheck,check -p @maelstrom-co/demo,@maelstrom-co/evals,evals-offline --skip-nx-cache --skipSync
```

## Manual D35 adjudicated three-Vessel addition

`d35.ts` uses the user-approved initial scene: only `weather-main`/Weather/current.
It loads actual current Weather, no-data Labs and Calendar definitions through
fixed runtime imports, not the scripted response fixture. Three exact source
requests from `/items/34` run in one fresh Engine session:

1. “Add my lab results and calendar to the weather view.”
2. “Switch the weather to weekly forecast.”
3. “Show me the week view in the calendar.”

Turn 1 adds `labs-main`/Labs/trends and `calendar-main`/Calendar/month while keeping
Weather/current. Turn 2 requires Weather/showWeekly, turn 3 Calendar/showWeek.
Labs stays trends after creation and cannot receive further Actions. All three
IDs and Vessel IDs must remain stable. This is the adjudicated dataset flow, not
the old task's preloaded scene or mismatched turn-0 Weather/turn-1 Labs scorer.
The raw source and digest index are unchanged; D35 is now bounded case evidence.

The shared offline/manual scorer checks exact membership/Variants, incoming
Action availability and sequential transitions. It does not require an empty
first plan or an Action to create Instances. Extra valid non-transition Actions
are allowed; their parameters/effects and layout geometry are unscored. Full
requests (including actual shipped layouts) and actual prior user/assistant
history must carry forward exactly in the manual sequence. Engine healing may
alter the raw candidate before scoring. No client, handler or renderer runs.

Inspect without credentials or network:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d35.ts
```

Only after review, explicit sample authorization and the external capped-key
prerequisites above, invoke once:

```sh
bun --no-env-file --conditions=@maelstrom-co/source packages/evals/src/manual/d35.ts --live --confirm-capped-key
```

This uses `gpt-6-luna`, the existing eval prompt, 2,048 output tokens per turn,
at most three generation transmissions and zero Engine/SDK retries. Failure,
truncation or uncertainty stops without retry. The shared transport enforces the
official endpoint and rejects tools/remote conversation references; there is no
provider preflight, spend guard, `.env` loading, Langfuse or CI target. The cap is
an operator acknowledgement, not verified billing evidence. No live provider
call was made during this status-promotion edit or the scripted tests.

D35 is **COMPLETE only for the user-adjudicated current contract** after the fresh
post-fix one-shot sample `d35-798289d4-18e7-4604-b049-7b1d5b8321e2` passed the
unchanged predicate. It used the three exact source prompts with
`generationDispatches: 3`, `evaluation: pass` and empty failures: turn 0 added
`labs-main`/Labs/trends and `calendar-main`/Calendar/month; turn 1 emitted
`weather-main/showWeekly` → weekly; turn 2 emitted `calendar-main/showWeek` → week.
Labs remained after addition. This is one sample, not reliability evidence or
user semantic acceptance; `semanticReview` remains `pending-human-review`.

The saved raw report is unchanged at
`/var/folders/sx/3r95wzqn483glq6t_19hhjbw0000gn/T/pi-bash-de96e6635608a092.log`.
Its static PARTIAL limitation predates this promotion; it has not been edited or
re-run. Future runner output describes the bounded COMPLETE status independently
of each new run's verdict and pending semantic review. Prior failed reports remain
preserved, including `d35-c900a0df-c1f4-4ce4-ac2c-766396da7a37`, which completed
three dispatches but failed: no Labs or Calendar on the first prompt and a new
`calendar-week` only on the third. Its historical `COMPLETE` description does not
override `result.evaluation: fail`.

Remediation changes the shared product prompt to use catalog defaults when a
new Instance's Variant is omitted, preserving explicit Variants and clarification
for genuine ambiguity, unsupported capabilities or missing configuration. The
Labs catalog now explicitly permits opening its empty default view with a no-data
disclosure; this is not a global empty-panel substitution rule. No D35-specific
prompt override is added. Scripted tests verify prompt delivery and preserve the
failed sequence as a failing regression control, not a model-compliance result.
The fresh post-fix sample above was separately authorized and had no retry; this
promotion did not rerun providers. Any future live sample needs separate
authorization under the capped-key prerequisites above.

The case retains `review: pending-human-review`. Each complete response sequence,
including the passing sample above and new runs, remains pending human semantic
review for accurate addition/navigation descriptions and no fabricated clinical
data/advice. Labs has no results or trend data; adding its empty view is not
clinical data/trend fulfillment. An Engine report establishes no client/handler
effects. No semantic-quality, reliability, source scorer/runtime or legacy
`TASK_DEFINITIONS` equivalence, or demo-factory-parity claim is made. Offline verification:

```sh
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/manual/d35.test.ts tools/evals-offline/three-vessel-addition-fixture.test.ts
bunx nx run-many -t test,typecheck,check -p demo,@maelstrom-co/evals,evals-offline --skip-nx-cache --skipSync
```

## Optional judge for every manual probe

D02, D14, D17, D25, D33, D35 and the Weather probes honor
`MAELSTROM_ENABLE_LLM_JUDGE` and the provider/model/rubric variables documented in
[the eval guide](../../README.md#grader-secondary). This is an explicit additional
opt-in, not part of the fixed planner dispatch budget. Verify adequate hard caps
and permission for **every** configured provider before a live invocation. Dry-run
still reads no credentials and makes no planner or judge calls; its judge status
is `not_run/dry_run`.

Library callers can provide a fourth `ManualJudgeOptions` argument with explicit
`configuration` overrides or an injected `judge` (used by offline tests). Explicit
`configuration.enabled: false` overrides environment activation. Invalid enabled
judge configuration rejects before planner execution. The judge never relaxes,
retries or consumes a planner generation slot. Reports keep `generationDispatches`
and `judgeCalls` separate: attempts, provider-reported calls, and attempts whose
call count is unknown after an exception. Heuristic attempts report zero provider
calls and remain labeled non-LLM.

The judge reads only actual returned responses or retained partial-session turns
and the case inputs/expectations. Missing output is not graded. Surface mode uses
the session-outcome rubric (a single-response probe is a one-turn interaction);
legacy mode uses the distinct adapted scalar rubric. Neither can change the
existing deterministic result, exit status or pending human semantic review.
The bounded result is stored under `result.judge`, ready for reviewed publication;
no upload or judging occurs during report rendering.
