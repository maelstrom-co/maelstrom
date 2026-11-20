---
editUrl: false
next: false
prev: false
title: "RealtimeOpening"
---

> **RealtimeOpening** = \{ `generatedOpening?`: `never`; `greeting`: \{ `text`: `string`; \}; \} \| \{ `generatedOpening`: \{ `instructions`: `string`; \}; `greeting?`: `never`; \}

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:91

How a session opens: a fixed greeting spoken verbatim, or a generated
introduction. Both share one introduction per Maelstrom session, including
across provider switches: once either was attempted, neither runs again.

## Union Members

### Type Literal

\{ `generatedOpening?`: `never`; `greeting`: \{ `text`: `string`; \}; \}

#### generatedOpening?

> `readonly` `optional` **generatedOpening?**: `never`

Excluded: choose one opening.

#### greeting

> `readonly` **greeting**: `object`

Fixed assistant line, acknowledged in Engine history before speech.

##### greeting.text

> `readonly` **text**: `string`

***

### Type Literal

\{ `generatedOpening`: \{ `instructions`: `string`; \}; `greeting?`: `never`; \}

#### generatedOpening

> `readonly` **generatedOpening**: `object`

Natural introduction; use an explicit language in these trusted instructions.

##### generatedOpening.instructions

> `readonly` **instructions**: `string`

#### greeting?

> `readonly` `optional` **greeting?**: `never`

Excluded: choose one opening.
