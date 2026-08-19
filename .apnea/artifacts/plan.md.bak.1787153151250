---
status: done
---

# Plan: user-controlled voice greeting and interruption

## Goal restatement

Redesign PR 117 so the fixed greeting never blocks a user from starting their task. Ship a dependable, accessible **Skip greeting** action first; then deepen the modules that own greeting, response, microphone, and shared-session invariants; finally add an opt-in, provider-neutral route to spoken interruption with local pre-roll. Throughout, retain at-most-once Engine/provider history, deterministic reconnects, exact microphone-state restoration, greeting self-echo protection, normal post-greeting barge-in, privacy-safe diagnostics, and existing LiveKit behavior. Do not present unit-tested audio plumbing as proof of real-device acoustic behavior.

## Phase 1 — Ship explicit Skip greeting with terminal semantics

### Intent

Deliver the user-control outcome without depending on acoustic detection. Add one idempotent session operation that terminally skips the configured greeting, expose it through `useVoice()`, and render an accessible Skip greeting button while preparation is active.

The terminal race contract must be explicit:

- Skip records terminal proof synchronously before aborting current greeting work. Reconnects, remounts, and recreation of the provider session for the same Maelstrom session must remain skipped.
- If Skip wins before Engine acknowledgement starts or completes, no caption, provider history item, synthesis request, or playback may start.
- An Engine acknowledgement or provider send that became irreversible before Skip may remain, but it must occur at most once; Skip must prevent every later caption/send/playback step and all reconnect retries. The implementation must not pretend it can roll back an already delivered side effect.
- If synthesis, decode, or playback is active, Skip stops it and restores every microphone track to its exact captured `enabled` value before releasing operation ownership.
- Repeated Skip, Skip after another terminal result, Skip racing disconnect/fatal error, and stale completions are no-ops against the newer terminal/generation owner.

Represent skipped presentation distinctly (for example, an additive `skipped` `GreetingState` and terminal reason in the coordinator snapshot) rather than collapsing it into retryable `pending` or ambiguous `settled`. Keep `skipGreeting()` synchronous and idempotent at the `RealtimeSession`/hook interface so UI callers do not need to coordinate abort controllers or provider capabilities.

### Files likely touched

- `packages/realtime/src/lib/greeting-coordinator.ts`
- `packages/realtime/src/lib/greeting-coordinator.test.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.types.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`
- `packages/realtime/src/index.ts`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`
- `apps/demo/src/components/voice-control.tsx`
- `apps/demo/src/components/voice-control.test.tsx`
- `apps/docs/e2e/fixtures/voice/openai-voice-control.tsx`
- `apps/docs/src/content/docs/guides/voice/openai-realtime.mdx`
- `docs/realtime-voice-architecture.md`

### Acceptance checks

- A configured greeting in `preparing` exposes one clearly named **Skip greeting** button; it is keyboard operable, has a usable touch target, does not overflow at mobile or desktop widths, and does not create a second competing live region.
- Activating Skip immediately removes the action and leaves a connected session ready for the user's task; idle, error, listening, thinking, and speaking labels retain precedence.
- Coordinator/session tests cover Skip during Engine wait, in-flight acknowledgement, provider handoff, synthesis, decode, and playback, plus duplicate clicks, disconnect rejection, reconnect, shared-session recreation, new session IDs, and stale generations.
- Tests assert zero-or-one Engine acknowledgement, caption, provider item, synthesis, and playback according to the documented race point; no path duplicates provider or Engine history.
- Existing OpenAI greeting abort tests continue to prove exact prior microphone state restoration, including initially disabled and multiple unique tracks.
- Existing LiveKit greeting/readiness/barge-in tests remain unchanged and green.

### Verify commands

```bash
bun test packages/realtime/src/lib/greeting-coordinator.test.ts packages/realtime/src/lib/realtime-session/realtime-session.test.ts
bun test packages/react-realtime/src/lib/use-voice.test.tsx
bun test apps/demo/src/components/voice-control.test.tsx
bunx nx typecheck @maelstrom-co/realtime --skipSync
bunx nx typecheck @maelstrom-co/react-realtime --skipSync
bunx nx typecheck @maelstrom-co/demo --skipSync
bunx biome check packages/realtime/src packages/react-realtime/src/lib/maelstrom-realtime.ts packages/react-realtime/src/lib/use-voice.test.tsx apps/demo/src/components/voice-control.tsx apps/demo/src/components/voice-control.test.tsx --error-on-warnings
```

### Dependencies

None. This is the first independently shippable slice and the fallback user-control mechanism for all later acoustic work.

### Non-goals

- Spoken greeting interruption or claims that VAD can distinguish the user from speaker output.
- Changing OpenAI server-VAD defaults or LiveKit turn-taking.
- Removing an Engine/provider history item that was already irreversibly accepted before Skip won.

## Phase 2 — Deepen the ownership modules without changing behavior

### Intent

Replace the growing cross-coupled state in the adapters and React binding with deep, package-private modules. Write characterization tests first, then move behavior behind small interfaces; delete obsolete or compensating flags when the new owner can derive them instead of copying the same state into new files.

Create four clear seams:

1. **OpenAI response arbitration** owns response identity, validated-turn/tool-follow-up priority, cancellation attribution, late output-clear obligations, fatal `response.create` send closure, and generation reset. The adapter supplies typed provider facts and executes returned wire commands; it does not mutate arbiter internals. Delete the unused `response-lifecycle` state machine once the arbiter covers the real behavior.
2. **OpenAI greeting presentation** owns gesture activation, provider history handoff, synthesis/decode/playback, replacement/abort/Skip, and operation ownership. Engine acknowledgement and replay policy remain in `GreetingCoordinator`; presentation must not duplicate that responsibility.
3. **Microphone publication gating** owns one generation-scoped snapshot and idempotent acquire/release. Its interface must guarantee exact prior `enabled` restoration and stale-owner no-ops; callers must not carry parallel gate/controller/generation fields.
4. **Shared React session operations** own the per-Orchestrator session/coordinator entry, consumer reference count, microtask retirement, eviction-before-disconnect ordering, and reacquisition races. `useVoice()` remains responsible only for React subscriptions and callbacks.

Keep these modules package-private unless a second real adapter requires the seam. Test through each module interface and retain adapter/session integration tests for ordering across seams.

### Files likely touched

- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/response-lifecycle.ts` (delete after replacement)
- `packages/realtime-openai/src/response-lifecycle.test.ts` (delete after replacement)
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`
- `packages/realtime-openai/src/` (new package-private arbiter, greeting-presentation, and publication-gate modules with focused tests)
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`
- `packages/react-realtime/src/lib/` (new package-private shared-session operations module and focused tests)
- `packages/realtime/src/lib/greeting-coordinator.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.ts`
- `docs/realtime-voice-architecture.md`

### Acceptance checks

- Public exports and Phase 1 Skip behavior are unchanged; package-private refactoring does not add provider-specific concepts to `RealtimeSession`.
- The response arbiter's table/sequence tests preserve: one active response, tool follow-up priority, item correlation, exactly-once cancel, proven-empty versus ambiguous cancellation handling, late audio clear, send-failure closure, re-entrant provider events, and stale-generation rejection.
- Greeting presentation tests preserve Engine ack → caption → provider item → synthesis → playback ordering, terminal handoff semantics, Skip/abort/replacement behavior, and exact gate restoration.
- Shared-session tests preserve simultaneous/late consumers, Strict Mode-style mount churn, retirement deduplication, eviction before async disconnect, reacquisition during teardown, and coordinator proof across session recreation.
- The old response lifecycle module and redundant adapter/session flags are deleted rather than left as two sources of truth.
- OpenAI and LiveKit package integration suites remain green; there is no LiveKit runtime change in this phase.

### Verify commands

```bash
bunx nx test @maelstrom-co/realtime-openai --skipSync
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync
bunx nx test @maelstrom-co/realtime --skipSync
bunx nx typecheck @maelstrom-co/realtime --skipSync
bunx nx test @maelstrom-co/react-realtime --skipSync
bunx nx typecheck @maelstrom-co/react-realtime --skipSync
bunx nx test @maelstrom-co/realtime-livekit --skipSync
bunx biome check packages/realtime-openai/src packages/realtime/src packages/react-realtime/src --error-on-warnings
```

### Dependencies

Phase 1, so Skip is a fixed behavior that the extracted modules must preserve.

### Non-goals

- A public framework for hypothetical providers; one adapter does not justify a public seam.
- Enabling local VAD for OpenAI greetings.
- Moving fields unchanged into shallow state-holder classes.
- Altering wire payloads, server-VAD tuning, or LiveKit runtime ordering.

## Phase 3 — Add an opt-in provider-neutral spoken-interruption path with pre-roll

### Intent

Build the reusable browser-audio path needed to interrupt a greeting by speech without dropping the start of the utterance, but keep it opt-in until real-device gates pass. The reliable Skip action remains available regardless of VAD/worklet support.

Generalize the existing LiveKit-local AudioWorklet pre-roll implementation into `@maelstrom-co/realtime-vad` rather than creating a second ring buffer. Its interface must separate browser-local capture from transport publication and support bounded buffering, silence/closed publication, one ordered pre-roll flush, live pass-through, clear, and idempotent destroy. LiveKit should consume the generalized primitive with byte-for-byte-equivalent turn ordering and failure behavior.

For OpenAI's opt-in greeting-interruption mode:

- Capture remains local while greeting publication is closed; speaker output must never be intentionally forwarded to OpenAI during the gate.
- A generation-owned local VAD observes the local stream. On an accepted speech start, stop local greeting playback first, then open publication and flush bounded pre-roll before live samples so the first utterance can enter the existing OpenAI server-VAD/transcription path.
- Retire the greeting-only VAD and return to normal OpenAI server-VAD behavior once greeting presentation is played, skipped, interrupted, failed, or disconnected. Intentional barge-in after greeting must continue to use the existing configured immediate/transcript-confirmed policy.
- VAD/worklet setup or callback failure fails closed to the Phase 1 explicit Skip path; it must not leak greeting-period audio, wedge preparation, silently enable a different turn mode, or affect a replacement generation.
- Keep the option disabled by default and do not enable it in the hosted demo until the real-device matrix below has evidence. Unit tests prove ordering and state ownership, not echo cancellation or speech recognition quality.

Diagnostics may report only bounded categories/reason codes, booleans such as gate/VAD activity, and non-content timing. They must never log audio, transcript/delta text, complete media settings, stream/track objects, device identifiers, credentials, or raw provider events containing content.

### Files likely touched

- `packages/realtime-vad/src/index.ts`
- `packages/realtime-vad/src/browser-vad.ts`
- `packages/realtime-vad/src/browser-vad.test.ts`
- `packages/realtime-vad/src/browser-vad.types.ts`
- `packages/realtime-vad/src/` (generalized pre-roll/publication module and tests)
- `packages/realtime-vad/README.md`
- `packages/realtime-livekit/src/local-audio-pre-roll.ts` (move/delete after generalization)
- `packages/realtime-livekit/src/local-audio-pre-roll.test.ts` (move/delete after generalization)
- `packages/realtime-livekit/src/livekit-adapter.ts`
- `packages/realtime-livekit/src/livekit-adapter.test.ts`
- `packages/realtime-livekit/README.md`
- `packages/realtime-openai/package.json`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/README.md`
- `apps/demo/src/lib/maelstrom.ts`
- `apps/demo/src/lib/maelstrom.test.ts`
- `apps/docs/src/content/docs/guides/voice/openai-realtime.mdx`
- `apps/docs/src/content/docs/guides/voice/livekit-cascade.mdx`
- `apps/docs/src/content/docs/understanding/browser-vad-and-barge-in.mdx`
- `docs/realtime-voice-architecture.md`
- `bun.lock`

### Acceptance checks

- Audio-worklet tests prove a bounded ring, one pre-roll flush before live samples, no duplication across rapid starts, clear/misfire behavior, acknowledgement bounds, and stale/destroyed generation no-ops.
- OpenAI mocked tests prove greeting-period publication stays closed, speech-trigger ordering is playback stop → publication open → pre-roll → live audio, Skip remains available, and failure/disconnect/reconnect restores exact prior track/publication state.
- Cross-layer tests preserve one Engine message, one caption, and at most one provider history item whether the greeting plays, is explicitly skipped, or is interrupted by the opt-in spoken path.
- Normal post-greeting immediate and transcript-confirmed barge-in regression suites remain unchanged and green.
- LiveKit tests prove its existing pause-before-idle, resume-before-pre-roll, manual degradation, misfire, teardown, TTS cancellation, and reconnect behavior did not change when the primitive moved.
- Documentation labels the spoken path experimental/opt-in, states the fallback, provides trusted VAD asset setup, and records the unverified acoustic claims rather than implying guarantees.

### Real-device validation gate

Before changing the default or enabling the spoken path in the hosted demo, record pass/fail evidence for current Safari/iOS, Chrome/Android, and desktop Safari/Chrome using built-in speaker/mic, earpiece where available, wired headset, and Bluetooth routes. At minimum verify:

1. Skip during Engine wait, synthesis, and playback stops promptly; the immediately following first utterance is complete and executes once.
2. Spoken interruption preserves the first phoneme/word with no duplicate prefix and reaches the task exactly once.
3. The greeting alone does not trigger interruption or reach provider transcription/history at supported playback volumes.
4. Quiet and normal speakers can interrupt; fan noise, sustained sibilance, keyboard noise, and room speech do not cause unacceptable false starts.
5. Post-greeting barge-in still works in both OpenAI policies, and reconnect/new-session behavior matches terminal proof.
6. Microphone indicators, permission prompts, autoplay unlock, route changes, background/foreground transitions, and Bluetooth handoffs recover without a hot-mic or stuck-silence state.

If any required route fails, keep the feature opt-in/default-off, preserve explicit Skip, document the failure, and do not convert the failed observation into a product claim.

### Verify commands

```bash
bunx nx test @maelstrom-co/realtime-vad --skipSync
bunx nx typecheck @maelstrom-co/realtime-vad --skipSync
bunx nx test @maelstrom-co/realtime-livekit --skipSync
bunx nx typecheck @maelstrom-co/realtime-livekit --skipSync
bunx nx test @maelstrom-co/realtime-openai --skipSync
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync
bunx nx test @maelstrom-co/demo --skipSync
bunx nx typecheck @maelstrom-co/demo --skipSync
CI=1 bunx nx run @maelstrom-co/docs:e2e --skipSync
bunx biome check packages/realtime-vad packages/realtime-livekit packages/realtime-openai apps/demo/src/lib/maelstrom.ts apps/demo/src/lib/maelstrom.test.ts apps/docs/src/content/docs/guides/voice apps/docs/src/content/docs/understanding/browser-vad-and-barge-in.mdx docs/realtime-voice-architecture.md --error-on-warnings
```

### Dependencies

Phase 2's greeting-presentation and publication-gate seams. Reuse the existing `@maelstrom-co/realtime-vad` callback model and LiveKit pre-roll behavior rather than adding a parallel detector.

### Non-goals

- Enabling spoken interruption by default before device evidence exists.
- Claiming AEC/NS/AGC, VAD accuracy, no self-echo, first-phoneme preservation, or interruption latency from mocks.
- Replacing OpenAI server VAD after greeting.
- Changing LiveKit semantics beyond intentionally sharing the provider-neutral audio primitive.

## Acoustic claims that remain unverified by automated tests

The run must leave this list in user/contributor documentation with current device evidence, including explicit “not tested” entries:

- Browser/OS AEC actually removes the app's own greeting on each speaker/microphone/audio route.
- Local VAD distinguishes a real user from greeting playback, background speech, fans, sibilance, and transient noise at acceptable false-positive/false-negative rates.
- Configured pre-roll preserves the first phoneme/word without audible gaps, duplication, resampling artifacts, or excessive latency.
- Track/publication gating sends no intelligible greeting audio over real WebRTC implementations; `track.enabled` and mocked worklets alone do not prove this.
- Skip-to-listening and spoken-interruption latency feel prompt on supported mobile and desktop hardware.
- Normal post-greeting barge-in remains reliable at the configured OpenAI threshold and across LiveKit routes.
- Autoplay unlock, AudioWorklet behavior, permission state, route changes, backgrounding, and Bluetooth transitions behave consistently on supported devices.
- Requested/applied AEC, NS, and AGC booleans describe configuration only, not acoustic effectiveness.

## Definition of done

- All three phases are delivered in order and each phase leaves its focused package set green.
- Explicit Skip is production-usable, accessible, idempotent, terminal for the same session, and available even when experimental spoken interruption is unavailable or fails.
- Engine acknowledgement, caption, provider history, synthesis, and playback have documented linearization points and at-most-once regression coverage across Skip/interruption/disconnect/reconnect races.
- Microphone/publication ownership restores exact prior state and stale work cannot alter a replacement generation.
- Response arbitration, greeting presentation, microphone gating, and shared-session lifecycle each have one deep owner; obsolete compensating state/tests are removed.
- LiveKit behavior is unchanged except for the explicitly tested reuse of the generalized pre-roll primitive.
- Diagnostics remain privacy-safe and documentation covers the public interfaces, fallback behavior, mobile/desktop UX, manual matrix, and residual acoustic uncertainty.
- Focused checks above pass, followed by the repository gate:

```bash
bunx nx run-many -t check test build typecheck e2e
```

- Any real-device failures or unrun matrix entries are recorded; the spoken path remains opt-in/default-off until the validation gate passes. No acoustic guarantee is inferred solely from automated tests.
