# @maelstrom-co/engine

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Reference implementation of the Maelstrom orchestration engine. Given the current chart state, available vessels, and accumulated update reasons, it asks an LLM for a layout + execution plan and returns a structured response.

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
import { createEngine, llmPlanner } from '@maelstrom-co/engine';

const engine = createEngine({
  planner: llmPlanner({ adapter: geminiText('gemini-2.0-flash') }),
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

**`chart_request`** — asks the engine to produce a layout + execution plan for the current chart state. Runs the full prompt → LLM → response-processor pipeline. If history is configured, the engine reads the session's prior turns + injections into the LLM call as prior messages (so the model reasons across turns), then records the completed turn after the response returns.

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

```ts
interface EngineConfig {
  /** Produces the candidate response for every chart_request. Required. */
  planner: Planner;
  /** Logger (defaults to consoleLogger). */
  logger?: Logger;
  /** Opt-in conversation history (see below). */
  history?: HistoryConfig;
  /** Retry policy wrapped around `planner` (see Retry). Default: { max: 1 }. `false` runs the planner once. */
  retry?: { max: number } | false;
}
```

`planner` is a `Stage<PlanningInput, PlannerCandidate>` — most consumers reach for `llmPlanner`, which makes a single structured-output LLM call per attempt:

```ts
interface LlmPlannerOptions {
  /** TanStack AI text adapter. Required. */
  adapter: AnyTextAdapter;
  /** Section-based prompt customization. */
  prompt?: PromptOptions;
  /** Provider-specific options forwarded verbatim to every `chat()` call. */
  modelOptions?: Record<string, unknown>;
}
```

```ts
import { geminiText } from '@tanstack/ai-gemini';
import { llmPlanner } from '@maelstrom-co/engine';

const planner = llmPlanner({ adapter: geminiText('gemini-2.0-flash') });
```

See [Planners and stages](#planners-and-stages) below for composing more than one LLM call, or non-LLM steps, into a planner.

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
  deriveLLMContext?: (entry: HistoryEntry<TMeta>) => readonly LLMContextMessage[];
}
```

`store` has no default. Local dev and tests pass `createInMemoryStore()` explicitly:

```ts
import { createEngine, createInMemoryStore, llmPlanner } from '@maelstrom-co/engine';

const engine = createEngine({
  planner: llmPlanner({ adapter: /* ... */ }),
  history: {
    store: createInMemoryStore(),
    maxEntries: 50,
    maxChars: 40_000,
  },
});
```

Production deployments supply a persistent, atomic backend (Redis, Postgres, SQLite, …). The reference engine refuses to silently fall back to an in-process store because a configured `history` block deserves an explicit choice — silently losing every session on process restart is the kind of bug you want a type error to flag, not a runtime surprise.

Truncation is hybrid — both `maxEntries` and `maxChars` are enforced on write, newest-first. The most recent entry is always retained even if it alone exceeds the char budget (losing the user's latest turn would be more visibly broken than exceeding the cap).

**Oversized injections are rejected at the engine boundary.** When `maxChars` is configured, an `assistant_message` whose `content.length` exceeds `maxChars` returns `ValidationError('content')` instead of being persisted. This closes the loop on the "newest entry always wins" rule: without a boundary check, a single 10MB injection would silently dominate every subsequent LLM call. A turn-shaped entry that legitimately fills the cap is still allowed; the rule targets pathological inputs that can never coexist with the configured budget. If `maxChars` is omitted, no size validation runs.

### Richer entries with typed metadata

`HistoryEntry<TMeta>` exposes an optional `metadata` slot so production deployments can ride auxiliary data along every entry (tenant id, experiment arm, token counts, audit fields) without forking the entry shape:

```ts
interface TurnMeta {
  readonly tenantId: string;
  readonly tokensUsed: number;
}

const engine = createEngine({
  planner: llmPlanner({ adapter: /* ... */ }),
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

When neither hook is supplied the engine uses its defaults: turns project to a user message (from user_intent reasons) + an assistant message (from the response's userMessage); injections project to a single assistant message.

Consecutive `assistant_message` injections produce consecutive `role: 'assistant'` messages in the LLM prompt. Modern chat APIs (Gemini, OpenAI, Anthropic) tolerate this; models that require strict user/assistant alternation will need an adapter-level shim.

**Ordering.** `getHistory` and `getLLMContext` sort entries by the envelope `timestamp` field (client-set wall clock), not by store insertion order. This matters when injections land while a long `chart_request` is still processing — the turn's `input.timestamp` is older than the injection even though the turn only enters the store after the LLM returns. Sorting by timestamp recovers the intended chronology in the common single-client case. Multi-device sessions with drifting clocks will see minor reordering; a server-side monotonic `receivedAt` is the right fix and is tracked in the cloud-engine improvements backlog as a follow-up to this reference implementation.

### Retry

The Engine wraps the configured `planner` in `withRetry(planner, config.retry)` unless `config.retry` is `false`. `withRetry` reads heal's `retryHint.recommend` signal and re-runs the planner only when the response would otherwise leave the user staring at a no-op (empty rendered layout when instances were requested, or every proposed action skipped for a fixable reason). Default: `{ max: 1 }` (initial attempt plus one retry — two total planner runs in the worst case).

`retry: false` runs the planner exactly once, with no engine-level retry — the right choice for a planner (or a stage inside one) that already retries its own steps, since a second engine-level retry would multiply on top of the planner's own.

The trigger is *exclusively* `retryHint.recommend === true` on a healed response. Errors short-circuit immediately:

| Outcome | Behavior |
|---|---|
| `Ok` with `retryHint.recommend === false` | success — ship the response (silently healed drops/warnings are normal and observable via the `Response healed` log line) |
| `Ok` with `retryHint.recommend === true` | retry with a structured prompt summarizing the prior diagnostics |
| `ProviderError`, `CancellationError`, `TimeoutError`, `ParseError`, `HistoryError` | fatal — surfaced as-is (these are not heal-recoverable; the LLM adapter handles its own transient retries) |

On retry, the user prompt is replaced with a structured feedback block followed by the verbatim original prompt. The system prompt is unchanged, so the LLM still has the full vessel/variant catalogue and chart bounds — diagnostics cite fields by name and trust the LLM to re-derive valid options from context. Tree-malformation drops collapse to a single advisory line (token-position fields would be useless to the LLM); `state_drift` skips are suppressed (the LLM cannot fix engine-state mismatch by re-prompting).

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

`retry.max` is a non-negative integer. Set to `{ max: 0 }` to disable retries entirely while keeping the layer wired (the `recommend` predicate still evaluates and the diagnostic summary still emits via the `Response healed` log line) — useful for deterministic test harnesses, replay scenarios, and consumers that own their own retry policy.

---

## Planners and stages

`EngineConfig.planner` is a `Stage<PlanningInput, PlannerCandidate>` — a function from the request (plus context: signal, logger, the original request, and a `validate` callback) to a candidate response or a failure. `llmPlanner` is the stage most consumers need, but the same `Stage` shape composes:

- **`pipeline(...stages)`** chains stages so each one's output feeds the next, typed end to end (up to nine stages). The first `Err` — a `Deferred` or an `EngineError` — stops the chain.
- **`withFallback(primary, fallback)`** runs `fallback` only when `primary` returns a `Deferred` (a stage abstaining from the request via `deferred(reason)`, checked with `isDeferred`). A real `EngineError` from `primary` is never masked.
- **`withRetry(stage, { max })`** is the same combinator the Engine applies by default around `EngineConfig.planner`. It wraps a stage that produces a `PlannerCandidate` (typically the last stage of a pipeline) and retries it when healing recommends a retry. When you place it yourself, set `retry: false` on the Engine so the retries do not multiply.

A `Deferred` that reaches the top of the configured planner with nothing to recover it becomes `Err(ValidationError)` on field `'planner'` — the Engine cannot ship a response without a candidate.

```ts
import { llmPlanner, pipeline, withFallback } from '@maelstrom-co/engine';

const planner = withFallback(
  pipeline(selectVessels, arrangeLayout),
  llmPlanner({ adapter }),
);
```

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

Maelstrom is built for realtime UX: every delay before the user sees something update is worse than serving partial results. The engine therefore favors **lenient recovery over strict rejection**. When the LLM produces output that can be partially salvaged, the engine drops the broken pieces, logs them as structured diagnostics, and returns the recovered response — instead of failing the whole turn.

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

`Engine.handle()` returns `Err` only for genuinely unrecoverable conditions:

- The LLM produced no `userMessage` at all.
- The configured `layoutMode` is unsupported (programmer error).
- A provider error / cancellation / history error occurred upstream (see `Errors` below).

Everything else returns `Ok(EngineOutput)` with a possibly-degraded response. Consumers do not see the recovery path — they see either a usable response or a hard error.

### Engine-internal diagnostics

Internally the response carries a `diagnostics` block describing exactly what was healed, what was skipped, and how degraded the result is. This is stripped from the public response before it crosses the engine boundary; it powers retry-layer decisioning and observability. Planner stages see only the public `EngineDiagnostics` summary (`retryHint`, per-kind `counts`, and sanitized `feedback` text); the per-entry records below stay internal. Layout drops and action skips are independent — neither short-circuits the other, and a single response can carry both. The engine emits a single `'Response healed'` log when any drop or warning fires, severity-routed via `logAtSeverity` (`info` for `low`/`none`, `warn` for `medium`, `error` for `unrecoverable`) so blank-UI responses cross default `warn`-threshold paging filters.

```ts
// Engine-internal records; not exported.
interface HealRecords {
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

- **`ProviderError`** — LLM adapter failure (rate limit, service unavailable, non-Error rejection).
- **`ValidationError`** — malformed prompt customization, `assistant_message` without history configured, unsupported `layoutMode`, and similar caller-fixable conditions.
- **`ParseError`** — LLM output failed structural validation (e.g. missing `userMessage`).
- **`TimeoutError`** — configured LLM call timeout elapsed.
- **`CancellationError`** — the `AbortSignal` fired before or during the call.
- **`HistoryError`** — the configured `HistoryStore` failed during a record/persist operation. Distinct from `ProviderError` (LLM adapter) so callers can route LLM vs. store failures to different recovery paths. `operation` identifies which engine entry point surfaced the failure (`'record_turn' | 'add_assistant_message' | 'clear'`).

All errors carry structured fields (`_tag`, `message`, and per-variant context) so routing and retry logic can branch without string-sniffing. (Layout-output problems no longer surface as a dedicated error tag — they heal into `diagnostics.droppedLayoutEntries` per the section above.)
