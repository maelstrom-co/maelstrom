---
status: done
---

# Phase 1 package — provider-neutral local audio pre-roll

## Phase outcome

Add a standalone, documented local-audio pre-roll primitive to the root of `@maelstrom-co/realtime-vad`, with sample-level AudioWorklet tests and browser-lifecycle tests. At the end of this phase, realtime-vad is independently buildable, packable, and consumable, while the existing LiveKit-local implementation remains unchanged so both packages stay green. LiveKit migration and duplicate deletion belong to Phase 2.

## Required contract

Add this provider-neutral root API in `packages/realtime-vad/src/local-audio-pre-roll.ts` and re-export it from `packages/realtime-vad/src/index.ts`:

- `createLocalAudioPreRoll(sourceTrack: MediaStreamTrack): Promise<LocalAudioPreRoll>`
- `LocalAudioPreRoll.track: MediaStreamTrack`
- `LocalAudioPreRoll.startAutomaticTurn(preRollMs: number): Promise<void>`
- `LocalAudioPreRoll.startManualTurn(): Promise<void>`
- `LocalAudioPreRoll.clear(): Promise<void>`
- `LocalAudioPreRoll.endTurn(): Promise<void>`
- `LocalAudioPreRoll.destroy(): Promise<void>`

Use these semantics:

- `sourceTrack` is caller-owned. The bridge must never disable or stop it.
- `track` is bridge-owned. It is the generated publication track and must be disabled and stopped during destruction.
- Closed/idle mode emits silence and retains only the newest bounded source tail.
- Automatic start publishes the selected newest tail exactly once before live samples accepted after the start.
- Manual start discards retained/queued audio and publishes only new live input.
- `clear()` discards retained/queued audio and returns to closed silent buffering.
- `endTurn()` stops accepting new automatic live input, drains audio already accepted, acknowledges only after that drain, and returns to closed silent buffering.
- Pre-roll is clamped to 0–500 ms; non-finite values select zero. Convert the bounded duration to samples with the AudioContext sample rate.
- Automatic/manual/clear requests time out after 250 ms.
- End acknowledgement times out after `min(1500, 500 + 2 * clamp(activePreRollMs, 0, 500))` ms.
- Every acknowledged operation carries a monotonically increasing request ID. Unknown, duplicate, stale, and late IDs are ignored.
- A request timeout removes only that pending request, posts an unacknowledged processor clear, and rejects with the existing timeout error. A later operation must be able to succeed.
- `destroy()` is idempotent, clears processor state, settles outstanding lifecycle waits, releases every acquired bridge resource once, and causes later lifecycle calls to reject as destroyed.

All exported declarations and interface members need consumer-facing JSDoc. Describe observable ordering, limits, timeouts, and ownership; do not expose LiveKit terminology in this API.

## Exact implementation steps

### 1. Add the provider-neutral module and public types

Create:

- `packages/realtime-vad/src/local-audio-pre-roll.ts`

Steps:

1. Use the existing implementation in `packages/realtime-livekit/src/local-audio-pre-roll.ts` as a read-only behavioral baseline; do not edit or delete it in this phase.
2. Define private constants for the processor name, 500 ms maximum pre-roll, 250 ms ordinary acknowledgement timeout, and the existing end-timeout formula.
3. Define `LocalAudioPreRoll` with declaration-visible JSDoc on the interface, `track`, and all five lifecycle methods.
4. Document `createLocalAudioPreRoll` as provider-neutral: it receives one caller-owned source, exposes one bridge-owned generated track, and leaves transport publication/pause ordering to the caller.
5. Keep the API on the package root only. Do not add an export-map subpath or edit package visibility.

### 2. Implement fail-closed Web Audio setup and complete cleanup

In `createLocalAudioPreRoll`:

1. Reject with the existing unsupported-browser error if `AudioContext` or `AudioWorkletNode` is unavailable.
2. Create the AudioContext and retain optional references for every resource as it is acquired: source node, generated track, object URL, worklet node/port, and context.
3. Create the media-stream source from `new MediaStream([sourceTrack])`, create the destination, and establish that the destination produced an audio track. Initialization must reject if no generated audio track exists.
4. Build the processor module from the worklet source Blob, create/revoke its object URL exactly once, load the module, create the one-channel worklet with `maxSamples = ceil(sampleRate * 500 / 1000)`, connect source → worklet → destination, and resume the context.
5. Implement one cleanup routine with per-resource guards. A failure in URL revocation, port close, node disconnect, source disconnect, generated-track disable/stop, or context close must not prevent attempts to release later resources.
6. During failed construction, preserve the original construction error even if cleanup also fails. During normal destruction, surface the first cleanup error only after all cleanup attempts have run.
7. Disable and stop the generated track exactly once. Never mutate or stop `sourceTrack`.
8. Ensure a second `destroy()` is a no-op even if the first call encountered a cleanup rejection after marking the generation destroyed.

### 3. Implement the ID-fenced lifecycle protocol

Still in `createLocalAudioPreRoll`:

1. Maintain a monotonically increasing request ID and a `Map` of pending requests containing resolve, reject, and timeout handles.
2. Set `node.port.onmessage` to accept only an ID currently in that map. Delete and clear the matching timeout before resolving. Ignore messages without IDs and IDs no longer pending.
3. Add one private request helper that:
   - rejects immediately after destruction;
   - inserts the pending entry before posting `{ type, id, ...data }`;
   - on timeout, deletes that exact ID, posts best-effort `{ type: 'clear' }` without an ID, and rejects with `Audio pre-roll worklet request timed out`.
4. `startAutomaticTurn()` clamps its duration, sends the rounded sample count, and records the active bounded duration only after acknowledgement. Reset active duration to zero if it rejects.
5. `startManualTurn()` and `clear()` use the 250 ms request timeout and reset active duration in `finally`.
6. `endTurn()` derives its timeout from the active automatic duration and resets active duration in `finally`.
7. `destroy()` marks the bridge destroyed before any await, posts a best-effort unacknowledged clear, clears all pending timers, settles pending callers using the existing LiveKit behavior, empties the map, and then invokes complete cleanup.

### 4. Implement the sample processor without provider coupling

Embed the AudioWorklet processor source in the new module and preserve the existing one-channel ring/queue design:

1. In idle mode, fill every output frame with zeros and append input samples to a fixed-size ring. Once full, overwrite from the oldest position so only the newest `maxSamples` remain.
2. On `automatic-start`, clamp the requested count to the retained ring length, clear any prior output queue, enqueue only the newest requested ring tail in chronological order, clear the ring, enter automatic mode, and acknowledge that request ID.
3. On `manual-start`, clear ring and queue, enter manual mode, and acknowledge. Manual processing copies only current input to output.
4. On `clear`, return to idle, clear ring/queue and any pending end ID, and acknowledge only when the clear message itself has an ID. Timeout/destroy clears have no ID and therefore produce no stray acknowledgement.
5. On `end`, acknowledge immediately after returning idle if no automatic queue needs draining. Otherwise store that end ID and stop enqueuing new live samples.
6. In automatic processing, enqueue new live samples only before end begins, then dequeue into output. This guarantees existing pre-roll precedes later live samples.
7. Once an ending automatic queue reaches zero, clear the stored end ID, enter idle, and acknowledge that end. Subsequent idle frames are silent and begin retaining a fresh tail.
8. A rapid later start must clear prior queued output before selecting a new tail, so an older prefix cannot be replayed or duplicated.

### 5. Add processor-level sample tests

Create:

- `packages/realtime-vad/src/local-audio-pre-roll.test.ts`

Build a deterministic processor harness that exercises the actual embedded worklet source:

1. Capture the Blob module supplied to the fake `audioWorklet.addModule`, evaluate it against fake `AudioWorkletProcessor` and `registerProcessor` globals, retain the registered processor class, and give instances a controllable message port.
2. Drive processor `port.onmessage` and `process()` directly with short `Float32Array` inputs/outputs. Assert sample arrays and acknowledgement IDs, not only posted message types.
3. Restore every replaced browser global, URL function, timer mode, and mock in `finally` blocks. The package test target runs isolated files, but each test must still clean up its own mutations.
4. Cover closed silence plus bounded ring wraparound: feed more than `maxSamples`, assert outputs remain zero, then prove only the newest retained values are available.
5. Cover newest-tail-before-live ordering: retain a recognizable sequence, request a shorter tail, process recognizable live samples, and assert one exact ordered output with no dropped, reordered, or duplicated prefix.
6. Cover zero/full bounded pre-roll and rapid consecutive automatic starts. A later start must not replay an older queue or tail.
7. Cover manual discard: retained/queued values disappear and only samples arriving after manual start pass through.
8. Cover explicit clear from idle, automatic, manual, and pending-end states: retained/queued samples and pending end ownership are discarded, the matching clear ID is acknowledged, and later idle output is silent.
9. Cover end drain: no new input is accepted once end is pending, the end ID is not acknowledged early, existing queued data drains, and the next frame is silent/closed.

### 6. Add browser lifecycle, fencing, ownership, and failure tests

In the same test file, add a separate fake Web Audio harness around the public factory:

1. Port the useful timeout and teardown cases from the LiveKit-local test as provider-neutral tests; do not remove that old test in this phase.
2. Verify processor options use 24,000 maximum samples at 48 kHz.
3. Table-test end acknowledgement at 500 ms for 0 ms pre-roll, 1,000 ms for 250 ms, and 1,500 ms for 500 ms. Prove acknowledgement just before each bound succeeds and absence just beyond it rejects.
4. Verify automatic/manual/clear requests use 250 ms and reset the active pre-roll duration after failure.
5. Hold one timed-out end acknowledgement, begin a later request, deliver the stale ID, and prove it cannot settle the current request. Then deliver the current ID and prove it settles exactly once.
6. Verify timeout posts one unacknowledged clear before the next accepted turn, and prove a subsequent automatic request can recover.
7. Verify unsupported APIs and missing generated tracks reject and release everything acquired so far.
8. Use table-driven injected failures at module load, worklet construction/connection, context resume, and cleanup operations. Assert URL revocation, node/source disconnection, generated-track disable/stop, port close, and context close according to which resources existed.
9. Verify the original initialization error remains the rejection even when a cleanup operation also throws.
10. Verify successful destruction resolves pending operations, closes/stops each bridge-owned resource once across repeated calls, leaves source `enabled` and `stop` untouched, and makes later start/manual/clear/end calls reject as destroyed.

### 7. Export and document the primitive

Edit:

- `packages/realtime-vad/src/index.ts`
- `packages/realtime-vad/README.md`

Steps:

1. Update the package-level JSDoc to describe both independent capabilities: browser VAD and local publication buffering.
2. Re-export `createLocalAudioPreRoll` and `LocalAudioPreRoll` from `./local-audio-pre-roll.js`.
3. Add a README usage example that publishes `bridge.track`, starts automatic/manual turns, clears a cancelled turn, ends/drains a completed turn, and destroys the bridge.
4. Document that the caller owns the source and transport ordering, especially that transport publication/upstream must be ready before automatic start emits buffered samples.
5. Document silent closed buffering, newest-tail ordering, 0–500 ms clamping, acknowledgement bounds, timeout recovery, and generated-resource ownership.
6. Move the generic Blob-backed AudioWorklet CSP requirement into this README: supported deployments must allow `blob:` worklet scripts.
7. Keep existing browser-VAD asset and contributor-isolation guidance intact.
8. Update the entry-point list to include the new root exports; do not add a package subpath.

## Files to touch

Required:

- `packages/realtime-vad/src/local-audio-pre-roll.ts` (new)
- `packages/realtime-vad/src/local-audio-pre-roll.test.ts` (new)
- `packages/realtime-vad/src/index.ts`
- `packages/realtime-vad/README.md`

## Files and areas not to touch

- `.apnea/state.json`
- `packages/realtime-vad/package.json` — especially `publishConfig`; it must remain without `access`
- `packages/realtime-vad/vite.config.ts` and tsconfig files; the root re-export is sufficient for the existing build
- `packages/realtime-livekit/**` — read the local implementation/tests only as behavioral references; migration and deletion are Phase 2
- `packages/realtime-openai/**`
- Other package manifests and `bun.lock`
- `tools/public-api-docs/**`; do not change audit discovery to include this package
- Generated/ignored `dist/**` files as authored source; produce them only through the build verification
- Any OpenAI greeting, interruption, provider, API, dependency, test, or documentation surface

## Acceptance checks

### Processor behavior

- Closed output is silent while the fixed ring retains only the newest bounded samples.
- Automatic output contains one newest retained tail followed by later live input, in order and without duplication across rapid starts.
- Manual and clear operations discard old ring/queue contents; manual passes only new live input, while clear returns to silent closed buffering.
- End drains only already accepted automatic audio, acknowledges after the queue empties, and closes publication.

### Lifecycle and ownership

- All operations are request-ID fenced; stale/late acknowledgements cannot settle a newer request.
- Ordinary and end acknowledgement timeouts use their exact documented bounds, clear uncertain processor state, and permit a later request to recover.
- Partial initialization and cleanup failures release every acquired resource possible while preserving the primary construction error.
- Source ownership remains with the caller. Generated track, port, nodes, URL, and context are bridge-owned and released once.
- Destroy settles pending work, is idempotent, and fences later lifecycle calls.

### Public package surface

- Root source and generated declarations expose the factory and interface with consumer-facing JSDoc on every public member.
- The VAD README accurately documents standalone use and does not describe the implementation as LiveKit-owned.
- The package builds and packs with runtime/declaration artifacts present.
- A clean temporary project installs the tarball, typechecks root exports with `skipLibCheck: false`, and runtime-imports the root functions.
- `publishConfig.access` remains absent. Do not invoke `audit:public-api-docs --packages=@maelstrom-co/realtime-vad`; the package is intentionally outside that selector.

### Phase boundary

- Existing LiveKit source, tests, README, dependency manifest, and behavior are unchanged in Phase 1.
- No OpenAI file, API, dependency, or behavior changes.

## Verify commands

Run from the workspace root. Each block fails closed.

### Focused VAD checks

```bash
set -euo pipefail
bunx nx run-many -t test build typecheck lint --projects=@maelstrom-co/realtime-vad --parallel=false --skipSync
```

### Declaration, tarball, and clean-consumer checks

Do not use the inapplicable public-package audit selector.

```bash
bash .apnea/verify-realtime-vad-packed.sh
```

## Non-goals

- Editing LiveKit source/tests/docs, switching its import, or deleting its duplicate in this phase.
- Changing the existing LiveKit adapter's turn ordering, VAD misfire behavior, fallback/degradation, timeout handling, reconnect, or teardown.
- Adding a new export subpath or changing realtime-vad package distribution visibility.
- Modifying browser-VAD detection, asset copying, dependency pins, or VAD defaults.
- Adding any OpenAI API, dependency, greeting/interruption path, test, documentation, or runtime behavior.
- Running the serial whole-repository gate; that is required after Phase 2 on the final tree.
- Committing, pushing, or editing `.apnea/state.json`.
