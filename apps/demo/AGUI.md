# AG-UI workspace contract

The demo's **Workspace → AG-UI** selection carries workspace planning and application results over the existing `/ws` connection. It works with the normal demo composition, including all registered Vessels and native voice providers. [The demo README](./README.md) describes the selector and key entry.

## Transport and ownership

The experimental [`@maelstrom-co/agui` package](../../packages/agui/README.md) owns the browser adapter, server session, and shared wire schemas. The demo supplies authentication, host dispatch, Engine configuration, and socket checkpoint storage.

The hosted Worker routes `/ws` to the session's existing Durable Object. The same origin checks, connection rate limiter, browser-owned key handshake, heartbeat, and Engine factory serve both protocol selections. Local development uses the existing Bun WebSocket host.

The Engine remains the planning entry point. Its normal Planner, validation, retry policy, and history configuration remain in use. The client Orchestrator admits typed and voice intents through one FIFO and builds the authoritative request snapshot at dispatch. Resize and mutation updates retain their existing coalescing behavior.

Voice audio uses its provider's native connection. A voice `update_ui` call enters the same Orchestrator as typed input and therefore uses the selected workspace protocol. Grounding, captions, provider switching, and speech playback remain in the voice integration. Engine history reads and acknowledged assistant-message insertion use their existing native control frames on the same WebSocket. AG-UI run completion does not acknowledge a spoken greeting or prove audio playback.

## Private input mapping

Each workspace frame has `type: 'demo.agui.run'` and an `input` validated as AG-UI `RunAgentInput`. This is a demo-owned WebSocket binding. The protocol does not define this frame name or these `forwardedProps` operations.

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

Both demo protocol selections allow five seconds for a lazy Vessel's Action runner to register. Cold module loading can exceed the client's default 500 ms. Readiness expiry still skips the Action; it never triggers a write retry.

`RUN_ERROR` carries a safe message and `WORKSPACE_STOPPED`. Its `rawEvent` contains the private thread/run correlation. A terminal event alone never establishes application success. Native Chart-request frames are rejected once that connection has entered the AG-UI workspace flow.

## Hibernation and uncertain outcomes

The connection's hibernation attachment retains only protocol evidence: thread ID, sequence, revision, stopped state, pending correlation, and an Action-identity digest. It stores no key, prompt, Action parameters, Journal content, or Chart snapshot. The digest checks the complete set of acknowledged Action identities, including duplicates.

The existing rehello handshake restores the browser-owned key after idle. The attachment preserves the acknowledgment gate across that handshake. The host marks an in-flight planning checkpoint as stopped before invoking the Engine, so a reset cannot make an unfinished request replayable.

Socket loss during planning or acknowledgment stops continuation. The connector never resends the write. It displays the failure and requires an explicit new session through the protocol selector or page reload. Inspect the application first. A new session does not reconcile an uncertain write.

These attachments last only as long as the socket. Engine conversation history remains memory-only, as in the normal hosted demo. This integration does not add durable goals, cross-reload recovery, Atomic Steps, or general-purpose result-dependent loops. The [separate Journal proof](./EXPERIMENTAL-AGUI.md) demonstrates one bounded result-dependent loop.

## Verification boundaries

The integration tests exercise the real Engine, Orchestrator, WebSocket connector, application settlement, native history acknowledgment, and provider-neutral voice session with deterministic provider fixtures. Worker tests reconstruct the Durable Object between planning and acknowledgment to check key custody and correlation recovery. Browser tests use the hosted bundle and a fixture Planner.

Live voice and platform hibernation require a deployed preview and a browser-owned key. A local reconstruction or a clean idle round trip without an observed rehello is not evidence of actual Cloudflare hibernation.
