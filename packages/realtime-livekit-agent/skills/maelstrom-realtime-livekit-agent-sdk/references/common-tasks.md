# Start the separate cascade worker

Use a Node worker entrypoint after loading trusted environment configuration.
This code starts a worker when executed; documentation checks only compile it.

```ts
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
```

Keep this outside the browser app and the credential-mint HTTP server. The worker
uses LiveKit, Deepgram, and Cartesia credentials in its documented roles. It
transcribes/synthesizes room speech; the Engine remains the UI planner. Keep
Vessel/Chart structure out of the worker.

For a compiled `voice-worker.mjs`, the installed worker CLI supports
`node --env-file=.env voice-worker.mjs start`. Configure worker selection and
room dispatch in the chosen deployment; do not infer them from typechecking.

## Verify

Test deployment registration, speech-service failure, room readiness, audio drain,
and graceful shutdown. Record real room/audio tests separately from mocks.
Confirm no worker dependency reaches a browser package.

## Troubleshoot

The worker module must stay importable from disk for LiveKit's job processes.
Joining the browser room is not proof of worker registration or TTS readiness.
Missing credentials are worker configuration failures; avoid logging their values.
