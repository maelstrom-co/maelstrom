# @maelstrom-co/realtime-livekit

`@maelstrom-co/realtime-livekit` connects `RealtimeSession` to a cascaded
LiveKit STT/TTS pipeline. The browser adapter owns microphone publication,
browser voice activity detection (VAD), pre-roll, and turn boundaries. The
companion `@maelstrom-co/realtime-livekit-agent` worker runs Deepgram STT and
Cartesia TTS; it does not run a voice-side LLM.

The package is separate from `@maelstrom-co/realtime` so applications that do
not use LiveKit do not install `livekit-client` or the browser VAD runtime.

## How the adapter drives Maelstrom

`LiveKitAdapter` converts each final user transcript into an `update_ui` tool
call. The intent then follows the same `RealtimeSession` path as a speech-native
adapter, including speak-after-render, barge-in, and sidechannel events.

- `RoomEvent.TranscriptionReceived` produces transcript events and the
  synthesized `update_ui` call.
- `sendToolResult()` sends the Engine's `userMessage` over the `speak` text
  stream when present, otherwise it sends the post-settle structural summary.
- The worker synthesizes that summary through Cartesia.

## Configure turn detection

Browser VAD is enabled by default:

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  mintToken: (roomName) => fetchLiveKitToken(roomName),
  roomName: `maelstrom-${sessionId}`,
  vad: {
    assetBaseUrl: '/vad-web/',
    preRollMs: 250,
    providerOptions: { positiveSpeechThreshold: 0.8 },
  },
});

const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();
```

The `vad` option accepts four forms:

- Omitted: enable automatic turns with `assetBaseUrl: '/vad-web/'`,
  `preRollMs: 250`, and the provider defaults.
- `true`: use the same automatic defaults as an omitted value.
- An options object: enable automatic turns and override supported settings.
- `false`: use manual turns without fetching VAD assets or creating the VAD and
  pre-roll worklets.

`preRollMs` must be a finite value from 0 through 500. It controls transport
pre-roll: audio retained locally before speech detection is sent once before
live speech. `providerOptions.preSpeechPadMs` is different; it changes the
provider's detection segment and does not replace or populate transport
pre-roll.

`providerOptions` exposes only supported detection tuning. Applications cannot
replace adapter-owned streams, callbacks, asset paths, audio context, start
policy, or ONNX Runtime configuration.

### Automatic and manual behavior

In automatic mode, the adapter observes the microphone locally and keeps the
upstream publication paused while the user is silent. Speech start sends the
bounded pre-roll once and opens live upstream audio. Speech end drains accepted
audio, pauses publication, and signals the worker to flush STT. No idle
microphone media is sent upstream between turns.

Invalid VAD configuration and asset, initialization, runtime, or VAD callback
failures degrade that connected session to manual mode. The adapter first ends
any active automatic turn and pauses upstream publication; only then does it
emit manual mode and expose `turnControl`. The LiveKit room, transcripts, and
TTS remain available.

Manual controls are dynamic and are available only after manual mode is
established:

```ts
const turnControl = session.turnControl;
await turnControl?.startTurn();
await turnControl?.endTurn();
```

A transport failure is different from VAD degradation. Token minting, room,
publication, required data-channel, pause, or unexpected disconnection failures
that leave the transport dead or unable to stop upstream audio are fatal. The
adapter tears down the connection instead of presenting manual mode as a safe
fallback.

## Deploy browser VAD assets

Default-on VAD still requires a build-time asset step. The default
`/vad-web/` URL does not create or publish files for the application. Use the
package-owned Node subpath or CLI so the copied assets match this adapter's
pinned VAD and ONNX Runtime dependencies. The workspace catalog pins
`@ricky0123/vad-web` to `0.0.30` and `onnxruntime-web` to `1.27.0` exactly.
Keeping both pins exact ensures that the copied worklet and model files stay
aligned with the ONNX Runtime JavaScript and WebAssembly files that load them.

### Node API

```ts
import { copyLiveKitVadAssets } from '@maelstrom-co/realtime-livekit/vad-assets';

const copied = await copyLiveKitVadAssets({ outputDir: 'public/vad-web' });
```

Relative destinations resolve from the caller's current working directory. The
helper returns sorted paths relative to the destination with `/` separators. It
stages and validates the complete manifest before replacing the destination,
then swaps any previous destination through a sibling backup. A failure before
the validated staging directory is committed restores the previous destination.
After commit, a stale-backup cleanup failure reports an error but keeps the
validated installation in place. Filesystem roots, symbolic links, and existing
non-directory targets are rejected.

### CLI

```sh
maelstrom-livekit-assets public/vad-web
```

The CLI applies the same replacement rules. It prints the copied-file count on
success and exits nonzero with a concise error on failure. A typical application
runs it before its normal build:

```json
{
  "scripts": {
    "prepare:vad": "maelstrom-livekit-assets public/vad-web",
    "build": "bun run prepare:vad && vite build"
  }
}
```

### Asset URL and hosting rules

`assetBaseUrl` must identify the directory containing the complete copied asset
set. A relative URL, including `/vad-web/`, resolves against the application
document and remains same-origin. An absolute URL must use credential-free
HTTPS. Protocol-relative URLs, HTTP, credentials, query strings, and fragments
are rejected. A missing trailing slash is normalized.

For an operator-controlled CDN:

- use an immutable, versioned HTTPS directory rather than a mutable alias;
- allow the application origin through CORS;
- serve JavaScript and `.mjs` as JavaScript, `.wasm` as `application/wasm`, and
  `.onnx` as a binary content type such as `application/octet-stream`; and
- publish the complete output from the package helper whenever either pinned
  dependency changes.

The browser executes the worklet, JavaScript, and WebAssembly files. Treat the
configured host as trusted executable infrastructure and never derive
`assetBaseUrl` from user input. The local pre-roll processor also uses a
Blob-backed AudioWorklet module, so the application's Content Security Policy
must allow `blob:` for worklet scripts in supported browsers.

Missing, blocked, malformed, or version-mismatched assets cause safe manual
degradation. They do not make an otherwise healthy LiveKit room a transport
failure.

## Contributor testing

Run `bun test --isolate` from this package. The `--isolate` flag deliberately
fences process-global happy-dom, browser, audio, module, and Bun mocks between
test files by giving each file a fresh global and module environment. This
boundary prevents one file's browser shims or `mock.module()` registrations from
changing another file's imports.

Isolation does not replace teardown. Each test must still restore mutated
globals and spies, stop tracks and worklets, clear timers, and release other
resources so failures and tests within the same file cannot leak state.

## Entry points

- `@maelstrom-co/realtime-livekit` — browser `LiveKitAdapter` and configuration
  types.
- `@maelstrom-co/realtime-livekit/token` — shared LiveKit token grant type.
- `@maelstrom-co/realtime-livekit/protocol` — wire topics shared with the
  worker.
- `@maelstrom-co/realtime-livekit/vad-assets` — Node-only asset deployment
  helper; never import this subpath into browser code.

## Breaking pre-release migration

Browser VAD moved from `@maelstrom-co/react-realtime` into `LiveKitAdapter`.

- Move supported `assetBaseUrl`, `preRollMs`, and `providerOptions` values from
  `maelstromRealtime(...).withVAD(options)` to
  `new LiveKitAdapter({ ..., vad: options })`.
- Replace the old VAD error callback and `vadError` with the provider-neutral
  `turnModeError` from `useVoice()`.
- Do not call a public automatic-turn capability. Automatic turn serialization
  is private to the adapter; only manual `turnControl` remains public.
- Remove the React package's VAD controller and direct VAD dependencies. Use
  this package's asset helper or CLI during the application build instead.

See [`@maelstrom-co/react-realtime`](../react-realtime/README.md) for the React
hook and turn-mode state.
