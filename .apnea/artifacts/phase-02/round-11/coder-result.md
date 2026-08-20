---
status: done
---

## Changes

- Added enabled presentation coverage that synthesis/decode cannot create or accept a local boundary, and that replacement fences stale playback hooks plus the replaced operation's local-boundary callback.
- Added enabled adapter coverage that, after greeting settlement, immediate mode still does not create a response from raw `speech_started`, transcript-confirmed mode still creates one response from a committed useful transcript, and the adapter still exposes no `turnControl` and emits no `turn_mode` event.

Files touched:

- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 224 pass, 0 fail; 886 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

Tests use fakes and make no claims about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency. Phase 3 fallback and sender-replacement recovery remain out of scope.
