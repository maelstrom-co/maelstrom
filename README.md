# Maelstrom

**AI-orchestrated dynamic UI framework**

Maelstrom enables LLM-driven user interfaces where an AI agent intelligently arranges, controls, and interacts with UI components based on user intent and available screen space.

---

## What is Maelstrom?

Maelstrom is a framework for building dynamic, AI-controlled user interfaces. Instead of static layouts or manual user arrangement, an LLM (Large Language Model) acts as an intelligent orchestrator that:

- **Understands user intent** - Interprets natural language requests to determine what the user wants to see
- **Manages layout dynamically** - Positions and resizes UI components based on available viewport space
- **Orchestrates component state** - Triggers actions on components to change their behavior
- **Adapts in real-time** - Responds to viewport changes and user interactions

### Use Cases

- **Dashboards** - AI arranges widgets based on what's relevant to the user's current task
- **Command interfaces** - Natural language controls which tools and views are visible
- **Adaptive applications** - UI that reconfigures itself across devices (desktop, tablet, TV, watch)
- **Assistive interfaces** - AI helps users navigate complex applications

---

## Core Concepts

### Vessels

**Vessels** are state machines that represent UI components. Each Vessel declares:

- **What it does** - A semantic description for the LLM to understand its purpose
- **Variants** - The possible states it can be in, each with a minimum size requirement
- **Actions** - Transitions between variants that the LLM can invoke

Vessels are pre-defined components, not dynamically generated. The LLM orchestrates them by invoking actions that transition between variants.

```typescript
const calendar: Vessel = {
  id: "calendar",
  name: "Calendar",
  description: "Calendar for scheduling and date selection",
  defaultVariant: "month",
  variants: {
    month: {
      props: { view: "month" },
      minSize: { w: 4, h: 4 },
      actions: [
        { name: "showWeek", description: "Switch to week view", transitionsTo: "week" },
        { name: "collapse", description: "Minimize", transitionsTo: "collapsed" },
      ],
    },
    week: {
      props: { view: "week" },
      minSize: { w: 6, h: 3 },
      actions: [{ name: "showMonth", description: "Back to month", transitionsTo: "month" }],
    },
    collapsed: {
      props: { collapsed: true },
      minSize: { w: 2, h: 1 },
      actions: [{ name: "expand", description: "Expand", transitionsTo: "month" }],
    },
  },
};
```

### Chart

The **Chart** is the grid-based canvas that positions Vessels. It:

- Divides its container into a logical grid (configurable, default: 80px cells)
- Tracks available columns and rows based on container size
- Applies positioning directives from the Maelstrom engine
- Handles overflow when components don't fit

The LLM works with integer grid coordinates, never pixels. This abstraction allows the same orchestration logic to work across different screen densities.

### Maelstrom Engine

The **Maelstrom Engine** is the decision-making core:

- **Receives**: Current context (visible Vessels, registered Vessels, user intent, chart dimensions)
- **Returns**: Execution plan (actions to invoke) + Layout directives (where to position Vessels)

The engine is transport-agnostic. It doesn't know how it's being called - could be WebSocket, HTTP, or direct function call. This makes it easy to test, deploy, and integrate.

---

## Architecture

```
+------------------------------------------------------------------+
|                         Client                                    |
|  +-------------+  +-------------+  +---------------------------+ |
|  |  Vessel     |  |   Chart     |  |     Client Core           | |
|  |  Registry   |  |  (Layout)   |  |   (State + Events)        | |
|  +-------------+  +-------------+  +---------------------------+ |
+--------------------------------|----------------------------------+
                                 | Protocol (transport-agnostic)
                                 v
+------------------------------------------------------------------+
|                    Maelstrom Engine                               |
|  +-------------+  +-------------+  +---------------------------+ |
|  |  Context    |  |   Prompt    |  |     LLM Provider          | |
|  |  Builder    |  |  Templates  |  |  (OpenAI/Anthropic/...)   | |
|  +-------------+  +-------------+  +---------------------------+ |
+------------------------------------------------------------------+
```

The protocol defines the message contract. Transport (WebSocket, HTTP, etc.) is a separate concern.

---

## Packages

### Shared

| Package                                    | Description                     | Documentation                         |
| ------------------------------------------ | ------------------------------- | ------------------------------------- |
| [`@maelstrom-co/protocol-old`](./shared/protocol) | Core types and message contract | [README](./shared/protocol/README.md) |

### Client

| Package                              | Description                       | Documentation                      |
| ------------------------------------ | --------------------------------- | ---------------------------------- |
| [`@maelstrom-co/client`](./client/core) | Framework-agnostic client library | [README](./client/core/README.md)  |
| [`@maelstrom-co/react`](./packages/react) | React bindings and components     | [README](./packages/react/README.md) |

### Server

| Package                                | Description         | Documentation                       |
| -------------------------------------- | ------------------- | ----------------------------------- |
| [`@maelstrom-co/engine-old`](./server/engine) | LLM decision engine | [README](./server/engine/README.md) |

---

## Key Features

### Grid-Based Layout

The LLM works with a logical grid, not pixels. This provides:

- **Simplicity** - Integer coordinates instead of pixel math
- **Adaptability** - Same logic works across screen sizes
- **Predictability** - Components snap to grid, preventing overlap

### Vessels as State Machines

Vessels define their behavior through variants and actions:

- **Variants** - Discrete states with specific size requirements
- **Actions** - Transitions between variants, invokable by the LLM
- **Self-describing** - Vessels declare what they can do, the LLM figures out when

### Transport-Agnostic Protocol

The protocol defines the message contract between client and engine:

- Messages are plain objects that can be serialized to JSON
- Transport layer (WebSocket, HTTP, in-memory) is a separate concern
- Easy to test with mock implementations

### Provider-Agnostic LLM Integration

The engine supports multiple LLM providers:

- OpenAI (GPT-4, etc.)
- Anthropic (Claude)
- Custom providers via an abstract interface

### Event System

Subscribe to lifecycle events for debugging, analytics, and UI feedback.

---

## Documentation

- [Architecture Overview](./docs/architecture.md) - Deep dive into system design
- [Getting Started](./docs/getting-started.md) - Step-by-step tutorial
- [Creating Vessels](./client/react/README.md#creating-vessels) - Guide to building custom components

---

## Development

This is an Nx monorepo using:

- **TypeScript** - Type-safe code across all packages
- **Vite** - Fast builds and dev server
- **Vitest** - Testing framework
- **React 19** - UI framework (for `@maelstrom-co/react`)

### Commands

```bash
# Install dependencies
npm install

# Run the demo app
nx serve demo

# Build all packages
nx run-many -t build

# Run tests
nx run-many -t test

# Type check
nx run-many -t typecheck
```

---

## Contributing

We welcome contributions! Please see our contributing guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE) for details.
