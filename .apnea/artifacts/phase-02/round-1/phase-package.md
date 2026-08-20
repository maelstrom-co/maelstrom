---
status: done
---

# Phase 2 package: playback-scoped greeting interruption

## Intent

Implement the enabled happy path behind the Phase 1 opt-in. A package-private owner must publish a generated `LocalAudioPreRoll` track, accept at most one local speech boundary only after greeting playback starts, stop playback before opening publication, and then leave ordinary OpenAI server VAD in sole control.

This phase covers successful runtime loading, bridge creation, VAD creation, and worklet commands. Phase 3 owns lazy-load, bridge, VAD, worklet-command, sender-replacement, and teardown failure recovery. Do not weaken default-off behavior while adding the enabled path.

## Files to touch

- `packages/realtime-openai/src/greeting-interruption.ts` (new)
- `packages/realtime-openai/src/greeting-interruption.test.ts` (new)
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

## Files not to touch

- `packages/realtime-openai/src/index.ts`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-openai/src/greeting-interruption-runtime.ts`
- `packages/realtime-openai/src/greeting-interruption-runtime.test.ts`
- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-vad/**`
- `packages/realtime-openai/package.json`
- `bun.lock`
- `apps/demo/**`
- `apps/docs/**`
- `.apnea/state.json`

Use the Phase 1 `loadGreetingInterruptionRuntime` seam as-is. Do not add a static import of `@maelstrom-co/realtime-vad` runtime code.

## Exact steps

### 1. Define the package-private owner and its boundaries

Create `greeting-interruption.ts`. Keep every export package-private by leaving the file out of `src/index.ts`.

The owner should receive these dependencies through constructor options rather than reach into `OpenAIAdapter`:

- the already resolved `ResolvedBrowserVadConfig`;
- the existing `MicrophonePublicationGate`;
- the current-generation reader;
- the Phase 1 runtime loader, or a narrow injected loader calling it;
- a callback that synchronously stops local greeting playback;
- a bounded diagnostic callback.

The owner must hold:

- one committed raw source stream/audio track;
- one `LocalAudioPreRoll` bridge and its generated track;
- one attached `RTCRtpSender` identity for Phase 3 recovery;
- one connection generation;
- at most one active greeting operation;
- the operation's arm epoch and accepted/disarmed state;
- the VAD setup/result and one-shot retirement state;
- an idempotent transition promise for acceptance or normal settlement.

Do not give the owner the OpenAI data channel, greeting text/id, response arbiter, transcript state, or session event emitter. It must not send provider frames or append history.

Use type-only imports for realtime-VAD runtime types if needed. Production runtime values must come from `loadGreetingInterruptionRuntime()`.

### 2. Add prepared-publication ownership

Add a narrow prepare/commit boundary between `GreetingPresentation` and `OpenAIAdapter`.

Recommended shape:

- `GreetingPresentation.prepareMicrophone(rawStream)` delegates to the owner and returns an attempt-local descriptor.
- The descriptor identifies the raw source audio track, the track to attach, whether it is owner-generated, and an idempotent `abandon()` cleanup.
- After `RTCPeerConnection.addTrack`, `GreetingPresentation.attachMicrophone(descriptor, sender, generation)` commits the descriptor to the current owner generation.
- `GreetingPresentation.disconnect()` aborts the active operation and begins owner cleanup.

For disabled config, preserve the current path exactly:

- no runtime loader call;
- no bridge or descriptor-owned resource;
- attach every original track;
- retain the existing raw-stream greeting lease.

For enabled config:

1. Call `loadGreetingInterruptionRuntime()` through the existing lazy seam.
2. Select the original audio track from the acquired microphone stream.
3. Call `runtime.createLocalAudioPreRoll(sourceAudioTrack)`.
4. Return the bridge's generated track as the publication audio track.
5. Keep the original stream and track enabled and caller-owned for VAD, pre-roll input, and metering.
6. Do not publish both raw and generated audio tracks.
7. Preserve any non-audio tracks in the adapter's existing loop.

Preparation is attempt-local until commit. If the connect guard rejects after an await but before commit, invoke the descriptor's `abandon()` so its bridge/generated track cannot leak. Phase 3 will broaden stale/failure coverage, but the successful and straightforward superseded-attempt paths must have an ownership seam now.

### 3. Make `OpenAIAdapter` only prepare, attach, and delegate

Pass the Phase 1 resolved `#greetingInterruption` config into `GreetingPresentation` construction. Remove the direct `loadGreetingInterruptionRuntime()` call and import from `openai-adapter.ts`; enabled preparation now belongs behind presentation/owner.

In `connect()` after raw microphone acquisition:

1. Ask presentation to prepare the microphone publication.
2. Re-check `attempt.assertCurrent()` after preparation.
3. Add the generated audio track instead of its matching raw audio track when enabled.
4. Capture the returned `RTCRtpSender` for that publication track.
5. Start/obtain the committed connection generation using the existing adapter generation boundary.
6. Commit the prepared descriptor and sender to presentation for that generation.
7. Continue attaching non-audio tracks unchanged.
8. Publish `#micStream = rawStream`, never a generated-only stream.

Keep `getAudioStreams().mic` unchanged. Level metering must still receive the original capture stream.

Do not implement `replaceTrack` recovery in this phase. Retain sender identity only so Phase 3 can add the generation-fenced replacement.

Ensure abandoned connect cleanup distinguishes caller-owned raw tracks from owner-generated tracks. Raw tracks remain stopped by adapter attempt cleanup. Generated tracks remain stopped/destroyed by descriptor/owner cleanup; do not silently create two owners.

### 4. Move enabled greeting gating into the owner

Keep the disabled `GreetingPresentation` lease flow unchanged.

For enabled presentation:

- Begin one owner operation only after the exact assistant provider item has been sent successfully.
- Gate the generated publication track, not the raw source track. The raw track must remain enabled so pre-roll and local VAD can observe it.
- A temporary `MediaStream` wrapper around the generated track may be used with `MicrophonePublicationGate`; the wrapper does not own or stop the track.
- Keep the bridge closed/silent while synthesis and decode are pending.
- Expose owner gate activity through `GreetingPresentation.isPublicationGated` so existing immediate-mode event logic retains its meaning.

The owner operation should expose synchronous `arm()` and `disarm()` methods plus an idempotent asynchronous `settle()` method. `GreetingPresentation.abort()` must synchronously disarm and stop local playback, then begin the same settlement promise. `speak()` must await that promise in `finally` so normal completion does not resolve before publication reaches its successful live state.

Keep operation identity checks from the existing presentation. A stale caller abort or stale playback hook must not settle a replacement operation.

### 5. Scope acceptance to actual Web Audio playback

Extend `WebAudioGreetingPlayer.play` with a package-private lifecycle-hooks argument, for example:

```ts
interface GreetingPlaybackHooks {
  readonly onPlaybackStart?: () => void;
  readonly onPlaybackEnd?: () => void;
}
```

Implement these exact rules:

- Call `onPlaybackStart` once only after `source.start(0)` returns successfully.
- Do not call start for readiness failure, synthesis failure, delayed/failed decode, pre-abort, or `source.start` failure.
- Track whether playback actually started in `PlaybackHandle`.
- For started playback, call `onPlaybackEnd` synchronously and once before the play promise settles on natural `onended`, `stop()`, or abort.
- `stop()` remains idempotent and must not emit a second end hook.
- If a hook throws, contain it inside the package-private playback/presentation boundary, stop the source safely, and settle once; do not leave a hanging play promise.

`GreetingPresentation` passes operation-scoped hooks:

- start hook calls `ownerOperation.arm()` only if that presentation operation is still current;
- end hook calls `ownerOperation.disarm()` before the player promise settles;
- final settlement calls `disarm()` again safely before `settle()`.

The current shared `createBrowserVad` API does not expose the instant at which its internal provider callback was observed. Therefore, to guarantee the approved playback-only boundary, do not start `createBrowserVad` during synthesis/decode. Runtime and bridge preparation may happen earlier, but initiate greeting-only VAD from `arm()` after source start. This avoids a pre-playback provider boundary being processed after a later arm.

### 6. Implement one-shot local acceptance

When `arm()` runs for the current attached generation:

1. Increment/capture the operation arm epoch.
2. Mark the operation armed.
3. Start `runtime.createBrowserVad` against the original raw stream using the validated asset/provider config.
4. Supply owner callbacks for start/end/cancel/failure.

For the successful Phase 2 path:

- `startTurn` is the local acceptance candidate.
- Re-check owner identity, connection generation, operation identity, armed state, arm epoch, and not-yet-accepted state when the callback executes.
- A failed check resolves as a no-op. It must not queue an acceptance that can become valid later.
- `endTurn` and `cancelTurn` do not close the OpenAI publication. They only let the one-shot detector clear its own internal boundary state when no acceptance won.
- `onFailure` must be caught and bounded so no rejection escapes; complete raw fallback belongs to Phase 3.

The first valid start callback must serialize this exact order:

1. Atomically mark the operation accepted before any callback or await.
2. Call presentation's local playback-stop callback.
3. Allow the player's end hook to disarm future callbacks without cancelling the accepted transition.
4. Release the generated-track gate while the bridge still emits silence.
5. Call `bridge.startAutomaticTurn(config.preRollMs)` exactly once.
6. Leave the bridge in live mode. Do not call `endTurn()` after the accepted user speech ends.
7. Retire greeting-only VAD once. OpenAI server VAD now owns all later boundaries.

Handle VAD resolution ordering: `createBrowserVad` may invoke `startTurn` during its own `start()` before the returned `BrowserVad` is assigned. Record `retireWhenReady` and destroy the returned VAD immediately after assignment when acceptance already won.

Duplicate/adjacent starts, speech end, misfire, natural playback completion, and later OpenAI provider events must not call `startAutomaticTurn` again.

### 7. Implement successful normal completion and Skip

If playback ends, aborts, or is skipped before acceptance:

1. Disarm synchronously.
2. In the operation's single settlement promise, call `bridge.startManualTurn()` once.
3. Await its acknowledgement.
4. Release the generated-track gate.
5. Retire/destroy any greeting-only VAD without stopping the raw stream or generated bridge.
6. Leave the bridge live-only for normal OpenAI server-VAD turns.

This order discards retained and queued greeting-period samples before live publication becomes audible to the sender. Never use `startAutomaticTurn` on normal completion or Skip.

If acceptance already won, `settle()` waits for the accepted transition and does not issue `startManualTurn`, close the bridge, or restore a stale lease.

Replacement greeting behavior remains latest-operation-wins: abort/disarm/settle the old operation before the new operation acquires the gate. Its late synthesis, playback hooks, and VAD callbacks must be no-ops.

### 8. Preserve provider history and post-greeting behavior

Do not move the existing provider `conversation.item.create` send. It must still happen:

- after readiness and open-channel checks;
- before synthesis/playback;
- once per accepted greeting attempt;
- without waiting for `conversation.item.created`;
- without sending `response.create`.

Keep `GreetingSpeechResult` semantics unchanged: pre-send failures return `not_started`; post-send local work returns `accepted`.

Do not modify raw OpenAI event parsing or `ResponseArbiter`. After owner settlement:

- immediate mode still responds to provider `speech_started` as today;
- transcript-confirmed mode still waits for useful correlated transcription and commit/completion;
- no local owner callback creates/cancels a provider response;
- no `turnControl` or `turn_mode` event appears.

### 9. Add direct owner tests

Create `greeting-interruption.test.ts` with injected fake runtime, bridge, gate, raw/generated tracks, sender, generation reader, stop callback, and diagnostics.

Cover at least:

- disabled preparation does not load runtime and returns raw behavior;
- enabled preparation loads once and returns the generated publication track;
- begin gates generated while raw remains enabled;
- callback before arm is ignored and cannot become valid after arm;
- callback while armed records `stop` before gate release/`automatic-start`;
- configured `preRollMs` reaches `startAutomaticTurn` once;
- duplicate starts and later end/cancel cannot flush twice;
- accepted settlement does not call `startManualTurn` or bridge `endTurn`;
- normal natural settlement calls `startManualTurn` before gate release;
- Skip before acceptance follows the same live-only order;
- VAD is retired once and raw is never stopped;
- stale callbacks from a replaced operation/generation are no-ops;
- a VAD returned after disarm/settlement is immediately retired.

Name test inputs as local boundaries, not verified human speech. A fake callback may represent echo or noise.

### 10. Extend player and presentation tests

In `web-audio-greeting-player.test.ts`, add tests for:

- delayed decode emits neither hook until source start;
- successful source start emits start once;
- natural end emits end before play resolution;
- `stop()` and abort emit one end only after start;
- stop during decode emits no start/end pair;
- source-start failure never arms and does not hang;
- repeated stop remains idempotent.

In `greeting-presentation.test.ts`, add enabled-owner harness coverage for:

- provider item send still precedes synthesis/owner playback;
- synthesis-period callback cannot stop or flush;
- start/end hooks arm/disarm only the current operation;
- natural completion and Skip await live-only settlement;
- accepted stop does not let `finally` race into manual start;
- replacement greeting fences old hooks and callbacks;
- post-send local outcomes remain `accepted`.

Keep existing disabled presentation tests unchanged and green.

### 11. Extend adapter integration tests

Use the existing `setGreetingInterruptionRuntimeImporterForTests` seam. Return a fake runtime whose bridge and VAD callbacks are observable.

Cover:

- enabled connect replaces only the raw audio sender input with one generated track;
- no raw audio track is also published;
- non-audio tracks remain attached as before;
- `getAudioStreams().mic` is the original stream;
- enabled greeting gates generated, not raw;
- accepted callback stops local playback before one pre-roll command;
- normal completion/Skip use live-only publication;
- exact assistant provider item remains one, with no provider ack wait or `response.create`;
- OpenAI adapter still has no `turnControl` and emits no turn-mode event;
- after greeting settlement, immediate and transcript-confirmed tests retain current response-arbitration behavior;
- omitted/`false` runtime and bundle tests remain green.

Use existing fake `RTCRtpSender`/`addTrack` infrastructure. Add sender identity assertions now, but defer `replaceTrack` recovery assertions to Phase 3.

### 12. Wire normal disconnect ownership

Delegate active-operation abort and bridge/VAD cleanup from adapter teardown through `GreetingPresentation`. Preserve synchronous fencing first: disarm callbacks, stop playback, clear current operation/generation ownership, and disable/stop generated publication before stale async completion can act.

The adapter must continue stopping caller-owned raw tracks. The owner must continue owning generated-track/bridge destruction. Avoid adding a second explicit generated-track stop in the adapter path. Phase 3 will add exhaustive partial-failure and exact-once teardown tests; this phase must at least make successful enabled disconnect leak-free and idempotent.

## Acceptance checks

- Omitted and `false` still attach raw, never load runtime, and pass the Phase 1 bundle graph test.
- Enabled connect attaches one generated audio track and does not also publish raw audio.
- `getAudioStreams().mic` and metering remain bound to the original raw stream.
- Generated publication is silent/gated while synthesis and decode are pending; raw remains enabled locally.
- Acceptance cannot occur before successful `AudioBufferSourceNode.start(0)` or after playback end/stop.
- A pre-playback or stale callback cannot become valid under a later arm epoch.
- The first valid local boundary stops playback before one bounded `startAutomaticTurn(preRollMs)` call.
- Duplicate boundaries, VAD end/misfire, settlement, and later provider events cannot flush a second pre-roll.
- Natural completion and Skip call `startManualTurn` before gate release and never flush retained greeting-period audio.
- The exact provider greeting item remains at most once; no provider acknowledgement wait or response creation is added.
- Immediate and transcript-confirmed post-greeting response arbitration remain unchanged.
- OpenAI still exposes no manual turn control or turn-mode transition.
- Successful enabled disconnect retires VAD and destroys generated resources without stopping raw twice.
- Tests make no acoustic, first-phoneme, self-echo, accuracy, or latency claim.

## Verify commands

Run from the workspace root:

```bash
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
```

Useful focused commands while implementing:

```bash
bun test --cwd packages/realtime-openai src/greeting-interruption.test.ts
bun test --cwd packages/realtime-openai src/web-audio-greeting-player.test.ts
bun test --cwd packages/realtime-openai src/greeting-presentation.test.ts
bun test --cwd packages/realtime-openai src/openai-adapter.test.ts src/default-off-bundle.test.ts
```

Before reporting completion, run diagnostics on every edited TypeScript file, then rerun the four Nx targets above.

## Dependencies

- Phase 1's `ResolvedBrowserVadConfig` and synchronous option validation.
- Phase 1's `loadGreetingInterruptionRuntime` and scoped test importer.
- Reviewed `createLocalAudioPreRoll` and `createBrowserVad` contracts.
- Existing `MicrophonePublicationGate`, `ConnectRaceGuard`, presentation operation identity, and connection generation.
- Existing Web Audio fakes and OpenAI adapter WebRTC/data-channel harness.

## Non-goals

- Do not implement lazy-import or bridge-creation fallback; Phase 3 owns it.
- Do not implement post-attachment `replaceTrack` fallback or worklet-timeout recovery; Phase 3 owns it.
- Do not modify shared realtime-VAD or pre-roll contracts.
- Do not accept speech during synthesis, decode, readiness, or after playback settlement.
- Do not use local VAD for post-greeting turns.
- Do not send provider frames, history, response creation, or response cancellation from the owner.
- Do not expose the owner, generated track, VAD state, arm epoch, or fallback state publicly.
- Do not enable the option in the demo or change docs in this phase.
- Do not claim real-device self-echo rejection, VAD accuracy, first-phoneme retention, or latency.
- Do not commit or edit `.apnea/state.json`.
