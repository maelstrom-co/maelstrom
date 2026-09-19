# GPT-Live architecture and stack overview

GPT-Live adds continuous voice to Maelstrom while the [Engine](./architecture.md)
remains responsible for planning the interface. The integration separates speech,
tool execution, application outcomes, and connection recovery because they finish
at different times.

This overview is for contributors who know Vessels, the Chart, and the Engine. It
explains the responsibilities introduced by PRs #197, #198, #201, #202, and #203,
including their review fixes. Its implementation baseline is stack tip
`62213cf4231a87f652169a925c804ba8cf9f57a3`. These are changes in the reviewed PR
stack; their presence does not imply a merged release or production rollout.

## What changed

The stack adds a continuous observation channel alongside the existing turn-based
voice interfaces. It then adds Live transport, managed tool delegation, native
opening and recovery, and demo integration.

| PR | Responsibility | Main additions |
| --- | --- | --- |
| [#197](https://github.com/maelstrom-co/maelstrom/pull/197) | Shared observations | Timed fragments, revisable captions, independent media/work evidence, `useVoiceObservations()` |
| [#198](https://github.com/maelstrom-co/maelstrom/pull/198) | Live transport and exchange | Browser/server sibling packages, validated protocol subpath, WebRTC lifecycle, usage and finalization |
| [#201](https://github.com/maelstrom-co/maelstrom/pull/201) | Managed UI tools | Full Live adapter, batch result handling, provider identity validation, truthful application outcomes |
| [#202](https://github.com/maelstrom-co/maelstrom/pull/202) | Opening and recovery | Native opening, playback-readiness gate, application-session memory, explicit reconnect |
| [#203](https://github.com/maelstrom-co/maelstrom/pull/203) | Demo integration | Provider switching, Live default, visitor-key exchange, authenticated local mode, metadata debug drawer |

OpenAI Realtime and LiveKit remain supported. Fresh normal demo visits select
GPT-Live. Explicit Realtime configuration and the local LiveKit profile retain
their choices. The default change was moved into this stack; it is not evidence
that the planned comparative evaluation has been completed.

## Three responsibilities, not three UI planners

The Live path has three distinct model responsibilities:

1. **GPT-Live handles conversation and audio.** It delegates requests that need
   application information or changes.
2. **Managed Responses selects and calls the exposed UI tools.** It receives
   their results and continues the delegated interaction.
3. **The Maelstrom Engine plans UI changes.** It receives the intent and a
   snapshot constructed by the client, then returns layout and Actions.

The demo selects `gpt-live-1` for voice and `gpt-5.4-mini` for the managed backend.
The Engine has its own model configuration. Provider conversation, grounding, and
recovery excerpts do not replace the client's authoritative planning snapshot.

```text
Browser                                  OpenAI
  microphone / output audio <----------> GPT-Live
  Live data channel <------------------>   |
    OpenAILiveTransport                   delegates
           |                               v
    OpenAILiveAdapter <----------------> managed Responses
           | validated tool calls
    RealtimeSession
           | update_ui(intent)

Browser application                      Application server
    Orchestrator / Connector ----------> Engine host
           |                               |
           | <--- layout and Actions ------+
    apply layout, then run Actions
           |
    settled result --> adapter --> all outputs --> backend continuation
```

`get_ui_state` and `get_capabilities` read client-owned snapshots. `update_ui`
enters the existing Engine path. Exposing a tool or Action does not implement
authorization. Action handlers and trusted APIs must enforce permissions.

## Package boundaries and ownership

The stack retains the [four-layer dependency rule](./adr/0002-credential-custody-is-a-dependency-edge.md):
server and worker packages cannot depend on browser packages. The Live protocol
is a subpath; its implementations are sibling packages.

| Layer or owner | Module | Responsibility |
| --- | --- | --- |
| Shared client contracts | `@maelstrom-co/client` | Framework-independent observation, fragment, caption, and application-work types |
| Contract | `@maelstrom-co/realtime-protocol/openai-live` | Session/exchange schemas, supported commands, event envelopes, sanitized diagnostic errors |
| Browser voice core | `@maelstrom-co/realtime` | Tool coordination, observation store, opening policy, recovery memory, provider-neutral interfaces |
| Browser provider | `@maelstrom-co/realtime-openai-live` | WebRTC transport and managed Responses adapter |
| Server | `@maelstrom-co/realtime-openai-live-server` | Server-held-key SDP exchange; no browser implementation dependency |
| React binding | `@maelstrom-co/react-realtime` | Shared session retention, hooks, and Orchestrator-scoped memory |
| Demo application | `apps/demo` | Provider selection, key custody choices, switching owner, controls, and diagnostics |

`RealtimeTransportAdapter` describes connection and observation behavior.
`OpenAILiveTransport` implements that subset without placeholder tool methods.
`RealtimeProviderAdapter` adds the complete tool and grounding contract;
`OpenAILiveAdapter` implements it using the transport. `RealtimeSession` requires
the full provider interface.

The optional observation, generated-opening, and recovery capabilities preserve
existing adapter implementations. The stack does not widen the legacy exhaustive
`RealtimeAdapterEvent` union to represent every Live event.

The [provider taxonomy ADR](./adr/0001-realtime-providers-come-in-two-kinds.md)
predates this integration's SDP exchange. Live's server sibling exchanges a
session offer; it does not mint a Realtime ephemeral credential. The structural
package split still applies.

## Connection readiness and retirement

The browser supplies an SDP offer to an injected `LiveSessionExchange`. The host
chooses whether that exchange uses a server route or an application-owned direct
visitor-key request.

```text
explicit start
    -> acquire microphone, create peer and event channel
    -> create offer, set local description, gather ICE
    -> exchange offer for session ID and answer
    -> apply answer AND receive session.started
    -> connected
```

An HTTP success or open data channel is insufficient for readiness. WebRTC
session creation starts the provider session; the transport does not send a
second `session.start` command.

Each connection attempt owns its peer, tracks, callbacks, timers, and abort
signal. Ownership checks follow asynchronous waits and reentrant host callbacks.
A late microphone acquisition is stopped; a stale exchange cannot overwrite a
replacement session's identity. Observer failure cannot prevent transport
cleanup, and releasing subscriptions attempts every disposer.

A transient peer `disconnected` state gets a non-extending five-second grace
period. Recovery keeps the same peer and cancels the timer. Terminal peer states
and channel loss end the connection. This is distinct from automatic reconnect:
the library never creates a replacement paid session after terminal loss.

End voice stops microphone capture and local playback before finalization. It keeps the
event channel available for bounded finalization. `session.closed` supplies final
usage; a close timeout or lost transport leaves finalization incomplete. Neither
waiting for finalization nor closing the peer cancels submitted Engine work.

## Observations describe evidence, not inferred success

`useVoiceObservations()` reads a shared, stable snapshot without connecting a
provider. Its fields separate connection lifecycle, microphone capture, user
speech evidence, incoming audio evidence, and application planning/application
activity. Missing evidence stays `unknown`.

Timed transcript fragments retain exact text and connection-local timestamps.
Fragments can arrive late, revise earlier text, and overlap across speakers.
Display captions group those fragments with stable identities; they are not
authoritative final turns. Display fading never creates finality or triggers
tools. Transcript IDs are validated before publication, and bounded retention
rejects oversized fragments rather than truncating the live caption.

The observation store copies declared fields only. Identical media evidence
preserves snapshot identity and emits no notification. Listener delivery uses a
snapshot so unsubscribe/resubscribe during notification cannot extend that pass
indefinitely.

Three distinctions matter when interpreting the UI:

- Incoming audio does not prove a person heard speech.
- Inactive application work does not prove success.
- A received tool result does not mean GPT-Live has spoken it.

The legacy caption path remains available to Realtime and LiveKit. Reconnecting
does not revive an unchanged faded legacy receipt. Continuous captions still use
their connection generation to distinguish new observations.

## Managed tool execution has a result barrier

The adapter tracks delegation, response, output-item, provider-call, and local
tool-call identities as distinct values. One delegation can span multiple backend
responses. Treating its current response as the identity of every historical
event would turn harmless duplicates into fatal conflicts.

For each response, the adapter collects completed function items before
dispatching the successfully completed batch. It does not use the terminal
response's output array as the call inventory: that array can be empty.

```text
completed function items -> validate identities, slots, arguments
successful batch end    -> dispatch each collected call once
application settlement -> retain each serialized result
all results available  -> send every response.item.create output
                       -> send one body-free response.create continuation
```

Identical duplicates are ignored, including historical duplicates after a
continuation starts. Conflicting identities or output slots are rejected before
batch dispatch. Identity records remain for the connection; capacity exhaustion
ends voice instead of evicting records that protect against repeated effects.
This is connection-local duplicate suppression, not durable exactly-once
execution across new sessions or independent requests.

The client applies `set_layout` before `execute_actions`. Tool output waits for
application settlement. A summary-generation or delivery error cannot rewrite a
confirmed application success. Conversely, losing settlement confirmation cannot
be reported as successful completion or used to resubmit the request.

The existing single latest-wins busy slot remains. Only a confirmed busy
submission rejection enters it. A newer queued intent supersedes the old queued
intent; it does not cancel an admitted request. Settled results remain observable
after voice ends, while a connection-epoch check prevents delivery into any
replacement provider, including retained Realtime and LiveKit adapters.

Result serialization is also bounded. A result that cannot be serialized, or
exceeds 262,144 UTF-16 code units after serialization, ends voice and emits
`DATA_CHANNEL_ERROR`. The delivery method's promise can still resolve. Consumers
must observe the error channel; submitted application work is not undone.

## Recovery is bounded application evidence

`RealtimeSessionMemory` belongs to a Maelstrom session identity. The React binding
retains it across provider-session recreation under the same Orchestrator.
Non-React callers can supply the same memory object when recreating a session;
cross-session reuse is rejected.

It retains an introduction-attempt marker, the latest eight observed speech
excerpts, and the latest eight voice UI outcomes. It stores no credentials,
audio, executable provider commands, or durable Engine history.

| Outcome | Meaning | Recovery consequence |
| --- | --- | --- |
| `queued` | Waiting in the existing busy slot | Not evidence of application admission |
| `submitted` | Application work was requested; settlement is pending | Do not replay it to recover voice |
| `completed` | Application settlement confirmed success | Retain success even if speech delivery failed |
| `failed` | Application failure is known | Distinguish from lost confirmation |
| `unknown` | Submission or settlement confirmation was lost | Do not invent success, failure, or an automatic retry |
| `not_submitted` | Work was dropped or never admitted | Distinguish from an operation with uncertain effects |

Readiness-wait failure, exhausted busy retries, and supersession before admission
retain `not_submitted`. A generic submission rejection can occur after effects;
it retains `unknown`, including after disconnect.

Explicit reconnect seeds observed recovery data and a structural summary in
startup input. The adapter measures the final serialized text, including escaping
and grounding, against an 8,192-byte budget. It removes older records and
reserializes valid JSON rather than cutting serialized bytes. Later outcomes
arrive through quiet appends. Optional grounding callback failure reports a
sanitized nonfatal error; it does not tear down otherwise healthy voice.

Recovery context steers conversation; it is neither authorization nor a source of
planning truth. Restoring it never replays old function calls. An append
acknowledgment confirms acceptance, not model consumption or audible delivery.

## Native opening and playback have separate gates

Live requests a natural introduction through `session.instructions.append`.
It does not use the retained providers' fixed-text TTS path. Requested wording
never becomes a transcript or an Engine history entry.

```text
connection ready + playback accepted
    -> claim the session's introduction attempt
    -> send native opening instruction
    -> correlate acknowledgment, rejection, or timeout
    -> record only speech fragments actually observed
```

The playback gate is optional in the provider-neutral capability. Live implements
it using playback acceptance. A blocked output leaves the introduction unclaimed
until automatic playback or an explicit Enable playback action succeeds. It does
not block microphone input or transport startup. Acceptance still does not prove
physical audibility.

After an attempt is claimed, rejection or timeout can mean uncertain delivery;
reconnect does not automatically repeat it. `requestGeneratedOpening()` returns
`true` for accepted requests and `false` when no request was made.

The demo shares this introduction policy with its retained fixed-greeting
coordinator. Fixed provider handoff claims the shared attempt before playback
settles. Switching from Realtime during its greeting therefore cannot create a
second Live introduction. Selecting an inert provider or failing before greeting
handoff does not consume that attempt.

For setup and the exact consumer contract, see the
[Live opening and recovery guide](../apps/docs/src/content/docs/guides/voice/live-opening-recovery.mdx).

## Credential custody belongs to the host

The library browser adapter receives an exchange callback, not a long-lived key.
The shared server helper owns a server key when the host selects that path.
The demo also has an explicit application-owned BYOK path; the grant-only wording
in the earlier voice architecture describes the retained minting pattern.

```text
Hosted visitor key, held in tab memory
    +-> browser Live exchange -> OpenAI Live session endpoint
    +-> playground.hello      -> hosted Engine Durable Object -> planning API

Local server-held key
    browser -> authenticated loopback Vite middleware -> Live server helper
```

The hosted voice exchange is browser-direct. The overall demo is not
browser-only key custody: the Engine also receives that key for server-side
planning. Browser-direct requests omit browser credentials and reject redirects.

Local server-key Live mode requires explicit opt-in, a separate password, and
actual loopback listener/socket checks. Authentication runs before loading the
application handler. Same-origin headers provide additional browser protection;
they are not authentication. Hosted mode and the standalone Start exchange route
reject this local-only path.

The server helper uses a fixed HTTPS endpoint, bounded request/response handling,
and no automatic session-creation retries. The wrapping host still owns caller
authorization and deployment policy. Development HTTP authentication is not a
general remote-service authentication design. See the
[demo setup](../apps/demo/README.md#optional-gpt-live-with-a-local-server-key).

## Demo ownership and diagnostics

The app-local `DemoVoiceOwner` keeps one Orchestrator identity, recovery memory,
and fixed-greeting coordinator across provider changes. It releases the old
connection before installing an inert replacement. Candidate construction commits
atomically; failure leaves a coherent previous owner and permits retry.

Operation promises exist before callbacks can observe teardown or switching.
Retired owners and older selection requests cannot overwrite a newer selection
after a key removal or replacement. Changing a key creates a new application
session rather than transferring old credentials into another provider run.

The debug drawer is an overlay. It does not own sessions or reduce Chart width.
The viewport layout reserves control space so mobile users can reach End voice
and the composer without an initial scroll.

Diagnostics retain at most 100 projected timeline entries and 16 completed or
incomplete Live transport records. Provider-instance identity distinguishes two
adapters whose connection counters both start at one. Final usage survives
provider changes and reconnects; cumulative usage is a snapshot, never a value to
sum across successive updates.

The panel excludes keys, SDP, transcript text, tool arguments/results, structural
payloads, raw errors, and full provider configuration. Some correlations and usage
are unavailable at the app-facing boundary, including backend token usage and a
complete tool-to-Engine mapping. The panel marks absence instead of inferring
links from event order. Recovery memory may contain bounded text; it is not the
metadata-only diagnostics store.

## Build and review safeguards

- Layer tests and per-server import restrictions cover both new Live packages.
- Workspace dependency references land where each dependency is introduced, so
  intermediate PRs install without fetching mismatched private release versions.
- The Live server package declares Node 20 or newer.
- TypeDoc registers both package roots and the Live protocol subpath. Explicit
  Nx dependencies make docs affected when either package's sources change.
- A public TypeDoc router emits real module index pages. The docs-link check no
  longer relies on the six historical missing-page exceptions.
- Vite configuration loads without prebuilt workspace outputs. The authenticated
  local middleware loads its application handler through Vite's SSR pipeline only
  after authorization, avoiding a cold-build dependency cycle.

Regression tests cover generation races, teardown failures, malformed identities,
batch ordering, retained outcomes, opening readiness, caption behavior, and
provider-switch ownership. Local WebRTC browser fixtures exercise the real app
and Engine pipeline with mocked provider/LLM boundaries. The stack also passed
public consumer checks, intermediate installs, and CI for every PR.

The deployed preview received desktop/mobile smoke checks, and user feedback
confirmed working Live conversation audio. These observations do not establish
exhaustive funded tool behavior, physical-device acoustics, Safari behavior, or
comparative superiority. Playback acceptance and a fixture acknowledgment remain
weaker evidence than a person hearing the intended speech.

## What this stack leaves for later

Generic cancellation remains a separate core phase. This stack adds no durable
operation registry, per-operation revision FIFO, cancellation-aware history
fencing, or rollback of admitted Actions. The hosted demo's Engine history remains
in memory; Durable Object hosting alone does not make those outcomes durable.

The managed-correction bridge, richer content inspector, provider taxonomy
redesign, and comparative experience evaluation also remain separate work. Live
is the demo default by explicit product choice, not because those projects are
complete.

## Code map for contributors

- [Observation contracts](../packages/client/src/lib/voice-session/voice-observations.ts)
  and [observation store](../packages/realtime/src/lib/realtime-session/voice-observation-store.ts).
- [Shared session](../packages/realtime/src/lib/realtime-session/realtime-session.ts)
  and [recovery memory](../packages/realtime/src/lib/realtime-session/realtime-session-memory.ts).
- [Live transport](../packages/realtime-openai-live/src/live-transport.ts)
  and [managed adapter](../packages/realtime-openai-live/src/live-adapter.ts).
- [Live protocol](../packages/realtime-protocol/src/openai-live.ts)
  and [server exchange](../packages/realtime-openai-live-server/src/index.ts).
- [React composition](../packages/react-realtime/src/lib/maelstrom-realtime.ts)
  and [shared registry](../packages/react-realtime/src/lib/shared-realtime-session.ts).
- [Demo owner](../apps/demo/src/lib/demo-voice.tsx),
  [diagnostic projection](../apps/demo/src/lib/voice-diagnostics.ts),
  and [local authorization middleware](../apps/demo/local-live-dev-plugin.ts).

These files define behavior. Generated API references describe the public
signatures; the [voice architecture decisions](./realtime-voice-architecture.md)
and ADRs describe the pre-existing design constraints.
