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
The component that coordinates planning and validates a Planner's proposed Layout and Execution Plan. It hosts Agent Sessions and can retain conversation history when configured.
_Avoid_: brain, orchestrator (that names a client-side module)

**Planner**:
The configured decision stage that proposes a Layout and Execution Plan from the current Chart state, update reasons such as a Screen Change's goal and Referents, and available history.
_Avoid_: engine (that names the component that coordinates and validates planning)

**Agent Session**:
A per-user conversation, hosted by the Engine, in which an agent pursues the user's goals across many steps (tool calls, tool results, user answers). Unlike the Planner, it holds state.
_Avoid_: runtime, brain, orchestrator, harness

**Agent Run**:
One pass of an Agent Session's loop pursuing the user's goals, from the input that starts it to its finish. Interruptions can amend its goals or add to them mid-run. An Agent Session holds many Agent Runs.
_Avoid_: run (unqualified), request, turn

**Interruption**:
Input from the user that arrives while an Agent Run is in progress. It amends the run, adds an independent goal to it, answers its open question, or supersedes it.
_Avoid_: barge-in (that is speech playback being cut, not an Agent Run)

**Atomic Step**:
A step of an Agent Run that an Interruption never cuts mid-way, such as a tool call with side effects or a UI change being applied. An Interruption takes effect only when no Atomic Step is in flight.

**Tool**:
A capability the Agent Session's loop model can call during an Agent Run. A Tool is either a Server Tool or a Client Tool. The model sees one list of Tools and never knows where a Tool runs.

**Server Tool**:
A Tool the app developer defines that runs where the Agent Session runs. Server Tools reach the app's backend data.

**Client Tool**:
A Tool that runs in the user's browser. Only the framework defines Client Tools: asking the user (ask_user) and the Vessel Queries.
_Avoid_: frontend tool

**Vessel Query**:
A read-only request a Vessel declares alongside its Actions, answered from the Vessel's current state in the browser. Each Vessel Query becomes a Client Tool.

**Screen Change**:
A request from an Agent Run's loop model to change what is on screen. The loop states a goal and its Referents and never names Vessels or Actions, because the Planner decides those. The loop normally waits for the result before it continues.
_Avoid_: show, UI update

**Ambient**:
A mode of a Screen Change that the loop does not wait for. Its outcome reaches the loop later as a Screen Note.

**Screen Note**:
An outcome of a Screen Change that reaches the loop later instead of as a tool result. It covers Ambient Screen Changes and outcomes that arrive late or after cancellation.

**Referents**:
Exact values the loop already knows, such as ids and quantities, passed alongside a Screen Change goal. Include important values in the goal text too, because built-in Planners currently do not consume Referents separately.

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
