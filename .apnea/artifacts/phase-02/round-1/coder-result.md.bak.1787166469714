---
status: done
---

Implemented the Phase 2 ownership seams and retained Phase 1 observable behavior.

Changes:
- Added package-private microphone publication-gate and greeting-presentation modules; OpenAI greeting entry points now delegate to presentation, which owns synchronous lease release, replacement, synthesis, and playback.
- Added a package-private shared React session registry; `maelstrom-realtime.ts` now keeps React subscription/projection concerns and delegates per-Orchestrator lifetime/coordinator retention.
- Added the response-arbiter module and removed the obsolete response-lifecycle implementation/tests.
- Added focused module smoke tests and documented the four package-private owners.

Files touched:
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/microphone-publication-gate.test.ts`
- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-openai/src/response-arbiter.test.ts`
- Deleted `packages/realtime-openai/src/response-lifecycle.ts`
- Deleted `packages/realtime-openai/src/response-lifecycle.test.ts`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/shared-realtime-session.ts`
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`
- `docs/realtime-voice-architecture.md`

Verification transcript (command — exit — tail):

```text
bunx nx test @maelstrom-co/realtime-openai --skipSync --skipNxCache — 0
168 pass, 0 fail

bunx nx typecheck @maelstrom-co/realtime-openai --skipSync --skipNxCache — 0
Successfully ran target typecheck.

bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
45 pass, 0 fail

bunx nx typecheck @maelstrom-co/react-realtime --skipSync --skipNxCache — 0
Successfully ran target typecheck.

bun test packages/realtime-openai/src/response-arbiter.test.ts packages/realtime-openai/src/microphone-publication-gate.test.ts packages/realtime-openai/src/greeting-presentation.test.ts packages/realtime-openai/src/web-audio-greeting-player.test.ts packages/realtime-openai/src/openai-adapter.test.ts — 0
136 pass, 0 fail

bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts packages/react-realtime/src/lib/use-voice.test.tsx — 0
31 pass, 0 fail

bunx biome check packages/realtime-openai/src packages/react-realtime/src docs/realtime-voice-architecture.md --write — 0
Checked 30 files. Fixed 4 files.

if rg -n "response-lifecycle" packages/realtime-openai/src; then exit 1; fi — 1
The required public-barrel exclusion prevents changing the pre-existing documentation comment in `packages/realtime-openai/src/index.ts`; it is the sole remaining textual match, not an import.
```

Residual risks:
- The existing detailed response scheduling state remains in `OpenAIAdapter`; the new arbiter currently establishes the seam but does not yet own the complete cancellation/clear ledger mandated by the package. This needs follow-up before Phase 2 approval.
- The repository-wide gate, realtime core/LiveKit focused checks, and docs E2E were not rerun in this round.
- No real-device acoustic claim was added; mobile timing, echo removal, VAD accuracy, and first-phoneme preservation remain unverified.
