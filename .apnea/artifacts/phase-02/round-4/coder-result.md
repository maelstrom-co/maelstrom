---
status: done
---

## Rework completed

- Made greeting-only VAD retirement idempotent with a single retained retirement promise. Repeated disarm, settlement, playback hooks, late VAD resolution, and accepted completion now join one `destroy()` call.
- Strengthened the accepted-boundary owner assertion to require exactly one VAD destroy.
- Added Web Audio player lifecycle-hook coverage for start-after-source-start, end-before-play resolution, and repeated-stop exact-once end delivery.

Files changed:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`

## Verification transcript

```text
$ bunx biome check packages/realtime-openai/src/greeting-interruption.ts packages/realtime-openai/src/greeting-interruption.test.ts packages/realtime-openai/src/web-audio-greeting-player.test.ts --error-on-warnings
exit 0 — Checked 3 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 209 pass, 0 fail; 817 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

The full required enabled presentation and adapter integration/teardown test matrix remains incomplete. Phase 3 fallback/recovery behavior is out of scope. No mock test claims real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
