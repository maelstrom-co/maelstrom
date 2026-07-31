# @maelstrom-co/react-realtime

`@maelstrom-co/react-realtime` adds one shared `RealtimeSession`, `useVoice()`,
and `VoiceOrb` to a Maelstrom React instance. Provider adapters own turn
detection and transport behavior. The React package subscribes to
provider-neutral session state; it does not create a browser VAD controller or
coordinate microphone publication.

## Usage

Configure browser VAD on `LiveKitAdapter`, then pass the adapter through
`maelstromRealtime()`:

```tsx
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';

const voice = maelstromRealtime({
  createAdapter: ({ sessionId }) =>
    new LiveKitAdapter({
      mintToken: (roomName) => fetchLiveKitToken(roomName),
      roomName: `maelstrom-${sessionId}`,
      vad: {
        assetBaseUrl: '/vad-web/',
        preRollMs: 250,
      },
    }),
});

const app = createMaelstrom({ vessels }).with(voice);
```

Omitting `vad` or setting it to `true` enables LiveKit's adapter-owned automatic
mode with `/vad-web/` and 250 ms of transport pre-roll. An options object
overrides supported settings. Set `vad: false` for intentional manual turns.
See [`@maelstrom-co/realtime-livekit`](../realtime-livekit/README.md) for the
asset-copy step, URL rules, provider tuning, and failure behavior.

Speech-native adapters keep their own automatic turn detection and require no
LiveKit browser VAD configuration.

## Read turn state with `useVoice()`

```tsx
function VoiceControl() {
  const {
    state,
    turnMode,
    turnModeError,
    turnControl,
    connect,
    disconnect,
  } = app.useVoice();

  // Render hold-to-talk only when manual controls are currently available.
  const canHoldToTalk = turnMode === 'manual' && turnControl !== undefined;
  // ...
}
```

The turn-related fields describe the current connection generation:

- `turnMode` is `'automatic'` or `'manual'`.
- `turnControl` is dynamic. It is absent in automatic mode and appears only
  after an adapter safely establishes manual mode. A reconnect or mode change
  can remove or replace it, so do not cache it outside React state.
- `turnModeError` contains the cause when attempted automatic mode degrades to
  manual. A clean automatic connection or intentional `vad: false` manual mode
  clears it.

`turnModeError` is diagnostic-only. Use its presence to show generic recovery
guidance, such as “Automatic voice detection is unavailable; hold to talk.”
Never render the value verbatim, include it in serialized application state, or
send it to telemetry. The underlying value may contain provider or browser
details that are unsuitable for users and observability payloads.

Invalid VAD configuration and VAD asset, initialization, runtime, or callback
failures are non-fatal when the LiveKit transport can still stop upstream audio
safely. The adapter pauses publication before publishing manual mode and
controls. Fatal LiveKit transport failures instead move the session through its
existing error path and do not expose manual mode as a fallback.

## Session sharing

All `useVoice()` consumers under one Maelstrom provider share a single
`RealtimeSession`. The extension creates one adapter per orchestrator session,
retains state for every subscriber, and retires the session after the final
consumer unmounts. `disconnect()` explicitly disconnects that shared session
regardless of how many consumers remain mounted.

## Breaking pre-release migration

Browser VAD ownership moved to `@maelstrom-co/realtime-livekit`.

- Move supported `assetBaseUrl`, `preRollMs`, and `providerOptions` values from
  `maelstromRealtime(...).withVAD(options)` to
  `new LiveKitAdapter({ ..., vad: options })` inside `createAdapter`.
- Replace the old VAD error callback and `vadError` with `turnModeError`.
- Remove calls to the former public automatic-turn capability. Automatic turn
  boundaries are private adapter behavior; `useVoice()` exposes only dynamic
  manual `turnControl`.
- Remove React-owned VAD setup and direct VAD runtime dependencies. Deploy the
  package-matched assets with `maelstrom-livekit-assets` or
  `copyLiveKitVadAssets()` during the application build.

Applications that previously used hold-to-talk can preserve that behavior by
setting `vad: false` on `LiveKitAdapter` and rendering controls only when
`turnMode === 'manual'` and `turnControl` is defined.
