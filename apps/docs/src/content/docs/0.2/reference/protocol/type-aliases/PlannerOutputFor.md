---
editUrl: false
next: false
prev: false
title: "PlannerOutputFor"
---

> **PlannerOutputFor**\<`R`\> = `R` *extends* `unknown` ? \[`SkipReplyFlagOf`\<`R`\>\] *extends* \[`false` \| `undefined`\] ? [`GridResponse`](/reference/protocol/type-aliases/gridresponse/) \| [`TilingResponse`](/reference/protocol/type-aliases/tilingresponse/) : `ReplylessPlannerOutput` : `never`

Defined in: packages/protocol/src/lib/request.ts:278

The Planner output a request of type `R` may receive, chosen by its
[ChartRequest.skipReply](/reference/protocol/interfaces/chartrequest/#skipreply) flag:

- flag absent or `false`: [GridResponse](/reference/protocol/type-aliases/gridresponse/) or [TilingResponse](/reference/protocol/type-aliases/tilingresponse/),
  both with a required `userMessage`
- flag `true`: [GridResponseWithoutReply](/reference/protocol/type-aliases/gridresponsewithoutreply/),
  [TilingResponseWithoutReply](/reference/protocol/type-aliases/tilingresponsewithoutreply/) or [NeedsClarification](/reference/protocol/interfaces/needsclarification/)
- flag only known as `boolean`: the `true` case, since the request may
  have set it

Distributes over a union of request types.

## Type Parameters

### R

`R` *extends* `object`
