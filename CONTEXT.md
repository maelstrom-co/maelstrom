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
The layout surface Instances are arranged on, sized by its container. In grid mode, addressed in integer grid coordinates, never pixels. In tiling mode, addressed as a split tree whose leaves derive their size from the tree and container.
_Avoid_: canvas, board, grid container

**Weighted Split**:
A tiling split token carrying comma-separated integer weights, as in `"V:1,1,1"`. The weight count declares the token's arity — how many following subtrees it consumes — and each child takes its weight over their sum. Bare `H`/`V` are the same thing with weights `1,1`.
_Avoid_: ratio node, proportional split, n-ary split

**Engine**:
The entry point clients talk to. Hosts Agent Sessions and delegates every UI decision to the Planner.
_Avoid_: brain, orchestrator (that names a client-side module)

**Planner**:
The stateless decision step: takes an intent plus current Chart state and returns an Execution Plan and Layout Directives.

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

**Execution Plan**:
The ordered list of Actions the Planner decided to invoke in response to an update.
_Avoid_: action list, plan (unqualified)

**Layout Directive**:
The Planner's placement decision for one Instance: grid position and size.
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
