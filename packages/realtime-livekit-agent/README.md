# @maelstrom-co/realtime-livekit-agent

Node LiveKit voice agent worker for the Maelstrom LiveKit adapter spike — a
separate process that relays STT (Deepgram) into the room and synthesizes TTS
(Cartesia) back out.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (the tool-result summary) → Cartesia → published
  back as an audio track the client attaches and plays.

No LLM in the agent — the Maelstrom engine remains the only orchestrator. The
browser's `LiveKitAdapter` synthesizes an `update_ui` tool call from each
transcript, and `RealtimeSession` drives it. Imports only
`@maelstrom-co/realtime-livekit/protocol` (the shared wire constants), so no
browser dependencies are pulled into the worker.

## Usage

```ts
// worker.ts — a thin entry that loads env then boots the worker.
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';
runVoiceAgent();
```

```bash
node --env-file=.env worker.ts start
```

Within this monorepo, the demo app instead runs the package's TypeScript
source directly against its `.env` at the repo root:

```bash
node --conditions=@maelstrom-co/source --env-file-if-exists=../../.env voice-worker.ts start
```

`--conditions=@maelstrom-co/source` resolves workspace packages to their
TypeScript source instead of `dist` — only needed for in-repo development,
not by consumers of the published package, who can run the plain `node
--env-file=.env worker.ts start` form above against their own entry file.

`defineMaelstromVoiceAgent()` returns the underlying LiveKit agent definition if
you need to embed it in your own worker harness.

## Secret-to-process mapping

| Process | Reads | Why |
|---------|-------|-----|
| Token endpoint (`@maelstrom-co/realtime-livekit/server`) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Signs room JWTs |
| Agent worker (this process) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` | Registers for auto-dispatch + runs STT/TTS |
| Browser client | None | Receives `{ token, url }` from the token endpoint at runtime |

## Env vars (root .env)

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
DEEPGRAM_API_KEY=<your key>
CARTESIA_API_KEY=<your key>
```

`livekit-server --dev` uses the well-known insecure key/secret (`devkey`/`secret`).
These defaults are pre-filled — only Deepgram (STT) and Cartesia (TTS) require real keys.

### Optional tuning

| Var | Default | Purpose |
|-----|---------|---------|
| `MAELSTROM_STT_DRAIN_TIMEOUT_MS` | `5000` | Provider-drain deadline (ms) after `endInput()`. Expiry closes the stalled Deepgram stream, drops audio received while no stream is writable, and installs a clean successor when the track is still active. |

The timeout must be a positive number. A non-numeric or non-positive value
fails worker startup. The provider drain is the sole production completion
authority: successful iterator completion emits all buffered finals once;
timeout or failure salvages finals already received, then resets ownership.
