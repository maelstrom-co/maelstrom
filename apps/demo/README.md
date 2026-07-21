# @maelstrom-co/demo

Demo app for Maelstrom (TanStack Start + React) — shows the Engine and Chart
driving real Vessels, with optional voice control.

## Run (default: OpenAI realtime voice)

From the repo root:

```bash
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

3. From `apps/demo/`:

   ```bash
   bun run dev-livekit
   ```

   (equivalent to `nx run @maelstrom-co/demo:dev-livekit` from the repo root)

This starts three processes: the WebSocket engine host (`ws-server.ts`, port
3001), the LiveKit voice agent worker (STT/TTS relay), and Vite (port 3000)
in `livekit` mode. Vite mode loads `.env.livekit`, which sets
`VITE_VOICE_PROVIDER=livekit` so the client selects `LiveKitAdapter` instead
of the OpenAI realtime adapter.

Expected failure modes:
- Missing `DEEPGRAM_API_KEY` / `CARTESIA_API_KEY` / LiveKit credentials → the
  agent worker prints a clear missing-env-var error and exits.
- No `livekit-server` running → `ECONNREFUSED ws://localhost:7880` from the
  agent worker and/or the browser client.

## Further reading

- [`packages/realtime-livekit-agent/README.md`](../../packages/realtime-livekit-agent/README.md) — voice agent worker internals
- [`docs/realtime-voice-architecture.md`](../../docs/realtime-voice-architecture.md) — OpenAI-track realtime voice architecture
