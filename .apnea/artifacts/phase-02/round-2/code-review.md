---
status: done
verdict: CHANGES_REQUIRED
---

# Findings

1. **High — Browser VAD is given a cast object instead of the committed raw `MediaStream`.** `GreetingInterruption` retains only `rawTrack`, then `Operation.#startVad()` fabricates `{ getAudioTracks: () => [rawTrack] } as MediaStream`. The runtime contract and phase package require VAD to receive the original raw stream; `@ricky0123/vad-web` is entitled to use the rest of the `MediaStream` interface. Retain the committed raw stream in the owner/descriptor and pass that actual stream to `createBrowserVad`.

2. **High — The required Phase 2 test matrix remains almost entirely absent.** The rework changed no tests, total coverage remains the same two owner happy-path tests, and neither `greeting-presentation.test.ts` nor `web-audio-greeting-player.test.ts` contains lifecycle-hook coverage. Adapter tests still only prove the runtime loader ran; they do not assert generated-only attachment, generated-vs-raw gating, pre-roll/manual ordering, provider history, turn mode, post-greeting arbitration, or enabled disconnect ownership. The package explicitly requires owner tests for disabled/pre-arm/duplicate/stale/generation/VAD-retirement cases, player hook timing and failure cases, presentation Skip/replacement/join races, and adapter integration. Implement those assertions before this phase can be accepted.

The shared gate, joinable settlement, generated-track ownership, and sender-retention issues from round 1 are addressed, and the four required Nx gates are reported passing.
