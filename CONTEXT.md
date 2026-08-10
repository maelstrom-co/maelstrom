# Maelstrom

An AI-orchestrated dynamic UI framework: an LLM arranges, controls, and interacts with UI components based on user intent and available screen space.

## Language

**Vessel**:
A state machine describing a UI component: a semantic description, a set of Variants, and the Actions that transition between them.
_Avoid_: component, widget

**Variant**:
A discrete state of a Vessel with its own props and minimum size requirement.
_Avoid_: state, mode

**Action**:
A named transition a Vessel offers in a given Variant. Invoked locally by the user — the client applies the declared transition immediately and informs the Engine — or by the Engine through an Execution Plan, where the Layout Directive carries the resulting Variants.
_Avoid_: command, event

**Instance**:
A live occurrence of a Vessel placed on a Chart. Several Instances of the same Vessel can coexist.
_Avoid_: element, node

**Chart**:
The grid-based layout surface Instances are arranged on. Sized by its container, addressed in integer grid coordinates, never pixels.
_Avoid_: canvas, board, grid container

**Engine**:
The stateless decision core: takes user intent plus current Chart state and returns an Execution Plan and Layout Directives.
_Avoid_: brain, orchestrator (that names a client-side module)

**Execution Plan**:
The ordered list of Actions the Engine decided to invoke in response to an update.
_Avoid_: action list, plan (unqualified)

**Layout Directive**:
The Engine's placement decision for one Instance: grid position and size.
_Avoid_: layout instruction

**Envelope**:
The unit of exchange on a duplex stream transport between client and engine host. ClientEnvelope names everything a client may send (every EngineMessage is one, plus transport-only queries); ServerEnvelope names everything a host may send back.
_Avoid_: frame, packet, wire message

**Connector**:
The client-side adapter that carries Envelopes (or their HTTP equivalents) over a concrete transport.
_Avoid_: transport (that names the medium, not the adapter)

**Provider Adapter**:
The implementation that drives one voice provider's transport behind the shared realtime session seam. Everything provider-shaped lives below it.
_Avoid_: driver, integration, plugin

**Speech-native Provider**:
A voice provider that owns speech recognition, the model, speech synthesis, and turn detection behind a single connection.
_Avoid_: realtime provider (that names the whole category, not this kind)

**Cascade Provider**:
A voice provider that supplies transport only, with speech recognition and synthesis run server-side as a separate process.
_Avoid_: STT/TTS provider, pipeline provider

**Grant**:
An ephemeral, provider-scoped credential the browser uses to open a voice session directly. Carries an expiry so it can be refreshed before it lapses.
_Avoid_: token, secret, key

**Minter**:
The server-side component that exchanges a long-lived provider API key for a Grant. The only side that ever holds the key.
_Avoid_: token service, auth endpoint

**Turn Mode**:
Whether the boundaries of a user's speaking turn are detected automatically or delimited by the user. A property of a live connection, not of a provider.
_Avoid_: push-to-talk, VAD mode
