---
editUrl: false
next: false
prev: false
title: "historyError"
---

> `const` **historyError**: `object`

Defined in: packages/engine/src/lib/errors.ts:276

Per-operation factories for [HistoryError](/reference/engine/interfaces/historyerror/). Each constructor pins
its `operation` literal at the type level, so an in-package call site
can no longer tag (for example) a `record_turn` failure as
`add_assistant_message` by passing the wrong string.

Prefer these over hand-constructing the discriminated union directly. The
type itself remains structurally exported for consumers' pattern-matching;
the constructor-only guarantee applies to in-package construction only.

## Type Declaration

### addAssistantMessage

> `readonly` **addAssistantMessage**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)

### clear

> `readonly` **clear**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)

### getHistory

> `readonly` **getHistory**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)

### getLLMContext

> `readonly` **getLLMContext**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)

### leaderPipeline

> `readonly` **leaderPipeline**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)

### recordTurn

> `readonly` **recordTurn**: (`message`, `cause`) => [`HistoryError`](/reference/engine/interfaces/historyerror/)

#### Parameters

##### message

`string`

##### cause

`unknown`

#### Returns

[`HistoryError`](/reference/engine/interfaces/historyerror/)
