---
editUrl: false
next: false
prev: false
title: "RetrySeverity"
---

> **RetrySeverity** = `"none"` \| `"low"` \| `"medium"` \| `"unrecoverable"`

Defined in: packages/engine/src/lib/validation/llm-output/healed-layout.ts:176

How badly healing degraded a candidate, from `'none'` (nothing changed) to
`'unrecoverable'` (the layout came out empty although the request had
instances). `'low'` means only cosmetic repairs; `'medium'` means healing
dropped layout entries or refused actions but something still renders.
The Engine also uses it to pick the level of its heal and retry log lines.
