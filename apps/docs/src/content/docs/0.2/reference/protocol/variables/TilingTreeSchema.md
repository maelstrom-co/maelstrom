---
editUrl: false
next: false
prev: false
title: "TilingTreeSchema"
---

> `const` **TilingTreeSchema**: `ZodArray`\<`ZodPipe`\<`ZodNullable`\<`ZodString`\>, `ZodTransform`\<`"H"` \| `"V"` \| `` `H:${string}` `` \| `` `V:${string}` `` \| `` `ID:${string}` `` \| `null`, `string` \| `null`\>\>\>

Defined in: packages/protocol/src/lib/schemas.ts:161

Preorder tiling tree. Carries the model-facing description directly, with no
override at the [TilingLayoutSchema](/reference/protocol/variables/tilinglayoutschema/) level: `.describe()` replaces a
description rather than appending to it, so a second call one level up would
make this teaching unreachable by the model that needs it.
