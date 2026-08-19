---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Shared-session registry acceptance matrix remains incomplete

The repository gate is now green, but no registry tests changed. `shared-realtime-session.test.ts` still asserts coordinator identity rather than carrying actual `skipped`, `presented`, and `suppressed` proof through recreation. It also does not hold an old disconnect completion/rejection pending while a replacement operates, assert retirement-microtask deduplication and eviction-before-disconnect ordering, or observe rejected cleanup for unhandled-rejection safety. These are explicit required tests for the new owner.

## High — Required direct arbiter/presentation cases remain absent

No owner tests changed this round. The arbiter suite still lacks the phase package's malformed/duplicate/newer completion cases, re-entrant output/clear and fatal-error notification behavior, and replacement-generation stale events. Presentation still lacks direct synthesis→decode→playback gate-span, immediate versus transcript-confirmed interruption, and bounded privacy-diagnostic tests. A green adapter integration/repository suite is valuable evidence, but the package explicitly requires these invariants to be characterized at the extracted module interfaces as part of making them deep owners.
