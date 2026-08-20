---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — Greeting-only VAD retirement is not one-shot.** `Operation.disarm()` calls `#vad.destroy()` every time it is invoked and never records a retirement promise/state. Normal playback end is followed by presentation settlement and operation settlement, each of which disarms again; accepted playback adds further disarms from the stop hook and acceptance completion. A VAD that resolves after disarm is also destroyed in `#startVad()` and then again by later settlement. The phase package requires retirement exactly once. Add an idempotent retire operation/promise and assert an exact destroy count across natural, accepted, late-resolution, Skip, replacement, and disconnect paths.

2. **High — The mandatory Phase 2 integration/race test matrix is still not implemented.** The coder result explicitly leaves player hooks, enabled presentation races, and adapter integration/teardown uncovered. Only one additional owner test was added. There are still no direct assertions for hook timing/failures, pre-playback and stale callbacks, Skip/replacement settlement joining, generated-only sender attachment and gating, provider history/no-response behavior, post-greeting arbitration/turn mode, or successful enabled disconnect ownership. These are explicit Phase 2 deliverables, not Phase 3 fallback tests, and must be added before approval.

The original raw `MediaStream` is now correctly retained and passed to browser VAD, and all four required Nx gates are reported passing.
