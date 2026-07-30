# `@maelstrom-co/realtime-livekit`

Browser adapter for Maelstrom’s LiveKit cascade voice transport.

The package implements `RealtimeProviderAdapter` from `@maelstrom-co/realtime` using:

* LiveKit for browser-to-worker audio transport
* Deepgram for worker-side speech-to-text
* Cartesia for worker-side text-to-speech
* Maelstrom’s existing Engine path for intent planning

The LiveKit worker contains no conversational or planning LLM. Every final transcript becomes ordinary natural-language intent and passes through the same `RealtimeSession`, Maelstrom client, and Engine path used by other voice transports.

The package is separate from `@maelstrom-co/realtime` so applications that do not use LiveKit do not receive `livekit-client` in their browser bundle.

## Architecture

```text
Browser                              LiveKit worker
┌─────────────────────────────┐      ┌──────────────────────────┐
│ LiveKitAdapter              │      │ Deepgram STT             │
│                             │      │                          │
│ microphone ─────────────────┼─────►│ final transcript         │
│                             │◄─────┼──────────────────────────│
│ final transcript            │      │                          │
│        │                    │      │ Cartesia TTS             │
│        ▼                    │      │                          │
│ RealtimeSession             │─────►│ settled response text    │
│        │                    │◄─────┼ synthesized audio        │
│        ▼                    │      └──────────────────────────┘
│ Maelstrom client + Engine   │
└─────────────────────────────┘
```

A complete voice turn works as follows:

1. The user starts a hold-to-talk turn.
2. `LiveKitAdapter` unmutes the published microphone.
3. The worker transcribes the microphone audio with Deepgram.
4. The user ends the turn.
5. The adapter mutes the microphone and tells the worker to flush its STT buffer.
6. The worker publishes the final transcript.
7. The adapter converts the transcript into an `update_ui` tool call.
8. `RealtimeSession` submits the natural-language intent through the normal Maelstrom client and Engine path.
9. The client applies the Engine result and waits for rendering to settle.
10. The adapter sends the Engine’s `userMessage`, or the settled structural summary fallback, to the worker.
11. The worker synthesizes the response with Cartesia and publishes the audio back to the browser.

Successful speech therefore starts only after the corresponding UI update has settled.

## Install

Install the adapter and its LiveKit peer dependency:

```bash
bun add @maelstrom-co/realtime-livekit livekit-client
```

Equivalent commands:

```bash
npm install @maelstrom-co/realtime-livekit livekit-client
pnpm add @maelstrom-co/realtime-livekit livekit-client
yarn add @maelstrom-co/realtime-livekit livekit-client
```

A complete React integration normally also uses:

```bash
bun add \
  @maelstrom-co/react-realtime \
  @maelstrom-co/realtime-livekit-server \
  @maelstrom-co/realtime-livekit-agent
```

## Package roles

The LiveKit cascade is split across three runtime packages:

| Package                                 | Runtime             | Responsibility                                                                                                   |
| --------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@maelstrom-co/realtime-livekit`        | Browser             | Room connection, microphone publication, transcript-to-intent conversion, hold-to-talk control, and TTS playback |
| `@maelstrom-co/realtime-livekit-server` | Application server  | Signs short-lived LiveKit room tokens                                                                            |
| `@maelstrom-co/realtime-livekit-agent`  | Long-running worker | Runs Deepgram STT and Cartesia TTS                                                                               |

The browser package never reads LiveKit signing credentials, Deepgram credentials, or Cartesia credentials.

## Create the browser adapter

Create one `LiveKitAdapter` for each Maelstrom voice session:

```ts
import {
  LiveKitAdapter,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit';

async function fetchLiveKitToken(): Promise<
  ReturnType<typeof LiveKitTokenGrantSchema.parse>
> {
  const response = await fetch('/api/livekit-token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-CSRF-Token': getCsrfToken(),
    },
  });

  if (!response.ok) {
    throw new Error(
      `LiveKit token mint failed with status ${response.status}`,
    );
  }

  return LiveKitTokenGrantSchema.parse(await response.json());
}

const adapter = new LiveKitAdapter({
  roomName: `maelstrom-${sessionId}`,
  mintToken: async (_roomName) => fetchLiveKitToken(),
});
```

`roomName` should be stable for the lifetime of the voice session so an explicit reconnect can rejoin the same room.

The server must independently derive and authorize the room represented by the returned token. Do not trust browser-provided room names or participant identities as authorization input.

### Constructor options

```ts
interface LiveKitAdapterOptions {
  readonly roomName: string;

  readonly mintToken: (
    roomName: string,
  ) => Promise<LiveKitTokenGrant>;

  readonly debug?: boolean;

  readonly thinkingFallbackMs?: number;
}
```

#### `roomName`

The LiveKit room the browser joins.

Use a unique, stable name for each voice session. The room granted by the server-issued token must match this value.

#### `mintToken`

Called each time a fresh `connect()` begins.

The callback must return:

```ts
interface LiveKitTokenGrant {
  readonly token: string;
  readonly url: string;
  readonly expiresAt: number;
}
```

The adapter consumes `token` and `url` when joining the room.

`expiresAt` describes when the token stops being valid for a fresh connection. The adapter does not schedule proactive token renewal from this value. LiveKit manages token refresh for an already connected participant.

#### `debug`

Enables adapter debug logging.

Default: `false`

Do not enable verbose client logs in production unless the application’s telemetry and redaction policy has been reviewed.

#### `thinkingFallbackMs`

Maximum time the adapter remains in `thinking` after an empty hold-to-talk turn that produces no transcript or worker response.

Default: `10000`

Set it to `0` to disable the fallback.

A real transcript, TTS signal, barge-in, or disconnect cancels the pending fallback.

## Connect through `RealtimeSession`

The adapter can be used directly with `RealtimeSession`:

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  roomName: `maelstrom-${sessionId}`,
  mintToken: async () => fetchLiveKitToken(),
});

const session = new RealtimeSession({
  adapter,
  instance,
  sessionId,
});

await session.connect();
```

`RealtimeSession` remains responsible for:

* Tool routing
* Intent submission
* Waiting for rendered UI settlement
* Barge-in queueing
* Transcript and state handling
* Sidechannel events
* Structural result summaries

`LiveKitAdapter` remains responsible for:

* LiveKit room lifecycle
* Microphone publication
* Explicit turn boundaries
* Transcript conversion
* Worker speech requests
* Audio playback
* Transport-specific failures

## React integration

With `@maelstrom-co/react-realtime`, provide the adapter through `maelstromRealtime`:

```tsx
import { createMaelstrom } from '@maelstrom-co/react';
import {
  maelstromRealtime,
  type CreateAdapterContext,
} from '@maelstrom-co/react-realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

function createLiveKitAdapter({
  sessionId,
}: CreateAdapterContext): LiveKitAdapter {
  return new LiveKitAdapter({
    roomName: `maelstrom-${sessionId}`,
    mintToken: async () => fetchLiveKitToken(),
  });
}

export const m = createMaelstrom({
  vessels,
}).with(
  maelstromRealtime({
    createAdapter: createLiveKitAdapter,
  }),
);
```

Components under the same Maelstrom Orchestrator share one realtime session.

## Hold-to-talk controls

The LiveKit cascade exposes explicit turn controls:

```ts
await adapter.turnControl.startTurn();

try {
  await waitForUserRelease();
} finally {
  await adapter.turnControl.endTurn();
}
```

`startTurn()`:

* Cancels any empty-turn fallback.
* Sends a best-effort TTS cancellation when the assistant is speaking.
* Unmutes the microphone.
* Emits `speech_started`.
* Moves the session to `listening`.

`endTurn()`:

* Mutes the microphone.
* Sends a `turn_end` signal to the worker.
* Moves the session to `thinking`.
* Starts the empty-turn fallback.

When using the React binding, obtain the same capability from `useVoice()`:

```tsx
function HoldToTalkButton() {
  const { state, turnControl } = m.useVoice();

  if (!turnControl) {
    return null;
  }

  return (
    <button
      disabled={state === 'connecting' || state === 'error'}
      onPointerDown={() => {
        void turnControl.startTurn();
      }}
      onPointerUp={() => {
        void turnControl.endTurn();
      }}
      onPointerCancel={() => {
        void turnControl.endTurn();
      }}
    >
      Hold to talk
    </button>
  );
}
```

Render hold-to-talk controls based on the presence of `turnControl`, not by checking a provider name.

Speech-native adapters may not expose this capability.

## Transcript handling

The worker publishes final STT transcript segments through LiveKit.

For each non-empty final transcript, `LiveKitAdapter` emits:

1. A provider-neutral user transcript event.
2. A synthesized `update_ui` tool call containing the transcript as natural-language intent.

The adapter does not construct a Chart request and does not select Vessels, Instances, Variants, Actions, or layout coordinates.

The Maelstrom client captures the current UI state when the intent is submitted. That client-built snapshot remains the Engine’s planning truth.

## Spoken responses

When `RealtimeSession` returns a successful tool result, the adapter selects speech text in this order:

1. The Engine’s `userMessage`
2. The settled structural `summary`
3. A serialized representation of the result as a final fallback

The text is sent to the worker on the shared `speak` stream.

The adapter enters `speaking` when the request is handed to the worker. It returns to `connected` when the worker reports that playback has completed, rather than immediately after the text is sent.

A TTS send or synthesis failure is non-fatal to the already-applied UI operation. The adapter leaves the speaking state and reports the audio failure separately.

## Barge-in

Starting another turn while TTS is playing sends a best-effort cancellation signal to the worker before the microphone is reopened.

The worker stops the active Cartesia stream and clears queued playback audio.

Cancellation is correlated with the current utterance so a late completion signal from cancelled speech does not move the new turn into an incorrect state.

Failure to publish the cancellation signal does not block the user’s new turn. In the worst case, stale assistant audio may continue playing while the new turn begins.

## Audio streams

The adapter exposes microphone and playback streams for metering or visualization:

```ts
const { mic, playback } = adapter.getAudioStreams();
```

Both values are optional:

* `mic` becomes available after the microphone publication is created.
* `playback` becomes available after the worker’s audio track is subscribed.
* Both are unavailable before connection and after disconnection.

The microphone stream remains stable across hold-to-talk turns because the same publication is muted and unmuted rather than recreated.

## Audio playback permission

Some browsers require a user gesture before remote audio can play.

After an appropriate user interaction, unlock LiveKit playback with:

```ts
await adapter.enableAudio();
```

`enableAudio()` is a concrete `LiveKitAdapter` helper and is not part of the provider-neutral adapter contract.

Applications should call it from a user gesture when automatic playback is blocked.

## Grounding behavior

The adapter’s grounding hook is intentionally a no-op.

The worker has no conversational LLM and therefore receives no:

* Chart snapshot
* Vessel descriptions
* Capability snapshot
* UI grounding prompt
* Planning instructions

The Engine still receives current client-owned planning context through the normal Maelstrom intent path.

Do not move UI planning into the speech worker.

## Token validation without the browser SDK

The `/token` entry point exports the LiveKit grant contract without loading the LiveKit browser transport:

```ts
import {
  LiveKitTokenGrantSchema,
  type LiveKitTokenGrant,
} from '@maelstrom-co/realtime-livekit/token';

const grant: LiveKitTokenGrant =
  LiveKitTokenGrantSchema.parse(await response.json());
```

The schema requires:

* A non-empty token
* A `ws:` or `wss:` LiveKit URL
* An absolute Unix expiry in seconds

Use this entry point in server-adjacent or shared token-fetching code where importing `livekit-client` is unnecessary.

## Wire protocol

The browser adapter and worker share protocol constants through:

```ts
import {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TTS_TOPIC,
  TURN_TOPIC,
  USER_PARTICIPANT_IDENTITY,
} from '@maelstrom-co/realtime-livekit/protocol';
```

The protocol includes:

* `turn_end` — flush the current STT turn
* `tts_cancel` — stop active assistant speech
* `tts_done` — synthesized audio finished playing
* `tts_error` — synthesis or playback failed
* Monotonic utterance IDs for rejecting stale TTS status

Applications normally should not publish these messages directly. Use `LiveKitAdapter` unless implementing a custom worker or transport integration.

## Server requirements

The token endpoint should use `@maelstrom-co/realtime-livekit-server` and must add application-specific security controls.

A production endpoint must:

* Authenticate the caller
* Authorize access to voice
* Derive room and participant scope from trusted server state
* Validate CSRF protection
* Enforce an exact origin allowlist
* Apply a shared principal-based rate limit
* Return `Cache-Control: private, no-store`
* Expose generic browser errors
* Keep credential and token details out of logs
* Keep `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` server-only

The repository demo token route is intended only for local development and must not be deployed as a production authorization boundary.

## Worker requirements

Run `@maelstrom-co/realtime-livekit-agent` as a long-lived process separate from the application server.

The worker requires:

```dotenv
LIVEKIT_URL=wss://your-livekit-host
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret

DEEPGRAM_API_KEY=your-deepgram-api-key
CARTESIA_API_KEY=your-cartesia-api-key
```

The worker owns speech processing only. The browser remains responsible for routing final transcripts through `RealtimeSession`.

## Failure behavior

Connection-level failures are fatal to the voice session and may include:

* Token mint failure
* LiveKit room connection failure
* Microphone publication failure
* Unexpected room disconnection
* Failure to send the required turn-end signal

Speech confirmation failures are non-fatal after the UI result has already been applied and may include:

* Failure to send text to the worker
* Cartesia synthesis failure
* Playback failure
* Best-effort barge-in cancellation failure

Applications should distinguish a failed voice connection from a failed spoken confirmation of an otherwise successful UI update.

## Exports

### Package root

```ts
import {
  LiveKitAdapter,
  LiveKitTokenGrantSchema,
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TTS_TOPIC,
  TURN_TOPIC,
  USER_PARTICIPANT_IDENTITY,
  type LiveKitAdapterOptions,
  type LiveKitTokenGrant,
} from '@maelstrom-co/realtime-livekit';
```

### Protocol-only entry

```ts
import {
  SPEAK_TOPIC,
  TTS_TOPIC,
  TURN_TOPIC,
} from '@maelstrom-co/realtime-livekit/protocol';
```

### Token-contract-only entry

```ts
import {
  LiveKitTokenGrantSchema,
  type LiveKitTokenGrant,
} from '@maelstrom-co/realtime-livekit/token';
```

## Related documentation

* [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
* [Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/)
* [Voice architecture](https://docs.maelstrom-ai.co/understanding/voice-architecture/)
* [Browser adapter API reference](https://docs.maelstrom-ai.co/reference/realtime-livekit/readme/)
* [`@maelstrom-co/realtime`](../realtime/README.md)
* [`@maelstrom-co/react-realtime`](../react-realtime/README.md)
* [`@maelstrom-co/realtime-livekit-server`](../realtime-livekit-server/README.md)
* [`@maelstrom-co/realtime-livekit-agent`](../realtime-livekit-agent/README.md)

## License

MIT

