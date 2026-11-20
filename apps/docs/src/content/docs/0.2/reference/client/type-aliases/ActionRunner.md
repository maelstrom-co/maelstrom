---
editUrl: false
next: false
prev: false
title: "ActionRunner"
---

> **ActionRunner**\<`V`\> = `Partial`\<`{ [Name in ActionNames<V>]: ActionHandler<GetActionParams<GetAllActions<V>, Name>> }`\>

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:146

Typed action runner map keyed by action name.
All action handlers are optional, but type inference is preserved
for any handlers that are implemented.

## Type Parameters

### V

`V` *extends* `VesselDefinition` = `VesselDefinition`

## Example

```typescript
import { ok } from '@maelstrom-co/protocol';

const runner: ActionRunner<typeof myVessel> = {
  selectOrder: (params) => {
    // params is fully typed based on vessel definition
    console.log(params.orderId);
    return ok(undefined);
  },
  closeOrderDetails: () => {
    return ok(undefined);
  },
};
```
