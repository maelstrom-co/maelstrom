# @maelstrom-co/engine

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Reference implementation of the Maelstrom orchestration engine. Given the current chart state, available vessels, and accumulated update reasons, it takes a configured planner's candidate layout + execution plan, heals and validates it, and returns a structured response. The reference LLM planner lives in `@maelstrom-co/planner-llm`.

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/engine/readme/>

This package is a **reference implementation** — it ships to demonstrate how the engine contract works and to power local development and demos. Production deployments are expected to supply their own engine behind the same `Engine` interface.

> Looking for an introduction? See [The Engine](https://docs.maelstrom-ai.co/understanding/engine) on the docs site. This README is the technical reference for the reference implementation itself.

---

## Quickstart

The Gemini adapter reads its API key from `GOOGLE_API_KEY` or `GEMINI_API_KEY`.

```ts
import { geminiText } from '@tanstack/ai-gemini';
import {
  ChartRequestMessage,
  SessionId,
  isOk,
} from '@maelstrom-co/protocol';
import { createEngine } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';

const engine = createEngine({
  planner: llmPlanner({ adapter: geminiText('gemini-3.1-pro-preview') }),
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

Every input to `Engine.handle()` is an `EngineMessage` carrying `sessionId`, `id`, and `timestamp` alongside its payload. A successful `EngineOutput` echoes the input's `sessionId` and `id`. The following notation shows the two input and output kinds:

```ts
type EngineMessage =
  | { type: 'chart_request';     sessionId; id; timestamp; request }
  | { type: 'assistant_message'; sessionId; id; timestamp; content };

type EngineOutput =
  | { type: 'chart_response';           sessionId; id; response }
  | { type: 'assistant_message_result'; sessionId; id; outcome };
```

The request entry point dispatches on `message.type`. This excerpt shows `handle()`; the full `Engine` interface also provides `getHistory()`, `openConnection()`, and optional observation methods:

```ts
interface Engine {
  handle(
    message: EngineMessage,
    signal?: AbortSignal,
  ): Promise<Result<EngineOutput, EngineError>>;
}
```

### Why envelopes

The client assigns message and session IDs before sending a request. The Engine echoes them in its result, which lets callers correlate responses and lets configured history identify duplicate requests.

The duplex wire contract uses `ClientEnvelope` and `ServerEnvelope`. `handleEnvelope` decodes a client envelope, dispatches it, and maps the outcome back to the wire contract. For example, a successful `chart_response` becomes `engine.maelstrom.response`, with the input ID in `requestId`; a failed chart request becomes `engine.error`. The ordinary `assistant_message` wire envelope has no reply. Callers that need a receipt use `client.assistant_message.acknowledged`.

The protocol's factories and codecs own the message shapes. A host supplies transport plumbing and calls the adapter instead of constructing wire responses itself.

### Streaming connections

`engine.openConnection(options)` returns an isolated `AgentConnection` with `send`, `subscribe`, and `close`. The host supplies the authorized `sessionId` and `user` (`null` for anonymous sessions). Optional `token` and `capabilities` are host context, not Planner inputs. Provider API keys do not belong in `token`.

`send(input: unknown): Promise<void>` validates an [AgentInput](../protocol/README.md#agent-wire-frames). For an utterance, it resolves when planning ends or the connection closes, without waiting for a future acknowledgement. A queued send can remain pending until earlier work is acknowledged. `subscribe(listener)` observes future events and returns an unsubscribe function. Observer failures do not fail the run. `close()` aborts work, clears pending inputs and timers, and stops events. Calls after close do nothing.

The UI-only route emits `placeholder` and `accepted` immediately, then calls the configured Planner with the utterance text and no `skipReply` flag. It emits the validated response as `ui_change`. The browser applies the Layout Directive, runs the Execution Plan, then sends `ui_applied`. Only then does the connection emit the Planner reply as `message` followed by `finished`. Missing Action outcomes leave the change pending. Failed Action outcomes fail the run without a successful reply.

Planning stays serialized through acknowledgement. Queued utterances use the acknowledged Chart. The connection admits at most 32 pending utterances and remembers at most 4,096 input IDs without eviction. Duplicate input IDs are ignored. New inputs beyond these limits receive `queue_full` or `session_capacity`; a capacity-limited session needs a new connection.

`acknowledgementTimeoutMs` defaults to 30,000 milliseconds and accepts positive integers up to 2,147,483,647. Timeout fails the active run, cancels queued runs, and discards the uncertain Chart. A later utterance can supply a fresh Chart. Optional `clock` supplies monotonic milliseconds for elapsed-time metrics. UI-only loop-turn, tool-call, and loop-token counts are zero; elapsed time includes queueing and acknowledgement.

The request/reply API and its history store remain separate. Streaming connections neither read nor write that store. Agent transcripts and the tool loop are not implemented by this route.

Run-owned development diagnostics carry a server-minted `runId` in place of `requestId`, with the originating `inputId` in metadata. Planning-pipeline events keep their usual kinds, such as `engine.planner.started`. The connection's own lifecycle events use `engine.agent.*` kinds. Matching-session run diagnostics bypass legacy request-ID ambiguity and forwarding limits. Hosts still require explicit diagnostic opt-in; content requires `includeContent`. Production diagnostic forwarding remains disabled.

### Message variants

**`chart_request`** — asks the engine to produce a layout + execution plan for the current chart state. Runs the configured planner, then the response processor (heal and validate). If history is configured, the engine reads the session's prior turns + injections into the LLM call as prior messages (so the model reasons across turns), then records the completed turn after the response returns.

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

The engine's `handle()` requires envelopes with all required fields. It has no partial-input overloads. Always use the factories.

---

## Configuration

```ts
interface EngineConfig {
  /** Produces the candidate response for every chart_request. Required. */
  planner: ClarifyingPlanner;
  /** Optional synchronous requirement check on the healed response. */
  validatePlan?: PlanValidator;
  /** Logger (defaults to consoleLogger). */
  logger?: Logger;
  /** Opt-in conversation history (see below). */
  history?: HistoryConfig;
  /** Telemetry seam for planner stages (see Instrumentation). Default: noopInstrument. */
  instrument?: Instrument;
  /** Retry policy wrapped around `planner` (see Retry). Default: { max: 1 }. `false` runs the planner once. */
  retry?: { max: number } | false;
}
```

`planner` is usually a `Planner`, a `Stage<PlanningInput, PlannerCandidate>`. The field accepts the wider `ClarifyingPlanner` so a planner serving `skipReply` requests can also return replyless candidates or a needs-clarification result (see [skipReply and needs-clarification](#skipreply-and-needs-clarification)). Most consumers use `llmPlanner` from [`@maelstrom-co/planner-llm`](https://github.com/maelstrom-co/maelstrom/blob/main/packages/planner-llm/README.md), which makes a single structured-output LLM call per attempt.

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
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';

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

On retry, `llmPlanner` (from `@maelstrom-co/planner-llm`) replaces the user prompt with a structured feedback block followed by the verbatim original prompt. The system prompt is unchanged, so the LLM still has the full vessel/variant catalogue and chart bounds — diagnostics cite fields by name and trust the LLM to re-derive valid options from context. Tree-malformation drops collapse to a single advisory line (token-position fields would be useless to the LLM); `state_drift` skips are suppressed (the LLM cannot fix engine-state mismatch by re-prompting).

```
The previous response had issues. Please re-issue the response addressing:

Layout drops:
- instance "calendar-main" at (0,10) size 4x3 exceeds chart bounds (12x8)

Skipped actions:
- Action "expand" on instance "panel-2" had unparseable params: {bad

Original request:
<original user prompt>
```

If every attempt produces `recommend === true`, the **last** attempt's response ships as-is unless application requirements remain unmet (see [Plan validation](#plan-validation)). Heal guarantees a renderable response, but cannot guarantee application-specific requirements. The `Retries exhausted` log line is severity-routed via `logAtSeverity` (`info` for `low`/`none`, `warn` for `medium`, `error` for `unrecoverable`) and carries the final `retrySeverity` and diagnostic counts.

> **State drift visibility.** `state_drift` skipped actions are dropped from the response's execution plan and logged at error level by the simulator (`Vessel state drift: …, dropping action`), but they are NOT surfaced through the `Result` channel — detailed diagnostics stay internal; planner stages receive only `retryHint` (plus per-kind `counts`) and sanitized `feedback` text, so drift is visible in logs and feedback prose, not as data. Operators see drift in logs; programmatic callers cannot branch on it. If you need branch-on-drift behaviour from outside the engine, route through your logger / alerting pipeline.

`retry.max` is a non-negative integer. `retry: false` (or `{ max: 0 }`) runs the planner once; the Engine still heals and validates the candidate and emits the `Response healed` log line either way. Use `retry: false` for deterministic test harnesses, replay scenarios, and planners that own their own retry policy.

### Plan validation

`validatePlan` checks explicit application requirements after layout healing and Action validation.
It receives the original `ChartRequest` and the `MaelstromResponse` that would reach the client, without Engine diagnostics.
The application owns requirement selection. The Engine does not interpret user prose or add a model call to infer requirements.

This configuration fragment requires a known Instance to remain visible:

```ts
import { createEngine, type Planner, type PlanValidator } from '@maelstrom-co/engine';
import { InstanceId, tilingLeafToken } from '@maelstrom-co/protocol';

const requireCalendar: PlanValidator = ({ response }) => {
  const visible = response.layout.type === 'grid'
    ? response.layout.positions.some(({ instanceId }) => instanceId === 'calendar-main')
    : response.layout.tree.includes(tilingLeafToken(InstanceId('calendar-main')));
  return visible ? [] : [{
    code: 'required_view',
    message: 'Keep calendar-main visible in the layout.',
  }];
};

export function createCalendarEngine(planner: Planner) {
  return createEngine({ planner, validatePlan: requireCalendar, retry: { max: 1 } });
}
```

Tiling `layout.instances` retains hidden Instances. Check tree leaves to require a displayed view.
Check `response.executionPlan` for accepted Actions; it excludes skipped Actions.

- Return `[]` to accept the response. Existing healing diagnostics still apply.
- Return `{ code, message }` issues to recommend a retry within the existing budget.
  Codes and messages must be nonempty strings. Both appear in `RetryFeedback.diagnostics.planIssues`.
- Feedback uses the shared sanitization, line, and byte limits. Each rendered code and message is limited to 128 code points.
- Unresolved issues return `ValidationError` with `field: 'validatePlan'` and the final issues in `cause`.
  This also applies to `retry: false`, `{ max: 0 }`, and custom planners that bypass `ctx.validate`.
  A rejected response does not enter successful turn history or reach the client.
- Throws, Promise returns, and malformed results return `ValidationError` immediately without retrying the planner.

The hook is synchronous, deterministic, and side-effect free. Do not mutate either input.
Validation is cached per candidate object per request, including calls through `ctx.validate` and the final Engine guard.
Without `validatePlan`, existing behavior is unchanged. This hook does not replace authorization or Action-handler validation.

---

## Planners and stages

`EngineConfig.planner` is a `ClarifyingPlanner`, a `Stage<PlanningInput, PlannerOutput>`: a function from the request (plus context: signal, logger, instrument, the original request, and a `validate` callback) to a candidate response or a failure. `llmPlanner` from `@maelstrom-co/planner-llm` is the stage most consumers need, but the same `Stage` shape composes:

- **`pipeline(...stages)`** chains stages so each one's output feeds the next, typed end to end (up to nine stages). The first `Err` — a `Deferred` or an `EngineError` — stops the chain.
- **`withFallback(primary, fallback)`** runs `fallback` only when `primary` returns a `Deferred` (a stage abstaining from the request via `deferred(reason)`, checked with `isDeferred`). A real `EngineError` from `primary` is never masked.
- **`withRetry(stage, { max })`** is the same combinator the Engine applies by default around `EngineConfig.planner`. It wraps a stage that produces a `PlannerOutput` (typically the last stage of a pipeline) and retries it when healing recommends a retry. A needs-clarification result is returned without a retry. When you place it yourself, set `retry: false` on the Engine so the retries do not multiply.

A `Deferred` that reaches the top of the configured planner with nothing to recover it becomes `Err(ValidationError)` on field `'planner'` — the Engine cannot ship a response without a candidate.

### skipReply and needs-clarification

A `ChartRequest` may set `skipReply: true` when its caller writes the reply itself, and may carry `intentFacts`, structured values the caller already knows. Both reach every stage unchanged through `input.request`, and `withRetry` and `withFallback` pass them through.

The flag changes what validation accepts:

- Without `skipReply`, a candidate must carry a non-blank `userMessage`. A needs-clarification result is `Err(ValidationError)` on field `'planner'`.
- With `skipReply: true`, a candidate may omit `userMessage` (a supplied one, even blank, is passed through unchanged), and a planner may return a `NeedsClarification` (`{ type: 'needs_clarification', question, options? }`, see `isNeedsClarification`) instead. Its diagnostics are empty and never recommend a retry, and `withRetry` returns it on the attempt that produced it.

The types keep the two cases apart. `PlannerCandidate` and `ValidatedCandidate` always carry a `userMessage`. `ReplylessCandidate` and `ValidatedReplylessCandidate` are the same shapes with `userMessage` optional, and `PlannerOutput` is `PlannerCandidate | ReplylessCandidate | NeedsClarification`. In a stage, `ctx.validate` returns a `ValidatedCandidate` for a `PlannerCandidate` and a `ValidatedReplylessCandidate` for a `ReplylessCandidate`. It does not accept a `NeedsClarification`.

A plain `Planner` keeps its strict types through the combinators: `withRetry`, `withFallback` and `pipeline` return a `Planner` for it, and its `RetryFeedback.previous` is a `PlannerCandidate`. A stage whose output is wider gets a result that is just as wide. For example, `withRetry` on a stage returning any `PlannerOutput` yields a `ClarifyingPlanner` and hands it `Retryable<In, ReplylessCandidate>` feedback. A `Planner` that only returns strict candidates is still a valid `EngineConfig.planner`.

`Engine.handle()` still answers with a `chart_response` whose `userMessage` is required. A `skipReply: true` request whose planner returns no `userMessage` or a blank one, or a needs-clarification result, is refused with `Err(ValidationError)` on field `'skipReply'` until the Engine has a path that can return those outcomes.

```ts
import { pipeline, withFallback } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';

const planner = withFallback(
  pipeline(selectVessels, arrangeLayout),
  llmPlanner({ adapter }),
);
```

### Instrumentation

`EngineConfig.instrument` is the telemetry seam of the planner, and every stage receives it as `StageContext.instrument`. It has two methods:

- **`stage(name, stage)`** wraps one stage of a `pipeline`, once per request, just before the stage runs. Return the stage itself, a stage that calls through to it (to time or trace it), or a different stage (for example one that replays a recorded output). `name` is the one given with `named(name, stage)`, or `stage-<index>` for an unnamed stage. `stageName(stage)` reads it back.
- **`event(name, attributes)`** reports something that happened inside a stage, such as a model call. Attributes are a flat bag of strings, numbers and booleans. Provider call sites use the OpenTelemetry GenAI keys (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`); Maelstrom-specific keys start with `maelstrom.`.

The default, `noopInstrument`, returns every stage unchanged and ignores every event. A logging implementation takes a few lines:

```ts
import { createEngine, type Instrument } from '@maelstrom-co/engine';

const loggingInstrument: Instrument = {
  stage: (name, stage) => async (input, ctx) => {
    const started = performance.now();
    const result = await stage(input, ctx);
    ctx.logger.info('stage', { name, latencyMs: performance.now() - started });
    return result;
  },
  event: (name, attributes) => console.info(name, attributes),
};

const engine = createEngine({ planner, instrument: loggingInstrument });
```

`withRetry` re-runs its stage as a whole, so a retried pipeline reports its stages again.

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

- The LLM produced no `userMessage` at all. With `skipReply: true` validation accepts that, but `handle()` still refuses to ship it (see [skipReply and needs-clarification](#skipreply-and-needs-clarification)).
- The configured `layoutMode` is unsupported (programmer error).
- A provider error / cancellation / history error occurred upstream (see `Errors` below).

Everything else returns `Ok(EngineOutput)`. The response may omit invalid layout entries or actions. Consumers do not see the recovery path — they see either a usable response or a hard error.

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

## Operational telemetry

`attachEngineTelemetry(engine, telemetry)` observes server-local metadata in every
environment. Import the attachment from `@maelstrom-co/engine` and create the
application-owned delivery instance with `@maelstrom-co/telemetry`.

Attach before requests. The attachment returns `{ release, drained }`. Stop accepting
work, release every attachment, and await its drain before the final flush and disposal. This enables
neither content capture nor Engine-to-browser forwarding. Whole request handling,
planning, and nested stages have independent local durations. Idempotent followers
count handled requests while one shared planner run produces one planning outcome.
Cancellation stays separate from failure; deferred stages count as skipped work.
Unexpected planner and stage throws count as unknown failures while retaining the
existing Engine error shape. Genuine validation failures keep their validation
category. Stage-authored instrument events remain diagnostic evidence; only
Engine-owned events contribute operational counts.

The application owns SDKs, exporters, flush, and disposal. See the
[telemetry package](../telemetry/README.md) for the sink contract and limits.

## Errors

`Engine.handle()` returns a `Result<EngineOutput, EngineError>`. The error union:

- **`ProviderError`** — LLM adapter failure (rate limit, service unavailable, non-Error rejection).
- **`ValidationError`**: a planner that cannot build its prompt from the request, `assistant_message` without history configured, unsupported `layoutMode`, and similar caller-fixable conditions.
- **`ParseError`** — LLM output failed structural validation (e.g. missing `userMessage`).
- **`TimeoutError`** — configured LLM call timeout elapsed.
- **`CancellationError`** — the `AbortSignal` fired before or during the call.
- **`HistoryError`** — the configured `HistoryStore` failed during a record/persist operation. Distinct from `ProviderError` (LLM adapter) so callers can route LLM vs. store failures to different recovery paths. `operation` identifies which engine entry point surfaced the failure (`'record_turn' | 'add_assistant_message' | 'clear'`).

All errors carry structured fields (`_tag`, `message`, and per-variant context) so routing and retry logic can branch without string-sniffing. (Layout-output problems no longer surface as a dedicated error tag — they heal into `diagnostics.droppedLayoutEntries` per the section above.)
