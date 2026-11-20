---
editUrl: false
next: false
prev: false
title: "SummarizeFn"
---

> **SummarizeFn** = (`snapshot`) => `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:123

Pure, model-free formatter turning a structural snapshot into a short
sentence. Injectable so callers can swap in richer copy without touching
sequencing logic; the default is deterministic and O(1) — grounding must
never involve a model call.

Backs two paths: every latest-wins grounding push and the structural
fallback summary for an `update_ui` tool result. It does not summarize the
direct `get_ui_state` pull, which returns its UIStructuralSnapshot
directly. That snapshot already contains visible-only Instances. When the
settled [SubmitIntentResult](/reference/realtime/interfaces/submitintentresult/) carries a non-empty `userMessage`, that
engine reply remains the preferred product voice over the structural
fallback.

## Parameters

### snapshot

`UIStructuralSnapshot`

## Returns

`string`
