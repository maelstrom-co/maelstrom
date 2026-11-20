---
editUrl: false
next: false
prev: false
title: "UnixSecondsSchema"
---

> `const` **UnixSecondsSchema**: `ZodPipe`\<`ZodNumber`, `ZodTransform`\<[`UnixSeconds`](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/), `number`\>\>

Defined in: packages/realtime-protocol/src/lib/unix-seconds.ts:17

Wire-format Zod parser for [UnixSeconds](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/). Carries the `UnixSeconds`
brand on `z.infer` output so consumer schemas that reference it stay
branded end-to-end.
