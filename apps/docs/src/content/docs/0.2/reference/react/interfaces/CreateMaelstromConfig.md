---
editUrl: false
next: false
prev: false
title: "CreateMaelstromConfig"
---

Defined in: packages/react/src/lib/create-maelstrom.ts:33

Configuration used to create one typed React Maelstrom instance.

## Type Parameters

### T

`T` *extends* readonly `AnyVesselEntry`[]

## Properties

### cellSizePx?

> `optional` **cellSizePx?**: `number`

Defined in: packages/react/src/lib/create-maelstrom.ts:40

Grid cell size in pixels. Defaults to 80, must be positive, and may be
overridden by the Provider.

***

### debug?

> `optional` **debug?**: `boolean`

Defined in: packages/react/src/lib/create-maelstrom.ts:47

Enables client diagnostic logging. Defaults to `false`.

***

### intentQueue?

> `optional` **intentQueue?**: `IntentQueueOptions`

Defined in: packages/react/src/lib/create-maelstrom.ts:59

Mount-time shared FIFO policy. Defaults: 8 pending, 30s queue wait,
10s disconnected grace, 60s active result deadline. The deadline does not
cancel work. Provider overrides replace this object; remount to change it.
Invalid limits fail Provider construction, as in the client SDK.

***

### motion?

> `optional` **motion?**: [`ChartMotionConfig`](/reference/react/interfaces/chartmotionconfig/)

Defined in: packages/react/src/lib/create-maelstrom.ts:52

Chart motion/choreography settings. A `motion` prop on the Provider
overrides this as a whole object (no per-field merge).

***

### tilingPaddingPx?

> `optional` **tilingPaddingPx?**: `number`

Defined in: packages/react/src/lib/create-maelstrom.ts:45

Pixel gap inset around computed tiling regions. Defaults to 8, must be
non-negative, and may be overridden by the Provider.

***

### vessels

> **vessels**: `AssertNarrowIds`\<`T`\> & `T`

Defined in: packages/react/src/lib/create-maelstrom.ts:35

Vessel entries available to the Provider and generated hooks.
