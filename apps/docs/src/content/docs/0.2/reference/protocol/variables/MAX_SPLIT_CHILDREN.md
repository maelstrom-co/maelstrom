---
editUrl: false
next: false
prev: false
title: "MAX_SPLIT_CHILDREN"
---

> `const` **MAX\_SPLIT\_CHILDREN**: `12` = `12`

Defined in: packages/protocol/src/lib/model-output-limits.ts:17

Maximum subtrees one weighted tiling split token may declare.

Twelve covers a 2x6 arrangement with headroom and is the real usability
bound on a single split; excess weight fields are discarded rather than
rescaled.
