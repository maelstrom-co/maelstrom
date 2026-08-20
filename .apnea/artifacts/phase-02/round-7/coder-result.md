---
status: done
---

## Rework completed

- Added direct owner coverage that a local boundary captured while armed cannot become accepted after the connection generation changes; no automatic pre-roll command is emitted.

Files changed:

- `packages/realtime-openai/src/greeting-interruption.test.ts`

## Verification transcript

```text
$ bunx biome check packages/realtime-openai/src/greeting-interruption.test.ts --error-on-warnings
exit 0 — Checked 1 file; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0 — Checked 29 files; no fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0 — 213 pass, 0 fail; 824 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

The enabled presentation and adapter integration/teardown test matrix remains incomplete. Phase 3 fallback/recovery is out of scope. Tests make no claim about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
