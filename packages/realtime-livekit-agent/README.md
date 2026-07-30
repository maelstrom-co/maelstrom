# `@maelstrom-co/realtime-livekit-agent`

LiveKit agent worker for Maelstrom’s cascade voice transport.

The worker runs as a separate Node.js process and provides two speech stages:

```text
User microphone → LiveKit → Deepgram STT → final transcript
Settled Maelstrom response → LiveKit → Cartesia TTS → browser playback
```

The worker does **not** contain a conversational or planning LLM. It does not receive UI grounding, construct Engine requests, select Vessels, or decide how the interface should change.

The Maelstrom Engine remains the only planning model.

## Architecture

The complete LiveKit voice path consists of three packages:

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

None of these long-lived credentials belong in browser code.

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

These credentials and the repository’s demo token route are intended only for local development. Do not use them as a production authentication boundary.

Deepgram and Cartesia still require valid provider credentials.

## Optional tuning

### `MAELSTROM_STT_FLUSH_TIMEOUT_MS`

```dotenv
MAELSTROM_STT_FLUSH_TIMEOUT_MS=2000
```

Default: `2000`

This value is the fallback timeout, in milliseconds, for completing a hold-to-talk turn when Deepgram does not return a flush-produced final transcript.

A normal turn is emitted as soon as its flush-final arrives. The timeout primarily bounds empty taps or cases where the expected final event never arrives.

The value must be a positive number. Invalid or non-positive values cause the worker to fail during startup.

## Speech provider configuration

The shipped worker currently uses:

* Deepgram `nova-2`
* Recognition language `en-US`
* Cartesia streaming TTS

The worker uses Cartesia’s streaming synthesis path rather than its single-request byte endpoint. This allows synthesized frames to be published incrementally into the LiveKit room.

Changing models, languages, voices, or providers currently requires extending the worker implementation.

## Barge-in behavior

The browser adapter can cancel active speech when the user begins another turn.

When cancellation is requested, the worker:

1. Closes the active Cartesia synthesis stream.
2. Clears queued audio that has not yet played.
3. Completes the normal TTS status path so the browser can leave its speaking state.

The already-applied Maelstrom UI result is not rolled back when playback is interrupted or TTS fails.

## Public API

### `runVoiceAgent()`

Starts the package as a standalone LiveKit worker.

```js
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
```

The function reads LiveKit credentials from the process environment and delegates command handling to the LiveKit worker CLI.

Use it from a thin process entry that loads environment variables before startup.

### `defineMaelstromVoiceAgent()`

Returns the underlying LiveKit agent definition.

```ts
import { defineMaelstromVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

const agent = defineMaelstromVoiceAgent();
```

Use this when embedding the Maelstrom voice agent definition in a custom LiveKit worker harness.

### Default export

The package default export is the LiveKit agent definition:

```ts
import maelstromVoiceAgent from '@maelstrom-co/realtime-livekit-agent';
```

The standalone worker uses this definition when LiveKit loads the agent module.

## Production requirements

Deploy the worker as a long-running process with:

* Network access to LiveKit
* LiveKit worker credentials
* Deepgram and Cartesia credentials
* Restart and health-monitoring policies
* Redacted logs and telemetry
* Resource limits appropriate for concurrent audio sessions

The application’s token endpoint remains a separate server concern. It must authenticate the caller, authorize room access, derive room and participant identities from trusted server state, enforce origin and CSRF policy, apply shared rate limits, and return non-cacheable responses.

Do not accept unrestricted room names, participant identities, or token permissions directly from browser input.

## Failure boundaries

The speech pipeline and UI update have separate outcomes.

For example:

1. A transcript can be recognized successfully.
2. The Engine can update the UI successfully.
3. Cartesia synthesis or audio playback can then fail.

A later speech failure does not mean that the UI operation failed. Applications should report TTS failures separately from the Maelstrom command result.

The worker also fails closed when required LiveKit credentials or timeout configuration are invalid.

## Related documentation

* [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
* [Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/)
* [Voice architecture](https://docs.maelstrom-ai.co/understanding/voice-architecture/)
* [Agent API reference](https://docs.maelstrom-ai.co/reference/realtime-livekit-agent/readme/)
* [`@maelstrom-co/realtime-livekit`](../realtime-livekit/README.md)
* [`@maelstrom-co/realtime-livekit-server`](../realtime-livekit-server/README.md)

