---
status: done
---

# Phase 3 package: recover lazy-load and post-attachment failures

## Intent

Make every experimental setup and lifecycle failure recoverable without failing an otherwise healthy OpenAI voice session or publishing greeting-period audio.

Phase 2 already delivers the successful enabled path and stores unused sender identity. This phase adds two recovery families:

1. **Pre-attachment.** A rejected `import('@maelstrom-co/realtime-vad')` or failed `createLocalAudioPreRoll` must attach the original raw track and use the existing `MicrophonePublicationGate`. `connect()` still succeeds.
2. **Post-attachment.** VAD setup/callback failure and `startAutomaticTurn()` / `startManualTurn()` rejection or timeout must request a generation-fenced `RTCRtpSender.replaceTrack(raw)` from the adapter. Never trust the failed bridge to drain, clear, or open.

Independent `replaceTrack` failure is a fatal transport error. Do not misreport it as successful degradation.

## Files to touch

- `packages/realtime-openai/src/greeting-interruption.ts`
- `packages/realtime-openai/src/greeting-interruption.test.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

Touch `packages/realtime-openai/src/web-audio-greeting-player.ts` and its test only if an existing hook race cannot be fenced in the owner/presentation. Do not change the Phase 2 start/end hook contract.

## Files not to touch

- `packages/realtime-openai/src/index.ts`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-openai/src/greeting-interruption-runtime.ts`
- `packages/realtime-openai/src/greeting-interruption-runtime.test.ts`
- `packages/realtime-openai/src/default-off-bundle.test.ts`
- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-vad/**`
- `apps/demo/**`
- `apps/docs/**`
- package manifests and `bun.lock`
- `.apnea/state.json`

Keep using `setGreetingInterruptionRuntimeImporterForTests` and `loadRuntime` injection. Do not add a static `@maelstrom-co/realtime-vad` runtime import.

## Exact steps

### 1. Treat loader and bridge creation failure as pre-attachment fallback

`GreetingInterruption.prepareAndRemember` currently stores `#runtime` before `createLocalAudioPreRoll` and lets either rejection escape. That fails `connect()`. Change the enabled branch to:

1. Call the injected/production loader.
2. If the loader rejects, emit `runtime-unavailable` and return a raw, `generated: false` descriptor whose `abandon()` is a no-op.
3. If the loader resolves, call `createLocalAudioPreRoll(rawAudioTrack)`.
4. If bridge creation rejects, emit `bridge-unavailable`, clear any temporary runtime handle, and return the same raw descriptor.
5. Store `#runtime`, `#bridge`, and `#rawStream` only after both succeed.
6. Never leave a generated track, worklet, or runtime handle attached to the owner after a failed prepare.

`OpenAIAdapter.connect()` already attaches raw when `preparedMicrophone.generated` is false and `GreetingPresentation.speak()` already falls back to the existing raw `MicrophonePublicationGate` when `begin()` returns undefined. Keep that composition. Do not add a second raw-gate path.

`connect()` must resolve after this fallback. Do not wrap loader/bridge failure as `CONNECTION_FAILED`.

If prepare is overtaken after a successful bridge, keep the existing `abandon()` path. A delayed successful prepare after disconnect/generation change must destroy only that attempt's bridge and must not commit onto the winner.

### 2. Add owner-requested, adapter-executed publication recovery

`#sender` is stored and unused. Keep sender identity in the owner, but do not call `replaceTrack` from the owner.

Add one injected recovery callback on `GreetingInterruptionOptions`, supplied by `OpenAIAdapter`:

```ts
replacePublication(args: {
  readonly generation: number;
  readonly generated: MediaStreamTrack;
  readonly raw: MediaStreamTrack;
}): Promise<'replaced' | 'stale' | 'failed'>;
```

Adapter rules, in this order:

1. If `args.generation !== #connectionGeneration`, return `'stale'`.
2. If there is no committed sender, or `sender.track !== args.generated`, return `'stale'`.
3. Acquire a raw `MicrophonePublicationGate` lease for `#micStream` / `args.raw` so raw is disabled **before** replacement. Keep the generated track gated or closed.
4. Call `sender.replaceTrack(args.raw)`.
5. On success, return `'replaced'` only after the sender references raw. Do not stop raw.
6. On rejection, keep both publications gated, return `'failed'`, emit `RealtimeVoiceError('CONNECTION_FAILED', 'Failed to restore the OpenAI microphone publication')`, and tear down through the existing fatal transport path. Do not include the `replaceTrack` error message in logs or events.

The owner destroys the generated bridge/track only after `'replaced'`. If the result is `'stale'` or `'failed'`, it must not stop raw or mutate the newer generation's sender.

Update the default `FakeSender.replaceTrack` so successful recovery tests can replace, while existing greeting-gating tests still fail if they call `replaceTrack` unexpectedly. Prefer an injectable per-sender implementation rather than changing every non-recovery test.

### 3. Make replacement leak-safe and terminal

Add one owner transition, `recoverRaw(reason)`, serialized with acceptance and normal settlement. Exactly one terminal wins: automatic publication, live-only/manual publication, raw-gated fallback, or teardown.

Shared replacement sequence after a trusted generated track is already attached:

1. Disarm new local acceptance.
2. Stop local playback if it is still active.
3. Keep generated gated/closed. Do not call `startAutomaticTurn`, `startManualTurn`, `clear`, or `endTurn` on a failed bridge.
4. Acquire the raw lease (raw `enabled = false`).
5. Await `replacePublication`.
6. If `'replaced'`, destroy the bridge/generated track once, drop `#bridge`/`#sender`, and remember that publication is now raw.
7. If greeting playback is still the current operation, retain the raw lease until settlement.
8. If playback already stopped because acceptance won, release the raw lease immediately after successful replacement so live raw resumes. Do not claim pre-roll retention.
9. If `'failed'`, leave publication gated and let adapter teardown finish.
10. If `'stale'`, destroy only this generation's leftover generated resources and do nothing to the current sender.

Use this transition for:

- `createBrowserVad` load/construction/`start()` failure after attachment;
- `onFailure` before acceptance;
- `startAutomaticTurn()` rejection or acknowledgement timeout;
- `startManualTurn()` rejection or acknowledgement timeout.

Do not use replacement for omitted/`false`, pre-attachment fallback, or a successful automatic/manual start.

After raw fallback, later local VAD callbacks are no-ops. OpenAI server VAD owns later turns. `begin()` on a later greeting in the same recovered connection must use the existing raw gate, not recreate a destroyed bridge.

### 4. Preserve exact ownership

Before replacement:

- Adapter owns and eventually stops the caller-owned raw stream/tracks.
- Owner exclusively destroys the generated bridge/track and greeting-only VAD.

After successful replacement:

- The sender references raw.
- Adapter teardown still stops raw once through `#micStream`.
- Owner `destroy()` / `abandon()` must not stop raw.
- Generated cleanup happens once in the owner, never again in `#closeAbandonedAttempt` or `#teardown`.

`#closeAbandonedAttempt` already avoids iterating senders to stop tracks. Keep that. Teardown must still call `GreetingPresentation.disconnect()` before stopping raw, so a generated track is destroyed by the owner first when replacement has not occurred.

A reconnect increments connection generation through the existing `#startConnectionGeneration()`. Delayed generation-N loader, bridge, VAD, playback hook, callback, or `replaceTrack` work destroys only generation-N resources.

### 5. Fence every late callback on fallback paths

Keep Phase 2 arm-epoch / operation / generation checks. Extend them so:

- a synthesis-period callback cannot start recovery or pre-roll;
- a callback after natural end, Skip, abort, or replacement greeting cannot recover or flush;
- a callback queued while armed but executed after disarm/recovery is a no-op;
- `onFailure` after acceptance does not start a second recovery or close an already live publication;
- `settle()` after a winning recovery does not call `startManualTurn` or `startAutomaticTurn`;
- `settle()` after a winning automatic start does not recover.

`GreetingPresentation.abort()` / Skip remain synchronous for disarm and local stop. Recovery and bridge destroy stay on the existing terminal promise so Skip still returns without disconnecting voice.

### 6. Keep diagnostics bounded

Replace free-form error logging with this allowlist only:

- `runtime-unavailable`
- `bridge-unavailable`
- `vad-unavailable`
- `automatic-start-failed`
- `manual-start-failed`
- `publication-replaced`
- `publication-replace-failed`
- existing `interruption-failed` / `presentation-failed` if a leftover local failure has no more specific category

Payloads may include only those category strings and booleans such as `greetingActive`. Never log or emit raw `Error` objects, messages, stacks, tracks, streams, device data, settings objects, audio, VAD scores, provider payloads, or transcript text.

A local acceptance remains an untrusted boundary. Test names and diagnostics must say "local acceptance" / "local boundary", not human speech, self-echo rejection, accuracy, first-phoneme retention, or latency.

### 7. Direct owner tests

Extend `greeting-interruption.test.ts` with injected loader/bridge/VAD/replace seams. Cover:

- loader rejection returns raw `generated: false`, does not call `createLocalAudioPreRoll` / `createBrowserVad`, and emits `runtime-unavailable`;
- bridge creation rejection returns raw, stores no bridge, and emits `bridge-unavailable`;
- post-attachment VAD setup failure requests replace after disabling raw, then destroys only the generated bridge;
- `onFailure` before acceptance follows the same raw-gated recovery;
- `startAutomaticTurn` rejection/timeout stops playback, replaces, releases raw immediately, and never claims a flush;
- `startManualTurn` rejection/timeout keeps the gate until settlement, then replaces and resumes live raw;
- raw is `enabled === false` before `replacePublication` is awaited;
- `'failed'` replace leaves generated/raw gated and does not release;
- `'stale'` replace cannot mutate a newer generation's sender;
- delayed VAD/bridge after `destroy()` is retired/destroyed locally;
- a local boundary during synthesis, after natural end, after Skip, or from a replaced operation cannot recover or flush;
- later OpenAI-unrelated callbacks cannot issue a second pre-roll or second replace;
- acoustic-uncertainty: feed a callback labeled as possible playback echo and assert ordering only.

### 8. Presentation and adapter tests

Presentation:

- enabled speak after pre-attachment fallback uses the existing raw gate, disables raw during greeting, and restores it on Skip/natural end;
- synthesis-period callback plus later VAD/setup failure cannot stop/flush before playback start;
- replacement greeting fences stale recovery from the previous operation.

Adapter, through `setGreetingInterruptionRuntimeImporterForTests` and a controllable `FakeSender.replaceTrack`:

- loader rejection: `connect()` succeeds, raw is attached, runtime/bridge/VAD factories are not used, greeting gates raw, Skip restores raw, no greeting-period replay path;
- bridge creation rejection: same raw-gate outcome, `connect()` succeeds;
- post-attachment VAD setup/callback failure: generated is replaced by disabled raw, voice stays connected, no `turn_mode` / `turnControl`;
- automatic-start failure: live raw resumes after successful replace, `startAutomaticTurn` is not retried, no pre-roll claim;
- manual-start failure: gate remains held until settlement, then live raw resumes;
- failed `replaceTrack`: publication stays gated, adapter emits `CONNECTION_FAILED`, teardown runs, no successful-degradation diagnostic;
- delayed prepare overtaken by disconnect destroys the late bridge and does not attach it;
- Skip versus local acceptance: exactly one terminal transition;
- playback-end versus disconnect: no double raw stop and no generated leak;
- reconnect: generation N+1 ignores delayed N replace/VAD/bridge work;
- after successful recovery, immediate and transcript-confirmed arbitration remain unchanged;
- omitted/`false` still never load runtime or call `replaceTrack`;
- no second pre-roll from later `speech_started` / useful-delta events.

Existing greeting, response-arbiter, immediate/transcript-confirmed, state, and teardown suites must stay green. The Phase 1 default-off bundle test must stay green.

## Acceptance checks

- Enabled `connect()` survives loader rejection and bridge creation failure by attaching raw behind the old gate.
- Loader failure performs no bridge/VAD work and cannot leak greeting-period audio.
- VAD setup, automatic-start, and manual-start failures preserve voice when generation-fenced raw replacement succeeds.
- No fallback publishes retained greeting-period audio. Raw is disabled before `replaceTrack`. Historical raw samples have no replay path.
- Automatic-start failure after playback stop resumes live raw without claiming pre-roll retention.
- Manual-start failure retains the non-interruptible gate until settlement, then resumes live raw.
- Failed sender replacement remains gated and fails closed through `CONNECTION_FAILED`.
- Pre-playback and stale post-playback callbacks stay fenced on every fallback path.
- Every partial and complete resource is released once; stale generations cannot touch current resources.
- Diagnostics stay on the allowlist.
- Existing greeting, response-arbiter, barge-in, state, teardown, and default-off suites remain green.

## Verify commands

Run from the workspace root:

```bash
bunx nx run @maelstrom-co/realtime-openai:check
bunx nx run @maelstrom-co/realtime-openai:test
bunx nx run @maelstrom-co/realtime-openai:typecheck
bunx nx run @maelstrom-co/realtime-openai:build
bunx nx run @maelstrom-co/realtime-vad:test
bunx nx run @maelstrom-co/realtime-vad:typecheck
```

Useful focused commands:

```bash
bun test --cwd packages/realtime-openai src/greeting-interruption.test.ts
bun test --cwd packages/realtime-openai src/greeting-presentation.test.ts
bun test --cwd packages/realtime-openai src/openai-adapter.test.ts src/default-off-bundle.test.ts
```

Before reporting completion, run diagnostics on every edited TypeScript file, then rerun the six Nx targets above.

## Dependencies

- Phase 2 owner, generated-track attachment, sender identity, playback hooks, and arm-epoch fencing.
- Phase 1 config discriminant and `setGreetingInterruptionRuntimeImporterForTests`.
- Existing `MicrophonePublicationGate`, `ConnectRaceGuard`, connection generations, and fatal `CONNECTION_FAILED` teardown.
- Same-kind `RTCRtpSender.replaceTrack` and `MediaStreamTrack.enabled = false`.

## Non-goals

- Do not fail voice merely because the optional runtime chunk cannot load.
- Do not continue using a bridge after a lifecycle acknowledgement failure.
- Do not release raw publication before generation-fenced replacement succeeds.
- Do not expose fallback state, VAD scores, or manual turn control.
- Do not restart a greeting after local acceptance later appears acoustically wrong.
- Do not implement demo/docs/device-matrix work; that is Phase 4.
- Do not change shared realtime-VAD or pre-roll contracts.
- Do not claim real-device self-echo rejection, VAD accuracy, first-phoneme retention, or latency.
- Do not commit or edit `.apnea/state.json`.
