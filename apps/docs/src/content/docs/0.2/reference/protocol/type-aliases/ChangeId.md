---
editUrl: false
next: false
prev: false
title: "ChangeId"
---

> **ChangeId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"ChangeId"`\>

Defined in: packages/protocol/src/lib/agent-ids.ts:84

Identifies one UI change the Engine asks the browser to apply. The browser
echoes it in its `ui_applied` acknowledgement so the loop can pair the
applied Chart state with the change that produced it.
