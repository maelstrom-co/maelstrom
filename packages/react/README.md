# @maelstrom-co/react

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

React bindings for building intent-driven apps with Maelstrom.

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/react/readme/>

## Install

```bash
bun add @maelstrom-co/react
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/react`

## What it does

- **`createMaelstrom({ vessels })`** — factory that returns a typed Maelstrom instance — see bullets below for what it exposes
- **`defineVessel(config)`** — declares the framework-agnostic vessel state machine
- **`vessel(definition, component | loader, loadingComponent?)`** — pairs a vessel definition with a React component; `loadingComponent` is only used when a lazy loader is passed
- **`WebSocketConnector` / `HttpConnector`** — client connectors re-exported for React apps
- **`m.Provider`** — connects to the engine and owns all chart state; accepts any `EngineConnector`
- **`m.Chart`** — renders the grid canvas; the engine emits layout directives that Chart renders as CSS positioning
- **Hooks**
  - `useMaelstrom` — intent submission and connection status
  - `useVessel` and `useActions` — vessel-level state
  - `useInstance` — raw access to the Maelstrom instance
  - `useAgentRun` and `useAgentEvent` — Agent Run state and raw agent events
- **`.with(extension)`** — builder for optional extensions

## Quick example

```tsx
import { createMaelstrom, defineVessel, vessel, WebSocketConnector } from '@maelstrom-co/react';

const greetingVessel = vessel(
  defineVessel({
    id: 'greeting',
    name: 'Greeting',
    description: 'Displays a greeting message.',
    defaultVariant: 'compact',
    variants: {
      compact: {
        description: 'One-line greeting',
        props: { message: 'Hello!' },
        minSize: { width: 2, height: 1 },
        actions: [],
      },
    },
  }),
  ({ variantProps }) => <div>{variantProps.message}</div>
);

const m = createMaelstrom({ vessels: [greetingVessel] });
const connector = new WebSocketConnector({ url: 'ws://localhost:3001/ws' });

export function App() {
  return (
    <m.Provider connector={connector}>
      <m.Chart className="h-screen" />
    </m.Provider>
  );
}
```

## Rendering an Agent Run

`m.useAgentRun()` returns the run of the latest input and a stable `sendMessage`. Branch on `run.status` to render each stage.

```tsx
function AgentReply() {
  const { run, sendMessage } = m.useAgentRun();

  return (
    <section>
      <button onClick={() => void sendMessage('show my last order')}>Ask</button>
      {run?.status === 'working' && <p>{run.placeholder ?? 'Working...'}</p>}
      {(run?.status === 'streaming' || run?.status === 'finished') && <p>{run.reply}</p>}
      {run?.status === 'lost' && <p>Connection lost. Try again.</p>}
      {run?.status === 'failed' && <p role="alert">{run.error?.message}</p>}
    </section>
  );
}
```

To follow raw agent events such as `ui_change` or `finished`, call `m.useAgentEvent(type, handler)`.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/
- React guides: https://docs.maelstrom-ai.co/guides/react/creating-vessels/
- Optional DevTools: [inspect requests, layouts, voice events, and recordings](https://docs.maelstrom-ai.co/guides/devtools/) with `@maelstrom-co/react-devtools`.
- API reference: https://docs.maelstrom-ai.co/reference/react/readme/

## License

MIT
