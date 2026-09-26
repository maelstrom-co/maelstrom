---
name: maelstrom-voice-integration
description: >-
  Use only when the requested product goal requires adding or changing optional
  voice input for a Maelstrom application. Not for ordinary text intent, provider
  support research alone, or general realtime systems unrelated to Maelstrom.
license: MIT
metadata:
  author: Maelstrom
  version: 1.0.0
---

# Optional voice integration

1. **Confirm need and decisions.** Inspect the product goal, intent flow, app auth/server boundary, installed package versions, and deployment. Voice is optional; do not add it unless the goal needs it. Leave provider/deployment undecided when the user has not selected them; do not install packages or invent support to fill the gap.
2. **Read only the relevant portable guidance.** Use [`../references/browser-react.md`](../references/browser-react.md) for browser UI/framework ownership; [`../references/voice-lifecycle-and-turn-taking.md`](../references/voice-lifecycle-and-turn-taking.md) for session lifecycle and runtime turn mode; and [`../references/provider-deployment.md`](../references/provider-deployment.md) only after provider and deployment are selected. The downloaded bundle includes the exact canonical [`voice architecture`](../references/canonical-voice/docs/realtime-voice-architecture.md), [general architecture](../references/canonical-voice/docs/architecture.md), and [three voice ADRs](../references/canonical-voice/docs/adr/0001-realtime-providers-come-in-two-kinds.md). Use those included files; do not assume a public page links the ADRs or require a consumer checkout.
3. **Keep layers distinct.** Preserve CONTRACT, BROWSER, SERVER, and WORKER boundaries; no server or worker package may depend on a browser package. Browser UI is not automatically a Vessel. Speech supplies natural-language intent; the Engine remains the planner and uses client-owned state. Application auth/authorization remains app-owned. Never put long-lived provider keys in browser code. A server or LiveKit worker may hold the credentials required by its documented role; the LiveKit cascade worker uses LiveKit, Deepgram, and Cartesia credentials. Keep Vessel/Chart structure out of every worker so it cannot become a second planner.
4. **Preserve provider differences.** Confirm adapter APIs from installed exports/types/source/tests. Treat a provider guide as version-specific only when its version matches the installed SDK; otherwise label it current, unversioned guidance. Do not treat turn mode as a provider constant or hide speech-native versus cascade differences behind assumptions.
5. **Implement and verify only when authorized.** Keep edits bounded, add deterministic local lifecycle/failure tests where applicable, and run affected checks. Report provider/deployment choices, ownership map, API/version evidence, security risks, exact commands/results, and microphone/provider/Engine scenarios not actually exercised.

Do not claim acoustic or live provider success from source review, mocks, or typechecks. Plan-only work makes no edits.