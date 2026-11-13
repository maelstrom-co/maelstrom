# How the experimental AG-UI stack changes Maelstrom

The stack adds an optional AG-UI workspace transport and strengthens application
completion across transports. Existing applications keep the legacy connector
default. Applications that use the new transport gain correlated evidence that
the requested Layout and Actions settled before a dependent request starts.

This explanation compares the stack with `main` at
`f74d004a9c4c32e9380e4ebf1acedcc01743a4b4`. It is intended for SDK maintainers and
application developers who know the [core architecture](./architecture.md).
The baseline already includes tagged Planner results, Action `effect`,
post-handler transitions, and the native agent/tool loop. Those features are
preserved; they are not additions from this stack.

## Ownership across the two loops

The dedicated app uses TanStack AI to decompose a goal and decide whether another
step is needed. Each `apply_workspace` frontend-tool call requests one Maelstrom
plan. The Engine selects and validates a Layout and Actions. The client applies
them and reports their settlement. Only then can the outer goal loop continue.

AG-UI carries interaction events between these owners. It does not take over
Maelstrom's Chart state, Action execution, or the application's records.
The browser's stores remain authoritative for the dispatch-time UI snapshot.
The application server remains authoritative for records and mutation receipts.

Typed input and GPT-Live enter the dedicated app's same `runGoal` path. Speech
supplies natural-language intent. It does not supply an alternative UI plan.
The [voice architecture](./realtime-voice-architecture.md) still defines provider
ownership, credentials, and runtime turn mode.

## Changes to existing libraries

| Library | Change | Effect on consumers |
| --- | --- | --- |
| `@maelstrom-co/client` | Optional application-settlement callback and bounded acknowledgment | Dependent requests can wait for their own application evidence |
| `@maelstrom-co/client` | Opt-in native agent-event WebSocket adapter | The client FIFO can send complete Chart requests over the native event wire |
| `@maelstrom-co/client` | Action summaries preserve original plan indices | Interleaved Instances keep correct positional acknowledgment evidence |
| `@maelstrom-co/engine` | Whole-batch application status on UI-only connections | Layout refusal and uncertain effects have different continuation rules |
| `@maelstrom-co/engine` | Client-dispatched Chart input and configured native planning history | Automatic updates retain their dispatch-time context and history policy |
| `@maelstrom-co/protocol` | Native wire version 3, `chart_request`, and required application status | Native agent peers must upgrade together |
| `@maelstrom-co/react` | Provider `readyTimeoutMs` | Applications can allow lazy Vessel handlers more time to register |
| `@maelstrom-co/realtime-openai-live-server` | Manual redirect handling | The session exchange works with workerd without following redirects |
| Server and worker packages | AG-UI and shared-view import restrictions | Browser code remains outside server dependency paths |

### Client completion belongs to one application batch

`ApplicationSettlement` and `ApplicationActionOutcome` are public client types.
The optional `EngineConnector.applicationSettled(settlement, signal)` callback
receives the request ID, canonical batch result, ordered Action outcomes, and
the observed Chart. A full `chartRequest` snapshot supports native acknowledgment.

The Orchestrator captures this evidence at the requesting operation's own batch
boundary. A queued server push cannot replace that request's observation.
Unsolicited pushes continue to apply independently and do not trigger request
acknowledgment. Transport completion and global command-queue idleness are not
used as substitutes for application completion.

The callback participates in queued intents, immediate requests, and automatic
update flushes. The next planning request waits for it. The existing
`processIntent()` return still means response delivery; callers that need settled
completion use the queued intent ticket. This distinction prevents a response
from being mistaken for a committed application effect.

`applicationAcknowledgmentTimeoutMs` defaults to 60,000 milliseconds. Its timer
starts after Actions settle. A timeout, rejected acknowledgment, connector
replacement, or disposal retires the acknowledgment signal. Cancellation stops
acknowledgment work; it cannot undo an Action that has already executed.

An uncertain acknowledgment blocks further planning on that connector binding.
Queued intents keep their own expiry limits, and automatic updates remain
buffered. A different connector permits new admission after application-owned
reconciliation. Reconnecting the same connector does not clear uncertainty.

The ActionManager still executes different Instances concurrently and each
Instance's Actions in order. Its result array now uses original Execution Plan
indices, including the transition path. This prevents evidence for one Instance
from being assigned to another when their completion order differs.

Relevant implementation:
[settlement types](../packages/client/src/lib/connection-manager/application-settlement.ts),
[Orchestrator](../packages/client/src/lib/orchestrator/orchestrator.ts), and
[ActionManager](../packages/client/src/lib/command-processor/action-manager.ts).

### Client native events remain an explicit choice

`WebSocketConnectorOptions.protocol` accepts `legacy` or `agent`, with `legacy`
as the default. Agent mode sends complete client-dispatched Chart requests,
correlates `accepted` and `ui_change`, and applies the response through the same
command processor. It sends `ui_applied` only after that batch settles and waits
for the matching terminal event.

Duplicate delivery cannot repeat a write. Incorrect correlation, malformed
events, missing terminals, and transport loss stop the uncertain exchange.
Late events from a replaced socket cannot satisfy a new request.
Legacy subclasses can still implement their own settlement hook; constructing
a legacy connector does not install a field that hides a subclass method.

This adapter requires a UI-only Engine connection. It does not drive the native
agent configuration's utterance/tool loop. That loop still owns its transcript,
tools, budgets, and server run queue, and rejects client-dispatched Chart requests
with `unsupported_input`.

### Engine and protocol uncertainty stops continuation

Native agent wire version 3 introduces `AgentChartRequestInput` and requires
whole-batch `status` on `ui_applied`. The baseline's `started`, `tool_call`, and
`tool_result` events remain part of the union. Decoders reject older versions.

| Application status | Required evidence | UI-only connection behavior |
| --- | --- | --- |
| `applied` | One successful outcome for every Action | Finish successfully and admit later work |
| `failed` | Layout refusal before Actions; no Action outcomes | Fail this run and allow later work |
| `unknown` | Partial or uncertain application; evidence may be incomplete | Stop admission and cancel queued runs |

Acknowledgment timeout also stops the connection. Later success cannot reopen
it. These rules preserve uncertainty: an unknown outcome never proves that no
write occurred, and a new connection never authorizes replay.

The UI-only route accepts complete `chart_request` inputs only while idle.
Busy requests receive `connection_busy` without reserving their IDs. The client
can later dispatch a fresh snapshot for a request that was definitely refused.
Accepted or uncertain requests cannot be retried automatically.

The request preserves resize and mutation reasons, `intentFacts`, and explicit
`skipReply`. Admission clones it before callbacks. An earlier acknowledgment's
Chart cannot overwrite this newer dispatch-time snapshot. The UI-only route
still requires a usable nonblank reply; it does not widen the Engine's replyless
outcome support.

These are wire-breaking changes for native agent peers. They do not change the
legacy envelope format. Consumers with custom native hosts must upgrade client
and server together and supply the required application status.

### Engine native planning uses configured history

UI-only connections now load the host's configured history and injections when
planning starts. A validated plan is recorded before `ui_change`, using the same
transform, projection, and retention policy as request/reply. History read
failures stop the run. Record failures are logged without discarding a usable
plan.

Stored turns describe planning input and output. They do not certify that the
browser applied the plan. Layout refusal, uncertainty, timeout, and connection
closure do not retract a planning record. Native connections do not consult the
legacy response-replay cache. Reusing an ID across connections is therefore not
a recovery mechanism.

Closing during a history read prevents later planning. Closing during planning
prevents a subsequent record write. An already-started store write can finish
because the store contract has no cancellation signal. Hosts must still
coordinate separate connections that share a session.

See the [Engine connection reference](../packages/engine/README.md#streaming-connections)
for limits, event timing, and diagnostic ownership.

### React and Live session exchange

The React Provider forwards `readyTimeoutMs` to the Orchestrator. The default
remains 500 milliseconds. The value is captured on mount, accepts finite
nonnegative values, and requires a remount to change. Expiry skips an unavailable
Action handler; it never retries a write. Settlement itself remains independent
of React subscriptions.

The OpenAI Live server exchange uses `redirect: 'manual'` instead of
`redirect: 'error'`. It still rejects unsuccessful responses and does not follow
a redirected request with the provider credential. This accommodates workerd's
supported redirect behavior while retaining the server-held-key boundary.

## The three public experimental libraries

| Package | Owns | Does not own |
| --- | --- | --- |
| `@maelstrom-co/agui` | Browser connector, transport-independent client, run validation, acknowledgment, observable errors | Engine, credentials, persistent records |
| `@maelstrom-co/agui-server` | Sequence and revision admission, Engine dispatch, checkpoint restoration | HTTP hosting, authentication, goal decomposition |
| `@maelstrom-co/agui-protocol` | Shared schemas, correlation, Action-identity digest, non-content checkpoints | Browser or server implementation |

The browser package exports the same API at its root and `/browser`. Separate
manifests enforce dependency direction. The server depends on the Engine and
contract package. The browser depends on the client and contract package.
Neither runtime imports the other.

The packages follow the SDK's fixed version, MIT license, public npm metadata,
ES module exports, declaration builds, and generated API-reference registration.
Release discovery includes them because their manifests are publishable.
Runtime tarballs include built output rather than source tests or application
assets. The protocol package also includes its wire-contract document.

Experimental status remains explicit in descriptions, API documentation, and
reference navigation. Public availability does not make the wire mapping stable.
Both endpoints need matching versions. Release preparation chooses the next
SDK-wide version; this stack does not publish an already-used release version.

The binding retains `demo.agui.run`, `demo:workspace-result`, and
`demo:application-result` for compatibility. They are Maelstrom-specific AG-UI
extensions. A supported run contains `RUN_STARTED`, one custom result, and a
successful `RUN_FINISHED` without pending tools. Arbitrary AG-UI agents,
interruptions, and frontend-tool streams are not interchangeable with that
inner protocol. The [wire contract](../packages/agui-protocol/CONTRACT.md)
defines the exact subset.

## App behavior and shared Vessels

`@maelstrom-co/demo-vessels` is a private application-support package for shared
views, definitions, and data helpers. Calendar, Weather, Map, and Labs reuse
those views. The original demo retains its newer Journal and Tasks editors and
activity receipts. The shared Weather implementation includes the compact
Variant and responsive skeleton from the baseline.

The dedicated app supplies its own exact-ID record Actions and read-only views.
Its policy allows one application-effect Action per plan, plus supported
view-only Actions. This is application policy, not a limit in the public
Maelstrom or AG-UI libraries.

The rebase also changes the app's plan validator to respect pre-action Layout
Variants. A Journal can start in `list`, create a record, and transition to
`entry` after handler success. Issuance checks that every Action can replay from
the response Layout and that a new Action target is visible so its handler can
mount. It does not require the Layout to claim the future final Variant.

The app's durable plan and receipt ledger checks the issued plan, Action index,
active binding, record ID, and version. Each mutation and receipt commit in one
transaction. The outer tool declares `expectedMutation`; continuation requires
matching accepted-command and receipt evidence. Missing evidence remains
uncertain. A known mismatch produces `incomplete`.

Those checks prevent specific false completion reports. They cannot prove that
the goal model decomposed every natural-language requirement correctly.
Recovery preserves committed records and receipts in fresh sessions, without
restoring conversation or Layout and without replaying old writes.

## Compatibility evidence and remaining limits

The stack has contract tests for settlement, acknowledgment deadlines, native
history, correlation, dispatch-time snapshots, and dependency boundaries.
Transport-parity tests exercise legacy, native-agent, and AG-UI application
effects. The dedicated app adds issuance, SQL receipts, authorization, and
recovery checks. Packed-consumer and generated-documentation checks validate
the published package surfaces separately from source-conditioned workspace
tests.

These checks establish specific contracts. They do not establish general
cross-runtime AG-UI compatibility or live-model planning reliability.
Deployed Cloudflare recovery, observed native-demo hibernation, and paired
reliability and cost measurements remain acceptance work. Historical live
evidence predating this rebase must not be presented as verification of the
rebased artifacts.

Experimental source integration and full feature graduation have different
evidence requirements. Release publication follows
[the repository release workflow](../CONTRIBUTING.md#releasing), including
first-publication setup for new npm packages. Public metadata alone does not
prove that a package has been published or that deployed acceptance has passed.
