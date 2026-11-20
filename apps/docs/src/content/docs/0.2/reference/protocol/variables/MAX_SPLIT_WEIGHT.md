---
editUrl: false
next: false
prev: false
title: "MAX_SPLIT_WEIGHT"
---

> `const` **MAX\_SPLIT\_WEIGHT**: `1000` = `1000`

Defined in: packages/protocol/src/lib/model-output-limits.ts:27

Maximum value accepted for a single tiling split weight, in ratio units.

Deliberately loose: its job is to bound the arithmetic, not to police
proportions. A tight cap would force ratio-rescaling on malformed input,
where a loose one means real ratios never reach it and clamping one field
in isolation is always adequate.
