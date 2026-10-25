# AG-UI workspace contract

The experimental `@maelstrom-co/agui` binding carries workspace planning and application results over WebSocket. The [package README](./README.md) describes its entrypoints and ownership. This contract is private to the workspace and is not a stable public runtime API.

## Transport and ownership

The package owns the browser adapter, server session, and shared wire schemas. Applications supply authentication, host dispatch, Engine configuration, and socket checkpoint storage.

The Engine remains the planning entry point. Its configured Planner, validation, retry policy, and history remain in use. The client Orchestrator admits intents through one FIFO and builds the authoritative request snapshot at dispatch. Resize and mutation updates retain their existing coalescing behavior. Native history reads and acknowledged message insertion retain their existing control frames on the same WebSocket.

## Private input mapping

Each workspace frame has `type: 'demo.agui.run'` and an `input` validated as AG-UI `RunAgentInput`. The `demo.*` names are compatibility identifiers for this private WebSocket binding. AG-UI does not define these names or these `forwardedProps` operations.

`threadId` identifies the application session. Each operation has a fresh `runId` and an increasing `sequence`. `messages`, `tools`, and `context` are empty; `state` is null. `forwardedProps` accepts either:

- `kind: 'plan'`: the current acknowledged `revision` and a validated Maelstrom Chart request.
- `kind: 'applied'`: correlation, application status, exact Action outcomes, and the authoritative structural Chart snapshot.

Typed and voice utterances received during active work wait in the client FIFO. Automatic updates wait and coalesce locally. They become later planning runs. Application feedback starts a separate run after command settlement. This mapping preserves the current demo's admission policy; it does not introduce a general interruption classifier or standard mid-run AG-UI input channel.

[AG-UI frontend tool results](https://docs.ag-ui.com/spec/1.0/events/tool-calls.md#frontend-tools) normally return in the next run's tool messages. The private operations above are not frontend tool results. Vessel Actions and layout commands are not loop tools.

## Output and application acknowledgment

A successful run emits `RUN_STARTED`, one `CUSTOM` result, then `RUN_FINISHED` as separate WebSocket messages.

- `demo:workspace-result` carries the validated Engine response and its session, run, request, call, and revision correlation.
- `demo:application-result` confirms acceptance of the correlated application result and advances the workspace revision.

The connector validates the complete run before returning a workspace response. The Orchestrator applies layout before Actions. Its canonical batch settlement supplies Action outcomes and the structural snapshot through `EngineConnector.applicationSettled`. The client awaits this callback before admitting later planning. A failed or incomplete application stops this protocol session. Partial execution is reported as `unknown`. React subscribes to protocol errors for display; acknowledgment requires no component attachment.

`RUN_ERROR` carries a safe message and `WORKSPACE_STOPPED`. Its `rawEvent` contains the private thread/run correlation. A terminal event alone never establishes application success. Native Chart-request frames are rejected once that connection has entered the AG-UI workspace flow.

## Checkpoints and uncertain outcomes

The checkpoint retains only protocol evidence: thread ID, sequence, revision, stopped state, pending correlation, and an Action-identity digest. It stores no key, prompt, Action parameters, application content, or Chart snapshot. The digest checks the complete set of acknowledged Action identities, including duplicates.

The host supplies a synchronous checkpoint callback and restores that evidence when reconstructing a session. Authentication restoration is host-owned. The adapter marks an in-flight planning checkpoint as stopped before invoking the Engine, so a reset cannot make an unfinished request replayable.

Socket loss during planning or acknowledgment stops continuation. The connector never resends the write. It exposes a typed local error through `snapshot()` and `observe()`. Application UI owns recovery instructions. A new session does not reconcile an uncertain write.

The checkpoint is admission evidence, not durable recovery. Engine conversation history follows the host's configuration. This integration does not add durable goals, cross-reload recovery, Atomic Steps, or general-purpose result-dependent loops.

## Verification boundaries

Package tests cover correlation, sequence, duplicate acknowledgments, incomplete evidence, checkpoint restoration, and headless application settlement. The [demo integration](../../apps/demo/AGUI.md) exercises the exported connector with host authentication, native voice, Worker lifecycle, and browser rendering.

## Local failure reasons

`WorkspaceError` carries a `code` and a sanitized `message`. `snapshot()` returns the first terminal error and retains that same object after later failures. Remote error text is not forwarded to application UI.

- `connection_lost`: the connection changed or closed with unfinished work.
- `invalid_run`: output violated event order, completeness, or correlation.
- `run_failed`: the host terminated the run.
- `run_timeout`: the run exceeded its time bound.
- `send_failed`: the transport rejected a send.
- `request_too_large`: the encoded input exceeded the frame limit.
- `planning_failed`: planning failed without an earlier terminal protocol error.
- `application_failed`: the client reported a definite application refusal.
- `application_unknown`: application or its acknowledgment has an uncertain outcome.

Applications can use these codes for presentation. None grants permission to replay an uncertain write.
