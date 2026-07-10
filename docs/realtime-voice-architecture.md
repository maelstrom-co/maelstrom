# Realtime Voice Architecture

How Maelstrom gives a realtime speech-to-speech model (OpenAI `gpt-realtime`) control of the UI, as landed in PR #36 for [MAE-300](https://linear.app/maelstrom-vortex/issue/MAE-300/add-realtime-model-access-to-maelstrom). This document explains the design: the constraints, the boundaries, and why each piece sits where it does. For the general system (Vessels, Chart, Engine), read [architecture.md](./architecture.md) first. The full decision log — including rejected alternatives — is the [D1–D8 decision record](https://linear.app/maelstrom-vortex/issue/MAE-300/add-realtime-model-access-to-maelstrom#comment-4abca3b2) on MAE-300.

---

## The problem

Maelstrom already has a brain: the engine plans layout and actions from a `ChartRequest` snapshot. Adding voice means adding a **second model** — a realtime speech model living in the browser with its own beliefs about what's on screen. That creates the central hazard of the design:

> **Never let the model's belief be the engine's planning input.**

The realtime model hears speech, holds a (small, lossy, eventually-consistent) picture of the UI, and decides *what the user wants*. The engine plans against *ground truth*. Every architectural choice below exists to keep those two roles from contaminating each other:

- The realtime model's only power is emitting a **natural-language intent** — the same thing a keyboard produces. It never emits actions, layout, or vessel IDs.
- The engine's planning context is the request-embedded snapshot the client builds from its own stores — never anything the model said.
- The model's picture of the UI is maintained on a separate, deliberately loose **grounding channel** that can lag or drop without harming correctness.

A second constraint shaped the packaging: voice is one *capability* with two future *implementations* — this realtime track and a cascaded STT→LLM→TTS pipeline (MAE-286/330). Both must satisfy the same seam so apps can swap them.

---

## System overview

```
┌────────────────────────────  Browser  ────────────────────────────┐
│                                                                    │
│   OpenAI gpt-realtime ◄──── WebRTC (audio) + data channel ────┐    │
│                                                               │    │
│   ┌──────────────────────── @maelstrom-co/realtime ───────────┴─┐  │
│   │  createOpenAIAdapter()          RealtimeSession             │  │
│   │  (transport, envelopes,   ◄──►  (tool routing, speak-after- │  │
│   │   response pacing)               render, grounding cadence) │  │
│   └───────────────────────────────────────────┬─────────────────┘  │
│                                    RealtimeInstance bridge          │
│   ┌──────────────────────── @maelstrom-co/client ─┴─────────────┐  │
│   │  Orchestrator: processIntent · waitForIdle ·                │  │
│   │  getStructuralSnapshot · onSettled                          │  │
│   └───────────────────────────────────────────┬─────────────────┘  │
│                                                │ ChartRequest       │
└────────────────────────────────────────────────┼───────────────────┘
                                                 ▼
                                     @maelstrom-co/engine (unchanged)

  Browser ──POST TokenHandshakeRequest──► @maelstrom-co/realtime-server
          ◄──TokenHandshakeResponse────── (mints ephemeral secret;
                                           sole holder of OPENAI_API_KEY)
```

Three facts to hold onto:

1. **The engine is untouched.** A voice-driven `ChartRequest` is byte-identical to a keyboard-driven one. Voice is a new *intent source*, not a new planning path.
2. **The browser talks to OpenAI directly** (client-direct WebRTC), authenticated by a short-lived client secret the server mints. No audio ever transits Maelstrom-owned infrastructure.
3. **Two channels with different consistency guarantees**: the engine gets strong, request-embedded context; the realtime model gets eventual, latest-wins grounding.

---

## Package topology

```
@maelstrom-co/protocol          token-handshake + sidechannel schemas (zod, drift-guarded)
        │
   ┌────┴────────────────────────────┐
   ▼                                 ▼
@maelstrom-co/client        @maelstrom-co/realtime-server
  VoiceSession seam           createOpenAIMintHandler
  UIStructuralSnapshot        (framework-agnostic (req) => Response)
  Orchestrator additions
        ▲
        │
@maelstrom-co/realtime
  RealtimeSession (root)
  createOpenAIAdapter (/openai subpath)
  (/google subpath — reserved stub)
```

### Why three packages instead of one or two

- **`realtime` vs `client`**: the voice core carries browser-only weight (WebRTC, mic capture) and a provider surface that most Maelstrom apps never use. Apps that don't use voice pay zero bundle cost — the `VoiceSession` *seam* lives in `client` (types only), the *implementation* lives in `realtime`.
- **`realtime` vs `realtime-server`**: these run on opposite sides of an HTTP boundary and must never share code, only wire schemas. `realtime-server` has **no dependency edge to `realtime`** — both depend only on `protocol`. This makes key custody a *package boundary*, not a convention: the only code that can read `OPENAI_API_KEY` is `realtime-server`, and it only ever writes the key into the upstream `Authorization` header.
- **Provider adapters as subpath exports** (`@maelstrom-co/realtime/openai`, future `/google`): importing one provider doesn't pull the other's SDK weight, and the root package stays provider-neutral.

A fourth package, `@maelstrom-co/react-realtime` (the `.with()` extension), is deliberately deferred — the demo uses a local spike extension until the shared React layer is designed once for both voice tracks (MAE-332).

---

## The runtime loop

The model is given exactly two tools, defined in `RealtimeSession`:

- **`update_ui { intent: string }`** — "change what's on screen." The only write path.
- **`get_ui_state {}`** — "what's on screen right now?" A read-only pull for when the model needs certainty.

An `update_ui` round-trip (`packages/realtime/src/lib/realtime-session.ts`):

1. The model emits a `function_call` over the WebRTC data channel. `createOpenAIAdapter` parses the raw envelope (`parseOAIServerEvent`, a pure function) into a provider-neutral `tool_call` event.
2. `RealtimeSession` extracts the intent string — **only the plain string crosses this boundary** — and submits it through the `RealtimeInstance` bridge: `submitIntent(intent)` → `Orchestrator.processIntent`. From here it is an ordinary Maelstrom request: the client snapshots its own state into a `ChartRequest`, the engine plans, the client applies layout + actions in the standard strict order.
3. The session then awaits `waitForIdle()` — the command queue draining back to idle, i.e. the render has settled.
4. **Only now** does the session send the tool result, containing a terse summary derived from the *post-settle* snapshot.

Step 4 is the **speak-after-render** rule: the model physically cannot narrate a change before the screen shows it, because the tool result *is* its evidence and the result is withheld until settle. The session's default instructions reinforce this ("Only narrate a UI change after update_ui's result confirms it rendered"), but the sequencing makes it structural rather than prompt-dependent. While it waits, the model is free to fill the 1.5–4s engine gap conversationally.

Note the two different settle mechanisms and why both exist:

- **`waitForIdle()`** correlates a *specific* intent to *its own* settle — used for the tool result.
- **`onSettled(cb)`** is a *global* queue-drained-to-idle signal that fires for any source (engine responses *and* direct manipulation like a user clicking a vessel) — used only as the grounding trigger. Using it for the tool result would race concurrent settles.

---

## Grounding: the loose channel

The model needs *some* picture of the screen or its conversation drifts. But realtime model contexts are small, and streaming every change would grow context O(changes). The design (D6):

- On every `onSettled` fire, the session reads `getStructuralSnapshot()` and pushes a one-sentence summary ("3 vessels on screen, grid layout: calendar (month), weather (compact), …") through the adapter's `injectGrounding`.
- Pushes are **debounced (~1s) and latest-wins** (`groundedDebounce`): a burst of settles produces one push carrying the final state. Intermediate states are unobservable by design.
- Pushes are **clamped to 400 chars** (~100 tokens) before reaching the adapter. `summarize` is injectable, so without the clamp a consumer's verbose summary would silently eat the realtime context budget; the first clamp per session logs a warning.
- On the wire, the OpenAI adapter keeps grounding at **O(1) context**: it maintains a single conversation item with a stable ID (`maelstrom-grounding`), deleting the previous one before inserting the replacement — the context holds exactly one grounding message at all times, never an accumulating log.
- The summary function is injectable (`SummarizeFn`) but must stay **deterministic and model-free** — grounding may never involve a model call.
- When looseness isn't good enough (the model is about to make a claim), it pulls truth via `get_ui_state`, answered synchronously from the snapshot.

### The structural boundary

`UIStructuralSnapshot` (in `client`) projects each instance to `{instanceId, vesselId, variant}` plus layout, layout mode, and chart dimensions. **Vessel domain data — props, contents — never reaches the realtime model**, for the same reason it never reaches the engine: both plan/ground on structure. A test enforces this projection; adding a data field breaks it.

---

## Seams and contracts

Five deliberate seams, ordered from innermost out:

**1. `RealtimeInstance`** (`realtime`) — the four-method bridge (`submitIntent`, `waitForIdle`, `getStructuralSnapshot`, `onSettled`) that is *all* the voice core knows about Maelstrom. `Orchestrator` maps onto it with a five-line wrapper (see `apps/demo/src/lib/voice-spike.ts`). This keeps `realtime` off the full `Orchestrator` surface and makes the session trivially testable with a fake instance.

**2. `RealtimeProviderAdapter`** (`realtime`) — the provider seam: `connect(tools, instructions)`, `disconnect()`, `sendToolResult()`, `injectGrounding()`, and an inbound event union (`tool_call | transcript | speech_started | state | error`). Everything provider-shaped — WebRTC vs WebSocket, envelope formats, token handshakes, response pacing — lives *below* this line; `RealtimeSession` never branches on provider identity. A Gemini Live adapter is one new file under a `/google` subpath (MAE-311).

**3. `VoiceSession`** (`client`) — the capability seam both voice tracks implement: `state`, `connect()`, `disconnect()`, `on('state')`. Deliberately minimal in v1; the fuller shape (intent-emission surface, speakable results, grounding flow) is to be settled jointly with the cascade track before the contract ossifies. `SpeakableResult` and `GroundingUpdate` types are exported ahead of that.

**4. `TokenHandshakeRequest/Response`** (`protocol`) — the browser↔mint-endpoint wire contract, provider-tagged (`'openai' | 'google'`) with an opaque credential `value`, so one schema serves every provider. Zod-validated on both ends, with compile-time drift guards pinning the interfaces to the schemas.

**5. `SidechannelEvent`** (`protocol`) — the observability stream (`transcript | tool_call | tool_result | timing`), stamped with `sessionId` and client-clock time (skew-prone by contract: receivers must stamp their own receipt time for anything cross-client, like metering), carrying **no audio**. `RealtimeSession` mirrors every tool round-trip onto its `onEvent` callback. This schema is the contract a future cloud tier's metering rides on, so it is additive-only. Only the emitter side ships; the receiver is MAE-335.

---

## Concurrency and lifecycle

Voice is the first intent source that can fire *while a request is in flight* — a keyboard user waits for the spinner; a model doesn't. Three mechanisms handle this:

**Barge-in as a typed contract, resolved by latest-wins queueing.** `Orchestrator.processIntent` throws `RequestInFlightError` (exported from `client`) when a request is already processing. `RealtimeSession` catches it *by type* — no cross-package string matching — and queues the intent in a single latest-wins slot: when the in-flight request settles, the queued intent is submitted and answered with the normal post-settle summary, so correcting yourself mid-request just works. A newer barge-in supersedes an older queued one (the superseded call is answered immediately, keeping the exactly-once tool-result guarantee per call). Because the command queue can drain while the engine round-trip is still processing, the retry is bounded (a few attempts, separated by `waitForIdle()` plus a short delay); only on exhaustion does the model get a "try again in a moment" answer. Crucially, any *other* rejection is surfaced as a distinct failure ("something went wrong"), not "try again" — mislabeling a genuine pipeline failure as busy-ness would put the model in a non-recovery retry loop. Raw exceptions never reach the adapter.

**`response.create` pacing.** OpenAI rejects a `response.create` while a prior response is still active, and a single model response can contain multiple tool calls (`get_ui_state` answers instantly while `update_ui` is still settling). `response-lifecycle.ts` is a pure state machine — `{active, pending}` — that defers at most one `response.create` behind the active response and flushes it on `response.done`/`response.cancelled`. It's driven off raw event types in the adapter, invisible to `RealtimeSession`.

**Connection guards at both layers.** The session's `connect()` is re-entrant-safe (a second call while `connecting`/`connected` is a no-op) and unwinds its subscriptions plus the pending grounding debounce on failure. The adapter closes the guard-before-await race with a synchronous `connecting` flag — `mintToken()` is the first await, so without it a double-click during the mint round-trip would leak a second `RTCPeerConnection` and mic stream. A failed handshake tears down everything already opened (mic, data channel, peer connection) before rejecting. Session state distinguishes `'connected'` (transport live, no active turn) from `'idle'` (not connected) — collapsing them would make a live session unreadable in the UI.

---

## Security model

- **Custody**: `OPENAI_API_KEY` exists only in `@maelstrom-co/realtime-server`'s mint handler and only in the upstream `Authorization` header. Verified absent from the demo's built client bundle.
- **Ephemeral credentials**: the mint requests a client secret with a 600s expiry, scoped to one model. The browser uses it once, for the SDP exchange.
- **Adapter owns the credential**: `mintToken` is injected into `createOpenAIAdapter`; `RealtimeSession` never sees a token, so no session-layer code path can leak one.
- **Known gap, by design**: the mint endpoint is an **unauthenticated bootstrap** — anyone who can reach it can mint a short-lived credential. The handler's JSDoc says so explicitly; origin allowlist, rate limiting, and an auth hook are required before any real deployment (MAE-337).

---

## Testing strategy

The strategy is **pure cores, live shell**. Everything that can be made a pure function was, and is unit-tested exhaustively: envelope parsing (`parseOAIServerEvent`), response pacing (`response-lifecycle.ts`), grounding debounce, the structural-snapshot projection (including the domain-data-leak guard), speak-after-render ordering, barge-in handling, connection lifecycle transitions, and the mint handler's request/response mapping (with an injected `fetch`). The impure shell — `RTCPeerConnection`, mic capture, the data channel — is deliberately not unit-tested; it's validated by running the demo against the real API. That live run already earned its keep: it corrected the model ID, the streamed function-call event shape, and the mint request's body nesting — three things no mock would have caught.

The seam between shell and core is explicit: the adapter is "thin RTCPeerConnection glue" around parse + pacing, and the event mappings OpenAI doesn't document (transcripts, speech-started) are isolated in `parseOAIServerEvent` with comments marking them as best-known shapes, cheap to correct as real traffic teaches us. Shape drift is not silent: event types the parser doesn't map and that aren't on an explicit known-benign allowlist are warned once per distinct type (`unexpected-event-tracker.ts`, itself a tested pure core), so a provider-side rename shows up as a console warning instead of a quietly missing feature.

---

## Decision → code map

| Decision (MAE-300 record) | Where it lives |
|---|---|
| D1 — realtime + cascade are siblings behind one seam | `VoiceSession` in `client` |
| D2 — OSS-first; cloud = same seam, hosted URL | mint handler is `(req) => Response`, framework-agnostic |
| D3 — client-direct session, server-minted tokens, sidechannel | `createOpenAIAdapter` + `createOpenAIMintHandler` + `SidechannelEvent` |
| D4 — client-built requests, M1 context, engine unchanged | `submitIntent` → `processIntent`; no engine diff |
| D5 — speak-after-render | tool result withheld until `waitForIdle()` |
| D6 — debounced latest-wins grounding + pull tool | `groundedDebounce` + stable-ID grounding item + `get_ui_state` |
| D7 — thin in-house provider adapter | `RealtimeProviderAdapter` + `/openai` subpath |
| D8 — three packages | `realtime` / `realtime-server` / (deferred) `react-realtime` |

---

## Follow-ups

Tracked in Linear, all under Soft Preview Release:

- **[MAE-311](https://linear.app/maelstrom-vortex/issue/MAE-311)** — Gemini Live adapter (`/google` subpath), the seam's first real pressure test, plus its mint handler.
- **[MAE-330](https://linear.app/maelstrom-vortex/issue/MAE-330) / [MAE-331](https://linear.app/maelstrom-vortex/issue/MAE-331)** — rebase the LiveKit cascade voice track onto the `VoiceSession` seam and the token-handshake contract.
- **[MAE-332](https://linear.app/maelstrom-vortex/issue/MAE-332)** — the shared React layer (`maelstromVoice()` `.with()` extension), designed once for both tracks; session ownership moves out of component state.
- **[MAE-333](https://linear.app/maelstrom-vortex/issue/MAE-333)** — docs reconciliation across the voice packages.
- **[MAE-334](https://linear.app/maelstrom-vortex/issue/MAE-334)** — acoustic false barge-in (noise triggering `speech_started`).
- **[MAE-335](https://linear.app/maelstrom-vortex/issue/MAE-335)** — the sidechannel *receiver*: wire `onEvent` to a transport and a storage-agnostic server handler.
- **[MAE-336](https://linear.app/maelstrom-vortex/issue/MAE-336)** *(done)* — latest-wins barge-in queueing implemented and live-validated along with the `response.create` deferral; the optional shared-queue extraction rides with MAE-330's cascade work.
- **[MAE-337](https://linear.app/maelstrom-vortex/issue/MAE-337)** — harden the mint endpoint (origin allowlist, rate limit, auth hook).
- **[MAE-338](https://linear.app/maelstrom-vortex/issue/MAE-338)** — unify voice and typed conversation history via the orchestrator (`addAssistantMessage`).
- **[MAE-339](https://linear.app/maelstrom-vortex/issue/MAE-339)** — inject a compact vessel-capability catalog on the slow channel (the second half of D6: the model currently knows what's on screen, not what the app *can* do).
- **[MAE-340](https://linear.app/maelstrom-vortex/issue/MAE-340)** — shared-primitive cleanups from the PR #36 review (typed emitter, shared mock connector, drift-guard pattern, `CommandProcessor.onIdle`).

## What I'd improve now

Of the seven judgments this section originally flagged, five have since been implemented (2026-07-07) and folded into the body above:

- **Session ownership in the demo spike** — the session now lives in the extension closure (`WeakMap` keyed by orchestrator, subscriber refcount), not a `useState` initializer; hooks only subscribe. The real extension (MAE-332) should inherit this shape.
- **Latest-wins barge-in queueing** — the "try again in a moment" busy answer is gone; see *Concurrency and lifecycle*.
- **Parser drift visibility** — unexpected event types now warn once per distinct type; see *Testing strategy*.
- **Grounding length clamp** — the ~100-token budget is enforced, not conventional; see *Grounding*.
- **Sidechannel clock semantics** — the schema contract now states `at` is skew-prone client time and receivers must stamp receipt time for metering.

- **Live validation of the `response.create` deferral and barge-in queue** — done 2026-07-09 against real `gpt-realtime-2` traffic: the deferral flushed on `response.done` with no "active response" errors, and mid-request corrections applied latest-wins (MAE-336, closed).

One remains open, deliberately:

1. **`VoiceSession` shipped thinner than its exports suggest.** `SpeakableResult` and `GroundingUpdate` are exported but unreferenced by the interface — reserved names for a contract not yet settled. That's honest (the JSDoc says so), but it's also API surface consumers can import and misread as functional. Settle the full seam shape with the cascade track (MAE-330/332) sooner rather than later, before external code grows around the placeholder types. This is a joint design decision, not a unilateral code change.
