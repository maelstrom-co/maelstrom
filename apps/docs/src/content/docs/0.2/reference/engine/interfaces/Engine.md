---
editUrl: false
next: false
prev: false
title: "Engine"
---

Defined in: packages/engine/src/lib/engine.ts:119

The engine's public surface. Construct via [createEngine](/reference/engine/functions/createengine/).

Stateful at the session level: a per-session async mutex inside
`HistoryManager` serializes `recordTurn` and the truncation step of
`addAssistantMessage` and `clear`; in-process only — multi-instance
deployments must close that gap externally, see the README's Concurrency
section. The planner call itself is NOT mutex-protected — concurrent
`chart_request`s on the same session race their history reads and
planner calls; the in-flight dedup Map only collapses identical
`(sessionId, messageId)` duplicates, not different requests.

Stateless at the request level: a `chart_request` flows history load →
planner (optionally retried) → response-processor → history record
without retained inter-call state beyond what the configured
`HistoryStore` persists.

Both safeguards are process-local: multi-instance deployments need
deployment-level coordination for history mutations and for identical
requests that may reach different instances.

## Properties

### observeDiagnostics?

> `optional` **observeDiagnostics?**: (`observer`) => () => `void`

Defined in: packages/engine/src/lib/engine.ts:123

Observes development evidence. Overlapping legacy request IDs suppress request-correlated events except engine.request.finished. Run-owned events and metadata observers are unaffected. Hosts must opt in before forwarding.

#### Parameters

##### observer

[`EngineDiagnosticObserver`](/reference/engine/type-aliases/enginediagnosticobserver/)

#### Returns

() => `void`

***

### observeMetadata?

> `optional` **observeMetadata?**: (`observer`) => () => `void`

Defined in: packages/engine/src/lib/engine.ts:125

Observes server-local metadata in every environment, without granting content or browser forwarding.

#### Parameters

##### observer

`TelemetryMetadataObserver`

#### Returns

() => `void`

## Methods

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<`Result`\<readonly `SessionHistoryEntry`[], [`EngineError`](/reference/engine/type-aliases/engineerror/)\>\>

Defined in: packages/engine/src/lib/engine.ts:208

Read the recorded history for a session, projected into the public wire
shape. Used by clients that persist a session id and need to rehydrate
prior context after a refresh, on a new device, or in a parallel tab.

The engine's internal storage record is heavier (full request and
response payloads, optional metadata); the returned
SessionHistoryEntry carries only what a chat UI needs to render
the conversation. This decoupling lets the engine evolve its storage
shape without breaking the wire contract.

Lock-free read — does not serialize with concurrent `handle` calls on
the same session. Entries are returned in chronological order by
envelope `timestamp`, matching [HistoryManager.getHistory](/reference/engine/interfaces/historymanager/#gethistory).

Returns `Err(ValidationError)` when the engine was constructed without
a `history` config — the same shape used by `assistant_message` so
callers can branch on `_tag` once. Returns `Err(HistoryError)` with
`operation: 'get_history'` when the underlying store throws.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<`Result`\<readonly `SessionHistoryEntry`[], [`EngineError`](/reference/engine/type-aliases/engineerror/)\>\>

***

### handle()

> **handle**(`message`, `signal?`): `Promise`\<`Result`\<`EngineOutput`, [`EngineError`](/reference/engine/type-aliases/engineerror/)\>\>

Defined in: packages/engine/src/lib/engine.ts:183

Routes on `message.type`:

- `chart_request` → hands the request and prior history to the
  configured planner, heals its candidate against the request (drops
  broken pieces, returns a renderable layout), retries per
  `EngineConfig.retry` when validation recommends, and records the turn.
  Returns `Ok(chart_response)` for renderable outcomes accepted by
  `EngineConfig.validatePlan`, when configured (including healed-with-drops).
- `assistant_message` → persists developer-supplied content into
  session history. Does NOT invoke the planner. Returns
  `Ok(assistant_message_result)` with `outcome: 'inserted' | 'deduped'`.

`Err` is reserved for genuinely unrecoverable conditions (provider
fault, cancellation, prompt-build failure, invalid Action parameter
definitions in the Vessel catalog (field `'vessels'`), history error,
missing `userMessage`, a planner that deferred with no fallback or
threw). A request that set `skipReply: true` still ships only a
response with a non-blank `userMessage`: a candidate without one or with
a blank one, or a needs-clarification result, is `Err(ValidationError)` on field
`'skipReply'`, since a `chart_response` always carries a reply.
Invalid `validatePlan` callbacks and unmet application requirements also
return `ValidationError` on field `'validatePlan'`.
Layout problems heal into diagnostics rather than surfacing here — see
[EngineDiagnostics](/reference/engine/interfaces/enginediagnostics/) (planner stages see only a summary:
`retryHint`, `counts`, rendered `feedback`, and optional `planIssues`;
detailed healing records stay internal and are stripped before the response
crosses the Engine boundary).

`signal` cancels mid-flight: it reaches every planner stage as
`StageContext.signal`. A stage that calls a provider is expected to
short-circuit a pre-aborted signal to `CancellationError` and to map an
abort during the call the same way.
A stage that throws after the signal aborted also yields
`CancellationError`.

**Idempotency.** When `history` is configured on [EngineConfig](/reference/engine/interfaces/engineconfig/),
two duplicate `chart_request` envelopes sharing the same `(sessionId,
id)` collapse onto a single planner run: a duplicate that arrives after
the original completed replays the stored `chart_response` from
history; a duplicate that arrives mid-flight awaits the leader's
promise. Failures are not persisted — the next duplicate after a
failure reaches the planner as a fresh request. Eviction is bounded by
`HistoryManager` truncation only. Without `history` configured, no
dedup happens and every request reaches the planner.

**Cancellation note for idempotency followers.** A follower (second
concurrent caller) that aborts its own `signal` resolves its own await
with `Err(CancellationError)`; the leader's planner run continues. If the
leader's signal aborts, the leader's promise resolves with
`Err(CancellationError)` under the engine contract — an unguarded
pipeline throw escapes as `Err(historyError.leaderPipeline)` instead
(see the defensive catch in `chart-request-dedup`'s `awaitWithSignal`).
Either way, any followers awaiting the leader observe the same `Err`
value via the shared promise. Callers that don't want another caller's
abort to surface to them must not reuse the `messageId`.

#### Parameters

##### message

`EngineMessage`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`Result`\<`EngineOutput`, [`EngineError`](/reference/engine/type-aliases/engineerror/)\>\>

***

### openConnection()

> **openConnection**(`options`): [`AgentConnection`](/reference/engine/interfaces/agentconnection/)

Defined in: packages/engine/src/lib/engine.ts:121

Opens an isolated Agent Session with host-authorized identity. The UI-only route does not use the legacy history store.

#### Parameters

##### options

[`OpenConnectionOptions`](/reference/engine/interfaces/openconnectionoptions/)

#### Returns

[`AgentConnection`](/reference/engine/interfaces/agentconnection/)
