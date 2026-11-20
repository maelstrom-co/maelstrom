---
editUrl: false
next: false
prev: false
title: "MaelstromRealtimeOpeningOptions"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:166

Opening chosen per provider; excludes the fixed opening options.

## Type Parameters

### Provider

`Provider` = `undefined`

## Properties

### generatedOpening?

> `readonly` `optional` **generatedOpening?**: `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:178

Excluded: `opening` decides the generated opening.

***

### greeting?

> `readonly` `optional` **greeting?**: `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:176

Excluded: `opening` decides the greeting.

***

### opening

> `readonly` **opening**: (`context`) => [`RealtimeOpening`](/reference/react-realtime/type-aliases/realtimeopening/) \| `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:172

Chooses the opening of each built session from its provider, so one
extension can greet on one provider and generate an introduction on
another. Return `undefined` for no opening.

#### Parameters

##### context

[`RealtimeSessionInit`](/reference/react-realtime/interfaces/realtimesessioninit/)\<`Provider`\>

#### Returns

[`RealtimeOpening`](/reference/react-realtime/type-aliases/realtimeopening/) \| `undefined`
