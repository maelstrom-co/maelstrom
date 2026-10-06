# Configure a browser session with manual turns

Select this adapter only for a chosen LiveKit cascade deployment. The application
supplies an authenticated grant callback and a server-authorized room scope.

```ts
import { LiveKitAdapter, type LiveKitAdapterOptions } from '@maelstrom-co/realtime-livekit';

export function createManualVoice(
  roomName: string,
  mintToken: LiveKitAdapterOptions['mintToken'],
) {
  return new LiveKitAdapter({ roomName, mintToken, vad: false });
}
```

The server must derive and authorize room/identity scope; the browser's room
argument is not authorization. The cascade worker supplies speech services.
Keep LiveKit keys and speech-service credentials in their server/worker roles.

## Verify

Test mint failure, worker readiness, cancellation, cleanup, and runtime Turn Mode.
Render manual controls only when exposed by the active session. Test automatic
VAD degradation separately before enabling detector-driven turns.

## Troubleshoot

Joining a room is not proof that the speech worker is ready. A Grant's expiry
does not impose a maximum active room duration; application policy owns it.
The adapter does not schedule its own proactive renewal. Observe current state
rather than assuming a fixed connection/reconnect progression.
