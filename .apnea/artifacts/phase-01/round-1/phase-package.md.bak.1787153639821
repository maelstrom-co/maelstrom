---
status: done
---

# Phase 1 package — explicit Skip greeting

## Phase outcome

Ship a production-usable **Skip greeting** action that lets a connected user proceed without waiting for the fixed greeting. Skip is synchronous, idempotent, and terminal for the current Maelstrom session: reconnecting or recreating the provider session must not replay the greeting. This phase does not add spoken interruption or alter VAD/LiveKit turn-taking.

## Required contract

Use these concrete semantics across the core, React binding, and demo:

- Add `'skipped'` to `GreetingState`. It is a distinct terminal presentation state, not an alias for retryable `pending` or ambiguous `settled`.
- Make `GreetingCoordinatorSnapshot` distinguish terminal reasons while keeping `lifecycle` available to current callers:
  - pending work: `{ lifecycle: 'pending' }`;
  - completed presentation: `{ lifecycle: 'terminal', reason: 'presented' }`;
  - an existing Engine dedupe that suppressed presentation: `{ lifecycle: 'terminal', reason: 'suppressed' }`;
  - explicit user choice: `{ lifecycle: 'terminal', reason: 'skipped' }`.
- Add one synchronous, idempotent coordinator operation for the current `SessionId` that records `skipped` only if no earlier terminal outcome won. Return whether this call performed the transition so `RealtimeSession` can distinguish a winning Skip from a late no-op.
- Add synchronous `RealtimeSession.skipGreeting(): void`. It must:
  1. no-op when no greeting is configured;
  2. ask the coordinator to record terminal Skip before aborting work;
  3. if Skip wins, abort and release the owned greeting generation, then publish `greetingState === 'skipped'`;
  4. no-op after `presented`/`suppressed`, and remain idempotent after `skipped`;
  5. never disconnect the provider or alter normal voice state/turn mode.
- Add `skipGreeting: () => void` to `UseVoiceResult`, backed by the shared `RealtimeSession`; all hook consumers must observe the same terminal state.

### Race linearization

Tests and documentation must use these rules rather than asserting impossible rollback:

| Skip wins at | Required observable result |
| --- | --- |
| Before/during Engine readiness wait | No Engine acknowledgement, caption, provider item, synthesis, or playback. |
| While Engine acknowledgement is in flight | The already-started acknowledgement may resolve once; after Skip is observed there is no caption, provider item, synthesis, or playback. |
| After Engine insertion but before caption/provider handoff | The one Engine entry may remain; no later caption/provider/speech side effect starts. |
| During synthesis/decode/playback after provider handoff | Existing Engine/provider history remains at most once; local work aborts, microphone state is restored, and reconnect never retries. |
| After `presented` or `suppressed` is terminal | Skip is a no-op and does not rewrite the earlier outcome. |

A skipped run must check terminal Skip after every await and immediately before caption and provider speech. A stale run must never overwrite `'skipped'` with `'settled'` or `'pending'`.

## Exact implementation steps

### 1. Extend coordinator state and tests first

Edit:

- `packages/realtime/src/lib/greeting-coordinator.test.ts`
- `packages/realtime/src/lib/greeting-coordinator.ts`
- `packages/realtime/src/index.ts`

Steps:

1. Add failing tests for all rows in the race table, duplicate Skip, Skip after accepted/suppressed terminal outcomes, reconnect/run after Skip, and a new `SessionId` receiving independent greeting behavior.
2. Add the terminal-reason type and export it from `packages/realtime/src/index.ts` with the existing greeting coordinator types.
3. Store explicit skipped proof separately from persistence/speech phase; reset it only when the coordinator adopts a genuinely new session.
4. Make the coordinator's Skip operation mark proof synchronously. Do not await Engine/provider cleanup.
5. Check skipped proof at run entry, after Engine readiness, after acknowledgement, after synchronous caption delivery, and before/after provider speech. Return a dedicated `'skipped'` disposition where needed so callers cannot mistake it for retryable abort.
6. Give explicit Skip precedence over a later continuation from the same in-flight run, but do not rewrite a terminal `presented` or `suppressed` result.
7. Preserve existing at-most-once IDs and acknowledgement behavior; do not change `greetingIdFor()`.

### 2. Add the shared session operation and retained state

Edit:

- `packages/realtime/src/lib/realtime-session/realtime-session.types.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`

Steps:

1. Add `'skipped'` and its exact terminal meaning to `GreetingState` JSDoc.
2. Add session tests before implementation for Skip:
   - before provider connect resolves;
   - during Engine wait and in-flight acknowledgement;
   - while the fake greeting adapter is awaiting speech completion;
   - repeated calls;
   - calls with no configured greeting;
   - calls after accepted/suppressed terminal proof;
   - calls racing explicit disconnect, disconnect rejection, fatal adapter error, and stale connection completion;
   - reconnect and recreation with the same coordinator/session ID;
   - a fresh session ID greeting normally.
3. Implement `skipGreeting()` with coordinator-mark → controller-abort/release → retained-state publication ordering. Do not call `adapter.disconnect()`.
4. Update initial-state derivation, connect-time snapshot handling, greeting disposition handling, and teardown reset so terminal reason `skipped` always maps to `'skipped'`; other terminal reasons continue mapping to `'settled'`.
5. Ensure a skipped state prevents `#runGreetingGeneration` from starting after a still-pending provider handshake resolves.
6. Keep existing generation/identity guards. A late run, disconnect continuation, or provider event must not move `'skipped'` back to `'pending'`, `'preparing'`, or `'settled'`.
7. Assert subscribers receive `'skipped'` once for the winning transition and no duplicate notification for repeated Skip.

### 3. Make active OpenAI publication-gate release synchronous on caller abort

Edit only the greeting-abort path in:

- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/openai-adapter.ts`

Steps:

1. Strengthen the existing greeting abort tests so they call `AbortController.abort()` and immediately assert every unique microphone audio track has its exact prior `enabled` value, before awaiting the `speakAssistantText()` promise.
2. Route the caller signal's abort listener through the adapter's current operation-owned greeting abort/settle method, rather than merely aborting the inner controller and waiting for a later promise continuation.
3. Preserve stale operation and connection-generation guards. Replacement greeting cleanup must not restore over the replacement gate.
4. Do not change greeting synthesis, Web Audio player behavior, server VAD, response arbitration, wire payloads, or post-greeting barge-in.

This small adapter change is required so a user who clicks Skip can begin speaking immediately without waiting for asynchronous cleanup to restore the microphone.

### 4. Expose Skip through the shared React hook

Edit:

- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`

Steps:

1. Update test fakes to support the new snapshot reason, `'skipped'` state, and `skipGreeting()` operation.
2. Add `skipGreeting` to `UseVoiceResult` with JSDoc stating that it is synchronous, shared, idempotent, and does not disconnect voice.
3. Return a stable `useCallback(() => session.skipGreeting(), [session])` from `useVoice()`.
4. Test simultaneous and late consumers: one consumer skips, all mounted consumers observe `'skipped'`, a remounted/recreated provider session starts skipped, and only one coordinator transition occurs.
5. Confirm the existing session retirement/reacquisition behavior is untouched.

### 5. Render an accessible mobile/desktop action

Edit:

- `apps/demo/src/components/voice-control.test.tsx`
- `apps/demo/src/components/voice-control.tsx`

Steps:

1. Add `skipGreeting` to the test hook result and create tests for visibility, activation, duplicate rerender/click behavior, state-label precedence, keyboard use, and narrow layout.
2. Render a visible `<button type="button">Skip greeting</button>` only while `greetingState === 'preparing'` and voice is neither `idle` nor `error`.
3. Keep the button outside the existing `role="status" aria-live="polite"` element; do not add another live region. The existing status remains the sole announcement source.
4. On click, call `skipGreeting()` only. Do not disconnect or synthesize a fake transcript.
5. Treat `'skipped'` like `'settled'` only for the otherwise-connected label (`Listening`); real `listening`, `thinking`, `speaking`, `idle`, and `error` labels keep precedence.
6. Use the existing visual language, but retain a minimum 44px touch target, visible focus behavior, non-shrinking button text, wrapping container behavior, and no fixed width that overflows a narrow viewport.
7. Once the shared state becomes `'skipped'`, the button disappears and does not return on reconnect for that session.

### 6. Document the public behavior and compile-check the example

Edit:

- `apps/docs/e2e/fixtures/voice/openai-voice-control.tsx`
- `apps/docs/src/content/docs/guides/voice/openai-realtime.mdx`
- `docs/realtime-voice-architecture.md`

Steps:

1. Update the compile-checked voice-control fixture to consume `skipGreeting` and show the same conditional button semantics as the public example.
2. Document `GreetingState.skipped`, `UseVoiceResult.skipGreeting()`, same-session reconnect/recreation behavior, and the race table's irreversible-side-effect rule.
3. State that explicit Skip is the reliable path to immediate user control in this phase.
4. State plainly that this phase does not support spoken interruption during the gated OpenAI greeting and does not prove mobile timing, echo removal, VAD accuracy, or first-phoneme preservation on real devices.
5. Preserve the existing privacy statement: no audio, transcript content, stream/track object, device identity, or complete media settings may be added to diagnostics.

## Files to touch

Required:

- `packages/realtime/src/lib/greeting-coordinator.ts`
- `packages/realtime/src/lib/greeting-coordinator.test.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.types.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`
- `packages/realtime/src/index.ts`
- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`
- `apps/demo/src/components/voice-control.tsx`
- `apps/demo/src/components/voice-control.test.tsx`
- `apps/docs/e2e/fixtures/voice/openai-voice-control.tsx`
- `apps/docs/src/content/docs/guides/voice/openai-realtime.mdx`
- `docs/realtime-voice-architecture.md`

Touch only if an existing export/type fixture requires it after the additive public-interface change:

- `packages/react-realtime/src/index.ts`
- `packages/react-realtime/src/lib/removed-api.test-d.ts`

## Files and areas not to touch

- `.apnea/state.json`
- `packages/realtime-openai/src/response-lifecycle.ts`
- `packages/realtime-openai/src/response-lifecycle.test.ts`
- `packages/realtime-openai/src/openai-adapter.types.ts`
- `packages/realtime-vad/**`
- `packages/realtime-livekit/**`
- `packages/realtime-livekit-agent/**`
- `packages/realtime-livekit-server/**`
- `apps/demo/src/lib/maelstrom.ts`
- `apps/demo/src/lib/maelstrom.test.ts`
- Greeting TTS route/synthesizer files under `apps/demo/src/routes/api/` and `apps/demo/src/lib/demo-greeting-tts.ts`
- Dependency manifests and `bun.lock`
- Response arbitration, shared-session module extraction, pre-roll generalization, or any Phase 2/3 work

## Acceptance checks

### Automated behavior

- Skip is a first-class terminal state and wins synchronously before aborting asynchronous greeting work.
- No pre-Skip side effect is duplicated; post-Skip caption/provider/synthesis/playback work cannot begin.
- An already-started Engine acknowledgement or provider send may settle once but never causes replay.
- Same-session reconnect and shared-session recreation remain skipped; a new session can greet normally.
- Skip during active OpenAI greeting work restores all microphone tracks to exact prior values synchronously, including initially disabled and duplicate track references.
- Skip does not disconnect voice, alter turn mode, inject a transcript, or change OpenAI's normal post-greeting interruption behavior.
- Existing LiveKit tests pass without source changes.

### UI/accessibility

- Exactly one visible **Skip greeting** button appears only during active preparation.
- Mouse, touch, Enter, and Space activation use native button behavior.
- The action has at least a 44px touch target, visible focus, and no narrow-screen overflow.
- The existing single polite status region remains the only live region.
- After Skip, an otherwise connected session reads `Listening`; active/error/off labels retain precedence.

### Documentation

- Public state/callback semantics and race behavior are documented.
- The fixture compiles and rendered docs remain verbatim with the source fixture.
- The docs do not claim spoken greeting interruption or verified acoustic behavior.

## Verify commands

Run from the workspace root, in this order:

```bash
bun test packages/realtime/src/lib/greeting-coordinator.test.ts packages/realtime/src/lib/realtime-session/realtime-session.test.ts
bun test packages/realtime-openai/src/openai-adapter.test.ts
bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/use-voice.test.tsx
bun --cwd apps/demo test src/components/voice-control.test.tsx
bunx nx test @maelstrom-co/realtime --skipSync
bunx nx typecheck @maelstrom-co/realtime --skipSync
bunx nx test @maelstrom-co/realtime-openai --skipSync
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync
bunx nx build @maelstrom-co/react --skipSync --skipNxCache
bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/react-realtime --skipSync --skipNxCache
bunx nx test @maelstrom-co/demo --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/demo --skipSync --skipNxCache
bunx nx test @maelstrom-co/realtime-livekit --skipSync --skipNxCache
CI=1 bunx nx run @maelstrom-co/docs:e2e --skipSync --skipNxCache
bunx biome check packages/realtime/src packages/realtime-openai/src/openai-adapter.ts packages/realtime-openai/src/openai-adapter.test.ts packages/react-realtime/src/lib/maelstrom-realtime.ts packages/react-realtime/src/lib/use-voice.test.tsx apps/demo/src/components/voice-control.tsx apps/demo/src/components/voice-control.test.tsx apps/docs/e2e/fixtures/voice/openai-voice-control.tsx apps/docs/src/content/docs/guides/voice/openai-realtime.mdx docs/realtime-voice-architecture.md --error-on-warnings
```

If focused checks pass, run the phase-wide repository gate:

```bash
bunx nx run-many -t check test build typecheck e2e
```

## Non-goals

- Spoken greeting interruption, local VAD during greeting, or pre-roll.
- Any claim that AEC/NS/AGC prevents real-device self-echo or that the first phoneme is acoustically preserved.
- OpenAI response-arbiter extraction or deletion of compensating scheduler state.
- Greeting-presentation/publication-gate/shared-session module extraction.
- OpenAI threshold, `bargeInMode`, transcription, session payload, or wire-protocol changes.
- LiveKit source changes, TTS cancellation changes, VAD changes, or turn-boundary changes.
- Removing or compensating for Engine/provider history that became irreversible before Skip won.
- Committing, pushing, or editing `.apnea/state.json`.
