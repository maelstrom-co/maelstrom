---
status: done
---

Added the missing direct greeting-presentation replacement/stale-completion regression.

Changes:
- Starts a pending greeting, replaces it with a second pending greeting, resolves the stale first synthesis, and proves the successor microphone lease remains gated until the current operation is aborted.
- Renamed the prior test to describe only its synchronous Skip restoration assertion.

Files touched:
- `packages/realtime-openai/src/greeting-presentation.test.ts`

Verification transcript (command — exit — tail):

```text
bunx biome check packages/realtime-openai/src/greeting-presentation.test.ts --write — 0
Checked 1 file. Fixed 1 file.

bun test packages/realtime-openai/src/greeting-presentation.test.ts — 0
8 pass, 0 fail
```

Residual risks:
- Direct arbiter re-entrant/error and completion-projection cases, further presentation teardown/interruption/privacy cases, and the remaining registry terminal/concurrency matrix are not fully represented at their owner interfaces.
- The serial repository gate passed in round 9 before this test-only change; it was not rerun in this round.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
