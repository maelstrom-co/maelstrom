<!-- TEMP: spike comparison notes — remove before merge -->
# MAE-286 spike: "LiveKit as just another RealtimeProviderAdapter"

Ergonomics comparison of two ways to add LiveKit voice to Maelstrom:

- **Spike** (this branch, `ktrz/mae-286-livekit-adapter-spike`): LiveKit implemented as a
  `RealtimeProviderAdapter`, driven by the provider-agnostic `RealtimeSession` core that
  PR-36 (MAE-300) introduced for the OpenAI realtime provider.
- **Original** (`ktrz/mae-286-livekit-integration`, built BEFORE PR-36): a bespoke
  `liveKitVoice()` Maelstrom extension with its own React hook + `onTranscript`/`onResponse`
  seams.

Phase-1 scope is deliberately degenerate: **no LLM in the worker**. The worker is pure
STT (Deepgram) + TTS (Cartesia) relay; the browser adapter synthesizes an `update_ui`
tool call from each final transcript.

---

## The core idea

`LiveKitAdapter.#handleTranscription` turns a cascaded final transcript into the *same*
`tool_call` event a speech-native model would emit:

```
{ type: 'tool_call', callId: ToolCallId(...), name: 'update_ui',
  argumentsJson: JSON.stringify({ intent: transcript }) }
```

From there the cascade rides the identical code path as OpenAI:
`RealtimeSession.#handleUpdateUI` → `instance.submitIntent` → `waitForIdle` →
`sendToolResult({ ok, summary })` → adapter sends `summary` over the `speak` topic →
worker speaks it. Speak-after-render, barge-in, and grounding debounce are all
`RealtimeSession`'s concern — the adapter never sees them.

---

## 1. Demo wiring surface (LOC + concepts)

| | Spike | Original |
|---|---|---|
| App-side voice wiring | `livekit-voice-spike.ts` 129, `livekit-mic.tsx` 72, `get-livekit-token.ts` 21, `voice-worker.ts` 6 → **~228 LOC** | `.with(liveKitVoice({ getToken }))` block ~8 LOC + `mic-toggle` 56 + token 21 + worker 6 → **~90 LOC** |
| Where the hook lives | app (`livekit-voice-spike.ts`, copied from `voice-spike.ts`) | package (`liveKitVoice` extension owns `useVoice`) |
| Concepts the app juggles | `RealtimeSession`, `RealtimeInstance` bridge, `LiveKitAdapter`, WeakMap+refcount | `liveKitVoice()` extension, `getToken` injection |

Read literally, the original's *app* wiring is lighter — because the hook, room lifecycle,
and seams are all inside the extension package. The spike pushes the WeakMap/refcount +
`RealtimeInstance` bridge into the app because the extension factory runs once outside
React (same constraint the OpenAI `voiceSpike` already lives with). That ~130-line factory
is near-identical to `voice-spike.ts` and is a natural candidate to extract into a shared
`@maelstrom-co/react-realtime` binding — at which point the spike's app surface collapses
to roughly the original's.

**Net:** the LOC delta is an artifact of *where the binding lives*, not of the adapter
approach. The adapter approach concentrates the reusable logic in one place; the original
duplicated it per-extension.

## 2. Behavior parity

| Behavior | Spike | Original |
|---|---|---|
| Speak-after-render | **Inherited free.** `sendToolResult`'s summary is derived from the POST-`waitForIdle` snapshot. | **Absent.** Spoke on `requestCoordinator` `processing_completed` (speak-on-apply), not gated on render settle / resize feedback loop. |
| Barge-in (latest-wins) | **Inherited free.** `RealtimeSession` queues on `RequestInFlightError`, supersedes, bounded retry. | **Absent.** Each transcript called `processIntent` directly; a mid-flight second utterance just raced. |
| Grounding (latest-wins, debounced) | Machinery runs, but adapter `injectGrounding` is a **phase-1 no-op** (no worker LLM to inject into). | N/A — concept didn't exist. |
| Sidechannel timing events | **Inherited free** (`onEvent`). | N/A. |

This is the spike's decisive win: two behaviors the original **never had** come for free,
because they live in the shared session core rather than the transport.

## 3. Adapter LOC vs seams+extension LOC

| | Spike | Original |
|---|---|---|
| Transport/provider glue | `livekit-adapter.ts` ~330 + `livekit-adapter.types.ts` ~35 → **~365 LOC** (heavily JSDoc'd) | `livekit-voice.ts` 393 + `seams.ts` 65 → **458 LOC** |
| What that code contains | pure transport: room connect, mic publish/mute, transcript→tool_call, tool_result→speak, state mapping | transport **+** React hook lifecycle **+** intent/speak seam policy **+** speak-back predicate |
| Shared infra (identical both sides) | `protocol.ts` 21, `server.ts` 66 (+ test) | same files |
| Unit tests | `livekit-adapter.test.ts` **289 LOC, 19 tests** (mock `livekit-client`, no React) | `livekit-voice.test.ts` ~430 LOC (renderHook + happy-dom + orchestrator mock) |

The adapter is smaller *and* does strictly less: it's transport only. The sequencing logic
it doesn't contain is the logic the original had to hand-roll (and still came out behind on
behavior).

## 4. Testability

- **Spike:** the adapter is a plain class. Every load-bearing behavior — transcript →
  `update_ui` synthesis, `sendToolResult` → speak-topic payload, `{ok,summary}` extraction,
  and the listening/thinking/speaking state mapping — is exercised by mocking
  `livekit-client` at the module boundary and driving a `_emit` helper. No React, no
  WebRTC, no DOM required for the core (happy-dom is only preloaded for the audio-sink
  path). 19 focused tests.
- **Original:** logic was fused into a React hook, so tests needed `renderHook` +
  `@testing-library/react` + happy-dom and spent much of their weight on hook lifecycle
  (StrictMode remount, ref juggling) rather than the mapping. The pure seam functions
  (`defaultShouldSpeak`, `onTranscript`) tested cleanly; the room mechanics did not.

The adapter shape is the more testable one: transport glue behind a 5-method interface,
with the stateful/concurrent parts (barge-in, debounce) already tested once in
`realtime-session.test.ts` for all providers.

## 5. Estimated cost of a THIRD provider

**Under the adapter approach (~1 file):** implement `connect/disconnect/sendToolResult/
injectGrounding/on` + event mapping for the new transport. Inherits barge-in,
speak-after-render, grounding, sidechannel, and tool routing unchanged. Estimate
**~150–350 LOC + ~15 tests**, plus a copy of the ~130-line binding factory (extractable
to a shared helper, at which point it's near-zero).

**Under the original approach (~full extension each):** a new `xyzVoice()` extension
re-implementing the React hook, transport lifecycle, and `onTranscript`/`onResponse` seams
from scratch — **~400+ LOC each**, none of the sequencing shared, and barge-in /
speak-after-render would have to be rebuilt per provider or (as happened) skipped.

The adapter approach makes provider count cheap; the extension approach makes it linear in
the hard parts.

---

## Friction log (where the seam fought back)

Honest accounting — the fit is good but not clean:

1. **Push-to-talk has no home on the interface.** `RealtimeProviderAdapter.connect(opts)`
   models a continuously-listening speech-native model: there's no room name and no
   start/stop-turn concept. I had to (a) pass `roomName` via constructor options, and
   (b) add `startTalking()`/`stopTalking()` as **concrete-only methods outside the
   interface**, with the demo holding the concrete `LiveKitAdapter` (not just the
   `RealtimeSession`) to reach them. A speech-native provider needs no such escape hatch;
   the cascade does. If hold-to-talk is a first-class input mode, the seam arguably wants a
   `setListening(bool)` or a turn-boundary signal.

2. **State-mapping impedance.** `VoiceSessionState`
   (idle/connecting/connected/listening/thinking/speaking/error) presumes the provider
   reports rich turn state. A cascade only knows *local mic state* + *"text handed to
   TTS"*. Mapping: `startTalking`→`listening`, `stopTalking`→`thinking`,
   `sendToolResult`→`speaking`→`connected`. The lie: `speaking`→`connected` fires when the
   summary is handed to the worker, **not when audio finishes** — there's no TTS-done
   signal over the room, so the "speaking" pill under-reports duration. A speech-native
   provider gets real audio lifecycle events; the cascade fabricates the transition.

3. **`tools` / `instructions` are dropped.** `connect()` hands the adapter the declared
   tool specs + system instructions the session wants the model to have. Phase 1 has no
   worker LLM, so both are ignored (JSDoc'd as degeneracy). Consequence: the adapter only
   ever synthesizes `update_ui`; `get_ui_state` / `get_capabilities` tool calls can never
   be produced (no model to decide to call them). The adapter exercises only half the seam.

4. **`injectGrounding` is a no-op.** Grounding is ambient context for a model; there's no
   model here. `RealtimeSession` still debounces/clamps and calls into the no-op — harmless
   but wasteful. Grounding becomes real only once a worker LLM exists.

5. **`sendToolResult(callId, output)` output shape is an informal contract.** `output` is
   typed `unknown`; the adapter must *know* `update_ui` results are `{ ok, summary }` to
   extract the speakable string (fallback: `JSON.stringify`). A tighter seam might carry a
   typed `SpeakableResult` so transports don't reverse-engineer the payload.

None of these blocked the spike, and none required touching `packages/realtime` internals.
Items 1–2 are the real signal: the interface is shaped for speech-native, turn-managed
providers, and a push-to-talk cascade has to reach around it (concrete methods) and
fabricate state it can't observe. Worth weighing before committing the cascade to this seam
long-term — but the payoff (free barge-in + speak-after-render, cheap Nth provider, no
React in the transport) is substantial.

---

## Verification

- `bun install` — OK (GITHUB_TOKEN sourced from `gh auth token`).
- `bunx nx run-many -t typecheck` — **13 projects green**.
- `bunx nx run-many -t test` — **all green** (realtime-livekit: 19 pass; full sweep 365+ in client, etc., 0 fail).
- Not run live: an actual room join (needs a local `livekit-server --dev` + Deepgram/
  Cartesia keys). The transport plumbing is untested by design; the mappable parts are
  covered.

## Files

New package `@maelstrom-co/realtime-livekit` (`packages/realtime-livekit/`):
`livekit-adapter.ts`, `livekit-adapter.types.ts`, `protocol.ts`, `server.ts`, `index.ts`,
tests, package/tsconfig/vite/biome config.

New worker `@maelstrom-co/realtime-livekit-agent` (`packages/realtime-livekit-agent/`):
copy of the original agent with import paths repointed to
`@maelstrom-co/realtime-livekit/protocol`. **Flat path chosen** (not `packages/livekit/agent`)
so it matches the existing `packages/*` workspace glob — avoids adding `packages/*/*` to the
root workspaces list.

Demo: `apps/demo/src/lib/livekit-voice-spike.ts`, `apps/demo/src/components/livekit-mic.tsx`,
`apps/demo/src/lib/voice/get-livekit-token.ts`, `apps/demo/voice-worker.ts`;
`maelstrom.ts` chains `.with(liveKitVoiceSpike())` (key `useLiveKitVoiceSpike`, no collision
with `useVoiceSpike`); `index.tsx` renders `<LiveKitMic>` next to `<MicToggle>`.

Config: `.npmrc` `@livekit` registry line, `.env.example` LiveKit block, root
`tsconfig.json` references, `apps/demo/tsconfig.app.json` (via `nx sync`), `dev:agent`
script + demo deps.
