# Maelstrom Voice Agent

LiveKit agent worker for the Maelstrom demo.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (the response's userMessage) → Cartesia → published back
  as an audio track the client attaches and plays.

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
CARTESIA_API_KEY=<your key>
```

`livekit-server --dev` uses the well-known insecure key/secret (`devkey`/`secret`).
These defaults are pre-filled — only Deepgram (STT) and Cartesia (TTS) require real keys.

## Verifying the voice loop

1. Start all four processes above.
2. Open `http://localhost:3000` in a browser.
3. Toggle voice on (the master switch joins the room + unlocks audio playback).
4. Accept the microphone permission prompt.
5. Hold the "Hold to speak" button and say "show me the weather".
6. Release — the UI updates exactly as if typed **and** the assistant speaks its `userMessage`.
7. Type-in / voice-out also works: with voice on, typing an intent still speaks the reply.
