---
status: done
---

# Interchangeable Jev and conventional LLM planners

## Goal

Add a provider-neutral planning boundary to Maelstrom. The existing TanStack-backed LLM remains the default. Jev enters as an opt-in, experimental, server-only implementation behind the same structured interface. A successful plan always contains a layout and an ordered `executionPlan`. `userMessage` and `rationale` become optional presentation metadata rather than planning requirements.

The design must preserve the current adapter path by default. Existing `EngineConfig.adapter` users continue to get the current heal, retry, and final heal-and-ship behavior. Strict all-or-nothing finalization is explicit for Jev and other new planners. The engine, not a provider, owns finalization and visibly applies either policy, so a provider cannot secretly discard part of its proposal.

The evidence does not justify default promotion. Staged Jev v3 scored 66/66 on development trials but only 39/48 on fresh synthetic trials. It accepted eight wrong layouts and unnecessarily deferred once. Actions and parameters were correct in those eight accepted-layout failures. Recorded model-backed p50/p95 was 647/1,142 ms on development and 604/1,256 ms on fresh cases. These synthetic probes neither represent production traffic nor compare against the current LLM. The retrospective `0.6` cutoff retained only 9/33 expected fresh plans and is not a calibrated policy.

## Current constraints from the repository

- `EngineConfig.adapter` is required today. Prompt construction, `chat()`, healing, retry, history, and response construction are coupled in `createEngine`.
- The current LLM policy is intentional: heal invalid layout/action pieces, retry only when healing recommends it, then ship the final renderable subset after retries are exhausted.
- `GridResponseSchema`, `TilingResponseSchema`, `MaelstromResponse`, and the server-envelope decoder require `userMessage` and `rationale`. `processResponse` rejects a blank `userMessage`.
- `HistoryConfig.deriveLLMContext` is public. `maxChars` measures exactly the messages emitted by that projection. Omitted `maxChars` and `maxEntries` mean no retention cap.
- The full successful request and response are already stored internally. Public history projects only user intent and assistant prose.
- `Orchestrator.#dispatchResponse` atomically dispatches `set_layout` before `execute_actions`. That order supports actions against instances introduced by the response layout and must not change.
- The demo response component already hides itself when there is no message.
- Realtime already treats `SubmitIntentResult.userMessage` as optional. It always computes a post-render structural summary. LiveKit speaks `userMessage ?? summary`; OpenAI receives both values.
- Local demo WebSocket mode uses a shared server engine when `OPENAI_API_KEY` exists. Otherwise it requires a browser `playground.hello` and builds an engine from that browser key.
- Hosted demo mode is always BYOK. A Durable Object holds a visitor-keyed OpenAI engine and discards it with the key. The first Jev demo path must not break this lifecycle.
- The Jev prototype supports tiling only. Its two-action, two-new-instance, candidate extraction, and arrangement-template limits belong to that implementation, not to a shared contract.

## Target package boundaries

1. `@maelstrom-co/protocol` owns only transport-visible request, response, history, and error schemas.
2. `@maelstrom-co/engine` owns the public planning interfaces, invocation loop, request/history snapshots, normalized enums, canonical finalizer, operation budgets, fallback routing, history, deduplication, and the conventional LLM planner.
3. New server-only package `@maelstrom-co/engine-jev` owns TypeSafe/Jev HTTP calls, credentials, model options, question decomposition, confidence handling, candidate extraction, and Jev-specific capability limits.
4. `@maelstrom-co/engine-jev` depends on `engine`, `protocol`, and server-safe utilities. No engine, protocol, client, React, or browser realtime package depends on it.
5. Client, React, demo browser, and realtime packages consume only finalized protocol responses. They never receive provider credentials, questions, prompts, or raw traces.

The new package must include `package.json`, `biome.json` with `{"extends":"//"}`, TypeScript configs, tests, a root export, and a docs TypeDoc entry point.

## Public planning contracts

### Immutable input

The engine validates each envelope and `ChartRequest` once, then creates one detached snapshot before any planner call. All initial attempts, repairs, and fallback attempts receive the same object graph.

```ts
interface PlanningInput {
  readonly request: ChartRequest;
  readonly history: {
    readonly structured: readonly PlanningHistoryEntry[];
    readonly conversation: readonly PlanningConversationMessage[];
  };
  readonly actionEnums: readonly NormalizedActionEnumEntry[];
}
```

- `request` is validated, detached from caller-owned values, and deeply immutable.
- `actionEnums` uses stable vessel/variant/action/parameter identity and detached, recursively frozen JSON values.
- `history.structured` contains accepted prior plans. Jev consumes this form.
- `history.conversation` contains role-tagged text from the existing `deriveLLMContext` path. The conventional LLM consumes this form, preserving custom projections.
- No provider-specific prompt, model option, key, confidence threshold, or question appears here.

### One invocation contract for initial attempts and repairs

Every built-in and third-party planner implements the same single method. A repair is another invocation with public finalizer feedback, not an internal import or provider-specific callback.

```ts
interface Planner {
  readonly id: string;
  readonly supportedLayoutModes: readonly LayoutMode[];
  invoke(
    invocation: PlannerInvocation,
  ): Promise<Result<PlannerProposal, PlannerFailure>>;
}

interface PlannerInvocation {
  readonly input: PlanningInput;
  readonly phase:
    | { readonly kind: 'initial' }
    | {
        readonly kind: 'repair';
        readonly number: number;
        readonly previous: PlannerCandidate;
        readonly report: FinalizationReport;
      };
  readonly context: PlanningOperationContext;
}

interface PlanningOperationContext {
  readonly signal: AbortSignal;
  readonly deadlineAt?: number; // absent when timeout is disabled
  readonly calls: PlanningCallBudget;
}

interface PlanningCallBudget {
  readonly remaining: number;
  claim(call: {
    readonly plannerId: string;
    readonly stage: string;
  }): Result<void, { readonly kind: 'budget_exhausted' }>;
}

type PlannerProposal =
  | { readonly kind: 'candidate'; readonly candidate: PlannerCandidate }
  | {
      readonly kind: 'deferred';
      readonly reason: PlanningDeferralReason;
      readonly detail?: Readonly<Record<string, string | number | boolean>>;
    };
```

`PlannerCandidate` is an untrusted structured proposal. It contains proposed layout data, proposed actions and parameters, and optional `userMessage`/`rationale`. Its fields are broad enough to represent malformed provider output without dropping entries inside an implementation. Only the engine finalizer can produce canonical `GridLayout | TilingLayout` and `ActionExecution[]`.

`FinalizationReport` is public and provider-neutral. It contains bounded machine-readable issues such as layout mode mismatch, unknown instance, invalid tree, overflow, duplicate identity, invalid action order, parameter parse/type/enum failure, and whether healing produced a renderable plan. It never contains credentials, provider prompts, or unbounded raw output. The LLM planner converts this report into its repair prompt. A third-party planner can do the same without importing engine internals.

`claim` is synchronous and decrements exactly once before an external model request starts. A failed claim forbids that request. Deterministic work, finalization, and history reads do not claim calls.

`PlanningFailure` distinguishes:

- `provider_error`
- `invalid_provider_response`
- `cancelled`
- `timeout`
- `budget_exhausted`

Semantic uncertainty or capability mismatch is a `deferred` proposal, not a provider failure.

### One engine-owned operation loop

`executePlanningOperation` is the only path from a validated chart request to a finalized response:

1. Check the selected planner's declared layout modes. A mismatch returns `unsupported_capability` without a provider call.
2. Invoke the primary planner with `phase: initial`.
3. If it returns a candidate, run the canonical finalizer.
4. If policy requests repair and repair budget remains, invoke the same planner with `phase: repair`, the prior candidate, and the bounded report.
5. Repeat finalization after each repair. Every external model call, including all Jev stages inside one invocation, must claim the shared call budget.
6. When primary processing ends in an eligible deferral, failure, or strict finalization rejection, start the one configured fallback at `phase: initial` with the identical input and remaining operation budget.
7. Run fallback through the same invocation, finalization, and repair path.
8. Return and persist only one finalized response. No proposal, repair, deferral, or failed primary writes history or reaches the client.

There is at most one primary-to-fallback transition. A `Planner` cannot embed a fallback because routing is not part of the interface. This removes loops by construction and makes finalizer-triggered fallback work for third-party planners.

## Canonical finalization and explicit policy

The canonical finalizer always performs the same work:

1. Validate layout mode and parse the complete proposed layout.
2. Check grid bounds or tiling tree/instance coherence.
3. Resolve newly declared tiling instances before action validation.
4. Parse and validate every proposed action and parameter against the fixed enum snapshot.
5. Simulate actions in order so later actions use the variant left by earlier actions.
6. Return one of:
   - `exact`: every proposal item is canonical and the complete plan is usable.
   - `healed`: a canonical renderable plan plus a report of every dropped/repaired item and the current retry recommendation.
   - `unusable`: no complete/renderable result plus a report.

The route's `finalization` policy chooses what those results mean:

- `heal-and-ship`: current adapter behavior. `exact` succeeds. `healed` requests repair only when the existing retry predicate recommends it and repair budget remains; otherwise the healed plan succeeds. `unusable` follows existing error/retry behavior. The engine records and sends the actual healed plan, never the raw proposal.
- `strict`: `exact` succeeds. Any material layout repair or dropped/invalid action is a finalization rejection. The engine offers bounded repair, then fallback if configured, then returns semantic `invalid_plan` deferral. Optional missing prose is not a material issue.

Defaults are compatibility-specific:

- Existing `EngineConfig.adapter` selects `heal-and-ship` and cannot be silently changed to strict.
- Every explicit planner route requires `finalization`; there is no hidden explicit-route default. Third-party planners therefore never inherit partial-plan policy implicitly.
- Jev examples and demo configuration use `strict`.
- An explicit LLM route may choose either policy. Docs show both and explain the behavior.

This satisfies the no-secret-partial rule: only the shared engine finalizer can remove proposal pieces, and the route visibly opts into whether that healed result may ship.

## Exact engine configuration and defaults

`EngineConfig` becomes a union with two arms.

### Existing adapter compatibility arm

```ts
createEngine({
  adapter,
  prompt,
  maxRetries,
  modelOptions,
  operationTimeoutMs,
  maxProviderCalls,
  history,
  logger,
});
```

Defaults and validation:

- `maxRetries` remains a non-negative integer with existing default `1`.
- `finalization` is fixed to `heal-and-ship`.
- `operationTimeoutMs` defaults to `null`, meaning no engine-level deadline. This preserves current behavior. A supplied value must be a positive finite integer; `null` explicitly disables it.
- `maxProviderCalls` defaults to `maxRetries + 1`. A supplied value must be a positive integer. If it is lower than `maxRetries + 1`, the call budget stops further retries; budget exhaustion never causes an extra call.
- Repair attempts equal `maxRetries` and use the current retry recommendation.
- No fallback is available on this shorthand arm. Consumers wanting fallback use the explicit planner arm.
- Existing prompt, retry, and model options remain valid only here or inside `createLlmPlanner`.

Therefore the demo's existing `maxRetries: 2` resolves to three allowed LLM calls and no operation timeout unless it explicitly opts into one.

### Explicit planner arm

```ts
createEngine({
  planner: {
    primary: {
      implementation: createJevPlanner(/* provider-only options */),
      finalization: 'strict',
      maxRepairAttempts: 0,
    },
    fallback: {
      implementation: createLlmPlanner(/* provider-only options */),
      finalization: 'strict',
      maxRepairAttempts: 1,
      on: ['deferred', 'invalid_plan'],
    },
    operation: {
      timeoutMs: 12_000,
      maxProviderCalls: 5,
    },
  },
  history,
  logger,
});
```

Rules:

- `primary.finalization`, `primary.maxRepairAttempts`, `operation.timeoutMs`, and `operation.maxProviderCalls` are required in the low-level explicit form. This avoids provider-dependent implicit budgets.
- `timeoutMs` accepts a positive finite integer or `null`. `null` disables the whole-operation deadline and produces no `deadlineAt`.
- `maxProviderCalls` is one positive integer shared by primary stages, primary repairs, fallback stages, and fallback repairs.
- `maxRepairAttempts` is a required non-negative integer per explicit route. Jev initially uses `0`; the strict LLM examples use `1`.
- `fallback` is optional and defaults to absent.
- `fallback.on` is a required non-empty subset of `deferred`, `invalid_plan`, `provider_error`, and `invalid_provider_response`.
- Cancellation, whole-operation timeout, and exhausted call budget are never fallback-eligible.
- The fallback has no fallback field. Nested or cyclic routing is unrepresentable.
- LLM-only `prompt`, `maxRetries`, and `modelOptions` at the engine root are rejected on this arm.
- Supplying both `adapter` and `planner`, or neither, fails synchronously.

Precedence is fixed: caller cancellation first; then operation deadline; then provider-call budget; then per-route repair limit; then fallback eligibility. A deadline or cancellation aborts the active request and prevents all later stages.

After fallback policy is exhausted, a semantic deferral maps to a new `PlanningDeferredError` member of `EngineError` and a correlated `engine.error` code of `PlanningDeferredError`. Provider faults retain `ProviderError`; cancellation and timeout retain their existing tags. Connectors therefore reject a deferred request distinctly without widening `process()` to return a fake no-op response. No layout or action is dispatched for any error arm.

### Configuration examples

```ts
// Existing/default LLM behavior: heal, retry once when recommended, then ship.
const engine = createEngine({
  adapter: openaiText('<model-id>'),
  history: { store },
});
```

```ts
// Explicit strict LLM behavior.
const engine = createEngine({
  planner: {
    primary: {
      implementation: createLlmPlanner({
        adapter: openaiText('<model-id>'),
        modelOptions: { max_output_tokens: 16_384 },
      }),
      finalization: 'strict',
      maxRepairAttempts: 1,
    },
    operation: { timeoutMs: 30_000, maxProviderCalls: 2 },
  },
  history: { store },
});
```

```ts
// Experimental Jev without fallback.
const engine = createEngine({
  planner: {
    primary: {
      implementation: createJevPlanner({
        apiKey: process.env.TYPESAFE_API_KEY!,
        model: '<pinned-jev-model>',
      }),
      finalization: 'strict',
      maxRepairAttempts: 0,
    },
    operation: { timeoutMs: 30_000, maxProviderCalls: 3 },
  },
  history: { store, planning: { maxChars: 40_000 } },
});
```

```ts
// Experimental Jev with exactly one LLM fallback route.
const engine = createEngine({
  planner: {
    primary: {
      implementation: createJevPlanner({
        apiKey: process.env.TYPESAFE_API_KEY!,
        model: '<pinned-jev-model>',
      }),
      finalization: 'strict',
      maxRepairAttempts: 0,
    },
    fallback: {
      implementation: createLlmPlanner({
        adapter: openaiText('<model-id>'),
      }),
      finalization: 'strict',
      maxRepairAttempts: 1,
      on: ['deferred', 'invalid_plan'],
    },
    operation: { timeoutMs: 45_000, maxProviderCalls: 5 },
  },
  history: { store, planning: { maxChars: 40_000 } },
});
```

These examples belong only in server code. No provider key uses a `PUBLIC_`/`VITE_` name, component prop, URL, browser store, or wire frame.

## History and retention compatibility

The engine adds structured planning history without redefining the existing public hooks.

```ts
interface HistoryConfig<TMeta = unknown> {
  readonly store: HistoryStore<TMeta>;
  readonly maxEntries?: number;
  readonly maxChars?: number; // unchanged: conversation projection only
  readonly transformEntry?: /* existing signature */;
  readonly deriveLLMContext?: /* existing signature */;
  readonly planning?: {
    readonly maxChars?: number;
    readonly deriveContext?: (
      entry: HistoryEntry<TMeta>,
      defaults: () => readonly PlanningHistoryEntry[],
    ) => readonly PlanningHistoryEntry[];
  };
}
```

Compatibility rules:

- `deriveLLMContext` remains supported with its existing signature and control. The LLM planner consumes its messages.
- Existing `maxChars` continues to measure exactly `deriveLLMContext` output. Structured plan bytes are not added to that number.
- Existing prose turns produce the same default conversation projection and retention cost.
- For a new text-free turn, the default conversation projection emits the user intent plus a bounded assistant-role structural summary of the accepted layout/actions. This gives the conventional LLM continuity without fake prose. A custom `deriveLLMContext` still controls the result completely, including returning `[]` at zero cost.
- `history.planning.deriveContext` controls the structured projection independently. Its default contains identifiers, timestamp, update reasons/intents, finalized layout, finalized ordered actions, and optional assistant text.
- `history.planning.maxChars` measures a deterministic bounded serialization of that structured projection. It is independent of `maxChars`.
- Omitted `history.planning.maxChars` means infinity, matching existing omitted-cap semantics. Omitted `maxEntries` and both char caps still means no truncation.
- When multiple caps exist, an entry must fit `maxEntries`, conversational `maxChars`, and planning `maxChars`; newest-first and newest-entry-sticky behavior remains.
- `transformEntry` still runs before both projections and remains the place to redact or enrich stored data.
- Oversized assistant injections retain the existing `maxChars` boundary check. A large structured turn is bounded during projection and governed by `planning.maxChars`; the newest turn remains sticky rather than being rejected after the user already received it.
- Dedup replays the finalized response that actually reached the client, including a legacy healed plan or a strict exact plan.
- Final semantic deferrals and provider failures remain unrecorded, matching current failed-turn behavior. In-flight duplicates still coalesce around the complete operation.

## Text-free wire and consumer migration

Make these fields optional and omit them when absent:

- `MaelstromResponse.userMessage?: string`
- `MaelstromResponse.rationale?: string`
- turn-shaped `SessionHistoryEntry.assistantMessage?: string`

Move/export one canonical `MaelstromResponseSchema` from protocol and use it in both WebSocket envelope decoding and HTTP response decoding. Both transports must reject malformed layout/actions while accepting absent prose.

This is an additive wire relaxation but a TypeScript source migration: a consumer reading either field now receives `string | undefined`. Release protocol, engine, client, React, and reverse consumers together. Migration docs must show presence checks or omission-aware rendering. They must not recommend replacing absent text with fake wire content.

Existing LLM prompts continue requesting conversational output, preserving it for current users. Jev omits both fields. The client still applies the plan. The demo renders no empty card. Public history renders the user turn without an assistant bubble. Realtime waits for application to settle, then LiveKit speaks the structural summary and OpenAI receives the summary without an invented message.

## Demo deployment decision

The first Jev demo path is intentionally limited to trusted local server configuration.

### Trusted local mode

- `MAELSTROM_PLANNER=llm|jev` is read only by `apps/demo/src/server/ws-server.ts`; default is `llm`.
- `llm` keeps the current behavior: use server `OPENAI_API_KEY` when present, otherwise allow the browser `playground.hello` path.
- `jev` requires server `TYPESAFE_API_KEY` at startup and builds one shared server engine. A socket starts with `helloReceived: true`, exactly like current server-key mode. No hello or rehello is needed because no visitor credential is involved.
- The local Jev run profile sets the existing non-secret browser build flag so `usesBrowserKey()` is false. The keyless preview and OpenAI key drawer do not appear. This reuses existing server-key UI behavior rather than inventing a handshake.
- Local Jev plus optional LLM fallback requires both server `TYPESAFE_API_KEY` and server `OPENAI_API_KEY`. Missing either required key fails engine construction clearly. The fallback never consumes a browser key.
- Planner credentials are passed to a logger/redactor that protects every configured secret.
- Voice remains independently configured through the existing local OpenAI or LiveKit paths. Jev planning does not provide an OpenAI voice credential. A local Jev text demo can run without voice; voice controls follow their existing credential readiness rules.

### Hosted BYOK mode

- Hosted mode remains LLM-only in this run.
- `VITE_HOSTED=1` continues to force browser-key mode, `playground.hello/rehello`, visitor-key engine caching, and key drawer behavior.
- `SessionDO`, `Connections`, `Engines.forApiKey`, and `EngineFactory.make(apiKey)` retain their OpenAI BYOK lifecycle. They do not import `engine-jev`, read a server Jev key, bypass hello, or change cache identity.
- `MAELSTROM_PLANNER=jev` has no hosted meaning and must not silently alter a hosted build. Docs state that hosted Jev needs a later explicit deployment/custody design.
- No new hosted authentication or authorization system is part of this work.

## Ordered implementation phases

### Phase 1 — Add the shared invocation loop while preserving adapter behavior

**Intent**

Extract the current LLM path behind the public invocation contract. Implement finalization, repair feedback, budgets, and engine-owned routing once. Keep adapter users behaviorally unchanged.

**Likely files/packages**

- `packages/engine/src/lib/config.ts`
- `packages/engine/src/lib/validation/engine-config.ts`
- `packages/engine/src/lib/engine.ts`
- `packages/engine/src/lib/pipeline/{call-llm,retry,retry-prompt}.ts`
- `packages/engine/src/lib/response/response-processor.ts`
- New `packages/engine/src/lib/planning/{contracts,operation,finalizer,call-budget,llm-planner}.ts`
- Existing layout healer and execution-plan parser modules
- `packages/engine/src/lib/chart-request-dedup.ts`
- `packages/engine/src/index.ts`
- Engine config, parity, finalization, retry, cancellation, budget, fallback, and dedup tests

**Concrete decision**

Implement `Planner.invoke`, `executePlanningOperation`, `FinalizationReport`, and the two explicit finalization policies. Resolve adapter shorthand to `heal-and-ship`, `maxRetries` repairs, derived call budget, no timeout, and no fallback. Add the explicit route form and one engine-owned fallback slot.

**Acceptance checks**

- Existing adapter fixtures produce the same finalized layouts, skipped/healed actions, retry decisions, exhausted-retry heal-and-ship output, user text, errors, and logs.
- Existing default `maxRetries: 1` permits two calls. Demo-style `maxRetries: 2` permits three.
- Adapter shorthand has no deadline by default. Opting into a timeout covers all retries.
- Explicit strict routes never return a healed subset; explicit heal-and-ship routes do so only through engine finalization.
- A fake third-party planner receives a finalizer report on repair and can return a corrected candidate without importing an internal validator.
- A strict-invalid primary can trigger fallback after finalization. Fallback is invoked at most once and follows the same repair/finalization loop.
- Cancellation, timeout, and exhausted call budget stop repairs and fallback.
- Grid/tiling capability mismatch defers before provider work.
- Only one finalized response is persisted and correlated. Duplicate message IDs coalesce around the full operation.
- Existing `adapter` configs compile; ambiguous config arms fail synchronously.
- Every public function, type, and exported field has useful JSDoc.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
```

**Dependencies**

None.

**Non-goals**

No Jev code, no default strictness, no hosted demo change, and no browser fallback.

### Phase 2 — Add structured history and carry text-free plans end to end

**Intent**

Make layout/actions sufficient across wire, history, HTTP/WebSocket connectors, state, demo presentation, and voice while preserving existing history-hook semantics.

**Likely files/packages**

- `packages/protocol/src/lib/{request,response,envelope,session-history-entry,schemas}.ts`
- `packages/protocol/README.md`
- `packages/engine/src/lib/history/{history-manager,history-store,wire-projection,truncation}.ts`
- Engine response/history tests
- `packages/client/src/lib/connection-manager/connectors/{http-connector,web-socket-connector}.ts`
- `packages/client/src/lib/orchestrator/*`
- `packages/react/src/lib/*`
- `packages/realtime/src/lib/realtime-session/*`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/realtime-livekit/src/livekit-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `apps/demo/src/components/{home-page,assistant-response}.tsx`
- `apps/www` reverse-consumer source/tests affected by optional response fields

**Concrete decision**

Make response/history prose optional. Export and reuse one response schema across HTTP and WebSocket boundaries. Add independent `history.planning` projection/budget while leaving `deriveLLMContext` and `maxChars` semantics intact.

**Acceptance checks**

- A custom strict planner returning only layout/actions round-trips through HTTP and WebSocket, correlates, and applies successfully.
- Layout applies before ordered actions, including an action against a newly declared instance.
- HTTP and WebSocket reject malformed plan shapes but accept omitted prose.
- React state exposes optional text without synthesizing it. The demo clears its busy state and renders no assistant card for a text-free success.
- Both voice adapters receive a post-render structural summary. LiveKit speaks it when text is absent; OpenAI receives no invented `userMessage`. Existing non-empty LLM text still takes precedence.
- Public history omits the assistant message for a text-free turn. Internal structured history retains the finalized layout/actions and supplies them to the next planner.
- Existing custom `deriveLLMContext` output and `maxChars` truncation are byte-for-byte unchanged for prose turns.
- A custom `deriveLLMContext` returning `[]` remains zero conversational cost; no hidden structural cost is added to `maxChars`.
- `planning.maxChars` independently truncates structured entries, handles oversized bounded summaries, preserves newest-entry-sticky behavior, and defaults to infinity.
- Omitted caps remain unbounded. `maxEntries` still bounds text-free turns when configured.
- Dedup replays a text-free finalized response without another planner call.
- TypeScript migration tests cover callers that previously assumed required `userMessage`, `rationale`, or `assistantMessage`.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo,@maelstrom-co/www --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo,@maelstrom-co/www --skip-nx-cache
```

**Dependencies**

Phase 1.

**Non-goals**

No fake “Done” copy, no chat redesign, no change to action application order, and no redefinition of existing `maxChars`.

### Phase 3 — Add the experimental Jev planner package

**Intent**

Port the staged prototype into an isolated, server-only planner that participates in the same invocation, finalization, cancellation, budget, and fallback mechanism.

**Likely files/packages**

- New `packages/engine-jev/package.json`
- New `packages/engine-jev/biome.json`
- New `packages/engine-jev/tsconfig*.json`
- New `packages/engine-jev/src/index.ts`
- New `packages/engine-jev/src/lib/{jev-planner,typesafe-client,questions,candidates,compiler}.ts`
- Scripted/fake-fetch tests
- Package boundary test proving no browser dependency
- `apps/docs/astro.config.ts` TypeDoc entry point

**Concrete decision**

Export `createJevPlanner(options): Planner`. Read current TypeSafe HTTP, state, Choice, confidence, and function-calling docs before implementation. Keep model ID, API key, endpoint, question text, candidate extraction, staged workflow, and confidence policy inside this package. Use strict finalization and zero repair attempts initially because no repair strategy has representative evidence.

The implementation keeps the staged sequence:

1. Select visibility/lifecycle changes, new-instance counts, arrangement, and action count.
2. Allocate IDs in code, then select actions only from retained/created instances.
3. Select parameters from implementation-owned candidates and construct one proposal.

It declares tiling-only support. Resize-only tiling requests remain deterministic and action-free. Current two-action, two-new-instance, extraction, and layout-template limits may remain explicit Jev-only deferrals. They never constrain shared contracts or LLM behavior.

**Acceptance checks**

- Scripted cases cover preserve/show/hide/delete, hidden reuse, new-instance targeting, comparison, enums/runtime enums, variant transitions, parameters, structured follow-up history, resize, ambiguity, missing candidates, and policy limits.
- IDs, tree construction, enum normalization, and action sequence are code-owned. Model output cannot inject arbitrary IDs or parameter values.
- Every TypeSafe response validates model metadata, usage, question IDs, choices, probability keys, totals, and selected values before use.
- Each external call claims the shared engine call budget. Layout-only needs one call, parameterless actions at most two, and parameterized actions at most three under the initial design.
- Caller cancellation or operation deadline aborts active fetch and prevents later stages.
- Grid input defers without network traffic.
- Any cross-stage inconsistency becomes a proposal that strict finalization rejects or a semantic deferral. No partial plan escapes.
- Tests require no key and make no live calls.
- No runtime dependency reaches client, React, realtime browser packages, demo renderer code, or prototype report/viewer files.
- Keys and authorization headers never appear in logs, client errors, traces, or snapshots.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine-jev,@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine-jev,@maelstrom-co/engine,@maelstrom-co/protocol --skip-nx-cache
```

**Dependencies**

Phases 1 and 2.

**Non-goals**

No grid support, no generative content inside Jev, no calibrated confidence threshold, no default promotion, and no live CI call.

### Phase 4 — Wire trusted local demo selection and preserve hosted BYOK

**Intent**

Demonstrate configuration switching without replacing the existing hosted visitor-key lifecycle or inventing authentication.

**Likely files/packages**

- `apps/demo/src/server/{ws-server,engine-config,engine-model,redact}.ts`
- Demo local startup scripts/profile
- `apps/demo/src/lib/{hosted-mode,connector}.ts` tests if local browser-key flag coverage changes
- `apps/demo/src/components/{keyless-demo,key-drawer,home-page}.tsx` tests
- `.env.example`
- Hosted regression tests under `apps/demo/src/worker/session/*`

**Concrete decision**

Support Jev only in trusted local server mode. `MAELSTROM_PLANNER` selects the local shared engine. Local Jev marks connections pre-authenticated and uses existing non-browser-key UI mode. Hosted Worker/Durable Object remains OpenAI BYOK and keeps current hello, rehello, engine cache, and teardown behavior.

**Acceptance checks**

- No planner variable still selects current LLM behavior.
- Local LLM without server OpenAI key still prompts for a browser key and completes the existing hello flow.
- Local Jev requires server `TYPESAFE_API_KEY`, creates a shared engine, starts sockets hello-complete, and never opens the OpenAI key drawer.
- Local Jev with configured fallback requires a server OpenAI key before startup; no browser key can satisfy fallback.
- Hosted mode remains browser-key LLM regardless of local planner env. Rehello, key mismatch rebuild, hibernation, last-socket drop, and key-drawer tests remain unchanged.
- Text-free Jev success updates the chart without a response card. A strict deferral leaves the chart unchanged and surfaces a distinct planning-deferred error.
- Existing local voice modes still use their own credentials and structural-summary fallback. The work makes no new voice availability claim.
- Redaction covers all configured server secrets.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/demo,@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/demo,@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
```

**Dependencies**

Phases 1–3.

**Non-goals**

No hosted Jev, no Durable Object credential redesign, no new authentication system, no browser Jev key, and no public planner toggle.

### Phase 5 — Publish API, migration, security, and operational documentation

**Intent**

Document the interface, compatibility policies, local-only demo scope, evaluation limits, and rollback. Ensure all public surfaces render in generated reference docs.

**Likely files/packages**

- `packages/engine/README.md`
- `packages/engine-jev/README.md`
- `packages/protocol/README.md`
- `apps/docs/src/content/docs/guides/engine/custom-llm-providers.mdx` or a new planner-backends guide
- `apps/docs/src/content/docs/guides/engine/conversation-history.mdx`
- `apps/docs/src/content/docs/understanding/engine.mdx`
- `docs/architecture.md`
- `.env.example`
- Public JSDoc in engine, engine-jev, and protocol entry points

**Concrete decision**

Document adapter shorthand as the stable compatibility path and explicit routes as the path for strictness/fallback. Publish all four configuration examples. Mark Jev experimental, tiling-only, and local-demo-only. State that hosted BYOK remains LLM.

**Acceptance checks**

- Docs explain `heal-and-ship` versus `strict`, including defaults and migration consequences.
- Docs explain the single invocation/finalization/repair/fallback loop and third-party planner contract.
- Optional-field migration explicitly tells TypeScript users to handle `undefined` for response and history text.
- Protocol README no longer claims response prose is required.
- History docs distinguish `maxChars` from `planning.maxChars`, preserve custom `deriveLLMContext` semantics, and explain omitted caps.
- Security docs place every credential server-side and state the local/hosted demo split.
- Evidence docs include 66/66 and 39/48 with the eight incorrect accepted layouts, latency caveats, no LLM comparison, and no `0.6` policy claim.
- Generated docs contain every public symbol and no internal helper.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/protocol,@maelstrom-co/docs,@maelstrom-co/www --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/protocol,@maelstrom-co/docs,@maelstrom-co/www --skip-nx-cache
bun run docs:lint
bun run audit:public-api-docs --declarations --packed-consumer
bun run audit:public-api-docs --typedoc
bun run audit:strip-internal --report=tmp/strip-internal.json
bun -e 'const x=await Bun.file("tmp/strip-internal.json").json(); if(x.results.some((v)=>v.result.status==="drift-rejected")) process.exit(1)'
```

**Dependencies**

Phases 1–4.

**Non-goals**

No default switch, no provider marketing claim, and no unrelated docs-site restructuring.

### Phase 6 — Add offline parity evaluation and a separate promotion gate

**Intent**

Exercise both implementations through the same public contract, then define what evidence a later default decision requires.

**Likely files/packages**

- `packages/engine-jev/evaluation/*` or `tools/planner-evaluation/*`
- `packages/engine-jev/package.json` with an explicit `evaluate-offline` Nx target
- Shared contract fixtures and result schemas
- Evaluation/report tests and rollout documentation
- Existing prototype evidence referenced as historical input only

**Concrete decision**

Add a deterministic `evaluate-offline` target as part of package configuration before invoking it. The evaluator submits identical frozen request/history inputs, finalizes with the configured policy, and scores observable layout/action behavior. Live mode, if later added, requires an explicit flag and credentials and is never part of CI verification.

**Acceptance checks**

- Shared cases cover layout mode, visibility/retention, new-instance actions, ordered transitions, exact parameters, optional text, history follow-up, cancellation, finalization, deferral, and fallback.
- Reports separate incorrect accepted layouts, incorrect actions/parameters, useful coverage, unnecessary deferrals, provider failures, candidate gaps, compiler/finalizer bugs, fallback, call count, p50/p95, model IDs, and verified cost inputs.
- Expected answers and scoring rules are never sent to a provider.
- A representative, independently labeled, privacy-reviewed set is required before promotion. Synthetic prototype cases remain regression probes.
- The current LLM is measured on the same representative snapshots.
- Product owners set thresholds before final holdout results: accepted-plan error, coverage, fallback rate, latency, cost, and repeated-run stability.
- Rollout remains opt-in and small. Rollback switches local/server configuration to LLM; no client or history migration is required.
- The LLM stays default until a separate approval changes it.

**Verify commands**

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/engine,@maelstrom-co/engine-jev --skip-nx-cache
bunx nx run @maelstrom-co/engine-jev:evaluate-offline --skip-nx-cache
```

**Dependencies**

Phases 1–5. The `evaluate-offline` target must exist in `packages/engine-jev/package.json` before this phase's final command runs.

**Non-goals**

No live call in verification, no tuning on final holdout, no universal confidence threshold, and no default promotion.

## Verification prerequisites and final gate

Before any phase verification in a fresh clone:

```sh
bun install
```

Documentation verification additionally requires Vale **3.18.0** on `PATH`; confirm with `vale --version` before `bun run docs:lint`.

The final uncached gate runs every affected package, including the private reverse consumer:

```sh
bunx nx run-many -t typecheck,test,check --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo,@maelstrom-co/docs,@maelstrom-co/www --skip-nx-cache
bunx nx run-many -t build --projects=@maelstrom-co/protocol,@maelstrom-co/engine,@maelstrom-co/engine-jev,@maelstrom-co/client,@maelstrom-co/react,@maelstrom-co/realtime,@maelstrom-co/react-realtime,@maelstrom-co/realtime-livekit,@maelstrom-co/realtime-openai,@maelstrom-co/demo,@maelstrom-co/docs,@maelstrom-co/www --skip-nx-cache
bunx nx run @maelstrom-co/engine-jev:evaluate-offline --skip-nx-cache
bun run docs:lint
bun run audit:public-api-docs --declarations --packed-consumer
bun run audit:public-api-docs --typedoc
bun run audit:strip-internal --report=tmp/strip-internal.json
bun -e 'const x=await Bun.file("tmp/strip-internal.json").json(); if(x.results.some((v)=>v.result.status==="drift-rejected")) process.exit(1)'
```

`audit:strip-internal` is not considered passing until the follow-up parser confirms there is no `drift-rejected` result.

## Decisions supported by current code and evidence

- The seam belongs before provider prompt/question construction, not in a fake TanStack adapter that reparses prompts.
- Engine-owned finalization can preserve legacy heal-and-ship while enforcing strict Jev plans.
- Layout and actions are sufficient client output; prose is presentation-only.
- Existing voice summary behavior is the correct text-free fallback.
- Request validation, normalized enum snapshots, finalization, history, correlation, deduplication, and application order belong outside providers.
- Jev must begin tiling-only and opt-in. Fresh-case layout failures rule out default promotion.
- Typed output and valid actions do not prove semantic layout correctness.
- Confidence alone is not a correctness or permission signal.

## Product decisions deliberately left for owners

1. The representative evaluation source, privacy/redaction policy, labeling ownership, sample size, and trace retention.
2. Promotion thresholds for incorrect accepted plans, coverage, fallback, latency, cost, and stability, set before final holdout results.
3. Whether Jev must expand beyond current tiling, action-count, instance-count, extraction, and arrangement limits before any customer cohort.
4. Application treatment of final semantic deferral: clarification, visible error, silence, or configured fallback. The engine does not generate copy.
5. Whether a deployment enables fallback on provider errors. Default fallback is absent; the example enables only semantic deferral and invalid plans.
6. A future hosted Jev credential/custody and engine-cache design. Hosted BYOK remains LLM until that separate decision.

## Definition of done

- Existing adapter users retain current LLM default, retry, healing, and final heal-and-ship behavior.
- Explicit planners use one documented invocation contract and one engine-owned finalization/repair/fallback loop, including third-party implementations.
- Strictness, repair limits, timeout, call budget, fallback triggers, and disabled states have concrete validated configuration.
- Both LLM and Jev produce one finalized layout plus ordered actions. Jev omits prose without placeholders.
- Protocol, HTTP/WebSocket connectors, history, React, demo, `www`, and both voice paths handle absent text.
- Existing `deriveLLMContext` and `maxChars` semantics remain compatible. Structured retention has a separate optional budget.
- Finalized layouts always apply before ordered actions, including actions on new instances.
- Cancellation and optional whole-operation deadline cover all calls. One shared call budget covers stages, repairs, and fallback.
- Semantic deferral, provider error, malformed response, cancellation, timeout, and exhausted budget remain distinct.
- Fallback is optional, runs at most once, uses the same snapshot, and cannot duplicate writes.
- Jev is isolated server-side, validates all third-party data, supports tiling explicitly, and leaks no credential.
- Trusted local demo can select Jev. Hosted BYOK remains on its existing OpenAI lifecycle.
- Public APIs have JSDoc, migration docs are complete, and API audits pass with no `drift-rejected` result.
- Offline contract/parity evaluation passes without live calls.
- All final commands pass after `bun install`, with Vale 3.18.0 for docs.
- The LLM remains the default. Jev promotion requires separate representative comparative evidence and approval.
