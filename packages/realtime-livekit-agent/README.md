# @maelstrom-co/realtime-livekit-agent

Node LiveKit voice agent worker for the Maelstrom LiveKit adapter — a separate
process that relays STT (Deepgram) into the room and synthesizes TTS (Cartesia)
back out.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (`userMessage ?? summary`) → Cartesia →
  published back as an audio track the client attaches and plays.

The worker has no planning LLM and receives no UI grounding. The Maelstrom
Engine remains the only planning model. The browser's `LiveKitAdapter`
synthesizes an `update_ui` tool call from each transcript, and
`RealtimeSession` drives it. At runtime the worker imports only
`@maelstrom-co/realtime-protocol/livekit`, the shared wire constants, so
loading that subpath never evaluates browser or server modules.

## How a voice turn works

1. The browser publishes microphone audio to the LiveKit room.
2. The worker streams that audio to Deepgram.
3. Deepgram produces one or more final transcript fragments.
4. The worker combines the fragments into one transcript for the finished turn.
5. The browser adapter converts the transcript into an `update_ui` intent.
6. `RealtimeSession` submits the intent through the normal client and Engine path.
7. The client waits until the resulting UI commands have settled.
8. The browser sends `userMessage ?? summary` to the worker.
9. The worker synthesizes that text with Cartesia and publishes the audio.
10. The browser plays the assistant audio.

Speech therefore happens only after the matching interface update has settled.

## Install

```bash
bun add @maelstrom-co/realtime-livekit-agent@alpha
```

```bash
npm install @maelstrom-co/realtime-livekit-agent@alpha
pnpm add @maelstrom-co/realtime-livekit-agent@alpha
yarn add @maelstrom-co/realtime-livekit-agent@alpha
```

## Create the worker entry

Write a small entry file that starts the worker:

```js
// voice-worker.mjs
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
```

Start it with the LiveKit worker CLI command:

```bash
node --env-file=.env voice-worker.mjs start
```

An `.mjs` entry runs on every Node version in this package's `engines` range.
A bare `.ts` entry does not:

- Node 20 cannot run TypeScript at all. Build the entry, or supply a loader.
- Node 22.6–22.17 and 23.0–23.5 need `--experimental-strip-types`.
- Node 22.18+ and 23.6+ strip types by default, for erasable syntax only.

`--env-file` needs Node 20.6 or later. On an earlier release, export the
variables into the environment instead — the worker reads them either way.

`defineMaelstromVoiceAgent()` returns the underlying LiveKit agent definition
if you need to embed it in your own worker harness.

Deploy this entry as a long-running process, separate from the application
server that mints browser room tokens. The worker runs only Deepgram STT and
Cartesia TTS; it does not convert transcripts into UI plans. The commands and
APIs in this README are scoped to the `^1.4.8` ranges declared for
`@livekit/agents` and the Deepgram and Cartesia plugins.

### Monorepo development

Inside this repository the demo runs the package's TypeScript source directly
against the `.env` at the repo root:

```bash
node \
  --conditions=@maelstrom-co/source \
  --env-file-if-exists=../../.env \
  voice-worker.ts \
  start
```

`--conditions=@maelstrom-co/source` resolves workspace packages to their
TypeScript source instead of `dist`. This command is for in-repo development
only, and it asks more of Node than the published path does: it runs a bare
`.ts` entry, so it needs a Node that strips types, and `--env-file-if-exists`
needs 20.19+ or 22.9+. Consumers of the published package use the `.mjs` form
above, which has neither requirement.

## Secret-to-process mapping

| Process | Reads | Why |
|---------|-------|-----|
| Token endpoint (`@maelstrom-co/realtime-livekit-server`) | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Signs room JWTs |
| Agent worker (this process) | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY` | Registers for auto-dispatch + runs STT/TTS |
| Browser client | None | Receives `{ token, url }` from the token endpoint at runtime |

The browser receives a short-lived room token and the LiveKit URL, minted by
`@maelstrom-co/realtime-livekit-server`, and LiveKit may push it a refreshed
token while it stays connected. The token exposes `LIVEKIT_API_KEY` as its
public issuer; `LIVEKIT_API_SECRET`, which signs the token, never reaches the
browser.

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
