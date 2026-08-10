# @maelstrom-co/realtime-vad

[![npm](https://img.shields.io/npm/v/@maelstrom-co/realtime-vad.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/realtime-vad)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

`@maelstrom-co/realtime-vad` is the provider-neutral browser voice-activity
detection (VAD) engine behind automatic turn-taking. It never acquires a
microphone: a caller passes a `MediaStream` it already owns and never stops,
plus `startTurn`, `endTurn`, and `onFailure` callbacks. Reacting to those
speech edges — resuming upstream publication, flushing pre-roll audio, or
whatever else a given transport needs — is the caller's responsibility, not
this package's.

📚 **Full documentation:** <https://docs.maelstrom-ai.co>

The package is separate from `@maelstrom-co/realtime` so applications that
don't use automatic turn-taking never install `@ricky0123/vad-web` or the
ONNX Runtime browser weight. `@maelstrom-co/realtime-livekit` is the first
consumer: `LiveKitAdapter` calls `createBrowserVad` and reacts to its
`startTurn`/`endTurn` boundaries by resuming LiveKit's upstream publication
and flushing its local pre-roll bridge. Any other transport adapter can drive
the same engine the same way.

## Usage

```ts
import { createBrowserVad, resolveBrowserVadConfig } from '@maelstrom-co/realtime-vad';

const config = resolveBrowserVadConfig({
  assetBaseUrl: '/vad-web/',
  preRollMs: 250,
  providerOptions: { positiveSpeechThreshold: 0.8 },
});

if (config.enabled) {
  const vad = await createBrowserVad({
    stream, // a MediaStream the caller owns and keeps alive
    config,
    startTurn: async () => {
      /* open the transport's live upstream audio, flush pre-roll */
    },
    endTurn: async () => {
      /* drain accepted audio, pause upstream publication */
    },
    cancelTurn: async () => {
      /* discard the buffered pre-roll — the utterance never reached minSpeechMs */
    },
    onFailure: async (error, { turnActive, retire }) => {
      /* close any active turn, retire VAD, fall back to manual control */
    },
  });

  // Later, when the connection tears down:
  await vad.destroy();
}
```

`resolveBrowserVadConfig` accepts four forms for its input:

- Omitted or `undefined`: enable automatic turns with `assetBaseUrl:
  '/vad-web/'`, `preRollMs: 250`, and the provider defaults.
- `true`: use the same automatic defaults as an omitted value.
- An options object: enable automatic turns and override supported settings.
- `false`: `{ enabled: false }` — the caller should skip VAD entirely and use
  manual turns without fetching VAD assets or creating the VAD and pre-roll
  worklets.

`preRollMs` must be a finite value from 0 through 500. It is part of the
resolved VAD config because any adapter that gates upstream audio while idle
needs pre-roll, not just LiveKit — only the *implementation* of "flush the
buffered pre-roll" is transport-specific. `providerOptions.preSpeechPadMs` is
different; it changes the provider's detection segment and does not replace
or populate transport pre-roll.

`providerOptions` exposes only supported detection tuning. Callers cannot
replace engine-owned streams, callbacks, asset paths, audio context, start
policy, or ONNX Runtime configuration.

### Behavior

`createBrowserVad` serializes rapid speech-start/speech-end boundaries,
collapses adjacent duplicate boundaries, and treats a VAD misfire like a
speech end that closes any turn already opened by a speech start. Load,
construction, and initial start failures reject so the caller can choose
manual mode up front. Later boundary failures fence further callbacks and
offer `onFailure` the diagnostic once; when a turn is active at the time of
failure, the handler also receives that state and an idempotent `retire`
operation so it can close its transport turn, retire the VAD instance, then
expose manual control, in that order. `destroy()` is idempotent, closes an
established turn when no boundary or failure handler already owns
finalization, and never stops the caller-owned microphone stream.

## Deploy browser VAD assets

Default-on VAD still requires a build-time asset step. The default
`/vad-web/` URL does not create or publish files for the application. Use the
package-owned Node subpath or CLI so the copied assets match this package's
pinned VAD and ONNX Runtime dependencies. The workspace catalog pins
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
`assetBaseUrl` from user input.

Missing, blocked, malformed, or version-mismatched assets cause the caller's
`createBrowserVad()` call or first-run initialization to fail so it can fall
back to manual mode. They do not, on their own, make an otherwise healthy
transport connection a fatal transport failure — that call is the adapter's.

## Entry points

- `@maelstrom-co/realtime-vad` — `createBrowserVad`, `resolveBrowserVadConfig`,
  and the `BrowserVad`, `BrowserVadOptions`, `BrowserVadProviderOptions`,
  `CreateBrowserVadOptions`, `ResolvedBrowserVadConfig` types.
- `@maelstrom-co/realtime-vad/assets` — Node-only asset deployment helper;
  never import this subpath into browser code.

## Contributor testing

From the workspace root, run `nx test @maelstrom-co/realtime-vad --skipSync`.
That target runs `bun test --isolate`, which gives each test file a fresh
global and module environment. `src/vad-assets.test.ts` installs a
`mock.module('node:fs/promises', …)` fault injector, and `mock.restore()`
reverts spies but not module registrations — isolation is what keeps that
injector out of every other file.

Match your local Bun to `.bun-version` at the repo root; every workflow reads
that file. `--isolate` is absent in 1.3.7 and present in 1.3.14, and Bun
accepts unknown flags silently rather than rejecting them, so on an older
version this suite runs unisolated and still passes locally while leaking
across files anywhere else.

## Where this fits

See [`@maelstrom-co/realtime-livekit`](../realtime-livekit/README.md) for the
concrete example of an adapter wiring this engine's `startTurn`/`endTurn`
callbacks to LiveKit's microphone publication and pre-roll bridge, and
[`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md)
for the full package topology.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
