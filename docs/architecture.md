# Maelstrom Architecture

This document provides a deep dive into the Maelstrom system architecture, explaining how the components work together to enable AI-orchestrated UIs.

---

## System Overview

Maelstrom is designed as a layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application                               │
│  (Demo app, your product, etc.)                                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Framework Bindings                           │
│  @maelstrom-co/react (or Vue, Svelte, etc. in the future)              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Client Core                                  │
│  @maelstrom-co/client - Vessel Registry, Chart, Event System       │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Protocol                                     │
│  @maelstrom-co/protocol - Message definitions (transport-agnostic)      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ (Any transport: WS, HTTP, etc.)
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Maelstrom Engine                            │
│  @maelstrom-co/engine - LLM decision logic                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Vessels (State Machines)

Vessels are the fundamental building blocks of a Maelstrom application. Each Vessel is a **state machine** with defined variants (states) and actions (transitions).

#### Vessel Definition

Each Vessel declares:

| Property         | Purpose                                                |
| ---------------- | ------------------------------------------------------ |
| `id`             | Unique identifier for the Vessel                       |
| `name`           | Human-readable name                                    |
| `description`    | Semantic description for the LLM to understand purpose |
| `defaultVariant` | Starting variant when the Vessel is created            |
| `variants`       | Map of variant names to variant definitions            |

#### Variants

Each variant represents a discrete state of the Vessel:

| Property  | Purpose                                                       |
| --------- | ------------------------------------------------------------- |
| `props`   | State properties for this variant (e.g., `{ view: 'month' }`) |
| `minSize` | Minimum chart size required to display this variant           |
| `actions` | Actions available when in this variant                        |

#### Actions

Actions are transitions in the state machine:

| Property        | Purpose                                       |
| --------------- | --------------------------------------------- |
| `name`          | Action identifier                             |
| `description`   | What this action does (for LLM)               |
| `parameters`    | Optional parameters for the action            |
| `transitionsTo` | Target variant (undefined if no state change) |

#### Why State Machines?

This design allows the LLM to:

1. Know exactly what actions are available in the current variant
2. Predict the size a Vessel will need after a transition
3. Make intelligent trade-offs (e.g., "collapse Calendar to fit Weather")
4. Never invoke invalid actions for the current state

---

### 2. Chart (Layout System)

The Chart manages the visual arrangement of Vessels on screen using a grid-based system.

**Important**: Grid calculations are based on the Chart container's size, not the browser viewport. This allows Charts to be embedded in any layout context - full-screen, split views, or nested containers.

#### Grid System

```
┌──────────────────────────────────────────────────────────┐
│ 0,0 │ 1,0 │ 2,0 │ 3,0 │ 4,0 │ 5,0 │ 6,0 │ 7,0 │ ...     │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────────│
│ 0,1 │ 1,1 │ 2,1 │ 3,1 │ 4,1 │ 5,1 │ 6,1 │ 7,1 │ ...     │
├─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────────│
│ 0,2 │ 1,2 │ 2,2 │ 3,2 │ 4,2 │ 5,2 │ 6,2 │ 7,2 │ ...     │
└──────────────────────────────────────────────────────────┘
```

**Key Properties:**

- **Grid Unit**: Configurable (default 80px × 80px)
- **Available Grid**: Calculated from Chart container size: `cols = floor(containerWidth / gridUnit)`
- **Coordinates**: Always integers (the LLM never deals with pixels)

#### Container-Based Sizing

The Chart observes its container element and recalculates the available grid when the container resizes:

```
Container: 960px × 640px
Grid Unit: 80px
Available: 12 cols × 8 rows
```

This design allows:

- Full-viewport Charts (container = viewport)
- Split layouts (Chart beside other content)
- Nested Charts (Chart inside another component)
- Multiple Charts on a single page

#### Why Grid-Based?

1. **LLM Simplicity**: Integer coordinates are easier for LLMs to reason about than pixels
2. **Container Agnostic**: The same layout logic works regardless of where the Chart is placed
3. **Predictable Layouts**: Components snap to grid, preventing overlap and alignment issues
4. **Density Adaptation**: Grid unit can be adjusted for different device types (TV, watch, etc.)

#### Layout Engine Responsibilities

- Calculate available grid based on Chart container size
- Register DOM elements for Vessels
- Apply CSS transforms to position Vessels
- Animate transitions between layouts
- Clip visual overflow at the Chart boundary

---

### 3. Maelstrom Engine (Decision Core)

The engine finalizes layout and ordered actions from a provider-neutral planner.
The conventional TanStack LLM remains the default. Experimental Jev uses the
same server-side contract through `@maelstrom-co/engine-jev`.

#### Input: ChartRequest

```
{
  type: "chart_request",
  context: {
    updateReasons: [
      { type: "user_intent", intent: "Show me my calendar for next week" }
    ],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: "tiling"
  },
  instances: [
    { instanceId: "calendar-1", vesselId: "calendar", variant: "month" }
  ],
  vessels: [...],  // All registered Vessel definitions
  layout: {
    type: "tiling",
    tree: ["ID:calendar-1"],
    instances: [{ instanceId: "calendar-1", vesselId: "calendar", variant: "month" }]
  }
}
```

The surrounding `ChartRequestMessage` carries `id`, `sessionId`, and `timestamp`.

Update reasons can include types such as:

- `user_intent`: Explicit user request
- `chart_resize`: The chart container was resized
- `vessel_mutation`: A vessel's state was changed externally

#### Output: MaelstromResponse

```
{
  type: "maelstrom_response",
  requestId: "...",
  executionPlan: [
    { instanceId: "calendar-1", action: "showWeek" }
  ],
  layout: {
    type: "tiling",
    tree: ["ID:calendar-1"],
    instances: [{ instanceId: "calendar-1", vesselId: "calendar", variant: "month" }]
  }
}
```

`userMessage` and `rationale` are optional presentation metadata. A text-free
plan still applies atomically, layout before actions. Public history likewise
permits an absent `assistantMessage`; consumers omit the assistant bubble.

#### Design Properties

The engine is designed with clear boundaries:

- **Client-owned chart state**: Every request supplies the current layout and instances.
- **Optional accepted history**: The engine can persist finalized plans and injections; these do not prove action execution.
- **No action execution**: The engine calls providers and stores history, but client action runners apply its decisions.
- **Transport Agnostic**: Can be called via WebSocket, HTTP, or direct function call
- **Testable**: Easy to unit test with mock inputs and fixed LLM responses

Note that while the engine's logic is deterministic, the LLM responses are inherently stochastic - the same input may produce different (but hopefully semantically similar) outputs.

---

### 4. Protocol (Message Contract)

The protocol defines the structure of messages between client and engine, independent of how they're transported.

#### Message Types

Messages travel as **envelopes** over the duplex stream. The `EngineMessage` variants (`chart_request`, `assistant_message`) are the frames the LLM sees; the envelope layer adds transport-only frames the LLM never sees.

**Client → Engine (`ClientEnvelope`):**

- `chart_request` (`ChartRequestMessage`): User intent + current state
- `assistant_message` (`AssistantInjectionMessage`): Inject an assistant turn into session history
- `client.history.get` (`HistoryGetMessage`): Ask the host to replay recorded session history

**Engine → Client (`ServerEnvelope`):**

- `engine.maelstrom.response` (`MaelstromResponseMessage`): Execution plan + layout directives
- `engine.history.response` (`HistoryResponseMessage`): The recorded session-history entries
- `engine.error` (`EngineErrorMessage`): A failure, correlated to the request when recoverable

The **codec** owns parsing and validation: `encodeEnvelope` serializes any envelope, and `decodeClientEnvelope` / `decodeServerEnvelope` return a `Result` (never throw) — a malformed frame yields an `EnvelopeError` rather than a rejected promise, so a host or connector branches without a try/catch.

#### Transport Agnostic

The protocol only defines message shapes. Transport is a separate concern:

| Transport | Use Case                          |
| --------- | --------------------------------- |
| WebSocket | Real-time, persistent connections |
| HTTP      | Stateless, request/response       |
| In-memory | Testing, embedded deployments     |

The envelope module in `@maelstrom-co/protocol` is the single home of the stream wire contract. It has exactly two adapters: `WebSocketConnector` (client side) encodes outbound frames and decodes server envelopes, and `handleEnvelope` (engine side) decodes a client frame, dispatches it to the engine, and maps the outcome back to a `ServerEnvelope`. A host such as the demo's `ws-server.ts` owns only socket plumbing — it never hand-builds or hand-parses a wire shape.

---

## Data Flow

### Complete Request Lifecycle

```
1. User expresses intent ("Show me weather for next week")
                                    │
                                    ▼
2. Client builds request
   - Captures user intent
   - Snapshots current visible Vessels
   - Includes Chart dimensions (cols × rows)
                                    │
                                    ▼
3. Request sent via transport (WS/HTTP/etc.)
                                    │
                                    ▼
4. Engine processes request
   - Builds LLM prompt with context
   - LLM decides actions and layout
   - Parses and validates LLM response
                                    │
                                    ▼
5. Response sent back to client
                                    │
                                    ▼
6. Client executes response (STRICT ORDER):
   a. Apply set_layout (declares instances and geometry)
   b. Run execute_actions (may transition variants)
                                    │
                                    ▼
7. UI updates, user sees result
```

### Execution Order (Critical)

The client MUST execute the response in this strict order:

1. **Apply `set_layout` first**: Declare the response's instances and geometry.
2. **Run `execute_actions`**: Execute actions sequentially after the layout exists.

This order matters because:

- The client dispatches layout and actions as one atomic command batch.
- `applyTilingLayout` builds a fresh instance map from `layout.instances` instead of merging with the previous map.
- An action may target an instance introduced by the same tiling response. Layout must create that instance before its action runner can become available.
- Applying geometry first also prevents a transitioning Vessel from rendering briefly at stale coordinates.

The client does not run an inline minimum-size reconciliation or overflow resolver after actions. Grid `minSize` validation happens in the engine before the response reaches the client. Tiling does not enforce `minSize`. The Chart clips visual overflow with CSS.

The React Chart observes its container. When the container's pixel size crosses a whole-cell boundary, the `ResizeObserver` sends a new `chart_resize` request. That request starts a separate engine turn; it is not part of the response batch.

---

## Planner integration

### One engine-owned operation

`Planner` exposes `id`, `supportedLayoutModes`, and one `invoke` method.
The engine validates input and captures one detached, deeply frozen request,
enum, and history snapshot. Primary, repair, and fallback calls share that graph.
The conventional LLM builds prompts; Jev builds typed questions. Provider keys,
model options, questions, and raw traces remain inside server implementations.

Canonical finalization checks complete layout coherence, new-instance resolution,
parameter values, and ordered variant transitions. Adapter shorthand preserves
`heal-and-ship`: recommended repair followed by the final renderable subset.
Explicit routes require a visible finalization policy. `strict` rejects material
repairs or dropped actions, but permits valid empty plans and absent prose.

Only the engine schedules repair and one optional fallback. Repair receives
the complete previous candidate and bounded public `FinalizationReport`.
`createLlmPlanner` performs one logical `chat()` per invocation, without an
internal semantic retry loop. Jev claims each stage fetch. Started claims are
not refunded; hidden adapter HTTP retries remain one logical call.

The operation shares its call budget and optional deadline across all routes.
Caller cancellation, deadline expiry, and call exhaustion stop later stages
and never trigger fallback. Finite deadlines must leave room below connector,
proxy, and platform timeouts; local Jev uses 25 seconds under the connector's
30-second default. Legacy shorthand still has no engine deadline by default.

Only finalized acceptance reaches the client or accepted history. Errors remain
distinct: semantic `PlanningDeferredError`, `PlanningBudgetExceededError`,
recognized malformed `InvalidProviderResponseError`, `ProviderError`,
`CancellationError`, and `TimeoutError`. No error applies a partial response.

### Supported Providers

- **OpenAI**: GPT-4 and compatible models
- **Anthropic**: Claude models
- **Custom**: Implement a TanStack text adapter or the public `Planner` contract.
- **Jev**: Experimental tiling-only server planner, with strict finalization and zero repairs.

Jev's two-action, two-new-instance-per-vessel, extraction, and arrangement
limits belong to that implementation. They do not restrict other planners.
The [Jev package reference](../packages/engine-jev/README.md) documents the
historical evidence, including eight incorrect accepted fresh-case layouts.
Typed choices and structural validity cannot establish semantic correctness.

### History and deployment boundaries

The LLM uses `history.conversation`; Jev uses accepted `history.structured`.
`deriveLLMContext` still fully controls its projection and conversational
`maxChars` cost. `planning.deriveContext` and `planning.maxChars` are independent.
An empty custom projection costs zero in its dimension. Omitted caps are
unbounded, while the newest entry stays retained even over a configured
character budget. Text-free turns get a bounded LLM structural summary without
inventing response prose. `transformEntry` precedes both projections.

The local `dev-jev` demo profile uses server `TYPESAFE_API_KEY` and `JEV_MODEL`.
Optional LLM fallback requires server `OPENAI_API_KEY`; log and wire redaction
cover both secrets. Voice remains independently credentialed. Hosted BYOK stays
OpenAI LLM-only with its visitor-key hello/rehello, caching, and teardown lifecycle.
Rollback selects local/server LLM configuration without client or history migration.
See the [planner guide](https://docs.maelstrom-ai.co/guides/engine/planner-backends/).

### Prompt Engineering

The engine constructs prompts that include:

1. **System context**: What Maelstrom is and what the LLM should do
2. **Available Vessels**: All registered Vessels with variants and available actions
3. **Current state**: Visible instances with their current variant
4. **Chart constraints**: Available grid space (cols × rows)
5. **User intent**: What the user wants

The LLM knows:

- What actions are available in each instance's current variant
- What variant each action transitions to
- The current Chart dimensions in grid mode
- The current allocated size of each grid instance

The initial prompt omits each variant's numeric `minSize`. In grid mode, the engine validates the returned placement against the active variant's minimum. If a placement is too small, the engine drops it and may include the required dimensions in a retry prompt. Tiling never reads `minSize`.

The LLM returns structured JSON with:

- Optional presentation text on the finalized wire response; the conventional LLM still requests prose.
- Execution plan (actions to invoke, must be valid for current variant)
- Layout directive (where to place Vessels; in grid mode, size must meet the active variant's `minSize`)

---

## Error Handling

The recovery examples below describe `heal-and-ship`. A strict route rejects
material changes and uses its bounded repair/fallback policy instead.

### Hallucinated Coordinates

If the LLM returns coordinates outside the Chart grid:

- Drop the overflowing position and keep valid positions from the same response
- Record a structured `position_overflow` diagnostic for retry decisions and engine logs

### Invalid Actions

If the LLM references an action that doesn't exist or isn't available in the current variant:

- Skip the action
- Log warning
- Continue with remaining actions

### Malformed Responses

If the LLM returns invalid JSON or unexpected structure:

- Return error to client
- Client can retry or show error state

---

## Event System

The client emits events throughout the lifecycle for observability:

| Event                    | When                                        |
| ------------------------ | ------------------------------------------- |
| `requestSent`            | Client sends request to engine              |
| `responseReceived`       | Engine response arrives                     |
| `actionStarted`          | Before executing an action                  |
| `actionCompleted`        | After action completes (success or failure) |
| `layoutApplied`          | After layout directives are applied         |
| `connectionStateChanged` | Transport connection state changes          |

These enable:

- Debugging during development
- Analytics in production
- UI feedback (spinners, etc.)

---

## Package Dependencies

Packages sit in four layers. Nothing server-side or worker-side may depend on
anything browser-side; a minter and its adapter meet only in the contract layer.

```
CONTRACT  protocol ◀───────────── realtime-protocol
             ▲                             ▲
BROWSER   client ◀── realtime ◀── realtime-openai
             ▲                 ◀── realtime-livekit ──▶ realtime-vad
          react ◀── react-realtime

SERVER    engine ◀── engine-jev    realtime-openai-server    realtime-livekit-server

WORKER    realtime-livekit-agent
```

### Why This Structure?

- **protocol**: Foundation - types and message contract shared by all
- **realtime-protocol**: the realtime contract leaf — token-grant types, mint-failure taxonomy, wire topics. Depends on nothing but `protocol` and `zod`, so a minter can import it without pulling in a browser SDK
- **client**: Framework-agnostic client, can be used anywhere
- **engine**: Server-side only, has LLM provider dependencies
- **engine-jev**: Server-only TypeSafe integration depending on engine and protocol. No engine, protocol, client, React, or browser realtime package depends on it.
- **react** / **react-realtime**: React-specific bindings, optional
- **realtime**: browser-side realtime voice core; talks to the provider directly with ephemeral tokens, feeds intents into the client
- **realtime-vad**: provider-neutral browser voice-activity detector; `MediaStream` in, speech boundaries out
- **realtime-openai** / **realtime-livekit**: browser adapters implementing the `RealtimeProviderAdapter` seam
- **realtime-openai-server** / **realtime-livekit-server**: mint credentials; the sole holders of `OPENAI_API_KEY` and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. They share only contract schemas with the browser side — no code crosses the HTTP boundary
- **realtime-livekit-agent**: Node voice-agent worker running the STT/TTS pipeline for the cascade provider

`packages/realtime-protocol/src/layer-boundary.test.ts` enforces the layering
and fails the build when it is broken. See `docs/adr/0001`–`0003`.

---

## Future Considerations

### Streaming Responses

Currently, the engine returns complete responses. Future versions may support streaming for:

- Showing partial results as they're generated
- Better perceived performance

### Additional Transports

Future transport implementations:

- `@maelstrom-co/transport-ws`: WebSocket transport
- `@maelstrom-co/transport-http`: HTTP transport
- `@maelstrom-co/transport-worker`: Web Worker transport

### Additional Framework Bindings

- `@maelstrom-co/vue`: Vue.js bindings
- `@maelstrom-co/svelte`: Svelte bindings
- `@maelstrom-co/solid`: SolidJS bindings
