---
status: done
---

## Changed

- Added the Phase 1 lazy runtime boundary in `greeting-interruption-runtime.ts`; its production path dynamically imports `@maelstrom-co/realtime-vad` only when enabled.
- Retained the resolved enabled/disabled greeting-interruption config in `OpenAIAdapter` and invoke the loader only during enabled connection preparation.
- Replaced the stale global test importer with an adapter-construction dependency seam. Adapter tests now inject a counted loader and prove that enabled connects call it exactly once while omitted and explicit `false` call it zero times; both default-off modes still attach the original raw track.
- Kept the loader unit tests for injection and rejection propagation.

Files touched in this rework:

- `packages/realtime-openai/src/greeting-interruption-runtime.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `.apnea/artifacts/phase-01/round-4/coder-result.md`

## Verification transcript

```text
$ bun install
exit 0
bun install v1.3.7 (ba426210)
Checked 1926 installs across 2178 packages (no changes) [308.00ms]

$ bunx nx run @maelstrom-co/realtime-vad:check
exit 0
NX   Successfully ran target check for project @maelstrom-co/realtime-vad

$ bunx nx run @maelstrom-co/realtime-vad:test
exit 0
NX target succeeded. Run duration: 1.3s.

$ bunx nx run @maelstrom-co/realtime-vad:typecheck
exit 0
NX target succeeded. Run duration: 1.1s.

$ bunx nx run @maelstrom-co/realtime-vad:build
exit 0
NX   Successfully ran target build for project @maelstrom-co/realtime-vad

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0
NX target succeeded. Run duration: 307ms.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0
NX target succeeded. Run duration: 542ms.

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0
NX target succeeded. Run duration: 3.5s.

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0
NX   Successfully ran target build for project @maelstrom-co/realtime-openai and 5 tasks it depends on

$ bunx biome check <all 13 edited TypeScript files> --error-on-warnings
exit 0
Checked 13 files in 63ms. No fixes applied.

$ bunx nx run @maelstrom-co/realtime-vad:check
exit 0
Checked 17 files in 18ms. No fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0
Checked 27 files in 59ms. No fixes applied.
```

## Residual risks

The enabled branch deliberately establishes only the lazy loader boundary. It does not create a bridge, VAD lease, generated track, or greeting-interruption lifecycle; those remain later phases. Mocked loader tests establish call ordering and isolation only, not device/VAD/acoustic behavior.
