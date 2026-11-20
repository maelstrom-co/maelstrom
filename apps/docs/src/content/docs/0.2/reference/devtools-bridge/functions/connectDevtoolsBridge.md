---
editUrl: false
next: false
prev: false
title: "connectDevtoolsBridge"
---

> **connectDevtoolsBridge**(`tools`, `options`): `Promise`\<() => `void`\>

Defined in: packages/devtools/src/mcp-bridge.ts:28

Pairs a development collector with a loopback, metadata-only inspector.
Rejects in production or when pairing fails. Returns idempotent socket cleanup.
Aborting the signal releases only this connection, including during setup.

## Parameters

### tools

`Devtools`

### options

[`DevtoolsBridgeOptions`](/reference/devtools-bridge/interfaces/devtoolsbridgeoptions/)

## Returns

`Promise`\<() => `void`\>
