---
editUrl: false
next: false
prev: false
title: "UnixSeconds"
---

> **UnixSeconds** = `Brand`\<`number`, `"UnixSeconds"`\>

Defined in: packages/realtime-protocol/src/lib/unix-seconds.ts:10

Absolute Unix-epoch timestamp, in seconds. Branding this separately from
plain `number` prevents mixing it up with millisecond timestamps (e.g.
`Date.now()`) — a bare `Date.now() > expiresAt` comparison would silently
compare the wrong units.
