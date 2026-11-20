---
editUrl: false
next: false
prev: false
title: "TilingNodeSchema"
---

> `const` **TilingNodeSchema**: `ZodPipe`\<`ZodNullable`\<`ZodString`\>, `ZodTransform`\<`"H"` \| `"V"` \| `` `H:${string}` `` \| `` `V:${string}` `` \| `` `ID:${string}` `` \| `null`, `string` \| `null`\>\>

Defined in: packages/protocol/src/lib/schemas.ts:133

A node in the tiling tree: a split token, an `ID:`-prefixed leaf, or `null`.
Tokens keep the spelling they arrived with.

A malformed weight suffix still passes — `"H:2,x"` is a split whose weights
are repaired downstream by `parseTilingSplitToken`, because rejecting it
costs a model round trip over something the tree's shape survives. A token
belonging to no class is refused instead: it has no shape to survive, and
the only alternatives are guessing which class it meant or letting it stand
as empty space, which turns a mis-spelled layout into a blank Chart with
nothing said about it.

The refusal is `ctx.addIssue` inside the transform rather than a throw. A
throw raised in a Zod transform escapes `safeParse` instead of becoming an
issue, which would turn careless model output into an uncaught error at
whichever boundary parsed it.
