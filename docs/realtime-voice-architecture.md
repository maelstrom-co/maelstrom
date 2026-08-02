# Voice Architecture

Maelstrom ships two voice transports behind one provider-neutral session design:

* **OpenAI Realtime** — a speech-to-speech model connected directly from the browser over WebRTC.
* **LiveKit cascade** — browser audio routed through LiveKit to separate Deepgram speech-to-text and Cartesia text-to-speech stages.

Both transports use the same Maelstrom intent boundary. Voice is an additional source of natural-language intent; it is not an alternative planning path.

For implementation instructions, start with the [public voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/), then follow either the [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/) or the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/).

For the general Maelstrom architecture—Vessels, Chart, Orchestrator, and Engine—read [architecture.md](./architecture.md).

Use the implementation guides first: start with the [public voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/), then follow either the [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/) or the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/). Keep this document as a secondary architecture reference for the design constraints and decisions behind those integrations.

Use the implementation guides first: start with the [public voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/), then follow either the [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/) or the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/). Keep this document as a secondary architecture reference for the design constraints and decisions behind those integrations.

---

## Core invariants

Every voice transport must preserve these rules.

### Voice submits intent, not UI instructions

The voice layer can submit natural-language intent such as:

```text
Move my afternoon tasks next to the calendar.
```

It must not submit:

* Vessel IDs
* Layout coordinates
* Chart mutations
* Engine actions
* A provider-generated representation of the current UI

The Maelstrom client remains responsible for building the request sent to the Engine.

### The client owns planning truth

A voice provider may maintain transcripts, conversation history, or a structural description of the interface. That information helps the provider conduct a conversation, but it is not Engine planning input.

When an intent is submitted, the client captures the current Chart and instance state from its own stores. The Engine plans against that client-built snapshot.

> A voice model's belief about the UI is conversational context. The client snapshot is planning truth.

### Successful speech waits for the rendered result

A successful voice response must not claim that an interface change happened before it is visible.

`RealtimeSession` submits the intent, waits for the Maelstrom command queue to become idle, and only then returns the result to the active transport.

The transport may then speak:

1. The Engine's conversational `userMessage`, when one was returned.
2. A deterministic summary of the settled structural snapshot as a fallback.

### Long-lived credentials never enter browser code

The browser receives only short-lived provider credentials:

* OpenAI client secrets are minted by `@maelstrom-co/realtime-server`.
* LiveKit room tokens are minted by `@maelstrom-co/realtime-livekit-server`.

Raw provider API keys and signing secrets remain in server or worker processes.

---

## Shared architecture

```text
                                  Browser
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  React UI                                                            │
│  @maelstrom-co/react-realtime                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ maelstromRealtime({ createAdapter })                           │  │
│  │ useVoice() · VoiceOrb · transcripts · state · turnControl      │  │
│  └───────────────────────────────┬────────────────────────────────┘  │
│                                  │                                   │
│                                  ▼                                   │
│  @maelstrom-co/realtime                                              │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ RealtimeSession                                                │  │
│  │                                                                │  │
│  │ tool routing · intent submission · speak-after-render          │  │
│  │ barge-in handling · structural grounding · sidechannel events  │  │
│  └─────────────────────┬──────────────────────┬───────────────────┘  │
│                        │                      │                      │
│                        ▼                      ▼                      │
│               OpenAIAdapter             LiveKitAdapter              │
│         @maelstrom-co/realtime/openai   @maelstrom-co/              │
│                                        realtime-livekit             │
│                                                                      │
│                        │                                              │
│                        ▼                                              │
│              Maelstrom client bridge                                 │
│              submitIntent · waitForIdle                              │
│              getStructuralSnapshot                                   │
│              getCapabilitySnapshot                                   │
└────────────────────────┼─────────────────────────────────────────────┘
                         │
                         ▼
                 @maelstrom-co/engine
```

`RealtimeSession` never branches on provider identity. It communicates with every transport through `RealtimeProviderAdapter`.

The adapter owns provider-specific connection and audio behavior. The session owns Maelstrom-specific behavior.

---

## Package boundaries

| Package                                 | Runtime | Responsibility                                                                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@maelstrom-co/realtime`                | Browser | Provider-neutral session, tool routing, intent submission, post-render result ordering, grounding, and typed voice errors |
| `@maelstrom-co/realtime/openai`         | Browser | OpenAI Realtime WebRTC transport                                                                                          |
| `@maelstrom-co/react-realtime`          | Browser | Shared React session, `useVoice()`, `VoiceOrb`, transcript state, and optional turn controls                              |
| `@maelstrom-co/realtime-server`         | Server  | Exchanges a server-held OpenAI API key for a short-lived browser credential                                               |
| `@maelstrom-co/realtime-livekit`        | Browser | LiveKit room transport, transcript-to-intent conversion, playback, and hold-to-talk control                               |
| `@maelstrom-co/realtime-livekit-server` | Server  | Signs short-lived LiveKit room tokens                                                                                     |
| `@maelstrom-co/realtime-livekit-agent`  | Worker  | Runs Deepgram STT and Cartesia TTS inside a LiveKit agent worker                                                          |

The Engine has no voice-provider dependency. It receives the same kind of client-built request regardless of whether the original intent came from a keyboard, OpenAI Realtime, or LiveKit STT.

The `@maelstrom-co/realtime/google` subpath is reserved for a future adapter. It is not currently implemented and must not be documented as a usable transport.

---

## The provider-neutral session

`RealtimeSession` connects a `RealtimeProviderAdapter` to a narrow Maelstrom instance bridge:

```ts
interface RealtimeInstance {
  submitIntent(intent: string): Promise<{
    userMessage?: string;
  }>;
  waitForIdle(): Promise<void>;
  getStructuralSnapshot(): UIStructuralSnapshot;
  getCapabilitySnapshot(): CapabilitySnapshot;
  onSettled(callback: () => void): Unsubscribe;
}
```

This boundary keeps the realtime package focused on voice orchestration rather than the complete client API.

### Adapter contract

A transport implements `RealtimeProviderAdapter`:

```ts
interface RealtimeProviderAdapter {
  connect(options: AdapterConnectOptions): Promise<void>;
  disconnect(): Promise<void>;

  getAudioStreams(): {
    mic?: MediaStream;
    playback?: MediaStream;
  };

  sendToolResult(
    callId: ToolCallId,
    output: ToolResult,
  ): Promise<void>;

  updateGrounding(grounding: string): Promise<void>;

  onEvent(
    callback: (event: RealtimeAdapterEvent) => void,
  ): Unsubscribe;

  readonly turnControl?: AdapterTurnControl;
}
```

Adapters emit provider-neutral events:

* Tool calls
* User and assistant transcripts
* Speech-started notifications
* Session state changes
* Errors

Provider wire formats do not cross into `RealtimeSession`.

---

## Shared intent loop

The session exposes three Maelstrom tools to speech-native providers:

* **`update_ui { intent: string }`** — submit natural-language intent.
* **`get_ui_state {}`** — read the current structural UI snapshot.
* **`get_capabilities {}`** — read the Vessel capabilities available to the application.

The LiveKit adapter has no conversational LLM. Instead, it synthesizes an `update_ui` tool call when it receives a final STT transcript.

The resulting Maelstrom flow is the same for both transports:

```text
Voice transport
      │
      │ natural-language intent
      ▼
RealtimeSession
      │
      │ submitIntent(intent)
      ▼
Maelstrom client
      │
      │ intent + client-built Chart snapshot
      ▼
Engine
      │
      │ layout and actions
      ▼
Client renders result
      │
      │ waitForIdle()
      ▼
RealtimeSession
      │
      │ userMessage or settled snapshot summary
      ▼
Voice transport speaks
```

### `update_ui` sequencing

For each `update_ui` call:

1. The adapter emits a provider-neutral tool call.
2. `RealtimeSession` validates and extracts the plain-text intent.
3. The session calls `submitIntent(intent)`.
4. The client captures its current state and sends the normal request to the Engine.
5. The Engine response is applied through the normal command pipeline.
6. The session waits for `waitForIdle()`.
7. The session sends a successful tool result to the adapter.

The result carries two independently typed fields:

* `userMessage` — the Engine's conversational response, preferred when present.
* `summary` — a deterministic description of the post-render structural snapshot.

A speech-native model can use both fields when composing its response. The LiveKit adapter has no response-generating model, so it speaks `userMessage ?? summary`.

### Read-only tools

`get_ui_state` and `get_capabilities` do not mutate the UI.

They let a speech-native provider refresh its conversational understanding without allowing that understanding to replace client-owned planning state.

The LiveKit worker does not receive these snapshots because it performs only STT and TTS.

---

## Structural grounding

A speech-native model needs enough context to discuss what the user can currently see. `RealtimeSession` therefore maintains a deliberately limited grounding channel.

Grounding is:

* Structural rather than domain-data-heavy
* Debounced
* Latest-wins
* Derived from client-owned state
* Separate from Engine requests

A render settlement schedules a new grounding update. Multiple rapid settlements collapse into the latest snapshot.

Grounding can be delayed or dropped without changing planning correctness. The next Engine request still contains a fresh client-built snapshot.

The LiveKit cascade does not send grounding to its worker because the worker has no conversational model and does not make UI decisions.

---

## Concurrency and interruption

Voice can produce another intent while a previous request is still being processed.

`RealtimeSession` handles an in-flight request through a latest-wins barge-in queue:

* One pending intent is retained.
* A newer pending intent supersedes the older one.
* The pending intent is retried after the active request settles.
* Non-busy failures are reported as failures rather than incorrectly retried as contention.

This behavior is shared by both transports because it lives above the adapter boundary.

Transport-specific interruption remains the adapter's responsibility:

* OpenAI manages speech-native interruption through its realtime session.
* LiveKit exposes `turnControl`. Starting a new turn while TTS is playing sends a best-effort cancellation signal to the worker before reopening the microphone.

---

## React session ownership

`@maelstrom-co/react-realtime` adds voice through a Maelstrom extension:

```tsx
const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({
    createAdapter: ({ sessionId }) => {
      return createVoiceAdapter(sessionId);
    },
  }),
);
```

The extension creates one shared `RealtimeSession` for each Maelstrom Orchestrator.

All `useVoice()` consumers under that instance share:

* Connection state
* Fatal error state
* User and assistant transcripts
* Audio streams
* `connect()` and `disconnect()`
* Optional adapter-defined `turnControl`

`turnControl` is capability-based:

* It is absent for the OpenAI adapter because the provider owns turn detection.
* It is present for the LiveKit adapter because the current cascade uses explicit hold-to-talk boundaries.

The UI should render controls based on the presence of `turnControl`, not by checking the provider name.

---

## OpenAI Realtime transport

```text
Browser                                               Application server
┌────────────────────────────────────────────┐         ┌──────────────────────┐
│ OpenAIAdapter                              │  mint   │ createOpenAIMinter   │
│                                            ├────────►│                      │
│ microphone + playback                     │◄────────┤ short-lived secret   │
│ WebRTC peer connection                     │         │                      │
└─────────────────────┬──────────────────────┘         └──────────┬───────────┘
                      │                                           │
                      │ audio + data channel                      │ OPENAI_API_KEY
                      ▼                                           │
               OpenAI Realtime API                                │
                      │                                           │
                      │ update_ui tool call                        │
                      ▼                                           │
               RealtimeSession                                    │
```

### Responsibilities

`OpenAIAdapter` owns:

* Microphone capture
* WebRTC setup and teardown
* Provider event parsing
* Provider session configuration
* Tool-result delivery
* Response pacing
* Realtime audio playback

`@maelstrom-co/realtime-server` owns:

* Access to `OPENAI_API_KEY`
* Calling the provider's client-secret endpoint
* Returning a short-lived credential contract

The application route wrapping the minter must add its own:

* Authentication
* Authorization
* CSRF validation
* Exact origin allowlist
* Shared rate limiting
* Model allowlist
* Redacted telemetry
* `Cache-Control: private, no-store`

The package minter is transport-agnostic and does not provide those application controls.

### When to choose it

Choose OpenAI Realtime when the product benefits from:

* Fluid speech-to-speech conversation
* Provider-managed turn detection
* Natural interruption and pacing
* Fewer application-operated speech stages
* A single provider session for recognition, conversation, and synthesis

Evaluate the provider's latency, audio quality, data handling, observability, model behavior, and session controls against the application's requirements.

---

## LiveKit cascade transport

```text
Browser                 LiveKit room                 Agent worker
┌──────────────────┐                               ┌─────────────────────┐
│ LiveKitAdapter   │── microphone audio ─────────►│ Deepgram STT        │
│                  │◄─ final transcript ──────────│                     │
│                  │                               │                     │
│ RealtimeSession  │── speak text ───────────────►│ Cartesia TTS        │
│                  │◄─ synthesized audio ─────────│                     │
└────────┬─────────┘                               └─────────────────────┘
         │
         │ final transcript becomes update_ui intent
         ▼
 Maelstrom client and Engine
```

### Browser adapter

`LiveKitAdapter`:

* Mints a room token through application-provided server code.
* Connects to the configured LiveKit room.
* Publishes the browser microphone.
* Keeps the microphone muted outside an explicit user turn.
* Emits a user transcript event for each final STT result.
* Synthesizes one `update_ui` tool call from each non-empty final transcript.
* Sends settled response text to the worker over the `speak` text stream.
* Attaches the worker's TTS audio track for playback.
* Exposes `turnControl.startTurn()` and `turnControl.endTurn()`.

### Agent worker

`@maelstrom-co/realtime-livekit-agent` runs as a separate long-lived process.

It performs:

```text
User audio → Deepgram STT → final transcript
Settled result text → Cartesia TTS → playback audio
```

The worker:

* Has no planning LLM.
* Receives no UI grounding.
* Does not construct Chart requests.
* Does not decide which Vessels or actions should be used.
* Imports the shared LiveKit wire constants from `@maelstrom-co/realtime-livekit/protocol`.

The Maelstrom Engine remains the only planning model in the cascade.

### Token server

`@maelstrom-co/realtime-livekit-server` signs room-scoped access tokens using:

* `LIVEKIT_URL`
* `LIVEKIT_API_KEY`
* `LIVEKIT_API_SECRET`

The application route must derive room names and participant identities from trusted server state. Browser input must not be allowed to widen room scope or token permissions.

The repository demo token route is a local-development checkpoint, not a production authentication boundary.

### When to choose it

Choose the LiveKit cascade when the product benefits from:

* Independent STT and TTS provider selection
* Domain- or language-specific speech recognition
* Explicit hold-to-talk interaction
* Stage-level operational visibility
* The ability to replace recognition or synthesis separately
* Greater application control over the speech pipeline

That control adds more infrastructure, credentials, failure boundaries, and potentially more latency. Measure complete user turns rather than isolated STT or TTS timings.

---

## Transport comparison

| Concern             | OpenAI Realtime                                   | LiveKit cascade                                                                  |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Conversation        | Speech-native provider session                    | No voice-side conversational LLM                                                 |
| Recognition         | Managed by the realtime provider                  | Deepgram STT worker stage                                                        |
| Synthesis           | Managed by the realtime provider                  | Cartesia TTS worker stage                                                        |
| Turn boundaries     | Provider-managed                                  | Explicit `turnControl` hold-to-talk                                              |
| Browser transport   | Direct WebRTC to provider                         | LiveKit room                                                                     |
| Planning path       | Natural-language intent through `RealtimeSession` | Final transcript converted to natural-language intent through `RealtimeSession`  |
| Spoken confirmation | Model receives result after render                | Worker speaks `userMessage ?? summary` after render                              |
| Grounding           | Structural grounding and read-only tools          | Not sent to the worker                                                           |
| Operational surface | Credential route plus provider session            | Token route, LiveKit deployment, STT/TTS worker, and speech-provider credentials |
| Component choice    | More provider-coupled                             | STT and TTS can be selected independently                                        |

Neither transport is inherently more private or compliant. Review where audio, transcripts, conversational context, telemetry, and credentials are processed and retained.

---

## Credential and process ownership

| Secret               | Process that may read it                                 |
| -------------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`     | Application server using `@maelstrom-co/realtime-server` |
| `LIVEKIT_API_KEY`    | LiveKit token server and agent worker                    |
| `LIVEKIT_API_SECRET` | LiveKit token server and agent worker                    |
| `DEEPGRAM_API_KEY`   | LiveKit agent worker                                     |
| `CARTESIA_API_KEY`   | LiveKit agent worker                                     |

Browser code receives only:

* A short-lived OpenAI client credential, or
* A short-lived LiveKit room token and room URL

Credential endpoints must fail closed and must not return raw provider errors, token diagnostics, credentials, request bodies, or internal session data.

---

## Failure boundaries

The UI update and its spoken confirmation are separate outcomes.

For example, in the LiveKit path:

1. The intent may apply successfully.
2. The UI may render successfully.
3. TTS delivery may then fail.

A TTS failure must not roll back or misreport the already-applied UI result. The voice UI should leave the speaking state and surface the audio failure separately.

Connection, credential, microphone, and data-channel failures may prevent the transport from operating and can move the shared session into an error state. Consumers should render the current session state and typed error rather than assuming every provider follows one fixed transition sequence.

---

## Sidechannel events

`RealtimeSession` can emit typed sidechannel events through its optional `onEvent` callback.

These events support telemetry for concerns such as:

* Tool calls
* Transcripts
* Timing
* Session behavior

Sidechannel delivery is observational. It does not participate in Engine planning or determine whether a UI update succeeds.

Applications are responsible for transporting, storing, redacting, and retaining these events according to their own telemetry and privacy policies.

---

## Testing strategy

The implementation keeps provider-independent logic testable without a live microphone or provider account.

Unit tests cover areas including:

* Provider event parsing
* Tool routing
* Speak-after-render ordering
* Snapshot summarization
* Grounding debounce and latest-wins behavior
* Barge-in queueing
* Connection lifecycle
* Token request and response mapping
* LiveKit transcript conversion
* LiveKit turn controls
* LiveKit TTS status and cancellation handling

The documentation suite also contains compile-checked voice examples and browser-level documentation tests.

Mocks cannot validate every provider wire behavior. Before release, run at least one complete quickstart against a real transport and verify:

1. Credential minting succeeds.
2. Microphone capture succeeds.
3. Spoken intent reaches the Engine.
4. The UI renders the expected result.
5. Speech confirmation begins only after the render settles.
6. Disconnect and reconnect work.
7. Production routes enforce the required security controls.

---

## Adding another transport

A new voice transport should:

1. Implement `RealtimeProviderAdapter`.
2. Translate provider events into the provider-neutral adapter event union.
3. Keep provider credentials behind a short-lived server-minted grant.
4. Submit only natural-language intent through `update_ui`.
5. Use `RealtimeSession` rather than introducing another Engine path.
6. Respect post-render result ordering.
7. Expose explicit turn controls only through the optional `turnControl` capability.
8. Keep provider-specific dependencies outside `@maelstrom-co/realtime`.

A speech-native adapter may use the declared tools, instructions, and structural grounding.

A cascade adapter may synthesize tool calls from final transcripts, as the LiveKit implementation does, while keeping STT and TTS workers outside the planning boundary.

---

## Related documentation

* [Voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/)
* [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/)
* [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/)
* [Voice architecture comparison](https://docs.maelstrom-ai.co/understanding/voice-architecture/)
* [General Maelstrom architecture](./architecture.md)
* [Realtime package README](../packages/realtime/README.md)
* [React voice README](../packages/react-realtime/README.md)
* [LiveKit browser adapter README](../packages/realtime-livekit/README.md)
* [LiveKit token server README](../packages/realtime-livekit-server/README.md)
* [LiveKit agent worker README](../packages/realtime-livekit-agent/README.md)

