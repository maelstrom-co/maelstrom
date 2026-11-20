---
editUrl: false
next: false
prev: false
title: "createLevelMeter"
---

> **createLevelMeter**(`stream`): [`LevelMeter`](/reference/react-realtime/interfaces/levelmeter/)

Defined in: packages/react-realtime/src/lib/level-meter.ts:34

Meters a live audio stream for UI feedback (voice orbs, waveforms).
Pull-based by design: call `read()` inside your own rAF loop instead of
receiving a callback, so render cadence stays under the consumer's control.
Shares one lazily-created `AudioContext` across all active meters (see
module notes above) — there is no way to supply your own context.

## Parameters

### stream

`MediaStream`

## Returns

[`LevelMeter`](/reference/react-realtime/interfaces/levelmeter/)

## Example

```ts
const meter = createLevelMeter(stream);
const level = meter.read(); // 0..1, call again each animation frame
meter.dispose(); // stops metering this stream when done
```
