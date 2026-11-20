---
editUrl: false
next: false
prev: false
title: "parseTilingSplitToken"
---

## Call Signature

> **parseTilingSplitToken**(`token`): [`ParsedTilingSplit`](/reference/protocol/interfaces/parsedtilingsplit/)

Defined in: packages/protocol/src/lib/response.ts:265

Reads a split token's axis and arity, or returns null for a node that is not
a split token.

Bare `'H'` / `'V'` parse as `weights: [1, 1]`, so an unweighted tree runs the
same arithmetic it always did. A malformed suffix is repaired rather than
rejected — a split node's arity is unknown until its weights are read, and
dropping the node would mean dropping subtrees whose extent cannot be
determined. Each field is clamped independently, with no rescaling: a
non-numeric or sub-1 field becomes 1, a fractional field rounds to the
nearest integer, a field above `MAX_SPLIT_WEIGHT` is capped, fewer than two
fields pad to two, and fields beyond `MAX_SPLIT_CHILDREN` are discarded.
`repaired` reports that any of that happened.

An empty field declares nothing, so it is ignored rather than filled in:
`"V:1,1,"` is a two-way split, not a three-way one. Reading a stray comma
as an extra child would raise the token's arity, and arity is what advances
the preorder cursor, so a typo would silently steal the following subtree
from whichever ancestor owned it.

Every returned object carries all five fields; none is optional.

### Parameters

#### token

[`TilingSplitToken`](/reference/protocol/type-aliases/tilingsplittoken/)

### Returns

[`ParsedTilingSplit`](/reference/protocol/interfaces/parsedtilingsplit/)

### Example

```ts
// { axis: 'V', weights: [1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
parseTilingSplitToken('V');
// { axis: 'V', weights: [1, 1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
parseTilingSplitToken('V:1,1,1');
// { axis: 'V', weights: [1, 1], repaired: true, repairReason: 'unreadable', discardedChildCount: 0 }
parseTilingSplitToken('V:abc');
// null
parseTilingSplitToken(null);
```

## Call Signature

> **parseTilingSplitToken**(`token`): [`ParsedTilingSplit`](/reference/protocol/interfaces/parsedtilingsplit/) \| `null`

Defined in: packages/protocol/src/lib/response.ts:268

Reads a split token's axis and arity, or returns null for a node that is not
a split token.

Bare `'H'` / `'V'` parse as `weights: [1, 1]`, so an unweighted tree runs the
same arithmetic it always did. A malformed suffix is repaired rather than
rejected — a split node's arity is unknown until its weights are read, and
dropping the node would mean dropping subtrees whose extent cannot be
determined. Each field is clamped independently, with no rescaling: a
non-numeric or sub-1 field becomes 1, a fractional field rounds to the
nearest integer, a field above `MAX_SPLIT_WEIGHT` is capped, fewer than two
fields pad to two, and fields beyond `MAX_SPLIT_CHILDREN` are discarded.
`repaired` reports that any of that happened.

An empty field declares nothing, so it is ignored rather than filled in:
`"V:1,1,"` is a two-way split, not a three-way one. Reading a stray comma
as an extra child would raise the token's arity, and arity is what advances
the preorder cursor, so a typo would silently steal the following subtree
from whichever ancestor owned it.

Every returned object carries all five fields; none is optional.

### Parameters

#### token

[`TilingNode`](/reference/protocol/type-aliases/tilingnode/)

### Returns

[`ParsedTilingSplit`](/reference/protocol/interfaces/parsedtilingsplit/) \| `null`

### Example

```ts
// { axis: 'V', weights: [1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
parseTilingSplitToken('V');
// { axis: 'V', weights: [1, 1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
parseTilingSplitToken('V:1,1,1');
// { axis: 'V', weights: [1, 1], repaired: true, repairReason: 'unreadable', discardedChildCount: 0 }
parseTilingSplitToken('V:abc');
// null
parseTilingSplitToken(null);
```
