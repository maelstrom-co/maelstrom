---
status: done
---

# Phase 2 package — switch LiveKit to shared pre-roll

## Outcome

Replace LiveKit's package-local pre-roll implementation with the reviewed
`@maelstrom-co/realtime-vad` root export. Preserve every observable LiveKit
turn, timeout, fallback, and teardown behavior. Delete the duplicate only after
the shared import and full LiveKit suite are green. Do not add or modify OpenAI
behavior or public APIs.

## Required changes

- Update `packages/realtime-livekit/src/livekit-adapter.ts` to import
  `createLocalAudioPreRoll` and `LocalAudioPreRoll` from
  `@maelstrom-co/realtime-vad` beside existing VAD imports.
- Update LiveKit tests and mocks so they exercise the shared package export
  without bypassing existing VAD behavior.
- Delete `packages/realtime-livekit/src/local-audio-pre-roll.ts` and its test
  after the shared path is green.
- Update `packages/realtime-livekit/README.md` and
  `packages/realtime-vad/README.md` to state that the primitive is shared while
  transport lifecycle policy remains adapter-owned.
- Do not change pause-before-idle, resume-before-pre-roll, automatic/manual
  turn ordering, misfire handling, degradation, TTS cancellation, reconnect,
  or cleanup semantics.

## Acceptance

- Existing LiveKit sequence assertions remain unchanged except import/mock
  plumbing.
- VAD and LiveKit package tests, typechecks, and builds pass cache-free.
- The LiveKit-local implementation and test no longer exist.
- No OpenAI, demo, core realtime, React, dependency, or lockfile changes occur.
- Biome passes with warnings treated as errors.
- The final serial repository gate passes, with the existing documented docs
  crawler retry policy if an isolated connection reset occurs.

## Files

Required edits:

- `packages/realtime-livekit/src/livekit-adapter.ts`
- `packages/realtime-livekit/src/livekit-adapter.test.ts`
- `packages/realtime-livekit/README.md`
- `packages/realtime-vad/README.md`

Required deletions:

- `packages/realtime-livekit/src/local-audio-pre-roll.ts`
- `packages/realtime-livekit/src/local-audio-pre-roll.test.ts`

Do not touch `.apnea/state.json`, OpenAI packages, package manifests, or
`bun.lock`.

## Verify commands

```bash
bunx nx test @maelstrom-co/realtime-vad --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/realtime-vad --skipSync --skipNxCache
bunx nx build @maelstrom-co/realtime-vad --skipSync --skipNxCache
bunx nx test @maelstrom-co/realtime-livekit --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/realtime-livekit --skipSync --skipNxCache
bunx nx build @maelstrom-co/realtime-livekit --skipSync --skipNxCache
bunx biome check packages/realtime-vad packages/realtime-livekit --error-on-warnings
if test -e packages/realtime-livekit/src/local-audio-pre-roll.ts || test -e packages/realtime-livekit/src/local-audio-pre-roll.test.ts; then exit 1; fi
bunx nx run-many -t check test build typecheck --parallel=1 --skipNxCache
```

## Non-goals

- OpenAI greeting interruption or any OpenAI option.
- New audio behavior or acoustic claims.
- Changes to LiveKit turn policy.
- Refactoring unrelated LiveKit code.
