---
status: done
---

## Changes

- Added a 250 ms acknowledgement timeout around `startAutomaticTurn` / `startManualTurn` so a hanging worklet never leaves publication open. Tests can inject `commandTimeoutMs`.
- Fenced delayed prepare after `destroy()` with a prepare epoch so a late bridge is destroyed locally and never committed.
- Extended owner, presentation, and adapter tests for hanging acks, delayed VAD/bridge after destroy, post-settlement/Skip/replacement callback fencing, synthesis-period non-flush, automatic/manual start-failure replace, delayed-prepare-vs-disconnect, and reconnect generation isolation.

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
exit 0 — 246 pass, 0 fail; 971 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.

$ bunx nx run @maelstrom-co/realtime-vad:test
exit 0 — 93 pass, 0 fail; 266 expectations.

$ bunx nx run @maelstrom-co/realtime-vad:typecheck
exit 0 — Successfully ran target typecheck.
```

## Residual risks

Dedicated adapter cases for Skip-versus-acceptance single terminal, playback-end-versus-disconnect ownership, and post-recovery immediate/transcript-confirmed arbitration remain thinner than the owner/presentation matrix. Tests use fakes and make no claims about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
