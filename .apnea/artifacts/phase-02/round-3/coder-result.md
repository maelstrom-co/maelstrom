---
status: done
---

## Rework completed

- Retained the original captured `MediaStream` in the prepared descriptor and interruption owner.
- Passed that committed raw stream directly to `createBrowserVad`; no fabricated stream-shaped object remains.
- Added owner assertions that enabled VAD receives the exact raw stream and that disabled preparation remains raw, generated-resource-free, and does not invoke the lazy runtime loader.

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
exit 0 — 207 pass, 0 fail; 813 expectations.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0 — Successfully ran target typecheck.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0 — Successfully ran target build.
```

## Residual risks

The remaining phase-package test matrix (player lifecycle hooks, enabled presentation races, and adapter integration/teardown coverage) is still not fully represented in new direct tests. Phase 3 recovery behavior remains out of scope. No mock-based test makes a claim about real-device echo rejection, VAD accuracy, first-phoneme retention, or latency.
