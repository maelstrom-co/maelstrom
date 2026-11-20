---
editUrl: false
next: false
prev: false
title: "DevtoolsBridgeOptions"
---

Defined in: packages/devtools/src/mcp-bridge.ts:14

Explicit configuration for a local inspector connection.

## Properties

### endpoint

> `readonly` **endpoint**: `string`

Defined in: packages/devtools/src/mcp-bridge.ts:16

Local listener endpoint supplied by the MCP process.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: packages/devtools/src/mcp-bridge.ts:20

Cancels connection setup and releases the socket after pairing.

***

### token

> `readonly` **token**: `string`

Defined in: packages/devtools/src/mcp-bridge.ts:18

Process-scoped pairing credential, kept in memory.
