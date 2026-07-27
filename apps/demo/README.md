# Maelstrom Demo

A day-planner UI — calendar, weather, map, journal, tasks — arranged entirely by an LLM. Talk or type: the engine reads your intent and the current state of the board, then decides what to show, where, and how big. Voice is client-direct WebRTC straight to OpenAI's realtime model (the default), or a self-hosted LiveKit cascade; the engine can't tell whether an intent came from your keyboard or your mouth.

<!-- screenshot: busy board mid-rearrange, orb active -->

## Quickstart (default: OpenAI realtime voice)

From the repo root:

```bash
bun install
cp .env.example .env
```

Fill in `.env`:

| Key | Required for | Notes |
| --- | --- | --- |
| `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) | Text planning engine | Powers the engine's Gemini adapter |
| `OPENAI_API_KEY` | Voice | Mints ephemeral realtime tokens server-side; never reaches the browser |
| `OPENAI_REALTIME_MODEL` | Voice (optional) | Overrides the realtime model; defaults to `gpt-realtime-2` |
| `ANTHROPIC_API_KEY` | Optional | For the engine's custom LLM provider support |

One command runs both the WebSocket engine server and the Vite dev server:

```bash
bunx nx dev demo
```

This runs the WebSocket engine host (`ws-server.ts`, port 3001) and Vite
(port 3000) together. Open http://localhost:3000.

The `nx` commands in this README run from the repository root. Commands shown
as `bun run ...` under the LiveKit section run from `apps/demo/`.

## Run (LiveKit voice)

This is the repository's development-only LiveKit checkpoint. It exercises the
browser adapter and local worker, but its mint route is not a production token
boundary. For deployment, follow the
[LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
after validating the local path.

1. Install and run a LiveKit server in dev mode:

   ```bash
   brew install livekit   # or download a release: https://github.com/livekit/livekit/releases
   livekit-server --dev
   ```

   `--dev` mode's well-known `devkey` / `secret` credentials already match the
   pre-filled `LIVEKIT_*` values in `.env.example` (`ws://localhost:7880`), so
   no LiveKit-side config changes are needed for local dev.

2. In `.env`, additionally set real keys for:
   - `DEEPGRAM_API_KEY` — speech-to-text
   - `CARTESIA_API_KEY` — text-to-speech

   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `LIVEKIT_URL` can stay at
   their `.env.example` defaults when using `livekit-server --dev`.

3. From the repo root:

   ```bash
   bunx nx dev-livekit demo
   ```

   Run it through Nx (not `bun run dev-livekit` from `apps/demo/`) so the
   `^build` dependency fires and workspace packages are built first.

This starts three processes managed by `concurrently --kill-others-on-fail`:
the WebSocket engine host (`ws-server.ts`, port 3001), the LiveKit voice agent
worker (STT/TTS relay), and Vite (port 3000) in `livekit` mode. Vite mode loads
`.env.livekit`, which sets `VITE_VOICE_PROVIDER=livekit` so the client selects
`LiveKitAdapter` instead of the OpenAI realtime adapter.

### LiveKit browser VAD

The LiveKit demo uses adapter-owned browser VAD, which is also the
`LiveKitAdapter` default when `vad` is omitted or `true`. The demo supplies an
options object with `assetBaseUrl: '/vad-web/'`; the remaining defaults include
250 ms of transport pre-roll. Set `vad: false` in the adapter to skip all VAD
assets and worklets and use intentional manual turns.

The complete `providerOptions` override set — `positiveSpeechThreshold: 0.8`,
`negativeSpeechThreshold: 0.65`, `redemptionMs: 200`, `preSpeechPadMs: 100`, and
`minSpeechMs: 100` — is aggressive demo-only tuning. Validate all five settings
against real application speech before reusing them in production.

Automatic mode keeps microphone audio in the browser while idle. If automatic
detection cannot initialize, the adapter safely switches that connected
session to manual turns and exposes `turnControl` for hold-to-talk. OpenAI
realtime is unchanged and continues to use its speech-native turn handling.

VAD initialization uses self-hosted assets. Prepare them from the repository
root with:

```bash
bunx nx run demo:prepare-voice-assets
```

The equivalent command from `apps/demo/` is:

```bash
bun run prepare:voice-assets
```

The Nx target builds `@maelstrom-co/realtime-livekit` first, then runs the
package command. Its `maelstrom-livekit-assets` CLI atomically replaces the
ignored `apps/demo/public/vad-web/` directory with the complete asset set that
matches the adapter's pinned VAD and ONNX Runtime dependencies. The Nx
`serve`, `dev`, `dev-livekit`, and `build-livekit` targets run this preparation
automatically. An ordinary `build` does not prepare VAD assets; run the root Nx
command first if that build needs them.

This build-time step is required even though automatic VAD is the runtime
default: the default `/vad-web/` URL does not create or publish the assets. Vite
serves the generated directory at `/vad-web/`, which is the demo's current
`assetBaseUrl`. Do not commit the generated binaries.

For production, either publish the complete directory at `/vad-web/` on the
demo origin or set `assetBaseUrl` to an absolute HTTPS CDN directory. Use an
immutable, versioned path such as
`https://cdn.example.com/maelstrom/vad-web/0.0.30-ort-1.27.0/`; never replace
files at that path. Return `Access-Control-Allow-Origin` for the demo origin,
serve `.js` and `.mjs` as `text/javascript`, `.wasm` as `application/wasm`, and
`.onnx` as `application/octet-stream`. The browser executes the JavaScript,
worklet, and WASM assets, so publish the complete set only from controlled,
trusted storage. CORS and MIME handling are operator and browser requirements;
Maelstrom does not inspect response headers. Browser or VAD-runtime asset
rejections surface as initialization errors and restore hold-to-talk fallback.

The LiveKit adapter also creates its local pre-roll processor from a Blob-backed
AudioWorklet module. Production Content Security Policy must allow `blob:` for
worklet scripts under the directive used by the target browser. If AudioWorklet
is unavailable, blocked, or fails to initialize, the adapter keeps manual turn
control and the demo safely restores hold-to-talk rather than opening an
unbuffered automatic turn.

VAD is LiveKit-only. OpenAI realtime keeps its existing speech-native turn
handling and does not create a browser VAD controller. When LiveKit VAD is
healthy, turns are automatic and the hold-to-talk control is hidden. If VAD
assets or runtime initialization fail, the demo switches to manual mode,
shows a concise fallback notice, and restores hold-to-talk with its existing
pointer and keyboard safeguards.

## Things to say

Type these into the input, or say them to the orb:

- "Clear all this — just show me today"
- "What's my morning look like? I need to be at the design review by 10"
- "Actually skip the gym, add coffee with Sam at 9"
- "Start a journal entry about today's plan and jot down the key points"

## How voice works

The browser holds the OpenAI realtime session directly, authenticated by a short-lived token minted by `/api/realtime-token` — `OPENAI_API_KEY` never leaves the server. The model has one write path: an `update_ui` tool call carrying a plain-text intent, which flows through the same path as typed input — the engine plans against the app's own state, never the model's beliefs about the screen. The model only narrates a change after the render has settled, so it never talks ahead of what you see. Full design: [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md).

## Debug overlays

Append `?debug` to the URL (e.g. `http://localhost:3000/?debug`) to show the grid/tiling overlay and instance-id/size labels on every vessel. Off by default, so a plain `bunx nx dev demo` renders clean.

**Recording tip:** macOS's "Reduce Motion" setting (System Settings → Accessibility → Display) disables all of the demo's choreography via `prefers-reduced-motion` — turn it off before recording the launch video.

## Troubleshooting

- **Mic blocked** — allow microphone access for this site in your browser's site settings, then click the orb to retry.
- **Voice error: "couldn't start"** — `OPENAI_API_KEY` isn't set in `.env` for the dev server (`bunx nx dev demo`), which mints the realtime token via `/api/realtime-token`.
- **Weather shows fixture data** — the demo is offline (no network to Open-Meteo); it falls back to canned values silently rather than erroring.
- **Map tiles blank** — no network to `tiles.openfreemap.org`.

LiveKit-specific failure modes:

Manual mode means browser VAD no longer starts or owns turn boundaries. The
LiveKit `turnControl.startTurn()` and `endTurn()` controls become available only
after the adapter has paused upstream publication and established manual mode.
The demo reads this dynamic control through `useVoice()`; it does not retain an
automatic-turn capability.

`useVoice().turnModeError` is diagnostic-only. The demo uses its presence to
show a fixed fallback notice. Never render the underlying value verbatim or
serialize it into application state or telemetry.

`providerOptions` accepts only the documented detection tuning fields. Stream
callbacks, speech callbacks, asset paths, `ortConfig`, and other runtime-owned
fields are invalid configuration and cause diagnostic manual degradation rather
than being ignored.

`preRollMs` defaults to 250 ms and applies only to automatic transport audio;
it does not affect manual hold-to-talk turns. The provider's
`preSpeechPadMs` changes the detected speech segment, not transport pre-roll,
and cannot replace it.

VAD setup and runtime failures fall back to manual mode only when the adapter
can pause upstream audio safely. Token, room, publication, required
data-channel, pause, and unexpected disconnection failures that make the
transport unusable are fatal: the session enters its error path instead of
presenting hold-to-talk as a safe fallback.

- Missing `DEEPGRAM_API_KEY` / `CARTESIA_API_KEY` / LiveKit credentials → the
  agent worker prints a clear missing-env-var error and exits.
- No `livekit-server` running → `ECONNREFUSED ws://localhost:7880` from the
  agent worker and/or the browser client.
- `LIVEKIT_TOKEN_TTL` must be a bare integer (seconds) or `<int><unit>` with
  unit `s`/`m`/`h`/`d` (default `15m`); anything else (e.g. `2 days`, `1w`)
  fails closed with an HTTP 500 invalid-config response and a console error
  naming the bad value.
- `MAELSTROM_STT_DRAIN_TIMEOUT_MS` (optional, default `5000`) sets the positive
  millisecond deadline for the provider stream to finish draining after
  `endInput()`. If the stream stalls, the agent closes it and installs a clean
  successor while the track remains active. A non-numeric or non-positive value
  fails the agent worker's startup with a clear error naming the bad value.
- The three processes run under `concurrently --kill-others-on-fail`, so a
  worker that dies (e.g. on a missing `DEEPGRAM_API_KEY`/`CARTESIA_API_KEY`)
  takes the other two down with it and the command exits non-zero. The failure
  is visible rather than silent — check the terminal output for the agent
  worker's error.

## Further reading

- [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/) — browser integration first, then the production token and worker checkpoint
- [`packages/realtime-livekit-agent/README.md`](../../packages/realtime-livekit-agent/README.md) — voice agent worker internals
- [`packages/realtime-livekit/README.md`](../../packages/realtime-livekit/README.md) — adapter VAD configuration and asset deployment
- [`packages/react-realtime/README.md`](../../packages/react-realtime/README.md) — `useVoice()` turn-mode state
- [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) — realtime voice architecture
