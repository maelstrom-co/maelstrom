---
status: done
---

# Interchangeable Jev and LLM planners

## Goal

Add a provider-neutral planning boundary to Maelstrom. The existing LLM planner remains the default. Jev becomes an opt-in experimental server-side planner behind the same interface. Both planners return one atomic layout plus ordered `executionPlan`; conversational `userMessage` and diagnostic `rationale` remain optional presentation metadata.

This run must not claim that Jev is production-ready. The staged prototype scored 66/66 on its development trials but only 39/48 on fresh synthetic trials. It accepted eight wrong layouts and unnecessarily deferred once. The action selections and parameters in those eight accepted failures were correct, but the layouts were not. Recorded p50/p95 latency was 647/1,142 ms on development and 604/1,256 ms on fresh cases. These probes neither represent production traffic nor compare Jev with the existing LLM. The retrospective `0.6` confidence cutoff retained only 9/33 expected fresh plans and is not a deployment policy.

## Current-code findings that constrain the design

- `EngineConfig.adapter` is currently a required `AnyTextAdapter`. Prompt construction, `chat()`, response healing, retry, history loading, and response construction are coupled inside `createEngine`.
- `GridResponseSchema`, `TilingResponseSchema`, `MaelstromResponse`, and the server-envelope parser require `userMessage` and `rationale`. `processResponse` rejects blank `userMessage`.
- Successful history stores the full request and response. Its default LLM projection and public wire projection both assume `response.userMessage` exists.
- `Orchestrator.#dispatchResponse` already applies `set_layout` before `execute_actions` in one command batch. This order supports actions against instances introduced by the same tiling layout and must not change.
- The demo renders `lastResponse?.userMessage`; its response component already hides itself when there is no message. It must not receive placeholder prose.
- The realtime seam already models `SubmitIntentResult.userMessage` as optional. `RealtimeSession` omits blank text and always builds a structural summary. LiveKit speaks `userMessage ?? summary`; OpenAI receives both fields. These are the correct text-free fallbacks.
- Request validation, enum normalization, sequential action validation, correlation, in-flight deduplication, history storage, envelope handling, and client application are reusable shared layers.
- The prototype validates `ChartRequest`, uses request-scoped enum candidates, allocates IDs in code, validates actions sequentially, and defers when a plan needs repair. It supports tiling only. Its two-action, two-new-instance, and arrangement-template limits are prototype implementation limits, not shared Maelstrom contract limits.
- The existing heal path can silently return a partial layout or action plan. The new planner boundary must not treat a provider candidate with dropped pieces as a complete plan.

## Target architecture and API decisions

### Package and dependency direction

1. `@maelstrom-co/protocol` continues to own only transport-visible request, response, history, and error shapes. It does not depend on a planner or provider.
2. `@maelstrom-co/engine` owns the public planner contract, validated request snapshots, structured planning history, shared final validation, operation budgets, fallback composition, and the conventional LLM implementation.
3. A new server-only `@maelstrom-co/engine-jev` package owns TypeSafe/Jev HTTP details, question decomposition, model selection, credentials, confidence policy, candidate extraction, and Jev-specific repair or deferral rules. It depends on `engine`, `protocol`, and validation/runtime utilities only. Neither `engine` nor any browser package depends on it.
4. `client`, React, and realtime packages continue to consume only protocol responses. They never import either planner implementation and never receive provider credentials.
5. Demo server and Worker composition roots choose the planner. Browser bundles receive no `TYPESAFE_API_KEY`, provider prompt, or raw Jev trace.

The new package needs `package.json`, `biome.json` containing `{"extends":"//"}`, TypeScript configs, tests, a root entry point, and a TypeDoc entry point.

### Provider-neutral planning contract

Export the following conceptual contract from `@maelstrom-co/engine`. Exact type aliases may follow repository naming conventions, but the discriminants and semantics are fixed by this plan.

```ts
interface PlanningInput {
  readonly request: ChartRequest; // validated, detached, immutable snapshot
  readonly history: readonly PlanningHistoryEntry[];
  readonly actionEnums: readonly NormalizedActionEnumEntry[];
}

interface PlanningContext {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  readonly budget: PlanningCallBudget;
}

interface Planner {
  readonly id: string;
  readonly supportedLayoutModes: readonly LayoutMode[];
  plan(
    input: PlanningInput,
    context: PlanningContext,
  ): Promise<Result<PlanningDecision, PlanningFailure>>;
}

type PlanningDecision =
  | {
      readonly kind: 'planned';
      readonly layout: GridLayout | TilingLayout;
      readonly executionPlan: readonly ActionExecution[];
      readonly userMessage?: string;
      readonly rationale?: string;
    }
  | {
      readonly kind: 'deferred';
      readonly reason:
        | 'unsupported_capability'
        | 'ambiguous_intent'
        | 'insufficient_candidates'
        | 'low_confidence'
        | 'policy_limit'
        | 'invalid_plan';
      readonly detail?: Readonly<Record<string, string | number | boolean>>;
    };

type PlanningFailure =
  | { readonly kind: 'provider'; readonly cause: unknown }
  | { readonly kind: 'invalid_provider_response'; readonly cause: unknown }
  | { readonly kind: 'cancelled'; readonly reason: unknown }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'budget_exhausted' };
```

Rules for this interface:

- `planned` is the complete candidate. It never means “best surviving subset.”
- `deferred` is a semantic, expected outcome. It is distinct from provider, timeout, cancellation, and malformed-response failures.
- Provider prompts, TypeSafe questions, TanStack options, credentials, model IDs, confidence calculations, extraction strategies, and repair prompts do not appear in the interface.
- The contract has no two-action, two-instance, confidence, or arrangement-template limit. A particular implementation may declare and enforce narrower capabilities by returning `deferred`.
- Planner diagnostics stay in logs/evaluation records, not in the client plan. `rationale` remains optional only for compatibility with existing LLM users.

### Immutable request and history snapshots

Before invoking any planner, the engine validates the envelope and `ChartRequest`, then creates one detached request snapshot and one normalized enum snapshot. Every attempt and fallback sees those same values. Enum entries use stable vessel/variant/action/parameter identity plus detached, recursively frozen JSON values. A provider cannot observe author-owned enum mutations between stages.

`PlanningHistoryEntry` is structured rather than a list of chat strings. A successful turn retains identifiers, timestamp, user update reasons or extracted intents, accepted layout, ordered actions, and optional assistant text. An injection retains its assistant content. The LLM planner alone converts this structure to chat messages. When a prior successful turn lacks assistant prose, that conversion serializes a bounded structured summary of its accepted layout and actions instead of inserting `''` or pretending the turn never happened. Jev receives the structured form directly.

History truncation must count a deterministic bounded serialization of each structured projection. Therefore a text-free successful turn still consumes retention budget and cannot become immortal or free. The public history DTO makes `assistantMessage` optional; chat UIs omit that bubble while preserving the user turn. Internal history continues to retain the accepted plan for follow-up planning and dedup replay.

### Shared final validation and atomicity

All planner implementations return candidates to one engine-owned finalizer. The finalizer:

1. Confirms the returned layout mode matches the request.
2. Parses the complete layout against the canonical protocol schema and checks instance/tree/grid coherence.
3. Resolves newly introduced tiling instances before validating actions.
4. Validates every action and parameter against the fixed request snapshot and normalized enums.
5. Simulates ordered variant transitions so each later action is checked against the state left by the earlier action.
6. Accepts the candidate only when every proposed layout entry and action survives. Any drop, structural repair, unknown target, invalid parameter, or action-order failure produces `invalid_plan`; it never returns a partial success.
7. Leaves client application unchanged: layout first, then ordered actions, in one response dispatch.

The conventional LLM implementation may use healing diagnostics to construct an implementation-local repair prompt. It may not return the healed subset as a successful plan. This intentionally tightens the old “partial output beats failure” behavior. Document it as a compatibility change rather than hiding it behind Jev.

### Deadlines, cancellation, retries, and fallback

- Add an engine-level whole-operation timeout and model-call budget. The same composed `AbortSignal`, absolute deadline, and call-budget object span every LLM retry, every Jev stage, and optional fallback.
- Distinguish caller cancellation from deadline expiry. Cancellation stops all remaining stages and never invokes fallback. Deadline expiry returns `TimeoutError` even if the active provider reports an abort-shaped exception.
- Each implementation claims budget before a provider call. The initial Jev backend uses at most three calls and no automatic provider retry. The LLM backend retains its configured repair retry count. Neither implementation may reset the shared budget.
- Provide `createFallbackPlanner(primary, fallback, policy)` in `engine`. It can invoke the fallback at most once, with the same immutable input, signal, deadline, and remaining budget. It is non-recursive and rejects a nested fallback planner at construction or flattens it to one bounded chain.
- Default fallback is disabled. When configured, the default eligible outcomes are semantic deferral, invalid provider response, and invalid final plan. Provider faults may be enabled explicitly. Cancellation, whole-operation timeout, and exhausted budget never fall back.
- Only the final accepted plan is recorded and sent. Primary deferral/failure and intermediate repair candidates do not write history, emit envelopes, or reach the client. Dedup wraps the complete primary/fallback operation, so duplicate `(sessionId, messageId)` requests cannot create duplicate accepted writes.
- A final semantic deferral maps to a distinct `PlanningDeferredError`/wire error code after fallback policy is exhausted. It is not mislabeled as `ProviderError`. Existing connector promise shapes remain compatible: they reject rather than returning a fake no-op `MaelstromResponse`.

### Configuration and compatibility

`EngineConfig` becomes a mutually exclusive union:

- Existing `{ adapter, prompt?, maxRetries?, modelOptions?, ...shared }` remains supported and continues to select the conventional LLM planner. It remains the default path and should not be deprecated in this run.
- New `{ planner, planningPolicy?, ...shared }` selects an explicit planner. LLM-only fields are rejected when `planner` is supplied.
- `createLlmPlanner` exposes the explicit implementation form. `createJevPlanner` is exported by `@maelstrom-co/engine-jev`.
- Supplying both `adapter` and `planner`, or neither, fails synchronously with a clear config validation issue.

Examples to publish:

```ts
// Existing/default LLM configuration remains valid.
const engine = createEngine({
  adapter: openaiText('<model-id>'),
  history: { store },
});
```

```ts
// Explicit conventional LLM planner.
const engine = createEngine({
  planner: createLlmPlanner({
    adapter: openaiText('<model-id>'),
    maxRetries: 1,
    modelOptions: { max_output_tokens: 16_384 },
  }),
  planningPolicy: { timeoutMs: 10_000, maxProviderCalls: 2 },
  history: { store },
});
```

```ts
// Experimental Jev, with no silent fallback.
const engine = createEngine({
  planner: createJevPlanner({
    apiKey: process.env.TYPESAFE_API_KEY!,
    model: '<pinned-jev-model>',
  }),
  planningPolicy: { timeoutMs: 5_000, maxProviderCalls: 3 },
  history: { store },
});
```

```ts
// Experimental Jev with one bounded LLM fallback.
const engine = createEngine({
  planner: createFallbackPlanner(
    createJevPlanner({
      apiKey: process.env.TYPESAFE_API_KEY!,
      model: '<pinned-jev-model>',
    }),
    createLlmPlanner({ adapter: openaiText('<model-id>'), maxRetries: 1 }),
  ),
  planningPolicy: { timeoutMs: 12_000, maxProviderCalls: 5 },
  history: { store },
});
```

All examples belong in server-only files. No example may use `PUBLIC_`, `VITE_`, client component props, or browser storage for a provider secret.

## Ordered phases

### Phase 1 — Introduce the planner seam without changing the default LLM behavior

**Intent**

Extract the current conventional LLM path behind `Planner`. Keep all existing `EngineConfig.adapter` callers working and keep LLM as the default. Establish immutable planning inputs and structured history before adding another provider.

**Likely files/packages**

- `packages/engine/src/lib/config.ts`
- `packages/engine/src/lib/validation/engine-config.ts`
- `packages/engine/src/lib/engine.ts`
- `packages/engine/src/lib/pipeline/call-llm.ts`
- New `packages/engine/src/lib/planning/{planner,planning-input,llm-planner}.ts`
- `packages/engine/src/lib/history/{history-manager,history-store,load-history-context}.ts`
- `packages/engine/src/index.ts`
- Corresponding engine config, history, retry, cancellation, dedup, and parity tests

**Concrete API/migration decision**

Add the `Planner` contract, `createLlmPlanner`, structured planning history, normalized enum catalog, and mutually exclusive `adapter | planner` config. Existing adapter configuration is compatibility sugar implemented by constructing the same LLM planner internally. Keep existing prompt and model options only on that compatibility arm.

**Acceptance checks**

- Existing adapter-based fixtures produce the same successful layout, ordered actions, user message, rationale, retry count, error tags, and request IDs.
- Explicit `createLlmPlanner` produces the same result as adapter sugar for grid and tiling fixtures.
- Planner input is detached from caller mutation and contains normalized enum values from the exact request snapshot.
- Prior turns reach the LLM planner through structured history, then are projected to the same chat messages as today when prose exists.
- History loading, in-flight dedup, correlation, cancellation, and one advisory history write remain outside provider implementations.
- Supplying both config arms, neither arm, or LLM-only options with an explicit planner fails synchronously.
- Every new public symbol and exported field has useful JSDoc.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
```

**Dependencies**

None.

**Non-goals**

No Jev calls, no optional wire text yet, no fallback, and no change to default planner selection.

### Phase 2 — Carry text-free successful plans through protocol, history, UI, and speech

**Intent**

Make conversational output genuinely optional across the actual wire and every consumer. Prove that a plan containing only layout and actions remains usable, replayable, and speakable without placeholder strings.

**Likely files/packages**

- `packages/protocol/src/lib/{request,response,envelope,session-history-entry}.ts`
- Protocol schema and envelope tests
- `packages/engine/src/lib/response/response-processor.ts`
- `packages/engine/src/lib/history/{history-manager,wire-projection,truncation}.ts`
- Engine response/history tests
- `packages/client/src/lib/connection-manager/connectors/*`
- `packages/client/src/lib/orchestrator/*`
- `packages/react/src/lib/*` tests and mocks that construct `MaelstromResponse`
- `packages/realtime/src/lib/realtime-session/*`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/realtime-livekit/src/livekit-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.ts` tests
- `apps/demo/src/components/{home-page,assistant-response}.tsx` and tests

**Concrete API/migration decision**

Make `MaelstromResponse.userMessage` and `rationale` optional and omit absent keys on the wire. Make `SessionHistoryEntry` turn `assistantMessage` optional. Remove the blank-message parse failure. Keep LLM prompts requesting conversational output so existing users retain it when their model supplies it. Do not substitute `''`, “Done,” or generated rationale.

This is source-compatible for consumers that already use optional access, but an older decoder rejects a new text-free response. Release protocol, engine, and client consumers as one coordinated version. Existing LLM responses continue to decode on older clients; opting into Jev requires the upgraded client.

**Acceptance checks**

- A planner response containing only `layout` and `executionPlan` encodes, decodes, correlates, and applies successfully.
- A text-free response still dispatches layout before actions, including an action targeting a newly declared instance.
- A successful text-free turn is persisted, costs retention budget, appears in later structured planning history, and dedup-replays without a second planner call.
- Public history returns the user turn with no assistant-message field; clients do not render an empty assistant bubble.
- The demo clears its processing treatment and shows no response card after a text-free success.
- Realtime waits for render completion, then supplies the structural summary. LiveKit speaks the summary and OpenAI receives a result without an invented `userMessage`.
- Existing non-empty LLM prose still displays and takes precedence over the structural speech summary.
- Empty/whitespace provider text is normalized to absence at the planner boundary, not retained as meaningful prose.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo --skip-nx-cache
```

**Dependencies**

Phase 1.

**Non-goals**

No generated fallback copy, no chat UI redesign, no voice-provider architecture change, and no Jev implementation.

### Phase 3 — Enforce complete plans and bounded operation policy

**Intent**

Put strict final validation, semantic deferral, whole-operation cancellation/deadline handling, call budgets, and optional one-shot fallback around every planner.

**Likely files/packages**

- New `packages/engine/src/lib/planning/{finalize-plan,planning-budget,fallback-planner,planning-errors}.ts`
- `packages/engine/src/lib/engine.ts`
- `packages/engine/src/lib/errors.ts`
- `packages/engine/src/lib/chart-request-dedup.ts`
- Existing layout healer and execution-plan validator modules, refactored into reusable strict checks where needed
- `packages/engine/src/lib/pipeline/{retry,retry-prompt}.ts`
- `packages/engine/src/lib/envelope-handler.ts`
- `packages/protocol/src/lib/envelope.ts` if a distinct deferred wire code/schema helper is needed
- Engine, envelope, dedup, deadline, retry, and fallback tests

**Concrete API/migration decision**

Add engine-owned finalization and `createFallbackPlanner`. A finalizer rejection becomes an implementation repair opportunity while budget remains, then a semantic `invalid_plan` deferral. After fallback policy ends, map deferral to a distinct `PlanningDeferredError` and correlated wire error code. Do not return a fake response and do not apply a subset.

Introduce `planningPolicy.timeoutMs` and `planningPolicy.maxProviderCalls`. Preserve `maxRetries` only as LLM implementation configuration. Default fallback remains off.

**Acceptance checks**

- A candidate with one valid and one invalid action applies neither action and no new layout.
- A candidate whose layout needs a dropped leaf, position, or structural repair is not returned as `planned`.
- Valid layouts and all actions still apply atomically in layout-then-action order.
- A caller abort during any LLM retry or Jev-like multi-stage fake stops later calls, skips fallback, writes no history, and returns `CancellationError`.
- A whole-operation deadline covers all attempts and fallback. It returns `TimeoutError` with one configured duration and cannot restart per stage.
- Provider faults, malformed provider responses, semantic deferrals, exhausted budget, timeout, and cancellation remain distinguishable in typed results and correlated wire codes.
- Fallback runs at most once, receives the identical snapshot, cannot recurse, and cannot exceed the remaining call budget.
- Only the winning accepted plan is persisted once. Primary candidates and failures produce no history write or client command.
- Existing duplicate request IDs coalesce around the whole composed operation.
- Existing LLM users get explicit documentation that invalid partial responses now defer or fail instead of silently applying a subset.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/protocol,@maelstrom-co/client --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/protocol,@maelstrom-co/client --skip-nx-cache
```

**Dependencies**

Phases 1 and 2.

**Non-goals**

No retries for arbitrary provider errors by default, no multi-provider loop, no client-side fallback, and no automatic application of degraded output.

### Phase 4 — Add the experimental server-only Jev planner

**Intent**

Turn the staged prototype into an isolated production-shaped implementation without treating its synthetic results as a promotion signal.

**Likely files/packages**

- New `packages/engine-jev/package.json`
- New `packages/engine-jev/biome.json`
- New `packages/engine-jev/tsconfig*.json`
- New `packages/engine-jev/src/index.ts`
- New `packages/engine-jev/src/lib/{jev-planner,typesafe-client,questions,candidates,compiler}.ts`
- Jev unit, contract, cancellation, deadline, and parity tests using scripted responses/fake fetch
- `apps/docs/astro.config.ts` for the public package entry point
- Architecture dependency-boundary test or manifest test proving the package has no browser dependency

**Concrete API/migration decision**

Export `createJevPlanner(options): Planner` from `@maelstrom-co/engine-jev`. Pin or explicitly configure a model. Read current TypeSafe HTTP, Choice, state, confidence, and function-calling documentation before implementation. Validate every third-party response. Keep the API key, endpoint, model options, questions, source-value extraction, confidence policy, and staged workflow inside this package.

Initial behavior follows the proven staged ordering:

1. Select visibility/lifecycle changes, new-instance counts, arrangement, and action count.
2. Allocate stable new instance IDs in code, then select ordered actions only from retained/allocated instances.
3. Select parameter values from implementation-owned candidates, then construct a candidate plan.

The initial backend declares tiling-only capability. Resize-only tiling turns remain deterministic and action-free. Its current action-count, new-instance, source-candidate, and arrangement-template bounds may remain as explicit Jev-only deferral rules for the first experiment. They do not enter `Planner`, protocol schemas, LLM behavior, or shared validation. Grid requests defer as `unsupported_capability` before a Jev network call.

**Acceptance checks**

- Scripted Jev fixtures cover preserve/show/hide/delete, hidden-instance reuse, new-instance allocation, comparisons, enum and runtime enum values, sequential variant transitions, parameterized actions, follow-up structured history, resize, ambiguous intent, missing candidates, and over-limit deferral.
- IDs, tree construction, enum normalization, and action order are code-owned. Model answers cannot inject arbitrary IDs or parameter values.
- Each provider call validates exact question IDs, choices, probability keys, probability totals, model metadata, and usage before use.
- Cancellation and deadline abort the active fetch and prevent later stages.
- A request uses one call for layout-only, at most two for parameterless actions, and at most three for parameterized actions under the initial implementation. Tests assert these bounds without live calls.
- Tiling capability mismatch defers without network traffic. Jev-specific two-action/template limits never reject an LLM plan through shared code.
- Any cross-stage inconsistency or shared-finalizer rejection returns a deferral; no partial candidate escapes.
- No test requires `TYPESAFE_API_KEY`, and verification makes no live provider call.
- The package has no dependency on `client`, React, realtime browser packages, demo renderers, or prototype viewer/report code.
- Credentials and authorization headers never appear in logs, traces, errors returned to clients, or test snapshots.
- Every exported symbol and field has JSDoc; internal decomposition comments explain only non-obvious constraints.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine-jev,@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine-jev,@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
```

**Dependencies**

Phases 1–3.

**Non-goals**

No grid support, no default promotion, no confidence cutoff inferred from captured trials, no generative content fallback inside Jev, no browser rendering imports, and no live provider call in CI.

### Phase 5 — Wire opt-in configuration, docs, observability, and user-visible behavior

**Intent**

Make planner choice an explicit server composition decision, document migration and security, and expose enough bounded telemetry to evaluate and roll back the experiment.

**Likely files/packages**

- `apps/demo/src/server/engine-config.ts`
- `apps/demo/src/server/engine-model.ts`
- `apps/demo/src/worker/session/engine-factory.ts`
- `apps/demo/src/worker-bindings.ts`
- `.env.example`
- Demo server/Worker tests and browser-facing behavior tests
- `packages/engine/README.md`
- `packages/engine-jev/README.md`
- `apps/docs/src/content/docs/guides/engine/custom-llm-providers.mdx` or a new planning-backends guide
- `apps/docs/src/content/docs/guides/engine/conversation-history.mdx`
- `apps/docs/src/content/docs/understanding/engine.mdx`
- `docs/architecture.md`
- Public JSDoc and generated API configuration

**Concrete API/migration decision**

Add a server-only demo configuration such as `MAELSTROM_PLANNER=llm|jev`, defaulting to `llm`. Jev additionally requires server-side `TYPESAFE_API_KEY`. Do not add a browser toggle or expose the key through a public env prefix. Configure optional LLM fallback only at the composition root and keep it off unless explicitly selected.

Emit structured logs for planner ID, layout mode, stage count, provider-call count, elapsed time, outcome, machine-readable deferral/failure reason, fallback attempted, and final backend. Do not log credentials, authorization headers, full prompts, user content, Vessel descriptions, or raw provider responses by default. Correlate with existing message/session identifiers subject to the host's logging policy.

**Acceptance checks**

- With no new environment variable, demo/server/Worker construction selects the existing LLM path.
- Selecting Jev without a server key fails startup/configuration clearly; it never falls back silently to a browser-held key.
- Selecting Jev in tiling mode produces a text-free response that updates the chart without a blank assistant card. Voice uses the structural summary.
- Selecting LLM preserves conversational text display and speech precedence.
- A Jev deferral leaves the chart unchanged and surfaces as a distinct application error; the demo does not claim success with invented prose.
- Planner and fallback logs support latency/error/deferral analysis without leaking provider input or secrets.
- Docs include both configuration examples, the `adapter` compatibility path, mutually exclusive config rules, strict no-partial behavior, optional text migration, history behavior, tiling-only capability, server-only secret custody, fallback bounds, and rollback instructions.
- Docs state the recorded 66/66 development and 39/48 fresh results with their limitations and do not present `0.6` as a calibrated threshold.
- Generated reference pages include every new public API and omit internal helpers.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/demo,@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/docs --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/demo,@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/docs --skip-nx-cache
bun run docs:lint
bun run audit:public-api-docs --declarations --packed-consumer
bun run audit:public-api-docs --typedoc
bun run audit:strip-internal
```

**Dependencies**

Phases 1–4.

**Non-goals**

No public planner selector in the demo, no provider key in browser state, no unrelated realtime package migration, and no claim that synthetic latency is production latency.

### Phase 6 — Build comparative evaluation and hold the default behind a separate gate

**Intent**

Evaluate both implementations through the same public planner contract and define an evidence-based promotion decision without changing the default in this run.

**Likely files/packages**

- A new offline-first evaluation area under `packages/engine-jev/evaluation/` or `tools/planner-evaluation/`
- Contract fixtures shared by LLM and Jev fakes
- Evaluation result schemas, report generation, and documentation
- Existing prototype evidence referenced as historical baseline, not imported into runtime packages
- Rollout documentation and operator runbook

**Concrete API/migration decision**

Create one evaluator that submits identical frozen request/history snapshots to each configured planner and scores observable accepted layout/action behavior. Keep expected answers and scoring rules outside provider inputs. Live modes require explicit credentials and an explicit flag; CI runs deterministic contract fixtures only.

Jev remains opt-in after this phase. Promotion requires a separately approved evaluation plan and decision. Rollback is configuration-only: switch planner selection to LLM and disable fallback chaining; no protocol downgrade or stored-history migration should be required.

**Acceptance checks**

- Contract suites run the LLM and Jev implementations against shared cases for layout mode, instance retention, new-instance targeting, ordered transitions, exact parameters, text-free history, cancellation, deferral, and failure mapping.
- The evaluator records accepted-plan correctness, incorrect accepted layouts, incorrect actions/parameters, useful coverage, unnecessary deferrals, fallback rate, end-to-end p50/p95, provider calls, verified cost inputs, model IDs, and repeated-run stability.
- Reports separate semantic model errors, candidate-coverage gaps, provider/transport failures, shared compiler bugs, and application failures.
- A representative, independently labeled, privacy-reviewed request set is required before promotion. Synthetic prototype cases remain regression probes only.
- The current LLM is measured on the same representative snapshots. No latency, quality, or cost benefit is claimed without this comparison.
- Promotion thresholds are approved before viewing final holdout results. The captured `0.6` sweep is excluded from threshold selection.
- Rollout starts with a small opt-in cohort and dashboards/alerts for incorrect accepted plans, deferrals, fallback, timeout, latency, and provider faults. The default remains LLM until a separate decision explicitly changes it.
- A rollback drill proves that switching to LLM requires no client release and produces no duplicate write for an in-flight correlated request.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
# Deterministic/offline evaluation only; the exact target is added with the harness.
bunx nx run @maelstrom-co/engine-jev:evaluate-offline --skip-nx-cache
```

**Dependencies**

Phases 1–5.

**Non-goals**

No live call in normal verification, no tuning on the final holdout, no default switch, no universal confidence threshold, and no account-cost claim without verified pricing.

## Decisions supported by current code and evidence

- The planner seam belongs before prompt construction. Wrapping Jev as a TanStack text adapter would force it to parse rendered prompts and would hide structured state.
- Layout and ordered actions are sufficient planning output. Current client application does not need prose to apply a response.
- Optional speech behavior is already structurally supported: realtime has a deterministic post-render summary fallback.
- Shared request validation, enum normalization, sequential action validation, correlation, dedup, history, and client command ordering should remain outside providers.
- Jev must start tiling-only and experimental. Fresh-case layout errors rule out default promotion.
- The eight wrong accepted fresh layouts show that schema validity and action correctness do not establish plan correctness.
- Confidence is not a correctness proof. The retrospective threshold sharply reduced coverage and was selected after observing the same records.

## Unresolved product choices requiring explicit owner decisions

These choices must not be silently encoded by the implementation team:

1. **Representative evaluation corpus:** traffic source, privacy/redaction rules, labeling ownership, sample size, retention, and whether production requests may be replayed to either provider.
2. **Promotion thresholds:** maximum incorrect accepted-plan rate, minimum useful coverage, acceptable fallback rate, latency/cost ceilings, and required repeated-run stability. Set these before the final holdout.
3. **Jev capability expansion:** whether grid support, more general layout solving, broader source-span extraction, and more than two actions/new instances are required before any customer cohort. Initial implementation may defer instead.
4. **Product deferral presentation:** the engine supplies a machine-readable semantic deferral. Each application must decide whether to ask for clarification, show an error, do nothing, or configure fallback. The engine must not manufacture a conversational message.
5. **Provider-fault fallback policy:** default remains disabled. A deployment owner must explicitly choose whether quota/network/provider failures may consume the LLM fallback budget and accept the resulting latency/cost.
6. **Data handling for evaluation traces:** whether raw structured requests and provider answers may be retained, for how long, and under which access controls. Runtime logs remain metadata-only regardless.

## Whole-run definition of done

- Existing `EngineConfig.adapter` applications still compile and select the conventional LLM planner by default.
- Applications can select an explicit LLM or Jev implementation behind one documented `Planner` interface.
- Both implementations produce the same validated atomic layout/action response shape. Jev can omit `userMessage` and `rationale` entirely.
- Protocol, connectors, React state, public history, demo UI, and voice handle absent prose without placeholders or blank output.
- Structured successful history retains accepted layout/actions and remains bounded when assistant prose is absent.
- One immutable validated request and normalized enum snapshot is shared across attempts and fallback.
- Final validation rejects partial plans. The client still applies layout before ordered actions, including actions on new instances.
- Cancellation and a whole-operation deadline span all model calls. Retry and fallback share a bounded provider-call budget.
- Semantic deferral, provider failure, malformed response, cancellation, timeout, and budget exhaustion are observably distinct.
- Optional fallback runs at most once, cannot loop, and writes/sends only the final accepted result.
- Jev is isolated in a server-only package, supports tiling explicitly, validates third-party responses, and never exposes credentials to browser packages or logs.
- Public APIs have JSDoc and rendered reference coverage. User docs include migration, both backend examples, security, optional text, history, fallback, evaluation limits, and rollback.
- Contract/parity tests cover LLM and Jev behavior without live calls. All affected projects pass typecheck, tests, `check`, and build with `--skip-nx-cache`; documentation and public API audits pass.
- The LLM remains the default. A future default change requires a separate representative comparative evaluation and explicit approval.