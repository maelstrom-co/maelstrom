---
editUrl: false
next: false
prev: false
title: "assertValidSplitWeights"
---

> **assertValidSplitWeights**(`weights`): `void`

Defined in: packages/protocol/src/lib/response.ts:360

Throws unless `weights` satisfies the invariant [ParsedTilingSplit](/reference/protocol/interfaces/parsedtilingsplit/)
documents: 2 to `MAX_SPLIT_CHILDREN` entries, each an integer from 1 to
`MAX_SPLIT_WEIGHT`.

[parseTilingSplitToken](/reference/protocol/functions/parsetilingsplittoken/) clamps its way to that invariant, so nothing
it returns can violate it — but the type is a plain `number[]`, and every
other path that builds a weighted split (a renderer's child list, a test
fixture, a healer rewriting an arity) type-checks fine with `0`, `-5` or
`1.5`. Those values do not fail loudly downstream; they produce a region
of zero or negative extent, or a normalizing sum that no longer divides the
parent cleanly. Construction is the last point where the offending value is
still attributable to the code that invented it.

## Parameters

### weights

readonly `number`[]

## Returns

`void`
