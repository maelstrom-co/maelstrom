# Maelstrom

An AI-orchestrated UI framework that arranges and controls application-defined Vessels based on user intent and available Chart space.

## Language

**Vessel**:
A state machine describing a UI component, with a semantic description, Variants, and the Actions available in each Variant.
_Avoid_: component, widget

**Variant**:
A discrete state of a Vessel with its own props, available Actions, and a minimum size enforced in grid layouts.
_Avoid_: state, mode

**Action**:
A named operation a Vessel offers in a given Variant, which may transition an Instance to another Variant. The client runs Actions from local input or an accepted Execution Plan.
_Avoid_: command, event

**Instance**:
A live occurrence of a Vessel retained by a Chart, whether visible or hidden. Several Instances of the same Vessel can coexist.
_Avoid_: element, node

**Chart**:
A container-sized surface for arranging Instances. Grid Layouts use integer cell coordinates; tiling Layouts divide its space with a split tree.
_Avoid_: canvas, board, grid container

**Weighted Split**:
A tiling split whose positive integer weights define child regions and their relative shares of the available space. An unweighted split has two equal regions.
_Avoid_: ratio node, proportional split, n-ary split

**Engine**:
The component that coordinates planning and validates a Planner's proposed Layout and Execution Plan. It can retain conversation history when configured.
_Avoid_: brain, orchestrator (that names a client-side module)

**Planner**:
The configured decision stage that proposes a Layout and Execution Plan from the current Chart state, update reasons, and available history.
_Avoid_: engine (that names the component that coordinates and validates planning)

**Execution Plan**:
The ordered list of Actions the client runs after applying an accepted Layout.
_Avoid_: action list, plan (unqualified)

**Layout**:
The arrangement of Instances on a Chart. A grid Layout uses positions and sizes; a tiling Layout uses a split tree and retained Instance identities and Variants.
_Avoid_: layout directive (when referring to the complete Layout)

**Layout Directive**:
A placement decision for one Instance in a grid Layout, with a position and size.
_Avoid_: layout instruction

**Envelope**:
The unit of exchange between a client and Engine host over a duplex transport. ClientEnvelope and ServerEnvelope define the two directions of the wire contract.
_Avoid_: frame, packet, wire message

**Connector**:
The client-side adapter that carries Envelopes (or their HTTP equivalents) over a concrete transport.
_Avoid_: transport (that names the medium, not the adapter)

**Provider Adapter**:
The implementation that drives one voice provider's transport through the shared realtime session interface. It owns provider-specific behavior.
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
