# What the workspace round trip proves

AG-UI can carry a validated Maelstrom workspace operation while TanStack AI
owns tool execution and continuation. This example implements a narrow,
private adapter for one goal. It does not establish a general SDK adapter.

## The executed path

1. An AG-UI `RunAgentInput` advertises `apply_workspace` and supplies one user goal.
2. TanStack's released `fakeText` adapter proposes a scripted workspace response.
   The real Maelstrom Engine validates that candidate against the Vessel catalog.
   The host refuses a healed response that loses the required Action.
3. Run 1 emits a complete frontend call and finishes with `apply-1` pending.
4. The frontend passes the response into the Orchestrator's existing
   `PushConnector` subscription. The Orchestrator dispatches its own settled
   command batch. Layout creates `notes-1` before the `create` Action executes.
5. The frontend returns correlated Action outcomes and `readStructuralSnapshot`
   in a tool message. This starts run 2 without another user goal.
6. Run 2 executes `delegate_lookup`. That server tool starts a nested TanStack
   chat whose `read_created_note` tool reads the local store.
7. The read returns a canonical ID and version. The next scripted model step
   obtains those values from the actual tool-result message. A second Engine
   response passes them to `focus` through `apply-2`.
8. After the second frontend acknowledgment, run 3 reports completion.

Actions return only `Result<undefined, Error>`. Their acknowledgments contain no
record ID or other domain output. The separate read supplies those values.
The test changes the allocated ID from the demo value to detect hard-coded
result binding. The goal never contains that ID.

The original demo is headless. A fixture registers Action handlers after the
real layout store changes. The browser experiment instead mounts the existing
React Chart and registers handlers through `useActions`. Chromium verifies
the visible Notes Vessel, exact record focus, command order, and a 12×8 grid
measured from the 960×640 container. Its viewport is 1200×1100. The create Action
calls the loopback server; the delegated read observes that server-owned record.
Resize races, routing, and multi-writer behavior remain untested.

## Release-specific protocol translation

Installed manifests confirm `@tanstack/ai@1.0.0` and `@ag-ui/core@1.0.0`.
The new lockfile entries only register this private workspace; they do not
upgrade other dependencies. Maelstrom workspace packages are version `0.1.0`.

Released source and executed assertions found these differences from some docs:

- AG-UI validators live at `@ag-ui/core/schemas`, separate from the root exports.
- TanStack's `chatParamsFromRequestBody` performs structural checks without Zod.
  The host first uses the actual AG-UI `RunAgentInputSchema` for full validation.
- TanStack emits pending frontend tools as `tanstack:client_tool_execution`
  interrupts. The [AG-UI frontend-tool rules][tools] require success or no outcome.
- The exercised TanStack server-tool loop emits two `RUN_FINISHED` events for
  run 2. The [run lifecycle][lifecycle] permits one terminal event per run.
- Raw runtime usage can still be an object. Official serialization normalizes
  internal events and message snapshots into the public wire contract.

`src/boundary.ts` holds model-turn terminal events until the runtime finishes.
It emits one outer terminal and translates only the known client-tool interrupt
to `success.pendingToolCallIds`. It omits usage rather than presenting one
model turn's estimate as the whole run's usage. Other interrupt kinds fail.
No provider adapter or installed package is patched.

The host translates the next correlated tool message into TanStack's supported
`resume` entry with `parentRunId`. TanStack validates and consumes the frontend
result. The fixture therefore crosses a real client-tool continuation boundary.
It does not merely concatenate unrelated event fixtures.

`toServerSentEventsResponse` owns wire serialization. The consumer uses the
official `EventSchemas` on every received event. It checks run boundaries and
requires both `TOOL_CALL_END` and successful run completion before execution.
The decoder is deliberately limited to the serializer's SSE format. It is not
a general SSE client or a full AG-UI conformance suite.

Source inspection locations inside the installed TanStack package:
`src/testing/fake-text.ts`, `src/utilities/chat-params.ts`,
`src/activities/chat/index.ts` (`buildActionableInterrupts`, ephemeral resume,
and deferred model terminals), `src/interrupt-resume.ts`, and
`src/stream-to-response.ts`. AG-UI's released `package.json` declares the schema
subpath. These release-specific facts take precedence over older examples.

## Acknowledgment and interruption policy

- Each workspace call records its promise before another delivery can execute.
  An exact duplicate shares the original outcome. Changed duplicate arguments
  fail. This protection lasts only for this in-memory workspace.
- A call must match the current local revision. Each dispatched batch advances
  that revision, including a partially successful batch. Stale plans are refused.
- Host acknowledgments must match the pending call, response request ID,
  revision, and Action identities. Repeated or stale runs receive HTTP 409.
  The stored conversation prefix cannot be replaced by the caller.
- A delayed handler delays its acknowledgment. A failed or missing handler
  yields an unknown batch outcome. The next run stops without retrying.
- Abort before dispatch changes nothing. Abort during a handler does not cancel
  its underlying business effect. The fixture waits for settlement, reports
  unknown, and closes that workspace to new calls.
- Lost acknowledgment leaves the parent waiting. No automatic mutation retry
  occurs. There is no restart recovery or reconciliation service.
- Parent request abort or SSE reader disconnect reaches the nested read's
  abort signal. The parent stops before the dependent frontend call.

The nested read has no approval or frontend pause. Child interrupt persistence
and child resume are unsupported. After child abort, this parent cannot resume;
it remains stopped. The child is an application-owned nested `chat()` call,
not TanStack's subagent API. Its raw trace is separate; no AG-UI `SUBAGENT_*`
events or distributed child recovery are claimed.

The separate `src/child.test.ts` experiment uses TanStack's actual `defineAgent`
and routed `subagents` APIs. A child tool with `needsApproval` suspends the
parent. `StreamProcessor` records child state; `uiMessagesToWire` serializes it
for `chatParamsFromRequestBody`. A new parent run forwards the approval and
resumes the same `subagentRunId`. Approval performs one read; denial performs
none. Both cases pass through the official SSE serializer and AG-UI validators.
This establishes child approval continuation in the released runtime. The
workspace host still rejects these interrupts. Restart durability and a combined
workspace-plus-child-approval flow remain unproven.

The revision policy covers this single writer only. It does not observe arbitrary
manual edits, resize races, other Charts, or other processes. Structural settlement
does not certify browser paint, loaded content, or a durable business commit.

## Voice and changing an active goal

Voice media remains outside AG-UI. The prototype never opens a microphone,
voice provider, WebRTC connection, or speech playback channel.

Mid-task amend or supersede needs application-owned goal identity, admission,
classification, safe cancellation points, and stale-result rules. It also needs
a defined consumer-to-agent input channel while a run is active. Switching SSE
to WebSockets supplies transport, not those semantics.

Pushed speech after a voice tool returns needs a separate provider-specific
proof: acknowledge acceptance, later request speech, correlate playback and
task identities, then test barge-in, supersede, disconnect, and queued messages.
No provider parity, audible delivery, or production voice guarantee is proven.

## Adoption recommendation

Keep the workspace semantics in Maelstrom. Treat this adapter as evidence that
an external agent loop can own a goal and return observed workspace outcomes.
Resolve the TanStack release-specific protocol differences upstream or retain
an explicitly version-tested boundary before broad adoption.

Production needs authenticated session ownership, authorization at each business
operation, trusted reconciliation, bounded input streams and waits, durable
operation identity, and broader transport tests. The local store has no external
effects. The host serves one fixed fixture thread and is not a deployable service.
The example accepts at most three parent runs and eight workspace call identities.

AG-UI supplies interaction semantics. Maelstrom supplies its workspace model.
Generic tools, components, shared state, approvals, and navigation are not
exclusive to Maelstrom. CopilotKit is the closer application-framework comparison.

[tools]: https://docs.ag-ui.com/spec/1.0/events/tool-calls.md
[lifecycle]: https://docs.ag-ui.com/spec/1.0/events/lifecycle.md
