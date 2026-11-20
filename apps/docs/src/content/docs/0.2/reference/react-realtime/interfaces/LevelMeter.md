---
editUrl: false
next: false
prev: false
title: "LevelMeter"
---

Defined in: packages/react-realtime/src/lib/level-meter.ts:2

A live audio level reader returned by [createLevelMeter](/reference/react-realtime/functions/createlevelmeter/).

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/react-realtime/src/lib/level-meter.ts:9

Disconnects this meter's audio nodes and, once no meter is active
anymore, suspends the shared AudioContext. The meter reads 0 afterwards.

#### Returns

`void`

***

### read()

> **read**(): `number`

Defined in: packages/react-realtime/src/lib/level-meter.ts:4

Instantaneous level in [0, 1] (RMS of the current analyser frame).

#### Returns

`number`
