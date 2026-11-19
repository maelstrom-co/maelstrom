# @maelstrom-co/agui-protocol

Public experimental contracts for the Maelstrom AG-UI workspace binding. The root exports wire schemas, correlation comparison, and non-content checkpoint evidence used by both runtime layers. Use matching package versions at both endpoints; experimental contracts may change between releases.

API reference: <https://docs.maelstrom-ai.co/reference/agui-protocol/readme/>.

It depends only on `@maelstrom-co/protocol`, AG-UI schemas, and Zod. Browser and server implementations depend on this package; it depends on neither implementation.

`readWorkspaceRun` returns `undefined` for unrelated, oversized, or invalid frames. `workspaceRun` validates its operation and allocates a fresh run ID. `actionDigest` uses Web Crypto SHA-256 over Action identities, including duplicates, without retaining parameters. It certifies identity completeness, not business effects or Action order. The consuming application owns exact-plan and durable-receipt checks.

See the [wire contract](./CONTRACT.md) and [adapter integration](../agui/README.md).
