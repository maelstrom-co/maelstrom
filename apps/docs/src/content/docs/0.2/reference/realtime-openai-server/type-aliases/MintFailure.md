---
editUrl: false
next: false
prev: false
title: "MintFailure"
---

> **MintFailure** = \{ `reason`: `Exclude`\<[`MintFailureReason`](/reference/realtime-openai-server/type-aliases/mintfailurereason/), `"upstream-failure"`\>; \} \| \{ `reason`: `"upstream-failure"`; `upstreamStatus?`: `number`; \}

Defined in: packages/realtime-protocol/dist/lib/mint.d.ts:38

Failure detail for a mint call. `upstreamStatus` is only ever present when
`reason` is `upstream-failure`, and even then only when the provider
returned an HTTP response (it's absent when the upstream call itself threw,
e.g. a network error).
