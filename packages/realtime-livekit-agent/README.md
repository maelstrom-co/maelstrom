# `@maelstrom-co/realtime-livekit-agent`

Node LiveKit voice agent worker for the Maelstrom LiveKit adapter spike — a
separate process that relays STT (Deepgram) into the room and synthesizes TTS
(Cartesia) back out.

- **STT:** user mic audio → Deepgram → transcript → client via publishTranscription.
- **TTS:** client `speak` text stream (the tool-result summary) → Cartesia → published
  back as an audio track the client attaches and plays.

The worker has no planning LLM and receives no UI grounding. The Maelstrom
Engine remains the only planning model. The browser's `LiveKitAdapter`
synthesizes an `update_ui` tool call from each transcript, and
`RealtimeSession` drives it. The worker imports only
`@maelstrom-co/realtime-livekit/protocol` (the shared wire constants), so no
browser dependencies are pulled into the worker.

| Package                                 | Runtime            | Responsibility                                                                                                                           |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@maelstrom-co/realtime-livekit`        | Browser            | Connects to the LiveKit room, publishes microphone audio, turns final transcripts into Maelstrom intent, and plays synthesized responses |
| `@maelstrom-co/realtime-livekit-server` | Application server | Signs short-lived room tokens for authenticated browser sessions                                                                         |
| `@maelstrom-co/realtime-livekit-agent`  | Worker process     | Runs Deepgram speech recognition and Cartesia speech synthesis                                                                           |

The browser adapter and worker communicate using the shared wire protocol exported from:

```ts
@maelstrom-co/realtime-livekit/protocol
```

Applications normally do not need to interact with that protocol directly.

## How a voice turn works

A complete hold-to-talk turn follows this sequence:

1. The browser publishes microphone audio to the LiveKit room.
2. The worker streams the audio to Deepgram.
3. Deepgram produces one or more final transcript fragments.
4. The worker combines those fragments into one transcript for the completed turn.
5. The browser adapter converts the transcript into an `update_ui` intent.
6. `RealtimeSession` submits the intent through the normal Maelstrom client and Engine path.
7. The client waits until the resulting UI commands have settled.
8. The browser sends the Engine’s `userMessage`, or the structural summary fallback, to the worker.
9. The worker synthesizes the text with Cartesia and publishes the resulting audio.
10. The browser plays the assistant audio.

Successful speech therefore happens only after the corresponding interface update has settled.

## Install

```bash
bun add @maelstrom-co/realtime-livekit-agent
```

Equivalent commands:

```bash
npm install @maelstrom-co/realtime-livekit-agent
pnpm add @maelstrom-co/realtime-livekit-agent
yarn add @maelstrom-co/realtime-livekit-agent
```

## Create the worker entry

Create a small entry file that starts the worker:

```js
// voice-worker.mjs
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
```

Start it with the LiveKit worker CLI command:

```bash
node --env-file=.env voice-worker.mjs start
```

The process must remain running independently from the application server that mints browser room tokens.

### Monorepo development

Inside the Maelstrom repository, workspace packages can be resolved directly from TypeScript source:

```bash
node \
  --conditions=@maelstrom-co/source \
  --env-file-if-exists=../../.env \
  voice-worker.ts \
  start
```

The `@maelstrom-co/source` condition is only needed for repository development. Consumers of the published package should use the normal package entry point.

## Environment variables

The worker requires the following environment variables:

```dotenv
LIVEKIT_URL=wss://your-livekit-host
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret

DEEPGRAM_API_KEY=your-deepgram-api-key
CARTESIA_API_KEY=your-cartesia-api-key
```

### Variable ownership

| Variable             | Read by                 | Purpose                                   |
| -------------------- | ----------------------- | ----------------------------------------- |
| `LIVEKIT_URL`        | Token server and worker | LiveKit deployment URL                    |
| `LIVEKIT_API_KEY`    | Token server and worker | Signs tokens and authenticates the worker |
| `LIVEKIT_API_SECRET` | Token server and worker | Signs tokens and authenticates the worker |
| `DEEPGRAM_API_KEY`   | Worker only             | Speech-to-text                            |
| `CARTESIA_API_KEY`   | Worker only             | Text-to-speech                            |

Deploy this entry as a long-running process separate from the application
server that mints browser room tokens. The worker runs only Deepgram STT and
Cartesia TTS; it does not convert transcripts into UI plans. The commands and
APIs in this README are scoped to the locked `@livekit/agents`, Deepgram plugin,
and Cartesia plugin 1.4.8 releases.

## Secret-to-process mapping

The browser should receive only a short-lived room token minted by `@maelstrom-co/realtime-livekit-server`.

## Local LiveKit development

A local LiveKit server started with:

```bash
livekit-server --dev
```

uses the development credentials:

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

`livekit-server --dev` uses the well-known insecure key/secret (`devkey`/`secret`).
These defaults are pre-filled — only Deepgram (STT) and Cartesia (TTS) require real keys.
The development server and repository demo token route are local-only examples;
do not deploy either one as a production authentication boundary.

## Related documentation

| Var | Default | Purpose |
|-----|---------|---------|
| `MAELSTROM_STT_FLUSH_TIMEOUT_MS` | `2000` | Fallback ceiling (ms) for emitting a push-to-talk turn when the flush-produced final never arrives (an empty tap). A turn normally emits the instant its flush-final lands, so this only bounds the empty-turn case. Must be a positive number — a non-numeric or non-positive value fails worker startup. |

## Docs

- Production guide: https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/
- Voice overview: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime-livekit-agent/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/
- LiveKit token generation: https://docs.livekit.io/home/server/generating-tokens/
- LiveKit voice AI worker guide: https://docs.livekit.io/agents/start/voice-ai/
