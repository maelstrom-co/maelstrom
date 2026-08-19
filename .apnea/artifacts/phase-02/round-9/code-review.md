---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Extracted owner test matrices still do not match the phase package

The full repository gate is now green, but no tests changed this round and the required direct-interface gaps remain. `response-arbiter.test.ts` still lacks synchronous re-entrant command/error sequences, malformed/duplicate/newer completion, and replacement-generation stale-event coverage. `greeting-presentation.test.ts` still does not create the successor named by its stale-completion test and lacks direct replacement, teardown, decode/playback gate-span, interruption-policy, and privacy-diagnostic cases. The phase package explicitly requires these behaviors at the new owner seams; adapter integration coverage is complementary, not a substitute.

## High — Shared registry acceptance cases remain unproved

The registry suite still asserts coordinator identity only and records none of the required `skipped`, `presented`, or `suppressed` proof before recreation. It also does not hold old disconnect completion/rejection pending while a replacement operates, assert retirement-microtask deduplication, verify eviction before disconnect starts, or observe rejection for unhandled-rejection safety. These are the central concurrency and proof-retention guarantees assigned to `SharedRealtimeSessionRegistry` and remain blocking despite the green repository gate.
