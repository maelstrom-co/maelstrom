---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — Enabled publication gating is invisible to `GreetingPresentation`.** The adapter constructs separate `MicrophonePublicationGate` instances for presentation and `GreetingInterruption`, while `isPublicationGated` reads only presentation's gate. During an enabled greeting the generated track is gated by the owner, but `isPublicationGated` remains false, so existing immediate server events can take the ungated abort path. Share the gate or explicitly expose owner gate state, as required by the phase package.

2. **High — Presentation settlement is not joinable and does not wait for the accepted transition.** `GreetingPresentation.#settle` clears `#operation` before awaiting `interruption.settle()`. An abort/Skip-started settlement is therefore not joined by `speak()`'s `finally`, allowing `speak()` to resolve before `startManualTurn()` acknowledges and before the gate opens. Separately, `Operation.settle()` checks `accepted` but does not retain/await the in-flight `#accept()` promise, so accepted playback can resolve before `startAutomaticTurn()` completes. Store one operation-scoped terminal promise and have abort, replacement, and `finally` all join it.

3. **High — Generated-track ownership is still duplicated in adapter cleanup.** Enabled teardown calls owner destruction through presentation, then `#teardown()` also stops every sender track; `#closeAbandonedAttempt()` likewise stops sender tracks after descriptor abandonment. A generated sender track is therefore stopped both by `LocalAudioPreRoll.destroy()` and by the adapter, contrary to the package's explicit ownership rule. Adapter cleanup must stop caller-owned raw tracks only and delegate generated-track release exclusively to the descriptor/owner.

4. **Medium — Required Phase 2 state/race coverage and sender retention are absent.** `GreetingInterruption.commit()` discards the `RTCRtpSender` instead of retaining its identity for Phase 3. Only two owner tests were added; the required player and presentation test files were not changed, and the listed pre-playback, delayed-decode, hook ordering, Skip/replacement, stale callback/generation, adapter history/arbitration, and enabled disconnect cases are not covered. Implement the package's direct owner/player/presentation/adapter matrix rather than relying on the pre-existing suites.

The coder supplied passing evidence for the four required Nx gates, but those gates do not compensate for the missing behavior and assertions above.
