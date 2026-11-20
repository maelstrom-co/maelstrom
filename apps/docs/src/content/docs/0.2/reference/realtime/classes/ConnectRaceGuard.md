---
editUrl: false
next: false
prev: false
title: "ConnectRaceGuard"
---

Defined in: packages/realtime/src/lib/connect-race-guard.ts:60

A monotonic generation counter that lets a provider adapter's `connect()`
detect, once each of its awaits resumes, that a newer `connect()` or a
`disconnect()`/teardown overtook it — so the stale attempt aborts instead of
clobbering the winner's shared connection state.

One instance per adapter, held for the adapter's lifetime. `begin()` opens a
fresh attempt (superseding any in-flight one); `supersede()` invalidates the
current attempt from teardown so a mid-handshake `connect()` abandons itself.
Both provider adapters (`@maelstrom-co/realtime-openai` and
`@maelstrom-co/realtime-livekit`) share this so superseded-connect behavior is
uniform — a superseded attempt always rejects with `CONNECT_SUPERSEDED`,
never resolves as if it succeeded.

## Example

```ts
async connect(): Promise<void> {
  const attempt = this.#guard.begin();
  const token = await this.#mintToken();
  attempt.assertCurrent();       // throws CONNECT_SUPERSEDED if overtaken
  this.#connection = await join(token);
  attempt.assertCurrent();
  // ...publish to shared fields, now known safe
}

#teardown(): void {
  this.#guard.supersede();       // any in-flight connect() abandons itself
  // ...null shared fields
}
```

## Constructors

### Constructor

> **new ConnectRaceGuard**(): `ConnectRaceGuard`

#### Returns

`ConnectRaceGuard`

## Methods

### begin()

> **begin**(): [`ConnectAttempt`](/reference/realtime/interfaces/connectattempt/)

Defined in: packages/realtime/src/lib/connect-race-guard.ts:67

Open a new connect attempt, superseding any in-flight one. Returns a handle
the caller re-checks after each await to detect being overtaken.

#### Returns

[`ConnectAttempt`](/reference/realtime/interfaces/connectattempt/)

***

### supersede()

> **supersede**(): `void`

Defined in: packages/realtime/src/lib/connect-race-guard.ts:90

Invalidate the current attempt (call from teardown/disconnect) so a
`connect()` still mid-handshake abandons its own attempt when its awaits
resume instead of publishing to shared state the teardown just cleared.

#### Returns

`void`
