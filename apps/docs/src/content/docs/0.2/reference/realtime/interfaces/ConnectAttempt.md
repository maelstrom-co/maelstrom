---
editUrl: false
next: false
prev: false
title: "ConnectAttempt"
---

Defined in: packages/realtime/src/lib/connect-race-guard.ts:12

A single `connect()` attempt handed out by [ConnectRaceGuard.begin](/reference/realtime/classes/connectraceguard/#begin).

A provider adapter's `connect()` interleaves awaits (token mint, transport
join, mic acquisition) with shared-field writes. Between those awaits a
`disconnect()` or a newer `connect()` can overtake this one; re-checking the
attempt after each await tells the stale winner-loser apart so a superseded
attempt abandons its own resources instead of clobbering the winner's.

## Properties

### isCurrent

> `readonly` **isCurrent**: `boolean`

Defined in: packages/realtime/src/lib/connect-race-guard.ts:19

`true` while no newer `begin()` or `supersede()` has overtaken this attempt.
Non-throwing, for cleanup branches (e.g. a `catch` deciding whether to reset
shared state) — a superseded attempt must NOT run teardown, which belongs to
the winner.

## Methods

### assertCurrent()

> **assertCurrent**(): `void`

Defined in: packages/realtime/src/lib/connect-race-guard.ts:26

Throw [RealtimeVoiceError](/reference/realtime/classes/realtimevoiceerror/) `CONNECT_SUPERSEDED` if a newer attempt or a
teardown overtook this one. Call after each `connect()` await, before
publishing to shared fields, so a stale attempt aborts rather than joining a
transport nobody owns.

#### Returns

`void`
