---
editUrl: false
next: false
prev: false
title: "UIStructuralSnapshot"
---

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:28

Terse, structural-only view of what is on screen. Deliberately excludes
vessel domain data: the engine plans structurally and the model grounds on
shape, never contents.

`instances` lists only rendered Instances. Hidden retained Instances stay
in the command-processor store for Engine requests and remount. Every ID in
the emitted grid positions, tiling tree, and tiling declarations resolves to
an emitted top-level Instance. The copied tiling tree preserves split and
`null` tokens, including consumed partial-root geometry, but replaces every
Instance token outside the rendered set with `null`. This includes retained
tokens after the first parsed preorder root: trailing tokens remain ignored
rather than becoming rendered. `layout` is null before the first layout
applies, and then `instances` is empty.

## Properties

### chartDimensions

> `readonly` **chartDimensions**: `ChartDimensions`

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:32

***

### instances

> `readonly` **instances**: readonly `VesselInstanceSnapshot`[]

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:29

***

### layout

> `readonly` **layout**: `GridLayout` \| `TilingLayout` \| `null`

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:30

***

### layoutMode

> `readonly` **layoutMode**: `LayoutMode`

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:31
