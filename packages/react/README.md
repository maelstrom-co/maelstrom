# @maelstrom-co/react

React bindings for Maelstrom — AI-orchestrated dynamic UIs.

## Install

```bash
bun add @maelstrom-co/react @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/react @maelstrom-co/client @maelstrom-co/protocol`

## What it does

- **`createMaelstrom({ vessels })`** — factory that returns a fully-typed `{ Provider, Chart, useMaelstrom, useVessel, useActions, useInstance, registerVessel, with }` instance
- **`vessel(definition, component, skeleton?)`** — pairs a vessel definition with a React component; supports lazy imports for code splitting
- **`m.Provider`** — connects to the engine and owns all chart state; accepts any `EngineConnector`
- **`m.Chart`** — renders the grid canvas; the engine positions vessels here via CSS transforms
- **Hooks** — `useMaelstrom` for intent submission and connection status; `useVessel` and `useActions` for vessel-level state; `useInstance` for raw access
- **`.with(extension)`** — builder for optional extensions (e.g. `maelstromVoice()` from `@maelstrom-co/react-voice`)

## Quick example

```tsx
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import { WebSocketConnector } from '@maelstrom-co/client';
import { greetingVessel } from './vessels/greeting'; // see Quick Start for full definition

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
- API reference: https://docs.maelstrom-ai.co/reference/react/

## License

MIT
