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
│  @maelstrom-co/engine - planner seam, validation, orchestration        │
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

#### Benefits of state machines

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

#### Benefits of a grid

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

The engine is the "brain" of the system. It takes context as input and produces layout decisions as output.

#### Input: ChartRequest

```
{
  context: {
    updateReasons: [
      { type: "user_intent", intent: "Show me my calendar for next week" }
    ],
    chartDimensions: { cols: 12, rows: 8 },
    sessionId: "...",
    timestamp: 1234567890
  },
  instances: [
    { instanceId: "calendar-1", vesselId: "calendar", variant: "month", position: {...}, size: {...} }
  ],
  vessels: [...]  // All registered Vessel definitions
}
```

Update reasons can include types such as:

- `user_intent`: Explicit user request
- `chart_resize`: The chart container was resized
- `vessel_mutation`: A vessel's state was changed externally

#### Output: MaelstromResponse

```
{
  rationale: "Switching calendar to week view to show next week",
  executionPlan: [
    { instanceId: "calendar-1", action: "showWeek" }
  ],
  layoutDirective: [
    { instanceId: "calendar-1", position: { x: 0, y: 0 }, size: { w: 6, h: 3 } }
  ]
}
```

#### Design Properties

The engine is designed with clear boundaries:

- **Stateless**: No internal state between requests (context is passed in each time)
- **Side-effect free**: Doesn't modify external systems, only returns decisions
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
- `client.agent.input` (`AgentInputMessage`): Wraps one `AgentInput` (`utterance`, `ui_applied`) under `input`

**Engine → Client (`ServerEnvelope`):**

- `engine.maelstrom.response` (`MaelstromResponseMessage`): Execution plan + layout directives
- `engine.history.response` (`HistoryResponseMessage`): The recorded session-history entries
- `engine.error` (`EngineErrorMessage`): A failure, correlated to the request when recoverable
- `engine.agent.event` (`AgentEventMessage`): Wraps one `AgentEvent` (`placeholder`, `accepted`, `message`, `ui_change`, `finished`, `error`) under `event`

`client.agent.input` carries `id` and `sessionId` like the other client frames. `engine.agent.event` carries its own `id` and `sessionId` in place of the `requestId` the other server frames echo. The inner agent members keep their own `type` discriminator and carry `version` equal to `AGENT_WIRE_VERSION` (currently 1). A new optional field keeps the version. A new member or enum value is rejected by an older decoder as `invalid_envelope`, so it bumps the version, and decoders reject any other version value. Agent ids are branded: `RunId` names an Agent Run, `CallId` a call the loop expects an answer to (separate from the provider's `ToolCallId`), and `ChangeId` a UI change the browser acknowledges.

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

## LLM Integration

### Provider Interface

The engine uses an abstract provider interface:

```
LLMProvider
  ├── generateResponse(context, prompt) → response
  └── (implementation details hidden)
```

### Supported Providers

- **OpenAI**: GPT-4 and compatible models
- **Anthropic**: Claude models
- **Custom**: Implement the interface for any provider

### Prompt Engineering

The reference LLM planner (`@maelstrom-co/planner-llm`) constructs prompts that include:

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

- Rationale (for debugging/logging)
- Execution plan (actions to invoke, must be valid for current variant)
- Layout directive (where to place Vessels; in grid mode, size must meet the active variant's `minSize`)

---

## Error Handling

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

## Diagnostic observations

The Orchestrator exposes a framework-independent `DiagnosticChannel` for optional
observers. DevTools attaches before connection and retains bounded metadata.
Content remains lazy until an explicit recording requests it. Diagnostic observer
failures remain isolated from application work.

| Diagnostic kind | Evidence |
| --- | --- |
| `client.request.started` | The client began a request. |
| `client.response.received` | A response reached the client. |
| `client.response.applied` | The client completed the response command batch. |
| `client.action.completed` | An Action completed, failed, or was skipped. |
| `client.connection.changed` | Engine transport state changed. |
| `client.chart.resized` | Chart dimensions changed. |

DevTools correlates requests by app lifetime and request ID. Response receipt and
application completion remain distinct. Completion does not establish browser
paint or audible speech. Optional realtime integrations publish projected voice
evidence through the same channel, with separate provider lifetimes and generations.

The provider-neutral attachment lives in `realtime`. Framework bindings supply
session lifetime and identity. Provider packages project their own native
envelopes through an optional diagnostics feed; DevTools retains generic evidence
without interpreting provider protocols. Session `generation` and native
`providerGeneration` are independent. The panel does not infer a mapping between
them. Accepted tool results preserve the generation captured before dispatch,
including after reconnect or provider retirement.

Authoritative client and Engine inputs preserve `SessionId` and `MessageId`.
Projected diagnostic identifiers remain strings because redaction and import can
remove their domain guarantees. Synthetic push correlations use a new local
`MessageId` and remain labelled as push evidence.

The server owns Engine observation and `createDiagnosticConnection`. An authorized
host can forward evidence over the protocol through a compatible connector.
Forwarding requires explicit host opt-in and connection-bound session identity;
it stays disabled in production. The Engine never imports a browser DevTools package.

The default DevTools production entrypoints are inert. Explicit `/production`
imports enable browser tools in every build without changing server policy.
See the [DevTools guide](https://docs.maelstrom-ai.co/guides/devtools/) for setup,
recording, redaction, and inspection. These tools do not replace the application's
production telemetry.

Local MCP inspection uses three modules. `@maelstrom-co/devtools-protocol` owns
runtime-neutral wire schemas. The explicit `@maelstrom-co/devtools/mcp-bridge` browser
bridge reads projected metadata through existing filter and request models.
`@maelstrom-co/devtools-mcp-server` owns the stdio interface and authenticated loopback
listener. Its runtime dependencies must not include browser packages.
Pairing is independent of panel visibility. It grants metadata reads without
capture, app inspection, or application Action authority. Production activation
remains disabled for this local, read-only integration.

`@maelstrom-co/telemetry` defines operational facts and bounded sink delivery for
browser and server consumers. It has no runtime dependencies. Its fixed field
allowlist excludes content, identifiers, arbitrary labels, and error text.
Applications own SDKs and exporters. Producer packages provide concrete attachment
APIs through telemetry's `/integration` subscription and projection helpers.
Its metadata projector uses selected producer facts without depending on diagnostic
envelopes or content readers. Operational observation enables no remote diagnostics.

Producer packages expose explicit telemetry attachments. Client metadata
subscriptions keep local observations active without enabling diagnostic-only
connector forwarding or content sources. Forwarded Engine and attached voice
diagnostics bypass client metadata observers. Engine metadata remains server-local.
`diagnosticsObserved` and `addDiagnosticSource` name full-diagnostic capabilities;
the deprecated `observed` and `addSource` aliases preserve compatibility.
`locallyObserved` includes metadata and full diagnostic consumers because both
need local producer work. Realtime shares tool ownership across telemetry and
diagnostics while keeping diagnostic collection separate. Private invocation
identity preserves accepted results across reconnects and repeated tool call IDs.
Retirement drains have bounded capacity and time. Every attachment returns
`{ release, drained }`. The last release retires the shared subscription. Voice
drains also await accepted tool outcomes or report deadline loss before flushing.
Only the application that owns telemetry flushes and disposes it; borrowing scopes
release their attachments. The core has no Effect dependency. Explicit ownership,
tagged states, typed outcomes, and isolated callbacks use plain TypeScript.

Built-in operational metadata types live beside their projection in telemetry's
integration subpath. Custom diagnostic kinds remain extensible. Runtime allowlisting
still protects the export contract. Client and Engine share metadata callback
delivery; source activation, request identity, and producer policy remain local.

---

## Package Dependencies

Packages sit in four layers. Nothing server-side or worker-side may depend on
anything browser-side; a minter and its adapter meet only in the contract layer.

```
CONTRACT  protocol ◀───────────── realtime-protocol
          telemetry (optional operational contract and sink delivery)
             ▲                             ▲
BROWSER   client ◀── realtime ◀── realtime-openai
             ▲                 ◀── realtime-livekit ──▶ realtime-vad
          react ◀── react-realtime
          client ◀── devtools ◀── react-devtools ──▶ react

SERVER    engine ◀── planner-llm    realtime-openai-server    realtime-livekit-server
                 ◀── planner-jev ◀── evals (private)

WORKER    realtime-livekit-agent
```

### Rationale for the package structure

- **protocol**: Foundation - types and message contract shared by all
- **telemetry**: optional operational contract and bounded application-owned sink delivery; usable from every layer without browser, framework, or exporter dependencies
- **realtime-protocol**: the realtime contract leaf — token-grant types, mint-failure taxonomy, wire topics. Depends on nothing but `protocol` and `zod`, so a minter can import it without pulling in a browser SDK
- **client**: Framework-agnostic client, can be used anywhere
- **engine**: Server-side only; planner seam, validation and orchestration, with no LLM provider dependency
- **planner-llm**: the reference LLM planner (`llmPlanner` and the prompt builder) on the engine's planner seam; owns the `@tanstack/ai` dependency the engine dropped. Depends on `engine` and `protocol`; the engine never depends on it
- **planner-jev**: experimental server-only planner that composes Jev (TypeSafe) stages on the engine's planner seam. Depends on `engine` and `protocol`; the engine never depends on it
- **evals**: private, unpublished live evals for the planners (whole-planner arms and single-stage evals). Depends on `planner-jev` (through its internal `_internal` and `_testing` subpaths), `planner-llm`, `engine` and `protocol`; nothing depends on it
- **react** / **react-realtime**: React-specific bindings, optional
- **devtools**: optional browser-side diagnostics collector, bounded capture store, import/export, and shared panel. Depends on `client` and `protocol`; framework adapters own lifecycle wiring
- **react-devtools**: optional React extension that attaches the collector before Provider connection and mounts the shared panel. Depends on `react`, `client`, and `devtools`
- **realtime**: browser-side realtime voice core; talks to the provider directly with ephemeral tokens, feeds intents into the client
- **realtime-vad**: provider-neutral browser voice-activity detector; `MediaStream` in, speech boundaries out
- **realtime-openai** / **realtime-livekit**: browser adapters implementing the `RealtimeProviderAdapter` seam
- **realtime-openai-server** / **realtime-livekit-server**: mint credentials; the sole holders of `OPENAI_API_KEY` and `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. They share only contract schemas with the browser side — no code crosses the HTTP boundary
- **realtime-livekit-agent**: Node voice-agent worker running the STT/TTS pipeline for the cascade provider

`packages/realtime-protocol/src/layer-boundary.test.ts` enforces the layering
and fails the build when it is broken. See the [voice package contracts](./realtime-voice-architecture.md#provider-package-contracts).

---

## Planner provider call flow

The TypeSafe and OpenAI Decisions clients share `createProviderCall` in
`packages/planner-jev/src/lib/provider-call.ts`. It owns option limits,
cancellation and timeouts, reply validation, failure-to-deferral mapping,
logging, instrumentation, and the `onCall` record.

The shared `postJson` step in `packages/planner-jev/src/lib/provider-fetch.ts`
bounds response bodies and retains only short error identifiers that do not
contain the provider key. A transport owns request encoding, reply decoding,
and the location of provider-specific error fields. It cannot bypass the shared
validation or error filtering.

A replacement transport must pass every existing row of
`packages/planner-jev/src/lib/provider-transport-contract.test.ts` without
removing or weakening a case. An adapter bridge must also preserve these
requirements, including those outside that suite:

- Typed refusals name the refused questions and retain other answers and usage.
  Report usage on refusals and failures as well as success.
- Honor the per-call timeout and caller cancellation. Expose HTTP status as a
  field, bound response bodies, and keep error bodies out of exception messages.
  Preserve access to the raw reply and distinguish network failures by type.
- Send score levels with separate labels and descriptions. Preserve duplicate
  answer names until shared validation can inspect them.
- Disable SDK retries by default or allow setting retries to zero per call.
- Stringify structured choice-option text and non-string state before passing
  them to TanStack `adapter.evaluate()`. This normalization belongs in the bridge.

`decide()` remains excluded from this call flow. The shared validator must check
answer key sets, probability sums, the most probable choice, and the model echo.
The score is the most probable level, rather than a rounded score value.
Passing a transport suite does not authorize weaker validation or changed scores.

### Provider evaluation baseline

Evaluate both provider arms with suite `all` and `--repeats 3`, using 465 turns
per arm for this baseline. A cheap turn has no fallback call. Cheap correct and
cheap wrong are passing and failing cheap turns, each divided by all turns.
Fallback rate is the share of turns with any fallback call. Cheap p50 is the
median duration of cheap turns.

| Arm | Cheap correct | Cheap wrong | Fallback | Cheap p50 |
| --- | --- | --- | --- | --- |
| `jev-composed-pairs-screen-scope` (TypeSafe) | 69.2% | 12.7% | 18.1% | 2079 ms |
| `decisions-composed-pairs-screen-scope-prose` (Decisions) | 53.1% | 25.8% | 21.1% | 2497 ms |

A replacement must keep cheap-correct, cheap-wrong, and fallback rates within one
percentage point of these baselines, and cheap-path median latency within 10%.
Provider behavior can drift, so also run the existing and replacement transports
at the same time under the same provider/model configuration and record both
results. These are live evaluations and require the usual service and cost
approval; passing local tests does not establish these measurements.

The shared flow imports TanStack wire types only. A library upgrade alone does
not replace the fetch transports or establish equivalent validation behavior.

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
