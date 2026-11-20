---
editUrl: false
next: false
prev: false
title: "finalVariants"
---

> **finalVariants**(`instances`, `actions`, `vessels`): `Result`\<`ReadonlyMap`\<`InstanceId`, `VariantName`\>, [`SimulationError`](/reference/engine/type-aliases/simulationerror/)\>

Defined in: packages/engine/src/lib/response/execution-plan/final-variants.ts:53

Replays an Execution Plan's actions in order and returns the variant each
instance ends in.

An action with `transitionsTo` moves its instance to that variant, and each
later action resolves against the variant reached so far. Any other action
leaves the variant unchanged, as do instances no action targets.

Where the Engine skips an action it cannot resolve and carries on, this
replay stops at the first such action and returns a [SimulationError](/reference/engine/type-aliases/simulationerror/),
so a planner can reject or repair the plan before handing it over.

## Parameters

### instances

readonly `Readonly`\<`Pick`\<`VesselInstanceSnapshot`, `"instanceId"` \| `"vesselId"` \| `"variant"`\>\>[]

The instances and their variants before the plan runs.

### actions

readonly `Readonly`\<`Pick`\<`ActionExecution`, `"instanceId"` \| `"action"`\>\>[]

The plan's actions, in execution order.

### vessels

readonly `object`[]

The catalog the instances belong to.

## Returns

`Result`\<`ReadonlyMap`\<`InstanceId`, `VariantName`\>, [`SimulationError`](/reference/engine/type-aliases/simulationerror/)\>
