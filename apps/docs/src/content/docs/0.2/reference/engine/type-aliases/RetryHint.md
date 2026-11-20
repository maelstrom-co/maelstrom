---
editUrl: false
next: false
prev: false
title: "RetryHint"
---

> **RetryHint** = \{ `recommend`: `false`; `severity`: `"none"`; \} \| \{ `recommend`: `false`; `severity`: `"low"`; \} \| \{ `recommend`: `false`; `severity`: `"medium"`; \} \| \{ `recommend`: `true`; `severity`: `"medium"`; \} \| \{ `recommend`: `true`; `severity`: `"unrecoverable"`; \}

Defined in: packages/engine/src/lib/validation/llm-output/healed-layout.ts:187

The Engine's verdict on a healed candidate: its `severity`
([RetrySeverity](/reference/engine/type-aliases/retryseverity/)) and whether the Engine `recommend`s asking the
planner for another attempt. A retry is recommended when the candidate
would leave the user looking at a no-op: an empty layout although the
request had instances, or every proposed action refused for a reason the
planner can fix. Only the valid pairs are representable: nothing to report
never recommends a retry, and an unrecoverable result always does.
