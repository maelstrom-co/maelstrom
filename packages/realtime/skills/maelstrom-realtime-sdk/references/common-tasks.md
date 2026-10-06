# Create a session from an application bridge

The application bridge submits intent to the Engine. The Provider Adapter owns
speech transport, not UI planning. Retain memory for the same application session
across adapter recreation.

```ts
import type { SessionId } from '@maelstrom-co/protocol';
import {
  type RealtimeInstance,
  type RealtimeProviderAdapter,
  RealtimeSession,
  RealtimeSessionMemory,
} from '@maelstrom-co/realtime';

export function createVoiceSession(
  sessionId: SessionId,
  instance: RealtimeInstance,
  adapter: RealtimeProviderAdapter,
  memory: RealtimeSessionMemory,
) {
  return new RealtimeSession({ sessionId, instance, adapter, memory });
}
```

Supply the real bridge rather than inventing a second planner. Its session ID must
match the application's Maelstrom session. Keep different users/sessions isolated.

## Verify

Test connect/disconnect races, cancellation, retained greeting proof, and settle
failures with a deterministic adapter. Observe runtime Turn Mode; automatic mode
can degrade to manual. Expose manual controls only when the session supplies them.

## Troubleshoot

Busy application work differs from failed work. Inspect result-bearing settle
evidence before speaking success. Recreating memory can lose deduplication proof.
Source tests and typechecks do not prove microphone or provider behavior.
