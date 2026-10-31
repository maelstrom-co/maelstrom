# Legacy source obligations — not executable cases

`v1/legacy.json` preserves one bounded current code-unit evidence row (D01) and eight out-of-scope rows (D04–D11) from pinned legacy dataset
`d6ef99aacb8ebce4d707d54fee14149daeea552d`,
`langfuse/maelstrom-eval-dataset.v1.json`. Each retains its complete raw source row,
pointer and explicit evidence, blockers or scope-exclusion reason. A 41-row identity/digest index binds those
rows and the executable cases to the original source, including repeated task IDs.
Digests use SHA-256 of JSON with recursively sorted object keys, preserving array order.

This ledger is **not** a case/fixture registry. It has no runtime profile, dummy
scorer, generated observation, `not_applicable` verdict or pass count. It closes a
traceability gap, not behavioral evaluations. Unit evidence is not counted as an
executable case or model-quality result. Out-of-scope rows are accounting only:
they are not blocked active work, evidence or passing results. Loading never reads
the legacy sibling repository or calls a provider.

## D04 excluded from unification scope

D04 `/items/3`, `reg-ai-chat-schema-enforced-lab-extraction`, is explicitly
`out-of-scope` by user decision: it is not needed for this unification. Review
found no supplied lab-extraction schema body, malformed draft payload or clean-failure
contract. Its exact raw row, source pointer, revision and SHA-256 digest remain
preserved. The exclusion removes D04 from the active blocker list, not from the
41-row source inventory. It adds no case, fixture, scorer, unit evidence or pass,
and does not establish extraction-schema enforcement or model quality.

## D05 excluded from unification scope

D05 `/items/4`, `reg-labs-extraction-error-wrap`, is `out-of-scope` by user
decision, like D04. No current Labs extraction API, schema or failure contract
was authorized; the user excluded D05 rather than defining a new extraction
contract. Its raw row, pointer, revision, digest and the 41-row source index remain
unchanged. No schema, `AIExtractionError`, provider seam, case or fixture is
created. This exclusion is not unit evidence, a pass or current behavioral coverage.

## D06 excluded from unification scope

D06 `/items/5`, `reg-labs-job-non-lab-key`, is `out-of-scope` by user decision,
like D04/D05. Review identified no current Labs S3 job, and the source row specifies
no S3 event envelope, batch result or key parsing/skip contract. Its exact raw row,
source pointer, revision and SHA-256 digest remain unchanged in the 41-row index.
The exclusion removes active blocked work without inventing a handler, batch
contract, case, fixture, scorer or pass. It is accounting only, not unit evidence
or current behavioral coverage.

## D01 bounded current unit evidence

D01 `/items/0`, `reg-maelstrom-history-used-when-available`, retains its exact raw
source row and `history-aware provider path used` expectation. Its status is
`current-unit-test-evidence`, linking
`packages/planner-llm/src/lib/llm-planner.test.ts` →
`D01 bounded provider-input evidence: sends the system prompt, history, then the user prompt`.
The existing fake `@tanstack/ai.chat` assertion checks the system prompt and exact
prior user/assistant history before the current user prompt, unchanged.

This proves **provider-input history propagation only**, not an Engine multi-turn
session, model semantic reliance or the source's unspecified Turn-2 setup. The ID
is still absent from pinned legacy `TASK_DEFINITIONS`; no legacy runnable contract
is recovered. There is no new executable case, profile, fixture or registry entry,
and full history/semantic coverage remains unresolved.

## D07–D11 excluded from unification scope

The user deferred all voice/audio-related rows from this task. D07–D11
(`/items/6`–`/items/10`) are now `out-of-scope`, alongside D04–D06:

- D07: `reg-voice-stt-api-key-required`
- D08: `reg-voice-stt-send-audio-without-connection`
- D09: `reg-voice-tts-no-voice-id`
- D10: `reg-voice-engine-state-transitions`
- D11: `reg-voice-engine-barge-in-interrupt`

Their exact source rows, pointers, revision and SHA-256 digests remain unchanged.
D07/D10/D11 no longer count as active unit evidence; D08/D09 are no longer active
blockers. Existing server-minter and adapter unit tests and all voice/audio code
remain unchanged. Their existence does not promote excluded rows to coverage,
evidence or passes. No case, fixture, model/provider evidence or audio change is
added by this deferral.

## D35 adjudicated addition case

D35 `/items/34` is now represented by `three-vessel-addition`, not a blocked
ledger entry. The user approved Weather/current alone initially, adding Labs
and Calendar on the first prompt, and preserving Labs from that point onward.
The raw pinned dataset and 41-row digest index remain unchanged. The old task's
preloaded scene and mismatched scorer remain documented historical differences;
this is not recovered source scorer/runtime or legacy `TASK_DEFINITIONS` equivalence.
D35 is **COMPLETE only for this adjudicated current contract** after one fresh
post-fix one-shot current-Engine sample passed in three dispatches with empty
failures and no retry. Prior failed reports remain preserved; case and sample
semantic review remain pending, not user semantic acceptance. One sample implies
no reliability, clinical data/trend fulfillment or client/handler effects.
Case/ledger accounting is unchanged.
See the [case contract](../cases/README.md#user-adjudicated-three-vessel-addition-d35t17).

## D39 action-backed transition case

D39 `/items/38` is represented by `weather-action-backed-transition`, not a blocked
ledger entry. The earlier direct-transition prohibition interpretation was wrong:
legacy `checkSingleTurn` permits `showWeekly`, rejects weekly layout with an empty
Execution Plan, and rejects first-action `showCurrent`. Current Weather also allows
current → `showWeekly` → weekly. The new predicate requires the matching Action and
existing Weather identity, strengthening the permissive nonempty-plan check.
Unrelated extra Actions/params and geometry are unscored. D40's separate historical
multi-turn scorer mismatch does not apply. The pinned row/digest is unchanged;
no live/model or handler result is implied. See the
[D39 contract](../cases/README.md#action-backed-weekly-transition-d39).

## Active blockers and exclusions

No source-only blocked obligations remain. The eight unregistered source rows
`/items/3`–`/items/10` are excluded by user decision, not resolved implementations.
Their absence from pinned legacy `src/tasks/index.ts` does not prove
repository-wide implementation absence. Exclusions are accounting only, not
behavioral evidence or passes.

D38 `/items/37`, D40 `/items/39`, and D41 `/items/40` are **separate executable
bounded cases**, complete for declared scope, not ledger rows. D38 covers only staying current. D40 follows its
dataset trajectory while retaining the historical scorer mismatch as a limitation.
D41 requires actual valid Actions, strengthening the legacy scorer's empty-plan
allowance. None establishes model understanding or Action handler effects.

Case status follows the [declared-scope completion convention](../cases/README.md#completion-scope).
Remaining raw ledger rows and unit-evidence limits are unchanged; D35 and D39
now have distinct case evidence. D35 has one passing post-fix current-Engine sample
for its adjudicated contract only; semantic review remains pending.

## Inventory integrity

```sh
bun --no-env-file --conditions=@maelstrom-co/source tools/evals-offline/inventory-cli.ts
```

The `legacy` section validates all 41 source pointers: **32 with bounded case
evidence, 1 with bounded code-unit evidence (D01), 0 source-only blocked obligations,
8 out-of-scope rows (D04–D11), 41 total accounted, zero unaccounted**. The 32 include
bounded predicates, not completed legacy migrations. Multiple cases can provide evidence for
one row; four rows with the same deterministic-action task ID remain four rows.
Duplicate source pointers, duplicate lineage within a case, mismatched identity,
revision/path, overlap or missing classifications reject the inventory report.
`legacy.outOfScopeObligations` lists excluded pointers and reasons separately;
`legacy.counts.outOfScopeObligations` contributes only to total accounting.

Executable totals remain separate: **43 cases, 35 fixtures, 30 profiles**.
The additional D14-inspired lexical case is a user-defined synthetic extension,
not a new legacy row or semantic D14 certification. D33's isolated optional-enum
case also reuses an existing pointer; it is complete for that synthetic predicate,
not full legacy D33 behavior. The remaining source obligations are unchanged. The
155 JSON-backed current scenario definitions and their case-level metadata links
are another dimension; neither is inferred from this ledger. No domain-owner,
ClickUp, Vault, provider, retention or publication decisions are made here.
