---
status: done
---

Completed the remaining direct shared-session registry teardown ordering coverage.

Changes:
- Added a disconnect-callback assertion proving a zero-consumer entry is evicted before its asynchronous disconnect starts.
- Added pending old-disconnect completion isolation alongside the existing pending rejection case; neither old outcome can affect a retained replacement.

Files touched:
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`

Verification transcript (command — exit — tail):

```text
bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts — 0
10 pass, 0 fail

bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
54 pass, 0 fail
```

Residual risks:
- Direct presentation interruption/privacy-diagnostic coverage and arbiter re-entrant output/clear/fatal-error plus generation-isolation projections remain incomplete.
- The serial repository gate has not been rerun after accumulated test additions.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
