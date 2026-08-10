# @maelstrom-co/realtime-livekit

[![npm](https://img.shields.io/npm/v/@maelstrom-co/realtime-livekit.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/realtime-livekit)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

A `RealtimeProviderAdapter` (from `@maelstrom-co/realtime`) backed by a LiveKit
cascaded STT/TTS voice pipeline instead of a speech-native realtime model.

**Full documentation:** <https://docs.maelstrom-ai.co>

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

This package exports `@maelstrom-co/realtime-livekit`, the browser
`LiveKitAdapter` and its configuration types. Shared grants and room topics live
in `@maelstrom-co/realtime-protocol/livekit`. The provider-neutral VAD engine and
its Node-only asset helper live in `@maelstrom-co/realtime-vad`.

The Node-only token minter is a **separate package**, not a subpath here:
`@maelstrom-co/realtime-livekit-server` (`mintLiveKitToken`).

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/realtime-livekit @maelstrom-co/realtime-vad livekit-client
```

```bash
npm install @maelstrom-co/realtime @maelstrom-co/realtime-livekit @maelstrom-co/realtime-vad livekit-client
pnpm add @maelstrom-co/realtime @maelstrom-co/realtime-livekit @maelstrom-co/realtime-vad livekit-client
yarn add @maelstrom-co/realtime @maelstrom-co/realtime-livekit @maelstrom-co/realtime-vad livekit-client
```

`@maelstrom-co/realtime` is listed explicitly because the usage below imports
`RealtimeSession` from it directly; relying on it arriving transitively breaks
under a stricter installer. `livekit-client` is a peer dependency, so your
application owns its version.

## Usage

```ts
import { RealtimeSession } from '@maelstrom-co/realtime';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { LiveKitTokenGrantSchema } from '@maelstrom-co/realtime-protocol/livekit';

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

Default-on VAD still requires a build-time asset step. The default `/vad-web/`
URL does not create or publish files for the application. Use the
`@maelstrom-co/realtime-vad` Node subpath or CLI so copied assets match the
engine's pinned VAD and ONNX Runtime dependencies. The workspace catalog pins
`@ricky0123/vad-web` to `0.0.30` and `onnxruntime-web` to `1.27.0` exactly.
Keeping both pins exact ensures that the copied worklet and model files stay
aligned with the ONNX Runtime JavaScript and WebAssembly files that load them.

### Node API

```ts
import { copyBrowserVadAssets } from '@maelstrom-co/realtime-vad/assets';

const copied = await copyBrowserVadAssets({ outputDir: 'public/vad-web' });
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
maelstrom-vad-assets public/vad-web
```

The CLI applies the same replacement rules. It prints the copied-file count on
success and exits nonzero with a concise error on failure. A typical application
runs it before its normal build:

```json
{
  "scripts": {
    "prepare:vad": "maelstrom-vad-assets public/vad-web",
    "build": "bun run prepare:vad && vite build"
  }
}
```

Add `@maelstrom-co/realtime-vad` as a direct dependency before running the CLI.
It reaches an application only transitively through this package, and package
managers link a bin into the root `node_modules/.bin` only for direct
dependencies — so without that entry `maelstrom-vad-assets` is not on `PATH`.

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

Match your local Bun to `.bun-version` at the repo root; every workflow reads
that file. `--isolate` is absent in 1.3.7 and present in 1.3.14, and Bun
accepts unknown flags silently rather than rejecting them, so on an older
version this suite runs unisolated and still passes locally while leaking
across files anywhere else. This package's suite genuinely depends on the
boundary.

Isolation does not replace teardown. Each test must still restore mutated
globals and spies, stop tracks and worklets, and clear timers, so state cannot
leak between tests inside one file.

## Docs

See the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
for the compile-checked browser integration and exact local demo commands. The
[Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/) compares
the provider tracks. Production token and worker setup is the guide's next
checkpoint; the checked-in demo route is development-only.

API details are available in the
[generated reference](https://docs.maelstrom-ai.co/reference/realtime-livekit/readme/).
For the reasoning behind the seams, read the
[voice architecture decisions](https://github.com/maelstrom-co/maelstrom/blob/main/docs/realtime-voice-architecture.md).

## License

MIT
