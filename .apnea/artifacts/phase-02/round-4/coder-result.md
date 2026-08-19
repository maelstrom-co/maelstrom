---
status: done
---

Expanded OpenAI owner-level re-entrancy, generation isolation, and bounded diagnostic coverage.

Changes:
- Added arbiter coverage for synchronous output during cancel (one clear), fatal `response.create` closure before re-entrant error work, and stale closed-generation facts being unable to command a replacement arbiter.
- Hardened the arbiter to ignore `response.created` and useful-delta facts after a generation is closed, matching generation isolation at its owner seam.
- Asserted presentation synthesis failures emit only the bounded `presentation-failed` diagnostic category, not the thrown content-bearing error.

Files touched:
- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-openai/src/response-arbiter.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`

Verification transcript (command — exit — tail):

```text
bunx biome check packages/realtime-openai/src/response-arbiter.ts packages/realtime-openai/src/response-arbiter.test.ts --write — 0
Checked 2 files. No fixes applied.

bun test packages/realtime-openai/src/response-arbiter.test.ts — 0
14 pass, 0 fail

bunx nx typecheck @maelstrom-co/realtime-openai --skipSync --skipNxCache — 0
Successfully ran target typecheck.

bunx biome check packages/realtime-openai/src/greeting-presentation.test.ts --write — 0
Checked 1 file. No fixes applied.

bun test packages/realtime-openai/src/greeting-presentation.test.ts — 0
9 pass, 0 fail
```

Residual risks:
- Direct presentation immediate/transcript-confirmed interruption routing remains partially covered by adapter integration rather than the owner seam.
- The serial repository gate has not been rerun after accumulated test and arbiter changes.
- No acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
