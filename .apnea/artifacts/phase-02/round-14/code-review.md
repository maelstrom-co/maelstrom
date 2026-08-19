---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Registry terminal and pending-teardown cases remain absent

No registry tests changed. The phase package requires `presented` and `suppressed` proof to survive recreation in addition to `skipped`, and requires a replacement session to remain independent while the old disconnect is genuinely pending or rejects. The current fake disconnect settles immediately, so eviction-before-disconnect-start, pending completion/rejection isolation, and explicit unhandled-rejection safety are still not demonstrated.

## High — Remaining owner-level projections are still untested

The new conservative-completion arbiter sequence covers omitted/wrong/non-empty/duplicate facts, but direct re-entrant output/clear and fatal-error notification behavior plus replacement-generation stale events remain missing. Presentation still lacks the phase package's interruption-routing and bounded privacy-diagnostic characterization. These are the remaining explicitly enumerated owner tests.

## Medium — Final gate evidence predates current tests

The serial repository gate passed in round 12, before rounds 13–14 added tests. Rerun it on the final working tree after the remaining acceptance cases are added.
