---
name: maelstrom-devtools-mcp-server-sdk
description: Version-matched guide for local MCP inspection of Maelstrom DevTools. Load when installing the stdio command, embedding its server, or debugging pairing and scoped reads.
license: MIT
metadata:
  author: Maelstrom
  sdkPackage: '@maelstrom-co/devtools-mcp-server'
---

Read the installed package's `package.json` version as the version authority.
Confirm exports and declarations from that installation before choosing options.

Use this server for explicitly paired, local metadata reads. Keep the browser
bridge in the application's development lifecycle. The server runtime consumes
neutral wire contracts and does not import browser implementations.

Configure an exact HTTP loopback app origin. Treat the process-scoped pairing
credential as private local configuration. The CLI creates a new file and refuses
an existing path. Use a directory restricted to the current account. It creates
files with mode `0600` on POSIX; on Windows, restrict the directory's ACL before
startup because the CLI does not configure it. Keep credentials outside the
repository and tool results.

Read targets, then app handles, then events or a request. Use the app's opaque
`id` as `appId`; its `reportedId` is projected evidence. Missing or colliding
identities remain unavailable. Preserve cursor arguments and report source-wide
loss separately from hidden or viewer-omitted events. Cleanup releases the local
connection and preserves human recordings.

For startup, lifecycle, and read examples, read
[common tasks](references/common-tasks.md).
