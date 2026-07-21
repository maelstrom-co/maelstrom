# @maelstrom-co/react-realtime

React bindings for Maelstrom realtime voice sessions. The package provides
`maelstromRealtime()` for speech-native adapters and `.withVAD()` for a
LiveKit-style cascaded adapter with a shared microphone stream.

## Browser VAD

Browser VAD is opt-in and requires a same-origin, self-hosted asset directory.
The asset set must match the installed versions of `@ricky0123/vad-web` and
`onnxruntime-web`. Copy the following script into your app (for example,
`scripts/copy-vad-assets.mjs`) and run it from the app directory:

```js
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vadDist = dirname(
  fileURLToPath(await import.meta.resolve('@ricky0123/vad-web')),
);
const ortDist = dirname(
  fileURLToPath(await import.meta.resolve('onnxruntime-web/wasm')),
);
const outputDir = join(process.cwd(), 'public', 'vad-web');

await mkdir(outputDir, { recursive: true });

const [vadFiles, ortFiles] = await Promise.all([
  readdir(vadDist),
  readdir(ortDist),
]);
const assets = [
  ...vadFiles
    .filter(
      (name) =>
        name === 'vad.worklet.bundle.min.js' || name.endsWith('.onnx'),
    )
    .map((name) => [vadDist, name]),
  ...ortFiles
    .filter((name) => name.endsWith('.wasm') || name.endsWith('.mjs'))
    .map((name) => [ortDist, name]),
];

await Promise.all(
  assets.map(([sourceDir, name]) =>
    cp(join(sourceDir, name), join(outputDir, name)),
  ),
);

console.log(`Copied ${assets.length} VAD assets to ${outputDir}`);
```

The recipe discovers the installed package locations rather than assuming a
repository layout. It copies the VAD worklet, all Silero model `.onnx` files,
and all ONNX Runtime `.wasm` and `.mjs` files into `public/vad-web/`, served at
`/vad-web/`. A deployment must publish that complete directory at a
same-origin URL and pass the URL as `assetBaseUrl`; cross-origin URLs are
rejected before the VAD module loads.

Strict package-manager consumers should install a version-matched
`onnxruntime-web` directly in the application that runs this recipe. The
version must match the runtime used by the installed `@ricky0123/vad-web` asset
set.

Run it with either `node scripts/copy-vad-assets.mjs` or
`bun scripts/copy-vad-assets.mjs`.

### Browser Dependency Risk

The pinned `onnxruntime-web@1.27.0` browser artifact embeds a `protobufjs`
version with published advisories. This integration limits reachability by
loading only version-matched, fixed same-origin Silero assets, rejecting
external asset origins, and exposing no executable provider hooks. Operators
must treat same-origin assets as trusted, monitor upstream advisories, and
upgrade when a patched ONNX Runtime browser artifact exists. These controls do
not mean that the dependency is patched or risk-free.

## Usage (illustrative)

The adapter, token mint, and vessel registry below are application-specific.

```tsx
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';

const voice = maelstromRealtime({
  createAdapter: ({ sessionId }) =>
    new LiveKitAdapter({
      mintToken: (roomName) => fetchLiveKitToken(roomName),
      roomName: `maelstrom-${sessionId}`,
    }),
}).withVAD({
  assetBaseUrl: '/vad-web/',
  onError: (error) => console.error('Browser VAD unavailable', error),
});

const app = createMaelstrom({ vessels }).with(voice);
```

The LiveKit adapter must expose `turnControl` and a shared `mic` stream from
`getAudioStreams()`. The browser VAD controller reuses that stream. The
LiveKit server, token minter, and `@maelstrom-co/realtime-livekit-agent`
worker must also be configured, including Deepgram and Cartesia credentials.

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

OpenAI realtime is unchanged. It uses its existing speech-native turn handling
and does not create a browser VAD controller.
