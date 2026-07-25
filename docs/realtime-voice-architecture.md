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

**`realtime-livekit` apart from `realtime`.** LiveKit and the browser VAD assets
are optional transport weight. The adapter owns the microphone and turn
mechanics without imposing them on apps using a different provider.

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

The same reasoning governs the browser's VAD assets. The browser executes
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
