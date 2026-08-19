---
status: done
---

Expanded the shared-session registry's direct terminal-proof and asynchronous teardown coverage.

Changes:
- Added recreated-session proof retention tests for both `presented` and `suppressed` terminal coordinator snapshots.
- Added a genuinely pending old-disconnect rejection scenario: a replacement is retained before the old rejection settles, and the rejection cannot evict or affect the replacement.

Files touched:
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`

Verification transcript (command — exit — tail):

```text
bunx biome check packages/react-realtime/src/lib/shared-realtime-session.test.ts --write — 0
Checked 1 file. Fixed 1 file.

bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts — 0
8 pass, 0 fail
```

Residual risks:
- Registry eviction-before-disconnect ordering is covered indirectly by recreation but is not asserted from within a disconnect callback; completion isolation is less direct than the added rejection isolation.
- Presentation direct interruption/privacy diagnostics and arbiter re-entrant output/clear/fatal-error plus replacement-generation stale-event cases remain partial.
- The serial repository gate passed in round 12 before rounds 13–15 test-only additions; it was not rerun in this round.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
