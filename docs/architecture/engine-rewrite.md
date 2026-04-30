# Engine Rewrite Architecture

> Reference document for the MAE-99 engine rewrite epic. Describes the target architecture, package relationships, data flows, and key contracts.
>
> Design spec: `docs/superpowers/specs/2026-04-01-engine-rewrite-design.md`

## Package Dependency Graph

```
                    ┌──────────────────┐
                    │    protocol       │  Result, SessionId, MessageId,
                    │                  │  InstanceId, ChartRequest, Vessel,
                    │                  │  MaelstromResponse, Zod schemas
                    │                  │  (+ EngineMessage/Output after MAE-102)
                    └────────┬─────────┘
                             │ imported by
                ┌────────────┼────────────┬─────────────┐
                │            │            │             │
                ▼            ▼            ▼             ▼
         ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
         │  engine   │  │  client   │  │  react    │  │ voice-server  │
         └──────────┘  └──────────┘  └──────────┘  └──────────────┘
                              │
                              │ legacy imports only (Success/Err/Result,
                              │  vessel-inference helpers, voice wire)
                              ▼
                       ┌──────────────┐
                       │ protocol-old  │  (action-runner runtime contract,
                       │              │   voice wire format, engine-old)
                       └──────────────┘

  Key: engine and voice-server are SIBLINGS.
       voice-server does NOT depend on engine.
       They connect via the ProcessIntent contract.

  MAE-138 ✅ Request-side type hierarchy moved to protocol.
             protocol-old now scoped to voice messages, the
             legacy action-runner runtime, and engine-old.
```

## Engine Pipeline

> **Current interface:** `Engine.process(request: ChartRequest, signal?): Promise<Result<MaelstromResponse, EngineError>>`
> MAE-102 will introduce the `EngineMessage` envelope and `EngineOutput` types shown below.

The target pipeline (after MAE-102) accepts an `EngineMessage` envelope and returns an `EngineOutput`. For `chart_request` messages, the core pipeline is:

```
┌──────────────────────────────────────────────────────────────────┐
│                     createEngine(config)                          │
│                                                                    │
│  EngineMessage { type: 'chart_request', sessionId, id, request } │
│       │                                                            │
│       ▼                                                            │
│  ┌─────────────┐   prompt/prompt-builder.ts                      │
│  │ Prompt       │   Section orchestration + var interpolation     │
│  │ Builder      │   ──────────────────────────────                │
│  │              │   prompt/request-serializer.ts  (MAE-137)      │
│  │              │   ChartRequest → vessels, layout, reasons text  │
│  └──────┬──────┘                                                 │
│         │ user prompt + system prompt                            │
│         ▼                                                         │
│  ┌─────────────┐   pipeline/call-llm.ts  (MAE-128)              │
│  │ LLM Call     │   TanStack AI chat() + outputSchema (Zod)     │
│  │              │   AbortSignal handling, provider error mapping  │
│  └──────┬──────┘                                                 │
│         │ structured JSON output                                 │
│         ▼                                                         │
│  ┌─────────────┐   response/response-processor.ts                │
│  │ Response     │   ~75 LOC thin orchestrator (MAE-127)           │
│  │ Processor    │   dispatches execution-plan/ + layout/          │
│  │              │   submodules; layout validation (MAE-124)       │
│  └──────┬──────┘                                                 │
│         │                                                         │
│         ▼                                                         │
│  ┌ ─ ─ ─ ─ ─ ─┐   history/history-manager.ts  [planned: MAE-102] │
│  │ History      │   Records turn under per-session lock          │
│  │ Manager      │   Hybrid truncation (maxEntries + maxChars)    │
│  └ ─ ─ ─┬─ ─ ─┘                                                 │
│         │                                                         │
│         ▼                                                         │
│  EngineOutput { type: 'chart_response', sessionId, id, response }│
│  response: { userMessage, rationale, executionPlan, layout }     │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Voice Architecture

### ProcessIntent Contract

The voice-server connects to the engine via a thin interface:

```typescript
interface ProcessIntent {
  process(request: ChartRequest, signal?: AbortSignal): Promise<MaelstromResponse>
}
```

The engine implements this. The cloud API client implements this. Any processing backend implements this. The voice-server doesn't know or care which one it talks to.

### Voice Session — Internal Loop

The voice-server owns the full STT → process → TTS loop:

```
┌──────────────────────────────────────────────────────────────┐
│               createVoiceSession(process, config)             │
│                                                                │
│  Audio In (PCM chunks)                                        │
│       │                                                        │
│       ▼                                                        │
│  ┌──────────┐                                                 │
│  │ STT       │  Deepgram: native VAD, configurable keyterms  │
│  │ Provider   │  Emits interim + final transcripts            │
│  └─────┬────┘                                                 │
│        │ final transcript                                     │
│        ▼                                                       │
│  ┌──────────┐                                                 │
│  │ Process   │  ProcessIntent.process(request, signal)        │
│  │ Intent    │  Could be local engine or cloud API            │
│  └─────┬────┘                                                 │
│        │ MaelstromResponse                                    │
│        ▼                                                       │
│  ┌──────────┐                                                 │
│  │ TTS       │  Cartesia: atomic state machine,              │
│  │ Provider   │  efficient decoding, cancellable chunks       │
│  └─────┬────┘                                                 │
│        │ audio chunks                                         │
│        ▼                                                       │
│  Audio Out (PCM chunks)                                       │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ State Machine                                           │   │
│  │                                                          │   │
│  │  idle ──► listening ──► processing ──► speaking ──┐     │   │
│  │   ▲                                                │     │   │
│  │   └────────────────────────────────────────────────┘     │   │
│  │                                                          │   │
│  │  Barge-in: speaking → abort TTS + abort process → idle  │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  Events emitted:                                              │
│  - transcript(text, isFinal)                                  │
│  - audio(data, cancellable)                                   │
│  - state(idle | listening | processing | speaking)            │
│  - response(MaelstromResponse)                                │
│  - error(Error)                                               │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### End-to-End: Browser to Server and Back

```
BROWSER                              SERVER
───────                              ──────

Microphone                           ws-server.ts (thin adapter)
    │                                     │
    ▼                                     │
AudioCapture (16kHz)                      │
    │                                     │
    ▼                                     │
VADProcessor (Silero ONNX)                │
    │ speech detected                     │
    ▼                                     │
VoiceWebSocketConnector ──── WS ────► receives frames
    │ binary: PCM chunks                  │ pushAudio() ──► VoiceSession
    │ json: vad events                    │                     │
    │                                     │                ┌────┴─────┐
    │                                     │                │ STT      │
    │                                     │                │ (Deepgram)│
    │                                     │                └────┬─────┘
    │                                     │                     │
    │                                     │                ┌────┴─────┐
    │                                     │                │ engine   │
    │                                     │                │.process()│
    │                                     │                └────┬─────┘
    │                                     │                     │
    │                                     │                ┌────┴─────┐
    │                                     │                │ TTS      │
    │                                     │                │(Cartesia)│
    │                                     │                └────┬─────┘
    │                                     │                     │
    │                              forwards events ◄────── emits events
    │                                     │
AudioPlayback (44.1kHz) ◄─── WS ────  sends frames
    │                                  json: transcripts
    ▼                                  json: responses
Speaker                                binary: TTS audio
```

### Cloud Migration

The architecture is designed so cloud replaces everything server-side. The client is unchanged:

```
BROWSER                              CLOUD
───────                              ─────

Same client code                     Cloud endpoint
Same VoiceWebSocketConnector ─ WS ─► Same voice message protocol
Same AudioCapture                    STT + Engine + TTS all server-side
Same VADProcessor                    Same binary frames, same JSON messages
Same AudioPlayback
```

The voice message protocol (defined in `@maelstrom-co/protocol`) is the durable contract. Message types (`client.vad.speech_start`, `engine.stt.transcript`, `engine.tts.sent`, etc.) and the binary audio frame format are the API surface that must remain stable.

## Envelope Model [planned: MAE-102]

> **Not yet implemented.** The types and interface below are the MAE-102 target design.

The engine will use a uniform `EngineMessage` envelope at the protocol layer. The client edge will construct envelopes via protocol factory functions. Every layer between client and engine is a pure passthrough — wire format equals engine format.

```typescript
type EngineMessage =
  | { type: 'chart_request'; sessionId: SessionId; id: MessageId; timestamp: number; request: ChartRequest }
  | { type: 'assistant_message'; sessionId: SessionId; id: MessageId; timestamp: number; content: string };

type EngineOutput =
  | { type: 'chart_response'; sessionId: SessionId; id: MessageId; response: MaelstromResponse }
  | { type: 'assistant_message_result'; sessionId: SessionId; id: MessageId; outcome: 'inserted' | 'deduped' };

interface Engine {
  handle(message: EngineMessage, signal?: AbortSignal): Promise<Result<EngineOutput, EngineError>>;
}
```

## History System [planned: MAE-102]

```
┌─────────────────────────────────────────────────┐
│              HistoryManager                       │
│                                                   │
│  HistoryConfig<TMeta>:                           │
│    maxEntries: number    (hard cap on entries)    │
│    maxChars: number      (token proxy)           │
│    transformEntry?: (entry) => entry              │
│    deriveLLMContext?: (entry) => messages[]      │
│    store?: HistoryStore<TMeta>                   │
│                                                   │
│  Truncation: newest-first retention               │
│  Drop oldest until both limits satisfied          │
│  System prompt + current request NOT counted      │
│                                                   │
│  Concurrency:                                    │
│    Per-session AsyncMutex for chart_request       │
│    assistant_message bypasses lock (atomic store) │
│                                                   │
│  Dedup:                                          │
│    assistant_message: silent-skip via store       │
│    chart_request: NOT deduped (see MAE-132)      │
│                                                   │
│         ┌──────────────────┐                     │
│         │   HistoryStore    │  ◄── interface      │
│         │   (pluggable)     │  atomic append      │
│         └────────┬─────────┘  returns {inserted}  │
│                  │                                │
│         ┌────────┴─────────┐                     │
│         │ InMemoryStore     │  ◄── ref impl       │
│         │ (Map by MessageId)│                     │
│         └──────────────────┘                     │
│                                                   │
│  Production stores: Redis SETNX, Postgres         │
│  ON CONFLICT, SQLite INSERT OR IGNORE             │
└─────────────────────────────────────────────────┘
```

## Validation System (MAE-121)

Five layers of validation, added incrementally:

```
┌─────────────────────────────────────────────────┐
│                                                   │
│  1. Engine Config (MAE-122) ✅                   │
│     Zod schema validation at createEngine()      │
│                                                   │
│  2. EngineMessage (MAE-123)                      │
│     Pre-process envelope validation               │
│                                                   │
│  3. LLM Output Layout (MAE-124) ✅              │
│     Grid/tiling layout shape validation           │
│                                                   │
│  4. Self-healing (MAE-158) ✅                    │
│     processResponse heals layout failures into    │
│     droppedEntries diagnostics + retryHint        │
│     instead of rejecting outright                 │
│                                                   │
│  5. Retry System (MAE-125) ✅                    │
│     Re-prompts on retryHint.recommend === true   │
│     pipeline/retry.ts wraps callLLM + heal       │
│                                                   │
└─────────────────────────────────────────────────┘
```

### MAE-158 — self-healing rationale

The realtime-UX principle is **be lenient with errors and only retry when the cost of a degraded response is worse than the cost of waiting**. Strict validation (MAE-124) rejected the whole response on any single layout failure, forcing the retry layer into "retry-or-fail" thinking and discarding LLM turns whose layout was 90% valid.

MAE-158 rewrites the `validateGridLayout` / `validateTilingLayout` functions as `healGridLayout` / `healTilingLayout` returning a `HealedGridLayout | HealedTilingLayout` discriminated union (filtered layout + structured `droppedEntries` + non-fatal `warnings`). `processResponse` exposes those alongside the existing `skippedActions` on a new `EngineDiagnostics` shape, plus a `retryHint` scalar that encodes "is this response too degraded to be useful?". The retry layer (MAE-125) becomes opaque to healing internals — it reads the hint and decides retry vs. accept.

## Structural Refactors

Three mechanical splits to reduce file sizes and prepare clean landing zones for validation and retry:

**MAE-127 ✅ Split response-processor** (unblocked MAE-124)
```
response/
├── response-processor.ts         # ~40 LOC thin orchestrator
├── layout/
│   ├── build-grid-layout.ts
│   └── build-tiling-layout.ts
└── execution-plan/
    ├── parse-execution-plan.ts
    ├── resolve-action.ts
    ├── simulate-variant.ts
    ├── parse-params.ts
    └── validation-context.ts
```

**MAE-128 ✅ Extract callLLM** (unblocked MAE-125)
```
pipeline/
└── call-llm.ts                   # callLLM + LLMOutput + abort handling
```

**MAE-137 ✅ Split prompt-builder**
```
prompt/
├── prompt-builder.ts             # ~180 LOC, section orchestration only
├── request-serializer.ts         # ~270 LOC, ChartRequest → text
├── sections.ts                   # unchanged
├── system-prompts.ts             # unchanged
├── system-prompt-grid.ts         # unchanged
├── system-prompt-shared.ts       # unchanged
└── system-prompt-tiling.ts       # unchanged
```

## Protocol Migration (MAE-138 ✅)

Request-side type hierarchy moved from `protocol-old` to `@maelstrom-co/protocol`:

- `ChartRequest`, `ChartDimensions`, `ChartPosition`, `ChartSize`, `VesselInstanceSnapshot`, `Vessel`, `VesselAction`, `ActionParameter`, `VesselVariant`
- `UpdateReason` (`user_intent`, `chart_resize`, `vessel_mutation`)
- Request/response layout types (`GridLayout`, `GridPosition`, `TilingLayout`, `TilingInstance`, `TilingNode`, `TilingSplit`) unified in one package
- Zod schemas (`GridResponseSchema`, `TilingResponseSchema`, `TilingNodeSchema`, `TilingTreeSchema`, `ActionExecutionSchema`, `VesselSchema`, etc.)

Branding propagated beyond the original spec (deliberately picked up during the migration):

- `ChartRequest.id` → `MessageId`; `ChartRequest.context.sessionId` → `SessionId`
- `VesselInstanceSnapshot.instanceId`, `GridPosition.instanceId`, `TilingInstance.instanceId`, `ActionExecution.instanceId`, `VesselMutationReason.instanceId` → all `InstanceId`
- Positive `TilingNode` guards (`isInstanceIdNode`, `isTilingSplit`) replace the negative-narrowing pattern (`node !== null && node !== 'H' && node !== 'V'`)

Consumers migrated in the same PR: `engine`, `client`, `react`, `demo`, `www`. `protocol-old` now only serves:

- `engine-old`
- Voice wire format (`VoiceClientMessage`, `VoiceServerMessage`, etc.) — on its own migration path
- Old-shape `Result` / `Success` / `Err` (different shape from new protocol's `.ok`/`.err`) tied to the legacy action-runner runtime
- Generic `ActionExecution<V extends Vessel>` and the `vessel-inference` helpers (`ActionNames`, `VariantNames`, `VariantPropsUnion`)
- `VesselId` / `VariantName` / `ActionName` branding — deferred to MAE-133

## Type-Safety Cleanups (MAE-133)

Originally scoped to "brand remaining domain IDs" (see `docs/superpowers/specs/2026-04-16-branded-ids-design.md`). Scope extended during MAE-127, MAE-119, and MAE-138 landings to collect related latent type-safety debt:

- **Remaining domain-ID branding.** MAE-138 deferred `VesselId`, `VariantName`, `ActionName` branding to keep that migration mechanical. These live as plain `string` fields across `Vessel`, `VesselVariant`, `VesselAction`, `VesselInstanceSnapshot.vesselId`/`variant`, `ActionExecution.action`, etc.
- **Engine-internal InstanceId tightening.** `SkippedAction.instanceId`, `parseParams` parameter, `ValidationLookups.instanceMap` / `SimulationState.variants` map keys, `extractVisibleInstanceIds` return type — all still `string` despite `VesselInstanceSnapshot.instanceId` now being `InstanceId` at the protocol boundary.
- **LLM→protocol narrowing casts.** `response/response-processor.ts` (mode-dispatched `llmOutput as GridResponse` / `as TilingResponse`) and `response/layout/build-layout.ts` (nested `llmLayout as { positions: … }` / `as { tree: …, instances: … }`). Both rely on the Zod schema selection matching `layoutMode` at runtime but carry no compile-time or runtime invariant check.
- **`SimulationState.variants` read/write split.** Currently a `Map<string, string>` whose "only `updateSimulatedVariant` writes" rule is convention-only (the field is `readonly` only at reference level). Either split into a read-only view + writer, or enforce the invariant at a type boundary.

## Story Dependency Graph

```
MAE-100 ✅ Foundation
    │
    ├──► MAE-107 ✅ 2a: Core Pipeline
    │        │
    │        ├──► MAE-108 ✅ 2b: Action Validation
    │        │
    │        └──► MAE-109 ✅ 2c: Islands + Phrase Extractor ──────────────►┐
    │                                                                       │
    ├──► MAE-119 ✅ SessionId / MessageId / Brand<T, B>                     │
    │        │                                                               │
    │        └──► MAE-102    History & Session Management                   │
    │                 │                                                      │
    │                 ├──► MAE-123  EngineMessage Validation                │
    │                 │                                                      │
    │                 ├──► MAE-132  Uniform idempotency                     │
    │                 │                                                      │
    │                 └──► MAE-104  Integration ◄───────────────────────────┘
    │                              ▲
    │                              │
    ├──► MAE-103    Voice Server ──┘
    │
    │    ── Structural refactors (all shipped — landing zones cleared) ──
    │
    ├──► MAE-127 ✅ Split response-processor ──► MAE-124 ✅ Layout Validation ──┐
    ├──► MAE-128 ✅ Extract callLLM ──────────►                                  │
    ├──► MAE-137 ✅ Split prompt-builder                                         ▼
    │                                                                MAE-158 ✅ Self-healing
    │                                                                  validation
    │                                                                           ▼
    │                                                                MAE-125 ✅ Retry System
    │                                                                           ▲
    │    MAE-142 ✅ Promote SkippedAction discriminated union ────────────────►┘
    │    MAE-143  Split validation-context / logger decouple (cleanup, non-blocking)
    │
    │    ── Validation (standalone) ──
    │
    ├──► MAE-122 ✅ Engine Config Validation (Zod)
    │
    │    ── Protocol migration ──
    │
    ├──► MAE-138 ✅ Migrate ChartRequest to new protocol
    │
    │    ── Type-safety cleanups ──
    │
    └──► MAE-133  Brand remaining IDs + remove convention-only invariants

Legend: ✅ Done  ⚙️ In Progress  (unmarked = Todo)
```

## Recommended Execution Order

> **Revised 2026-04-18.** Wave 1 structural refactors (MAE-127, MAE-128, MAE-137)
> and the MAE-119 brand utility have all shipped, clearing merge hotspots and
> unblocking the envelope story. MAE-123 and MAE-125 both land more cleanly on
> top of the envelope from MAE-102, so they move after it rather than alongside.

```
✅ Done
  MAE-127  Split response-processor
  MAE-128  Extract callLLM
  MAE-137  Split prompt-builder
  MAE-119  SessionId / MessageId brands
  MAE-122  Engine Config Validation (Zod)
  MAE-124  LLM Output Layout Validation
  MAE-138  Migrate ChartRequest to new protocol
  MAE-109  2c: Islands + Phrase Extractor

Wave 2 — Envelope foundation
  MAE-102  History & Session Management             (needs MAE-119 ✅)
           Introduces EngineMessage envelope, factories, HistoryStore /
           HistoryManager, per-session mutex, hybrid truncation, and rewrites
           the engine surface to Engine.handle(message). Unblocks MAE-123,
           MAE-132, and makes MAE-125's retry loop sit cleanly inside handle().

Wave 3 — Validation (parallel, after Wave 2)
  MAE-123     EngineMessage Validation              (needs MAE-102 envelope types)
  MAE-142 ✅ Promote SkippedAction discriminated union
  MAE-158 ✅ Self-healing validation                (heal contract: layout
                                                     failures become diagnostics
                                                     + retryHint instead of Err)
  MAE-125 ✅ Retry System                           (re-prompts on
                                                     retryHint.recommend; built
                                                     on the heal contract)

Wave 4 — Cleanup (any time, non-blocking)
  MAE-143  Split validation-context / logger decouple

Wave 5 — Voice (independent track)
  MAE-103  Voice Server Package

Wave 6 — Post-history
  MAE-132  Uniform idempotency                      (needs MAE-102)
  MAE-133  Type-safety cleanups                     (independent; can interleave)

Wave 7 — Capstone
  MAE-104  Integration & Migration                  (needs everything above)
```
