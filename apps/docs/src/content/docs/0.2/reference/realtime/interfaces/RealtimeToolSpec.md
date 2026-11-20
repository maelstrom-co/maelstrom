---
editUrl: false
next: false
prev: false
title: "RealtimeToolSpec"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:22

A single tool exposed to the realtime model, in provider-neutral form.
Concrete adapters translate this into whatever shape their provider's
session-config wire format wants (OpenAI's `tools[]`, Google's
`functionDeclarations`, …).

## Type Parameters

### Name

`Name` *extends* `string` = `string`

## Properties

### description

> `readonly` **description**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:24

***

### name

> `readonly` **name**: `Name`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:23

***

### parametersJsonSchema

> `readonly` **parametersJsonSchema**: `unknown`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:26

JSON Schema for the tool's arguments object.
