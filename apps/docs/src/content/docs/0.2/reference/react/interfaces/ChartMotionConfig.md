---
editUrl: false
next: false
prev: false
title: "ChartMotionConfig"
---

Defined in: packages/react/src/lib/chart/motion/motion-config.ts:6

Choreography settings for Chart layout changes. All motion honors
`prefers-reduced-motion: reduce` regardless of these values — the media
preference always wins over configuration.

## Properties

### disabled?

> `readonly` `optional` **disabled?**: `boolean`

Defined in: packages/react/src/lib/chart/motion/motion-config.ts:14

Disables all chart motion when true. Default false.

***

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Defined in: packages/react/src/lib/chart/motion/motion-config.ts:8

Move/resize + enter/exit duration in ms. Default 350.

***

### easing?

> `readonly` `optional` **easing?**: `string`

Defined in: packages/react/src/lib/chart/motion/motion-config.ts:10

CSS easing for all chart animations. Default 'cubic-bezier(0.22, 1, 0.36, 1)'.

***

### staggerMs?

> `readonly` `optional` **staggerMs?**: `number`

Defined in: packages/react/src/lib/chart/motion/motion-config.ts:12

Per-vessel delay in reading order for enter/move waves. Default 30.
