---
status: done
---

## Changes

- Pre-attachment fallback: loader or `createLocalAudioPreRoll` rejection now returns a raw `generated: false` descriptor, emits `runtime-unavailable` / `bridge-unavailable`, and lets `connect()` succeed without wrapping those failures as `CONNECTION_FAILED`.
- Post-attachment recovery: VAD setup/`onFailure` and automatic/manual start rejection request a generation-fenced adapter `replaceTrack(raw)` after raw is disabled. Successful replace destroys only the generated bridge; `'failed'` stays gated and emits `CONNECTION_FAILED`; `'stale'` does not mutate a newer sender.
- Later greetings on a recovered connection fall back to the existing raw `MicrophonePublicationGate`. Diagnostics stay on the allowlist.

Files touched:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 238 pass, 0 fail; 943 expectations.

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

Adapter coverage still needs more delayed-prepare, reconnect-generation, and automatic/manual start-failure integration cases. Tests use fakes and make no claims about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency. Phase 4 demo/docs work remains out of scope.
