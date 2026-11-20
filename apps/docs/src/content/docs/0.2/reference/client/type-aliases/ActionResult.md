---
editUrl: false
next: false
prev: false
title: "ActionResult"
---

> **ActionResult** = [`Result`](/reference/client/type-aliases/result/)\<`undefined`, `Error`\>

Defined in: packages/client/src/lib/command-processor/action-result.ts:22

Result returned by a vessel action handler.

Domain alias over the protocol's generic `Result` that tightens the
error channel to `Error`. Vessel author handlers signal success with
`ok(value)` and failure with `err(new Error(...))` from
`@maelstrom-co/protocol`.

## Example

```typescript
import { ok, err } from '@maelstrom-co/protocol';
import type { ActionResult } from '@maelstrom-co/client';

const handler = async (params: { orderId: string }): Promise<ActionResult> => {
  if (!params.orderId) return err(new Error('orderId required'));
  return ok(undefined);
};
```
