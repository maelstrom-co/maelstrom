---
status: done
---

Added direct re-entrancy and teardown-idempotence regression coverage.

Changes:
- Added an arbiter test where `response.cancel` synchronously re-enters with matching `response.done`; asserts a single cancel decision with no spurious command.
- Made the presentation replacement test call abort twice before stale work completes, proving idempotent teardown preserves exact microphone restoration.

Files touched:
- `packages/realtime-openai/src/response-arbiter.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`

Verification transcript (command — exit — tail):

```text
bunx biome check packages/realtime-openai/src/response-arbiter.test.ts packages/realtime-openai/src/greeting-presentation.test.ts --write — 0
Checked 2 files. No fixes applied.

bun test packages/realtime-openai/src/response-arbiter.test.ts packages/realtime-openai/src/greeting-presentation.test.ts — 0
18 pass, 0 fail
```

Residual risks:
- Direct owner coverage still does not exhaust every arbiter completion/generation projection, presentation interruption/privacy case, or registry proof/concurrency acceptance case.
- The serial repository gate passed in round 9 but has not been rerun after subsequent test-only additions.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
