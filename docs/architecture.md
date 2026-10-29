# Maelstrom Architecture

Maelstrom separates planning, validation, and UI updates. The Planner proposes a layout and Actions, the Engine validates them, and the client applies the accepted response. This page explains those responsibilities and the order of a Chart update.

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

Variants and Actions describe the choices available to the configured Planner. For example, it can request an Action that collapses a Calendar to make room for Weather. The Engine validates each requested Action against the Vessel definition before including it in the client's `executionPlan`.

---

### 2. Chart (Layout System)

The Chart arranges Instances within its container. It supports tiling, the default layout mode, and a grid of integer-cell positions and sizes. Both modes use the Chart container's size, so a Chart can fill a screen or sit beside other content.

#### Tiling layout

A tiling layout divides the container with a tree of horizontal (`H`) and vertical (`V`) splits. Horizontal splits divide height; vertical splits divide width. Each leaf identifies a visible Instance or an empty region. The client calculates each region's size from the tree and the container dimensions.

The layout also carries an `instances` array with the identity and Variant of every retained Instance. The tree controls visibility: an Instance listed in `instances` but omitted from the tree remains retained and hidden. Removing it from `instances` removes it from the client's Instance map.

This separation lets the Planner change which Instances are visible while retaining their identities for later layouts. See [Grid vs Tiling Layout](https://docs.maelstrom-ai.co/understanding/grid-vs-tiling/) for split examples and weights.

#### Grid layout

A grid layout gives each visible Instance an integer row, column, width, and height. The client converts these cell values to positions within the Chart container.

The configurable grid unit defaults to 80px × 80px. Available columns are `floor(containerWidth / gridUnit)`; rows use the same calculation with container height. The Chart observes its container, not the browser viewport:

```text
Container: 960px × 640px
Grid Unit: 80px
Available: 12 columns × 8 rows
```

The Engine checks grid positions against the Chart bounds and the active Variant's `minSize`. It drops placements that overflow or fall below the minimum. Tiling does not enforce `minSize`; its leaf sizes come from the split tree and container dimensions.

#### Client layout responsibilities

- Calculate available grid based on Chart container size in grid mode
- Register DOM elements for Vessels
- Apply CSS transforms to position Vessels
- Animate transitions between layouts
- Clip visual overflow at the Chart boundary

---

### 3. Maelstrom Engine (Decision Core)

The Engine passes a `ChartRequest` to the configured Planner, repairs recoverable problems in its candidate, and validates the result. It returns the accepted layout and Actions for the client to apply.

#### Input: ChartRequest

`ChartRequest` is the payload inside a `ChartRequestMessage`. The message envelope carries `id`, `sessionId`, and `timestamp`; those fields are not part of the request payload.

Illustrative grid-mode request payload, with Vessel definitions omitted:

```ts
{
  type: 'chart_request',
  context: {
    updateReasons: [
      { type: 'user_intent', intent: 'Show me my calendar for next week' }
    ],
    chartDimensions: { columns: 12, rows: 8 },
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

The Engine returns a `layout` and an `executionPlan`. The client applies the layout first so Actions can target Instances created by that response. See [Execution order](#execution-order-critical) for the atomic command batch.

Illustrative grid-mode response payload:

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

`requestId` echoes the originating message ID. `userMessage` is the user-facing text; `rationale` is for diagnostics.

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

`client.agent.input` carries `id` and `sessionId` like the other client frames. `engine.agent.event` carries its own `id` and `sessionId` in place of the `requestId` the other server frames echo. The inner agent members keep their own `type` discriminator and carry `version` equal to `AGENT_WIRE_VERSION` (currently 1). A new optional field keeps the version. A new member or enum value is rejected by an older decoder as `invalid_envelope`, so it bumps the version, and decoders reject any other version value. An `accepted` event for `ui_only` carries a server-minted `runId` followed by exactly one `finished` for that run, and only `noise` has a null `runId`. The wire is unstable until the client event applier ships, and version bumps apply from then on. Agent IDs are branded: `RunId` names an Agent Run, `CallId` a call the loop expects an answer to (separate from the provider's `ToolCallId`), and `ChangeId` a UI change the browser acknowledges.

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

The client does not run an inline minimum-size reconciliation or overflow resolver after Actions. The Engine handles the [layout constraints](#grid-layout) before returning the response, and the Chart clips visual overflow with CSS.

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

The Planner uses the available Actions and Variant transitions to propose an execution plan. The Engine validates that candidate against the original request and repairs recoverable layout and Action problems before the client receives it.

The Planner returns structured output with:

- A user-facing message and a rationale
- An execution plan of Action invocations
- A grid or tiling layout, depending on the request's layout mode

---

## Error Handling

### Invalid Layout Entries

If the Planner returns an invalid grid position or an inconsistent tiling entry, the response processor can drop or repair the affected entry while preserving the rest of a recoverable response. Grid overflow is reported as a structured diagnostic. A response that heals to an empty layout may recommend a retry when the request included Instances.

### Invalid Actions

If the Planner requests an Action that does not exist or is unavailable in the current Variant, the Engine skips it. It records a diagnostic explaining why and continues with the remaining valid Actions.

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
