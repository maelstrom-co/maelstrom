---
editUrl: false
next: false
prev: false
title: "UpdateVesselResult"
---

> **UpdateVesselResult** = \{ `ok`: `true`; \} \| \{ `conflict`: [`UpdateVesselConflict`](/reference/react/type-aliases/updatevesselconflict/); `ok`: `false`; \}

Defined in: packages/react/src/lib/vessel-entry-types.ts:211

Return type of `m.updateVessel()` and `handle.update()`.

`ok: false` is an ordinary, user-triggerable outcome, not a bug report —
check `result.conflict.code` and decide whether to retry, skip the
republish, or surface a message.
