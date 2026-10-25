# What the AG-UI prototype adds

An external agent can pursue a multi-step goal while Maelstrom controls the
workspace. The prototype makes that boundary executable and testable.

## Follow one goal

The user asks: “Create a note and focus the new record.”

```text
Run 1: propose → Engine validation → apply_workspace
       → set_layout → React mount → create → acknowledgment

Run 2: consume acknowledgment → native child → approval interrupt

Run 3: resume the child → read canonical ID/version
       → Engine validation → apply_workspace → focus → acknowledgment

Run 4: consume acknowledgment → report completion
```

The new record ID is absent from the original goal. The second Action receives
it from an actual read result. This is why the continuation matters: the agent
can choose its next operation using observed application state.

## Read the change

- [host.ts](./src/host.ts) owns the scripted agent loop and accepts only the
  expected acknowledgment before continuing.
- [planner.ts](./src/planner.ts) sends proposed layouts and Actions through the
  real Engine. Invalid capabilities fail before frontend dispatch.
- [workspace.ts](./src/workspace.ts) uses the Orchestrator's push path, waits for
  command settlement, and returns Action outcomes plus a structural snapshot.
- [boundary.ts](./src/boundary.ts) adapts two observed TanStack 1.0 behaviors:
  repeated model-turn terminals and frontend calls represented as interrupts.
- [browser.tsx](./src/browser.tsx) mounts the real Chart and Notes Vessel. Its
  React handlers perform create and focus.
- [child.test.ts](./src/child.test.ts) separately proves native child approval
  interruption and continuation, including denial.
- [approved-lookup.ts](./src/approved-lookup.ts) defines the native reader used
  inside the combined goal. [approval-flow.test.ts](./src/approval-flow.test.ts)
  checks approval, denial, stale input, disconnect, and restart rejection.

The Action contract returns success or failure, without business data. The
explicit read supplies the canonical record ID and version. A structural
snapshot describes the workspace; it does not replace that read.

## What we gain

Maelstrom can participate in an external agent loop without moving its workspace
rules into that agent. Vessels, Variants, Actions, Engine validation, and the
Chart retain their existing roles. AG-UI carries the interaction; TanStack runs
the scripted tool loop.

The adapter also exposes the difficult boundary: when did a frontend operation
actually settle? Its acknowledgment correlates the call, response, revision,
and Action outcomes. Delayed work delays continuation. A stale result cannot
advance the goal. An unknown business outcome stops the agent without a retry.

## How much confidence to place in it

The headless suite and loopback transport tests exercise adverse outcomes.
Chromium verifies real mounting, visible focus, and container-derived geometry.
The native child experiment proves same-child resumption after approval.

All model decisions are scripted. This does not measure model planning quality.
The host serves one fixed thread, keeps state in memory, and has a three-run
budget in baseline mode and a four-run budget in approval mode. Native child
approval now works through the optional workspace route. Durable recovery,
concurrent writers, and voice need further experiments. See
[the complete proof](./PROOF.md).

## Video

The replacement architectural and code walkthrough lasts 5 minutes 33 seconds:

- 0:00: ownership and the server/browser boundary.
- 0:25: proposed layout and declared Actions.
- 0:49: complete frontend tool delivery.
- 1:13: existing layout-before-Actions dispatch.
- 1:39: settlement and structural acknowledgment.
- 2:05: correlation and the unknown-outcome policy.
- 2:30: native child approval and forwarded context.
- 2:54: the actual browser at the approval pause.
- 3:19: admission of the pending child's answer.
- 3:46: outer run framing and message serialization.
- 4:13: binding the observed record into focus.
- 4:38: disconnect and side-effect assertions.
- 5:03: conclusions and the next reconciliation experiment.

The delivered MP4 is `~/Movies/maelstrom-agui-architecture-code-v2.mp4`.
Editable scene source and narration text are in [walkthrough](./walkthrough/).
