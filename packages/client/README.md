# @maelstrom-co/client

Framework-agnostic client core for Maelstrom.

## Install

```bash
bun add @maelstrom-co/client
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/client`

## What it does

- **Orchestrator** — coordinates intent submission, engine responses, and the execution order (actions → sizes → layout → overflow)
- **Vessel registry** — registers vessel definitions so the engine knows what components are available
- **Chart Manager** — tracks grid dimensions and translates engine layout directives into CSS transforms
- **Connectors** — transport-agnostic contract; ships with `WebSocketConnector` and `VoiceWebSocketConnector` for the Maelstrom engine, and `HttpConnector` for request/response flows

## Quick example

```ts
import { Orchestrator, WebSocketConnector } from '@maelstrom-co/client';
import { defineVessel } from '@maelstrom-co/protocol';

const greetingDefinition = defineVessel({
  id: 'greeting',
  name: 'Greeting',
  description: 'Displays a greeting message to the user.',
  defaultVariant: 'compact',
  variants: {
    compact: {
      description: 'Short one-line greeting',
      props: { message: 'Hello!' },
      minSize: { width: 2, height: 1 },
      actions: [],
    },
  },
});

const connector = new WebSocketConnector({ url: 'ws://localhost:3001/ws' });
const orchestrator = new Orchestrator(connector);

orchestrator.vesselManager.registerVessel(greetingDefinition);
orchestrator.chartManager.setDimensions({ columns: 12, rows: 8 });

await orchestrator.connect();
await orchestrator.processIntent('show me a greeting');
```

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/
- Client guides: https://docs.maelstrom-ai.co/guides/client/custom-connectors/
- API reference: https://docs.maelstrom-ai.co/reference/client/

## License

MIT
