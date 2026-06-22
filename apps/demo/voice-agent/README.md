# Maelstrom Voice Agent

LiveKit agent worker for the Maelstrom demo. STT-only (Phase 1).

Pipeline: user mic audio → Deepgram STT → transcript → client via publishTranscription.
No LLM in the agent — Maelstrom engine remains the only orchestrator.

## Secret-to-process mapping

| Process | Reads | Why |
|---------|-------|-----|
| Token endpoint (TanStack Start server fn) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Signs room JWTs |
| Agent worker (this process) | All five: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` | Registers for auto-dispatch + runs STT/TTS |
| Browser client | None | Receives `{ token, url }` from token endpoint at runtime |

## Setup

Install livekit-server locally:

```
brew install livekit
```

Install worker dependencies (separate from root workspace):

```
cd apps/demo/voice-agent
bun install
```

## Running (4 terminals)

```
# Terminal 1 — LiveKit SFU (local dev server, insecure)
livekit-server --dev

# Terminal 2 — Maelstrom engine WS server (port 3001)
cd apps/demo && bun run dev:ws

# Terminal 3 — Vite / TanStack Start (port 3000)
cd apps/demo && bun run dev:client

# Terminal 4 — Voice agent worker
cd apps/demo/voice-agent && node --env-file=../../../.env index.ts start
```

## Env vars (root .env)

```
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
DEEPGRAM_API_KEY=<your key>
CARTESIA_API_KEY=<your key — Phase 2 TTS>
```

`livekit-server --dev` uses the well-known insecure key/secret (`devkey`/`secret`).
These defaults are pre-filled — only Deepgram (and Cartesia for Phase 2) require real keys.

## Verifying Phase 1

1. Start all four processes above.
2. Open `http://localhost:3000` in a browser.
3. Accept the microphone permission prompt.
4. Hold the "Hold to speak" button and say "show me the weather".
5. Release — the UI should update exactly as if you had typed the intent.

No spoken response in Phase 1. TTS is added in Phase 2.
