# @maelstrom-co/realtime-livekit-server

Server-only handler for minting LiveKit room access tokens.

The server sibling of `@maelstrom-co/realtime-livekit`:
`@maelstrom-co/realtime-protocol` owns the shared LiveKit grant and mint-failure
contracts, and this package implements the token minter. This package and the
agent worker both read `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`; the browser
gets a scoped, short-lived grant whose token exposes the API key as its public
issuer. The signing secret never ships to the browser.

## Install

```bash
bun add @maelstrom-co/realtime-livekit-server
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-livekit-server`

Do not install `@maelstrom-co/realtime-livekit` here. That is the browser
adapter; it carries the LiveKit WebRTC peer surface and the browser VAD
runtime. This package reaches the shared contract through
`@maelstrom-co/realtime-protocol/livekit` instead, which is what keeps the
process holding `LIVEKIT_API_SECRET` free of browser code.

## What it does

- `mintLiveKitToken` — a `(input: unknown) => Promise<LiveKitMintResult>` that
  signs a LiveKit room JWT scoped to a room + identity, reading credentials
  and the token TTL from `LIVEKIT_*` env vars. The minter owns only request
  shape validation and local provider interaction; application transport owns
  authentication, authorization, CSRF, origin checks, shared rate limits, and
  trusted room scope. The returned grant carries
  `expiresAt`. Token expiry is checked for each initial or fresh room connection,
  including an explicit `connect()` after `disconnect()`. It does not impact
  SDK-managed reconnects for an already connected participant because LiveKit
  pushes refreshed tokens to connected clients, and the SDK uses the refreshed
  token for managed reconnects. Expiry alone does not disconnect an active
  participant or end the room. Each fresh `connect()` invokes `mintToken`.
- `mintFailureHttpStatus` — a suggested `MintFailureReason -> HTTP status`
  mapping that this package provides by re-exporting it from
  `@maelstrom-co/realtime-protocol` for callers wiring the minter into an HTTP
  transport.

## Quick example

```ts
import { isErr } from '@maelstrom-co/protocol';
import {
  mintLiveKitToken,
  LiveKitTokenRequestSchema,
} from '@maelstrom-co/realtime-livekit-server';

// Room name and participant identity come from authenticated server policy,
// never from the browser. This package signs the scope it is handed; it does
// not decide who may ask for one.
const result = await mintLiveKitToken({
  roomName: authenticated.roomName,
  identity: authenticated.identity,
});

const response = isErr(result)
  ? Response.json({ error: 'mint-failed' }, { status: 500 })
  : Response.json(result.value);
```

`LiveKitTokenRequestSchema` validates the shape of a mint request when your
transport needs it. The grant carries `roomJoin` for that one room,
`canPublish`, and `canSubscribe` — no room administration, recording, ingress,
or egress.

Everything that makes this route safe to expose — authentication, origin and
CSRF checks, rate limits, short token lifetimes, session duration limits,
no-store headers, redacted telemetry — belongs to the route around it, and is
worked through step by step in the
[LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/#harden-the-mint-route).

The server process requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
`LIVEKIT_API_SECRET`. `LIVEKIT_TOKEN_TTL` is optional and defaults to `15m`.
Token TTL does not bound a session: LiveKit pushes refreshed tokens to
connected participants, so expiry only affects new connections.

> **Development-only demo route:** The repository demo mint route at
> `apps/demo/src/lib/voice/get-livekit-token.ts` currently lacks production
> authentication, trusted scope derivation, and explicit no-store cache headers.
> Do not deploy it; use the hardened route from the guide above.


## Docs

- Production guide: https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/
- Voice overview: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime-livekit-server/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/
- LiveKit token generation: https://docs.livekit.io/home/server/generating-tokens/
- LiveKit voice AI worker guide: https://docs.livekit.io/agents/start/voice-ai/

## License

MIT
