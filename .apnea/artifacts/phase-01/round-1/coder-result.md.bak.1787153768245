---
status: done
---

Implemented Phase 1 explicit Skip greeting.

Changed:
- Added terminal `skipped` coordinator proof/reason and synchronous idempotent `skip()` arbitration.
- Added `RealtimeSession.skipGreeting()` with coordinator → abort/release → retained-state ordering.
- Exposed stable `UseVoiceResult.skipGreeting`, rendered accessible Skip greeting UI, and updated fixture/docs.
- Restored OpenAI greeting microphone gates synchronously on caller abort.
- Added coordinator, session, React, OpenAI, and UI regression coverage.

Files touched: only the Phase 1 required source/test/docs files listed in the package.

Verify transcript (command — exit — tail):

```text
bun test packages/realtime/src/lib/greeting-coordinator.test.ts packages/realtime/src/lib/realtime-session/realtime-session.test.ts — 0
100 pass, 0 fail

bun test packages/realtime-openai/src/openai-adapter.test.ts — 0
121 pass, 0 fail

bun test packages/react-realtime/src/lib/use-voice.test.tsx — 1
Direct Bun lacks the DOM test environment (document is not defined). Equivalent Nx package test passed: 44 pass, 0 fail.

bun test apps/demo/src/components/voice-control.test.tsx — 1
Direct Bun cannot run Vitest's vi.doMock. Equivalent Nx package test passed: 560 pass, 0 fail.

bunx nx test @maelstrom-co/realtime --skipSync — 0
bunx nx typecheck @maelstrom-co/realtime --skipSync — 0
bunx nx test @maelstrom-co/realtime-openai --skipSync — 0
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync — 0
bunx nx test @maelstrom-co/react-realtime --skipSync — 0
44 pass, 0 fail
bunx nx typecheck @maelstrom-co/react-realtime --skipSync — 0
bunx nx test @maelstrom-co/demo --skipSync — 0
560 pass, 0 fail
bunx nx typecheck @maelstrom-co/demo --skipSync — 0
bunx nx test @maelstrom-co/realtime-livekit --skipSync — 0
153 pass, 0 fail
CI=1 bunx nx run @maelstrom-co/docs:e2e --skipSync --skipNxCache — 0
70 passed
bunx biome check [package command paths] --error-on-warnings — 0
Checked 20 files. No fixes applied.

bunx nx run-many -t check test build typecheck e2e — 130
Repository-wide parallel gate failed in pre-existing/cache-sensitive package build resolution: @maelstrom-co/react entry was unavailable to www/docs, causing dependent docs/www e2e/typecheck failures. Focused docs e2e passed after a cache-bypassed rebuild.
```

Residual risks:
- Acoustic behavior remains unverified: mobile timing, echo removal, VAD accuracy, and first-phoneme preservation.
- Spoken greeting interruption is intentionally out of scope for this phase.
- The repository-wide parallel gate remains blocked by unrelated flaky/stale package build resolution; focused required checks pass.
