# @maelstrom-co/engine

Reference implementation of the Maelstrom orchestration engine. Given the current chart state, available vessels, and accumulated update reasons, it asks an LLM for a layout + execution plan and returns a structured response.

This package is a **reference implementation** — it ships to demonstrate how the engine contract works and to power local development and demos. Production deployments are expected to supply their own engine behind the same `Engine` interface.

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
- **Client constructs, middlemen pass through.** The client edge (React provider, voice session loop, HTTP caller) calls the protocol factory functions and produces a fully-formed envelope. Nothing downstream mutates it.

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
  /** TanStack AI text adapter. Required. */
  adapter: AnyTextAdapter;
  /** Logger (defaults to consoleLogger). */
  logger?: Logger;
  /** Section-based prompt customization. */
  prompt?: PromptOptions;
  /** Opt-in conversation history (see below). */
  history?: HistoryConfig;
}
```

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

When neither hook is supplied the engine uses its defaults: turns project to a user message (from user_intent reasons) + an assistant message (from the response's userMessage); injections project to a single assistant message.

Consecutive `assistant_message` injections produce consecutive `role: 'assistant'` messages in the LLM prompt. Modern chat APIs (Gemini, OpenAI, Anthropic) tolerate this; models that require strict user/assistant alternation will need an adapter-level shim.

**Ordering.** `getHistory` and `getLLMContext` sort entries by the envelope `timestamp` field (client-set wall clock), not by store insertion order. This matters when injections land while a long `chart_request` is still processing — the turn's `input.timestamp` is older than the injection even though the turn only enters the store after the LLM returns. Sorting by timestamp recovers the intended chronology in the common single-client case. Multi-device sessions with drifting clocks will see minor reordering; a server-side monotonic `receivedAt` is the right fix and is tracked in the cloud-engine improvements backlog as a follow-up to this reference implementation.

---

## Concurrency

The engine serializes `chart_request` processing per session via an in-process async mutex. Concurrent `chart_request` messages on the same session queue; messages on different sessions run in parallel.

`assistant_message` is partially decoupled: the **append is lock-free** (dedup correctness is owned by `HistoryStore.append`'s atomicity), so an injection write doesn't queue behind a long-running `chart_request`. **Truncation, however, serializes via the same mutex** — both `recordTurn` and `addAssistantMessage` call `store.replace`, and racing replaces can clobber each other's appends. That gives correct bounds on the store *and* keeps the common case (write-then-resolve) fast when the cap isn't hit.

### Multi-instance deployment caveat

> **The in-process mutex only serializes within a single Node/Bun process.**

If two engine instances (pods, containers, processes) serve the same `sessionId`, their mutexes don't talk to each other. Concurrent `chart_request` messages across instances will race — producing stale LLM context, divergent assistant responses, and inconsistent history truncation. The LLM call is 1–5 seconds wide; this is a user-visible bug, not a theoretical one.

Production multi-instance deployments MUST close this gap at a higher layer. Options:

- **Session affinity at the load balancer** — route all messages for a given `sessionId` to the same instance (consistent hashing or sticky sessions).
- **Distributed lock service** — Redis Redlock, Postgres advisory locks, ZooKeeper, etcd.
- **Per-session message queue** — partition a queue (Kafka, NATS JetStream, SQS FIFO) on `sessionId` so each session has exactly one in-flight consumer.

Similarly, the bundled `createInMemoryStore` is a reference implementation only — useful for local dev and tests, never appropriate for production. The `store` field on `HistoryConfig` is required precisely so a deployment can't accidentally inherit it. Production deployments must supply a `HistoryStore` backed by a persistent, atomic backend (Redis `SETNX`, SQLite `INSERT OR IGNORE`, Postgres `ON CONFLICT DO NOTHING`).

---

## Errors

`Engine.handle()` returns a `Result<EngineOutput, EngineError>`. The error union:

- **`ProviderError`** — LLM adapter failure (rate limit, service unavailable, non-Error rejection).
- **`ValidationError`** — malformed prompt customization, `assistant_message` without history configured, and similar caller-fixable conditions.
- **`ParseError`** — LLM output failed structural validation.
- **`TimeoutError`** — configured LLM call timeout elapsed.
- **`CancellationError`** — the `AbortSignal` fired before or during the call.
- **`HistoryError`** — the configured `HistoryStore` failed during a record/persist operation. Distinct from `ProviderError` (LLM adapter) so callers can route LLM vs. store failures to different recovery paths. `operation` identifies which engine entry point surfaced the failure (`'record_turn' | 'add_assistant_message' | 'clear'`).

All errors carry structured fields (`_tag`, `message`, and per-variant context) so routing and retry logic can branch without string-sniffing.
