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
- `mintFailureHttpStatus` — a suggested `MintFailureReason -> HTTP status`
  mapping for transports that don't want to hand-roll one. Optional: this
  package stays transport-agnostic, so nothing requires using it.

## Quick example

```ts
import { isOk } from '@maelstrom-co/protocol';
import {
  createOpenAIMinter,
  mintFailureHttpStatus,
} from '@maelstrom-co/realtime-server';

const mint = createOpenAIMinter({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-2',
});

// Authenticating the caller, deriving `sessionId` from trusted server state,
// and choosing an allowed model are all your transport's job — this package
// does none of them. Never take either value from the request body.
declare const sessionId: string;
declare const model: string;

const result = await mint({ provider: 'openai', sessionId, model });

const response = isOk(result)
  ? Response.json(result.value)
  : Response.json(
      { error: 'mint-failed' },
      { status: mintFailureHttpStatus(result.error.reason) },
    );
```

That call is the whole package surface. Everything that makes it safe to expose
— origin allowlist, CSRF, rate limits, server-derived model policy, no-store
headers, redacted telemetry — belongs to the route around it, and is worked
through step by step in the
[OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/#harden-the-mint-route).

Never return or log `MintFailureReason`, credential diagnostics, raw
exceptions, request bodies, or session data. `mintFailureHttpStatus` maps only
the HTTP status.

OpenAI recommends an `OpenAI-Safety-Identifier` header for client-secret
creation. `createOpenAIMinter` does not currently expose a public
upstream-header option, so adding that support remains a follow-up.

## Docs

- OpenAI Realtime guide: https://docs.maelstrom-ai.co/guides/voice/openai-realtime/
- Package API reference: https://docs.maelstrom-ai.co/reference/realtime-server/readme/
- OpenAI Realtime WebRTC docs: https://platform.openai.com/docs/guides/realtime-webrtc
- OpenAI Realtime API docs: https://platform.openai.com/docs/guides/realtime

## License

MIT
