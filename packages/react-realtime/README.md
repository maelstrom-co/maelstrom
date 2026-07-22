# @maelstrom-co/react-realtime

React bindings for Maelstrom realtime voice sessions. The package provides
`maelstromRealtime()` for speech-native adapters and `.withVAD()` for a
LiveKit-style cascaded adapter with manual and automatic turn controls plus a
shared microphone stream.

## Browser VAD

Browser VAD is opt-in and loads its worklet, model, and ONNX Runtime files from
`assetBaseUrl`. This URL can be a relative directory served by the application
or an absolute HTTPS CDN directory. The current asset set must pair
`@ricky0123/vad-web@0.0.30` with `onnxruntime-web@1.27.0`; do not mix files from
other versions. Copy the following script into your app (for example,
`scripts/copy-vad-assets.mjs`) and run it from the app directory:

```js
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vadDist = dirname(fileURLToPath(await import.meta.resolve("@ricky0123/vad-web")));
const ortDist = dirname(fileURLToPath(await import.meta.resolve("onnxruntime-web/wasm")));
const outputDir = join(process.cwd(), "public", "vad-web");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const [vadFiles, ortFiles] = await Promise.all([readdir(vadDist), readdir(ortDist)]);
const assets = [...vadFiles.filter((name) => name === "vad.worklet.bundle.min.js" || name.endsWith(".onnx")).map((name) => [vadDist, name]), ...ortFiles.filter((name) => name.endsWith(".wasm") || name.endsWith(".mjs")).map((name) => [ortDist, name])];

await Promise.all(assets.map(([sourceDir, name]) => cp(join(sourceDir, name), join(outputDir, name))));

console.log(`Copied ${assets.length} VAD assets to ${outputDir}`);
```

The recipe discovers the installed package locations rather than assuming a
repository layout. It removes the previous destination before copying the VAD
worklet, all Silero model `.onnx` files, and all ONNX Runtime `.wasm` and `.mjs`
files into `public/vad-web/`, served at `/vad-web/`.

Strict package-manager consumers should install a version-matched
`onnxruntime-web@1.27.0` directly in the application that runs this recipe.
Regenerate the complete directory whenever either package version changes.

Run it with either `node scripts/copy-vad-assets.mjs` or
`bun scripts/copy-vad-assets.mjs`.

### Publishing assets

Pass either a relative application path or an absolute HTTPS CDN path. Both
forms must identify a directory containing the complete, matched asset set:

```tsx
// Served by the application.
assetBaseUrl: "/vad-web/";

// Served by an operator-controlled CDN.
assetBaseUrl: "https://cdn.example.com/maelstrom/vad-web/0.0.30-ort-1.27.0/";
```

Use an immutable, versioned CDN directory such as the one above and publish a
new directory when either dependency changes. Do not replace files under an
already cached version because a mixed worklet, model, and runtime set can fail
to initialize. Protocol-relative URLs, plain HTTP, credentials, query strings,
and fragments are rejected; a rejected URL invokes `onError` and leaves manual
turn controls available.

For a cross-origin CDN, the browser requires every asset response to allow the
application's origin with `Access-Control-Allow-Origin` (or `*` for public,
credential-free assets). Serve `.js` and `.mjs` as JavaScript, `.wasm` as
`application/wasm`, and `.onnx` as a binary MIME type such as
`application/octet-stream`. These are operator and browser requirements;
Maelstrom does not fetch assets itself or inspect response headers. If the
browser or VAD runtime rejects an asset, the resulting initialization error
invokes `onError` and leaves `turnControl.startTurn()` /
`turnControl.endTurn()` available for manual operation.

The LiveKit adapter's local pre-roll uses a Blob-backed AudioWorklet module.
Content Security Policy must therefore allow `blob:` for worklet scripts (for
example, through the applicable `script-src` or `worker-src` policy in the
target browser). If AudioWorklet is unavailable or its setup fails, Maelstrom
does not open an unbuffered automatic turn: it selects manual fallback instead.

The worklet, `.mjs`, and `.wasm` files are executable browser assets. Treat
`assetBaseUrl` as trusted operator configuration, never user input, and publish
only artifacts copied from the exact installed package versions.

### Browser Dependency Risk

The pinned `onnxruntime-web@1.27.0` browser artifact embeds a `protobufjs`
version with published advisories. This integration limits reachability by
pinning exact versions and loading only a complete asset set from an
operator-configured directory. Operators must trust the configured application
or CDN host, monitor upstream advisories, and upgrade when a patched ONNX
Runtime browser artifact exists. These controls do not mean that the dependency
is patched or risk-free.

## Usage (illustrative)

The adapter, token mint, and vessel registry below are application-specific.

```tsx
import { LiveKitAdapter } from "@maelstrom-co/realtime-livekit";
import { maelstromRealtime } from "@maelstrom-co/react-realtime";

const voice = maelstromRealtime({
  createAdapter: ({ sessionId }) =>
    new LiveKitAdapter({
      mintToken: (roomName) => fetchLiveKitToken(roomName),
      roomName: `maelstrom-${sessionId}`,
    }),
}).withVAD({
  assetBaseUrl: "/vad-web/",
  onError: (error) => console.error("Browser VAD unavailable", error),
});

const app = createMaelstrom({ vessels }).with(voice);
```

The cascaded adapter must expose `turnControl`, `automaticTurnControl`, and a
shared `mic` stream from `getAudioStreams()`. Browser VAD observes that stream,
while `automaticTurnControl` owns buffered automatic turn boundaries;
`turnControl` remains the manual fallback. The LiveKit server, token minter,
and `@maelstrom-co/realtime-livekit-agent` worker must also be configured,
including Deepgram and Cartesia credentials.

If assets, the runtime, initialization, or a VAD turn callback fails, `onError`
is called and the hook remains usable in manual mode:
`turnControl.startTurn()` and `turnControl.endTurn()` remain the turn
boundaries. Errors thrown by `onError` itself are contained and do not reject
VAD lifecycle operations. VAD teardown does not intentionally stop the LiveKit
track; Maelstrom overrides VAD stream hooks to reuse the adapter stream and
controls the VAD instance lifecycle.

`providerOptions` forwards non-lifecycle tuning options to `@ricky0123/vad-web`.
The following are reserved and ignored: `audioContext`, `getStream`,
`pauseStream`, `resumeStream`, `onSpeechStart`, `onSpeechEnd`,
`onVADMisfire`, `onSpeechRealStart`, `onFrameProcessed`, `startOnLoad`,
`submitUserSpeechOnPause`, `baseAssetPath`, `onnxWASMBasePath`, and `ortConfig`.

`preRollMs` and `providerOptions.preSpeechPadMs` affect different buffers.
`preRollMs` applies only to automatic turn control: it replays browser-local
transport audio once before automatic live audio reaches the adapter, defaults
to 250ms, and is clamped to 0–500ms. Manual turns do not use it.
`preSpeechPadMs` only changes how much earlier audio `vad-web` includes in its
detected speech segment. It does not replay that audio to the transport and
cannot replace `preRollMs`.

OpenAI realtime is unchanged. It uses its existing speech-native turn handling
and does not create a browser VAD controller.
