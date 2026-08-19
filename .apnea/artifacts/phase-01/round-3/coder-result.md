---
status: done
---

Implemented only the requested round-3 rework coverage.

Changes:
- Added session regressions for Skip while waiting on Engine readiness, a Skip/fatal-adapter-error/late-readiness race, and normal greeting behavior for a fresh `SessionId` after another session was skipped.
- Added executable Enter and Space activation coverage for the visible native Skip button.

Files touched:
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`
- `apps/demo/src/components/voice-control.test.tsx`

Verification transcript (command — exit — tail):

```text
bun test packages/realtime/src/lib/greeting-coordinator.test.ts packages/realtime/src/lib/realtime-session/realtime-session.test.ts — 0
107 pass, 0 fail

bun test packages/realtime-openai/src/openai-adapter.test.ts — 0
122 pass, 0 fail

bun test packages/react-realtime/src/lib/use-voice.test.tsx — 1
The root direct invocation lacks the package test preload and @maelstrom-co/source condition: document is not defined.
bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/use-voice.test.tsx — 0
30 pass, 0 fail

bun test apps/demo/src/components/voice-control.test.tsx — 1
The root Bun runner does not provide Vitest's vi.doMock.
bun --cwd apps/demo test src/components/voice-control.test.tsx — 0
37 pass, 0 fail

bunx nx test @maelstrom-co/realtime --skipSync — 0
bunx nx typecheck @maelstrom-co/realtime --skipSync — 0
bunx nx test @maelstrom-co/realtime-openai --skipSync — 0
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync — 0
bunx nx build @maelstrom-co/react --skipSync --skipNxCache — 0
bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
bunx nx typecheck @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
bunx nx test @maelstrom-co/demo --skipSync --skipNxCache — 0
bunx nx typecheck @maelstrom-co/demo --skipSync --skipNxCache — 0
bunx nx test @maelstrom-co/realtime-livekit --skipSync --skipNxCache — 0

CI=1 bunx nx run @maelstrom-co/docs:e2e --skipSync --skipNxCache — 0
70 passed

bunx biome check packages/realtime/src packages/realtime-openai/src/openai-adapter.ts packages/realtime-openai/src/openai-adapter.test.ts packages/react-realtime/src/lib/maelstrom-realtime.ts packages/react-realtime/src/lib/use-voice.test.tsx apps/demo/src/components/voice-control.tsx apps/demo/src/components/voice-control.test.tsx apps/docs/e2e/fixtures/voice/openai-voice-control.tsx apps/docs/src/content/docs/guides/voice/openai-realtime.mdx docs/realtime-voice-architecture.md --error-on-warnings — 0
Checked 20 files. No fixes applied.

bunx nx run-many -t check test build typecheck e2e — 130
Concurrent task execution could not resolve @maelstrom-co/react for docs/www.

bunx nx run-many -t check test build typecheck e2e --parallel=1 --skipNxCache — 1
All other targets passed. @maelstrom-co/docs:e2e: 69 passed, 1 failed because the unchanged same-origin link crawler received ECONNRESET for /understanding/voice-architecture/.
```

Residual risks:
- The repository-wide gate remains blocked by an unrelated, reproducible docs E2E server ECONNRESET under the phase-wide run. The prescribed focused docs gate passed cleanly (70/70).
- Root-level direct Bun commands for React/demo UI files do not reproduce their configured package runners; equivalent configured invocations and Nx targets pass.
- Real-device acoustic claims remain unverified: mobile timing, echo removal, VAD accuracy, and first-phoneme preservation. Spoken interruption remains outside Phase 1.
