# @maelstrom-co/engine

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Reference implementation of the Maelstrom orchestration engine. Given the current chart state, available vessels, and update reasons, it finalizes a planner's layout and ordered execution plan. The conventional LLM remains the default; explicit routes support other server-side planners.

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/engine/readme/>

This package is a **reference implementation** — it ships to demonstrate how the engine contract works and to power local development and demos. Production deployments are expected to supply their own engine behind the same `Engine` interface.

> Looking for an introduction? See [The Engine](https://docs.maelstrom-ai.co/understanding/engine) on the docs site. This README is the technical reference for the reference implementation itself.

---

## Quickstart

```ts
import { geminiText } from '@tanstack/ai-gemini';
import {
  ChartRequestMessage,
  SessionId,
  isOk,
} from '@maelstrom-co/protocol';
import { createEngine } from '@maelstrom-co/engine';

const engine = createEngine({
  adapter: geminiText('gemini-2.0-flash'),
});

const session = SessionId();

const message = ChartRequestMessage({
  sessionId: session,
  request: /* build ChartRequest */,
});

const result = await engine.handle(message);

if (isOk(result) && result.value.type === 'chart_response') {
  // result.value.response is the MaelstromResponse
  console.log(result.value.response.userMessage);
}
```

---

## The envelope model

Every input to the engine is an `EngineMessage` — a tagged envelope carrying `sessionId`, `id`, and `timestamp` alongside the variant-specific payload. Every output mirrors that shape with an `EngineOutput` envelope.

```ts
type EngineMessage =
  | { type: 'chart_request';     sessionId; id; timestamp; request }
  | { type: 'assistant_message'; sessionId; id; timestamp; content };

type EngineOutput =
  | { type: 'chart_response';           sessionId; id; response }
  | { type: 'assistant_message_result'; sessionId; id; outcome };
```

The engine exposes a single public method that routes on `message.type`:

```ts
interface Engine {
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;
}
```

### Why envelopes

- **Uniform identity.** Every message is tagged with the same `sessionId` and `id`, so correlation, dedup, and audit work the same way across variants and across future message kinds.
- **Wire format = engine format.** Connectors, transports, and server dispatch code are pure passthrough — they serialize and deserialize envelopes but never add, rename, or inject fields. The JSON on the wire is the `EngineMessage` the engine sees.
- **Client constructs, intermediaries pass through.** The client edge (React provider, voice session loop, HTTP caller) calls the protocol factory functions and produces a fully-formed envelope. Nothing downstream mutates it.

### Message variants

**`chart_request`** — asks the engine to produce a layout and execution plan. The engine captures detached request, enum, and history snapshots, then runs the selected planner through finalization, bounded repair, and optional fallback. Only the accepted finalized response is recorded. Deferrals and failed proposals do not enter history.

**`assistant_message`** — persists developer-supplied content into session history so subsequent LLM turns see it as prior context. Does not invoke the LLM. Returns an `assistant_message_result` envelope whose `outcome` is `'inserted'` (new write) or `'deduped'` (a prior entry with the same `MessageId` already existed; the write was a no-op). Callers who don't care about idempotency can ignore `outcome`; callers instrumenting replay-safe behavior can branch on it. If history is not configured, returns a `ValidationError`.

---

## Factory pattern

Envelopes are constructed via the smart-constructor factories in `@maelstrom-co/protocol`. The identifier doubles as the type (for annotations) and the factory (for runtime creation), exploiting TypeScript's separate type/value namespaces.

```ts
import {
  ChartRequestMessage,
  AssistantInjectionMessage,
  SessionId,
  MessageId,
} from '@maelstrom-co/protocol';

// Auto-fills id (uuid) and timestamp (Date.now())
const chartMsg = ChartRequestMessage({
  sessionId: SessionId('user-42'),
  request: buildChartRequest(),
});

// Explicit id/timestamp when you need them (rehydration, testing, replay)
const injection = AssistantInjectionMessage({
  sessionId: SessionId('user-42'),
  content: 'FYI: flights tend to be cheaper on Tuesdays.',
  id: MessageId('injection-1'),
  timestamp: 1_700_000_000_000,
});
```

The engine's `handle()` accepts only fully-formed envelopes — there are no partial-input overloads. Always use the factories.

---

## Configuration

`EngineConfig` has two mutually exclusive forms:

- **`AdapterEngineConfig`** accepts `adapter`, `prompt`, `modelOptions`,
  `maxRetries`, `operationTimeoutMs`, `maxProviderCalls`, `history`, and `logger`.
  It preserves `heal-and-ship`, defaults to one repair, derives a call budget of
  `maxRetries + 1`, and disables the engine deadline by default. It has no fallback.
- **`PlannerEngineConfig`** accepts `planner`, `history`, and `logger`.
  `planner.primary` and optional `planner.fallback` each require an
  `implementation`, `finalization`, and `maxRepairAttempts`.
  `planner.operation` requires `timeoutMs` and `maxProviderCalls`.
  Fallback also requires a non-empty `on` list.

`maxRepairAttempts` and shorthand `maxRetries` are non-negative integers.
Call budgets are positive integers. Timeouts are positive finite integer
milliseconds, or `null` to disable. Explicit routes have no implicit policy or
budget. LLM prompt and model options belong to `createLlmPlanner` on that form;
root LLM-only options are rejected. Both configuration forms, or neither, fail
synchronously at construction.

The [planner guide](https://docs.maelstrom-ai.co/guides/engine/planner-backends/)
contains four complete configurations: legacy adapter, strict LLM, strict Jev,
and strict Jev with one bounded LLM fallback. Jev is experimental and lives in
the separate server-only `@maelstrom-co/engine-jev` package.

### Finalization, repair, and fallback

The engine owns one invocation loop. It checks layout capability before provider
work, invokes the primary with `phase.kind: 'initial'`, and finalizes every
candidate. Finalization checks layout coherence, resolves new tiling instances,
validates parameters against the fixed enums, and simulates actions in order.

- **`heal-and-ship`** accepts exact output and permits the renderable healed
  subset. Repair follows the existing recommendation predicate. When the route's
  repair limit is reached, the final renderable result may ship.
- **`strict`** accepts exact plans and rejects material layout changes or
  dropped/invalid actions. It offers bounded repair, then configured fallback,
  then `PlanningDeferredError` with reason `invalid_plan`. Valid empty layouts
  and action lists are allowed. Missing presentation text is not material.

A repair is another `Planner.invoke` call with the complete previous candidate,
one-based repair number, and bounded `FinalizationReport`. `createLlmPlanner`
owns no retry loop: each invocation makes one claimed TanStack `chat()` call.
The engine can transition to one fallback route at `initial`, using the same
frozen input and remaining operation budget. Eligible triggers are `deferred`,
`invalid_plan`, `provider_error`, and `invalid_provider_response`. No nested
fallback exists. The engine returns and records at most one finalized response.

### Logical calls and deadlines

Every planner must claim each logical provider invocation through
`context.calls.claim` immediately before starting it. A failed claim forbids
the call. One LLM `chat()` or Jev stage `fetch()` consumes one claim. Opaque
adapter HTTP retries remain inside that logical call, so `maxProviderCalls`
does not guarantee a physical network-request count. Started claims are never
refunded after provider failure, malformed output, cancellation, or timeout.
Deterministic work and finalization do not consume claims.

Pass caller cancellation to `engine.handle(message, signal)`. Precedence is
caller cancellation, operation deadline, logical call budget, route repair
limit, then fallback eligibility. Cancellation, timeout, and budget exhaustion
are terminal and never trigger fallback. A provider must honor the operation
signal to stop its underlying network work.

Keep finite engine deadlines below the shortest outer connector/proxy/platform
timeout. The guide and local Jev demo use 25 seconds under the connector's
30-second default, leaving error-delivery headroom. Equal deadlines race.
Legacy shorthand remains deadline-free unless configured and can outlive the
connector timeout.

### Third-party planners

Implement the public `Planner` interface: `id`, `supportedLayoutModes`, and
`invoke(invocation): Promise<Result<PlannerProposal, PlannerFailure>>`.
Read validated, detached, deeply frozen `PlanningInput.request`, role-tagged
`history.conversation`, structured `history.structured`, and `actionEnums`.
Every attempt receives the same input graph. Keep provider credentials and
prompt construction in the implementation.

Return a complete untrusted `PlannerCandidate` or a semantic `deferred` proposal.
Keep invalid proposal items for engine feedback rather than silently dropping
them. Return `PlannerFailure` for transport, recognized malformed responses,
operation control failures, or local validation failures. Honor `context.signal`
and `deadlineAt`, and claim provider work. Use the public repair report;
the operation runner and canonical finalizer remain implementation helpers.

### History

Opt-in. When omitted, `chart_request` still runs normally but no prior conversation is fed to the LLM and nothing is recorded; `assistant_message` returns a `ValidationError('history not configured')`.

When configured, every `chart_request` is processed with the session's prior turns (and any developer-injected `assistant_message` content) supplied to the LLM as prior messages. After the response returns, the new turn is appended to history for the next call.

```ts
interface HistoryConfig<TMeta = unknown> {
  /** Backing store. REQUIRED — no implicit default. */
  store: HistoryStore<TMeta>;
  /** Hard cap on per-session entry count. Omit to disable. */
  maxEntries?: number;
  /** Char budget per session — used as a token proxy. Omit to disable. */
  maxChars?: number;
  /** Write-time hook: mutate or enrich each entry (including `metadata`) before persistence. */
  transformEntry?: (entry: HistoryEntry<TMeta>) => HistoryEntry<TMeta>;
  /** Read-time hook: project a stored entry to the LLM-context messages it contributes. */
  deriveLLMContext?: (
    entry: HistoryEntry<TMeta>,
    defaults: () => readonly LLMContextMessage[],
  ) => readonly LLMContextMessage[];
  /** Independent accepted-plan projection and character budget. */
  planning?: {
    maxChars?: number;
    deriveContext?: (
      entry: HistoryEntry<TMeta>,
      defaults: () => readonly PlanningHistoryEntry[],
    ) => readonly PlanningHistoryEntry[];
  };
}
```

`store` has no default. Local dev and tests pass `createInMemoryStore()` explicitly:

```ts
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';

const engine = createEngine({
  adapter: /* ... */,
  history: {
    store: createInMemoryStore(),
    maxEntries: 50,
    maxChars: 40_000,
  },
});
```

Production deployments supply a persistent, atomic backend (Redis, Postgres, SQLite, …). The reference engine refuses to silently fall back to an in-process store because a configured `history` block deserves an explicit choice — silently losing every session on process restart is the kind of bug you want a type error to flag, not a runtime surprise.

Truncation enforces every configured cap on write, newest-first. `maxChars`
counts exactly the conversational projection's content lengths.
`planning.maxChars` independently measures deterministic structured projection
serialization, stopping measurement when the cap is exceeded. Neither cost is
added to the other. An empty custom projection costs zero in its dimension.
Omitting a cap disables that dimension; omitting all three means no truncation.
The newest entry remains sticky even when it exceeds either character budget.
The complete accepted plan remains intact rather than being cut to fit.

**Oversized injections are rejected at the engine boundary.** When `maxChars` is configured, an `assistant_message` whose `content.length` exceeds `maxChars` returns `ValidationError('content')` instead of being persisted. This closes the loop on the "newest entry always wins" rule: without a boundary check, a single 10MB injection would silently dominate every subsequent LLM call. A turn-shaped entry that legitimately fills the cap is still allowed; the rule targets pathological inputs that can never coexist with the configured budget. If `maxChars` is omitted, no size validation runs.

### Richer entries with typed metadata

`HistoryEntry<TMeta>` exposes an optional `metadata` slot so production deployments can ride auxiliary data along every entry (tenant id, experiment arm, token counts, audit fields) without forking the entry shape:

```ts
interface TurnMeta {
  readonly tenantId: string;
  readonly tokensUsed: number;
}

const engine = createEngine({
  adapter: /* ... */,
  history: {
    store: createInMemoryStore(),
    maxEntries: 50,
    maxChars: 40_000,
    // Enrich at write time.
    transformEntry: (entry) =>
      entry.kind === 'turn'
        ? { ...entry, metadata: { tenantId, tokensUsed: /* ... */ } }
        : entry,
    // Surface richer stored data to the LLM (or redact it).
    deriveLLMContext: (entry) => {
      if (entry.kind === 'turn' && entry.metadata?.tokensUsed > 1_000) {
        return [{ role: 'assistant', content: /* summarized version */ }];
      }
      // Fall back to the default projection by returning the same shape.
      return /* ... */;
    },
  } satisfies HistoryConfig<TurnMeta>,
});
```

Without custom hooks, prose turns project to user intent and the response's
`userMessage`; injections project to one assistant message. Text-free turns
instead produce a bounded assistant-role structural summary. Truncated summaries
end with `[summary truncated]`. A custom `deriveLLMContext` retains full control,
including returning `[]` without hidden structural cost in `maxChars`.

The independent structured projection includes identity, timestamp, update
reasons, finalized layout, ordered actions, and optional text. These are accepted
plans, not observed action execution. `transformEntry` runs before both
projections. Public `SessionHistoryEntry` omits `assistantMessage` for text-free
turns. Dedup replays the finalized accepted response, including omitted prose.

Consecutive `assistant_message` injections produce consecutive `role: 'assistant'` messages in the LLM prompt. Modern chat APIs (Gemini, OpenAI, Anthropic) tolerate this; models that require strict user/assistant alternation will need an adapter-level shim.

**Ordering.** `getHistory` and `getLLMContext` sort entries by the envelope `timestamp` field (client-set wall clock), not by store insertion order. This matters when injections land while a long `chart_request` is still processing — the turn's `input.timestamp` is older than the injection even though the turn only enters the store after the LLM returns. Sorting by timestamp recovers the intended chronology in the common single-client case. Multi-device sessions with drifting clocks will see minor reordering; a server-side monotonic `receivedAt` is the right fix and is tracked in the cloud-engine improvements backlog as a follow-up to this reference implementation.

### Retry

For adapter shorthand and explicit `heal-and-ship`, the engine reads heal's
`retryHint.recommend` signal and repairs only when the response would otherwise
be a no-op (empty rendered layout when instances were requested, or every
proposed action skipped for a fixable reason). Shorthand defaults to one repair:
the initial call plus one repair call. Strict routes use material rejection
instead of this recommendation predicate.

The trigger is *exclusively* `retryHint.recommend === true` on a healed response. Errors short-circuit immediately:

| Outcome | Behavior |
|---|---|
| `Ok` with `retryHint.recommend === false` | success — ship the response (silently healed drops/warnings are normal and observable via the `Response healed` log line) |
| `Ok` with `retryHint.recommend === true` | retry with a structured prompt summarizing the prior diagnostics |
| `ProviderError`, `CancellationError`, `TimeoutError`, `ParseError`, `HistoryError` | fatal — surfaced as-is (these are not heal-recoverable; the LLM adapter handles its own transient retries) |

On repair, the LLM planner converts the bounded public finalization report into
feedback followed by the original user prompt. The system prompt is unchanged.
Reports include stable issue codes and available action, parameter, tree-token,
and schema-path locations; they do not include provider prompts or raw output.

```
The previous response had issues. Please re-issue the response addressing:

Layout drops:
- instance "calendar-main" at (0,10) size 4x3 exceeds chart bounds (12x8)

Skipped actions:
- Action "expand" on instance "panel-2" had unparseable params: {bad

Original request:
<original user prompt>
```

If every attempt produces `recommend === true`, the **last** attempt's response ships as-is — heal guarantees it is renderable, so the user sees a degraded UI rather than a blocked turn. The `Retries exhausted` log line is severity-routed via `logAtSeverity` (`info` for `low`/`none`, `warn` for `medium`, `error` for `unrecoverable`) and carries the final `retrySeverity` and diagnostic counts.

> **State drift visibility.** `state_drift` skipped actions are dropped from the response's execution plan and logged at error level by the simulator (`Vessel state drift: …, dropping action`), but they are NOT surfaced through the `Result` channel — `diagnostics` is engine-internal and stripped before the response crosses the engine boundary. Operators see drift in logs; programmatic callers do not. If you need branch-on-drift behaviour from outside the engine, route through your logger / alerting pipeline.

`maxRetries` is a non-negative integer. Set to `0` to disable retries entirely while keeping the layer wired (the `recommend` predicate still evaluates and the diagnostic summary still emits via the `Response healed` log line) — useful for deterministic test harnesses, replay scenarios, and consumers that own their own retry policy.

---

## Concurrency

The engine has **two** layers of per-session coordination, each protecting a different invariant:

1. **In-flight dedup Map** (in `chart-request-dedup`). Collapses concurrent duplicates that share the same `(sessionId, messageId)` onto a single LLM call — a follower attaches to the leader's promise instead of issuing its own. Idempotency only; it does NOT serialize *different* `chart_request`s on the same session.
2. **Per-session async mutex** (in `HistoryManager`). Serializes the post-LLM history-write path: `recordTurn`'s `store.append` + truncation, the truncation step inside `addAssistantMessage`, and `clear`. The LLM call itself runs OUTSIDE the mutex — concurrent `chart_request`s on the same session race their LLM reads/calls; the mutex only prevents racing truncations from clobbering each other's appends.

`assistant_message` is partially decoupled: the **append is lock-free** (dedup correctness is owned by `HistoryStore.append`'s atomicity), so an injection write doesn't queue behind a long-running `chart_request`. **Truncation, however, serializes via the same mutex** — both `recordTurn` and `addAssistantMessage` call `store.replace`, and racing replaces can clobber each other's appends. That gives correct bounds on the store *and* keeps the common case (write-then-resolve) fast when the cap isn't hit.

What this means in practice: two distinct `chart_request`s on the same session see the same prior history (both call `getLLMContext` lock-free) and run their LLM calls in parallel. They serialize only when they reach `recordTurn` — second writer queues behind the first. This is by design; the alternative (full chart_request serialization) would push end-to-end latency for back-to-back requests to the sum of their LLM calls instead of the max.

### Multi-instance deployment caveat

> **The in-process mutex only serializes within a single Node/Bun process.**

If two engine instances (pods, containers, processes) serve the same `sessionId`, their mutexes don't talk to each other. Concurrent `recordTurn` / `addAssistantMessage` truncations across pods can clobber each other's appends, resurrecting evicted entries or duplicating retained ones.

Stale LLM context and divergent assistant responses are a separate concern this mutex does **not** address even within a single process — the LLM call runs outside the critical section by design. Closing that gap requires session-level serialization at a higher layer (one of the options below); the LLM call is 1–5 seconds wide, so when this matters it's a user-visible bug, not a theoretical one.

Production multi-instance deployments MUST close this gap at a higher layer. Options:

- **Session affinity at the load balancer** — route all messages for a given `sessionId` to the same instance (consistent hashing or sticky sessions).
- **Distributed lock service** — Redis Redlock, Postgres advisory locks, ZooKeeper, etcd.
- **Per-session message queue** — partition a queue (Kafka, NATS JetStream, SQS FIFO) on `sessionId` so each session has exactly one in-flight consumer.

Similarly, the bundled `createInMemoryStore` is a reference implementation only — useful for local dev and tests, never appropriate for production. The `store` field on `HistoryConfig` is required precisely so a deployment can't accidentally inherit it. Production deployments must supply a `HistoryStore` backed by a persistent, atomic backend (Redis `SETNX`, SQLite `INSERT OR IGNORE`, Postgres `ON CONFLICT DO NOTHING`).

---

## Self-healing LLM output

The adapter compatibility policy favors a renderable subset when output can
be salvaged. The engine removes broken pieces and logs diagnostics. An explicit
strict route uses the same canonical checks but rejects material repairs.
Only the engine finalizer can remove proposal pieces; the route visibly chooses
whether that healed result may ship.

### What gets healed

Layout-level problems are filtered, not rejected:

| LLM mistake | Recovery |
|---|---|
| Position overflows the chart | Drop that position; render the rest. |
| Position smaller than variant `minSize` | Drop that position. |
| Layout references unknown instance / vessel / variant | Drop that position (or tree leaf). |
| Duplicate `instanceId` in the same layout | Keep first occurrence; drop subsequent duplicates. |
| Tiling tree split missing a child | Collapse the split to its single surviving child, or drop the entire branch when every child is missing. |
| Tiling tree has trailing extra tokens | Truncate to first complete subtree. |
| Tiling leaf references unknown instance | Drop that leaf; collapse the parent split. |
| Tiling tree names the same instance twice | Blank the repeat to `null`, keeping the split's arity and every following token's index. |
| Tiling split token has an unreadable weight suffix | Repair the weights in place — a warning, not a drop, because nothing was removed. |
| Tiling split token declares more than `MAX_SPLIT_CHILDREN` weights | Cut the arity to the cap. Recorded as a drop: the subtrees the discarded slots would have consumed re-parent onto an ancestor, reshaping the tree. |
| `rationale` field is empty | Demote to a non-fatal warning. |

Action-level problems (`SkippedAction`, exposed via `parseExecutionPlan`) are filtered the same way — `unknown_*`, `action_not_valid`, `params_parse_failed` etc. drop the bad action without affecting the rest of the execution plan.

### What still fails the turn

The compatibility path still fails when:

- The LLM produced no `userMessage` at all.
- The request is malformed, including an unknown `layoutMode`.
- A provider error / cancellation / history error occurred upstream (see `Errors` below).

Explicit strict routes also fail with semantic deferral when the complete plan
cannot be accepted after repair and fallback. Custom planners may omit prose;
the conventional LLM retains its presentation validation. See the protocol
README's [optional-text migration](https://docs.maelstrom-ai.co/reference/protocol/readme/#optional-text-migration).

### Engine-internal diagnostics

Internally the response carries a `diagnostics` block describing exactly what was healed, what was skipped, and how degraded the result is. This is stripped from the public response before it crosses the engine boundary; it powers retry-layer decisioning and observability. Layout drops and action skips are independent — neither short-circuits the other, and a single response can carry both. The engine emits a single `'Response healed'` log when any drop or warning fires, severity-routed via `logAtSeverity` (`info` for `low`/`none`, `warn` for `medium`, `error` for `unrecoverable`) so blank-UI responses cross default `warn`-threshold paging filters.

```ts
interface EngineDiagnostics {
  /** Per-action drops with structured detail (params parse failure, unknown instance, …). */
  readonly skippedActions: readonly SkippedAction[];
  /** Per-layout-entry drops (overflow, orphan, tree pruning …). */
  readonly droppedLayoutEntries: readonly DroppedLayoutEntry[];
  /** Non-fatal advisories that didn't affect the rendered output. */
  readonly warnings: readonly LayoutWarning[];
  /** Scalar signal describing how degraded the response is. */
  readonly retryHint: RetryHint;
}

// Discriminated union over the only valid severity × recommend pairs.
// Impossible combinations ({severity:'none', recommend:true} and
// {severity:'unrecoverable', recommend:false}) are unconstructable.
type RetryHint =
  | { readonly severity: 'none'; readonly recommend: false }
  | { readonly severity: 'low'; readonly recommend: false }
  | { readonly severity: 'medium'; readonly recommend: false }
  | { readonly severity: 'medium'; readonly recommend: true }
  | { readonly severity: 'unrecoverable'; readonly recommend: true };
```

`retryHint.recommend` is `true` when:
- The healed layout has zero renderable entries AND the request had `>0` instances, OR
- The healed `executionPlan` is empty, the LLM proposed `>0` actions, AND at least one skipped action was for a re-promptable reason (i.e. anything other than `state_drift`).

A response with a partial layout and a partial execution plan is **not** recommended for retry — the user gets a partial UI update, which beats waiting for a re-roll.

---

## Errors

`Engine.handle()` returns a `Result<EngineOutput, EngineError>`. The error union:

- **`ProviderError`** — provider or transport failure, including opaque adapter exceptions. The engine does not classify errors by message text.
- **`PlanningDeferredError`** — semantic uncertainty, unsupported capability, policy deferral, or strict `invalid_plan` after routing is exhausted.
- **`PlanningBudgetExceededError`** — the shared logical call budget cannot fund another invocation. Never fallback-eligible.
- **`InvalidProviderResponseError`** — a recognized malformed provider response, including a Jev schema failure. Canonical plan rejection is instead `invalid_plan`.
- **`ValidationError`** — malformed prompt customization, `assistant_message` without history configured, and similar caller-fixable conditions.
- **`RequestValidationError`** — malformed inbound envelope or chart request, with a structured failing path.
- **`ParseError`** — LLM output failed structural validation (e.g. missing `userMessage`).
- **`TimeoutError`** — the whole-operation deadline elapsed across stages, repairs, and fallback.
- **`CancellationError`** — the `AbortSignal` fired before or during the call.
- **`HistoryError`** — history-context loading, injection, or public history reads failed. `operation` identifies the failing path. A completed turn's history-write failure is advisory: the engine logs it and still returns the accepted response.

Errors carry structured fields (`_tag`, `message`, and per-variant context).
The envelope handler preserves distinct error tags as correlated `engine.error`
codes. Connectors reject them without applying a fake empty response. A terminal
error dispatches neither layout nor actions.
