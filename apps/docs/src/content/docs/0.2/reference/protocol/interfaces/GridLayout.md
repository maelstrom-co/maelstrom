---
editUrl: false
next: false
prev: false
title: "GridLayout"
---

Defined in: packages/protocol/src/lib/response.ts:46

Cell-based layout reconciled against already-retained Instance metadata.

## Properties

### positions

> `readonly` **positions**: readonly [`GridPosition`](/reference/protocol/interfaces/gridposition/)[]

Defined in: packages/protocol/src/lib/response.ts:50

Only listed, known Instances remain visible after reconciliation.

***

### type

> `readonly` **type**: `"grid"`

Defined in: packages/protocol/src/lib/response.ts:48

Must agree with the request's `layoutMode`.
