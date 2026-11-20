---
editUrl: false
next: false
prev: false
title: "GreetingState"
---

> **GreetingState** = `"not_configured"` \| `"pending"` \| `"preparing"` \| `"settled"` \| `"skipped"`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:141

Retained presentation lifecycle of the shared session's fixed greeting.

`preparing` begins synchronously before the provider handshake and spans all
greeting work, including a wait for Engine readiness that has no timeout.
`settled` means that the current generation's greeting presentation has
finished; it does not report provider activity or prove that speech
succeeded. `skipped` is the explicit, terminal user choice not to present
the greeting. A retryable disconnect or abort returns a configured greeting
to `pending`, while retained terminal proof keeps `settled` or `skipped`
across session recreation. Work from a stale connection generation cannot
change the retained state.

This lifecycle is independent of `VoiceSessionState`, errors, transcripts,
and turn mode.
