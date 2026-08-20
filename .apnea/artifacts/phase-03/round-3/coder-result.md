---
status: done
---

## Changes

- Added adapter coverage for Skip versus local acceptance as exactly one terminal publication path.
- Added playback-end versus disconnect ownership: raw stops once, generated is owner-destroyed and not adapter-stopped.
- Added post-recovery immediate and transcript-confirmed arbitration, including no second pre-roll from later `speech_started` / useful-delta.
- Added reconnect coverage where an in-flight generation-N `replaceTrack` cannot mutate the generation N+1 sender.

Files touched:

- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 250 pass, 0 fail; 991 expectations.

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

Tests use fakes and make no claims about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency. Phase 4 demo/docs work remains out of scope.
