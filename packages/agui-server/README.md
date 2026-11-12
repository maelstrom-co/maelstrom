# @maelstrom-co/agui-server

Public experimental server package for the Maelstrom AG-UI workspace binding. Its root exports `AguiWorkspaceSession` and `rejectWorkspaceRun`. Use matching versions of the browser, server, and protocol packages; the experimental contract may change between releases.

API reference: <https://docs.maelstrom-ai.co/reference/agui-server/readme/>.

The session enters planning through the existing Engine and requires correlated application evidence before admitting another plan. The host supplies authentication, event delivery, and synchronous checkpoint storage. This package depends on the Engine and shared AG-UI contract, with no browser package dependency.

Validate ingress with `readWorkspaceRun` or `WorkspaceRunSchema` from `@maelstrom-co/agui-protocol` before calling `run`. Authorize the session before creating it. The sender receives event objects for host-owned serialization. Checkpoint writes are synchronous and can throw; hosts must treat a failed write as a stopped connection.

The runtime needs Web Crypto and `TextEncoder`. It contains no HTTP server, persistence backend, authentication policy, or goal loop. The [dedicated app](../../apps/agui-demo/README.md) supplies those pieces. See the [wire contract](../agui-protocol/CONTRACT.md) for admission and recovery semantics.
