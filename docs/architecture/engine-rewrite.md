# Engine Rewrite Architecture

> Reference document for the MAE-99 engine rewrite epic. Describes the target architecture, package relationships, data flows, and key contracts.
>
> Design spec: `docs/superpowers/specs/2026-04-01-engine-rewrite-design.md`

## Package Dependency Graph

```
                    ┌──────────────┐
                    │  protocol-old │  (domain types: ChartRequest,
                    │              │   MaelstromResponse, Vessel, etc.)
                    └──────┬───────┘
                           │ imported by
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────────┐
       │  engine   │  │  client   │  │ voice-server  │
       │          │  │          │  │              │
       └──────────┘  └──────────┘  └──────────────┘
              │                          │
              │ both depend on           │
              ▼                          ▼
       ┌──────────┐              ┌──────────┐
       │ protocol  │              │ protocol  │
       │ (Result)  │              │ (Result)  │
       └──────────┘              └──────────┘

  Key: engine and voice-server are SIBLINGS.
       voice-server does NOT depend on engine.
       They connect via the ProcessIntent contract.
```

## Engine Pipeline

The engine processes a `ChartRequest` and returns a `MaelstromResponse`. This is the core loop:

```
┌─────────────────────────────────────────────────────────────┐
│                     createEngine(config)                      │
│                                                               │
│  ChartRequest                                                │
│       │                                                       │
│       ▼                                                       │
│  ┌─────────────┐   Serializes vessels, layout,               │
│  │ Prompt       │   update reasons, free-space               │
│  │ Builder      │   islands (grid mode)                      │
│  └──────┬──────┘                                             │
│         │ user prompt + system prompt                        │
│         ▼                                                     │
│  ┌─────────────┐   TanStack AI chat() with                  │
│  │ LLM Call     │   outputSchema (Zod)                       │
│  │ (TanStack)   │   maxRetries + timeout built-in            │
│  └──────┬──────┘                                             │
│         │ structured JSON output                             │
│         ▼                                                     │
│  ┌─────────────┐   Parses LLM output into                   │
│  │ Response     │   MaelstromResponse                        │
│  │ Processor    │                                            │
│  └──────┬──────┘                                             │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────┐   Simulates variant transitions,            │
│  │ Action       │   validates action sequences,              │
│  │ Validator    │   skips invalid actions                    │
│  └──────┬──────┘                                             │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────┐   Records turn for multi-turn               │
│  │ History      │   context in future requests               │
│  │ Manager      │                                            │
│  └──────┬──────┘                                             │
│         │                                                     │
│         ▼                                                     │
│  MaelstromResponse                                           │
│  { userMessage, rationale, executionPlan, layout }           │
│                                                               │
└─────────────────────────────────────────────────────────────┘
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

## History System

```
┌────────────────────────────────────────────┐
│              HistoryManager                  │
│                                              │
│  HistoryConfig:                             │
│    maxEntries: number   (hard cap)          │
│    maxChars: number     (token proxy)       │
│    sessionTTL?: number  (auto-expire)       │
│    transformTurn?: (turn) => turn            │
│                                              │
│  Truncation: newest-first retention          │
│  When adding a turn, drop oldest until      │
│  both maxEntries and maxChars are satisfied │
│                                              │
│         ┌──────────────────┐                │
│         │   HistoryStore    │  ◄── interface │
│         │   (pluggable)     │                │
│         └────────┬─────────┘                │
│                  │                           │
│         ┌────────┴─────────┐                │
│         │  MemoryStore      │  ◄── ref impl │
│         │  (in-memory)      │                │
│         └──────────────────┘                │
│                                              │
│  Future stores: Redis, SQLite, cloud, etc.  │
└────────────────────────────────────────────┘
```

## Story Dependency Graph

```
Story 1 (MAE-100) ✅ Foundation
    │
    ├──► Story 2a (MAE-101) Core pipeline
    │        │
    │        ├──► Story 2b Action validation
    │        ├──► Story 2c Islands + phrase extractor
    │        └──► Story 3 (MAE-102) History
    │
    ├──► Story 4a (MAE-103) Voice scaffold + state machine
    │        │
    │        └──► Story 4b STT + TTS providers
    │
    └──────────────────────────────────────────┐
                                                ▼
                                    Story 5 (MAE-104) Integration
                                    (blocked by 2a, 2b, 2c, 3, 4a, 4b)

Execution order: 2a → 3 → 2b → 2c → 4a → 4b → 5
```
