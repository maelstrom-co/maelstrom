---
editUrl: false
next: false
prev: false
title: "DevtoolsMcpHost"
---

Defined in: packages/devtools-mcp-server/src/index.ts:86

Local listener and MCP factory owned by one host process.

## Properties

### endpoint

> `readonly` **endpoint**: `string`

Defined in: packages/devtools-mcp-server/src/index.ts:88

Loopback WebSocket URL for explicitly paired browsers.

***

### pairingToken

> `readonly` **pairingToken**: `string`

Defined in: packages/devtools-mcp-server/src/index.ts:90

In-memory pairing credential. Do not log it or return it from tools.

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: packages/devtools-mcp-server/src/index.ts:94

Releases all sockets and resolves outstanding reads as unavailable.

#### Returns

`Promise`\<`void`\>

***

### createServer()

> **createServer**(): `McpServer`

Defined in: packages/devtools-mcp-server/src/index.ts:92

Creates an MCP interface sharing this host's paired targets.

#### Returns

`McpServer`
