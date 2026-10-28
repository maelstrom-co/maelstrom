# Experimental AG-UI workspace server

`@maelstrom-co/agui-server` is a private server package. Its root exports `AguiWorkspaceSession` and `rejectWorkspaceRun`.

The session enters planning through the existing Engine and requires correlated application evidence before admitting another plan. The host supplies authentication, event delivery, and synchronous checkpoint storage. This package depends on the Engine and shared AG-UI contract, with no browser package dependency.

See the [wire contract](../agui-protocol/CONTRACT.md) and [demo host integration](../../apps/demo/AGUI.md).
