---
status: done
---

## Rework completed

Addressed the round-1 review findings within the Phase 2 package:

- Shared the same `MicrophonePublicationGate` between `GreetingPresentation` and `GreetingInterruption`, so enabled generated-track gating is visible through `isPublicationGated`.
- Made owner acceptance and normal settlement joinable. The accepted automatic pre-roll transition is retained and settlement waits for it; presentation retains a per-operation terminal promise so `finally`, abort, and enabled replacement join the same bridge transition.
- Removed adapter sender-track stopping from ordinary and abandoned cleanup. Raw stream tracks remain adapter-owned; generated publication destruction remains owner/bridge-owned.
- Retained the committed sender identity in the owner for the Phase 3 replacement seam.

Files changed:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/openai-adapter.ts`

## Verification transcript

```text
$ bun test --cwd packages/realtime-openai src/greeting-presentation.test.ts
exit 0 — 9 pass, 0 fail

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 206 pass, 0 fail; 808 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

Phase 3 recovery behavior remains out of scope: runtime/bridge/VAD/worklet failure fallback and sender `replaceTrack` recovery. The tests are mock-based and make no claim about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
