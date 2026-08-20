---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — Settlement starts VAD retirement but does not join it.** `disarm()` discards the promise returned by `#retireVad()`, and both `#accept()` and `settle()` can resolve while `vad.destroy()` is still pending. If VAD creation is still pending, settlement can resolve before the VAD even exists and before the deferred retirement runs. The phase package requires greeting-only VAD to be retired as part of accepted/normal settlement. Retain the setup/retirement lifecycle promise and have terminal settlement await the single retirement operation, including the late-VAD-resolution case.

2. **High — The required enabled presentation and adapter matrix remains incomplete.** The coder result explicitly acknowledges this. No enabled-owner harness was added to `greeting-presentation.test.ts`, and `openai-adapter.test.ts` still lacks generated-only attachment/gating, accepted/manual ordering, provider-history/no-response, turn-mode/arbitration, sender identity, and enabled disconnect assertions. Player coverage adds only natural end and repeated stop; hook behavior for abort, decode-time stop, source-start failure, thrown hooks, and delayed decode is still missing. These are explicit Phase 2 acceptance tests and cannot be deferred to Phase 3 recovery.

VAD destruction invocation is now idempotent, the raw stream fix remains correct, and all four required Nx gates are reported passing.
