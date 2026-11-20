---
editUrl: false
next: false
prev: false
title: "MaelstromRealtimeFixedOpeningOptions"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:182

One fixed opening for every session the extension builds.

## Properties

### generatedOpening?

> `readonly` `optional` **generatedOpening?**: `object`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:186

Optional natural introduction with an explicit language. One attempt per Maelstrom session, retained across remounts; cannot accompany greeting.

#### instructions

> `readonly` **instructions**: `string`

***

### greeting?

> `readonly` `optional` **greeting?**: `object`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:195

Optional fixed assistant greeting for each voice session.

When set, `text` is spoken verbatim once per voice session. The shared
GreetingCoordinator acknowledges the line in Engine history before
speech starts, so reconnects and remounts do not double-speak a greeting
the engine already retained.

#### text

> `readonly` **text**: `string`

***

### opening?

> `readonly` `optional` **opening?**: `undefined`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:184

Excluded: use the fixed options or `opening`, not both.
