---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

## High — Remaining arbiter/presentation owner cases are still missing

The registry proof additions resolve the terminal-reason gap. The phase package's remaining direct owner requirements are unchanged: arbiter re-entrant output/clear and fatal-error notification behavior, plus explicit old/new generation isolation; and greeting-presentation interruption routing and bounded privacy diagnostics. Add focused assertions that re-entrant sinks cannot recursively command, a closed old arbiter cannot affect a replacement, and presentation diagnostics expose only bounded categories without text/bytes/media/error content.

## High — Registry teardown ordering is only partially proved

The pending rejection test shows an old rejection does not evict a retained replacement, but the package requires both completion and rejection isolation and eviction before disconnect starts. Parameterize the pending teardown for resolve/reject, and assert from the old disconnect callback (or an equivalent synchronous observation) that `getOrCreate()` already returns a replacement before asynchronous teardown begins.

## Medium — Final gate evidence predates current tests

The serial repository gate passed in round 12, before rounds 13–15 added tests. Rerun it after the remaining owner cases are complete so approval evidence reflects the final working tree.
