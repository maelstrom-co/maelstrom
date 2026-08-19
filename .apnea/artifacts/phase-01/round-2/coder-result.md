---
status: done
---

Addressed the round-1 review findings with additional Skip race and accessibility coverage.

Changes:
- Added coordinator tests for Skip after acknowledgement/before caption and active provider handoff completion.
- Added session tests for active speech abort, duplicate notification prevention, no configured greeting, presented/suppressed no-op behavior, and disconnect rejection retention.
- Strengthened OpenAI abort coverage to assert synchronous restoration during decode and active playback.
- Added UI assertions for the sole polite live region, Skip placement, focus styling, non-wrapping text, and wrapping narrow-layout container.

Files touched:
- `packages/realtime/src/lib/greeting-coordinator.test.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `apps/demo/src/components/voice-control.test.tsx`

Verify transcript (command — exit — tail):

```text
bun test packages/realtime/src/lib/greeting-coordinator.test.ts packages/realtime/src/lib/realtime-session/realtime-session.test.ts — 0
104 pass, 0 fail

bun test packages/realtime-openai/src/openai-adapter.test.ts — 0
122 pass, 0 fail

bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
44 pass, 0 fail
bunx nx test @maelstrom-co/demo --skipSync --skipNxCache — 0
561 pass, 0 fail
bunx nx typecheck @maelstrom-co/realtime --skipSync — 0
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync --skipNxCache — 0
bunx nx typecheck @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
bunx nx typecheck @maelstrom-co/demo --skipSync --skipNxCache — 0
bunx biome check [phase-package paths] --error-on-warnings — 0
Checked 20 files. No fixes applied.

bunx nx run-many -t check test build typecheck e2e --parallel=1 --skipNxCache — 1
All non-docs targets completed. `@maelstrom-co/docs:e2e` had two unrelated flaky failures: sidebar client-side navigation did not leave its source URL, and a same-origin link crawl hit ECONNRESET. The focused docs e2e had previously passed cache-bypassed (70 passed); this rework did not alter the affected sidebar implementation or link crawler.
```

Residual risks:
- The repository-wide gate is not green because of the documented unrelated docs E2E flakes.
- Real-device acoustic claims remain unverified: mobile timing, echo removal, VAD accuracy, and first-phoneme preservation. Spoken interruption remains out of scope for Phase 1.
