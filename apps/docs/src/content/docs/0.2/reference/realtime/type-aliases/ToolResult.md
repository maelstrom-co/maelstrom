---
editUrl: false
next: false
prev: false
title: "ToolResult"
---

> **ToolResult** = [`UpdateUIToolResult`](/reference/realtime/interfaces/updateuitoolresult/) \| `UIStructuralSnapshot` \| `CapabilitySnapshot`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:188

Everything an adapter can receive at [RealtimeProviderAdapter.sendToolResult](/reference/realtime/interfaces/realtimeprovideradapter/#sendtoolresult):
either the dual-field [UpdateUIToolResult](/reference/realtime/interfaces/updateuitoolresult/) from `update_ui`, or a raw
snapshot from the read-only `get_ui_state` / `get_capabilities` pulls (which
a speech-native model reads as JSON, and a speaking adapter serializes rather
than voicing). The `ok` field is present only on [UpdateUIToolResult](/reference/realtime/interfaces/updateuitoolresult/),
so adapters discriminate on it.
