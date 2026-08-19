---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Several owner tests still do not prove the invariants they claim

The committed-first arbiter case queues `first` behind an active response but never settles that response and proves `first` drains; re-entrant command/error handling, malformed/duplicate/newer completion, and replacement-generation stale events remain absent. The presentation test named “stale completion cannot stop successor” still creates no successor, and there is still no direct replacement, teardown, gate-through-decode/playback, immediate/transcript-confirmed interruption, or privacy-diagnostic coverage. These are explicit focused-interface requirements in the phase package, not merely optional additional tests.

## High — Registry terminal proof is recorded after recreation, not carried through it

In `shared-realtime-session.test.ts`, the old entry is retired and the replacement is created before `retained.skip(...)` is called. The test therefore proves only that the same coordinator object is reused; it does not prove that pre-existing `skipped` proof survives recreation. It also does not cover `presented` or `suppressed` proof, a pending old disconnect/rejection while the replacement operates, retirement-microtask deduplication, or unhandled-rejection observation. Record each terminal reason before retirement and assert it from the recreated session/coordinator.

## High — The final repository gate is still missing

Focused docs E2E now passes and the accumulated package/type/build evidence is green, but the required serial repository gate was not rerun. The prescribed helper-removal check also still lacks a successful result, even if its only textual match is the prohibited pre-existing barrel comment. Complete or explicitly isolate both checks according to the phase package before approval.
