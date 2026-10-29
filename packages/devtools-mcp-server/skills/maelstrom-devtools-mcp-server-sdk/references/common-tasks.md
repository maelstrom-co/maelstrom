# Local MCP inspection

Inspect the installed manifest and declarations before using these examples.

## Embed the listener

Create the listener during explicit host startup. Pass `host.createServer` to
your MCP SDK's stdio transport. Supply the endpoint and pairing credential through
an authorized private local flow. Stop the stdio transport before closing the host.

```ts
import { createDevtoolsMcpServer } from '@maelstrom-co/devtools-mcp-server';

export async function createLocalInspector() {
  const host = await createDevtoolsMcpServer({
    origin: 'http://localhost:4200',
  });
  return host;
}
```

The CLI accepts `--origin` and `--pairing-file`. Use a new file path outside the
application checkout, inside a directory restricted to the current account.
It creates the file with mode `0600` on POSIX. On Windows, configure the directory's
ACL before startup; the CLI does not set Windows ACLs.
It removes only its owned file during graceful shutdown, including startup signals.

## Query evidence

Call `list_targets`, then `list_apps(targetId)`. Use the returned app handle with
`query_events` or `get_request`. Queries read live metadata from `recent`,
`requests`, or `connections`. Recorded content and imported files are separate.

Repeat all original arguments with a returned cursor. A page session expires
after 30 seconds, after two newer sessions replace it, or after evidence reset
or disconnect. Unknown request outcomes and timings remain explicit.

## Verify

Pair a development collector and reproduce one known request. Check that MCP and
the panel report the same request outcome and producer duration. Disconnect and
confirm that the old target fails and a human recording remains active.

## Troubleshoot

For pairing failure, check the exact browser origin and a fresh pairing file.
For `app_unavailable`, list app handles again. For `evidence_unavailable`, inspect
the reported identity availability. On `stale_cursor`, query again without the
cursor. Narrow a query on `limit_exceeded`; reducing the limit helps when a page,
rather than its complete frozen query, exceeds the envelope budget.
