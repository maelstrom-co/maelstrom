<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/maelstrom-co/maelstrom/main/media/logo-white.svg" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/maelstrom-co/maelstrom/main/media/logo-black.svg" />
    <img src="https://raw.githubusercontent.com/maelstrom-co/maelstrom/main/media/logo-black.svg" alt="Maelstrom" width="520" />
  </picture>
</div>

<br />

<div align="center">
  <a href="./LICENSE" target="_parent"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <a href="https://github.com/maelstrom-co/maelstrom" target="_parent"><img alt="GitHub stars" src="https://img.shields.io/github/stars/maelstrom-co/maelstrom.svg?style=social&label=Star" /></a>
  <a href="https://x.com/maelstrom_co" target="_parent"><img alt="Follow @maelstrom_co" src="https://img.shields.io/twitter/follow/maelstrom_co.svg?style=social" /></a>
</div>

# Maelstrom

**Maelstrom orchestrates the components you designed.** It hands your model your
stateful components and a live layout surface — to arrange them, resize them, and
trigger their actions by intent, in real time. It never invents new ones.

Maelstrom is an open-source library for **AI-orchestrated UI**. You author your
components as Vessels — typed state machines with discrete variants and size
hints — and a model arranges, resizes, transitions, and invokes them on a spatial
layout surface, from whatever the user is trying to do.

## <a href="https://docs.maelstrom-ai.co">Read the docs -></a>

## Start Here

- [Introduction](https://docs.maelstrom-ai.co/getting-started/introduction/) -
  what Maelstrom is and why it exists.
- [Quick Start](https://docs.maelstrom-ai.co/getting-started/quick-start/) -
  your first Vessel, from install to a running chart.
- [Core Concepts](https://docs.maelstrom-ai.co/getting-started/core-concepts/) -
  Vessels, the Chart, and the Engine.
- [How Maelstrom Compares](https://docs.maelstrom-ai.co/understanding/comparison/) -
  against chat-UI libraries and agent frameworks.
- [API Reference](https://docs.maelstrom-ai.co/reference/react/readme/) - every
  export, generated from source.

## Why Maelstrom

Most AI interfaces either put model output in a conversation or generate
interface elements at runtime. Maelstrom takes a different path: the model
adapts the interface in the moment by composing pieces you designed on purpose.

- **It arranges; it doesn't invent.** You author Vessels — your real UI
  components, each a typed state machine with discrete variants and size hints.
  The model chooses *which* are on screen, *where*, at *what scale*, in *what
  state* — never their contents.
- **It reasons in discrete layouts, not pixels.** In the default tiling mode,
  the model describes structure as an H/V split tree. The alternative grid mode
  uses integer-cell positions and sizes.
- **It acts; it doesn't just show.** Every Vessel exposes the actions its makers
  declare, and Maelstrom invokes them straight from intent. Actions and variants
  define model capabilities, not authorization — enforce permissions in action
  handlers and trusted server APIs.

Intent has many forms — voice, text, channels not yet invented. To the model
they're the same signal. Each follows the same engine path for planning layout
and actions against the application's registered Vessels and current Chart.

## Install

Maelstrom is currently a private beta on GitHub Packages. Configure access using
the [beta installation guide](https://docs.maelstrom-ai.co/getting-started/install-beta/),
then install the React package:

```bash
npm install @maelstrom-co/react@alpha
```

The guide includes npm, Bun, pnpm, and Yarn configuration. `@maelstrom-co/react`
re-exports the vessel helpers and connectors, so you do not need to install
`@maelstrom-co/client` or `@maelstrom-co/protocol` separately. Processing intent
still requires a compatible Maelstrom engine endpoint.

Want to see Maelstrom first? [Open the hosted BYOK demo](https://demo.maelstrom-ai.co)
with your own OpenAI API key.

## Define a Vessel

A Vessel is a state machine. Variants are its states, and each declares a
`minSize` in grid cells. Grid mode enforces it: the engine drops any placement
below the minimum, and names the number when it re-prompts. Tiling mode ignores
it — a leaf's size comes from the split tree:

```tsx
import { defineVessel } from '@maelstrom-co/react';

export const greetingVessel = defineVessel({
  id: 'greeting',
  name: 'Greeting',
  description: 'Greets the user by name.',
  defaultVariant: 'compact',
  variants: {
    compact: {
      description: 'One-line greeting',
      props: { name: 'there' },
      minSize: { width: 2, height: 1 },
      actions: [],
    },
  },
});
```

Learn more in the
[Creating Vessels docs](https://docs.maelstrom-ai.co/guides/react/creating-vessels/)
and the
[Variants & Actions docs](https://docs.maelstrom-ai.co/guides/react/variants-and-actions/).

## Render the Chart

`vessel()` pairs the definition with your component, which receives typed props
for whichever variant is live:

```tsx
import {
  createMaelstrom,
  type TypedVesselProps,
  vessel,
  WebSocketConnector,
} from '@maelstrom-co/react';

function Greeting({ variantProps }: TypedVesselProps<typeof greetingVessel>) {
  return <div>Hello {variantProps.name}</div>;
}

const m = createMaelstrom({ vessels: [vessel(greetingVessel, Greeting)] });
const connector = new WebSocketConnector({ url: 'ws://localhost:3001/ws' });

export const App = () => (
  <m.Provider connector={connector}>
    <m.Chart style={{ height: '100vh' }} />
  </m.Provider>
);
```

Learn more in the
[Layout Modes docs](https://docs.maelstrom-ai.co/guides/react/layout-modes/) and
the
[Programmatic Layout docs](https://docs.maelstrom-ai.co/guides/client/programmatic-layout/).

## Drive It With Intent

`useMaelstrom()` hands you the loop from any component under the Provider:

```tsx
function IntentBar() {
  const { processIntent, isProcessing } = m.useMaelstrom();
  return (
    <input
      disabled={isProcessing}
      onKeyDown={(e) =>
        e.key === 'Enter' && processIntent(e.currentTarget.value)
      }
    />
  );
}
```

Mount it anywhere under the same `Provider` as the Chart:

```tsx
<m.Provider connector={connector}>
  <IntentBar />
  <m.Chart style={{ height: '100vh' }} />
</m.Provider>
```

`processIntent("show me the greeting bigger")` goes to the engine; the engine
answers with layout and actions; the Chart re-flows. Learn more in the
[Error Handling docs](https://docs.maelstrom-ai.co/guides/react/error-handling/).

## How It Works

```mermaid
flowchart LR
  intent["User intent"] --> client["client"]
  client -->|"state + layout context"| engine["engine (LLM)"]
  engine -->|"layout + execution plan"| client
  client --> react["react bindings"]
  react --> chart["&lt;Chart /&gt; — your Vessels"]
  chart -.->|"ResizeObserver: container changed"| client
```

The engine holds no layout state: it receives the current state and returns where
things go and what to invoke. In grid mode, it receives Chart dimensions in cells
and returns positions and sizes. In tiling mode — the default — it receives the
current split tree and returns an updated tree; the client fits that structure to
the measured container.

Conversation history is opt-in — pass `history: { store }` to `createEngine` and
prior turns ride along in the prompt; leave it out and every request stands alone.
`protocol` gives every package the same TypeScript types and the zod schemas that
validate what actually crosses the wire — a malformed or incompatible message
gets rejected at runtime, where engine and client, built and deployed separately,
actually meet.

Applying a response re-renders the UI, the Chart measures itself, and a changed
container size schedules the next request — that observer is what closes the
loop.

## How Maelstrom Compares

Maelstrom's specific focus is **AI-directed spatial layout over your pre-built,
stateful components**. Tambo and CopilotKit can render or update application
components outside a chat thread, but they do not provide Maelstrom's built-in
tiling and grid placement model. LangGraph, AG-UI, and the Vercel AI SDK are
substrate rather than competition: Maelstrom is the layout layer their output can
drive. The comparison docs carry the full tables and
[where Maelstrom is the wrong tool](https://docs.maelstrom-ai.co/understanding/comparison/#where-maelstrom-is-the-wrong-tool).

## Packages

| Package | Use it for |
| --- | --- |
| [`@maelstrom-co/react`](https://docs.maelstrom-ai.co/reference/react/readme/) | React bindings: `createMaelstrom`, `vessel`, Provider, Chart, hooks |
| [`@maelstrom-co/client`](https://docs.maelstrom-ai.co/reference/client/readme/) | Framework-agnostic orchestrator, connectors, and layout |
| [`@maelstrom-co/engine`](https://docs.maelstrom-ai.co/reference/engine/readme/) | The LLM decision core, built on TanStack AI |
| [`@maelstrom-co/protocol`](https://docs.maelstrom-ai.co/reference/protocol/readme/) | Shared types, zod schemas, and the message contract |

Voice is opt-in and ships separately. Start with
[Run the voice demo locally](https://docs.maelstrom-ai.co/tutorials/run-voice-locally/) —
one API key, one command — then the
[voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/) to pick a
mode, and [the voice boundary](https://docs.maelstrom-ai.co/understanding/voice-architecture/)
for why a voice model never plans your UI.

## Get Involved

- Read the [docs](https://docs.maelstrom-ai.co).
- Run the demo — see [`apps/demo/README.md`](./apps/demo/README.md) for local
  setup, including optional LiveKit voice.
- See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions.
- [Report a bug](https://github.com/maelstrom-co/maelstrom/issues/new?template=bug_report.yml)
  or [share feedback and request capabilities](https://github.com/maelstrom-co/maelstrom/issues/new?template=feedback.yml).
- Read the [security policy](./SECURITY.md) and
  [Code of Conduct](./CODE_OF_CONDUCT.md).
- Follow [@maelstrom_co](https://x.com/maelstrom_co) for what we're building.

MIT licensed — see [LICENSE](./LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=maelstrom-co/maelstrom&type=Date)](https://star-history.com/#maelstrom-co/maelstrom&Date)
