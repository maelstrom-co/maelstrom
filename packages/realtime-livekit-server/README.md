# @maelstrom-co/realtime-livekit-server

Server-only handler for minting LiveKit room access tokens.

The server sibling of `@maelstrom-co/realtime-livekit`: the browser package
declares the `LiveKitTokenGrant` contract the adapter consumes, and this
package implements it. It is the only side that touches
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and it never ships to the browser.

## Install

```bash
bun add @maelstrom-co/realtime-livekit-server @maelstrom-co/realtime-livekit
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-livekit-server @maelstrom-co/realtime-livekit`

## What it does

- `mintLiveKitToken` — a `(input: unknown) => Promise<LiveKitMintResult>` that
  signs a LiveKit room JWT scoped to a room + identity, reading credentials
  and the token TTL from `LIVEKIT_*` env vars. Request validation is in-package
  (the trust boundary lives with the minter); the returned grant carries
  `expiresAt` so the browser can refresh proactively.
- `mintFailureHttpStatus` — a suggested `MintFailureReason -> HTTP status`
  mapping, re-exported from `@maelstrom-co/realtime` for callers wiring the
  minter into an HTTP transport.

## Quick example

```ts
import { createServerFn } from '@tanstack/react-start';
import { isErr } from '@maelstrom-co/protocol';
import { mintLiveKitToken } from '@maelstrom-co/realtime-livekit-server';

// Wire into a TanStack Start server fn, or any framework of choice:
export const getLivekitToken = createServerFn({ method: 'GET' })
  .inputValidator((d: unknown) => d)
  .handler(async ({ data }) => {
    const result = await mintLiveKitToken(data);
    if (isErr(result)) throw new Error(result.error.reason);
    return result.value;
  });
```

`mintLiveKitToken` validates request shape only — it performs no authentication
or authorization. The example above forwards client-supplied `roomName` and
`identity` straight through, which is fine for a local demo or spike but not
for production: a real deployment must authenticate the request first, then
derive or allowlist `roomName`/`identity` server-side from trusted session
state rather than forwarding raw client input, since a minted grant lets its
holder join, publish, and subscribe in the named room.

## Docs

- Client guides: https://docs.maelstrom-ai.co/guides/client/custom-connectors/
- API reference: https://docs.maelstrom-ai.co/reference/client/

## License

MIT
