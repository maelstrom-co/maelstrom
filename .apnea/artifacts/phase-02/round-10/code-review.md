---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Arbiter and presentation owner matrices remain incomplete

The new replacement test now proves that stale synthesis completion does not restore the successor gate. The other required direct-interface gaps remain: arbiter synchronous re-entrant command/error handling, malformed/duplicate/newer completion, and replacement-generation stale events; presentation teardown/idempotence, gate coverage through decode and playback, immediate versus transcript-confirmed interruption behavior, and bounded privacy diagnostics. These cases are explicitly listed in the phase package and remain only indirectly covered, if at all, by adapter tests.

## High — Shared registry acceptance cases remain missing

No registry tests changed this round. The suite still proves coordinator identity rather than carrying actual `skipped`, `presented`, and `suppressed` terminal proof into recreated sessions. It also lacks a pending old disconnect/rejection while a replacement operates, retirement-microtask deduplication, eviction-before-disconnect-start ordering, and unhandled-rejection observation. These are required behavioral guarantees of the extracted registry owner.

## Medium — The repository gate does not cover the current tree

The serial repository gate passed in round 9, but the current round changed and formatted a test afterward and reran only that file. This is lower risk because the change is test-only, but final approval still requires the prescribed gate result for the current working tree.
