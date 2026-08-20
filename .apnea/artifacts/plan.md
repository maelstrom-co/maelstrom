---
status: done
---

# Plan: opt-in OpenAI fixed-greeting interruption

## Goal

Add experimental `greetingInterruption?: false | true | BrowserVadOptions` support to `OpenAIAdapter`. Only while fixed-greeting audio is actually playing, the first locally accepted speech boundary must stop local playback, flush one bounded `LocalAudioPreRoll` tail, then pass live microphone audio. Explicit **Skip greeting** remains the reliable control.

Omitted and `false` configuration must preserve the existing raw-track runtime and initial bundle path. Enabled configuration must validate synchronously. Lazy-runtime, VAD, or AudioWorklet failure must safely return to the existing non-interruptible greeting gate without publishing greeting-period audio or failing an otherwise healthy voice session. `GreetingPresentation` composes a package-private interruption owner. `OpenAIAdapter` only prepares and attaches the selected publication track and performs generation-fenced sender replacement when the owner requests recovery.

Normal OpenAI turn ownership remains unchanged after greeting settlement. Preserve at-most-once Engine/provider greeting history, immediate and transcript-confirmed behavior, response arbitration, turn mode, bounded diagnostics, exact cleanup, reconnect isolation, and raw-stream metering.

## Phase 1 — Establish the opt-in API and default-off loading boundary

### Intent

Add synchronous configuration and a loading boundary that keeps VAD, ONNX, and pre-roll runtime code off the omitted/`false` initial path. Prove omitted and explicit `false` consumers have the same static bundle behavior before adding enabled lifecycle logic.

### Files likely touched

- `packages/realtime-vad/package.json`
- `packages/realtime-vad/vite.config.ts`
- `packages/realtime-vad/src/index.ts`
- `packages/realtime-vad/src/browser-vad.ts`
- `packages/realtime-vad/src/browser-vad-config.ts` (new)
- `packages/realtime-vad/src/browser-vad.test.ts`
- `packages/realtime-vad/README.md`
- `packages/realtime-openai/package.json`
- `packages/realtime-openai/tsconfig.lib.json`
- `packages/realtime-openai/vite.config.ts`
- `packages/realtime-openai/src/index.ts`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/default-off-bundle.test.ts` (new)
- `bun.lock`

### Implementation steps

1. Extract browser-VAD option resolution and validation into a browser-safe, runtime-light `@maelstrom-co/realtime-vad/config` subpath. This subpath may import types and validation helpers only. It must not statically reach `createBrowserVad`, `createLocalAudioPreRoll`, worklet source, `@ricky0123/vad-web`, or `onnxruntime-web`.
2. Keep package-root imports source-compatible by re-exporting the resolver and types. Update `browser-vad.ts` to consume the extracted config rather than duplicate validation.
3. Add `@maelstrom-co/realtime-vad` to the OpenAI manifest, TypeScript reference, and Vite externals. Update `bun.lock` through `bun install`.
4. Add `greetingInterruption?: false | true | BrowserVadOptions` to `OpenAIAdapterOptions` and re-export the option type from the OpenAI root, consistent with LiveKit.
5. Normalize configuration synchronously in the OpenAI constructor:
   - omitted and `false` become a disabled discriminant without loading runtime code;
   - `true` resolves shared defaults;
   - an object resolves and validates shared options;
   - invalid shape, URL, pre-roll, or provider tuning throws `TypeError` naming `greetingInterruption` before minting, capture, peer creation, promises, or dynamic import.
6. Keep the production runtime loader as a testable function that calls `import('@maelstrom-co/realtime-vad')` only from enabled connection preparation. This dynamic import is justified code splitting: disabled consumers must not fetch or execute VAD, ONNX, or pre-roll runtime code.
7. Add a bundle regression test with two minimal Vite consumers: one omits `greetingInterruption`, and one passes `false`. Compare output metadata and assert identical static dependency graphs. Neither initial graph may contain the realtime-VAD runtime root, provider libraries, ONNX runtime, or pre-roll worklet. Any realtime-VAD runtime edge must remain dynamic and unrequested during disabled construction/connection.
8. Keep direct runtime tests for omitted and `false`: both attach the original microphone track and never call the runtime loader, bridge factory, VAD factory, or asset loading.

### Acceptance checks

- Enabled malformed configuration throws synchronously with no token, media, peer, worklet, VAD, or dynamic-import work.
- Omitted and `false` attach and gate the raw microphone exactly as the current adapter does.
- Omitted and `false` have the same static consumer bundle graph and do not eagerly include or execute realtime-VAD runtime code.
- The config-only subpath has no runtime dependency edge to VAD, ONNX, or worklet implementation.
- Existing realtime-VAD root imports and LiveKit behavior remain source-compatible.

### Verify commands

```bash
bun install
bunx nx run @maelstrom-co/realtime-vad:check
bunx nx run @maelstrom-co/realtime-vad:test
bunx nx run @maelstrom-co/realtime-vad:typecheck
bunx nx run @maelstrom-co/realtime-vad:build
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
```

### Dependencies

- Extracts the existing validation semantics from `packages/realtime-vad/src/browser-vad.ts`; it does not redesign them.
- Uses Vite output metadata in the bundle regression test.

### Non-goals

- Do not eagerly import the realtime-VAD package root from OpenAI code.
- Do not change VAD defaults, accepted ranges, provider tuning, or LiveKit behavior.
- Do not initialize the experimental owner for omitted or `false` configuration.
- Do not claim that a lazy chunk proves browser or device behavior.

## Phase 2 — Deliver playback-scoped interruption through the private owner

### Intent

Implement the enabled happy path with a precise acceptance window. Detection resources may prepare while synthesis/decode is pending, but speech can interrupt only after Web Audio starts the greeting and before playback settles.

### Files likely touched

- `packages/realtime-openai/src/greeting-interruption.ts` (new)
- `packages/realtime-openai/src/greeting-interruption.test.ts` (new)
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

### Implementation steps

1. Add package-private `GreetingInterruption`. It owns one connection generation's config, loaded runtime module, `LocalAudioPreRoll`, generated track, greeting-only VAD, gate leases, acceptance epoch, transition queue, and cleanup. Keep it out of `src/index.ts`.
2. Have `GreetingPresentation` compose the owner. Keep provider handoff, synthesis, playback, abort, replacement greeting, and settlement in presentation. Give the owner only narrow callbacks for stopping local playback, replacing the current publication track, emitting a bounded diagnostic category, and reading the current generation.
3. During enabled connection preparation, dynamically load realtime-VAD and create `LocalAudioPreRoll` from the original microphone audio track. Return the generated track to `OpenAIAdapter`, which attaches it and retains the matching `RTCRtpSender` for recovery. Keep the original `MediaStream` in `#micStream` so metering remains raw.
4. Keep the generated bridge closed and silent while greeting synthesis and decode are pending. VAD may be prepared against the raw stream, but its callbacks must see acceptance as disarmed and must not stop playback, flush pre-roll, or queue acceptance for later.
5. Extend `WebAudioGreetingPlayer.play` with operation-scoped playback lifecycle hooks:
   - invoke `onPlaybackStart` exactly once, only after `AudioBufferSourceNode.start(0)` succeeds;
   - invoke `onPlaybackEnd` synchronously and at most once before resolving/rejecting playback for natural `onended`, `stop()`, abort, or started-playback failure;
   - never emit start when decode or source start fails.
6. `GreetingPresentation` uses those hooks to arm and disarm the matching interruption operation. The armed window begins after successful source start. It ends synchronously at playback end/stop, before the play promise settles and before presentation's final cleanup.
7. Tag each VAD callback with operation identity and the current arm epoch. Re-check both when queued callback work begins. A callback observed during synthesis/decode, after natural playback end, after Stop/Skip, or from a replacement generation is a no-op and cannot become valid after a later arm.
8. Serialize the first callback that executes while armed in this exact order:
   - atomically claim acceptance so duplicates are no-ops;
   - stop local greeting playback;
   - release the generated-track gate while the bridge still emits silence;
   - call `startAutomaticTurn(validatedPreRollMs)` once;
   - retain live bridge publication and retire greeting-only VAD without closing it.
   The stop hook disarms new callbacks, but it must not cancel the already claimed transition.
9. On natural completion or Skip before acceptance, discard retained and queued greeting-period samples with `startManualTurn()`, then release the gate. Never flush pre-roll on this path.
10. Preserve provider handoff position. The exact assistant item is sent once before local presentation, no provider acknowledgement is awaited, no `response.create` is added, and post-send local outcomes remain `accepted`.
11. After settlement, OpenAI server VAD resumes sole ownership. Existing raw `speech_started`, transcript deltas, commits, and response events continue through immediate/transcript-confirmed and `ResponseArbiter` paths without local VAD involvement.
12. Add direct owner/player/presentation tests for:
    - VAD callback during synthesis before `play()` starts;
    - callback during delayed decode;
    - source-start failure never arming;
    - arm only after source start;
    - callback while playing stops before one automatic start;
    - natural end disarming before promise settlement;
    - stale callback after natural end, stop, Skip, replacement, and reconnect;
    - callback queued while armed but executed after disarm;
    - normal/Skip tail discard and one-shot VAD retirement.
13. Add adapter tests for generated-track attachment, raw metering, exact provider history, no turn-mode change, and both post-greeting server barge-in modes.

### Acceptance checks

- No pre-roll flush or spoken interruption can occur before `AudioBufferSourceNode.start(0)` succeeds.
- The acceptance window is synchronously closed on natural end, local stop, abort, and Skip before playback promise settlement.
- Pre-playback and stale post-playback callbacks cannot stop audio, open publication, or become accepted by a later operation.
- A callback accepted while playing stops playback before one `startAutomaticTurn()` call.
- Enabled mode attaches one generated track while metering still receives the original stream.
- Normal completion and Skip use the live-only/manual transition and never publish retained greeting-period samples.
- Greeting history remains at most once, and post-greeting immediate/transcript-confirmed arbitration remains unchanged.
- OpenAI still exposes no manual turn control or LiveKit-style turn-mode transition.

### Verify commands

```bash
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
```

### Dependencies

- Depends on Phase 1's config discriminant and lazy runtime loader.
- Uses the reviewed `LocalAudioPreRoll` and `createBrowserVad` contracts.
- Uses actual `AudioBufferSourceNode.start`/settlement as the playback boundary rather than synthesis or decode timing.

### Non-goals

- Do not accept speech during synthesis, decode, readiness, or after playback settlement.
- Do not use local VAD for ordinary post-greeting turns.
- Do not let the owner send OpenAI commands, append history, create responses, or own transcript confirmation.
- Do not interpret a mocked boundary as proof of human speech or echo rejection.

## Phase 3 — Recover lazy-load and post-attachment failures; harden races

### Intent

Handle every setup and lifecycle failure, including dynamic-import rejection and bridge commands after the generated track is attached. Recover through the existing raw gate or generation-fenced raw-track replacement without replaying greeting-period audio.

### Files likely touched

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

### Implementation steps

1. Treat lazy runtime-loader rejection and bridge creation failure as pre-attachment recoverable setup failures. A missing/corrupt dynamic chunk, rejected `import('@maelstrom-co/realtime-vad')`, or failed `createLocalAudioPreRoll` must attach the original raw track and select the existing `MicrophonePublicationGate`. Enabled `connect()` still succeeds, and no partially loaded/prepared resource survives.
2. Test the lazy-loader failure directly through the injected loader seam. Assert no bridge/VAD factory runs, raw is attached, the greeting disables raw publication until settlement, Skip restores it, and no greeting-period audio has a replay path.
3. Add owner-requested, adapter-executed recovery for failures after generated-track attachment. The adapter verifies connection generation, sender identity, and expected generated track before `RTCRtpSender.replaceTrack(rawTrack)`.
4. Make replacement leak-safe:
   - acquire a lease disabling raw before replacement;
   - keep generated publication gated or closed;
   - replace generated with disabled raw;
   - after successful replacement, destroy the bridge/generated track;
   - retain raw gating while greeting playback remains active;
   - release on playback settlement, or immediately if accepted playback already stopped.
5. Use replacement for VAD load/construction/start failure after attachment, callback failure before acceptance, `startAutomaticTurn()` rejection/timeout, and `startManualTurn()` rejection/timeout. Never trust a bridge after a failed lifecycle acknowledgement.
6. If same-kind WebRTC `replaceTrack` independently fails, keep publication gated, classify it as transport recovery failure, and tear down through the existing fatal transport path. Do not leak uncertain audio or misreport it as successful degradation.
7. Keep ownership exact. Before replacement, the owner exclusively destroys generated resources and the adapter owns raw capture. After replacement, the sender references raw capture and teardown stops it once; owner cleanup may not stop raw.
8. Fence runtime loading, bridge/VAD creation, playback hooks, queued callbacks, sender replacement, and destruction by operation identity plus connection generation. Delayed generation-N work destroys only its own resources and cannot arm, stop, replace, or release generation N+1.
9. Serialize local acceptance, VAD failure, natural end, Skip, abort, replacement greeting, disconnect, and reconnect. Exactly one terminal transition selects automatic publication, normal live-only publication, raw-gated fallback, or teardown.
10. Emit only allowlisted categories and booleans. Never log raw errors, stacks, tracks, streams, settings objects, device data, audio, VAD scores, provider payloads, or transcript content.
11. Add focused tests for:
    - dynamic-import/runtime-loader rejection before attachment;
    - bridge creation failure before attachment;
    - post-attachment VAD setup and callback failure;
    - automatic/manual start rejection and acknowledgement timeout;
    - raw disabled before replacement and restored only at the safe boundary;
    - failed replacement staying gated and taking the fatal path;
    - callback during synthesis followed by setup failure;
    - playback-end/disconnect and Skip/acceptance races;
    - delayed setup overtaken by disconnect;
    - replacement greeting versus stale hooks/callbacks;
    - repeated teardown and reconnect isolation;
    - no second pre-roll from later OpenAI events.
12. Add acoustic-uncertainty assertions. Name the event as local acceptance, allow tests to model playback echo, and assert ordering/data flow only. Do not encode self-echo rejection, VAD accuracy, first-phoneme retention, or latency claims in tests or diagnostics.

### Acceptance checks

- Dynamic-import rejection and bridge creation failure attach raw behind the old gate and do not fail voice.
- Loader failure performs no bridge/VAD work and cannot leak greeting-period audio.
- VAD setup, automatic-start, and manual-start failures preserve voice when generation-fenced raw replacement succeeds.
- No fallback publishes retained greeting-period audio. Raw is disabled before sender replacement and historical raw samples cannot replay.
- Automatic-start failure after playback stop resumes live raw without claiming pre-roll retention.
- Manual-start failure retains the non-interruptible gate until playback settlement, then resumes live raw.
- Failed sender replacement remains gated and fails closed.
- Pre-playback and stale post-playback callbacks remain fenced on every fallback path.
- Every partial and complete resource is released once; stale generations cannot touch current resources.
- Existing greeting, response-arbiter, immediate/transcript-confirmed, state, and teardown suites remain green.

### Verify commands

```bash
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
bunx nx run @maelstrom-co/realtime-vad:test
bunx nx run @maelstrom-co/realtime-vad:typecheck
```

### Dependencies

- Depends on Phase 2's playback hooks, owner-managed generated track, and sender identity.
- Reuses `ConnectRaceGuard`, greeting operation identity, and connection generations.
- Uses `MediaStreamTrack.enabled = false` and same-kind `RTCRtpSender.replaceTrack` for post-attachment recovery.

### Non-goals

- Do not fail voice merely because the optional runtime chunk cannot load.
- Do not continue using a bridge after lifecycle acknowledgement failure.
- Do not release raw publication before generation-fenced replacement succeeds.
- Do not expose fallback state or manual turn control.
- Do not restart a greeting after local acceptance later appears acoustically wrong.

## Phase 4 — Document the experiment, keep the demo off, and run repository gates

### Intent

Ship compile-checked opt-in guidance and an honest real-device status. Keep the repository demo on the reliable current path.

### Files likely touched

- `packages/realtime-openai/README.md`
- `packages/realtime-vad/README.md`
- `apps/demo/src/lib/maelstrom.ts`
- `apps/demo/src/lib/maelstrom.test.ts`
- `apps/docs/e2e/fixtures/voice/openai-realtime.tsx`
- `apps/docs/e2e/voice-docs.spec.ts`
- `apps/docs/src/content/docs/guides/voice/openai-realtime.mdx`
- `apps/docs/src/content/docs/understanding/browser-vad-and-barge-in.mdx`

### Implementation steps

1. Set and test `greetingInterruption: false` in every OpenAI demo mode. Keep the existing Skip action and hosted/local server-VAD configuration unchanged.
2. Add a compile-checked OpenAI fixture region showing opt-in configuration and the VAD asset base URL. Render it verbatim in the guide and include it in the fixture-region Playwright assertion.
3. Document synchronous validation, default-off lazy loading, playback-scoped acceptance, stop-before-pre-roll ordering, bounded 0–500 ms pre-roll, normal/Skip discard, lazy-load and raw-replacement fallback, and unchanged post-greeting OpenAI server VAD.
4. State that synthesis and decode are not interruption windows. Local acceptance arms only after Web Audio source start and closes at playback end/stop; speech beginning before playback may not produce another accepted boundary, so Skip remains necessary.
5. Update the browser-VAD explanation to describe this as a narrow OpenAI fixed-greeting exception. OpenAI remains the sole turn/response owner after greeting settlement.
6. Explain acoustic uncertainty plainly. Local acceptance may be playback echo, another sound, or speech. Browser AEC/NS/AGC settings and mocks do not prove self-echo rejection, VAD accuracy, first-phoneme retention, or latency.
7. Add a real-device matrix for iOS Safari built-in audio, Android Chrome built-in audio, and desktop Chromium built-in audio. Initialize every required result to **Not tested**. Include revision, route, quiet/self-trigger trials, spoken-interruption trials, first-word observation, and latency evidence fields without values.
8. Require actual device evidence under the existing browser audio protocol before changing **Not tested** or making an acoustic claim. Automated checks establish loading, playback-window fencing, state-machine ordering, and publication boundaries only.
9. Run package, demo, docs, public API, packed-consumer, and root non-browser gates. Do not report the device matrix as passed.

### Acceptance checks

- Demo tests prove the experiment remains disabled in local, hosted, and browser-key OpenAI construction.
- The docs fixture compiles against public exports and appears verbatim in the rendered guide.
- README and API output expose the option/config subpath without exporting the private owner.
- Docs define the exact playback-only window and preserve Skip for speech that begins too early or is not accepted.
- Every required device cell says **Not tested**, with no nearby pass or latency claim.
- Package, demo, docs, packed-consumer, public API, and root non-browser gates pass.

### Verify commands

```bash
bunx nx run @maelstrom-co/realtime-vad:check
bunx nx run @maelstrom-co/realtime-vad:test
bunx nx run @maelstrom-co/realtime-vad:typecheck
bunx nx run @maelstrom-co/realtime-vad:build
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
bunx nx run @maelstrom-co/demo:check
bunx nx run @maelstrom-co/demo:test
bunx nx run @maelstrom-co/demo:typecheck
bunx nx run @maelstrom-co/demo:build
bunx nx run @maelstrom-co/demo:build-hosted
bunx nx run @maelstrom-co/demo:build-livekit
bunx nx run @maelstrom-co/docs:check
bunx nx run @maelstrom-co/docs:test
bunx nx run @maelstrom-co/docs:typecheck
bunx nx run @maelstrom-co/docs:build
bunx nx run '@maelstrom-co/docs:e2e-ci--e2e/voice-docs.spec.ts'
bun run audit:public-api-docs --declarations --packed-consumer
bun run audit:public-api-docs --typedoc
bun run audit:strip-internal
bunx nx run @maelstrom-co/source:check
bunx nx run @maelstrom-co/source:typecheck
bunx nx run @maelstrom-co/source:test
```

### Dependencies

- Depends on final behavior from Phases 1–3.
- Uses the existing fixture-region tests and browser audio protocol.

### Non-goals

- Do not enable the experiment in the demo.
- Do not mark real-device cells passed from unit, bundle, build, or Playwright results.
- Do not promise self-echo rejection, VAD accuracy, first-phoneme retention, latency, or mobile support.
- Do not redesign Skip greeting or general voice controls.

## Definition of done

- `greetingInterruption` is typed, synchronously validated when enabled, and disabled by default.
- Omitted and `false` retain raw-track runtime, perform no VAD/worklet setup, and have equivalent static bundle graphs with no eager realtime-VAD runtime edge.
- Enabled mode attaches one owner-managed generated track while raw metering remains unchanged.
- Local acceptance is impossible during synthesis/decode and after playback settlement. It arms only after source start and is synchronously fenced at end/stop.
- The first callback accepted while playback is active stops greeting before exactly one bounded pre-roll flush and later live samples.
- Normal completion and Skip discard greeting-period audio before live publication.
- Lazy runtime import, bridge creation, VAD setup, automatic-start, and manual-start failures recover through the old raw gate or generation-fenced replacement without leaking historical audio; independent replacement failure fails closed.
- Greeting history remains at most once, and post-greeting immediate/transcript-confirmed response arbitration and turn mode remain unchanged.
- Cleanup is exact across success, fallback, partial setup, Skip, disconnect, replacement greeting, and reconnect generations.
- Direct owner, player, presentation, adapter, bundle, pre-/post-playback fence, lazy-loader fallback, post-attachment failure, race, teardown, docs fixture, default-off, and acoustic-uncertainty coverage is green.
- The demo remains explicitly disabled.
- Every real-device matrix entry remains **Not tested** until hardware evidence exists.
- All listed package, demo, docs, packed-consumer, public API, and root non-browser commands pass.
