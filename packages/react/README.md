# @maelstrom-co/react

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

React bindings for Maelstrom — AI-orchestrated dynamic UIs.

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

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/
- React guides: https://docs.maelstrom-ai.co/guides/react/creating-vessels/
- API reference: https://docs.maelstrom-ai.co/reference/react/readme/

## License

MIT
