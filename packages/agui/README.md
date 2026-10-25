# Experimental AG-UI workspace adapter

`@maelstrom-co/agui` is a private workspace package. Its browser, server, and contract entrypoints implement the demo's experimental AG-UI binding. They can also serve a headless execution harness without importing the demo.

## Entrypoints

| Import | Responsibility |
| --- | --- |
| `@maelstrom-co/agui/browser` | `AguiWebSocketConnector`, complete-run validation, application acknowledgment, and observable protocol errors. |
| `@maelstrom-co/agui/server` | `AguiWorkspaceSession`, Engine dispatch, sequence/revision admission, and checkpoint restoration. |
| `@maelstrom-co/agui/contract` | Private input, result, correlation, and checkpoint schemas. |

The browser entrypoint has no Engine dependency. The server entrypoint has no client dependency. The contract imports only the protocol, AG-UI schemas, and Zod. There is no combined root entrypoint.

## Application settlement

The Orchestrator owns response application. After its layout-and-Actions batch settles, it calls the optional `EngineConnector.applicationSettled` method. This callback receives the request ID, canonical batch result, observed Action outcomes, and structural Chart snapshot.

The client awaits the callback before releasing admission for later planning. A rejected acknowledgment makes queued completion `unknown`; it never retries application. Connectors must bound their acknowledgment wait. The AG-UI adapter uses a 60-second run timeout.

The adapter translates this evidence into its private application run. A successful acknowledgment advances the revision. Failed or unknown application stops the session. Partial execution remains `unknown`, rather than being reported as a definite failure before any write occurred.

React components only subscribe to protocol errors for display. Application acknowledgment requires no React observer or manual Orchestrator attachment.

## Host responsibilities

Applications supply WebSocket options, authentication, host control frames, and their Engine configuration. The server session accepts a lazy Engine supplier, an event sender, and a synchronous checkpoint callback. The demo binds that callback to Durable Object socket attachments.

The adapter retains the experimental `demo.agui.run` and `demo:*` wire names. They are compatibility identifiers for a private binding. This package does not establish standard mid-run AG-UI input semantics or a stable public runtime contract. The [workspace contract](../../apps/demo/AGUI.md) defines the wire mapping and recovery limits.
