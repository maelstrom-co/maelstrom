# Experimental AG-UI workspace adapter

Three private workspace packages implement the experimental workspace binding used by the [dedicated AG-UI app](../../apps/agui-demo/README.md). They can also serve a headless execution harness without importing the app.

## Entrypoints

| Import | Responsibility |
| --- | --- |
| `@maelstrom-co/agui/browser` | `AguiWorkspaceClient` for host-owned transport, `AguiWebSocketConnector`, complete-run validation, application acknowledgment, and observable protocol errors. |
| `@maelstrom-co/agui-server` | `AguiWorkspaceSession`, Engine dispatch, sequence/revision admission, and checkpoint restoration. |
| `@maelstrom-co/agui-protocol` | Private input, result, correlation, and checkpoint schemas. |

`@maelstrom-co/agui` also exports the browser connector from its root. Its runtime dependencies exclude the Engine and server package. The server package has no client dependency. Both depend on the contract package, which imports only the protocol, AG-UI schemas, and Zod. Separate manifests preserve the repository's browser/server dependency boundary; separate subpaths within one mixed manifest do not.

## Application settlement

The Orchestrator owns response application. After its layout-and-Actions batch settles, it calls the optional `EngineConnector.applicationSettled` method. This callback receives the request ID, canonical batch result, observed Action outcomes, and structural Chart snapshot.

The client awaits the callback before releasing admission for later planning. `OrchestratorOptions.applicationAcknowledgmentTimeoutMs` bounds this wait, starting after Actions settle. It defaults to 60,000 ms and accepts finite positive numbers up to 2,147,483,647 ms. The AG-UI adapter also bounds each protocol run at 60 seconds.

The callback receives an optional `AbortSignal` as its second argument. Timeout, connector replacement, disposal, or acknowledgment failure aborts this signal. The adapter clears its pending run, timer, and listener. Cancellation does not undo or replay executed Actions.

Rejected or expired acknowledgment makes queued completion `unknown` and blocks planning on that binding. Pending intents retain their queue deadlines; automatic updates remain buffered. Immediate intents reject, and subsequent explicit flushes return `null`. Install a different connector to resume planning. Reconnecting the same connector cannot clear uncertainty, and a new session does not reconcile prior writes. Legacy `processIntent()` still resolves on response delivery, before application acknowledgment.

The adapter translates this evidence into its private application run. A successful acknowledgment advances the revision. Failed or unknown application stops the session. Partial execution remains `unknown`, rather than being reported as a definite failure before any write occurred.

React components only subscribe to protocol errors for display. Application acknowledgment requires no React observer or manual Orchestrator attachment.

## Host responsibilities

Applications supply transport, authentication, and their Engine configuration. The server session accepts a lazy Engine supplier, an event sender, and a synchronous checkpoint callback. The dedicated app uses a same-origin HTTP exchange with a durable app-owned plan and receipt ledger. Its [compatibility reference](../../apps/agui-demo/README.md#runtime-boundaries) separates outer TanStack frontend-tool continuation from the inner workspace operations.

The adapter retains the experimental `demo.agui.run` and `demo:*` wire names. They are compatibility identifiers for a private binding. These packages do not establish standard mid-run AG-UI input semantics or a stable public runtime contract. The [workspace contract](../agui-protocol/CONTRACT.md) defines the wire mapping, typed local failure reasons, and recovery limits. The [historical demo integration](../../apps/demo/AGUI.md) preserves the earlier socket-attachment design.
