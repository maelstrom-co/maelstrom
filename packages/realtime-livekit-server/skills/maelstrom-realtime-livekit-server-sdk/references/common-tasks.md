# Validate application-derived room scope

Derive the room from authenticated, authorized application state. With the
supplied Maelstrom cascade worker, use the fixed user identity and one human per
room. Keep principal authorization in the application's room mapping. This
fragment validates wire shape; validation is not authorization or minting.

```ts
import { LiveKitTokenRequestSchema } from '@maelstrom-co/realtime-livekit-server';
import { USER_PARTICIPANT_IDENTITY } from '@maelstrom-co/realtime-protocol/livekit';

export function validateTrustedScope(roomName: string) {
  return LiveKitTokenRequestSchema.safeParse({ roomName, identity: USER_PARTICIPANT_IDENTITY });
}
```

Only call `mintLiveKitToken` after application origin, authentication,
authorization, CSRF, and fail-closed rate-limit checks. The helper reads server
credentials; no server or worker should import a browser package for wire types.

## Verify

Test invalid room scope, missing credentials/URL, invalid TTL, and failure mapping.
Check that returned Grant scope matches the application session. Return bounded
error copy with private/no-store headers, not raw provider details.

## Troubleshoot

`LIVEKIT_URL` is required. The minter signs locally, so its test seam differs
from OpenAI's upstream-fetch seam. Token expiry governs fresh authentication,
not the duration of an already active room. Application policy owns cleanup.
The supplied worker waits for `USER_PARTICIPANT_IDENTITY`; a different identity
can validate successfully but leave that worker waiting for its participant.
