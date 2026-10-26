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
│  @maelstrom-co/react (or Vue, Svelte, etc. in the future)         │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Client Core                                  │
│  @maelstrom-co/client - Vessel Registry, Chart, Event System     │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Protocol                                     │
│  @maelstrom-co/protocol - Message definitions (transport-agnostic)│
└─────────────────────────────────┬───────────────────────────────┘
                                  │ (Any transport: WS, HTTP, etc.)
                                  │
┌─────────────────────────────────┴───────────────────────────────┐
│                     Maelstrom Engine                            │
│  @maelstrom-co/engine - planner seam, validation, orchestration  │
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
| `defaultVariant` | Starting variant when the Vessel is created           |
| `variants`       | Map of variant names to variant definitions            |

#### Variants

Each variant represents a discrete state of the Vessel:

| Property  | Purpose                                                       |
| --------- | ------------------------------------------------------------- |
| `props`   | State properties for this variant (e.g., `{ view: 'month' }`) |
| `minSize` | Minimum chart size required in grid layout mode               |
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

This design allows the configured Planner to:

1. Know which actions are available in the current variant.
2. Rely on Engine-side minimum-size validation in grid mode; tiling mode does not enforce `minSize`.
3. Make intelligent trade-offs (e.g., "collapse Calendar to fit Weather").
4. Request Actions for Engine validation; only accepted Actions reach the client's `executionPlan`.

---

### 2. Chart (Layout System)

The Chart arranges Vessels on screen using either a tiling split tree (the default layout mode) or a grid of integer-cell positions and sizes. Grid calculations are based on the Chart container's size, not the browser viewport. This allows Charts to be embedded in any layout context: full-screen, split views, or nested containers.

#### Grid System

```
┌──────────────────────────────────────────────────────────┐
│ row 0: positions use integer columns and cell sizes      │
├──────────────────────────────────────────────────────────┤
│ row 1: positions use integer columns and cell sizes      │
├──────────────────────────────────────────────────────────┤
│ row 2: positions use integer columns and cell sizes      │
└──────────────────────────────────────────────────────────┘
```

**Key Properties:**

- **Grid Unit**: Configurable (default 80px × 80px).
- **Available Grid**: Calculated from Chart container size: `cols = floor(containerWidth / gridUnit)`; rows use the same calculation with container height.
- **Coordinates**: Integer row and column values, with integer width and height; the model never deals with pixels.

#### Container-Based Sizing

In grid mode, the Chart observes its container element and recalculates available cells when the container resizes:

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

1. **LLM Simplicity**: Integer coordinates are easier for models to reason about than pixels.
2. **Container Agnostic**: The same layout logic works regardless of where the Chart is placed.
3. **Predictable Layouts**: Components snap to cells, preventing overlap and alignment issues.
4. **Density Adaptation**: Grid unit can be adjusted for different device types (TV, watch, etc.).

#### Layout Engine Responsibilities

- Calculate available grid based on Chart container size in grid mode
- Register DOM elements for Vessels
- Apply CSS transforms to position Vessels
- Animate transitions between layouts
- Clip visual overflow at the Chart boundary

Tiling mode describes layout with an H/V split tree and retained Instance metadata. The split tree determines which Instances are visible; retained Instances omitted from the tree remain hidden rather than deleted.

---

### 3. Maelstrom Engine (Decision Core)

The Engine receives a `ChartRequest` and a configured Planner's candidate, heals and validates the candidate, and returns a structured response. The Engine does not itself mutate the client Chart or execute Actions.

#### Input: ChartRequest

`ChartRequest` is the payload inside a `ChartRequestMessage`. The message envelope carries `id`, `sessionId`, and `timestamp`; those fields are not part of the request payload.

```ts
{
  type: 'chart_request',
  context: {
    updateReasons: [
      { type: 'user_intent', intent: 'Show me my calendar for next week' }
    ],
    chartDimensions: { cols: 12, rows: 8 },
    layoutMode: 'grid'
  },
  instances: [
    { instanceId: 'calendar-1', vesselId: 'calendar', variant: 'month' }
  ],
  vessels: [/* registered Vessel definitions */],
  layout: {
    type: 'grid',
    positions: [
      {
        instanceId: 'calendar-1',
        position: { row: 0, column: 0 },
        size: { width: 6, height: 3 }
      }
    ]
  }
}
```

The `instances` array describes current Instance identity and variant. The `layout` carries current geometry: grid positions in grid mode, or a split tree plus retained Instance metadata in tiling mode. Update reasons can include:

- `user_intent`: Explicit user request
- `chart_resize`: The Chart container was resized, with previous and current dimensions
- `vessel_mutation`: A Vessel's state was changed externally

#### Output: MaelstromResponse

The response carries a `layout` and an `executionPlan`; it does not use a `layoutDirective` field. The client applies the layout before executing the Actions.

```ts
{
  type: 'maelstrom_response',
  requestId: 'message-123',
  userMessage: 'Switching the calendar to week view.',
  rationale: 'The user asked to see next week.',
  executionPlan: [
    { instanceId: 'calendar-1', action: 'showWeek' }
  ],
  layout: {
    type: 'grid',
    positions: [
      {
        instanceId: 'calendar-1',
        position: { row: 0, column: 0 },
        size: { width: 6, height: 3 }
      }
    ]
  }
}
```

`requestId` echoes the originating message ID. `userMessage` is the user-facing text; `rationale` is for diagnostics, not the user-facing reply. `executionPlan` lists Action invocations, and `layout` is either a grid layout or a tiling layout.

#### Engine behavior and boundaries

- **Session state is optional.** With `history` configured, the Engine reads and records session history and deduplicates identical chart requests by `(sessionId, messageId)`. Without history, requests are processed without retained conversation history.
- **Request-level flow.** A chart request passes through history loading, the configured Planner (with retries when enabled), response healing and validation, and history recording when configured.
- **No direct UI mutation.** The Engine returns a response; the client applies its layout and executes accepted Actions. Configured history stores, loggers, instrumentation, and planner code may perform their own side effects.
- **Transport agnostic**: The protocol can travel over WebSocket, HTTP, or another compatible transport.
- **Testable**: Engine behavior can be tested with mock inputs and planner results.

The response processor heals recoverable layout and Action problems. Unrecoverable provider, validation, cancellation, or history failures return an error. A configured `validatePlan` hook can enforce application requirements on the healed response, using the existing retry budget.

---

### 4. Protocol (Message Contract)

The protocol defines message shapes between client and Engine host, independent of the transport.

#### Message Types

Messages travel as **envelopes** over the duplex stream. `EngineMessage` describes the `chart_request` and `assistant_message` inputs handled by the Engine. The envelope layer also contains transport and session-history frames and Agent Session frames. An assistant-message injection is persisted into history; it is not itself a planner request.

**Client → Engine host (`ClientEnvelope`):**

- `chart_request` (`ChartRequestMessage`): User intent and current Chart state
- `assistant_message` (`AssistantInjectionMessage`): Inject an assistant turn into session history
- `client.history.get` (`HistoryGetMessage`): Ask the host to replay recorded session history
- `client.agent.input` (`AgentInputMessage`): Wraps one `AgentInput` (`utterance`, `ui_applied`) under `input`

**Engine host → Client (`ServerEnvelope`):**

- `engine.maelstrom.response` (`MaelstromResponseMessage`): User-facing message, execution plan, and layout
- `engine.history.response` (`HistoryResponseMessage`): The recorded session-history entries
- `engine.error` (`EngineErrorMessage`): A failure, correlated to the request when recoverable
- `engine.agent.event` (`AgentEventMessage`): Wraps one `AgentEvent` (`placeholder`, `accepted`, `message`, `ui_change`, `finished`, `error`) under `event`

`client.agent.input` carries `id` and `sessionId` like the other client frames. `engine.agent.event` carries its own `id` and `sessionId` in place of the `requestId` the other server frames echo. The inner agent members keep their own `type` discriminator and carry `version` equal to `AGENT_WIRE_VERSION` (currently 1). A new optional field keeps the version. A new member or enum value is rejected by an older decoder as `invalid_envelope`, so it bumps the version, and decoders reject any other version value. Agent IDs are branded: `RunId` names an Agent Run, `CallId` a call the loop expects an answer to (separate from the provider's `ToolCallId`), and `ChangeId` a UI change the browser acknowledges.

The protocol package owns the envelope codecs: `encodeEnvelope` serializes an envelope, and `decodeClientEnvelope` / `decodeServerEnvelope` return a `Result` and never throw. A malformed frame yields an `EnvelopeError` rather than a rejected promise. The client `WebSocketConnector` and the Engine-side `handleEnvelope` use these codecs to adapt the wire contract to their respective boundaries; hosts should not hand-build or hand-parse wire shapes.

#### Transport Agnostic

The protocol only defines message shapes. Transport is a separate concern:

| Transport | Use Case                          |
| --------- | --------------------------------- |
| WebSocket | Real-time, persistent connections |
| HTTP      | Stateless, request/response       |
| In-memory | Testing, embedded deployments     |

---

## Data Flow

### Complete Request Lifecycle

```
1. User expresses intent ("Show me weather for next week")
                                    │
                                    ▼
2. Client builds a ChartRequestMessage
   - Captures the update reason
   - Snapshots current Instance identities and variants
   - Includes the current layout and Chart dimensions
                                    │
                                    ▼
3. Request sent via transport (WS/HTTP/etc.)
                                    │
                                    ▼
4. Engine processes the chart request
   - Loads prior history when configured
   - Runs the configured Planner and validates its candidate
   - Heals recoverable layout and Action problems
                                    │
                                    ▼
5. Response sent back to client
                                    │
                                    ▼
6. Client applies the response in order:
   a. Apply the response's layout
   b. Run the response's executionPlan Actions
                                    │
                                    ▼
7. UI updates, user sees result
```

### Execution Order (Critical)

The client applies the response in this order:

1. **Apply `layout` first**: Establish the response's Instances and geometry.
2. **Run `executionPlan` Actions**: Execute the accepted Actions after the layout exists.

This order matters because:

- The client dispatches layout and Actions as one atomic command batch.
- Applying a tiling layout builds the retained Instance map from `layout.instances`.
- An Action may target an Instance introduced by the same tiling response. Layout must establish that Instance before its Action runner can become available.
- Applying the geometry first also prevents a transitioning Vessel from rendering briefly at stale coordinates.

The client does not run an inline minimum-size reconciliation or overflow resolver after Actions. Grid `minSize` validation happens in the Engine before the response reaches the client. Tiling does not enforce `minSize`. The Chart clips visual overflow with CSS.

The React Chart observes its container. When the container's pixel size crosses a whole-cell boundary, the `ResizeObserver` sends a new `chart_resize` request. That request starts a separate Engine turn; it is not part of the response batch.

---

## LLM Integration

### Planner Interface

The Engine accepts a configured Planner stage through `EngineConfig.planner`. The reference LLM Planner, `@maelstrom-co/planner-llm`, uses a provider adapter and returns a candidate for Engine validation. The Engine itself has no provider dependency; applications can supply another compatible Planner.

### Prompt Engineering

The reference LLM Planner (`@maelstrom-co/planner-llm`) constructs prompts that include:

1. **System context**: What Maelstrom is and what the Planner should do
2. **Available Vessels**: Registered Vessels with variants and available Actions
3. **Current state**: The Instance snapshots and layout supplied in the ChartRequest
4. **Chart constraints**: Chart dimensions in grid mode and the layout mode
5. **User intent**: The update reason, when one is present

The Planner can use the available Actions and variant transitions to produce an execution plan. The Engine validates and heals the candidate against the original request. In grid mode, the Engine validates positions against Chart bounds and the active variant's `minSize`; tiling mode uses its split-tree layout and does not enforce `minSize`.

The Planner returns structured output with:

- A user-facing message and a rationale
- An execution plan of Action invocations
- A grid or tiling layout, depending on the request's layout mode

---

## Error Handling

### Invalid Layout Entries

If the Planner returns an invalid grid position or an inconsistent tiling entry, the response processor can drop or repair the affected entry while preserving the rest of a recoverable response. Grid overflow is reported as a structured diagnostic. A response that heals to an empty layout may recommend a retry when the request included Instances.

### Invalid Actions

If the Planner references an Action that does not exist or is not available in the current variant, the Engine skips that Action and records a structured diagnostic. It can continue with the remaining valid Actions; the response-healed summary log is severity-routed.

### Malformed Responses

Invalid JSON or a structurally invalid Planner result can return an error. Semantic layout and Action problems that the response processor can recover from are healed and reported through diagnostics rather than failing the whole turn.

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

The `chart_request` path returns a complete response. A separate Agent Session
wire contract includes streamed `message` events; that wire contract does not
mean the Engine's chart-response path streams. Future work may add streaming to
that path for:

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
