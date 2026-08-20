---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — `startAutomaticTurn` / `startManualTurn` acknowledgement timeout is not implemented.** The owner only `catch`es a rejected command. A hanging worklet acknowledgement never disarms, never requests `replacePublication`, and never fails closed. The package requires rejection *or timeout* for both commands; tests that `throw new Error('ack timeout')` do not cover a non-settling acknowledgement.

2. **High — The explicit Phase 3 fallback matrix is still incomplete.** Owner coverage exists for loader/bridge rejection, VAD setup/`onFailure`, thrown automatic/manual starts, `'failed'`/`'stale'` replace, and one acoustic-uncertainty ordering case. Still missing: delayed VAD/bridge after `destroy()`; synthesis/natural-end/Skip/replaced-operation callbacks that must not recover or flush; and a second local/provider callback that must not issue a second pre-roll or replace. Presentation still lacks synthesis-period callback plus later setup failure, and replacement fencing of stale recovery. Adapter still lacks automatic/manual start-failure integration, delayed-prepare-vs-disconnect, reconnect generation isolation, Skip-versus-acceptance single terminal, playback-end-versus-disconnect ownership, post-recovery immediate/transcript-confirmed arbitration, and no second pre-roll from later `speech_started` / useful-delta. The coder result already names several of these adapter gaps.

The phase package matches the approved plan. Pre-attachment raw fallback and the injected `replacePublication` seam are in place, and all six required Nx gates are reported green (238 / 943 openai, 93 / 266 vad).
