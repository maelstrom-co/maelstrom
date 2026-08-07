# @maelstrom-co/realtime-livekit

A `RealtimeProviderAdapter` (from `@maelstrom-co/realtime`) backed by a LiveKit
cascaded STT/TTS voice pipeline instead of a speech-native realtime model.

Shipped separately from `@maelstrom-co/realtime` so consumers of the core never
have `livekit-client` forced on them — pull this in only when you want the
LiveKit transport.

## The idea

`LiveKitAdapter` **synthesizes an `update_ui` tool call from each final user
transcript**, so a cascaded pipeline drives the exact same `RealtimeSession`
machinery (speak-after-render, barge-in, sidechannel events) as the OpenAI
realtime adapter — with no voice-side LLM in the worker or adapter. The
synthesized intent still flows through Maelstrom's engine LLM via
`RealtimeSession`, exactly as an OpenAI-realtime session would.

- **Transcripts in:** `RoomEvent.TranscriptionReceived` → `transcript` event +
  a synthesized `update_ui` `tool_call`.
- **Speak out:** the worker has no model, so `sendToolResult` picks the words:
  the engine's `userMessage` when present, else the structural `summary`. It
  goes over the `speak` text stream and the worker synthesizes it via Cartesia.
- **Hold-to-talk:** `adapter.turnControl.startTurn()` /
  `adapter.turnControl.endTurn()` unmute and mute the published microphone;
  ending the turn also asks the worker to flush its STT buffer.

The companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
STT (Deepgram) and TTS (Cartesia), and holds no LLM of its own.

## Entry points

Every subpath this package exports:

- **`@maelstrom-co/realtime-livekit`** — `LiveKitAdapter` (browser), plus
  `LiveKitTokenGrant` and `LiveKitTokenGrantSchema` re-exported from `./token`.
- **`@maelstrom-co/realtime-livekit/protocol`** — wire topic constants shared
  with the worker.
- **`@maelstrom-co/realtime-livekit/token`** — the grant type and schema on
  their own, for code that validates a grant without pulling in the adapter.
- **`@maelstrom-co/realtime-livekit/vad-assets`** — `copyLiveKitVadAssets`, the
  Node-only helper behind the build step in
  [Deploy browser VAD assets](#deploy-browser-vad-assets).

The Node-only token minter is a **separate package**, not a subpath here:
`@maelstrom-co/realtime-livekit-server` (`mintLiveKitToken`).

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/realtime-livekit livekit-client
```

```bash
npm install @maelstrom-co/realtime @maelstrom-co/realtime-livekit livekit-client
pnpm add @maelstrom-co/realtime @maelstrom-co/realtime-livekit livekit-client
yarn add @maelstrom-co/realtime @maelstrom-co/realtime-livekit livekit-client
```

`@maelstrom-co/realtime` is listed explicitly because the usage below imports
`RealtimeSession` from it directly; relying on it arriving transitively breaks
under a stricter installer. `livekit-client` is a peer dependency, so your
application owns its version.

## Usage

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import {
  LiveKitAdapter,
  LiveKitTokenGrantSchema,
} from '@maelstrom-co/realtime-livekit';

const adapter = new LiveKitAdapter({
  mintToken: async (roomName) => {
    const response = await fetch('/api/voice/livekit-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Send the room name as a hint only. The route derives the room and
      // identity it will actually sign from the caller's own session, because
      // a browser-chosen room name would let one caller join another's room.
      body: JSON.stringify({ roomName }),
    });
    if (!response.ok) throw new Error('Unable to start voice session');
    // Parse rather than cast: a malformed grant should fail here, not later
    // inside the room connection.
    return LiveKitTokenGrantSchema.parse(await response.json());
  },
  roomName: `maelstrom-${sessionId}`,
});
const session = new RealtimeSession({ adapter, instance, sessionId });
await session.connect();

// Hold-to-talk. `turnControl` is optional on the adapter seam, so read it
// through the session, which exposes it only while manual mode is established:
await session.turnControl?.startTurn();
await session.turnControl?.endTurn();
```

`connect()` acquires the microphone track, mutes it, and only then publishes it
and pauses it upstream — never `setMicrophoneEnabled(true)`, which would put an
enabled track on the wire before the gate is applied. It stays muted until
`startTurn()`. Each non-empty final transcript becomes one `update_ui` intent. An empty turn returns from `thinking` to `connected` after the bounded
`thinkingFallbackMs` interval (10 seconds by default).

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

This package runs `bun test --isolate`, and it is the only package here that
does. The flag gives every test file a fresh global and module environment. That
boundary is required: these tests install process-global happy-dom, browser,
audio, and `mock.module()` shims, and without it one file's shims change what
another file imports.

Isolation does not replace teardown. Each test must still restore mutated
globals and spies, stop tracks and worklets, and clear timers, so state cannot
leak between tests inside one file.

See the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
for the compile-checked browser integration and exact local demo commands. The
[Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/) compares
the provider tracks. Production token and worker setup is the guide's next
checkpoint; the checked-in demo route is development-only.

API details are available in the
[generated reference](https://docs.maelstrom-ai.co/reference/realtime-livekit/readme/).
For the reasoning behind the seams, read the
[voice architecture decisions](https://github.com/maelstrom-co/maelstrom/blob/main/docs/realtime-voice-architecture.md).
