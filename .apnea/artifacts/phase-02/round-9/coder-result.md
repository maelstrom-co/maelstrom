---
status: done
---

## Changes

- Added an arm epoch to reject a stale local-boundary callback after a disarm/re-arm transition.
- Extended owner tests for stale-boundary fencing and Skip manual-bridge-before-gate-release ordering.
- Added an enabled `GreetingPresentation` harness covering provider handoff before synthesis, generated-only gating, raw-track continuity, and accepted playback interruption.
- Added enabled adapter integration coverage for generated audio sender identity, preserved non-audio attachment, raw-stream identity, local acceptance ordering, no `response.create`, and generated-vs-raw teardown ownership.

Files touched:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bun test --cwd packages/realtime-openai src/greeting-interruption.test.ts src/greeting-presentation.test.ts src/openai-adapter.test.ts
exit 0 — 154 pass, 0 fail.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 217 pass, 0 fail; 848 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

Tests use fakes and do not establish real-device echo rejection, VAD accuracy, first-phoneme retention, or latency. Phase 3 fallback and sender-replacement recovery remain out of scope.
