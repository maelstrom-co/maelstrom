# Voice architecture decisions

Why the voice packages are shaped the way they are.

This document argues for the design. It is not a build guide and not a type
listing, because both already exist and both stay current on their own:

- To **build** with voice, follow the [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/) or the [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/).
- To **understand how voice behaves**, read [the voice boundary](https://docs.maelstrom-ai.co/understanding/voice-architecture/) and [turn detection in the browser](https://docs.maelstrom-ai.co/understanding/browser-vad-and-barge-in/).
- For **exact shapes**, read the generated [API reference](https://docs.maelstrom-ai.co/reference/realtime/readme/).

What is left here is the reasoning a contributor needs before changing any of
it. Every section answers "why is it like this, and what breaks if you undo it".
For the general system — Vessels, Chart, Engine — read
[architecture.md](./architecture.md) first.

## The rule everything else protects

A voice provider adds a second thing that talks to the user. It must not add a
second thing that decides what the user sees.

A speech model holds a picture of your interface as it speaks: what it believes
is on screen, what it just described, what it thinks it changed. That picture is
useful for conversation and wrong about as often as speech is. It never becomes
planning input. The model's only power is emitting a natural-language intent —
the same thing a keyboard produces — and the Engine plans against a snapshot the
client builds from its own stores.

[The voice boundary](https://docs.maelstrom-ai.co/understanding/voice-architecture/)
explains how that holds at runtime. Everything below is a consequence of it.

## Why the packages split where they do

Voice is one capability with several implementations, so the split follows the
boundaries that would otherwise be honour-system conventions.

The durable package rules are recorded in
[the provider taxonomy ADR](./adr/0001-realtime-providers-come-in-two-kinds.md),
[the credential custody ADR](./adr/0002-credential-custody-is-a-dependency-edge.md),
and [the turn-taking ADR](./adr/0003-turn-taking-is-provider-neutral.md).
`packages/realtime-protocol/src/layer-boundary.test.ts` is the executable
authority for dependency direction.

**`realtime` apart from `client`.** The voice core carries browser-only weight —
WebRTC, microphone capture — and a provider surface most Maelstrom apps never
touch. The *seam* lives in `client` as types; the *implementation* lives in
`realtime`. An app that never speaks pays nothing for the option.

**Provider adapters apart from their server minters.** These run on opposite
sides of an HTTP boundary, and only the server package may hold a provider key.
Both sides import wire and failure types from `realtime-protocol`; the adapter
never imports its server sibling. Nothing reachable from a browser bundle can
reach code that touches a key, because the browser package has no path to the
server package at all. Reverse that edge and key custody stops being structural.

**Providers as sibling packages.** `realtime-openai` and `realtime-livekit`
implement the provider-neutral seam from `realtime`. Importing one provider does
not drag another provider's SDK into the bundle, and the core never branches on
provider identity, so another adapter is an addition rather than a conditional.

**`realtime-livekit` apart from `realtime`.** LiveKit is optional transport
weight. The adapter owns the microphone and turn mechanics without imposing
them on apps using a different provider.

**`realtime-vad` apart from `realtime-livekit`.** Browser VAD consumes a
`MediaStream` and emits speech edges without knowing about LiveKit rooms or
publications. Its package owns the runtime and matching asset copier so another
transport can reuse detection without depending on LiveKit.

**The LiveKit adapter apart from its agent.** These sit on opposite sides of the
room. The adapter owns local capture and the privacy gate; the worker owns the
worker-only `DEEPGRAM_API_KEY` and `CARTESIA_API_KEY` credentials for STT and
TTS. It also holds `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to register with
LiveKit; the separate token endpoint uses the same LiveKit credentials to sign
browser room tokens. The browser receives only a short-lived room token, never
any of those credentials. The worker holds no planning model, and it is never
given Vessels, Chart state, or grounding, because a worker that could see
structure could plan against it.

It is not sealed off, though, and the distinction is worth stating precisely. It
does receive the words to speak: after a successful update that is the Engine's
own message, or failing that a short summary of the settled UI. So UI-derived
*text* does reach the worker. What never reaches it is UI *structure*, which is
the thing a second planner would need.

## Two channels, deliberately unequal

The Engine and the model both need to know what is on screen, and they are given
that knowledge with different guarantees on purpose.

The Engine gets **strong** context: the client snapshots its stores while
handling the intent and embeds that snapshot in the request. It remains the
planning input for that request even if client state changes while the request
executes.

The model gets **eventual** context: a short structural summary pushed after
renders settle, debounced and latest-wins. It can lag. It can be skipped
entirely under a burst.

That asymmetry is not a compromise, it is the point. Grounding exists so the
model can *talk* about the interface, and conversation tolerates being a beat
behind. Planning does not. If grounding were made strong, it would either cost a
round trip per change or grow the model's context in proportion to how much the
UI moves — and it would still not be safe to plan from, because it arrives
through the model. When the model needs certainty rather than ambience, it pulls
the current snapshot on demand instead.

Neither channel carries live instance content. An instance is projected to its
id, its Vessel, and its current variant before it goes anywhere, and a test
enforces that projection, so adding a data field breaks the build rather than
leaking quietly.

The two channels are not equally narrow, though, and that is worth being exact
about, because people do put sensitive strings in Vessel definitions. Alongside
those instance projections, the Engine receives the Vessel definitions
themselves — descriptions, variants, action descriptions — because that is the
material it plans against. The Engine plans from that full request. When history
is configured, the raw request is also persisted by default, but the host can use
`transformEntry` to sanitise the representation before it reaches the store. The
model receives only the projection and a summary built from it. "The model is
told less than the Engine" is accurate. "Nothing but structure reaches either"
is not.

A production history deployment must therefore define retention and deletion,
encrypt stored entries, authorise every tenant and session read, and configure
`transformEntry` to redact sensitive Vessel strings before storage. These
controls belong to the host application. The instance projection does not
provide them.

## Why grounding is rewritten, never edited

The OpenAI adapter keeps exactly one grounding message in the conversation, at a
stable id. On each update it deletes that item and inserts a replacement.

Updating it in place would be the obvious optimisation, and it would quietly
remove the property the design depends on. Recreating the item moves it to the
tail at the time of that update. OpenAI truncates context from the head, so
material already present — stale pull results, old transcript — is eligible for
eviction before that grounding version. Later conversation items can follow it,
so it does not remain permanently last. Recreating it on each settle still keeps
refreshing its position; an in-place update would pin it at its original position
and forfeit that protection entirely.

It is not free. Recreating the item invalidates the cached-input prefix from the
old position onward, so the suffix re-bills after each settle. That is a
deliberate choice of freshness over cache cost, and it is the one part of this
design that should be profiled before a long-session deployment, because heavy
UI churn is exactly the case where it gets expensive.

## Why "busy" is not a failure

Voice is the first intent source that can fire while a request is still in
flight. A person typing waits for the spinner. A model does not.

When an intent arrives mid-request, it is held in a single latest-wins slot and
submitted once the in-flight request settles, so correcting yourself mid-sentence
simply works. A newer interruption supersedes an older queued one, and the
superseded call is still answered, because every tool call must be answered
exactly once or the model waits forever.

The subtle part is what happens to *other* errors. The in-flight case is caught
by type, never by matching an error string across a package boundary, and
anything else surfaces as a distinct failure rather than as busy-ness. That
distinction is load-bearing: telling a model "try again in a moment" after a
genuine pipeline failure invites it to retry a thing that cannot succeed, and it
will keep doing so. A wrong answer here does not degrade the experience, it
creates a loop.

## Where the keys live

Provider credentials stay in the server-side process that needs them. The OpenAI
key exists only in its minter and authorises the upstream request. LiveKit's key
and secret exist in both the token endpoint that signs room tokens and the agent
worker that registers with LiveKit. Deepgram and Cartesia keys exist only in that
worker. The browser receives short-lived, narrowly scoped credentials instead,
and each adapter is handed a mint function rather than a provider key — so no
session-layer code path can leak one, because no session-layer code path ever
holds one.

One gap is deliberate and worth stating plainly rather than burying: **the
minters do not authenticate callers.** They validate shape and sign a
credential; they have no opinion about who is allowed to ask. Authentication,
authorisation, origin policy, and rate limiting belong to the route that wraps
the minter, and that route is the application's to write. The repository's demo
routes do not implement them and are not deployable.

Production deployments must also keep every credential-bearing hop encrypted
and redirect-free: browser-to-mint routes use HTTPS, LiveKit connections use
`wss://`, and credential-bearing requests reject redirects. Plain HTTP and
`ws://` are local-development options, not production transports.

The same reasoning governs `realtime-vad`'s browser assets. The browser executes
worklet, JavaScript, and WebAssembly code from whatever directory is configured,
so that directory is trusted infrastructure. It may never be derived from user
input.

## What we deliberately have not built

A future Gemini Live adapter remains unimplemented. The provider-neutral claim
will only be proven fully when another speech-native adapter lands behind the
seam.

The `VoiceSession` seam shipped thinner than its exports suggest.
`SpeakableResult` and `GroundingUpdate` are exported but not referenced by the
interface — reserved names for a contract not yet settled. The JSDoc says so,
which makes it honest but not harmless: they are still importable, and external
code that grows around a placeholder will make the real shape harder to choose.
Settling that seam is a joint design decision, not a unilateral change.

The sidechannel is emitter-only. Every tool round-trip is mirrored onto a
callback, but nothing in this repository consumes it. The schema is additive-only
because a metering or telemetry consumer would ride on it, and its timestamps are
client-clock and skew-prone by contract — any receiver correlating across clients
must stamp its own receipt time.

## Why the greeting is recorded before it is spoken

This section describes retained fixed greetings. Live uses a separate generated
opening. Its session-owned memory claims one introduction attempt before provider
send, including ambiguous failures. The shared React registry retains that memory
across provider-session recreation under the same Orchestrator, including a
runtime provider switch. A fixed greeting claims the same memory before it
speaks and treats an introduction claimed by another opening as terminal, so a
switch between Live and a fixed-greeting provider never introduces twice. Only observed
transcript excerpts enter recovery context; requested wording never enters Engine
history or captions. Native append acknowledgment does not prove model consumption
or audible completion. See the [Live opening and recovery guide](https://docs.maelstrom-ai.co/guides/voice/live-opening-recovery/).

The demo greets once when voice connects. Ordering is fixed:

**Engine ack → provider handoff → provider playout start + caption.**

The greeting is persisted to engine history first (`addAssistantMessageAcknowledged`
over the unchanged WebSocket transport), then the OpenAI adapter sends the exact
assistant item into provider conversation and fetches WAV bytes for playback.
The assistant caption is emitted only when the adapter reports its closest
reliable playout-start boundary. OpenAI reports exact local Web Audio source
start. LiveKit reports when the first synthesized frame enters the worker's
AudioSource queue; its browser SDK exposes autoplay readiness but no
per-utterance audible-render event. Once provider send begins, the coordinator
treats the result as terminal so reconnecting or recreating the provider session
cannot duplicate speech. A failure before provider send begins remains retriable
by a later connection generation. A new session greets again.

When the user clicks the voice orb, `RealtimeSession.connect()` calls
`adapter.activateAudio()` synchronously in the click handler so Web Audio unlock
work begins before any async handshake. Failures after a successful provider-item
send settle as `accepted` (terminal); only pre-send failures return `not_started`.
The keyless demo uses the same boundary when the first browser key is saved: it
pre-activates one OpenAI adapter during that save gesture, hands that exact
adapter to the remounted session, and then connects without requiring another
orb click.

The UI observes a retained, provider-neutral greeting presentation lifecycle
rather than inferring progress from transport state. `preparing` starts before
the provider handshake and includes the wait for Engine readiness, which has no
timeout; `settled` says only that presentation for the current generation ended,
not that provider speech succeeded or remains active. Retryable disconnects
return to `pending`, while terminal coordinator proof survives provider-session
recreation. Connection generations fence updates so abandoned work cannot change
the replacement session's UI. This shared lifecycle lets custom controls and the
demo show one compact “Preparing greeting…” treatment, then
“Listening”, without creating a second timer or provider-specific state machine.

`RealtimeSession` also passes this lifecycle into adapter connection setup.
When terminal proof makes greeting presentation impossible, OpenAI publishes
the raw microphone directly instead of preparing the generated greeting bridge.
Otherwise stopping and restarting voice would leave that generated track
published because no second greeting exists to replace it.

### Why Skip is terminal

`RealtimeSession.skipGreeting()` is the Phase 1 user-control action. It records
`skipped` synchronously before aborting local work, does not disconnect the
provider or change turn mode, and is idempotent. The retained proof survives a
provider reconnect or session recreation for the same Maelstrom `SessionId`; a
new `SessionId` starts independently. A completed presentation remains
`presented` and an Engine-deduped presentation remains `suppressed`; Skip never
rewrites either terminal reason.

The irreversible-side-effect boundary is explicit. If Skip wins before or while
waiting for Engine readiness, no acknowledgement, caption, provider item,
synthesis, or playback begins. An acknowledgement already in flight may settle
once, but after Skip no caption, provider item, synthesis, or playback begins.
After Engine insertion or provider handoff, the existing history can remain at
most once; local work aborts, the exact microphone enabled values are restored,
and reconnect does not replay the greeting.

Skip is the reliable immediate-control path in this phase. It does not add
spoken greeting interruption, local VAD, pre-roll, or a real-device acoustic
claim. Mobile timing, echo removal, VAD accuracy, and first-phoneme preservation
remain unverified. Diagnostics continue to exclude audio, transcript content,
streams and tracks, device identity, and complete media settings.

Debug-only OpenAI playout diagnostics project WebRTC receiver counters into
fixed packet-loss, concealment, rate-adjustment, and jitter-delay categories.
They never retain raw reports, exact counters, identifiers, addresses, codecs,
levels, audio, or text. These categories can implicate transport degradation;
clean categories cannot prove that provider audio sounded natural.

### OpenAI greeting TTS (demo)

OpenAI retains the exact assistant item in provider conversation
(`conversation.item.create`, `status: completed`, single `output_text`) and never
issues a greeting `response.create`, so an active model response cannot be
disturbed and the model never paraphrases the fixed text. Playback does **not**
wait for a provider `conversation.item.created` ack — engine acknowledgement is
the authoritative outer gate.

Speech uses OpenAI Text-to-Speech (`gpt-4o-mini-tts`, WAV, recommended built-in
voice `cedar`) so the greeting matches subsequent Realtime model audio. A fixed
style instruction asks for warm, natural, conversational delivery. The same
`cedar` value is configured on:

- the adapter's initial `session.update` `audio.output.voice`;
- local client-secret minting (`createOpenAIMinter` trusted option);
- hosted browser-direct client-secret creation.

**Local custody.** The browser POSTs a bodyless same-origin request to
`/api/demo-greeting-tts`. The route requires matching `Origin` and
`Sec-Fetch-Site: same-origin`, accepts no caller JSON/text, and calls OpenAI with
the server-held `OPENAI_API_KEY` and a fixed payload. Concurrent callers coalesce
onto one upstream request; the first validated WAV is cached process-locally. The
route allows at most three upstream attempts in a 60-second window. The budget
resets when that window elapses and after a validated response is cached. This
process-local budget and cache are development-only, not production distributed
abuse protection. The browser never sees the server key.

**Hosted BYOK custody.** The visitor key is used only in the browser Authorization
header for direct `POST https://api.openai.com/v1/audio/speech` (and client-secret
minting). It is never forwarded through Maelstrom servers, logs, or error bodies.

External audio is validated before Web Audio decode:

- HTTP success and an allowed WAV media type (`audio/wav`, `audio/x-wav`,
  `audio/wave`, or `audio/vnd.wave`);
- when `Content-Length` is present, the streamed byte count must match it exactly;
- a 1 MiB (`1_048_576`) actual-byte ceiling;
- a minimum complete WAV container size (44 bytes);
- `RIFF`/`WAVE` magic plus either an exact RIFF-declared file-size match
  (`chunkSize + 8`) or the standard `0xFFFFFFFF` unknown-length marker used by
  OpenAI streaming WAV responses.

Both credential-bearing TTS requests (hosted browser→OpenAI and the local route’s
server-key upstream call) set `redirect: 'error'` and fail closed rather than
following redirects. Abort races ensure hanging resume/fetch cannot leave greeting
work pending after disconnect.

OpenAI requires disclosing that voice audio is AI-generated. The demo renders a
compact visible label next to the voice orb: “AI-generated voice”.

### LiveKit greeting

LiveKit needs a narrow readiness gate. The worker registers `SPEAK_TOPIC`
asynchronously after the user joins (and after the TTS track publish), while the
browser `connect()` resolves at join — a greeting sent earlier is silently
dropped. The single-packet `tts_ready` closes that gap. If readiness is absent or
times out before `sendText()` begins, no provider send occurs and the adapter
returns retriable `not_started`; a later connection generation may try again.
Once `sendText()` begins, the outcome is terminal so an ambiguous completion
cannot cause duplicate speech. The greeting reuses the existing `SPEAK_TOPIC` /
status machinery (`tts_done` / `tts_error`), so barge-in and state collapse
semantics are unchanged. Stale data from a torn-down room is dropped by a
room-currency guard on the adapter's `DataReceived` handler.

### Manual verification (both providers)

Verify before you trust. Run these steps in order.

1. **Prerequisites.** Valid provider credentials. The LiveKit path additionally
   needs the agent worker running (`bun --cwd apps/demo run dev-livekit` runs
   both; `voice-worker.ts` sits on top of `ws-server`).
2. **OpenAI** (`bun --cwd apps/demo run dev`). Confirm the AI-voice disclosure is
   visible before interaction. Delay Engine readiness, save the first browser
   key (or click the orb for an existing session), and confirm
   that the compact “Connecting…” / “Preparing greeting…” treatment remains
   visible for the whole wait with no invented timeout; Stop voice must remain
   usable. Grant microphone permission if prompted. Restore Engine
   readiness and confirm that the label becomes “Listening” only after greeting
   presentation settles. Confirm that the save or orb click unlocks Web Audio and
   produces exactly one assistant caption matching the greeting text and one
   audible TTS playback. Network shows bodyless same-origin
   `POST /api/demo-greeting-tts` with `Sec-Fetch-Site: same-origin`. In DevTools,
   expect a `conversation.item.create` (assistant, `completed`) on the data channel
   **before** the TTS request and **no** greeting `response.create`. Confirm the
   engine history contains the greeting before playback and that the caption
   appears when playback starts. Disconnect during
   the Engine wait and confirm that a late continuation does not change the
   replacement UI. Reconnect and let the greeting complete once, then reconnect
   again → no second caption, TTS request, or playback after terminal proof
   exists. A fresh session → greets once again; local route cache means no second
   upstream OpenAI synthesis. These checks establish lifecycle ordering, not
   mobile behavior or acoustic effectiveness.
3. **LiveKit** (`bun --cwd apps/demo run dev-livekit`). The greeting is spoken
   only after `tts_ready`; “Preparing greeting…” remains visible until greeting
   presentation settles, then changes to “Listening” (worker log order shows
   track publish → `SPEAK_TOPIC`
   registration → `tts_ready`). If readiness is absent or times out, confirm that
   no `SPEAK_TOPIC` send occurs; reconnecting may retry on the later connection
   generation. Confirm the caption appears after the matching `tts_started`
   first-frame signal, including when a later utterance is already queued.
   ID-less and stale start signals must not publish it. After a `SPEAK_TOPIC`
   send begins, reconnecting must not repeat the greeting. A new session greets
   once. This signal narrows subtitle lead time but does not prove browser
   audible-render timing.

## Package-private OpenAI ownership seams

Four package-private modules concentrate implementation ownership without
changing Phase 1 public interfaces. The response arbiter owns OpenAI response
scheduling, cancellation, and output-clear policy. Greeting presentation owns
the provider assistant-history handoff and local Web Audio playback. The
microphone publication gate owns the exact prior `enabled` value for every
unique microphone track while that presentation is active. The shared React
session registry owns per-Orchestrator session lifetime, retains the greeting
coordinator across provider-session recreation, and is the only place that
builds sessions: `useVoice().switchProvider()` asks it to disconnect the current
session, build the next adapter and session, and release the old session's
`onSession` wiring.

These seams preserve Engine acknowledgement → provider handoff → synthesis →
provider playout-start caption ordering, existing privacy constraints, and LiveKit
behavior. They add no acoustic or spoken-interruption claim.
