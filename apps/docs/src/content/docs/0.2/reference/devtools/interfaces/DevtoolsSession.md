---
editUrl: false
next: false
prev: false
title: "DevtoolsSession"
---

Defined in: packages/devtools/src/types.ts:38

One Provider lifetime, retained after detachment for inspection.

## Properties

### active

> `readonly` **active**: `boolean`

Defined in: packages/devtools/src/types.ts:44

Whether the Provider remains attached.

***

### id

> `readonly` **id**: `string`

Defined in: packages/devtools/src/types.ts:40

Unique Provider lifetime, independent of application session identity.

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: packages/devtools/src/types.ts:42

Application session identifier.

***

### snapshot

> `readonly` **snapshot**: `unknown`

Defined in: packages/devtools/src/types.ts:46

Latest projected client state, with no live instance data.
