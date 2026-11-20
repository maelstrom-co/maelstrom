---
editUrl: false
next: false
prev: false
title: "AssistantMessageOutcome"
---

> **AssistantMessageOutcome** = `"inserted"` \| `"deduped"`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:517

Result of an acknowledged assistant-message insertion.

- `inserted`: the engine appended the message to session history.
- `deduped`: the engine already held a message with the same id, so it
  appended nothing.

Callers use this to decide whether side effects tied to the message (for
example a caption or speech playback) already ran in a previous attempt.
Greeting flows treat `deduped` without a retained `inserted` as “already
handled” and suppress caption and speech for that greeting forever.
