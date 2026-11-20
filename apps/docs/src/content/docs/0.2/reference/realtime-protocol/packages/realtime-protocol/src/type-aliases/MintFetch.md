---
editUrl: false
next: false
prev: false
title: "MintFetch"
---

> **MintFetch** = (`url`, `init`) => `Promise`\<`Response`\>

Defined in: packages/realtime-protocol/src/lib/mint.ts:6

Fetch implementation a minter calls upstream with. Defaults to the global
`fetch`; a server-side minter accepts one so tests can inject a fake and
avoid a real network call.

## Parameters

### url

`string`

### init

`RequestInit`

## Returns

`Promise`\<`Response`\>
