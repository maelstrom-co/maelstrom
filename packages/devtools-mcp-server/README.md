# @maelstrom-co/devtools-mcp-server

Local, read-only MCP access to a Maelstrom DevTools collector. The server exposes
`list_targets`, `list_apps`, `query_events`, and `get_request` over stdio.
The browser collector connects through `@maelstrom-co/devtools/mcp-bridge`.

Connect a local app using the [setup guide](https://docs.maelstrom-ai.co/guides/devtools-mcp/).
The browser fixture lives in `examples/`. It emits synthetic metadata and makes
no provider calls. The React extension does not yet expose its collector.

## Embedding

```ts
import { createDevtoolsMcpServer } from '@maelstrom-co/devtools-mcp-server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const host = await createDevtoolsMcpServer({ origin: 'http://localhost:4200' });
const stdio = serveStdio(() => host.createServer());

// Supply host.endpoint and host.pairingToken through a private local pairing flow.
// Release stdio and host when the owning process stops.
await stdio.close();
await host.close();
```

`createDevtoolsMcpServer` binds an ephemeral port on `127.0.0.1`.
It accepts browser upgrades only from the exact configured HTTP loopback origin.
Every authenticated connection gets a fresh opaque target ID.
The pairing token grants access to all collectors explicitly paired with that process;
native local processes run under the trusted local-user threat model.

The CLI writes its token to a new `--pairing-file` in a user-restricted directory.
It uses mode `0600` on macOS and Linux. On Windows, restrict the directory's ACL
before startup; the CLI does not configure Windows ACLs.
It removes only its owned file on graceful shutdown and keeps tokens out of logs and tool results.
An abrupt process kill can leave a stale file. Choose a new path or remove the
stale file after confirming that its process has stopped.

## Reads and limits

Every app read requires `targetId`. Event and request reads also require `appId`.
Use the opaque app handle returned by `list_apps`. Its separate `reportedId`
contains the application's projected metadata identity. Redacted, absent, or
colliding identities remain unavailable or ambiguous.
Selectors never broaden when an app or target disappears.
Queries use the collector's recent, request, or retained connection metadata;
they do not access recordings, imports, content readers, or full app inspection.

Event filters share the browser panel's semantics. Default pages contain 25 rows,
with a maximum of 100. A cursor binds the original operation, app, view, criteria,
request, and limit. Two frozen query sessions remain available for up to 30 seconds,
with a 1 MiB budget each. Clear, disconnect, and disposal invalidate reads.
The bridge rejects oversized evidence rather than silently dropping events.

Browser envelopes are limited to 256 KiB. The server permits eight sockets and
sixteen pending reads per target, with five-second pairing and read deadlines.
Returned loss counters cover all apps in the collector. Connection loss is unknown.
Durations use the producer's reported clock; absent or ambiguous evidence remains explicit.

Read failures return `{ ok: false, error }` and set MCP `isError`.
Codes include `target_unavailable`, `app_unavailable`, `request_unavailable`,
`stale_cursor`, `limit_exceeded`, `timeout`, `cancelled`, and `evidence_unavailable`.
The MCP SDK rejects malformed tool arguments before dispatch.

Server discovery includes instructions for app selection, paging, and interpreting
evidence. Failed reads preserve `structuredContent` and its JSON text block, then
add fixed recovery guidance as a second text block. The guidance uses each tool's
accepted arguments and asks clients to make at most one recovery attempt while
preserving the intended target, app, and request.

The server's runtime dependencies exclude browser packages. Shared wire contracts
live in `@maelstrom-co/devtools-protocol`. The browser installs its bridge through
`@maelstrom-co/devtools/mcp-bridge` and keeps application redaction in place.
