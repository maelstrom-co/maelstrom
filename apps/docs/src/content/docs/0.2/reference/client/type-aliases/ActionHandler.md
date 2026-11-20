---
editUrl: false
next: false
prev: false
title: "ActionHandler"
---

> **ActionHandler**\<`Params`\> = \[`Params`\] *extends* \[`undefined`\] ? () => `Promise`\<[`ActionResult`](/reference/client/type-aliases/actionresult/)\> \| [`ActionResult`](/reference/client/type-aliases/actionresult/) : (`params`) => `Promise`\<[`ActionResult`](/reference/client/type-aliases/actionresult/)\> \| [`ActionResult`](/reference/client/type-aliases/actionresult/)

Defined in: packages/client/src/lib/command-processor/action-runner.types.ts:121

Handler type for an action. Supports both sync and async handlers.
- No params: returns `ActionResult` (or `Promise<ActionResult>`) directly
- With params: receives typed params object, returns `Promise<ActionResult>`

## Type Parameters

### Params

`Params`
