---
status: done
---

## Rework completed

- Retained greeting VAD setup and retirement lifecycle promises.
- Terminal accepted and normal settlement now await the same VAD retirement path, including VAD instances that resolve after a disarm/settlement request.
- Added a direct late-VAD test proving settlement remains pending until the VAD resolves and destroys it exactly once.

Files changed:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`

## Verification transcript

```text
$ bunx biome check packages/realtime-openai/src/greeting-interruption.ts packages/realtime-openai/src/greeting-interruption.test.ts --error-on-warnings
exit 0 — Checked 2 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 210 pass, 0 fail; 819 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

The full enabled presentation and adapter integration/teardown matrix remains incomplete. Phase 3 fallback/recovery remains out of scope. No mock test claims real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
