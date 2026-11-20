---
editUrl: false
next: false
prev: false
title: "SimulationError"
---

> **SimulationError** = \{ `kind`: `"unknown_instance"`; `step`: `ActionStep`; \} \| \{ `kind`: `"action_not_valid"`; `step`: `ActionStep`; \} \| \{ `kind`: `"unknown_target"`; `step`: `ActionStep`; `target`: `VariantName`; \}

Defined in: packages/engine/src/lib/response/execution-plan/final-variants.ts:24

Why [finalVariants](/reference/engine/functions/finalvariants/) stopped replaying an Execution Plan. Each case
carries the `step` it stopped at; the steps before it replayed cleanly.

## Union Members

### Type Literal

\{ `kind`: `"unknown_instance"`; `step`: `ActionStep`; \}

The step names an instance missing from `instances`, or one whose Vessel is missing from `vessels`.

***

### Type Literal

\{ `kind`: `"action_not_valid"`; `step`: `ActionStep`; \}

The instance's replayed variant does not offer the step's action.

***

### Type Literal

\{ `kind`: `"unknown_target"`; `step`: `ActionStep`; `target`: `VariantName`; \}

The action's `transitionsTo` names a variant the Vessel does not define.

#### kind

> `readonly` **kind**: `"unknown_target"`

#### step

> `readonly` **step**: `ActionStep`

#### target

> `readonly` **target**: `VariantName`

The missing variant the action transitions to.
