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

- `createOpenAIMinter` — a transport-agnostic `(input: unknown) => Promise<MintResult>`
  that exchanges a server-held `OPENAI_API_KEY` for a short-lived client
  secret via OpenAI's `client_secrets` endpoint, so the browser never sees
  the long-lived key. `input` is the already-parsed request body; wiring it
  into an HTTP route (method checks, JSON parsing, status codes) is your
  transport's job.

## Quick example

```ts
import { createOpenAIMinter, type MintFailureReason } from '@maelstrom-co/realtime-server';

const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-realtime-2',
});

const STATUS: Record<MintFailureReason, number> = {
  'invalid-request': 400,
  'unsupported-provider': 400,
  'missing-api-key': 500,
  'upstream-failure': 502,
};

// Wire into your framework of choice, e.g. a Request/Response fetch route.
export async function POST(req: Request): Promise<Response> {
  const result = await mint(await req.json());
  if (result.ok) return Response.json(result.response);
  return Response.json({ error: result.reason }, { status: STATUS[result.reason] });
}
```

This mint operation is an unauthenticated bootstrap by design — see the
`createOpenAIMinter` JSDoc for what a real deployment must add.

## Docs

- Client guides: https://docs.maelstrom-ai.co/guides/client/custom-connectors/
- API reference: https://docs.maelstrom-ai.co/reference/client/

## License

MIT
