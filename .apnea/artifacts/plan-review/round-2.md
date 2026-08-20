---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — The local-acceptance window is not constrained to actual greeting playback.** The goal permits spoken interruption while the fixed greeting is playing, but Phase 2 describes VAD around the broader synthesis/playback operation and provides no playback-start arm/disarm transition or tests for callbacks arriving during synthesis. Because the provider item is sent and the microphone is gated before synthesis finishes, a VAD callback in that interval could stop a greeting that has not started and flush audio as an accepted interruption. Specify that detection may be prepared early but acceptance is armed only when playback begins, is fenced before/at settlement, and add pre-playback/stale-post-playback callback tests.

2. **Medium — Failure of the newly introduced lazy runtime import is not included in fallback coverage.** Phase 1 deliberately adds `import('@maelstrom-co/realtime-vad')`, but Phase 3 starts fallback coverage at bridge creation and only names VAD provider loading after attachment. A missing/corrupt chunk or dynamic-import rejection occurs before either case and must also attach the raw track behind the existing gate rather than fail `connect()`. Include runtime-loader rejection in the pre-attachment recovery step, acceptance checks, and focused tests.
