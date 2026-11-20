---
editUrl: false
next: false
prev: false
title: "ParsedTilingSplit"
---

Defined in: packages/protocol/src/lib/response.ts:109

The axis and per-child weights a split token declares.

## Properties

### axis

> `readonly` **axis**: [`TilingSplit`](/reference/protocol/type-aliases/tilingsplit/)

Defined in: packages/protocol/src/lib/response.ts:111

The region is divided along this axis.

***

### discardedChildCount

> `readonly` **discardedChildCount**: `number`

Defined in: packages/protocol/src/lib/response.ts:153

How many weight fields past `MAX_SPLIT_CHILDREN` the token declared and
this parse discarded.

Non-zero means the token's arity was cut, so the subtrees those slots
would have consumed are re-parented onto an ancestor rather than
disappearing. That reshapes the tree, which is why consumers that report
on model output treat it as a drop rather than a repair.

***

### repaired

> `readonly` **repaired**: `boolean`

Defined in: packages/protocol/src/lib/response.ts:135

True when the token's suffix was not spelled as the grammar requires and
`weights` holds the repaired substitute rather than a faithful reading.
A field is well formed only when it is a plain positive integer with no
sign, no leading zero, and no exponent or radix prefix, so `"V:1e3,1"`
and `"V:+2,1"` are reported here even though they coerce to a number.
Consumers that report on model output surface this; consumers that only
need geometry can ignore it.

Equivalent to `repairReason !== null`, and never a sufficient basis for
an explanation on its own — a consumer that words a message from this
flag alone mis-describes the other repair kinds.

***

### repairReason

> `readonly` **repairReason**: [`TilingSplitRepairReason`](/reference/protocol/type-aliases/tilingsplitrepairreason/) \| `null`

Defined in: packages/protocol/src/lib/response.ts:143

Which of the repairs `repaired` reports actually happened, or `null` when
the token was read faithfully.

Consumers that render a message about model output branch on this rather
than on `repaired`, so the wording matches the defect.

***

### weights

> `readonly` **weights**: readonly \[`number`, `number`, `number`\]

Defined in: packages/protocol/src/lib/response.ts:121

One weight per child, so `weights.length` is the token's arity. Always
between 2 and `MAX_SPLIT_CHILDREN` entries, each an integer between 1 and
`MAX_SPLIT_WEIGHT`.

The two-or-more tuple is the arity half of that invariant, stated in the
type: a consumer pairing each weight with a child slot can destructure
two of them without inventing a fallback for a split that has neither.
