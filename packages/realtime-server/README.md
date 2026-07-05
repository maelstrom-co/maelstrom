# @maelstrom-co/realtime-server

Server-only handlers for minting ephemeral realtime provider credentials.

This is the only Maelstrom package that touches raw provider API keys
(e.g. `OPENAI_API_KEY`). It never ships to the browser.

## Install

```bash
bun add @maelstrom-co/realtime-server @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-server @maelstrom-co/protocol`

## What it does

- `createOpenAiMintHandler` — a framework-agnostic `(Request) => Promise<Response>`
  that exchanges a server-held `OPENAI_API_KEY` for a short-lived client
  secret via OpenAI's `client_secrets` endpoint, so the browser never sees
  the long-lived key.

## Quick example

```ts
import { createOpenAiMintHandler } from '@maelstrom-co/realtime-server';

const handler = createOpenAiMintHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-realtime-2',
});

// Wire into your framework of choice, e.g. a Request/Response fetch handler.
export const POST = handler;
```

This mint endpoint is an unauthenticated bootstrap by design — see the
`createOpenAiMintHandler` JSDoc for what a real deployment must add.

## Docs

- Client guides: https://docs.maelstrom-ai.co/guides/client/custom-connectors/
- API reference: https://docs.maelstrom-ai.co/reference/client/

## License

MIT
