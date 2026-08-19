---
status: done
---

# LiveKit shared pre-roll cutover

Implemented the approved mechanical cutover.

Changes:

- `LiveKitAdapter` imports `createLocalAudioPreRoll` and `LocalAudioPreRoll`
  from `@maelstrom-co/realtime-vad`.
- LiveKit tests mock the shared package export while retaining the actual VAD
  exports.
- Deleted the LiveKit-local pre-roll implementation and test duplicate.
- Updated LiveKit and VAD READMEs to document shared primitive ownership while
  keeping transport policy adapter-owned.
- Added the new required `clear()` method to LiveKit test bridge fakes; no
  production turn flow calls it in this phase.

Verification:

- realtime-vad test/build/typecheck: pass, 93 tests.
- realtime-livekit test/build/typecheck: pass, 145 tests.
- Biome with `--error-on-warnings`: pass across both packages.
- Duplicate-removal proof: pass.
- Serial repository gate: all non-browser work reached completion, but docs and
  www E2E failed before test execution because every Chromium process crashed
  at macOS `MachPortRendezvousServer` registration with error 141. This is an
  environment failure after the computer restart, not a source assertion.

No OpenAI files, APIs, dependencies, or behavior changed.
