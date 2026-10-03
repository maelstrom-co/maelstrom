# Map a mint failure without exposing provider details

Import shared wire contracts from this package, including its provider subpaths.
A server or worker should not depend on a browser adapter to obtain those types.

```ts
import { type MintFailure, mintFailureHttpStatus } from '@maelstrom-co/realtime-protocol';

export function failureResponse(failure: MintFailure) {
  return Response.json(
    { error: 'mint-failed' },
    { status: mintFailureHttpStatus(failure.reason), headers: { 'Cache-Control': 'private, no-store' } },
  );
}
```

This is a response helper, not an authenticated route. The owning host still
checks authentication, authorization, origin, CSRF where relevant, and rate limits.
Use the `openai` or `livekit` subpath for provider-specific Grant schemas.

## Verify

Test each installed failure reason, invalid configuration, and malformed grants.
Validate expiries and provider scope before opening a browser session. Confirm
that server/worker dependencies contain no browser SDK package.

## Troubleshoot

Missing provider symbols at the root barrel usually require the provider subpath.
Preserve the installed reason taxonomy; do not serialize raw upstream errors,
credentials, or user content into the browser response.
