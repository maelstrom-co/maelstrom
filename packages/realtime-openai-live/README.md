# @maelstrom-co/realtime-openai-live

Browser WebRTC transport and Maelstrom UI tool integration for OpenAI Live.

## Entry points

- `OpenAILiveAdapter` connects managed Live Responses to `RealtimeSession`.
  It handles UI tool results and grounding, and exposes continuous transcript
  and media observations without treating fragments as completed turns.
- `OpenAILiveTransport` provides the WebRTC lifecycle and provider observations
  without the Maelstrom UI tool integration. It does not reconnect automatically
  or replay commands.
- `OpenAILiveAdapterOptions`, `LiveTransportOptions`, and
  `LiveTransportSnapshot` describe configuration and retained transport state.

Both implementations receive a host-owned `exchange` callback for the SDP
exchange. The companion `@maelstrom-co/realtime-openai-live-server` package
performs the upstream exchange with a server-held OpenAI key. Never pass an
application-owned provider key to the browser. The demo's visitor-owned-key
mode is a separate explicit custody choice, not a deployment default.

Shared wire types and schemas live at
`@maelstrom-co/realtime-protocol/openai-live`.

## Connect from the browser

Install matching versions of `@maelstrom-co/realtime-openai-live`,
`@maelstrom-co/realtime-protocol`, `@maelstrom-co/realtime`,
`@maelstrom-co/react-realtime`, and `@maelstrom-co/react`. Implement the
[server route](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/#server-route)
first; this callback sends no provider key.

```ts
import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import {
  LiveExchangeResponseSchema,
  type LiveSessionExchange,
} from '@maelstrom-co/realtime-protocol/openai-live';

const exchange: LiveSessionExchange = async (offer, signal) => {
  const response = await fetch('/api/live-session', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(offer),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (response.status !== 201) throw new Error('Live exchange failed');
  return LiveExchangeResponseSchema.parse(await response.json());
};

export const m = createMaelstrom({ vessels: [] }).with(
  maelstromRealtime({
    createAdapter: () => new OpenAILiveAdapter({
      model: 'gpt-live-1',
      responses: { model: 'gpt-6-luna' },
      exchange,
    }),
    generatedOpening: { instructions: 'In English, introduce yourself.' },
  }),
);
```

Replace the empty registry with your Vessel entries and mount `m.Provider` with
your existing Engine connector and `m.Chart`. Inside that Provider, render
`m.VoiceOrb`, or read `connect` from `m.useVoice()` during render and call that
function from a user gesture. Observe its
`state` and `error`; a ready transport does not prove an Engine update or audible
speech. Use `m.useVoiceObservations()` for timestamped evidence, not completed
turns. Requires a secure context, microphone permission, and access to both models.

The host route must authorize the session configuration, not merely validate its
shape. Do not retry session creation automatically: an aborted exchange may
already have created a paid session. Continue with the
[Live setup, opening, and recovery guide](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/).

## Inspect projected provider diagnostics

The adapter and transport expose an optional `diagnostics` feed. Subscribing
observes subsequent projected native receipts and successful sends. It does not
connect the transport or acquire media. Diagnostic observer failures remain
separate from transport errors.

Metadata includes allowlisted envelope names, opaque correlation IDs, semantic
context tags, and `providerGeneration`. It excludes instructions, configuration,
arguments, and audio. Supported intent content stays behind `readContent` and
requires explicit recording. Application redaction still applies to recorded data.

React realtime forwards the feed to its owning client automatically. Other
integrations use `attachRealtimeDiagnostics` from `@maelstrom-co/realtime`.
DevTools displays these observations under `voice.provider.*`.

The adapter tags UI and recovery context at the send site. It does not infer
meaning or snapshot revisions from grounding text. Native provider generation
and realtime session generation are independent counters.

## License

[MIT](./LICENSE)
