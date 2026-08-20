---
status: done
---

## Changes

- Fenced `GreetingInterruption` acceptance to its current owner operation, preventing a replaced operation's stale local-boundary callback from starting pre-roll.
- Added direct owner coverage for replacement fencing and duplicate/end/cancel local-boundary callbacks.
- Added enabled presentation coverage for natural completion and Skip: both retain generated-track gating until `startManualTurn()` settles, while raw capture remains enabled.
- Added enabled adapter coverage for both natural completion and Skip manual bridge paths.

Files touched:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 221 pass, 0 fail; 861 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

Tests use fakes and make no claims about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency. Phase 3 fallback and sender-replacement recovery remain out of scope.
