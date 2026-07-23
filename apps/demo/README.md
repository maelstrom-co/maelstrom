# @maelstrom-co/demo

Demo app for Maelstrom (TanStack Start + React) — shows the Engine and Chart
driving real Vessels, with optional voice control.

## Run (default: OpenAI realtime voice)

From the repo root:

```bash
bun install
cp .env.example .env
```

Fill in `.env`:
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) — the demo engine (`@tanstack/ai-gemini`)
- `OPENAI_API_KEY` — realtime voice (OpenAI, the default provider)

Then:

```bash
nx dev demo
```

This runs the WebSocket engine host (`ws-server.ts`, port 3001) and Vite
(port 3000) together.

## Run (LiveKit voice)

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
   nx dev-livekit demo
   ```

   Run it through Nx (not `bun run dev-livekit` from `apps/demo/`) so the
   `^build` dependency fires and workspace packages are built first.

This starts three processes (chained with `&`): the WebSocket engine host
(`ws-server.ts`, port 3001), the LiveKit voice agent worker (STT/TTS relay),
and Vite (port 3000) in `livekit` mode. Vite mode loads `.env.livekit`, which
sets `VITE_VOICE_PROVIDER=livekit` so the client selects `LiveKitAdapter`
instead of the OpenAI realtime adapter.

Expected failure modes:
- Missing `DEEPGRAM_API_KEY` / `CARTESIA_API_KEY` / LiveKit credentials → the
  agent worker prints a clear missing-env-var error and exits.
- No `livekit-server` running → `ECONNREFUSED ws://localhost:7880` from the
  agent worker and/or the browser client.
- `LIVEKIT_TOKEN_TTL` must be a bare integer (seconds) or `<int><unit>` with
  unit `s`/`m`/`h`/`d` (default `15m`); anything else (e.g. `2 days`, `1w`)
  fails closed with an HTTP 500 invalid-config response and a console error
  naming the bad value.
- `MAELSTROM_STT_FLUSH_TIMEOUT_MS` (optional, default `2000`) tunes the agent's
  push-to-talk turn-flush fallback; a non-numeric or non-positive value fails
  the agent worker's startup with a clear error naming the bad value.
- Because the three processes are chained with `&`, a worker that dies (e.g.
  on a missing `DEEPGRAM_API_KEY`/`CARTESIA_API_KEY`) leaves the other two
  running — voice will silently never respond, so check the terminal output
  for the agent worker's error.

## Further reading

- [`packages/realtime-livekit-agent/README.md`](../../packages/realtime-livekit-agent/README.md) — voice agent worker internals
- [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) — OpenAI-track realtime voice architecture
