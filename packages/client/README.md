# @maelstrom-co/client

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Framework-agnostic client core for Maelstrom.

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/client/readme/>

## Install

```bash
bun add @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/client @maelstrom-co/protocol`

## What it does

- **Orchestrator** — applies layout then executes actions — see [Core Concepts](https://docs.maelstrom-ai.co/getting-started/core-concepts/) for the full pipeline
- **Vessel registry** — registers vessel definitions so the engine knows what components are available
- **Chart Manager** — tracks grid dimensions and applies engine layout directives as CSS positioning
- **Connectors** — transport-agnostic contract:
  - `WebSocketConnector` — for the Maelstrom WebSocket engine
  - `HttpConnector` — for request/response flows

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

Both calls reject on transport or LLM errors — wrap in try/catch in real apps.

## Operational telemetry

`attachClientTelemetry(orchestrator, telemetry)` observes local request, atomic
application, and Action outcomes through `@maelstrom-co/telemetry`. Attach before
connecting. It enables neither remote Engine diagnostics nor content capture.
The attachment returns `{ release, drained }`. Stop producing work, release every
attachment, and await its drain before the final application-owned flush and disposal.
Repeated attachments share one subscription
until their last release. Omitted or disabled telemetry does not subscribe.

Use `DiagnosticChannel.diagnosticsObserved` and `addDiagnosticSource` for full
diagnostics. The deprecated `observed` and `addSource` aliases retain those
semantics. `locallyObserved` includes metadata and full diagnostic consumers;
`addLocalSource` starts local producer work for either kind of consumer.
Forwarded Engine and attached voice evidence use `emitDiagnostic` and never
notify local metadata subscribers.

Cancellation reported by a structured connector remains separate from failure.
Application duration uses the local command-start and settlement boundaries;
it does not prove browser paint. Unknown classifications stay unknown.
`ConnectorError` supplies explicit cancellation, transport, timeout, or
invalid-response provenance. Error names alone do not establish cancellation. HTTP error status alone leaves the failure category unknown.
Disposal cancels pending requests; only received responses can count as discarded
applications.
See the [telemetry package](../telemetry/README.md) for the sink contract and limits.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/
- Client guides: https://docs.maelstrom-ai.co/guides/client/custom-connectors/
- Optional DevTools: [attach a framework-independent collector](https://docs.maelstrom-ai.co/guides/devtools/#use-the-core-without-react) with `@maelstrom-co/devtools` before connecting the Orchestrator.
- API reference: https://docs.maelstrom-ai.co/reference/client/readme/

## License

MIT
