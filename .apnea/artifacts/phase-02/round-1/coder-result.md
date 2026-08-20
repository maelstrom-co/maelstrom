---
status: done
---

## Changed

- Added package-private `GreetingInterruption` ownership for generated pre-roll publication, greeting-scoped VAD, arm/disarm state, one-shot local acceptance, normal live-only settlement, and bridge destruction.
- Routed enabled microphone preparation through `GreetingPresentation`; `OpenAIAdapter` attaches the generated audio track while preserving the raw microphone stream for metering and non-audio attachment.
- Added playback start/end hooks to `WebAudioGreetingPlayer` and connected them to owner arming/disarming.
- Preserved disabled raw-track/gate behavior and added direct owner coverage for one-shot automatic pre-roll and normal manual settlement.
- Extended enabled runtime test fakes with a bridge/VAD surface.

Files touched:

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Verification transcript

```text
$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0
Checked 29 files in 82ms. No fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:test
exit 0
206 pass
0 fail
Ran 206 tests across 11 files. [461.00ms]

$ bunx nx run @maelstrom-co/realtime-openai:typecheck
exit 0
NX   Successfully ran target typecheck for project @maelstrom-co/realtime-openai and 6 tasks it depends on
Run duration: 4.0s

$ bunx nx run @maelstrom-co/realtime-openai:build
exit 0
NX   Successfully ran target build for project @maelstrom-co/realtime-openai and 5 tasks it depends on

$ bunx biome check <all 6 edited TypeScript files> --error-on-warnings
exit 0
Checked 6 files in 63ms. No fixes applied.

$ bunx nx run @maelstrom-co/realtime-openai:check
exit 0
Checked 29 files in 82ms. No fixes applied.
```

## Residual risks

Phase 3 recovery remains intentionally unimplemented: lazy-load, bridge/VAD/worklet command, sender replacement, and teardown-failure fallback. Automated tests model local boundaries only and make no claim about human speech, echo rejection, VAD accuracy, first-phoneme retention, or latency.
