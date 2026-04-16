# Engine Rewrite Architecture

> Reference document for the MAE-99 engine rewrite epic. Describes the target architecture, package relationships, data flows, and key contracts.
>
> Design spec: `docs/superpowers/specs/2026-04-01-engine-rewrite-design.md`

## Package Dependency Graph

```
                    ┌──────────────────┐
                    │    protocol       │  (target: all domain types)
                    │                  │  Result, SessionId, MessageId,
                    │                  │  EngineMessage, EngineOutput,
                    │                  │  MaelstromResponse, InstanceId
                    │                  │  + ChartRequest (after MAE-138)
                    └────────┬─────────┘
                             │ imported by
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
         ┌──────────┐  ┌──────────┐  ┌──────────────┐
         │  engine   │  │  client   │  │ voice-server  │
         └──────────┘  └──────────┘  └──────────────┘
                │            │
                │            │ still imports from (until MAE-138)
                │            ▼
                │     ┌──────────────┐
                │     │ protocol-old  │  (legacy: ChartRequest, Vessel,
                └────►│              │   Zod schemas, voice messages)
                      └──────────────┘

  Key: engine and voice-server are SIBLINGS.
       voice-server does NOT depend on engine.
       They connect via the ProcessIntent contract.

  Migration: MAE-138 moves request-side types to protocol.
             protocol-old remains only for voice messages
             and engine-old consumers.
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
│  │ Response     │   Currently ~600 LOC monolith; MAE-127 will    │
│  │ Processor    │   split into ~40 LOC orchestrator dispatching  │
│  │              │   to execution-plan/ and layout/ subdirs       │
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
  | { type: 'assistant_ack'; sessionId: SessionId; id: MessageId };

interface Engine {
  handle(message: EngineMessage, signal?: AbortSignal): Promise<Result<EngineOutput, EngineError>>;
}
```

## History System [planned: MAE-102]

```
┌─────────────────────────────────────────────────┐
│              HistoryManager                       │
│                                                   │
│  HistoryConfig:                                  │
│    maxEntries: number    (hard cap on entries)    │
│    maxChars: number      (token proxy)           │
│    transformTurn?: (entry) => entry               │
│    store?: HistoryStore                          │
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

Four layers of validation, added incrementally:

```
┌─────────────────────────────────────────────┐
│                                               │
│  1. Engine Config (MAE-122)                  │
│     Zod schema validation at createEngine()  │
│                                               │
│  2. EngineMessage (MAE-123)                  │
│     Pre-process envelope validation           │
│                                               │
│  3. LLM Output Layout (MAE-124)             │
│     Grid/tiling layout shape validation       │
│     Blocked by: MAE-127 (response split)     │
│                                               │
│  4. Retry System (MAE-125)                   │
│     Automatic retry on validation failures    │
│     pipeline/retry.ts next to call-llm.ts    │
│     Blocked by: MAE-128 (callLLM extract)    │
│                                               │
└─────────────────────────────────────────────┘
```

## Structural Refactors

Three mechanical splits to reduce file sizes and prepare clean landing zones for validation and retry:

**MAE-127 — Split response-processor** (blocks MAE-124)
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

**MAE-128 — Extract callLLM** (blocks MAE-125)
```
pipeline/
└── call-llm.ts                   # callLLM + LLMOutput + abort handling
```

**MAE-137 — Split prompt-builder**
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

## Protocol Migration (MAE-138)

Move the request-side type hierarchy from `protocol-old` to `@maelstrom-co/protocol`:

- `ChartRequest`, `ChartDimensions`, `VesselInstanceSnapshot`, `Vessel`, `VesselAction`, `ActionParameter`, `VariantDefinition`
- `UpdateReason` (`user_intent`, `chart_resize`, `vessel_mutation`)
- Request-side `GridLayout` / `TilingLayout` — unify with response-side layout types
- Zod schemas (`GridResponseSchema`, `TilingResponseSchema`, `TilingTreeSchema`)
- Adopt branded `InstanceId` in `VesselInstanceSnapshot.instanceId`

Goal: `@maelstrom-co/engine` no longer imports anything from `protocol-old`.

## Story Dependency Graph

```
MAE-100 ✅ Foundation
    │
    ├──► MAE-107 ✅ 2a: Core Pipeline
    │        │
    │        ├──► MAE-108 ✅ 2b: Action Validation
    │        │
    │        ├──► MAE-109  2c: Islands + Phrase Extractor ──────────────►┐
    │        │                                                            │
    │        └──► MAE-102  History & Session Management ──► MAE-132 ─►┐  │
    │                 ▲         │                                      │  │
    │                 │         └──► MAE-104  Integration ◄────────────┘  │
    │            MAE-119 ⚙️       ▲                          ◄────────────┘
    │            (in progress)    │
    │                             │
    ├──► MAE-103  Voice Server ───┘
    │
    │    ── Structural refactors (unblocked, parallel) ──
    │
    ├──► MAE-127  Split response-processor ──► MAE-124  Layout Validation
    ├──► MAE-128  Extract callLLM ─────────►   MAE-125  Retry System
    ├──► MAE-137  Split prompt-builder
    │
    │    ── Validation (unblocked) ──
    │
    ├──► MAE-122  Engine Config Validation (Zod)
    ├──► MAE-123  EngineMessage Validation
    │
    │    ── Protocol ──
    │
    └──► MAE-138  Migrate ChartRequest to new protocol

Legend: ✅ Done  ⚙️ In Progress  (unmarked = Todo)
```

## Recommended Execution Order

```
Wave 1 — Structural refactors (unblocked, parallel, prevent merge conflicts)
  MAE-127  Split response-processor
  MAE-128  Extract callLLM
  MAE-137  Split prompt-builder

Wave 2 — Features unblocked now (parallel)
  MAE-109  2c: Islands + Phrase Extractor
  MAE-122  Engine Config Validation
  MAE-123  EngineMessage Validation

Wave 3 — Validation (unblocked after Wave 1)
  MAE-124  LLM Output Layout Validation  (needs MAE-127)
  MAE-125  Retry System                  (needs MAE-128)

Wave 4 — History + Protocol (unblocked after MAE-119)
  MAE-102  History & Session Management  (needs MAE-119)
  MAE-138  Migrate ChartRequest          (coordinate with MAE-102)

Wave 5 — Voice (independent track, can interleave)
  MAE-103  Voice Server Package

Wave 6 — Post-history
  MAE-132  Uniform idempotency           (needs MAE-102)

Wave 7 — Capstone
  MAE-104  Integration & Migration       (needs everything above)
```
