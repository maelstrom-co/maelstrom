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
- Detect and handle overflow (Vessels that don't fit)

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

**Client → Engine:**

- `ChartRequest`: User intent + current state
- `PingMessage`: Heartbeat (if using persistent connection)

**Engine → Client:**

- `MaelstromResponse`: Execution plan + layout directives
- `ErrorResponse`: Error information
- `PongMessage`: Heartbeat response

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
   a. Execute actions (transitions variants)
   b. Get new sizes (from variant minSize)
   c. Apply layout (CSS transforms)
   d. Handle overflow
                                    │
                                    ▼
7. UI updates, user sees result
```

### Execution Order (Critical)

The client MUST execute the response in this strict order:

1. **Execute Actions First**: Run all actions sequentially, transitioning variants
2. **Get New Sizes**: Look up minSize from the new variant
3. **Apply Layout**: Position Vessels using CSS transforms
4. **Handle Overflow**: Manage Vessels that don't fit

This order matters because:

- Actions transition Vessels to new variants
- New variants have different minSize requirements
- Layout must allocate at least the minSize for each variant

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

The engine constructs prompts that include:

1. **System context**: What Maelstrom is and what the LLM should do
2. **Available Vessels**: All registered Vessels with variants and available actions
3. **Current state**: Visible instances with their current variant
4. **Chart constraints**: Available grid space (cols × rows)
5. **User intent**: What the user wants

The LLM knows:

- What actions are available in each instance's current variant
- What variant each action transitions to
- What size each variant requires

The LLM returns structured JSON with:

- Rationale (for debugging/logging)
- Execution plan (actions to invoke, must be valid for current variant)
- Layout directive (where to place Vessels, size must meet variant minSize)

---

## Error Handling

### Hallucinated Coordinates

If the LLM returns coordinates outside the Chart grid:

- Clamp to nearest valid position
- Log warning for debugging

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

```
@maelstrom-co/protocol     (foundation: types + messages)
         │
    ┌────┴────┐
    ▼         ▼
@maelstrom-co/client   @maelstrom-co/engine
         │
    ┌────┴───────────────┐
    ▼                    ▼
@maelstrom-co/react   @maelstrom-co/voice
         │                    │
         └────────┬───────────┘
                  ▼
         @maelstrom-co/react-voice
```

### Why This Structure?

- **protocol**: Foundation - types and message contract shared by all
- **client**: Framework-agnostic client, can be used anywhere
- **engine**: Server-side only, has LLM provider dependencies
- **react**: React-specific bindings, optional. Voice-free.
- **voice**: Browser-side voice runtime (audio capture, VAD, sessions)
- **react-voice**: Optional React extension that wires voice into a Maelstrom instance via `.with(maelstromVoice())`. Depends on react (peer) + voice.

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
