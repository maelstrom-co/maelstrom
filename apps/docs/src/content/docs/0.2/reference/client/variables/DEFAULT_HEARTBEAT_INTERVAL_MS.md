---
editUrl: false
next: false
prev: false
title: "DEFAULT_HEARTBEAT_INTERVAL_MS"
---

> `const` **DEFAULT\_HEARTBEAT\_INTERVAL\_MS**: `30000` = `30000`

Defined in: packages/connectors/dist/heartbeat-frame.d.ts:46

Recommended heartbeat cadence for a hosted deployment, in milliseconds.

This lives beside the frame shapes because it is part of the same
client/host contract: a host that reclaims idle sessions must derive its
"is this session still live" window from the same cadence the client
actually pings at. Drifting the two apart is silent and expensive — if the
client's interval grows past the host's window, every still-open session
looks abandoned and gets reclaimed out from under a live connection.

Both sides should import this rather than restating the number, so the
coupling is enforced by the compiler instead of by comments.

## Example

```ts
// Client: ping on this cadence.
new WebSocketConnector({ url, heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS });

// Host: treat a session touched within two beats as still live, which
// tolerates exactly one dropped or delayed heartbeat.
const livenessWindowMs = DEFAULT_HEARTBEAT_INTERVAL_MS * 2;
```
