# @maelstrom-co/livekit-agent

Node LiveKit voice agent worker for Maelstrom — a separate process that relays
STT (Deepgram) into the room and synthesizes TTS (Cartesia) back out.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (the response's userMessage) → Cartesia → published
  back as an audio track the client attaches and plays.

No LLM in the agent — the Maelstrom engine remains the only orchestrator; the
browser stays the orchestration hub. Imports only
`@maelstrom-co/livekit-voice/protocol` (the shared wire constants), so no browser
dependencies are pulled into the worker.

## Usage

```ts
// worker.ts — a thin entry that loads env then boots the worker.
import { runVoiceAgent } from '@maelstrom-co/livekit-agent';
runVoiceAgent();
```

```
node --env-file=.env worker.ts start
```

`defineMaelstromVoiceAgent()` returns the underlying LiveKit agent definition if
you need to embed it in your own worker harness.

## Secret-to-process mapping

| Process | Reads | Why |
|---------|-------|-----|
| Token endpoint (`@maelstrom-co/livekit-voice/server`) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Signs room JWTs |
| Agent worker (this process) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` | Registers for auto-dispatch + runs STT/TTS |
| Browser client | None | Receives `{ token, url }` from the token endpoint at runtime |

## Local setup

Install a local LiveKit SFU:

```
brew install livekit
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
