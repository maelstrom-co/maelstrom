# @maelstrom-co/realtime-livekit-agent

Node LiveKit voice agent worker for the Maelstrom LiveKit adapter — a separate
process that relays STT (Deepgram) into the room and synthesizes TTS (Cartesia)
back out.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (the settled tool result, phrased by the
  adapter) → Cartesia → published back as an audio track the client attaches
  and plays.

The worker has no planning LLM and receives no UI grounding. The Maelstrom
Engine remains the only planning model. The browser's `LiveKitAdapter`
synthesizes an `update_ui` tool call from each transcript, and
`RealtimeSession` drives it. The worker imports only
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

Node cannot execute a bare `.ts` entry before v23. On Node 20 or 22, build the
entry first and run the emitted `.js`, or supply your own TypeScript loader.

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

Deploy this entry as a long-running process separate from the application
server that mints browser room tokens. The worker runs only Deepgram STT and
Cartesia TTS; it does not convert transcripts into UI plans. The commands and
APIs in this README are scoped to the locked `@livekit/agents`, Deepgram plugin,
and Cartesia plugin 1.4.8 releases.

## Secret-to-process mapping

| Process | Reads | Why |
|---------|-------|-----|
| Token endpoint (`@maelstrom-co/realtime-livekit-server`) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Signs room JWTs |
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
The development server and repository demo token route are local-only examples;
do not deploy either one as a production authentication boundary.

### Optional tuning

| Var | Default | Purpose |
|-----|---------|---------|
| `MAELSTROM_STT_DRAIN_TIMEOUT_MS` | `5000` | Deadline (ms) for the Deepgram stream to finish draining after `endInput()`. Expiry closes that provider stream so a clean successor can open. It also derives the successor's pending-audio budget. Must be finite, positive, and no greater than `60000` — anything else fails worker startup rather than changing turn behavior later. |

## Docs

- Production guide: https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/
- Voice overview: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime-livekit-agent/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/
- LiveKit token generation: https://docs.livekit.io/home/server/generating-tokens/
- LiveKit voice AI worker guide: https://docs.livekit.io/agents/start/voice-ai/
