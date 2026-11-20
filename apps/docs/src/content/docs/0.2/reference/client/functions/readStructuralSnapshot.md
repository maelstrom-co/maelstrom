---
editUrl: false
next: false
prev: false
title: "readStructuralSnapshot"
---

> **readStructuralSnapshot**(`orchestrator`): [`UIStructuralSnapshot`](/reference/client/interfaces/uistructuralsnapshot/)

Defined in: packages/client/src/lib/voice-session/ui-structural-snapshot.ts:47

Visible-only structural snapshot of the Chart.

Reads Orchestrator stores without mutating the retained Instance map or
stored layout used by Engine requests and remount. Rendered IDs are the
intersection of retained IDs and getVisibleInstanceIds. Grid
positions, tiling declarations, and top-level Instances are copied and
filtered to that set. The complete tiling token array is copied iteratively;
split and existing `null` tokens keep their positions, while every other
token outside the rendered set becomes `null`. This preserves consumed
partial roots and nulls retained trailing tokens without promoting them.

## Parameters

### orchestrator

[`Orchestrator`](/reference/client/classes/orchestrator/)

## Returns

[`UIStructuralSnapshot`](/reference/client/interfaces/uistructuralsnapshot/)
