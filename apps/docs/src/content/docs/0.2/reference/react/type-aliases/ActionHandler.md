---
editUrl: false
next: false
prev: false
title: "ActionHandler"
---

> **ActionHandler**\<`Params`\> = \[`Params`\] *extends* \[`undefined`\] ? () => `Promise`\<[`ActionResult`](/reference/react/type-aliases/actionresult/)\> \| [`ActionResult`](/reference/react/type-aliases/actionresult/) : (`params`) => `Promise`\<[`ActionResult`](/reference/react/type-aliases/actionresult/)\> \| [`ActionResult`](/reference/react/type-aliases/actionresult/)

Defined in: packages/client/dist/lib/command-processor/action-runner.types.d.ts:50

Handler type for an action. Supports both sync and async handlers.
- No params: returns `ActionResult` (or `Promise<ActionResult>`) directly
- With params: receives typed params object, returns `Promise<ActionResult>`

## Type Parameters

### Params

`Params`
