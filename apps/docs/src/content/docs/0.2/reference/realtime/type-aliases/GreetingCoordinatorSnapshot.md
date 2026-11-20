---
editUrl: false
next: false
prev: false
title: "GreetingCoordinatorSnapshot"
---

> **GreetingCoordinatorSnapshot** = \{ `lifecycle`: `"pending"`; \} \| \{ `lifecycle`: `"terminal"`; `reason`: [`GreetingTerminalReason`](/reference/realtime/type-aliases/greetingterminalreason/); \}

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:40

Minimal replay-eligibility proof retained by [GreetingCoordinator](/reference/realtime/classes/greetingcoordinator/).
`terminal` means replay is forbidden; `pending` permits a later generation.
The snapshot deliberately contains no provider phase, failure, or run
disposition.
