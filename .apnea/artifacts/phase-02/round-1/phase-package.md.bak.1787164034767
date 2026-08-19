---
status: done
---

# Phase 2 package — deepen voice ownership modules

## Phase outcome

Refactor the Phase 1 behavior behind four deep, package-private modules: OpenAI response arbitration, OpenAI greeting presentation, microphone publication gating, and shared React session operations. This phase must not change any public type, provider wire payload, Skip semantics, reconnect/history behavior, voice state, VAD policy, UI, or LiveKit runtime behavior.

The implementation is complete only if the old coordinating fields and obsolete response lifecycle module are deleted. Do not create thin wrappers that leave the same state mutable in `OpenAIAdapter` or `maelstromRealtime()`.

## Fixed behavior entering this phase

Treat the approved Phase 1 implementation as characterization, not as an opportunity to redesign behavior:

- `skipGreeting()` is synchronous, idempotent, terminal, and shared across consumers.
- Greeting order remains Engine acknowledgement → caption → provider history handoff → synthesis → Web Audio playback.
- OpenAI microphone tracks are disabled only for greeting presentation and restored to each exact prior `enabled` value on completion, Skip, abort, replacement, or teardown.
- The OpenAI transcript-confirmed response scheduler preserves one active response, tool-follow-up priority, correlated useful turns, exactly-once cancellation, late-output clearing, and fatal closure after a failed `response.create` send.
- Immediate OpenAI barge-in remains provider-managed. LiveKit behavior remains unchanged.
- Diagnostics must not gain audio, transcript text/deltas, device identity, complete media settings, stream/track objects, credentials, or raw content-bearing event payloads.

## Exact implementation steps

### 1. Establish characterization before moving state

Edit tests first:

- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`

Steps:

1. Identify the existing adapter tests that cover response scheduling/interruption, greeting presentation/gating, and shared-session retirement. Keep a small adapter-level integration set for cross-module ordering.
2. Add any missing assertions needed to freeze externally observable command/event order before extraction. Do not test private fields.
3. Record wire behavior as ordered sent messages and emitted adapter events, not as implementation snapshots. Existing OpenAI JSON payloads must remain byte-for-byte equivalent after extraction.
4. Keep the full Phase 1 Skip race suite unchanged and green throughout the refactor.

### 2. Replace the unused response lifecycle helper with one real response arbiter

Create:

- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-openai/src/response-arbiter.test.ts`

Edit:

- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

Delete after replacement is green:

- `packages/realtime-openai/src/response-lifecycle.ts`
- `packages/realtime-openai/src/response-lifecycle.test.ts`

#### Required module ownership

`response-arbiter.ts` owns all of the following as one isolated connection generation:

- current/optimistic response identity;
- pending tool follow-up;
- validated-turn queue and per-item interruption ledger;
- settled and cancel-attempted response IDs;
- active response and output activity;
- response-create fatal closure;
- drain blocking/deferred drain during re-entrant cancel/clear decisions;
- cancellation-derived clear obligations and exact-response attribution.

Give the module a small package-private interface. The adapter may provide:

- a command sink for `response.create`, `response.cancel`, and `output_audio_buffer.clear`;
- a typed fatal/non-fatal error sink;
- a privacy-safe diagnostic sink.

The adapter may call operations equivalent to:

- request a tool follow-up;
- observe a committed input item;
- observe completed-transcript usefulness without passing transcript content;
- observe the first useful correlated delta;
- observe response created/done facts;
- observe output started/stopped/cleared;
- close/replace the current generation during reconnect or teardown.

Do not expose the ledger, queues, active IDs, drain flags, or output state. The adapter remains responsible for parsing raw OpenAI events and serializing the returned/sent wire command; the arbiter receives only projected IDs, statuses, explicit-empty-output proof, and usefulness booleans.

#### Required response tests

Move or recreate the focused sequence tests at the module interface for:

1. one optimistic `response.create` reservation and one active response;
2. tool follow-ups coalescing and draining before validated user turns;
3. committed + useful completed transcript eligibility in either event order;
4. duplicate/empty/uncorrelated deltas and duplicate committed/completed events;
5. one cancel per response and one decision per correlated item;
6. output active before cancel, late output start after cancel, stopped/cleared output, and standalone clear;
7. cancelled response with explicitly empty output releasing only its matching clear obligation;
8. omitted, malformed, non-empty, wrong-ID, duplicate, and newer-response completion remaining conservative;
9. synchronous re-entrant completion/output events during command dispatch;
10. failed cancel/clear sends preserving current recovery behavior;
11. failed `response.create` retiring the optimistic placeholder, closing that generation before error notification, and never recursively retrying re-entrant work;
12. generation replacement dropping queued/settled/cancel state so stale adapter events cannot command the replacement generation.

After integration, remove these fields and their coordinating methods from `OpenAIAdapter`; do not mirror them beside the arbiter:

- `#responseInFlight`
- `#toolFollowUpPending`
- `#responseSchedulerFatal`
- `#responseCreateDrainBlockDepth`
- `#responseCreateDrainDeferred`
- `#validatedTurnQueue`
- `#settledResponseIds`
- `#cancelAttemptedResponseIds`
- `#interruptionLedger`
- `#activeResponseId`
- `#outputActivity`

`#startConnectionGeneration()` should replace/close one arbiter generation rather than manually resetting all of those fields. Keep the existing adapter connection-generation guard around raw data-channel delivery.

### 3. Extract the microphone publication gate as a real lease owner

Create:

- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/microphone-publication-gate.test.ts`

Edit:

- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`

#### Required module ownership

The publication-gate module owns exactly one current lease. Acquiring a lease must:

- snapshot each unique current audio track once;
- retain each track's exact prior `enabled` value;
- disable those tracks;
- bind ownership to the caller's greeting operation and connection generation.

Releasing a lease must:

- restore exact prior values only when the lease is still current and belongs to the current generation;
- be idempotent;
- make stale/replaced lease release a no-op;
- never stop a track, remove a sender, replace a sender track, reacquire microphone permission, or inspect/log track metadata.

Keep the interface lease-oriented (acquire/release/current ownership), not a public bag of tracks. Replacement must release the previous current lease before adopting the next one. Empty streams are valid.

#### Required gate tests

Cover:

- mixed initially enabled/disabled tracks;
- duplicate track references;
- empty/missing audio streams;
- completion, synchronous caller abort/Skip, disconnect, and repeated release;
- replacement lease ordering;
- stale operation and stale generation release;
- a stale release never restoring over a newer gate;
- no calls to track `stop`, sender replacement, or stream mutation.

Remove `GreetingMicrophoneGate`, `#greetingMicrophoneGate`, and the gate snapshot/restore loops from `OpenAIAdapter`. There must be one owner of gate state.

### 4. Extract OpenAI greeting presentation around the existing player and gate

Create:

- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`

Edit:

- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`

#### Required module ownership

The greeting-presentation module composes `WebAudioGreetingPlayer` and the publication gate. It owns:

- gesture activation and readiness;
- the current presentation operation/controller;
- provider assistant-history handoff;
- synthesis invocation and abort race;
- decode/playback;
- replacement, explicit Skip/caller abort, provider interruption, and teardown;
- current/gated status needed by adapter event routing;
- terminal `accepted` versus retriable `not_started` semantics.

Inject only the dependencies it needs: synthesizer, configured voice, Web Audio player, current data-channel/send seam, current microphone stream, current connection generation, and privacy-safe debug callback. It must not know about Engine acknowledgement, captions, `GreetingCoordinator`, `RealtimeSession`, React, response queues, or LiveKit.

Keep `OpenAIAdapter`'s `RealtimeGreetingAdapter` methods as delegation only:

- `activateAudio()` delegates to presentation activation;
- `speakAssistantText()` delegates to presentation speech;
- teardown delegates to presentation abort;
- raw immediate `speech_started` asks presentation to interrupt only when publication is not gated;
- a useful transcript-confirmed delta asks presentation to interrupt the active greeting, independently of response arbitration;
- diagnostics read bounded `isActive`/interruption results rather than operation objects.

Do not expose the internal `AbortController`, publication lease, tracks, player source, or synthesis bytes. Delete `#greetingOp`, `#greetingPlayer`, gate-related fields, and the adapter's settle/abort implementation after delegation is complete.

#### Required presentation tests

Cover:

1. activation is synchronous, repeatable, and never throws;
2. no synthesizer, no activation, failed/hanging readiness, closed channel, caller abort, and pre-send send failure return `not_started`;
3. provider assistant item has the exact existing completed/output-text payload and no `response.create`;
4. provider send happens before synthesis and is the terminal linearization point;
5. post-send synthesis/decode/playback failure or abort returns `accepted`;
6. the publication gate spans synthesis, decode, and playback;
7. Skip/caller abort restores the gate synchronously before returning control to the caller;
8. replacement aborts/releases the prior operation before gating the replacement;
9. stale completion cannot clear/restore/stop a newer operation;
10. teardown abort is idempotent and retained Web Audio activation behavior is unchanged;
11. immediate raw `speech_started` does not abort while the greeting publication gate is active, preserving self-echo protection;
12. transcript-confirmed useful interruption targets greeting and response independently, exactly once;
13. debug output contains bounded categories only and no greeting text, bytes, track/stream objects, or raw errors that may carry content.

Keep `web-audio-greeting-player.ts` focused on activation/decode/source playback. Move orchestration out of the adapter, not into the player.

### 5. Extract shared React session ownership

Create:

- `packages/react-realtime/src/lib/shared-realtime-session.ts`
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`

Edit:

- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`

#### Required module ownership

Add one package-private shared-session registry per `maelstromRealtime()` extension. It owns:

- the `WeakMap<Orchestrator, entry>`;
- the retained `WeakMap<Orchestrator, GreetingCoordinator>`;
- one `RealtimeSession` creation per live entry;
- consumer count;
- live/retired phase;
- queued-retirement deduplication;
- eviction before asynchronous disconnect;
- best-effort disconnect rejection handling.

Use an opaque entry/handle with the session plus a registry method that retains it and returns an idempotent release callback. React render may obtain/create the entry, but consumer count changes must remain in `useEffect`; do not introduce render-time retain/release side effects.

The registry accepts a session factory so `maelstrom-realtime.ts` can continue constructing the existing Orchestrator bridge and `RealtimeSession` options without exposing registry internals. The coordinator must be reused when an entry is recreated for the same Orchestrator so Phase 1 `skipped`/terminal proof survives provider-session recreation.

`maelstrom-realtime.ts` should retain only React concerns: hook state, subscriptions, `useCallback` delegates, transcript accumulation, turn-policy projection, and VoiceOrb composition. Delete local `sessions`, `coordinators`, `queueRetirement`, mutable `VoiceSessionEntry` ownership fields, and their direct mutation from this file.

#### Required registry tests

Cover:

- simultaneous consumers share one entry/session/adapter;
- late consumers observe the same live entry;
- release is idempotent and count never goes negative;
- Strict Mode-style retain/release/reacquire before the retirement microtask keeps the current entry live;
- only one retirement microtask is queued;
- the zero-consumer entry is marked retired and evicted before disconnect starts;
- reacquisition after eviction creates a new session even while old disconnect is pending;
- old disconnect completion/rejection cannot evict or affect the replacement;
- rejected best-effort disconnect is observed/swallowed without an unhandled rejection;
- the retained coordinator carries `skipped`, `presented`, and `suppressed` proof into a recreated session;
- a different Orchestrator gets independent session/coordinator state.

Retain the existing `useVoice()` integration tests for simultaneous/late consumers, Skip propagation, callbacks, and session retirement.

### 6. Update architecture documentation only

Edit:

- `docs/realtime-voice-architecture.md`

Document the four owners and their interfaces:

- response arbiter owns scheduling/cancel/clear policy;
- greeting presentation owns OpenAI provider handoff and local playback;
- publication gate owns exact microphone restoration;
- shared-session registry owns per-Orchestrator lifetime.

State explicitly that all four are package-private implementation seams, Phase 1 public interfaces are unchanged, and no acoustic claim is added. Keep the existing Engine/provider history order, privacy constraints, and LiveKit wording intact.

## Files to touch

Required additions:

- `packages/realtime-openai/src/response-arbiter.ts`
- `packages/realtime-openai/src/response-arbiter.test.ts`
- `packages/realtime-openai/src/microphone-publication-gate.ts`
- `packages/realtime-openai/src/microphone-publication-gate.test.ts`
- `packages/realtime-openai/src/greeting-presentation.ts`
- `packages/realtime-openai/src/greeting-presentation.test.ts`
- `packages/react-realtime/src/lib/shared-realtime-session.ts`
- `packages/react-realtime/src/lib/shared-realtime-session.test.ts`

Required edits:

- `packages/realtime-openai/src/openai-adapter.ts`
- `packages/realtime-openai/src/openai-adapter.test.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.ts`
- `packages/realtime-openai/src/web-audio-greeting-player.test.ts`
- `packages/react-realtime/src/lib/maelstrom-realtime.ts`
- `packages/react-realtime/src/lib/use-voice.test.tsx`
- `docs/realtime-voice-architecture.md`

Required deletions once replacements pass:

- `packages/realtime-openai/src/response-lifecycle.ts`
- `packages/realtime-openai/src/response-lifecycle.test.ts`

Touch only if a core characterization comment/test must be updated without changing behavior:

- `packages/realtime/src/lib/greeting-coordinator.ts`
- `packages/realtime/src/lib/greeting-coordinator.test.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.ts`
- `packages/realtime/src/lib/realtime-session/realtime-session.test.ts`

## Files and areas not to touch

- `.apnea/state.json`
- Public barrels: `packages/realtime-openai/src/index.ts`, `packages/react-realtime/src/index.ts`, `packages/realtime/src/index.ts`
- Public option/type contracts: `packages/realtime-openai/src/openai-adapter.types.ts`, `packages/realtime/src/lib/realtime-session/provider-adapter.types.ts`, `packages/realtime/src/lib/realtime-session/realtime-session.types.ts`
- `packages/realtime-vad/**`
- `packages/realtime-livekit/**`
- `packages/realtime-livekit-agent/**`
- `packages/realtime-livekit-server/**`
- `apps/demo/**`
- `apps/docs/**`
- Package manifests and `bun.lock`
- OpenAI token minting, SDP exchange, ICE handling, microphone acquisition constraints, server-VAD configuration, voice-activity derivation, event parsing, grounding, and tool-result payloads except for replacing direct response-arbiter calls
- Phase 3 pre-roll, local greeting VAD, or spoken-interruption work

## Acceptance checks

### Module depth and deletion

- Each new module owns behavior and invariants, not merely a copied state object.
- `OpenAIAdapter` has no duplicate arbiter, greeting-operation, or gate state.
- `maelstrom-realtime.ts` has no direct consumer-count/retirement/registry mutation.
- The obsolete `response-lifecycle` files are deleted.
- No new package-private module is exported from a public barrel.

### Behavior preservation

- All existing OpenAI wire payloads and adapter-event order remain unchanged.
- Transcript-confirmed response arbitration passes the full sequencing, cancellation, late-output, re-entrancy, send-failure, and stale-generation matrix.
- Phase 1 Skip remains synchronous and terminal; Engine/provider history stays at most once.
- Greeting replacement/Skip/disconnect restore exact prior microphone values and stale work cannot affect a replacement.
- Immediate and transcript-confirmed post-greeting barge-in remain unchanged.
- Shared-session Strict Mode/reacquisition behavior and coordinator proof remain deterministic.
- LiveKit's complete existing suite passes without LiveKit source changes.

### Privacy and scope

- New diagnostics are bounded projections only and contain no content or device/media objects.
- No public interface, option, package dependency, UI, docs fixture, or provider configuration changes.
- No spoken-interruption or acoustic guarantee is introduced.

## Verify commands

Run from the workspace root. Use the configured React test preload/condition established by Phase 1 review rather than the broken root-level default invocation.

```bash
bun test packages/realtime-openai/src/response-arbiter.test.ts packages/realtime-openai/src/microphone-publication-gate.test.ts packages/realtime-openai/src/greeting-presentation.test.ts packages/realtime-openai/src/web-audio-greeting-player.test.ts packages/realtime-openai/src/openai-adapter.test.ts
bun test --conditions=@maelstrom-co/source --preload ./packages/react-realtime/src/lib/__tests__/setup.ts packages/react-realtime/src/lib/shared-realtime-session.test.ts packages/react-realtime/src/lib/use-voice.test.tsx
bunx nx test @maelstrom-co/realtime-openai --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/realtime-openai --skipSync --skipNxCache
bunx nx test @maelstrom-co/realtime --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/realtime --skipSync --skipNxCache
bunx nx build @maelstrom-co/react --skipSync --skipNxCache
bunx nx test @maelstrom-co/react-realtime --skipSync --skipNxCache
bunx nx typecheck @maelstrom-co/react-realtime --skipSync --skipNxCache
bunx nx test @maelstrom-co/realtime-livekit --skipSync --skipNxCache
bunx biome check packages/realtime-openai/src packages/react-realtime/src docs/realtime-voice-architecture.md --error-on-warnings
```

Also prove the deleted helper is no longer imported:

```bash
if rg -n "response-lifecycle" packages/realtime-openai/src --glob '!index.ts'; then exit 1; fi
```

If all focused checks pass, run the serial repository gate to reduce the known Nx concurrent build-resolution failure from Phase 1:

```bash
bunx nx run-many -t check test build typecheck e2e --parallel=1 --skipNxCache
```

If the unchanged docs crawler again reports an isolated `ECONNRESET`, preserve the full failing transcript and rerun its configured focused gate for evidence; do not alter docs server/crawler code in this phase:

```bash
CI=1 bunx nx run @maelstrom-co/docs:e2e --skipSync --skipNxCache
```

## Non-goals

- Any public API or type change.
- Spoken greeting interruption, browser VAD during greeting, pre-roll, or publication-track replacement.
- Changing Phase 1 Skip behavior or UI.
- Reworking `GreetingCoordinator` persistence/history policy.
- Changing OpenAI server-VAD thresholds, barge-in modes, transcription, connection lifecycle, SDP/ICE behavior, or provider payloads.
- Changing LiveKit code or behavior.
- Adding a generic framework for hypothetical adapters; these are package-private seams justified by current owners.
- Moving old fields unchanged into shallow holder classes or retaining old and new state in parallel.
- Fixing unrelated repository-wide docs E2E flakiness.
- Committing, pushing, or editing `.apnea/state.json`.
