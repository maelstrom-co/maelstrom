# Classify transport closure

Both client and host may import this contract package. Client transport
implementations remain in the client package; application authentication remains
in the application.

```ts
import { classifyCloseCode, isHeartbeatPingFrame } from '@maelstrom-co/connectors';

export function reconnectAllowed(code: number) {
  const closure = classifyCloseCode(code);
  return !closure.clean && closure.retryable;
}

export function isTransportHeartbeat(frame: unknown) {
  return isHeartbeatPingFrame(frame);
}
```

Use the installed heartbeat constants and classifiers on both sides. A heartbeat
is transport activity, not a product intent or authorization decision.

## Verify

Test clean closure separately from retryable failure. Code 1000 is clean; code
1008 reports a policy rejection. Test heartbeat handling without dispatching it
to Engine planning, and keep reconnect limits in the owning transport policy.

## Troubleshoot

Do not treat `retryable` alone as permission to reconnect after a clean close.
For custom wire correlation, inspect `isCorrelatableId` and the protocol's parsed
Envelope shape before associating a response with an outstanding request.
