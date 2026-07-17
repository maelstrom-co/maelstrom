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
